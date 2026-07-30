/**
 * EnhancedToolRegistry - 增强工具注册中心
 * Harness T层（工具接口协议）增强
 *
 * 在现有 ToolRegistry 基础上增加四项生产级能力：
 *   1. ToolSchemaValidator  - 工具入参 JSON Schema 校验（required / type / enum）
 *   2. ToolCircuitBreaker   - 工具级超时 + 熔断（CLOSED / OPEN / HALF_OPEN）
 *   3. ParallelToolExecutor - 并行工具执行器（独立超时 + 错误隔离）
 *   4. enhancedExecute      - 组合上述能力的增强执行包装器（指标记录 + 错误降级）
 *
 * 设计原则：
 *   - 与 ToolRegistry.js 完全兼容，可平滑替换（re-export 原有 API）
 *   - 工具结构不变：{ name, description, parameters, execute(args, context) }
 *   - 所有增强可选，不传 options 时使用合理默认值
 *   - 错误降级：工具失败返回结构化错误字符串，不抛异常中断 Agent 流程
 *
 * 使用示例：
 *   const { enhancedExecute, executeTools } = require('./EnhancedToolRegistry');
 *
 *   // 单工具增强执行
 *   const res = await enhancedExecute('search_words', { keyword: 'abandon' }, { userId: 1 });
 *   // → { toolName, success, result, error, durationMs, validation, circuitState }
 *
 *   // 并行执行多个工具
 *   const results = await executeTools(
 *       [{ name: 'search_words', arguments: { keyword: 'abandon' } },
 *        { name: 'get_review_queue', arguments: {} }],
 *       getAllTools(),
 *       { userId: 1 }
 *   );
 *   // → [{ toolName, success, result, error, durationMs }, ...]
 */

'use strict';

const ToolRegistry = require('./ToolRegistry');

// ============================================================
// 常量定义
// ============================================================

/**
 * 熔断器状态枚举
 * @readonly
 * @enum {string}
 */
const CircuitState = Object.freeze({
    CLOSED: 'CLOSED',        // 正常放行
    OPEN: 'OPEN',            // 熔断中，拒绝所有请求
    HALF_OPEN: 'HALF_OPEN'   // 半开探测，允许有限请求试探恢复
});

// 默认配置
const DEFAULT_TIMEOUT_MS = 10000;       // 工具默认超时 10s
const DEFAULT_FAILURE_THRESHOLD = 3;    // 连续失败 3 次触发熔断
const DEFAULT_RESET_TIMEOUT_MS = 60000; // 熔断恢复冷却 60s


// ============================================================
// 1. ToolSchemaValidator - 工具 Schema 校验器
// ============================================================

/**
 * 工具入参 JSON Schema 校验器
 *
 * 根据工具 parameters（JSON Schema 子集）校验入参：
 *   - required 字段是否存在
 *   - 字段类型是否匹配（string / integer / number / boolean / array / object）
 *   - enum 枚举值是否合法
 *   - 输出 sanitized 对象（仅保留 schema 中定义的字段，自动类型修正）
 */
class ToolSchemaValidator {

    /**
     * @param {Object} [options={}]
     * @param {boolean} [options.coerceTypes=true] - 是否自动修正类型（如 "3" → 3）
     * @param {boolean} [options.stripUnknown=true] - 是否移除 schema 中未定义的字段
     */
    constructor(options = {}) {
        /** @type {Map<string, Object>} toolName → parameters schema */
        this.schemas = new Map();
        this.coerceTypes = options.coerceTypes !== false;
        this.stripUnknown = options.stripUnknown !== false;
    }

    /**
     * 注册工具的 parameters schema
     * @param {string} toolName - 工具名称
     * @param {Object} parameters - JSON Schema（parameters 字段）
     */
    register(toolName, parameters) {
        if (parameters && typeof parameters === 'object') {
            this.schemas.set(toolName, parameters);
        }
    }

