/**
 * ContextManager - 上下文管理与 Token 预算控制器（C 层）
 *
 * 职责：
 *   1. Token 预算管理（TokenBudgetManager）：按模型上下文窗口估算 token 用量，
 *      达到阈值（默认 40%）时触发压缩，并为输出预留 token 空间。
 *   2. 上下文压缩（ContextCompressor）：保留最近 N 条消息，将更早的历史用 LLM
 *      摘要压缩；无 API Key 或摘要失败时降级为简单截断（保留首尾，删除中间）。
 *   3. 统一管理器（ContextManager）：组合上述两者，对外暴露 checkAndCompress /
 *      getTokenStats 等方法，供 Agent 在每步 think 前调用。
 *
 * 设计原则：
 *   - 异常不阻断主流程：压缩失败时返回原始消息，Agent 可继续运行。
 *   - 无 API Key 降级：未配置 AI Key 时走截断策略，保证功能可用。
 *   - 不引入外部 npm 包，仅复用项目已有的 AIService / ai-observability。
 *
 * 集成点：
 *   - BaseAgent.messageList: [{ role, content, tool_calls?, tool_call_id? }]
 *   - AIService.chat(messages, { model, temperature, maxTokens, userId, endpoint })
 *   - ai-observability.estimateTokens(text)
 *   - AIService.getActiveProvider() => 'dashscope' | 'deepseek' | 'local'
 */

const { estimateTokens } = require('../middleware/ai-observability');
const { chat, getActiveProvider, AIProvider } = require('./AIService');

// ===== 默认配置常量 =====

/**
 * 各模型默认上下文窗口大小（token 数）
 * 用于在没有显式传入 contextWindow 时按 model 自动推断
 */
const MODEL_CONTEXT_WINDOWS = {
    'qwen-turbo': 8192,
    'qwen-plus': 32768,
    'qwen-max': 32768,
    'qwen-long': 32768,
    'deepseek-chat': 32768,
    'deepseek-reasoner': 65536,
    'deepseek-coder': 32768
};

const DEFAULT_CONTEXT_WINDOW = 8192;        // 未知模型的默认上下文窗口
const DEFAULT_COMPRESSION_THRESHOLD = 0.4;  // 默认压缩触发阈值（占上下文窗口的比例）
const DEFAULT_KEEP_RECENT = 4;              // 默认保留的最近消息条数
const DEFAULT_RESERVED_TOKENS = 1000;       // 默认为输出预留的 token 空间（约等于 maxTokens）
const MESSAGE_OVERHEAD_TOKENS = 4;          // 每条消息在 chat 格式中的结构性开销（token）


// ===== 消息 Token 估算工具函数 =====

/**
 * 估算单条消息的 token 数
 * 综合计算 role、content、tool_calls、tool_call_id、name 等字段，
 * 并叠加每条消息的结构性开销。
 *
 * @param {Object} message - 消息对象 { role, content, tool_calls?, tool_call_id?, name? }
 * @returns {number} 估算的 token 数
 */
function estimateMessageTokens(message) {
    if (!message || typeof message !== 'object') return 0;

    let tokens = 0;

    // role 字段（如 "assistant"、"tool"，约 1~2 token）
    if (message.role) {
        tokens += estimateTokens(String(message.role));
    }

    // content 字段（消息主体内容，token 大头）
    if (message.content) {
        tokens += estimateTokens(String(message.content));
    }

    // tool_calls 字段（assistant 发起的工具调用列表）
    // 结构：[{ id, type, function: { name, arguments } }]
    if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
            if (!tc) continue;
            if (tc.id) tokens += estimateTokens(String(tc.id));
            if (tc.type) tokens += estimateTokens(String(tc.type));
            if (tc.function) {
                if (tc.function.name) tokens += estimateTokens(String(tc.function.name));
                if (tc.function.arguments) tokens += estimateTokens(String(tc.function.arguments));
            }
        }
    }

    // tool_call_id 字段（tool 结果消息引用的调用 ID）
    if (message.tool_call_id) {
        tokens += estimateTokens(String(message.tool_call_id));
    }

    // name 字段（部分消息可能携带，如具名函数调用）
    if (message.name) {
        tokens += estimateTokens(String(message.name));
    }

    // 消息结构性开销（chat completions 格式中每条消息的固定开销）
    tokens += MESSAGE_OVERHEAD_TOKENS;

    return tokens;
}

