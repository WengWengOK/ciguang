const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// AI接口限流：每分钟最多10次请求
const aiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});

// AI翻译评判
router.post('/translation/evaluate', aiRateLimit, async (req, res) => {
    try {
        const { source_text, user_translation, reference_translation } = req.body;
        
        if (!source_text || !user_translation) {
            return res.status(400).json({ success: false, message: '缺少必要参数' });
        }
        
        const apiKey = process.env.DEEPSEEK_API_KEY;
        const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
        
        if (!apiKey) {
            // 如果没有配置API Key，使用本地规则引擎评判
            const result = evaluateTranslationLocal(source_text, user_translation, reference_translation);
            return res.json({ success: true, data: result });
        }
        
        const prompt = `你是一位资深的英语翻译评分专家。请对以下学生的翻译进行评分和点评。

原文：${source_text}
参考译文：${reference_translation || '无'}
学生译文：${user_translation}

请按以下格式输出：
1. 总分（0-100分）
2. 准确性评分（0-40分）：是否准确传达原文意思
3. 流畅性评分（0-30分）：中文表达是否自然流畅
4. 完整性评分（0-30分）：是否遗漏重要信息
5. 详细点评：指出优点和需要改进的地方
6. 修改建议：给出优化后的译文

请以JSON格式输出：{"score": 总分, "accuracy": 准确性分, "fluency": 流畅性分, "completeness": 完整性分, "feedback": "点评", "suggestion": "修改建议"}`;

        const response = await axios.post(apiUrl, {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 1000
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        const aiContent = response.data.choices[0].message.content;
        
        // 尝试解析JSON
        let result;
        try {
            const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('无法解析AI响应');
            }
        } catch (e) {
            // 如果解析失败，返回原始文本
            result = {
                score: 0,
                feedback: aiContent,
                suggestion: '请查看上方点评',
                raw: aiContent
            };
        }
        
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('AI评判失败:', err.message);
        // 降级到本地评判
        const result = evaluateTranslationLocal(source_text, user_translation, reference_translation);
        res.json({ success: true, data: { ...result, fallback: true } });
    }
});

// 生成例句（AI辅助）
router.post('/generate-example', aiRateLimit, async (req, res) => {
    try {
        const { word, meaning } = req.body;
        
        if (!word) {
            return res.status(400).json({ success: false, message: '缺少单词参数' });
        }
        
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            return res.json({
                success: true,
                data: {
                    en: `The ${word} plays an important role in our daily life.`,
                    cn: `${word}在我们的日常生活中扮演着重要角色。`,
                    fallback: true
                }
            });
        }
        
        const prompt = `请为单词"${word}"（含义：${meaning || '无'}）生成一个考研英语难度的例句，并提供中文翻译。
要求：
1. 例句长度适中，约15-25个单词
2. 使用考研常见词汇和语法结构
3. 语境自然、有意义

请以JSON格式输出：{"en": "英文例句", "cn": "中文翻译"}`;

        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        const aiContent = response.data.choices[0].message.content;
        let result;
        try {
            const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
            result = jsonMatch ? JSON.parse(jsonMatch[0]) : { en: aiContent, cn: '' };
        } catch (e) {
            result = { en: aiContent, cn: '' };
        }
        
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, message: '生成例句失败: ' + err.message });
    }
});