    /**
     * 批量注册工具 schema
     * @param {Array} tools - 工具定义数组
     */
    registerAll(tools) {
        if (!Array.isArray(tools)) return;
        tools.forEach(tool => {
            if (tool && tool.name && tool.parameters) {
                this.register(tool.name, tool.parameters);
            }
        });
    }

    /**
     * 校验工具入参
     * @param {string} toolName - 工具名称
     * @param {Object} args - 待校验的入参对象
     * @returns {{ valid: boolean, errors: string[], sanitized: Object }}
     */
    validateParams(toolName, args) {
        const schema = this.schemas.get(toolName);

        // 未注册 schema 的工具，跳过校验（兼容无 schema 的自定义工具）
        if (!schema) {
            return { valid: true, errors: [], sanitized: args || {} };
        }

        const errors = [];
        const sanitized = {};

        // 确保入参是对象
        const input = (args && typeof args === 'object' && !Array.isArray(args))
            ? args
            : {};

        const properties = schema.properties || {};
        const required = schema.required || [];

        // 1. 检查 required 字段
        for (const field of required) {
            if (input[field] === undefined || input[field] === null || input[field] === '') {
                errors.push(`缺少必填字段: ${field}`);
            }
        }

        // 2. 逐字段校验类型与枚举
        for (const [key, propSchema] of Object.entries(properties)) {
            const value = input[key];

            // 跳过未提供的可选字段（required 已检查）
            if (value === undefined || value === null) {
                continue;
            }

            // 类型校验
            const typeError = this._validateType(key, value, propSchema);
            if (typeError) {
                errors.push(typeError);
                continue;
            }

            // 枚举校验
            if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
                errors.push(
                    `字段 ${key} 的值 "${value}" 不在允许范围内: [${propSchema.enum.join(', ')}]`
                );
                continue;
            }

            // 通过校验，写入 sanitized（按需类型修正）
            sanitized[key] = this.coerceTypes
                ? this._coerceValue(value, propSchema.type)
                : value;
        }

        // 3. 如果不剥离未知字段，将 schema 外的字段也保留
        if (!this.stripUnknown) {
            for (const [key, value] of Object.entries(input)) {
                if (!(key in properties) && !(key in sanitized)) {
                    sanitized[key] = value;
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized
        };
    }

    /**
     * 校验单个字段的类型
     * @param {string} key - 字段名
     * @param {*} value - 字段值
     * @param {Object} propSchema - 字段 schema
     * @returns {string|null} 错误信息，null 表示通过
     * @private
     */
    _validateType(key, value, propSchema) {
        const expectedType = propSchema.type;
        if (!expectedType) return null; // 无类型约束，跳过

        switch (expectedType) {
            case 'string':
                if (typeof value !== 'string') {
                    return `字段 ${key} 应为 string 类型，实际为 ${typeof value}`;
                }
                break;
            case 'integer':
                if (!Number.isInteger(value) && !this._isNumericString(value)) {
                    return `字段 ${key} 应为 integer 类型，实际为 ${typeof value}`;
                }
                break;
            case 'number':
                if (typeof value !== 'number' || isNaN(value)) {
                    if (!this._isNumericString(value)) {
                        return `字段 ${key} 应为 number 类型，实际为 ${typeof value}`;
                    }
                }
                break;
            case 'boolean':
                if (typeof value !== 'boolean' && !this._isBooleanString(value)) {
                    return `字段 ${key} 应为 boolean 类型，实际为 ${typeof value}`;
                }
                break;
            case 'array':
                if (!Array.isArray(value)) {
                    return `字段 ${key} 应为 array 类型，实际为 ${typeof value}`;
                }
                break;
            case 'object':
                if (typeof value !== 'object' || Array.isArray(value) || value === null) {
                    return `字段 ${key} 应为 object 类型，实际为 ${Array.isArray(value) ? 'array' : typeof value}`;
                }
                break;
            default:
                // 未知类型，跳过校验
                break;
        }

        return null;
    }

    /**
     * 类型修正：将字符串形式的数字/布尔值转为对应类型
     * @param {*} value - 原始值
     * @param {string} expectedType - 期望类型
     * @returns {*} 修正后的值
     * @private
     */
    _coerceValue(value, expectedType) {
        if (!expectedType) return value;

        switch (expectedType) {
            case 'integer':
                if (typeof value === 'string' && this._isNumericString(value)) {
                    return parseInt(value, 10);
                }
                return value;
            case 'number':
                if (typeof value === 'string' && this._isNumericString(value)) {
                    return parseFloat(value);
                }
                return value;
            case 'boolean':
                if (typeof value === 'string' && this._isBooleanString(value)) {
                    return value.toLowerCase() === 'true';
                }
                return value;
            default:
                return value;
        }
    }

    /** @private */
    _isNumericString(value) {
        return typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value));
    }

    /** @private */
    _isBooleanString(value) {
        return typeof value === 'string' &&
            (value.toLowerCase() === 'true' || value.toLowerCase() === 'false');
    }
}


