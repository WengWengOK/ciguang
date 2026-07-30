/**
 * PlanExecuteAgent 路由 - Plan-and-Execute 任务分解智能体接口
 *
 * 提供 Plan-and-Execute 模式的 AI 智能体对话：
 * - POST /run: 同步执行（复杂任务自动分解为子任务，逐步执行）
 * - POST /run-stream: SSE 流式执行（逐步推送 plan/execute/revise 过程）
 *
 * L 层增强：解决仅有单 Agent 单链 ReAct、无任务分解的短板
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { PlanExecuteAgent } = require('../agent/PlanExecuteAgent');
const { getAllTools } = require('../tools/EnhancedToolRegistry');
const { setupSSEResponse } = require('../utils/sse-stream');

const router = express.Router();

// Agent 限流：每分钟最多 3 次（Plan-Execute 开销大于普通 Agent）
const planRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { success: false, message: 'Plan-Execute 调用过于频繁，请稍后再试' }
});

/**
 * POST /run
 * 同步执行 Plan-Execute 智能体
 *
 * 请求体：
 *   { message: string }
 *
 * 响应：
 *   {
 *     success: boolean,
 *     data: {
 *       reply: string,
 *       plan: Array,           // 子任务计划
 *       executionTrace: Array,  // 执行轨迹
 *       totalSteps: number,
 *       sessionId: string,
 *       traceId: string
 *     }
 *   }
 */
router.post('/run', authMiddleware, planRateLimit, async (req, res) => {
    try {
        const { message, sessionId: clientSessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在1000字以内' });
        }

        const sessionId = clientSessionId || `planExecute_${req.userId}_${Date.now()}`;

        // 创建 PlanExecuteAgent 实例
        const agent = new PlanExecuteAgent({
            userId: req.userId,
            tools: getAllTools()
        });

        // 执行 Plan-Execute 循环
        const results = await agent.run(message, {
            sessionId,
            timeoutMs: 180000,    // 整体超时 180s（Plan-Execute 比普通 Agent 耗时长）
            stepTimeoutMs: 30000
        });

        const finalReply = agent.getFinalResponse();

        // 获取执行轨迹摘要
        let traceSummary = null;
        if (agent.tracer) {
            traceSummary = agent.tracer.getTraceSummary();
        }

        res.json({
            success: true,
            data: {
                reply: finalReply,
                plan: agent.taskPlan,
                executionTrace: agent.executionTrace,
                totalSteps: agent.currentStep,
                sessionId,
                traceId: agent.traceId,
                state: agent.state,
                traceSummary
            }
        });

    } catch (err) {
        console.error('PlanExecuteAgent 执行失败:', err.message);
        const isTimeout = err.message.includes('超时') || err.message.includes('timeout');
        res.status(isTimeout ? 504 : 500).json({
            success: false,
            message: isTimeout ? 'Plan-Execute 执行超时，请缩短问题或稍后重试' : 'Plan-Execute 执行失败: ' + err.message
        });
    }
});

/**
 * POST /run-stream
 * SSE 流式执行 Plan-Execute 智能体
 * 逐步推送 plan/execute/revise/done 过程
 *
 * SSE 事件类型：
 *   { type: 'plan', subtasks: Array }
 *   { type: 'execute_start', subtask: Object }
 *   { type: 'execute_result', subtask: Object, result: string }
 *   { type: 'revise', reason: string, revisedPlan: Array }
 *   { type: 'answer', content: string }
 *   { type: 'done', totalSteps: number, reply: string }
 */
router.post('/run-stream', authMiddleware, planRateLimit, async (req, res) => {
    try {
        const { message, sessionId: clientSessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在1000字以内' });
        }

        const sessionId = clientSessionId || `planExecute_stream_${req.userId}_${Date.now()}`;

        setupSSEResponse(res);

        res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);

        const agent = new PlanExecuteAgent({
            userId: req.userId,
            tools: getAllTools()
        });

        // 流式执行
        await agent.runStream(message, (event) => {
            const { step, result, state } = event;

            res.write(`data: ${JSON.stringify({
                type: 'step',
                step,
                result: result.substring(0, 500),
                traceId: agent.traceId
            })}\n\n`);

            // 推送计划信息
            if (agent.taskPlan && agent.taskPlan.length > 0 && step === 1) {
                res.write(`data: ${JSON.stringify({
                    type: 'plan',
                    subtasks: agent.taskPlan.map(s => ({
                        id: s.id,
                        description: s.description,
                        tools: s.tools,
                        status: s.status
                    }))
                })}\n\n`);
            }

            if (event.terminated) {
                res.write(`data: ${JSON.stringify({
                    type: 'terminated',
                    step,
                    message: '达到最大步数或任务完成',
                    timeout: event.timeout || false
                })}\n\n`);
            }
        }, {
            sessionId,
            timeoutMs: 180000,
            stepTimeoutMs: 30000
        });

        const finalReply = agent.getFinalResponse();
        res.write(`data: ${JSON.stringify({
            type: 'answer',
            content: finalReply,
            traceId: agent.traceId
        })}\n\n`);

        let traceSummary = null;
        if (agent.tracer) {
            traceSummary = agent.tracer.getTraceSummary();
        }

        res.write(`data: ${JSON.stringify({
            type: 'done',
            totalSteps: agent.currentStep,
            reply: finalReply,
            plan: agent.taskPlan,
            executionTrace: agent.executionTrace,
            sessionId,
            traceId: agent.traceId,
            state: agent.state,
            traceSummary
        })}\n\n`);

        res.end();

    } catch (err) {
        console.error('PlanExecuteAgent 流式执行失败:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Plan-Execute 执行失败' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
    }
});

module.exports = router;
