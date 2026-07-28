/**
 * 单词查询工具
 * Agent 可通过此工具查询单词库、搜索单词、获取随机单词
 */

const { all, get } = require('../database/db');

module.exports = {
    name: 'search_words',
    description: '搜索考研英语单词库。支持按关键词搜索、按字母筛选、获取单词详情。用于回答用户关于单词含义、用法的问题。',
    parameters: {
        type: 'object',
        properties: {
            keyword: {
                type: 'string',
                description: '搜索关键词（英文单词或中文含义）'
            },
            letter: {
                type: 'string',
                description: '按首字母筛选（可选，单个大写字母如 A）'
            },
            limit: {
                type: 'integer',
                description: '返回数量上限，默认10'
            }
        },
        required: ['keyword']
    },

    async execute(args, context) {
        const { keyword, letter, limit = 10 } = args;

        let sql = `SELECT * FROM words WHERE 1=1`;
        const params = [];

        if (keyword) {
            sql += ` AND (word LIKE ? OR meaning LIKE ?)`;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (letter) {
            sql += ` AND word LIKE ?`;
            params.push(`${letter.toUpperCase()}%`);
        }

        sql += ` ORDER BY frequency DESC LIMIT ?`;
        params.push(limit);

        const words = await all(sql, params);

        if (words.length === 0) {
            return `未找到与"${keyword}"相关的单词`;
        }

        return JSON.stringify(words.map(w => ({
            word: w.word,
            meaning: w.meaning,
            phonetic: w.phonetic || '',
            pos: w.pos || '',
            frequency: w.frequency || 0
        })));
    }
};