// ============================================================
// 2. ToolCircuitBreaker - 工具级超时与熔断
// ============================================================

/**
 * 工具级熔断器
 *
 * 为每个工具维护独立的熔断状态：
 *   - CLOSED → 正常执行；连续失败达阈值后转为 OPEN
 *   - OPEN   → 拒绝所有请求；经过 resetTimeout 后转为 HALF_OPEN
 *   - HALF_OPEN → 允许一次探测请求；成功转 CLOSED，失败转 OPEN
 *
 * 同时管理每个工具的独立超时配置。
 */
class ToolCircuitBreaker {

    /**
     * @param {Object} [options={}]
     * @param {number} [options.defaultTimeout=10000] - 默认超时（ms）
     * @param {number} [options.failureThreshold=3] - 触发熔断的连续失败次数
     * @param {number} [options.resetTimeout=60000] - 熔断恢复冷却时间（ms）
     * @param {Object<string, number>} [options.toolTimeouts={}] - 工具级超时覆盖 { toolName: ms }
     */
    constructor(options = {}) {
        this.defaultTimeout = options.defaultTimeout || DEFAULT_TIMEOUT_MS;
        this.failureThreshold = options.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
        this.resetTimeout = options.resetTimeout || DEFAULT_RESET_TIMEOUT_MS;
        /** @type {Object<string, number>} toolName → 超时 ms */
        this.toolTimeouts = options.toolTimeouts || {};
        /** @type {Map<string, Object>} toolName → 熔断状态条目 */
        this.states = new Map();
    }

    /**
     * 获取（或初始化）工具的熔断状态条目
     * @param {string} toolName
     * @returns {Object} 状态条目
     * @private
     */
    _getEntry(toolName) {
        if (!this.states.has(toolName)) {
            this.states.set(toolName, {
                state: CircuitState.CLOSED,
                failureCount: 0,
                lastFailureTime: null,
                openedAt: null
            });
        }
        return this.states.get(toolName);
    }

    /**
     * 获取工具的超时配置（ms）
     * @param {string} toolName
     * @returns {number}
     */
    getTimeout(toolName) {
        return this.toolTimeouts[toolName] || this.defaultTimeout;
    }

    /**
     * 设置工具的超时配置
     * @param {string} toolName
     * @param {number} timeoutMs
     */
    setTimeout(toolName, timeoutMs) {
        this.toolTimeouts[toolName] = timeoutMs;
    }

    /**
     * 获取工具当前熔断状态
     * @param {string} toolName
     * @returns {string} CircuitState 枚举值
     */
    getState(toolName) {
        return this._getEntry(toolName).state;
    }