// ===== 试卷智能分析 =====
// 使用 DashScope qwen-vl-plus 多模态模型分析试卷图片
router.post('/exam/analyze', aiRateLimit, async (req, res) => {
    try {
        const { images } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, message: '缺少试卷图片' });
        }

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            return res.json({
                success: false,
                message: '服务器未配置AI视觉模型API Key，请在前端设置中使用自己的API Key',
                fallback: true
            });
        }

        // 构建多模态消息
        const content = [];
        images.forEach(img => {
            content.push({ image: img });
        });

        const prompt = `你是一个专业的英语试卷分析助手。请仔细分析上传的试卷图片，识别试卷中的题目、答案和得分情况。

请从以下维度进行分析，并以JSON格式返回结果：

{
  "overview": {
    "level": "整体水平评价（如：优秀/良好/中等/需提升）",
    "score": "预估得分率或分数，如：72%",
    "description": "整体表现描述（1-2句话）"
  },
  "questionTypes": [
    {"name": "题型名称", "count": 题目数量, "correct": 正确数, "wrong": 错误数}
  ],
  "errorAnalysis": [
    {"type": "错误类型", "count": 数量, "examples": ["错误示例1"], "tags": ["标签1"]}
  ],
  "knowledgePoints": [
    {"name": "知识点名称", "mastery": 掌握度0-100, "total": 总题数, "correct": 正确数}
  ],
  "weakPoints": [
    {"point": "薄弱知识点", "reason": "原因分析", "suggestion": "改进建议"}
  ],
  "advice": ["具体建议1", "具体建议2"],
  "actionPlan": [
    {"title": "行动项", "description": "描述", "icon": "emoji", "target": "practice|reading|cloze|translation|writing|collection"}
  ]
}`;

        content.push({ text: prompt });

        const response = await axios.post(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
            {
                model: 'qwen-vl-plus',
                input: {
                    messages: [{ role: 'user', content }]
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const responseText = response.data.output?.choices?.[0]?.message?.content ||
                             response.data.output?.text || '';

        let result;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                const cleaned = jsonMatch[0].replace(/[\x00-\x1f]/g, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                result = JSON.parse(cleaned);
            }
        } else {
            throw new Error('无法解析AI返回结果');
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('试卷分析失败:', err.message);
        res.status(500).json({
            success: false,
            message: '试卷分析失败: ' + err.message,
            fallback: true
        });
    }
});

// ===== 统一AI代理接口 =====
// 前端所有AI调用统一通过此接口，API Key仅在后端管理

