/**
 * ReAct Agent 框架测试
 * 验证 Agent 继承体系、状态机、工具注册系统
 */

const { BaseAgent, AgentState } = require('../agent/BaseAgent');
const { ReActAgent } = require('../agent/ReActAgent');
const { ToolCallAgent } = require('../agent/ToolCallAgent');
const { StudyAgent } = require('../agent/StudyAgent');
const { getAllTools, getToolDefinitions, getTool } = require('../tools/ToolRegistry');

describe('ReAct Agent 框架', () => {

    describe('BaseAgent 状态机', () => {
        test('初始状态为 IDLE', () => {
            const agent = new BaseAgent({ name: 'test' });
            expect(agent.state).toBe(AgentState.IDLE);
            expect(agent.currentStep).toBe(0);
            expect(agent.maxSteps).toBe(10);
            expect(agent.messageList).toEqual([]);
        });

        test('step() 抛出异常（抽象方法）', async () => {
            const agent = new BaseAgent({ name: 'test' });
            await expect(agent.step()).rejects.toThrow('step() 必须由子类实现');
        });

        test('run() 拒绝非 IDLE 状态', async () => {
            const agent = new BaseAgent({ name: 'test' });
            agent.state = AgentState.RUNNING;
            await expect(agent.run('test')).rejects.toThrow('Agent 状态非 IDLE');
        });

        test('run() 拒绝空输入', async () => {
            const agent = new BaseAgent({ name: 'test' });
            await expect(agent.run('')).rejects.toThrow('用户输入不能为空');
            await expect(agent.run('   ')).rejects.toThrow('用户输入不能为空');
        });

        test('reset() 重置所有状态', () => {
            const agent = new BaseAgent({ name: 'test' });
            agent.state = AgentState.FINISHED;
            agent.currentStep = 5;
            agent.messageList.push({ role: 'user', content: 'test' });
            agent.results.push('result');

            agent.reset();

            expect(agent.state).toBe(AgentState.IDLE);
            expect(agent.currentStep).toBe(0);
            expect(agent.messageList).toEqual([]);
            expect(agent.results).toEqual([]);
        });

        test('maxSteps 可自定义', () => {
            const agent = new BaseAgent({ name: 'test', maxSteps: 20 });
            expect(agent.maxSteps).toBe(20);
        });
    });

    describe('ReActAgent 模板方法', () => {
        test('think() 和 act() 抛出异常（抽象方法）', async () => {
            const agent = new ReActAgent({ name: 'test' });
            await expect(agent.think()).rejects.toThrow('think() 必须由子类实现');
            await expect(agent.act()).rejects.toThrow('act() 必须由子类实现');
        });

        test('step() 是模板方法（固化 think→act 顺序）', async () => {
            // 创建测试子类
            class TestAgent extends ReActAgent {
                constructor() {
                    super({ name: 'test', maxSteps: 1 });
                    this.thinkCalled = false;
                    this.actCalled = false;
                }
                async think() {
                    this.thinkCalled = true;
                    return false; // 不需要行动
                }
                async act() {
                    this.actCalled = true;
                    return 'acted';
                }
            }

            const agent = new TestAgent();
            await agent.run('test input');

            expect(agent.thinkCalled).toBe(true);
            // think 返回 false，act 不应被调用
            expect(agent.actCalled).toBe(false);
            expect(agent.state).toBe(AgentState.FINISHED);
        });

        test('think 返回 true 时执行 act', async () => {
            class TestAgent extends ReActAgent {
                constructor() {
                    super({ name: 'test', maxSteps: 1 });
                    this.actCount = 0;
                }
                async think() {
                    return this.actCount === 0; // 第一次需要 act
                }
                async act() {
                    this.actCount++;
                    this.state = AgentState.FINISHED;
                    return 'acted';
                }
            }

            const agent = new TestAgent();
            await agent.run('test');

            expect(agent.actCount).toBe(1);
        });
    });

    describe('ToolCallAgent 工具调用', () => {
        test('构造时接收工具集', () => {
            const mockTools = [
                { name: 'tool1', description: 'test', parameters: {}, execute: async () => 'ok' }
            ];
            const agent = new ToolCallAgent({ name: 'test', tools: mockTools });
            expect(agent.tools).toHaveLength(1);
            expect(agent.tools[0].name).toBe('tool1');
        });

        test('thinkLocal 降级处理', async () => {
            const agent = new ToolCallAgent({
                name: 'test',
                tools: [],
                systemPrompt: 'test',
                nextStepPrompt: 'test'
            });
            // 模拟无 API Key
            const result = await agent.thinkLocal([{ role: 'user', content: 'hello' }]);
            expect(result).toBe(false);
            expect(agent.messageList.length).toBeGreaterThan(0);
        });
    });

    describe('StudyAgent 具体智能体', () => {
        test('创建实例并配置参数', () => {
            const agent = new StudyAgent({ userId: 1 });
            expect(agent.name).toBe('studyAgent');
            expect(agent.maxSteps).toBe(20);
            expect(agent.userId).toBe(1);
            expect(agent.tools.length).toBeGreaterThan(0);
        });

        test('系统提示词包含角色定义', () => {
            const agent = new StudyAgent();
            expect(agent.systemPrompt).toContain('词光');
            expect(agent.systemPrompt).toContain('智能体');
        });

        test('nextStepPrompt 包含工具使用引导', () => {
            const agent = new StudyAgent();
            expect(agent.nextStepPrompt).toContain('terminate');
            expect(agent.nextStepPrompt).toContain('工具');
        });
    });

    describe('工具注册中心', () => {
        test('注册 7 个工具', () => {
            const tools = getAllTools();
            expect(tools).toHaveLength(7);
        });

        test('每个工具有完整定义', () => {
            const tools = getAllTools();
            tools.forEach(tool => {
                expect(tool.name).toBeDefined();
                expect(tool.description).toBeDefined();
                expect(tool.parameters).toBeDefined();
                expect(typeof tool.execute).toBe('function');
            });
        });

        test('包含终止工具', () => {
            const termTool = getTool('terminate');
            expect(termTool).toBeDefined();
            expect(termTool.name).toBe('terminate');
        });

        test('getToolDefinitions 返回 AI API 格式', () => {
            const defs = getToolDefinitions();
            defs.forEach(def => {
                expect(def.name).toBeDefined();
                expect(def.description).toBeDefined();
                expect(def.parameters).toBeDefined();
            });
        });

        test('按名称筛选工具', () => {
            const defs = getToolDefinitions(['search_words', 'terminate']);
            expect(defs).toHaveLength(2);
        });
    });

    describe('Agent 状态流转', () => {
        test('完整执行流程：IDLE → RUNNING → FINISHED', async () => {
            class SimpleAgent extends ReActAgent {
                constructor() {
                    super({ name: 'simple', maxSteps: 3 });
                }
                async think() { return false; }
                async act() { return 'noop'; }
            }

            const agent = new SimpleAgent();
            expect(agent.state).toBe(AgentState.IDLE);

            await agent.run('hello');

            expect(agent.state).toBe(AgentState.FINISHED);
            expect(agent.currentStep).toBeGreaterThanOrEqual(1);
            expect(agent.results.length).toBeGreaterThanOrEqual(1);
        });

        test('步数耗尽强制终止', async () => {
            class LoopAgent extends ReActAgent {
                constructor() {
                    super({ name: 'loop', maxSteps: 2 });
                }
                async think() { return true; } // 永远需要行动
                async act() { return 'looping'; } // 但永远不终止
            }

            const agent = new LoopAgent();
            await agent.run('test');

            expect(agent.state).toBe(AgentState.FINISHED);
            expect(agent.results[agent.results.length - 1]).toContain('Reached max steps');
        });

        test('getFinalResponse 从 messageList 提取', () => {
            const agent = new BaseAgent({ name: 'test' });
            agent.messageList = [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'final answer' }
            ];
            expect(agent.getFinalResponse()).toBe('final answer');
        });
    });

    describe('超时控制（生产级增强）', () => {
        test('构造时配置超时参数', () => {
            const agent = new BaseAgent({
                name: 'test',
                timeoutMs: 10000,
                stepTimeoutMs: 5000
            });
            expect(agent.timeoutMs).toBe(10000);
            expect(agent.stepTimeoutMs).toBe(5000);
        });

        test('默认超时配置', () => {
            const agent = new BaseAgent({ name: 'test' });
            expect(agent.timeoutMs).toBe(300000);  // 5 分钟
            expect(agent.stepTimeoutMs).toBe(60000); // 60 秒
        });

        test('run() 生成 traceId', async () => {
            class TestAgent extends ReActAgent {
                constructor() { super({ name: 'test', maxSteps: 1 }); }
                async think() { return false; }
                async act() { return 'noop'; }
            }

            const agent = new TestAgent();
            expect(agent.traceId).toBeNull();

            await agent.run('test');

            expect(agent.traceId).toBeTruthy();
            expect(typeof agent.traceId).toBe('string');
            expect(agent.traceId.length).toBeGreaterThan(0);
        });

        test('步级超时：单步超时不终止整个 Agent', async () => {
            class SlowAgent extends ReActAgent {
                constructor() {
                    super({ name: 'slow', maxSteps: 2, stepTimeoutMs: 100 });
                }
                async think() {
                    // 模拟慢操作：sleep 200ms > 100ms 超时
                    await new Promise(resolve => setTimeout(resolve, 200));
                    return false;
                }
                async act() { return 'noop'; }
            }

            const agent = new SlowAgent();
            const results = await agent.run('test', { stepTimeoutMs: 100 });

            // 步级超时后 Agent 继续执行（跳过超时步）
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(r => r.includes('超时'))).toBe(true);
        });

        test('整体超时：超时后标记 ERROR 状态', async () => {
            class HangingAgent extends ReActAgent {
                constructor() {
                    super({ name: 'hang', maxSteps: 100 });
                }
                async think() {
                    // 模拟慢操作（300ms），整体超时 100ms 会先触发
                    await new Promise(resolve => setTimeout(resolve, 300));
                    return false;
                }
                async act() { return 'noop'; }
            }

            const agent = new HangingAgent();
            // 整体超时 100ms < 单步执行 300ms，超时后标记 ERROR
            await agent.run('test', { timeoutMs: 100, stepTimeoutMs: 10000 });

            expect(agent.state).toBe(AgentState.ERROR);
        });

        test('reset() 清除 traceId 和 sessionId', () => {
            const agent = new BaseAgent({ name: 'test' });
            agent.traceId = 'test-trace-id';
            agent.sessionId = 'test-session-id';
            agent.state = AgentState.FINISHED;

            agent.reset();

            expect(agent.traceId).toBeNull();
            expect(agent.sessionId).toBeNull();
            expect(agent.state).toBe(AgentState.IDLE);
        });

        test('run() 接受 options 参数（向后兼容）', async () => {
            class TestAgent extends ReActAgent {
                constructor() { super({ name: 'test', maxSteps: 1 }); }
                async think() { return false; }
                async act() { return 'noop'; }
            }

            const agent = new TestAgent();
            // 不传 options（向后兼容）
            await agent.run('test');
            expect(agent.state).toBe(AgentState.FINISHED);

            // 传空 options
            agent.reset();
            await agent.run('test', {});
            expect(agent.state).toBe(AgentState.FINISHED);

            // 传带超时的 options
            agent.reset();
            await agent.run('test', { timeoutMs: 60000, stepTimeoutMs: 30000 });
            expect(agent.state).toBe(AgentState.FINISHED);
        });
    });
});