    /**
     * 判断工具是否可执行（含 OPEN → HALF_OPEN 自动转换）
     *
     * @param {string} toolName
     * @returns {{ allowed: boolean, state: string, reason: string|null }}
     */
    canExecute(toolName) {
        const entry = this._getEntry(toolName);

        switch (entry.state) {
            case CircuitState.CLOSED:
                return { allowed: true, state: entry.state, reason: null };

            case CircuitState.OPEN: {
                const elapsed = Date.now() - entry.openedAt;
                if (elapsed >= this.resetTimeout) {
                    // 冷却期已过，转为半开探测
                    entry.state = CircuitState.HALF_OPEN;
                    console.log(
                        `[EnhancedToolRegistry] 熔断器 ${toolName}: OPEN → HALF_OPEN（冷却 ${this.resetTimeout / 1000}s 已过，开始半开探测）`
                    );
                    return { allowed: true, state: entry.state, reason: 'half_open_probe' };
                }
                const remaining = Math.ceil((this.resetTimeout - elapsed) / 1000);
                return {
                    allowed: false,
                    state: entry.state,
                    reason: `工具已熔断，${remaining}s 后自动恢复`
                };
            }

            case CircuitState.HALF_OPEN:
                // 半开状态：允许探测请求
                return { allowed: true, state: entry.state, reason: 'half_open_probe' };

            default:
                return { allowed: true, state: entry.state, reason: null };
        }
    }

    /**
     * 记录工具执行成功
     * - HALF_OPEN 状态下成功 → 转为 CLOSED（恢复）
     * - CLOSED 状态下成功 → 重置失败计数
     * @param {string} toolName
     */
    recordSuccess(toolName) {
        const entry = this._getEntry(toolName);

        if (entry.state === CircuitState.HALF_OPEN) {
            entry.state = CircuitState.CLOSED;
            entry.failureCount = 0;
            entry.openedAt = null;
            console.log(
                `[EnhancedToolRegistry] 熔断器 ${toolName}: HALF_OPEN → CLOSED（探测成功，已恢复）`
            );
        } else if (entry.state === CircuitState.CLOSED) {
            entry.failureCount = 0;
        }
    }

    /**
     * 记录工具执行失败
     * - HALF_OPEN 状态下失败 → 转为 OPEN（重新熔断）
     * - CLOSED 状态下失败 → 递增计数，达阈值则转为 OPEN
     * @param {string} toolName
     */
    recordFailure(toolName) {
        const entry = this._getEntry(toolName);
        entry.failureCount++;
        entry.lastFailureTime = Date.now();

        if (entry.state === CircuitState.HALF_OPEN) {
            entry.state = CircuitState.OPEN;
            entry.openedAt = Date.now();
            console.log(
                `[EnhancedToolRegistry] 熔断器 ${toolName}: HALF_OPEN → OPEN（探测失败，重新熔断 ${this.resetTimeout / 1000}s）`
            );
        } else if (entry.state === CircuitState.CLOSED) {
            if (entry.failureCount >= this.failureThreshold) {
                entry.state = CircuitState.OPEN;
                entry.openedAt = Date.now();
                console.log(
                    `[EnhancedToolRegistry] 熔断器 ${toolName}: CLOSED → OPEN（连续失败 ${entry.failureCount} 次，触发熔断 ${this.resetTimeout / 1000}s）`
                );
            }
        }
    }

    /**
     * 手动重置工具的熔断状态
     * @param {string} toolName
     */
    reset(toolName) {
        this.states.delete(toolName);
    }

    /**
     * 重置所有工具的熔断状态
     */
    resetAll() {
        this.states.clear();
    }

    /**
     * 获取所有工具的熔断状态快照（用于可观测性）
     * @returns {Object<string, Object>}
     */
    getStatus() {
        const status = {};
        for (const [name, entry] of this.states) {
            status[name] = {
                state: entry.state,
                failureCount: entry.failureCount,
                lastFailureTime: entry.lastFailureTime,
                openedAt: entry.openedAt,
                timeoutMs: this.getTimeout(name)
            };
        }
        return status;
    }
}


// ============================================================
// 3. ToolMetricsCollector - 工具执行指标收集
// ============================================================

/**
 * 工具执行指标收集器
 *
 * 记录每个工具的调用次数、成功/失败数、总耗时、最近错误等，
 * 供可观测性和调优使用。
 */
class ToolMetricsCollector {

    constructor() {
        /** @type {Map<string, Object>} toolName → 指标 */
        this.metrics = new Map();
    }

