const request = require('supertest');
const app = require('../server');

describe('单词模块 /api/words', () => {
    describe('GET /api/words - 获取单词列表', () => {
        it('应返回分页单词列表', async () => {
            const res = await request(app).get('/api/words?page=1&limit=5');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.words)).toBe(true);
            expect(res.body.data.words.length).toBeLessThanOrEqual(5);
            expect(res.body.data.pagination).toBeDefined();
            expect(res.body.data.pagination.page).toBe(1);
            expect(res.body.data.pagination.limit).toBe(5);
            expect(res.body.data.pagination.total).toBeGreaterThan(0);
            expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(1);
        });

        it('应支持按字母筛选', async () => {
            const res = await request(app).get('/api/words?letter=A&limit=50');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // 所有返回的单词首字母应为 A
            res.body.data.words.forEach(w => {
                expect(w.first_letter).toBe('A');
            });
        });

        it('应支持关键词搜索', async () => {
            const res = await request(app).get('/api/words?search=abandon');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.words.length).toBeGreaterThan(0);
            // 返回的单词应包含搜索关键词
            const hasMatch = res.body.data.words.some(
                w => w.word.includes('abandon') || (w.meaning && w.meaning.includes('abandon'))
            );
            expect(hasMatch).toBe(true);
        });
    });

    describe('GET /api/words/:id - 获取单个单词', () => {
        it('应返回指定ID的单词详情', async () => {
            // 先获取单词列表拿到一个有效ID
            const listRes = await request(app).get('/api/words?limit=1');
            const wordId = listRes.body.data.words[0].id;

            const res = await request(app).get(`/api/words/${wordId}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(wordId);
            expect(res.body.data.word).toBeDefined();
            expect(res.body.data.meaning).toBeDefined();
        });

        it('不存在的单词ID应返回404', async () => {
            const res = await request(app).get('/api/words/999999');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('GET /api/words/stats/by-letter - 按字母统计', () => {
        it('应返回按首字母分组的统计信息', async () => {
            const res = await request(app).get('/api/words/stats/by-letter');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBeGreaterThan(0);

            // 验证统计字段
            const firstStat = res.body.data[0];
            expect(firstStat.first_letter).toBeDefined();
            expect(firstStat.count).toBeDefined();
            expect(firstStat.count).toBeGreaterThan(0);
        });
    });

    describe('GET /api/words/random/weighted - 随机获取单词', () => {
        it('应返回指定数量的随机单词', async () => {
            const res = await request(app).get('/api/words/random/weighted?count=3');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(3);
            // 验证返回的是有效单词
            res.body.data.forEach(w => {
                expect(w.word).toBeDefined();
                expect(w.id).toBeDefined();
            });
        });

        it('默认应返回1个随机单词', async () => {
            const res = await request(app).get('/api/words/random/weighted');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(1);
        });
    });
});
