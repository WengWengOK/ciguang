const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有接口都需要登录认证
router.use(authMiddleware);

// 限流
const predictRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});

// 维度中文名称映射
const DIMENSION_LABELS = {
    vocabulary: '词汇量',
    grammar: '语法掌握',
    reading: '阅读理解',
    translation: '翻译能力',
    writing: '写作水平'
};

// 考研英语各部分权重（总分100分）
const EXAM_WEIGHTS = {
    vocabulary: 0.15,    // 词汇（完形填空+词汇题约15分）
    grammar: 0.15,       // 语法（翻译+改错约15分）
    reading: 0.40,       // 阅读（阅读理解40分）
    translation: 0.15,   // 翻译（英译汉15分）
    writing: 0.15         // 写作（小作文+大作文25分，但考虑到综合能力，取15%）
};

// ===== 获取学情预测数据 =====
router.get('/forecast', async (req, res) => {
    try {
        const userId = req.userId;

        // 1. 获取能力画像
        let profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);

        if (!profile) {
            return res.json({
                success: true,
                data: {
                    hasData: false,
                    message: '暂无学情数据，开始练习后即可生成预测'
                }
            });
        }

        const dimensions = {
            vocabulary: profile.vocabulary_score,
            grammar: profile.grammar_score,
            reading: profile.reading_score,
            translation: profile.translation_score,
            writing: profile.writing_score
        };

        // 2. 计算加权预测得分（转换为考研英语100分制）
        let predictedScore = 0;
        Object.entries(EXAM_WEIGHTS).forEach(([dim, weight]) => {
            predictedScore += dimensions[dim] * weight;
        });
        predictedScore = Math.round(predictedScore);

        // 3. 获取历史答题数据趋势
        const recentStats = await all(`
            SELECT date, total_count, correct_count,
                   practice_count, reading_count, translation_count, cloze_count, memory_count
            FROM daily_stats
            WHERE user_id = ? AND total_count > 0
            ORDER BY date DESC
            LIMIT 14
        `, [userId]);

        // 4. 计算学习活跃度和趋势
        const totalAnswers = profile.total_answers || 0;
        const totalCorrect = profile.total_correct || 0;
        const accuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;

        // 学习连续天数
        let streakDays = 0;
        if (recentStats.length > 0) {
            const today = new Date();
            for (let i = 0; i < recentStats.length; i++) {
                const statDate = new Date(recentStats[i].date);
                const diffDays = Math.floor((today - statDate) / (1000 * 60 * 60 * 24));
                if (diffDays === streakDays) {
                    streakDays++;
                } else {
                    break;
                }
            }
        }

        // 5. 计算各维度提升空间
        const improvementPotential = {};
        Object.entries(dimensions).forEach(([dim, score]) => {
            const weight = EXAM_WEIGHTS[dim];
            const maxGain = Math.round((100 - score) * weight);
            improvementPotential[dim] = {
                current: score,
                weight: Math.round(weight * 100),
                maxGain,
                priority: score < 60 ? 'high' : score < 80 ? 'medium' : 'low'
            };
        });

        // 6. 预测分数区间
        const scoreRange = {
            min: Math.max(0, predictedScore - 8),
            max: Math.min(100, predictedScore + 8),
            predicted: predictedScore
        };

        // 7. 7天学习趋势数据
        const trendData = recentStats.slice(0, 7).reverse().map(stat => ({
            date: stat.date,
            total: stat.total_count,
            correct: stat.correct_count,
            accuracy: stat.total_count > 0 ? Math.round((stat.correct_count / stat.total_count) * 100) : 0
        }));

        // 8. 分数等级
        let grade = '需提升';
        let gradeColor = '#f44336';
        if (predictedScore >= 85) { grade = '优秀'; gradeColor = '#4caf50'; }
        else if (predictedScore >= 75) { grade = '良好'; gradeColor = '#2196f3'; }
        else if (predictedScore >= 60) { grade = '及格'; gradeColor = '#ff9800'; }

        res.json({
            success: true,
            data: {
                hasData: true,
                scoreRange,
                grade,
                gradeColor,
                dimensions,
                accuracy,
                totalAnswers,
                streakDays,
                improvementPotential,
                trendData,
                weakDimension: Object.entries(dimensions).sort((a, b) => a[1] - b[1])[0]
            }
        });

    } catch (err) {
        console.error('学情预测失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ===== 生成AI学习计划 =====
router.post('/plan', predictRateLimit, async (req, res) => {
    try {
        const { examDate, dailyHours, targetScore } = req.body;
        const userId = req.userId;

        // 获取能力画像
        let profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);

        if (!profile) {
            return res.json({
                success: false,
                message: '暂无学情数据，请先进行一些练习'
            });
        }

        const dimensions = {
            vocabulary: profile.vocabulary_score,
            grammar: profile.grammar_score,
            reading: profile.reading_score,
            translation: profile.translation_score,
            writing: profile.writing_score
        };

        const overallScore = Math.round(
            (dimensions.vocabulary + dimensions.grammar + dimensions.reading +
             dimensions.translation + dimensions.writing) / 5
        );

        const accuracy = profile.total_answers > 0
            ? Math.round((profile.total_correct / profile.total_answers) * 100)
            : 0;

        // 计算距考试天数
        let daysToExam = 120; // 默认120天
        if (examDate) {
            const exam = new Date(examDate);
            const now = new Date();
            daysToExam = Math.max(1, Math.ceil((exam - now) / (1000 * 60 * 60 * 24)));
        }

        const hoursPerDay = dailyHours || 3;
        const target = targetScore || Math.min(85, overallScore + 15);

        // 获取薄弱知识点
        const weakPoints = await all(`
            SELECT dimension, skill_point, total_attempts, correct_attempts, mastery_level
            FROM user_skill_points
            WHERE user_id = ? AND mastery_level < 2
            ORDER BY (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC
            LIMIT 5
        `, [userId]);

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        // 构建学情摘要
        const dimStr = Object.entries(dimensions)
            .map(([k, v]) => `${DIMENSION_LABELS[k]}:${v}`)
            .join('，');

        const weakStr = weakPoints.length > 0
            ? weakPoints.map(w => `${DIMENSION_LABELS[w.dimension]}的${w.skill_point}（正确率${w.total_attempts > 0 ? Math.round((w.correct_attempts / w.total_attempts) * 100) : 0}%）`).join('；')
            : '暂无明显薄弱知识点';

        if (!apiKey) {
            // 无API Key时使用本地规则生成计划
            const localPlan = generateLocalPlan(dimensions, overallScore, accuracy, daysToExam, hoursPerDay, target, weakPoints);
            return res.json({ success: true, data: { ...localPlan, fallback: true } });
        }

        const prompt = `你是考研英语学习规划专家。请根据以下用户学情，生成一份个性化学习计划。

## 用户学情
- 综合得分：${overallScore}/100
- 正确率：${accuracy}%
- 总答题数：${profile.total_answers}
- 各维度：${dimStr}
- 薄弱知识点：${weakStr}

## 计划参数
- 距考试天数：${daysToExam}天
- 每日学习时长：${hoursPerDay}小时
- 目标分数：${target}分

## 请生成以下内容（JSON格式）：
{
  "summary": "一句话总结当前学情和目标差距",
  "phases": [
    {
      "name": "阶段名称（如：基础巩固期）",
      "duration": "持续时间（如：第1-4周）",
      "focus": "本阶段重点",
      "tasks": ["具体任务1", "具体任务2", "具体任务3"],
      "dailySchedule": [
        {"time": "时间段", "task": "学习任务", "duration": "时长"}
      ]
    }
  ],
  "weeklyGoals": ["每周目标1", "每周目标2", "每周目标3"],
  "tips": ["学习建议1", "学习建议2", "学习建议3"],
  "predictedProgress": "预计完成计划后的提升幅度"
}

要求：
1. 计划分2-3个阶段，从基础到冲刺
2. 每日任务要具体可执行
3. 优先安排薄弱维度的练习
4. 结合艾宾浩斯复习曲线安排复习
5. JSON格式严格，不要有多余文本`;

        let content = '';
        if (process.env.DASHSCOPE_API_KEY) {
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
                {
                    model: 'qwen-turbo',
                    input: { messages: [{ role: 'user', content: prompt }] },
                    parameters: { result_format: 'message', temperature: 0.6, max_tokens: 2000 }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            content = response.data.output?.choices?.[0]?.message?.content || '';
        } else {
            const response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.6,
                    max_tokens: 2000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            content = response.data.choices?.[0]?.message?.content || '';
        }

        // 解析AI返回的JSON
        let result;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                const cleaned = jsonMatch[0].replace(/[\x00-\x1f]/g, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                result = JSON.parse(cleaned);
            }
        } else {
            result = generateLocalPlan(dimensions, overallScore, accuracy, daysToExam, hoursPerDay, target, weakPoints);
            result.fallback = true;
        }

        res.json({ success: true, data: result });

    } catch (err) {
        console.error('生成学习计划失败:', err.message);

        // 降级到本地计划
        let profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId]).catch(() => null);
        if (profile) {
            const dimensions = {
                vocabulary: profile.vocabulary_score,
                grammar: profile.grammar_score,
                reading: profile.reading_score,
                translation: profile.translation_score,
                writing: profile.writing_score
            };
            const overallScore = Math.round(Object.values(dimensions).reduce((a, b) => a + b, 0) / 5);
            const accuracy = profile.total_answers > 0 ? Math.round((profile.total_correct / profile.total_answers) * 100) : 0;
            const localPlan = generateLocalPlan(dimensions, overallScore, accuracy, req.body.examDate, req.body.dailyHours || 3, req.body.targetScore || 75, []);
            return res.json({ success: true, data: { ...localPlan, fallback: true } });
        }

        res.status(500).json({ success: false, message: '生成学习计划失败: ' + err.message });
    }
});