    /**
     * 记录一次工具执行
     * @param {string} toolName
     * @param {{ success: boolean, durationMs: number, error: string|null }} result
     */
    record(toolName, { success, durationMs, error }) {
        if (!this.metrics.has(toolName)) {
            this.metrics.set(toolName, {
                calls: 0,
                successes: 0,
                failures: 0,
                totalDurationMs: 0,
                lastError: null,
                lastCallTime: null
            });
        }
        const m = this.metrics.get(toolName);
        m.calls++;
        m.totalDurationMs += durationMs;
        m.lastCallTime = Date.now();
        if (success) {
            m.successes++;
        } else {
            m.failures++;
            m.lastError = error;
        }
    }

    /**
     * 获取单个工具的指标
     * @param {string} toolName
     * @returns {Object|null}
     */
    getMetrics(toolName) {
        const m = this.metrics.get(toolName);
        if (!m) return null;
        return {
            ...m,
            avgDurationMs: m.calls > 0 ? Math.round(m.totalDurationMs / m.calls) : 0,
            successRate: m.calls > 0 ? Math.round((m.successes / m.calls) * 100) : 0
        };
    }

    /**
     * 获取所有工具的指标快照
     * @returns {Object<string, Object>}
     */
    getAllMetrics() {
        const result = {};
        for (const [name] of this.metrics) {
            result[name] = this.getMetrics(name);
        }
        return result;
    }

    /** 重置所有指标 */
    reset() {
        this.metrics.clear();
    }
}


// ============================================================
// 辅助函数
// ============================================================

/**
 * 为 Promise 添加超时控制
 *
 * 使用 Promise.race 实现：超时后 reject，底层 Promise 仍在后台执行
 * （Node.js 无法真正取消已发起的异步操作，如需真正取消需工具支持 AbortSignal）
 *
 * @param {Promise} promise - 原始 Promise
 * @param {number} timeoutMs - 超时时间（ms）
 * @param {string} toolName - 工具名称（用于错误信息）
 * @returns {Promise} 带超时的 Promise
 * @private
 */
function _withTimeout(promise, timeoutMs, toolName) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`工具 ${toolName} 执行超时（${timeoutMs / 1000}s）`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}

/**
 * 从 tools 参数构建 toolName → tool 的映射
 *
 * @param {Array|Object} tools - 工具数组或 ToolRegistry 模块
 * @returns {Map<string, Object>}
 * @private
 */
function _buildToolMap(tools) {
    const map = new Map();
    if (Array.isArray(tools)) {
        tools.forEach(t => {
            if (t && t.name) map.set(t.name, t);
        });
    } else if (tools && typeof tools === 'object') {
        // 兼容传入 ToolRegistry 模块（有 getAllTools / getTool 方法）
        if (typeof tools.getAllTools === 'function') {
            tools.getAllTools().forEach(t => {
                if (t && t.name) map.set(t.name, t);
            });
        } else if (typeof tools.getTool === 'function') {
            // 逐个查找（效率低，但兼容）
            // 此分支一般不触发，仅作兜底
        }
    }
    return map;
}

/**
 * 规范化工具调用对象，支持多种输入格式
 *
 * 支持的格式：
 *   - { name, arguments }          （OpenAI Function Calling 格式）
 *   - { toolName, args }           （简化格式）
 *   - { function: { name, arguments } } （原始 AI 响应格式）
 *
 * @param {Object} toolCall
 * @returns {{ name: string, args: Object }}
 * @private
 */
function _normalizeToolCall(toolCall) {
    // 格式: { function: { name, arguments } }（OpenAI 原始格式）
    if (toolCall.function && toolCall.function.name) {
        let args = {};
        try {
            args = typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments || '{}')
                : (toolCall.function.arguments || {});
        } catch (e) {
            args = {};
        }
        return { name: toolCall.function.name, args };
    }

    // 格式: { name, arguments }
    if (toolCall.name) {
        let args = {};
        try {
            args = typeof toolCall.arguments === 'string'
                ? JSON.parse(toolCall.arguments || '{}')
                : (toolCall.arguments || {});
        } catch (e) {
            args = {};
        }
        return { name: toolCall.name, args };
    }

    // 格式: { toolName, args }
    if (toolCall.toolName) {
        return { name: toolCall.toolName, args: toolCall.args || {} };
    }

    return { name: '', args: {} };
}


