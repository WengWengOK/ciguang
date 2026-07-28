/**
 * AI 评测框架服务
 * 解决 yu-ai-agent 缺乏生产级评测体系的短板
 *
 * 核心能力：
 * 1. 响应质量评分：相关性 / 完整性 / 准确性 / 格式规范性（0-10 分）
 * 2. 工具选择准确率：Precision / Recall / F1（基于 Agent 实际调用 vs 应调用工具集）
 * 3. 回归测试：对比基线结果，检测 AI 响应质量退化
 * 4. SQLite 持久化：评测结果可追溯，支持历史趋势分析
 *
 * 评测方式：
 * - 有 AI API Key 时：用 LLM 做裁判（LLM-as-a-Judge）自动评分
 * - 无 API Key 时：降级到规则评分（基于关键词匹配、长度、格式检测）
 */

const { run, get, all } = require('../database/db');
const { chat, getActiveProvider, AIProvider, extractJSON } = require('./AIService');
const { generateTraceId } = require('../middleware/ai-observability');

// ===== SQLite 初始化 =====
let dbInitialized = false;

async function ensureDBInit() {
    if (dbInitialized) return;
    try {
        // 评测结果表
        await run(`
            CREATE TABLE IF NOT EXISTS ai_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                eval_type TEXT NOT NULL,
                user_query TEXT NOT NULL,
                ai_response TEXT,
                reference_answer TEXT,
                scores TEXT NOT NULL DEFAULT '{}',
                overall_score INTEGER NOT NULL,
                tool_calls TEXT,
                tool_metrics TEXT,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_eval_trace ON ai_evaluations(trace_id)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_eval_type ON ai_evaluations(eval_type)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_eval_created ON ai_evaluations(created_at)`);

        // 回归测试基线表
        await run(`
            CREATE TABLE IF NOT EXISTS ai_eval_baselines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_name TEXT NOT NULL UNIQUE,
                user_query TEXT NOT NULL,
                expected_tools TEXT,
                reference_answer TEXT,
                min_overall_score INTEGER DEFAULT 7,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        dbInitialized = true;
        console.log('[EvaluationService] SQLite 评测表初始化完成');
    } catch (err) {
        console.error('[EvaluationService] SQLite 初始化失败:', err.message);
        dbInitialized = true;
    }
}

ensureDBInit();

/**
 * 评估 AI 回答质量（LLM-as-a-Judge）
 *
 * 评分维度：
 * - 相关性（relevance）：回答是否切题
 * - 完整性（completeness）：是否覆盖问题所有方面
 * - 准确性（accuracy）：信息是否正确（有参考答案时评估）
 * - 格式规范性（format）：结构是否清晰、格式是否规范
 *
 * @param {string} userQuery - 用户查询
 * @param {string} aiResponse - AI 回答
 * @param {string} [referenceAnswer] - 参考回答（可选，提高准确性评分精度）
 * @returns {Object} 评估结果 { overallScore, breakdown, timestamp }
 */
async function evaluateResponseQuality(userQuery, aiResponse, referenceAnswer) {
    const traceId = generateTraceId();

    // 无 AI API Key 时降级到规则评分
    if (getActiveProvider() === AIProvider.LOCAL) {
        const result = evaluateByRules(userQuery, aiResponse, referenceAnswer);
        await persistEvaluation({
            traceId, evalType: 'response_quality',
            userQuery, aiResponse, referenceAnswer,
            scores: result.breakdown,
            overallScore: result.overallScore
        });
        return result;
    }

    // LLM-as-a-Judge 评分 prompt
    const evalPrompt = `你是一个专业的 AI 回答质量评估专家。请对以下 AI 回答进行评分。

## 用户问题
${userQuery}

## AI 回答
${aiResponse}

${referenceAnswer ? `## 参考答案\n${referenceAnswer}` : ''}

## 评分标准（每项 0-10 分）
1. **relevance**（相关性）：回答是否切题，是否直接回答了用户问题
2. **completeness**（完整性）：是否覆盖了问题的所有方面，有无遗漏
3. **accuracy**（准确性）：${referenceAnswer ? '与参考答案对比，信息是否准确' : '基于常识判断信息是否准确'}
4. **format**（格式规范性）：结构是否清晰，是否有适当的小标题、列表等

请以 JSON 格式返回评分结果，不要包含其他内容：
{"relevance": <0-10>, "completeness": <0-10>, "accuracy": <0-10>, "format": <0-10>}`;

    try {
        const result = await chat(
            [
                { role: 'system', content: '你是 AI 质量评估专家，只输出 JSON 格式的评分结果。' },
                { role: 'user', content: evalPrompt }
            ],
            {
                model: 'qwen-turbo',
                temperature: 0.1, // 低温度保证评分一致性
                maxTokens: 200,
                endpoint: '/api/eval/response-quality',
                userId: null
            }
        );

        const scores = extractJSON(result.content) || evaluateByRules(userQuery, aiResponse, referenceAnswer).breakdown;

        const overallScore = Math.round(
            (scores.relevance + scores.completeness + scores.accuracy + scores.format) / 4
        );

        const evaluationResult = {
            overallScore,
            breakdown: {
                relevance: scores.relevance,
                completeness: scores.completeness,
                accuracy: scores.accuracy,
                format: scores.format
            },
            method: 'llm_judge',
            timestamp: new Date().toISOString()
        };

        await persistEvaluation({
            traceId, evalType: 'response_quality',
            userQuery, aiResponse, referenceAnswer,
            scores: evaluationResult.breakdown,
            overallScore: evaluationResult.overallScore
        });

        return evaluationResult;
    } catch (err) {
        console.error('[EvaluationService] LLM 评分失败，降级到规则评分:', err.message);
        const result = evaluateByRules(userQuery, aiResponse, referenceAnswer);
        await persistEvaluation({
            traceId, evalType: 'response_quality',
            userQuery, aiResponse, referenceAnswer,
            scores: result.breakdown,
            overallScore: result.overallScore,
            notes: `LLM 评分失败，降级规则评分: ${err.message}`
        });
        return result;
    }
}

/**
 * 规则评分（无 AI API Key 时的降级方案）
 * 基于关键词匹配、回答长度、格式检测
 */
function evaluateByRules(userQuery, aiResponse, referenceAnswer) {
    const query = userQuery.toLowerCase();
    const response = aiResponse || '';

    // 1. 相关性评分：检查回答中是否包含问题关键词
    const queryWords = query.split(/\s+/).filter(w => w.length > 2);
    const matchedWords = queryWords.filter(w => response.toLowerCase().includes(w));
    const relevance = Math.min(10, Math.round((matchedWords.length / Math.max(queryWords.length, 1)) * 10));

    // 2. 完整性评分：基于回答长度和结构
    let completeness = 5;
    if (response.length > 100) completeness += 2;
    if (response.length > 300) completeness += 1;
    if (response.includes('1.') || response.includes('- ') || response.includes('•')) completeness += 2;
    completeness = Math.min(10, completeness);

    // 3. 准确性评分
    let accuracy = 7;
    if (referenceAnswer) {
        const refWords = referenceAnswer.toLowerCase().split(/\s+/);
        const respWords = response.toLowerCase().split(/\s+/);
        const overlap = refWords.filter(w => respWords.includes(w)).length;
        accuracy = Math.min(10, Math.round((overlap / Math.max(refWords.length, 1)) * 10));
    }

    // 4. 格式评分
    let format = 5;
    if (/\n/.test(response)) format += 2; // 有换行
    if (/^\d+\./m.test(response)) format += 1; // 有编号列表
    if (/[-•]/.test(response)) format += 1; // 有列表符号
    if (response.length > 50 && response.length < 2000) format += 1; // 长度适中
    format = Math.min(10, format);

    const overallScore = Math.round((relevance + completeness + accuracy + format) / 4);

    return {
        overallScore,
        breakdown: { relevance, completeness, accuracy, format },
        method: 'rule_based',
        timestamp: new Date().toISOString()
    };
}

/**
 * 评估工具选择准确性
 *
 * 对比 Agent 实际调用的工具集与应有调用的工具集，
 * 计算 Precision / Recall / F1
 *
 * @param {string} userQuery - 用户查询
 * @param {Array} actualToolCalls - Agent 实际调用的工具 [{ function: { name, arguments } }]
 * @param {Array} expectedTools - 预期应调用的工具名列表 ['search_words', 'get_user_profile']
 * @returns {Object} { precision, recall, f1Score, actualTools, expectedTools }
 */
async function evaluateToolSelection(userQuery, actualToolCalls, expectedTools) {
    const traceId = generateTraceId();

    // 提取实际调用的工具名
    const actualTools = (actualToolCalls || [])
        .map(tc => tc.function?.name || tc.name || tc)
        .filter(name => name && name !== 'terminate'); // 排除终止工具

    // 如果未提供预期工具，用 LLM 推理应有工具
    let recommendedTools = expectedTools || [];
    if (recommendedTools.length === 0 && getActiveProvider() !== AIProvider.LOCAL) {
        recommendedTools = await inferRecommendedTools(userQuery);
    }

    // 计算 Precision / Recall / F1
    const actualSet = new Set(actualTools);
    const expectedSet = new Set(recommendedTools);

    // TP: 实际调用且应该调用的工具
    const truePositives = [...actualSet].filter(t => expectedSet.has(t));
    // FP: 实际调用但不应该调用的工具
    const falsePositives = [...actualSet].filter(t => !expectedSet.has(t));
    // FN: 应该调用但未调用的工具
    const falseNegatives = [...expectedSet].filter(t => !actualSet.has(t));

    const precision = actualSet.size > 0
        ? Math.round((truePositives.length / actualSet.size) * 100) / 100
        : 0;
    const recall = expectedSet.size > 0
        ? Math.round((truePositives.length / expectedSet.size) * 100) / 100
        : 0;
    const f1Score = (precision > 0 || recall > 0)
        ? Math.round((2 * (precision * recall) / (precision + recall)) * 100) / 100
        : 0;

    const result = {
        precision,
        recall,
        f1Score,
        actualTools,
        recommendedTools,
        analysis: {
            truePositives,
            falsePositives,
            falseNegatives
        },
        timestamp: new Date().toISOString()
    };

    // 持久化
    await persistEvaluation({
        traceId, evalType: 'tool_selection',
        userQuery,
        aiResponse: null,
        referenceAnswer: null,
        scores: { precision, recall, f1Score },
        overallScore: Math.round(f1Score * 10),
        toolCalls: JSON.stringify(actualToolCalls),
        toolMetrics: JSON.stringify(result.analysis)
    });

    return result;
}

/**
 * 用 LLM 推理用户查询应该调用哪些工具
 */
async function inferRecommendedTools(userQuery) {
    try {
        const toolList = [
            'get_user_profile', 'search_words', 'get_review_queue',
            'search_knowledge', 'get_error_stats', 'generate_exercise'
        ];

        const result = await chat(
            [
                { role: 'system', content: '你是工具选择评估专家，只输出 JSON。' },
                { role: 'user', content: `用户提问："${userQuery}"

可用工具列表：
- get_user_profile: 获取用户能力画像
- search_words: 搜索单词库
- get_review_queue: 获取复习队列
- search_knowledge: RAG 语义检索英语知识
- get_error_stats: 获取错题统计
- generate_exercise: 生成练习题

请判断回答该问题应该调用哪些工具（0-3个），以 JSON 数组返回：
{"tools": ["tool_name1", "tool_name2"]}` }
            ],
            {
                model: 'qwen-turbo',
                temperature: 0.1,
                maxTokens: 100,
                endpoint: '/api/eval/tool-inference'
            }
        );

        const parsed = extractJSON(result.content);
        return parsed?.tools || [];
    } catch (err) {
        console.error('[EvaluationService] 工具推理失败:', err.message);
        return [];
    }
}

/**
 * 运行回归测试套件
 * 对预定义的测试用例执行 AI 调用，与基线对比
 *
 * @param {Function} [aiCallFn] - 自定义 AI 调用函数 (query) => response
 * @returns {Object} { total, passed, failed, results }
 */
async function runRegressionTests(aiCallFn) {
    await ensureDBInit();

    // 从基线表加载测试用例
    const baselines = await all('SELECT * FROM ai_eval_baselines ORDER BY id');

    // 如果没有基线，使用默认测试集
    const testCases = baselines.length > 0 ? baselines : getDefaultTestCases();

    const results = [];
    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        const { test_name, user_query, expected_tools, reference_answer, min_overall_score } = testCase;

        console.log(`[EvaluationService] 执行回归测试: ${test_name}`);

        try {
            let aiResponse;
            if (aiCallFn) {
                aiResponse = await aiCallFn(user_query);
            } else if (getActiveProvider() !== AIProvider.LOCAL) {
                const result = await chat(
                    [{ role: 'user', content: user_query }],
                    { model: 'qwen-turbo', temperature: 0.7, endpoint: '/api/eval/regression' }
                );
                aiResponse = result.content || '';
            } else {
                aiResponse = '[无 API Key，跳过 LLM 调用]';
            }

            // 评估质量
            const quality = await evaluateResponseQuality(
                user_query,
                aiResponse,
                reference_answer
            );

            const threshold = min_overall_score || 7;
            const isPassed = quality.overallScore >= threshold;

            results.push({
                testName: test_name,
                query: user_query,
                response: aiResponse,
                quality,
                threshold,
                passed: isPassed
            });

            if (isPassed) passed++;
            else failed++;
        } catch (err) {
            console.error(`[EvaluationService] 测试 ${test_name} 失败:`, err.message);
            results.push({
                testName: test_name,
                query: user_query,
                error: err.message,
                passed: false
            });
            failed++;
        }
    }

    return {
        total: testCases.length,
        passed,
        failed,
        passRate: testCases.length > 0 ? Math.round((passed / testCases.length) * 100) + '%' : '0%',
        results
    };
}

/**
 * 默认回归测试用例
 */
function getDefaultTestCases() {
    return [
        {
            test_name: 'vocab_query',
            user_query: 'abandon 是什么意思？怎么记？',
            expected_tools: '["search_words"]',
            reference_answer: 'abandon 意为放弃、抛弃。建议使用词根词缀法记忆。',
            min_overall_score: 6
        },
        {
            test_name: 'study_plan',
            user_query: '我的阅读理解比较弱，应该怎么提高？',
            expected_tools: '["get_user_profile", "generate_exercise"]',
            reference_answer: '建议每天精读1篇外刊文章，做阅读练习题巩固。',
            min_overall_score: 6
        },
        {
            test_name: 'grammar_explain',
            user_query: '虚拟语气是什么？能举个例子吗？',
            expected_tools: '["search_knowledge"]',
            reference_answer: '虚拟语气表示假设或非真实情况，如 If I were you, I would study harder.',
            min_overall_score: 6
        }
    ];
}

/**
 * 保存评测结果到 SQLite
 */
async function persistEvaluation(data) {
    await ensureDBInit();
    try {
        await run(`
            INSERT INTO ai_evaluations (
                trace_id, eval_type, user_query, ai_response, reference_answer,
                scores, overall_score, tool_calls, tool_metrics, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            data.traceId,
            data.evalType,
            data.userQuery,
            data.aiResponse || null,
            data.referenceAnswer || null,
            JSON.stringify(data.scores),
            data.overallScore,
            data.toolCalls || null,
            data.toolMetrics || null,
            data.notes || null
        ]);
    } catch (err) {
        console.error('[EvaluationService] 保存评测结果失败:', err.message);
    }
}

