/**
 * MultiAgentOrchestrator - 多 Agent 编排器
 * 职责：注册多个 Agent、任务路由、Agent 间委派、并行执行、结果聚合
 *
 * 基于 Harness Engineering 的 L 层（生命周期编排）增强
 * 解决当前项目仅有单 Agent 单链 ReAct、无多 Agent 协作的短板
 *
 * 核心能力：
 *   1. 注册多个不同类型的 Agent（studyAgent、errorAgent、practiceAgent 等）
 *   2. 任务路由：根据用户意图自动选择最合适的 Agent（LLM 意图分类 + 关键词降级）
 *   3. Agent 间委派：一个 Agent 可将子任务委派给另一个 Agent
 *   4. 并行执行：多个独立子任务可并行执行（Promise.all）
 *   5. 统一的执行结果聚合（简单拼接 + LLM 智能综合）
 *
 * 设计说明：
 *   - 编排器本身不是 Agent，而是协调多个 Agent 的管理器
 *   - Agent 通过工厂函数注册，每请求创建独立实例（避免 messageList 串话）
 *   - 路由优先使用 LLM 意图分类，无 API Key 时降级为关键词匹配
 *   - 委派和并行执行均返回统一的执行结果结构
 */

const { chat, getActiveProvider, AIProvider, extractJSON } = require('../services/AIService');

// ===== 路由系统提示词 =====
const ROUTING_SYSTEM_PROMPT = `你是一个任务路由专家。你的职责是根据用户的输入，判断应该由哪个 Agent 来处理。

路由原则：
1. 根据用户意图匹配最合适的 Agent
2. 考虑每个 Agent 的能力描述和专长领域
3. 如果用户意图模糊，选择能力最通用的 Agent
4. 置信度 0-1 之间，越高表示越确定

输出格式（纯 JSON，不要包含其他文字）：
{
  "agent": "agentName",
  "confidence": 0.9,
  "reasoning": "选择该 Agent 的原因"
}`;

// ===== 结果聚合系统提示词 =====
const AGGREGATION_SYSTEM_PROMPT = `你是一个结果聚合专家。你的职责是将多个 Agent 的执行结果综合成一个连贯、完整的回复。

聚合原则：
1. 保留各 Agent 结果中的关键信息，去除冗余
2. 按逻辑顺序组织内容（如：分析→建议→练习）
3. 如果结果有冲突，以更权威的 Agent 结果为准
4. 输出格式清晰，使用适当的标题和分段

请直接输出综合后的回复，不要包含 JSON 或其他元信息。`;

// 默认配置
const DEFAULT_ROUTING_MODEL = 'qwen-turbo';
const DEFAULT_ROUTING_MAX_TOKENS = 500;
const DEFAULT_AGGREGATION_MAX_TOKENS = 1500;

class MultiAgentOrchestrator {
    /**
     * 构造 MultiAgentOrchestrator
     * @param {Object} options - 配置选项
     * @param {string} [options.name='MultiAgentOrchestrator'] - 编排器名称
     * @param {number} [options.userId] - 用户 ID（传递给 Agent）
     * @param {string} [options.routingModel='qwen-turbo'] - 路由分类使用的模型
     * @param {number} [options.routingMaxTokens=500] - 路由分类最大 token
     * @param {number} [options.aggregationMaxTokens=1500] - 结果聚合最大 token
     * @param {number} [options.timeoutMs=120000] - 单个 Agent 执行超时
     * @param {number} [options.stepTimeoutMs=30000] - 单步执行超时
     */
    constructor(options = {}) {
        // Agent 注册表：name → { name, factory, capabilities, description }
        this.agents = new Map();

        // 配置
        this.name = options.name || 'MultiAgentOrchestrator';
        this.userId = options.userId || null;
        this.routingModel = options.routingModel || DEFAULT_ROUTING_MODEL;
        this.routingMaxTokens = options.routingMaxTokens || DEFAULT_ROUTING_MAX_TOKENS;
        this.aggregationMaxTokens = options.aggregationMaxTokens || DEFAULT_AGGREGATION_MAX_TOKENS;
        this.timeoutMs = options.timeoutMs || 120000;
        this.stepTimeoutMs = options.stepTimeoutMs || 30000;

        // 执行历史（用于审计和调试）
        this.executionHistory = [];

        console.log(`[MultiAgentOrchestrator] 编排器初始化完成 (userId: ${this.userId || 'null'})`);
    }

    // ===== Agent 注册管理 =====