/**
 * 估算消息数组的总 token 数
 *
 * @param {Array} messages - 消息数组
 * @returns {number} 总 token 估算值
 */
function estimateMessagesTokens(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}


// ===== Token 预算管理器 =====

/**
 * TokenBudgetManager - Token 预算管理器
 *
 * 为每个 Agent 实例维护 token 预算：
 *   - 根据模型推断上下文窗口大小
 *   - 计算压缩触发阈值（默认 40%）
 *   - 为输出预留 token 空间（reservedTokens，默认等于 maxTokens）
 *   - 估算 messageList 的总 token 用量并判断是否需要压缩
 */
class TokenBudgetManager {
    /**
     * @param {Object} options
     * @param {number} [options.contextWindow] - 显式指定上下文窗口大小（优先于 model 推断）
     * @param {number} [options.compressionThreshold=0.4] - 压缩触发阈值（0~1）
     * @param {number} [options.reservedTokens=1000] - 为输出预留的 token 空间
     * @param {string} [options.model] - 默认模型名（用于推断上下文窗口）
     */
    constructor(options = {}) {
        // null 表示按 model 自动推断
        this.contextWindow = options.contextWindow || null;
        this.compressionThreshold = options.compressionThreshold != null
            ? options.compressionThreshold
            : DEFAULT_COMPRESSION_THRESHOLD;
        // 预留输出 token，默认与 maxTokens 对齐
        this.reservedTokens = options.reservedTokens != null
            ? options.reservedTokens
            : DEFAULT_RESERVED_TOKENS;
        this.model = options.model || null;
    }

    /**
     * 获取模型上下文窗口大小
     * 优先级：显式 contextWindow > MODEL_CONTEXT_WINDOWS[model] > 默认值
     *
     * @param {string} [model] - 模型名（覆盖构造时的 this.model）
     * @returns {number} 上下文窗口 token 数
     */
    getContextWindow(model) {
        if (this.contextWindow) return this.contextWindow;
        const m = model || this.model;
        if (m && MODEL_CONTEXT_WINDOWS[m]) return MODEL_CONTEXT_WINDOWS[m];
        return DEFAULT_CONTEXT_WINDOW;
    }

    /**
     * 获取压缩触发阈值（token 数）
     * = 上下文窗口 × 压缩阈值比例
     *
     * @param {string} [model] - 模型名
     * @returns {number} 触发压缩的 token 数阈值
     */
    getCompressionThreshold(model) {
        const window = this.getContextWindow(model);
        return Math.floor(window * this.compressionThreshold);
    }

    /**
     * 获取可用于输入的 token 预算
     * = 上下文窗口 - 预留输出 token
     *
     * @param {string} [model] - 模型名
     * @returns {number} 输入 token 预算
     */
    getInputBudget(model) {
        return Math.max(0, this.getContextWindow(model) - this.reservedTokens);
    }

    /**
     * 估算消息列表的总 token 数
     *
     * @param {Array} messages - 消息数组
     * @returns {number} 总 token 估算值
     */
    estimateTotalTokens(messages) {
        return estimateMessagesTokens(messages);
    }

    /**
     * 判断当前消息列表是否达到压缩阈值
     *
     * @param {Array} messages - 消息数组
     * @param {string} [model] - 模型名
     * @returns {boolean} true=需要压缩
     */
    shouldCompress(messages, model) {
        const total = this.estimateTotalTokens(messages);
        const threshold = this.getCompressionThreshold(model);
        return total >= threshold;
    }

