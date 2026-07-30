/**
 * Harness G层（治理安全）- Guardrails 中间件
 *
 * 解决当前项目无输入校验、无输出过滤、无审计日志的短板，提供三层治理能力：
 *
 * 1. InputGuard 输入防护层
 *    - promptInjection 检测（指令注入：高置信阻断、低置信告警）
 *    - 输入长度与复杂度校验
 *    - PII 敏感信息检测（手机号/身份证/邮箱/银行卡），日志中脱敏
 *    - 返回 { passed, reason, sanitized, warnings }
 *
 * 2. OutputGuard 输出过滤层
 *    - 毒性检测（关键词黑名单 + 评分，超阈值阻断）
 *    - 幻觉检测（"绝对"、"100%"等过度确定性表达）
 *    - 格式规范检测（重复内容、编码异常、长度异常）
 *    - 返回 { passed, filtered, warnings }
 *
 * 3. AuditLog 审计日志
 *    - 记录 who(userId) + when(timestamp) + what(endpoint, tool, action)
 *      + input(脱敏) + output(脱敏) + result(success/fail)
 *    - SQLite 持久化（audit_logs 表），使用 database/db.js 的 run/get/all
 *    - 支持多维度查询审计记录
 *
 * Express 中间件导出：
 *    - inputGuardMiddleware：路由前拦截，校验输入
 *    - outputGuardMiddleware：响应前过滤输出
 *    - guardMiddleware：组合输入输出防护（数组形式，可直接 app.use）
 *
 * 设计原则：fail-open，任何中间件内部异常均不阻塞主流程，保证向后兼容。
 */

const crypto = require('crypto');
const { run, get, all } = require('../database/db');

// ===== 全局配置 =====
const CONFIG = {
    maxInputLength: 8000,        // 输入最大字符数
    minInputLength: 1,           // 输入最小字符数（0 表示允许空）
    maxToxicityScore: 5,         // 毒性阻断阈值（累计 severity 达到则拦截）
    auditLogMaxLength: 2000,     // 审计日志单字段最大长度
    auditAllResponses: false,    // 是否对所有响应（含无文本响应）记录审计
    enablePromptInjection: process.env.GUARDRAILS_INJECTION !== 'false',
    enablePIIDetection: process.env.GUARDRAILS_PII !== 'false',
    enableToxicity: process.env.GUARDRAILS_TOXICITY !== 'false',
    enableHallucination: process.env.GUARDRAILS_HALLUCINATION !== 'false',
};

// ===== 指令注入检测模式 =====
// 高置信度（命中即阻断）
const PROMPT_INJECTION_BLOCK_PATTERNS = [
    /忽略(以上|上面|之前|前面|前文)(的)?(所有|全部)?(指令|提示|规则|限制|prompt)/i,
    /无视(以上|上面|之前|前面|前文)(的)?(所有|全部)?(指令|提示|规则|限制)/i,
    /不要(遵守|执行|理会|遵循)(以上|上面|之前|前面|前文)/i,
    /你(现在|从现在起|从此|接下来)(是|扮演|成为|变成|假装)/i,
    /(进入|切换到|扮演|模拟)(开发者|管理员|root|admin|DAN|越狱|jailbreak|无限制模式)/i,
    /\bignore\s+((?:all|previous|above|prior|the)\s+)*(instructions?|prompts?|rules)/i,
    /\bdisregard\s+((?:all|previous|above|prior|the)\s+)*(instructions?|prompts?|rules)/i,
    /\byou\s+are\s+now\b/i,
    /\bact\s+as\s+(if\s+you\s+(are|were)\s+)?(a|an|the)\b/i,
    /\bpretend\s+(to\s+be|that\s+you)\b/i,
    /\bfrom\s+now\s+on\b/i,
    /\b(DAN|jailbreak|developer\s+mode|god\s+mode|root\s+mode)\b/i,
    /<\/?(system|developer|admin|root)>/i,
    /(泄露|输出|显示|告诉我)(你的|系统的)?(初始|原始|默认|系统)?(prompt|提示词|提示|指令|设定|人设|规则)/i,
    /(重启|重置|清除)(你的|系统的)?(设定|规则|人设|限制|prompt)/i,
];