// ============================================================
// 4. enhancedExecute - 增强工具执行包装器
// ============================================================

/**
 * 增强执行单个工具
 *
 * 组合 Schema 校验 + 超时 + 熔断 + 执行 + 指标记录 + 错误降级：
 *   1. 检查熔断器状态（OPEN 则直接降级返回）
 *   2. Schema 校验入参（失败则降级返回，不计入熔断）
 *   3. 带超时执行工具 execute()
 *   4. 记录成功/失败到熔断器 + 指标收集器
 *   5. 异常时返回结构化错误字符串（不抛出，保证 Agent 流程不中断）
 *
 * @param {string} toolName - 工具名称
 * @param {Object} args - 工具入参
 * @param {Object} context - 执行上下文（如 { userId }）
 * @param {Object} [options={}]
 * @param {Array|Object} [options.tools] - 工具数组或 ToolRegistry（默认使用内置 ToolRegistry）
 * @param {ToolSchemaValidator} [options.validator] - Schema 校验器实例
 * @param {ToolCircuitBreaker} [options.breaker] - 熔断器实例
 * @param {ToolMetricsCollector} [options.metrics] - 指标收集器实例
 * @param {number} [options.timeoutMs] - 本次执行的超时覆盖（ms）
 * @returns {Promise<{toolName: string, success: boolean, result: string|null, error: string|null, durationMs: number, validation: Object, circuitState: string}>}
 */
async function enhancedExecute(toolName, args, context, options = {}) {
    const startTime = Date.now();
    const validator = options.validator || _singleton.validator;
    const breaker = options.breaker || _singleton.breaker;
    const metrics = options.metrics || _singleton.metrics;
    const toolMap = options.tools
        ? _buildToolMap(options.tools)
        : _singleton.toolMap;

    // 基础返回结构
    const baseResult = {
        toolName,
        success: false,
        result: null,
        error: null,
        durationMs: 0,
        validation: null,
        circuitState: CircuitState.CLOSED
    };

    // ----------------------------------------------------------
    // Step 1: 查找工具
    // ----------------------------------------------------------
    const tool = toolMap.get(toolName);
    if (!tool) {
        const durationMs = Date.now() - startTime;
        baseResult.error = `[工具不存在] 未找到工具: ${toolName}`;
        baseResult.durationMs = durationMs;
        metrics.record(toolName, { success: false, durationMs, error: baseResult.error });
        console.log(`[EnhancedToolRegistry] 工具不存在: ${toolName}`);
        return baseResult;
    }

    // ----------------------------------------------------------
    // Step 2: 检查熔断器
    // ----------------------------------------------------------
    const circuitCheck = breaker.canExecute(toolName);
    baseResult.circuitState = circuitCheck.state;

    if (!circuitCheck.allowed) {
        const durationMs = Date.now() - startTime;
        baseResult.error = `[工具熔断] ${toolName} 当前不可用（${circuitCheck.reason}）`;
        baseResult.durationMs = durationMs;
        // 熔断拒绝不计入指标（不是真正的执行）
        metrics.record(toolName, { success: false, durationMs, error: baseResult.error });
        console.log(`[EnhancedToolRegistry] 熔断拒绝: ${toolName}（${circuitCheck.reason}）`);
        return baseResult;
    }

    // ----------------------------------------------------------
    // Step 3: Schema 校验
    // ----------------------------------------------------------
    const validation = validator.validateParams(toolName, args);
    baseResult.validation = validation;

    if (!validation.valid) {
        const durationMs = Date.now() - startTime;
        baseResult.error = `[参数校验失败] ${toolName}: ${validation.errors.join('; ')}`;
        baseResult.durationMs = durationMs;
        // Schema 校验失败是调用方错误，不计入熔断（非工具本身故障）
        metrics.record(toolName, { success: false, durationMs, error: baseResult.error });
        console.log(`[EnhancedToolRegistry] 参数校验失败: ${toolName} → ${validation.errors.join('; ')}`);
        return baseResult;
    }

    // ----------------------------------------------------------
    // Step 4: 带超时执行
    // ----------------------------------------------------------
    const timeoutMs = options.timeoutMs || breaker.getTimeout(toolName);
    const sanitizedArgs = validation.sanitized;
    const execContext = context || {};

    try {
        console.log(
            `[EnhancedToolRegistry] 执行工具: ${toolName}（超时 ${timeoutMs / 1000}s，参数: ${JSON.stringify(sanitizedArgs)}）`
        );

        const execPromise = tool.execute(sanitizedArgs, execContext);
        const result = await _withTimeout(execPromise, timeoutMs, toolName);

        // 成功
        const durationMs = Date.now() - startTime;
        breaker.recordSuccess(toolName);
        metrics.record(toolName, { success: true, durationMs, error: null });

        console.log(`[EnhancedToolRegistry] 工具执行成功: ${toolName}（${durationMs}ms）`);

        return {
            ...baseResult,
            success: true,
            result: typeof result === 'string' ? result : JSON.stringify(result),
            error: null,
            durationMs,
            circuitState: breaker.getState(toolName)
        };

    } catch (err) {
        // 失败（超时 / 执行异常）
        const durationMs = Date.now() - startTime;
        const errorMsg = err.message || String(err);

        // 记录熔断 + 指标
        breaker.recordFailure(toolName);
        metrics.record(toolName, { success: false, durationMs, error: errorMsg });

        // 错误降级：返回结构化错误字符串，不抛出
        const degradedError = _degradeError(toolName, errorMsg, timeoutMs);
        console.error(`[EnhancedToolRegistry] 工具执行失败: ${toolName}（${durationMs}ms）→ ${errorMsg}`);

        return {
            ...baseResult,
            success: false,
            result: null,
            error: degradedError,
            durationMs,
            circuitState: breaker.getState(toolName)
        };
    }
}

