/**
 * RAG 检索服务
 * 组合 embedding 服务与向量存储，提供知识检索与上下文构建能力
 */
const { generateEmbedding, generateEmbeddings } = require('./embedding');
const { storeEmbedding, searchSimilar, getIndexStats, initVectorStore } = require('./vectorStore');

// 内容类型常量
const CONTENT_TYPE = {
    WORD_MEANING: 'word_meaning',   // 单词释义
    EXAMPLE: 'example',              // 例句
    KNOWLEDGE_POINT: 'knowledge_point' // 知识点
};

// 内容类型 -> 中文标签
const TYPE_LABELS = {
    word_meaning: '单词释义',
    example: '例句',
    knowledge_point: '知识点'
};

/**
 * 构建单词释义文本（用于生成 embedding）
 * @param {object} word
 * @returns {string}
 */
function buildMeaningText(word) {
    const parts = [];
    if (word.word) parts.push(word.word);
    if (word.phonetic) parts.push(`/${word.phonetic}/`);
    if (word.meaning) parts.push(word.meaning);
    return parts.filter(Boolean).join(' ').trim();
}

/**
 * 构建例句文本（中英文拼接，便于双语检索）
 * @param {object} word
 * @returns {string}
 */
function buildExampleText(word) {
    const parts = [];
    if (word.example_en) parts.push(word.example_en);
    if (word.example_cn) parts.push(word.example_cn);
    return parts.filter(Boolean).join(' ').trim();
}

/**
 * 为单个单词生成并存储 embedding（释义 + 例句）
 * @param {object} word 单词对象 { id, word, phonetic, meaning, example_en, example_cn, ... }
 * @returns {Promise<{wordId:number, word:string, indexed:number}>}
 */
async function indexWord(word) {
    try {
        if (!word || !word.id) {
            throw new Error('单词对象缺少 id');
        }
        await initVectorStore();

        const texts = [];
        const metas = [];

        // 1. 单词释义向量
        const meaningText = buildMeaningText(word);
        if (meaningText) {
            texts.push(meaningText);
            metas.push({ contentType: CONTENT_TYPE.WORD_MEANING, content: meaningText });
        }

        // 2. 例句向量（中英文拼接，便于双语检索）
        const exampleText = buildExampleText(word);
        if (exampleText) {
            texts.push(exampleText);
            metas.push({ contentType: CONTENT_TYPE.EXAMPLE, content: exampleText });
        }

        if (texts.length === 0) {
            return { wordId: word.id, word: word.word, indexed: 0 };
        }

        // 批量生成向量（内部已处理分批与降级）
        const embeddings = await generateEmbeddings(texts);

        // 批量存储
        for (let i = 0; i < embeddings.length; i++) {
            const meta = metas[i];
            await storeEmbedding(word.id, meta.contentType, meta.content, embeddings[i]);
        }

        return { wordId: word.id, word: word.word, indexed: embeddings.length };
    } catch (err) {
        console.error(`索引单词失败 (id=${word && word.id}):`, err.message);
        throw err;
    }
}

/**
 * 批量索引单词
 * @param {object[]} words 单词对象数组
 * @returns {Promise<{total:number, success:number, failed:number, errors:Array}>}
 */
async function indexAllWords(words) {
    try {
        if (!Array.isArray(words) || words.length === 0) {
            return { total: 0, success: 0, failed: 0, errors: [] };
        }

        let success = 0;
        let failed = 0;
        const errors = [];

        for (const word of words) {
            try {
                await indexWord(word);
                success++;
            } catch (err) {
                failed++;
                errors.push({ wordId: word && word.id, message: err.message });
            }
        }

        return { total: words.length, success, failed, errors };
    } catch (err) {
        console.error('批量索引单词失败:', err.message);
        return {
            total: Array.isArray(words) ? words.length : 0,
            success: 0,
            failed: Array.isArray(words) ? words.length : 0,
            errors: [err.message]
        };
    }
}

/**
 * 检索相关知识
 * @param {string} query 查询文本
 * @param {number} limit 返回条数（默认 5）
 * @param {string|null} contentType 内容类型过滤（可选）
 * @returns {Promise<Array>} 检索结果（按相似度降序）
 */
async function retrieve(query, limit = 5, contentType = null) {
    try {
        if (!query) return [];
        const queryEmbedding = await generateEmbedding(query);
        const results = await searchSimilar(queryEmbedding, limit, contentType);
        return results;
    } catch (err) {
        console.error('检索知识失败:', err.message);
        return [];
    }
}

/**
 * 格式化来源标注
 * @param {object} item 检索结果项
 * @returns {string} 来源描述
 */
function formatSource(item) {
    const typeLabel = TYPE_LABELS[item.content_type] || item.content_type || '未知';
    const score = typeof item.score === 'number' ? item.score.toFixed(4) : '0.0000';
    return `${typeLabel}(word_id=${item.word_id || '-'}, 相似度=${score})`;
}

/**
 * 构建给 AI 的上下文文本
 * 将检索结果格式化为带来源标注的文本，用 "\n---\n" 分隔
 * @param {string} query 查询文本
 * @param {number} limit 返回条数（默认 5）
 * @returns {Promise<{context:string, sources:Array, count:number}>}
 */
async function buildContext(query, limit = 5) {
    try {
        const results = await retrieve(query, limit);

        if (!results || results.length === 0) {
            return { context: '', sources: [], count: 0 };
        }

        // 每条结果格式化为带序号与来源标注的文本块
        const blocks = results.map((item, idx) => {
            const sourceLabel = formatSource(item);
            return `[${idx + 1}] 来源：${sourceLabel}\n${item.content}`;
        });

        // 用 "\n---\n" 分隔拼接
        const context = blocks.join('\n---\n');

        // 来源元信息（供调用方使用）
        const sources = results.map((item, idx) => ({
            index: idx + 1,
            word_id: item.word_id,
            content_type: item.content_type,
            score: item.score
        }));

        return { context, sources, count: results.length };
    } catch (err) {
        console.error('构建上下文失败:', err.message);
        return { context: '', sources: [], count: 0 };
    }
}

module.exports = {
    indexWord,
    indexAllWords,
    retrieve,
    buildContext,
    getIndexStats
};
