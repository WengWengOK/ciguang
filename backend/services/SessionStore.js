/**
 * 会话存储服务
 * 解决 yu-ai-agent 的 FileBasedChatMemory 短板：
 * - FileBasedChatMemory 用文件存储记忆，无并发控制
 *
 * 本实现：
 * 1. SQLite 持久化（重启不丢失）
 * 2. 内存锁 + async 队列保证并发安全（同一 sessionId 不会串话）
 * 3. TTL 自动清理（防止内存泄漏）
 * 4. 消息数量上限（防止无限增长）
 */

const { run, get, all } = require('../database/db');

// ===== 初始化会话表 =====
let initialized = false;
async function ensureInit() {
    if (initialized) return;
    try {
        await run(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                session_type TEXT NOT NULL DEFAULT 'tutor',
                messages TEXT NOT NULL DEFAULT '[]',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME
            )
        `);
        await run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON chat_sessions(expires_at)`);
        initialized = true;
    } catch (err) {
        console.error('SessionStore 初始化失败:', err.message);
        initialized = true; // 防止反复尝试
    }
}

// ===== 并发锁：每个 sessionId 一把锁 =====
const locks = new Map();

/**
 * 获取 sessionId 对应的锁
 * 返回一个 release 函数，调用后释放锁
 */
async function acquireLock(sessionId) {
    // 如果已有锁在等待，排队
    while (locks.has(sessionId)) {
        await locks.get(sessionId);
    }

    // 创建新的锁 promise
    let release;
    const lockPromise = new Promise(resolve => {
        release = resolve;
    });
    locks.set(sessionId, lockPromise);

    // 返回释放函数
    return () => {
        locks.delete(sessionId);
        release();
    };
}

// ===== 配置 =====
const MAX_MESSAGES = 20;        // 每个会话最多保留消息数
const SESSION_TTL_HOURS = 24;   // 会话过期时间（小时）
const MAX_SESSIONS_PER_USER = 10; // 每个用户最多会话数

/**
 * 获取会话消息（并发安全）
 * @param {string} sessionId - 会话 ID
 * @returns {Array} 消息数组
 */
async function getMessages(sessionId) {
    await ensureInit();

    const release = await acquireLock(sessionId);
    try {
        const row = await get(
            'SELECT messages FROM chat_sessions WHERE id = ?',
            [sessionId]
        );

        if (!row) return [];

        try {
            return JSON.parse(row.messages);
        } catch (e) {
            console.error('会话消息解析失败:', e.message);
            return [];
        }
    } finally {
        release();
    }
}

/**
 * 追加消息到会话（并发安全，原子操作）
 * @param {string} sessionId - 会话 ID
 * @param {number} userId - 用户 ID
 * @param {string} sessionType - 会话类型：tutor / error-agent / study-agent
 * @param {Object|Array} messages - 单条消息对象或消息数组
 * @returns {Array} 追加后的完整消息列表
 */
async function appendMessages(sessionId, userId, sessionType, messages) {
    await ensureInit();

    const release = await acquireLock(sessionId);
    try {
        // 读取现有消息
        const row = await get(
            'SELECT messages FROM chat_sessions WHERE id = ?',
            [sessionId]
        );

        let currentMessages = [];
        if (row) {
            try {
                currentMessages = JSON.parse(row.messages);
            } catch (e) {
                currentMessages = [];
            }
        }

        // 追加新消息
        const newMessages = Array.isArray(messages) ? messages : [messages];
        currentMessages.push(...newMessages);

        // 截断到最大长度
        if (currentMessages.length > MAX_MESSAGES * 2) {
            currentMessages = currentMessages.slice(-MAX_MESSAGES * 2);
        }

        // 计算过期时间
        const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

        // 写入数据库（upsert）
        await run(`
            INSERT INTO chat_sessions (id, user_id, session_type, messages, updated_at, expires_at)
            VALUES (?, ?, ?, ?, datetime('now'), ?)
            ON CONFLICT(id) DO UPDATE SET
                messages = excluded.messages,
                updated_at = datetime('now'),
                expires_at = excluded.expires_at
        `, [sessionId, userId, sessionType, JSON.stringify(currentMessages), expiresAt]);

        return currentMessages;
    } finally {
        release();
    }
}

/**
 * 清除会话
 */
async function clearSession(sessionId) {
    await ensureInit();

    const release = await acquireLock(sessionId);
    try {
        await run('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
    } finally {
        release();
    }
}

/**
 * 清理过期会话（定时调用）
 */
async function cleanupExpiredSessions() {
    await ensureInit();

    try {
        const result = await run(
            `DELETE FROM chat_sessions WHERE expires_at < datetime('now')`
        );

        // 清理超出上限的旧会话
        const users = await all('SELECT DISTINCT user_id FROM chat_sessions');
        for (const { user_id } of users) {
            const sessions = await all(
                `SELECT id FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC`,
                [user_id]
            );

            if (sessions.length > MAX_SESSIONS_PER_USER) {
                const toDelete = sessions.slice(MAX_SESSIONS_PER_USER);
                for (const { id } of toDelete) {
                    await run('DELETE FROM chat_sessions WHERE id = ?', [id]);
                }
            }
        }

        if (result.changes > 0) {
            console.log(`[SessionStore] 清理了 ${result.changes} 个过期会话`);
        }
    } catch (err) {
        console.error('[SessionStore] 清理过期会话失败:', err.message);
    }
}

// 定时清理（每小时执行一次）
setInterval(() => {
    cleanupExpiredSessions().catch(() => {});
}, 3600 * 1000);

// 启动时清理一次
setTimeout(() => {
    cleanupExpiredSessions().catch(() => {});
}, 5000);

module.exports = {
    getMessages,
    appendMessages,
    clearSession,
    cleanupExpiredSessions,
    MAX_MESSAGES,
    SESSION_TTL_HOURS
};