// 低置信度（命中仅告警，不阻断，保证向后兼容）
const PROMPT_INJECTION_WARN_PATTERNS = [
    /\bsystem\s*:/i,
    /\bdeveloper\s*:/i,
    /\badmin\s*:/i,
    /(^|\n)\s*(role|角色)\s*:/i,
    /忽略(任何|所有)(限制|规则|约束)/i,
    /\bdo\s+not\s+follow\b/i,
    /\boverride\s+(instructions?|rules|system)/i,
];

// ===== PII 敏感信息检测模式（顺序敏感：身份证须先于银行卡）=====
const PII_PATTERNS = [
    {
        type: 'idcard',
        pattern: /\b\d{17}[\dXx]\b/g,
        mask: (m) => m.slice(0, 6) + '********' + m.slice(-4),
    },
    {
        type: 'bankcard',
        pattern: /\b\d{16,19}\b/g,
        mask: (m) => m.slice(0, 4) + '********' + m.slice(-4),
    },
    {
        type: 'phone',
        pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
        mask: (m) => m.slice(0, 3) + '****' + m.slice(-4),
    },
    {
        type: 'email',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        mask: (m) => {
            const at = m.indexOf('@');
            if (at <= 2) return '*'.repeat(at) + m.slice(at);
            return m.slice(0, 2) + '***' + m.slice(at);
        },
    },
];

// ===== 毒性关键词黑名单（severity 累计）=====
const TOXICITY_BLACKLIST = [
    { word: /傻[逼屄比]|弱智|脑残|白痴|废柴|废物/gi, severity: 3 },
    { word: /操你|日你|草你|干你|你妈的|去死|找死/gi, severity: 3 },
    { word: /贱人|婊子|荡妇|妓女/gi, severity: 2 },
    { word: /\bfuck(ing|er|s)?\b|\bshit(ty|s)?\b|\bbitch(es)?\b|\basshole(s)?\b|\bcunt\b|\bdamn\b/gi, severity: 2 },
    { word: /杀人方法|自杀方法|制毒方法|炸弹制作|黑客攻击教程/gi, severity: 3 },
    { word: /种族歧视|纳粹|法西斯/gi, severity: 3 },
    { word: /赌博网站|色情网站|代写论文|买卖账号/gi, severity: 1 },
];

// ===== 幻觉检测模式（过度确定性表达）=====
const HALLUCINATION_PATTERNS = [
    { pattern: /绝对(是|会|不|正确|没错|真实|可靠)/gi, label: '绝对' },
    { pattern: /100%/g, label: '100%' },
    { pattern: /肯定会|必然会/gi, label: '肯定会' },
    { pattern: /不可能错|绝不会错/gi, label: '不可能错' },
    { pattern: /百分百/gi, label: '百分百' },
    { pattern: /毫无疑问|毋庸置疑/gi, label: '毫无疑问' },
    { pattern: /完全(正确|准确|没有错误|无误)/gi, label: '完全正确' },
    { pattern: /\bguaranteed\b/gi, label: 'guaranteed' },
    { pattern: /\b100%\s*(certain|sure|correct|right)\b/gi, label: '100% certain' },
    { pattern: /\bdefinitely\s+(correct|true|right|accurate)\b/gi, label: 'definitely' },
];

// ===== SQLite 初始化 =====
let auditDbInitialized = false;

/**
 * 初始化审计日志表（幂等，启动时异步执行一次）
 * @returns {Promise<void>}
 */
