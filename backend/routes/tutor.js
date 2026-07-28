const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有导师接口都需要登录认证
router.use(authMiddleware);

// 导师接口限流：每分钟最多15次请求
const tutorRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { success: false, message: '提问过于频繁，请稍后再试' }
});

// 维度中文名称映射
const DIMENSION_LABELS = {
    vocabulary: '词汇量',
    grammar: '语法掌握',
    reading: '阅读理解',
    translation: '翻译能力',
    writing: '写作水平'
};

// 维度对应的练习页面
const DIMENSION_PAGES = {
    vocabulary: 'practice',
    grammar: 'cloze',
    reading: 'reading',
    translation: 'translation',
    writing: 'writing'
};

// ===== 获取用户学情上下文 =====
async function getUserContext(userId) {
    try {
        // 1. 获取能力画像
        let profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);

        if (!profile) {
            return {
                profileSummary: '新用户，暂无学情数据',
                weakPoints: [],
                recentErrors: []
            };
        }

        const dimensions = {
            vocabulary: profile.vocabulary_score,
            grammar: profile.grammar_score,
            reading: profile.reading_score,
            translation: profile.translation_score,
            writing: profile.writing_score
        };

        const overallScore = Math.round(
            (profile.vocabulary_score + profile.grammar_score +
             profile.reading_score + profile.translation_score +
             profile.writing_score) / 5
        );

        const accuracy = profile.total_answers > 0
            ? Math.round((profile.total_correct / profile.total_answers) * 100)
            : 0;

        // 构建画像摘要
        const dimStr = Object.entries(dimensions)
            .map(([k, v]) => `${DIMENSION_LABELS[k]}:${v}`)
            .join('，');

        const profileSummary = `综合得分${overallScore}，正确率${accuracy}%，总答题${profile.total_answers}题。各维度：${dimStr}`;

        // 2. 获取薄弱知识点
        const weakPoints = await all(`
            SELECT dimension, skill_point, total_attempts, correct_attempts, mastery_level
            FROM user_skill_points
            WHERE user_id = ? AND mastery_level < 2
            ORDER BY (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC
            LIMIT 5
        `, [userId]);

        const weakPointsFormatted = weakPoints.map(wp => ({
            dimension: DIMENSION_LABELS[wp.dimension] || wp.dimension,
            skillPoint: wp.skill_point,
            accuracy: wp.total_attempts > 0
                ? Math.round((wp.correct_attempts / wp.total_attempts) * 100)
                : 0,
            attempts: wp.total_attempts
        }));

        // 3. 获取近期错题记录
        const recentErrors = await all(`
            SELECT word, type, meaning, correct_answer, created_at
            FROM practice_records
            WHERE user_id = ? AND is_correct = 0
            ORDER BY created_at DESC
            LIMIT 5
        `, [userId]);

        const recentErrorsFormatted = recentErrors.map(e => ({
            word: e.word,
            type: e.type,
            meaning: e.meaning
        }));

        return {
            profileSummary,
            weakPoints: weakPointsFormatted,
            recentErrors: recentErrorsFormatted,
            overallScore,
            accuracy,
            dimensions
        };
    } catch (err) {
        console.error('获取学情上下文失败:', err.message);
        return {
            profileSummary: '学情数据获取失败',
            weakPoints: [],
            recentErrors: []
        };
    }
}

// ===== 导入 Prompt 模板管理器 =====
const promptManager = require('../prompts');