    /**
     * 注册 Agent
     *
     * @param {string} name - Agent 唯一标识名（如 studyAgent、errorAgent）
     * @param {Function} factory - Agent 工厂函数 (options) => agentInstance
     * @param {Array<string>} capabilities - Agent 能力关键词列表（用于路由匹配）
     * @param {string} description - Agent 描述（用于路由决策）
     * @returns {boolean} 注册是否成功
     */
    registerAgent(name, factory, capabilities = [], description = '') {
        if (!name || typeof name !== 'string') {
            throw new Error('Agent 名称不能为空且必须为字符串');
        }
        if (typeof factory !== 'function') {
            throw new Error('Agent 工厂必须是一个函数');
        }
        if (this.agents.has(name)) {
            console.warn(`[MultiAgentOrchestrator] Agent "${name}" 已存在，将被覆盖`);
        }

        this.agents.set(name, {
            name,
            factory,
            capabilities,
            description
        });

        console.log(`[MultiAgentOrchestrator] 注册 Agent: ${name} (能力: ${capabilities.join(', ') || '无'}, 描述: ${description.substring(0, 50) || '无'})`);
        return true;
    }

    /**
     * 注销 Agent
     * @param {string} name - Agent 名称
     * @returns {boolean} 是否成功注销
     */
    unregisterAgent(name) {
        const removed = this.agents.delete(name);
        if (removed) {
            console.log(`[MultiAgentOrchestrator] 注销 Agent: ${name}`);
        }
        return removed;
    }

    /**
     * 获取所有已注册的 Agent 信息
     * @returns {Array} Agent 信息列表
     */
    getRegisteredAgents() {
        return Array.from(this.agents.values()).map(entry => ({
            name: entry.name,
            capabilities: entry.capabilities,
            description: entry.description
        }));
    }

    /**
     * 检查 Agent 是否已注册
     * @param {string} name - Agent 名称
     * @returns {boolean}
     */
    hasAgent(name) {
        return this.agents.has(name);
    }

    // ===== 任务路由 =====

    /**
     * 任务路由：根据用户意图自动选择最合适的 Agent
     *
     * 优先使用 LLM 意图分类，无 API Key 时降级为关键词匹配。
     *
     * @param {string} userInput - 用户输入
     * @returns {Object} { agentName, confidence, reasoning, method }
     */
    async routeTask(userInput) {
        if (!userInput || !userInput.trim()) {
            throw new Error('用户输入不能为空');
        }

        if (this.agents.size === 0) {
            throw new Error('未注册任何 Agent，无法路由任务');
        }

        // 只有一个 Agent 时直接返回
        if (this.agents.size === 1) {
            const agentName = this.agents.keys().next().value;
            console.log(`[MultiAgentOrchestrator] 仅注册了一个 Agent，直接路由到: ${agentName}`);
            return {
                agentName,
                confidence: 1.0,
                reasoning: '仅注册一个 Agent，无需路由',
                method: 'single'
            };
        }

        // 无 AI API Key 时降级为关键词匹配
        if (getActiveProvider() === AIProvider.LOCAL) {
            return this._routeLocal(userInput);
        }

        // LLM 意图分类路由
        try {
            const messages = this._buildRoutingMessages(userInput);
            const result = await chat(messages, {
                model: this.routingModel,
                temperature: 0.1,
                maxTokens: this.routingMaxTokens,
                userId: this.userId,
                endpoint: `/orchestrator/${this.name}/route`
            });

            const parsed = extractJSON(result.content);

            if (parsed && parsed.agent && this.agents.has(parsed.agent)) {
                console.log(`[MultiAgentOrchestrator] LLM 路由结果: ${parsed.agent} (置信度: ${parsed.confidence || 'N/A'}) - ${parsed.reasoning || ''}`);
                return {
                    agentName: parsed.agent,
                    confidence: parsed.confidence || 0.5,
                    reasoning: parsed.reasoning || 'LLM 路由决策',
                    method: 'llm'
                };
            }

            // LLM 返回的 Agent 名称不匹配，降级为关键词匹配
            console.warn(`[MultiAgentOrchestrator] LLM 路由结果无效 (${parsed?.agent || 'null'})，降级为关键词匹配`);
            return this._routeLocal(userInput);
        } catch (err) {
            console.warn(`[MultiAgentOrchestrator] LLM 路由失败: ${err.message}，降级为关键词匹配`);
            return this._routeLocal(userInput);
        }
    }

    // ===== 执行 =====

