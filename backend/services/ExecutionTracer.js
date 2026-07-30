/**
 * ExecutionTracer - Agent 执行轨迹完整记录（O 层：可观测性）
 *
 * 职责：
 *   完整记录 Agent 执行过程中的每一个 think / act / tool_call / state_change /
 *   error / plan 阶段，形成可回放、可排查、可统计的执行轨迹。
 *
 * 设计目标：
 *   1. 内存优先：轨迹先写入内存数组，提供同步、零延迟的 getTrace() / getTraceSummary()
 *   2. 异步落盘：每条轨迹 fire-and-forget 写入 SQLite，不阻塞 Agent 主流程
 *   3. 数据脱敏：工具入参中的敏感字段（password/token/apiKey 等）脱敏为 '***'，
 *      工具结果截断到 2000 字符，LLM 输入只存 role + content 前 200 字符
 *   4. 异常隔离：任何记录失败只 console.error，绝不 throw，保证不影响 Agent 执行
 *   5. 集成友好：提供 wrapThink / wrapAct 包装方法，调用方可按需接入
 *
 * 与现有模块的关系：
 *   - 复用 ../database/db 的 { run, get, all }（与 ai-observability、SessionStore 一致）
 *   - traceId 来源于 BaseAgent.run() 中的 crypto.randomUUID()，本类只做关联记录
 *   - 与 ai-observability（L 层 AI 调用指标）互补：本类聚焦 Agent 执行步骤轨迹
 *
 * 继承链参考：
 *   BaseAgent(traceId/sessionId/userId/currentStep/state/results)
 *     → ReActAgent(think/act)
 *       → ToolCallAgent(think 返回 boolean, act 返回 string, pendingToolCalls)
 *         → StudyAgent / PlanExecuteAgent
 *
 * 使用示例：
 *   const { ExecutionTracer } = require('../services/ExecutionTracer');
 *   const tracer = new ExecutionTracer({
 *       traceId: agent.traceId,
 *       agentName: agent.name,
 *       sessionId: agent.sessionId,
 *       userId: agent.userId
 *   });
 *   // 方式一：手动记录
 *   tracer.recordThink(agent.currentStep, { input: messages, toolCalls, decision, durationMs });
 *   // 方式二：自动包装（推荐）
 *   agent.think = tracer.wrapThink(agent.think);
 *   agent.act = tracer.wrapAct(agent.act);
 */

const crypto = require('crypto');
const { run, get, all } = require('../database/db');

// ===== 常量配置 =====

// 合法的轨迹阶段枚举
const VALID_PHASES = new Set([
    'think',          // 思考阶段：LLM 决策要调用哪些工具
    'act',            // 行动阶段：act() 整体执行（汇总）
    'tool_call',      // 单个工具调用（含入参与结果）
    'tool_result',    // 单个工具结果（细粒度，供手动记录使用）
    'state_change',   // 状态机变化（IDLE → RUNNING → FINISHED/ERROR）
    'error',          // 错误记录
    'plan',           // 规划阶段（PlanExecuteAgent 生成初始计划）
    'plan_revision'   // 计划修订（PlanExecuteAgent 修订计划）
]);

// 需要脱敏的敏感字段关键词（大小写不敏感，子串匹配）
// 子串匹配可覆盖 userPassword / apiKey / accessToken 等驼峰/下划线变体；
// 当前项目工具入参均为学习数据（userId/keyword 等），不会误伤。
const SENSITIVE_KEY_PATTERNS = [
    'password',
    'token',
    'apikey',
    'api_key',
    'secret',
    'authorization',
    'accesskey',
    'access_key'
];

// 数据截断阈值
const MAX_RESULT_CHARS = 2000;   // 工具结果最大字符数
const MAX_INPUT_CHARS = 200;     // LLM 输入消息 content 最大字符数
const MAX_PLAN_RESULT_CHARS = 1000; // 计划中单个子任务结果最大字符数
const MAX_MASK_DEPTH = 20;       // 脱敏递归最大深度（防止深层嵌套/栈溢出）

