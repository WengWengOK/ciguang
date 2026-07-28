# 词光 - AI 驱动的考研英语智能学习平台

> 一个集成 RAG 知识检索、SSE 流式输出、AI 可观测性的全栈 AI 教育应用

## 项目简介

词光是一个面向考研英语学习者的智能学习平台，通过 AI 技术为用户提供个性化学习体验。项目涵盖词汇记忆、阅读理解、翻译练习、选词填空、写作训练、口语练习等考研英语全模块，并深度集成了 RAG 检索增强生成、SSE 流式对话、AI 可观测性等企业级 AI 工程能力。

## 核心亮点

### AI 工程能力
- **RAG 知识检索系统**：基于 Embedding 向量 + 余弦相似度的语义检索，支持 DashScope API 和本地 TF-IDF 双路径降级
- **SSE 流式输出**：AI 对话逐字流式渲染，兼容 DeepSeek 和 DashScope 双 API 流式协议
- **AI 可观测性**：Token 用量统计、调用耗时监控、成功率追踪、多维度聚合分析
- **Prompt 工程管理**：JSON 模板化提示词，业务逻辑与提示词解耦
- **多级降级机制**：API Key 不可用时自动降级到本地规则引擎

### 工程化实践
- **Docker 容器化**：docker-compose 一键部署
- **CI/CD 流水线**：GitHub Actions 自动化测试与部署
- **测试覆盖**：Jest + Supertest 单元测试和 API 集成测试
- **安全加固**：Helmet 安全头、CORS、速率限制、JWT 认证、bcrypt 密码加密

### 产品功能
- 5676 个考研词汇，频率加权随机出题
- 5 维度能力画像（词汇/语法/阅读/翻译/写作）
- 艾宾浩斯遗忘曲线智能复习
- AI 学习导师（基于学情画像的个性化答疑）
- 错题 OCR 识别 + AI 归因分析
- 学情预测与 AI 学习计划生成

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                         前端（浏览器）                        │
│  index.html + app.js + styles.css + api-client.js           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ 单词收藏室 │ │ 练习模块  │ │ AI 对话   │ │ SSE 流式渲染   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP / SSE
┌─────────────────────────┴───────────────────────────────────┐
│                    后端 API 服务（Express.js）                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    路由层（Routes）                     │   │
│  │  auth │ words │ records │ ai │ stream │ rag │ agent   │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │                                 │
│  ┌─────────────┐  ┌───────┴────────┐  ┌─────────────────┐   │
│  │  RAG 模块    │  │   AI 工具层     │  │  中间件层       │   │
│  │ embedding   │  │  sse-stream    │  │ auth (JWT)     │   │
│  │ vectorStore │  │  sse-parser    │  │ ai-observability│   │
│  │ retriever   │  │  prompt-engine │  │ rate-limit     │   │
│  └─────────────┘  └────────────────┘  └─────────────────┘   │
│                           │                                 │
│  ┌────────────────────────┴─────────────────────────────┐   │
│  │                  数据层（SQLite）                      │   │
│  │  users │ words │ records │ profiles │ embeddings      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐
   │  DashScope   │ │ DeepSeek  │ │ 本地降级引擎  │
   │ (通义千问)    │ │    API    │ │ (TF-IDF+规则)│
   └─────────────┘ └───────────┘ └─────────────┘
```

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | HTML + CSS + 原生 JS | 无框架依赖，轻量级 |
| 后端 | Node.js + Express | RESTful API |
| 数据库 | SQLite3 | 嵌入式，零配置 |
| AI 服务 | DashScope + DeepSeek | 双 API 支持 |
| 向量检索 | 自研 SQLite + 余弦相似度 | 轻量级 RAG |
| 流式输出 | SSE（Server-Sent Events） | 浏览器原生支持 |
| 认证 | JWT + bcryptjs | 无状态认证 |
| 安全 | Helmet + CORS + Rate Limit | 多层防护 |
| 测试 | Jest + Supertest | 单元 + 集成测试 |
| 容器化 | Docker + docker-compose | 一致性部署 |
| CI/CD | GitHub Actions | 自动化流水线 |

## 快速开始

### 环境要求
- Node.js >= 16
- npm >= 8

### 本地开发

```bash
# 1. 克隆项目
git clone <repo-url>
cd ciguang

# 2. 安装后端依赖
cd backend
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，配置 JWT_SECRET 和 AI API Key（可选，不配置则使用本地降级模式）

# 4. 初始化数据库
npm run init-db

# 5. 导入单词数据
node database/import_words.js

# 6. 启动后端服务
npm run dev
# 服务运行在 http://localhost:3000

# 7. 打开前端
# 直接在浏览器中打开 index.html，或通过后端静态文件服务访问
```

### Docker 部署

```bash
# 一键启动
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f backend
```

### 运行测试

```bash
cd backend

# 运行全部测试
npm test