    /**
     * 获取完整的预算信息（用于调试与可观测性）
     *
     * @param {Array} messages - 消息数组
     * @param {string} [model] - 模型名
     * @returns {Object} 预算详情
     */
    getBudgetInfo(messages, model) {
        const contextWindow = this.getContextWindow(model);
        const total = this.estimateTotalTokens(messages);
        const threshold = this.getCompressionThreshold(model);
        const inputBudget = this.getInputBudget(model);
        return {
            model: model || this.model,
            contextWindow,
            totalTokens: total,
            threshold,
            thresholdRatio: this.compressionThreshold,
            reservedTokens: this.reservedTokens,
            inputBudget,
            remainingBudget: Math.max(0, inputBudget - total),
            shouldCompress: total >= threshold,
            // 上下文窗口利用率（百分比）
            utilization: contextWindow > 0 ? Math.round((total / contextWindow) * 100) : 0
        };
    }
}


// ===== 上下文压缩器 =====

/**
 * ContextCompressor - 上下文压缩器
 *
 * 压缩策略：
 *   1. 保留最近 N 条消息（keepRecent，默认 4）作为当前上下文。
 *   2. 将更早的消息用 LLM 摘要压缩为一条 system 消息，置于消息列表首位。
 *   3. 无 API Key 或 LLM 调用失败时，降级为简单截断：保留首条消息 + 最近 N 条，
 *      删除中间消息（保留首尾，删除中间）。
 *
 * 注意：压缩时会保证 tool_calls 与对应 tool 结果消息不被拆散，
 *       避免 OpenAI 格式下出现孤立的 tool 消息导致 API 报错。
 */
class ContextCompressor {
    /**
     * @param {Object} options
     * @param {number} [options.keepRecent=4] - 保留的最近消息条数
     * @param {number} [options.maxTokens=1000] - 摘要生成的最大 token 数
     * @param {string} [options.model='qwen-turbo'] - 摘要使用的模型
     * @param {string|number} [options.userId] - 用户 ID（透传给 AIService 用于可观测性）
     */
    constructor(options = {}) {
        this.keepRecent = options.keepRecent != null ? options.keepRecent : DEFAULT_KEEP_RECENT;
        this.maxTokens = options.maxTokens || 1000;
        this.model = options.model || 'qwen-turbo';
        this.userId = options.userId || null;
    }

    /**
     * 执行上下文压缩
     *
     * @param {Array} messages - 原始消息列表
     * @returns {Object} { messages, summary, compressed, method }
     *   - messages: 压缩后的消息列表
     *   - summary: 摘要文本（截断降级时为提示信息，无压缩时为 null）
     *   - compressed: 是否执行了压缩
     *   - method: 压缩方式 'llm_summary' | 'truncation' | 'truncation_fallback' | null
     */
    async compress(messages) {
        // 边界情况：消息不足，无需压缩
        if (!Array.isArray(messages) || messages.length <= this.keepRecent) {
            return {
                messages: [...(messages || [])],
                summary: null,
                compressed: false,
                method: null
            };
        }

        // 计算保留区起始索引（同时保证 tool_calls 关联完整性）
        const keepStartIndex = this._computeKeepStartIndex(messages, this.keepRecent);

        // 没有可压缩的前置消息，直接返回
        if (keepStartIndex <= 0) {
            return {
                messages: [...messages],
                summary: null,
                compressed: false,
                method: null
            };
        }

        const toKeep = messages.slice(keepStartIndex);     // 保留的最近 N 条
        const toSummarize = messages.slice(0, keepStartIndex); // 待压缩的历史消息

        // 检测是否有可用的 AI API
        const provider = getActiveProvider();

        // ---------- 无 API Key：降级到截断策略 ----------
        if (provider === AIProvider.LOCAL) {
            return this._truncateFallback(messages, toKeep, keepStartIndex, '无 API Key');
        }

        // ---------- 有 API Key：使用 LLM 摘要 ----------
        try {
            const summary = await this._summarizeWithLLM(toSummarize);
            // 压缩后第一条为 system 消息，包含历史摘要
            const summaryMessage = {
                role: 'system',
                content: `[对话历史摘要]\n${summary}`
            };
            return {
                messages: [summaryMessage, ...toKeep],
                summary,
                compressed: true,
                method: 'llm_summary'
            };
        } catch (err) {
            // LLM 摘要失败：降级到截断策略，异常不阻断主流程
            console.error('[ContextCompressor] LLM 摘要失败，降级到截断策略:', err.message);
            return this._truncateFallback(messages, toKeep, keepStartIndex, `摘要失败: ${err.message}`);
        }
    }

