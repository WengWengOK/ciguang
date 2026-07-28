const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { get, all, run } = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

const examRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 8,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});

// 考研英语题型定义
const EXAM_SECTIONS = {
    cloze: { name: '完形填空', icon: '📝', count: 20, time: 20 },
    reading_a: { name: '阅读理解Part A', icon: '📖', count: 4, time: 40 },
    reading_b: { name: '新题型Part B', icon: '🔀', count: 1, time: 15 },
    reading_c: { name: '翻译Part C', icon: '🌐', count: 5, time: 20 },
    writing_a: { name: '应用文写作', icon: '✉️', count: 1, time: 15 },
    writing_b: { name: '图表/图画作文', icon: '✍️', count: 1, time: 30 }
};

// ===== 生成真题练习题目 =====
router.post('/generate', examRateLimit, async (req, res) => {
    try {
        const { section, difficulty, topic } = req.body;

        if (!section || !EXAM_SECTIONS[section]) {
            return res.status(400).json({ success: false, message: '请选择有效的题型' });
        }

        const sectionInfo = EXAM_SECTIONS[section];
        const diff = difficulty || 'medium';
        const topicStr = topic || '';

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            const localExam = generateLocalExam(section, diff, topicStr);
            return res.json({ success: true, data: { ...localExam, fallback: true } });
        }

        const prompts = buildExamPrompt(section, diff, topicStr);

        let content = '';

        if (process.env.DASHSCOPE_API_KEY) {
            const response = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
                {
                    model: 'qwen-turbo',
                    input: { messages: [{ role: 'user', content: prompts }] },
                    parameters: { result_format: 'message', temperature: 0.7, max_tokens: 3000 }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 90000
                }
            );
            content = response.data.output?.choices?.[0]?.message?.content || '';
        } else {
            const response = await axios.post(
                process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompts }],
                    temperature: 0.7,
                    max_tokens: 3000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 90000
                }
            );
            content = response.data.choices?.[0]?.message?.content || '';
        }

        // 解析AI返回的JSON
        let result;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                const cleaned = jsonMatch[0].replace(/[\x00-\x1f]/g, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                result = JSON.parse(cleaned);
            }
        } else {
            result = generateLocalExam(section, diff, topicStr);
            result.fallback = true;
        }

        result.section = section;
        result.sectionName = sectionInfo.name;
        result.difficulty = diff;

        res.json({ success: true, data: result });

    } catch (err) {
        console.error('生成真题练习失败:', err.message);
        const localExam = generateLocalExam(req.body.section || 'cloze', req.body.difficulty || 'medium', req.body.topic || '');
        res.json({ success: true, data: { ...localExam, fallback: true, error: err.message } });
    }
});

