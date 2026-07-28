const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

const errorAgentRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { success: false, message: '提问过于频繁，请稍后再试' }
});

const DIMENSION_LABELS = {
    vocabulary: '词汇量',
    grammar: '语法掌握',
    reading: '阅读理解',
    translation: '翻译能力',
    writing: '写作水平'
};

// ===== 获取用户错题上下文 =====
async function getErrorContext(userId) {
    try {
        // 1. 获取复习队列中的错题
        const reviewErrors = await all(`
            SELECT item_type, word, question, correct_answer, user_answer,
                   review_count, next_review_time, last_result, is_archived
            FROM review_schedule
            WHERE user_id = ?
            ORDER BY is_archived ASC, next_review_time ASC
            LIMIT 30
        `, [userId]);

        // 2. 获取能力画像
        let profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
        const dimensions = profile ? {
            vocabulary: profile.vocabulary_score,
            grammar: profile.grammar_score,
            reading: profile.reading_score,
            translation: profile.translation_score,
            writing: profile.writing_score
        } : null;

        const overallScore = dimensions ? Math.round(
            Object.values(dimensions).reduce((a, b) => a + b, 0) / 5
        ) : 0;
        const accuracy = profile && profile.total_answers > 0
            ? Math.round((profile.total_correct / profile.total_answers) * 100)
            : 0;

        // 3. 获取薄弱知识点
        const weakPoints = await all(`
            SELECT dimension, skill_point, total_attempts, correct_attempts, mastery_level
            FROM user_skill_points
            WHERE user_id = ? AND mastery_level < 2
            ORDER BY (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC
            LIMIT 10
        `, [userId]);

        // 4. 分析错题分布
        const errorByType = {};
        const errorByDimension = { vocabulary: 0, grammar: 0, reading: 0, translation: 0, writing: 0 };

        reviewErrors.forEach(err => {
            const type = err.item_type || 'unknown';
            errorByType[type] = (errorByType[type] || 0) + 1;

            // 根据题型推断维度
            if (type === 'practice' || type === 'word' || type === 'memory') {
                errorByDimension.vocabulary++;
            } else if (type === 'cloze') {
                errorByDimension.grammar++;
            } else if (type === 'reading') {
                errorByDimension.reading++;
            } else if (type === 'translation') {
                errorByDimension.translation++;
            } else if (type === 'writing') {
                errorByDimension.writing++;
            }
        });

        // 5. 待复习和已掌握统计
        const pendingCount = reviewErrors.filter(e => !e.is_archived).length;
        const masteredCount = reviewErrors.filter(e => e.is_archived).length;

        // 6. 高频错题词
        const frequentWords = reviewErrors
            .filter(e => e.word && !e.is_archived)
            .reduce((acc, e) => {
                if (!acc[e.word]) acc[e.word] = { count: 0, type: e.item_type };
                acc[e.word].count++;
                return acc;
            }, {});
        const topErrorWords = Object.entries(frequentWords)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([word, info]) => ({ word, ...info }));

        return {
            profileSummary: dimensions
                ? `综合得分${overallScore}分，正确率${accuracy}%`
                : '新用户，暂无学情数据',
            dimensions,
            overallScore,
            accuracy,
            weakPoints: weakPoints.map(wp => ({
                dimension: wp.dimension,
                label: DIMENSION_LABELS[wp.dimension] || wp.dimension,
                skill: wp.skill_point,
                attempts: wp.total_attempts,
                correct: wp.correct_attempts,
                accuracy: wp.total_attempts > 0 ? Math.round((wp.correct_attempts / wp.total_attempts) * 100) : 0,
                mastery: wp.mastery_level
            })),
            recentErrors: reviewErrors.slice(0, 10).map(e => ({
                type: e.item_type,
                word: e.word,
                question: e.question,
                correctAnswer: e.correct_answer,
                userAnswer: e.user_answer,
                reviewCount: e.review_count,
                isMastered: e.is_archived === 1,
                lastResult: e.last_result
            })),
            errorByType,
            errorByDimension,
            pendingCount,
            masteredCount,
            topErrorWords,
            totalErrors: reviewErrors.length
        };
    } catch (err) {
        console.error('获取错题上下文失败:', err.message);
        return {
            profileSummary: '数据加载中',
            weakPoints: [],
            recentErrors: [],
            errorByType: {},
            errorByDimension: {},
            pendingCount: 0,
            masteredCount: 0,
            topErrorWords: [],
            totalErrors: 0
        };
    }
}

