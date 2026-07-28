const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet({
    contentSecurityPolicy: false // 允许前端内联脚本
}));

// CORS配置
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务（前端文件）
app.use(express.static(path.join(__dirname, '..')));

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/words', require('./routes/words'));
app.use('/api/records', require('./routes/records'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/user', require('./routes/profile'));
app.use('/api/review', require('./routes/review'));
app.use('/api/agent', require('./routes/tutor'));
app.use('/api/predict', require('./routes/predict'));
app.use('/api/exam-practice', require('./routes/exam-practice'));
app.use('/api/error-agent', require('./routes/error-agent'));
app.use('/api/rag', require('./routes/rag'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/study-agent', require('./routes/study-agent'));

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: '词光后端服务运行正常',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// API文档
app.get('/api', (req, res) => {
    res.json({
        name: '词光 API',
        version: '1.0.0',
        endpoints: {
            auth: {
                'POST /api/auth/register': '用户注册',
                'POST /api/auth/login': '用户登录',
                'GET /api/auth/me': '获取当前用户信息'
            },
            words: {
                'GET /api/words': '获取单词列表（支持分页、搜索、字母筛选）',
                'GET /api/words/:id': '获取单个单词详情',
                'GET /api/words/random/weighted': '频率加权随机获取单词',
                'GET /api/words/stats/by-letter': '按字母分组统计',
                'GET /api/words/user/progress': '获取用户学习进度（需登录）',
                'POST /api/words/user/progress': '更新用户学习进度（需登录）',
                'POST /api/words/:id/favorite': '切换收藏状态（需登录）',
                'GET /api/words/user/favorites': '获取收藏单词（需登录）'
            },
            records: {
                'POST /api/records/practice': '保存例句练习记录（需登录）',
                'GET /api/records/practice': '获取例句练习记录（需登录）',
                'POST /api/records/reading': '保存阅读练习记录（需登录）',
                'GET /api/records/reading': '获取阅读练习记录（需登录）',
                'POST /api/records/translation': '保存翻译练习记录（需登录）',
                'GET /api/records/translation': '获取翻译练习记录（需登录）',
                'POST /api/records/cloze': '保存选词填空记录（需登录）',
                'GET /api/records/cloze': '获取选词填空记录（需登录）',
                'POST /api/records/memory': '保存单词记忆记录（需登录）',
                'GET /api/records/memory': '获取单词记忆记录（需登录）',
                'POST /api/records/saved': '保存练习（需登录）',
                'GET /api/records/saved': '获取保存的练习（需登录）',
                'DELETE /api/records/saved/:id': '删除保存的练习（需登录）',
                'GET /api/records/stats/overview': '获取学习统计概览（需登录）'
            },
            ai: {
                'POST /api/ai/chat': '统一AI文本生成代理（前端所有AI调用通过此接口）',
                'POST /api/ai/multimodal': '统一多模态AI代理（图片+文本分析）',
                'POST /api/ai/ocr-analyze': '错题OCR识别 + AI归因分析（图片→文本→错误归因→变体题）',
                'POST /api/ai/speaking/generate': 'AI生成口语练习话题',
                'POST /api/ai/speaking/evaluate': 'AI评判口语回答（流利度/语法/内容/词汇/发音）',
                'POST /api/ai/translation/evaluate': 'AI翻译评判',
                'POST /api/ai/generate-example': 'AI生成例句',
                'POST /api/ai/exam/analyze': 'AI试卷智能分析（上传试卷图片，分析学生情况）'
            },
            sync: {
                'POST /api/sync/upload': '上传所有本地数据到云端（需登录）',
                'GET /api/sync/download': '从云端下载所有数据（需登录）',
                'POST /api/sync/sync': '增量同步：上传本地数据并下载云端最新数据（需登录）',
                'POST /api/sync/data/:key': '保存单条用户数据（需登录）',
                'GET /api/sync/data/:key': '获取单条用户数据（需登录）'
            },
            user: {
                'GET /api/user/profile': '获取用户能力画像（5维度评分）',
                'POST /api/user/profile/update': '更新能力画像（答题后调用）',
                'GET /api/user/skills/:dimension': '获取指定维度的知识点掌握情况',
                'POST /api/user/profile/reset': '重置能力画像'
            },
            agent: {
                'POST /api/agent/tutor/chat': 'AI学习导师对话（基于学情画像的个性化答疑）',
                'POST /api/agent/tutor/clear': '清除导师会话历史'
            },
            predict: {
                'GET /api/predict/forecast': '获取学情预测数据（预测分数/等级/趋势/提升空间）',
                'POST /api/predict/plan': '生成AI学习计划（分阶段/每日安排/周目标）'
            },
            stream: {
                'POST /api/stream/tutor': 'AI学习导师流式对话（SSE逐字输出）',
                'POST /api/stream/error-agent': '错题分析Agent流式对话（SSE逐字输出）',
                'GET /api/stream/metrics': 'AI调用可观测性数据（token统计/耗时/成功率）'
            },
            rag: {
                'POST /api/rag/index': '索引单词到向量数据库（需登录）',
                'POST /api/rag/search': '搜索相关知识（语义检索，需登录）',
                'GET /api/rag/stats': '获取向量索引统计（需登录）',
                'POST /api/rag/build-context': '构建RAG上下文（需登录）'
            },
            'study-agent': {
                'POST /api/study-agent/run': 'ReAct智能体同步执行（think+act多步推理+工具调用）',
                'POST /api/study-agent/run-stream': 'ReAct智能体SSE流式执行（逐步推送推理过程）',
                'GET /api/study-agent/tools': '获取智能体可用工具列表'
            }
        }
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ success: false, message: '接口不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ 
        success: false, 
        message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误'
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`=================================`);
        console.log(`词光后端服务已启动`);
        console.log(`监听端口: ${PORT}`);
        console.log(`API地址: http://localhost:${PORT}/api`);
        console.log(`健康检查: http://localhost:${PORT}/api/health`);
        console.log(`=================================`);
    });
}

module.exports = app;