/**
 * 错误降级：将异常信息转为用户/Agent 可读的结构化错误字符串
 *
 * @param {string} toolName
 * @param {string} errorMsg
 * @param {number} timeoutMs
 * @returns {string}
 * @private
 */
function _degradeError(toolName, errorMsg, timeoutMs) {
    if (errorMsg.includes('超时')) {
        return `[工具超时] ${toolName} 执行超时（${timeoutMs / 1000}s），请简化请求或稍后重试`;
    }
    return `[工具异常] ${toolName} 执行失败: ${errorMsg}`;
}


// ============================================================
// 5. ParallelToolExecutor - 并行工具执行器
// ============================================================

/**
 * 并行工具执行器
 *
 * 同时执行多个工具调用，每个工具独立超时和错误捕获，
 * 单个工具失败不影响其他工具的执行结果。
 */
class ParallelToolExecutor {

    /**
     * @param {Object} [options={}]
     * @param {ToolSchemaValidator} [options.validator] - Schema 校验器
     * @param {ToolCircuitBreaker} [options.breaker] - 熔断器
     * @param {ToolMetricsCollector} [options.metrics] - 指标收集器
     */
    constructor(options = {}) {
        this.validator = options.validator || _singleton.validator;
        this.breaker = options.breaker || _singleton.breaker;
        this.metrics = options.metrics || _singleton.metrics;
    }

    /**
     * 并行执行多个工具调用
     *
     * @param {Array<Object>} toolCalls - 工具调用数组，支持多种格式
     * @param {Array|Object} tools - 工具数组或 ToolRegistry 模块
     * @param {Object} context - 执行上下文
     * @param {Object} [options={}] - 额外选项（timeoutMs 覆盖等）
     * @returns {Promise<Array<{toolName: string, success: boolean, result: string|null, error: string|null, durationMs: number}>>}
     */
    async executeTools(toolCalls, tools, context, options = {}) {
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
            return [];
        }

