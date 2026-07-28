const request = require('supertest');
const app = require('../server');

describe('认证模块 /api/auth', () => {
    describe('POST /api/auth/register - 用户注册', () => {
        it('正常注册应返回成功和token', async () => {
            const username = `testuser_${Date.now()}`;
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username, password: 'password123', nickname: '测试用户' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeDefined();
            expect(res.body.data.user.username).toBe(username);
            expect(res.body.data.user.nickname).toBe('测试用户');
        });

        it('重复用户名注册应失败（409）', async () => {
            const username = `testuser_${Date.now()}`;
            // 第一次注册
            await request(app)
                .post('/api/auth/register')
                .send({ username, password: 'password123' });

            // 重复用户名注册
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username, password: 'password123' });

            expect(res.status).toBe(409);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('已存在');
        });

        it('缺少必填字段注册应失败（400）', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ username: `testuser_${Date.now()}` }); // 缺少 password

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('POST /api/auth/login - 用户登录', () => {
        it('正常登录应返回成功和token', async () => {
            const username = `testuser_${Date.now()}`;
            const password = 'password123';
            // 先注册
            await request(app)
                .post('/api/auth/register')
                .send({ username, password });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username, password });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeDefined();
            expect(res.body.data.user.username).toBe(username);
        });

        it('错误密码登录应失败（401）', async () => {
            const username = `testuser_${Date.now()}`;
            await request(app)
                .post('/api/auth/register')
                .send({ username, password: 'password123' });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username, password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('错误');
        });
    });

    describe('GET /api/auth/me - 获取当前用户信息', () => {
        it('未提供token应返回401', async () => {
            const res = await request(app).get('/api/auth/me');

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('无效token应返回401', async () => {
            const res = await request(app)
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalid.token.here');

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('有效token应返回用户信息', async () => {
            const username = `testuser_${Date.now()}`;
            // 注册获取token
            const registerRes = await request(app)
                .post('/api/auth/register')
                .send({ username, password: 'password123', nickname: '信息测试' });

            const token = registerRes.body.data.token;

            const res = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe(username);
            expect(res.body.data.nickname).toBe('信息测试');
        });
    });
});