    /**
     * 调用 LLM 生成对话历史摘要
     *
     * @param {Array} toSummarize - 待摘要的历史消息
     * @returns {Promise<string>} 摘要文本
     * @throws {Error} AI 服务降级或返回空内容时抛出，由上层捕获降级
     */
    async _summarizeWithLLM(toSummarize) {
        const historyText = this._formatMessagesForSummary(toSummarize);
        const prompt = this._buildSummaryPrompt(historyText);

        const result = await chat(
            [
                {
                    role: 'system',
                    content: '你是一个对话历史压缩助手，擅长将长对话压缩为简洁摘要，保留关键信息。'
                },
                { role: 'user', content: prompt }
            ],
            {
                model: this.model,
                temperature: 0.3,        // 低温度保证摘要稳定收敛
                maxTokens: this.maxTokens,
                userId: this.userId,
                endpoint: '/context/compress'
            }
        );

        // AI 服务降级（无有效内容）时抛出，触发上层截断降级
        if (result.fallback || !result.content) {
            throw new Error('AI 服务返回降级或空内容');
        }

        return result.content;
    }

    /**
     * 构建摘要提示词
     * 引导 LLM 保留用户意图、工具调用及结果、重要结论、待办任务
     *
     * @param {string} historyText - 格式化后的对话历史文本
     * @returns {string} 完整提示词
     */
    _buildSummaryPrompt(historyText) {
        return `请将以下对话历史压缩为简洁摘要，保留以下关键信息：
1. 用户的核心意图和需求
2. 已调用的工具及其返回结果的关键信息
3. 已经得出的重要结论和决策
4. 未完成或待处理的任务

要求：
- 用简洁的中文输出
- 不超过 300 字
- 聚焦对后续对话有用的信息，忽略无关细节

对话历史：
---
${historyText}
---`;
    }