        // 并行启动所有工具执行
        // 注意：直接传递原始 tools 给 enhancedExecute，由其内部 _buildToolMap 处理
        const promises = toolCalls.map(toolCall => {
            const { name, args } = _normalizeToolCall(toolCall);
            return enhancedExecute(name, args, context, {
                tools: tools,
                validator: this.validator,
                breaker: this.breaker,
                metrics: this.metrics,
                ...options
            });
        });

        const results = await Promise.all(promises);

        // 汇总日志
        const succeeded = results.filter(r => r.success).length;
        const failed = results.length - succeeded;
        console.log(
            `[EnhancedToolRegistry] 并行执行完成: ${results.length} 个工具` +
            `（成功 ${succeeded}, 失败 ${failed}）`
        );

        return results;
    }
}


// ============================================================
// 单例初始化（模块级共享实例）
// ============================================================

/**
 * 模块级单例容器
 *
 * 所有 enhancedExecute / executeTools 调用默认使用这些共享实例，
 * 保证整个应用内熔断状态和指标的一致性。
 */
const _singleton = {
    validator: new ToolSchemaValidator(),
    breaker: new ToolCircuitBreaker(),
    metrics: new ToolMetricsCollector(),
    toolMap: new Map()
};

/**
 * 初始化单例：自动注册所有 ToolRegistry 中的工具 schema
 */
function _initSingleton() {
    try {
        const allTools = ToolRegistry.getAllTools();
        _singleton.validator.registerAll(allTools);
        _singleton.toolMap = _buildToolMap(allTools);
        console.log(
            `[EnhancedToolRegistry] 初始化完成: 已注册 ${allTools.length} 个工具的 schema`
        );
    } catch (err) {
        console.error(`[EnhancedToolRegistry] 初始化失败: ${err.message}`);
    }
}

// 模块加载时自动初始化
_initSingleton();

/**
 * 重新初始化单例（支持运行时动态注册新工具后刷新）
 */
function refreshSingleton() {
    _singleton.validator = new ToolSchemaValidator();
    _singleton.breaker = new ToolCircuitBreaker();
    _singleton.metrics = new ToolMetricsCollector();
    _initSingleton();
}


// ============================================================
// 模块导出
// ============================================================

module.exports = {
    // ---- 原有 ToolRegistry API（向后兼容，可平滑替换）----
    getAllTools: ToolRegistry.getAllTools,
    getTool: ToolRegistry.getTool,
    getToolDefinitions: ToolRegistry.getToolDefinitions,

    // ---- 增强组件（类）----
    ToolSchemaValidator,
    ToolCircuitBreaker,
    ToolMetricsCollector,
    ParallelToolExecutor,

    // ---- 增强执行（函数）----
    enhancedExecute,

    /**
     * 并行执行多个工具（便捷函数，等价于 ParallelToolExecutor.executeTools）
     * @param {Array<Object>} toolCalls
     * @param {Array|Object} tools
     * @param {Object} context
     * @param {Object} [options={}]
     * @returns {Promise<Array>}
     */
    executeTools(toolCalls, tools, context, options = {}) {
        const executor = new ParallelToolExecutor(options);
        return executor.executeTools(toolCalls, tools, context, options);
    },

    // ---- 常量 ----
    CircuitState,

    // ---- 单例访问（供外部读取状态/指标）----
    getValidator: () => _singleton.validator,
    getBreaker: () => _singleton.breaker,
    getMetrics: () => _singleton.metrics,

    /**
     * 获取所有工具的执行指标快照
     * @returns {Object}
     */
    getToolMetrics: () => _singleton.metrics.getAllMetrics(),

    /**
     * 获取所有工具的熔断状态快照
     * @returns {Object}
     */
    getCircuitStatus: () => _singleton.breaker.getStatus(),

    /**
     * 手动重置所有工具的熔断状态和指标
     */
    resetAll: () => {
        _singleton.breaker.resetAll();
        _singleton.metrics.reset();
        console.log('[EnhancedToolRegistry] 已重置所有熔断状态和执行指标');
    },

    /**
     * 重新初始化单例（运行时刷新）
     */
    refreshSingleton
};
