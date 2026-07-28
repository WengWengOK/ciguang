/**
 * Embedding 服务
 * 使用 DashScope text-embedding-v2 模型生成文本向量（1536 维）
 * 当无 DASHSCOPE_API_KEY 时，降级为本地词袋向量，保证系统可用
 */
const axios = require('axios');

// ===== DashScope text-embedding API 配置 =====
const DASHSCOPE_EMBEDDING_URL =
    'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const EMBEDDING_MODEL = 'text-embedding-v2';
const EMBEDDING_DIMENSION = 1536; // text-embedding-v2 输出维度
const REQUEST_TIMEOUT = 30000;   // 30 秒超时
const BATCH_SIZE = 25;            // DashScope 单次请求最多 25 条文本

/**
 * 获取 DashScope API Key
 */
function getApiKey() {
    return process.env.DASHSCOPE_API_KEY || '';
}

/**
 * 是否配置了 DashScope API Key
 */
function hasApiKey() {
    return !!getApiKey();
}

// ============================================================
//  本地降级方案：基于 hash 的词袋向量（TF-IDF 简化版）
//  维度与 DashScope 一致（1536），保证无 API Key 时系统仍可工作
// ============================================================

/**
 * 文本分词（支持中英文）
 * - 英文：按非字母字符拆分，转小写
 * - 中文：按单字切分
 * @param {string} text 原始文本
 * @returns {string[]} token 数组
 */
function tokenize(text) {
    if (!text) return [];
    const tokens = [];
    const lower = String(text).toLowerCase();
    // 匹配连续英文单词 或 单个中文字符
    const regex = /[a-z]+|[\u4e00-\u9fa5]/g;
    let match;
    while ((match = regex.exec(lower)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
}

/**
 * 字符串哈希（DJB2 变体），将 token 映射到固定维度区间
 * @param {string} token
 * @returns {number} 非负哈希值
 */
function hashToken(token) {
    let hash = 5381;
    for (let i = 0; i < token.length; i++) {
        // hash * 33 + charCode
        hash = ((hash << 5) + hash) + token.charCodeAt(i);
        hash = hash & 0xffffffff; // 保持 32 位整数
    }
    return Math.abs(hash);
}

/**
 * 本地词袋向量生成（降级方案）
 * 对文本分词后，通过 hash 映射到固定维度，生成稀疏向量并归一化为单位向量
 * @param {string} text
 * @returns {number[]} 1536 维向量
 */
function generateLocalEmbedding(text) {
    const vector = new Array(EMBEDDING_DIMENSION).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
        const idx = hashToken(token) % EMBEDDING_DIMENSION;
        vector[idx] += 1;
    }
    // 归一化为单位向量，便于后续直接用点积近似余弦相似度
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
        for (let i = 0; i < vector.length; i++) {
            vector[i] = vector[i] / norm;
        }
    }
    return vector;
}

// ============================================================
//  DashScope API 调用
// ============================================================

/**
 * 调用 DashScope 批量生成 embedding
 * 请求格式：{ model, input: { texts: [...] } }
 * 响应格式：response.data.output.embeddings（数组，每项含 embedding 字段）
 * @param {string[]} texts 文本数组
 * @returns {Promise<number[][]>} 向量数组
 */
async function callDashScopeEmbeddings(texts) {
    const apiKey = getApiKey();
    const response = await axios.post(
        DASHSCOPE_EMBEDDING_URL,
        {
            model: EMBEDDING_MODEL,
            input: {
                texts: texts
            }
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT
        }
    );

    const embeddings = response.data?.output?.embeddings || [];
    return embeddings.map(item => item.embedding);
}

// ============================================================
//  对外导出方法
// ============================================================

/**
 * 批量生成文本向量
 * - 有 API Key：调用 DashScope（自动分批）
 * - 无 API Key 或调用失败：降级为本地词袋向量
 * @param {string[]} texts 文本数组
 * @returns {Promise<number[][]>} 向量数组（每个为 1536 维）
 */
async function generateEmbeddings(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return [];
    }

    // 无 API Key 时直接降级
    if (!hasApiKey()) {
        return texts.map(text => generateLocalEmbedding(text));
    }

    try {
        const results = [];
        // 分批调用，避免超出单次请求上限
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const embeddings = await callDashScopeEmbeddings(batch);
            results.push(...embeddings);
        }

        // 数量不一致时降级，保证返回与输入一一对应
        if (results.length !== texts.length) {
            console.warn('DashScope embedding 返回数量与输入不一致，降级使用本地向量');
            return texts.map(text => generateLocalEmbedding(text));
        }
        return results;
    } catch (err) {
        console.error('调用 DashScope embedding API 失败，降级使用本地向量:', err.message);
        return texts.map(text => generateLocalEmbedding(text));
    }
}

/**
 * 生成单个文本的向量
 * @param {string} text 文本
 * @returns {Promise<number[]>} 向量（1536 维）
 */
async function generateEmbedding(text) {
    const embeddings = await generateEmbeddings([text || '']);
    if (embeddings && embeddings.length > 0) {
        return embeddings[0];
    }
    // 兜底：本地向量
    return generateLocalEmbedding(text);
}

module.exports = {
    generateEmbedding,
    generateEmbeddings,
    generateLocalEmbedding,
    hasApiKey,
    EMBEDDING_DIMENSION
};