async function ensureAuditDBInit() {
    if (auditDbInitialized) return;
    try {
        await run(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                user_id TEXT,
                endpoint TEXT NOT NULL,
                method TEXT,
                tool TEXT,
                action TEXT,
                input_text TEXT,
                output_text TEXT,
                result TEXT NOT NULL,
                reason TEXT,
                warnings TEXT,
                ip TEXT,
                duration_ms INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_audit_endpoint ON audit_logs(endpoint)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_logs(result)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_logs(trace_id)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`);
        auditDbInitialized = true;
        console.log('[Guardrails] SQLite 审计日志表初始化完成');
    } catch (err) {
        console.error('[Guardrails] SQLite 审计表初始化失败:', err.message);
        auditDbInitialized = true; // 防止反复尝试
    }
}

// 启动时异步初始化（fire-and-forget）
ensureAuditDBInit();

// ===== 工具函数 =====

/**
 * 递归收集对象中的字符串值（用于提取请求输入文本）
 * @param {*} obj - 任意值
 * @param {string[]} [acc=[]] - 累加器
 * @param {number} [depth=0] - 当前递归深度
 * @returns {string[]} 字符串数组
 */
function collectStrings(obj, acc = [], depth = 0) {
    if (depth > 4 || acc.length > 50) return acc;
    if (obj == null) return acc;
    if (typeof obj === 'string') {
        if (obj.trim().length > 0) acc.push(obj);
    } else if (Array.isArray(obj)) {
        for (const item of obj) collectStrings(item, acc, depth + 1);
    } else if (typeof obj === 'object') {
        for (const v of Object.values(obj)) collectStrings(v, acc, depth + 1);
    }
    return acc;
}

/**
 * 从 Express 请求中提取待校验的输入文本（扫描 body 与 query）
 * @param {import('express').Request} req - Express 请求对象
 * @returns {string} 拼接后的输入文本
 */
function extractInputText(req) {
    const parts = [];
    if (req.body) parts.push(...collectStrings(req.body));
    if (req.query) parts.push(...collectStrings(req.query));
    return parts.join(' ').slice(0, CONFIG.maxInputLength + 200);
}

/**
 * 在响应体中定位主要 AI 文本字段（返回 get/set 引用）
 * @param {*} body - 响应体
 * @returns {{get: Function, set: Function}|null}
 */
function findOutputText(body) {
    if (!body || typeof body !== 'object') return null;
    const candidateKeys = [
        'content', 'message', 'feedback', 'answer', 'response',
        'reply', 'text', 'explanation', 'analysis', 'suggestion', 'result'
    ];
    // body.data.xxx
    if (body.data && typeof body.data === 'object') {
        for (const k of candidateKeys) {
            if (typeof body.data[k] === 'string' && body.data[k].trim()) {
                return { get: () => body.data[k], set: (v) => { body.data[k] = v; } };
            }
        }
    }
    // body.xxx
    for (const k of candidateKeys) {
        if (typeof body[k] === 'string' && body[k].trim()) {
            return { get: () => body[k], set: (v) => { body[k] = v; } };
        }
    }
    // body.data 为字符串
    if (typeof body.data === 'string' && body.data.trim()) {
        return { get: () => body.data, set: (v) => { body.data = v; } };
    }
    return null;
}

/**
 * PII 脱敏：检测并遮蔽手机号/身份证/邮箱/银行卡
 * @param {string} text - 原始文本
 * @returns {{masked: string, detected: Array<{type: string, count: number}>}}
 */
function maskPII(text) {
    if (!text || typeof text !== 'string') return { masked: '', detected: [] };
    let masked = text;
    const detected = [];
    for (const { type, pattern, mask } of PII_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        const matches = masked.match(re);
        if (matches && matches.length > 0) {
            detected.push({ type, count: matches.length });
            masked = masked.replace(re, mask);
        }
    }
    return { masked, detected };
}

/**
 * 截断文本用于审计日志存储
 * @param {string} text - 文本
 * @returns {string} 截断后的文本
 */
function truncateForLog(text) {
    if (!text) return '';
    return text.length > CONFIG.auditLogMaxLength
        ? text.slice(0, CONFIG.auditLogMaxLength) + '...[truncated]'
        : text;
}

// ===== 1. InputGuard 输入防护层 =====

/**
 * 输入防护：指令注入检测 + 长度/复杂度校验 + PII 检测脱敏
 *
 * @param {string} text - 用户输入文本
 * @param {Object} [options] - 覆盖默认配置
 * @returns {{passed: boolean, reason: string, sanitized: string, warnings: string[]}}
 */
function guardInput(text, options = {}) {
    const opts = { ...CONFIG, ...options };
    const warnings = [];

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        // 空输入放行，由路由层处理必填校验
        return { passed: true, reason: 'ok', sanitized: '', warnings };
    }

    // 长度校验
    if (text.length > opts.maxInputLength) {
        return {
            passed: false,
            reason: `输入超出最大长度限制(${opts.maxInputLength}字符，当前${text.length}字符)`,
            sanitized: '',
            warnings,
        };
    }

    // 指令注入检测（阻断级）
    if (opts.enablePromptInjection) {
        for (const pattern of PROMPT_INJECTION_BLOCK_PATTERNS) {
            if (pattern.test(text)) {
                return {
                    passed: false,
                    reason: `检测到指令注入模式: ${pattern.source}`,
                    sanitized: maskPII(text).masked,
                    warnings,
                };
            }
        }
        // 告警级（不阻断，保证向后兼容）
        for (const pattern of PROMPT_INJECTION_WARN_PATTERNS) {
            if (pattern.test(text)) {
                warnings.push(`疑似指令注入模式: ${pattern.source}`);
                break;
            }
        }
    }

    // PII 检测（始终脱敏用于日志；命中时告警）
    const piiResult = maskPII(text);
    if (opts.enablePIIDetection && piiResult.detected.length > 0) {
        warnings.push(
            `检测到敏感信息: ${piiResult.detected.map(d => `${d.type}(${d.count})`).join(', ')}（已脱敏）`
        );
    }

    return {
        passed: true,
        reason: 'ok',
        sanitized: piiResult.masked,
        warnings,
    };
}

// ===== 2. OutputGuard 输出过滤层 =====

/**
 * 格式规范检测：重复内容、编码异常、长度异常
 * @param {string} text - 输出文本
 * @returns {string[]} 告警列表
 */
function checkFormat(text) {
    const warnings = [];
    if (text.length > 10000) {
        warnings.push(`输出长度异常(${text.length}字符)`);
    }
    // 重复片段（同一4字符以上片段连续出现6次以上）；限定采样长度避免 ReDoS
    const sample = text.length > 4000 ? text.slice(0, 4000) : text;
    if (/(.{4,}?)\1{5,}/.test(sample)) {
        warnings.push('检测到重复内容');
    }
    // 编码异常字符
    if (/\ufffd/.test(text)) {
        warnings.push('检测到编码异常字符');
    }
    return warnings;
}

/**
 * 输出过滤：毒性检测 + 幻觉检测 + 格式规范检测
 *
 * @param {string} text - AI 输出文本
 * @param {Object} [options] - 覆盖默认配置
 * @returns {{passed: boolean, filtered: string, warnings: string[]}}
 */
function guardOutput(text, options = {}) {
    const opts = { ...CONFIG, ...options };
    const warnings = [];

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return { passed: true, filtered: text || '', warnings };
    }

    let filtered = text;

    // 毒性检测
    if (opts.enableToxicity) {
        let toxicityScore = 0;
        const hitWords = [];
        for (const { word, severity } of TOXICITY_BLACKLIST) {
            const re = new RegExp(word.source, word.flags);
            const matches = filtered.match(re);
            if (matches && matches.length > 0) {
                toxicityScore += severity * matches.length;
                hitWords.push(word.source);
                filtered = filtered.replace(re, '***');
            }
        }
        if (toxicityScore >= opts.maxToxicityScore) {
            return {
                passed: false,
                filtered: '抱歉，该响应内容因违反安全策略已被拦截。',
                warnings: [`毒性评分超阈值(${toxicityScore}>=${opts.maxToxicityScore})`],
            };
        }
        if (toxicityScore > 0) {
            warnings.push(`检测到毒性内容(评分${toxicityScore})，已过滤`);
        }
    }

    // 幻觉检测
    if (opts.enableHallucination) {
        let hallucinationScore = 0;
        const found = [];
        for (const { pattern, label } of HALLUCINATION_PATTERNS) {
            const re = new RegExp(pattern.source, pattern.flags);
            const matches = filtered.match(re);
            if (matches && matches.length > 0) {
                hallucinationScore += matches.length;
                found.push(label);
            }
        }
        if (hallucinationScore > 0) {
            warnings.push(
                `检测到过度确定性表达(评分${hallucinationScore}): ${[...new Set(found)].join(', ')}`
            );
        }
    }

    // 格式规范检测
    warnings.push(...checkFormat(filtered));

    return { passed: true, filtered, warnings };
}

// ===== 3. AuditLog 审计日志 =====

/**
 * 记录一条审计日志（fire-and-forget，不阻塞主流程）
 *
 * @param {Object} entry - 审计条目
 * @param {string} [entry.userId] - 用户 ID
 * @param {string} [entry.traceId] - 链路追踪 ID
 * @param {string} entry.endpoint - 请求端点
 * @param {string} [entry.method] - HTTP 方法
 * @param {string} [entry.tool] - 调用工具
 * @param {string} [entry.action] - 动作（input_check / output_check / 自定义）
 * @param {string} [entry.inputText] - 脱敏输入
 * @param {string} [entry.outputText] - 脱敏输出
 * @param {string} entry.result - 结果（success / fail）
 * @param {string} [entry.reason] - 原因
 * @param {string[]|string} [entry.warnings] - 告警
 * @param {string} [entry.ip] - 客户端 IP
 * @param {number} [entry.durationMs] - 耗时（毫秒）
 * @returns {void}
 */
function recordAudit(entry) {
    const warningsStr = Array.isArray(entry.warnings)
        ? entry.warnings.join('; ')
        : (entry.warnings || '');

    ensureAuditDBInit()
        .then(() => run(`
            INSERT INTO audit_logs (
                trace_id, user_id, endpoint, method, tool, action,
                input_text, output_text, result, reason, warnings, ip, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            entry.traceId || null,
            entry.userId || null,
            entry.endpoint || 'unknown',
            entry.method || null,
            entry.tool || null,
            entry.action || null,
            truncateForLog(entry.inputText),
            truncateForLog(entry.outputText),
            entry.result || 'success',
            entry.reason || null,
            warningsStr || null,
            entry.ip || null,
            entry.durationMs != null ? entry.durationMs : null,
        ]))
        .catch((err) => {
            console.error('[Guardrails] 审计日志写入失败:', err.message);
        });
}

