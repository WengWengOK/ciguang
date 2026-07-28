/**
 * 生产级增强测试
 * 覆盖 yu-ai-agent 四大短板的解决方案：
 * 1. SessionStore：并发安全的会话存储（替代 FileBasedChatMemory）
 * 2. ai-observability：SQLite 持久化 + Trace ID 链路追踪
 * 3. EvaluationService：AI 评测框架（质量评分 + 工具选择准确率 + 回归测试）
 * 4. Agent 超时控制（在 agent.test.js 中覆盖）
 */

const SessionStore = require('../services/SessionStore');
const {
    generateTraceId,
    recordAICall,
    getMetricsSummary,
    getMetricsSummaryAsync,
    getTraceById
} = require('../middleware/ai-observability');
const {
    evaluateByRules,
    evaluateToolSelection,
    evaluateResponseQuality,
    runRegressionTests,
    getEvaluationSummary
} = require('../services/EvaluationService');

describe('SessionStore 并发安全会话存储', () => {

    describe('基本读写', () => {
        test('空会话返回空数组', async () => {
            const msgs = await SessionStore.getMessages('nonexistent_session');
            expect(msgs).toEqual([]);
        });

        test('追加消息后可读取', async () => {
            const sessionId = `test_append_${Date.now()}`;
            await SessionStore.appendMessages(sessionId, 1, 'tutor', [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'hi there' }
            ]);

            const msgs = await SessionStore.getMessages(sessionId);
            expect(msgs).toHaveLength(2);
            expect(msgs[0].content).toBe('hello');
            expect(msgs[1].content).toBe('hi there');
        });

        test('多次追加累积', async () => {
            const sessionId = `test_multi_${Date.now()}`;
            await SessionStore.appendMessages(sessionId, 1, 'tutor', { role: 'user', content: 'msg1' });
            await SessionStore.appendMessages(sessionId, 1, 'tutor', { role: 'assistant', content: 'reply1' });
            await SessionStore.appendMessages(sessionId, 1, 'tutor', { role: 'user', content: 'msg2' });

            const msgs = await SessionStore.getMessages(sessionId);
            expect(msgs).toHaveLength(3);
        });

        test('清除会话', async () => {
            const sessionId = `test_clear_${Date.now()}`;
            await SessionStore.appendMessages(sessionId, 1, 'tutor', { role: 'user', content: 'temp' });
            await SessionStore.clearSession(sessionId);

            const msgs = await SessionStore.getMessages(sessionId);
            expect(msgs).toEqual([]);
        });
    });

    describe('并发安全', () => {
        test('并发写入同一 session 不丢数据', async () => {
            const sessionId = `test_concurrent_${Date.now()}`;

            // 模拟并发：同时发起多个 append
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(
                    SessionStore.appendMessages(sessionId, 1, 'tutor', {
                        role: 'user',
                        content: `concurrent_msg_${i}`
                    })
                );
            }

            await Promise.all(promises);

            const msgs = await SessionStore.getMessages(sessionId);
            // 5 条消息都应该存在（不丢数据）
            expect(msgs).toHaveLength(5);
        });

        test('不同 session 互不干扰', async () => {
            const sid1 = `test_isolation_1_${Date.now()}`;
            const sid2 = `test_isolation_2_${Date.now()}`;

            await SessionStore.appendMessages(sid1, 1, 'tutor', { role: 'user', content: 'session1' });
            await SessionStore.appendMessages(sid2, 1, 'tutor', { role: 'user', content: 'session2' });

            const msgs1 = await SessionStore.getMessages(sid1);
            const msgs2 = await SessionStore.getMessages(sid2);

            expect(msgs1).toHaveLength(1);
            expect(msgs1[0].content).toBe('session1');
            expect(msgs2).toHaveLength(1);
            expect(msgs2[0].content).toBe('session2');
        });
    });
});

