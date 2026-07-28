/**
 * 工具注册中心
 * 统一管理所有 Agent 可用的工具
 *
 * 设计参考：yu-ai-agent 的 ToolRegistration.java
 * - 工具以 POJO 对象形式定义（name/description/parameters/execute）
 * - 集中注册，按需注入到 Agent
 * - 支持动态添加和移除工具
 */

const wordTool = require('./WordTool');
const profileTool = require('./ProfileTool');
const reviewTool = require('./ReviewTool');
const ragTool = require('./RAGTool');
const errorTool = require('./ErrorTool');
const exerciseTool = require('./ExerciseTool');
const terminateTool = require('./TerminateTool');

/**
 * 获取所有可用工具
 * @returns {Array} 工具定义数组
 */
function getAllTools() {
    return [
        wordTool,
        profileTool,
        reviewTool,
        ragTool,
        errorTool,
        exerciseTool,
        terminateTool
    ];
}

/**
 * 按名称获取工具
 */
function getTool(name) {
    const tools = getAllTools();
    return tools.find(t => t.name === name);
}

/**
 * 获取工具的 AI API 格式定义（用于 chatWithTools）
 */
function getToolDefinitions(toolNames = null) {
    const tools = toolNames
        ? getAllTools().filter(t => toolNames.includes(t.name))
        : getAllTools();

    return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
    }));
}

module.exports = {
    getAllTools,
    getTool,
    getToolDefinitions
};