// ===== SQLite 表初始化（懒加载，与 ai-observability / SessionStore 风格一致）=====

let dbInitialized = false;
let dbInitPromise = null;

/**
 * 确保 agent_traces 表已创建
 * - 幂等：已初始化则直接返回
 * - 首次调用时创建表 + 索引，失败也置为已初始化（防止反复尝试拖慢主流程）
 * @returns {Promise<void>}
 */
function ensureDBInit() {
    if (dbInitialized) return Promise.resolve();
    if (!dbInitPromise) {
        dbInitPromise = (async () => {
            try {
                await run(`
                    CREATE TABLE IF NOT EXISTS agent_traces (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        trace_id TEXT NOT NULL,
                        user_id INTEGER,
                        session_id TEXT,
                        agent_name TEXT,
                        step INTEGER,
                        phase TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        duration_ms INTEGER,
                        data TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                // 按 trace_id 查询整条链路
                await run(`CREATE INDEX IF NOT EXISTS idx_agent_traces_trace ON agent_traces(trace_id)`);
                // 按用户查询历史轨迹
                await run(`CREATE INDEX IF NOT EXISTS idx_agent_traces_user ON agent_traces(user_id)`);
                dbInitialized = true;
                console.log('[ExecutionTracer] SQLite 轨迹表初始化完成');
            } catch (err) {
                console.error('[ExecutionTracer] SQLite 初始化失败，降级到纯内存模式:', err.message);
                dbInitialized = true; // 防止反复尝试
            }
        })();
    }
    return dbInitPromise;
}

/**
 * TraceEntry - 单条轨迹记录
 * 轻量数据载体，负责字段标准化与序列化
 */
class TraceEntry {
    /**
     * @param {Object} options
     * @param {string} options.traceId - 关联 BaseAgent 的 traceId
     * @param {number} options.step - 步骤编号
     * @param {string} options.phase - 阶段（见 VALID_PHASES）
     * @param {string} [options.timestamp] - ISO 时间戳（默认当前时间）
     * @param {*} options.data - 详细数据对象
     * @param {number} [options.durationMs] - 耗时（毫秒）
     */
    constructor({ traceId, step, phase, timestamp, data, durationMs }) {
        this.traceId = traceId || null;
        this.step = typeof step === 'number' ? step : 0;
        this.phase = VALID_PHASES.has(phase) ? phase : 'act';
        this.timestamp = timestamp || new Date().toISOString();
        // data 统一存为对象（便于后续 JSON.stringify 与查询解析）
        this.data = data === undefined ? null : data;
        this.durationMs = typeof durationMs === 'number' ? durationMs : null;
    }

    /**
     * 序列化为纯对象（用于输出 / JSON 化）
     * @returns {Object}
     */
    toJSON() {
        return {
            traceId: this.traceId,
            step: this.step,
            phase: this.phase,
            timestamp: this.timestamp,
            durationMs: this.durationMs,
            data: this.data
        };
    }
}

/**
 * ExecutionTracer - 执行轨迹记录器
 */
class ExecutionTracer {
    /**
     * @param {Object} options
     * @param {string} [options.traceId] - 关联 BaseAgent 的 traceId（未提供则自动生成）
     * @param {string} [options.agentName] - Agent 名称
     * @param {string} [options.sessionId] - 会话 ID
     * @param {string|number} [options.userId] - 用户 ID
     */
    constructor({ traceId, agentName, sessionId, userId } = {}) {
        this.traceId = traceId || crypto.randomUUID();
        this.agentName = agentName || 'unknown';
        this.sessionId = sessionId || null;
        this.userId = userId !== undefined ? userId : null;

        // 内存中的轨迹记录数组（按写入顺序）
        this.entries = [];
    }

    // ===== 核心写入 =====

    /**
     * 内部：写入一条轨迹（内存 + 异步落盘）
     * 所有 record* 方法最终都汇聚到这里，统一处理异常隔离与持久化。
     *
     * @param {number} step - 步骤编号
     * @param {string} phase - 阶段
     * @param {*} data - 详细数据
     * @param {number} [durationMs] - 耗时
     * @returns {TraceEntry|null} 写入的轨迹条目（失败返回 null）
     * @private
     */
    _recordEntry(step, phase, data, durationMs) {
        try {
            const entry = new TraceEntry({
                traceId: this.traceId,
                step,
                phase,
                timestamp: new Date().toISOString(),
                data,
                durationMs: typeof durationMs === 'number' ? durationMs : null
            });
            // 1. 写入内存（同步，立即可查）
            this.entries.push(entry);
            // 2. 异步落盘（fire-and-forget，不阻塞、不抛错）
            this._persist(entry);
            return entry;
        } catch (err) {
            // 任何记录失败都不阻断主流程
            console.error('[ExecutionTracer] 写入轨迹失败:', err.message);
            return null;
        }
    }

    /**
     * 异步持久化单条轨迹到 SQLite（fire-and-forget）
     * - 不返回 Promise 给调用方，调用方无需 await
     * - 内部捕获所有异常，仅 console.error
     * @param {TraceEntry} entry
     * @private
     */
    _persist(entry) {
        // data 序列化为 JSON 字符串存储；序列化失败则存原始字符串
        let dataStr;
        try {
            dataStr = JSON.stringify(entry.data);
        } catch (e) {
            dataStr = String(entry.data);
        }

        ensureDBInit()
            .then(() => run(`
                INSERT INTO agent_traces (
                    trace_id, user_id, session_id, agent_name,
                    step, phase, timestamp, duration_ms, data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                entry.traceId,
                this.userId,
                this.sessionId,
                this.agentName,
                entry.step,
                entry.phase,
                entry.timestamp,
                entry.durationMs,
                dataStr
            ]))
            .catch(err => {
                // SQLite 写入失败不影响主流程，仅记录日志
                console.error('[ExecutionTracer] SQLite 写入失败:', err.message);
            });
    }

    /**
     * 安全记录包装器：执行 fn()，捕获所有异常只 console.error，绝不 throw
     * @param {Function} fn
     * @private
     */
    _safeRecord(fn) {
        try {
            fn();
        } catch (err) {
            console.error('[ExecutionTracer] 轨迹记录异常:', err.message);
        }
    }

    // ===== 业务记录方法 =====

    /**
     * 记录 think 阶段
     * @param {number} step - 步骤编号
     * @param {Object} payload
     * @param {Array} [payload.input] - 发送给 LLM 的消息数组，仅存 role + content 前 200 字符
     * @param {Array} [payload.toolCalls] - AI 决策要调用的工具列表 [{ name, arguments }]
     * @param {boolean} [payload.decision] - think 返回值（true=需要执行工具, false=已有答案）
     * @param {number} [payload.durationMs] - think 耗时
     * @returns {TraceEntry|null}
     */
    recordThink(step, { input, toolCalls, decision, durationMs } = {}) {
        return this._safeRecord(() => {
            // 脱敏 LLM 输入：只保留 role + content 前 200 字符
            const sanitizedInput = this._sanitizeMessages(input);

            // 脱敏工具调用入参：解析 arguments 字符串并屏蔽敏感字段
            const sanitizedToolCalls = (Array.isArray(toolCalls) ? toolCalls : []).map(tc => {
                let parsedArgs = tc && tc.arguments;
                if (typeof parsedArgs === 'string') {
                    try {
                        parsedArgs = JSON.parse(parsedArgs);
                    } catch (e) {
                        // 解析失败保留原始字符串（仍会经脱敏处理）
                    }
                }
                return {
                    name: (tc && (tc.name || 'unknown')) || 'unknown',
                    arguments: this._maskSensitive(parsedArgs)
                };
            });

            return this._recordEntry(step, 'think', {
                input: sanitizedInput,
                toolCalls: sanitizedToolCalls,
                decision: decision
            }, durationMs);
        }) || null;
    }

    /**
     * 记录单个工具执行（act 阶段中的每一次工具调用）
     * @param {number} step - 步骤编号
     * @param {Object} payload
     * @param {string} [payload.toolName] - 工具名称
     * @param {*} [payload.args] - 工具入参（脱敏后存储）
     * @param {*} [payload.result] - 工具执行结果（截断到 2000 字符）
     * @param {boolean} [payload.success=true] - 是否成功
     * @param {number} [payload.durationMs] - 执行耗时
     * @param {string|Error} [payload.error] - 错误信息（失败时）
     * @returns {TraceEntry|null}
     */
    recordAct(step, { toolName, args, result, success = true, durationMs, error } = {}) {
        return this._safeRecord(() => {
            // 脱敏工具入参
            const maskedArgs = this._maskSensitive(args);
            // 截断工具结果，防止超大结果撑爆存储
            const truncatedResult = this._truncate(this._anyToString(result), MAX_RESULT_CHARS);

            const data = {
                toolName: toolName || 'unknown',
                args: maskedArgs,
                result: truncatedResult,
                success: success !== false
            };

            if (error) {
                data.error = this._truncate(this._anyToString(error), MAX_RESULT_CHARS);
            }

            return this._recordEntry(step, 'tool_call', data, durationMs);
        }) || null;
    }

    /**
     * 记录状态机变化
     * @param {number} step - 步骤编号
     * @param {Object} payload
     * @param {string} payload.from - 变化前状态
     * @param {string} payload.to - 变化后状态
     * @param {string} [payload.reason] - 变化原因
     * @returns {TraceEntry|null}
     */
    recordStateChange(step, { from, to, reason } = {}) {
        return this._safeRecord(() => {
            return this._recordEntry(step, 'state_change', {
                from: from || null,
                to: to || null,
                reason: reason || null
            });
        }) || null;
    }

    /**
     * 记录错误
     * @param {number} step - 步骤编号
     * @param {Object} payload
     * @param {string} [payload.phase] - 错误发生的阶段（think/act/tool_call/plan...）
     * @param {string|Error} [payload.error] - 错误信息
     * @param {string} [payload.stack] - 错误堆栈
     * @param {number} [payload.durationMs] - 发生错误前的耗时
     * @returns {TraceEntry|null}
     */
    recordError(step, { phase, error, stack, durationMs } = {}) {
        return this._safeRecord(() => {
            const errObj = error instanceof Error
                ? { message: error.message, stack: error.stack }
                : { message: this._anyToString(error) };

            return this._recordEntry(step, 'error', {
                phase: phase || 'unknown',
                error: errObj.message,
                stack: stack || errObj.stack || null
            }, durationMs);
        }) || null;
    }

    /**
     * 记录规划阶段（PlanExecuteAgent 用）
     * @param {number} step - 步骤编号
     * @param {Object} payload
     * @param {number} [payload.planVersion] - 计划版本（修订次数）
     * @param {Array} [payload.subtasks] - 子任务列表
     * @param {boolean} [payload.isRevision=false] - 是否为修订
     * @returns {TraceEntry|null}
     */
    recordPlan(step, { planVersion, subtasks, isRevision = false } = {}) {
        return this._safeRecord(() => {
            // 子任务结果可能很长，逐个截断防止存储膨胀
            const sanitizedSubtasks = (Array.isArray(subtasks) ? subtasks : []).map(s => {
                if (s && typeof s === 'object') {
                    const copy = { ...s };
                    if (typeof copy.result === 'string') {
                        copy.result = this._truncate(copy.result, MAX_PLAN_RESULT_CHARS);
                    } else if (copy.result != null) {
                        copy.result = this._truncate(this._anyToString(copy.result), MAX_PLAN_RESULT_CHARS);
                    }
                    if (typeof copy.description === 'string') {
                        copy.description = this._truncate(copy.description, MAX_INPUT_CHARS);
                    }
                    return copy;
                }
                return s;
            });

            const phase = isRevision ? 'plan_revision' : 'plan';
            return this._recordEntry(step, phase, {
                planVersion: typeof planVersion === 'number' ? planVersion : 0,
                subtasks: sanitizedSubtasks,
                isRevision: isRevision === true
            });
        }) || null;
    }

    /**
     * 通用记录方法（供手动记录 tool_result 等细粒度阶段使用）
     * @param {string} phase - 阶段（见 VALID_PHASES）
     * @param {number} step - 步骤编号
     * @param {*} data - 详细数据
     * @param {number} [durationMs] - 耗时
     * @returns {TraceEntry|null}
     */
    record(phase, step, data, durationMs) {
        return this._safeRecord(() => {
            return this._recordEntry(step, phase, data, durationMs);
        }) || null;
    }

    // ===== 查询方法 =====

    /**
     * 获取完整轨迹（内存，按写入顺序）
     * 返回拷贝，避免外部修改内部状态
     * @returns {Array<TraceEntry>}
     */
    getTrace() {
        return this.entries.map(e => e.toJSON());
    }

    /**
     * 获取轨迹摘要
     * @returns {Object} 摘要信息
     */
    getTraceSummary() {
        const phaseCounts = {};
        let toolCallCount = 0;
        let errorCount = 0;
        let totalDurationMs = 0;
        const steps = new Set();

        for (const e of this.entries) {
            phaseCounts[e.phase] = (phaseCounts[e.phase] || 0) + 1;
            if (e.phase === 'tool_call') toolCallCount++;
            if (e.phase === 'error') errorCount++;
            if (typeof e.durationMs === 'number') totalDurationMs += e.durationMs;
            if (typeof e.step === 'number') steps.add(e.step);
        }

        return {
            traceId: this.traceId,
            agentName: this.agentName,
            sessionId: this.sessionId,
            userId: this.userId,
            totalEntries: this.entries.length,
            totalSteps: steps.size,
            toolCallCount,
            errorCount,
            totalDurationMs,
            phaseCounts,
            startTime: this.entries.length > 0 ? this.entries[0].timestamp : null,
            endTime: this.entries.length > 0 ? this.entries[this.entries.length - 1].timestamp : null
        };
    }

    // ===== 集成辅助方法 =====

    /**
     * 包装 think 方法，自动记录轨迹
     *
     * 返回一个新的 async 函数，调用方式与原 think 一致。
     * 新函数通过 this 绑定到 Agent 实例，读取 currentStep / pendingToolCalls /
     * messageList 等属性，并在原 think 执行后自动写入 think 轨迹。
     *
     * 用法：
     *   agent.think = tracer.wrapThink(agent.think);
     *
     * @param {Function} originalThinkFn - 原 think 方法（未绑定也可，内部用 apply 绑定）
     * @returns {Function} 包装后的 think 函数
     */
    wrapThink(originalThinkFn) {
        const tracer = this;

        // 使用普通 function（非箭头函数），保证被赋值给 agent.think 后 this === agent
        return async function (...args) {
            const agent = this;
            const step = agent.currentStep || 0;
            const startTime = Date.now();

            try {
                // 执行原始 think
                const decision = await originalThinkFn.apply(agent, args);
                const durationMs = Date.now() - startTime;

                tracer._safeRecord(() => {
                    // 重建发送给 LLM 的消息（与 ToolCallAgent.think 构建逻辑保持一致）
                    const input = [];
                    if (agent.systemPrompt) {
                        input.push({ role: 'system', content: agent.systemPrompt });
                    }
                    if (Array.isArray(agent.messageList)) {
                        agent.messageList.forEach(msg => {
                            if (msg && msg.role !== 'system') input.push(msg);
                        });
                    }
                    if (agent.nextStepPrompt) {
                        input.push({ role: 'user', content: agent.nextStepPrompt });
                    }

                    // think 执行后 pendingToolCalls 已被填充
                    const toolCalls = (agent.pendingToolCalls || []).map(tc => ({
                        name: (tc && tc.function && tc.function.name) || (tc && tc.name) || 'unknown',
                        arguments: (tc && tc.function && tc.function.arguments) || (tc && tc.arguments) || '{}'
                    }));

                    tracer.recordThink(step, {
                        input,
                        toolCalls,
                        decision,
                        durationMs
                    });
                });

                return decision;
            } catch (err) {
                const durationMs = Date.now() - startTime;
                tracer._safeRecord(() => {
                    tracer.recordError(step, {
                        phase: 'think',
                        error: err,
                        durationMs
                    });
                });
                throw err; // 错误继续向上抛，仅做轨迹记录
            }
        };
    }

    /**
     * 包装 act 方法，自动记录轨迹
     *
     * act() 内部会循环执行多个工具并返回汇总字符串。
     * 包装器在 act 执行前后记录一条 'act' 阶段的汇总轨迹
     * （含工具数量、工具名列表、汇总结果、耗时）。
     *
     * 如需记录每个工具的独立入参与结果，请在工具执行循环中直接调用 recordAct()，
     * 或使用 record('tool_result', ...) 记录细粒度结果。
     *
     * 用法：
     *   agent.act = tracer.wrapAct(agent.act);
     *
     * @param {Function} originalActFn - 原 act 方法
     * @returns {Function} 包装后的 act 函数
     */
    wrapAct(originalActFn) {
        const tracer = this;

        return async function (...args) {
            const agent = this;
            const step = agent.currentStep || 0;
            const startTime = Date.now();

            // act 会消费 pendingToolCalls，执行前先快照工具名列表
            const pendingBefore = (agent.pendingToolCalls || []).slice();

            try {
                const result = await originalActFn.apply(agent, args);
                const durationMs = Date.now() - startTime;

                tracer._safeRecord(() => {
                    const toolNames = pendingBefore.map(tc =>
                        (tc && tc.function && tc.function.name) || (tc && tc.name) || 'unknown'
                    );

                    // 记录 act 阶段汇总（单个条目）
                    tracer._recordEntry(step, 'act', {
                        toolCount: pendingBefore.length,
                        toolNames,
                        result: tracer._truncate(tracer._anyToString(result), MAX_RESULT_CHARS),
                        success: true
                    }, durationMs);
                });

                return result;
            } catch (err) {
                const durationMs = Date.now() - startTime;
                tracer._safeRecord(() => {
                    tracer.recordError(step, {
                        phase: 'act',
                        error: err,
                        durationMs
                    });
                });
                throw err;
            }
        };
    }

    // ===== 数据脱敏与工具方法 =====

    /**
     * 判断字段名是否为敏感字段（大小写不敏感，子串匹配）
     * @param {string} key
     * @returns {boolean}
     * @private
     */
    _isSensitiveKey(key) {
        const k = String(key == null ? '' : key).toLowerCase();
        if (!k) return false;
        return SENSITIVE_KEY_PATTERNS.some(pattern => k.includes(pattern));
    }

    /**
     * 深度脱敏对象中的敏感字段（递归）
     * - 敏感字段的值统一替换为 '***'
     * - 处理循环引用与深层嵌套
     * @param {*} value
     * @param {WeakSet} [seen] - 已访问对象集合（防循环引用）
     * @param {number} [depth=0] - 当前递归深度
     * @returns {*} 脱敏后的新对象（不修改原对象）
     * @private
     */
    _maskSensitive(value, seen = new WeakSet(), depth = 0) {
        // 基本类型直接返回
        if (value === null || typeof value !== 'object') {
            return value;
        }
        // 深度兜底
        if (depth > MAX_MASK_DEPTH) {
            return '[MAX_DEPTH]';
        }
        // 循环引用兜底
        if (seen.has(value)) {
            return '[CIRCULAR]';
        }

        if (Array.isArray(value)) {
            seen.add(value);
            return value.map(item => this._maskSensitive(item, seen, depth + 1));
        }

        seen.add(value);
        const masked = {};
        for (const key of Object.keys(value)) {
            if (this._isSensitiveKey(key)) {
                masked[key] = '***';
            } else {
                masked[key] = this._maskSensitive(value[key], seen, depth + 1);
            }
        }
        return masked;
    }

    /**
     * 脱敏 LLM 输入消息：只保留 role + content 前 200 字符
     * @param {*} messages - 消息数组（或单条消息/字符串）
     * @returns {Array<Object>} 脱敏后的消息数组
     * @private
     */
    _sanitizeMessages(messages) {
        if (messages == null) return [];

        // 允许直接传字符串
        if (typeof messages === 'string') {
            return [{ role: 'unknown', content: this._truncate(messages, MAX_INPUT_CHARS) }];
        }
        if (!Array.isArray(messages)) return [];

        return messages
            .map(m => {
                if (m == null) return null;
                if (typeof m === 'string') {
                    return { role: 'unknown', content: this._truncate(m, MAX_INPUT_CHARS) };
                }
                return {
                    role: m.role || 'unknown',
                    content: this._truncate(this._contentToString(m.content), MAX_INPUT_CHARS)
                };
            })
            .filter(Boolean);
    }

    /**
     * 将消息 content 统一转为字符串
     * 兼容 string / 多模态数组 / 其他对象
     * @param {*} content
     * @returns {string}
     * @private
     */
    _contentToString(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            // 多模态消息：提取文本片段拼接
            return content
                .map(p => (typeof p === 'string' ? p : (p && p.text ? p.text : '')))
                .join(' ');
        }
        return this._anyToString(content);
    }

    /**
     * 任意值转字符串
     * @param {*} value
     * @returns {string}
     * @private
     */
    _anyToString(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch (e) {
            return String(value);
        }
    }

    /**
     * 截断字符串到指定长度（严格不超过 max）
     * 超出时保留前 max-3 个字符并追加 '...' 作为截断提示，
     * 保证返回字符串长度 <= max（满足「前 N 字符」「截断到 N 字符」的硬约束）。
     * @param {string} str
     * @param {number} max
     * @returns {string}
     * @private
     */
    _truncate(str, max) {
        const s = String(str == null ? '' : str);
        if (s.length <= max) return s;
        // max <= 3 时无法容纳省略号，直接切片
        if (max <= 3) return s.slice(0, max);
        return s.slice(0, max - 3) + '...';
    }

    // ===== 静态查询方法（从 SQLite 读取历史轨迹）=====

    /**
     * 将数据库行转换为 TraceEntry
     * @param {Object} row
     * @returns {TraceEntry}
     * @private
     */
    static _rowToEntry(row) {
        let data = null;
        if (row && row.data != null) {
            try {
                data = JSON.parse(row.data);
            } catch (e) {
                data = { raw: row.data };
            }
        }
        return new TraceEntry({
            traceId: row.trace_id,
            step: row.step,
            phase: row.phase,
            timestamp: row.timestamp,
            data,
            durationMs: row.duration_ms
        });
    }

    /**
     * 按 traceId 查询完整执行轨迹（从 SQLite）
     * @param {string} traceId - 轨迹 ID
     * @returns {Promise<Array<TraceEntry>>} 该 traceId 下的所有轨迹条目（按时间正序）
     */
    static async getTraceByTraceId(traceId) {
        try {
            await ensureDBInit();
            const rows = await all(
                `SELECT trace_id, step, phase, timestamp, duration_ms, data
                 FROM agent_traces
                 WHERE trace_id = ?
                 ORDER BY id ASC`,
                [traceId]
            );
            return rows.map(r => ExecutionTracer._rowToEntry(r));
        } catch (err) {
            console.error('[ExecutionTracer] 按 traceId 查询失败:', err.message);
            return [];
        }
    }

    /**
     * 按 userId 查询历史轨迹（从 SQLite）
     * @param {string|number} userId - 用户 ID
     * @param {number} [limit=50] - 返回条数上限
     * @returns {Promise<Array<TraceEntry>>} 该用户的轨迹条目（按时间倒序）
     */
    static async getTracesByUserId(userId, limit = 50) {
        try {
            await ensureDBInit();
            const rows = await all(
                `SELECT trace_id, step, phase, timestamp, duration_ms, data
                 FROM agent_traces
                 WHERE user_id = ?
                 ORDER BY id DESC
                 LIMIT ?`,
                [userId, limit]
            );
            return rows.map(r => ExecutionTracer._rowToEntry(r));
        } catch (err) {
            console.error('[ExecutionTracer] 按 userId 查询失败:', err.message);
            return [];
        }
    }
}

module.exports = { ExecutionTracer, TraceEntry };
