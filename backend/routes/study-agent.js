/**
 * StudyAgent 路由 - ReAct 智能体接口
 *
 * 提供 ReAct 模式的 AI 智能体对话：
 * - POST /run: 同步执行（返回完整推理过程 + 最终答案）
 * - POST /run-stream: SSE 流式执行（逐步推送 think/act 过程）
 * - GET /tools: 获取可用工具列表
 *
 * 设计参考：yu-ai-agent 的 AiController
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { StudyAgent } = require('../agent/StudyAgent');
const { getAllTools, getToolDefinitions } = require('../tools/ToolRegistry');
const { setupSSEResponse } = require('../utils/sse-stream');

const router = express.Router();

// 工具列表接口公开（用于文档展示）
// /run 和 /run-stream 需要登录认证（在各自路由中单独添加）

// Agent 限流：每分钟最多 5 次（Agent 执行开销大）
const agentRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: '智能体调用过于频繁，请稍后再试' }
});

/**
 * POST /run
 * 同步执行 ReAct 智能体
 *
 * 请求体：
 *   { message: string }
 *
 * 响应：
 *   {
 *     success: boolean,
 *     data: {
 *       reply: string,           // 最终回复
 *       steps: Array,            // 推理步骤记录
 *       toolCalls: Array,        // 工具调用记录
 *       totalSteps: number,      // 总步数
 *       sessionId: string
 *     }
 *   }
 */
router.post('/run', authMiddleware, agentRateLimit, async (req, res) => {
    try {
        const { message, sessionId: clientSessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在1000字以内' });
        }

        // 支持客户端传入 sessionId 实现跨请求会话连续
        // 未提供则生成新 sessionId（首次对话）
        const sessionId = clientSessionId || `studyAgent_${req.userId}_${Date.now()}`;

        // 创建智能体实例（每请求独立实例，避免 messageList 串话）
        const agent = new StudyAgent({ userId: req.userId });

        // 执行 ReAct 循环（带超时控制 + SessionStore 持久化）
        // timeoutMs: 整体超时 120s（适配 Serverless 函数限制）
        // stepTimeoutMs: 单步超时 30s（适配单次 LLM 调用）
        const results = await agent.run(message, {
            sessionId,
            timeoutMs: 120000,
            stepTimeoutMs: 30000
        });

        // 提取工具调用记录
        const toolCallLog = [];
        results.forEach((result, i) => {
            if (result.includes('工具 ') && result.includes('返回的结果')) {
                const toolMatch = result.match(/工具 (\S+) 返回的结果/);
                if (toolMatch) {
                    toolCallLog.push({
                        step: i + 1,
                        tool: toolMatch[1],
                        result: result
                    });
                }
            }
        });

        // 获取最终回复
        const finalReply = agent.getFinalResponse();

        res.json({
            success: true,
            data: {
                reply: finalReply,
                steps: results,
                toolCalls: toolCallLog,
                totalSteps: agent.currentStep,
                sessionId,
                traceId: agent.traceId,
                state: agent.state
            }
        });

    } catch (err) {
        console.error('StudyAgent 执行失败:', err.message);
        // 超时错误返回 504 Gateway Timeout
        const isTimeout = err.message.includes('超时') || err.message.includes('timeout');
        res.status(isTimeout ? 504 : 500).json({
            success: false,
            message: isTimeout ? '智能体执行超时，请缩短问题或稍后重试' : '智能体执行失败: ' + err.message
        });
    }
});

/**
 * POST /run-stream
 * SSE 流式执行 ReAct 智能体
 * 逐步推送 think/act 过程
 *
 * SSE 事件类型：
 *   { type: 'step_start', step: number }
 *   { type: 'thinking', step: number, tools: [toolNames] }
 *   { type: 'tool_result', step: number, tool: name, result: string }
 *   { type: 'answer', content: string }
 *   { type: 'done', totalSteps: number, reply: string }
 *   { type: 'error', message: string }
 */
router.post('/run-stream', authMiddleware, agentRateLimit, async (req, res) => {
    try {
        const { message, sessionId: clientSessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在1000字以内' });
        }

        const sessionId = clientSessionId || `studyAgent_stream_${req.userId}_${Date.now()}`;

        // 设置 SSE 响应
        setupSSEResponse(res);

        // 发送会话 ID 和 traceId 预览
        res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);

        // 创建智能体实例
        const agent = new StudyAgent({ userId: req.userId });

        // 流式执行（带超时控制 + SessionStore 持久化）
        await agent.runStream(message, (event) => {
            const { step, result, state } = event;

            // 推送步骤开始
            res.write(`data: ${JSON.stringify({ type: 'step_start', step, traceId: agent.traceId })}\n\n`);

            // 解析并推送工具调用信息
            if (result.includes('工具 ') && result.includes('返回的结果')) {
                const toolMatches = result.matchAll(/工具 (\S+) 返回的结果：([\s\S]*?)(?=\n工具 |\n$|$)/g);
                for (const match of toolMatches) {
                    res.write(`data: ${JSON.stringify({
                        type: 'tool_result',
                        step,
                        tool: match[1],
                        result: match[2].substring(0, 200) // 截断长结果
                    })}\n\n`);
                }
            } else if (result.includes('思考完成')) {
                res.write(`data: ${JSON.stringify({
                    type: 'thinking',
                    step,
                    message: result
                })}\n\n`);
            } else if (result.includes('超时')) {
                // 推送超时事件
                res.write(`data: ${JSON.stringify({
                    type: 'timeout',
                    step,
                    message: result
                })}\n\n`);
            }

            // 如果是终止步骤
            if (event.terminated) {
                res.write(`data: ${JSON.stringify({
                    type: 'terminated',
                    step,
                    message: '达到最大步数，强制终止',
                    timeout: event.timeout || false
                })}\n\n`);
            }
        }, {
            sessionId,
            timeoutMs: 120000,
            stepTimeoutMs: 30000
        });

        // 推送最终答案
        const finalReply = agent.getFinalResponse();
        res.write(`data: ${JSON.stringify({
            type: 'answer',
            content: finalReply,
            traceId: agent.traceId
        })}\n\n`);

        // 推送完成事件
        res.write(`data: ${JSON.stringify({
            type: 'done',
            totalSteps: agent.currentStep,
            reply: finalReply,
            sessionId,
            traceId: agent.traceId,
            state: agent.state
        })}\n\n`);

        res.end();

    } catch (err) {
        console.error('StudyAgent 流式执行失败:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: '智能体执行失败' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
    }
});

/**
 * GET /tools
 * 获取智能体可用的工具列表
 */
router.get('/tools', (req, res) => {
    const tools = getAllTools();
    res.json({
        success: true,
        data: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }))
    });
});

module.exports = router;
