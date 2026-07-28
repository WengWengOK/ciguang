/**
 * ReActAgent - ReAct 推理行动智能体
 * 职责：定义 think + act 模板方法
 *
 * 设计参考：yu-ai-agent 的 ReActAgent.java
 * - think() 返回 boolean：是否需要执行行动
 * - act() 返回 String：行动执行结果
 * - step() 是模板方法，固化 "think → (条件) act" 顺序
 * - think 返回 false 时跳过 act，自然终止循环
 */

const { BaseAgent } = require('./BaseAgent');

class ReActAgent extends BaseAgent {
    constructor(options = {}) {
        super(options);
    }

    /**
     * 模板方法：固化 think → act 执行顺序
     * 子类不可改变此顺序，只能实现 think 和 act
     */
    async step() {
        try {
            // 先思考：处理当前状态，决定下一步行动
            const shouldAct = await this.think();

            if (!shouldAct) {
                // think 返回 false：无需行动，循环可自然终止
                return '思考完成 - 无需行动';
            }

            // 再行动：执行决定的行动
            return await this.act();

        } catch (err) {
            console.error(`[${this.name}] step 执行失败:`, err.message);
            return `步骤执行失败: ${err.message}`;
        }
    }

    /**
     * 思考阶段（抽象方法）
     * @returns {boolean} 是否需要执行行动
     */
    async think() {
        throw new Error('think() 必须由子类实现');
    }

    /**
     * 行动阶段（抽象方法）
     * @returns {string} 行动执行结果
     */
    async act() {
        throw new Error('act() 必须由子类实现');
    }
}

module.exports = { ReActAgent };
