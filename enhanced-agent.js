/**
 * 词光考研英语学习平台 - 高级 AI Agent 面板交互逻辑
 * ============================================================
 * 对接后端三种 Agent 模式：
 *   1. ReAct 模式          —— POST /api/study-agent/run[-stream]
 *   2. Plan-Execute 模式    —— POST /api/plan-execute/run[-stream]
 *   3. Multi-Agent 模式     —— POST /api/orchestrator/run + agents/delegate
 *
 * 特性：
 *   - 原生 JavaScript，零框架依赖
 *   - SSE 流式响应处理（fetch + ReadableStream）
 *   - 推理步骤卡片、工具调用卡片、计划渲染、执行轨迹时间线
 *   - 流式逐字渲染 + 闪烁光标
 *   - 完善的错误处理与身份校验
 *
 * 作者：词光前端团队
 */

(function () {
  'use strict';

  /* ============================================================
   * 一、样式注入（避免与 app.js 冲突，所有选择器均带 enhanced-agent- 前缀）
   * ============================================================ */
  const PANEL_STYLES = `
.enhanced-agent-panel {
  position: fixed;
  top: 0;
  right: -460px;
  width: 440px;
  height: 100vh;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  transition: right 0.32s cubic-bezier(0.23, 1, 0.32, 1);
  overflow: hidden;
}
.enhanced-agent-panel.open {
  right: 0;
}

/* ---------- 头部 ---------- */
.enhanced-agent-panel .agent-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #6a5cff 0%, #8a7bff 100%);
  color: #fff;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.enhanced-agent-panel .agent-avatar-wrap {
  position: relative;
  width: 42px;
  height: 42px;
}
.enhanced-agent-panel .agent-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.enhanced-agent-panel .agent-status-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4ade80;
  border: 2px solid #6a5cff;
}
.enhanced-agent-panel .agent-status-dot.offline {
  background: #9ca3af;
}
.enhanced-agent-panel .agent-title {
  font-size: 16px;
  font-weight: 600;
}
.enhanced-agent-panel .agent-subtitle {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 2px;
}
.enhanced-agent-panel .agent-header-actions {
  display: flex;
  gap: 6px;
}
.enhanced-agent-panel .agent-btn-clear,
.enhanced-agent-panel .agent-btn-close {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}
.enhanced-agent-panel .agent-btn-clear:hover,
.enhanced-agent-panel .agent-btn-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* ---------- 模式选择器 ---------- */
.enhanced-agent-panel .agent-mode-selector {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  background: #f6f7fb;
  border-bottom: 1px solid #ececf1;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-mode-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px;
  background: #fff;
  border: 1px solid #e4e4ec;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  color: #6b7280;
}
.enhanced-agent-panel .agent-mode-btn:hover {
  border-color: #b9b9d6;
}
.enhanced-agent-panel .agent-mode-btn.active {
  background: linear-gradient(135deg, #6a5cff 0%, #8a7bff 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(106, 92, 255, 0.35);
}
.enhanced-agent-panel .agent-mode-btn .mode-icon {
  font-size: 18px;
}
.enhanced-agent-panel .agent-mode-btn .mode-name {
  font-size: 11px;
  font-weight: 600;
}

/* ---------- 消息区域 ---------- */
.enhanced-agent-panel .agent-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  background: #fafafe;
  scroll-behavior: smooth;
}
.enhanced-agent-panel .agent-messages::-webkit-scrollbar {
  width: 6px;
}
.enhanced-agent-panel .agent-messages::-webkit-scrollbar-thumb {
  background: #d4d4e0;
  border-radius: 3px;
}
.enhanced-agent-panel .agent-msg {
  display: flex;
  margin-bottom: 14px;
  gap: 8px;
  animation: ea-fade-in 0.3s ease;
}
.enhanced-agent-panel .agent-msg-bot {
  flex-direction: row;
}
.enhanced-agent-panel .agent-msg-user {
  flex-direction: row-reverse;
}
.enhanced-agent-panel .agent-msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #eef0ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-msg-user .agent-msg-avatar {
  background: #6a5cff;
}
.enhanced-agent-panel .agent-msg-bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.enhanced-agent-panel .agent-msg-bot .agent-msg-bubble {
  background: #fff;
  border: 1px solid #ececf1;
  border-top-left-radius: 4px;
  color: #1f2937;
}
.enhanced-agent-panel .agent-msg-user .agent-msg-bubble {
  background: #6a5cff;
  color: #fff;
  border-top-right-radius: 4px;
}
.enhanced-agent-panel .agent-msg-bubble p {
  margin: 0 0 6px;
}
.enhanced-agent-panel .agent-msg-bubble p:last-child {
  margin-bottom: 0;
}
.enhanced-agent-panel .agent-welcome-hint {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.9;
}

/* ---------- 步骤卡片 ---------- */
.enhanced-agent-panel .agent-step-card {
  margin: 8px 0 8px 40px;
  background: #fff;
  border: 1px solid #ececf1;
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  animation: ea-fade-in 0.3s ease;
}
.enhanced-agent-panel .agent-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: #f9f9fc;
}
.enhanced-agent-panel .agent-step-header:hover {
  background: #f1f1fa;
}
.enhanced-agent-panel .agent-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: #6a5cff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.enhanced-agent-panel .agent-step-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
}
.enhanced-agent-panel .agent-step-tag.think { background: #ede9fe; color: #7c3aed; }
.enhanced-agent-panel .agent-step-tag.act   { background: #dbeafe; color: #2563eb; }
.enhanced-agent-panel .agent-step-tag.tool  { background: #fef3c7; color: #d97706; }
.enhanced-agent-panel .agent-step-tag.plan  { background: #d1fae5; color: #059669; }
.enhanced-agent-panel .agent-step-toggle {
  margin-left: auto;
  font-size: 11px;
  color: #9ca3af;
  transition: transform 0.2s;
}
.enhanced-agent-panel .agent-step-card.collapsed .agent-step-toggle {
  transform: rotate(-90deg);
}
.enhanced-agent-panel .agent-step-body {
  padding: 10px 12px;
  color: #4b5563;
  white-space: pre-wrap;
  border-top: 1px solid #f0f0f5;
  max-height: 400px;
  overflow-y: auto;
}
.enhanced-agent-panel .agent-step-card.collapsed .agent-step-body {
  display: none;
}

/* ---------- 工具调用卡片 ---------- */
.enhanced-agent-panel .agent-tool-card {
  margin: 8px 0 8px 40px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  animation: ea-fade-in 0.3s ease;
}
.enhanced-agent-panel .agent-tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fef3c7;
}
.enhanced-agent-panel .agent-tool-name {
  font-weight: 600;
  color: #92400e;
}
.enhanced-agent-panel .agent-tool-status {
  margin-left: auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
}
.enhanced-agent-panel .agent-tool-status.running { background: #dbeafe; color: #2563eb; }
.enhanced-agent-panel .agent-tool-status.success { background: #d1fae5; color: #059669; }
.enhanced-agent-panel .agent-tool-status.error   { background: #fee2e2; color: #dc2626; }
.enhanced-agent-panel .agent-tool-body {
  padding: 10px 12px;
  color: #4b5563;
  white-space: pre-wrap;
  max-height: 260px;
  overflow-y: auto;
}
.enhanced-agent-panel .agent-tool-section {
  margin-bottom: 6px;
}
.enhanced-agent-panel .agent-tool-section-label {
  font-size: 11px;
  color: #92400e;
  font-weight: 600;
  margin-bottom: 2px;
}

/* ---------- 计划渲染 ---------- */
.enhanced-agent-panel .agent-plan {
  margin: 8px 0 8px 40px;
  background: #fff;
  border: 1px solid #d1fae5;
  border-radius: 10px;
  overflow: hidden;
  animation: ea-fade-in 0.3s ease;
}
.enhanced-agent-panel .agent-plan-title {
  padding: 8px 12px;
  background: #ecfdf5;
  font-size: 12px;
  font-weight: 600;
  color: #065f46;
  display: flex;
  align-items: center;
  gap: 6px;
}
.enhanced-agent-panel .agent-plan-list {
  padding: 8px 12px;
}
.enhanced-agent-panel .agent-plan-item {
  position: relative;
  padding: 8px 10px 8px 32px;
  margin-bottom: 6px;
  background: #f9fafb;
  border-radius: 8px;
  border-left: 3px solid #10b981;
}
.enhanced-agent-panel .agent-plan-item:last-child {
  margin-bottom: 0;
}
.enhanced-agent-panel .agent-plan-item::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
}
.enhanced-agent-panel .agent-plan-item.done { border-left-color: #10b981; }
.enhanced-agent-panel .agent-plan-item.done::before { background: #10b981; }
.enhanced-agent-panel .agent-plan-item.pending { border-left-color: #d1d5db; }
.enhanced-agent-panel .agent-plan-item.pending::before { background: #d1d5db; }
.enhanced-agent-panel .agent-plan-item.running { border-left-color: #3b82f6; }
.enhanced-agent-panel .agent-plan-item.running::before { background: #3b82f6; animation: ea-pulse 1.2s infinite; }
.enhanced-agent-panel .agent-plan-item.failed { border-left-color: #ef4444; }
.enhanced-agent-panel .agent-plan-item.failed::before { background: #ef4444; }
.enhanced-agent-panel .agent-plan-item::after {
  content: '';
  position: absolute;
  left: 15px;
  top: -6px;
  width: 2px;
  height: 14px;
  background: #e5e7eb;
}
.enhanced-agent-panel .agent-plan-item:first-child::after { display: none; }
.enhanced-agent-panel .agent-plan-desc {
  font-size: 13px;
  color: #1f2937;
  font-weight: 500;
}
.enhanced-agent-panel .agent-plan-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.enhanced-agent-panel .agent-plan-tool {
  font-size: 10px;
  padding: 1px 6px;
  background: #eef2ff;
  color: #4f46e5;
  border-radius: 4px;
}
.enhanced-agent-panel .agent-plan-dep {
  font-size: 10px;
  padding: 1px 6px;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 4px;
}
.enhanced-agent-panel .agent-plan-reason {
  font-size: 11px;
  color: #6b7280;
  margin-top: 3px;
  font-style: italic;
}

/* ---------- 执行轨迹时间线 ---------- */
.enhanced-agent-panel .agent-trace {
  margin: 10px 0 10px 40px;
  background: #fff;
  border: 1px solid #ececf1;
  border-radius: 10px;
  padding: 12px 14px;
  animation: ea-fade-in 0.3s ease;
}
.enhanced-agent-panel .agent-trace-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.enhanced-agent-panel .agent-trace-timeline {
  position: relative;
  padding-left: 20px;
}
.enhanced-agent-panel .agent-trace-timeline::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: #e5e7eb;
}
.enhanced-agent-panel .agent-trace-node {
  position: relative;
  padding-bottom: 12px;
}
.enhanced-agent-panel .agent-trace-node:last-child {
  padding-bottom: 0;
}
.enhanced-agent-panel .agent-trace-node::before {
  content: '';
  position: absolute;
  left: -17px;
  top: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6a5cff;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px #eef0ff;
}
.enhanced-agent-panel .agent-trace-stage {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
}
.enhanced-agent-panel .agent-trace-detail {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 1px;
}
.enhanced-agent-panel .agent-trace-duration {
  display: inline-block;
  font-size: 10px;
  color: #6a5cff;
  background: #eef0ff;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
}

/* ---------- 流式光标 ---------- */
.enhanced-agent-panel .streaming-cursor {
  display: inline-block;
  width: 7px;
  height: 15px;
  background: #6a5cff;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: ea-blink 0.9s steps(2) infinite;
}

/* ---------- 打字指示器 ---------- */
.enhanced-agent-panel .agent-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 14px;
}
.enhanced-agent-panel .agent-typing .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #b0b0c8;
  animation: ea-typing 1.2s infinite ease-in-out;
}
.enhanced-agent-panel .agent-typing .dot:nth-child(2) { animation-delay: 0.2s; }
.enhanced-agent-panel .agent-typing .dot:nth-child(3) { animation-delay: 0.4s; }

/* ---------- 错误提示 ---------- */
.enhanced-agent-panel .agent-error {
  margin: 8px 0 8px 40px;
  padding: 10px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 13px;
}

/* ---------- 快捷问题 ---------- */
.enhanced-agent-panel .agent-quick-templates {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  flex-wrap: wrap;
  border-top: 1px solid #f0f0f5;
  background: #fff;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-quick-btn {
  font-size: 12px;
  padding: 5px 10px;
  background: #f6f7fb;
  border: 1px solid #ececf1;
  border-radius: 14px;
  cursor: pointer;
  color: #4b5563;
  transition: all 0.2s;
}
.enhanced-agent-panel .agent-quick-btn:hover {
  background: #eef0ff;
  border-color: #c7c7f5;
  color: #6a5cff;
}

/* ---------- 输入区域 ---------- */
.enhanced-agent-panel .agent-input-area {
  display: flex;
  gap: 8px;
  padding: 10px 12px 14px;
  background: #fff;
  border-top: 1px solid #f0f0f5;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-input {
  flex: 1;
  resize: none;
  border: 1px solid #e4e4ec;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
  max-height: 120px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
}
.enhanced-agent-panel .agent-input:focus {
  border-color: #6a5cff;
}
.enhanced-agent-panel .agent-input:disabled {
  background: #f6f7fb;
  cursor: not-allowed;
}
.enhanced-agent-panel .agent-btn-send {
  background: linear-gradient(135deg, #6a5cff 0%, #8a7bff 100%);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  flex-shrink: 0;
}
.enhanced-agent-panel .agent-btn-send:hover { opacity: 0.9; }
.enhanced-agent-panel .agent-btn-send:disabled {
  background: #c7c7d8;
  cursor: not-allowed;
}

/* ---------- 动画 ---------- */
@keyframes ea-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ea-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0; }
}
@keyframes ea-typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30%           { transform: translateY(-5px); opacity: 1; }
}
@keyframes ea-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
`;

  /* ============================================================
   * 二、EnhancedAgentPanel 类
   * ============================================================ */
  class EnhancedAgentPanel {
    /**
     * 构造函数
     * @param {Object} options 配置项
     *   - apiBaseUrl:    API 基础路径，默认 '/api'
     *   - onAuthRequired: 需要登录时的回调函数
     */
    constructor(options = {}) {
      this.apiBaseUrl = options.apiBaseUrl || '/api';
      this.onAuthRequired = options.onAuthRequired || null;

      // 模式定义（与后端接口映射）
      this.modes = {
        'react': {
          label: 'ReAct 模式 · 自主推理',
          syncEndpoint: '/study-agent/run',
          streamEndpoint: '/study-agent/run-stream',
          supportsStream: true,
        },
        'plan-execute': {
          label: 'Plan-Execute 模式 · 规划执行',
          syncEndpoint: '/plan-execute/run',
          streamEndpoint: '/plan-execute/run-stream',
          supportsStream: true,
        },
        'multi-agent': {
          label: 'Multi-Agent 模式 · 多智能体协作',
          syncEndpoint: '/orchestrator/run',
          streamEndpoint: null, // 多智能体不支持流式
          supportsStream: false,
        },
      };

      // 运行时状态
      this.currentMode = 'react';
      this.sessionId = null;
      this.traceId = null;
      this.isStreaming = false;
      this.agentsLoaded = false;   // 是否已加载多智能体列表
      this.agents = [];             // 多智能体列表
      this.stepCounter = 0;         // 步骤计数器
      this.currentStreamBubble = null; // 当前流式渲染的气泡容器

      // DOM 引用
      this.container = null;
      this.panelEl = null;
      this.messagesEl = null;
      this.inputEl = null;
      this.sendBtnEl = null;
      this.modeLabelEl = null;

      // 注入样式（仅注入一次）
      this._injectStyles();
    }

    /* ----------------------------------------------------------
     * 样式注入
     * ---------------------------------------------------------- */
    _injectStyles() {
      if (document.getElementById('enhanced-agent-styles')) return;
      const style = document.createElement('style');
      style.id = 'enhanced-agent-styles';
      style.textContent = PANEL_STYLES;
      document.head.appendChild(style);
    }

    /* ----------------------------------------------------------
     * 挂载面板到容器
     * ---------------------------------------------------------- */
    mount(container) {
      // 容器可以是元素或选择器；若未提供则追加到 body
      let host = null;
      if (container) {
        host = typeof container === 'string'
          ? document.querySelector(container)
          : container;
      }
      if (!host) {
        host = document.body;
      }
      this.container = host;

      // 若已存在则先移除旧实例
      const existing = document.getElementById('enhanced-agent-panel');
      if (existing) existing.remove();

      // 创建面板根节点
      this.panelEl = document.createElement('div');
      this.panelEl.className = 'enhanced-agent-panel';
      this.panelEl.id = 'enhanced-agent-panel';
      this.panelEl.innerHTML = this._buildHTML();

      host.appendChild(this.panelEl);

      // 缓存关键 DOM
      this.messagesEl = this.panelEl.querySelector('#enhanced-agent-messages');
      this.inputEl = this.panelEl.querySelector('.agent-input');
      this.sendBtnEl = this.panelEl.querySelector('.agent-btn-send');
      this.modeLabelEl = this.panelEl.querySelector('#enhanced-agent-mode-label');

      // 绑定事件
      this._bindEvents();

      return this;
    }

    /* ----------------------------------------------------------
     * 生成面板内部 HTML
     * ---------------------------------------------------------- */
    _buildHTML() {
      return `
        <!-- 头部 -->
        <div class="agent-panel-header">
          <div class="agent-header-info">
            <div class="agent-avatar-wrap">
              <div class="agent-avatar">🤖</div>
              <div class="agent-status-dot"></div>
            </div>
            <div>
              <div class="agent-title">AI 学习导师</div>
              <div class="agent-subtitle" id="enhanced-agent-mode-label">ReAct 模式 · 自主推理</div>
            </div>
          </div>
          <div class="agent-header-actions">
            <button class="agent-btn-clear" title="清空对话" data-action="clear">🗑️</button>
            <button class="agent-btn-close" title="关闭" data-action="close">✕</button>
          </div>
        </div>

        <!-- 模式选择器 -->
        <div class="agent-mode-selector">
          <button class="agent-mode-btn active" data-mode="react">
            <span class="mode-icon">⚡</span>
            <span class="mode-name">ReAct</span>
          </button>
          <button class="agent-mode-btn" data-mode="plan-execute">
            <span class="mode-icon">📋</span>
            <span class="mode-name">Plan-Execute</span>
          </button>
          <button class="agent-mode-btn" data-mode="multi-agent">
            <span class="mode-icon">🧠</span>
            <span class="mode-name">Multi-Agent</span>
          </button>
        </div>

        <!-- 消息区域 -->
        <div class="agent-messages" id="enhanced-agent-messages">
          <div class="agent-msg agent-msg-bot">
            <div class="agent-msg-avatar">🤖</div>
            <div class="agent-msg-bubble">
              <p>你好！我是词光 AI 学习导师 👋</p>
              <p>支持三种智能体模式，选择不同模式体验不同的推理方式：</p>
              <p class="agent-welcome-hint">
                ⚡ <strong>ReAct</strong>：边想边做，逐步推理<br>
                📋 <strong>Plan-Execute</strong>：先规划再执行，支持任务分解<br>
                🧠 <strong>Multi-Agent</strong>：多智能体协作，自动路由
              </p>
            </div>
          </div>
        </div>

        <!-- 快捷问题 -->
        <div class="agent-quick-templates" id="enhanced-agent-quick-templates">
          <button class="agent-quick-btn" data-q="abandon怎么记？">💡 这个词怎么记？</button>
          <button class="agent-quick-btn" data-q="帮我分析我的学情">📊 分析学情</button>
          <button class="agent-quick-btn" data-q="制定一个考研英语复习计划">📅 制定计划</button>
        </div>

        <!-- 输入区域 -->
        <div class="agent-input-area">
          <textarea class="agent-input" placeholder="输入你的问题..." rows="1"></textarea>
          <button class="agent-btn-send">发送</button>
        </div>
      `;
    }

    /* ----------------------------------------------------------
     * 绑定事件监听
     * ---------------------------------------------------------- */
    _bindEvents() {
      // 关闭 / 清空
      this.panelEl.querySelector('[data-action="close"]')
        .addEventListener('click', () => this.toggle());
      this.panelEl.querySelector('[data-action="clear"]')
        .addEventListener('click', () => this.clearChat());

      // 模式切换
      this.panelEl.querySelectorAll('.agent-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-mode');
          this.switchMode(mode);
        });
      });

      // 快捷问题
      this.panelEl.querySelectorAll('.agent-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const q = btn.getAttribute('data-q');
          this.sendQuickQuestion(q);
        });
      });

      // 发送按钮
      this.sendBtnEl.addEventListener('click', () => this._handleSend());

      // 输入框：Enter 发送（Shift+Enter 换行）
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._handleSend();
        }
      });

      // 输入框自动撑高
      this.inputEl.addEventListener('input', () => {
        this.inputEl.style.height = 'auto';
        this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
      });
    }

    /* ----------------------------------------------------------
     * 处理发送动作（内部）
     * ---------------------------------------------------------- */
    _handleSend() {
      if (this.isStreaming) return;
      const text = this.inputEl.value.trim();
      if (!text) return;
      this.inputEl.value = '';
      this.inputEl.style.height = 'auto';
      this.sendMessage(text);
    }

    /* ----------------------------------------------------------
     * 打开/关闭面板
     * ---------------------------------------------------------- */
    toggle() {
      if (!this.panelEl) return;
      const isOpen = this.panelEl.classList.contains('open');
      if (isOpen) {
        this.panelEl.classList.remove('open');
      } else {
        this.panelEl.classList.add('open');
        // 首次打开且当前为多智能体模式时加载 Agent 列表
        if (this.currentMode === 'multi-agent' && !this.agentsLoaded) {
          this.loadAgents();
        }
        // 聚焦输入框
        setTimeout(() => {
          if (this.inputEl) this.inputEl.focus();
        }, 320);
      }
    }

    /* ----------------------------------------------------------
     * 切换 Agent 模式
     * ---------------------------------------------------------- */
    switchMode(mode) {
      if (!this.modes[mode]) {
        console.warn('[EnhancedAgent] 未知模式:', mode);
        return;
      }
      if (mode === this.currentMode) return;

      this.currentMode = mode;
      this.stepCounter = 0;
      this.sessionId = null;

      // 更新按钮高亮
      this.panelEl.querySelectorAll('.agent-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });

      // 更新副标题
      if (this.modeLabelEl) {
        this.modeLabelEl.textContent = this.modes[mode].label;
      }

      // 清空当前对话
      this.clearChat();

      // 多智能体模式：懒加载 Agent 列表
      if (mode === 'multi-agent' && !this.agentsLoaded && this.panelEl.classList.contains('open')) {
        this.loadAgents();
      }
    }

    /* ----------------------------------------------------------
     * 发送消息（主入口）
     * ---------------------------------------------------------- */
    async sendMessage(text) {
      if (!text || this.isStreaming) return;

      // 身份校验
      const token = this._getToken();
      if (!token) {
        this.renderError('请先登录后再使用 AI 学习导师。');
        if (typeof this.onAuthRequired === 'function') {
          this.onAuthRequired();
        }
        return;
      }

      // 渲染用户消息
      this.renderUserMessage(text);

      // 禁用输入
      this._setInputDisabled(true);
      this.isStreaming = true;
      this.stepCounter = 0;

      const modeConf = this.modes[this.currentMode];

      try {
        // 优先使用流式接口（multi-agent 不支持流式）
        if (modeConf.supportsStream && modeConf.streamEndpoint) {
          await this.sendStreamMessage(text, this.currentMode);
        } else {
          await this._sendSyncMessage(text, this.currentMode);
        }
      } catch (err) {
        console.error('[EnhancedAgent] 发送失败:', err);
        this.renderError(this._formatError(err));
      } finally {
        this.isStreaming = false;
        this._setInputDisabled(false);
        this.hideTyping();
      }
    }

    /* ----------------------------------------------------------
     * 同步发送消息（兜底 / multi-agent）
     * ---------------------------------------------------------- */
    async _sendSyncMessage(text, mode) {
      const modeConf = this.modes[mode];
      const endpoint = this.apiBaseUrl + modeConf.syncEndpoint;
      const token = this._getToken();

      this.showTyping();

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, sessionId: this.sessionId }),
      });

      if (response.status === 401) {
        this.hideTyping();
        this.renderError('登录已失效，请重新登录。');
        if (typeof this.onAuthRequired === 'function') this.onAuthRequired();
        return;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`接口返回 ${response.status}：${errText.slice(0, 200)}`);
      }

      const json = await response.json();
      this.hideTyping();

      if (!json.success) {
        throw new Error(json.message || json.error || '接口返回失败');
      }

      const data = json.data || {};
      this._consumeSyncResult(data, mode);
    }

    /* ----------------------------------------------------------
     * 消费同步接口的返回结果，按模式渲染
     * ---------------------------------------------------------- */
    _consumeSyncResult(data, mode) {
      // 通用字段
      if (data.sessionId) this.sessionId = data.sessionId;
      if (data.traceId) this.traceId = data.traceId;

      if (mode === 'react') {
        // ReAct：渲染步骤 + 工具调用 + 回答
        if (Array.isArray(data.steps)) {
          data.steps.forEach((s, i) => this._renderStepFromSync(s, i + 1));
        }
        if (Array.isArray(data.toolCalls)) {
          data.toolCalls.forEach((t) => this.renderToolCall({
            name: t.tool || t.name,
            args: t.args || t.arguments,
            result: t.result,
            status: 'success',
          }));
        }
        if (data.reply) this.renderAIMessage(data.reply);
        if (data.traceSummary) this.renderTrace(data.traceSummary);
      } else if (mode === 'plan-execute') {
        // Plan-Execute：渲染计划 + 执行轨迹 + 回答
        if (Array.isArray(data.plan)) this.renderPlan(data.plan);
        if (Array.isArray(data.executionTrace)) this.renderTrace(data.executionTrace);
        if (data.reply) this.renderAIMessage(data.reply);
        if (data.traceSummary) this.renderTrace(data.traceSummary);
      } else if (mode === 'multi-agent') {
        // Multi-Agent：渲染路由 + 步骤 + 回答
        if (data.routing) {
          this._renderRouting(data.routing);
        }
        if (Array.isArray(data.steps)) {
          data.steps.forEach((s, i) => this._renderStepFromSync(s, i + 1));
        }
        if (data.reply) this.renderAIMessage(data.reply);
        if (data.durationMs != null) {
          this._renderDuration(data.durationMs);
        }
      }
    }

    /* ----------------------------------------------------------
     * 渲染路由信息（multi-agent 专用）
     * ---------------------------------------------------------- */
    _renderRouting(routing) {
      const card = document.createElement('div');
      card.className = 'agent-step-card';
      const stage = typeof routing === 'string' ? routing : (routing.target || routing.agent || JSON.stringify(routing));
      card.innerHTML = `
        <div class="agent-step-header">
          <span class="agent-step-tag plan">路由</span>
          <span style="font-size:13px;color:#059669;font-weight:600;">→ ${this._escapeHtml(stage)}</span>
        </div>
      `;
      this._appendMessageNode(card);
    }

    /* ----------------------------------------------------------
     * 渲染耗时
     * ---------------------------------------------------------- */
    _renderDuration(ms) {
      const node = document.createElement('div');
      node.style.cssText = 'margin:4px 0 4px 40px;font-size:11px;color:#9ca3af;';
      node.textContent = `⏱ 耗时 ${ms} ms`;
      this._appendMessageNode(node);
    }

    /* ----------------------------------------------------------
     * 从同步步骤数据渲染步骤卡片
     * ---------------------------------------------------------- */
    _renderStepFromSync(step, index) {
      // 兼容多种字段命名
      const type = (step.type || step.kind || 'think').toLowerCase();
      const content = step.content || step.message || step.thought || step.observation || '';
      this.renderStepCard({
        type: ['think', 'act', 'tool', 'plan'].includes(type) ? type : 'think',
        step: index,
        content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      });
    }

    /* ----------------------------------------------------------
     * 流式发送消息（SSE）
     * ---------------------------------------------------------- */
    async sendStreamMessage(text, mode) {
      const modeConf = this.modes[mode];
      if (!modeConf.supportsStream || !modeConf.streamEndpoint) {
        // 不支持流式则回退同步
        return this._sendSyncMessage(text, mode);
      }

      const endpoint = this.apiBaseUrl + modeConf.streamEndpoint;
      const token = this._getToken();

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ message: text, sessionId: this.sessionId }),
      });

      if (response.status === 401) {
        this.renderError('登录已失效，请重新登录。');
        if (typeof this.onAuthRequired === 'function') this.onAuthRequired();
        return;
      }
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`流式接口返回 ${response.status}：${errText.slice(0, 200)}`);
      }
      if (!response.body || !response.body.getReader) {
        // 浏览器不支持ReadableStream，回退同步
        return this._sendSyncMessage(text, mode);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // 按换行切分，保留最后一段不完整内容
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // 支持 "data: {...}" 与 "data:{...}" 两种格式
            if (trimmed.startsWith('data:')) {
              const payload = trimmed.slice(5).trim();
              if (!payload) continue;
              // 忽略心跳 [DONE]
              if (payload === '[DONE]') continue;
              try {
                const data = JSON.parse(payload);
                this.handleSSEEvent(data);
              } catch (e) {
                console.warn('[EnhancedAgent] SSE 数据解析失败:', e, payload);
              }
            }
            // 忽略 event:/id:/comment 行
          }
        }
        // 处理 buffer 中可能残留的最后一行
        if (buffer.trim().startsWith('data:')) {
          const payload = buffer.trim().slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              this.handleSSEEvent(JSON.parse(payload));
            } catch (e) {
              /* 忽略残留解析错误 */
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch (e) { /* noop */ }
      }
    }

    /* ----------------------------------------------------------
     * SSE 事件分发处理
     * ---------------------------------------------------------- */
    handleSSEEvent(data) {
      if (!data || typeof data !== 'object') return;
      const type = data.type || data.event;

      switch (type) {
        case 'session':
          this.sessionId = data.sessionId || data.data?.sessionId;
          break;

        case 'step_start':
          // 新步骤开始，显示加载态（实际内容会在后续事件中渲染）
          this.showTyping();
          break;

        case 'thinking':
        case 'think':
          this.hideTyping();
          this.stepCounter += 1;
          this.renderStepCard({
            type: 'think',
            step: data.step || this.stepCounter,
            content: data.message || data.content || data.thought || '',
          });
          break;

        case 'action':
        case 'act':
          this.hideTyping();
          this.stepCounter += 1;
          this.renderStepCard({
            type: 'act',
            step: data.step || this.stepCounter,
            content: data.message || data.content || data.action || '',
          });
          break;

        case 'tool_call':
        case 'tool_start':
          this.hideTyping();
          this.renderToolCall({
            name: data.tool || data.toolName,
            args: data.args || data.arguments,
            result: null,
            status: 'running',
            step: data.step,
          });
          break;

        case 'tool_result':
          this.hideTyping();
          this.renderToolCall({
            name: data.tool || data.toolName,
            args: data.args || data.arguments,
            result: data.result || data.output,
            status: data.error ? 'error' : 'success',
            step: data.step,
          });
          break;

        case 'plan':
          this.hideTyping();
          this.renderPlan(data.subtasks || data.plan || data.data);
          break;

        case 'execution_trace':
        case 'trace':
          this.renderTrace(data.trace || data.executionTrace || data.data);
          break;

        case 'answer':
          this.hideTyping();
          this.renderAIMessage(data.content || data.message || data.reply || '');
          break;

        case 'partial':
        case 'delta':
          // 流式增量文本，追加到当前气泡
          this._appendStreamingChunk(data.content || data.delta || '');
          break;

        case 'done':
          this.hideTyping();
          this._finalizeStreaming();
          if (data.traceSummary) this.renderTrace(data.traceSummary);
          if (data.plan) this.renderPlan(data.plan);
          if (data.executionTrace) this.renderTrace(data.executionTrace);
          if (data.sessionId) this.sessionId = data.sessionId;
          if (data.traceId) this.traceId = data.traceId;
          break;

        case 'timeout':
          this.hideTyping();
          this.renderError('请求超时，请稍后重试或简化问题。');
          break;

        case 'terminated':
          this.hideTyping();
          this.renderError('任务被终止。' + (data.reason ? '原因：' + data.reason : ''));
          break;

        case 'error':
          this.hideTyping();
          this.renderError(data.message || data.error || '未知错误');
          break;

        default:
          // 未知事件类型，调试时可在控制台查看
          console.debug('[EnhancedAgent] 未处理的 SSE 事件:', data);
      }
    }

    /* ----------------------------------------------------------
     * 渲染用户消息气泡
     * ---------------------------------------------------------- */
    renderUserMessage(text) {
      const node = document.createElement('div');
      node.className = 'agent-msg agent-msg-user';
      node.innerHTML = `
        <div class="agent-msg-avatar">🧑</div>
        <div class="agent-msg-bubble"></div>
      `;
      node.querySelector('.agent-msg-bubble').textContent = text;
      this._appendMessageNode(node);
    }

    /* ----------------------------------------------------------
     * 渲染 AI 消息气泡（支持流式增量）
     * ---------------------------------------------------------- */
    renderAIMessage(text) {
      // 若已有流式气泡在渲染，则直接使用它
      if (this.currentStreamBubble) {
        const bubble = this.currentStreamBubble.querySelector('.agent-msg-bubble');
        bubble.textContent = text;
        this._finalizeStreaming();
        return;
      }

      const node = document.createElement('div');
      node.className = 'agent-msg agent-msg-bot';
      node.innerHTML = `
        <div class="agent-msg-avatar">🤖</div>
        <div class="agent-msg-bubble"></div>
      `;
      this._appendMessageNode(node);

      // 逐字流式显示
      if (text) {
        this.showStreamingText(node.querySelector('.agent-msg-bubble'), text);
      }
    }

    /* ----------------------------------------------------------
     * 流式增量追加（用于 partial/delta 事件）
     * ---------------------------------------------------------- */
    _appendStreamingChunk(chunk) {
      if (!chunk) return;
      // 若没有当前气泡，创建一个
      if (!this.currentStreamBubble) {
        const node = document.createElement('div');
        node.className = 'agent-msg agent-msg-bot';
        node.innerHTML = `
          <div class="agent-msg-avatar">🤖</div>
          <div class="agent-msg-bubble"></div>
        `;
        this._appendMessageNode(node);
        this.currentStreamBubble = node;
      }
      const bubble = this.currentStreamBubble.querySelector('.agent-msg-bubble');
      bubble.textContent += chunk;
      this._scrollToBottom();
    }

    /* ----------------------------------------------------------
     * 结束流式渲染（移除光标等）
     * ---------------------------------------------------------- */
    _finalizeStreaming() {
      if (this.currentStreamBubble) {
        const bubble = this.currentStreamBubble.querySelector('.agent-msg-bubble');
        const cursor = bubble.querySelector('.streaming-cursor');
        if (cursor) cursor.remove();
        this.currentStreamBubble = null;
      }
    }

    /* ----------------------------------------------------------
     * 渲染推理步骤卡片
     * ---------------------------------------------------------- */
    renderStepCard(stepData) {
      const { type = 'think', step, content = '' } = stepData;
      const tagMap = {
        think: { label: '思考', cls: 'think' },
        act:   { label: '行动', cls: 'act' },
        tool:  { label: '工具', cls: 'tool' },
        plan:  { label: '计划', cls: 'plan' },
      };
      const tag = tagMap[type] || tagMap.think;
      const stepNum = step || (this.stepCounter);

      const card = document.createElement('div');
      card.className = 'agent-step-card';
      card.innerHTML = `
        <div class="agent-step-header">
          <span class="agent-step-num">#${this._escapeHtml(String(stepNum))}</span>
          <span class="agent-step-tag ${tag.cls}">${tag.label}</span>
          <span class="agent-step-toggle">▼</span>
        </div>
        <div class="agent-step-body"></div>
      `;
      card.querySelector('.agent-step-body').textContent = content;

      // 折叠交互
      const header = card.querySelector('.agent-step-header');
      header.addEventListener('click', () => {
        card.classList.toggle('collapsed');
      });

      this._appendMessageNode(card);
    }

    /* ----------------------------------------------------------
     * 渲染工具调用卡片
     * ---------------------------------------------------------- */
    renderToolCall(toolData) {
      const { name = 'unknown', args, result, status = 'success', step } = toolData;
      const statusMap = {
        running: { label: '执行中', cls: 'running' },
        success: { label: '成功', cls: 'success' },
        error:   { label: '失败', cls: 'error' },
      };
      const st = statusMap[status] || statusMap.success;

      const card = document.createElement('div');
      card.className = 'agent-tool-card';
      card.innerHTML = `
        <div class="agent-tool-header">
          <span>🔧</span>
          <span class="agent-tool-name">${this._escapeHtml(name)}</span>
          <span class="agent-tool-status ${st.cls}">${st.label}</span>
        </div>
        <div class="agent-tool-body"></div>
      `;
      const body = card.querySelector('.agent-tool-body');

      // 参数
      if (args != null) {
        const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
        const sec = document.createElement('div');
        sec.className = 'agent-tool-section';
        sec.innerHTML = `<div class="agent-tool-section-label">参数</div>`;
        const pre = document.createElement('div');
        pre.textContent = argsStr;
        sec.appendChild(pre);
        body.appendChild(sec);
      }

      // 结果
      if (result != null) {
        const resStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        const sec = document.createElement('div');
        sec.className = 'agent-tool-section';
        sec.innerHTML = `<div class="agent-tool-section-label">结果</div>`;
        const pre = document.createElement('div');
        pre.textContent = resStr;
        sec.appendChild(pre);
        body.appendChild(sec);
      } else if (status === 'running') {
        const sec = document.createElement('div');
        sec.className = 'agent-tool-section';
        sec.style.color = '#9ca3af';
        sec.style.fontStyle = 'italic';
        sec.textContent = '正在执行...';
        body.appendChild(sec);
      }

      this._appendMessageNode(card);
    }

    /* ----------------------------------------------------------
     * 渲染 Plan-Execute 子任务计划
     * ---------------------------------------------------------- */
    renderPlan(plan) {
      if (!Array.isArray(plan) || plan.length === 0) return;

      const wrap = document.createElement('div');
      wrap.className = 'agent-plan';
      wrap.innerHTML = `
        <div class="agent-plan-title">📋 执行计划（共 ${plan.length} 个子任务）</div>
        <div class="agent-plan-list"></div>
      `;
      const list = wrap.querySelector('.agent-plan-list');

      plan.forEach((task, idx) => {
        const item = document.createElement('div');
        const status = (task.status || 'pending').toLowerCase();
        item.className = `agent-plan-item ${status || 'pending'}`;

        const tools = Array.isArray(task.tools)
          ? task.tools.map(t => `<span class="agent-plan-tool">${this._escapeHtml(String(t))}</span>`).join('')
          : '';
        const deps = Array.isArray(task.dependsOn) && task.dependsOn.length
          ? task.dependsOn.map(d => `<span class="agent-plan-dep">依赖 #${this._escapeHtml(String(d))}</span>`).join('')
          : '';

        item.innerHTML = `
          <div class="agent-plan-desc">
            ${task.id != null ? `<strong>#${this._escapeHtml(String(task.id))}</strong> ` : ''}
            ${this._escapeHtml(task.description || `子任务 ${idx + 1}`)}
          </div>
          ${(tools || deps) ? `<div class="agent-plan-meta">${tools}${deps}</div>` : ''}
          ${task.reasoning ? `<div class="agent-plan-reason">${this._escapeHtml(task.reasoning)}</div>` : ''}
        `;
        list.appendChild(item);
      });

      this._appendMessageNode(wrap);
    }

    /* ----------------------------------------------------------
     * 渲染执行轨迹时间线
     * ---------------------------------------------------------- */
    renderTrace(traceData) {
      // 兼容数组或对象
      let nodes = [];
      if (Array.isArray(traceData)) {
        nodes = traceData;
      } else if (traceData && Array.isArray(traceData.nodes)) {
        nodes = traceData.nodes;
      } else if (traceData && Array.isArray(traceData.steps)) {
        nodes = traceData.steps;
      } else if (traceData && typeof traceData === 'object') {
        // 单个节点
        nodes = [traceData];
      } else {
        return;
      }
      if (nodes.length === 0) return;

      const wrap = document.createElement('div');
      wrap.className = 'agent-trace';
      wrap.innerHTML = `
        <div class="agent-trace-title">🧭 执行轨迹</div>
        <div class="agent-trace-timeline"></div>
      `;
      const timeline = wrap.querySelector('.agent-trace-timeline');

      nodes.forEach((n) => {
        const node = document.createElement('div');
        node.className = 'agent-trace-node';
        const stage = n.stage || n.name || n.phase || n.type || '阶段';
        const detail = n.detail || n.description || n.message || '';
        const dur = n.durationMs != null ? n.durationMs : n.duration;
        const durHtml = (dur != null)
          ? `<span class="agent-trace-duration">${this._formatDuration(dur)}</span>`
          : '';
        node.innerHTML = `
          <div class="agent-trace-stage">${this._escapeHtml(String(stage))}${durHtml}</div>
          ${detail ? `<div class="agent-trace-detail">${this._escapeHtml(String(detail))}</div>` : ''}
        `;
        timeline.appendChild(node);
      });

      this._appendMessageNode(wrap);
    }

    /* ----------------------------------------------------------
     * 流式文字逐字渲染（带闪烁光标）
     * ---------------------------------------------------------- */
    showStreamingText(container, text) {
      if (!container || !text) return;
      // 先清空并加光标
      container.textContent = '';
      const cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      container.appendChild(cursor);
      this.currentStreamBubble = container.closest('.agent-msg');

      let i = 0;
      const speed = 18; // 每字毫秒
      const tick = () => {
        if (i >= text.length) {
          // 渲染完成，移除光标
          if (cursor && cursor.parentNode) cursor.remove();
          this.currentStreamBubble = null;
          return;
        }
        // 在光标前插入字符
        container.insertBefore(document.createTextNode(text[i]), cursor);
        i++;
        this._scrollToBottom();
        setTimeout(tick, speed);
      };
      tick();
    }

    /* ----------------------------------------------------------
     * 显示加载指示器（三点动画）
     * ---------------------------------------------------------- */
    showTyping() {
      if (!this.messagesEl) return;
      // 避免重复添加
      if (this.messagesEl.querySelector('.agent-typing')) return;
      const node = document.createElement('div');
      node.className = 'agent-typing';
      node.id = 'enhanced-agent-typing';
      node.innerHTML = `
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      `;
      this._appendMessageNode(node);
    }

    /* ----------------------------------------------------------
     * 隐藏加载指示器
     * ---------------------------------------------------------- */
    hideTyping() {
      const node = this.messagesEl && this.messagesEl.querySelector('.agent-typing');
      if (node) node.remove();
    }

    /* ----------------------------------------------------------
     * 清空对话
     * ---------------------------------------------------------- */
    clearChat() {
      if (!this.messagesEl) return;
      this.messagesEl.innerHTML = '';
      // 重新插入欢迎消息
      this.messagesEl.innerHTML = `
        <div class="agent-msg agent-msg-bot">
          <div class="agent-msg-avatar">🤖</div>
          <div class="agent-msg-bubble">
            <p>你好！我是词光 AI 学习导师 👋</p>
            <p>支持三种智能体模式，选择不同模式体验不同的推理方式：</p>
            <p class="agent-welcome-hint">
              ⚡ <strong>ReAct</strong>：边想边做，逐步推理<br>
              📋 <strong>Plan-Execute</strong>：先规划再执行，支持任务分解<br>
              🧠 <strong>Multi-Agent</strong>：多智能体协作，自动路由
            </p>
          </div>
        </div>
      `;
      this.stepCounter = 0;
      this.sessionId = null;
      this.currentStreamBubble = null;
    }

    /* ----------------------------------------------------------
     * 加载 Multi-Agent 列表
     * ---------------------------------------------------------- */
    async loadAgents() {
      try {
        const token = this._getToken();
        const response = await fetch(this.apiBaseUrl + '/orchestrator/agents', {
          method: 'GET',
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
          },
        });

        if (response.status === 401) {
          if (typeof this.onAuthRequired === 'function') this.onAuthRequired();
          return;
        }
        if (!response.ok) {
          console.warn('[EnhancedAgent] 加载 Agent 列表失败:', response.status);
          return;
        }

        const json = await response.json();
        const list = json.data || json.agents || json || [];
        this.agents = Array.isArray(list) ? list : [];
        this.agentsLoaded = true;

        // 在消息区展示已注册的 Agent
        if (this.agents.length > 0) {
          this._renderAgentList(this.agents);
        }
      } catch (err) {
        console.warn('[EnhancedAgent] loadAgents 异常:', err);
      }
    }

    /* ----------------------------------------------------------
     * 渲染 Agent 列表（multi-agent 模式提示）
     * ---------------------------------------------------------- */
    _renderAgentList(agents) {
      const wrap = document.createElement('div');
      wrap.className = 'agent-step-card';
      const names = agents.map(a => a.name || a.id || a).join('、');
      wrap.innerHTML = `
        <div class="agent-step-header">
          <span class="agent-step-tag plan">已注册智能体</span>
          <span class="agent-step-toggle">▼</span>
        </div>
        <div class="agent-step-body">
          <div style="font-size:13px;color:#4b5563;margin-bottom:6px;">
            当前共有 <strong>${agents.length}</strong> 个智能体可供调度：
          </div>
          ${agents.map(a => {
            const name = a.name || a.id || a;
            const desc = a.description || a.desc || a.role || '';
            return `<div style="margin-bottom:4px;">• <strong>${this._escapeHtml(String(name))}</strong>${desc ? ' — ' + this._escapeHtml(String(desc)) : ''}</div>`;
          }).join('')}
        </div>
      `;
      const header = wrap.querySelector('.agent-step-header');
      header.addEventListener('click', () => wrap.classList.toggle('collapsed'));
      this._appendMessageNode(wrap);
    }

    /* ----------------------------------------------------------
     * 发送快捷问题
     * ---------------------------------------------------------- */
    sendQuickQuestion(question) {
      if (!question) return;
      // 写入输入框并发送
      if (this.inputEl) {
        this.inputEl.value = question;
      }
      this.sendMessage(question);
    }

    /* ==========================================================
     * 以下为内部工具方法
     * ========================================================== */

    /**
     * 获取登录 token（兼容多种存储方式）
     */
    _getToken() {
      // 优先 localStorage，其次 sessionStorage，最后 cookie
      try {
        return localStorage.getItem('token')
          || localStorage.getItem('auth_token')
          || sessionStorage.getItem('token')
          || sessionStorage.getItem('auth_token')
          || this._getCookie('token')
          || '';
      } catch (e) {
        return '';
      }
    }

    /**
     * 读取 cookie
     */
    _getCookie(name) {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[2]) : '';
    }

    /**
     * 追加节点到消息区并自动滚动到底部
     */
    _appendMessageNode(node) {
      if (!this.messagesEl) return;
      this.messagesEl.appendChild(node);
      this._scrollToBottom();
    }

    /**
     * 滚动到底部
     */
    _scrollToBottom() {
      if (!this.messagesEl) return;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    /**
     * 启用/禁用输入区
     */
    _setInputDisabled(disabled) {
      if (this.inputEl) this.inputEl.disabled = disabled;
      if (this.sendBtnEl) this.sendBtnEl.disabled = disabled;
    }

    /**
     * 渲染错误提示
     */
    renderError(message) {
      const node = document.createElement('div');
      node.className = 'agent-error';
      node.textContent = message || '发生未知错误';
      this._appendMessageNode(node);
    }

    /**
     * HTML 转义，防止 XSS
     */
    _escapeHtml(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /**
     * 格式化错误信息
     */
    _formatError(err) {
      if (!err) return '未知错误';
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        return '网络连接失败，请检查网络后重试。';
      }
      return err.message || String(err);
    }

    /**
     * 格式化耗时
     */
    _formatDuration(ms) {
      if (ms == null) return '';
      if (ms < 1000) return ms + ' ms';
      return (ms / 1000).toFixed(2) + ' s';
    }
  }

  /* ============================================================
   * 三、全局集成与自动初始化
   * ============================================================ */

  /**
   * 全局初始化函数
   * @param {HTMLElement|string} container 挂载容器（可选）
   * @param {Object} options 配置项
   * @returns {EnhancedAgentPanel}
   */
  window.initEnhancedAgent = function (container, options) {
    const panel = new EnhancedAgentPanel(options || {});
    panel.mount(container);
    // 暴露到全局便于调试与外部调用
    window.enhancedAgentPanel = panel;
    return panel;
  };

  /**
   * 自动初始化：
   * 若页面中存在 data-enhanced-agent 容器或浮动触发按钮，则自动挂载。
   */
  function _autoInit() {
    // 若已经初始化过则跳过
    if (window.enhancedAgentPanel) return;

    // 查找声明式容器
    let container = document.querySelector('[data-enhanced-agent]')
      || document.getElementById('enhanced-agent-container')
      || null;

    // 若存在触发按钮，自动绑定 toggle
    const trigger = document.querySelector('[data-enhanced-agent-trigger]')
      || document.getElementById('enhanced-agent-trigger');

    const panel = window.initEnhancedAgent(container);

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        panel.toggle();
      });
    }
  }

  // DOM 就绪后自动初始化
  if (document.readyState !== 'loading') {
    setTimeout(_autoInit, 100);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_autoInit, 100));
  }

  // 暴露类本身（便于扩展）
  window.EnhancedAgentPanel = EnhancedAgentPanel;

})();
