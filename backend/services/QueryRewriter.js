/**
 * RAG 查询重写器
 * 将用户口语化问题重写为更适合向量检索的 query
 *
 * 设计参考：yu-ai-agent 的 QueryRewriter（基于 RewriteQueryTransformer）
 * 实现：通过 LLM 将口语化查询转换为检索优化查询
 */

const { chat, getActiveProvider, AIProvider } = require('./AIService');

const REWRITE_SYSTEM_PROMPT = `你是一个查询重写助手。你的任务是将用户的口语化问题重写为更适合语义检索的关键词组合。

重写规则：
1. 提取核心概念词（中英文均可）
2. 补充相关同义词和近义词
3. 去除语气词、问候语等无关内容
4. 保持简洁，不超过30个字
5. 直接输出重写结果，不要任何解释

示例：
- "这个单词怎么记" → "单词记忆方法 词根词缀 联想记忆"
- "abandon是什么意思" → "abandon 含义 用法 例句"
- "我语法不太好怎么办" → "语法薄弱 提升方法 从句 非谓语"
- "翻译有什么技巧" → "翻译技巧 语序调整 词性转换 直译意译"`;

/**
 * 重写查询以提升 RAG 检索召回率
 *
 * @param {string} userQuery - 用户原始查询
 * @returns {string} 重写后的查询（失败时返回原始查询）
 */
async function rewriteQuery(userQuery) {
    // 无 AI API Key 时直接返回原始查询
    if (getActiveProvider() === AIProvider.LOCAL) {
        return userQuery;
    }

    try {
        const result = await chat(
            [
                { role: 'system', content: REWRITE_SYSTEM_PROMPT },
                { role: 'user', content: userQuery }
            ],
            {
                model: 'qwen-turbo',
                temperature: 0.3,
                maxTokens: 60,
                endpoint: '/rag/query-rewrite'
            }
        );

        if (result.content && result.content.trim()) {
            return result.content.trim();
        }
    } catch (err) {
        console.error('查询重写失败，使用原始查询:', err.message);
    }

    // 降级：返回原始查询
    return userQuery;
}

module.exports = { rewriteQuery };