# 生成覆盖率报告
npm run test:coverage
```

## 项目结构

```
ciguang/
├── index.html              # 前端主页面
├── app.js                  # 前端核心逻辑（15000+ 行）
├── styles.css              # 全局样式
├── api-client.js           # 前端 API 客户端封装
├── agent-frontend.js       # Agent 前端客户端
├── words_data.js           # 单词数据
├── docker-compose.yml       # Docker 编排
├── nginx.conf               # Nginx 反向代理配置
├── .github/
│   └── workflows/
│       └── ci.yml          # CI/CD 流水线
├── backend/                 # 后端服务
│   ├── server.js           # 应用入口
│   ├── routes/             # API 路由（13 个模块）
│   ├── rag/                # RAG 检索增强生成
│   ├── middleware/         # 中间件（认证 + AI 可观测性）
│   ├── utils/             # 工具（SSE 流 + 解析器）
│   ├── prompts/           # Prompt 模板管理
│   ├── database/          # 数据库层
│   ├── tests/             # 测试套件
│   ├── Dockerfile         # 后端容器配置
│   └── README.md          # 后端详细文档
└── README.md              # 本文件
```

## AI 模块详解

### 1. RAG 知识检索系统

```
用户提问 → Embedding 生成 → 向量检索（余弦相似度）→ Top-K 结果 → 构建上下文 → AI 生成
```

- **Embedding 生成**：优先使用 DashScope text-embedding-v3（1536 维），无 API Key 时降级到本地 DJB2 哈希方案
- **向量存储**：基于 SQLite 的轻量级向量数据库，无需部署 Pinecone/Milvus
- **语义检索**：余弦相似度计算，支持按内容类型过滤

### 2. SSE 流式对话

```
前端发送 POST → 后端调用 AI 流式 API → 逐块解析 SSE → 逐块写入 res → 前端逐字渲染
```

- **后端**：`stream.js` 路由 + `sse-stream.js` 流式输出 + `sse-parser.js` 协议解析
- **前端**：`ReadableStream` API 消费 SSE 流，实时更新消息气泡
- **体验**：打字机效果，光标闪烁动画

### 3. AI 可观测性

```javascript
// 记录每次 AI 调用
recordAICall({
    endpoint: '/api/stream/tutor',
    model: 'qwen-turbo',
    inputTokens: 156,
    outputTokens: 324,
    durationMs: 2300,
    success: true,
    fallback: false
});

// 聚合统计
GET /api/stream/metrics → {
    totalCalls: 1234,
    totalTokens: 456789,
    successRate: 0.97,
    byModel: { 'qwen-turbo': {...}, 'deepseek-chat': {...} },
    byEndpoint: { '/api/stream/tutor': {...} }
}
```

### 4. Prompt 工程管理

```json
// prompts/tutor.json
{
    "system": "你是词光考研英语学习导师...",
    "variables": ["profileSummary", "weakPoints", "recentErrors"],
    "constraints": ["回答控制在200-300字", "结合用户薄弱知识点"]
}
```

提示词模板与业务代码分离，支持变量插值和版本管理。

## API 速览

| 模块 | 端点数 | 代表性接口 |
|------|--------|-----------|
| 认证 | 3 | POST /api/auth/login |
| 单词 | 8 | GET /api/words/random/weighted |
| 学习记录 | 12 | POST /api/records/practice |
| AI 代理 | 7 | POST /api/ai/chat |
| SSE 流式 | 3 | POST /api/stream/tutor |
| RAG 检索 | 4 | POST /api/rag/search |
| Agent | 4 | POST /api/agent/chat |
| 能力画像 | 4 | GET /api/user/profile |
| 学情预测 | 2 | GET /api/predict/forecast |
| 数据同步 | 5 | POST /api/sync/sync |
| 复习系统 | 6 | GET /api/review/queue |

完整 API 文档：启动服务后访问 `http://localhost:3000/api`

## 降级策略

| 场景 | 降级方案 |
|------|---------|
| 无 AI API Key | 本地规则引擎回复（基于关键词匹配的预设回答） |
| DashScope 不可用 | 自动切换到 DeepSeek API |
| DeepSeek 不可用 | 降级到本地规则引擎 |
| Embedding API 不可用 | 本地 DJB2 哈希 + TF-IDF 向量生成 |
| 后端服务不可用 | 前端降级到 localStorage 本地存储 |

## 开发指南

### 添加新的 AI 接口

1. 在 `prompts/` 目录创建 Prompt 模板 JSON
2. 在 `routes/` 创建路由文件
3. 在 `server.js` 注册路由
4. 在 `api-client.js` 添加前端调用方法
5. 编写测试用例

### 添加新的流式接口

1. 在 `routes/stream.js` 添加新路由
2. 调用 `streamChat()` 或 `streamDeepSeek()`
3. 前端使用 `api.streamChat()` 消费 SSE 流

### 添加 RAG 检索

1. 调用 `POST /api/rag/index` 索引内容
2. 调用 `POST /api/rag/search` 进行语义搜索
3. 调用 `POST /api/rag/build-context` 构建 AI 上下文

## License

MIT
