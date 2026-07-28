/**
 * RAG 知识检索工具
 * Agent 可通过此工具进行语义检索，获取相关知识
 */

const { retrieve, buildContext } = require('../rag/retriever');
const { rewriteQuery } = require('../services/QueryRewriter');

module.exports = {
    name: 'search_knowledge',
    description: '通过语义检索（RAG）搜索知识库，获取与查询相关的单词释义、例句、语法知识等。支持自然语言查询。用于回答用户关于英语知识的问题。',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '自然语言查询，如"abandon的用法"或"虚拟语气"'
            },
            limit: {
                type: 'integer',
                description: '返回结果数量上限，默认5'
            }
        },
        required: ['query']
    },

    async execute(args, context) {
        const { query, limit = 5 } = args;

        // 查询重写：将口语化查询转为更适合检索的 query
        const rewrittenQuery = await rewriteQuery(query);
        console.log(`[RAGTool] 查询重写: "${query}" → "${rewrittenQuery}"`);

        // 执行语义检索
        const results = await retrieve(rewrittenQuery, limit);

        if (!results || results.length === 0) {
            return `未找到与"${query}"相关的知识。尝试使用更具体的关键词。`;
        }

        // 格式化检索结果
        const formatted = results.map((r, i) => {
            const content = r.content || '';
            const similarity = r.similarity || 0;
            return `[${i + 1}] 相似度:${similarity}\n${content}`;
        }).join('\n---\n');

        return formatted;
    }
};