    /**
     * 将消息数组格式化为摘要输入文本
     * 把 role/content/tool_calls/tool_call_id 转为可读的行文本
     *
     * @param {Array} messages - 消息数组
     * @returns {string} 格式化后的文本
     */
    _formatMessagesForSummary(messages) {
        return messages.map(msg => {
            const role = msg.role || 'unknown';
            let text = `[${role}]`;

            if (msg.content) {
                text += ` ${msg.content}`;
            }

            // assistant 的工具调用决策
            if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                const calls = msg.tool_calls.map(tc => {
                    const name = tc.function && tc.function.name ? tc.function.name : 'unknown';
                    const args = tc.function && tc.function.arguments ? tc.function.arguments : '';
                    return `调用工具 ${name}(${args})`;
                }).join('; ');
                text += ` ${calls}`;
            }

            // tool 结果消息关联的调用 ID
            if (msg.tool_call_id) {
                text += ` (对应工具调用ID: ${msg.tool_call_id})`;
            }

            return text;
        }).join('\n');
    }

    /**
     * 截断降级策略：保留首条消息 + 最近 N 条，删除中间
     *
     * "保留首尾，删除中间"：
     *   - 首 = messages[0]（通常为初始用户意图或系统设定）
     *   - 尾 = toKeep（最近 N 条当前上下文）
     *   - 中间 = messages[1 .. keepStartIndex-1]（被丢弃）
     *
     * @param {Array} messages - 完整消息列表
     * @param {Array} toKeep - 保留的最近 N 条
     * @param {number} keepStartIndex - 保留区起始索引
     * @param {string} reason - 降级原因
     * @returns {Object} 压缩结果
     */
    _truncateFallback(messages, toKeep, keepStartIndex, reason) {
        const first = messages[0];
        // 被删除的中间消息数（首条保留，故 -1）
        const dropped = Math.max(0, keepStartIndex - 1);
        return {
            messages: [first, ...toKeep],
            summary: `[截断降级] ${reason}，已省略 ${dropped} 条中间消息`,
            compressed: true,
            method: 'truncation'
        };
    }

    /**
     * 计算保留区的安全起始索引
     *
     * 保证不切断 assistant(tool_calls) → tool(结果) 的关联：
     *   若保留区第一条是 tool 消息，则需向前回溯，把产生该 tool_call 的
     *   assistant 消息一并纳入保留区，避免出现孤立的 tool 消息导致 API 报错。
     *
     * @param {Array} messages - 消息列表
     * @param {number} keepRecent - 期望保留的最近消息条数
     * @returns {number} 调整后的起始索引
     */
    _computeKeepStartIndex(messages, keepRecent) {
        let start = Math.max(0, messages.length - keepRecent);
        if (start === 0) return 0;

        // 向前回溯循环，直到保留区第一条不再是孤立的 tool 消息
        let safety = messages.length; // 防御性循环上限
        while (start > 0 && safety-- > 0) {
            const firstKept = messages[start];
            if (firstKept && firstKept.role === 'tool' && firstKept.tool_call_id) {
                // 在保留区之前查找产生该 tool_call_id 的 assistant 消息
                let found = false;
                for (let j = start - 1; j >= 0; j--) {
                    const prev = messages[j];
                    if (
                        prev.role === 'assistant' &&
                        Array.isArray(prev.tool_calls) &&
                        prev.tool_calls.some(tc => tc && tc.id === firstKept.tool_call_id)
                    ) {
                        // 把该 assistant 消息纳入保留区
                        start = j;
                        found = true;
                        break;
                    }
                }
                // 找不到对应的 assistant，无法继续回溯
                if (!found) break;
            } else {
                // 保留区第一条不是 tool 消息，无需回溯
                break;
            }
        }
        return start;
    }
}


// ===== 统一上下文管理器 =====

/**
 * ContextManager - 统一上下文管理器
 *
 * 组合 TokenBudgetManager + ContextCompressor，对外提供统一接口。
 * 每个 Agent 实例可持有一个 ContextManager，在每步 think 前调用
 * checkAndCompress 自动维护上下文在 token 预算内。
 *
 * 典型用法：
 *   const cm = new ContextManager({ model: 'qwen-turbo', userId });
 *   const { messages, compressed } = await cm.checkAndCompress(this.messageList);
 *   if (compressed) this.messageList = messages;
 */
class ContextManager {
    /**
     * @param {Object} options
     * @param {number} [options.contextWindow] - 显式上下文窗口大小
     * @param {number} [options.compressionThreshold=0.4] - 压缩阈值比例
     * @param {number} [options.keepRecent=4] - 保留的最近消息条数
     * @param {number} [options.reservedTokens=1000] - 输出预留 token
     * @param {number} [options.maxTokens=1000] - 摘要生成最大 token
     * @param {string} [options.model] - 默认模型
     * @param {string|number} [options.userId] - 用户 ID
     */
    constructor(options = {}) {
        this.options = options;

        // 组合预算管理器
        this.budgetManager = new TokenBudgetManager({
            contextWindow: options.contextWindow,
            compressionThreshold: options.compressionThreshold,
            reservedTokens: options.reservedTokens,
            model: options.model
        });

        // 组合上下文压缩器
        this.compressor = new ContextCompressor({
            keepRecent: options.keepRecent,
            maxTokens: options.maxTokens,
            model: options.model,
            userId: options.userId
        });
    }

