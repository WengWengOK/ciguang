# 词光 - 后端服务

考研英语智能学习平台的 AI 后端服务，基于 Node.js + Express + SQLite 构建，集成 ReAct 智能体框架、RAG 知识检索、SSE 流式输出、AI 可观测性等企业级 AI 工程能力。

## 核心功能

### 基础功能
- **用户系统**：注册、登录、JWT 认证、密码加密（bcryptjs）
- **单词数据**：5676 个考研词汇，支持分页、搜索、字母筛选、频率加权随机
- **学习记录**：例句练习、阅读理解、翻译练习、选词填空、单词记忆全链路记录
- **数据统计**：学习进度、正确率、每日统计、能力画像（5 维度评分）

### AI 工程能力（求职面试亮点）
- **ReAct 智能体框架**：四层继承体系（BaseAgent → ReActAgent → ToolCallAgent → StudyAgent），自主 think/act 循环，手动管理工具调用
- **工具注册系统**：7 个内置工具（单词查询/学情画像/复习队列/RAG检索/错题统计/练习生成/终止），Agent 可自主选择和组合调用
- **RAG 知识检索**：基于 Embedding 向量 + 余弦相似度的语义检索，支持查询重写（QueryRewriter）提升召回率
- **SSE 流式输出**：AI 对话逐字流式渲染 + Agent 推理过程逐步推送，兼容 DeepSeek 和 DashScope 双 API
- **AI 可观测性**：Token 用量统计、调用耗时监控、成功率/错误率追踪、按模型/端点/日期维度聚合
- **Prompt 工程管理**：JSON 模板化提示词，`{{variable}}` 变量插值，业务逻辑与提示词解耦，支持热重载
- **统一 AI 服务层**：消除 DashScope/DeepSeek if-else 重复，统一 Function Calling 接口
- **多级降级机制**：API Key 不可用时自动降级到本地规则引擎，保证服务可用性

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，配置 JWT 密钥和 AI API 密钥
```

### 3. 初始化数据库并导入单词

```bash
npm run init-db
node database/import_words.js
```

### 4. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务启动后访问 `http://localhost:3000/api` 查看 API 文档。

### 5. 运行测试

```bash
# 全部测试
npm test

# 覆盖率报告
npm run test:coverage
```

## API 接口概览

### 认证接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 单词接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/words` | 单词列表（分页、搜索、筛选） |
| GET | `/api/words/random/weighted` | 频率加权随机单词 |
| POST | `/api/words/:id/favorite` | 收藏/取消收藏 |
| GET | `/api/words/user/progress` | 用户学习进度 |
| GET | `/api/words/user/favorites` | 收藏列表 |

### AI 接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | 统一 AI 文本生成代理 |
| POST | `/api/ai/multimodal` | 多模态 AI 代理（图片+文本） |
| POST | `/api/ai/translation/evaluate` | AI 翻译评判 |
| POST | `/api/ai/ocr-analyze` | 错题 OCR 识别 + AI 归因分析 |
| POST | `/api/ai/speaking/generate` | AI 口语话题生成 |
| POST | `/api/ai/speaking/evaluate` | AI 口语评判 |
| POST | `/api/ai/exam/analyze` | 试卷智能分析 |

### SSE 流式对话接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/stream/tutor` | AI 学习导师流式对话（SSE 逐字输出） |
| POST | `/api/stream/error-agent` | 错题分析 Agent 流式对话（SSE 逐字输出） |
| GET | `/api/stream/metrics` | AI 调用可观测性数据（Token 统计/耗时/成功率） |

### RAG 知识检索接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rag/index` | 索引单词到向量数据库 |
| POST | `/api/rag/search` | 语义搜索相关知识 |
| GET | `/api/rag/stats` | 向量索引统计 |
| POST | `/api/rag/build-context` | 构建 RAG 上下文 |

### Agent 接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/chat` | AI 学习导师对话（基于学情画像） |
| POST | `/api/agent/clear` | 清除导师会话历史 |
| POST | `/api/error-agent/chat` | 错题库 Agent 对话 |
| POST | `/api/error-agent/clear` | 清除错题 Agent 会话 |

