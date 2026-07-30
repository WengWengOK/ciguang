/**
 * BaseAgent - 基础智能体
 * 职责：状态管理 + 步数循环控制 + 消息上下文容器
 *
 * 设计参考：yu-ai-agent 的 BaseAgent.java
 * - 4 态状态机：IDLE → RUNNING → FINISHED/ERROR
 * - 步数上限循环：for (step < maxSteps && state != FINISHED)
 * - 自主维护 messageList（不依赖外部框架的自动记忆）
 * - 支持同步 run() 和流式 runStream()
 *
 * 生产级增强（解决 yu-ai-agent 短板）：
 * 1. 超时控制：Promise.race 实现步级超时 + AbortController 实现整体超时
 *    解决 Serverless 部署与 Agent 20 步循环的超时冲突
 * 2. SessionStore 集成：可选 sessionId 参数，加载/持久化消息上下文
 *    解决 messageList 实例变量多请求间串话问题（每请求独立实例 + 会话持久化）
 * 3. Trace ID：每次执行生成唯一 traceId，串联可观测性链路
 */

const crypto = require('crypto');

// Agent 状态枚举
const AgentState = {
    IDLE: 'idle',        // 空闲，唯一可启动状态
    RUNNING: 'running',   // 运行中
    FINISHED: 'finished', // 已完成
    ERROR: 'error'        // 错误
};

// 默认超时配置（毫秒）
const DEFAULT_TIMEOUT_MS = 300000;      // 整体超时：5 分钟（适配 Serverless 函数限制）
const DEFAULT_STEP_TIMEOUT_MS = 60000;   // 单步超时：60 秒（适配单次 LLM 调用）

class BaseAgent {
    constructor(options = {}) {
        // 状态机
        this.state = AgentState.IDLE;
        this.currentStep = 0;
        this.maxSteps = options.maxSteps || 10;

        // 自主维护的会话上下文（核心：不依赖外部框架自动管理记忆）
        // 注意：messageList 是实例变量，在 Node.js 单线程异步模型下，
        // 只要每个 HTTP 请求创建独立 Agent 实例（见 study-agent.js），
        // 就天然避免了多请求间串话。SessionStore 提供跨请求持久化。
        this.messageList = [];

        // 配置
        this.name = options.name || 'BaseAgent';
        this.systemPrompt = options.systemPrompt || '';
        this.nextStepPrompt = options.nextStepPrompt || '';
        this.userId = options.userId || null;

        // 执行结果
        this.results = [];

        // 超时配置
        this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.stepTimeoutMs = options.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS;

        // 可观测性
        this.traceId = null;
        this.sessionId = null;
    }