describe('AI 可观测性（SQLite 持久化 + Trace ID）', () => {

    describe('Trace ID 生成', () => {
        test('generateTraceId 返回 UUID 字符串', () => {
            const traceId = generateTraceId();
            expect(traceId).toBeTruthy();
            expect(typeof traceId).toBe('string');
            // UUID v4 格式
            expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        test('每次生成不同 ID', () => {
            const id1 = generateTraceId();
            const id2 = generateTraceId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('recordAICall 同步接口', () => {
        test('返回 traceId', () => {
            const traceId = recordAICall({
                endpoint: '/test/endpoint',
                model: 'test-model',
                inputTokens: 100,
                outputTokens: 50,
                durationMs: 500,
                success: true,
                userId: 1
            });

            expect(traceId).toBeTruthy();
            expect(typeof traceId).toBe('string');
        });

        test('使用传入的 traceId', () => {
            const customTraceId = 'custom-trace-12345';
            const returnedTraceId = recordAICall({
                traceId: customTraceId,
                endpoint: '/test/custom',
                model: 'test-model',
                inputTokens: 10,
                outputTokens: 5,
                durationMs: 100,
                success: true
            });

            expect(returnedTraceId).toBe(customTraceId);
        });

        test('记录失败调用', () => {
            const traceId = recordAICall({
                endpoint: '/test/fail',
                model: 'test-model',
                inputTokens: 0,
                outputTokens: 0,
                durationMs: 50,
                success: false,
                error: 'Connection timeout'
            });

            expect(traceId).toBeTruthy();
        });
    });

    describe('getMetricsSummary 同步接口', () => {
        test('返回完整统计结构', () => {
            const summary = getMetricsSummary();

            expect(summary).toHaveProperty('overview');
            expect(summary).toHaveProperty('byModel');
            expect(summary).toHaveProperty('byEndpoint');
            expect(summary).toHaveProperty('byDate');
            expect(summary).toHaveProperty('recentCalls');

            expect(summary.overview).toHaveProperty('totalCalls');
            expect(summary.overview).toHaveProperty('totalTokens');
            expect(summary.overview).toHaveProperty('successRate');
            expect(summary.overview).toHaveProperty('avgDurationMs');
        });

        test('记录后统计数据增加', () => {
            const before = getMetricsSummary();
            const beforeCalls = before.overview.totalCalls;

            recordAICall({
                endpoint: '/test/metrics',
                model: 'metrics-test',
                inputTokens: 200,
                outputTokens: 100,
                durationMs: 300,
                success: true
            });

            const after = getMetricsSummary();
            expect(after.overview.totalCalls).toBeGreaterThan(beforeCalls);
        });
    });

    describe('getMetricsSummaryAsync 异步接口（SQLite 查询）', () => {
        test('返回 SQLite 聚合数据', async () => {
            // 等待 SQLite 初始化和异步写入
            await new Promise(resolve => setTimeout(resolve, 500));

            const summary = await getMetricsSummaryAsync({ limit: 10 });

            expect(summary).toHaveProperty('overview');
            expect(summary).toHaveProperty('byEndpoint');
            expect(summary).toHaveProperty('byModel');
            expect(summary).toHaveProperty('byDate');
        });

        test('支持端点筛选', async () => {
            const summary = await getMetricsSummaryAsync({
                endpoint: '/test/metrics',
                limit: 5
            });

            expect(summary).toHaveProperty('overview');
            // 如果有数据，应该都是 /test/metrics 端点的
            if (summary.byEndpoint && summary.byEndpoint.length > 0) {
                summary.byEndpoint.forEach(e => {
                    expect(e.endpoint).toBe('/test/metrics');
                });
            }
        });
    });

    describe('getTraceById 链路追踪', () => {
        test('用 traceId 查询调用记录', async () => {
            // 记录一条带特定 traceId 的调用
            const traceId = 'trace-lookup-test-' + Date.now();
            recordAICall({
                traceId,
                endpoint: '/test/trace',
                model: 'trace-test-model',
                inputTokens: 50,
                outputTokens: 25,
                durationMs: 200,
                success: true
            });

            // 等待异步 SQLite 写入完成
            await new Promise(resolve => setTimeout(resolve, 500));

            const traces = await getTraceById(traceId);
            expect(traces).toBeDefined();
            expect(traces.length).toBeGreaterThanOrEqual(1);
            expect(traces[0].trace_id).toBe(traceId);
            expect(traces[0].endpoint).toBe('/test/trace');
        });
    });
});

describe('EvaluationService AI 评测框架', () => {

    describe('evaluateByRules 规则评分', () => {
        test('相关性评分：包含问题关键词得分更高', () => {
            const result = evaluateByRules(
                'how to remember abandon',
                'abandon means to give up. You can remember it by word roots.',
                null
            );

            expect(result.breakdown.relevance).toBeGreaterThan(3);
            expect(result.overallScore).toBeGreaterThan(0);
            expect(result.method).toBe('rule_based');
        });

        test('格式评分：有列表和换行得分更高', () => {
            const result = evaluateByRules(
                'how to study',
                '1. Read books\n2. Practice exercises\n3. Review mistakes',
                null
            );

            expect(result.breakdown.format).toBeGreaterThan(7);
        });

        test('空回答得低分', () => {
            const result = evaluateByRules('test question', '', null);
            expect(result.overallScore).toBeLessThan(5);
        });

        test('有参考答案时计算准确性', () => {
            const result = evaluateByRules(
                'what is abandon',
                'abandon means to give up something',
                'abandon means to give up something completely'
            );

            expect(result.breakdown.accuracy).toBeGreaterThan(5);
        });
    });

    describe('evaluateResponseQuality LLM 评分（降级到规则）', () => {
        test('无 API Key 时降级到规则评分', async () => {
            const result = await evaluateResponseQuality(
                'how to improve vocabulary',
                '1. Use flashcards\n2. Read more\n3. Practice daily',
                null
            );

            expect(result).toHaveProperty('overallScore');
            expect(result).toHaveProperty('breakdown');
            expect(result.breakdown).toHaveProperty('relevance');
            expect(result.breakdown).toHaveProperty('completeness');
            expect(result.breakdown).toHaveProperty('accuracy');
            expect(result.breakdown).toHaveProperty('format');
        });

        test('评分范围 0-10', async () => {
            const result = await evaluateResponseQuality('test', 'some response', null);

            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(10);
            Object.values(result.breakdown).forEach(score => {
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(10);
            });
        });
    });

    describe('evaluateToolSelection 工具选择准确率', () => {
        test('完全匹配：precision=1, recall=1, f1=1', async () => {
            const result = await evaluateToolSelection(
                'search for word abandon',
                [
                    { function: { name: 'search_words', arguments: '{}' } },
                    { function: { name: 'terminate', arguments: '{}' } }
                ],
                ['search_words']
            );

            expect(result.precision).toBe(1);
            expect(result.recall).toBe(1);
            expect(result.f1Score).toBe(1);
        });

        test('部分匹配：precision < 1 或 recall < 1', async () => {
            const result = await evaluateToolSelection(
                'get my profile and search words',
                [
                    { function: { name: 'search_words', arguments: '{}' } }
                    // 缺少 get_user_profile
                ],
                ['search_words', 'get_user_profile']
            );

            expect(result.precision).toBe(1);  // 调用的都是正确的
            expect(result.recall).toBeLessThan(1); // 但没有全部调用
            expect(result.f1Score).toBeLessThan(1);
        });

        test('多余调用：precision < 1', async () => {
            const result = await evaluateToolSelection(
                'search for word',
                [
                    { function: { name: 'search_words', arguments: '{}' } },
                    { function: { name: 'get_error_stats', arguments: '{}' } } // 不应该调用
                ],
                ['search_words']
            );

            expect(result.precision).toBeLessThan(1);
        });

        test('排除 terminate 工具不计入评估', async () => {
            const result = await evaluateToolSelection(
                'search word',
                [{ function: { name: 'terminate', arguments: '{}' } }],
                ['search_words']
            );

            expect(result.actualTools).not.toContain('terminate');
        });

        test('分析结果包含 TP/FP/FN', async () => {
            const result = await evaluateToolSelection(
                'search and get profile',
                [{ function: { name: 'search_words', arguments: '{}' } }],
                ['search_words', 'get_user_profile']
            );

            expect(result.analysis).toHaveProperty('truePositives');
            expect(result.analysis).toHaveProperty('falsePositives');
            expect(result.analysis).toHaveProperty('falseNegatives');
            expect(result.analysis.truePositives).toContain('search_words');
            expect(result.analysis.falseNegatives).toContain('get_user_profile');
        });
    });

    describe('getEvaluationSummary 评测统计', () => {
        test('返回统计结构', async () => {
            const summary = await getEvaluationSummary();

            expect(summary).toHaveProperty('byType');
            expect(summary).toHaveProperty('trend');
        });
    });

    describe('runRegressionTests 回归测试', () => {
        test('无 API Key 时执行降级测试', async () => {
            const result = await runRegressionTests();

            expect(result).toHaveProperty('total');
            expect(result).toHaveProperty('passed');
            expect(result).toHaveProperty('failed');
            expect(result).toHaveProperty('passRate');
            expect(result.total).toBeGreaterThan(0);
            expect(result.passed + result.failed).toBe(result.total);
        });

        test('使用自定义 AI 调用函数', async () => {
            const customFn = async (query) => {
                return `这是对 "${query}" 的测试回答。1. 第一点\n2. 第二点`;
            };

            const result = await runRegressionTests(customFn);

            expect(result.total).toBeGreaterThan(0);
            expect(result.results[0]).toHaveProperty('quality');
            expect(result.results[0]).toHaveProperty('passed');
        });
    });
});