### ReAct 智能体接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/study-agent/run` | ReAct 智能体同步执行（think+act 多步推理+工具调用） |
| POST | `/api/study-agent/run-stream` | ReAct 智能体 SSE 流式执行（逐步推送推理过程） |
| GET | `/api/study-agent/tools` | 获取智能体可用工具列表 |

### 学习记录与统计
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/records/practice` | 保存例句练习记录 |
| POST | `/api/records/reading` | 保存阅读练习记录 |
| POST | `/api/records/translation` | 保存翻译练习记录 |
| POST | `/api/records/cloze` | 保存选词填空记录 |
| POST | `/api/records/memory` | 保存单词记忆记录 |
| GET | `/api/records/stats/overview` | 学习统计概览 |

### 其他接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/profile` | 用户能力画像（5 维度评分） |
| POST | `/api/user/profile/update` | 更新能力画像 |
| GET | `/api/predict/forecast` | 学情预测数据 |
| POST | `/api/predict/plan` | 生成 AI 学习计划 |
| POST | `/api/sync/sync` | 增量数据同步 |
| GET/POST | `/api/review/*` | 艾宾浩斯复习队列 |

## 架构设计

```
backend/
├── server.js                 # 应用入口，路由注册
├── routes/                   # 路由层（请求处理）
│   ├── auth.js               # 认证路由
│   ├── words.js              # 单词路由
│   ├── records.js            # 学习记录路由
│   ├── ai.js                # AI 代理路由（翻译/口语/OCR/试卷分析）
│   ├── stream.js             # SSE 流式对话路由 ⭐
│   ├── rag.js                # RAG 知识检索路由 ⭐
│   ├── study-agent.js        # ReAct 智能体路由 ⭐
│   ├── tutor.js              # AI 学习导师路由（接入 Prompt 模板）
│   ├── error-agent.js        # 错题分析 Agent 路由
│   ├── profile.js            # 能力画像路由
│   ├── predict.js            # 学情预测路由
│   ├── exam-practice.js      # 真题练习路由
│   ├── review.js             # 艾宾浩斯复习路由
│   └── sync.js               # 数据同步路由
├── agent/                   # ReAct 智能体框架 ⭐
│   ├── BaseAgent.js          # 状态机 + 步数循环 + 超时控制 + O层轨迹集成
│   ├── ReActAgent.js         # think/act 模板方法
│   ├── ToolCallAgent.js      # 手动工具调用 + C层上下文压缩 + O层轨迹记录
│   ├── StudyAgent.js         # 具体智能体（提示词+工具集配置）
│   ├── PlanExecuteAgent.js   # L层：Plan-and-Execute 任务分解 ⭐
│   └── MultiAgentOrchestrator.js # L层：多 Agent 编排与路由 ⭐
├── tools/                   # 工具注册系统 ⭐
│   ├── ToolRegistry.js      # 工具注册中心（集中注册+按需注入）
│   ├── EnhancedToolRegistry.js # T层：Schema校验+熔断+并行执行 ⭐
│   ├── WordTool.js           # 单词查询工具
│   ├── ProfileTool.js        # 学情画像工具
│   ├── ReviewTool.js         # 复习队列工具
│   ├── RAGTool.js            # RAG 语义检索工具（含查询重写）
│   ├── ErrorTool.js          # 错题统计工具
│   ├── ExerciseTool.js       # 练习题生成工具
│   └── TerminateTool.js      # 终止工具
├── services/                # 统一服务层 ⭐
│   ├── AIService.js          # 统一 AI 服务（DashScope/DeepSeek 自动切换+可观测性）
│   ├── QueryRewriter.js      # RAG 查询重写器
│   ├── SessionStore.js       # 会话并发安全存储（SQLite+内存锁，替代 FileBasedChatMemory）
│   ├── EvaluationService.js  # V层：AI 评测框架（质量评分+工具准确率+回归测试）
│   ├── ContextManager.js     # C层：Token 预算管理 + 40% 阈值上下文压缩 ⭐
│   └── ExecutionTracer.js    # O层：Agent 执行轨迹完整记录 + SQLite 持久化 ⭐
├── rag/                      # RAG 检索增强生成模块
│   ├── embedding.js          # Embedding 生成（DashScope + 本地降级）
│   ├── vectorStore.js        # 向量存储（SQLite + 余弦相似度检索）
│   └── retriever.js          # 知识检索器
├── middleware/               # 中间件
│   ├── auth.js               # JWT 认证中间件
│   ├── ai-observability.js   # AI 可观测性中间件
│   └── guardrails.js         # G层：输入防护+输出过滤+审计日志 ⭐
├── utils/                    # 工具层
│   ├── sse-stream.js         # SSE 流式输出（DeepSeek + DashScope）
│   └── sse-parser.js         # SSE 协议解析器
├── prompts/                  # Prompt 模板管理 ⭐
│   ├── index.js              # 模板加载与渲染引擎（已接入 tutor.js）
│   ├── tutor.json            # 导师对话提示词
│   ├── errorAgent.json       # 错题分析提示词
│   ├── translation.json      # 翻译评判提示词
│   ├── speaking.json         # 口语练习提示词
│   ├── exam.json             # 真题练习提示词
│   └── predict.json          # 学情预测提示词
├── database/                 # 数据库层
│   ├── db.js                # SQLite 连接封装
│   ├── init.js               # 数据库初始化脚本
│   ├── import_words.js       # 单词数据导入
│   └── word_collection.db    # SQLite 数据库文件
├── tests/                    # 测试套件（84 个测试）
│   ├── setup.js              # 测试环境配置
│   ├── agent.test.js         # ReAct Agent 框架测试（含超时控制）⭐
│   ├── production.test.js   # 生产级增强测试（SessionStore+可观测性+评测）⭐
│   ├── auth.test.js          # 认证测试
│   ├── words.test.js         # 单词接口测试
│   ├── ai.test.js            # AI 降级测试
│   └── health.test.js        # 健康检查测试
├── Dockerfile                # Docker 容器配置
├── .dockerignore             # Docker 构建忽略
├── jest.config.js            # Jest 测试配置
└── .env.example              # 环境变量示例
```

