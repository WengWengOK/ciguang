/**
 * ToolCallAgent - 工具调用智能体
 * 职责：手动管理工具调用（think 决策 + act 执行）
 *
 * 设计参考：yu-ai-agent 的 ToolCallAgent.java
 * 核心设计决策：
 *   - 禁用 AI API 内置的自动工具执行
 *   - think() 让模型决策要调用哪些工具
 *   - act() 手动执行工具，控制每一步
 *   - 通过检测终止工具名来置 FINISHED 状态
 *
 * 这让 Agent 能逐步暴露推理过程，而非黑盒执行
 */

const { ReActAgent } = require('./ReActAgent');
const { AgentState } = require('./BaseAgent');
const { chatWithTools, getActiveProvider, AIProvider } = require('../services/AIService');

// 终止工具名称（Agent 调用此工具表示任务完成）
const TERMINATE_TOOL_NAME = 'terminate';

class ToolCallAgent extends ReActAgent {
    constructor(options = {}) {
        super(options);

        // 工具集
        this.tools = options.tools || [];

        // 暂存 think 阶段的 AI 响应（供 act 阶段使用）
        this.pendingToolCalls = [];
        this.lastAssistantMessage = null;

        // 系统提示词
        if (options.systemPrompt) {
            this.systemPrompt = options.systemPrompt;
        }
        if (options.nextStepPrompt) {
            this.nextStepPrompt = options.nextStepPrompt;
        }
    }

    /**
     * think: 让 AI 决策下一步要调用哪些工具
     * 将工具定义传给 AI，但不自动执行，只获取决策
     *
     * @returns {boolean} true=需要执行工具, false=无需执行（已有答案）
     */
    async think() {
        // 构建 messages（system prompt + 历史消息 + nextStepPrompt）
        const messages = [];

        if (this.systemPrompt) {
            messages.push({ role: 'system', content: this.systemPrompt });
        }

        // 加入历史消息（不含 system，因为已单独添加）
        this.messageList.forEach(msg => {
            // 跳过已作为 system 添加的第一条
            if (msg.role !== 'system') {
                messages.push(msg);
            }
        });

        // 追加 nextStepPrompt 引导模型主动选工具
        if (this.nextStepPrompt) {
            messages.push({ role: 'user', content: this.nextStepPrompt });
        }

        // 转换工具定义为 AI API 格式
        const toolDefinitions = this.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));

        // 无 AI API Key 时的降级处理
        if (getActiveProvider() === AIProvider.LOCAL) {
            return this.thinkLocal(messages);
        }

        // 调用 AI（带工具定义，但不自动执行）
        const result = await chatWithTools(messages, toolDefinitions, {
            model: this.model || 'qwen-turbo',
            temperature: 0.7,
            maxTokens: this.maxTokens || 800,
            userId: this.userId,
            endpoint: `/agent/${this.name}/think`
        });

        // 暂存 AI 响应
        this.lastAssistantMessage = result;

        // 检查是否有工具调用
        if (result.toolCalls && result.toolCalls.length > 0) {
            // 需要执行工具
            this.pendingToolCalls = result.toolCalls;
            // 不将 assistant 消息加入 messageList（因为执行工具后会统一处理）
            console.log(`[${this.name}] think: 决定调用 ${result.toolCalls.length} 个工具: ${result.toolCalls.map(tc => tc.function.name).join(', ')}`);
            return true;
        } else {
            // 无需调用工具，AI 已有最终答案
            // 将 assistant 消息加入上下文
            this.messageList.push({ role: 'assistant', content: result.content });
            console.log(`[${this.name}] think: 无需调用工具，已有最终答案`);
            return false;
        }
    }

    /**
     * act: 手动执行 think 阶段决策的工具调用
     * 逐个执行工具，收集结果，将结果反馈到消息上下文
     *
     * @returns {string} 工具执行结果汇总
     */
    async act() {
        if (!this.pendingToolCalls || this.pendingToolCalls.length === 0) {
            return '没有工具需要调用';
        }

        const toolResults = [];
        let shouldTerminate = false;

        for (const toolCall of this.pendingToolCalls) {
            const toolName = toolCall.function.name;
            let args = {};

            try {
                args = JSON.parse(toolCall.function.arguments || '{}');
            } catch (e) {
                console.warn(`[${this.name}] 工具参数解析失败: ${toolName}`, e.message);
            }

            // 检测终止工具
            if (toolName === TERMINATE_TOOL_NAME) {
                shouldTerminate = true;
                toolResults.push(`工具 ${toolName}: 任务结束`);
                console.log(`[${this.name}] act: 检测到终止工具，任务完成`);
                continue;
            }

            // 查找并执行工具
            const tool = this.tools.find(t => t.name === toolName);
            if (!tool) {
                toolResults.push(`工具 ${toolName}: 工具不存在`);
                continue;
            }

            try {
                console.log(`[${this.name}] act: 执行工具 ${toolName}，参数:`, JSON.stringify(args));
                const result = await tool.execute(args, { userId: this.userId });
                toolResults.push(`工具 ${toolName} 返回的结果：${typeof result === 'string' ? result : JSON.stringify(result)}`);
                console.log(`[${this.name}] act: 工具 ${toolName} 执行完成`);
            } catch (err) {
                toolResults.push(`工具 ${toolName} 执行失败：${err.message}`);
                console.error(`[${this.name}] act: 工具 ${toolName} 执行失败:`, err.message);
            }
        }

        // 将 assistant 消息 + tool 结果消息加入上下文
        // 模拟 OpenAI tool calling 的消息流：
        // assistant(tool_calls) → tool(result) → assistant(继续)
        if (this.lastAssistantMessage && this.lastAssistantMessage.toolCalls) {
            // 加入 assistant 消息（含 tool_calls）
            this.messageList.push({
                role: 'assistant',
                content: this.lastAssistantMessage.content || '',
                tool_calls: this.lastAssistantMessage.toolCalls
            });

            // 为每个工具调用加入 tool 结果消息
            this.pendingToolCalls.forEach((toolCall, index) => {
                this.messageList.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolResults[index] || '无结果'
                });
            });
        }

        // 清空待执行列表
        this.pendingToolCalls = [];

        // 如果调用了终止工具，置 FINISHED 状态
        if (shouldTerminate) {
            this.state = AgentState.FINISHED;
        }

        return toolResults.join('\n');
    }

    /**
     * 无 AI API Key 时的本地降级 think
     * 简单规则：直接返回最终答案，不调用工具
     */
    thinkLocal(messages) {
        // 提取最后一条用户消息
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const userContent = lastUserMsg ? lastUserMsg.content : '';

        this.messageList.push({
            role: 'assistant',
            content: `当前未配置 AI API Key，无法使用智能体工具调用功能。您的输入是：${userContent}\n\n请配置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY 后使用。`
        });
        return false;
    }
}

module.exports = { ToolCallAgent, TERMINATE_TOOL_NAME };