// ===== 构建 System Prompt（使用模板系统） =====
function buildSystemPrompt(context) {
    // 格式化薄弱知识点
    let weakPointsFormatted = '暂无薄弱知识点';
    if (context.weakPoints && context.weakPoints.length > 0) {
        weakPointsFormatted = context.weakPoints.map(wp =>
            `- ${wp.dimension}：${wp.skillPoint}（正确率${wp.accuracy}%，练习${wp.attempts}次）`
        ).join('\n');
    }

    // 格式化近期错题
    let recentErrorsFormatted = '暂无错题记录';
    if (context.recentErrors && context.recentErrors.length > 0) {
        recentErrorsFormatted = context.recentErrors.map(e =>
            `- ${e.word}（${e.type}）${e.meaning ? '：' + e.meaning : ''}`
        ).join('\n');
    }

    // 使用模板系统渲染（替代内联拼接）
    const rendered = promptManager.render('tutor', {
        profileSummary: context.profileSummary || '暂无学情数据',
        weakPointsFormatted,
        recentErrorsFormatted,
        message: '' // system prompt 不需要 user message
    });

    return rendered.system;
}

// ===== 导师对话接口 =====
router.post('/chat', tutorRateLimit, async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 500) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在500字以内' });
        }

        // 获取或创建会话ID
        const sid = sessionId || `tutor_${req.userId}_${Date.now()}`;

        // 获取用户学情上下文
        const context = await getUserContext(req.userId);

        // 获取会话历史（从内存中，最近10轮）
        // 使用全局会话存储（生产环境应使用Redis）
        if (!global.tutorSessions) {
            global.tutorSessions = new Map();
        }

        let history = global.tutorSessions.get(sid) || [];

        // 构建System Prompt
        const systemPrompt = buildSystemPrompt(context);

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        // 无API Key时使用本地规则回复
        if (!apiKey) {
            const localReply = generateLocalTutorReply(message, context);
            // 保存会话历史
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: localReply });
            if (history.length > 20) history = history.slice(-20);
            global.tutorSessions.set(sid, history);

            return res.json({
                success: true,
                data: {
                    reply: localReply,
                    sessionId: sid,
                    fallback: true,
                    recommendations: extractRecommendations(localReply)
                }
            });
        }

        // 构建对话消息
        const messages = [{ role: 'system', content: systemPrompt }];

        // 添加历史对话（最近10轮=20条消息）
        const recentHistory = history.slice(-20);
        recentHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });

        // 添加当前用户消息
        messages.push({ role: 'user', content: message });

        let replyContent = '';

        if (process.env.DASHSCOPE_API_KEY) {
            // 使用DashScope（通义千问）API
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
                {
                    model: 'qwen-turbo',
                    input: { messages },
                    parameters: {
                        result_format: 'message',
                        temperature: 0.7,
                        max_tokens: 800
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
            replyContent = response.data.output?.choices?.[0]?.message?.content || '';
        } else {
            // 使用DeepSeek API
            const response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages,
                    temperature: 0.7,
                    max_tokens: 800
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            replyContent = response.data.choices?.[0]?.message?.content || '';
        }

        // 保存会话历史
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: replyContent });
        if (history.length > 20) history = history.slice(-20);
        global.tutorSessions.set(sid, history);

        // 提取推荐动作
        const recommendations = extractRecommendations(replyContent);

        res.json({
            success: true,
            data: {
                reply: replyContent,
                sessionId: sid,
                recommendations
            }
        });

    } catch (err) {
        console.error('导师对话失败:', err.message);

        // 降级到本地回复
        const context = await getUserContext(req.userId).catch(() => ({}));
        const localReply = generateLocalTutorReply(req.body.message || '', context);

        res.json({
            success: true,
            data: {
                reply: localReply,
                sessionId: req.body.sessionId || `tutor_${req.userId}_${Date.now()}`,
                fallback: true,
                recommendations: extractRecommendations(localReply)
            }
        });
    }
});

