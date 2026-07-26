const express = require('express');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有同步接口都需要登录认证
router.use(authMiddleware);

// ========== 通用数据存取接口 ==========

// 保存单条用户数据
router.post('/data/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
            return res.status(400).json({ success: false, message: '缺少value参数' });
        }

        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

        await run(`
            INSERT INTO user_data (user_id, data_key, data_value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, data_key)
            DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
        `, [req.userId, key, valueStr, valueStr]);

        res.json({ success: true, message: '数据已同步到云端' });
    } catch (err) {
        console.error('保存用户数据失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取单条用户数据
router.get('/data/:key', async (req, res) => {
    try {
        const { key } = req.params;

        const row = await get(
            'SELECT data_value, updated_at FROM user_data WHERE user_id = ? AND data_key = ?',
            [req.userId, key]
        );

        if (!row) {
            return res.json({ success: true, data: null });
        }

        let value;
        try {
            value = JSON.parse(row.data_value);
        } catch (e) {
            value = row.data_value;
        }

        res.json({ success: true, data: { value, updated_at: row.updated_at } });
    } catch (err) {
        console.error('获取用户数据失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 全量同步接口 ==========

// 上传所有本地数据到云端
router.post('/upload', async (req, res) => {
    try {
        const { settings, moduleStats, activities } = req.body;
        const results = [];

        // 同步设置
        if (settings) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'settings', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(settings), JSON.stringify(settings)]);
            results.push('settings');
        }

        // 同步模块统计
        if (moduleStats) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'moduleStats', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(moduleStats), JSON.stringify(moduleStats)]);
            results.push('moduleStats');
        }

        // 同步活动记录
        if (activities && Array.isArray(activities)) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'activities', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(activities), JSON.stringify(activities)]);
            results.push('activities');
        }

        res.json({
            success: true,
            message: '数据已同步到云端',
            data: { synced: results, syncTime: new Date().toISOString() }
        });
    } catch (err) {
        console.error('上传数据失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 从云端下载所有数据
router.get('/download', async (req, res) => {
    try {
        const rows = await all(
            'SELECT data_key, data_value, updated_at FROM user_data WHERE user_id = ?',
            [req.userId]
        );

        const data = {};
        rows.forEach(row => {
            try {
                data[row.data_key] = JSON.parse(row.data_value);
            } catch (e) {
                data[row.data_key] = row.data_value;
            }
        });

        // 同时获取学习统计概览
        let statsOverview = null;
        try {
            const practiceCount = await get('SELECT COUNT(*) as count FROM practice_records WHERE user_id = ?', [req.userId]);
            const readingCount = await get('SELECT COUNT(*) as count FROM reading_records WHERE user_id = ?', [req.userId]);
            const translationCount = await get('SELECT COUNT(*) as count FROM translation_records WHERE user_id = ?', [req.userId]);
            const clozeCount = await get('SELECT COUNT(*) as count FROM cloze_records WHERE user_id = ?', [req.userId]);
            const memoryCount = await get('SELECT COUNT(*) as count FROM memory_records WHERE user_id = ?', [req.userId]);
            const favoriteCount = await get('SELECT COUNT(*) as count FROM user_words WHERE user_id = ? AND is_favorite = 1', [req.userId]);

            statsOverview = {
                counts: {
                    practice: practiceCount.count,
                    reading: readingCount.count,
                    translation: translationCount.count,
                    cloze: clozeCount.count,
                    memory: memoryCount.count,
                    favorites: favoriteCount.count
                }
            };
        } catch (e) {
            // 统计获取失败不影响主流程
        }

        res.json({
            success: true,
            data: {
                ...data,
                statsOverview,
                syncTime: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('下载数据失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 增量同步接口 ==========

// 增量同步：只上传本地新增/修改的数据，同时下载云端最新数据
router.post('/sync', async (req, res) => {
    try {
        const { settings, moduleStats, activities, lastSyncTime } = req.body;

        // 1. 上传本地数据
        if (settings) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'settings', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(settings), JSON.stringify(settings)]);
        }

        if (moduleStats) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'moduleStats', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(moduleStats), JSON.stringify(moduleStats)]);
        }

        if (activities && Array.isArray(activities)) {
            await run(`
                INSERT INTO user_data (user_id, data_key, data_value, updated_at)
                VALUES (?, 'activities', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_value = ?, updated_at = CURRENT_TIMESTAMP
            `, [req.userId, JSON.stringify(activities), JSON.stringify(activities)]);
        }

        // 2. 下载云端所有数据
        const rows = await all(
            'SELECT data_key, data_value, updated_at FROM user_data WHERE user_id = ?',
            [req.userId]
        );

        const cloudData = {};
        rows.forEach(row => {
            try {
                cloudData[row.data_key] = JSON.parse(row.data_value);
            } catch (e) {
                cloudData[row.data_key] = row.data_value;
            }
        });

        res.json({
            success: true,
            data: {
                ...cloudData,
                syncTime: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('增量同步失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
