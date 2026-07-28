/**
 * 学情画像工具
 * Agent 可通过此工具获取用户的能力画像（5维度评分）、薄弱知识点
 */

const { get, all } = require('../database/db');

module.exports = {
    name: 'get_user_profile',
    description: '获取用户的能力画像和薄弱知识点。包括词汇、语法、阅读、翻译、写作5个维度的评分，以及正确率较低的薄弱知识点列表。用于提供个性化学习建议。',
    parameters: {
        type: 'object',
        properties: {
            dimension: {
                type: 'string',
                description: '可选，指定查看的维度：vocabulary/grammar/reading/translation/writing',
                enum: ['vocabulary', 'grammar', 'reading', 'translation', 'writing']
            }
        },
        required: []
    },

    async execute(args, context) {
        const userId = context.userId;
        if (!userId) return '未登录，无法获取学情画像';

        const profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);

        if (!profile) {
            return '新用户，暂无学情数据。建议先进行一次能力测试。';
        }

        const dimensions = {
            vocabulary: profile.vocabulary_score,
            grammar: profile.grammar_score,
            reading: profile.reading_score,
            translation: profile.translation_score,
            writing: profile.writing_score
        };

        const overall = Math.round(
            (dimensions.vocabulary + dimensions.grammar + dimensions.reading +
             dimensions.translation + dimensions.writing) / 5
        );

        const accuracy = profile.total_answers > 0
            ? Math.round((profile.total_correct / profile.total_answers) * 100)
            : 0;

        // 如果指定了维度，返回该维度详情
        if (args.dimension) {
            const dimLabel = { vocabulary: '词汇量', grammar: '语法', reading: '阅读', translation: '翻译', writing: '写作' }[args.dimension];
            const score = dimensions[args.dimension];

            const skills = await all(
                'SELECT skill_point, total_attempts, correct_attempts, mastery_level FROM user_skill_points WHERE user_id = ? AND dimension = ? ORDER BY (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC',
                [userId, args.dimension]
            );

            return JSON.stringify({
                dimension: dimLabel,
                score,
                accuracy,
                skillPoints: skills.map(s => ({
                    name: s.skill_point,
                    attempts: s.total_attempts,
                    accuracy: s.total_attempts > 0 ? Math.round((s.correct_attempts / s.total_attempts) * 100) : 0,
                    mastery: ['未掌握', '部分掌握', '已掌握'][s.mastery_level] || '未知'
                }))
            });
        }

        // 获取薄弱知识点（正确率 < 60%）
        const weakPoints = await all(
            'SELECT dimension, skill_point, total_attempts, correct_attempts FROM user_skill_points WHERE user_id = ? AND total_attempts > 0 ORDER BY (CAST(correct_attempts AS FLOAT) / total_attempts) ASC LIMIT 5',
            [userId]
        );

        return JSON.stringify({
            overallScore: overall,
            accuracy,
            totalAnswers: profile.total_answers,
            totalCorrect: profile.total_correct,
            dimensions: {
                vocabulary: dimensions.vocabulary,
                grammar: dimensions.grammar,
                reading: dimensions.reading,
                translation: dimensions.translation,
                writing: dimensions.writing
            },
            weakPoints: weakPoints.map(wp => ({
                dimension: wp.dimension,
                skillPoint: wp.skill_point,
                accuracy: wp.total_attempts > 0 ? Math.round((wp.correct_attempts / wp.total_attempts) * 100) : 0
            }))
        });
    }
};
