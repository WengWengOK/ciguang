/**
 * AI 可观测性中间件
 * 记录所有 AI 调用的 token 用量、耗时、模型、成功率等指标
 * 提供 /api/ai/metrics 端点查看统计数据
 *
 * 生产级增强（解决 yu-ai-agent 缺乏监控的短板）：
 * 1. SQLite 持久化：指标存储在 SQLite，重启不丢失，支持历史查询
 * 2. Trace ID 链路追踪：每次 AI 调用关联 trace_id，串联请求全链路
 * 3. 内存缓存 + 异步落盘：保持同步接口的响应速度，异步写入不阻塞主流程
 * 4. 多维度聚合查询：按端点/模型/日期/Trace ID 查询，支持时间范围筛选
 */

const crypto = require('crypto');
const { run, get, all } = require('../database/db');

// ===== 内存缓存（保持同步接口的快速响应）=====
if (!global.aiMetrics) {
    global.aiMetrics = {
        calls: [],           // 最近的调用记录（环形缓冲）
        totalCalls: 0,       // 总调用次数
        totalTokens: 0,      // 总 token 用量
        totalErrors: 0,      // 总错误次数
        byModel: {},         // 按模型统计
        byEndpoint: {},      // 按端点统计
        byDate: {},          // 按日期统计
        maxRecords: 1000     // 最多保留记录数
    };
}

// ===== SQLite 初始化 =====
let dbInitialized = false;

async function ensureDBInit() {
    if (dbInitialized) return;
    try {
        await run(`
            CREATE TABLE IF NOT EXISTS ai_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL,
                success BOOLEAN NOT NULL,
                fallback BOOLEAN NOT NULL DEFAULT 0,
                user_id INTEGER,
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_metrics_trace ON ai_metrics(trace_id)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_metrics_endpoint ON ai_metrics(endpoint)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_metrics_created ON ai_metrics(created_at)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_metrics_model ON ai_metrics(model)`);
        dbInitialized = true;
        console.log('[ai-observability] SQLite 指标表初始化完成');
    } catch (err) {
        console.error('[ai-observability] SQLite 初始化失败，降级到纯内存模式:', err.message);
        dbInitialized = true; // 防止反复尝试
    }
}

// 启动时异步初始化
ensureDBInit();

/**
 * 生成 Trace ID
 * 用于串联一次请求中的所有 AI 调用
 * @returns {string} UUID v4 格式的 trace ID
 */
function generateTraceId() {
    return crypto.randomUUID();
}

/**
 * 异步写入 SQLite（fire-and-forget，不阻塞主流程）
 */
