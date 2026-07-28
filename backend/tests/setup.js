/**
 * Jest 测试环境初始化
 * 在每个测试文件运行前执行：设置环境变量、初始化测试数据库、填充种子数据
 */
const path = require('path');
const fs = require('fs');

// ========== 1. 设置测试环境变量 ==========
// 必须在加载 server.js / database/db.js 之前设置，因为 dotenv 默认不覆盖已存在的环境变量
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

// 确保 AI API Key 为空，使所有 AI 接口走本地降级方案（不依赖外部服务）
process.env.DEEPSEEK_API_KEY = '';
process.env.DASHSCOPE_API_KEY = '';
process.env.DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// ========== 2. 设置测试数据库路径（每个 worker 独立，避免并发冲突） ==========
const workerId = process.env.JEST_WORKER_ID || '0';
const testDbPath = path.join(__dirname, '..', 'database', `test_${workerId}.db`);
process.env.DB_PATH = testDbPath;

// 如果测试数据库已存在则先删除，保证每次测试都是干净状态
if (fs.existsSync(testDbPath)) {
    try {
        fs.unlinkSync(testDbPath);
    } catch (e) {
        // 忽略删除失败
    }
}

// ========== 3. 加载数据库模块（此时会使用上面设置的 DB_PATH） ==========
const { db, run, get, all } = require('../database/db');
const { initDatabase } = require('../database/init');

// ========== 4. 种子单词数据 ==========
const seedWords = [
    { id: 1, word: 'abandon', phonetic: '/əˈbændən/', meaning: 'v. 放弃，抛弃', first_letter: 'A', freq: 5, example_en: 'He abandoned his career to pursue art.', example_cn: '他放弃了他的事业去追求艺术。' },
    { id: 2, word: 'benefit', phonetic: '/ˈbenɪfɪt/', meaning: 'n. 利益，好处 v. 受益', first_letter: 'B', freq: 4, example_en: 'Regular exercise benefits your health.', example_cn: '经常锻炼有益于健康。' },
    { id: 3, word: 'capable', phonetic: '/ˈkeɪpəbl/', meaning: 'adj. 有能力的，能干的', first_letter: 'C', freq: 3, example_en: 'She is capable of leading the team.', example_cn: '她有能力领导这个团队。' },
    { id: 4, word: 'determine', phonetic: '/dɪˈtɜːmɪn/', meaning: 'v. 决定，决心', first_letter: 'D', freq: 4, example_en: 'He determined to succeed no matter what.', example_cn: '他下定决心无论如何都要成功。' },
    { id: 5, word: 'economy', phonetic: '/ɪˈkɒnəmi/', meaning: 'n. 经济，节约', first_letter: 'E', freq: 5, example_en: 'The economy is recovering slowly.', example_cn: '经济正在缓慢复苏。' },
    { id: 6, word: 'factor', phonetic: '/ˈfæktə/', meaning: 'n. 因素，要素', first_letter: 'F', freq: 3, example_en: 'Weather is a key factor in agriculture.', example_cn: '天气是农业的关键因素。' },
    { id: 7, word: 'generate', phonetic: '/ˈdʒenəreɪt/', meaning: 'v. 产生，生成', first_letter: 'G', freq: 3, example_en: 'Wind turbines generate electricity.', example_cn: '风力涡轮机产生电力。' },
    { id: 8, word: 'handle', phonetic: '/ˈhændl/', meaning: 'v. 处理，操作 n. 把手', first_letter: 'H', freq: 2, example_en: 'She handled the crisis calmly.', example_cn: '她冷静地处理了危机。' },
    { id: 9, word: 'identify', phonetic: '/aɪˈdentɪfaɪ/', meaning: 'v. 识别，确认', first_letter: 'I', freq: 4, example_en: 'Can you identify the suspect?', example_cn: '你能认出嫌疑人吗？' },
    { id: 10, word: 'journal', phonetic: '/ˈdʒɜːnl/', meaning: 'n. 期刊，日记', first_letter: 'J', freq: 2, example_en: 'She published a paper in a journal.', example_cn: '她在一本期刊上发表了论文。' },
    { id: 11, word: 'knowledge', phonetic: '/ˈnɒlɪdʒ/', meaning: 'n. 知识，学识', first_letter: 'K', freq: 3, example_en: 'Knowledge is power.', example_cn: '知识就是力量。' },
    { id: 12, word: 'labor', phonetic: '/ˈleɪbə/', meaning: 'n. 劳动，劳工', first_letter: 'L', freq: 2, example_en: 'Physical labor can be exhausting.', example_cn: '体力劳动可能令人筋疲力尽。' },
    { id: 13, word: 'method', phonetic: '/ˈmeθəd/', meaning: 'n. 方法，方式', first_letter: 'M', freq: 3, example_en: 'This teaching method is effective.', example_cn: '这种教学方法很有效。' },
    { id: 14, word: 'necessary', phonetic: '/ˈnesəsəri/', meaning: 'adj. 必要的，必需的', first_letter: 'N', freq: 3, example_en: 'Sleep is necessary for good health.', example_cn: '睡眠对健康是必要的。' },
    { id: 15, word: 'obtain', phonetic: '/əbˈteɪn/', meaning: 'v. 获得，得到', first_letter: 'O', freq: 3, example_en: 'He obtained a degree in physics.', example_cn: '他获得了物理学学位。' }
];

/**
 * 填充种子单词数据（仅在 words 表为空时插入）
 */
async function seedWordsIfEmpty() {
    const countResult = await get('SELECT COUNT(*) as count FROM words');
    if (countResult && countResult.count > 0) {
        return;
    }

    for (const w of seedWords) {
        await run(`
            INSERT OR REPLACE INTO words (id, word, phonetic, meaning, first_letter, freq, example_en, example_cn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [w.id, w.word, w.phonetic, w.meaning, w.first_letter, w.freq, w.example_en, w.example_cn]);
    }
}

// ========== 5. 在所有测试开始前初始化数据库 ==========
beforeAll(async () => {
    // 创建所有表结构
    await initDatabase();
    // 填充种子数据
    await seedWordsIfEmpty();
}, 30000);

// ========== 6. 所有测试结束后清理 ==========
afterAll(async () => {
    // 等待数据库写入完成后再关闭连接，避免 jest 挂起
    await new Promise((resolve) => {
        db.close((err) => {
            if (err) {
                console.error('关闭测试数据库失败:', err.message);
            }
            resolve();
        });
    });
}, 15000);