/**
 * 查询审计日志（支持多维度筛选）
 *
 * @param {Object} [options={}] - 查询选项
 * @param {string} [options.userId] - 按用户筛选
 * @param {string} [options.endpoint] - 按端点筛选
 * @param {string} [options.result] - 按结果筛选（success/fail）
 * @param {string} [options.traceId] - 按链路 ID 筛选
 * @param {string} [options.startDate] - 开始时间（ISO）
 * @param {string} [options.endDate] - 结束时间（ISO）
 * @param {number} [options.limit=100] - 返回上限
 * @param {number} [options.offset=0] - 偏移量
 * @returns {Promise<Array>} 审计记录列表
 */
async function queryAuditLogs(options = {}) {
    await ensureAuditDBInit();
    const {
        userId = null,
        endpoint = null,
        result = null,
        traceId = null,
        startDate = null,
        endDate = null,
        limit = 100,
        offset = 0,
    } = options;

    const conditions = [];
    const params = [];
    if (userId) { conditions.push('user_id = ?'); params.push(userId); }
    if (endpoint) { conditions.push('endpoint = ?'); params.push(endpoint); }
    if (result) { conditions.push('result = ?'); params.push(result); }
    if (traceId) { conditions.push('trace_id = ?'); params.push(traceId); }
    if (startDate) { conditions.push('created_at >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('created_at <= ?'); params.push(endDate); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        return await all(
            `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
    } catch (err) {
        console.error('[Guardrails] 审计日志查询失败:', err.message);
        return [];
    }
}

/**
 * 按 ID 查询单条审计日志
 * @param {number} id - 审计日志 ID
 * @returns {Promise<Object|null>}
 */
async function getAuditLogById(id) {
    await ensureAuditDBInit();
    try {
        return await get(`SELECT * FROM audit_logs WHERE id = ?`, [id]);
    } catch (err) {
        console.error('[Guardrails] 审计日志查询失败:', err.message);
        return null;
    }
}

/**
 * 审计日志统计摘要
 * @param {Object} [options] - 时间范围筛选
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Promise<Object>}
 */
async function getAuditSummary(options = {}) {
    await ensureAuditDBInit();
    const { startDate = null, endDate = null } = options;
    const conditions = [];
    const params = [];
    if (startDate) { conditions.push('created_at >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('created_at <= ?'); params.push(endDate); }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const overview = await get(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) as fail_count
            FROM audit_logs ${whereClause}
        `, params);
        const byEndpoint = await all(`
            SELECT endpoint,
                   COUNT(*) as total,
                   SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) as fails
            FROM audit_logs ${whereClause}
            GROUP BY endpoint ORDER BY total DESC
        `, params);
        return {
            total: overview?.total || 0,
            successCount: overview?.success_count || 0,
            failCount: overview?.fail_count || 0,
            byEndpoint,
        };
    } catch (err) {
        console.error('[Guardrails] 审计统计失败:', err.message);
        return { total: 0, successCount: 0, failCount: 0, byEndpoint: [] };
    }
}

