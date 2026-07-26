const express = require('express');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有画像接口都需要登录认证
router.use(authMiddleware);

// 能力维度定义
const DIMENSIONS = {
    vocabulary: 'vocabulary_score',       // 词汇量
    grammar: 'grammar_score',             // 语法掌握度
    reading: 'reading_score',             // 阅读理解力
    translation: 'translation_score',     // 翻译能力
    writing: 'writing_score'              // 写作水平
};

// 维度中文名称映射
const DIMENSION_LABELS = {
    vocabulary: '词汇量',
    grammar: '语法掌握',
    reading: '阅读理解',
    translation: '翻译能力',
    writing: '写作水平'
};

// ========== 获取用户能力画像 ==========

router.get('/profile', async (req, res) => {
    try {
        let profile = await get(
            'SELECT * FROM user_profiles WHERE user_id = ?',
            [req.userId]
        );

        // 如果没有画像记录，创建默认画像
        if (!profile) {
            await run(`
                INSERT INTO user_profiles (user_id) VALUES (?)
            `, [req.userId]);
            profile = await get(
                'SELECT * FROM user_profiles WHERE user_id = ?',
                [req.userId]
            );
        }

        // 获取各维度薄弱知识点
        const weakPoints = await all(`
            SELECT dimension, skill_point, total_attempts, correct_attempts, mastery_level
            FROM user_skill_points
            WHERE user_id = ? AND mastery_level < 2
            ORDER BY (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC
            LIMIT 10
        `, [req.userId]);

        // 计算综合得分
        const overallScore = Math.round(
            (profile.vocabulary_score + profile.grammar_score +
             profile.reading_score + profile.translation_score +
             profile.writing_score) / 5
        );

        // 计算总体正确率
        const accuracy = profile.total_answers > 0
            ? Math.round((profile.total_correct / profile.total_answers) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                dimensions: {
                    vocabulary: profile.vocabulary_score,
                    grammar: profile.grammar_score,
                    reading: profile.reading_score,
                    translation: profile.translation_score,
                    writing: profile.writing_score
                },
                dimensionLabels: DIMENSION_LABELS,
                overallScore,
                accuracy,
                totalAnswers: profile.total_answers,
                totalCorrect: profile.total_correct,
                weakPoints: weakPoints.map(wp => ({
                    dimension: wp.dimension,
                    dimensionLabel: DIMENSION_LABELS[wp.dimension] || wp.dimension,
                    skillPoint: wp.skill_point,
                    masteryLevel: wp.mastery_level,
                    accuracy: wp.total_attempts > 0
                        ? Math.round((wp.correct_attempts / wp.total_attempts) * 100)
                        : 0
                })),
                lastUpdated: profile.last_updated
            }
        });
    } catch (err) {
        console.error('获取能力画像失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 更新能力画像（答题后调用） ==========

router.post('/profile/update', async (req, res) => {
    try {
        const { dimension, is_correct, skill_point, response_time } = req.body;

        // 验证维度参数
        const validDimensions = Object.keys(DIMENSIONS);
        if (!validDimensions.includes(dimension)) {
            return res.status(400).json({
                success: false,
                message: `无效的维度参数，可选值: ${validDimensions.join(', ')}`
            });
        }

        const isCorrect = is_correct ? 1 : 0;
        const responseTime = response_time || null;

        // 1. 更新或创建用户画像主表
        let profile = await get(
            'SELECT * FROM user_profiles WHERE user_id = ?',
            [req.userId]
        );

        if (!profile) {
            await run('INSERT INTO user_profiles (user_id) VALUES (?)', [req.userId]);
            profile = await get('SELECT * FROM user_profiles WHERE user_id = ?', [req.userId]);
        }

        // 计算新的维度分数
        // 使用加权移动平均：新分 = 旧分 * 0.85 + 本次表现 * 0.15
        // 本次表现：正确=100，错误=30（不会直接降到0，保留基础分）
        const performanceScore = isCorrect ? 100 : 30;
        const oldDimensionScore = profile[DIMENSIONS[dimension]];
        const newDimensionScore = Math.round(oldDimensionScore * 0.85 + performanceScore * 0.15);

        // 确保分数在0-100之间
        const clampedScore = Math.max(0, Math.min(100, newDimensionScore));

        // 更新画像主表
        const scoreColumn = DIMENSIONS[dimension];
        await run(`
            UPDATE user_profiles
            SET ${scoreColumn} = ?,
                total_answers = total_answers + 1,
                total_correct = total_correct + ?,
                last_updated = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `, [clampedScore, isCorrect, req.userId]);

        // 2. 更新知识点明细表（如果提供了skill_point）
        if (skill_point) {
            let skillRecord = await get(
                'SELECT * FROM user_skill_points WHERE user_id = ? AND dimension = ? AND skill_point = ?',
                [req.userId, dimension, skill_point]
            );

            if (skillRecord) {
                // 更新已有记录
                const newConsecutive = isCorrect
                    ? skillRecord.consecutive_correct + 1
                    : 0;

                // 掌握度判定：
                // 0 = 未掌握（正确率<50%）
                // 1 = 学习中（正确率50-70%）
                // 2 = 已掌握（正确率>=70%且连续正确>=3）
                const newTotal = skillRecord.total_attempts + 1;
                const newCorrect = skillRecord.correct_attempts + isCorrect;
                const accuracy = newCorrect / newTotal;

                let masteryLevel = 0;
                if (accuracy >= 0.7 && newConsecutive >= 3) {
                    masteryLevel = 2;
                } else if (accuracy >= 0.5) {
                    masteryLevel = 1;
                }

                await run(`
                    UPDATE user_skill_points
                    SET total_attempts = ?,
                        correct_attempts = ?,
                        consecutive_correct = ?,
                        mastery_level = ?,
                        last_practiced = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND dimension = ? AND skill_point = ?
                `, [newTotal, newCorrect, newConsecutive, masteryLevel, req.userId, dimension, skill_point]);
            } else {
                // 创建新记录
                const masteryLevel = isCorrect ? 1 : 0;
                await run(`
                    INSERT INTO user_skill_points
                    (user_id, dimension, skill_point, total_attempts, correct_attempts, consecutive_correct, mastery_level, last_practiced)
                    VALUES (?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
                `, [req.userId, dimension, skill_point, isCorrect, isCorrect ? 1 : 0, masteryLevel]);
            }
        }

        // 3. 返回更新后的画像
        const updatedProfile = await get(
            'SELECT * FROM user_profiles WHERE user_id = ?',
            [req.userId]
        );

        const overallScore = Math.round(
            (updatedProfile.vocabulary_score + updatedProfile.grammar_score +
             updatedProfile.reading_score + updatedProfile.translation_score +
             updatedProfile.writing_score) / 5
        );

        res.json({
            success: true,
            data: {
                dimension,
                dimensionLabel: DIMENSION_LABELS[dimension],
                newScore: clampedScore,
                scoreChange: clampedScore - oldDimensionScore,
                overallScore,
                isCorrect: !!isCorrect
            }
        });
    } catch (err) {
        console.error('更新能力画像失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取知识点掌握情况 ==========

router.get('/skills/:dimension', async (req, res) => {
    try {
        const { dimension } = req.params;

        const validDimensions = Object.keys(DIMENSIONS);
        if (!validDimensions.includes(dimension)) {
            return res.status(400).json({
                success: false,
                message: `无效的维度参数，可选值: ${validDimensions.join(', ')}`
            });
        }

        const skills = await all(`
            SELECT skill_point, total_attempts, correct_attempts, consecutive_correct, mastery_level, last_practiced
            FROM user_skill_points
            WHERE user_id = ? AND dimension = ?
            ORDER BY mastery_level ASC, (CAST(correct_attempts AS FLOAT) / MAX(total_attempts, 1)) ASC
        `, [req.userId, dimension]);

        res.json({
            success: true,
            data: skills.map(s => ({
                skillPoint: s.skill_point,
                totalAttempts: s.total_attempts,
                correctAttempts: s.correct_attempts,
                accuracy: s.total_attempts > 0
                    ? Math.round((s.correct_attempts / s.total_attempts) * 100)
                    : 0,
                consecutiveCorrect: s.consecutive_correct,
                masteryLevel: s.mastery_level,
                masteryLabel: ['未掌握', '学习中', '已掌握'][s.mastery_level] || '未知',
                lastPracticed: s.last_practiced
            }))
        });
    } catch (err) {
        console.error('获取知识点掌握情况失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 重置能力画像 ==========

router.post('/profile/reset', async (req, res) => {
    try {
        await run(`
            UPDATE user_profiles
            SET vocabulary_score = 50,
                grammar_score = 50,
                reading_score = 50,
                translation_score = 50,
                writing_score = 50,
                total_answers = 0,
                total_correct = 0,
                last_updated = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `, [req.userId]);

        await run('DELETE FROM user_skill_points WHERE user_id = ?', [req.userId]);

        res.json({ success: true, message: '能力画像已重置' });
    } catch (err) {
        console.error('重置能力画像失败:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