    /**
     * 检查并按需压缩消息列表
     *
     * 流程：
     *   1. 估算当前 messageList 的总 token 数
     *   2. 判断是否达到压缩阈值
     *   3. 达到则执行压缩，返回压缩后的消息与前后 token 对比
     *   4. 未达到则原样返回
     *
     * 异常安全：压缩过程中任何异常都不阻断主流程，失败时返回原始消息。
     *
     * @param {Array} messageList - 当前消息列表
     * @param {Object} [options] - 本次调用的覆盖选项
     * @param {string} [options.model] - 覆盖模型
     * @returns {Promise<Object>}
     *   压缩时：{ compressed: true, messages, summary, method, tokensBefore, tokensAfter, budgetInfo }
     *   未压缩：{ compressed: false, messages, tokensBefore, budgetInfo }
     */
    async checkAndCompress(messageList, options = {}) {
        const model = options.model || this.options.model;
        const messages = Array.isArray(messageList) ? messageList : [];

        // 计算压缩前的 token 估算
        const tokensBefore = this.budgetManager.estimateTotalTokens(messages);

        // 判断是否达到压缩阈值
        const shouldCompress = this.budgetManager.shouldCompress(messages, model);

        if (!shouldCompress) {
            // 未达到阈值，原样返回
            return {
                compressed: false,
                messages,
                tokensBefore,
                budgetInfo: this.budgetManager.getBudgetInfo(messages, model)
            };
        }

        // 达到阈值，执行压缩（异常安全）
        try {
            const result = await this.compressor.compress(messages);
            const tokensAfter = this.budgetManager.estimateTotalTokens(result.messages);

            return {
                compressed: result.compressed,
                messages: result.messages,
                summary: result.summary,
                method: result.method,
                tokensBefore,
                tokensAfter,
                budgetInfo: this.budgetManager.getBudgetInfo(result.messages, model)
            };
        } catch (err) {
            // 压缩失败：返回原始消息，不阻断主流程
            console.error('[ContextManager] 压缩失败，返回原始消息:', err.message);
            return {
                compressed: false,
                messages,
                tokensBefore,
                error: err.message,
                budgetInfo: this.budgetManager.getBudgetInfo(messages, model)
            };
        }
    }

    /**
     * 获取消息列表的 token 统计详情
     * 返回每条消息的 token 估算及总计，用于调试与可观测性展示
     *
     * @param {Array} messageList - 消息列表
     * @returns {Object} { totalTokens, messageCount, messages: [{ index, role, tokens, contentPreview }] }
     */
    getTokenStats(messageList) {
        const messages = (messageList || []).map((msg, index) => ({
            index,
            role: msg ? msg.role || 'unknown' : 'unknown',
            tokens: estimateMessageTokens(msg),
            // 内容预览（前 50 字符），便于人工核查
            contentPreview: msg && msg.content ? String(msg.content).substring(0, 50) : '',
            hasToolCalls: !!(msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0),
            hasToolCallId: !!(msg && msg.tool_call_id)
        }));

        const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0);

        return {
            totalTokens,
            messageCount: messages.length,
            messages
        };
    }

    /**
     * 获取预算信息（透传 TokenBudgetManager.getBudgetInfo）
     *
     * @param {Array} messageList - 消息列表
     * @param {string} [model] - 模型名
     * @returns {Object} 预算详情
     */
    getBudgetInfo(messageList, model) {
        return this.budgetManager.getBudgetInfo(messageList, model);
    }
}


// ===== 模块导出 =====

module.exports = {
    ContextManager,
    TokenBudgetManager,
    ContextCompressor,
    estimateMessageTokens,
    estimateMessagesTokens,
    // 附带模型上下文窗口配置表，便于外部查阅或扩展
    MODEL_CONTEXT_WINDOWS
};
