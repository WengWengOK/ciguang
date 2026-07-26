const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../database/db');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// 注册
router.post('/register', async (req, res) => {
    try {
        const { username, password, nickname } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: '密码长度至少6位' });
        }
        
        // 检查用户名是否已存在
        const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(409).json({ success: false, message: '用户名已存在' });
        }
        
        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 创建用户
        const result = await run(
            'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
            [username, hashedPassword, nickname || username]
        );
        
        const user = await get('SELECT id, username, nickname FROM users WHERE id = ?', [result.id]);
        const token = generateToken(user);
        
        res.json({
            success: true,
            message: '注册成功',
            data: {
                user: { id: user.id, username: user.username, nickname: user.nickname },
                token
            }
        });
    } catch (err) {
        console.error('注册失败:', err);
        res.status(500).json({ success: false, message: '注册失败: ' + err.message });
    }
});

// 登录
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        }
        
        const user = await get('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }
        
        const token = generateToken(user);
        
        res.json({
            success: true,
            message: '登录成功',
            data: {
                user: { id: user.id, username: user.username, nickname: user.nickname },
                token
            }
        });
    } catch (err) {
        console.error('登录失败:', err);
        res.status(500).json({ success: false, message: '登录失败: ' + err.message });
    }
});

// 获取当前用户信息
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: '未登录' });
        }
        
        const token = authHeader.substring(7);
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'word-collection-default-secret');
        
        const user = await get('SELECT id, username, nickname, avatar, created_at FROM users WHERE id = ?', [decoded.userId]);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        res.json({ success: true, data: user });
    } catch (err) {
        res.status(401).json({ success: false, message: 'token无效' });
    }
});

module.exports = router;