// ===== 评估真题答案 =====
router.post('/evaluate', examRateLimit, async (req, res) => {
    try {
        const { section, questions, userAnswers } = req.body;

        if (!questions || !userAnswers) {
            return res.status(400).json({ success: false, message: '缺少题目或答案数据' });
        }

        // 客观题本地判分
        let correctCount = 0;
        let totalQuestions = 0;
        const results = [];

        questions.forEach((q, i) => {
            const userAns = userAnswers[i] || '';
            const isCorrect = userAns.toString().trim().toLowerCase() === q.correctAnswer.toString().trim().toLowerCase();
            if (isCorrect) correctCount++;
            totalQuestions++;
            results.push({
                index: i,
                question: q.question || q.stem || '',
                userAnswer: userAns,
                correctAnswer: q.correctAnswer,
                isCorrect,
                explanation: q.explanation || ''
            });
        });

        const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

        // 保存练习记录
        try {
            await run(`
                INSERT INTO practice_records (user_id, word_id, user_answer, reference_answer, score, is_correct, mode)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                req.userId,
                0,
                JSON.stringify(userAnswers).substring(0, 500),
                JSON.stringify(questions.map(q => q.correctAnswer)).substring(0, 500),
                score,
                score >= 60 ? 1 : 0,
                `exam_${section}`
            ]);
        } catch (e) {
            console.log('保存真题记录失败:', e.message);
        }

        res.json({
            success: true,
            data: {
                score,
                correctCount,
                totalQuestions,
                results,
                section,
                completedAt: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error('评估真题答案失败:', err.message);
        res.status(500).json({ success: false, message: '评估失败: ' + err.message });
    }
});

// ===== 获取真题练习历史 =====
router.get('/history', async (req, res) => {
    try {
        const records = await all(`
            SELECT * FROM practice_records
            WHERE user_id = ? AND mode LIKE 'exam_%'
            ORDER BY created_at DESC
            LIMIT 20
        `, [req.userId]);

        const history = records.map(r => ({
            id: r.id,
            mode: r.mode,
            score: r.score,
            isCorrect: r.is_correct,
            createdAt: r.created_at
        }));

        res.json({ success: true, data: history });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

// ===== 获取可用题型列表 =====
router.get('/sections', (req, res) => {
    res.json({
        success: true,
        data: Object.entries(EXAM_SECTIONS).map(([key, val]) => ({
            key,
            ...val
        }))
    });
});

// ===== 构建AI生成Prompt =====
function buildExamPrompt(section, difficulty, topic) {
    const diffMap = { easy: '基础难度（略低于考研难度）', medium: '标准考研难度', hard: '考研冲刺难度（偏难）' };
    const diffStr = diffMap[difficulty] || diffMap.medium;

    const topicHint = topic ? `话题方向：${topic}。` : '话题不限，但应符合考研英语常见话题（社会、科技、教育、文化、经济等）。';

    let prompt = `你是考研英语命题专家。请生成一份${diffStr}的考研英语${EXAM_SECTIONS[section].name}题目。${topicHint}\n\n`;

    if (section === 'cloze') {
        prompt += `要求：
1. 提供一篇约250-300词的英语文章，挖空20处
2. 每空4个选项(A/B/C/D)
3. 考查词汇辨析、语法结构、上下文逻辑

JSON格式返回：
{
  "passage": "文章全文，空格处用[1][2]...[20]标记",
  "translation": "文章中文翻译",
  "questions": [
    {"index": 1, "options": {"A":"选项A","B":"选项B","C":"选项C","D":"选项D"}, "correctAnswer": "A", "explanation": "解析"}
  ]
}`;
    } else if (section === 'reading_a') {
        prompt += `要求：
1. 提供1篇约400-500词的英语阅读文章
2. 配5道单选题（每题4个选项）
3. 考查主旨、细节、推理、词义等

JSON格式返回：
{
  "passage": "文章全文",
  "title": "文章标题",
  "translation": "文章中文翻译",
  "questions": [
    {"index": 1, "stem": "题干", "options": {"A":"A","B":"B","C":"C","D":"D"}, "correctAnswer": "A", "explanation": "解析"}
  ]
}`;
    } else if (section === 'reading_b') {
        prompt += `要求：
1. 提供1篇约500词的英语文章，部分段落被挖出
2. 从6-7个备选段落中选择5个填入空白处
3. 考查文章结构、逻辑连贯

JSON格式返回：
{
  "passage": "文章全文，空白处用[1][2][3][4][5]标记",
  "title": "文章标题",
  "translation": "文章中文翻译",
  "options": [{"label":"A","content":"段落内容"}, {"label":"B","content":"段落内容"}, {"label":"C","content":"段落内容"}, {"label":"D","content":"段落内容"}, {"label":"E","content":"段落内容"}, {"label":"F","content":"段落内容(干扰项1)"}, {"label":"G","content":"段落内容(干扰项2)"}],
  "correctOrder": ["A","C","E","B","D"],
  "explanations": "各题解析"
}`;
    } else if (section === 'reading_c') {
        prompt += `要求：
1. 提供1篇约400词的英语文章
2. 划出5个句子要求翻译为中文
3. 考查长难句理解和翻译技巧

JSON格式返回：
{
  "passage": "文章全文，需翻译的句子用①②③④⑤标记",
  "title": "文章标题",
  "translation": "全文参考翻译",
  "sentences": [
    {"index": 1, "original": "需翻译的英文句子", "reference": "参考翻译", "explanation": "翻译要点解析"}
  ]
}`;
    } else if (section === 'writing_a') {
        prompt += `要求：
1. 提供一个应用文写作题目（如信件、通知、便条等）
2. 字数要求约100词
3. 提供写作要点和参考范文

JSON格式返回：
{
  "prompt": "写作题目和要求",
  "scenario": "情景描述",
  "requirements": ["要求1", "要求2", "要求3"],
  "referenceEssay": "参考范文",
  "tips": ["写作技巧1", "写作技巧2"],
  "keyPhrases": ["常用句型1", "常用句型2"]
}`;
    } else if (section === 'writing_b') {
        prompt += `要求：
1. 提供一个图表或图画作文题目
2. 字数要求约150-200词
3. 提供写作框架和参考范文

JSON格式返回：
{
  "prompt": "写作题目",
  "chartDescription": "图表/图画描述",
  "requirements": ["要求1", "要求2", "要求3"],
  "outline": ["第一段：描述图表", "第二段：分析原因", "第三段：总结展望"],
  "referenceEssay": "参考范文",
  "tips": ["写作技巧1", "写作技巧2"],
  "keyPhrases": ["高频句型1", "高频句型2"]
}`;
    }

    prompt += '\n\n注意：JSON格式必须严格正确，不要有多余文本。所有内容用中文和英文混合（题目英文，解析中文）。';
    return prompt;
}

// ===== 本地降级生成真题 =====
function generateLocalExam(section, difficulty, topic) {
    const exams = getLocalExamBank();

    const sectionExams = exams[section] || exams.cloze;
    const diffExams = sectionExams[difficulty] || sectionExams.medium || sectionExams[0];
    const exam = Array.isArray(diffExams) ? diffExams[Math.floor(Math.random() * diffExams.length)] : diffExams;

    return {
        ...exam,
        section,
        sectionName: EXAM_SECTIONS[section]?.name || '真题练习',
        difficulty
    };
}

// ===== 本地题库 =====
function getLocalExamBank() {
    return {
        cloze: {
            easy: {
                passage: "Communication is essential in our daily lives. We communicate [1]___ others through various means: speaking, writing, and body language. Effective communication requires [2]___ skills. First, we need to listen [3]___ to what others are saying. Many people think that communication is only about [4]___, but listening is equally [5]___. When we listen carefully, we can [6]___ the speaker's message accurately. Moreover, good communicators pay [7]___ to non-verbal cues such as facial expressions and gestures. These [8]___ often convey more information than [9]___. In professional settings, clear communication can [10]___ misunderstandings and improve productivity.",
                translation: "沟通在日常生活中至关重要。我们通过各种方式与他人交流...",
                questions: [
                    { index: 1, options: { A: "with", B: "to", C: "for", D: "at" }, correctAnswer: "A", explanation: "communicate with sb 固定搭配" },
                    { index: 2, options: { A: "much", B: "many", C: "few", D: "little" }, correctAnswer: "A", explanation: "skills为不可数概念，用much修饰" },
                    { index: 3, options: { A: "careful", B: "carefully", C: "care", D: "careless" }, correctAnswer: "B", explanation: "副词修饰动词listen" },
                    { index: 4, options: { A: "speak", B: "speaking", C: "spoke", D: "spoken" }, correctAnswer: "B", explanation: "about后接动名词" },
                    { index: 5, options: { A: "important", B: "importance", C: "import", D: "possibly" }, correctAnswer: "A", explanation: "is equally important 同样重要" },
                    { index: 6, options: { A: "understand", B: "understanding", C: "understood", D: "misunderstand" }, correctAnswer: "A", explanation: "情态动词后接动词原形" },
                    { index: 7, options: { A: "money", B: "attention", C: "visit", D: "time" }, correctAnswer: "B", explanation: "pay attention to 固定搭配" },
                    { index: 8, options: { A: "cues", B: "queue", C: "cue", D: "queues" }, correctAnswer: "A", explanation: "these后接复数名词" },
                    { index: 9, options: { A: "word", B: "words", C: "world", D: "works" }, correctAnswer: "B", explanation: "words指言语，复数形式" },
                    { index: 10, options: { A: "cause", B: "create", C: "prevent", D: "increase" }, correctAnswer: "C", explanation: "清晰沟通可以防止误解" }
                ]
            },
            medium: {
                passage: "The concept of sustainable development has gained [1]___ attention in recent years. As the world faces [2]___ challenges such as climate change and resource depletion, it has become [3]___ that our current lifestyle is not [4]___. Sustainable development aims to meet the needs of the present [5]___ compromising the ability of future generations to meet their [6]___ needs. This requires a [7]___ shift in how we produce and [8]___ goods. Many companies have started to [9]___ sustainable practices, such as using renewable energy and reducing [10]___.",
                translation: "可持续发展概念近年来受到广泛关注...",
                questions: [
                    { index: 1, options: { A: "increasing", B: "decreasing", C: "little", D: "no" }, correctAnswer: "A", explanation: "increasing attention 越来越多的关注" },
                    { index: 2, options: { A: "easy", B: "environmental", C: "simple", D: "small" }, correctAnswer: "B", explanation: "环境挑战" },
                    { index: 3, options: { A: "clear", B: "unclear", C: "doubtful", D: "impossible" }, correctAnswer: "A", explanation: "it has become clear 变得清晰" },
                    { index: 4, options: { A: "sustainable", B: "possible", C: "available", D: "affordable" }, correctAnswer: "A", explanation: "不可持续" },
                    { index: 5, options: { A: "with", B: "without", C: "by", D: "through" }, correctAnswer: "B", explanation: "without compromising 不损害" },
                    { index: 6, options: { A: "own", B: "own's", C: "owns", D: "owning" }, correctAnswer: "A", explanation: "their own needs 他们自己的需求" },
                    { index: 7, options: { A: "fundamental", B: "small", C: "minor", D: "slight" }, correctAnswer: "A", explanation: "根本性转变" },
                    { index: 8, options: { A: "consume", B: "sell", C: "buy", D: "waste" }, correctAnswer: "A", explanation: "生产和消费" },
                    { index: 9, options: { A: "adopt", B: "adapt", C: "reject", D: "ignore" }, correctAnswer: "A", explanation: "采纳可持续做法" },
                    { index: 10, options: { A: "waste", B: "profit", C: "speed", D: "quality" }, correctAnswer: "A", explanation: "减少浪费" }
                ]
            }
        },
        reading_a: {
            easy: {
                title: "The Benefits of Reading",
                passage: "Reading is one of the most beneficial activities a person can engage in. Not only does it improve vocabulary and language skills, but it also enhances cognitive abilities. Studies have shown that people who read regularly tend to have better memory and concentration. Furthermore, reading can reduce stress and improve empathy by allowing readers to experience different perspectives. In today's digital age, where information is readily available, the habit of reading books remains irreplaceable for deep learning and personal growth.",
                translation: "阅读是人能参与的最有益的活动之一...",
                questions: [
                    { index: 1, stem: "According to the passage, reading can improve all of the following EXCEPT:", options: { A: "vocabulary", B: "memory", C: "physical strength", D: "concentration" }, correctAnswer: "C", explanation: "文章未提到体能提升" },
                    { index: 2, stem: "What does the word 'empathy' most likely mean in this context?", options: { A: "sympathy", B: "ability to understand others' feelings", C: "pity", D: "knowledge" }, correctAnswer: "B", explanation: "同理心，理解他人感受的能力" },
                    { index: 3, stem: "Why does the author mention the digital age?", options: { A: "To discourage reading", B: "To show books are obsolete", C: "To emphasize the unique value of book reading", D: "To promote digital devices" }, correctAnswer: "C", explanation: "强调深度阅读的不可替代性" },
                    { index: 4, stem: "What is the main idea of the passage?", options: { A: "Reading is beneficial in multiple ways", B: "Digital devices are bad", C: "Memory declines with age", D: "Stress is unavoidable" }, correctAnswer: "A", explanation: "阅读的多重益处" },
                    { index: 5, stem: "The author's attitude toward reading is:", options: { A: "neutral", B: "positive", C: "negative", D: "uncertain" }, correctAnswer: "B", explanation: "积极正面的态度" }
                ]
            },
            medium: {
                title: "The Impact of Social Media on Society",
                passage: "Social media has fundamentally transformed the way people communicate and share information. While it has brought people closer across geographical boundaries, it has also raised concerns about privacy, mental health, and the spread of misinformation. Research indicates that excessive social media use can lead to anxiety and depression, particularly among young people. Moreover, the algorithmic nature of these platforms often creates echo chambers, where users are exposed primarily to viewpoints that align with their existing beliefs. Despite these challenges, social media continues to play a crucial role in social movements, business marketing, and global awareness campaigns. The key lies in finding a balance between leveraging its benefits and mitigating its negative effects.",
                translation: "社交媒体从根本上改变了人们沟通和分享信息的方式...",
                questions: [
                    { index: 1, stem: "According to the passage, social media has caused concerns about:", options: { A: "privacy only", B: "mental health only", C: "privacy, mental health, and misinformation", D: "business marketing" }, correctAnswer: "C", explanation: "文中提到三方面担忧" },
                    { index: 2, stem: "What does 'echo chambers' refer to?", options: { A: "Rooms with echoes", B: "Environments where only similar views are heard", C: "Social media platforms", D: "News channels" }, correctAnswer: "B", explanation: "回音室效应" },
                    { index: 3, stem: "Who is most affected by excessive social media use?", options: { A: "Elderly people", B: "Business owners", C: "Young people", D: "Journalists" }, correctAnswer: "C", explanation: "年轻人最容易受影响" },
                    { index: 4, stem: "What does the author suggest about social media?", options: { A: "It should be banned", B: "It has only negative effects", C: "A balance between benefits and risks is needed", D: "It is perfect as is" }, correctAnswer: "C", explanation: "需要在利弊间找到平衡" },
                    { index: 5, stem: "The word 'mitigating' in the last sentence most likely means:", options: { A: "increasing", B: "reducing", C: "ignoring", D: "causing" }, correctAnswer: "B", explanation: "减轻、缓解" }
                ]
            }
        },
        reading_c: {
            easy: {
                title: "Education and Innovation",
                passage: "①Education has always been the cornerstone of human progress, serving as the bridge between past wisdom and future innovation. ②In an era where technological advancements occur at an unprecedented pace, the role of education has evolved beyond mere knowledge transmission to fostering critical thinking and adaptability. ③Traditional classroom models are being challenged by online platforms that offer personalized learning experiences tailored to individual needs. ④However, the human element of teaching—the ability to inspire, mentor, and guide—remains irreplaceable by any technology. ⑤As we navigate this transformation, it is crucial to ensure that education remains accessible to all, regardless of socioeconomic background.",
                translation: "教育一直是我们进步的基石...",
                sentences: [
                    { index: 1, original: "Education has always been the cornerstone of human progress, serving as the bridge between past wisdom and future innovation.", reference: "教育一直是人类进步的基石，是连接过去智慧与未来创新的桥梁。", explanation: "cornerstone 基石；serving as 分词作状语" },
                    { index: 2, original: "In an era where technological advancements occur at an unprecedented pace, the role of education has evolved beyond mere knowledge transmission to fostering critical thinking and adaptability.", reference: "在技术进步以前所未有的速度发生的时代，教育的角色已经超越了单纯的知识传授，发展到培养批判性思维和适应能力。", explanation: "unprecedented pace 前所未有的速度；beyond...to... 从...发展到..." },
                    { index: 3, original: "However, the human element of teaching—the ability to inspire, mentor, and guide—remains irreplaceable by any technology.", reference: "然而，教学中的人文要素——激励、指导和引导的能力——是任何技术都无法替代的。", explanation: "human element 人文要素；irreplaceable 不可替代的" },
                    { index: 4, original: "As we navigate this transformation, it is crucial to ensure that education remains accessible to all, regardless of socioeconomic background.", reference: "在我们驾驭这一变革的过程中，确保教育对所有人开放，无论其社会经济背景如何，是至关重要的。", explanation: "navigate 驾驭；accessible to all 对所有人开放" }
                ]
            }
        },
        writing_a: {
            easy: {
                prompt: "Suppose you are a student volunteer at a local library. Write a letter to the library manager to suggest organizing a book donation event.",
                scenario: "你是图书馆志愿者，建议举办图书捐赠活动",
                requirements: ["说明活动目的", "提出具体方案", "表达期待"],
                referenceEssay: "Dear Manager,\n\nI am writing to propose organizing a book donation event at our library. The purpose of this event is to collect books for children in rural areas who lack access to reading materials.\n\nI suggest we hold the event on weekends during the upcoming month. We could set up donation boxes at the library entrance and promote the event through social media. Additionally, we could organize a small ceremony to thank donors.\n\nI believe this event will not only help those in need but also enhance our library's community engagement. I look forward to your reply.\n\nYours sincerely,\nLi Ming",
                tips: ["注意书信格式", "语气礼貌正式", "要点清晰"],
                keyPhrases: ["I am writing to propose...", "The purpose of...", "I suggest we..."]
            },
            medium: {
                prompt: "Suppose you are the president of the Student Union. Write a notice to inform students about an upcoming English speech contest.",
                scenario: "你是学生会主席，通知即将举行的英语演讲比赛",
                requirements: ["比赛时间地点", "报名方式", "奖项设置"],
                referenceEssay: "NOTICE\n\nAn English Speech Contest will be held by the Student Union on December 15th, 2024, at 2:00 PM in the Main Auditorium. The theme of the contest is \"Youth and Responsibility in the New Era.\"\n\nAll students are welcome to participate. Please register at the Student Union Office before December 10th. The top three winners will receive certificates and prizes.\n\nWe look forward to your active participation!\n\nStudent Union",
                tips: ["通知格式规范", "信息准确完整", "鼓励性语言"],
                keyPhrases: ["will be held", "All students are welcome to", "Please register"]
            }
        },
        writing_b: {
            medium: {
                prompt: "Write an essay based on the following chart, which shows the changes in the number of people using public transportation in a city from 2018 to 2023.",
                chartDescription: "图表显示某城市2018-2023年公共交通使用人数变化：从2018年的200万增长到2023年的500万，疫情期间有所下降",
                requirements: ["描述图表数据", "分析变化原因", "预测未来趋势"],
                outline: ["第一段：描述图表，点明主要趋势", "第二段：分析增长原因（环保意识、政策推动等）", "第三段：总结展望，提出建议"],
                referenceEssay: "As is vividly depicted in the chart, the number of public transportation users in a certain city experienced a significant increase from 2 million in 2018 to 5 million in 2023, despite a temporary decline during the pandemic period.\n\nSeveral factors contribute to this upward trend. Firstly, growing environmental awareness has encouraged more people to choose eco-friendly travel options. Secondly, the government's substantial investment in public transportation infrastructure has made it more convenient and efficient. Lastly, rising fuel costs have made private car ownership less economical.\n\nLooking ahead, this positive trend is likely to continue as cities further develop their public transportation systems. It is advisable that authorities continue to invest in green transportation to build a more sustainable urban environment.",
                tips: ["图表作文三段论", "数据描述要准确", "分析要有深度"],
                keyPhrases: ["As is vividly depicted", "Several factors contribute to", "Looking ahead"]
            }
        },
        reading_b: {
            medium: {
                title: "The Power of Habit",
                passage: "Habits shape our daily lives more than we realize. [1]___ Research shows that about 40% of our daily actions are driven by habit rather than conscious decision-making.\n\nThe habit loop consists of three components: cue, routine, and reward. [2]___ Understanding this loop is the first step toward changing unwanted behaviors.\n\n[3]___ Small changes in routine can lead to significant improvements over time. For example, replacing just 15 minutes of social media scrolling with reading can result in finishing dozens of books per year.\n\nHowever, breaking bad habits requires more than willpower. [4]___ Environment design plays a crucial role—removing triggers and creating friction for unwanted behaviors.\n\n[5]___ The key is to start small, be consistent, and celebrate small wins along the way.",
                translation: "习惯对我们日常生活的塑造超出了我们的认知...",
                options: [
                    { label: "A", content: "From the moment we wake up to the time we go to sleep, our habits dictate our behavior." },
                    { label: "B", content: "It requires a systematic approach that addresses both the cue and the reward." },
                    { label: "C", content: "Building good habits is a gradual process that requires patience and persistence." },
                    { label: "D", content: "The cue triggers the routine, and the reward reinforces it, creating a cycle." },
                    { label: "E", content: "Moreover, habits can be powerful tools for personal growth when used intentionally." },
                    { label: "F", content: "This is why many people struggle to maintain New Year's resolutions." }
                ],
                correctOrder: ["A", "D", "E", "B", "C"],
                explanations: "[1]A-引出习惯影响日常行为；[2]D-解释习惯回路三要素关系；[3]E-过渡到积极面；[4]B-系统方法打破坏习惯；[5]C-总结建议"
            }
        }
    };
}

module.exports = router;
