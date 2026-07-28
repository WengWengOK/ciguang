/**
 * 错题统计工具
 * Agent 可通过此工具获取用户的错题统计和高频错词
 */

const { all, get } = require('../database/db');

module.exports = {
    name: 'get_error_stats',
    description: '获取用户的错题统计数据。包括错题总数、按题型分布、按维度分布、高频错词列表。用于分析用户的薄弱环节并给出针对性建议。',
    parameters: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: '可选，按题型筛选：practice/reading/translation/cloze/memory',
                enum: ['practice', 'reading', 'translation', 'cloze', 'memory']
            }
        },
        required: []
    },

    async execute(args, context) {
        const userId = context.userId;
        if (!userId) return '未登录，无法获取错题统计';

        // 获取错题总数
        const totalErrors = await get(
            `SELECT COUNT(*) as count FROM practice_records WHERE user_id = ? AND is_correct = 0`,
            [userId]
        );

        if (totalErrors.count === 0) {
            return JSON.stringify({
                totalErrors: 0,
                message: '暂无错题记录，继续加油！'
            });
        }

        // 按题型分布
        const byType = await all(
            `SELECT type, COUNT(*) as count FROM practice_records
             WHERE user_id = ? AND is_correct = 0 GROUP BY type ORDER BY count DESC`,
            [userId]
        );

        // 高频错词（错 2 次以上）
        const frequentErrors = await all(
            `SELECT word, meaning, COUNT(*) as error_count, MAX(created_at) as last_error_time
             FROM practice_records
             WHERE user_id = ? AND is_correct = 0
             GROUP BY word ORDER BY error_count DESC LIMIT 10`,
            [userId]
        );

        // 按维度分布（从 user_skill_points 获取）
        const byDimension = await all(
            `SELECT dimension, COUNT(*) as count
             FROM user_skill_points
             WHERE user_id = ? AND mastery_level < 2
             GROUP BY dimension ORDER BY count DESC`,
            [userId]
        );

        return JSON.stringify({
            totalErrors: totalErrors.count,
            byType: byType.map(t => ({ type: t.type, count: t.count })),
            byDimension: byDimension.map(d => ({ dimension: d.dimension, weakCount: d.count })),
            frequentErrors: frequentErrors.map(e => ({
                word: e.word,
                meaning: e.meaning,
                errorCount: e.error_count,
                lastErrorAt: e.last_error_time
            }))
        });
    }
};
