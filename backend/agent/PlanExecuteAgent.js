/**
 * PlanExecuteAgent - Plan-and-Execute 任务分解智能体
 * 职责：先规划再执行，支持动态修订计划
 *
 * 基于 Harness Engineering 的 L 层（生命周期编排）增强
 * 解决当前项目仅有单 Agent 单链 ReAct、无任务分解的短板
 *
 * 核心设计：
 *   - plan(): LLM 将复杂任务分解为结构化子任务列表（JSON 数组）
 *   - executePlan(): 逐步执行子任务，每个子任务可调用不同工具组合
 *   - 支持 plan 修订：执行过程中如发现 plan 不合理，可动态修订
 *   - 支持子任务间依赖：标记哪些子任务需要等前一个完成
 *   - 记录执行轨迹：每步的 plan、执行结果、修订记录
 *   - step() 覆写：先 plan 再逐步 execute
 *   - maxPlanIterations 防止无限修订
 *
 * 继承链：BaseAgent → ReActAgent → ToolCallAgent → PlanExecuteAgent
 *
 * 执行流程：
 *   step() 循环驱动阶段状态机：
 *     PLANNING → EXECUTING → (REVISING → EXECUTING)* → DONE
 *   每次 step() 调用完成一个阶段转换或一个子任务执行
 *
 * 注意：实例属性使用 this.taskPlan（子任务列表），
 *       原型方法使用 plan()（生成/修订计划），
 *       避免实例属性遮蔽原型方法。
 */

const { ToolCallAgent } = require('./ToolCallAgent');
const { AgentState } = require('./BaseAgent');
const { chat, chatWithTools, getActiveProvider, AIProvider, extractJSON } = require('../services/AIService');

// 执行阶段枚举
const PlanPhase = {
    PLANNING: 'planning',     // 规划阶段：生成或修订计划
    EXECUTING: 'executing',   // 执行阶段：逐步执行子任务
    REVISING: 'revising',    // 修订阶段：重新规划
    DONE: 'done'             // 完成阶段
};

// 子任务状态枚举
const SubTaskStatus = {
    PENDING: 'pending',       // 待执行
    RUNNING: 'running',       // 执行中
    COMPLETED: 'completed',   // 已完成
    FAILED: 'failed',         // 失败
    SKIPPED: 'skipped'        // 跳过（依赖未满足）
};

// 默认最大修订次数
const DEFAULT_MAX_PLAN_ITERATIONS = 3;

// ===== Plan 系统提示词 =====
const PLAN_SYSTEM_PROMPT = `你是一个任务规划专家。你的职责是将复杂任务分解为可执行的子任务列表。

分解原则：
1. 每个子任务应该是一个可独立验证的最小工作单元
2. 明确每个子任务需要使用的工具（从可用工具列表中选择）
3. 标注子任务间的依赖关系（dependsOn 填写前置子任务的 id，空数组表示无依赖）
4. 子任务数量控制在 2-8 个之间
5. 子任务应按执行顺序排列，有依赖的子任务排在被依赖的子任务之后

输出格式（纯 JSON 数组，不要包含其他文字）：
[
  {
    "id": 1,
    "description": "子任务描述",
    "tools": ["tool_name1", "tool_name2"],
    "dependsOn": [],
    "reasoning": "为什么需要这个子任务"
  },
  {
    "id": 2,
    "description": "子任务描述",
    "tools": ["tool_name1"],
    "dependsOn": [1],
    "reasoning": "依赖子任务1的结果"
  }
]`;

// ===== Revision 系统提示词 =====
const REVISION_SYSTEM_PROMPT = `你是一个任务计划修订专家。根据当前执行进展，判断计划是否需要修订。

修订原则：
1. 如果执行过程中发现新的信息导致原计划不合理，应修订
2. 如果某个子任务失败且影响了后续子任务，应修订
3. 已完成的子任务不要重复包含在修订后的计划中
4. 修订后的计划只包含尚未完成的子任务

输出格式（纯 JSON，不要包含其他文字）：
{
  "needsRevision": true,
  "reason": "修订原因",
  "revisedPlan": [
    {
      "id": 3,
      "description": "...",
      "tools": ["..."],
      "dependsOn": [],
      "reasoning": "..."
    }
  ]
}

如果计划合理无需修订，返回：{"needsRevision": false, "reason": "计划仍然合理"}`;

