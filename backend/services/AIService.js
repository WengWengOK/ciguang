/**
 * 统一 AI 服务层
 * 消除各路由中重复的 DashScope/DeepSeek if-else 分支
 * 统一接入 AI 可观测性中间件
 *
 * 设计参考：yu-ai-agent 的 ChatClient 统一封装
 */

const axios = require('axios');
const { recordAICall, estimateTokens, wrapAICall } = require('../middleware/ai-observability');

// AI 供应商枚举
const AIProvider = {
    DASHSCOPE: 'dashscope',
    DEEPSEEK: 'deepseek',
    LOCAL: 'local'
};

/**
 * 获取当前可用的 AI 供应商
 */
function getActiveProvider() {
    if (process.env.DASHSCOPE_API_KEY) return AIProvider.DASHSCOPE;
    if (process.env.DEEPSEEK_API_KEY) return AIProvider.DEEPSEEK;
    return AIProvider.LOCAL;
}

/**
 * 统一 AI 聊天接口（非流式）
 * 自动选择供应商，自动记录可观测性指标
 *
 * @param {Array} messages - OpenAI 格式消息数组
 * @param {Object} options - { model, temperature, maxTokens, userId, endpoint }
 * @returns {Object} { content, usage, provider, fallback }
 */
async function chat(messages, options = {}) {
    const {
        model,
        temperature = 0.7,
        maxTokens = 800,
        userId = null,
        endpoint = '/api/ai/chat'
    } = options;

    const provider = getActiveProvider();

    if (provider === AIProvider.LOCAL) {
        return {
            content: null,
            provider: AIProvider.LOCAL,
            fallback: true,
            message: 'No AI API Key configured'
        };
    }

    return wrapAICall(async () => {
        if (provider === AIProvider.DASHSCOPE) {
            return await callDashScope(messages, { model: model || 'qwen-turbo', temperature, maxTokens });
        } else {
            return await callDeepSeek(messages, { model: model || 'deepseek-chat', temperature, maxTokens });
        }
    }, { endpoint, model: model || (provider === AIProvider.DASHSCOPE ? 'qwen-turbo' : 'deepseek-chat'), userId });
}

/**
 * 统一 AI 聊天接口（带工具定义，用于 Function Calling）
 *
 * @param {Array} messages - 消息数组
 * @param {Array} tools - 工具定义数组（OpenAI function calling 格式）
 * @param {Object} options - 选项
 * @returns {Object} { content, toolCalls, usage, provider }
 */
async function chatWithTools(messages, tools, options = {}) {
    const {
        model,
        temperature = 0.7,
        maxTokens = 800,
        userId = null,
        endpoint = '/api/agent/run'
    } = options;

    const provider = getActiveProvider();

    if (provider === AIProvider.LOCAL) {
        return {
            content: null,
            toolCalls: [],
            provider: AIProvider.LOCAL,
            fallback: true
        };
    }

    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    try {
        let response;

        if (provider === AIProvider.DASHSCOPE) {
            // DashScope 支持 OpenAI 兼容模式的 function calling
            response = await axios.post(
                'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                {
                    model: model || 'qwen-turbo',
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    tools: tools.map(t => ({
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters
                        }
                    })),
                    tool_choice: 'auto'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
        } else {
            // DeepSeek OpenAI 兼容 API
            response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: model || 'deepseek-chat',
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    tools: tools.map(t => ({
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters
                        }
                    })),
                    tool_choice: 'auto'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
        }

        const choice = response.data.choices[0];
        const message = choice.message;

        // 提取 token 用量
        if (response.data.usage) {
            inputTokens = response.data.usage.prompt_tokens || 0;
            outputTokens = response.data.usage.completion_tokens || 0;
        }

        const durationMs = Date.now() - startTime;
        if (inputTokens === 0) inputTokens = estimateTokens(messages.map(m => m.content || '').join(''));
        if (outputTokens === 0) outputTokens = estimateTokens(message.content || '');

        recordAICall({
            endpoint,
            model: model || (provider === AIProvider.DASHSCOPE ? 'qwen-turbo' : 'deepseek-chat'),
            inputTokens,
            outputTokens,
            durationMs,
            success: true,
            userId
        });

        return {
            content: message.content || '',
            toolCalls: message.tool_calls || [],
            finishReason: choice.finish_reason,
            usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
            provider
        };

    } catch (err) {
        const durationMs = Date.now() - startTime;
        recordAICall({
            endpoint,
            model: model || (provider === AIProvider.DASHSCOPE ? 'qwen-turbo' : 'deepseek-chat'),
            inputTokens: 0,
            outputTokens: 0,
            durationMs,
            success: false,
            userId,
            error: err.message
        });
        throw err;
    }
}

/**
 * 调用 DashScope（通义千问）
 */
async function callDashScope(messages, options) {
    const { model, temperature, maxTokens } = options;
    const startTime = Date.now();

    const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        {
            model,
            input: { messages },
            parameters: {
                result_format: 'message',
                temperature,
                max_tokens: maxTokens
            }
        },
        {
            headers: {
                'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        }
    );

    const content = response.data.output?.choices?.[0]?.message?.content || '';
    const usage = response.data.usage || {};

    return {
        content,
        provider: AIProvider.DASHSCOPE,
        usage: {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0
        }
    };
}

/**
 * 调用 DeepSeek API
 */
async function callDeepSeek(messages, options) {
    const { model, temperature, maxTokens } = options;

    const response = await axios.post(
        process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
        {
            model,
            messages,
            temperature,
            max_tokens: maxTokens
        },
        {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        }
    );

    const content = response.data.choices?.[0]?.message?.content || '';
    const usage = response.data.usage || {};

    return {
        content,
        provider: AIProvider.DEEPSEEK,
        usage: {
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0
        }
    };
}

/**
 * 统一 JSON 提取（消除各路由中重复的正则提取逻辑）
 */
function extractJSON(text) {
    if (!text) return null;

    // 尝试直接解析
    try {
        return JSON.parse(text);
    } catch (e) { /* 继续 */ }

    // 尝试从 markdown 代码块中提取
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch (e) { /* 继续 */ }
    }

    // 尝试从文本中提取 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        let jsonStr = jsonMatch[0];
        // 清理常见的 JSON 格式问题
        jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            // 尝试修复未转义的换行
            try {
                jsonStr = jsonStr.replace(/\n/g, '\\n');
                return JSON.parse(jsonStr);
            } catch (e2) { /* 放弃 */ }
        }
    }

    return null;
}

module.exports = {
    AIProvider,
    getActiveProvider,
    chat,
    chatWithTools,
    extractJSON
};