## 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| Web 框架 | Express.js | 轻量级 Node.js 框架 |
| 数据库 | SQLite3 | 嵌入式数据库，零配置部署 |
| 认证 | JWT + bcryptjs | 无状态认证 + 密码加密 |
| 安全 | Helmet + CORS + express-rate-limit | 安全头 + 跨域 + 限流 |
| AI 服务 | DashScope（通义千问）+ DeepSeek | 双 API 支持，自动降级 |
| 向量检索 | 自研 SQLite + 余弦相似度 | 轻量级 RAG，无需外部向量数据库 |
| 流式输出 | SSE（Server-Sent Events） | 标准协议，浏览器原生支持 |
| 测试 | Jest + Supertest | 单元测试 + API 集成测试 |
| 容器化 | Docker + docker-compose | 一致性部署环境 |

## AI 工程亮点

### 1. ReAct 智能体框架（核心亮点）
- **四层继承体系**：BaseAgent（状态机+循环）→ ReActAgent（think/act 模板）→ ToolCallAgent（手动工具调用）→ StudyAgent（配置层），模板方法模式的典型应用
- **状态机管理**：IDLE → RUNNING → FINISHED/ERROR 四态流转，步数上限保护防止无限循环
- **手动工具调用**：禁用 AI API 内置自动执行，自行维护消息上下文（messageList），实现 think/act 分离
- **双执行模式**：`run()` 同步执行返回完整推理链，`runStream()` SSE 流式逐步推送 think/act 过程

```
用户输入 → BaseAgent.run()
              ↓
         for (step < maxSteps && state != FINISHED)
              ↓
         ReActAgent.step() = think() + act()
              ↓
         ToolCallAgent.think(): AI 决策调用哪些工具
         ToolCallAgent.act(): 手动执行工具，结果反馈到 messageList
              ↓
         检测 terminate 工具 → state = FINISHED → 循环退出
```