// 统一文本生成代理
router.post('/chat', aiRateLimit, async (req, res) => {
    try {
        const { prompt, system_prompt, temperature, max_tokens } = req.body;

        if (!prompt) {
            return res.status(400).json({ success: false, message: '缺少prompt参数' });
        }

        // 优先使用DashScope，其次DeepSeek
        const dashscopeKey = process.env.DASHSCOPE_API_KEY;
        const deepseekKey = process.env.DEEPSEEK_API_KEY;

        if (!dashscopeKey && !deepseekKey) {
            return res.status(503).json({
                success: false,
                message: '服务器未配置AI服务，请联系管理员配置API Key',
                fallback: true
            });
        }

        let content = '';
        const temp = temperature !== undefined ? temperature : 0.7;
        const maxTokens = max_tokens || 2000;

        // 构建消息数组
        const messages = [];
        if (system_prompt) {
            messages.push({ role: 'system', content: system_prompt });
        }
        messages.push({ role: 'user', content: prompt });

        if (dashscopeKey) {
            // 使用DashScope（通义千问）API
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
                {
                    model: 'qwen-turbo',
                    input: { messages },
                    parameters: {
                        result_format: 'message',
                        temperature: temp,
                        max_tokens: maxTokens
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${dashscopeKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            content = response.data.output?.choices?.[0]?.message?.content || '';
        } else {
            // 使用DeepSeek API（OpenAI兼容格式）
            const response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages,
                    temperature: temp,
                    max_tokens: maxTokens
                },
                {
                    headers: {
                        'Authorization': `Bearer ${deepseekKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );
            content = response.data.choices?.[0]?.message?.content || '';
        }

        res.json({ success: true, data: { content } });
    } catch (err) {
        console.error('AI代理请求失败:', err.message);
        res.status(500).json({
            success: false,
            message: 'AI服务请求失败: ' + err.message,
            fallback: true
        });
    }
});

// 统一多模态AI代理（图片+文本）
router.post('/multimodal', aiRateLimit, async (req, res) => {
    try {
        const { prompt, images, system_prompt } = req.body;

        if (!prompt || !images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, message: '缺少prompt或images参数' });
        }

        const apiKey = process.env.DASHSCOPE_API_KEY;

        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: '服务器未配置多模态AI服务',
                fallback: true
            });
        }

        // 构建多模态消息内容
        const content = [];
        images.forEach(img => {
            content.push({ image: img });
        });
        content.push({ text: prompt });

        const response = await axios.post(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
            {
                model: 'qwen-vl-plus',
                input: {
                    messages: [{ role: 'user', content }]
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const responseText = response.data.output?.choices?.[0]?.message?.content ||
                             response.data.output?.text || '';

        res.json({ success: true, data: { content: responseText } });
    } catch (err) {
        console.error('多模态AI代理失败:', err.message);
        res.status(500).json({
            success: false,
            message: '多模态AI服务请求失败: ' + err.message,
            fallback: true
        });
    }
});

// ===== 错题OCR识别 + AI归因分析 =====
// 接收错题图片，通过多模态AI完成OCR识别和错误归因分析
router.post('/ocr-analyze', aiRateLimit, async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, message: '缺少图片数据' });
        }

        const apiKey = process.env.DASHSCOPE_API_KEY;

        if (!apiKey) {
            return res.json({
                success: false,
                message: '服务器未配置多模态AI服务，无法进行OCR识别',
                fallback: true
            });
        }

        const prompt = `你是一个专业的英语学习助手，请仔细分析这张错题图片。

请完成以下任务：
1. OCR识别：提取图片中的所有文字内容（题目、选项、答案等）
2. 错误归因分析：判断这道题的错误类型和原因
3. 生成2-3道同类变体题供练习

请以JSON格式返回结果：
{
  "ocrText": "图片中识别到的全部文字内容",
  "questionType": "题目类型（vocabulary/grammar/reading/translation/cloze/other）",
  "questionContent": "提取的题目内容摘要",
  "correctAnswer": "正确答案",
  "userAnswer": "用户的错误答案（如果能识别到）",
  "errorCategory": "错误归因分类（vocabulary/grammar/logic/knowledge/other）",
  "knowledgePoints": ["涉及的知识点1", "知识点2"],
  "errorAnalysis": "错误原因详细分析",
  "improvementSuggestion": "针对性的改进建议",
  "variantQuestions": [
    {
      "question": "变体题1题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": 0,
      "explanation": "解析"
    }
  ]
}

注意：
- errorCategory可选值：vocabulary（词汇不足）、grammar（语法混淆）、logic（逻辑误判）、knowledge（知识点遗漏）、other（其他）
- variantQuestions生成2-3道与原题同类但不同内容的题目
- 如果图片不是英语错题或无法识别，返回 {"ocrText": "", "errorCategory": "other", "errorAnalysis": "无法识别图片内容"}`;

        // 构建多模态消息
        const content = [
            { image: image },
            { text: prompt }
        ];

        const response = await axios.post(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
            {
                model: 'qwen-vl-plus',
                input: {
                    messages: [{ role: 'user', content }]
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const responseText = response.data.output?.choices?.[0]?.message?.content ||
                             response.data.output?.text || '';

        // 解析JSON结果
        let result;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                // 尝试清理后解析
                const cleaned = jsonMatch[0]
                    .replace(/[\x00-\x1f]/g, '')
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']');
                result = JSON.parse(cleaned);
            }
        } else {
            // 无法解析为JSON，返回原始文本
            result = {
                ocrText: responseText,
                errorCategory: 'other',
                errorAnalysis: 'AI返回内容无法结构化解析，请查看原始文本',
                rawResponse: responseText
            };
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('OCR分析失败:', err.message);
        res.status(500).json({
            success: false,
            message: 'OCR分析失败: ' + err.message,
            fallback: true
        });
    }
});

// ===== AI口语练习模块 =====

// 生成口语话题
router.post('/speaking/generate', aiRateLimit, async (req, res) => {
    try {
        const { category } = req.body;

        const categories = {
            self_intro: '个人介绍类（如描述家乡、兴趣爱好、个人经历）',
            social: '社会话题类（如环保问题、科技发展、教育公平）',
            academic: '学术讨论类（如研究方法、学术论文复述、学术观点表达）',
            daily: '日常生活类（如购物体验、旅行计划、饮食习惯）',
            career: '职业规划类（如考研动机、未来职业规划、实习经历）'
        };

        const topicCategory = categories[category] || '考研英语口语话题';

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            // 无API Key时返回预设话题
            const fallbackTopics = [
                { topic: 'Describe your hometown and what makes it special.', category: 'self_intro', tips: 'Try to include geographical location, local culture, and personal feelings.' },
                { topic: 'Discuss the impact of technology on education.', category: 'social', tips: 'Consider both positive and negative effects with examples.' },
                { topic: 'Why did you choose to pursue postgraduate studies?', category: 'career', tips: 'Explain your academic interests and career goals.' },
                { topic: 'Describe a book that influenced you deeply.', category: 'self_intro', tips: 'Include the main theme and how it changed your perspective.' },
                { topic: 'What are the advantages and disadvantages of social media?', category: 'social', tips: 'Provide balanced arguments with specific examples.' }
            ];
            const random = fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)];
            return res.json({ success: true, data: { ...random, fallback: true } });
        }

        const prompt = `你是一个考研英语口语考试出题专家。请生成一道${topicCategory}的口语话题。

要求：
1. 话题适合考研复试口语水平
2. 话题表述用英文，清晰简洁
3. 给出回答提示（中英文均可）
4. 预估回答时长约2-3分钟

请以JSON格式输出：
{"topic": "英文话题", "category": "${category || 'general'}", "tips": "回答提示", "estimatedTime": "2-3分钟"}`;

        const response = await axios.post(
            process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        let content = response.data.choices?.[0]?.message?.content || '';
        let result;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try { result = JSON.parse(jsonMatch[0]); }
            catch (e) { result = { topic: content, tips: '', fallback: true }; }
        } else {
            result = { topic: content, tips: '', fallback: true };
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('生成口语话题失败:', err.message);
        res.json({
            success: true,
            data: { topic: 'Describe a challenge you faced and how you overcame it.', tips: 'Use specific examples and reflect on what you learned.', fallback: true }
        });
    }
});

// 评判口语回答
router.post('/speaking/evaluate', aiRateLimit, async (req, res) => {
    try {
        const { topic, transcription, duration } = req.body;

        if (!transcription) {
            return res.status(400).json({ success: false, message: '缺少转写文本' });
        }

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        // 计算流利度指标
        const wordCount = transcription.split(/\s+/).filter(w => w.length > 0).length;
        const durationSec = duration || 120;
        const wordsPerMin = Math.round((wordCount / durationSec) * 60);

        if (!apiKey) {
            // 无API Key时使用本地规则评判
            const localResult = evaluateSpeakingLocal(topic, transcription, wordCount, wordsPerMin, durationSec);
            return res.json({ success: true, data: { ...localResult, fallback: true } });
        }

        const prompt = `你是一位专业的考研英语口语考官。请评判以下学生的口语回答。

话题：${topic || '未指定'}
学生回答（语音转文字）：${transcription}
回答时长：${durationSec}秒
语速：${wordsPerMin}词/分钟

请从以下维度评分（每项0-100分），并给出详细反馈：

1. 流利度（Fluency）：语速、停顿、连贯性
2. 语法（Grammar）：语法正确性、句式多样性
3. 内容（Content）：观点相关性、论据充分性、逻辑性
4. 词汇（Vocabulary）：词汇多样性、用词准确性
5. 发音预估（Pronunciation）：基于转写文本的发音可读性评估

请以JSON格式输出：
{
  "scores": {
    "fluency": 分数,
    "grammar": 分数,
    "content": 分数,
    "vocabulary": 分数,
    "pronunciation": 分数
  },
  "overall": 总分,
  "feedback": {
    "fluency": "流利度反馈",
    "grammar": "语法反馈（指出具体错误）",
    "content": "内容反馈",
    "vocabulary": "词汇反馈"
  },
  "errors": [
    {"original": "原句", "correction": "修正", "type": "grammar/vocabulary"}
  ],
  "suggestions": ["改进建议1", "改进建议2"],
  "referenceAnswer": "AI生成的参考范文（优秀回答示例）"
}`;

        const response = await axios.post(
            process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 2000
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        let content = response.data.choices?.[0]?.message?.content || '';
        let result;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try { result = JSON.parse(jsonMatch[0]); }
            catch (e) {
                const cleaned = jsonMatch[0].replace(/[\x00-\x1f]/g, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                result = JSON.parse(cleaned);
            }
        } else {
            result = evaluateSpeakingLocal(topic, transcription, wordCount, wordsPerMin, durationSec);
            result.rawResponse = content;
        }

        // 补充本地计算的流利度数据
        if (!result.wordStats) {
            result.wordStats = { wordCount, durationSec, wordsPerMin };
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('口语评判失败:', err.message);
        const wordCount = (req.body.transcription || '').split(/\s+/).filter(w => w.length > 0).length;
        const localResult = evaluateSpeakingLocal(req.body.topic, req.body.transcription, wordCount, 100, req.body.duration || 120);
        res.json({ success: true, data: { ...localResult, fallback: true } });
    }
});

// 本地口语评判引擎（降级方案）
function evaluateSpeakingLocal(topic, transcription, wordCount, wordsPerMin, durationSec) {
    let fluencyScore = 60;
    let grammarScore = 60;
    let contentScore = 60;
    let vocabScore = 55;
    let pronScore = 60;

    const feedback = {};
    const errors = [];

    // 流利度评估
    if (wordsPerMin >= 100 && wordsPerMin <= 160) {
        fluencyScore = 80;
        feedback.fluency = '语速适中，表达较为流畅';
    } else if (wordsPerMin < 60) {
        fluencyScore = 45;
        feedback.fluency = '语速偏慢，建议增加练习提高流畅度';
    } else if (wordsPerMin > 180) {
        fluencyScore = 65;
        feedback.fluency = '语速偏快，注意控制节奏和清晰度';
    } else {
        fluencyScore = 70;
        feedback.fluency = '语速基本正常，继续练习保持流畅';
    }

    // 语法评估（简单规则）
    const sentences = transcription.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLen = sentences.length > 0 ? wordCount / sentences.length : 0;

    // 检查常见语法错误
    const lowerText = transcription.toLowerCase();
    if (/\bi\s /.test(lowerText) && !/\bI\s /.test(transcription)) {
        errors.push({ original: 'i', correction: 'I', type: 'grammar' });
    }
    if (/\bhe\s+don\b/i.test(transcription)) {
        errors.push({ original: 'he don\'t', correction: 'he doesn\'t', type: 'grammar' });
    }

    if (avgSentenceLen > 5 && avgSentenceLen < 25) {
        grammarScore = 70;
        feedback.grammar = '句子长度适中，基本语法结构正确';
    } else if (avgSentenceLen >= 25) {
        grammarScore = 55;
        feedback.grammar = '部分句子过长，建议拆分以提升可读性';
    } else {
        grammarScore = 50;
        feedback.grammar = '句子过短，建议使用更丰富的句式结构';
    }
    if (errors.length > 0) {
        grammarScore -= 10;
    }

    // 内容评估
    if (wordCount > 50) {
        contentScore = 72;
        feedback.content = '回答内容充实，表达了较多信息';
    } else if (wordCount > 20) {
        contentScore = 60;
        feedback.content = '回答基本涵盖话题，建议补充更多细节';
    } else {
        contentScore = 40;
        feedback.content = '回答过于简短，需要展开更多内容';
    }

    // 词汇评估
    const uniqueWords = new Set(transcription.toLowerCase().match(/[a-z]+/g) || []);
    const vocabRatio = wordCount > 0 ? uniqueWords.size / wordCount : 0;
    if (vocabRatio > 0.6) {
        vocabScore = 75;
        feedback.vocabulary = '词汇使用多样，表达丰富';
    } else if (vocabRatio > 0.4) {
        vocabScore = 62;
        feedback.vocabulary = '词汇基本适当，可尝试使用更多高级词汇';
    } else {
        vocabScore = 50;
        feedback.vocabulary = '词汇重复较多，建议丰富词汇量';
    }

    pronScore = Math.round((fluencyScore + vocabScore) / 2);

    const overall = Math.round((fluencyScore + grammarScore + contentScore + vocabScore + pronScore) / 5);

    return {
        scores: {
            fluency: fluencyScore,
            grammar: grammarScore,
            content: contentScore,
            vocabulary: vocabScore,
            pronunciation: pronScore
        },
        overall,
        feedback,
        errors,
        suggestions: [
            '多进行口语练习，尝试录音后回放检查',
            '注意使用连接词（however, therefore, in addition等）提升连贯性',
            '积累话题相关的高级词汇和表达方式'
        ],
        referenceAnswer: '建议围绕话题展开2-3个主要观点，每个观点用具体例子支撑，注意使用过渡词连接各部分。',
        wordStats: { wordCount, durationSec: durationSec || 120, wordsPerMin }
    };
}

// 本地翻译评判引擎（降级方案）
function evaluateTranslationLocal(source, userTrans, refTrans) {
    let score = 60; // 基础分
    const feedbacks = [];
    
    // 长度检查
    const sourceLen = source.length;
    const userLen = userTrans.length;
    const ratio = userLen / (sourceLen * 0.6 + 1); // 粗略估算中文字数
    
    if (ratio < 0.5) {
        score -= 15;
        feedbacks.push('译文过短，可能遗漏了部分内容');
    } else if (ratio > 2) {
        score -= 5;
        feedbacks.push('译文偏长，可以更简洁');
    } else {
        score += 5;
        feedbacks.push('译文长度适中');
    }
    
    // 关键词检查（简单匹配）
    const sourceWords = source.toLowerCase().match(/[a-z]+/g) || [];
    const userWords = userTrans.toLowerCase();
    let keywordMatch = 0;
    sourceWords.forEach(w => {
        if (w.length > 4 && userWords.includes(w)) keywordMatch++;
    });
    
    if (keywordMatch > 0) {
        score += Math.min(10, keywordMatch * 2);
        feedbacks.push('关键词翻译准确');
    }
    
    // 如果有参考译文，做简单对比
    if (refTrans) {
        const refWords = refTrans.split(/\s+/);
        const userWordsArr = userTrans.split(/\s+/);
        let overlap = 0;
        refWords.forEach(rw => {
            if (userWordsArr.some(uw => uw.includes(rw) || rw.includes(uw))) overlap++;
        });
        const similarity = overlap / refWords.length;
        if (similarity > 0.5) {
            score += 10;
            feedbacks.push('与参考译文较为接近');
        }
    }
    
    // 确保分数在0-100之间
    score = Math.max(0, Math.min(100, score));
    
    return {
        score,
        accuracy: Math.round(score * 0.4),
        fluency: Math.round(score * 0.3),
        completeness: Math.round(score * 0.3),
        feedback: feedbacks.join('；') || '译文基本正确，继续努力！',
        suggestion: refTrans ? `参考译文：${refTrans}` : '建议对照原文逐词检查'
    };
}

module.exports = router;
