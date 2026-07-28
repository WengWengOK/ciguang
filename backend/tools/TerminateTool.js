/**
 * 终止工具
 * Agent 调用此工具表示任务完成，触发 FINISHED 状态
 *
 * 设计参考：yu-ai-agent 的 TerminateTool.doTerminate()
 */

module.exports = {
    name: 'terminate',
    description: '终止当前任务。当用户的问题已经回答完毕，或者你无法继续处理时，调用此工具来结束对话。务必在给出最终答案后调用此工具。',
    parameters: {
        type: 'object',
        properties: {
            summary: {
                type: 'string',
                description: '任务完成总结，简述你做了什么'
            }
        },
        required: []
    },

    async execute(args, context) {
        const summary = args.summary || '任务已完成';
        return `任务终止: ${summary}`;
    }
};