    /**
     * 执行用户任务：路由到最合适的 Agent 并执行
     *
     * @param {string} userInput - 用户输入
     * @param {Object} [options={}] - 执行选项（timeoutMs, stepTimeoutMs, sessionId）
     * @returns {Object} { reply, agentUsed, routing, steps, totalSteps, traceId, state }
     */
    async execute(userInput, options = {}) {
        const startTime = Date.now();

        // 路由到最合适的 Agent
        const routing = await this.routeTask(userInput);
        console.log(`[MultiAgentOrchestrator] 任务路由到: ${routing.agentName} (方法: ${routing.method})`);

        // 创建 Agent 实例并执行
        const agent = this._createAgent(routing.agentName);
        const execOptions = {
            timeoutMs: options.timeoutMs || this.timeoutMs,
            stepTimeoutMs: options.stepTimeoutMs || this.stepTimeoutMs,
            sessionId: options.sessionId || null
        };

        const results = await agent.run(userInput, execOptions);

        const executionResult = {
            reply: agent.getFinalResponse(),
            agentUsed: routing.agentName,
            routing,
            steps: results,
            totalSteps: agent.currentStep,
            traceId: agent.traceId,
            state: agent.state,
            sessionId: execOptions.sessionId,
            // 如果是 PlanExecuteAgent，附带执行摘要
            executionSummary: typeof agent.getExecutionSummary === 'function'
                ? agent.getExecutionSummary()
                : null,
            durationMs: Date.now() - startTime
        };

        // 记录执行历史
        this._recordHistory({
            type: 'execute',
            userInput: userInput.substring(0, 200),
            ...executionResult
        });

        console.log(`[MultiAgentOrchestrator] 任务完成: Agent=${routing.agentName}, 步数=${agent.currentStep}, 状态=${agent.state}, 耗时=${executionResult.durationMs}ms`);

        return executionResult;
    }

    /**
     * Agent 间委派：将子任务委派给指定的 Agent 执行
     *
     * 一个 Agent 在执行过程中，可通过此方法将子任务委派给另一个 Agent。
     * 委派会创建新的 Agent 实例，独立执行子任务后返回结果。
     *
     * @param {string} toAgentName - 目标 Agent 名称
     * @param {string} task - 委派的子任务描述
     * @param {Object} [options={}] - 执行选项
     * @param {string} [options.fromAgent] - 委派来源 Agent 名称（用于日志追踪）
     * @returns {Object} { reply, agentUsed, steps, totalSteps, traceId, state }
     */
    async delegate(toAgentName, task, options = {}) {
        if (!this.agents.has(toAgentName)) {
            throw new Error(`委派目标 Agent "${toAgentName}" 未注册`);
        }

        const fromAgent = options.fromAgent || 'unknown';
        console.log(`[MultiAgentOrchestrator] 委派: ${fromAgent} → ${toAgentName}, 任务: ${task.substring(0, 100)}`);

        const startTime = Date.now();

        // 创建目标 Agent 实例
        const agent = this._createAgent(toAgentName);

        const execOptions = {
            timeoutMs: options.timeoutMs || this.timeoutMs,
            stepTimeoutMs: options.stepTimeoutMs || this.stepTimeoutMs,
            sessionId: options.sessionId || null
        };

        const results = await agent.run(task, execOptions);

        const delegationResult = {
            reply: agent.getFinalResponse(),
            agentUsed: toAgentName,
            delegatedBy: fromAgent,
            steps: results,
            totalSteps: agent.currentStep,
            traceId: agent.traceId,
            state: agent.state,
            durationMs: Date.now() - startTime
        };

        // 记录执行历史
        this._recordHistory({
            type: 'delegate',
            fromAgent,
            toAgent: toAgentName,
            task: task.substring(0, 200),
            ...delegationResult
        });

        console.log(`[MultiAgentOrchestrator] 委派完成: ${fromAgent} → ${toAgentName}, 耗时=${delegationResult.durationMs}ms`);

        return delegationResult;
    }

    /**
     * 并行执行：多个独立子任务同时执行
     *
     * 适用于互不依赖的子任务，通过 Promise.all 并行执行，
     * 显著缩短总执行时间（对比串行执行）。
     *
     * @param {Array} tasks - 子任务列表 [{ agentName, task, options? }]
     * @returns {Array} 各子任务的执行结果数组（顺序与输入一致）
     */
    async executeParallel(tasks) {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return [];
        }

        console.log(`[MultiAgentOrchestrator] 并行执行 ${tasks.length} 个子任务: ${tasks.map(t => `${t.agentName}(${(t.task || '').substring(0, 30)})`).join(', ')}`);

        const startTime = Date.now();

