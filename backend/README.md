# 单词收藏室 - 后端服务

考研英语学习App的后端API服务，使用Node.js + Express + SQLite构建。

## 功能特性

- **用户系统**：注册、登录、JWT认证
- **单词数据**：分页查询、搜索、字母筛选、频率加权随机
- **学习记录**：例句练习、阅读理解、翻译练习、选词填空、单词记忆
- **AI集成**：翻译评判、例句生成（支持DeepSeek API）
- **数据统计**：学习进度、正确率、每日统计

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置JWT密钥和AI API密钥
```

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 导入单词数据

```bash
node database/import_words.js
```

### 5. 启动服务

```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务启动后访问 http://localhost:3000/api 查看API文档。

## API接口概览

### 认证接口
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 获取当前用户

### 单词接口
- `GET /api/words` - 单词列表（分页、搜索、筛选）
- `GET /api/words/random/weighted` - 频率加权随机单词
- `POST /api/words/:id/favorite` - 收藏/取消收藏

### 学习记录接口
- `POST /api/records/practice` - 保存例句练习
- `POST /api/records/reading` - 保存阅读练习
- `POST /api/records/translation` - 保存翻译练习
- `POST /api/records/cloze` - 保存选词填空
- `POST /api/records/memory` - 保存单词记忆
- `GET /api/records/stats/overview` - 学习统计

### AI接口
- `POST /api/ai/translation/evaluate` - AI翻译评判
- `POST /api/ai/generate-example` - AI生成例句

## 数据库结构

- **users** - 用户表
- **words** - 单词表（5676个考研词汇）
- **user_words** - 用户单词学习记录
- **practice_records** - 例句练习记录
- **reading_records** - 阅读练习记录
- **translation_records** - 翻译练习记录
- **cloze_records** - 选词填空记录
- **memory_records** - 单词记忆记录
- **daily_stats** - 每日学习统计

## 技术栈

- **框架**: Express.js
- **数据库**: SQLite3
- **认证**: JWT + bcryptjs
- **安全**: Helmet + CORS + Rate Limit
- **AI**: DeepSeek API (可选)

## 目录结构

```
backend/
├── server.js           # 入口文件
├── package.json        # 依赖配置
├── .env.example        # 环境变量示例
├── README.md           # 说明文档
├── routes/             # 路由
│   ├── auth.js         # 认证路由
│   ├── words.js        # 单词路由
│   ├── records.js      # 记录路由
│   └── ai.js           # AI路由
├── middleware/         # 中间件
│   └── auth.js         # JWT认证
└── database/           # 数据库
    ├── db.js           # 数据库连接
    ├── init.js         # 初始化脚本
    └── import_words.js # 导入单词数据
```