### 2. 工具注册系统
- **7 个内置工具**：单词查询、学情画像、复习队列、RAG 检索、错题统计、练习生成、终止
- **集中注册**：ToolRegistry 统一管理，按需注入到 Agent
- **AI 自主选择**：通过 Function Calling 让 AI 决定调用哪些工具，支持多步组合调用
- **终止信号**：检测 `terminate` 工具名自动置 FINISHED 状态

### 3. RAG 知识检索系统
- **查询重写**：QueryRewriter 通过 LLM 将口语化查询重写为检索优化查询，提升召回率
- **双路径 Embedding**：优先 DashScope text-embedding-v3 API，无 Key 时降级到本地 DJB2 哈希
- **向量存储**：基于 SQLite 的轻量级向量数据库，无需外部服务
- **余弦相似度检索**：内存计算，Top-K 语义检索

### 4. 统一 AI 服务层
- **消除重复**：统一封装 DashScope/DeepSeek API 调用，消除 6+ 处 if-else 分支重复
- **Function Calling**：`chatWithTools()` 统一工具调用接口，支持 OpenAI 格式的 function calling
- **JSON 提取**：统一 `extractJSON()` 消除各路由重复的正则提取逻辑
- **可观测性集成**：所有 AI 调用自动记录 Token/耗时/成功率

### 5. SSE 流式输出
- **双 API 兼容**：同时支持 DeepSeek 和 DashScope 流式协议
- **Agent 推理流**：SSE 逐步推送 Agent 的 think/act 过程（step_start/tool_result/answer/done）
- **逐字渲染**：前端 ReadableStream API 逐字渲染 AI 回复

### 6. Prompt 工程管理
- **JSON 模板**：提示词与代码解耦，`{{variable}}` 变量插值
- **已接入**：tutor.js 已使用模板系统替代内联拼接
- **热重载**：支持运行时重载模板，无需重启服务

### 7. 生产级增强（解决 yu-ai-agent 四大短板）

以下增强针对 yu-ai-agent 教学项目的生产级缺陷，是面试中区分"跟着敲代码"与"理解原理"的关键切入点：

#### 7.1 会话并发安全（SessionStore）
- **问题**：yu-ai-agent 的 FileBasedChatMemory 用文件存储记忆，无并发控制
- **方案**：SQLite 持久化 + 内存锁（async 队列）保证并发安全
- **特性**：TTL 自动清理、消息数量上限、每用户会话数限制
- **集成**：BaseAgent.run() 支持可选 sessionId，自动加载/持久化消息上下文

#### 7.2 Agent 超时控制
- **问题**：Serverless 部署与 Agent 20 步循环存在超时冲突
- **方案**：Promise.race 实现步级超时 + AbortController 实现整体超时
- **设计**：步级超时跳过当前步继续执行（给恢复机会）；整体超时标记 ERROR 并终止
- **配置**：timeoutMs（整体，默认 300s）、stepTimeoutMs（单步，默认 60s）

#### 7.3 AI 可观测性升级（SQLite 持久化 + Trace ID）
- **问题**：yu-ai-agent 缺乏生产级监控，指标仅在内存中
- **方案**：SQLite 持久化 + Trace ID 链路追踪
- **特性**：内存缓存（同步快速响应）+ 异步落盘（不阻塞主流程）
- **查询**：getTraceById 按 trace 查调用链；getMetricsSummaryAsync 按时间/端点/模型筛选

#### 7.4 AI 评测框架（EvaluationService）
- **问题**：yu-ai-agent 缺乏生产级评测体系
- **方案**：LLM-as-a-Judge 自动评分 + 规则降级 + 回归测试
- **评分维度**：相关性 / 完整性 / 准确性 / 格式规范性（0-10 分）
- **工具选择准确率**：Precision / Recall / F1（对比实际调用 vs 应调用工具集）
- **回归测试**：预定义测试用例，自动执行并对比基线，检测质量退化

### 8. ETCLOVG 七层 Harness 架构增强

