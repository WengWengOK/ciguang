/**
 * 练习题生成工具
 * Agent 可通过此工具为用户生成针对性练习题
 */

const { chat, extractJSON, getActiveProvider, AIProvider } = require('../services/AIService');

module.exports = {
    name: 'generate_exercise',
    description: '为用户生成针对性练习题。可根据用户的薄弱知识点生成例句练习、翻译练习、选词填空等题目。用于帮助用户针对性练习。',
    parameters: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: '练习类型：practice（例句）/translation（翻译）/cloze（选词填空）',
                enum: ['practice', 'translation', 'cloze']
            },
            topic: {
                type: 'string',
                description: '练习主题或知识点，如"虚拟语气"、"定语从句"'
            },
            difficulty: {
                type: 'string',
                description: '难度：easy/medium/hard',
                enum: ['easy', 'medium', 'hard']
            },
            count: {
                type: 'integer',
                description: '题目数量，默认3'
            }
        },
        required: ['type', 'topic']
    },

    async execute(args, context) {
        const { type, topic, difficulty = 'medium', count = 3 } = args;
        const userId = context.userId;

        // 无 API Key 降级
        if (getActiveProvider() === AIProvider.LOCAL) {
            return JSON.stringify({
                type,
                topic,
                questions: [{
                    question: `请翻译以下句子（主题：${topic}）`,
                    answer: '（需要配置 AI API Key 才能生成高质量题目）'
                }],
                fallback: true
            });
        }

        const promptMap = {
            practice: `生成 ${count} 道关于"${topic}"的英语例句练习题。每题包含一个英语句子和中文翻译，句子难度为${difficulty}。`,
            translation: `生成 ${count} 道关于"${topic}"的英译汉翻译练习。每题包含一个英语句子和参考翻译。`,
            cloze: `生成 ${count} 道关于"${topic}"的选词填空题。每题包含一个句子（含空格）和4个选项。`
        };

        const result = await chat(
            [
                {
                    role: 'system',
                    content: '你是考研英语出题专家。请生成结构化的练习题，以 JSON 格式返回。格式：{"questions":[{"question":"题目","options":["A","B","C","D"],"answer":"答案","explanation":"解析"}]}'
                },
                { role: 'user', content: promptMap[type] || promptMap.practice }
            ],
            {
                model: 'qwen-turbo',
                temperature: 0.8,
                maxTokens: 1000,
                userId,
                endpoint: '/tool/generate_exercise'
            }
        );

        const parsed = extractJSON(result.content);

        if (parsed && parsed.questions) {
            return JSON.stringify({
                type,
                topic,
                difficulty,
                questions: parsed.questions
            });
        }

        // JSON 解析失败，返回原始文本
        return JSON.stringify({
            type,
            topic,
            questions: [{ question: result.content, answer: '' }],
            parseWarning: true
        });
    }
};