// ===== 构建错题Agent System Prompt =====
function buildErrorAgentPrompt(context) {
    let prompt = `你是「词光」考研英语错题分析专家。你的职责是帮助用户分析错题、诊断薄弱知识点、生成针对性练习题。

## 用户学情画像
${context.profileSummary}

## 错题统计
- 总错题数：${context.totalErrors}
- 待复习：${context.pendingCount}题
- 已掌握：${context.masteredCount}题

## 错题分布（按题型）
${Object.entries(context.errorByType).map(([type, count]) => `- ${type}: ${count}题`).join('\n') || '- 暂无数据'}

## 错题分布（按能力维度）
${Object.entries(context.errorByDimension).map(([dim, count]) => `- ${DIMENSION_LABELS[dim] || dim}: ${count}题`).join('\n') || '- 暂无数据'}

## 薄弱知识点（前5个）
${context.weakPoints.slice(0, 5).map((wp, i) =>
    `${i + 1}. ${wp.label} - ${wp.skill}（正确率${wp.accuracy}%，已练习${wp.attempts}次）`
).join('\n') || '- 暂无薄弱知识点数据'}

## 近期错题
${context.recentErrors.slice(0, 5).map((err, i) =>
    `${i + 1}. [${err.type}] ${err.word || err.question || ''} → 正确答案：${err.correctAnswer || ''}，用户答案：${err.userAnswer || ''}（已复习${err.reviewCount}次）`
).join('\n') || '- 暂无错题记录'}

## 高频错题词
${context.topErrorWords.map(w => `- ${w.word}（错${w.count}次，${w.type}类型）`).join('\n') || '- 暂无数据'}

## 回答要求
1. 优先基于用户真实错题数据进行分析
2. 错题分析要指出具体错误原因（词汇/语法/逻辑/知识盲区）
3. 薄弱知识点讲解要结合具体例题
4. 生成练习题时要针对用户薄弱环节
5. 回答控制在200-400字以内
6. 可以在回答末尾推荐学习动作，格式为：【推荐动作】描述
7. 如果用户要求出题，可以生成2-3道针对性练习题，用JSON代码块包裹
8. 始终以鼓励性语言结尾，激发学习动力`;

    return prompt;
}

// ===== 提取推荐动作 =====
function extractRecommendations(reply) {
    const recommendations = [];
    const lines = reply.split('\n');

    for (const line of lines) {
        const match = line.match(/【推荐动作】(.+)/);
        if (match) {
            const text = match[1].trim();
            let page = 'wrong';
            let icon = '📝';

            if (text.includes('词汇') || text.includes('单词')) { page = 'practice'; icon = '✏️'; }
            else if (text.includes('阅读')) { page = 'reading'; icon = '📖'; }
            else if (text.includes('翻译')) { page = 'translation'; icon = '🌐'; }
            else if (text.includes('填空')) { page = 'cloze'; icon = '📝'; }
            else if (text.includes('作文') || text.includes('写作')) { page = 'writing'; icon = '✍️'; }
            else if (text.includes('复习')) { page = 'review'; icon = '🔄'; }
            else if (text.includes('错题') || text.includes('整理')) { page = 'wrong'; icon = '❌'; }
            else if (text.includes('真题')) { page = 'exam-practice'; icon = '📋'; }

            recommendations.push({ text, page, icon });
        }
    }

    return recommendations;
}