基于 AI Agent Harness 框架最佳实践，项目完成了 ETCLOVG 七层架构的全面增强，使 Agent 系统具备生产级的安全、可控、可观测能力。

| 层级 | 名称 | 模块 | 核心能力 |
|------|------|------|---------|
| E | Execution Environment | BaseAgent | 状态机 + 超时控制 + SessionStore 持久化 |
| T | Tool Interface Protocol | EnhancedToolRegistry | JSON Schema 校验 + 并行执行 + 熔断器 |
| C | Context Memory | ContextManager | Token 预算管理 + 40% 阈值自动压缩 |
| L | Lifecycle Orchestration | PlanExecuteAgent + MultiAgentOrchestrator | 任务分解 + 多 Agent 编排 |
| O | Observability | ExecutionTracer | 执行轨迹完整记录 + SQLite 持久化 |
| V | Validation & Evaluation | EvaluationService | LLM-as-Judge + 回归测试 |
| G | Governance & Security | Guardrails | 输入防护 + 输出过滤 + 审计日志 |

#### 8.1 T 层：增强工具协议（EnhancedToolRegistry）
- **Schema 校验**：工具入参 JSON Schema 校验，支持 required/type/enum，自动类型转换
- **熔断器**：CLOSED → OPEN → HALF_OPEN 状态机，连续失败 3 次自动熔断，60 秒后探测恢复
- **超时控制**：工具级可配置超时，默认 10 秒，Promise.race 实现
- **并行执行**：独立工具并行调用，错误隔离，互不影响

#### 8.2 C 层：上下文压缩与 Token 预算（ContextManager）
- **Token 预算**：按模型上下文窗口（qwen-turbo: 8192, deepseek-chat: 32768）管理预算
- **40% 阈值压缩**：当 messageList 估算 Token 达到上下文窗口 40% 时自动触发压缩
- **LLM 摘要**：保留最近 4 条消息，更早的历史用 LLM 压缩为摘要 system 消息
- **降级策略**：无 API Key 时自动降级为截断策略（保留首尾，删除中间）
- **tool_calls 关联保护**：压缩时保证 assistant(tool_calls) → tool(结果) 不被拆散

#### 8.3 L 层：生命周期编排（PlanExecuteAgent + MultiAgentOrchestrator）
- **Plan-and-Execute**：复杂任务自动分解为结构化子任务，支持依赖排序和动态修订（最多 3 次修订）
- **Multi-Agent 编排**：Agent 注册/路由/委派/并行执行，LLM 意图分类自动选择最合适的 Agent
- **状态机**：PLANNING → EXECUTING → DONE 三阶段流转，支持 plan revision 回退

#### 8.4 O 层：执行轨迹完整记录（ExecutionTracer）
- **全链路记录**：think/act/tool_call/state_change/error/plan 全阶段轨迹
- **数据脱敏**：password/token/apiKey 等敏感字段自动脱敏为 `***`
- **结果截断**：工具结果截断到 2000 字符，LLM 输入只存 role + content 前 200 字符
- **SQLite 持久化**：fire-and-forget 异步写入，不阻塞 Agent 主流程
- **可回放**：支持按 traceId 和 userId 查询历史轨迹

#### 8.5 G 层：安全防护（Guardrails）
- **输入防护**：Prompt Injection 检测（阻断级 + 告警级）、PII 脱敏、输入长度限制
- **输出过滤**：毒性检测与过滤、幻觉表达检测、重复内容检测
- **审计日志**：所有 AI 交互自动记录到 SQLite audit_logs 表，支持按 traceId/userId/时间查询

## 部署

### Docker 部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f backend
```

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 3000 |
| NODE_ENV | 运行环境 | development |
| JWT_SECRET | JWT 签名密钥 | （必须修改） |
| JWT_EXPIRES_IN | Token 过期时间 | 7d |
| DASHSCOPE_API_KEY | 通义千问 API Key | （可选） |
| DEEPSEEK_API_KEY | DeepSeek API Key | （可选） |
| FRONTEND_URL | 前端地址（CORS） | http://localhost:8080 |