function persistToSQLite(record) {
    ensureDBInit().then(() => {
        return run(`
            INSERT INTO ai_metrics (
                trace_id, endpoint, model, input_tokens, output_tokens,
                duration_ms, success, fallback, user_id, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            record.trace_id,
            record.endpoint,
            record.model,
            record.input_tokens || 0,
            record.output_tokens || 0,
            record.duration_ms || 0,
            record.success ? 1 : 0,
            record.fallback ? 1 : 0,
            record.user_id || null,
            record.error || null
        ]);
    }).catch(err => {
        // SQLite 写入失败不影响主流程，仅记录日志
        console.error('[ai-observability] SQLite 写入失败:', err.message);
    });
}

/**
 * 记录一次 AI 调用（同步接口，保持向后兼容）
 *
 * 写入内存缓存（同步）+ 异步写入 SQLite（fire-and-forget）
 *
 * @param {Object} params - 调用参数
 * @param {string} params.endpoint - 调用端点（如 '/api/agent/chat'）
 * @param {string} params.model - 使用的模型（如 'deepseek-chat'）
 * @param {number} params.inputTokens - 输入 token 数
 * @param {number} params.outputTokens - 输出 token 数
 * @param {number} params.durationMs - 调用耗时（毫秒）
 * @param {boolean} params.success - 是否成功
 * @param {boolean} params.fallback - 是否走了降级
 * @param {string} params.userId - 用户 ID
 * @param {string} params.error - 错误信息（失败时）
 * @param {string} [params.traceId] - Trace ID（未提供则自动生成）
 * @returns {string} trace ID
 */
function recordAICall(params) {
    const traceId = params.traceId || generateTraceId();

    const record = {
        trace_id: traceId,
        endpoint: params.endpoint || 'unknown',
        model: params.model || 'unknown',
        input_tokens: params.inputTokens || 0,
        output_tokens: params.outputTokens || 0,
        totalTokens: (params.inputTokens || 0) + (params.outputTokens || 0),
        duration_ms: params.durationMs || 0,
        success: params.success !== false,
        fallback: params.fallback || false,
        user_id: params.userId || null,
        error: params.error || null,
        timestamp: new Date().toISOString()
    };

    // 1. 写入内存缓存（同步）
    global.aiMetrics.calls.push(record);
    if (global.aiMetrics.calls.length > global.aiMetrics.maxRecords) {
        global.aiMetrics.calls.shift();
    }

    // 更新汇总统计
    global.aiMetrics.totalCalls++;
    global.aiMetrics.totalTokens += record.totalTokens;
    if (!record.success) global.aiMetrics.totalErrors++;

    // 按模型统计
    if (!global.aiMetrics.byModel[record.model]) {
        global.aiMetrics.byModel[record.model] = {
            calls: 0, tokens: 0, errors: 0, totalDurationMs: 0
        };
    }
    global.aiMetrics.byModel[record.model].calls++;
    global.aiMetrics.byModel[record.model].tokens += record.totalTokens;
    global.aiMetrics.byModel[record.model].totalDurationMs += record.duration_ms;
    if (!record.success) global.aiMetrics.byModel[record.model].errors++;

    // 按端点统计
    if (!global.aiMetrics.byEndpoint[record.endpoint]) {
        global.aiMetrics.byEndpoint[record.endpoint] = {
            calls: 0, tokens: 0, errors: 0, totalDurationMs: 0, fallbacks: 0
        };
    }
    global.aiMetrics.byEndpoint[record.endpoint].calls++;
    global.aiMetrics.byEndpoint[record.endpoint].tokens += record.totalTokens;
    global.aiMetrics.byEndpoint[record.endpoint].totalDurationMs += record.duration_ms;
    if (!record.success) global.aiMetrics.byEndpoint[record.endpoint].errors++;
    if (record.fallback) global.aiMetrics.byEndpoint[record.endpoint].fallbacks++;

    // 按日期统计
    const dateKey = record.timestamp.split('T')[0];
    if (!global.aiMetrics.byDate[dateKey]) {
        global.aiMetrics.byDate[dateKey] = { calls: 0, tokens: 0, errors: 0 };
    }
    global.aiMetrics.byDate[dateKey].calls++;
    global.aiMetrics.byDate[dateKey].tokens += record.totalTokens;
    if (!record.success) global.aiMetrics.byDate[dateKey].errors++;

    // 2. 异步写入 SQLite（fire-and-forget）
    persistToSQLite(record);

    return traceId;
}

/**
 * 获取 AI 调用统计摘要（同步接口，从内存缓存读取）
 * 保持向后兼容，stream.js 调用此函数
 */
function getMetricsSummary() {
    const metrics = global.aiMetrics;
    const recentCalls = metrics.calls.slice(-100); // 最近100次调用

    // 计算平均耗时
    const avgDuration = recentCalls.length > 0
        ? Math.round(recentCalls.reduce((sum, c) => sum + c.duration_ms, 0) / recentCalls.length)
        : 0;

    // 计算成功率
    const successRate = metrics.totalCalls > 0
        ? Math.round(((metrics.totalCalls - metrics.totalErrors) / metrics.totalCalls) * 100)
        : 100;

    // 计算降级率
    const fallbackCount = recentCalls.filter(c => c.fallback).length;
    const fallbackRate = recentCalls.length > 0
        ? Math.round((fallbackCount / recentCalls.length) * 100)
        : 0;

    return {
        overview: {
            totalCalls: metrics.totalCalls,
            totalTokens: metrics.totalTokens,
            totalErrors: metrics.totalErrors,
            successRate: successRate + '%',
            fallbackRate: fallbackRate + '%',
            avgDurationMs: avgDuration
        },
        byModel: Object.entries(metrics.byModel).map(([model, stats]) => ({
            model,
            calls: stats.calls,
            tokens: stats.tokens,
            errors: stats.errors,
            avgDurationMs: stats.calls > 0 ? Math.round(stats.totalDurationMs / stats.calls) : 0,
            errorRate: stats.calls > 0 ? Math.round((stats.errors / stats.calls) * 100) + '%' : '0%'
        })),
        byEndpoint: Object.entries(metrics.byEndpoint).map(([endpoint, stats]) => ({
            endpoint,
            calls: stats.calls,
            tokens: stats.tokens,
            errors: stats.errors,
            fallbacks: stats.fallbacks,
            avgDurationMs: stats.calls > 0 ? Math.round(stats.totalDurationMs / stats.calls) : 0
        })),
        byDate: Object.entries(metrics.byDate).map(([date, stats]) => ({
            date,
            calls: stats.calls,
            tokens: stats.tokens,
            errors: stats.errors
        })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7), // 最近7天
        recentCalls: recentCalls.slice(-20).reverse() // 最近20次调用
    };
}

/**
 * 从 SQLite 查询指定 Trace ID 的完整调用链路
 * 用于生产环境问题排查：一个 traceId 可能关联多次 AI 调用
 *
 * @param {string} traceId - Trace ID
 * @returns {Array} 该 traceId 下的所有 AI 调用记录
 */
async function getTraceById(traceId) {
    await ensureDBInit();
    try {
        const rows = await all(
            `SELECT * FROM ai_metrics WHERE trace_id = ? ORDER BY created_at ASC`,
            [traceId]
        );
        return rows;
    } catch (err) {
        console.error('[ai-observability] 查询 trace 失败:', err.message);
        return [];
    }
}

/**
 * 从 SQLite 查询时间范围内的 AI 调用统计（异步接口）
 * 用于历史数据分析和趋势监控
 *
 * @param {Object} options - 查询选项
 * @param {string} [options.startDate] - 开始日期（ISO 格式）
 * @param {string} [options.endDate] - 结束日期（ISO 格式）
 * @param {string} [options.endpoint] - 按端点筛选
 * @param {string} [options.model] - 按模型筛选
 * @param {number} [options.limit] - 返回记录数上限
 * @returns {Object} 聚合统计结果
 */
async function getMetricsSummaryAsync(options = {}) {
    await ensureDBInit();

    const {
        startDate = null,
        endDate = null,
        endpoint = null,
        model = null,
        limit = 100
    } = options;

    try {
        // 构建查询条件
        const conditions = [];
        const params = [];

        if (startDate) {
            conditions.push('created_at >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('created_at <= ?');
            params.push(endDate);
        }
        if (endpoint) {
            conditions.push('endpoint = ?');
            params.push(endpoint);
        }
        if (model) {
            conditions.push('model = ?');
            params.push(model);
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        // 总体统计
        const overview = await get(`
            SELECT
                COUNT(*) as total_calls,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(input_tokens + output_tokens) as total_tokens,
                AVG(duration_ms) as avg_duration_ms,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count,
                SUM(CASE WHEN fallback = 1 THEN 1 ELSE 0 END) as fallback_count
            FROM ai_metrics ${whereClause}
        `, params);

        // 按端点统计
        const byEndpoint = await all(`
            SELECT
                endpoint,
                COUNT(*) as calls,
                SUM(input_tokens + output_tokens) as tokens,
                AVG(duration_ms) as avg_duration_ms,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN fallback = 1 THEN 1 ELSE 0 END) as fallbacks
            FROM ai_metrics ${whereClause}
            GROUP BY endpoint
            ORDER BY calls DESC
        `, params);

        // 按模型统计
        const byModel = await all(`
            SELECT
                model,
                COUNT(*) as calls,
                SUM(input_tokens + output_tokens) as tokens,
                AVG(duration_ms) as avg_duration_ms,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
            FROM ai_metrics ${whereClause}
            GROUP BY model
            ORDER BY calls DESC
        `, params);

        // 按日期统计
        const byDate = await all(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as calls,
                SUM(input_tokens + output_tokens) as tokens,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
            FROM ai_metrics ${whereClause}
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `, params);

        // 最近调用明细
        const recentCallsParams = [...params];
        const recentCalls = await all(`
            SELECT * FROM ai_metrics ${whereClause}
            ORDER BY created_at DESC
            LIMIT ?
        `, [...recentCallsParams, limit]);

        const totalCalls = overview?.total_calls || 0;
        const successCount = overview?.success_count || 0;
        const errorCount = overview?.error_count || 0;

        return {
            overview: {
                totalCalls,
                totalTokens: overview?.total_tokens || 0,
                totalInputTokens: overview?.total_input_tokens || 0,
                totalOutputTokens: overview?.total_output_tokens || 0,
                totalErrors: errorCount,
                successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) + '%' : '100%',
                fallbackRate: totalCalls > 0 ? Math.round(((overview?.fallback_count || 0) / totalCalls) * 100) + '%' : '0%',
                avgDurationMs: Math.round(overview?.avg_duration_ms || 0)
            },
            byEndpoint,
            byModel,
            byDate,
            recentCalls
        };
    } catch (err) {
        console.error('[ai-observability] SQLite 查询失败，降级到内存模式:', err.message);
        // 降级：返回内存缓存数据
        return getMetricsSummary();
    }
}