// ===== 本地降级回复 =====
function generateLocalErrorReply(message, context) {
    const msg = message.toLowerCase();

    // 错题分析
    if (msg.includes('分析') || msg.includes('错题') || msg.includes('错误')) {
        if (context.recentErrors.length === 0) {
            return `📊 **错题分析报告**\n\n目前你的错题库中还比较空，建议多做一些练习来积累错题数据。\n\n从能力画像来看，你的综合得分为${context.overallScore}分，正确率${context.accuracy}%。\n\n【推荐动作】去做一些练习题`;
        }

        let reply = `📊 **错题分析报告**\n\n`;

        if (context.totalErrors > 0) {
            reply += `## 错题概览\n`;
            reply += `- 总错题：${context.totalErrors}题\n`;
            reply += `- 待复习：${context.pendingCount}题\n`;
            reply += `- 已掌握：${context.masteredCount}题\n\n`;

            reply += `## 错题分布\n`;
            Object.entries(context.errorByType).forEach(([type, count]) => {
                const typeLabels = { practice: '例句练习', reading: '阅读理解', cloze: '选词填空', translation: '翻译练习', memory: '记忆训练', photo: '拍照错题', word: '单词' };
                reply += `- ${typeLabels[type] || type}：${count}题\n`;
            });

            reply += `\n## 薄弱知识点\n`;
            context.weakPoints.slice(0, 3).forEach((wp, i) => {
                reply += `${i + 1}. ${wp.label} - ${wp.skill}（正确率${wp.accuracy}%）\n`;
            });

            if (context.topErrorWords.length > 0) {
                reply += `\n## 高频错题\n`;
                context.topErrorWords.forEach(w => {
                    reply += `- ${w.word}（错${w.count}次）\n`;
                });
            }

            reply += `\n💡 **建议**：优先复习薄弱知识点对应的题型，每次练习后及时将错题加入复习队列。\n`;
            reply += `【推荐动作】去复习错题`;
        }

        return reply;
    }

    // 薄弱知识点
    if (msg.includes('薄弱') || msg.includes('弱点') || msg.includes('不足') || msg.includes('弱项')) {
        if (context.weakPoints.length === 0) {
            return `🎯 **薄弱知识点分析**\n\n目前暂无薄弱知识点数据，开始练习后会自动记录。\n\n建议你先做一些练习题，系统会自动分析你的薄弱环节。\n\n【推荐动作】去做例句练习`;
        }

        let reply = `🎯 **薄弱知识点分析**\n\n根据你的练习记录，以下是重点需要提升的知识点：\n\n`;

        context.weakPoints.slice(0, 5).forEach((wp, i) => {
            const status = wp.accuracy < 30 ? '🔴 严重薄弱' : wp.accuracy < 50 ? '🟡 需要加强' : '🟢 基本掌握';
            reply += `${i + 1}. **${wp.label}** - ${wp.skill}\n`;
            reply += `   ${status} | 正确率${wp.accuracy}% | 已练习${wp.attempts}次\n\n`;
        });

        const weakest = context.weakPoints[0];
        if (weakest) {
            reply += `💡 建议优先攻克 **${weakest.label} - ${weakest.skill}**，这是你最薄弱的知识点。\n`;
            reply += `【推荐动作】针对性练习${weakest.label}`;
        }

        return reply;
    }

    // 出题
    if (msg.includes('出题') || msg.includes('练习题') || msg.includes('测试') || msg.includes('题目')) {
        let reply = `📝 **针对性练习题**\n\n`;

        if (context.weakPoints.length > 0) {
            const wp = context.weakPoints[0];
            reply += `基于你的薄弱知识点 **${wp.label} - ${wp.skill}**，为你生成以下练习题：\n\n`;

            reply += `**题目1**（${wp.label}）\n`;
            reply += `请根据${wp.skill}的知识点完成以下练习：\n`;
            reply += `选择正确的选项填空：\n\n`;

            if (wp.dimension === 'vocabulary') {
                reply += `The word that best fits the context "The professor's lecture was so ___ that students stayed after class to ask questions" is:\n`;
                reply += `A. boring  B. engaging  C. simple  D. short\n\n`;
                reply += `**答案**：B. engaging（引人入胜的）\n`;
                reply += `**解析**：从后文"stayed after class to ask questions"可知讲座很精彩。\n\n`;
            } else if (wp.dimension === 'grammar') {
                reply += `Choose the correct sentence:\n`;
                reply += `A. If I was you, I would study harder.\n`;
                reply += `B. If I were you, I would study harder.\n`;
                reply += `C. If I am you, I will study harder.\n\n`;
                reply += `**答案**：B（虚拟语气）\n`;
                reply += `**解析**：表示与现在事实相反的假设，用were。\n\n`;
            } else if (wp.dimension === 'reading') {
                reply += `Read the following sentence and determine the author's tone:\n`;
                reply += `"The results of this study are nothing short of revolutionary."\n`;
                reply += `A. Critical  B. Enthusiastic  C. Neutral  D. Skeptical\n\n`;
                reply += `**答案**：B. Enthusiastic\n`;
                reply += `**解析**："nothing short of revolutionary"表达了高度赞扬。\n\n`;
            } else {
                reply += `Translate the following sentence:\n`;
                reply += `"The rapid development of technology has brought both opportunities and challenges."\n\n`;
                reply += `**参考翻译**：技术的快速发展带来了机遇与挑战。\n`;
                reply += `**解析**：注意"rapid development"的翻译和"both...and..."结构。\n\n`;
            }

            reply += `**题目2**（综合应用）\n`;
            reply += `请用${wp.skill}相关的知识点造一个句子，并标注关键语法结构。\n\n`;
        } else {
            reply += `暂无足够的学情数据来生成针对性题目，建议先完成一些练习。\n\n`;
            reply += `**通用练习题**：\n请翻译以下句子：\n"The importance of education cannot be overstated."\n\n`;
            reply += `**参考答案**：教育的重要性怎么强调都不为过。\n`;
        }

        reply += `\n做完后可以告诉我你的答案，我来帮你分析！\n`;
        reply += `【推荐动作】去做真题练习`;

        return reply;
    }

    // 高频错题
    if (msg.includes('高频') || msg.includes('常错') || msg.includes('反复')) {
        if (context.topErrorWords.length === 0) {
            return `🔍 **高频错题分析**\n\n目前暂无高频错题数据。随着你的练习，系统会自动统计你经常出错的单词和知识点。\n\n【推荐动作】去做例句练习`;
        }

        let reply = `🔍 **高频错题分析**\n\n以下是你反复出错的内容，需要重点关注：\n\n`;
        context.topErrorWords.forEach((w, i) => {
            const typeLabels = { practice: '例句', reading: '阅读', cloze: '填空', translation: '翻译', memory: '记忆' };
            reply += `${i + 1}. **${w.word}** - 错${w.count}次（${typeLabels[w.type] || w.type}类型）\n`;
        });
        reply += `\n💡 建议：将这些高频错词加入记忆训练，配合艾宾浩斯复习曲线反复巩固。\n`;
        reply += `【推荐动作】去复习这些错题`;

        return reply;
    }

    // 学习建议
    if (msg.includes('建议') || msg.includes('怎么办') || msg.includes('如何') || msg.includes('计划')) {
        let reply = `💡 **个性化学习建议**\n\n`;
        reply += `基于你的学情数据（综合${context.overallScore}分，正确率${context.accuracy}%）：\n\n`;

        if (context.dimensions) {
            const sortedDims = Object.entries(context.dimensions).sort((a, b) => a[1] - b[1]);
            reply += `## 能力维度排序（由弱到强）\n`;
            sortedDims.forEach(([dim, score], i) => {
                const status = score < 60 ? '⚠️ 需重点提升' : score < 80 ? '📌 可继续加强' : '✅ 保持良好';
                reply += `${i + 1}. ${DIMENSION_LABELS[dim]}：${score}分 ${status}\n`;
            });

            const weakest = sortedDims[0];
            reply += `\n## 优先建议\n`;
            reply += `重点提升 **${DIMENSION_LABELS[weakest[0]]}**（${weakest[1]}分），这是你目前最薄弱的维度。\n`;
            reply += `建议每天花30分钟进行专项练习，配合错题复习巩固。\n`;
        }

        reply += `\n## 复习策略\n`;
        reply += `- 当前待复习错题：${context.pendingCount}题\n`;
        reply += `- 已掌握错题：${context.masteredCount}题\n`;
        if (context.pendingCount > 10) {
            reply += `- ⚠️ 待复习题目较多，建议立即开始复习\n`;
        }
        reply += `\n【推荐动作】开始复习错题`;

        return reply;
    }

    // 默认回复
    return `🤖 你好！我是错题分析助手，可以帮你：\n\n📊 **错题分析** - 分析你的错题规律和错误类型\n🎯 **薄弱知识点** - 诊断你的薄弱环节\n📝 **出题练习** - 针对薄弱点生成练习题\n🔍 **高频错题** - 找出你反复出错的内容\n💡 **学习建议** - 个性化提升方案\n\n你的错题库目前有${context.totalErrors}道题（待复习${context.pendingCount}题），试试问我"分析我的错题"吧！`;
}