// ===== 子任务执行引导提示词 =====
const SUBTASK_NEXT_STEP_PROMPT = `你正在执行一个计划中的子任务。请根据子任务描述选择最合适的工具来完成任务。
完成子任务后，请调用 terminate 工具结束当前子任务的执行。
如果已有信息足以完成子任务，直接给出结果并调用 terminate。`;

class PlanExecuteAgent extends ToolCallAgent {
    /**
     * 构造 PlanExecuteAgent
     * @param {Object} options - 配置选项
     * @param {string} [options.name='PlanExecuteAgent'] - Agent 名称
     * @param {number} [options.maxPlanIterations=3] - 最大计划修订次数
     * @param {string} [options.planModel='qwen-turbo'] - 规划阶段使用的模型
     * @param {number} [options.planMaxTokens=1500] - 规划阶段最大 token 数
     * @param {Array} [options.tools] - 可用工具集
     * @param {string} [options.systemPrompt] - 系统提示词
     * @param {number} [options.userId] - 用户 ID
     */
    constructor(options = {}) {
        super(options);

        // 计划状态
        // 注意：使用 this.taskPlan 而非 this.plan，避免遮蔽原型方法 plan()
        this.taskPlan = [];                  // 当前子任务列表
        this.currentSubTaskIndex = 0;        // 当前执行的子任务索引
        this.phase = PlanPhase.PLANNING;      // 当前执行阶段
        this.planIterations = 0;             // 已修订次数
        this.maxPlanIterations = options.maxPlanIterations || DEFAULT_MAX_PLAN_ITERATIONS;

        // 执行轨迹（记录每步的 plan、执行结果、修订记录）
        this.executionTrace = [];

        // 规划阶段模型配置
        this.planModel = options.planModel || 'qwen-turbo';
        this.planMaxTokens = options.planMaxTokens || 1500;

        // Agent 名称
        this.name = options.name || 'PlanExecuteAgent';

        // 保存原始的 nextStepPrompt，子任务执行时临时替换
        this._originalNextStepPrompt = this.nextStepPrompt;
    }

    /**
     * plan: 让 LLM 将复杂任务分解为结构化子任务列表
     *
     * 首次规划时基于用户原始输入生成计划；
     * 修订时基于已完成的子任务结果和剩余任务重新生成计划。
     *
     * @param {boolean} [isRevision=false] - 是否为修订模式
     * @returns {Array} 子任务列表
     */
    async plan(isRevision = false) {
        console.log(`[PlanExecuteAgent] ${isRevision ? '修订' : '生成'}计划中... (第 ${this.planIterations + 1} 次规划)`);

        // 无 AI API Key 时的降级处理：生成简单的单步计划
        if (getActiveProvider() === AIProvider.LOCAL) {
            return this._planLocal(isRevision);
        }

        // 构建规划消息
        const messages = this._buildPlanMessages(isRevision);

        // 调用 LLM 生成计划
        const result = await chat(messages, {
            model: this.planModel,
            temperature: 0.3,
            maxTokens: this.planMaxTokens,
            userId: this.userId,
            endpoint: `/agent/${this.name}/plan`
        });

        // 提取 JSON 子任务列表
        const subtasks = extractJSON(result.content);

        if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
            console.warn(`[PlanExecuteAgent] 计划解析失败，使用降级单步计划`);
            return this._planLocal(isRevision);
        }

        // 标准化子任务结构 + 继承已完成子任务的状态
        const normalizedPlan = this._normalizePlan(subtasks, isRevision);

        // 记录执行轨迹
        this._recordTrace({
            type: isRevision ? 'revise' : 'plan',
            description: isRevision ? `第 ${this.planIterations + 1} 次修订计划` : '初始计划生成',
            plan: normalizedPlan.map(s => ({ ...s }))
        });

        console.log(`[PlanExecuteAgent] 计划${isRevision ? '修订' : '生成'}完成，共 ${normalizedPlan.length} 个子任务`);
        normalizedPlan.forEach(s => {
            console.log(`[PlanExecuteAgent]   子任务 #${s.id}: ${s.description} (工具: ${s.tools.join(', ') || '无'}, 依赖: [${(s.dependsOn || []).join(', ')}])`);
        });