// ===== 清除会话历史 =====
router.post('/clear', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (sessionId && global.tutorSessions) {
            global.tutorSessions.delete(sessionId);
        }
        res.json({ success: true, message: '会话已清除' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ===== 从回复中提取推荐动作 =====
function extractRecommendations(reply) {
    const recommendations = [];

    // 匹配【推荐动作】格式
    const actionMatch = reply.match(/【推荐动作】(.+)/);
    if (actionMatch) {
        const action = actionMatch[1].trim();

        // 根据内容判断推荐页面
        if (/词汇|单词|背词/.test(action)) {
            recommendations.push({ text: action, page: 'practice', icon: '✏️' });
        } else if (/阅读/.test(action)) {
            recommendations.push({ text: action, page: 'reading', icon: '📖' });
        } else if (/翻译/.test(action)) {
            recommendations.push({ text: action, page: 'translation', icon: '🌐' });
        } else if (/填空|语法/.test(action)) {
            recommendations.push({ text: action, page: 'cloze', icon: '📝' });
        } else if (/作文|写作/.test(action)) {
            recommendations.push({ text: action, page: 'writing', icon: '✍️' });
        } else if (/复习/.test(action)) {
            recommendations.push({ text: action, page: 'review', icon: '🔄' });
        } else if (/口语/.test(action)) {
            recommendations.push({ text: action, page: 'speaking', icon: '🗣️' });
        } else {
            recommendations.push({ text: action, page: null, icon: '💡' });
        }
    }

    return recommendations;
}

// ===== 本地导师回复（无API Key降级） =====
function generateLocalTutorReply(message, context) {
    const msg = message.toLowerCase();

    // 词汇类问题
    if (/怎么记|如何记|背不下来|记不住|词汇量/.test(msg)) {
        let reply = '记单词建议使用以下方法：\n\n1. **词根词缀法**：如 abandon（a+band+on，away+bind+on，即"放开"→放弃）\n2. **联想记忆法**：将单词与图像、故事关联\n3. **语境记忆法**：在句子中记忆，而非孤立背诵\n4. **间隔重复法**：利用复习模块的艾宾浩斯曲线自动安排复习\n\n';
        if (context.recentErrors && context.recentErrors.length > 0) {
            reply += `你最近错的「${context.recentErrors[0].word}」可以试试词根拆解法。\n\n`;
        }
        reply += '【推荐动作】去复习模块巩固近期错题';
        return reply;
    }

    // 语法类问题
    if (/语法|句型|时态|从句|虚拟语气|倒装/.test(msg)) {
        let reply = '考研英语语法重点掌握以下内容：\n\n1. **三大从句**：定语从句、名词性从句、状语从句\n2. **非谓语动词**：不定式、动名词、分词的用法区别\n3. **特殊句式**：倒装句、强调句、虚拟语气\n4. **长难句分析**：找主干→理从句→翻译\n\n';
        if (context.weakPoints && context.weakPoints.length > 0) {
            const grammarWeak = context.weakPoints.find(w => w.dimension === '语法掌握');
            if (grammarWeak) {
                reply += `你的薄弱知识点是「${grammarWeak.skillPoint}」，建议多做选词填空练习。\n\n`;
            }
        }
        reply += '【推荐动作】去选词填空练习语法';
        return reply;
    }

    // 阅读类问题
    if (/阅读|读不懂|长难句|阅读理解|主旨|推断/.test(msg)) {
        let reply = '阅读理解提分策略：\n\n1. **先读题干**：带着问题找答案\n2. **定位关键句**：通过题干关键词回原文定位\n3. **分析长难句**：抓主干，理清从句关系\n4. **警惕干扰项**：偷换概念、以偏概全、过度推断\n\n';
        if (context.dimensions && context.dimensions.reading < 60) {
            reply += `你的阅读理解得分${context.dimensions.reading}，建议每天精读1篇外刊文章。\n\n`;
        }
        reply += '【推荐动作】去阅读练习模块训练';
        return reply;
    }

    // 翻译类问题
    if (/翻译|译|translate/.test(msg)) {
        let reply = '翻译技巧要点：\n\n1. **直译与意译结合**：先直译保证准确，再意译保证流畅\n2. **语序调整**：英文长句拆分为中文短句\n3. **词性转换**：英文名词常转中文动词\n4. **增删得当**：增补隐含语义，删去冗余表达\n\n';
        if (context.dimensions && context.dimensions.translation < 60) {
            reply += `你的翻译得分${context.dimensions.translation}，建议多练习真题翻译。\n\n`;
        }
        reply += '【推荐动作】去翻译练习模块训练';
        return reply;
    }

    // 写作类问题
    if (/作文|写作|write|模板/.test(msg)) {
        let reply = '考研写作提分建议：\n\n1. **积累高级词汇**：用significant替代important等\n2. **句式多样化**：长短句结合，使用从句和倒装\n3. **逻辑清晰**：使用连接词（however, moreover, therefore）\n4. **背诵范文**：每种类型背1-2篇优秀范文\n\n';
        if (context.dimensions && context.dimensions.writing < 60) {
            reply += `你的写作得分${context.dimensions.writing}，建议从仿写开始练习。\n\n`;
        }
        reply += '【推荐动作】去作文练习模块训练';
        return reply;
    }

    // 学习计划类问题
    if (/计划|安排|怎么学|如何学|备考|复习计划|时间/.test(msg)) {
        let reply = '基于你的学情，建议如下学习计划：\n\n';
        if (context.overallScore !== undefined) {
            reply += `你目前综合得分${context.overallScore}，正确率${context.accuracy}%。\n\n`;
        }
        if (context.weakPoints && context.weakPoints.length > 0) {
            reply += '**薄弱环节：**\n';
            context.weakPoints.forEach(w => {
                reply += `- ${w.dimension}：${w.skillPoint}（正确率${w.accuracy}%）\n`;
            });
            reply += '\n';
        }
        reply += '**每日计划建议：**\n1. 早晨：背单词30分钟（用例句练习）\n2. 上午：阅读理解2篇+精读\n3. 下午：翻译/语法专项练习\n4. 晚上：复习错题+1篇作文\n5. 睡前：用复习模块巩固今日错题\n\n【推荐动作】去复习模块查看今日待复习内容';
        return reply;
    }

    // 口语类问题
    if (/口语|发音|speaking|说/.test(msg)) {
        let reply = '口语练习建议：\n\n1. **多说多练**：每天用口语练习模块练习1-2个话题\n2. **录音回放**：录音后听自己的发音，找出问题\n3. **跟读模仿**：跟读标准发音材料\n4. **积累表达**：背诵常用口语句型和过渡词\n\n【推荐动作】去口语练习模块训练';
        return reply;
    }

    // 通用问候
    if (/你好|hello|hi|在吗|帮我/.test(msg)) {
        let reply = '你好！我是你的AI英语学习导师，可以帮你：\n\n📚 解答词汇、语法、阅读、翻译、写作问题\n📊 分析你的学情，给出个性化建议\n💡 制定学习计划，推荐练习内容\n\n你可以直接提问，比如：\n- "abandon怎么记？"\n- "定语从句怎么用？"\n- "阅读总是做不完怎么办？"\n- "帮我制定复习计划"';
        return reply;
    }

    // 默认回复
    let reply = '我理解你的问题。作为考研英语学习导师，我可以帮你：\n\n1. **词汇记忆**：词根词缀法、联想记忆法\n2. **语法讲解**：从句、时态、特殊句式\n3. **阅读技巧**：长难句分析、题型策略\n4. **翻译指导**：直译意译、语序调整\n5. **写作提升**：句式多样化、逻辑连贯\n6. **学习规划**：基于你的学情制定计划\n\n请告诉我你具体想了解哪方面？';
    if (context.weakPoints && context.weakPoints.length > 0) {
        reply += `\n\n💡 根据你的学情，建议优先攻克：${context.weakPoints[0].dimension}的「${context.weakPoints[0].skillPoint}」`;
    }
    return reply;
}

module.exports = router;
