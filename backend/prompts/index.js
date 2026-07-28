/**
 * 词光 Prompt 模板管理器
 * 统一加载和管理所有 AI prompt 模板
 *
 * 用法：
 *   const promptManager = require('./prompts');
 *   const { system, user } = promptManager.render('translation', { source_text, user_translation });
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ===== 加载所有 prompt 模板 =====
const TEMPLATES_DIR = __dirname;

const templates = {
    translation: require('./translation.json'),
    speaking: require('./speaking.json'),
    tutor: require('./tutor.json'),
    exam: require('./exam.json'),
    errorAgent: require('./errorAgent.json'),
    predict: require('./predict.json')
};

// 模板缓存：记录哪些模板已加载
const _loadedTemplates = Object.keys(templates);

/**
 * 用变量填充模板字符串
 * 支持 {{variable}} 和 {{ variable }} 两种占位符写法
 * 未提供值的变量会替换为空字符串
 *
 * @param {string} template - 含 {{variable}} 占位符的模板字符串
 * @param {Object} variables - 变量键值对
 * @returns {string} 填充后的字符串
 */
function fillTemplate(template, variables) {
    if (typeof template !== 'string') {
        return template;
    }
    const vars = variables || {};
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
        const value = vars[key];
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    });
}

/**
 * 渲染指定模板，返回 system_prompt 和 user_prompt
 *
 * @param {string} templateName - 模板名称（translation/speaking/tutor/exam/errorAgent/predict）
 * @param {Object} variables - 填充变量
 * @returns {{system: string, user: string, variables: Object, params: Object}} 渲染结果
 * @throws {Error} 模板不存在时抛出错误
 */
function render(templateName, variables) {
    const template = templates[templateName];
    if (!template) {
        throw new Error(`Prompt 模板不存在: ${templateName}。可用模板: ${_loadedTemplates.join(', ')}`);
    }

    const vars = variables || {};

    // 渲染 system_prompt（部分模板可能没有 system_prompt）
    const system = template.system_prompt
        ? fillTemplate(template.system_prompt, vars)
        : '';

    // 渲染 user_prompt_template
    const user = template.user_prompt_template
        ? fillTemplate(template.user_prompt_template, vars)
        : '';

    return {
        system,
        user,
        variables: vars,
        params: template.params || {}
    };
}

/**
 * 仅渲染 user prompt
 * @param {string} templateName - 模板名称
 * @param {Object} variables - 填充变量
 * @returns {string} 渲染后的 user prompt
 */
function renderUser(templateName, variables) {
    const template = templates[templateName];
    if (!template) {
        throw new Error(`Prompt 模板不存在: ${templateName}`);
    }
    return fillTemplate(template.user_prompt_template || '', variables || {});
}

/**
 * 仅渲染 system prompt
 * @param {string} templateName - 模板名称
 * @param {Object} variables - 填充变量
 * @returns {string} 渲染后的 system prompt
 */
function renderSystem(templateName, variables) {
    const template = templates[templateName];
    if (!template) {
        throw new Error(`Prompt 模板不存在: ${templateName}`);
    }
    return template.system_prompt ? fillTemplate(template.system_prompt, variables || {}) : '';
}

/**
 * 获取模板的原始定义（不渲染）
 * @param {string} templateName - 模板名称
 * @returns {Object} 模板对象
 */
function getTemplate(templateName) {
    const template = templates[templateName];
    if (!template) {
        throw new Error(`Prompt 模板不存在: ${templateName}`);
    }
    return template;
}

/**
 * 列出所有可用模板名称
 * @returns {string[]} 模板名称列表
 */
function listTemplates() {
    return _loadedTemplates.slice();
}

/**
 * 获取模板中定义的变量列表
 * @param {string} templateName - 模板名称
 * @returns {string[]} 变量名列表
 */
function getVariables(templateName) {
    const template = templates[templateName];
    if (!template) {
        throw new Error(`Prompt 模板不存在: ${templateName}`);
    }
    if (Array.isArray(template.variables)) {
        return template.variables.map(v => (typeof v === 'string' ? v : v.name));
    }
    return [];
}

/**
 * 热重载某个模板（开发调试用）
 * 清除 require 缓存并重新加载 JSON 文件
 * @param {string} templateName - 模板名称
 */
function reload(templateName) {
    if (!templates[templateName]) {
        throw new Error(`Prompt 模板不存在: ${templateName}`);
    }
    const filePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
    delete require.cache[require.resolve(filePath)];
    templates[templateName] = require(filePath);
}

module.exports = {
    templates,
    render,
    renderUser,
    renderSystem,
    getTemplate,
    listTemplates,
    getVariables,
    reload,
    fillTemplate
};
