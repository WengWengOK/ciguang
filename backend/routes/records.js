const express = require('express');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ========== 能力画像更新辅助函数 ==========
// 在答题记录保存后异步更新能力画像，不阻塞主流程
async function updateProfileAsync(userId, dimension, isCorrect, skillPoint) {
    try {
        const profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);

        if (!profile) {
            await run('INSERT INTO user_profiles (user_id) VALUES (?)', [userId]);
        }

        const scoreColumn = {
            vocabulary: 'vocabulary_score',
            grammar: 'grammar_score',
            reading: 'reading_score',
            translation: 'translation_score',
            writing: 'writing_score'
        }[dimension];

        if (!scoreColumn) return;

        const currentProfile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
        const oldScore = currentProfile[scoreColumn];
        const performanceScore = isCorrect ? 100 : 30;
        const newScore = Math.max(0, Math.min(100, Math.round(oldScore * 0.85 + performanceScore * 0.15)));

        await run(`
            UPDATE user_profiles
            SET ${scoreColumn} = ?,
                total_answers = total_answers + 1,
                total_correct = total_correct + ?,
                last_updated = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `, [newScore, isCorrect ? 1 : 0, userId]);

        // 更新知识点明细
        if (skillPoint) {
            const existing = await get(
                'SELECT * FROM user_skill_points WHERE user_id = ? AND dimension = ? AND skill_point = ?',
                [userId, dimension, skillPoint]
            );

            if (existing) {
                const newConsecutive = isCorrect ? existing.consecutive_correct + 1 : 0;
                const newTotal = existing.total_attempts + 1;
                const newCorrect = existing.correct_attempts + (isCorrect ? 1 : 0);
                const accuracy = newCorrect / newTotal;

                let masteryLevel = 0;
                if (accuracy >= 0.7 && newConsecutive >= 3) masteryLevel = 2;
                else if (accuracy >= 0.5) masteryLevel = 1;

                await run(`
                    UPDATE user_skill_points
                    SET total_attempts = ?, correct_attempts = ?, consecutive_correct = ?, mastery_level = ?, last_practiced = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND dimension = ? AND skill_point = ?
                `, [newTotal, newCorrect, newConsecutive, masteryLevel, userId, dimension, skillPoint]);
            } else {
                await run(`
                    INSERT INTO user_skill_points (user_id, dimension, skill_point, total_attempts, correct_attempts, consecutive_correct, mastery_level, last_practiced)
                    VALUES (?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [userId, dimension, skillPoint, isCorrect ? 1 : 0, isCorrect ? 1 : 0, isCorrect ? 1 : 0]);
            }
        }
    } catch (err) {
        console.error('能力画像更新失败（非阻塞）:', err.message);
    }
}

// ========== 例句练习记录 ==========
router.post('/practice', authMiddleware, async (req, res) => {
    try {
        const { word_id, user_answer, reference_answer, score, is_correct, mode } = req.body;
        
        const result = await run(`
            INSERT INTO practice_records (user_id, word_id, user_answer, reference_answer, score, is_correct, mode)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [req.userId, word_id, user_answer, reference_answer, score, is_correct ? 1 : 0, mode]);
        
        // 更新每日统计
        await updateDailyStats(req.userId, 'practice', is_correct);

        // 异步更新能力画像（词汇维度）
        updateProfileAsync(req.userId, 'vocabulary', is_correct, mode || 'word_practice');

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/practice', authMiddleware, async (req, res) => {
    try {
        const records = await all(`
            SELECT pr.*, w.word
            FROM practice_records pr
            LEFT JOIN words w ON pr.word_id = w.id
            WHERE pr.user_id = ?
            ORDER BY pr.created_at DESC
            LIMIT 50
        `, [req.userId]);
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 阅读练习记录 ==========
router.post('/reading', authMiddleware, async (req, res) => {
    try {
        const { passage_title, passage_content, questions, answers, user_answers, score, total_questions } = req.body;
        
        const result = await run(`
            INSERT INTO reading_records (user_id, passage_title, passage_content, questions, answers, user_answers, score, total_questions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [req.userId, passage_title, passage_content, JSON.stringify(questions), JSON.stringify(answers), JSON.stringify(user_answers), score, total_questions]);
        
        await updateDailyStats(req.userId, 'reading', score / total_questions >= 0.6);

        // 异步更新能力画像（阅读维度）
        updateProfileAsync(req.userId, 'reading', score / total_questions >= 0.6, passage_title);

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/reading', authMiddleware, async (req, res) => {
    try {
        const records = await all(`
            SELECT * FROM reading_records
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.userId]);
        
        // 解析JSON字段
        records.forEach(r => {
            try { r.questions = JSON.parse(r.questions); } catch(e) {}
            try { r.answers = JSON.parse(r.answers); } catch(e) {}
            try { r.user_answers = JSON.parse(r.user_answers); } catch(e) {}
        });
        
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 翻译练习记录 ==========
router.post('/translation', authMiddleware, async (req, res) => {
    try {
        const { source_text, user_translation, reference_translation, ai_feedback, score, theme } = req.body;
        
        const result = await run(`
            INSERT INTO translation_records (user_id, source_text, user_translation, reference_translation, ai_feedback, score, theme)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [req.userId, source_text, user_translation, reference_translation, ai_feedback, score, theme]);
        
        await updateDailyStats(req.userId, 'translation', score >= 60);

        // 异步更新能力画像（翻译维度）
        updateProfileAsync(req.userId, 'translation', score >= 60, theme);

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/translation', authMiddleware, async (req, res) => {
    try {
        const records = await all(`
            SELECT * FROM translation_records
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.userId]);
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 选词填空记录 ==========
router.post('/cloze', authMiddleware, async (req, res) => {
    try {
        const { passage_title, passage_content, blanks, user_answers, correct_answers, score, total_blanks } = req.body;
        
        const result = await run(`
            INSERT INTO cloze_records (user_id, passage_title, passage_content, blanks, user_answers, correct_answers, score, total_blanks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [req.userId, passage_title, passage_content, JSON.stringify(blanks), JSON.stringify(user_answers), JSON.stringify(correct_answers), score, total_blanks]);
        
        await updateDailyStats(req.userId, 'cloze', score / total_blanks >= 0.6);

        // 异步更新能力画像（语法维度，完形填空主要考查语法和词汇运用）
        updateProfileAsync(req.userId, 'grammar', score / total_blanks >= 0.6, passage_title);

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/cloze', authMiddleware, async (req, res) => {
    try {
        const records = await all(`
            SELECT * FROM cloze_records
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.userId]);
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 单词记忆记录 ==========
router.post('/memory', authMiddleware, async (req, res) => {
    try {
        const { word_id, word, is_remembered } = req.body;
        
        const result = await run(`
            INSERT INTO memory_records (user_id, word_id, word, is_remembered)
            VALUES (?, ?, ?, ?)
        `, [req.userId, word_id, word, is_remembered ? 1 : 0]);
        
        await updateDailyStats(req.userId, 'memory', is_remembered);

        // 异步更新能力画像（词汇维度）
        updateProfileAsync(req.userId, 'vocabulary', is_remembered, word);

        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/memory', authMiddleware, async (req, res) => {
    try {
        const records = await all(`
            SELECT mr.*, w.meaning, w.phonetic
            FROM memory_records mr
            LEFT JOIN words w ON mr.word_id = w.id
            WHERE mr.user_id = ?
            ORDER BY mr.created_at DESC
            LIMIT 100
        `, [req.userId]);
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 保存的练习 ==========
router.post('/saved', authMiddleware, async (req, res) => {
    try {
        const { type, title, content, data } = req.body;
        
        const result = await run(`
            INSERT INTO saved_exercises (user_id, type, title, content, data)
            VALUES (?, ?, ?, ?, ?)
        `, [req.userId, type, title, content, JSON.stringify(data)]);
        
        res.json({ success: true, data: { id: result.id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/saved', authMiddleware, async (req, res) => {
    try {
        const { type } = req.query;
        let sql = 'SELECT * FROM saved_exercises WHERE user_id = ?';
        const params = [req.userId];
        
        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        
        sql += ' ORDER BY created_at DESC';
        
        const records = await all(sql, params);
        records.forEach(r => {
            try { r.data = JSON.parse(r.data); } catch(e) {}
        });
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/saved/:id', authMiddleware, async (req, res) => {
    try {
        await run('DELETE FROM saved_exercises WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        res.json({ success: true, message: '已删除' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 统计接口 ==========
router.get('/stats/overview', authMiddleware, async (req, res) => {
    try {
        // 各模块练习次数
        const practiceCount = await get('SELECT COUNT(*) as count FROM practice_records WHERE user_id = ?', [req.userId]);
        const readingCount = await get('SELECT COUNT(*) as count FROM reading_records WHERE user_id = ?', [req.userId]);
        const translationCount = await get('SELECT COUNT(*) as count FROM translation_records WHERE user_id = ?', [req.userId]);
        const clozeCount = await get('SELECT COUNT(*) as count FROM cloze_records WHERE user_id = ?', [req.userId]);
        const memoryCount = await get('SELECT COUNT(*) as count FROM memory_records WHERE user_id = ?', [req.userId]);
        
        // 正确率统计
        const practiceAccuracy = await get(`
            SELECT ROUND(AVG(is_correct) * 100, 1) as accuracy 
            FROM practice_records WHERE user_id = ?
        `, [req.userId]);
        
        // 收藏单词数
        const favoriteCount = await get(`
            SELECT COUNT(*) as count FROM user_words WHERE user_id = ? AND is_favorite = 1
        `, [req.userId]);
        
        // 最近7天学习数据
        const weeklyStats = await all(`
            SELECT date, 
                   practice_count + reading_count + translation_count + cloze_count + memory_count as total,
                   correct_count, total_count
            FROM daily_stats
            WHERE user_id = ? AND date >= date('now', '-7 days')
            ORDER BY date
        `, [req.userId]);
        
        res.json({
            success: true,
            data: {
                counts: {
                    practice: practiceCount.count,
                    reading: readingCount.count,
                    translation: translationCount.count,
                    cloze: clozeCount.count,
                    memory: memoryCount.count,
                    favorites: favoriteCount.count
                },
                accuracy: {
                    practice: practiceAccuracy.accuracy || 0
                },
                weekly: weeklyStats
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 辅助函数 ==========
async function updateDailyStats(userId, module, isCorrect) {
    const today = new Date().toISOString().split('T')[0];
    
    // 检查今日记录是否存在
    const existing = await get(
        'SELECT * FROM daily_stats WHERE user_id = ? AND date = ?',
        [userId, today]
    );
    
    if (existing) {
        const updates = [];
        const params = [];
        
        if (module === 'practice') { updates.push('practice_count = practice_count + 1'); }
        else if (module === 'reading') { updates.push('reading_count = reading_count + 1'); }
        else if (module === 'translation') { updates.push('translation_count = translation_count + 1'); }
        else if (module === 'cloze') { updates.push('cloze_count = cloze_count + 1'); }
        else if (module === 'memory') { updates.push('memory_count = memory_count + 1'); }
        
        updates.push('total_count = total_count + 1');
        if (isCorrect) updates.push('correct_count = correct_count + 1');
        
        await run(
            `UPDATE daily_stats SET ${updates.join(', ')} WHERE user_id = ? AND date = ?`,
            [userId, today]
        );
    } else {
        const counts = { practice: 0, reading: 0, translation: 0, cloze: 0, memory: 0 };
        counts[module] = 1;
        
        await run(`
            INSERT INTO daily_stats (user_id, date, practice_count, reading_count, translation_count, cloze_count, memory_count, correct_count, total_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, today, counts.practice, counts.reading, counts.translation, counts.cloze, counts.memory, isCorrect ? 1 : 0, 1]);
    }
}

module.exports = router;
