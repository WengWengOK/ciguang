const request = require('supertest');
const app = require('../server');

/**
 * AI 降级逻辑测试
 * 测试环境未配置 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY（在 tests/setup.js 中置空），
 * 因此所有 AI 接口应走本地降级方案，不依赖外部 API 调用。
 */
describe('AI模块降级逻辑 /api/ai', () => {
    describe('POST /api/ai/translation/evaluate - 翻译评判', () => {
        it('无API Key时走本地降级，返回评分结果', async () => {
            const res = await request(app)
                .post('/api/ai/translation/evaluate')
                .send({
                    source_text: 'The weather is nice today.',
                    user_translation: '今天天气很好。',
                    reference_translation: '今天天气不错。'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            // 本地降级引擎应返回评分字段
            expect(res.body.data.score).toBeDefined();
            expect(typeof res.body.data.score).toBe('number');
            expect(res.body.data.score).toBeGreaterThanOrEqual(0);
            expect(res.body.data.score).toBeLessThanOrEqual(100);
            expect(res.body.data.feedback).toBeDefined();
        });

        it('缺少必要参数应返回400', async () => {
            const res = await request(app)
                .post('/api/ai/translation/evaluate')
                .send({ source_text: 'Hello' }); // 缺少 user_translation

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('POST /api/ai/generate-example - 生成例句', () => {
        it('无API Key时走本地降级，返回预设例句', async () => {
            const res = await request(app)
                .post('/api/ai/generate-example')
                .send({ word: 'abandon', meaning: '放弃' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.fallback).toBe(true);
            expect(res.body.data.en).toBeDefined();
            expect(res.body.data.cn).toBeDefined();
            // 降级例句中应包含请求的单词
            expect(res.body.data.en.toLowerCase()).toContain('abandon');
        });

        it('缺少单词参数应返回400', async () => {
            const res = await request(app)
                .post('/api/ai/generate-example')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('POST /api/ai/speaking/generate - 生成口语话题', () => {
        it('无API Key时走本地降级，返回预设口语话题', async () => {
            const res = await request(app)
                .post('/api/ai/speaking/generate')
                .send({ category: 'self_intro' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.fallback).toBe(true);
            expect(res.body.data.topic).toBeDefined();
            expect(typeof res.body.data.topic).toBe('string');
            expect(res.body.data.topic.length).toBeGreaterThan(0);
        });

        it('未指定分类也应返回降级话题', async () => {
            const res = await request(app)
                .post('/api/ai/speaking/generate')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.fallback).toBe(true);
            expect(res.body.data.topic).toBeDefined();
        });
    });
});