/**
 * 查询历史评测结果
 * @param {Object} options - { evalType, limit, startDate, endDate }
 */
async function getEvaluationHistory(options = {}) {
    await ensureDBInit();
    const { evalType = null, limit = 50, startDate = null, endDate = null } = options;

    const conditions = [];
    const params = [];

    if (evalType) {
        conditions.push('eval_type = ?');
        params.push(evalType);
    }
    if (startDate) {
        conditions.push('created_at >= ?');
        params.push(startDate);
    }
    if (endDate) {
        conditions.push('created_at <= ?');
        params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return await all(
        `SELECT * FROM ai_evaluations ${whereClause} ORDER BY created_at DESC LIMIT ?`,
        [...params, limit]
    );
}

/**
 * 获取评测统计摘要
 */
async function getEvaluationSummary() {
    await ensureDBInit();

    try {
        const stats = await get(`
            SELECT
                eval_type,
                COUNT(*) as total,
                AVG(overall_score) as avg_score,
                MIN(overall_score) as min_score,
                MAX(overall_score) as max_score
            FROM ai_evaluations
            GROUP BY eval_type
        `);

        const recentTrend = await all(`
            SELECT
                DATE(created_at) as date,
                eval_type,
                AVG(overall_score) as avg_score,
                COUNT(*) as count
            FROM ai_evaluations
            GROUP BY DATE(created_at), eval_type
            ORDER BY date DESC
            LIMIT 30
        `);

        return { byType: stats, trend: recentTrend };
    } catch (err) {
        console.error('[EvaluationService] 查询统计失败:', err.message);
        return { byType: [], trend: [] };
    }
}

module.exports = {
    evaluateResponseQuality,
    evaluateToolSelection,
    runRegressionTests,
    getEvaluationHistory,
    getEvaluationSummary,
    evaluateByRules
};
