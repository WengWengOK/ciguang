/**
 * 复习队列工具
 * Agent 可通过此工具获取用户的艾宾浩斯复习队列
 */

const { all, get } = require('../database/db');

module.exports = {
    name: 'get_review_queue',
    description: '获取用户的艾宾浩斯遗忘曲线复习队列。返回需要复习的单词/题目列表，包括复习优先级和上次复习时间。用于提醒用户复习。',
    parameters: {
        type: 'object',
        properties: {
            limit: {
                type: 'integer',
                description: '返回数量上限，默认10'
            }
        },
        required: []
    },

    async execute(args, context) {
        const userId = context.userId;
        const { limit = 10 } = args;

        if (!userId) return '未登录，无法获取复习队列';

        const queue = await all(
            `SELECT id, item_type, content, review_count, next_review_at, priority
             FROM review_items
             WHERE user_id = ? AND status = 'pending' AND next_review_at <= datetime('now')
             ORDER BY priority DESC, next_review_at ASC
             LIMIT ?`,
            [userId, limit]
        );

        if (queue.length === 0) {
            // 检查是否有未来的复习项
            const upcoming = await get(
                `SELECT COUNT(*) as count, MIN(next_review_at) as next_time
                 FROM review_items
                 WHERE user_id = ? AND status = 'pending'`,
                [userId]
            );

            if (upcoming && upcoming.count > 0) {
                return JSON.stringify({
                    status: 'no_due',
                    message: `当前没有需要复习的项目，下次复习时间: ${upcoming.next_time}`,
                    upcomingCount: upcoming.count
                });
            }

            return JSON.stringify({
                status: 'empty',
                message: '复习队列为空，建议学习新内容后添加复习项目'
            });
        }

        return JSON.stringify({
            status: 'has_items',
            dueCount: queue.length,
            items: queue.map(item => ({
                id: item.id,
                type: item.item_type,
                content: item.content,
                reviewCount: item.review_count,
                nextReviewAt: item.next_review_at,
                priority: item.priority
            }))
        });
    }
};