// ===== 4. Express 中间件 =====

/**
 * 输入防护中间件：路由前拦截，校验输入
 *
 * - 通过 req.guardInput 暴露 { passed, reason, sanitized, warnings }
 * - 命中阻断级规则时返回 400，并记录 fail 审计
 * - 不修改 req.body，保证向后兼容（脱敏文本仅用于日志）
 *
 * @param {Object} [options] - 覆盖默认配置
 * @returns {import('express').RequestHandler}
 */
function inputGuardMiddleware(options = {}) {
    return (req, res, next) => {
        const startTime = Date.now();
        try {
            const inputText = extractInputText(req);
            const result = guardInput(inputText, options);
            req.guardInput = result;
            req._guardStartTime = startTime;

            if (!result.passed) {
                console.log(`[Guardrails] 输入拦截: ${result.reason}`);
                recordAudit({
                    userId: req.userId || req.username || null,
                    endpoint: req.originalUrl || req.path,
                    method: req.method,
                    action: 'input_check',
                    inputText: result.sanitized || maskPII(inputText).masked,
                    outputText: '',
                    result: 'fail',
                    reason: result.reason,
                    warnings: result.warnings,
                    ip: req.ip,
                    durationMs: Date.now() - startTime,
                });
                return res.status(400).json({
                    success: false,
                    code: 'INPUT_GUARD_BLOCKED',
                    message: result.reason,
                });
            }

            if (result.warnings && result.warnings.length > 0) {
                console.log(`[Guardrails] 输入告警: ${result.warnings.join('; ')}`);
            }
            return next();
        } catch (err) {
            console.error('[Guardrails] inputGuardMiddleware 异常:', err.message);
            return next(); // fail-open，保证向后兼容
        }
    };
}

