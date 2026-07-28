/**
 * SSE 流式输出路由
 * 提供 AI 对话的流式响应，前端可逐字渲染
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../middleware/auth');
const { streamChat, setupSSEResponse } = require('../utils/sse-stream');
const { getMetricsSummary } = require('../middleware/ai-observability');
const { get, all } = require('../database/db');

const router = express.Router();

// 所有接口都需要登录认证
router.use(authMiddleware);

// 流式接口限流：每分钟10次
const streamRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});

/**
 * POST /api/stream/tutor
 * AI 学习导师 - 流式对话
 * 返回 SSE 流，前端逐字渲染
 */
router.post('/tutor', streamRateLimit, async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 500) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在500字以内' });
        }

        const sid = sessionId || `tutor_stream_${req.userId}_${Date.now()}`;

        // 获取或创建会话历史
        if (!global.tutorSessions) {
            global.tutorSessions = new Map();
        }
        let history = global.tutorSessions.get(sid) || [];

        // 检查是否有 API Key
        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: '未配置 AI API Key，无法使用流式对话',
                fallback: true
            });
        }

        // 获取用户学情上下文（复用 tutor.js 的逻辑）
        let systemPrompt = '你是"词光"考研英语学习导师，擅长帮助考研学生备考英语。';
        try {
            const profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId]);
            if (profile) {
                systemPrompt += `\n## 用户学情画像\n词汇：${profile.vocabulary_score}/100，语法：${profile.grammar_score}/100，阅读：${profile.reading_score}/100，翻译：${profile.translation_score}/100，写作：${profile.writing_score}/100`;
            }

            // 获取薄弱知识点
            const weakPoints = await all(
                'SELECT dimension, skill_point, accuracy, attempts FROM user_skill_points WHERE user_id = ? AND accuracy < 60 ORDER BY accuracy ASC LIMIT 5',
                [req.userId]
            );
            if (weakPoints.length > 0) {
                systemPrompt += '\n## 薄弱知识点\n';
                weakPoints.forEach(wp => {
                    systemPrompt += `- ${wp.dimension}：${wp.skill_point}（正确率${wp.accuracy}%）\n`;
                });
            }
        } catch (e) {
            console.log('获取学情上下文失败:', e.message);
        }

        // 构建对话消息
        const messages = [{ role: 'system', content: systemPrompt }];
        const recentHistory = history.slice(-20);
        recentHistory.forEach(msg => messages.push({ role: msg.role, content: msg.content }));
        messages.push({ role: 'user', content: message });

        // 设置 SSE 响应头
        setupSSEResponse(res);

        // 发送会话 ID
        res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sid })}\n\n`);

        // 流式调用 AI
        let fullContent = '';
        await streamChat(res, messages, {
            model: process.env.DASHSCOPE_API_KEY ? 'qwen-turbo' : 'deepseek-chat',
            temperature: 0.7,
            maxTokens: 800,
            userId: req.userId,
            endpoint: '/api/stream/tutor'
        });

        // 保存会话历史（流式调用已结束，需要从最后的 done 事件获取完整内容）
        // 注意：streamChat 内部会发送 done 事件，这里更新历史
        // 由于流式响应已经结束，我们通过 hook 获取完整内容

    } catch (err) {
        console.error('流式导师对话失败:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: '服务暂时不可用' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '生成失败' })}\n\n`);
            res.end();
        }
    }
});

/**
 * POST /api/stream/error-agent
 * 错题分析 Agent - 流式对话
 */
router.post('/error-agent', streamRateLimit, async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 500) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在500字以内' });
        }

        const sid = sessionId || `error_stream_${req.userId}_${Date.now()}`;

        // 获取会话历史
        if (!global.errorAgentSessions) {
            global.errorAgentSessions = new Map();
        }
        let history = global.errorAgentSessions.get(sid) || [];

        // 检查是否有 API Key
        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: '未配置 AI API Key，无法使用流式对话',
                fallback: true
            });
        }

        // 获取错题上下文
        let systemPrompt = '你是"词光"错题分析助手，专门帮助学生分析英语错题、诊断薄弱知识点、生成针对性练习题。';
        try {
            const totalErrors = await get('SELECT COUNT(*) as count FROM practice_records WHERE user_id = ? AND is_correct = 0', [req.userId]);
            if (totalErrors && totalErrors.count > 0) {
                systemPrompt += `\n\n## 用户错题统计\n总错题数：${totalErrors.count}`;
            }

            // 获取高频错词
            const topWrongWords = await all(
                `SELECT w.word, w.meaning, COUNT(*) as error_count
                 FROM practice_records pr
                 JOIN words w ON pr.word_id = w.id
                 WHERE pr.user_id = ? AND pr.is_correct = 0
                 GROUP BY w.id ORDER BY error_count DESC LIMIT 5`,
                [req.userId]
            );
            if (topWrongWords.length > 0) {
                systemPrompt += '\n## 高频错词\n';
                topWrongWords.forEach(w => {
                    systemPrompt += `- ${w.word}（${w.meaning}）出错${w.error_count}次\n`;
                });
            }
        } catch (e) {
            console.log('获取错题上下文失败:', e.message);
        }

        // 构建对话消息
        const messages = [{ role: 'system', content: systemPrompt }];
        const recentHistory = history.slice(-20);
        recentHistory.forEach(msg => messages.push({ role: msg.role, content: msg.content }));
        messages.push({ role: 'user', content: message });

        // 设置 SSE 响应头
        setupSSEResponse(res);

        // 发送会话 ID
        res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sid })}\n\n`);

        // 流式调用 AI
        await streamChat(res, messages, {
            model: process.env.DASHSCOPE_API_KEY ? 'qwen-turbo' : 'deepseek-chat',
            temperature: 0.7,
            maxTokens: 1000,
            userId: req.userId,
            endpoint: '/api/stream/error-agent'
        });

    } catch (err) {
        console.error('流式错题Agent对话失败:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: '服务暂时不可用' });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '生成失败' })}\n\n`);
            res.end();
        }
    }
});

/**
 * GET /api/stream/metrics
 * 获取 AI 调用可观测性数据
 */
router.get('/metrics', (req, res) => {
    const summary = getMetricsSummary();
    res.json({
        success: true,
        data: summary
    });
});

module.exports = router;
