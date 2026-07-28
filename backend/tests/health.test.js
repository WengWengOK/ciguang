const request = require('supertest');
const app = require('../server');

describe('健康检查与基础路由', () => {
    it('GET /api/health - 应返回服务健康状态', async () => {
        const res = await request(app).get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBeDefined();
        expect(res.body.timestamp).toBeDefined();
        expect(res.body.version).toBeDefined();
    });

    it('GET /api - 应返回API文档', async () => {
        const res = await request(app).get('/api');

        expect(res.status).toBe(200);
        expect(res.body.name).toBeDefined();
        expect(res.body.version).toBeDefined();
        expect(res.body.endpoints).toBeDefined();
        // 验证文档包含主要模块
        expect(res.body.endpoints.auth).toBeDefined();
        expect(res.body.endpoints.words).toBeDefined();
        expect(res.body.endpoints.ai).toBeDefined();
    });

    it('GET /api/nonexistent - 不存在的接口应返回404', async () => {
        const res = await request(app).get('/api/nonexistent');

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBeDefined();
    });
});
