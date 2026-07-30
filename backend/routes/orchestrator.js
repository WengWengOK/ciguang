/**
 * MultiAgentOrchestrator 路由 - 多 Agent 编排接口
 *
 * 提供 Multi-Agent 模式的 AI 智能体对话：
 * - POST /run: 同步执行（自动路由到最合适的 Agent，支持并行执行）
 * - GET /agents: 获取已注册的 Agent 列表
 * - POST /delegate: 手动委派任务给指定 Agent
 *
 * L 层增强：解决仅有单 Agent、无多 Agent 协作的短板
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { MultiAgentOrchestrator } = require('../agent/MultiAgentOrchestrator');
const { StudyAgent } = require('../agent/StudyAgent');
const { getAllTools } = require('../tools/EnhancedToolRegistry');

const router = express.Router();

// Agent 限流
const orchestratorRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { success: false, message: '多 Agent 编排调用过于频繁，请稍后再试' }
});

/**
 * 创建并配置 MultiAgentOrchestrator 实例
 * 注册 studyAgent 和 errorAgent 两个默认 Agent
 */
function createOrchestrator(userId) {
    const orchestrator = new MultiAgentOrchestrator({ userId });

    // 注册学习导师 Agent
    orchestrator.registerAgent(
        'studyAgent',
        () => new StudyAgent({ userId }),
        ['学习规划', '单词查询', '复习建议', '学情分析', '练习生成'],
        '考研英语学习导师，擅长学情分析和学习计划制定'
    );

    // 注册错题分析 Agent（复用 StudyAgent，配置不同的提示词）
    orchestrator.registerAgent(
        'errorAgent',
        () => new StudyAgent({ userId, name: 'errorAgent' }),
        ['错题分析', '薄弱环节诊断', '错题归因', '变体题推荐'],
        '错题分析专家，擅长分析错误原因和推荐针对性练习'
    );

    return orchestrator;
}

/**
 * POST /run
 * 多 Agent 编排同步执行
 *
 * 请求体：
 *   { message: string }
 *
 * 响应：
 *   {
 *     success: boolean,
 *     data: {
 *       reply: string,
 *       routedAgent: string,
 *       confidence: number,
 *       results: Array,
 *       traceId: string
 *     }
 *   }
 */
router.post('/run', authMiddleware, orchestratorRateLimit, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在1000字以内' });
        }

        const orchestrator = createOrchestrator(req.userId);

        // 执行多 Agent 编排（execute = routeTask + delegate）
        const result = await orchestrator.execute(message, {
            timeoutMs: 180000,
            stepTimeoutMs: 30000
        });

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.error('MultiAgentOrchestrator 执行失败:', err.message);
        const isTimeout = err.message.includes('超时') || err.message.includes('timeout');
        res.status(isTimeout ? 504 : 500).json({
            success: false,
            message: isTimeout ? '多 Agent 编排执行超时' : '多 Agent 编排执行失败: ' + err.message
        });
    }
});

/**
 * GET /agents
 * 获取已注册的 Agent 列表
 */
router.get('/agents', authMiddleware, (req, res) => {
    const orchestrator = createOrchestrator(req.userId);
    const agents = [];

    for (const [name, config] of orchestrator.agents) {
        agents.push({
            name,
            capabilities: config.capabilities,
            description: config.description
        });
    }

    res.json({
        success: true,
        data: agents
    });
});

/**
 * POST /delegate
 * 手动委派任务给指定 Agent
 *
 * 请求体：
 *   { agentName: string, task: string }
 */
router.post('/delegate', authMiddleware, orchestratorRateLimit, async (req, res) => {
    try {
        const { agentName, task } = req.body;

        if (!agentName || !task) {
            return res.status(400).json({ success: false, message: '请提供 agentName 和 task' });
        }

        const orchestrator = createOrchestrator(req.userId);

        // 检查 Agent 是否存在
        if (!orchestrator.agents.has(agentName)) {
            return res.status(404).json({
                success: false,
                message: `Agent "${agentName}" 未注册`,
                available: Array.from(orchestrator.agents.keys())
            });
        }

        const result = await orchestrator.delegate(agentName, task, {
            timeoutMs: 120000
        });

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.error('Agent 委派失败:', err.message);
        res.status(500).json({
            success: false,
            message: 'Agent 委派失败: ' + err.message
        });
    }
});

module.exports = router;