// ===== 错题库对话接口 =====
router.post('/chat', errorAgentRateLimit, async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ success: false, message: '请输入问题' });
        }

        if (message.length > 500) {
            return res.status(400).json({ success: false, message: '问题过长，请控制在500字以内' });
        }

        const sid = sessionId || `error_agent_${req.userId}_${Date.now()}`;

        // 获取错题上下文
        const context = await getErrorContext(req.userId);

        // 会话历史
        if (!global.errorAgentSessions) {
            global.errorAgentSessions = new Map();
        }

        let history = global.errorAgentSessions.get(sid) || [];

        const systemPrompt = buildErrorAgentPrompt(context);

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            const localReply = generateLocalErrorReply(message, context);
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: localReply });
            if (history.length > 20) history = history.slice(-20);
            global.errorAgentSessions.set(sid, history);

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

        const messages = [{ role: 'system', content: systemPrompt }];
        const recentHistory = history.slice(-20);
        recentHistory.forEach(msg => {
            messages.push({ role: msg.role, content: msg.content });
        });
        messages.push({ role: 'user', content: message });

        let replyContent = '';

        if (process.env.DASHSCOPE_API_KEY) {
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
                {
                    model: 'qwen-turbo',
                    input: { messages },
                    parameters: { result_format: 'message', temperature: 0.7, max_tokens: 1000 }
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
            const response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages,
                    temperature: 0.7,
                    max_tokens: 1000
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

        if (!replyContent) {
            replyContent = generateLocalErrorReply(message, context);
        }

        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: replyContent });
        if (history.length > 20) history = history.slice(-20);
        global.errorAgentSessions.set(sid, history);

        res.json({
            success: true,
            data: {
                reply: replyContent,
                sessionId: sid,
                recommendations: extractRecommendations(replyContent)
            }
        });

    } catch (err) {
        console.error('错题Agent对话失败:', err.message);
        const context = await getErrorContext(req.userId).catch(() => ({}));
        const localReply = generateLocalErrorReply(req.body.message || '', context);
        res.json({
            success: true,
            data: {
                reply: localReply,
                sessionId: `error_agent_${req.userId}_${Date.now()}`,
                fallback: true,
                recommendations: extractRecommendations(localReply)
            }
        });
    }
});

// ===== 清除会话 =====
router.post('/clear', (req, res) => {
    const { sessionId } = req.body;
    if (global.errorAgentSessions && sessionId) {
        global.errorAgentSessions.delete(sessionId);
    }
    res.json({ success: true, message: '会话已清除' });
});

// ===== 获取错题统计摘要 =====
router.get('/summary', async (req, res) => {
    try {
        const context = await getErrorContext(req.userId);
        res.json({
            success: true,
            data: {
                totalErrors: context.totalErrors,
                pendingCount: context.pendingCount,
                masteredCount: context.masteredCount,
                errorByType: context.errorByType,
                errorByDimension: context.errorByDimension,
                topErrorWords: context.topErrorWords,
                weakPoints: context.weakPoints.slice(0, 5),
                overallScore: context.overallScore,
                accuracy: context.accuracy
            }
        });
    } catch (err) {
        res.json({ success: true, data: { totalErrors: 0, pendingCount: 0, masteredCount: 0 } });
    }
});

module.exports = router;