        // 为每个子任务创建独立的委派 Promise
        // 单个任务失败不影响其他任务（catch 包装防止单点故障导致 Promise.all 整体失败）
        const promises = tasks.map((task, index) => {
            const agentName = task.agentName;
            const taskDesc = task.task || '';
            const taskOptions = task.options || {};

            if (!this.agents.has(agentName)) {
                return Promise.resolve({
                    reply: `Agent "${agentName}" 未注册，子任务被跳过`,
                    agentUsed: agentName,
                    taskIndex: index,
                    error: true,
                    errorMessage: `Agent "${agentName}" 未注册`,
                    steps: [],
                    totalSteps: 0,
                    state: 'error'
                });
            }

            return this.delegate(agentName, taskDesc, {
                ...taskOptions,
                fromAgent: 'parallel-executor'
            }).then(result => ({
                ...result,
                taskIndex: index
            })).catch(err => ({
                reply: `子任务执行失败: ${err.message}`,
                agentUsed: agentName,
                taskIndex: index,
                error: true,
                errorMessage: err.message,
                steps: [],
                totalSteps: 0,
                state: 'error'
            }));
        });

        // 并行执行所有子任务
        const results = await Promise.all(promises);

        const durationMs = Date.now() - startTime;
        const successCount = results.filter(r => !r.error).length;
        const failCount = results.filter(r => r.error).length;

        console.log(`[MultiAgentOrchestrator] 并行执行完成: ${successCount} 成功, ${failCount} 失败, 耗时=${durationMs}ms`);

        // 记录执行历史
        this._recordHistory({
            type: 'parallel',
            taskCount: tasks.length,
            successCount,
            failCount,
            durationMs,
            results: results.map(r => ({
                agentUsed: r.agentUsed,
                error: r.error || false,
                state: r.state
            }))
        });