/**
 * 输出过滤中间件：响应前过滤输出
 *
 * - 包装 res.json，对 AI 文本字段执行毒性/幻觉/格式检测
 * - 命中毒性阈值时替换为安全响应并记录 fail 审计
 * - 过滤后回写文本，告警写入 X-Guard-Warnings 响应头
 * - 成功响应记录 success 审计（含脱敏输入/输出）
 *
 * @param {Object} [options] - 覆盖默认配置
 * @returns {import('express').RequestHandler}
 */
function outputGuardMiddleware(options = {}) {
    return (req, res, next) => {
        const startTime = req._guardStartTime || Date.now();
        const originalJson = res.json.bind(res);

        /**
         * @param {*} body - 响应体
         */
        res.json = function (body) {
            try {
                let outputText = null;
                let ref = null;

                if (typeof body === 'string' && body.trim()) {
                    outputText = body;
                } else {
                    ref = findOutputText(body);
                    outputText = ref ? ref.get() : null;
                }

                if (outputText) {
                    const result = guardOutput(outputText, options);
                    const userId = req.userId || req.username || null;
                    const endpoint = req.originalUrl || req.path;
                    const inputSanitized = req.guardInput ? req.guardInput.sanitized : '';

                    if (!result.passed) {
                        console.log(`[Guardrails] 输出拦截: ${result.warnings.join('; ')}`);
                        recordAudit({
                            userId,
                            endpoint,
                            method: req.method,
                            action: 'output_check',
                            inputText: inputSanitized,
                            outputText: maskPII(outputText).masked,
                            result: 'fail',
                            reason: result.warnings.join('; '),
                            warnings: result.warnings,
                            ip: req.ip,
                            durationMs: Date.now() - startTime,
                        });
                        return originalJson({
                            success: false,
                            code: 'OUTPUT_GUARD_BLOCKED',
                            message: '输出被安全策略拦截',
                        });
                    }

                    // 回写过滤后的文本
                    if (result.filtered !== outputText) {
                        if (ref) {
                            ref.set(result.filtered);
                        } else {
                            body = result.filtered;
                        }
                    }

                    if (result.warnings.length > 0) {
                        res.setHeader(
                            'X-Guard-Warnings',
                            encodeURIComponent(result.warnings.join('; ')).slice(0, 200)
                        );
                        console.log(`[Guardrails] 输出告警: ${result.warnings.join('; ')}`);
                    }

                    req.guardOutput = result;
                    recordAudit({
                        userId,
                        endpoint,
                        method: req.method,
                        action: 'output_check',
                        inputText: inputSanitized,
                        outputText: maskPII(result.filtered).masked,
                        result: 'success',
                        warnings: result.warnings,
                        ip: req.ip,
                        durationMs: Date.now() - startTime,
                    });
                } else if (options.auditAllResponses || CONFIG.auditAllResponses) {
                    // 无文本输出时按需记录轻量审计
                    if (req.guardInput) {
                        recordAudit({
                            userId: req.userId || req.username || null,
                            endpoint: req.originalUrl || req.path,
                            method: req.method,
                            action: 'response',
                            inputText: req.guardInput.sanitized,
                            outputText: '',
                            result: 'success',
                            ip: req.ip,
                            durationMs: Date.now() - startTime,
                        });
                    }
                }
            } catch (err) {
                console.error('[Guardrails] outputGuardMiddleware 异常:', err.message);
            }
            return originalJson(body);
        };

        return next();
    };
}

/**
 * 组合中间件：同时应用输入输出防护
 *
 * 用法：app.use('/api/ai', guardMiddleware())
 * 等价于 [inputGuardMiddleware(), outputGuardMiddleware()]
 *
 * @param {Object} [options] - 覆盖默认配置
 * @returns {Array<import('express').RequestHandler>}
 */
function guardMiddleware(options = {}) {
    return [inputGuardMiddleware(options), outputGuardMiddleware(options)];
}

module.exports = {
    // 中间件
    inputGuardMiddleware,
    outputGuardMiddleware,
    guardMiddleware,
    // 核心防护函数
    guardInput,
    guardOutput,
    maskPII,
    // 审计日志
    recordAudit,
    queryAuditLogs,
    getAuditLogById,
    getAuditSummary,
    ensureAuditDBInit,
    // 配置
    CONFIG,
};
