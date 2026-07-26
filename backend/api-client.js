/**
 * 词光 - 前端API客户端
 * 封装所有后端API调用，提供统一的错误处理和认证管理
 * 使用方法：在app.js中引入此文件，替换原有的localStorage操作
 */

const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : '/api';

class ApiClient {
    constructor() {
        this.baseUrl = API_BASE_URL;
        this.token = localStorage.getItem('auth_token');
    }

    // 设置token
    setToken(token) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    // 清除token
    clearToken() {
        this.token = null;
        localStorage.removeItem('auth_token');
    }

    // 检查是否已登录
    isLoggedIn() {
        return !!this.token;
    }

    // 通用请求方法
    async request(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${this.baseUrl}${url}`, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }

            return data;
        } catch (err) {
            console.error('API请求失败:', err);
            throw err;
        }
    }

    // GET请求
    get(url) {
        return this.request(url, { method: 'GET' });
    }

    // POST请求
    post(url, body) {
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    // DELETE请求
    delete(url) {
        return this.request(url, { method: 'DELETE' });
    }

    // ========== 认证接口 ==========
    async register(username, password, nickname) {
        const data = await this.post('/auth/register', { username, password, nickname });
        if (data.success && data.data.token) {
            this.setToken(data.data.token);
        }
        return data;
    }

    async login(username, password) {
        const data = await this.post('/auth/login', { username, password });
        if (data.success && data.data.token) {
            this.setToken(data.data.token);
        }
        return data;
    }

    async getCurrentUser() {
        return this.get('/auth/me');
    }

    logout() {
        this.clearToken();
    }

    // ========== 单词接口 ==========
    async getWords(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.get(`/words?${query}`);
    }

    async getWordById(id) {
        return this.get(`/words/${id}`);
    }

    async getRandomWords(count = 1, freqWeight = true) {
        return this.get(`/words/random/weighted?count=${count}&freq_weight=${freqWeight}`);
    }

    async getWordStats() {
        return this.get('/words/stats/by-letter');
    }

    async toggleFavorite(wordId) {
        return this.post(`/words/${wordId}/favorite`);
    }

    async getFavorites() {
        return this.get('/words/user/favorites');
    }

    async getUserProgress() {
        return this.get('/words/user/progress');
    }

    async updateWordProgress(wordId, isCorrect, isFavorite) {
        return this.post('/words/user/progress', { word_id: wordId, is_correct: isCorrect, is_favorite: isFavorite });
    }

    // ========== 学习记录接口 ==========
    async savePracticeRecord(record) {
        return this.post('/records/practice', record);
    }

    async getPracticeRecords() {
        return this.get('/records/practice');
    }

    async saveReadingRecord(record) {
        return this.post('/records/reading', record);
    }

    async getReadingRecords() {
        return this.get('/records/reading');
    }

    async saveTranslationRecord(record) {
        return this.post('/records/translation', record);
    }

    async getTranslationRecords() {
        return this.get('/records/translation');
    }

    async saveClozeRecord(record) {
        return this.post('/records/cloze', record);
    }

    async getClozeRecords() {
        return this.get('/records/cloze');
    }

    async saveMemoryRecord(record) {
        return this.post('/records/memory', record);
    }

    async getMemoryRecords() {
        return this.get('/records/memory');
    }

    async saveExercise(type, title, content, data) {
        return this.post('/records/saved', { type, title, content, data });
    }

    async getSavedExercises(type) {
        const query = type ? `?type=${type}` : '';
        return this.get(`/records/saved${query}`);
    }

    async deleteSavedExercise(id) {
        return this.delete(`/records/saved/${id}`);
    }

    async getStatsOverview() {
        return this.get('/records/stats/overview');
    }

    // ========== AI接口（统一通过后端代理，API Key不在前端暴露） ==========

    // 统一文本生成代理
    async callAI(prompt, systemPrompt, options = {}) {
        return this.post('/ai/chat', {
            prompt,
            system_prompt: systemPrompt || '',
            temperature: options.temperature,
            max_tokens: options.max_tokens
        });
    }

    // 统一多模态代理（图片+文本）
    async callAIMultimodal(prompt, images, systemPrompt) {
        return this.post('/ai/multimodal', {
            prompt,
            images,
            system_prompt: systemPrompt || ''
        });
    }

    // 原有AI接口（保留兼容）
    async evaluateTranslation(sourceText, userTranslation, referenceTranslation) {
        return this.post('/ai/translation/evaluate', {
            source_text: sourceText,
            user_translation: userTranslation,
            reference_translation: referenceTranslation
        });
    }

    // 错题OCR识别 + AI归因分析
    async analyzeErrorImage(image) {
        return this.post('/ai/ocr-analyze', { image });
    }

    async generateExample(word, meaning) {
        return this.post('/ai/generate-example', { word, meaning });
    }

    // 试卷智能分析
    async analyzeExam(images) {
        return this.post('/ai/exam/analyze', { images });
    }

    // ========== 云端数据同步接口 ==========

    // 上传所有本地数据到云端
    async syncUpload(settings, moduleStats, activities) {
        return this.post('/sync/upload', { settings, moduleStats, activities });
    }

    // 从云端下载所有数据
    async syncDownload() {
        return this.get('/sync/download');
    }

    // 增量同步（上传本地数据并下载云端最新数据）
    async syncData(settings, moduleStats, activities, lastSyncTime) {
        return this.post('/sync/sync', { settings, moduleStats, activities, lastSyncTime });
    }

    // 保存单条用户数据
    async saveUserData(key, value) {
        return this.post(`/sync/data/${key}`, { value });
    }

    // 获取单条用户数据
    async getUserData(key) {
        return this.get(`/sync/data/${key}`);
    }

    // ========== 能力画像接口 ==========

    // 获取用户能力画像
    async getProfile() {
        return this.get('/user/profile');
    }

    // 更新能力画像（答题后调用）
    async updateProfile(dimension, isCorrect, skillPoint, responseTime) {
        return this.post('/user/profile/update', {
            dimension,
            is_correct: isCorrect,
            skill_point: skillPoint,
            response_time: responseTime
        });
    }

    // 获取指定维度的知识点掌握情况
    async getSkills(dimension) {
        return this.get(`/user/skills/${dimension}`);
    }

    // 重置能力画像
    async resetProfile() {
        return this.post('/user/profile/reset');
    }

    // ========== 艾宾浩斯复习接口 ==========

    // 添加复习项目
    async addReviewItem(data) {
        return this.post('/review/add', data);
    }

    // 获取复习队列
    async getReviewQueue(limit) {
        const query = limit ? `?limit=${limit}` : '';
        return this.get(`/review/queue${query}`);
    }

    // 获取复习统计
    async getReviewStats() {
        return this.get('/review/stats');
    }

    // 提交复习结果
    async submitReview(reviewId, isCorrect) {
        return this.post('/review/submit', { review_id: reviewId, is_correct: isCorrect });
    }

    // 归档复习项目
    async archiveReview(id) {
        return this.post(`/review/archive/${id}`);
    }

    // 删除复习项目
    async deleteReview(id) {
        return this.delete(`/review/${id}`);
    }
}

// 创建全局实例
const api = new ApiClient();

// 兼容原有Storage接口的适配层
const BackendStorage = {
    // 单词数据 - 从后端获取
    async getWords() {
        // 先检查localStorage缓存
        const cached = localStorage.getItem('wordCollection_words');
        if (cached) {
            try { return JSON.parse(cached); } catch(e) {}
        }
        // 尝试从后端获取
        try {
            if (api.isLoggedIn()) {
                const response = await api.getWords({ limit: 10000 });
                if (response.success) {
                    return response.data.words;
                }
            }
        } catch (err) {
            console.log('后端获取失败，使用本地数据:', err.message);
        }
        // 降级到嵌入式数据
        return (typeof EMBEDDED_WORDS !== 'undefined') ? EMBEDDED_WORDS : null;
    },

    // 用户单词进度
    async getUserWords() {
        try {
            if (api.isLoggedIn()) {
                const response = await api.getUserProgress();
                if (response.success) {
                    return response.data;
                }
            }
        } catch (err) {
            console.log('后端获取失败，使用本地数据');
        }
        // 降级到localStorage
        const data = localStorage.getItem('wordCollection_words');
        return data ? JSON.parse(data) : [];
    },

    // 保存单词进度
    async saveWordProgress(wordId, isCorrect, isFavorite) {
        try {
            if (api.isLoggedIn()) {
                await api.updateWordProgress(wordId, isCorrect, isFavorite);
            }
        } catch (err) {
            console.log('后端保存失败，使用本地存储');
        }
        // 同时保存到localStorage作为备份
        const words = JSON.parse(localStorage.getItem('wordCollection_words') || '[]');
        const word = words.find(w => w.id === wordId);
        if (word) {
            if (isCorrect) word.correct_count = (word.correct_count || 0) + 1;
            else word.wrong_count = (word.wrong_count || 0) + 1;
            if (isFavorite !== undefined) word.is_favorite = isFavorite;
        }
        localStorage.setItem('wordCollection_words', JSON.stringify(words));
    },

    // 收藏单词
    async toggleFavorite(wordId) {
        try {
            if (api.isLoggedIn()) {
                const response = await api.toggleFavorite(wordId);
                return response.data?.is_favorite;
            }
        } catch (err) {
            console.log('后端收藏失败，使用本地存储');
        }
        // 本地降级
        const words = JSON.parse(localStorage.getItem('wordCollection_words') || '[]');
        const word = words.find(w => w.id === wordId);
        if (word) {
            word.is_favorite = !word.is_favorite;
            localStorage.setItem('wordCollection_words', JSON.stringify(words));
            return word.is_favorite;
        }
        return false;
    },

    // 获取设置（优先从本地读取，异步从云端同步）
    getSettings() {
        const data = localStorage.getItem('wordCollection_settings');
        return data ? JSON.parse(data) : { pageSize: 100 };
    },

    // 保存设置（双写：本地 + 云端）
    saveSettings(settings) {
        localStorage.setItem('wordCollection_settings', JSON.stringify(settings));
        // 异步同步到云端（不阻塞UI）
        if (api.isLoggedIn()) {
            api.saveUserData('settings', settings).catch(err => {
                console.log('设置云端同步失败:', err.message);
            });
        }
    },

    // 获取活动记录（优先从本地读取）
    async getActivity() {
        const data = localStorage.getItem('wordCollection_activity');
        return data ? JSON.parse(data) : [];
    },

    // 添加活动（双写：本地 + 云端）
    async addActivity(activity) {
        const activities = this.getActivity();
        activities.unshift({ ...activity, time: new Date().toISOString() });
        if (activities.length > 50) activities.pop();
        localStorage.setItem('wordCollection_activity', JSON.stringify(activities));
        // 异步同步到云端
        if (api.isLoggedIn()) {
            api.saveUserData('activities', activities).catch(err => {
                console.log('活动云端同步失败:', err.message);
            });
        }
    },

    // 获取模块统计
    getModuleStats() {
        const data = localStorage.getItem('wordCollection_moduleStats');
        const stats = data ? JSON.parse(data) : {
            practice: { total: 0, correct: 0 },
            reading: { total: 0, correct: 0, passages: 0 },
            translation: { total: 0, sentences: 0, avgScore: 0 },
            cloze: { total: 0, correct: 0, passages: 0 }
        };
        if (!stats.cloze) stats.cloze = { total: 0, correct: 0, passages: 0 };
        return stats;
    },

    // 保存模块统计（双写：本地 + 云端）
    saveModuleStats(stats) {
        localStorage.setItem('wordCollection_moduleStats', JSON.stringify(stats));
        // 异步同步到云端
        if (api.isLoggedIn()) {
            api.saveUserData('moduleStats', stats).catch(err => {
                console.log('统计云端同步失败:', err.message);
            });
        }
    },

    // 获取保存的练习
    async getSavedExercises() {
        try {
            if (api.isLoggedIn()) {
                const response = await api.getSavedExercises();
                if (response.success) {
                    return response.data;
                }
            }
        } catch (err) {
            console.log('后端获取失败，使用本地存储');
        }
        return JSON.parse(localStorage.getItem('saved_exercises') || '[]');
    },

    // 保存练习
    async saveExercise(exercise) {
        try {
            if (api.isLoggedIn()) {
                await api.saveExercise(exercise.type, exercise.title, exercise.content, exercise.data);
                return;
            }
        } catch (err) {
            console.log('后端保存失败，使用本地存储');
        }
        const exercises = await this.getSavedExercises();
        exercises.unshift({ ...exercise, id: Date.now(), created_at: new Date().toISOString() });
        localStorage.setItem('saved_exercises', JSON.stringify(exercises));
    },

    // 删除保存的练习
    async deleteSavedExercise(id) {
        try {
            if (api.isLoggedIn()) {
                await api.deleteSavedExercise(id);
                return;
            }
        } catch (err) {
            console.log('后端删除失败，使用本地存储');
        }
        const exercises = await this.getSavedExercises();
        const filtered = exercises.filter(e => e.id !== id);
        localStorage.setItem('saved_exercises', JSON.stringify(filtered));
    },

    // 保存单词数据到localStorage（全量缓存）
    saveWords(words) {
        localStorage.setItem('wordCollection_words', JSON.stringify(words));
    },

    // 清空所有数据
    clearAll() {
        localStorage.removeItem('wordCollection_words');
        localStorage.removeItem('wordCollection_activity');
        localStorage.removeItem('saved_exercises');
    },

    // ========== 云端同步管理 ==========

    // 从云端下载所有数据并更新本地
    async syncFromCloud() {
        if (!api.isLoggedIn()) {
            console.log('未登录，跳过云端同步');
            return false;
        }

        try {
            const response = await api.syncDownload();
            if (!response.success || !response.data) {
                return false;
            }

            const cloudData = response.data;

            // 合并设置（云端优先，但保留本地pageSize等界面设置）
            if (cloudData.settings) {
                const localSettings = this.getSettings();
                const mergedSettings = { ...localSettings, ...cloudData.settings };
                localStorage.setItem('wordCollection_settings', JSON.stringify(mergedSettings));
            }

            // 合并模块统计（取较大值，避免数据丢失）
            if (cloudData.moduleStats) {
                const localStats = this.getModuleStats();
                const mergedStats = this._mergeModuleStats(localStats, cloudData.moduleStats);
                localStorage.setItem('wordCollection_moduleStats', JSON.stringify(mergedStats));
            }

            // 合并活动记录（按时间去重合并）
            if (cloudData.activities && Array.isArray(cloudData.activities)) {
                const localActivities = JSON.parse(localStorage.getItem('wordCollection_activity') || '[]');
                const mergedActivities = this._mergeActivities(localActivities, cloudData.activities);
                localStorage.setItem('wordCollection_activity', JSON.stringify(mergedActivities));
            }

            // 记录最后同步时间
            localStorage.setItem('lastSyncTime', cloudData.syncTime || new Date().toISOString());

            console.log('云端数据同步完成');
            return true;
        } catch (err) {
            console.error('云端同步失败:', err.message);
            return false;
        }
    },

    // 上传所有本地数据到云端
    async syncToCloud() {
        if (!api.isLoggedIn()) {
            return false;
        }

        try {
            const settings = this.getSettings();
            const moduleStats = this.getModuleStats();
            const activities = JSON.parse(localStorage.getItem('wordCollection_activity') || '[]');
            const lastSyncTime = localStorage.getItem('lastSyncTime');

            const response = await api.syncData(settings, moduleStats, activities, lastSyncTime);

            if (response.success) {
                localStorage.setItem('lastSyncTime', response.data?.syncTime || new Date().toISOString());
                console.log('数据已上传到云端');
                return true;
            }
            return false;
        } catch (err) {
            console.error('数据上传失败:', err.message);
            return false;
        }
    },

    // 初始化自动同步（在应用启动时调用）
    _syncTimer: null,
    _isSyncing: false,

    async initSync() {
        if (!api.isLoggedIn()) {
            console.log('未登录，云端同步未启用');
            return;
        }

        // 首次加载：从云端同步数据到本地
        await this.syncFromCloud();

        // 设置定时同步（每5分钟）
        if (this._syncTimer) {
            clearInterval(this._syncTimer);
        }
        this._syncTimer = setInterval(async () => {
            if (!this._isSyncing && api.isLoggedIn()) {
                this._isSyncing = true;
                try {
                    await this.syncToCloud();
                } finally {
                    this._isSyncing = false;
                }
            }
        }, 5 * 60 * 1000); // 5分钟

        // 页面可见性变化时触发同步
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible' && api.isLoggedIn() && !this._isSyncing) {
                    this._isSyncing = true;
                    try {
                        await this.syncFromCloud();
                    } finally {
                        this._isSyncing = false;
                    }
                }
            });
        }

        // 页面关闭前触发上传
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                if (api.isLoggedIn() && !this._isSyncing) {
                    // 使用sendBeacon确保请求能发出
                    const settings = this.getSettings();
                    const moduleStats = this.getModuleStats();
                    const activities = JSON.parse(localStorage.getItem('wordCollection_activity') || '[]');
                    const data = JSON.stringify({ settings, moduleStats, activities });
                    navigator.sendBeacon(
                        `${api.baseUrl}/sync/upload`,
                        new Blob([data], { type: 'application/json' })
                    );
                }
            });
        }

        console.log('云端自动同步已启动');
    },

    // 合并模块统计（取较大值）
    _mergeModuleStats(local, cloud) {
        const merged = {};
        const keys = new Set([...Object.keys(local), ...Object.keys(cloud)]);

        keys.forEach(key => {
            const l = local[key] || {};
            const c = cloud[key] || {};
            merged[key] = {
                total: Math.max(l.total || 0, c.total || 0),
                correct: Math.max(l.correct || 0, c.correct || 0),
                passages: Math.max(l.passages || 0, c.passages || 0),
                sentences: Math.max(l.sentences || 0, c.sentences || 0),
                avgScore: Math.max(l.avgScore || 0, c.avgScore || 0)
            };
        });

        return merged;
    },

    // 合并活动记录（按时间去重）
    _mergeActivities(local, cloud) {
        const merged = [...local];
        const localTimes = new Set(local.map(a => a.time));

        cloud.forEach(c => {
            if (c.time && !localTimes.has(c.time)) {
                merged.push(c);
            }
        });

        // 按时间降序排序
        merged.sort((a, b) => new Date(b.time) - new Date(a.time));

        // 限制最多50条
        return merged.slice(0, 50);
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ApiClient, api, BackendStorage };
} else {
    window.ApiClient = ApiClient;
    window.api = api;
    window.BackendStorage = BackendStorage;
}
