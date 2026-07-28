/**
 * SSE 流式输出工具
 * 支持 DeepSeek 和 DashScope（通义千问）两种 API 的流式调用
 */

const axios = require('axios');
const { estimateTokens, recordAICall } = require('../middleware/ai-observability');

/**
 * 调用 DeepSeek 流式 API 并逐块通过 SSE 发送给客户端
 *
 * @param {Object} res - Express response 对象
 * @param {Array} messages - 对话消息数组 [{role, content}]
 * @param {Object} options - { model, temperature, maxTokens, userId, endpoint }
 */
async function streamDeepSeek(res, messages, options = {}) {
    const {
        model = 'deepseek-chat',
        temperature = 0.7,
        maxTokens = 800,
        userId,
        endpoint = '/api/agent/stream'
    } = options;

    const startTime = Date.now();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
        const response = await axios.post(
            process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
            {
                model,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: true
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 60000
            }
        );

        // 解析 SSE 流
        const { processSSEStream } = require('./sse-parser');

        await processSSEStream(response.data, (chunk) => {
            if (chunk.choices && chunk.choices[0]?.delta?.content) {
                const text = chunk.choices[0].delta.content;
                fullContent += text;

                // 发送 SSE 事件
                res.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`);
            }

            // 提取 usage 信息（部分 API 在最后一块返回）
            if (chunk.usage) {
                inputTokens = chunk.usage.prompt_tokens || 0;
                outputTokens = chunk.usage.completion_tokens || 0;
            }
        });

        const durationMs = Date.now() - startTime;
        if (inputTokens === 0) inputTokens = estimateTokens(messages.map(m => m.content || '').join(''));
        if (outputTokens === 0) outputTokens = estimateTokens(fullContent);

        recordAICall({
            endpoint,
            model,
            inputTokens,
            outputTokens,
            durationMs,
            success: true,
            userId
        });

        // 发送完成事件
        res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
        res.end();

    } catch (err) {
        const durationMs = Date.now() - startTime;
        recordAICall({
            endpoint,
            model,
            inputTokens: 0,
            outputTokens: 0,
            durationMs,
            success: false,
            userId,
            error: err.message
        });

        // 发送错误事件
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
    }
}

/**
 * 调用 DashScope 流式 API 并逐块通过 SSE 发送给客户端
 */
async function streamDashScope(res, messages, options = {}) {
    const {
        model = 'qwen-turbo',
        temperature = 0.7,
        maxTokens = 800,
        userId,
        endpoint = '/api/agent/stream'
    } = options;

    const startTime = Date.now();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
        const response = await axios.post(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
            {
                model,
                input: { messages },
                parameters: {
                    result_format: 'message',
                    temperature,
                    max_tokens: maxTokens,
                    incremental_output: true
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                    'Content-Type': 'application/json',
                    'X-DashScope-SSE': 'enable'
                },
                responseType: 'stream',
                timeout: 60000
            }
        );

        const { processSSEStream } = require('./sse-parser');

        await processSSEStream(response.data, (chunk) => {
            // DashScope 流式返回格式
            if (chunk.output?.choices?.[0]?.message?.content) {
                const text = chunk.output.choices[0].message.content;
                fullContent += text;
                res.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`);
            }

            if (chunk.usage) {
                inputTokens = chunk.usage.input_tokens || 0;
                outputTokens = chunk.usage.output_tokens || 0;
            }
        });

        const durationMs = Date.now() - startTime;
        if (inputTokens === 0) inputTokens = estimateTokens(messages.map(m => m.content || '').join(''));
        if (outputTokens === 0) outputTokens = estimateTokens(fullContent);

        recordAICall({
            endpoint,
            model,
            inputTokens,
            outputTokens,
            durationMs,
            success: true,
            userId
        });

        res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
        res.end();

    } catch (err) {
        const durationMs = Date.now() - startTime;
        recordAICall({
            endpoint,
            model,
            inputTokens: 0,
            outputTokens: 0,
            durationMs,
            success: false,
            userId,
            error: err.message
        });

        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
    }
}

/**
 * 统一流式调用入口
 * 根据配置的 API Key 自动选择 DeepSeek 或 DashScope
 */
async function streamChat(res, messages, options = {}) {
    if (process.env.DASHSCOPE_API_KEY) {
        return streamDashScope(res, messages, options);
    } else if (process.env.DEEPSEEK_API_KEY) {
        return streamDeepSeek(res, messages, options);
    } else {
        // 无 API Key，无法流式
        throw new Error('未配置 AI API Key');
    }
}

/**
 * 设置 SSE 响应头
 */
function setupSSEResponse(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
}

module.exports = {
    streamDeepSeek,
    streamDashScope,
    streamChat,
    setupSSEResponse
};