/**
 * 估算 token 数量（简单估算：英文约4字符=1token，中文约1.5字符=1token）
 */
function estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 包装 AI 调用，自动记录可观测性数据
 * @param {Function} aiCallFn - AI 调用函数，返回 { content, inputTokens, outputTokens } 或字符串
 * @param {Object} meta - 元数据 { endpoint, model, userId, messages, traceId }
 * @returns {string|Object} AI 调用结果
 */
async function wrapAICall(aiCallFn, meta) {
    const startTime = Date.now();
    const traceId = meta.traceId || generateTraceId();

    try {
        const result = await aiCallFn();

        const durationMs = Date.now() - startTime;

        // 解析结果
        let content = result;
        let inputTokens = 0;
        let outputTokens = 0;

        if (typeof result === 'object' && result !== null) {
            content = result.content || '';
            inputTokens = result.inputTokens || estimateTokens(
                (meta.messages || []).map(m => m.content || '').join('')
            );
            outputTokens = result.outputTokens || estimateTokens(content);
        } else {
            inputTokens = estimateTokens(
                (meta.messages || []).map(m => m.content || '').join('')
            );
            outputTokens = estimateTokens(content);
        }

        recordAICall({
            traceId,
            endpoint: meta.endpoint,
            model: meta.model,
            inputTokens,
            outputTokens,
            durationMs,
            success: true,
            fallback: meta.fallback || false,
            userId: meta.userId
        });

        return content;
    } catch (err) {
        const durationMs = Date.now() - startTime;

        recordAICall({
            traceId,
            endpoint: meta.endpoint,
            model: meta.model,
            inputTokens: 0,
            outputTokens: 0,
            durationMs,
            success: false,
            fallback: false,
            userId: meta.userId,
            error: err.message
        });

        throw err;
    }
}

module.exports = {
    recordAICall,
    getMetricsSummary,
    getMetricsSummaryAsync,
    getTraceById,
    generateTraceId,
    estimateTokens,
    wrapAICall
};