        return normalizedPlan;
    }

    /**
     * executePlan: 逐步执行子任务
     *
     * 每次调用执行一个子任务（由 step() 驱动）。
     * 执行完成后检查是否需要修订计划。
     *
     * @returns {string} 执行结果摘要
     */
    async executePlan() {
        // 查找下一个可执行的子任务（依赖已满足 + 待执行）
        const subtask = this._getNextExecutableSubtask();

        if (!subtask) {
            // 没有可执行的子任务，检查是否有因依赖未满足而跳过的
            const skipped = this.taskPlan.filter(s => s.status === SubTaskStatus.PENDING);
            if (skipped.length > 0) {
                // 将依赖未满足的子任务标记为跳过
                skipped.forEach(s => {
                    s.status = SubTaskStatus.SKIPPED;
                    console.log(`[PlanExecuteAgent] 子任务 #${s.id} 因依赖未满足被跳过`);
                });
                this._recordTrace({
                    type: 'skip',
                    description: `${skipped.length} 个子任务因依赖未满足被跳过`,
                    subtaskId: null
                });
            }

            // 所有子任务处理完毕
            this.phase = PlanPhase.DONE;
            this.state = AgentState.FINISHED;

            const completedCount = this.taskPlan.filter(s => s.status === SubTaskStatus.COMPLETED).length;
            const summary = `计划执行完成：${completedCount}/${this.taskPlan.length} 个子任务完成`;

            // 记录最终轨迹
            this._recordTrace({
                type: 'done',
                description: summary,
                plan: this.taskPlan.map(s => ({ ...s }))
            });

            console.log(`[PlanExecuteAgent] ${summary}`);
            return summary;
        }

        // 标记子任务为执行中
        subtask.status = SubTaskStatus.RUNNING;
        console.log(`[PlanExecuteAgent] 执行子任务 #${subtask.id}: ${subtask.description}`);

        // 记录开始执行
        this._recordTrace({
            type: 'execute_start',
            description: `开始执行子任务 #${subtask.id}: ${subtask.description}`,
            subtaskId: subtask.id
        });

        // 执行子任务
        let result;
        let success = true;

        try {
            result = await this._executeSubtask(subtask);
            subtask.status = SubTaskStatus.COMPLETED;
            subtask.result = result;
            console.log(`[PlanExecuteAgent] 子任务 #${subtask.id} 执行完成`);
        } catch (err) {
            result = `子任务执行失败: ${err.message}`;
            subtask.status = SubTaskStatus.FAILED;
            subtask.result = result;
            success = false;
            console.error(`[PlanExecuteAgent] 子任务 #${subtask.id} 执行失败:`, err.message);
        }

        // 推进索引
        this.currentSubTaskIndex++;

        // 记录执行结果轨迹
        this._recordTrace({
            type: 'execute_result',
            description: `子任务 #${subtask.id} ${success ? '完成' : '失败'}: ${result.substring(0, 200)}`,
            subtaskId: subtask.id,
            result: result,
            success: success
        });

        // 检查是否需要修订计划
        if (!success || this._shouldCheckRevision(subtask, result)) {
            if (this.planIterations < this.maxPlanIterations) {
                console.log(`[PlanExecuteAgent] 子任务 #${subtask.id} ${success ? '完成后' : '失败后'}触发计划修订检查`);
                this.phase = PlanPhase.REVISING;
            } else {
                console.warn(`[PlanExecuteAgent] 已达最大修订次数 (${this.maxPlanIterations})，继续执行当前计划`);
            }
        }

        return `子任务 #${subtask.id} ${success ? '完成' : '失败'}: ${result.substring(0, 200)}`;
    }

    /**
     * step: 覆写模板方法，先 plan 再逐步 execute
     *
     * 阶段状态机：
     *   PLANNING → 生成计划 → EXECUTING
     *   EXECUTING → 执行子任务 → (REVISING → 修订计划 → EXECUTING)* → DONE
     *   DONE → 标记 FINISHED
     *
     * @returns {string} 当前步骤执行结果
     */
    async step() {
        try {
            switch (this.phase) {
                case PlanPhase.PLANNING:
                    return await this._handlePlanning();

                case PlanPhase.EXECUTING:
                    return await this.executePlan();

                case PlanPhase.REVISING:
                    return await this._handleRevising();

                case PlanPhase.DONE:
                    this.state = AgentState.FINISHED;
                    return '计划已全部完成';

                default:
                    this.state = AgentState.FINISHED;
                    return '未知阶段，终止执行';
            }
        } catch (err) {
            console.error(`[PlanExecuteAgent] step 执行失败:`, err.message);
            return `步骤执行失败: ${err.message}`;
        }
    }

    /**
     * 获取执行轨迹
     * @returns {Array} 执行轨迹数组
     */
    getExecutionTrace() {
        return this.executionTrace;
    }

    /**
     * 获取执行摘要
     * @returns {Object} 执行摘要 { totalSubtasks, completed, failed, skipped, revisions, trace }
     */
    getExecutionSummary() {
        const completed = this.taskPlan.filter(s => s.status === SubTaskStatus.COMPLETED).length;
        const failed = this.taskPlan.filter(s => s.status === SubTaskStatus.FAILED).length;
        const skipped = this.taskPlan.filter(s => s.status === SubTaskStatus.SKIPPED).length;

        return {
            totalSubtasks: this.taskPlan.length,
            completed,
            failed,
            skipped,
            revisions: this.planIterations,
            phase: this.phase,
            trace: this.executionTrace
        };
    }

    // ===== 内部方法 =====

    /**
     * 处理 PLANNING 阶段：生成初始计划
     * @returns {string} 规划结果摘要
     */
    async _handlePlanning() {
        this.taskPlan = await this.plan(false);
        this.currentSubTaskIndex = 0;
        this.phase = PlanPhase.EXECUTING;
        return `计划生成完成，共 ${this.taskPlan.length} 个子任务，开始执行`;
    }

    /**
     * 处理 REVISING 阶段：修订计划
     * @returns {string} 修订结果摘要
     */
    async _handleRevising() {
        this.planIterations++;

        if (this.planIterations > this.maxPlanIterations) {
            console.warn(`[PlanExecuteAgent] 已达最大修订次数 ${this.maxPlanIterations}，继续执行剩余计划`);
            this.phase = PlanPhase.EXECUTING;
            return `已达最大修订次数，继续执行剩余计划`;
        }

        console.log(`[PlanExecuteAgent] 开始第 ${this.planIterations} 次修订计划`);
        this.taskPlan = await this.plan(true);
        this.phase = PlanPhase.EXECUTING;
        return `计划已修订（第 ${this.planIterations} 次），共 ${this.taskPlan.length} 个待执行子任务`;
    }

    /**
     * 执行单个子任务：利用父类 think() + act() 机制
     *
     * 将子任务描述注入消息上下文，临时替换 nextStepPrompt，
     * 然后调用 ToolCallAgent 的 think/act 循环完成工具调用。
     *
     * @param {Object} subtask - 子任务对象
     * @returns {string} 执行结果
     */
    async _executeSubtask(subtask) {
        // 临时替换 nextStepPrompt，引导 AI 聚焦当前子任务
        const originalNextStepPrompt = this.nextStepPrompt;
        const toolHint = subtask.tools && subtask.tools.length > 0
            ? `建议优先使用以下工具: ${subtask.tools.join(', ')}`
            : '根据需要选择合适的工具';
        this.nextStepPrompt = `当前子任务: ${subtask.description}\n${toolHint}\n${SUBTASK_NEXT_STEP_PROMPT}`;

        // 将子任务描述作为用户消息注入上下文
        this.messageList.push({
            role: 'user',
            content: `[子任务 #${subtask.id}] ${subtask.description}`
        });

        let result;

        try {
            // 调用 think: AI 决策要调用哪些工具
            const shouldAct = await this.think();

            if (shouldAct) {
                // 调用 act: 执行工具调用
                result = await this.act();

                // 检查是否需要多轮工具调用（think 返回 true 但 act 后可能还需继续）
                // 如果状态不是 FINISHED 且仍有 pending 工具调用，继续循环
                let safetyCounter = 0;
                while (this.state !== AgentState.FINISHED &&
                       this.pendingToolCalls && this.pendingToolCalls.length > 0 &&
                       safetyCounter < 5) {
                    result += '\n' + await this.act();
                    safetyCounter++;
                }

                // 重置 FINISHED 状态（子任务完成不等于整个计划完成）
                if (this.state === AgentState.FINISHED) {
                    this.state = AgentState.RUNNING;
                }
            } else {
                // 无需调用工具，AI 已有答案
                result = this.lastAssistantMessage?.content || '子任务无需工具调用，已完成';

                // think 返回 false 时 state 可能为 IDLE，重置为 RUNNING
                if (this.state !== AgentState.RUNNING) {
                    this.state = AgentState.RUNNING;
                }
            }
        } finally {
            // 恢复原始 nextStepPrompt
            this.nextStepPrompt = originalNextStepPrompt;
        }

        return result;
    }

    /**
     * 构建规划阶段的消息列表
     * @param {boolean} isRevision - 是否为修订
     * @returns {Array} 消息数组
     */
    _buildPlanMessages(isRevision) {
        const messages = [];

        // 系统提示词
        messages.push({ role: 'system', content: PLAN_SYSTEM_PROMPT });

        // 构建可用工具描述
        const toolDescriptions = this.tools.map(t =>
            `- ${t.name}: ${t.description}`
        ).join('\n');

        // 提取用户原始任务（从 messageList 中找到第一条 user 消息）
        const userMessages = this.messageList.filter(m => m.role === 'user' && !m.content.startsWith('[子任务'));
        const userTask = userMessages.length > 0
            ? userMessages[0].content
            : (this.messageList.find(m => m.role === 'user')?.content || '');

        if (!isRevision) {
            // 首次规划：提供用户任务 + 可用工具
            messages.push({
                role: 'user',
                content: `可用工具列表：\n${toolDescriptions}\n\n需要分解的任务：\n${userTask}\n\n请将此任务分解为子任务列表（JSON 数组）。`
            });
        } else {
            // 修订规划：提供已完成子任务结果 + 剩余子任务 + 失败原因
            const completedTasks = this.taskPlan
                .filter(s => s.status === SubTaskStatus.COMPLETED)
                .map(s => `子任务 #${s.id} [已完成]: ${s.description}\n  结果: ${(s.result || '').substring(0, 200)}`)
                .join('\n');

            const failedTasks = this.taskPlan
                .filter(s => s.status === SubTaskStatus.FAILED)
                .map(s => `子任务 #${s.id} [失败]: ${s.description}\n  失败原因: ${s.result || '未知'}`)
                .join('\n');

            const pendingTasks = this.taskPlan
                .filter(s => s.status === SubTaskStatus.PENDING)
                .map(s => `子任务 #${s.id} [待执行]: ${s.description}`)
                .join('\n');

            messages.push({
                role: 'user',
                content: `原始任务：\n${userTask}\n\n可用工具列表：\n${toolDescriptions}\n\n当前执行进展：\n${completedTasks || '（无已完成子任务）'}\n${failedTasks || '（无失败子任务）'}\n\n剩余待执行子任务：\n${pendingTasks || '（无）'}\n\n请根据当前进展判断是否需要修订计划，并输出修订后的计划（只包含未完成的子任务）。`
            });
        }

        return messages;
    }

    /**
     * 查找下一个可执行的子任务（依赖已满足 + 状态为 PENDING）
     * @returns {Object|null} 子任务对象，无则返回 null
     */
    _getNextExecutableSubtask() {
        for (let i = this.currentSubTaskIndex; i < this.taskPlan.length; i++) {
            const subtask = this.taskPlan[i];

            // 跳过已处理的子任务
            if (subtask.status !== SubTaskStatus.PENDING) {
                continue;
            }

            // 检查依赖是否全部满足（依赖子任务状态为 COMPLETED）
            const dependencies = subtask.dependsOn || [];
            const depsMet = dependencies.every(depId => {
                const dep = this.taskPlan.find(s => s.id === depId);
                return dep && dep.status === SubTaskStatus.COMPLETED;
            });

            if (depsMet) {
                this.currentSubTaskIndex = i;
                return subtask;
            } else {
                // 依赖未满足，标记跳过
                subtask.status = SubTaskStatus.SKIPPED;
                console.log(`[PlanExecuteAgent] 子任务 #${subtask.id} 依赖未满足，标记为跳过`);
                this._recordTrace({
                    type: 'skip',
                    description: `子任务 #${subtask.id} 依赖未满足，跳过`,
                    subtaskId: subtask.id
                });
            }
        }

        return null;
    }

    /**
     * 判断是否需要检查计划修订
     * @param {Object} subtask - 刚执行完的子任务
     * @param {string} result - 执行结果
     * @returns {boolean} 是否需要修订
     */
    _shouldCheckRevision(subtask, result) {
        // 子任务失败时自动触发修订检查
        if (subtask.status === SubTaskStatus.FAILED) {
            return true;
        }

        // 结果中包含错误关键词时触发修订检查
        const errorKeywords = ['失败', '错误', '无法', '不存在', '未找到', 'error', 'failed'];
        const lowerResult = (result || '').toLowerCase();
        if (errorKeywords.some(kw => lowerResult.includes(kw.toLowerCase()))) {
            return true;
        }

        return false;
    }

    /**
     * 标准化子任务结构，确保字段完整
     * 修订时保留已完成子任务的原始状态
     *
     * @param {Array} rawPlan - LLM 返回的原始子任务列表
     * @param {boolean} isRevision - 是否为修订
     * @returns {Array} 标准化后的子任务列表
     */
    _normalizePlan(rawPlan, isRevision) {
        let normalized;

        if (isRevision) {
            // 修订模式：保留已完成/跳过的子任务，替换待执行的子任务
            const completedTasks = this.taskPlan.filter(s =>
                s.status === SubTaskStatus.COMPLETED || s.status === SubTaskStatus.SKIPPED
            );

            // 标准化新计划中未完成的子任务
            const newPendingTasks = rawPlan.map((s, index) => ({
                id: s.id || (completedTasks.length + index + 1),
                description: s.description || '未描述子任务',
                tools: Array.isArray(s.tools) ? s.tools : [],
                dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
                reasoning: s.reasoning || '',
                status: SubTaskStatus.PENDING,
                result: null
            }));

            normalized = [...completedTasks, ...newPendingTasks];
        } else {
            // 首次规划：标准化所有子任务
            normalized = rawPlan.map((s, index) => ({
                id: s.id || (index + 1),
                description: s.description || `子任务 ${index + 1}`,
                tools: Array.isArray(s.tools) ? s.tools : [],
                dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
                reasoning: s.reasoning || '',
                status: SubTaskStatus.PENDING,
                result: null
            }));
        }

        return normalized;
    }

    /**
     * 记录执行轨迹
     * @param {Object} entry - 轨迹条目 { type, description, subtaskId?, result?, plan?, success? }
     */
    _recordTrace(entry) {
        this.executionTrace.push({
            timestamp: new Date().toISOString(),
            step: this.currentStep,
            planVersion: this.planIterations,
            phase: this.phase,
            ...entry
        });
    }

    /**
     * 无 AI API Key 时的本地降级规划
     * 生成简单的单步计划：直接处理用户输入
     *
     * @param {boolean} isRevision - 是否为修订
     * @returns {Array} 降级单步计划
     */
    _planLocal(isRevision) {
        // 提取用户任务
        const userMessages = this.messageList.filter(m => m.role === 'user');
        const userTask = userMessages.length > 0 ? userMessages[0].content : '';

        // 收集所有工具名称作为推荐工具
        const allToolNames = this.tools.map(t => t.name).filter(n => n !== 'terminate');

        const plan = [{
            id: 1,
            description: isRevision
                ? `（降级修订）直接处理用户任务：${userTask.substring(0, 100)}`
                : `直接处理用户任务：${userTask.substring(0, 100)}`,
            tools: allToolNames,
            dependsOn: [],
            reasoning: '未配置 AI API Key，无法智能分解任务，使用单步降级计划',
            status: SubTaskStatus.PENDING,
            result: null
        }];

        console.log(`[PlanExecuteAgent] 使用降级单步计划（无 AI API Key）`);

        this._recordTrace({
            type: isRevision ? 'revise' : 'plan',
            description: '降级单步计划（无 AI API Key）',
            plan: plan.map(s => ({ ...s }))
        });

        return plan;
    }

    /**
     * 重置 Agent 状态（包括计划相关状态）
     */
    reset() {
        super.reset();
        this.taskPlan = [];
        this.currentSubTaskIndex = 0;
        this.phase = PlanPhase.PLANNING;
        this.planIterations = 0;
        this.executionTrace = [];
    }
}

module.exports = { PlanExecuteAgent, PlanPhase, SubTaskStatus };
