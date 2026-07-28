const { db, run } = require('./db');

async function initDatabase() {
    console.log('开始初始化数据库...');

    // 用户表
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nickname TEXT,
            avatar TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 单词表（从words_data.js导入）
    await run(`
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY,
            word TEXT NOT NULL,
            phonetic TEXT,
            meaning TEXT,
            first_letter TEXT,
            freq INTEGER DEFAULT 3,
            example_en TEXT,
            example_cn TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 用户单词学习记录表
    await run(`
        CREATE TABLE IF NOT EXISTS user_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            correct_count INTEGER DEFAULT 0,
            wrong_count INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            last_practiced DATETIME,
            UNIQUE(user_id, word_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (word_id) REFERENCES words(id)
        )
    `);

    // 练习记录表（例句练习）
    await run(`
        CREATE TABLE IF NOT EXISTS practice_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER,
            user_answer TEXT,
            reference_answer TEXT,
            score INTEGER,
            is_correct INTEGER,
            mode TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 阅读练习记录表
    await run(`
        CREATE TABLE IF NOT EXISTS reading_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            passage_title TEXT,
            passage_content TEXT,
            questions TEXT,
            answers TEXT,
            user_answers TEXT,
            score INTEGER,
            total_questions INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 翻译练习记录表
    await run(`
        CREATE TABLE IF NOT EXISTS translation_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            source_text TEXT,
            user_translation TEXT,
            reference_translation TEXT,
            ai_feedback TEXT,
            score INTEGER,
            theme TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 选词填空记录表
    await run(`
        CREATE TABLE IF NOT EXISTS cloze_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            passage_title TEXT,
            passage_content TEXT,
            blanks TEXT,
            user_answers TEXT,
            correct_answers TEXT,
            score INTEGER,
            total_blanks INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 单词记忆记录表
    await run(`
        CREATE TABLE IF NOT EXISTS memory_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER,
            word TEXT,
            is_remembered INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 保存的练习表
    await run(`
        CREATE TABLE IF NOT EXISTS saved_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT,
            content TEXT,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 学习活动日志表
    await run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            module TEXT,
            detail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 每日学习统计表
    await run(`
        CREATE TABLE IF NOT EXISTS daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            practice_count INTEGER DEFAULT 0,
            reading_count INTEGER DEFAULT 0,
            translation_count INTEGER DEFAULT 0,
            cloze_count INTEGER DEFAULT 0,
            memory_count INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            total_count INTEGER DEFAULT 0,
            UNIQUE(user_id, date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 阅读文章模板表
    await run(`
        CREATE TABLE IF NOT EXISTS passage_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            translation TEXT,
            difficulty INTEGER DEFAULT 3,
            topic TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 翻译语料表
    await run(`
        CREATE TABLE IF NOT EXISTS translation_sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            en TEXT NOT NULL,
            cn TEXT NOT NULL,
            theme TEXT,
            difficulty INTEGER DEFAULT 3,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 用户通用数据表（云端同步用）
    await run(`
        CREATE TABLE IF NOT EXISTS user_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            data_key TEXT NOT NULL,
            data_value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, data_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户能力画像表（5维度评分）
    await run(`
        CREATE TABLE IF NOT EXISTS user_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            vocabulary_score INTEGER DEFAULT 50,
            grammar_score INTEGER DEFAULT 50,
            reading_score INTEGER DEFAULT 50,
            translation_score INTEGER DEFAULT 50,
            writing_score INTEGER DEFAULT 50,
            total_answers INTEGER DEFAULT 0,
            total_correct INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户能力维度明细表（记录每个知识点的掌握情况）
    await run(`
        CREATE TABLE IF NOT EXISTS user_skill_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            dimension TEXT NOT NULL,
            skill_point TEXT NOT NULL,
            total_attempts INTEGER DEFAULT 0,
            correct_attempts INTEGER DEFAULT 0,
            consecutive_correct INTEGER DEFAULT 0,
            mastery_level INTEGER DEFAULT 0,
            last_practiced DATETIME,
            UNIQUE(user_id, dimension, skill_point),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 艾宾浩斯遗忘曲线复习调度表
    await run(`
        CREATE TABLE IF NOT EXISTS review_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            item_id INTEGER,
            word TEXT,
            meaning TEXT,
            question TEXT,
            correct_answer TEXT,
            user_answer TEXT,
            review_count INTEGER DEFAULT 0,
            next_review_time DATETIME NOT NULL,
            last_reviewed DATETIME,
            last_result INTEGER,
            is_archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    console.log('数据库表创建完成！');
    console.log('请运行 npm run import-words 导入单词数据');
}

if (require.main === module) {
    initDatabase().catch(console.error);
}

module.exports = { initDatabase };
