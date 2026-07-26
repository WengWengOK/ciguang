const express = require('express');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有复习接口都需要登录认证
router.use(authMiddleware);

// 艾宾浩斯遗忘曲线复习间隔序列（毫秒）
// 第1次→20分钟，第2次→1小时，第3次→9小时，第4次→1天，第5次→2天，第6次→6天，第7次→31天
const REVIEW_INTERVALS = [
    20 * 60 * 1000,          // 20分钟
    60 * 60 * 1000,          // 1小时
    9 * 60 * 60 * 1000,      // 9小时
    24 * 60 * 60 * 1000,     // 1天
    2 * 24 * 60 * 60 * 1000, // 2天
    6 * 24 * 60 * 60 * 1000, // 6天
    31 * 24 * 60 * 60 * 1000 // 31天
];

// ========== 添加复习项目 ==========
// 当用户答错或学习新词时，将项目加入复习队列
router.post('/add', async (req, res) => {
    try {
        const { item_type, item_id, word, meaning, question, correct_answer, user_answer } = req.body;

        if (!item_type) {
            return res.status(400).json({ success: false, message: 'item_type 不能为空' });
        }

        // 检查是否已存在相同项目的复习记录（未归档）
        const existing = await get(
            `SELECT * FROM review_schedule 
             WHERE user_id = ? AND item_type = ? AND (item_id = ? OR word = ?) AND is_archived = 0`,
            [req.userId, item_type, item_id || null, word || null]
        );

        if (existing) {
            // 已存在，重置复习计数（答错重置为第1阶段）
            const nextReviewTime = new Date(Date.now() + REVIEW_INTERVALS[0]).toISOString();
            await run(
                `UPDATE review_schedule 
                 SET review_count = 0, 
                     next_review_time = ?,
                     last_result = 0,
                     user_answer = ?,
                     is_archived = 0
                 WHERE id = ?`,
                [nextReviewTime, user_answer || null, existing.id]
            );
            return res.json({ success: true, data: { id: existing.id, reset: true } });
        }

        // 创建新复习记录，下次复习时间为20分钟后
        const nextReviewTime = new Date(Date.now() + REVIEW_INTERVALS[0]).toISOString();
        const result = await run(
            `INSERT INTO review_schedule 
             (user_id, item_type, item_id, word, meaning, question, correct_answer, user_answer, review_count, next_review_time, last_result)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
            [req.userId, item_type, item_id || null, word || null, meaning || null,
             question || null, correct_answer || null, user_answer || null, nextReviewTime]
        );

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        console.error('添加复习项目失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取复习队列 ==========
// 返回当前需要复习的项目列表
router.get('/queue', async (req, res) => {
    try {
        const { limit } = req.query;
        const maxLimit = Math.min(parseInt(limit) || 50, 100);

        const items = await all(
            `SELECT * FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0 AND datetime(next_review_time) <= datetime('now')
             ORDER BY next_review_time ASC
             LIMIT ?`,
            [req.userId, maxLimit]
        );

        // 统计信息
        const stats = await get(
            `SELECT 
                COUNT(*) as total_pending,
                SUM(CASE WHEN review_count = 0 THEN 1 ELSE 0 END) as new_items,
                SUM(CASE WHEN review_count > 0 THEN 1 ELSE 0 END) as review_items
             FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0 AND datetime(next_review_time) <= datetime('now')`,
            [req.userId]
        );

        // 获取今日预计复习数（包含未来24小时内）
        const upcoming = await get(
            `SELECT COUNT(*) as count FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0 
             AND datetime(next_review_time) > datetime('now') 
             AND datetime(next_review_time) <= datetime('now', '+1 day')`,
            [req.userId]
        );

        res.json({
            success: true,
            data: {
                queue: items,
                pendingCount: stats.total_pending || 0,
                newCount: stats.new_items || 0,
                reviewCount: stats.review_items || 0,
                upcoming24h: upcoming.count || 0
            }
        });
    } catch (err) {
        console.error('获取复习队列失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取复习统计 ==========
router.get('/stats', async (req, res) => {
    try {
        const pending = await get(
            `SELECT COUNT(*) as count FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0 AND datetime(next_review_time) <= datetime('now')`,
            [req.userId]
        );

        const total = await get(
            `SELECT COUNT(*) as count FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0`,
            [req.userId]
        );

        const mastered = await get(
            `SELECT COUNT(*) as count FROM review_schedule 
             WHERE user_id = ? AND is_archived = 1`,
            [req.userId]
        );

        // 按类型分组统计
        const byType = await all(
            `SELECT item_type, COUNT(*) as count 
             FROM review_schedule 
             WHERE user_id = ? AND is_archived = 0
             GROUP BY item_type`,
            [req.userId]
        );

        res.json({
            success: true,
            data: {
                pending: pending.count || 0,
                total: total.count || 0,
                mastered: mastered.count || 0,
                byType: byType.reduce((acc, r) => { acc[r.item_type] = r.count; return acc; }, {})
            }
        });
    } catch (err) {
        console.error('获取复习统计失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 提交复习结果 ==========
// 复习时答对→进入下一阶段间隔；复习时答错→重置为第1阶段
router.post('/submit', async (req, res) => {
    try {
        const { review_id, is_correct } = req.body;

        if (!review_id) {
            return res.status(400).json({ success: false, message: 'review_id 不能为空' });
        }

        const item = await get(
            'SELECT * FROM review_schedule WHERE id = ? AND user_id = ?',
            [review_id, req.userId]
        );

        if (!item) {
            return res.status(404).json({ success: false, message: '复习项目不存在' });
        }

        const now = new Date().toISOString();
        let newReviewCount;
        let nextReviewTime;
        let isArchived = 0;

        if (is_correct) {
            // 答对 → 进入下一阶段
            newReviewCount = item.review_count + 1;

            if (newReviewCount >= REVIEW_INTERVALS.length) {
                // 已完成所有复习阶段，归档为已掌握
                isArchived = 1;
                nextReviewTime = now; // 归档时设为当前时间（NOT NULL约束）
            } else {
                // 安排下次复习
                nextReviewTime = new Date(Date.now() + REVIEW_INTERVALS[newReviewCount]).toISOString();
            }
        } else {
            // 答错 → 重置为第1阶段
            newReviewCount = 0;
            nextReviewTime = new Date(Date.now() + REVIEW_INTERVALS[0]).toISOString();
        }

        await run(
            `UPDATE review_schedule 
             SET review_count = ?,
                 next_review_time = ?,
                 last_reviewed = ?,
                 last_result = ?,
                 is_archived = ?
             WHERE id = ?`,
            [newReviewCount, nextReviewTime, now, is_correct ? 1 : 0, isArchived, review_id]
        );

        res.json({
            success: true,
            data: {
                reviewCount: newReviewCount,
                nextReviewTime,
                isMastered: isArchived === 1,
                stage: newReviewCount >= REVIEW_INTERVALS.length ? '已掌握' : `第${newReviewCount + 1}阶段`,
                totalStages: REVIEW_INTERVALS.length
            }
        });
    } catch (err) {
        console.error('提交复习结果失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 归档复习项目 ==========
router.post('/archive/:id', async (req, res) => {
    try {
        await run(
            'UPDATE review_schedule SET is_archived = 1 WHERE id = ? AND user_id = ?',
            [req.params.id, req.userId]
        );
        res.json({ success: true, message: '已归档' });
    } catch (err) {
        console.error('归档复习项目失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 删除复习项目 ==========
router.delete('/:id', async (req, res) => {
    try {
        await run(
            'DELETE FROM review_schedule WHERE id = ? AND user_id = ?',
            [req.params.id, req.userId]
        );
        res.json({ success: true, message: '已删除' });
    } catch (err) {
        console.error('删除复习项目失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