// ===== 本地学习计划生成（降级方案） =====
function generateLocalPlan(dimensions, overallScore, accuracy, daysToExam, hoursPerDay, target, weakPoints) {
    // 找出最薄弱的维度
    const sortedDims = Object.entries(dimensions).sort((a, b) => a[1] - b[1]);
    const weakest = sortedDims[0];
    const secondWeakest = sortedDims[1];

    const gap = target - overallScore;
    const phase1End = Math.min(Math.floor(daysToExam * 0.4), 35);
    const phase2End = Math.min(Math.floor(daysToExam * 0.7), 70);

    return {
        summary: `当前综合得分${overallScore}分，目标${target}分，差距${gap}分。${gap > 20 ? '需要较大提升，建议加大学习强度。' : gap > 10 ? '有一定差距，坚持练习可达标。' : '差距较小，保持当前节奏即可。'}`,

        phases: [
            {
                name: '基础巩固期',
                duration: `第1-${Math.floor(phase1End / 7)}周（共${phase1End}天）`,
                focus: `重点攻克${DIMENSION_LABELS[weakest[0]]}（${weakest[1]}分）和${DIMENSION_LABELS[secondWeakest[0]]}（${secondWeakest[1]}分）`,
                tasks: [
                    `${DIMENSION_LABELS[weakest[0]]}：每日专项练习30分钟，重点掌握薄弱知识点`,
                    `${DIMENSION_LABELS[secondWeakest[0]]}：每日练习20分钟，巩固基础`,
                    `每日背诵核心词汇50个（用例句练习模块）`,
                    `每周完成2篇阅读理解+1篇翻译练习`,
                    `使用复习模块每天巩固错题（艾宾浩斯曲线）`
                ],
                dailySchedule: [
                    { time: '早晨', task: '词汇背诵（例句练习）', duration: '30分钟' },
                    { time: '上午', task: `${DIMENSION_LABELS[weakest[0]]}专项练习`, duration: '40分钟' },
                    { time: '下午', task: '阅读理解2篇', duration: '40分钟' },
                    { time: '晚上', task: '翻译/语法练习', duration: '30分钟' },
                    { time: '睡前', task: '复习模块巩固错题', duration: '20分钟' }
                ]
            },
            {
                name: '强化提升期',
                duration: `第${Math.floor(phase1End / 7) + 1}-${Math.floor(phase2End / 7)}周（共${phase2End - phase1End}天）`,
                focus: '全面提升各维度能力，增加练习难度',
                tasks: [
                    '每日完成1套真题阅读理解（4篇）',
                    '每周完成2篇作文练习（大小作文各1篇）',
                    '翻译练习每日1-2句，对照参考译文',
                    '口语练习每日1个话题（用AI口语模块）',
                    '错题本复盘，确保同类错误不再犯'
                ],
                dailySchedule: [
                    { time: '早晨', task: '词汇复习+新词背诵', duration: '30分钟' },
                    { time: '上午', task: '真题阅读4篇', duration: '50分钟' },
                    { time: '下午', task: '作文/翻译练习', duration: '40分钟' },
                    { time: '晚上', task: '口语练习1话题', duration: '20分钟' },
                    { time: '睡前', task: '复习模块+错题复盘', duration: '20分钟' }
                ]
            },
            {
                name: '冲刺模考期',
                duration: `第${Math.floor(phase2End / 7) + 1}-${Math.floor(daysToExam / 7)}周（共${daysToExam - phase2End}天）`,
                focus: '模拟考试训练，查漏补缺',
                tasks: [
                    '每周完成1-2套完整模拟试卷',
                    '针对模考暴露的弱点进行专项突破',
                    '复习所有错题，确保掌握',
                    '背诵作文模板和高分句式',
                    '保持每日练习手感，调整考试心态'
                ],
                dailySchedule: [
                    { time: '早晨', task: '核心词汇快速回顾', duration: '20分钟' },
                    { time: '上午', task: '模考/专项突破', duration: '60分钟' },
                    { time: '下午', task: '模考分析+错题回顾', duration: '40分钟' },
                    { time: '晚上', task: '作文模板背诵/口语', duration: '30分钟' },
                    { time: '睡前', task: '复习模块最终巩固', duration: '20分钟' }
                ]
            }
        ],

        weeklyGoals: [
            `每周至少练习5天，累计答题${hoursPerDay * 7 * 10}题以上`,
            `薄弱维度${DIMENSION_LABELS[weakest[0]]}每周提升2-3分`,
            `每周完成至少1次完整模拟练习`,
            `保持每日复习，错题不再重复犯错`
        ],

        tips: [
            '💡 利用碎片时间背单词，通勤/排队时均可',
            '📊 每周日复盘本周学习数据，调整下周计划',
            '🔄 严格执行艾宾浩斯复习，不要跳过复习日',
            '🎯 优先攻克薄弱环节，不要只练擅长的部分',
            '😴 保证充足睡眠，学习效率比时长更重要'
        ],

        predictedProgress: `按此计划执行${daysToExam}天，预计可提升${Math.min(gap, 15 + Math.floor(daysToExam / 10))}分，达到${Math.min(target, overallScore + 15 + Math.floor(daysToExam / 10))}分左右。`
    };
}

module.exports = router;