        return results;
    }

    // ===== 结果聚合 =====

    /**
     * 聚合多个 Agent 的执行结果（简单拼接模式）
     *
     * 将各 Agent 的回复按顺序拼接，附带执行统计信息。
     * 适用于快速聚合场景，不依赖 LLM。
     *
     * @param {Array} results - 执行结果数组（来自 execute 或 executeParallel）
     * @returns {Object} { totalTasks, successful, failed, summary, details }
     */
    aggregateResults(results) {
        if (!Array.isArray(results) || results.length === 0) {
            return {
                totalTasks: 0,
                successful: 0,
                failed: 0,
                summary: '无执行结果',
                details: []
            };
        }

        const successful = results.filter(r => !r.error);
        const failed = results.filter(r => r.error);

        // 按顺序拼接成功的回复
        const parts = successful.map((r, i) => {
            const agentLabel = r.agentUsed || `Agent-${i + 1}`;
            const reply = r.reply || '无回复';
            return `【${agentLabel}】\n${reply}`;
        });

        // 如果有失败的任务，附加失败信息
        if (failed.length > 0) {
            parts.push(`\n---\n以下 ${failed.length} 个子任务执行失败：`);
            failed.forEach((r, i) => {
                parts.push(`${i + 1}. [${r.agentUsed}] ${r.errorMessage || r.reply || '未知错误'}`);
            });
        }

        return {
            totalTasks: results.length,
            successful: successful.length,
            failed: failed.length,
            summary: parts.join('\n\n'),
            details: results.map(r => ({
                agentUsed: r.agentUsed,
                reply: r.reply,
                error: r.error || false,
                errorMessage: r.errorMessage || null,
                totalSteps: r.totalSteps || 0,
                state: r.state || null,
                traceId: r.traceId || null
            }))
        };
    }

    /**
     * 智能聚合多个 Agent 的执行结果（LLM 综合模式）
     *
     * 使用 LLM 将各 Agent 的回复综合成一个连贯、完整的回复。
     * 适用于需要高质量综合输出的场景。
     *
     * @param {Array} results - 执行结果数组
     * @returns {Object} { totalTasks, successful, failed, summary, details, aggregated }
     */
    async aggregateResultsWithLLM(results) {
        // 先获取简单聚合结果
        const simpleAgg = this.aggregateResults(results);

        // 无 AI API Key 时直接返回简单聚合
        if (getActiveProvider() === AIProvider.LOCAL) {
            console.log(`[MultiAgentOrchestrator] 无 AI API Key，使用简单聚合`);
            return { ...simpleAgg, aggregated: false };
        }

        // 构建 LLM 聚合消息
        const agentResults = results.filter(r => !r.error).map((r, i) => {
            return `--- Agent: ${r.agentUsed} ---\n${r.reply || '无回复'}`;
        }).join('\n\n');

        const messages = [
            { role: 'system', content: AGGREGATION_SYSTEM_PROMPT },
            {
                role: 'user',
                content: `以下是多个 Agent 的执行结果，请将它们综合成一个连贯、完整的回复：\n\n${agentResults}`
            }
        ];

        try {
            const result = await chat(messages, {
                model: this.routingModel,
                temperature: 0.5,
                maxTokens: this.aggregationMaxTokens,
                userId: this.userId,
                endpoint: `/orchestrator/${this.name}/aggregate`
            });

            return {
                ...simpleAgg,
                summary: result.content || simpleAgg.summary,
                aggregated: true
            };
        } catch (err) {
            console.warn(`[MultiAgentOrchestrator] LLM 聚合失败: ${err.message}，使用简单聚合`);
            return { ...simpleAgg, aggregated: false };
        }
    }

    // ===== 执行历史 =====

    /**
     * 获取执行历史
     * @returns {Array} 执行历史记录
     */
    getExecutionHistory() {
        return this.executionHistory;
    }

    /**
     * 清除执行历史
     */
    clearHistory() {
        this.executionHistory = [];
        console.log(`[MultiAgentOrchestrator] 执行历史已清除`);
    }

    // ===== 内部方法 =====

    /**
     * 创建 Agent 实例（通过工厂函数）
     * @param {string} name - Agent 名称
     * @returns {Object} Agent 实例
     */
    _createAgent(name) {
        const entry = this.agents.get(name);
        if (!entry) {
            throw new Error(`Agent "${name}" 未注册`);
        }

        // 通过工厂函数创建实例，注入 userId 和编排器引用
        const agent = entry.factory({
            userId: this.userId,
            orchestrator: this  // 注入编排器引用，支持 Agent 间委派
        });

        return agent;
    }

    /**
     * 构建路由分类的消息列表
     * @param {string} userInput - 用户输入
     * @returns {Array} 消息数组
     */
    _buildRoutingMessages(userInput) {
        const messages = [];

        // 系统提示词
        messages.push({ role: 'system', content: ROUTING_SYSTEM_PROMPT });

        // 构建 Agent 能力描述
        const agentList = Array.from(this.agents.values()).map(entry => {
            return `- ${entry.name}: ${entry.description || '无描述'}\n  能力关键词: ${entry.capabilities.join(', ') || '无'}`;
        }).join('\n');

        messages.push({
            role: 'user',
            content: `可用的 Agent 列表：\n${agentList}\n\n用户输入：\n${userInput}\n\n请判断应该由哪个 Agent 处理此任务，输出 JSON。`
        });

        return messages;
    }

    /**
     * 关键词匹配路由（无 AI API Key 时的降级方案）
     *
     * 将用户输入与每个 Agent 的能力关键词和描述进行匹配，
     * 选择得分最高的 Agent。
     *
     * @param {string} userInput - 用户输入
     * @returns {Object} { agentName, confidence, reasoning, method }
     */
    _routeLocal(userInput) {
        const lowerInput = userInput.toLowerCase();
        let bestMatch = null;
        let bestScore = 0;

        for (const [name, entry] of this.agents) {
            let score = 0;

            // 匹配能力关键词（权重高）
            for (const cap of entry.capabilities) {
                if (cap && lowerInput.includes(cap.toLowerCase())) {
                    score += 3;
                }
            }

            // 匹配描述中的关键词（权重低）
            if (entry.description) {
                const descWords = entry.description.toLowerCase()
                    .split(/[\s,，。、;；:：()（）]+/)
                    .filter(w => w.length > 1);
                for (const word of descWords) {
                    if (lowerInput.includes(word)) {
                        score += 1;
                    }
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = name;
            }
        }

        // 无匹配时选择第一个注册的 Agent 作为默认
        if (!bestMatch) {
            bestMatch = this.agents.keys().next().value;
            console.log(`[MultiAgentOrchestrator] 关键词无匹配，使用默认 Agent: ${bestMatch}`);
        }

        const confidence = bestScore > 0 ? Math.min(0.3 + bestScore * 0.1, 0.8) : 0.3;

        console.log(`[MultiAgentOrchestrator] 关键词路由: ${bestMatch} (得分: ${bestScore}, 置信度: ${confidence})`);

        return {
            agentName: bestMatch,
            confidence,
            reasoning: `关键词匹配 (得分: ${bestScore})`,
            method: 'keyword'
        };
    }

    /**
     * 记录执行历史
     * @param {Object} entry - 历史记录条目
     */
    _recordHistory(entry) {
        this.executionHistory.push({
            timestamp: new Date().toISOString(),
            ...entry
        });

        // 限制历史记录数量，防止内存泄漏
        if (this.executionHistory.length > 100) {
            this.executionHistory = this.executionHistory.slice(-100);
        }
    }
}

module.exports = { MultiAgentOrchestrator };