    /**
     * 同步执行 ReAct 循环（带超时控制）
     *
     * 解决 yu-ai-agent 的 Serverless 超时冲突：
     * - 整体超时（timeoutMs）：防止超过 Serverless 函数执行限制
     * - 步级超时（stepTimeoutMs）：防止单步 LLM 调用卡死整个循环
     * - AbortController：整体超时后中止后续步骤
     *
     * @param {string} userPrompt - 用户输入
     * @param {Object} [options] - 执行选项
     * @param {number} [options.timeoutMs] - 整体超时（毫秒），默认 300000
     * @param {number} [options.stepTimeoutMs] - 单步超时（毫秒），默认 60000
     * @param {string} [options.sessionId] - 会话 ID，提供则从 SessionStore 加载/持久化消息
     * @returns {Array} 每步执行结果数组
     */
    async run(userPrompt, options = {}) {
        const {
            timeoutMs = this.timeoutMs,
            stepTimeoutMs = this.stepTimeoutMs,
            sessionId = null
        } = options;

        // 前置校验
        if (this.state !== AgentState.IDLE) {
            throw new Error(`Agent 状态非 IDLE，当前状态: ${this.state}。请重置后再启动。`);
        }
        if (!userPrompt || !userPrompt.trim()) {
            throw new Error('用户输入不能为空');
        }

        // 生成 Trace ID 用于可观测性链路追踪
        this.traceId = crypto.randomUUID();
        this.sessionId = sessionId;

        // O 层：初始化执行轨迹记录器
        // 如果子类（ToolCallAgent 等）已有 tracer 则跳过
        if (!this.tracer) {
            try {
                const { ExecutionTracer } = require('../services/ExecutionTracer');
                this.tracer = new ExecutionTracer({
                    traceId: this.traceId,
                    agentName: this.name,
                    sessionId: this.sessionId,
                    userId: this.userId
                });
            } catch (e) {
                console.warn(`[${this.name}] 执行轨迹记录器初始化失败:`, e.message);
            }
        } else {
            // 子类已初始化 tracer，更新 traceId
            this.tracer.traceId = this.traceId;
        }

        // 如果提供了 sessionId，从 SessionStore 加载历史消息
        // 解决 yu-ai-agent 的 messageList 串话问题：
        // 每次请求创建新 Agent 实例（避免实例变量共享），
        // 通过 SessionStore 恢复会话上下文（实现跨请求连续对话）
        if (sessionId) {
            try {
                const SessionStore = require('../services/SessionStore');
                const history = await SessionStore.getMessages(sessionId);
                if (history && history.length > 0) {
                    this.messageList = [...history];
                    console.log(`[${this.name}] 从 SessionStore 恢复 ${history.length} 条历史消息, traceId=${this.traceId}`);
                }
            } catch (e) {
                console.warn(`[${this.name}] SessionStore 加载失败，使用空上下文:`, e.message);
            }
        }

        // 启动
        this.state = AgentState.RUNNING;
        this.messageList.push({ role: 'user', content: userPrompt });

        // O 层：记录状态变化 IDLE → RUNNING
        if (this.tracer) {
            this.tracer.recordStateChange(0, {
                from: 'idle',
                to: 'running',
                reason: 'Agent 启动'
            });
        }

        console.log(`[${this.name}] Agent 启动，最大步数: ${this.maxSteps}，超时: ${timeoutMs / 1000}s，traceId: ${this.traceId}`);

        // 创建整体超时控制器
        const abortController = new AbortController();
        const { signal } = abortController;

        // 整体超时定时器
        const overallTimeoutId = setTimeout(() => {
            abortController.abort();
            console.error(`[${this.name}] Agent 整体超时 (${timeoutMs / 1000}s)，已执行 ${this.currentStep} 步`);
        }, timeoutMs);

        try {
            // 步数循环（增加 signal.aborted 检查）
            for (let i = 0; i < this.maxSteps && this.state !== AgentState.FINISHED && !signal.aborted; i++) {
                this.currentStep = i + 1;
                console.log(`[${this.name}] 执行第 ${this.currentStep} 步... (traceId: ${this.traceId})`);

                // 单步超时控制：Promise.race 让步执行与超时竞争
                // 超时后不中止底层 LLM 调用（需 AbortController 传入 axios），
                // 但能让循环继续推进或优雅终止
                const stepPromise = this.step();
                const stepTimeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Step ${this.currentStep} 超时 (${stepTimeoutMs / 1000}s)`));
                    }, stepTimeoutMs);
                });

                let stepResult;
                try {
                    stepResult = await Promise.race([stepPromise, stepTimeoutPromise]);
                } catch (stepErr) {
                    // 整体超时已触发：记录并退出循环
                    if (signal.aborted) {
                        this.results.push(`Step ${this.currentStep}: 整体超时中止 - ${stepErr.message}`);
                        break;
                    }
                    // 步级超时：记录错误，跳过当前步继续下一步
                    // 设计决策：步级超时不立即终止 Agent，给后续步恢复的机会
                    stepResult = `超时跳过 - ${stepErr.message}`;
                    console.warn(`[${this.name}] 第 ${this.currentStep} 步超时: ${stepErr.message}`);
                }

                this.results.push(`Step ${this.currentStep}: ${stepResult}`);
                console.log(`[${this.name}] 第 ${this.currentStep} 步完成: ${stepResult.substring(0, 100)}...`);
            }

            // 步数耗尽强制结束
            if (this.currentStep >= this.maxSteps && this.state !== AgentState.FINISHED) {
                this.state = AgentState.FINISHED;
                this.results.push(`Terminated: Reached max steps (${this.maxSteps})`);
                console.log(`[${this.name}] 达到最大步数上限，强制终止`);

                // O 层：记录状态变化 → FINISHED
                if (this.tracer) {
                    this.tracer.recordStateChange(this.currentStep, {
                        from: 'running',
                        to: 'finished',
                        reason: `达到最大步数上限 (${this.maxSteps})`
                    });
                }
            }

            // 整体超时后标记 ERROR
            if (signal.aborted && this.state !== AgentState.FINISHED) {
                this.state = AgentState.ERROR;
                this.results.push(`Terminated: Overall timeout (${timeoutMs / 1000}s)`);

                // O 层：记录状态变化 → ERROR + 错误详情
                if (this.tracer) {
                    this.tracer.recordStateChange(this.currentStep, {
                        from: 'running',
                        to: 'error',
                        reason: `整体超时 (${timeoutMs / 1000}s)`
                    });
                    this.tracer.recordError(this.currentStep, {
                        phase: 'run',
                        error: `Agent 整体超时 (${timeoutMs / 1000}s)`
                    });
                }
            }

        } catch (err) {
            this.state = AgentState.ERROR;
            console.error(`[${this.name}] Agent 执行出错:`, err.message);

            // O 层：记录错误
            if (this.tracer) {
                this.tracer.recordError(this.currentStep, {
                    phase: 'run',
                    error: err,
                    stack: err.stack
                });
                this.tracer.recordStateChange(this.currentStep, {
                    from: 'running',
                    to: 'error',
                    reason: err.message
                });
            }
            throw err;
        } finally {
            clearTimeout(overallTimeoutId);

            // 如果提供了 sessionId，持久化消息到 SessionStore
            if (sessionId) {
                try {
                    const SessionStore = require('../services/SessionStore');
                    await SessionStore.appendMessages(sessionId, this.userId, 'study-agent', this.messageList);
                    console.log(`[${this.name}] 会话已持久化到 SessionStore, sessionId: ${sessionId}`);
                } catch (e) {
                    console.warn(`[${this.name}] SessionStore 持久化失败:`, e.message);
                }
            }

            // O 层：记录最终状态
            if (this.tracer && this.state === AgentState.FINISHED) {
                this.tracer.recordStateChange(this.currentStep, {
                    from: 'running',
                    to: 'finished',
                    reason: 'Agent 正常完成'
                });
            }

            await this.cleanup();
        }

        return this.results;
    }

    /**
     * 流式执行 ReAct 循环（带超时控制）
     * 通过 SSE 逐步推送执行结果
     *
     * @param {string} userPrompt - 用户输入
     * @param {Function} onStep - 每步完成回调 (stepResult, step) => void
     * @param {Object} [options] - 执行选项（timeoutMs, stepTimeoutMs, sessionId）
     * @returns {Array} 每步执行结果数组
     */
    async runStream(userPrompt, onStep, options = {}) {
        const {
            timeoutMs = this.timeoutMs,
            stepTimeoutMs = this.stepTimeoutMs,
            sessionId = null
        } = options;

        if (this.state !== AgentState.IDLE) {
            throw new Error(`Agent 状态非 IDLE，当前状态: ${this.state}`);
        }
        if (!userPrompt || !userPrompt.trim()) {
            throw new Error('用户输入不能为空');
        }

        // 生成 Trace ID
        this.traceId = crypto.randomUUID();
        this.sessionId = sessionId;

        // O 层：初始化执行轨迹记录器
        if (!this.tracer) {
            try {
                const { ExecutionTracer } = require('../services/ExecutionTracer');
                this.tracer = new ExecutionTracer({
                    traceId: this.traceId,
                    agentName: this.name,
                    sessionId: this.sessionId,
                    userId: this.userId
                });
            } catch (e) {
                console.warn(`[${this.name}] 执行轨迹记录器初始化失败:`, e.message);
            }
        } else {
            this.tracer.traceId = this.traceId;
        }

        // 从 SessionStore 加载历史消息
        if (sessionId) {
            try {
                const SessionStore = require('../services/SessionStore');
                const history = await SessionStore.getMessages(sessionId);
                if (history && history.length > 0) {
                    this.messageList = [...history];
                    console.log(`[${this.name}] 流式模式从 SessionStore 恢复 ${history.length} 条消息, traceId=${this.traceId}`);
                }
            } catch (e) {
                console.warn(`[${this.name}] SessionStore 加载失败:`, e.message);
            }
        }

        this.state = AgentState.RUNNING;
        this.messageList.push({ role: 'user', content: userPrompt });

        // O 层：记录状态变化 IDLE → RUNNING
        if (this.tracer) {
            this.tracer.recordStateChange(0, {
                from: 'idle',
                to: 'running',
                reason: '流式 Agent 启动'
            });
        }

        console.log(`[${this.name}] 流式 Agent 启动，最大步数: ${this.maxSteps}，超时: ${timeoutMs / 1000}s，traceId: ${this.traceId}`);

        // 整体超时控制
        const abortController = new AbortController();
        const { signal } = abortController;
        const overallTimeoutId = setTimeout(() => {
            abortController.abort();
            console.error(`[${this.name}] 流式 Agent 整体超时 (${timeoutMs / 1000}s)`);
        }, timeoutMs);

        try {
            for (let i = 0; i < this.maxSteps && this.state !== AgentState.FINISHED && !signal.aborted; i++) {
                this.currentStep = i + 1;
                console.log(`[${this.name}] 流式执行第 ${this.currentStep} 步... (traceId: ${this.traceId})`);

                // 单步超时控制
                const stepPromise = this.step();
                const stepTimeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Step ${this.currentStep} 超时 (${stepTimeoutMs / 1000}s)`));
                    }, stepTimeoutMs);
                });

                let stepResult;
                try {
                    stepResult = await Promise.race([stepPromise, stepTimeoutPromise]);
                } catch (stepErr) {
                    if (signal.aborted) {
                        const timeoutMsg = `整体超时中止 (已执行 ${this.currentStep} 步)`;
                        this.results.push(`Step ${this.currentStep}: ${timeoutMsg}`);
                        if (onStep) {
                            onStep({
                                step: this.currentStep,
                                result: timeoutMsg,
                                state: AgentState.ERROR,
                                terminated: true,
                                timeout: true
                            });
                        }
                        break;
                    }
                    stepResult = `超时跳过 - ${stepErr.message}`;
                    console.warn(`[${this.name}] 流式第 ${this.currentStep} 步超时: ${stepErr.message}`);
                }

                this.results.push(`Step ${this.currentStep}: ${stepResult}`);

                // 通过回调推送每步结果
                if (onStep) {
                    onStep({
                        step: this.currentStep,
                        result: stepResult,
                        state: this.state,
                        messageList: [...this.messageList],
                        traceId: this.traceId
                    });
                }
            }

            if (this.currentStep >= this.maxSteps && this.state !== AgentState.FINISHED) {
                this.state = AgentState.FINISHED;
                const terminateMsg = `Terminated: Reached max steps (${this.maxSteps})`;
                this.results.push(terminateMsg);

                // O 层：记录状态变化 → FINISHED
                if (this.tracer) {
                    this.tracer.recordStateChange(this.currentStep, {
                        from: 'running',
                        to: 'finished',
                        reason: `达到最大步数上限 (${this.maxSteps})`
                    });
                }

                if (onStep) {
                    onStep({
                        step: this.currentStep,
                        result: terminateMsg,
                        state: this.state,
                        terminated: true
                    });
                }
            }

            if (signal.aborted && this.state !== AgentState.FINISHED) {
                this.state = AgentState.ERROR;

                // O 层：记录状态变化 → ERROR
                if (this.tracer) {
                    this.tracer.recordStateChange(this.currentStep, {
                        from: 'running',
                        to: 'error',
                        reason: `流式整体超时 (${timeoutMs / 1000}s)`
                    });
                    this.tracer.recordError(this.currentStep, {
                        phase: 'runStream',
                        error: `流式 Agent 整体超时 (${timeoutMs / 1000}s)`
                    });
                }

                if (onStep) {
                    onStep({
                        step: this.currentStep,
                        result: `整体超时 (${timeoutMs / 1000}s)`,
                        state: this.state,
                        timeout: true,
                        terminated: true
                    });
                }
            }

        } catch (err) {
            this.state = AgentState.ERROR;
            console.error(`[${this.name}] 流式 Agent 执行出错:`, err.message);

            // O 层：记录错误
            if (this.tracer) {
                this.tracer.recordError(this.currentStep, {
                    phase: 'runStream',
                    error: err,
                    stack: err.stack
                });
                this.tracer.recordStateChange(this.currentStep, {
                    from: 'running',
                    to: 'error',
                    reason: err.message
                });
            }

            if (onStep) {
                onStep({
                    step: this.currentStep,
                    result: `错误: ${err.message}`,
                    state: this.state,
                    error: true
                });
            }
            throw err;
        } finally {
            clearTimeout(overallTimeoutId);

            // 持久化会话
            if (sessionId) {
                try {
                    const SessionStore = require('../services/SessionStore');
                    await SessionStore.appendMessages(sessionId, this.userId, 'study-agent', this.messageList);
                } catch (e) {
                    console.warn(`[${this.name}] SessionStore 持久化失败:`, e.message);
                }
            }

            // O 层：记录最终状态
            if (this.tracer && this.state === AgentState.FINISHED) {
                this.tracer.recordStateChange(this.currentStep, {
                    from: 'running',
                    to: 'finished',
                    reason: '流式 Agent 正常完成'
                });
            }

            await this.cleanup();
        }

        return this.results;
    }

    /**
     * 单步执行（抽象方法，由子类实现）
     * BaseAgent 只管循环，具体每步做什么交给子类
     */
    async step() {
        throw new Error('step() 必须由子类实现');
    }

    /**
     * 清理钩子（子类可重写）
     */
    async cleanup() {
        // 默认空实现
    }

    /**
     * 重置 Agent 状态
     */
    reset() {
        this.state = AgentState.IDLE;
        this.currentStep = 0;
        this.messageList = [];
        this.results = [];
        this.traceId = null;
        this.sessionId = null;
        this.tracer = null;
    }

    /**
     * 获取最终回复内容（从 messageList 中提取最后的 assistant 消息）
     */
    getFinalResponse() {
        for (let i = this.messageList.length - 1; i >= 0; i--) {
            const msg = this.messageList[i];
            if (msg.role === 'assistant' && msg.content) {
                return msg.content;
            }
        }
        // 如果没有 assistant 消息，从 results 中拼接
        return this.results.join('\n\n');
    }
}

module.exports = { BaseAgent, AgentState };
