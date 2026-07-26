const express = require('express');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取单词列表（支持分页、搜索、字母筛选）
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 100, letter, search, freq_min, freq_max } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (letter) {
            whereClause += ' AND first_letter = ?';
            params.push(letter.toUpperCase());
        }
        
        if (search) {
            whereClause += ' AND (word LIKE ? OR meaning LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        if (freq_min) {
            whereClause += ' AND freq >= ?';
            params.push(parseInt(freq_min));
        }
        
        if (freq_max) {
            whereClause += ' AND freq <= ?';
            params.push(parseInt(freq_max));
        }
        
        // 获取总数
        const countResult = await get(`SELECT COUNT(*) as total FROM words ${whereClause}`, params);
        
        // 获取单词列表
        const words = await all(
            `SELECT * FROM words ${whereClause} ORDER BY id LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );
        
        res.json({
            success: true,
            data: {
                words,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.total,
                    totalPages: Math.ceil(countResult.total / parseInt(limit))
                }
            }
        });
    } catch (err) {
        console.error('获取单词列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取单个单词详情
router.get('/:id', async (req, res) => {
    try {
        const word = await get('SELECT * FROM words WHERE id = ?', [req.params.id]);
        if (!word) {
            return res.status(404).json({ success: false, message: '单词不存在' });
        }
        res.json({ success: true, data: word });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取随机单词（支持频率加权）
router.get('/random/weighted', async (req, res) => {
    try {
        const { count = 1, freq_weight = 'true' } = req.query;
        
        let words;
        if (freq_weight === 'true') {
            // 频率加权随机：freq 5权重10，4权重5，3权重2，2权重1，1权重0.5
            words = await all(`
                SELECT * FROM words 
                ORDER BY 
                    CASE freq
                        WHEN 5 THEN 10 * RANDOM()
                        WHEN 4 THEN 5 * RANDOM()
                        WHEN 3 THEN 2 * RANDOM()
                        WHEN 2 THEN 1 * RANDOM()
                        WHEN 1 THEN 0.5 * RANDOM()
                        ELSE RANDOM()
                    END DESC
                LIMIT ?
            `, [parseInt(count)]);
        } else {
            words = await all('SELECT * FROM words ORDER BY RANDOM() LIMIT ?', [parseInt(count)]);
        }
        
        res.json({ success: true, data: words });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取按字母分组的单词统计
router.get('/stats/by-letter', async (req, res) => {
    try {
        const stats = await all(`
            SELECT first_letter, COUNT(*) as count, 
                   AVG(freq) as avg_freq,
                   SUM(CASE WHEN freq >= 4 THEN 1 ELSE 0 END) as high_freq_count
            FROM words 
            GROUP BY first_letter 
            ORDER BY first_letter
        `);
        res.json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 需要登录的接口 ==========

// 获取用户的学习记录（收藏、正确/错误次数）
router.get('/user/progress', authMiddleware, async (req, res) => {
    try {
        const userWords = await all(`
            SELECT uw.*, w.word, w.phonetic, w.meaning, w.freq
            FROM user_words uw
            JOIN words w ON uw.word_id = w.id
            WHERE uw.user_id = ?
            ORDER BY uw.last_practiced DESC
        `, [req.userId]);
        
        res.json({ success: true, data: userWords });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新用户单词学习记录
router.post('/user/progress', authMiddleware, async (req, res) => {
    try {
        const { word_id, is_correct, is_favorite } = req.body;
        
        // 检查是否已有记录
        const existing = await get(
            'SELECT * FROM user_words WHERE user_id = ? AND word_id = ?',
            [req.userId, word_id]
        );
        
        if (existing) {
            // 更新记录
            const correctInc = is_correct ? 1 : 0;
            const wrongInc = is_correct ? 0 : 1;
            await run(`
                UPDATE user_words 
                SET correct_count = correct_count + ?,
                    wrong_count = wrong_count + ?,
                    is_favorite = COALESCE(?, is_favorite),
                    last_practiced = CURRENT_TIMESTAMP
                WHERE user_id = ? AND word_id = ?
            `, [correctInc, wrongInc, is_favorite, req.userId, word_id]);
        } else {
            // 创建新记录
            await run(`
                INSERT INTO user_words (user_id, word_id, correct_count, wrong_count, is_favorite, last_practiced)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [req.userId, word_id, is_correct ? 1 : 0, is_correct ? 0 : 1, is_favorite || 0]);
        }
        
        res.json({ success: true, message: '学习记录已更新' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 切换收藏状态
router.post('/:id/favorite', authMiddleware, async (req, res) => {
    try {
        const wordId = req.params.id;
        const existing = await get(
            'SELECT * FROM user_words WHERE user_id = ? AND word_id = ?',
            [req.userId, wordId]
        );
        
        if (existing) {
            const newFavorite = existing.is_favorite ? 0 : 1;
            await run(
                'UPDATE user_words SET is_favorite = ? WHERE user_id = ? AND word_id = ?',
                [newFavorite, req.userId, wordId]
            );
            res.json({ success: true, data: { is_favorite: newFavorite } });
        } else {
            await run(
                'INSERT INTO user_words (user_id, word_id, is_favorite) VALUES (?, ?, 1)',
                [req.userId, wordId]
            );
            res.json({ success: true, data: { is_favorite: 1 } });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取用户收藏的单词
router.get('/user/favorites', authMiddleware, async (req, res) => {
    try {
        const favorites = await all(`
            SELECT w.*, uw.correct_count, uw.wrong_count, uw.last_practiced
            FROM user_words uw
            JOIN words w ON uw.word_id = w.id
            WHERE uw.user_id = ? AND uw.is_favorite = 1
            ORDER BY uw.last_practiced DESC
        `, [req.userId]);
        
        res.json({ success: true, data: favorites });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
