/**
 * RAG 知识检索 API 路由
 * 提供单词向量化索引、知识检索、索引统计、上下文构建能力
 * 所有接口均需 JWT 认证，并施加每分钟 20 次的限流
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const { authMiddleware } = require('../middleware/auth');
const { get } = require('../database/db');
const retriever = require('../rag/retriever');
const { getIndexStats } = require('../rag/vectorStore');

const router = express.Router();

// 所有 RAG 接口都需要登录认证
router.use(authMiddleware);

// RAG 接口限流：每分钟最多 20 次请求
const ragRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});
router.use(ragRateLimit);

/**
 * POST /api/rag/index
 * 索引单词（触发单词向量化）
 * body: { wordId: number } 或 { word: { id, word, meaning, ... } }
 */
router.post('/index', async (req, res) => {
    try {
        const { wordId, word } = req.body;

        if (!wordId && !word) {
            return res.status(400).json({ success: false, message: '缺少 wordId 或 word 参数' });
        }

        let wordObj = null;
        // 优先按 wordId 从数据库查询完整单词信息
        if (wordId) {
            wordObj = await get('SELECT * FROM words WHERE id = ?', [wordId]);
        }
        // 若未查到且请求体传入了 word 对象，则直接使用
        if (!wordObj && word) {
            wordObj = word;
        }

        if (!wordObj || !wordObj.id) {
            return res.status(404).json({ success: false, message: '未找到对应单词' });
        }

        const result = await retriever.indexWord(wordObj);

        res.json({
            success: true,
            data: result,
            fallback: !process.env.DASHSCOPE_API_KEY
        });
    } catch (err) {
        console.error('索引单词失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/rag/search
 * 搜索相关知识
 * body: { query: string, limit?: number, contentType?: string }
 */
router.post('/search', async (req, res) => {
    try {
        const { query, limit = 5, contentType } = req.body;

        if (!query) {
            return res.status(400).json({ success: false, message: '缺少 query 参数' });
        }

        const results = await retriever.retrieve(query, limit, contentType);

        res.json({
            success: true,
            data: {
                query,
                results,
                count: results.length,
                fallback: !process.env.DASHSCOPE_API_KEY
            }
        });
    } catch (err) {
        console.error('搜索知识失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/rag/stats
 * 获取索引统计
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await getIndexStats();
        res.json({
            success: true,
            data: {
                ...stats,
                embeddingMode: process.env.DASHSCOPE_API_KEY ? 'dashscope' : 'local-tfidf'
            }
        });
    } catch (err) {
        console.error('获取索引统计失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/rag/build-context
 * 构建 RAG 上下文（检索结果格式化为带来源标注的文本）
 * body: { query: string, limit?: number }
 */
router.post('/build-context', async (req, res) => {
    try {
        const { query, limit = 5 } = req.body;

        if (!query) {
            return res.status(400).json({ success: false, message: '缺少 query 参数' });
        }

        const result = await retriever.buildContext(query, limit);

        res.json({
            success: true,
            data: result,
            fallback: !process.env.DASHSCOPE_API_KEY
        });
    } catch (err) {
        console.error('构建上下文失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
