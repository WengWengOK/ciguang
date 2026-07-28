/**
 * 向量存储服务
 * 基于 SQLite3 存储 embedding 向量，支持余弦相似度检索
 * 表结构：word_embeddings(id, word_id, content_type, content, embedding, created_at)
 * content_type 区分：'word_meaning'(单词释义) / 'example'(例句) / 'knowledge_point'(知识点)
 */
const { run, get, all } = require('../database/db');

const TABLE_NAME = 'word_embeddings';

// 初始化守卫，避免每次调用都执行建表语句
let initPromise = null;

/**
 * 初始化向量存储表（幂等）
 */
async function initVectorStore() {
    await run(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            id INTEGER PRIMARY KEY,
            word_id INTEGER,
            content_type TEXT,
            content TEXT,
            embedding TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    `);
    // 为常用查询字段建立索引，加速检索
    await run(`CREATE INDEX IF NOT EXISTS idx_we_word_id ON ${TABLE_NAME}(word_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_we_content_type ON ${TABLE_NAME}(content_type)`);
}

/**
 * 确保表已初始化（带守卫，并发安全）
 */
function ensureInit() {
    if (!initPromise) {
        initPromise = initVectorStore();
    }
    return initPromise;
}

/**
 * 存储一条 embedding 向量
 * @param {number} wordId 关联的单词 ID
 * @param {string} contentType 内容类型：word_meaning / example / knowledge_point
 * @param {string} content 原始文本内容
 * @param {number[]} embedding 向量（以 JSON 字符串形式存储）
 * @returns {Promise<{id:number, changes:number}>}
 */
async function storeEmbedding(wordId, contentType, content, embedding) {
    try {
        await ensureInit();
        const embeddingJson = JSON.stringify(embedding);
        const result = await run(
            `INSERT INTO ${TABLE_NAME} (word_id, content_type, content, embedding, created_at)
             VALUES (?, ?, ?, ?, datetime('now','localtime'))`,
            [wordId || null, contentType || 'knowledge_point', content || '', embeddingJson]
        );
        return result;
    } catch (err) {
        console.error('存储 embedding 失败:', err.message);
        throw err;
    }
}

/**
 * 计算两个向量的余弦相似度
 * cosine_similarity(a, b) = dot(a,b) / (|a| * |b|)
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 相似度 [-1, 1]
 */
function cosineSimilarity(a, b) {
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
}

/**
 * 检索相似向量（基于余弦相似度）
 * 由于 SQLite 原生不支持向量运算，这里先拉取候选集再在内存中计算相似度排序
 * @param {number[]} queryEmbedding 查询向量
 * @param {number} limit 返回条数（默认 5）
 * @param {string|null} contentType 内容类型过滤（可选）
 * @returns {Promise<Array>} 排序后的相似结果
 */
async function searchSimilar(queryEmbedding, limit = 5, contentType = null) {
    try {
        await ensureInit();

        // 拉取候选集（按类型过滤）
        let sql = `SELECT id, word_id, content_type, content, embedding FROM ${TABLE_NAME}`;
        const params = [];
        if (contentType) {
            sql += ` WHERE content_type = ?`;
            params.push(contentType);
        }
        const rows = await all(sql, params);

        // 在内存中逐条计算余弦相似度
        const scored = [];
        for (const row of rows) {
            let embedding = null;
            try {
                embedding = JSON.parse(row.embedding);
            } catch (e) {
                // 跳过无法解析的脏数据
                continue;
            }
            if (!Array.isArray(embedding)) continue;

            const score = cosineSimilarity(queryEmbedding, embedding);
            scored.push({
                id: row.id,
                word_id: row.word_id,
                content_type: row.content_type,
                content: row.content,
                score: score
            });
        }

        // 按相似度降序排序，取前 limit 条
        scored.sort((x, y) => y.score - x.score);
        return scored.slice(0, limit);
    } catch (err) {
        console.error('向量检索失败:', err.message);
        return [];
    }
}

/**
 * 获取索引统计信息
 * @returns {Promise<{total:number, indexedWords:number, byContentType:Object}>}
 */
async function getIndexStats() {
    try {
        await ensureInit();

        const totalRow = await get(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`);
        const byTypeRows = await all(
            `SELECT content_type, COUNT(*) as count FROM ${TABLE_NAME} GROUP BY content_type`
        );
        const wordCountRow = await get(
            `SELECT COUNT(DISTINCT word_id) as count FROM ${TABLE_NAME} WHERE word_id IS NOT NULL`
        );

        const byContentType = {};
        if (Array.isArray(byTypeRows)) {
            for (const row of byTypeRows) {
                byContentType[row.content_type] = row.count;
            }
        }

        return {
            total: totalRow ? totalRow.count : 0,
            indexedWords: wordCountRow ? wordCountRow.count : 0,
            byContentType: byContentType
        };
    } catch (err) {
        console.error('获取索引统计失败:', err.message);
        return { total: 0, indexedWords: 0, byContentType: {} };
    }
}

module.exports = {
    initVectorStore,
    storeEmbedding,
    searchSimilar,
    getIndexStats,
    cosineSimilarity
};
