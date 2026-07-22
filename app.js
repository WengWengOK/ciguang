/**
 * 词光 - 考研英语学习App
 * 核心功能：收藏室展示、翻译练习、AI评判、进度追踪
 */

// ===== 数据存储 =====
// 优先使用后端存储，后端不可用时降级到localStorage
const Storage = typeof BackendStorage !== 'undefined' ? BackendStorage : {
    getWords() {
        const data = localStorage.getItem('wordCollection_words');
        return data ? JSON.parse(data) : null;
    },
    
    saveWords(words) {
        localStorage.setItem('wordCollection_words', JSON.stringify(words));
    },
    
    getSettings() {
        const data = localStorage.getItem('wordCollection_settings');
        return data ? JSON.parse(data) : { apiKey: '', pageSize: 100 };
    },
    
    saveSettings(settings) {
        localStorage.setItem('wordCollection_settings', JSON.stringify(settings));
    },
    
    getActivity() {
        const data = localStorage.getItem('wordCollection_activity');
        return data ? JSON.parse(data) : [];
    },
    
    getModuleStats() {
        const data = localStorage.getItem('wordCollection_moduleStats');
        const stats = data ? JSON.parse(data) : {
            practice: { total: 0, correct: 0 },
            reading: { total: 0, correct: 0, passages: 0 },
            translation: { total: 0, sentences: 0, avgScore: 0 }
        };
        if (!stats.cloze) {
            stats.cloze = { total: 0, correct: 0, passages: 0 };
        }
        return stats;
    },
    
    saveModuleStats(stats) {
        localStorage.setItem('wordCollection_moduleStats', JSON.stringify(stats));
    },
    
    addActivity(activity) {
        const activities = this.getActivity();
        activities.unshift({
            ...activity,
            time: new Date().toISOString()
        });
        if (activities.length > 50) activities.pop();
        localStorage.setItem('wordCollection_activity', JSON.stringify(activities));
    },
    
    clearAll() {
        localStorage.removeItem('wordCollection_words');
        localStorage.removeItem('wordCollection_activity');
    },
    
    getSavedExercises() {
        return JSON.parse(localStorage.getItem('saved_exercises') || '[]');
    },
    
    saveSavedExercises(exercises) {
        localStorage.setItem('saved_exercises', JSON.stringify(exercises));
    }
};

// ===== 认证相关函数 =====
function showLoginModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('auth-title').textContent = '用户登录';
    document.getElementById('auth-submit-btn').textContent = '登录';
    document.getElementById('nickname-group').classList.add('hidden');
    document.getElementById('auth-switch-text').textContent = '还没有账号？';
    document.getElementById('auth-switch-link').textContent = '立即注册';
    document.getElementById('auth-error').classList.add('hidden');
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
}

function toggleAuthMode() {
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const nicknameGroup = document.getElementById('nickname-group');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    
    if (title.textContent === '用户登录') {
        title.textContent = '用户注册';
        btn.textContent = '注册';
        nicknameGroup.classList.remove('hidden');
        switchText.textContent = '已有账号？';
        switchLink.textContent = '立即登录';
    } else {
        title.textContent = '用户登录';
        btn.textContent = '登录';
        nicknameGroup.classList.add('hidden');
        switchText.textContent = '还没有账号？';
        switchLink.textContent = '立即注册';
    }
    document.getElementById('auth-error').classList.add('hidden');
}

async function handleAuthSubmit() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const nickname = document.getElementById('auth-nickname').value.trim();
    const errorEl = document.getElementById('auth-error');
    const isRegister = document.getElementById('auth-title').textContent === '用户注册';
    
    if (!username || !password) {
        errorEl.textContent = '请填写用户名和密码';
        errorEl.classList.remove('hidden');
        return;
    }
    
    if (password.length < 6) {
        errorEl.textContent = '密码长度至少6位';
        errorEl.classList.remove('hidden');
        return;
    }
    
    try {
        let result;
        if (isRegister) {
            result = await api.register(username, password, nickname || username);
        } else {
            result = await api.login(username, password);
        }
        
        if (result.success) {
            closeAuthModal();
            updateAuthUI();
            // 刷新页面数据
            if (window.app) {
                await window.app.loadWords();
                window.app.renderCollection();
            }
        } else {
            errorEl.textContent = result.message;
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = '网络错误，请稍后重试';
        errorEl.classList.remove('hidden');
    }
}

function logout() {
    api.logout();
    updateAuthUI();
    // 清除本地数据
    localStorage.removeItem('auth_token');
}

function updateAuthUI() {
    const btnLogin = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const nicknameEl = document.getElementById('user-nickname');
    
    if (api.isLoggedIn()) {
        btnLogin.classList.add('hidden');
        userInfo.classList.remove('hidden');
        // 获取用户信息
        api.getCurrentUser().then(result => {
            if (result.success) {
                nicknameEl.textContent = result.data.nickname || result.data.username;
            }
        }).catch(() => {
            nicknameEl.textContent = '用户';
        });
    } else {
        btnLogin.classList.remove('hidden');
        userInfo.classList.add('hidden');
    }
}

// ===== 等级系统 =====
const LevelSystem = {
    getLevel(correctCount) {
        if (correctCount >= 21) return 4;      // 红色
        if (correctCount >= 11) return 3;      // 金色
        if (correctCount >= 6) return 2;       // 紫色
        if (correctCount >= 3) return 1;       // 蓝色
        return 0;                               // 绿色
    },
    
    getLevelName(level) {
        const names = ['绿色', '蓝色', '紫色', '金色', '红色'];
        return names[level] || '绿色';
    },
    
    getLevelRange(level) {
        const ranges = ['0-2次', '3-5次', '6-10次', '11-20次', '21次+'];
        return ranges[level] || '0-2次';
    }
};

// ===== 例句生成 =====
const ExampleGenerator = {
    // 名词模板 (n.)
    nounTemplates: [
        "The {word} plays an important role in our daily life.",
        "Many people don't understand the true meaning of {word}.",
        "The professor explained the concept of {word} in detail.",
        "The {word} is often discussed in academic papers.",
        "Understanding {word} is essential for learning English.",
        "The meaning of {word} has changed over time.",
        "In this context, {word} refers to something specific.",
        "We should pay attention to the {word} when reading this passage.",
        "The government has taken measures to deal with the {word}.",
        "It is widely acknowledged that {word} has a significant impact on society.",
        "Researchers have found that {word} can lead to unexpected results.",
        "The {word} has become a hot topic in recent years.",
        "The book provides a comprehensive analysis of {word}.",
        "A deep understanding of {word} helps us grasp the passage better.",
        "The author emphasizes the importance of {word} throughout the text."
    ],
    // 动词模板 (v./vt./vi.)
    verbTemplates: [
        "In the exam, you need to know how to {word} correctly.",
        "The author used {word} to express his ideas clearly.",
        "Students should practice how to {word} in different situations.",
        "She tried to {word} but failed in the end.",
        "They decided to {word} after a long discussion.",
        "The ability to {word} is considered a key skill in modern education.",
        "One of the biggest challenges is how to {word} effectively.",
        "Learning to {word} properly takes years of practice.",
        "You must {word} if you want to achieve your goals.",
        "The teacher asked students to {word} in their homework.",
        "Scientists continue to {word} in order to find new solutions.",
        "It is important to {word} at the right time.",
        "Many young people choose to {word} during their college years.",
        "Parents often encourage children to {word} from an early age.",
        "The new policy aims to help citizens {word} more easily."
    ],
    // 形容词模板 (adj.)
    adjTemplates: [
        "The professor gave a {word} explanation of the theory.",
        "It is {word} for students to review lessons regularly.",
        "The results of the experiment were quite {word}.",
        "A {word} attitude is essential for success.",
        "The city has become increasingly {word} in recent years.",
        "Many people find it {word} to balance work and life.",
        "The novel describes a {word} scene that impresses readers.",
        "Students should develop a {word} habit of reading.",
        "The environment here is {word} for studying.",
        "His performance in the exam was truly {word}.",
        "A {word} approach can solve this problem effectively.",
        "The teacher is {word} and always helps students patiently.",
        "It is {word} to prepare well before the examination.",
        "The new technology makes our life more {word}.",
        "Maintaining a {word} lifestyle benefits our health."
    ],
    // 副词模板 (adv.)
    advTemplates: [
        "She {word} finished her homework before dinner.",
        "The team worked {word} to meet the deadline.",
        "He {word} agreed with the professor's viewpoint.",
        "The situation has {word} improved over the past decade.",
        "Students should {word} check their answers before submission.",
        "The theory can be {word} applied to real-world problems.",
        "They {word} discussed the plan for three hours.",
        "The data shows that the economy is recovering {word}.",
        "You need to think {word} before making a decision.",
        "The author {word} describes the beauty of nature.",
        "Children learn languages {word} at a young age.",
        "The project was completed {word} ahead of schedule.",
        "He spoke {word} during the academic conference.",
        "The medicine works {word} to relieve pain.",
        "We should {word} follow the guidelines provided."
    ],
    // 通用模板（无法判断词性时使用）
    generalTemplates: [
        "In the exam, you need to know how to use {word} correctly.",
        "Students should practice using {word} in sentences.",
        "The author used {word} to express his ideas clearly.",
        "Understanding {word} is essential for learning English.",
        "The meaning of {word} has changed over time.",
        "In this context, {word} refers to something specific.",
        "The book provides a comprehensive analysis of {word}.",
        "Many people don't understand the true meaning of {word}."
    ],

    _lastTemplateIndex: -1,
    _lastTemplateType: '',

    getPos(wordObj) {
        if (!wordObj || !wordObj.meaning) return 'general';
        const m = wordObj.meaning.trim();
        if (m.startsWith('adj.')) return 'adj';
        if (m.startsWith('adv.')) return 'adv';
        if (m.startsWith('vt.') || m.startsWith('vi.') || m.startsWith('v.')) return 'verb';
        if (m.startsWith('n.')) return 'noun';
        if (m.startsWith('prep.') || m.startsWith('art.') || m.startsWith('conj.')) return 'general';
        return 'general';
    },

    getTemplatesByPos(pos) {
        switch (pos) {
            case 'noun': return this.nounTemplates;
            case 'verb': return this.verbTemplates;
            case 'adj': return this.adjTemplates;
            case 'adv': return this.advTemplates;
            default: return this.generalTemplates;
        }
    },

    generate(wordObj, avoidIndex = -1) {
        const pos = this.getPos(wordObj);
        const templates = this.getTemplatesByPos(pos);
        const word = typeof wordObj === 'string' ? wordObj : wordObj.word;

        let idx;
        let attempts = 0;
        do {
            idx = Math.floor(Math.random() * templates.length);
            attempts++;
        } while (idx === avoidIndex && templates.length > 1 && attempts < 10);

        this._lastTemplateIndex = idx;
        this._lastTemplateType = pos;
        const template = templates[idx];
        return template.replace('{word}', word);
    },

    generateHighlighted(wordObj, avoidIndex = -1) {
        const sentence = this.generate(wordObj, avoidIndex);
        const word = typeof wordObj === 'string' ? wordObj : wordObj.word;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = word.length <= 2 ? `\\b${escaped}\\b` : escaped;
        const regex = new RegExp(pattern, 'gi');
        return sentence.replace(regex, '<span class="highlight-word">$&</span>');
    }
};

// ===== 应用主类 =====
// ===== 练习模式管理 =====
const PracticeMode = {
    SEQUENTIAL: 'sequential',
    RANDOM: 'random',
    LETTER: 'letter'
};

class WordCollectionApp {
    constructor() {
        this.words = [];
        this.filteredWords = [];
        this.currentPage = 0;
        this.currentLetter = 'ALL';
        this.isLoading = false;
        this.settings = Storage.getSettings();
        this.currentPracticeWord = null;
        this.currentExampleIndex = -1;
        
        // 练习模式状态
        this.practiceMode = PracticeMode.SEQUENTIAL;
        this.sequentialIndex = 0;
        this.randomIndices = [];
        this.randomIndex = 0;
        this.letterFilter = 'A';
        this.letterWords = [];
        this.letterIndex = 0;
        
        // 阅读练习状态
        this.readingDifficulty = 'easy';
        this.readingSource = 'random'; // 题目来源：random / custom / photo
        this.useAIReading = false;
        this.currentPassage = null;
        this.readingAnswers = {};
        this.readingCurrentQuestion = 0;
        this.readingCameraStream = null; // 阅读页相机流
        this.currentSeason = 'default';   // 当前季节主题
        
        // 翻译练习状态
        this.translationTopic = 'culture';
        this.currentTranslation = null;
        this.translationInputs = {};

        // 选词填空状态
        this.clozeDifficulty = 'easy';
        this.currentCloze = null;
        this.clozeAnswers = {};

        // 单词记忆状态
        this.memoryMode = 'all';
        this.memoryLetter = '';
        this.memoryWords = [];
        this.memoryCurrentIndex = 0;
        this.memoryCurrentWord = null;
        
        // 保存的练习
        this.savedExercises = [];
        // BackendStorage.getSavedExercises 是 async，需要 await
        const savedResult = Storage.getSavedExercises();
        if (savedResult instanceof Promise) {
            savedResult.then(data => { if (Array.isArray(data)) this.savedExercises = data; });
        } else if (Array.isArray(savedResult)) {
            this.savedExercises = savedResult;
        }

        // 错题本
        this.wrongRecords = JSON.parse(localStorage.getItem('wrong_records') || '[]');

        // 计时器状态
        this.timers = {
            practice: { start: null, elapsed: 0 },
            reading: { start: null, elapsed: 0 },
            translation: { start: null, elapsed: 0 },
            cloze: { start: null, elapsed: 0 },
            memory: { start: null, elapsed: 0 }
        };

        // 学习总时长（持久化）
        this.totalStudyTime = parseInt(localStorage.getItem('ciguang_study_time') || '0');

        this.init();
    }
    
    async init() {
        this.initTheme();
        await this.loadWords();
        this.setupEventListeners();
        this.initMemory();
        this.initSeasonTheme();
        this.renderLetterNav();
        this.renderCollection();
        this.updateTotalCount();
        this.renderSavedExercises();
    }
    
    initMemory() {
        // 渲染字母选择器
        const letterContainer = document.getElementById('memory-letter-options');
        if (letterContainer) {
            letterContainer.innerHTML = '';
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => {
                const btn = document.createElement('button');
                btn.className = 'letter-btn';
                btn.textContent = letter;
                btn.addEventListener('click', () => this.selectMemoryLetter(letter));
                letterContainer.appendChild(btn);
            });
        }
    }

    async loadWords() {
        // Try to load from localStorage first
        let words = Storage.getWords();
        // BackendStorage.getWords is async, handle both sync/async
        if (words && typeof words.then === 'function') {
            words = await words;
        }
        
        // Validate words is an array
        if (!Array.isArray(words)) {
            console.warn('Loaded words is not an array, clearing cache');
            words = null;
            localStorage.removeItem('wordCollection_words');
        }
        
        if (!words) {
            // Load from embedded data (will be injected)
            try {
                const response = await fetch('words_database.json');
                if (response.ok) {
                    words = await response.json();
                }
            } catch (e) {
                console.log('Using embedded word data');
            }
            
            // If still no words, use embedded fallback
            if (!words && typeof EMBEDDED_WORDS !== 'undefined') {
                words = EMBEDDED_WORDS;
            }
            
            if (words) {
                Storage.saveWords(words);
            }
        }
        
        this.words = words || [];
        this.filteredWords = [...this.words];
    }
    
    setupEventListeners() {
        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.switchPage(page);
            });
        });
        
        // Settings modal
        const settingsBtn = document.getElementById('settings-btn');
        const settingsModal = document.getElementById('settings-modal');
        const modalClose = document.getElementById('modal-close');
        const btnSaveSettings = document.getElementById('btn-save-settings');
        
        settingsBtn.addEventListener('click', () => {
            this.openSettings();
        });
        
        modalClose.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
        
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });
        
        btnSaveSettings.addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Theme buttons
        document.getElementById('btn-apply-custom-theme').addEventListener('click', () => {
            this.applyCustomTheme();
        });
        
        document.getElementById('btn-reset-theme').addEventListener('click', () => {
            this.resetTheme();
        });
        
        // Practice buttons
        const btnSkip = document.getElementById('btn-skip');
        const btnSubmit = document.getElementById('btn-submit');
        const btnNext = document.getElementById('btn-next');
        const btnRefreshExample = document.getElementById('btn-refresh-example');
        
        btnSkip.addEventListener('click', () => {
            this.nextPracticeWord();
        });
        
        btnSubmit.addEventListener('click', () => {
            this.submitTranslation();
        });
        
        btnNext.addEventListener('click', () => {
            this.nextPracticeWord();
        });
        
        // Refresh example sentence
        btnRefreshExample.addEventListener('click', () => {
            this.refreshExample();
        });
        
        // Toggle hint and answer buttons
        document.getElementById('btn-show-hint')?.addEventListener('click', () => {
            const hintEl = document.getElementById('answer-hint');
            const btn = document.getElementById('btn-show-hint');
            if (!hintEl || !btn) return;
            const isHidden = hintEl.style.display === 'none';
            hintEl.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '💡 隐藏单词提示' : '💡 显示单词提示';
        });
        
        document.getElementById('btn-show-answer')?.addEventListener('click', () => {
            const answerEl = document.getElementById('standard-answer');
            const btn = document.getElementById('btn-show-answer');
            if (!answerEl || !btn) return;
            const isHidden = answerEl.style.display === 'none';
            answerEl.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '📖 隐藏标准翻译' : '📖 显示标准翻译';
        });
        
        // Speak buttons
        const btnSpeakWord = document.getElementById('btn-speak-word');
        const btnSpeakExample = document.getElementById('btn-speak-example');
        
        btnSpeakWord.addEventListener('click', () => {
            this.speakText(this.currentPracticeWord?.word || '');
        });
        
        btnSpeakExample.addEventListener('click', () => {
            const sentenceEl = document.getElementById('example-sentence');
            const text = sentenceEl ? sentenceEl.textContent : '';
            this.speakText(text);
        });
        
        // Mode selector buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                if (mode) this.switchPracticeMode(mode);
            });
        });
        
        // Reading mode selector
        document.querySelectorAll('[data-reading-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.readingMode;
                if (mode) this.switchReadingMode(mode);
            });
        });
        
        // Reading action buttons
        document.getElementById('btn-new-passage')?.addEventListener('click', () => {
            this.useAIReading = false;
            this.generateNewPassage();
        });
        document.getElementById('btn-generate-ai-reading')?.addEventListener('click', () => {
            this.useAIReading = true;
            this.generateNewPassage();
        });

        // 阅读练习 - 题目来源tab切换
        document.querySelectorAll('[data-reading-source]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchReadingSource(e.target.dataset.readingSource);
            });
        });

        // 阅读练习 - 自定义输入
        document.getElementById('reading-custom-text')?.addEventListener('input', () => {
            const text = document.getElementById('reading-custom-text').value.trim();
            const wordCount = text ? text.split(/\s+/).filter(w => w).length : 0;
            document.getElementById('reading-custom-word-count').textContent = wordCount;
        });
        document.getElementById('btn-start-custom-reading')?.addEventListener('click', () => {
            this.startCustomReading();
        });
        document.getElementById('btn-start-random-reading')?.addEventListener('click', () => {
            this.generateNewPassage();
        });

        // 阅读练习 - 拍照
        document.getElementById('reading-btn-start-camera')?.addEventListener('click', () => {
            this.startReadingCamera();
        });
        document.getElementById('reading-btn-take-photo')?.addEventListener('click', () => {
            this.takeReadingPhoto();
        });
        document.getElementById('reading-btn-stop-camera')?.addEventListener('click', () => {
            this.stopReadingCamera();
        });

        // 阅读练习 - 文件上传
        document.getElementById('reading-file-upload-area')?.addEventListener('click', (e) => {
            if (e.target.id !== 'reading-btn-upload-file') {
                document.getElementById('reading-file-input').click();
            }
        });
        document.getElementById('reading-btn-upload-file')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('reading-file-input').click();
        });
        document.getElementById('reading-file-input')?.addEventListener('change', (e) => {
            if (e.target.files[0]) this.processReadingFile(e.target.files[0]);
        });
        // 拖拽上传
        const readingFileArea = document.getElementById('reading-file-upload-area');
        if (readingFileArea) {
            readingFileArea.addEventListener('dragover', (e) => { e.preventDefault(); readingFileArea.classList.add('dragover'); });
            readingFileArea.addEventListener('dragleave', () => { readingFileArea.classList.remove('dragover'); });
            readingFileArea.addEventListener('drop', (e) => {
                e.preventDefault();
                readingFileArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) this.processReadingFile(file);
            });
        }
        document.getElementById('btn-submit-reading')?.addEventListener('click', () => {
            this.submitReadingAnswers();
        });
        document.getElementById('btn-next-passage')?.addEventListener('click', () => {
            this.useAIReading = false;
            this.generateNewPassage();
        });
        
        // Toggle reading nav collapse/expand
        document.getElementById('reading-nav-toggle')?.addEventListener('click', () => {
            const navInner = document.querySelector('.reading-nav-inner');
            if (navInner) {
                navInner.classList.toggle('collapsed');
                const isCollapsed = navInner.classList.contains('collapsed');
                const btn = document.getElementById('reading-nav-toggle');
                if (btn) btn.title = isCollapsed ? '展开选项' : '收起选项';
            }
        });
        
        // Toggle all Chinese translations
        document.getElementById('btn-toggle-cn')?.addEventListener('click', (e) => {
            const btn = e.target;
            const isShowing = btn.classList.toggle('active');
            
            // Toggle all paragraph translations
            document.querySelectorAll('.cn-paragraph').forEach(p => {
                p.style.display = isShowing ? 'block' : 'none';
            });
            document.querySelectorAll('.paragraph-toggle-btn').forEach(b => {
                b.classList.toggle('active', isShowing);
                b.textContent = isShowing ? '🔽' : '🇨🇳';
            });
            
            // Toggle question translation (main content)
            document.querySelectorAll('.question-cn').forEach(p => {
                p.style.display = isShowing ? 'block' : 'none';
            });
            document.querySelectorAll('.option-cn').forEach(p => {
                p.style.display = isShowing ? 'inline' : 'none';
            });
            // Toggle question translation (nav bar)
            document.querySelectorAll('.nav-question-cn').forEach(p => {
                p.style.display = isShowing ? 'block' : 'none';
            });
            document.querySelectorAll('.nav-option-cn').forEach(p => {
                p.style.display = isShowing ? 'block' : 'none';
            });
            btn.textContent = isShowing ? '🇨🇳 隐藏全部' : '🇨🇳 显示全部';
        });
        
        // Cloze translation toggle
        document.getElementById('btn-cloze-toggle-cn')?.addEventListener('click', (e) => {
            const btn = e.target;
            const isShowing = btn.classList.toggle('active');
            const cnContent = document.getElementById('cloze-cn-content');
            if (cnContent) {
                cnContent.style.display = isShowing ? 'block' : 'none';
            }
            btn.textContent = isShowing ? '🇨🇳 隐藏翻译' : '🇨🇳 翻译';
        });
        
        // Translation topic selector
        document.querySelectorAll('[data-translation-topic]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const topic = e.target.dataset.translationTopic;
                if (topic) this.switchTranslationTopic(topic);
            });
        });

        // Translation action buttons
        document.getElementById('btn-new-translation')?.addEventListener('click', () => {
            this.generateNewTranslation();
        });
        document.getElementById('btn-submit-translation')?.addEventListener('click', () => {
            this.submitTranslationAnswers();
        });
        document.getElementById('btn-next-translation')?.addEventListener('click', () => {
            this.generateNewTranslation();
        });

        // Cloze difficulty selector
        document.querySelectorAll('[data-cloze-difficulty]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const difficulty = e.target.dataset.clozeDifficulty;
                if (difficulty) this.switchClozeDifficulty(difficulty);
            });
        });

        // Cloze action buttons
        document.getElementById('btn-new-cloze')?.addEventListener('click', () => {
            this.generateCloze();
        });
        document.getElementById('btn-submit-cloze')?.addEventListener('click', () => {
            this.submitClozeAnswers();
        });
        // Cloze nav toggle
        document.getElementById('cloze-nav-toggle')?.addEventListener('click', () => {
            const optionsPanel = document.getElementById('cloze-nav-options');
            if (!optionsPanel) return;
            const isHidden = optionsPanel.style.display === 'none';
            optionsPanel.style.display = isHidden ? 'block' : 'none';
            const btn = document.getElementById('cloze-nav-toggle');
            if (btn) btn.textContent = isHidden ? '⬆️' : '⬇️';
        });
        document.getElementById('btn-next-cloze')?.addEventListener('click', () => {
            this.generateCloze();
        });

        // 选词填空 - 题目来源tab切换
        document.querySelectorAll('.cloze-source-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const source = e.target.dataset.clozeSource;
                // 切换tab按钮激活状态
                document.querySelectorAll('.cloze-source-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.clozeSource === source);
                });
                // 切换面板显示
                document.querySelectorAll('.cloze-source-panel').forEach(p => {
                    p.classList.remove('active');
                });
                const targetPanel = document.getElementById(`cloze-panel-${source}`);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }
            });
        });

        // 选词填空 - 自定义输入生成按钮
        document.getElementById('btn-generate-custom-cloze')?.addEventListener('click', () => {
            const text = document.getElementById('cloze-custom-text')?.value.trim();
            const wordsStr = document.getElementById('cloze-custom-words')?.value.trim();
            if (!text) {
                alert('请先粘贴英文文章');
                return;
            }
            if (!wordsStr) {
                alert('请输入要挖空的单词');
                return;
            }
            const blankWords = wordsStr.split(/[,，]/).map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
            if (blankWords.length === 0) {
                alert('请输入有效的单词');
                return;
            }
            this.generateClozeFromCustomInput(text, blankWords);
        });

        // Download buttons
        document.getElementById('btn-download-reading')?.addEventListener('click', () => {
            this.downloadExercise('reading');
        });
        document.getElementById('btn-download-translation')?.addEventListener('click', () => {
            this.downloadExercise('translation');
        });
        document.getElementById('btn-download-cloze')?.addEventListener('click', () => {
            this.downloadExercise('cloze');
        });

        // Upload tab switching
        document.querySelectorAll('[data-upload-tab]').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const targetTab = e.target.dataset.uploadTab;
                document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.upload-panel').forEach(p => p.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(`upload-panel-${targetTab}`)?.classList.add('active');
            });
        });

        // File upload for translation
        const fileUploadArea = document.getElementById('file-upload-area');
        const fileUploadInput = document.getElementById('file-upload-input');
        const btnSelectFile = document.getElementById('btn-select-file');

        btnSelectFile?.addEventListener('click', (e) => {
            e.stopPropagation();
            fileUploadInput?.click();
        });

        fileUploadArea?.addEventListener('click', () => {
            fileUploadInput?.click();
        });

        fileUploadArea?.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.classList.add('dragover');
        });

        fileUploadArea?.addEventListener('dragleave', () => {
            fileUploadArea.classList.remove('dragover');
        });

        fileUploadArea?.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleTranslationFileUpload(files[0]);
            }
        });

        fileUploadInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleTranslationFileUpload(e.target.files[0]);
            }
        });

        // Camera upload for translation
        this.setupCameraUpload();

        // Enter key for translation
        document.getElementById('user-translation').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.submitTranslation();
            }
        });
        
        // Memory mode selector
        document.querySelectorAll('[data-memory-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.memoryMode;
                if (mode) this.switchMemoryMode(mode);
            });
        });

        // Memory action buttons
        document.getElementById('btn-remember')?.addEventListener('click', () => {
            this.handleRemember();
        });
        document.getElementById('btn-forget')?.addEventListener('click', () => {
            this.handleForget();
        });
        document.getElementById('btn-memory-submit')?.addEventListener('click', () => {
            this.submitMemoryMeaning();
        });
        document.getElementById('btn-memory-skip')?.addEventListener('click', () => {
            this.nextMemoryWord();
        });
        document.getElementById('btn-memory-next')?.addEventListener('click', () => {
            this.nextMemoryWord();
        });
        document.getElementById('btn-memory-next-forget')?.addEventListener('click', () => {
            this.nextMemoryWord();
        });
        document.getElementById('btn-memory-speak')?.addEventListener('click', () => {
            this.speakText(this.memoryCurrentWord?.word);
        });
        document.getElementById('btn-memory-speak-write')?.addEventListener('click', () => {
            this.speakText(this.memoryCurrentWord?.word);
        });

        // Enter key for memory input
        document.getElementById('memory-meaning-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitMemoryMeaning();
            }
        });
        
        // Saved exercises tabs
        document.querySelectorAll('[data-saved-type]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.target.dataset.savedType;
                document.querySelectorAll('.saved-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.renderSavedExercises(type);
            });
        });
        
        // Save exercise buttons
        document.getElementById('btn-save-translation')?.addEventListener('click', () => {
            if (this.currentTranslation) {
                const preview = this.currentTranslation.sentences.map(s => s.cn).join(' ').substring(0, 100) + '...';
                this.saveCurrentExercise('translation', this.currentTranslation.title, preview, this.currentTranslation);
            } else {
                alert('请先生成或加载一篇翻译练习');
            }
        });
        document.getElementById('btn-save-reading')?.addEventListener('click', () => {
            if (this.currentPassage) {
                const preview = this.currentPassage.paragraphs
                    ? this.currentPassage.paragraphs.map(p => p.en).join(' ').substring(0, 100) + '...'
                    : (this.currentPassage.text || '').substring(0, 100) + '...';
                this.saveCurrentExercise('reading', this.currentPassage.title, preview, this.currentPassage);
            } else {
                alert('请先生成或加载一篇阅读练习');
            }
        });

        // Infinite scroll for collection
        window.addEventListener('scroll', () => {
            if (this.currentPage === 'collection') {
                this.handleScroll();
            }
        });

        // 错题本相关
        document.getElementById('btn-clear-wrong')?.addEventListener('click', () => this.clearWrongRecords());
        document.querySelectorAll('.wrong-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.wrong-filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.renderWrongList(e.target.dataset.filter);
            });
        });
    }
    
    // ===== 练习模式切换 =====
    switchPracticeMode(mode) {
        this.practiceMode = mode;
        
        // Update UI
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // Show/hide letter filter
        const letterFilter = document.getElementById('letter-filter');
        if (mode === PracticeMode.LETTER) {
            letterFilter.style.display = 'flex';
            this.renderLetterFilter();
        } else {
            letterFilter.style.display = 'none';
        }
        
        // Reset mode state and start fresh
        this.resetModeState();
        this.nextPracticeWord();
    }
    
    resetModeState() {
        this.sequentialIndex = 0;
        this.randomIndex = 0;
        this.letterIndex = 0;
        
        // Generate new random order for random mode
        if (this.practiceMode === PracticeMode.RANDOM) {
            this.randomIndices = this.shuffleArray([...Array(this.words.length).keys()]);
        }
        
        // Filter words for letter mode
        if (this.practiceMode === PracticeMode.LETTER) {
            this.updateLetterWords();
        }
    }
    
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * 频率加权随机抽取
     * freq=5 权重10, freq=4 权重5, freq=3 权重2, freq=2 权重1, freq=1 权重0.5
     * @param {Array} words - 单词数组
     * @param {number} count - 抽取数量
     * @returns {Array} 抽取的单词子集
     */
    getWeightedRandomWords(words, count = 1) {
        if (!words || words.length === 0) return [];
        
        const freqWeights = { 5: 10, 4: 5, 3: 2, 2: 1, 1: 0.5 };
        
        // Build weighted pool
        const weightedPool = [];
        words.forEach((w, idx) => {
            const weight = freqWeights[w.freq] || 1;
            // Add word index 'weight' times to the pool
            const times = Math.max(1, Math.round(weight * 2));
            for (let i = 0; i < times; i++) {
                weightedPool.push(idx);
            }
        });
        
        // Shuffle and pick unique
        const shuffled = this.shuffleArray([...weightedPool]);
        const picked = new Set();
        const result = [];
        
        for (const idx of shuffled) {
            if (picked.has(idx)) continue;
            picked.add(idx);
            result.push(words[idx]);
            if (result.length >= count) break;
        }
        
        // If not enough from weighted pool, fill randomly
        if (result.length < count) {
            const remaining = words.filter(w => !result.includes(w));
            const extra = this.shuffleArray(remaining).slice(0, count - result.length);
            result.push(...extra);
        }
        
        return result;
    }

    /**
     * 频率加权随机打乱（用于整个列表的乱序）
     * 高频词更可能出现在前面
     */
    shuffleArrayByFrequency(words) {
        const freqWeights = { 5: 10, 4: 5, 3: 2, 2: 1, 1: 0.5 };
        
        // Create weighted entries
        const entries = words.map((w, idx) => ({
            idx,
            sortKey: Math.random() / (freqWeights[w.freq] || 1)
        }));
        
        // Sort by sortKey (lower = higher frequency gets lower random values = appears first more often)
        entries.sort((a, b) => a.sortKey - b.sortKey);
        
        return entries.map(e => words[e.idx]);
    }
    
    updateLetterWords() {
        this.letterWords = this.words.filter(w => 
            (w.first_letter || w.word[0].toUpperCase()) === this.letterFilter
        );
        // Shuffle within the letter group
        this.letterWords.sort(() => Math.random() - 0.5);
        this.letterIndex = 0;
    }
    
    renderLetterFilter() {
        const container = document.getElementById('letter-filter-options');
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        
        // Count words per letter
        const letterCounts = {};
        this.words.forEach(w => {
            const letter = w.first_letter || w.word[0].toUpperCase();
            letterCounts[letter] = (letterCounts[letter] || 0) + 1;
        });
        
        let html = '';
        letters.forEach(letter => {
            const hasWords = letterCounts[letter] > 0;
            const isActive = letter === this.letterFilter;
            html += `<button class="letter-filter-btn ${!hasWords ? 'empty' : ''} ${isActive ? 'active' : ''}" 
                     data-letter="${letter}" ${!hasWords ? 'disabled' : ''}>${letter}</button>`;
        });
        
        container.innerHTML = html;
        
        // Add click handlers
        container.querySelectorAll('.letter-filter-btn:not(.empty)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const letter = e.target.dataset.letter;
                this.letterFilter = letter;
                
                // Update active state
                container.querySelectorAll('.letter-filter-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.letter === letter);
                });
                
                // Update letter words and restart
                this.updateLetterWords();
                this.letterIndex = 0;
                this.nextPracticeWord();
            });
        });
    }
    
    switchPage(page) {
        // Update nav tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.page === page);
        });
        
        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `${page}-page`);
        });
        
        // Reset nav tabs scroll to keep first items visible
        const navTabs = document.querySelector('.nav-tabs');
        if (navTabs) {
            navTabs.scrollLeft = 0;
        }
        
        this.currentPage = page;
        
        // Page-specific initialization
        if (page === 'practice') {
            this.nextPracticeWord();
        } else if (page === 'reading') {
            if (!this.currentPassage) {
                this.generateNewPassage();
            }
        } else if (page === 'translation') {
            if (!this.currentTranslation) {
                this.generateNewTranslation();
            }
        } else if (page === 'cloze') {
            if (!this.currentCloze) {
                this.generateCloze();
            }
        } else if (page === 'writing') {
            if (!this.currentWritingPrompt) {
                this.initWritingPage();
            }
        } else if (page === 'saved') {
            this.renderSavedExercises();
        } else if (page === 'stats') {
            this.renderStats();
            this.renderDiagnosis();
        } else if (page === 'memory') {
            if (!this.memoryCurrentWord) this.startMemoryPractice();
        } else if (page === 'wrong') {
            this.renderWrongList();
        }
    }
    
    // ===== 收藏室功能 =====
    renderLetterNav() {
        const nav = document.getElementById('letter-nav');
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        
        // Count words per letter
        const letterCounts = {};
        this.words.forEach(w => {
            const letter = w.first_letter || w.word[0].toUpperCase();
            letterCounts[letter] = (letterCounts[letter] || 0) + 1;
        });
        
        let html = `<button class="letter-btn ${this.currentLetter === 'ALL' ? 'active' : ''}" data-letter="ALL">全部</button>`;
        
        letters.forEach(letter => {
            const hasWords = letterCounts[letter] > 0;
            html += `<button class="letter-btn ${!hasWords ? 'empty' : ''} ${this.currentLetter === letter ? 'active' : ''}" 
                     data-letter="${letter}" ${!hasWords ? 'disabled' : ''}>${letter}</button>`;
        });
        
        nav.innerHTML = html;
        
        // Add click handlers
        nav.querySelectorAll('.letter-btn:not(.empty)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const letter = e.target.dataset.letter;
                this.filterByLetter(letter);
            });
        });
    }
    
    filterByLetter(letter) {
        this.currentLetter = letter;
        this.currentPage = 0;
        
        // Update active state
        document.querySelectorAll('.letter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.letter === letter);
        });
        
        // Filter words
        if (letter === 'ALL') {
            this.filteredWords = [...this.words];
        } else {
            this.filteredWords = this.words.filter(w => 
                (w.first_letter || w.word[0].toUpperCase()) === letter
            );
        }
        
        // Re-render
        document.getElementById('collection-grid').innerHTML = '';
        this.renderCollection();
    }
    
    renderCollection() {
        const grid = document.getElementById('collection-grid');
        const pageSize = this.settings.pageSize || 100;
        const start = this.currentPage * pageSize;
        const end = start + pageSize;
        const pageWords = this.filteredWords.slice(start, end);
        
        if (pageWords.length === 0 && this.currentPage === 0) {
            grid.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px;">暂无单词数据</div>';
            return;
        }
        
        const html = pageWords.map(word => this.createWordCard(word)).join('');
        
        if (this.currentPage === 0) {
            grid.innerHTML = html;
        } else {
            grid.innerHTML += html;
        }
        
        this.isLoading = false;
        document.getElementById('loading').style.display = 'none';
    }
    
    createWordCard(word) {
        const level = LevelSystem.getLevel(word.correct_count || 0);
        const levelName = LevelSystem.getLevelName(level);
        const count = word.correct_count || 0;
        
        return `
            <div class="word-card level-${level}" data-word="${word.word}" title="${word.word}: ${word.meaning}">
                <span class="word-count">${count}</span>
                <div class="word-text">${word.word}</div>
                <div class="word-meaning">${word.meaning}</div>
            </div>
        `;
    }
    
    handleScroll() {
        if (this.isLoading) return;
        
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollTop = window.scrollY + window.innerHeight;
        
        if (scrollTop >= scrollHeight - 200) {
            const pageSize = this.settings.pageSize || 100;
            const maxPage = Math.ceil(this.filteredWords.length / pageSize) - 1;
            
            if (this.currentPage < maxPage) {
                this.isLoading = true;
                this.currentPage++;
                document.getElementById('loading').style.display = 'flex';
                
                // Small delay for smooth loading
                setTimeout(() => {
                    this.renderCollection();
                }, 300);
            }
        }
    }
    
    updateTotalCount() {
        document.querySelector('.total-words').textContent = `📚 ${this.words.length} 个单词`;
    }
    
    // ===== 翻译练习功能 =====
    nextPracticeWord() {
        // Start timer for practice (only on first word)
        if (!this.timers.practice.start) {
            this.startTimer('practice');
        }
        
        let selectedWord = null;
        let modeLabel = '';
        
        switch (this.practiceMode) {
            case PracticeMode.SEQUENTIAL:
                // 顺序模式：按单词表顺序
                if (this.sequentialIndex >= this.words.length) {
                    this.sequentialIndex = 0; // 循环
                }
                selectedWord = this.words[this.sequentialIndex];
                this.sequentialIndex++;
                modeLabel = `顺序 #${selectedWord.id}`;
                break;
                
            case PracticeMode.RANDOM:
                // 乱序模式：按频率加权随机顺序（高频词优先）
                if (this.randomIndices.length === 0) {
                    const weighted = this.shuffleArrayByFrequency([...this.words]);
                    this.randomIndices = weighted.map(w => this.words.indexOf(w));
                }
                if (this.randomIndex >= this.randomIndices.length) {
                    this.randomIndex = 0; // 循环
                }
                selectedWord = this.words[this.randomIndices[this.randomIndex]];
                this.randomIndex++;
                modeLabel = `乱序 #${selectedWord.id}`;
                break;
                
            case PracticeMode.LETTER:
                // 字母模式：按指定字母开头
                if (this.letterWords.length === 0) {
                    this.updateLetterWords();
                }
                if (this.letterWords.length === 0) {
                    // 如果当前字母没有单词，切换到下一个有单词的字母
                    this.findNextLetterWithWords();
                }
                if (this.letterIndex >= this.letterWords.length) {
                    this.letterIndex = 0; // 循环
                }
                selectedWord = this.letterWords[this.letterIndex];
                this.letterIndex++;
                modeLabel = `字母 ${this.letterFilter} #${selectedWord.id}`;
                break;
                
            default:
                // 默认顺序模式
                selectedWord = this.words[0];
        }
        
        this.currentPracticeWord = selectedWord;
        this.renderPracticeCard(modeLabel);
        
        // Hide evaluation, hint, answer, and clear input
        document.getElementById('ai-evaluation').style.display = 'none';
        document.getElementById('answer-hint').style.display = 'none';
        document.getElementById('standard-answer').style.display = 'none';
        document.getElementById('user-translation').value = '';
        
        // Reset toggle buttons
        const btnShowHint = document.getElementById('btn-show-hint');
        const btnShowAnswer = document.getElementById('btn-show-answer');
        if (btnShowHint) btnShowHint.textContent = '💡 显示单词提示';
        if (btnShowAnswer) btnShowAnswer.textContent = '📖 显示标准翻译';
    }
    
    findNextLetterWithWords() {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        const currentIdx = letters.indexOf(this.letterFilter);
        
        for (let i = 1; i < letters.length; i++) {
            const nextIdx = (currentIdx + i) % letters.length;
            const nextLetter = letters[nextIdx];
            const words = this.words.filter(w => 
                (w.first_letter || w.word[0].toUpperCase()) === nextLetter
            );
            if (words.length > 0) {
                this.letterFilter = nextLetter;
                this.updateLetterWords();
                // Update UI
                this.renderLetterFilter();
                return;
            }
        }
    }
    
    renderPracticeCard(modeLabel = '') {
        const word = this.currentPracticeWord;
        if (!word) return;
        
        const level = LevelSystem.getLevel(word.correct_count || 0);
        const levelName = LevelSystem.getLevelName(level);
        
        // Generate highlighted example sentence
        this.currentExampleIndex = ExampleGenerator._lastTemplateIndex;
        const highlightedExample = ExampleGenerator.generateHighlighted(word, this.currentExampleIndex);
        
        // Update word display
        document.getElementById('practice-word').textContent = word.word;
        
        // Show phonetic if available
        const phoneticEl = document.getElementById('practice-phonetic');
        if (word.phonetic) {
            phoneticEl.textContent = `[${word.phonetic}]`;
            phoneticEl.style.display = 'inline';
        } else {
            phoneticEl.style.display = 'none';
        }
        
        // Show mode label + level info
        const levelText = modeLabel ? `${modeLabel} | ${levelName}` : levelName;
        document.getElementById('practice-level').textContent = `${levelText} (答对${word.correct_count || 0}次)`;
        
        // Render highlighted example
        const sentenceEl = document.getElementById('example-sentence');
        sentenceEl.innerHTML = highlightedExample;
        
        // Set answer hint content (but don't show automatically)
        document.getElementById('hint-word').textContent = word.word;
        document.getElementById('hint-meaning').textContent = `— ${word.meaning}`;
        
        // Reset toggle buttons
        const btnShowHint = document.getElementById('btn-show-hint');
        const btnShowAnswer = document.getElementById('btn-show-answer');
        if (btnShowHint) btnShowHint.textContent = '💡 显示单词提示';
        if (btnShowAnswer) btnShowAnswer.textContent = '📖 显示标准翻译';
        
        // Hide hint and answer areas
        document.getElementById('answer-hint').style.display = 'none';
        document.getElementById('standard-answer').style.display = 'none';
    }
    
    refreshExample() {
        const word = this.currentPracticeWord;
        if (!word) return;
        
        const sentenceEl = document.getElementById('example-sentence');
        const refreshBtn = document.getElementById('btn-refresh-example');
        
        // Animate refresh
        sentenceEl.classList.add('refreshing');
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳';
        
        setTimeout(() => {
            // Generate new highlighted example (avoiding current)
            const highlightedExample = ExampleGenerator.generateHighlighted(word, this.currentExampleIndex);
            sentenceEl.innerHTML = highlightedExample;
            sentenceEl.classList.remove('refreshing');
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 刷新例句';
        }, 300);
    }
    
    async submitTranslation() {
        const userTranslation = document.getElementById('user-translation').value.trim();
        if (!userTranslation) {
            alert('请输入翻译内容');
            return;
        }
        
        const word = this.currentPracticeWord;
        const evaluationDiv = document.getElementById('ai-evaluation');
        const evaluationContent = document.getElementById('evaluation-content');
        
        evaluationDiv.style.display = 'block';
        evaluationContent.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><span>AI评判中...</span></div>';
        
        try {
            let result;
            
            if (this.settings.apiKey) {
                // Use real AI API
                result = await this.callAIAPI(word, userTranslation);
            } else {
                // Use local evaluation
                result = this.localEvaluate(word, userTranslation);
            }
            
            this.displayEvaluation(result);
            
            // Show standard answer
            this.showStandardAnswer(word);
            
            // Update word progress
            if (result.score >= 60) {
                word.correct_count = (word.correct_count || 0) + 1;
                Storage.addActivity({
                    type: 'correct',
                    word: word.word,
                    message: `正确翻译了 "${word.word}"`
                });
            } else {
                word.wrong_count = (word.wrong_count || 0) + 1;
                Storage.addActivity({
                    type: 'wrong',
                    word: word.word,
                    message: `翻译 "${word.word}" 需要改进`
                });
            }
            
            // Save updated words
            Storage.saveWords(this.words);
            
        } catch (error) {
            evaluationContent.innerHTML = `<div style="color: var(--error);">评判出错: ${error.message}</div>`;
        }
    }
    
    localEvaluate(word, userTranslation) {
        const meaning = word.meaning.toLowerCase();
        const user = userTranslation.toLowerCase();
        
        // Simple keyword matching
        const keywords = meaning.split(/[；;，,、\s]+/).filter(k => k.length >= 2);
        let matched = 0;
        
        keywords.forEach(keyword => {
            if (user.includes(keyword) || keyword.includes(user)) {
                matched++;
            }
        });
        
        const matchRate = keywords.length > 0 ? matched / keywords.length : 0;
        let score = Math.round(matchRate * 100);
        
        // Adjust score
        if (user.length < 2) score = Math.min(score, 20);
        if (matchRate >= 0.8) score = Math.min(100, score + 10);
        
        let feedback;
        if (score >= 90) {
            feedback = '太棒了！你的翻译非常准确，完全理解了单词的含义。';
        } else if (score >= 70) {
            feedback = '很好！你的翻译基本正确，但还可以更精确一些。';
        } else if (score >= 50) {
            feedback = '还不错，你的翻译抓住了部分含义，建议再学习一下这个单词的用法。';
        } else {
            feedback = `需要加油哦！这个单词的意思是"${word.meaning}"，建议多加记忆。`;
        }
        
        return { score, feedback, isLocal: true };
    }
    
    async callAIAPI(word, userTranslation) {
        const apiKey = this.settings.apiKey;
        const example = document.getElementById('example-sentence').textContent;
        
        const prompt = `请评判以下英语单词翻译的准确性，给出0-100分的评分和详细反馈。

单词: ${word.word}
标准释义: ${word.meaning}
例句: ${example}
用户翻译: ${userTranslation}

请以JSON格式返回：
{
  "score": 分数,
  "feedback": "详细反馈建议"
}`;

        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'qwen-turbo',
                input: {
                    messages: [
                        { role: 'system', content: '你是一个专业的英语翻译评判助手。' },
                        { role: 'user', content: prompt }
                    ]
                },
                parameters: {
                    result_format: 'message'
                }
            })
        });
        
        if (!response.ok) {
            throw new Error('API请求失败');
        }
        
        const data = await response.json();
        const content = data.output?.choices?.[0]?.message?.content || '';
        
        // Try to parse JSON from response
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return { score: result.score, feedback: result.feedback, isLocal: false };
            }
        } catch (e) {
            // Fallback: extract score and feedback manually
        }
        
        // Fallback evaluation
        return this.localEvaluate(word, userTranslation);
    }
    
    displayEvaluation(result) {
        const content = document.getElementById('evaluation-content');
        const scoreClass = result.score >= 80 ? 'high' : result.score >= 60 ? 'medium' : 'low';
        
        content.innerHTML = `
            <div class="score ${scoreClass}">得分: ${result.score}分</div>
            <div class="feedback">${result.feedback}</div>
            ${result.isLocal ? '<small style="color: var(--text-muted);">（本地评判，设置API Key可使用AI评判）</small>' : ''}
        `;
    }
    
    showStandardAnswer(word) {
        const answerText = document.getElementById('standard-answer-text');
        
        // Generate a reference translation for the example sentence
        const exampleText = document.getElementById('example-sentence').textContent;
        const referenceTranslation = this.generateReferenceTranslation(word, exampleText);
        
        answerText.textContent = `${word.word}：${word.meaning}`;
        if (referenceTranslation) {
            answerText.textContent += `\n例句参考翻译：${referenceTranslation}`;
        }
        // Don't show automatically - user must click button
    }
    
    generateReferenceTranslation(word, exampleText) {
        // Simple reference translation based on the example template
        const templates = {
            'plays an important role': '在...中扮演重要角色',
            "don't understand": '不理解',
            'true meaning': '真正含义',
            'explained the concept': '解释了...的概念',
            'need to know': '需要知道',
            'use correctly': '正确使用',
            'often discussed': '经常被讨论',
            'is essential for': '对...至关重要',
            'used to express': '用来表达',
            'should practice': '应该练习',
            'has changed over time': '随着时间的推移发生了变化',
            'refers to': '指的是',
            'pay attention to': '注意',
            'taken measures': '采取措施',
            'deal with': '处理',
            'widely acknowledged': '被广泛认可',
            'significant impact': '重大影响',
            'lead to': '导致',
            'hot topic': '热门话题',
            'tried to': '试图',
            'decided to': '决定',
            'key skill': '关键技能',
            'biggest challenges': '最大的挑战',
            'effectively': '有效地',
            'comprehensive analysis': '全面分析',
            'ability to': '...的能力',
            'considered': '被认为是'
        };
        
        let translation = '';
        for (const [eng, chn] of Object.entries(templates)) {
            if (exampleText.toLowerCase().includes(eng)) {
                translation += chn + '；';
            }
        }
        
        return translation ? translation.slice(0, -1) : '（参考例句上下文理解单词含义）';
    }
    
    // ===== 语音功能 =====
    speakText(text) {
        if (!text || !window.speechSynthesis) {
            console.warn('Speech synthesis not supported');
            return;
        }
        
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        utterance.pitch = 1;
        
        // Find a good English voice
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
            || voices.find(v => v.lang.startsWith('en'))
            || voices[0];
        if (enVoice) {
            utterance.voice = enVoice;
        }
        
        // Visual feedback
        const wordBtn = document.getElementById('btn-speak-word');
        const exampleBtn = document.getElementById('btn-speak-example');
        
        utterance.onstart = () => {
            if (text === (this.currentPracticeWord?.word || '')) {
                wordBtn?.classList.add('playing');
            } else {
                exampleBtn?.classList.add('playing');
            }
        };
        
        utterance.onend = () => {
            wordBtn?.classList.remove('playing');
            exampleBtn?.classList.remove('playing');
        };
        
        utterance.onerror = () => {
            wordBtn?.classList.remove('playing');
            exampleBtn?.classList.remove('playing');
        };
        
        window.speechSynthesis.speak(utterance);
    }
    
    // ===== 阅读练习功能 =====
    switchReadingMode(mode) {
        this.readingDifficulty = mode;
        document.querySelectorAll('[data-reading-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.readingMode === mode);
        });
        this.generateNewPassage();
    }
    
    generateNewPassage() {
        // Start timer for reading
        this.startTimer('reading');
        
        if (this.useAIReading) {
            this.generateAIPassage();
            return;
        }
        
        // Select words based on difficulty
        const wordCounts = { easy: 8, medium: 12, hard: 16 };
        const count = wordCounts[this.readingDifficulty] || 10;
        
        const selectedWords = [];
        const usedIndices = new Set();
        while (selectedWords.length < count && usedIndices.size < this.words.length) {
            const idx = Math.floor(Math.random() * this.words.length);
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                selectedWords.push(this.words[idx]);
            }
        }
        
        // Generate passage using templates
        const passage = this.buildPassage(selectedWords);
        this.currentPassage = passage;
        this.readingAnswers = {};
        this.readingCurrentQuestion = 0;
        
        // Render
        this.renderPassage(passage);
        this.renderQuestions(passage.questions);
        
        // Hide result and source switch, reset nav item colors
        document.getElementById('reading-result').style.display = 'none';
        document.getElementById('reading-card').style.display = 'block';
        document.getElementById('reading-source-switch').style.display = 'none';
        document.querySelectorAll('.reading-nav-item').forEach(item => {
            item.classList.remove('nav-correct', 'nav-wrong');
        });
    }

    async generateAIPassage() {
        this.showLoading('AI正在生成阅读文章...');
        try {
            const topicMap = ['社会热点', '教育学习', '科技发展', '环境保护', '文化传承', '经济发展', '健康生活', '职业规划'];
            const topic = topicMap[Math.floor(Math.random() * topicMap.length)];
            const result = await agentClient.generateReading(topic, this.readingDifficulty || 'medium');
            
            if (result.success && result.data && result.data.exercise) {
                const ex = result.data.exercise;
                const passage = {
                    title: ex.title || 'AI生成阅读文章',
                    theme: topic,
                    paragraphs: ex.paragraphs || [],
                    questions: (ex.questions || []).map((q, i) => ({
                        number: i + 1,
                        question: q.question || '',
                        options: (q.options || []).map((o, j) => ({
                            label: String.fromCharCode(65 + j),
                            text: o,
                            cn: ''
                        })),
                        correct: q.correctIndex !== undefined ? String.fromCharCode(65 + q.correctIndex) : 'A',
                        explanation: q.explanation || '',
                        cn: q.explanation || ''
                    })),
                    summary: ex.summary || '',
                    keyWords: ex.keyWords || []
                };
                
                this.currentPassage = passage;
                this.readingAnswers = {};
                this.readingCurrentQuestion = 0;
                this.renderPassage(passage);
                this.renderQuestions(passage.questions);

                document.getElementById('reading-result').style.display = 'none';
                document.getElementById('reading-card').style.display = 'block';
                document.getElementById('reading-source-switch').style.display = 'none';
                document.querySelectorAll('.reading-nav-item').forEach(item => {
                    item.classList.remove('nav-correct', 'nav-wrong');
                });
            } else {
                throw new Error(result.errorMessage || 'AI生成失败');
            }
        } catch (err) {
            console.error('AI生成失败，切换回本地模板', err);
            this.useAIReading = false;
            this.generateNewPassage();
        } finally {
            this.hideLoading();
        }
    }

    // ===== 种子随机数生成器 =====
    /**
     * 基于字符串种子创建可重复的伪随机数生成器 (Mulberry32)
     * @param {string} seed - 种子字符串
     * @returns {Function} 返回 0~1 之间的伪随机数
     */
    createSeededRandom(seed) {
        // 将字符串转换为数字种子
        let hash = 0;
        const str = String(seed);
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // 转为32位整数
        }
        // Mulberry32 PRNG
        let state = hash >>> 0;
        return function() {
            state += 0x6D2B79F5;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * 使用种子的 Fisher-Yates 洗牌
     */
    seededShuffle(arr, seed) {
        const rng = this.createSeededRandom(seed + '_shuffle');
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    buildPassage(words) {
        // Pick a theme based on the words
        const themes = [
            { name: 'Campus Life', templates: [
                { en: 'The transition from high school to {word1} is one of the most significant milestones in a young person\'s life. For many students, entering {word2} means living away from home for the first time, managing their own schedule, and making new friends from diverse backgrounds. Universities today offer a wide range of activities and organizations that help students {word3} both academically and socially. However, this newfound freedom can also be overwhelming, as students must learn to balance their studies with personal responsibilities.', cn: '从高中到大学的过渡是年轻人生命中最重要的里程碑之一。对许多学生来说，进入大学意味着第一次离开家生活，管理自己的时间表，并与来自不同背景的人交朋友。如今的大学提供各种各样的活动和组织，帮助学生在学业和社交方面都能适应。然而，这种新获得的自由也可能令人不知所措，因为学生必须学会平衡学业和个人责任。' },
                { en: 'Academic life presents its own set of challenges. Unlike high school, university courses require students to {word4} independently and think critically about complex topics. Many professors encourage students to participate in {word5} and challenge established theories. The ability to {word6} effectively is considered one of the most valuable skills a student can develop. Students who actively engage in class discussions and seek help during office hours tend to perform better throughout their academic careers.', cn: '学术生活带来了自身的挑战。与高中不同，大学课程要求学生独立学习，并对复杂话题进行批判性思考。许多教授鼓励学生参与课堂讨论，挑战既定理论。有效沟通的能力被认为是学生可以培养的最重要的技能之一。积极参与课堂讨论并在办公时间寻求帮助的学生往往在整个学术生涯中表现更好。' },
                { en: 'Beyond academics, the social aspect of university life plays a crucial role in personal development. Joining student clubs and organizations allows students to {word7} valuable leadership skills and build lasting friendships. Campus events, cultural festivals, and sports competitions create a vibrant community atmosphere. Research has shown that students who are socially active on campus are more likely to {word8} and report higher levels of satisfaction with their university experience.', cn: '除了学业之外，大学生活的社交方面在个人发展中起着至关重要的作用。加入学生社团和组织使学生能够培养宝贵的领导技能并建立持久的友谊。校园活动、文化节和体育比赛营造了充满活力的社区氛围。研究表明，在校园中社交活跃的学生更有可能取得成功，并对他们的大学经历报告更高的满意度。' },
                { en: 'Many universities now emphasize the importance of career preparation from the very first year. Career centers offer workshops on resume writing, interview techniques, and networking strategies. Students are encouraged to pursue {word9} and part-time jobs that relate to their field of study. These experiences not only enhance employability but also help students {word10} their career goals. In an increasingly competitive job market, early career planning has become essential for success.', cn: '许多大学现在从第一年就强调职业准备的重要性。职业中心提供简历写作、面试技巧和社交策略的研讨会。学生被鼓励追求实习和与其学习领域相关的兼职工作。这些经历不仅提高了就业能力，还帮助学生明确他们的职业目标。在日益竞争激烈的就业市场中，早期职业规划已成为成功的关键。' },
                { en: 'International students face unique challenges when studying abroad. Adapting to a new {word1} requires patience, cultural sensitivity, and a willingness to embrace different perspectives. Universities that provide dedicated support services for international students tend to have higher {word2} and more diverse campus communities. These students enrich the educational experience for everyone by sharing their unique cultural backgrounds and viewpoints, fostering a truly global learning environment.', cn: '国际学生在国外学习时面临独特的挑战。适应新的文化环境需要耐心、文化敏感性和接受不同观点的意愿。为国际学生提供专门支持服务的大学往往有更高的满意度和更多样化的校园社区。这些学生通过分享他们独特的文化背景和观点，丰富了每个人的教育体验，营造了真正的全球学习环境。' },
                { en: 'Financial pressure is a significant concern for many college students today. The rising cost of tuition, textbooks, and living expenses has led to increased reliance on scholarships, grants, and student loans. Many students must balance their academic responsibilities with part-time employment to {word1} their education. Universities are responding by expanding financial aid programs and offering more {word2} opportunities to help students manage the cost of higher education without compromising their academic performance.', cn: '经济压力是当今许多大学生的重要关切。不断上涨的学费、教科书费用和生活费用导致学生更加依赖奖学金、助学金和学生贷款。许多学生必须在学业责任和兼职工作之间取得平衡，以资助他们的教育。大学正在通过扩大经济援助项目和提供更多工作机会来应对，帮助学生管理高等教育的费用，同时不影响他们的学业表现。' },
                { en: 'Campus safety and health services have become increasingly important priorities for universities. Institutions are investing in improved security measures, including campus police, emergency notification systems, and well-lit pathways. Health centers provide students with access to medical care, counseling services, and {word1} programs. Students who take advantage of these resources tend to {word2} better during their college years, demonstrating the vital role that institutional support plays in student well-being and academic success.', cn: '校园安全和健康服务已成为大学越来越重要的优先事项。各机构正在投资于改进的安全措施，包括校园警察、紧急通知系统和照明良好的道路。健康中心为学生提供医疗、咨询服务和心理健康项目。利用这些资源的学生在大学期间往往表现更好，这证明了机构支持在学生福祉和学业成功中发挥的重要作用。' },
                { en: 'The value of a strong alumni network becomes most apparent after graduation. Universities with active alumni associations offer graduates access to mentorship programs, job referrals, and professional networking events. Many alumni generously {word1} their time and expertise to help current students navigate the transition from university to career. Building and maintaining these connections can {word2} a graduate\'s career prospects for years to come, making alumni engagement a mutually beneficial relationship that strengthens the entire university community.', cn: '强大校友网络的价值在毕业后变得最为明显。拥有活跃校友会的大学为毕业生提供指导项目、工作推荐和专业社交活动的机会。许多校友慷慨地贡献他们的时间和专业知识，帮助在校学生顺利度过从大学到职场的过渡。建立和维护这些联系可以在未来几年改善毕业生的职业前景，使校友参与成为一种互惠互利的关系，加强整个大学社区。' }
            ]},
            { name: 'Workplace Essentials', templates: [
                { en: 'Entering the workforce for the first time can be both exciting and daunting. New employees must quickly adapt to the {word1} of their organization, which often differs significantly from the academic environment they are used to. Understanding workplace culture, learning to communicate professionally, and building relationships with colleagues are all essential skills for career success. Many companies now offer {word2} programs to help new hires transition smoothly into their roles.', cn: '第一次进入职场既令人兴奋又令人畏惧。新员工必须迅速适应所在组织的文化，这通常与他们习惯的学术环境有很大不同。理解职场文化、学习专业沟通以及与同事建立关系都是职业成功的基本技能。许多公司现在提供入职培训项目，帮助新员工顺利过渡到他们的角色。' },
                { en: 'Effective communication is perhaps the most critical skill in any workplace. Employees who can {word3} clearly and concisely are more likely to advance in their careers. This includes not only verbal communication but also written correspondence, presentations, and digital communication. In today\'s globalized economy, the ability to {word4} across cultural boundaries has become increasingly important. Many organizations invest heavily in training programs to improve their employees\' communication skills.', cn: '有效沟通也许是任何职场中最关键的技能。能够清晰简洁地表达观点的员工更有可能在职业生涯中取得进步。这不仅包括口头沟通，还包括书面信函、演讲和数字沟通。在当今全球化的经济中，跨文化沟通的能力变得越来越重要。许多组织大力投资于培训项目，以提高员工的沟通技能。' },
                { en: 'Time management and productivity are also key concerns for professionals. The ability to {word5} tasks effectively can significantly impact both individual performance and team outcomes. Many successful professionals attribute their achievements to自律的工作习惯和即使在压力下也能保持专注的能力. Modern workplaces are increasingly adopting flexible work arrangements, which require employees to be self-motivated and capable of managing their own schedules without constant supervision.', cn: '时间管理和生产力也是专业人士的关键关注点。有效安排任务的能力可以显著影响个人表现和团队成果。许多成功的专业人士将他们的成就归功于自律的工作习惯和即使在压力下也能保持专注的能力。现代工作场所越来越多地采用灵活的工作安排，这要求员工具有自我激励的能力，并能够在没有持续监督的情况下管理自己的时间表。' },
                { en: 'Career development is a lifelong process that requires continuous learning and adaptation. Professionals who regularly {word7} new skills and stay updated with industry trends are better positioned for advancement opportunities. Many companies support employee development through {word8} programs, conference attendance, and mentorship initiatives. Building a strong professional network is equally important, as it can open doors to new opportunities and provide valuable guidance throughout one\'s career journey.', cn: '职业发展是一个需要持续学习和适应的终身过程。定期学习新技能并紧跟行业趋势的专业人士更有可能获得晋升机会。许多公司通过培训项目、参加会议和指导计划来支持员工发展。建立强大的职业人脉同样重要，因为它可以为新机会打开大门，并在整个职业生涯中提供宝贵的指导。' },
                { en: 'The rise of remote work and hybrid work models has transformed the modern workplace. Advances in technology have made it possible for employees to {word1} effectively from virtually anywhere, reducing commute times and increasing flexibility. However, remote work also presents challenges, including feelings of isolation and difficulty separating work from personal life. Companies that establish clear {word2} policies and invest in collaboration tools tend to maintain higher productivity and employee satisfaction in distributed work environments.', cn: '远程工作和混合工作模式的兴起已经改变了现代工作场所。技术的进步使员工几乎可以在任何地方有效协作，减少了通勤时间并增加了灵活性。然而，远程工作也带来了挑战，包括孤独感以及难以将工作与个人生活分开。建立明确远程工作政策并投资于协作工具的公司，往往在分布式工作环境中保持更高的生产力和员工满意度。' },
                { en: 'Workplace diversity and inclusion have become central themes in organizational strategy. Companies that prioritize creating a {word1} workforce benefit from a wider range of perspectives and ideas, which can drive innovation and improve decision-making. Many organizations have established dedicated diversity initiatives and training programs to {word2} bias and promote equal opportunities. Employees who feel valued and included are more engaged and committed to their organization\'s mission and goals.', cn: '职场多元化和包容性已成为组织战略的核心主题。优先考虑创建多元化员工队伍的公司受益于更广泛的视角和想法，这可以推动创新并改善决策。许多组织已建立专门的多元化倡议和培训项目，以减少偏见并促进平等机会。感到被重视和包容的员工更有参与度，并更致力于实现组织的使命和目标。' },
                { en: 'Achieving a healthy work-life balance is essential for long-term career sustainability and personal well-being. Professionals who consistently work long hours without adequate rest are at risk of {word1} and decreased productivity. Many companies now offer flexible scheduling, generous leave policies, and wellness programs to help employees {word2} their professional and personal commitments. Setting clear boundaries between work and personal time has become a critical skill for maintaining both career成功 and overall life satisfaction.', cn: '实现健康的工作与生活平衡对于长期职业可持续性和个人福祉至关重要。持续长时间工作而没有充分休息的专业人士面临倦怠和生产力下降的风险。许多公司现在提供灵活的时间安排、慷慨的休假政策和健康计划，以帮助员工平衡他们的职业和个人承诺。在工作和个人时间之间设定明确的界限，已成为保持职业成功和整体生活满意度的关键技能。' },
                { en: 'Lifelong learning and continuous skill development have become necessities in today\'s rapidly evolving job market. Technological advancements and shifting industry demands require professionals to regularly {word1} their knowledge and acquire new competencies. Online courses, professional certifications, and industry workshops provide accessible avenues for career growth. Employers increasingly value candidates who demonstrate a commitment to {word2} and adaptability, making continuous education a key differentiator in competitive job markets across all sectors.', cn: '终身学习和持续技能发展已成为当今快速变化的就业市场的必需品。技术进步和不断变化的行业需求要求专业人士定期更新知识并获得新能力。在线课程、专业认证和行业研讨会为职业发展提供了便捷的途径。雇主越来越重视表现出对学习和适应性承诺的候选人，使持续教育成为各行业竞争激烈的就业市场中的关键差异化因素。' }
            ]},
            { name: 'Social Media Influence', templates: [
                { en: 'Social media has fundamentally transformed how people communicate, access information, and form opinions. Platforms like Facebook, Twitter, and Instagram have become integral parts of daily life for billions of users worldwide. The ability to {word1} with people across the globe has created unprecedented opportunities for connection and collaboration. However, the rapid spread of information on these platforms has also raised concerns about the {word2} of news and the potential for misinformation to influence public opinion.', cn: '社交媒体从根本上改变了人们交流、获取信息和形成观点的方式。Facebook、Twitter和Instagram等平台已成为全球数十亿用户日常生活中不可或缺的一部分。与世界各地的人联系的能力创造了前所未有的连接和协作机会。然而，这些平台上信息的快速传播也引发了人们对新闻准确性的担忧，以及错误信息可能影响公众舆论的潜在风险。' },
                { en: 'The psychological impact of social media is a topic of growing concern among researchers. Studies have shown that excessive social media use can contribute to feelings of anxiety, depression, and low self-esteem, particularly among young people. The tendency to {word3} one\'s life with the carefully curated highlights of others can create unrealistic expectations and dissatisfaction. Experts recommend that users develop healthy habits, such as {word4} screen time and engaging in meaningful offline activities, to maintain their mental well-being in the digital age.', cn: '社交媒体对心理的影响是研究人员日益关注的话题。研究表明，过度使用社交媒体可能导致焦虑、抑郁和自卑感，尤其是在年轻人中。将自己的生活与他人精心策划的精彩片段进行比较的倾向可能产生不切实际的期望和不满。专家建议用户养成健康的习惯，例如限制屏幕时间并参与有意义的线下活动，以在数字时代保持心理健康。' },
                { en: 'From a business perspective, social media has revolutionized marketing and advertising. Companies now use sophisticated algorithms to {word5} consumer behavior and deliver personalized advertisements. The rise of influencer marketing has created new career opportunities, while also raising questions about authenticity and transparency. Consumers are becoming increasingly aware of how their personal data is collected and used, leading to growing demands for {word6} and stronger privacy protections.', cn: '从商业角度来看，社交媒体彻底改变了营销和广告。公司现在使用复杂的算法来分析消费者行为并投放个性化广告。网红营销的兴起创造了新的职业机会，同时也引发了关于真实性和透明度的问题。消费者越来越意识到他们的个人数据是如何被收集和使用的，导致对问责制和更强隐私保护的需求不断增长。' },
                { en: 'Education systems around the world are grappling with the role of social media in learning. While these platforms can facilitate collaboration and resource sharing, they can also serve as sources of {word7} during study time. Schools and universities are developing policies to help students use social media responsibly. The concept of digital literacy has become an essential component of modern education, teaching students to {word8} information critically and engage with online content in a thoughtful manner.', cn: '世界各地的教育系统正在努力应对社交媒体在学习中的作用。虽然这些平台可以促进协作和资源共享，但它们也可能在学习时间成为干扰的来源。学校和大学正在制定政策，帮助学生负责任地使用社交媒体。数字素养的概念已成为现代教育的重要组成部分，教导学生批判性地评估信息，并以深思熟虑的方式参与在线内容。' },
                { en: 'Cyberbullying and online safety have emerged as serious concerns in the digital age. The anonymity provided by social media platforms can embolden individuals to {word1} others in ways they might not in face-to-face interactions. Victims of cyberbullying often experience significant emotional distress, which can affect their academic performance, social relationships, and mental health. Schools, parents, and tech companies are working together to {word2} online harassment and create safer digital environments for users of all ages.', cn: '网络欺凌和在线安全已成为数字时代的严重关切。社交媒体平台提供的匿名性可能使个人敢于以面对面互动中不会采用的方式骚扰他人。网络欺凌的受害者经常经历严重的情绪困扰，这可能影响他们的学业表现、社交关系和心理健康。学校、家长和技术公司正在共同努力打击网络骚扰，并为所有年龄段的用户创造更安全的数字环境。' },
                { en: 'The impact of social media on adolescents has drawn particular attention from psychologists and educators. Teenagers who spend excessive time on social platforms may experience {word1} in their social development and self-image formation. The pressure to maintain a perfect online persona can lead to anxiety and feelings of inadequacy. Experts suggest that parents should actively {word2} their children\'s social media use and encourage open conversations about the difference between curated online content and reality.', cn: '社交媒体对青少年的影响引起了心理学家和教育工作者的特别关注。在社交平台花费过多时间的青少年可能在社交发展和自我形象形成方面遇到延迟。维持完美在线形象的压力可能导致焦虑和无能感。专家建议家长应积极监督孩子的社交媒体使用，并鼓励就精心策划的在线内容与现实之间的差异进行公开对话。' },
                { en: 'The way people consume news has been dramatically altered by social media algorithms. These platforms are designed to {word1} content that aligns with users\' existing beliefs, potentially creating echo chambers that limit exposure to diverse viewpoints. The phenomenon of information overload has made it increasingly difficult for individuals to {word2} reliable sources from misinformation. Media literacy education is becoming essential to help people navigate the complex digital information landscape and make informed decisions.', cn: '人们消费新闻的方式已被社交媒体算法彻底改变。这些平台旨在推荐与用户现有信念一致的内容，可能制造限制接触多元观点的回音室。信息过载现象使个人越来越难以区分可靠来源和错误信息。媒体素养教育正变得至关重要，以帮助人们在复杂的数字信息环境中导航并做出明智的决定。' },
                { en: 'Looking ahead, social media continues to evolve at a rapid pace. Emerging technologies such as virtual reality, augmented reality, and artificial intelligence are poised to {word1} how people interact online. New platforms are constantly emerging, each offering innovative ways to connect and share content. The challenge for society will be to {word2} these technological advances with appropriate regulations and ethical guidelines that protect users while preserving the benefits of digital communication and community building.', cn: '展望未来，社交媒体继续快速发展。虚拟现实、增强现实和人工智能等新兴技术有望改变人们在线互动的方式。新平台不断涌现，每个平台都提供创新的连接和分享内容的方式。社会面临的挑战将是如何平衡这些技术进步与适当的法规和道德准则，在保护用户的同时保留数字沟通和社区建设的益处。' }
            ]},
            { name: 'Environmental Behavior', templates: [
                { en: 'Environmental awareness has grown significantly in recent years, with more people adopting sustainable practices in their daily lives. From reducing plastic waste to conserving energy, individuals are increasingly taking responsibility for their environmental {word1}. Governments worldwide have implemented policies to encourage {word2}, such as banning single-use plastics and promoting renewable energy sources. These efforts reflect a growing recognition that collective action is necessary to address pressing environmental challenges.', cn: '近年来，环保意识显著增强，越来越多的人在日常生活中采取可持续的做法。从减少塑料垃圾到节约能源，个人越来越重视承担环境责任。世界各国政府已实施政策鼓励环保行为，例如禁止一次性塑料并推广可再生能源。这些努力反映了人们日益认识到，集体行动对于应对紧迫的环境挑战是必要的。' },
                { en: 'Consumer behavior plays a significant role in environmental sustainability. The choices people make about what to buy, how to travel, and what to eat all have environmental consequences. The concept of {word3} has gained popularity, encouraging consumers to consider the full lifecycle of products before making purchases. Many companies are responding to consumer demand by adopting {word4} practices, reducing packaging waste, and offering more environmentally friendly product options.', cn: '消费行为在环境可持续性中发挥着重要作用。人们在购买什么、如何出行以及吃什么方面所做的选择都会对环境产生影响。绿色消费的概念越来越受欢迎，鼓励消费者在购买前考虑产品的完整生命周期。许多公司正在响应消费者需求，采取环保做法，减少包装浪费，并提供更环保的产品选择。' },
                { en: 'Urban planning and development are also evolving to prioritize environmental considerations. Green building standards, expanded public transportation networks, and the creation of urban green spaces are becoming increasingly common features of modern cities. The ability to {word5} effectively is crucial for creating livable communities that balance economic growth with环境保护. Many cities are investing in smart technologies to {word6} resource use and reduce their carbon footprint.', cn: '城市规划和发展也在不断演变，以优先考虑环境因素。绿色建筑标准、扩大的公共交通网络以及城市绿地的创建正成为现代城市越来越常见的特征。有效规划的能力对于创建平衡经济增长与环境保护的宜居社区至关重要。许多城市正在投资智能技术，以优化资源使用并减少碳足迹。' },
                { en: 'Education is widely recognized as a key factor in promoting environmental awareness. Schools and universities are incorporating sustainability topics into their curricula, helping students understand the {word7} of their actions on the planet. Community programs and public campaigns also play an important role in encouraging people to adopt more sustainable lifestyles. The challenge lies in translating awareness into action, ensuring that knowledge about environmental issues leads to meaningful changes in {word8}.', cn: '教育被广泛认为是促进环保意识的关键因素。学校和大学正在将可持续性主题纳入课程，帮助学生理解他们的行为对地球的影响。社区项目和公共宣传活动在鼓励人们采取更可持续的生活方式方面也发挥着重要作用。挑战在于将意识转化为行动，确保关于环境问题的知识能导致行为上的有意义的改变。' },
                { en: 'The transition to renewable energy sources has accelerated dramatically in recent years. Solar, wind, and hydropower are increasingly replacing fossil fuels as the primary sources of electricity generation. Many countries have set ambitious targets to {word1} their carbon emissions and achieve energy独立. Advances in battery storage and grid technology are making it easier to {word2} renewable energy into existing power infrastructure, bringing the world closer to a sustainable energy future.', cn: '向可再生能源的过渡近年来急剧加速。太阳能、风能和水力发电正日益取代化石燃料，成为主要的发电来源。许多国家已设定了雄心勃勃的目标，以减少碳排放并实现能源独立。电池储能和电网技术的进步使将可再生能源整合到现有电力基础设施中变得更加容易，使世界更接近可持续能源的未来。' },
                { en: 'Food waste and sustainable dietary choices represent significant environmental challenges. Approximately one-third of all food produced globally is wasted, contributing to greenhouse gas emissions and resource depletion. Consumers can make a meaningful difference by choosing to {word1} locally sourced, seasonal produce and reducing meat consumption. The growing popularity of plant-based diets and farm-to-table movements reflects an increasing awareness of the connection between dietary habits and {word2}.', cn: '食物浪费和可持续的饮食选择代表了重大的环境挑战。全球生产的所有食物中约有三分之一被浪费，这导致温室气体排放和资源枯竭。消费者可以通过选择购买本地采购的季节性农产品并减少肉类消费来做出有意义的改变。植物性饮食和从农场到餐桌运动的日益流行，反映了人们对饮食习惯与环境影响之间联系的日益认识。' },
                { en: 'Biodiversity loss is one of the most critical environmental threats facing the planet today. Habitat destruction, pollution, and climate change are driving many species toward extinction at an alarming rate. Conservation organizations are working to {word1} endangered ecosystems and protect wildlife through habitat restoration and anti-poaching efforts. Individuals can contribute to biodiversity preservation by supporting conservation initiatives and making choices that {word2} natural habitats in their daily lives.', cn: '生物多样性丧失是当今地球面临的最严峻环境威胁之一。栖息地破坏、污染和气候变化正使许多物种以惊人的速度走向灭绝。保护组织正在努力恢复濒危生态系统，并通过栖息地恢复和反偷猎工作来保护野生动物。个人可以通过支持保护倡议并在日常生活中做出保护自然栖息地的选择，为生物多样性保护做出贡献。' },
                { en: 'Individual actions, when multiplied across millions of people, can have a profound impact on the environment. Simple changes such as reducing energy consumption, recycling, using public transportation, and conserving water can collectively {word1} significant environmental benefits. The key is to make sustainable choices a consistent part of daily routines rather than occasional gestures. Environmental advocates emphasize that every person has the power to {word2} through their daily decisions, creating a ripple effect that inspires others to adopt more sustainable practices.', cn: '当个人行动乘以数百万人时，可以对环境产生深远的影响。简单的改变，如减少能源消耗、回收利用、使用公共交通和节约用水，可以共同产生显著的环境效益。关键是将可持续选择作为日常惯例的一致部分，而不是偶尔的姿态。环保倡导者强调，每个人都有能力通过日常决策做出贡献，创造涟漪效应，激励他人采取更可持续的做法。' }
            ]},
            { name: 'Health and Psychology', templates: [
                { en: 'Mental health has become a major topic of public discussion in recent years. Increased awareness has helped reduce the stigma surrounding conditions such as depression, anxiety, and stress-related disorders. Many workplaces and educational institutions now offer {word1} programs to support mental well-being. The importance of seeking professional help when needed is now widely recognized, and access to mental health services has improved in many communities. However, challenges remain in ensuring that adequate resources are available to meet the growing demand.', cn: '近年来，心理健康已成为公众讨论的主要话题。意识的提高有助于减少对抑郁症、焦虑症和压力相关疾病等状况的污名化。许多工作场所和教育机构现在提供心理咨询项目来支持心理健康。现在人们普遍认识到在需要时寻求专业帮助的重要性，许多社区获得心理健康服务的机会也有所改善。然而，确保有足够的资源来满足不断增长的需求仍然面临挑战。' },
                { en: 'The relationship between physical health and mental well-being is well documented. Regular exercise, a balanced diet, and adequate sleep all contribute to better mental health outcomes. Research has shown that people who maintain a healthy lifestyle are better able to {word2} the challenges of daily life. The concept of {word3} emphasizes the connection between mind and body, encouraging individuals to take a holistic approach to their health. Healthcare providers are increasingly incorporating mental health screenings into routine checkups.', cn: '身体健康与心理健康之间的关系有充分的文献记载。定期锻炼、均衡饮食和充足睡眠都有助于改善心理健康状况。研究表明，保持健康生活方式的人更能应对日常生活的挑战。整体健康的概念强调身心之间的联系，鼓励个人采取全面的健康方法。医疗服务提供者越来越多地将心理健康筛查纳入常规体检。' },
                { en: 'Workplace stress is a growing concern in today\'s fast-paced economy. Many employees report feeling overwhelmed by the demands of their jobs, leading to burnout and decreased productivity. Companies are exploring various strategies to help employees {word4}, including flexible work arrangements, wellness programs, and stress management workshops. The ability to maintain a healthy work-life balance has become a key factor in job satisfaction and employee retention. Experts emphasize the importance of setting boundaries and {word5} personal time for relaxation and self-care.', cn: '职场压力是当今快节奏经济中日益严重的关切。许多员工报告称，工作的要求让他们感到不堪重负，导致倦怠和生产力下降。公司正在探索各种策略来帮助员工应对压力，包括灵活的工作安排、健康计划和压力管理研讨会。保持健康工作与生活平衡的能力已成为工作满意度和员工留任的关键因素。专家强调设定界限和优先安排个人时间进行放松和自我照顾的重要性。' },
                { en: 'Technology\'s impact on health is a double-edged sword. While digital health tools and telemedicine have improved access to healthcare, excessive screen time and sedentary lifestyles associated with technology use have contributed to various health problems. The phenomenon of {word6} has become increasingly common, with many people experiencing sleep disturbances, eye strain, and posture-related issues. Health professionals recommend regular digital detoxes and ergonomic practices to {word7} the negative effects of technology on physical health. Finding the right balance between leveraging technology\'s benefits and maintaining healthy habits remains an ongoing challenge for modern society.', cn: '科技对健康的影响是一把双刃剑。虽然数字健康工具和远程医疗改善了获得医疗保健的机会，但过度使用屏幕和与技术使用相关的久坐生活方式已导致各种健康问题。数字疲劳现象越来越普遍，许多人经历睡眠障碍、眼睛疲劳和与姿势相关的问题。健康专业人士建议定期进行数字排毒和采用人体工程学做法，以减轻科技对身体健康的负面影响。在利用科技益处和保持健康习惯之间找到适当的平衡，仍然是现代社会面临的持续挑战。' },
                { en: 'Sleep and rest are fundamental pillars of good health that are often overlooked in today\'s busy world. Research consistently shows that adults who get seven to eight hours of quality sleep each night are better able to {word1}, maintain a healthy weight, and ward off chronic diseases. Poor sleep habits have been linked to weakened immune function, impaired memory, and increased risk of cardiovascular problems. Sleep specialists recommend establishing consistent bedtime routines and creating {word2} sleep environments to improve overall sleep quality and daytime functioning.', cn: '睡眠和休息是良好健康的基本支柱，但在当今忙碌的世界中经常被忽视。研究一致表明，每晚获得七到八小时优质睡眠的成年人更能集中注意力、保持健康的体重并预防慢性疾病。不良的睡眠习惯与免疫功能减弱、记忆力受损和心血管疾病风险增加有关。睡眠专家建议建立一致的睡前习惯并创造有利于睡眠的环境，以改善整体睡眠质量和日间功能。' },
                { en: 'Mindfulness meditation and stress management techniques have gained widespread recognition as effective tools for improving mental health. Regular meditation practice can help individuals {word1} by reducing cortisol levels and promoting a sense of inner calm. Many healthcare providers now recommend mindfulness-based interventions as complementary treatments for anxiety, depression, and chronic pain. The growing body of scientific evidence supporting these practices has led to their integration into {word2} programs in schools, workplaces, and healthcare facilities worldwide.', cn: '正念冥想和压力管理技巧已获得广泛认可，成为改善心理健康的有效工具。定期冥想练习可以帮助个人管理压力，通过降低皮质醇水平并促进内心的平静感。许多医疗保健提供者现在推荐基于正念的干预措施，作为焦虑、抑郁和慢性疼痛的辅助治疗方法。越来越多支持这些做法的科学证据促使它们被整合到世界各地学校、工作场所和医疗机构的健康促进项目中。' },
                { en: 'Strong community support and meaningful interpersonal relationships are essential components of psychological well-being. Individuals who maintain close connections with family, friends, and community members tend to {word1} better during difficult times and report higher levels of life满意度. Social isolation, on the other hand, has been linked to increased rates of depression, cognitive decline, and even physical illness. Community organizations and support groups play a vital role in helping people {word2} and build the social connections that are so critical for mental health.', cn: '强大的社区支持和有意义的人际关系是心理健康的重要组成部分。与家人、朋友和社区成员保持密切联系的人往往在困难时期能更好地应对，并报告更高的生活满意度。另一方面，社交孤立与抑郁症发病率增加、认知能力下降甚至身体疾病有关。社区组织和支持团体在帮助人们应对挑战并建立对心理健康至关重要的社会联系方面发挥着至关重要的作用。' },
                { en: 'Health technology and digital health tools are rapidly transforming how people manage their well-being. Wearable fitness trackers, smartphone health apps, and telemedicine platforms have made it easier than ever to {word1} vital health metrics and access medical care remotely. These innovations are particularly valuable for individuals in underserved communities who may have limited access to traditional healthcare facilities. However, experts caution that technology should complement rather than {word2} professional medical advice, emphasizing the importance of using digital health tools as part of a comprehensive approach to health management.', cn: '健康技术和数字健康工具正在迅速改变人们管理自身健康的方式。可穿戴健身追踪器、智能手机健康应用程序和远程医疗平台使监测重要健康指标和远程获得医疗服务变得前所未有的容易。这些创新对于服务不足社区中可能难以获得传统医疗设施的个人尤其有价值。然而，专家警告说，技术应该补充而不是取代专业医疗建议，强调将数字健康工具作为全面健康管理方法一部分的重要性。' }
            ]}
        ];

        // 风格映射：不同风格优先选择不同主题，但auto保持随机
        // 随机选择主题
        let theme = themes[Math.floor(Math.random() * themes.length)];

        // All difficulties use 8 paragraphs for 600-800 words
        const numParagraphs = 8;

        // Shuffle and pick paragraphs
        const shuffledTemplates = [...theme.templates].sort(() => Math.random() - 0.5);
        const selectedParagraphs = shuffledTemplates.slice(0, numParagraphs);

        // Replace placeholders with words from the word bank
        let passageText = '';
        let passageCn = '';
        const usedWords = [];
        let wordIndex = 0;

        selectedParagraphs.forEach((paragraph, pIdx) => {
            let paraText = paragraph.en;
            let paraCn = paragraph.cn;
            // Count placeholders in this paragraph
            const placeholderMatches = paraText.match(/\{word\d+\}/g);
            if (placeholderMatches) {
                placeholderMatches.forEach(placeholder => {
                    if (wordIndex < words.length) {
                        const word = words[wordIndex];
                        paraText = paraText.replace(placeholder, `<span class="highlight-word">${word.word}</span>`);
                        usedWords.push(word);
                        wordIndex++;
                    } else {
                        // Fallback if we run out of words
                        paraText = paraText.replace(placeholder, 'this concept');
                    }
                });
            }
            passageText += paraText + '\n\n';
            passageCn += paraCn + '\n\n';
        });

        // Generate questions
        const questions = this.generateQuestions(usedWords, passageText, theme.name, selectedParagraphs);

        return {
            title: theme.name,
            text: passageText.trim(),
            cnText: passageCn.trim(),
            wordCount: passageText.split(/\s+/).length,
            questions: questions,
            paragraphs: selectedParagraphs
        };
    }

    generateQuestions(words, passageText, theme, paragraphs) {
        const questions = [];

        // 随机数生成器
        const rng = null;

        // Theme Chinese translation map
        const themeCnMap = {
            'Campus Life': '校园生活',
            'Workplace Essentials': '职场基础',
            'Social Media Influence': '社交媒体影响',
            'Environmental Behavior': '环境行为',
            'Health and Psychology': '健康与心理'
        };
        const themeCn = themeCnMap[theme] || theme;

        // Get some words for question generation
        const w0 = words[0] || { word: 'the topic', meaning: '主题' };
        const w1 = words[1] || { word: 'education', meaning: '教育' };
        const w2 = words[2] || { word: 'development', meaning: '发展' };
        const w3 = words[3] || { word: 'society', meaning: '社会' };
        const w4 = words[4] || { word: 'technology', meaning: '技术' };

        // Q1: Main idea
        questions.push({
            text: 'What is the main idea of this passage?',
            textCn: '这篇文章的主旨是什么？',
            options: [
                `The significance of ${w0.word} in the context of ${theme.toLowerCase()} and its impact on individuals and society`,
                `A historical overview of ${theme.toLowerCase()} from ancient times to the present day`,
                `A comparison of different countries' approaches to ${theme.toLowerCase()}`,
                `A personal narrative about the author's experience with ${theme.toLowerCase()}`
            ],
            optionsCn: [
                `${w0.word} 在 ${themeCn} 背景下的重要性及其对个人和社会的影响`,
                `从古代到现代的 ${themeCn} 历史概述`,
                `不同国家对 ${themeCn} 的不同做法的比较`,
                `作者关于 ${themeCn} 的个人经历叙述`
            ],
            correct: 0
        });

        // Q2: Detail understanding - based on actual paragraph content
        const detailWord = w1.word;
        questions.push({
            text: `According to the passage, what is said about "${detailWord}"?`,
            textCn: `根据文章，关于"${detailWord}"说了什么？`,
            options: [
                `It plays a significant role and is closely related to the broader theme of ${theme.toLowerCase()}`,
                `It has been completely replaced by modern technology`,
                `It is only relevant to a small group of specialists`,
                `It has remained unchanged for the past several decades`
            ],
            optionsCn: [
                `它在 ${themeCn} 这一更广泛的主题中扮演着重要角色，且与之密切相关`,
                `它已被现代技术完全取代`,
                `它只与一小部分专家相关`,
                `在过去几十年里它一直没有变化`
            ],
            correct: 0
        });

        // Q3: Word meaning guess - use real word definition
        const guessWord = w2.word;
        const guessMeaning = w2.meaning ? w2.meaning.split(/[；;,，]/)[0].substring(0, 40) : 'a concept or practice';
        questions.push({
            text: `Based on the context of the passage, what does the word "${guessWord}" most likely mean?`,
            textCn: `根据文章的上下文，"${guessWord}"这个词最可能是什么意思？`,
            options: [
                guessMeaning,
                'A type of natural disaster that occurs frequently',
                'An ancient ritual practiced by indigenous peoples',
                'A mathematical equation used in physics'
            ],
            optionsCn: [
                guessMeaning,
                `一种经常发生的自然灾害`,
                `土著民族实践的一种古老仪式`,
                `物理学中使用的一个数学方程`
            ],
            correct: 0
        });

        // Q4: Inference
        const inferWord = w3.word;
        questions.push({
            text: 'What can be inferred from the passage?',
            textCn: '从文章中可以推断出什么？',
            options: [
                `A deeper understanding of ${inferWord} can help individuals make better decisions in their daily lives`,
                'The author believes that no further research is needed on this topic',
                'The passage suggests that all current practices are ineffective',
                'Readers should avoid engaging with the topic altogether'
            ],
            optionsCn: [
                `对 ${inferWord} 的更深入理解可以帮助人们在日常生活中做出更好的决定`,
                `作者认为这个话题不需要进一步研究`,
                `文章表明所有当前的实践都是无效的`,
                `读者应该完全避免接触这个话题`
            ],
            correct: 0
        });

        // Q5: Author's attitude/purpose
        const purposeWord = w4.word;
        questions.push({
            text: `What is the author's primary purpose in writing this passage?`,
            textCn: '作者写这篇文章的主要目的是什么？',
            options: [
                `To inform readers about the importance of ${purposeWord} and encourage thoughtful engagement with the topic`,
                'To persuade readers to adopt a specific political viewpoint',
                'To entertain readers with humorous anecdotes and stories',
                'To criticize current practices without offering any alternatives'
            ],
            optionsCn: [
                `告知读者 ${purposeWord} 的重要性，并鼓励对这个话题进行深入思考`,
                `说服读者采纳特定的政治观点`,
                `用幽默的轶事和故事来娱乐读者`,
                `批评当前的实践而不提供任何替代方案`
            ],
            correct: 0
        });

        return questions;
    }
    
    renderPassage(passage) {
        document.getElementById('passage-title').textContent = passage.title;
        document.getElementById('passage-info').textContent = `约 ${passage.wordCount} 词 · ${this.readingDifficulty === 'easy' ? '简单' : this.readingDifficulty === 'medium' ? '中等' : '困难'}`;
        
        // Build bilingual content with per-paragraph toggle
        const enParagraphs = passage.text.split('\n\n').filter(p => p.trim());
        const cnParagraphs = passage.cnText.split('\n\n').filter(p => p.trim());
        
        let html = '<div class="passage-bilingual">';
        enParagraphs.forEach((en, idx) => {
            const cn = cnParagraphs[idx] || '';
            html += `
                <div class="bilingual-block" data-para="${idx}">
                    <div class="paragraph-header">
                        <span class="paragraph-number">P${idx + 1}</span>
                        <button class="paragraph-toggle-btn" data-para="${idx}" title="显示/隐藏翻译">🇨🇳</button>
                    </div>
                    <div class="en-paragraph">${en}</div>
                    <div class="cn-paragraph" style="display: none;">${cn}</div>
                </div>
            `;
        });
        html += '</div>';
        
        document.getElementById('passage-content').innerHTML = html;
        
        // Add per-paragraph toggle listeners
        document.querySelectorAll('.paragraph-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const paraIdx = parseInt(e.currentTarget.dataset.para);
                this.toggleParagraphTranslation(paraIdx);
            });
        });
    }
    
    toggleParagraphTranslation(idx) {
        const block = document.querySelector(`.bilingual-block[data-para="${idx}"]`);
        if (!block) return;
        const cnEl = block.querySelector('.cn-paragraph');
        const btn = block.querySelector('.paragraph-toggle-btn');
        if (!cnEl || !btn) return;
        
        const isHidden = cnEl.style.display === 'none';
        cnEl.style.display = isHidden ? 'block' : 'none';
        btn.classList.toggle('active', isHidden);
        btn.textContent = isHidden ? '🔽' : '🇨🇳';
    }
    
    renderQuestions(questions) {
        const container = document.getElementById('questions-list');
        const navContainer = document.getElementById('reading-nav-items');
        const navOptionsContainer = document.getElementById('reading-nav-options');
        container.innerHTML = '';
        if (navContainer) navContainer.innerHTML = '';
        if (navOptionsContainer) navOptionsContainer.innerHTML = '';
        
        this.readingCurrentQuestion = 0;
        
        // Render navigation bar items
        if (navContainer) {
            questions.forEach((q, idx) => {
                const navItem = document.createElement('div');
                navItem.className = 'reading-nav-item';
                navItem.dataset.q = idx;
                navItem.innerHTML = `
                    <span class="reading-nav-item-number">${idx + 1}</span>
                    <span class="reading-nav-item-answer" id="nav-answer-${idx}"></span>
                `;
                navItem.addEventListener('click', () => {
                    this.switchReadingQuestion(idx);
                });
                navContainer.appendChild(navItem);
            });
        }
        
        // Render question stems in main content (no options)
        questions.forEach((q, idx) => {
            const qEl = document.createElement('div');
            qEl.className = 'question-single';
            qEl.dataset.q = idx;
            qEl.style.display = idx === 0 ? 'block' : 'none';
            qEl.innerHTML = `
                <div class="question-text">
                    <span class="question-number">${idx + 1}</span>
                    <div class="question-en">${q.text}</div>
                    <div class="question-cn">${q.textCn}</div>
                </div>
            `;
            container.appendChild(qEl);
        });
        
        // Render options in nav bar for current question
        this.renderNavOptions(0, questions);
        
        // Update nav active state
        this.updateReadingNavActive();
    }
    
    renderNavOptions(idx, questions) {
        const navOptionsContainer = document.getElementById('reading-nav-options');
        const navTop = document.getElementById('reading-nav-top');
        if (!navOptionsContainer || !questions) return;
        
        const q = questions[idx];
        const selectedAnswer = this.readingAnswers[idx];
        
        // Add border separator when options are visible
        if (navTop) navTop.classList.add('has-options');
        
        navOptionsContainer.innerHTML = `
            <div class="nav-question-text">
                <span class="nav-q-number">${idx + 1}.</span>${q.text}
                <div class="nav-question-cn">${q.textCn || ''}</div>
            </div>
            <div class="nav-options-list">
                ${q.options.map((opt, optIdx) => `
                    <div class="nav-option-item ${selectedAnswer === optIdx ? 'selected' : ''}" data-q="${idx}" data-opt="${optIdx}">
                        <span class="nav-option-letter">${String.fromCharCode(65 + optIdx)}</span>
                        <div>
                            <div class="nav-option-text">${opt}</div>
                            <div class="nav-option-cn">${q.optionsCn ? q.optionsCn[optIdx] : ''}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        // Add click handlers for options
        navOptionsContainer.querySelectorAll('.nav-option-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const qIdx = parseInt(item.dataset.q);
                const optIdx = parseInt(item.dataset.opt);
                this.selectAnswer(qIdx, optIdx);
            });
        });
    }
    
    switchReadingQuestion(idx) {
        this.readingCurrentQuestion = idx;
        
        // Hide all questions
        document.querySelectorAll('.question-single').forEach(el => {
            el.style.display = 'none';
        });
        
        // Show selected question
        const selected = document.querySelector(`.question-single[data-q="${idx}"]`);
        if (selected) {
            selected.style.display = 'block';
            selected.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Update nav options
        if (this.currentPassage) {
            this.renderNavOptions(idx, this.currentPassage.questions);
        }
        
        this.updateReadingNavActive();
    }
    
    updateReadingNavActive() {
        document.querySelectorAll('.reading-nav-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === this.readingCurrentQuestion);
            
            // Show selected answer letter
            const answer = this.readingAnswers[idx];
            const answerEl = document.getElementById(`nav-answer-${idx}`);
            if (answerEl) {
                if (answer !== undefined) {
                    answerEl.textContent = String.fromCharCode(65 + answer);
                    item.classList.add('answered');
                } else {
                    answerEl.textContent = '';
                    item.classList.remove('answered');
                }
            }
        });
    }
    
    selectAnswer(qIdx, optIdx) {
        this.readingAnswers[qIdx] = optIdx;
        
        // Update nav option items
        document.querySelectorAll(`#reading-nav-options .nav-option-item[data-q="${qIdx}"]`).forEach((item, idx) => {
            item.classList.toggle('selected', idx === optIdx);
        });
        
        // Update nav bar
        this.updateReadingNavActive();
    }
    
    submitReadingAnswers() {
        if (!this.currentPassage) return;
        
        const questions = this.currentPassage.questions;
        let correct = 0;
        const results = [];
        
        questions.forEach((q, idx) => {
            const userAnswer = this.readingAnswers[idx];
            const isCorrect = userAnswer === q.correct;
            if (isCorrect) correct++;

            // 记录错题
            if (!isCorrect) {
                this.addWrongRecord({
                    type: 'reading',
                    word: q.options[q.correct] || '',
                    meaning: '',
                    question: q.text,
                    correctAnswer: q.options[q.correct],
                    userAnswer: userAnswer !== undefined ? q.options[userAnswer] : '未作答'
                });
            }
            
            // Find the relevant sentence from passage
            const relevantSentence = this.findRelevantSentence(q.text);
            
            results.push({
                question: q.text,
                userAnswer: userAnswer !== undefined ? q.options[userAnswer] : '未作答',
                correctAnswer: q.options[q.correct],
                isCorrect: isCorrect,
                relevantSentence: relevantSentence,
                explanation: this.generateExplanation(q, userAnswer, isCorrect)
            });
            
            // Highlight in nav options
            document.querySelectorAll(`#reading-nav-options .nav-option-item[data-q="${idx}"]`).forEach((item, optIdx) => {
                item.classList.remove('selected');
                if (optIdx === q.correct) {
                    item.classList.add('correct');
                } else if (optIdx === userAnswer && !isCorrect) {
                    item.classList.add('wrong');
                }
            });
            
            // Mark nav item as correct or wrong
            const navItem = document.querySelector(`.reading-nav-item[data-q="${idx}"]`);
            if (navItem) {
                navItem.classList.remove('answered');
                if (isCorrect) {
                    navItem.classList.add('nav-correct');
                } else {
                    navItem.classList.add('nav-wrong');
                }
            }
        });
        
        // Highlight relevant sentences in the original passage
        this.highlightPassageSentences(results);
        
        // Show result
        const score = Math.round((correct / questions.length) * 100);
        this.renderReadingResult(score, correct, questions.length, results);
        
        // Update module stats
        const moduleStats = Storage.getModuleStats();
        moduleStats.reading.total += questions.length;
        moduleStats.reading.correct += correct;
        moduleStats.reading.passages += 1;
        Storage.saveModuleStats(moduleStats);
        
        // Add activity
        Storage.addActivity({
            type: correct >= 3 ? 'correct' : 'wrong',
            message: `📖 阅读练习：${this.currentPassage.title}，答对 ${correct}/${questions.length} 题`
        });
        
        // Show result below the passage (keep article visible)
        document.getElementById('reading-result').style.display = 'block';
        document.getElementById('reading-result').scrollIntoView({ behavior: 'smooth', block: 'start' });

        // 学习助手Agent反馈
        const wrongItems = results.filter(r => !r.isCorrect).map(r => ({
            question: r.question,
            word: r.correctAnswer || '',
            correctAnswer: r.correctAnswer,
            userAnswer: r.userAnswer
        }));
        this.showAgentFeedback('reading', score, correct, questions.length, wrongItems);
    }
    
    renderReadingResult(score, correct, total, results) {
        const content = document.getElementById('result-content');
        const elapsed = this.stopTimer('reading');
        
        let html = `
            <div class="result-score">${score}</div>
            <div class="result-score-label">得分 · 答对 ${correct}/${total} 题 · 用时 ${this.formatTime(elapsed)}</div>
        `;
        
        results.forEach((r, idx) => {
            html += `
                <div class="result-detail ${r.isCorrect ? 'correct' : 'wrong'}">
                    <div class="detail-q">${idx + 1}. ${r.question}</div>
                    ${r.relevantSentence ? `<div class="detail-sentence">📖 <span class="sentence-highlight">${r.relevantSentence}</span></div>` : ''}
                    <div class="detail-a">你的答案：${r.userAnswer}</div>
                    ${!r.isCorrect ? `<div class="detail-correct">正确答案：${r.correctAnswer}</div>` : ''}
                    <div class="detail-explanation">💡 ${r.explanation}</div>
                </div>
            `;
        });
        
        content.innerHTML = html;
    }
    
    findRelevantSentence(questionText) {
        if (!this.currentPassage) return '';
        
        const questionWords = questionText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        let bestMatch = '';
        let bestScore = 0;
        
        // Try paragraphs first
        if (this.currentPassage.paragraphs) {
            this.currentPassage.paragraphs.forEach(para => {
                const sentences = para.en.split(/[.!?]+/);
                sentences.forEach(sent => {
                    const sentLower = sent.toLowerCase();
                    let score = 0;
                    questionWords.forEach(qw => {
                        if (sentLower.includes(qw)) score++;
                    });
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = sent.trim();
                    }
                });
            });
        }
        
        // Fallback: search in passage text
        if (!bestMatch && this.currentPassage.text) {
            const sentences = this.currentPassage.text.split(/[.!?]+/);
            sentences.forEach(sent => {
                const sentLower = sent.toLowerCase();
                let score = 0;
                questionWords.forEach(qw => {
                    if (sentLower.includes(qw)) score++;
                });
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = sent.trim();
                }
            });
        }
        
        return bestMatch;
    }
    
    highlightPassageSentences(results) {
        // For each question, find and highlight the relevant sentence in the passage
        const enParagraphs = document.querySelectorAll('.en-paragraph');
        if (!enParagraphs.length) return;
        
        // Collect all sentence texts with their positions
        const allSentences = [];
        enParagraphs.forEach((paraEl, paraIdx) => {
            const text = paraEl.textContent;
            const sentences = text.split(/(?<=[.!?])\s+/);
            let offset = 0;
            sentences.forEach(sent => {
                const trimmed = sent.trim();
                if (trimmed.length > 20) { // Only consider meaningful sentences
                    allSentences.push({
                        text: trimmed,
                        paraEl: paraEl,
                        paraIdx: paraIdx,
                        offset: offset
                    });
                }
                offset += sent.length + 1;
            });
        });
        
        // For each result, find the best matching sentence and highlight it
        const highlighted = new Set();
        
        results.forEach((r, idx) => {
            if (!r.relevantSentence) return;
            
            const relSent = r.relevantSentence.toLowerCase();
            let bestMatch = null;
            let bestScore = 0;
            
            allSentences.forEach((s, sIdx) => {
                if (highlighted.has(sIdx)) return;
                const sLower = s.text.toLowerCase();
                // Calculate overlap score
                const relWords = relSent.split(/\s+/);
                let score = 0;
                relWords.forEach(w => {
                    if (w.length > 3 && sLower.includes(w)) score++;
                });
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = s;
                }
            });
            
            if (bestMatch && bestScore >= 2) {
                highlighted.add(allSentences.indexOf(bestMatch));
                const paraEl = bestMatch.paraEl;
                const originalText = paraEl.innerHTML;
                
                // Escape regex special chars
                const escaped = bestMatch.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escaped})`, 'i');
                
                // Check if already has highlight tag to avoid double-wrapping
                if (!originalText.includes('reading-highlight')) {
                    const correctClass = r.isCorrect ? ' correct' : '';
                    paraEl.innerHTML = originalText.replace(regex, 
                        `<span class="reading-highlight${correctClass}" data-q="${idx + 1}"><span class="highlight-tag">${idx + 1}</span>$1</span>`
                    );
                }
            }
        });
    }
    
    generateExplanation(q, userAnswer, isCorrect) {
        // 优先使用AI生成的解析
        if (q.explanation) {
            if (isCorrect) {
                return `正确！${q.explanation}`;
            }
            if (userAnswer === undefined) {
                return `未作答。正确答案是 ${q.options[q.correct]}。${q.explanation}`;
            }
            return `错误。你选择了 ${q.options[userAnswer]}，但正确答案是 ${q.options[q.correct]}。${q.explanation}`;
        }
        if (isCorrect) {
            return `正确！${q.options[q.correct]} 是最佳答案，因为该选项与文章主旨和上下文逻辑一致。`;
        }
        if (userAnswer === undefined) {
            return `未作答。正确答案是 ${q.options[q.correct]}。${q.options[q.correct]} 最符合文章语境。`;
        }
        return `错误。你选择了 ${q.options[userAnswer]}，但正确答案是 ${q.options[q.correct]}。${q.options[q.correct]} 更准确地反映了文章中的信息。`;
    }
    
    // ===== 保存的练习功能 =====
    renderSavedExercises(filter = 'all') {
        const list = document.getElementById('saved-list');
        const empty = document.getElementById('saved-empty');
        if (!list) return;
        
        let items = this.savedExercises;
        if (filter !== 'all') {
            items = items.filter(item => item.type === filter);
        }
        
        if (items.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'block';
            return;
        }
        
        list.style.display = 'flex';
        empty.style.display = 'none';
        
        list.innerHTML = items.map((item, idx) => `
            <div class="saved-item" data-saved-idx="${idx}">
                <div class="saved-item-header">
                    <span class="saved-item-type ${item.type}">${item.type === 'translation' ? '🌐 翻译练习' : '📖 阅读练习'}</span>
                    <span class="saved-item-date">${new Date(item.savedAt).toLocaleDateString('zh-CN')}</span>
                </div>
                <div class="saved-item-title">${item.title}</div>
                <div class="saved-item-preview">${item.preview}</div>
                <div class="saved-item-actions">
                    <button onclick="app.loadSavedExercise(${idx})">📖 查看</button>
                    <button class="btn-delete" onclick="app.deleteSavedExercise(${idx})">🗑️ 删除</button>
                </div>
            </div>
        `).join('');
    }
    
    saveCurrentExercise(type, title, preview, data) {
        const exercise = {
            type,
            title,
            preview,
            data,
            savedAt: new Date().toISOString()
        };
        
        // Check if already saved
        const exists = this.savedExercises.some(e => 
            e.type === type && e.title === title
        );
        if (exists) {
            alert('该练习已保存！');
            return;
        }
        
        this.savedExercises.unshift(exercise);
        Storage.saveSavedExercises(this.savedExercises);
        this.renderSavedExercises();
        
        Storage.addActivity({
            type: 'correct',
            message: `💾 保存了${type === 'translation' ? '翻译' : '阅读'}练习：${title}`
        });
        
        alert('练习已保存！');
    }
    
    loadSavedExercise(idx) {
        const item = this.savedExercises[idx];
        if (!item) return;
        
        if (item.type === 'translation') {
            this.switchPage('translation');
            // Restore translation data
            this.currentTranslation = item.data;
            this.renderTranslation(item.data);
        } else if (item.type === 'reading') {
            this.switchPage('reading');
            this.currentPassage = item.data;
            this.renderPassage(item.data);
        }
    }
    
    deleteSavedExercise(idx) {
        if (!confirm('确定要删除这个保存的练习吗？')) return;
        this.savedExercises.splice(idx, 1);
        Storage.saveSavedExercises(this.savedExercises);
        this.renderSavedExercises();
    }
    
    // ===== 选词填空功能 =====
    switchClozeDifficulty(difficulty) {
        this.clozeDifficulty = difficulty;
        document.querySelectorAll('[data-cloze-difficulty]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.clozeDifficulty === difficulty);
        });
        this.generateCloze();
    }

    generateCloze() {
        // Start timer for cloze
        this.startTimer('cloze');

        // Get reading themes data (same as reading practice)
        const themes = this.getClozeThemes();
        const theme = themes[Math.floor(Math.random() * themes.length)];

        // Difficulty determines how many paragraphs to combine
        const paragraphCounts = { easy: 4, medium: 5, hard: 6 };
        const numParagraphs = paragraphCounts[this.clozeDifficulty] || 4;

        // Shuffle and pick paragraphs
        const shuffledTemplates = [...theme.templates].sort(() => Math.random() - 0.5);
        const selectedParagraphs = shuffledTemplates.slice(0, numParagraphs);

        // Build full text by replacing placeholders with random words
        let fullText = '';
        let fullCnText = '';
        const allWords = [];

        selectedParagraphs.forEach((paragraph) => {
            let paraText = paragraph.en;
            let paraCn = paragraph.cn || '';
            const placeholderMatches = paraText.match(/\{word\d+\}/g);
            if (placeholderMatches) {
                placeholderMatches.forEach(placeholder => {
                    const word = this.getRandomWord();
                    paraText = paraText.replace(placeholder, word);
                    allWords.push(word);
                });
            }
            fullText += paraText + ' ';
            if (paraCn) fullCnText += paraCn + ' ';
        });

        // Select 10 words to blank out (prioritize longer, content words)
        const tokens = fullText.split(/\s+/);
        const candidateWords = [];
        tokens.forEach((token, idx) => {
            const clean = token.replace(/[^a-zA-Z]/g, '').toLowerCase();
            if (clean.length >= 4 && !this.isCommonWord(clean)) {
                candidateWords.push({ word: clean, index: idx, original: token });
            }
        });

        // Shuffle and pick 10 unique words
        const shuffledCandidates = this.shuffleArray([...candidateWords]);
        const selectedBlanks = [];
        const usedWords = new Set();
        for (const cand of shuffledCandidates) {
            if (selectedBlanks.length >= 10) break;
            if (!usedWords.has(cand.word)) {
                usedWords.add(cand.word);
                selectedBlanks.push(cand);
            }
        }

        // Sort blanks by their appearance order in text
        selectedBlanks.sort((a, b) => a.index - b.index);

        // Build blank mapping
        const blanks = selectedBlanks.map((cand, i) => {
            const distractors = this.generateDistractors(cand.word, theme, themes);
            const options = this.shuffleArray([cand.word, ...distractors]);
            return {
                index: i + 1,
                word: cand.word,
                options: options
            };
        });

        // Replace selected words with blanks in text
        // Use token-level replacement to ensure correct occurrence matching
        let words = fullText.split(/\s+/);
        for (let i = selectedBlanks.length - 1; i >= 0; i--) {
            const cand = selectedBlanks[i];
            const wordIdx = cand.index;
            if (wordIdx < words.length) {
                const originalToken = words[wordIdx];
                // Extract the alphabetic part of the token
                const cleaned = originalToken.replace(/[^a-zA-Z]/g, '');
                if (cleaned.toLowerCase() === cand.word) {
                    // Replace the word within the token, preserving surrounding punctuation
                    words[wordIdx] = originalToken.replace(cleaned, `[${i + 1}]`);
                }
            }
        }
        let displayText = words.join(' ');

        this.currentCloze = {
            title: theme.name,
            text: displayText.trim(),
            cnText: fullCnText.trim(),
            blanks: blanks
        };
        this.clozeAnswers = {};

        this.renderCloze(this.currentCloze);

        document.getElementById('cloze-result').style.display = 'none';
        document.getElementById('cloze-card').style.display = 'block';
    }

    getClozeThemes() {
        // Reuse the same themes from reading practice
        return [
            { name: 'Campus Life', templates: [
                { en: 'The transition from high school to {word1} is one of the most significant milestones in a young person\'s life. For many students, entering {word2} means living away from home for the first time, managing their own schedule, and making new friends from diverse backgrounds. Universities today offer a wide range of activities and organizations that help students {word3} both academically and socially. However, this newfound freedom can also be overwhelming, as students must learn to balance their studies with personal responsibilities.', cn: '从高中到大学的过渡是年轻人生命中最重要的里程碑之一。' },
                { en: 'Academic life presents its own set of challenges. Unlike high school, university courses require students to {word4} independently and think critically about complex topics. Many professors encourage students to participate in {word5} and challenge established theories. The ability to {word6} effectively is considered one of the most valuable skills a student can develop.', cn: '学术生活带来了自身的挑战。' },
                { en: 'Beyond academics, the social aspect of university life plays a crucial role in personal development. Joining student clubs and organizations allows students to {word7} valuable leadership skills and build lasting friendships. Campus events, cultural festivals, and sports competitions create a vibrant community atmosphere.', cn: '除了学业之外，大学生活的社交方面在个人发展中起着至关重要的作用。' },
                { en: 'Many universities now emphasize the importance of career preparation from the very first year. Career centers offer workshops on resume writing, interview techniques, and networking strategies. Students are encouraged to pursue {word9} and part-time jobs that relate to their field of study.', cn: '许多大学现在从第一年就强调职业准备的重要性。' },
                { en: 'International students face unique challenges when studying abroad. Adapting to a new {word1} requires patience, cultural sensitivity, and a willingness to embrace different perspectives. Universities that provide dedicated support services for international students tend to have higher {word2} and more diverse campus communities.', cn: '国际学生在国外学习时面临独特的挑战。' },
                { en: 'Financial pressure is a significant concern for many college students today. The rising cost of tuition, textbooks, and living expenses has led to increased reliance on scholarships, grants, and student loans. Many students must balance their academic responsibilities with part-time employment to {word1} their education.', cn: '经济压力是当今许多大学生的重要关切。' },
                { en: 'Campus safety and health services have become increasingly important priorities for universities. Institutions are investing in improved security measures, including campus police, emergency notification systems, and well-lit pathways. Health centers provide students with access to medical care, counseling services, and {word1} programs.', cn: '校园安全和健康服务已成为大学越来越重要的优先事项。' },
                { en: 'The value of a strong alumni network becomes most apparent after graduation. Universities with active alumni associations offer graduates access to mentorship programs, job referrals, and professional networking events. Many alumni generously {word1} their time and expertise to help current students navigate the transition from university to career.', cn: '强大校友网络的价值在毕业后变得最为明显。' }
            ]},
            { name: 'Workplace Essentials', templates: [
                { en: 'Entering the workforce for the first time can be both exciting and daunting. New employees must quickly adapt to the {word1} of their organization, which often differs significantly from the academic environment they are used to. Understanding workplace culture, learning to communicate professionally, and building relationships with colleagues are all essential skills for career success.', cn: '第一次进入职场既令人兴奋又令人畏惧。' },
                { en: 'Effective communication is perhaps the most critical skill in any workplace. Employees who can {word3} clearly and concisely are more likely to advance in their careers. This includes not only verbal communication but also written correspondence, presentations, and digital communication.', cn: '有效沟通也许是任何职场中最关键的技能。' },
                { en: 'Time management and productivity are also key concerns for professionals. The ability to {word5} tasks effectively can significantly impact both individual performance and team outcomes. Many successful professionals attribute their achievements to strong work habits.', cn: '时间管理和生产力也是专业人士的关键关注点。' },
                { en: 'Career development is a lifelong process that requires continuous learning and adaptation. Professionals who regularly {word7} new skills and stay updated with industry trends are better positioned for advancement opportunities.', cn: '职业发展是一个需要持续学习和适应的终身过程。' },
                { en: 'The rise of remote work and hybrid work models has transformed the modern workplace. Advances in technology have made it possible for employees to {word1} effectively from virtually anywhere, reducing commute times and increasing flexibility.', cn: '远程工作和混合工作模式的兴起已经改变了现代工作场所。' },
                { en: 'Workplace diversity and inclusion have become central themes in organizational strategy. Companies that prioritize creating a {word1} workforce benefit from a wider range of perspectives and ideas, which can drive innovation and improve decision-making.', cn: '职场多元化和包容性已成为组织战略的核心主题。' },
                { en: 'Achieving a healthy work-life balance is essential for long-term career sustainability and personal well-being. Professionals who consistently work long hours without adequate rest are at risk of {word1} and decreased productivity.', cn: '实现健康的工作与生活平衡对于长期职业可持续性和个人福祉至关重要。' },
                { en: 'Lifelong learning and continuous skill development have become necessities in today\'s rapidly evolving job market. Technological advancements and shifting industry demands require professionals to regularly {word1} their knowledge and acquire new competencies.', cn: '终身学习和持续技能发展已成为当今快速变化的就业市场的必需品。' }
            ]},
            { name: 'Social Media Influence', templates: [
                { en: 'Social media has fundamentally transformed how people communicate, access information, and form opinions. Platforms like Facebook, Twitter, and Instagram have become integral parts of daily life for billions of users worldwide. The ability to {word1} with people across the globe has created unprecedented opportunities for connection and collaboration.', cn: '社交媒体从根本上改变了人们交流、获取信息和形成观点的方式。' },
                { en: 'The psychological impact of social media is a topic of growing concern among researchers. Studies have shown that excessive social media use can contribute to feelings of anxiety, depression, and low self-esteem, particularly among young people. The tendency to {word3} one\'s life with the carefully curated highlights of others can create unrealistic expectations.', cn: '社交媒体对心理的影响是研究人员日益关注的话题。' },
                { en: 'From a business perspective, social media has revolutionized marketing and advertising. Companies now use sophisticated algorithms to {word5} consumer behavior and deliver personalized advertisements. The rise of influencer marketing has created new career opportunities.', cn: '从商业角度来看，社交媒体彻底改变了营销和广告。' },
                { en: 'Education systems around the world are grappling with the role of social media in learning. While these platforms can facilitate collaboration and resource sharing, they can also serve as sources of {word7} during study time.', cn: '世界各地的教育系统正在努力应对社交媒体在学习中的作用。' },
                { en: 'Cyberbullying and online safety have emerged as serious concerns in the digital age. The anonymity provided by social media platforms can embolden individuals to {word1} others in ways they might not in face-to-face interactions.', cn: '网络欺凌和在线安全已成为数字时代的严重关切。' },
                { en: 'The impact of social media on adolescents has drawn particular attention from psychologists and educators. Teenagers who spend excessive time on social platforms may experience {word1} in their social development and self-image formation.', cn: '社交媒体对青少年的影响引起了心理学家和教育工作者的特别关注。' },
                { en: 'The way people consume news has been dramatically altered by social media algorithms. These platforms are designed to {word1} content that aligns with users\' existing beliefs, potentially creating echo chambers that limit exposure to diverse viewpoints.', cn: '人们消费新闻的方式已被社交媒体算法彻底改变。' },
                { en: 'Looking ahead, social media continues to evolve at a rapid pace. Emerging technologies such as virtual reality, augmented reality, and artificial intelligence are poised to {word1} how people interact online.', cn: '展望未来，社交媒体继续快速发展。' }
            ]},
            { name: 'Environmental Behavior', templates: [
                { en: 'Environmental awareness has grown significantly in recent years, with more people adopting sustainable practices in their daily lives. From reducing plastic waste to conserving energy, individuals are increasingly taking responsibility for their environmental {word1}. Governments worldwide have implemented policies to encourage {word2}, such as banning single-use plastics and promoting renewable energy sources.', cn: '近年来，环保意识显著增强。' },
                { en: 'Consumer behavior plays a significant role in environmental sustainability. The choices people make about what to buy, how to travel, and what to eat all have environmental consequences. The concept of {word3} has gained popularity, encouraging consumers to consider the full lifecycle of products before making purchases.', cn: '消费行为在环境可持续性中发挥着重要作用。' },
                { en: 'Urban planning and development are also evolving to prioritize environmental considerations. Green building standards, expanded public transportation networks, and the creation of urban green spaces are becoming increasingly common features of modern cities.', cn: '城市规划和发展也在不断演变，以优先考虑环境因素。' },
                { en: 'Education is widely recognized as a key factor in promoting environmental awareness. Schools and universities are incorporating sustainability topics into their curricula, helping students understand the {word7} of their actions on the planet.', cn: '教育被广泛认为是促进环保意识的关键因素。' },
                { en: 'The transition to renewable energy sources has accelerated dramatically in recent years. Solar, wind, and hydropower are increasingly replacing fossil fuels as the primary sources of electricity generation. Many countries have set ambitious targets to {word1} their carbon emissions and achieve energy independence.', cn: '向可再生能源的过渡近年来急剧加速。' },
                { en: 'Food waste and sustainable dietary choices represent significant environmental challenges. Approximately one-third of all food produced globally is wasted, contributing to greenhouse gas emissions and resource depletion. Consumers can make a meaningful difference by choosing to {word1} locally sourced, seasonal produce and reducing meat consumption.', cn: '食物浪费和可持续的饮食选择代表了重大的环境挑战。' },
                { en: 'Biodiversity loss is one of the most critical environmental threats facing the planet today. Habitat destruction, pollution, and climate change are driving many species toward extinction at an alarming rate. Conservation organizations are working to {word1} endangered ecosystems and protect wildlife through habitat restoration.', cn: '生物多样性丧失是当今地球面临的最严峻环境威胁之一。' },
                { en: 'Individual actions, when multiplied across millions of people, can have a profound impact on the environment. Simple changes such as reducing energy consumption, recycling, using public transportation, and conserving water can collectively {word1} significant environmental benefits.', cn: '当个人行动乘以数百万人时，可以对环境产生深远的影响。' }
            ]},
            { name: 'Health and Psychology', templates: [
                { en: 'Mental health has become a major topic of public discussion in recent years. Increased awareness has helped reduce the stigma surrounding conditions such as depression, anxiety, and stress-related disorders. Many workplaces and educational institutions now offer {word1} programs to support mental well-being.', cn: '近年来，心理健康已成为公众讨论的主要话题。' },
                { en: 'The relationship between physical health and mental well-being is well documented. Regular exercise, a balanced diet, and adequate sleep all contribute to better mental health outcomes. Research has shown that people who maintain a healthy lifestyle are better able to {word2} the challenges of daily life.', cn: '身体健康与心理健康之间的关系有充分的文献记载。' },
                { en: 'Workplace stress is a growing concern in today\'s fast-paced economy. Many employees report feeling overwhelmed by the demands of their jobs, leading to burnout and decreased productivity. Companies are exploring various strategies to help employees {word4}, including flexible work arrangements and wellness programs.', cn: '职场压力是当今快节奏经济中日益严重的关切。' },
                { en: 'Technology\'s impact on health is a double-edged sword. While digital health tools and telemedicine have improved access to healthcare, excessive screen time and sedentary lifestyles associated with technology use have contributed to various health problems.', cn: '科技对健康的影响是一把双刃剑。' },
                { en: 'Sleep and rest are fundamental pillars of good health that are often overlooked in today\'s busy world. Research consistently shows that adults who get seven to eight hours of quality sleep each night are better able to {word1}, maintain a healthy weight, and ward off chronic diseases.', cn: '睡眠和休息是良好健康的基本支柱。' },
                { en: 'Mindfulness meditation and stress management techniques have gained widespread recognition as effective tools for improving mental health. Regular meditation practice can help individuals {word1} by reducing cortisol levels and promoting a sense of inner calm.', cn: '正念冥想和压力管理技巧已获得广泛认可。' },
                { en: 'Strong community support and meaningful interpersonal relationships are essential components of psychological well-being. Individuals who maintain close connections with family, friends, and community members tend to {word1} better during difficult times and report higher levels of life satisfaction.', cn: '强大的社区支持和有意义的人际关系是心理健康的重要组成部分。' },
                { en: 'Health technology and digital health tools are rapidly transforming how people manage their well-being. Wearable fitness trackers, smartphone health apps, and telemedicine platforms have made it easier than ever to {word1} vital health metrics and access medical care remotely.', cn: '健康技术和数字健康工具正在迅速改变人们管理自身健康的方式。' }
            ]}
        ];
    }

    getRandomWord() {
        if (this.words.length === 0) return 'education';
        const wordObj = this.words[Math.floor(Math.random() * this.words.length)];
        return wordObj.word;
    }

    isCommonWord(word) {
        const commonWords = new Set([
            'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'way', 'will', 'with', 'have', 'this', 'that', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take', 'than', 'them', 'well', 'were', 'what', 'your', 'about', 'could', 'other', 'after', 'first', 'never', 'these', 'think', 'where', 'being', 'every', 'great', 'might', 'shall', 'still', 'those', 'while', 'would', 'there', 'their', 'should', 'through', 'between', 'before', 'people', 'little', 'around', 'things', 'years', 'going', 'right', 'again', 'under', 'work', 'life', 'even', 'more', 'also', 'back', 'only', 'most', 'into', 'year', 'said', 'each', 'which', 'however', 'therefore', 'although', 'because', 'without', 'another', 'against', 'nothing', 'someone', 'everyone', 'something', 'everything'
        ]);
        return commonWords.has(word.toLowerCase());
    }

    generateDistractors(correctWord, currentTheme, allThemes) {
        const distractors = [];
        const used = new Set([correctWord.toLowerCase()]);

        // Collect words from other themes' templates
        const otherThemes = allThemes.filter(t => t.name !== currentTheme.name);
        const candidateWords = [];

        otherThemes.forEach(theme => {
            theme.templates.forEach(template => {
                const words = template.en.split(/\s+/);
                words.forEach(w => {
                    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
                    if (clean.length >= 4 && !this.isCommonWord(clean)) {
                        candidateWords.push(clean);
                    }
                });
            });
        });

        // Also use words from word database
        this.words.forEach(w => {
            const clean = w.word.toLowerCase();
            if (clean.length >= 4 && !this.isCommonWord(clean)) {
                candidateWords.push(clean);
            }
        });

        // Shuffle and pick 3 unique distractors
        const shuffled = this.shuffleArray([...candidateWords]);
        for (const word of shuffled) {
            if (distractors.length >= 3) break;
            if (!used.has(word)) {
                used.add(word);
                distractors.push(word);
            }
        }

        // Fallback: if not enough distractors, use default words
        const defaultDistractors = ['analysis', 'approach', 'concept', 'context', 'culture', 'design', 'effect', 'factor', 'future', 'growth', 'impact', 'issue', 'level', 'method', 'model', 'nature', 'period', 'policy', 'process', 'project', 'range', 'reason', 'result', 'review', 'role', 'series', 'source', 'stage', 'system', 'theory', 'trend', 'value', 'view'];
        let fallbackIdx = 0;
        while (distractors.length < 3 && fallbackIdx < defaultDistractors.length) {
            const word = defaultDistractors[fallbackIdx++];
            if (!used.has(word)) {
                used.add(word);
                distractors.push(word);
            }
        }

        return distractors;
    }

    // 根据用户自定义文章和指定单词生成选词填空练习
    generateClozeFromCustomInput(text, blankWords) {
        // 启动计时器
        this.startTimer('cloze');

        let displayText = text;
        const blanks = [];

        // 为每个要挖空的单词进行处理
        blankWords.forEach((targetWord, i) => {
            const blankIndex = i + 1;

            // 用大小写不敏感的正则在文本中找到并替换该单词
            // 只替换第一次出现的匹配
            const regex = new RegExp(`\\b${this.escapeRegex(targetWord)}\\b`, 'i');
            displayText = displayText.replace(regex, `[${blankIndex}]`);

            // 为该单词生成干扰词
            const distractors = this.generateCustomDistractors(targetWord, blankWords);
            const options = this.shuffleArray([targetWord, ...distractors]);

            blanks.push({
                index: blankIndex,
                word: targetWord,
                options: options
            });
        });

        // 构造cloze数据对象
        this.currentCloze = {
            title: '自定义练习',
            text: displayText.trim(),
            cnText: '',
            blanks: blanks
        };
        this.clozeAnswers = {};

        // 渲染练习
        this.renderCloze(this.currentCloze);

        // 隐藏结果区域，显示练习卡片
        document.getElementById('cloze-result').style.display = 'none';
        document.getElementById('cloze-card').style.display = 'block';

        // 切换难度显示为"自定义"
        document.getElementById('cloze-info').textContent = `${blanks.length} 空 · 自定义`;

        // 隐藏中文翻译按钮（自定义练习无翻译）
        const cnToggle = document.getElementById('btn-cloze-toggle-cn');
        if (cnToggle) cnToggle.style.display = 'none';
        const cnContent = document.getElementById('cloze-cn-content');
        if (cnContent) cnContent.style.display = 'none';
    }

    // 为自定义练习生成干扰词
    generateCustomDistractors(correctWord, allBlankWords) {
        const distractors = [];
        const used = new Set([correctWord.toLowerCase()]);
        // 将其他要挖空的单词也排除，避免干扰词与答案重复
        allBlankWords.forEach(w => used.add(w.toLowerCase()));

        // 优先从已有词汇库中选取干扰词
        const candidateWords = [];
        if (this.words && this.words.length > 0) {
            this.words.forEach(w => {
                const clean = w.word.toLowerCase();
                if (clean.length >= 3 && !used.has(clean)) {
                    candidateWords.push(clean);
                }
            });
        }

        // 打乱并选取3个干扰词
        const shuffled = this.shuffleArray([...candidateWords]);
        for (const word of shuffled) {
            if (distractors.length >= 3) break;
            if (!used.has(word)) {
                used.add(word);
                distractors.push(word);
            }
        }

        // 如果词汇库不够，使用默认干扰词列表
        const defaultDistractors = ['analysis', 'approach', 'concept', 'context', 'culture', 'design', 'effect', 'factor', 'future', 'growth', 'impact', 'issue', 'level', 'method', 'model', 'nature', 'period', 'policy', 'process', 'project', 'range', 'reason', 'result', 'review', 'role', 'series', 'source', 'stage', 'system', 'theory', 'trend', 'value', 'view'];
        let fallbackIdx = 0;
        while (distractors.length < 3 && fallbackIdx < defaultDistractors.length) {
            const word = defaultDistractors[fallbackIdx++];
            if (!used.has(word)) {
                used.add(word);
                distractors.push(word);
            }
        }

        return distractors;
    }

    // 转义正则表达式特殊字符
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    renderCloze(cloze) {
        document.getElementById('cloze-title').textContent = cloze.title;
        document.getElementById('cloze-info').textContent = `${cloze.blanks.length} 空 · ${this.clozeDifficulty === 'easy' ? '简单' : this.clozeDifficulty === 'medium' ? '中等' : '困难'}`;

        // Format text with clickable blanks
        let html = cloze.text;
        cloze.blanks.forEach(blank => {
            const regex = new RegExp(`\\[${blank.index}\\]`, 'g');
            html = html.replace(regex, `<span class="cloze-blank" data-blank="${blank.index}" id="blank-${blank.index}">[${blank.index}]</span>`);
        });

        document.getElementById('cloze-content').innerHTML = html;
        
        // Render Chinese translation
        const cnContent = document.getElementById('cloze-cn-content');
        if (cnContent && cloze.cnText) {
            cnContent.textContent = cloze.cnText;
        }

        // Render options
        const optionsList = document.getElementById('cloze-options-list');
        optionsList.innerHTML = '';

        cloze.blanks.forEach(blank => {
            const group = document.createElement('div');
            group.className = 'cloze-option-group';
            group.innerHTML = `
                <span class="cloze-option-number">${blank.index}</span>
                <div class="cloze-option-choices">
                    ${blank.options.map(opt => `
                        <button class="cloze-option-btn" data-blank="${blank.index}" data-word="${opt}">${opt}</button>
                    `).join('')}
                </div>
            `;
            optionsList.appendChild(group);
        });

        // Add click handlers for option buttons
        optionsList.querySelectorAll('.cloze-option-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const blankIndex = parseInt(e.target.dataset.blank);
                const word = e.target.dataset.word;
                this.selectClozeAnswer(blankIndex, word);
            });
        });

        // Add click handlers for blanks in text
        document.getElementById('cloze-content').querySelectorAll('.cloze-blank').forEach(blank => {
            blank.addEventListener('click', (e) => {
                const blankIndex = parseInt(e.target.dataset.blank);
                this.selectClozeBlankFromNav(blankIndex);
            });
        });

        // Render bottom navigation items
        this.renderClozeNavigation(cloze);
    }

    renderClozeNavigation(cloze) {
        const navItemsContainer = document.getElementById('cloze-nav-items');
        const navOptionsContainer = document.getElementById('cloze-nav-options');
        if (!navItemsContainer || !navOptionsContainer) return;

        navItemsContainer.innerHTML = '';

        cloze.blanks.forEach(blank => {
            const navItem = document.createElement('div');
            navItem.className = 'cloze-nav-item';
            navItem.dataset.blank = blank.index;

            const userAnswer = this.clozeAnswers[blank.index];
            if (userAnswer) {
                navItem.classList.add('answered');
            }

            navItem.innerHTML = `${blank.index}`;
            navItem.addEventListener('click', () => {
                this.selectClozeBlankFromNav(blank.index);
            });
            navItemsContainer.appendChild(navItem);
        });

        // Set first as active if none selected
        if (cloze.blanks.length > 0 && !this.currentClozeBlank) {
            this.selectClozeBlankFromNav(cloze.blanks[0].index);
        }

        // Options panel visible by default
        if (navOptionsContainer) {
            navOptionsContainer.style.display = 'block';
            const toggleBtn = document.getElementById('cloze-nav-toggle');
            if (toggleBtn) toggleBtn.textContent = '⬆️';
        }
    }

    selectClozeBlankFromNav(blankIndex) {
        // Update active state in navigation
        document.querySelectorAll('.cloze-nav-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.blank) === blankIndex);
        });

        // Scroll to blank in text
        const blankEl = document.getElementById(`blank-${blankIndex}`);
        if (blankEl) {
            blankEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            blankEl.style.backgroundColor = 'rgba(74, 158, 255, 0.15)';
            setTimeout(() => {
                blankEl.style.backgroundColor = '';
            }, 1000);
        }

        // Render options in navigation panel
        this.renderClozeOptionsToNav(blankIndex);

        // Auto-expand options panel so user can see the choices
        const navOptionsContainer = document.getElementById('cloze-nav-options');
        const toggleBtn = document.getElementById('cloze-nav-toggle');
        if (navOptionsContainer && navOptionsContainer.style.display === 'none') {
            navOptionsContainer.style.display = 'block';
            if (toggleBtn) toggleBtn.textContent = '⬆️';
        }
    }

    renderClozeOptionsToNav(blankIndex) {
        const navOptionsContainer = document.getElementById('cloze-nav-options');
        if (!navOptionsContainer || !this.currentCloze) return;

        const blank = this.currentCloze.blanks.find(b => b.index === blankIndex);
        if (!blank) return;

        let html = `
            <div class="cloze-option-group">
                <span class="cloze-option-number">${blank.index}. 选择单词</span>
                <div class="cloze-option-choices">
                    ${blank.options.map(opt => `
                        <button class="cloze-option-btn${this.clozeAnswers[blank.index] === opt ? ' selected' : ''}" 
                                data-blank="${blank.index}" data-word="${opt}">${opt}</button>
                    `).join('')}
                </div>
            </div>
        `;
        navOptionsContainer.innerHTML = html;

        // Add click handlers
        navOptionsContainer.querySelectorAll('.cloze-option-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bIndex = parseInt(e.target.dataset.blank);
                const word = e.target.dataset.word;
                this.selectClozeAnswer(bIndex, word);
                this.updateClozeNavigationItem(bIndex, word);
            });
        });
    }

    updateClozeNavigationItem(blankIndex, word) {
        const navItem = document.querySelector(`.cloze-nav-item[data-blank="${blankIndex}"]`);
        if (navItem) {
            if (word) {
                navItem.classList.add('answered');
            } else {
                navItem.classList.remove('answered');
            }
        }
    }

    selectClozeAnswer(blankIndex, word) {
        this.clozeAnswers[blankIndex] = word;

        // Update option buttons in main options list
        const optionsList = document.getElementById('cloze-options-list');
        if (optionsList) {
            const group = optionsList.querySelectorAll('.cloze-option-group')[blankIndex - 1];
            if (group) {
                group.querySelectorAll('.cloze-option-btn').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.word === word);
                });
            }
        }

        // Update option buttons in nav panel
        const navOptions = document.getElementById('cloze-nav-options');
        if (navOptions) {
            navOptions.querySelectorAll('.cloze-option-btn').forEach(btn => {
                btn.classList.toggle('selected', parseInt(btn.dataset.blank) === blankIndex && btn.dataset.word === word);
            });
        }

        // Update blank in text
        const blankEl = document.getElementById(`blank-${blankIndex}`);
        if (blankEl) {
            blankEl.textContent = word;
            blankEl.classList.add('filled');
        }

        // Update navigation item
        this.updateClozeNavigationItem(blankIndex, word);
    }

    submitClozeAnswers() {
        if (!this.currentCloze) return;

        const blanks = this.currentCloze.blanks;
        let correct = 0;
        const results = [];

        blanks.forEach(blank => {
            const userAnswer = this.clozeAnswers[blank.index];
            const isCorrect = userAnswer === blank.word;
            if (isCorrect) correct++;

            // 记录错题
            if (!isCorrect) {
                this.addWrongRecord({
                    type: 'cloze',
                    word: blank.word,
                    meaning: '',
                    question: `第${blank.index}空 - ${this.currentCloze.title}`,
                    correctAnswer: blank.word,
                    userAnswer: userAnswer || '未作答'
                });
            }

            results.push({
                index: blank.index,
                word: blank.word,
                userAnswer: userAnswer || '未作答',
                isCorrect: isCorrect
            });

            // Highlight option buttons
            const optionsList = document.getElementById('cloze-options-list');
            const group = optionsList.querySelectorAll('.cloze-option-group')[blank.index - 1];
            if (group) {
                group.querySelectorAll('.cloze-option-btn').forEach(btn => {
                    btn.classList.remove('selected');
                    if (btn.dataset.word === blank.word) {
                        btn.classList.add('correct');
                    } else if (btn.dataset.word === userAnswer && !isCorrect) {
                        btn.classList.add('wrong');
                    }
                });
            }

            // Highlight blank in text
            const blankEl = document.getElementById(`blank-${blank.index}`);
            if (blankEl) {
                blankEl.classList.remove('filled');
                if (isCorrect) {
                    blankEl.classList.add('correct');
                } else {
                    blankEl.classList.add('wrong');
                    blankEl.textContent = blank.word;
                }
            }
        });

        // Show result
        const score = Math.round((correct / blanks.length) * 100);
        this.renderClozeResult(score, correct, blanks.length, results);

        // Update module stats
        const moduleStats = Storage.getModuleStats();
        if (!moduleStats.cloze) {
            moduleStats.cloze = { total: 0, correct: 0, passages: 0 };
        }
        moduleStats.cloze.total += blanks.length;
        moduleStats.cloze.correct += correct;
        moduleStats.cloze.passages += 1;
        Storage.saveModuleStats(moduleStats);

        // Add activity
        Storage.addActivity({
            type: correct >= 6 ? 'correct' : 'wrong',
            message: `📝 选词填空：${this.currentCloze.title}，答对 ${correct}/${blanks.length} 空`
        });

        // Hide card, show result
        document.getElementById('cloze-card').style.display = 'none';
        document.getElementById('cloze-result').style.display = 'block';

        // 学习助手Agent反馈
        const clozeWrongItems = results.filter(r => !r.isCorrect).map(r => ({
            word: r.word || '',
            correctAnswer: r.word,
            userAnswer: r.userAnswer || ''
        }));
        this.showAgentFeedback('cloze', score, correct, blanks.length, clozeWrongItems);
    }

    renderClozeResult(score, correct, total, results) {
        const content = document.getElementById('cloze-result-content');
        const elapsed = this.stopTimer('cloze');

        let html = `
            <div class="result-score">${score}</div>
            <div class="result-score-label">得分 · 答对 ${correct}/${total} 空 · 用时 ${this.formatTime(elapsed)}</div>
        `;

        results.forEach((r, idx) => {
            html += `
                <div class="result-detail ${r.isCorrect ? 'correct' : 'wrong'}">
                    <div class="detail-q">${idx + 1}. [${r.index}]</div>
                    <div class="detail-a">你的答案：${r.userAnswer}</div>
                    ${!r.isCorrect ? `<div class="detail-correct">正确答案：${r.word}</div>` : ''}
                </div>
            `;
        });

        content.innerHTML = html;
    }

    // ===== 翻译练习功能 =====
    switchTranslationTopic(topic) {
        this.translationTopic = topic;
        document.querySelectorAll('[data-translation-topic]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.translationTopic === topic);
        });
        this.generateNewTranslation();
    }

    generateNewTranslation() {
        // Start timer for translation
        this.startTimer('translation');
        
        const materials = this.getTranslationMaterials(this.translationTopic);
        const material = materials[Math.floor(Math.random() * materials.length)];
        this.currentTranslation = material;
        this.translationInputs = {};
        
        this.renderTranslation(material);
        this.renderTranslationSentences(material);
        
        document.getElementById('translation-result').style.display = 'none';
        document.getElementById('translation-card').style.display = 'block';
    }

    getTranslationMaterials(topic) {
        const materials = {
            culture: [
                {
                    title: 'The Spring Festival',
                    blocks: [
                        { en: 'The Spring Festival, also known as Chinese New Year, is the most important traditional festival in China. It falls on the first day of the lunar calendar, usually in late January or early February. The festival represents family reunion, hope, and new beginnings.', cn: '春节，也被称为中国新年，是中国最重要的传统节日。它在农历正月初一，通常在1月下旬或2月上旬。这个节日代表了家庭团聚、希望和新的开始。', keywords: ['traditional festival', 'family reunion', 'lunar calendar'] },
                        { en: 'Before the festival, families thoroughly clean their houses to sweep away bad luck and make room for good fortune. People decorate their homes with red lanterns, couplets, and paper cuttings. The color red is believed to ward off evil spirits and bring prosperity.', cn: '在节日之前，家家户户彻底打扫房屋，扫除厄运，为好运腾出空间。人们用红灯笼、春联和剪纸装饰房屋。红色被认为可以驱邪并带来繁荣。', keywords: ['sweep away bad luck', 'red lanterns', 'ward off evil spirits'] },
                        { en: 'On New Year\'s Eve, families gather for a grand reunion dinner. Traditional dishes include dumplings, fish, and rice cakes, each carrying symbolic meanings. Dumplings symbolize wealth, fish represents surplus, and rice cakes signify progress year by year.', cn: '在除夕夜，家人聚在一起吃团圆饭。传统菜肴包括饺子、鱼和年糕，每道菜都有象征意义。饺子象征财富，鱼代表富余，年糕寓意年年高升。', keywords: ['reunion dinner', 'symbolic meanings', 'signify progress'] },
                        { en: 'During the festival, children receive red envelopes containing money from their elders, which symbolizes good wishes and blessings. Fireworks and dragon dances are also important traditions that bring joy and excitement to the celebration.', cn: '节日期间，孩子们收到长辈给的红包，里面装有钱，象征着美好的祝愿和祝福。烟花和舞龙也是重要的传统，为庆祝活动带来欢乐和兴奋。', keywords: ['red envelopes', 'good wishes', 'dragon dances'] }
                    ],
                    sentences: [
                        { cn: '春节是中国最重要的传统节日。', refEn: 'The Spring Festival is the most important traditional festival in China.', keywords: ['Spring Festival', 'traditional festival', 'important'] },
                        { cn: '家家户户彻底打扫房屋，扫除厄运。', refEn: 'Families thoroughly clean their houses to sweep away bad luck.', keywords: ['families', 'thoroughly clean', 'sweep away', 'bad luck'] },
                        { cn: '红色被认为可以驱除邪灵。', refEn: 'The color red is believed to ward off evil spirits.', keywords: ['color red', 'ward off', 'evil spirits'] },
                        { cn: '孩子们收到长辈给的红包，象征着美好祝愿。', refEn: 'Children receive red envelopes containing money from their elders, symbolizing good wishes.', keywords: ['red envelopes', 'elders', 'good wishes'] }
                    ]
                },
                {
                    title: 'Chinese Tea Culture',
                    blocks: [
                        { en: 'Tea culture has a long and distinguished history in China, dating back thousands of years. Tea is not merely a beverage but a way of life that reflects Chinese philosophy and aesthetics. The art of tea preparation and appreciation has been refined over centuries into an elegant cultural practice.', cn: '茶文化在中国有着悠久而卓越的历史，可以追溯到数千年前。茶不仅是一种饮料，更是一种反映中国哲学和美学的生活方式。泡茶和品茶的艺术经过几个世纪的精炼，已经成为一种优雅的文化实践。', keywords: ['distinguished history', 'philosophy and aesthetics', 'cultural practice'] },
                        { en: 'Different regions of China produce distinct varieties of tea, each with its own unique flavor and characteristics. Green tea, black tea, oolong tea, and white tea are among the most well-known types. The process of growing, harvesting, and processing tea leaves requires great skill and patience.', cn: '中国不同地区出产不同种类的茶，每种都有自己独特的风味和特点。绿茶、红茶、乌龙茶和白茶是最知名的品种。种植、采摘和加工茶叶的过程需要极大的技巧和耐心。', keywords: ['distinct varieties', 'unique flavor', 'great skill and patience'] },
                        { en: 'The Chinese tea ceremony emphasizes harmony, respect, purity, and tranquility. When serving tea to guests, the host demonstrates courtesy and hospitality. Tea houses serve as important social spaces where people gather to discuss business, share ideas, or simply enjoy each other\'s company.', cn: '中国茶道强调和、敬、清、寂。在为客人奉茶时，主人展示了礼貌和好客。茶馆是重要的社交空间，人们聚集在这里讨论商务、分享想法，或者只是享受彼此的陪伴。', keywords: ['harmony and respect', 'courtesy and hospitality', 'social spaces'] },
                        { en: 'In recent years, Chinese tea culture has gained international recognition and popularity. Tea tourism has become a growing industry, with visitors traveling to famous tea-producing regions to experience the culture firsthand. This global interest helps preserve and promote traditional tea-making techniques.', cn: '近年来，中国茶文化获得了国际认可和普及。茶旅游已成为一个不断增长的产业，游客前往著名的产茶区亲身体验这种文化。这种全球性的兴趣有助于保护和推广传统的制茶技艺。', keywords: ['international recognition', 'tea tourism', 'preserve and promote'] }
                    ],
                    sentences: [
                        { cn: '茶不仅是一种饮料，更是一种反映中国哲学的生活方式。', refEn: 'Tea is not merely a beverage but a way of life that reflects Chinese philosophy.', keywords: ['tea', 'beverage', 'way of life', 'philosophy'] },
                        { cn: '中国茶道强调和、敬、清、寂。', refEn: 'The Chinese tea ceremony emphasizes harmony, respect, purity, and tranquility.', keywords: ['tea ceremony', 'harmony', 'respect', 'purity', 'tranquility'] },
                        { cn: '茶馆是人们聚集讨论商务的重要社交空间。', refEn: 'Tea houses serve as important social spaces where people gather to discuss business.', keywords: ['tea houses', 'social spaces', 'discuss business'] },
                        { cn: '这种全球性的兴趣有助于保护和推广传统制茶技艺。', refEn: 'This global interest helps preserve and promote traditional tea-making techniques.', keywords: ['global interest', 'preserve', 'promote', 'traditional'] }
                    ]
                },
                {
                    title: 'Chinese Calligraphy',
                    blocks: [
                        { en: 'Chinese calligraphy is one of the highest forms of Chinese art, serving both as a means of communication and as an expression of artistic beauty. It has been practiced for over three thousand years and continues to be highly valued in Chinese culture today.', cn: '中国书法是中国艺术的最高形式之一，既是交流手段，也是艺术美的表达。它已有三千多年的历史，至今在中国文化中仍然备受重视。', keywords: ['highest forms', 'artistic beauty', 'highly valued'] },
                        { en: 'The four treasures of the study — brush, ink, paper, and inkstone — are the essential tools for calligraphy. Mastering calligraphy requires years of dedicated practice and a deep understanding of Chinese characters. Each stroke carries meaning, and the balance of the characters reflects the calligrapher\'s skill and personality.', cn: '文房四宝——笔、墨、纸、砚——是书法的基本工具。掌握书法需要多年的专注练习和对汉字的深刻理解。每一笔都有意义，字的平衡反映了书法家的技艺和个性。', keywords: ['four treasures', 'dedicated practice', 'balance of characters'] },
                        { en: 'Calligraphy is not only an art form but also a form of meditation. The focused attention required to create each character helps practitioners achieve a state of inner calm and concentration. Many people practice calligraphy as a way to relieve stress and cultivate patience in their daily lives.', cn: '书法不仅是一种艺术形式，也是一种冥想。创作每个字所需的专注帮助练习者达到内心平静和专注的状态。许多人通过练习书法来缓解压力，在日常生活中培养耐心。', keywords: ['form of meditation', 'inner calm', 'relieve stress'] },
                        { en: 'In contemporary China, calligraphy remains an important part of education and cultural identity. Schools teach calligraphy as part of the curriculum, and calligraphy exhibitions attract large audiences. The digital age has not diminished interest in this ancient art; rather, it has created new platforms for sharing and learning calligraphy online.', cn: '在当代中国，书法仍然是教育和文化认同的重要组成部分。学校将书法作为课程的一部分来教授，书法展览吸引了大量观众。数字时代并没有削弱人们对这门古老艺术的兴趣，相反，它为在线分享和学习书法创造了新的平台。', keywords: ['cultural identity', 'curriculum', 'digital age'] }
                    ],
                    sentences: [
                        { cn: '文房四宝是书法的基本工具。', refEn: 'The four treasures of the study are the essential tools for calligraphy.', keywords: ['four treasures', 'essential tools', 'calligraphy'] },
                        { cn: '书法不仅是一种艺术形式，也是一种冥想。', refEn: 'Calligraphy is not only an art form but also a form of meditation.', keywords: ['calligraphy', 'art form', 'meditation'] },
                        { cn: '专注的练习帮助练习者达到内心平静的状态。', refEn: 'The focused attention helps practitioners achieve a state of inner calm.', keywords: ['focused attention', 'inner calm', 'achieve'] },
                        { cn: '数字时代并没有削弱人们对这门古老艺术的兴趣。', refEn: 'The digital age has not diminished interest in this ancient art.', keywords: ['digital age', 'diminished', 'ancient art', 'interest'] }
                    ]
                }
            ],
            technology: [
                {
                    title: 'Artificial Intelligence',
                    blocks: [
                        { en: 'Artificial intelligence has become one of the most transformative technologies of the 21st century. From virtual assistants on smartphones to recommendation systems on streaming platforms, AI has seamlessly integrated into everyday life. Machine learning algorithms can now recognize speech, translate languages, and even generate creative content with remarkable accuracy.', cn: '人工智能已成为21世纪最具变革性的技术之一。从智能手机上的虚拟助手到流媒体平台上的推荐系统，人工智能已无缝融入日常生活。机器学习算法现在能够以惊人的准确性识别语音、翻译语言，甚至生成创意内容。', keywords: ['transformative technologies', 'machine learning', 'creative content'] },
                        { en: 'In the healthcare sector, AI is revolutionizing disease diagnosis and drug discovery. Advanced algorithms can analyze medical images to detect tumors at early stages, often with greater precision than human doctors. AI-powered drug discovery platforms are accelerating the development of new medications, potentially saving years of research time.', cn: '在医疗领域，人工智能正在革新疾病诊断和药物研发。先进的算法可以分析医学影像，在早期阶段检测肿瘤，其精确度往往超过人类医生。人工智能驱动的药物研发平台正在加速新药的开发，可能节省数年的研究时间。', keywords: ['disease diagnosis', 'drug discovery', 'medical images'] },
                        { en: 'The development of autonomous vehicles represents another major breakthrough in AI technology. Self-driving cars use a combination of sensors, cameras, and neural networks to navigate roads safely. Companies around the world are investing billions in this technology, which promises to reduce traffic accidents and transform urban transportation.', cn: '自动驾驶汽车的发展代表了人工智能技术的另一项重大突破。自动驾驶汽车使用传感器、摄像头和神经网络的组合来安全地导航道路。世界各地的公司正在向这项技术投资数十亿美元，它有望减少交通事故并改变城市交通。', keywords: ['autonomous vehicles', 'neural networks', 'traffic accidents'] },
                        { en: 'However, the rapid advancement of AI also raises important ethical questions. Concerns about job displacement, data privacy, and algorithmic bias have sparked global debates. Governments and organizations are working to establish regulations and ethical frameworks to ensure that AI development benefits society while minimizing potential risks.', cn: '然而，人工智能的快速发展也引发了重要的伦理问题。对失业、数据隐私和算法偏见的担忧引发了全球性的辩论。政府和组织正在努力建立法规和伦理框架，以确保人工智能发展造福社会，同时最大限度地降低潜在风险。', keywords: ['ethical questions', 'job displacement', 'algorithmic bias'] }
                    ],
                    sentences: [
                        { cn: '人工智能已成为21世纪最具变革性的技术之一。', refEn: 'Artificial intelligence has become one of the most transformative technologies of the 21st century.', keywords: ['artificial intelligence', 'transformative', '21st century'] },
                        { cn: '先进的算法可以分析医学影像，在早期阶段检测肿瘤。', refEn: 'Advanced algorithms can analyze medical images to detect tumors at early stages.', keywords: ['algorithms', 'medical images', 'detect tumors'] },
                        { cn: '自动驾驶汽车使用传感器和神经网络来安全导航道路。', refEn: 'Self-driving cars use sensors and neural networks to navigate roads safely.', keywords: ['self-driving cars', 'neural networks', 'navigate roads'] },
                        { cn: '政府和组织正在努力建立人工智能伦理框架。', refEn: 'Governments and organizations are working to establish ethical frameworks for AI.', keywords: ['governments', 'ethical frameworks', 'AI'] }
                    ]
                },
                {
                    title: '5G and the Internet of Things',
                    blocks: [
                        { en: 'The rollout of 5G networks has ushered in a new era of connectivity. With speeds up to 100 times faster than 4G, 5G technology enables real-time communication between devices on an unprecedented scale. This ultra-fast, low-latency network is the backbone of the Internet of Things, connecting everything from smart home appliances to industrial machinery.', cn: '5G网络的推出 ushered in 了一个连接的新时代。5G技术的速度比4G快100倍，使设备之间能够以空前的规模进行实时通信。这种超高速、低延迟的网络是物联网的支柱，连接从智能家居电器到工业机械的一切设备。', keywords: ['5G networks', 'real-time communication', 'Internet of Things'] },
                        { en: 'Smart cities are one of the most promising applications of 5G and IoT technology. Connected traffic systems can optimize signal timing to reduce congestion, while smart grids manage electricity distribution more efficiently. Environmental sensors monitor air quality in real time, providing valuable data for urban planning and public health.', cn: '智慧城市是5G和物联网技术最有前景的应用之一。连接的交通系统可以优化信号时间以减少拥堵，而智能电网可以更有效地管理电力分配。环境传感器实时监测空气质量，为城市规划和公共卫生提供有价值的数据。', keywords: ['smart cities', 'smart grids', 'environmental sensors'] },
                        { en: 'In agriculture, IoT devices are transforming traditional farming practices. Soil sensors monitor moisture and nutrient levels, while drones equipped with cameras survey crop health. This data-driven approach allows farmers to optimize irrigation, reduce pesticide use, and increase crop yields, contributing to more sustainable food production.', cn: '在农业领域，物联网设备正在改变传统的耕作方式。土壤传感器监测湿度和养分水平，而配备摄像头的无人机则调查作物健康状况。这种数据驱动的方法使农民能够优化灌溉、减少农药使用并提高作物产量，从而促进更可持续的粮食生产。', keywords: ['IoT devices', 'soil sensors', 'sustainable food production'] },
                        { en: 'The combination of 5G and edge computing is enabling new possibilities in augmented and virtual reality. These technologies are being applied in education, healthcare, and entertainment, creating immersive experiences that were previously impossible. As 5G coverage expands globally, the full potential of these connected technologies is just beginning to be realized.', cn: '5G和边缘计算的结合正在为增强现实和虚拟现实开辟新的可能性。这些技术正在教育、医疗和娱乐领域得到应用，创造出以前不可能的沉浸式体验。随着5G覆盖范围在全球的扩大，这些连接技术的全部潜力才刚刚开始实现。', keywords: ['edge computing', 'augmented reality', 'immersive experiences'] }
                    ],
                    sentences: [
                        { cn: '5G技术的速度比4G快100倍。', refEn: '5G technology is up to 100 times faster than 4G.', keywords: ['5G technology', 'faster', '4G'] },
                        { cn: '智慧城市是5G和物联网技术最有前景的应用之一。', refEn: 'Smart cities are one of the most promising applications of 5G and IoT technology.', keywords: ['smart cities', '5G', 'IoT technology'] },
                        { cn: '物联网设备正在改变传统的耕作方式。', refEn: 'IoT devices are transforming traditional farming practices.', keywords: ['IoT devices', 'transforming', 'farming practices'] },
                        { cn: '增强现实技术正在教育领域创造沉浸式体验。', refEn: 'Augmented reality technology is creating immersive experiences in education.', keywords: ['augmented reality', 'immersive experiences', 'education'] }
                    ]
                }
            ],
            society: [
                {
                    title: 'Digital Life in China',
                    blocks: [
                        { en: 'China has become one of the world\'s most digitally advanced societies, with mobile payment, e-commerce, and online services deeply integrated into daily life. For many Chinese consumers, cash has become almost unnecessary as mobile payment platforms like Alipay and WeChat Pay dominate transactions across all sectors of the economy.', cn: '中国已成为世界上数字化程度最高的社会之一，移动支付、电子商务和在线服务已深度融入日常生活。对于许多中国消费者来说，现金几乎变得不必要，因为支付宝和微信支付等移动支付平台主导了经济各领域的交易。', keywords: ['digitally advanced', 'mobile payment', 'deeply integrated'] },
                        { en: 'Online shopping has revolutionized retail in China. E-commerce platforms offer an enormous variety of products at competitive prices, with fast delivery services that can reach even remote rural areas. Live-streaming e-commerce has emerged as a major trend, combining entertainment with shopping in a way that has transformed consumer behavior.', cn: '网购已经彻底改变了中国的零售业。电子商务平台以有竞争力的价格提供种类繁多的商品，快递服务可以到达偏远农村地区。直播电商已成为一大趋势，将娱乐与购物相结合，改变了消费者的行为。', keywords: ['revolutionized retail', 'live-streaming e-commerce', 'consumer behavior'] },
                        { en: 'Digital technology has also transformed education in China. Online learning platforms provide access to educational resources for students of all ages and backgrounds. During the pandemic, digital education tools became essential, and many schools have continued to incorporate online elements into their teaching methods even after normal operations resumed.', cn: '数字技术也改变了中国的教育。在线学习平台为各种年龄和背景的学生提供了获取教育资源的途径。在疫情期间，数字教育工具变得不可或缺，许多学校在恢复正常运营后仍继续将在线元素纳入教学方法中。', keywords: ['transformed education', 'online learning platforms', 'digital education tools'] },
                        { en: 'While digital life brings tremendous convenience, it also raises concerns about privacy, screen addiction, and the digital divide between urban and rural areas. The government has introduced regulations to protect consumer data and limit the time minors spend on online games. Balancing technological progress with social well-being remains an ongoing challenge.', cn: '虽然数字生活带来了极大的便利，但也引发了对隐私、屏幕上瘾以及城乡数字鸿沟的担忧。政府出台了保护消费者数据和限制未成年人网络游戏时间的法规。在技术进步和社会福祉之间保持平衡仍然是一个持续的挑战。', keywords: ['privacy concerns', 'digital divide', 'balancing technological progress'] }
                    ],
                    sentences: [
                        { cn: '中国已成为世界上数字化程度最高的社会之一。', refEn: 'China has become one of the world\'s most digitally advanced societies.', keywords: ['China', 'digitally advanced', 'societies'] },
                        { cn: '直播电商已成为电子商务的一大趋势。', refEn: 'Live-streaming e-commerce has emerged as a major trend in online shopping.', keywords: ['live-streaming', 'e-commerce', 'major trend'] },
                        { cn: '政府出台了法规来保护消费者数据。', refEn: 'The government has introduced regulations to protect consumer data.', keywords: ['government', 'regulations', 'protect', 'consumer data'] },
                        { cn: '城乡之间的数字鸿沟仍然是一个令人关注的问题。', refEn: 'The digital divide between urban and rural areas remains a concern.', keywords: ['digital divide', 'urban', 'rural areas', 'concern'] }
                    ]
                },
                {
                    title: 'Health and Wellness',
                    blocks: [
                        { en: 'Health awareness has increased significantly among Chinese people in recent years. More people are adopting active lifestyles, paying attention to nutrition, and prioritizing mental well-being. The concept of "healthy China" has become a national initiative, with government policies promoting exercise, balanced diets, and preventive healthcare.', cn: '近年来，中国人的健康意识显著提高。越来越多的人采取积极的生活方式，关注营养，并将心理健康放在首位。"健康中国"的概念已成为一项国家倡议，政府政策促进锻炼、均衡饮食和预防性医疗保健。', keywords: ['health awareness', 'active lifestyles', 'preventive healthcare'] },
                        { en: 'The fitness industry in China has experienced remarkable growth. Gyms, yoga studios, and fitness apps have proliferated in cities across the country. Outdoor activities such as running, cycling, and hiking have gained popularity among people of all ages. Marathon running, in particular, has become a cultural phenomenon, with major cities hosting annual events that attract tens of thousands of participants.', cn: '中国的健身产业经历了显著增长。健身房、瑜伽馆和健身应用在全国各地的城市中大量涌现。跑步、骑自行车和徒步旅行等户外活动在各个年龄段的人群中越来越受欢迎。马拉松跑步尤其成为一种文化现象，主要城市每年举办的活动吸引了数万名参与者。', keywords: ['fitness industry', 'cultural phenomenon', 'marathon running'] },
                        { en: 'Traditional Chinese medicine continues to play an important role in health and wellness. Practices such as acupuncture, herbal medicine, and tai chi are valued not only in China but increasingly around the world. Many people integrate traditional and modern medical approaches, seeking the benefits of both systems for comprehensive health management.', cn: '中医药在健康和养生方面继续发挥着重要作用。针灸、草药和太极等实践不仅在中国受到重视，在世界范围内也越来越受到重视。许多人将传统和现代医疗方法相结合，寻求两种系统的益处以实现全面的健康管理。', keywords: ['traditional Chinese medicine', 'acupuncture', 'comprehensive health management'] },
                        { en: 'Mental health has also received greater attention in Chinese society. The pressures of modern life, including work stress and academic competition, have highlighted the need for psychological support services. Counseling services, helplines, and community mental health programs are expanding, reflecting a growing recognition that mental well-being is just as important as physical health.', cn: '心理健康在中国社会也得到了更多关注。现代生活的压力，包括工作压力和学业竞争，凸显了对心理支持服务的需求。咨询服务、热线和社区心理健康项目正在扩大，反映了人们越来越认识到心理健康与身体健康同等重要。', keywords: ['mental health', 'psychological support', 'mental well-being'] }
                    ],
                    sentences: [
                        { cn: '"健康中国"已成为一项国家倡议。', refEn: 'The concept of "healthy China" has become a national initiative.', keywords: ['healthy China', 'national initiative', 'concept'] },
                        { cn: '马拉松跑步已成为中国城市的一种文化现象。', refEn: 'Marathon running has become a cultural phenomenon in Chinese cities.', keywords: ['marathon running', 'cultural phenomenon', 'Chinese cities'] },
                        { cn: '许多人将传统和现代医疗方法相结合，以实现全面的健康管理。', refEn: 'Many people integrate traditional and modern medical approaches for comprehensive health management.', keywords: ['integrate', 'traditional', 'modern', 'comprehensive health'] },
                        { cn: '心理健康与身体健康同等重要。', refEn: 'Mental well-being is just as important as physical health.', keywords: ['mental well-being', 'physical health', 'important'] }
                    ]
                }
            ]
        };
        return materials[topic] || materials.culture;
    }

    renderTranslation(material) {
        const container = document.getElementById('translation-passage');
        let html = `<h3 style="margin-bottom: 16px; color: var(--accent);">📚 ${material.title}</h3>`;
        
        material.blocks.forEach(block => {
            html += `
                <div class="passage-block">
                    <div class="en-text">${block.en}</div>
                    <div class="cn-text">${block.cn}</div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    }

    renderTranslationSentences(material) {
        const container = document.getElementById('translation-sentences');
        container.innerHTML = '';

        material.sentences.forEach((s, idx) => {
            const item = document.createElement('div');
            item.className = 'translation-sentence-item';
            item.innerHTML = `
                <div class="sentence-label">句子 ${idx + 1}</div>
                <div class="sentence-cn">${s.cn}</div>
                <div class="sentence-keywords-hint">💡 关键词提示：${s.keywords.map(k => `<span class="keyword-tag">${k}</span>`).join(' ')}</div>
                <textarea id="translation-input-${idx}" placeholder="Please type the English translation..." data-idx="${idx}"></textarea>
                <div class="sentence-upload-row">
                    <button class="btn-photo-sentence" onclick="app.openSentencePhotoDialog(${idx})" title="拍照识别填入">
                        📷 拍照
                    </button>
                    <button class="btn-photo-sentence" onclick="document.getElementById('sentence-file-${idx}').click()" title="上传文件识别">
                        📎 文件
                    </button>
                    <input type="file" id="sentence-file-${idx}" accept="image/*" style="display:none" onchange="app.handleSentenceFile(${idx}, this)">
                    <span class="photo-status" id="sentence-photo-status-${idx}"></span>
                </div>
            `;
            container.appendChild(item);
        });

        // Add input listeners
        container.querySelectorAll('textarea').forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                this.translationInputs[parseInt(e.target.dataset.idx)] = e.target.value;
            });
        });
    }

    async submitTranslationAnswers() {
        if (!this.currentTranslation) return;
        
        const sentences = this.currentTranslation.sentences;
        const results = [];
        
        // Try AI evaluation first
        const hasApiKey = this.settings.apiKey && this.settings.apiKey.trim().length > 0;
        
        if (hasApiKey) {
            // AI evaluation
            const prompt = `你是一个英语翻译评分助手。请评判以下中翻英翻译的质量。

规则：
1. 每题给出0-100的分数
2. 检查语法正确性、用词准确性、表达地道性
3. 给出简短的改进建议（中文）
4. 用JSON格式返回结果

题目和答案：
${sentences.map((s, idx) => {
    const userInput = this.translationInputs[idx] || '（未作答）';
    return `第${idx+1}题：
中文：${s.cn}
参考英文：${s.refEn}
学生翻译：${userInput}
关键词：${s.keywords.join(', ')}`;
}).join('\n\n')}

请返回JSON格式：
{"results": [{"score": 85, "feedback": "语法正确，表达地道", "suggestions": "可以更简洁"}, ...]}`;

            try {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.settings.apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 1000
                    })
                });
                
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content || '';
                
                // Parse AI response
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const aiResults = JSON.parse(jsonMatch[0]);
                    aiResults.results.forEach((aiR, idx) => {
                        results.push({
                            cn: sentences[idx].cn,
                            refEn: sentences[idx].refEn,
                            userInput: this.translationInputs[idx] || '（未作答）',
                            keywords: sentences[idx].keywords,
                            score: aiR.score || 0,
                            feedback: aiR.feedback || '',
                            suggestions: aiR.suggestions || '',
                            isAI: true
                        });
                    });
                } else {
                    // Fallback to local evaluation
                    this.localTranslationEval(sentences, results);
                }
            } catch (err) {
                console.error('AI evaluation failed:', err);
                this.localTranslationEval(sentences, results);
            }
        } else {
            // Local keyword matching evaluation
            this.localTranslationEval(sentences, results);
        }
        
        const avgScore = results.length > 0 
            ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length) 
            : 0;
        
        this.renderTranslationResult(avgScore, results);
        
        // Update module stats
        const moduleStats = Storage.getModuleStats();
        moduleStats.translation.total += 1;
        moduleStats.translation.sentences += results.length;
        // Running average score
        const prevTotal = moduleStats.translation.total - 1;
        if (prevTotal > 0) {
            moduleStats.translation.avgScore = Math.round(
                (moduleStats.translation.avgScore * prevTotal + avgScore) / moduleStats.translation.total
            );
        } else {
            moduleStats.translation.avgScore = avgScore;
        }
        Storage.saveModuleStats(moduleStats);
        
        // Add activity
        const completed = results.filter(r => r.score >= 60).length;
        Storage.addActivity({
            type: completed >= 3 ? 'correct' : 'wrong',
            message: `🌐 翻译练习：${this.currentTranslation.title}，均分 ${avgScore}，${completed}/${results.length} 句及格`
        });
        
        document.getElementById('translation-card').style.display = 'none';
        document.getElementById('translation-result').style.display = 'block';

        // 学习助手Agent反馈
        const transWrongItems = results.filter(r => r.score < 60).map(r => ({
            score: r.score,
            correctAnswer: r.refEn || '',
            userAnswer: r.userInput || ''
        }));
        this.showAgentFeedback('translation', avgScore, completed, results.length, transWrongItems);
    }
    
    localTranslationEval(sentences, results) {
        sentences.forEach((s, idx) => {
            const userInput = (this.translationInputs[idx] || '').trim().toLowerCase();
            const refEn = s.refEn.toLowerCase();
            
            // Score based on keyword coverage and similarity
            let score = 0;
            const matchedKeywords = [];
            const missedKeywords = [];
            
            s.keywords.forEach(kw => {
                const kwLower = kw.toLowerCase();
                if (userInput.includes(kwLower)) {
                    matchedKeywords.push(kw);
                    score += 20;
                } else {
                    missedKeywords.push(kw);
                }
            });
            
            // Bonus for reasonable length (not too short, not too long)
            const refWords = refEn.split(/\s+/).length;
            const userWords = userInput.split(/\s+/).length;
            if (userWords >= refWords * 0.5 && userWords <= refWords * 2) {
                score += 10;
            }
            
            // Cap at 100
            score = Math.min(100, score);
            
            const feedback = matchedKeywords.length === s.keywords.length 
                ? '✅ 关键词全部正确！' 
                : `使用了 ${matchedKeywords.length}/${s.keywords.length} 个关键词`;
            
            results.push({
                cn: s.cn,
                refEn: s.refEn,
                userInput: this.translationInputs[idx] || '（未作答）',
                keywords: s.keywords,
                matchedKeywords,
                missedKeywords,
                score,
                feedback,
                suggestions: missedKeywords.length > 0 ? `建议使用：${missedKeywords.join(', ')}` : '',
                isAI: false
            });
        });
    }

    renderTranslationResult(avgScore, results) {
        const content = document.getElementById('translation-result-content');
        const elapsed = this.stopTimer('translation');

        let html = `
            <div class="result-score">${avgScore}</div>
            <div class="result-score-label">平均得分 · ${results.length} 句翻译 · 用时 ${this.formatTime(elapsed)}</div>
        `;

        results.forEach((r, idx) => {
            const scoreColor = r.score >= 80 ? '#43e97b' : r.score >= 60 ? '#fbbf24' : '#ff6b6b';
            html += `
                <div class="translation-detail">
                    <div class="detail-cn">${idx + 1}. 中文：${r.cn}</div>
                    <div class="detail-user">你的英文：${r.userInput}</div>
                    <div class="detail-ref">参考英文：${r.refEn}</div>
                    <div class="detail-keywords">关键词：${r.keywords.join(' / ')}</div>
                    <div class="detail-score-bar" style="color: ${scoreColor};">
                        <strong>${r.score}分</strong> — ${r.feedback}
                    </div>
                    ${r.suggestions ? `<div class="detail-suggestions">💡 ${r.suggestions}</div>` : ''}
                    ${!r.isAI ? '<small style="color: var(--text-muted);">（本地评判，设置API Key可使用AI精准评判）</small>' : ''}
                </div>
            `;
        });

        content.innerHTML = html;
    }

    handleTranslationFileUpload(file) {
        if (!file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
            alert('请上传 .txt 或 .md 格式的文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            this.parseAndGradeTranslationFile(content, file.name);
        };
        reader.readAsText(file);
    }

    // ===== 摄像头拍照上传 =====
    setupCameraUpload() {
        const video = document.getElementById('camera-video');
        const canvas = document.getElementById('camera-canvas');
        const photo = document.getElementById('camera-photo');
        const placeholder = document.getElementById('camera-placeholder');
        const btnStart = document.getElementById('btn-camera-start');
        const btnSnap = document.getElementById('btn-camera-snap');
        const btnRetake = document.getElementById('btn-camera-retake');
        const btnOcr = document.getElementById('btn-camera-ocr');
        const status = document.getElementById('camera-status');
        
        let stream = null;
        
        const setStatus = (msg, type = '') => {
            status.textContent = msg;
            status.className = 'camera-status ' + type;
        };
        
        const showElement = (el) => el && (el.style.display = 'block');
        const hideElement = (el) => el && (el.style.display = 'none');
        
        // Start camera
        btnStart?.addEventListener('click', async () => {
            try {
                setStatus('正在请求摄像头权限...', 'processing');
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: 'environment' } 
                });
                video.srcObject = stream;
                showElement(video);
                hideElement(placeholder);
                hideElement(btnStart);
                showElement(btnSnap);
                setStatus('摄像头已启动，请对准翻译内容拍照');
            } catch (err) {
                setStatus('无法访问摄像头：' + err.message, 'error');
                console.error('Camera error:', err);
            }
        });
        
        // Take photo
        btnSnap?.addEventListener('click', () => {
            if (!stream) return;
            
            const ctx = canvas.getContext('2d');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Stop camera
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            
            // Show photo
            photo.src = canvas.toDataURL('image/png');
            hideElement(video);
            showElement(photo);
            hideElement(btnSnap);
            showElement(btnRetake);
            showElement(btnOcr);
            setStatus('拍照完成，点击"识别并评分"进行OCR识别');
        });
        
        // Retake
        btnRetake?.addEventListener('click', async () => {
            hideElement(photo);
            hideElement(btnRetake);
            hideElement(btnOcr);
            showElement(btnStart);
            setStatus('');
        });
        
        // OCR and grade
        btnOcr?.addEventListener('click', async () => {
            if (!photo.src) return;
            
            setStatus('正在进行OCR文字识别，请稍候...', 'processing');
            btnOcr.disabled = true;
            
            try {
                const result = await Tesseract.recognize(
                    photo.src,
                    'eng',
                    { logger: m => {
                        if (m.status === 'recognizing text') {
                            setStatus(`OCR识别中... ${Math.round(m.progress * 100)}%`, 'processing');
                        }
                    }}
                );
                
                const recognizedText = result.data.text;
                setStatus('OCR识别完成！正在进行评分...', 'success');
                
                // Use existing grading logic
                this.parseAndGradeTranslationFile(recognizedText, 'camera_photo.png');
                
            } catch (err) {
                setStatus('OCR识别失败：' + err.message, 'error');
                console.error('OCR error:', err);
            } finally {
                btnOcr.disabled = false;
            }
        });
    }

    parseAndGradeTranslationFile(content, filename) {
        // Split content by lines and filter empty lines
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (!this.currentTranslation) {
            alert('请先选择一篇翻译练习题目');
            return;
        }

        const sentences = this.currentTranslation.sentences;
        if (lines.length < sentences.length) {
            alert(`文件中的句子数量(${lines.length})少于题目要求的数量(${sentences.length})，请检查文件内容`);
            return;
        }

        // Grade each sentence
        const results = sentences.map((sentence, idx) => {
            const userTranslation = lines[idx] || '';
            const refEn = sentence.refEn.toLowerCase();
            const userLower = userTranslation.toLowerCase();

            // Check keywords
            const keywords = sentence.keywords || [];
            const matchedKeywords = keywords.filter(kw => userLower.includes(kw.toLowerCase()));
            const keywordScore = Math.round((matchedKeywords.length / keywords.length) * 60);

            // Length similarity (0-20 points)
            const lenDiff = Math.abs(userTranslation.length - sentence.refEn.length);
            const lenScore = lenDiff < 20 ? 20 : lenDiff < 50 ? 10 : 5;

            // Completeness (0-20 points)
            const completenessScore = userTranslation.length > 10 ? 20 : 10;

            const score = Math.min(100, keywordScore + lenScore + completenessScore);

            return {
                sentence,
                userTranslation,
                score,
                matchedKeywords,
                totalKeywords: keywords.length
            };
        });

        const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);

        // Show result
        this.renderFileUploadResult(avgScore, results, filename);

        // Update stats
        const moduleStats = Storage.getModuleStats();
        moduleStats.translation.total += 1;
        moduleStats.translation.sentences += results.length;
        const prevTotal = moduleStats.translation.total - 1;
        if (prevTotal > 0) {
            moduleStats.translation.avgScore = Math.round(
                (moduleStats.translation.avgScore * prevTotal + avgScore) / moduleStats.translation.total
            );
        } else {
            moduleStats.translation.avgScore = avgScore;
        }
        Storage.saveModuleStats(moduleStats);
    }

    renderFileUploadResult(avgScore, results, filename) {
        const content = document.getElementById('translation-result-content');
        if (!content) return;

        let html = `
            <div class="result-score">${avgScore}</div>
            <div class="result-score-label">文件评分 · ${filename} · ${results.length} 句翻译</div>
            <div class="file-upload-result">
                <strong>📄 文件翻译评分结果</strong>
            </div>
        `;

        results.forEach((result, idx) => {
            const status = result.score >= 60 ? '✅' : '❌';
            html += `
                <div class="translation-item">
                    <div class="translation-cn"><strong>${idx + 1}.</strong> ${result.sentence.cn}</div>
                    <div class="translation-user"><span class="label">你的英文：</span>${result.userTranslation}</div>
                    <div class="translation-ref"><span class="label">参考英文：</span>${result.sentence.refEn}</div>
                    <div class="translation-keywords">关键词：${result.sentence.keywords.join(' / ')}</div>
                    <div class="translation-grade">${status} ${result.score}分 — 匹配关键词 ${result.matchedKeywords.length}/${result.totalKeywords}</div>
                </div>
            `;
        });

        content.innerHTML = html;
        document.getElementById('translation-card').style.display = 'none';
        document.getElementById('translation-result').style.display = 'block';
    }

    downloadExercise(type) {
        const includeTranslation = confirm('是否包含中文翻译？\n点击"确定"包含翻译，点击"取消"仅下载英文题目。');

        let content = '';
        let filename = '';
        const date = new Date().toLocaleDateString('zh-CN');

        if (type === 'reading' && this.currentPassage) {
            filename = `阅读练习_${this.currentPassage.title}_${date}.md`;
            content = this.generateReadingMarkdown(this.currentPassage, includeTranslation);
        } else if (type === 'translation' && this.currentTranslation) {
            filename = `翻译练习_${this.currentTranslation.title}_${date}.md`;
            content = this.generateTranslationMarkdown(this.currentTranslation, includeTranslation);
        } else if (type === 'cloze' && this.currentCloze) {
            filename = `选词填空_${this.currentCloze.title}_${date}.md`;
            content = this.generateClozeMarkdown(this.currentCloze, includeTranslation);
        } else {
            alert('当前没有可下载的题目，请先生成一篇练习');
            return;
        }

        this.downloadFile(content, filename);
    }

    generateReadingMarkdown(passage, includeTranslation) {
        let md = `# 阅读练习：${passage.title}\n\n`;
        md += `**词数**：约 ${passage.wordCount} 词\n\n`;
        md += `---\n\n`;
        md += `## 文章\n\n`;
        md += passage.text + '\n\n';

        if (includeTranslation && passage.cnText) {
            md += `## 中文翻译\n\n`;
            md += passage.cnText + '\n\n';
        }

        md += `---\n\n`;
        md += `## 题目\n\n`;
        passage.questions.forEach((q, idx) => {
            md += `${idx + 1}. ${q.text}\n`;
            if (includeTranslation && q.textCn) {
                md += `   > ${q.textCn}\n`;
            }
            q.options.forEach((opt, optIdx) => {
                md += `   ${String.fromCharCode(65 + optIdx)}. ${opt}\n`;
                if (includeTranslation && q.optionsCn) {
                    md += `      > ${q.optionsCn[optIdx]}\n`;
                }
            });
            md += '\n';
        });

        return md;
    }

    generateTranslationMarkdown(material, includeTranslation) {
        let md = `# 翻译练习：${material.title}\n\n`;
        md += `---\n\n`;
        md += `## 阅读原文\n\n`;
        material.blocks.forEach(block => {
            md += block.en + '\n\n';
            if (includeTranslation) {
                md += `> ${block.cn}\n\n`;
            }
        });

        md += `---\n\n`;
        md += `## 翻译题目（中译英）\n\n`;
        material.sentences.forEach((s, idx) => {
            md += `${idx + 1}. ${s.cn}\n`;
            if (includeTranslation) {
                md += `   > 参考译文：${s.refEn}\n`;
            }
            md += '\n';
        });

        return md;
    }

    generateClozeMarkdown(cloze, includeTranslation) {
        let md = `# 选词填空：${cloze.title}\n\n`;
        md += `---\n\n`;
        md += `## 文章\n\n`;
        md += cloze.text + '\n\n';

        md += `---\n\n`;
        md += `## 选项\n\n`;
        cloze.blanks.forEach((blank, idx) => {
            md += `${idx + 1}. `;
            blank.options.forEach((opt, optIdx) => {
                md += `${String.fromCharCode(65 + optIdx)}. ${opt}  `;
            });
            md += '\n';
        });

        if (includeTranslation) {
            md += `\n---\n\n`;
            md += `## 答案\n\n`;
            cloze.blanks.forEach((blank, idx) => {
                md += `${idx + 1}. ${blank.word}\n`;
            });
        }

        return md;
    }

    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ===== 计时器工具 =====
    startTimer(module) {
        // Clear any existing interval
        if (this.timers[module]?.interval) {
            clearInterval(this.timers[module].interval);
        }
        this.timers[module] = { start: Date.now(), elapsed: 0 };
        
        // Map module to timer element ID
        const timerIdMap = {
            practice: 'practice-timer',
            reading: 'reading-timer',
            translation: 'translation-timer',
            cloze: 'cloze-timer'
        };
        const timerEl = document.getElementById(timerIdMap[module]);
        if (!timerEl) return;
        
        // Start real-time update
        this.timers[module].interval = setInterval(() => {
            const elapsed = Date.now() - this.timers[module].start;
            timerEl.textContent = '⏱️ ' + this.formatTimerDisplay(elapsed);
        }, 1000);
    }
    
    stopTimer(module) {
        const timer = this.timers[module];
        if (timer) {
            if (timer.interval) {
                clearInterval(timer.interval);
                timer.interval = null;
            }
            if (timer.start) {
                timer.elapsed = Date.now() - timer.start;
                timer.start = null;
                // 持久化学习总时长
                this.totalStudyTime += timer.elapsed;
                localStorage.setItem('ciguang_study_time', String(this.totalStudyTime));
                return timer.elapsed;
            }
        }
        return timer?.elapsed || 0;
    }
    
    formatTimerDisplay(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        const m = minutes.toString().padStart(2, '0');
        const s = remainingSeconds.toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    showLoading(message) {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <p id="loading-message">加载中...</p>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        document.getElementById('loading-message').textContent = message || '加载中...';
        overlay.style.display = 'flex';
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    formatTime(ms) {
        if (ms < 1000) return '1秒';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return `${remainingSeconds}秒`;
        return `${minutes}分${remainingSeconds}秒`;
    }

    // ===== 错题本功能 =====

    // 记录错题
    addWrongRecord(record) {
        record.id = Date.now();
        record.createdAt = new Date().toISOString();
        // 避免重复（同一单词同一类型30分钟内不重复记录）
        const recent = this.wrongRecords.find(r =>
            r.word === record.word && r.type === record.type &&
            (Date.now() - new Date(r.createdAt).getTime()) < 30 * 60 * 1000
        );
        if (!recent) {
            this.wrongRecords.push(record);
            this.saveWrongRecords();
        }
    }

    // 保存错题记录到localStorage
    saveWrongRecords() {
        localStorage.setItem('wrong_records', JSON.stringify(this.wrongRecords));
    }

    // 移除单条错题
    removeWrongRecord(id) {
        this.wrongRecords = this.wrongRecords.filter(r => r.id !== id);
        this.saveWrongRecords();
        this.renderWrongList();
    }

    // 清空所有错题
    clearWrongRecords() {
        if (confirm('确定要清空所有错题记录吗？')) {
            this.wrongRecords = [];
            this.saveWrongRecords();
            this.renderWrongList();
        }
    }

    // 渲染错题列表
    renderWrongList(filter = 'all') {
        const list = document.getElementById('wrong-list');
        const filtered = filter === 'all' ? this.wrongRecords : this.wrongRecords.filter(r => r.type === filter);

        // 更新统计数据
        document.getElementById('wrong-total').textContent = this.wrongRecords.length;
        document.getElementById('wrong-practice-count').textContent = this.wrongRecords.filter(r => r.type === 'practice').length;
        document.getElementById('wrong-reading-count').textContent = this.wrongRecords.filter(r => r.type === 'reading').length;
        document.getElementById('wrong-cloze-count').textContent = this.wrongRecords.filter(r => r.type === 'cloze').length;
        document.getElementById('wrong-memory-count').textContent = this.wrongRecords.filter(r => r.type === 'memory').length;

        if (filtered.length === 0) {
            list.innerHTML = '<div class="wrong-empty"><div class="empty-icon">🎉</div><p>暂无错题，继续保持！</p></div>';
            return;
        }

        list.innerHTML = filtered.map(record => `
            <div class="wrong-item" data-id="${record.id}">
                <div class="wrong-item-header">
                    <span class="wrong-item-type ${record.type}">${{practice: '例句练习', reading: '阅读练习', cloze: '选词填空', memory: '单词记忆'}[record.type] || record.type}</span>
                    <span class="wrong-item-time">${new Date(record.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <div class="wrong-item-word">${record.word}</div>
                <div class="wrong-item-meaning">${record.meaning || ''}</div>
                ${record.question ? `<div class="wrong-item-question">${record.question}</div>` : ''}
                ${record.correctAnswer ? `<div class="wrong-item-answer">正确答案：${record.correctAnswer}</div>` : ''}
                ${record.userAnswer ? `<div class="wrong-item-user-answer">你的答案：${record.userAnswer}</div>` : ''}
                <div class="wrong-item-actions">
                    <button onclick="app.practiceWrongItem('${record.id}')">🔄 重新练习</button>
                    <button class="btn-remove" onclick="app.removeWrongRecord('${record.id}')">❌ 移除</button>
                </div>
            </div>
        `).join('');
    }

    // 重新练习错题
    practiceWrongItem(id) {
        const record = this.wrongRecords.find(r => r.id == id);
        if (!record) return;
        // 根据错题类型跳转到对应页面并加载
        if (record.type === 'practice' || record.type === 'memory') {
            const word = this.words.find(w => w.word.toLowerCase() === record.word.toLowerCase());
            if (word) {
                this.switchPage('practice');
                this.practiceWord = word;
                this.startPractice('sequential');
            }
        } else if (record.type === 'reading') {
            // 阅读练习错题：跳转到阅读页面并重新生成题目
            this.switchPage('reading');
            this.generateRandomReading();
        } else if (record.type === 'cloze') {
            // 选词填空错题：跳转到选词填空页面并重新生成题目
            this.switchPage('cloze');
            this.generateRandomCloze();
        }
    }

    // ===== 统计功能 =====
    renderStats() {
        const total = this.words.length;
        const totalCorrect = this.words.reduce((sum, w) => sum + (w.correct_count || 0), 0);
        const totalWrong = this.words.reduce((sum, w) => sum + (w.wrong_count || 0), 0);
        const accuracy = totalCorrect + totalWrong > 0 
            ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100) 
            : 0;
        const mastered = this.words.filter(w => (w.correct_count || 0) >= 3).length;
        
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-correct').textContent = totalCorrect;
        document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
        document.getElementById('stat-mastered').textContent = mastered;
        
        // Module stats
        const moduleStats = Storage.getModuleStats();
        
        // Practice stats (from word data)
        const practiceTotal = totalCorrect + totalWrong;
        document.getElementById('stat-practice-total').textContent = practiceTotal;
        document.getElementById('stat-practice-correct').textContent = totalCorrect;
        document.getElementById('stat-practice-rate').textContent = practiceTotal > 0 
            ? `${Math.round((totalCorrect / practiceTotal) * 100)}%` : '0%';
        
        // Reading stats
        document.getElementById('stat-reading-passages').textContent = moduleStats.reading.passages;
        document.getElementById('stat-reading-total').textContent = moduleStats.reading.total;
        document.getElementById('stat-reading-correct').textContent = moduleStats.reading.correct;
        document.getElementById('stat-reading-rate').textContent = moduleStats.reading.total > 0 
            ? `${Math.round((moduleStats.reading.correct / moduleStats.reading.total) * 100)}%` : '0%';
        
        // Translation stats
        document.getElementById('stat-translation-total').textContent = moduleStats.translation.total;
        document.getElementById('stat-translation-sentences').textContent = moduleStats.translation.sentences;
        document.getElementById('stat-translation-avg').textContent = moduleStats.translation.avgScore;

        // Cloze stats (render if elements exist)
        const clozePassagesEl = document.getElementById('stat-cloze-passages');
        if (clozePassagesEl) {
            clozePassagesEl.textContent = moduleStats.cloze ? moduleStats.cloze.passages : 0;
        }
        const clozeTotalEl = document.getElementById('stat-cloze-total');
        if (clozeTotalEl) {
            clozeTotalEl.textContent = moduleStats.cloze ? moduleStats.cloze.total : 0;
        }
        const clozeCorrectEl = document.getElementById('stat-cloze-correct');
        if (clozeCorrectEl) {
            clozeCorrectEl.textContent = moduleStats.cloze ? moduleStats.cloze.correct : 0;
        }
        const clozeRateEl = document.getElementById('stat-cloze-rate');
        if (clozeRateEl) {
            const clozeTotal = moduleStats.cloze ? moduleStats.cloze.total : 0;
            const clozeCorrect = moduleStats.cloze ? moduleStats.cloze.correct : 0;
            clozeRateEl.textContent = clozeTotal > 0 ? `${Math.round((clozeCorrect / clozeTotal) * 100)}%` : '0%';
        }
        
        // Level distribution
        const levelCounts = [0, 0, 0, 0, 0];
        this.words.forEach(w => {
            const level = LevelSystem.getLevel(w.correct_count || 0);
            levelCounts[level]++;
        });
        
        const levelBars = document.getElementById('level-bars');
        const levelNames = ['绿色 (0-2次)', '蓝色 (3-5次)', '紫色 (6-10次)', '金色 (11-20次)', '红色 (21次+)'];
        
        levelBars.innerHTML = levelNames.map((name, i) => {
            const count = levelCounts[i];
            const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
            return `
                <div class="level-bar-item">
                    <span class="level-bar-label">${name.split(' ')[0]}</span>
                    <div class="level-bar-track">
                        <div class="level-bar-fill level-${i}" style="width: ${percentage}%"></div>
                    </div>
                    <span class="level-bar-count">${count}</span>
                </div>
            `;
        }).join('');
        
        // Recent activity
        let activities = Storage.getActivity();
        if (activities instanceof Promise) activities = [];
        activities = Array.isArray(activities) ? activities.slice(0, 10) : [];
        const activityList = document.getElementById('activity-list');
        
        if (activities.length === 0) {
            activityList.innerHTML = '<div style="color: var(--text-muted); text-align: center;">暂无练习记录</div>';
        } else {
            activityList.innerHTML = activities.map(a => {
                const icon = a.type === 'correct' ? '✅' : '❌';
                const time = new Date(a.time).toLocaleString('zh-CN');
                return `
                    <div class="activity-item">
                        <span class="activity-icon">${icon}</span>
                        <span class="activity-text">${a.message}</span>
                        <span class="activity-time">${time}</span>
                    </div>
                `;
            }).join('');
        }
    }

    // ===== 学情诊断 =====
    renderDiagnosis() {
        const records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        const wrongRecords = JSON.parse(localStorage.getItem('wrong_records') || '[]');
        const summaryEl = document.getElementById('diagnosis-summary');
        const detailsEl = document.getElementById('diagnosis-details');
        const scoreEl = document.getElementById('diagnosis-overall-score');
        const ringEl = scoreEl?.parentElement;
        
        if (records.length === 0 && wrongRecords.length === 0) {
            summaryEl.innerHTML = '<p>开始练习后将生成学情诊断报告</p>';
            detailsEl.innerHTML = '';
            scoreEl.textContent = '--';
            if (ringEl) ringEl.className = 'diagnosis-score-ring';
            return;
        }
        
        // 计算各模块正确率
        const totalAttempts = records.length;
        const totalCorrect = records.filter(r => r.correct).length;
        const overallRate = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
        
        // 按类型统计
        const typeStats = {};
        records.forEach(r => {
            if (!typeStats[r.type]) typeStats[r.type] = { total: 0, correct: 0 };
            typeStats[r.type].total++;
            if (r.correct) typeStats[r.type].correct++;
        });
        
        // 综合评分
        const wrongPenalty = Math.min(wrongRecords.length * 2, 20);
        const score = Math.max(0, Math.min(100, overallRate - wrongPenalty));
        scoreEl.textContent = score;
        if (ringEl) {
            ringEl.className = 'diagnosis-score-ring ' + (score >= 80 ? 'good' : score >= 50 ? 'medium' : 'weak');
        }
        
        // 生成诊断建议
        const suggestions = [];
        
        // 各模块分析
        const moduleNames = { practice: '例句练习', reading: '阅读练习', cloze: '选词填空', memory: '单词记忆' };
        Object.entries(moduleNames).forEach(([type, name]) => {
            const stat = typeStats[type] || { total: 0, correct: 0 };
            const rate = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : -1;
            const wrongCount = wrongRecords.filter(r => r.type === type).length;
            const barColor = rate >= 80 ? 'var(--success)' : rate >= 50 ? 'var(--accent)' : 'var(--error)';
            const scoreColor = rate >= 80 ? 'var(--success)' : rate >= 50 ? 'var(--accent)' : 'var(--error)';
            
            let icon = '📚', desc = '尚未练习此模块';
            if (rate >= 0) {
                icon = rate >= 80 ? '💪' : rate >= 50 ? '📖' : '⚠️';
                desc = rate >= 80 ? '掌握良好，继续保持' : rate >= 50 ? `正确率${rate}%，建议加强练习` : `正确率仅${rate}%，需要重点复习`;
                if (wrongCount > 0) desc += `，有${wrongCount}道错题待回顾`;
            }
            
            suggestions.push({ icon, name, desc, rate, barColor, scoreColor, wrongCount });
        });
        
        // 综合建议
        let overallDesc = '';
        if (score >= 80) {
            overallDesc = `综合表现优秀！共完成${totalAttempts}次练习，正确率${overallRate}%。建议适当挑战更高难度的题目。`;
        } else if (score >= 50) {
            overallDesc = `整体水平良好，共完成${totalAttempts}次练习，正确率${overallRate}%。重点关注薄弱模块，建议多做错题本中的题目。`;
        } else {
            overallDesc = `需要加强练习！共完成${totalAttempts}次练习，正确率${overallRate}%。建议从基础单词记忆开始，逐步提升。`;
        }
        if (wrongRecords.length > 0) {
            overallDesc += `错题本中有${wrongRecords.length}道错题需要回顾。`;
        }
        summaryEl.innerHTML = `<p>${overallDesc}</p>`;
        
        // 渲染详情
        detailsEl.innerHTML = suggestions.map(s => `
            <div class="diagnosis-item">
                <div class="diagnosis-item-icon">${s.icon}</div>
                <div class="diagnosis-item-info">
                    <div class="diagnosis-item-title">${s.name}</div>
                    <div class="diagnosis-item-desc">${s.desc}</div>
                </div>
                <div class="diagnosis-item-bar">
                    <div class="diagnosis-item-bar-fill" style="width: ${Math.max(s.rate, 0)}%; background: ${s.barColor};"></div>
                </div>
                <div class="diagnosis-item-score" style="color: ${s.scoreColor};">${s.rate >= 0 ? s.rate + '%' : '--'}</div>
            </div>
        `).join('');
    }
    
    // ===== 设置功能 =====
    openSettings() {
        const settings = Storage.getSettings();
        document.getElementById('api-key').value = settings.apiKey || '';
        document.getElementById('page-size').value = settings.pageSize || 100;
        document.getElementById('settings-modal').style.display = 'flex';
        this.renderThemePresets();
        this.loadCurrentThemeColors();
        this.renderStarryBackground();
    }
    
    renderStarryBackground() {
        const container = document.getElementById('settings-starry-bg');
        if (!container) return;
        container.innerHTML = '';
        
        // Generate random stars
        for (let i = 0; i < 40; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.animationDelay = Math.random() * 3 + 's';
            star.style.animationDuration = (2 + Math.random() * 3) + 's';
            const size = Math.random() > 0.7 ? 3 : 2;
            star.style.width = size + 'px';
            star.style.height = size + 'px';
            container.appendChild(star);
        }
        
        // Generate meteors
        for (let i = 0; i < 5; i++) {
            const meteor = document.createElement('div');
            meteor.className = 'meteor';
            meteor.style.top = Math.random() * 80 + '%';
            meteor.style.left = (50 + Math.random() * 50) + '%';
            meteor.style.animationDuration = (3 + Math.random() * 3) + 's';
            meteor.style.animationDelay = Math.random() * 5 + 's';
            container.appendChild(meteor);
        }
    }
    
    saveSettings() {
        const apiKey = document.getElementById('api-key').value.trim();
        const pageSize = parseInt(document.getElementById('page-size').value);
        
        this.settings = { apiKey, pageSize };
        Storage.saveSettings(this.settings);
        
        document.getElementById('settings-modal').style.display = 'none';
        
        // Refresh collection if page size changed
        if (this.currentPage === 'collection') {
            this.currentPage = 0;
            document.getElementById('collection-grid').innerHTML = '';
            this.renderCollection();
        }
    }
    
    // ===== 主题颜色功能 =====
    getThemePresets() {
        return [
            {
                name: '星空蓝',
                accent: '#4a9eff', bg: '#0f0f1a', bgSecondary: '#1a1a2e', bgCard: '#16213e',
                bgHover: '#1f2b47', text: '#e0e0e0', textSecondary: '#a0a0b0', textMuted: '#6a6a7a', border: '#2a2a4a'
            },
            {
                name: '极光紫',
                accent: '#a855f7', bg: '#110f1a', bgSecondary: '#1e1a2e', bgCard: '#241640',
                bgHover: '#2d1f50', text: '#e0e0e0', textSecondary: '#b0a0c0', textMuted: '#7a6a8a', border: '#3a2a5a'
            },
            {
                name: '薄荷绿',
                accent: '#34d399', bg: '#0a1510', bgSecondary: '#132a20', bgCard: '#163028',
                bgHover: '#1d3d32', text: '#e0e8e4', textSecondary: '#a0b8b0', textMuted: '#607a70', border: '#2a4a3a'
            },
            {
                name: '落日橙',
                accent: '#fb923c', bg: '#1a1008', bgSecondary: '#2e1a0e', bgCard: '#3a2010',
                bgHover: '#4a2a18', text: '#e8e0d8', textSecondary: '#c0a890', textMuted: '#8a7060', border: '#4a3a2a'
            },
            {
                name: '樱花粉',
                accent: '#f472b6', bg: '#1a0f14', bgSecondary: '#2e1a24', bgCard: '#3a1628',
                bgHover: '#4a1f32', text: '#e8e0e4', textSecondary: '#c0a0b0', textMuted: '#8a6a7a', border: '#4a2a3a'
            },
            {
                name: '纯净白',
                accent: '#3b82f6', bg: '#f8fafc', bgSecondary: '#f1f5f9', bgCard: '#ffffff',
                bgHover: '#e2e8f0', text: '#1e293b', textSecondary: '#64748b', textMuted: '#94a3b8', border: '#e2e8f0'
            },
            {
                name: '暖光金',
                accent: '#eab308', bg: '#141208', bgSecondary: '#24200e', bgCard: '#302810',
                bgHover: '#403418', text: '#e8e0d0', textSecondary: '#c0b090', textMuted: '#8a7a5a', border: '#4a3a1a'
            },
            {
                name: '深海青',
                accent: '#22d3ee', bg: '#081418', bgSecondary: '#0e222a', bgCard: '#122e38',
                bgHover: '#183a48', text: '#d8e8f0', textSecondary: '#90b8c8', textMuted: '#588898', border: '#1a3a4a'
            }
        ];
    }
    
    renderThemePresets() {
        const grid = document.getElementById('theme-preset-grid');
        if (!grid) return;
        
        const presets = this.getThemePresets();
        const savedTheme = JSON.parse(localStorage.getItem('ciguang_theme') || 'null');
        
        grid.innerHTML = presets.map((preset, idx) => {
            const isActive = savedTheme && savedTheme.accent === preset.accent;
            return `
                <div class="theme-preset-card ${isActive ? 'active' : ''}" data-preset-idx="${idx}">
                    <div class="theme-preset-preview">
                        <div class="theme-preset-swatch" style="background: ${preset.bg}"></div>
                        <div class="theme-preset-swatch" style="background: ${preset.bgCard}"></div>
                        <div class="theme-preset-swatch" style="background: ${preset.accent}"></div>
                    </div>
                    <div class="theme-preset-name">${preset.name}</div>
                </div>
            `;
        }).join('');
        
        // Add click event for preset cards
        grid.querySelectorAll('.theme-preset-card').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.presetIdx);
                this.applyThemePreset(idx);
            });
        });
    }
    
    applyThemePreset(idx) {
        const presets = this.getThemePresets();
        const preset = presets[idx];
        if (!preset) return;
        
        const root = document.documentElement;
        root.style.setProperty('--bg-primary', preset.bg);
        root.style.setProperty('--bg-secondary', preset.bgSecondary);
        root.style.setProperty('--bg-card', preset.bgCard);
        root.style.setProperty('--bg-hover', preset.bgHover);
        root.style.setProperty('--text-primary', preset.text);
        root.style.setProperty('--text-secondary', preset.textSecondary);
        root.style.setProperty('--text-muted', preset.textMuted);
        root.style.setProperty('--border-color', preset.border);
        root.style.setProperty('--accent', preset.accent);
        root.style.setProperty('--glow-1', preset.accent + '66');
        
        // Save to localStorage
        localStorage.setItem('ciguang_theme', JSON.stringify(preset));
        
        // Update active state
        document.querySelectorAll('.theme-preset-card').forEach((card, i) => {
            card.classList.toggle('active', i === idx);
        });
        
        // Update color inputs
        this.loadCurrentThemeColors();
    }
    
    applyCustomTheme() {
        const accent = document.getElementById('theme-color-accent').value;
        const bg = document.getElementById('theme-color-bg').value;
        const card = document.getElementById('theme-color-card').value;
        const text = document.getElementById('theme-color-text').value;
        
        const root = document.documentElement;
        root.style.setProperty('--bg-primary', bg);
        root.style.setProperty('--bg-card', card);
        root.style.setProperty('--accent', accent);
        root.style.setProperty('--text-primary', text);
        
        // Auto-derive secondary colors
        const bgSecondary = this.lightenColor(bg, 10);
        const bgHover = this.lightenColor(card, 8);
        const textSecondary = this.lightenColor(text, -20);
        const textMuted = this.lightenColor(text, -40);
        const border = this.lightenColor(bg, 15);
        
        root.style.setProperty('--bg-secondary', bgSecondary);
        root.style.setProperty('--bg-hover', bgHover);
        root.style.setProperty('--text-secondary', textSecondary);
        root.style.setProperty('--text-muted', textMuted);
        root.style.setProperty('--border-color', border);
        root.style.setProperty('--glow-1', accent + '66');
        
        // Save custom theme
        const customTheme = {
            name: '自定义',
            accent, bg, bgSecondary, bgCard: card, bgHover,
            text, textSecondary, textMuted, border,
            isCustom: true
        };
        localStorage.setItem('ciguang_theme', JSON.stringify(customTheme));
        
        // Deselect preset cards
        document.querySelectorAll('.theme-preset-card').forEach(card => {
            card.classList.remove('active');
        });
    }
    
    loadCurrentThemeColors() {
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        
        document.getElementById('theme-color-accent').value = cs.getPropertyValue('--accent').trim();
        document.getElementById('theme-color-bg').value = cs.getPropertyValue('--bg-primary').trim();
        document.getElementById('theme-color-card').value = cs.getPropertyValue('--bg-card').trim();
        document.getElementById('theme-color-text').value = cs.getPropertyValue('--text-primary').trim();
    }
    
    lightenColor(hex, amount) {
        // Simple color lighten/darken
        let color = hex.replace('#', '');
        if (color.length === 3) color = color.split('').map(c => c + c).join('');
        
        const num = parseInt(color, 16);
        let r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
        let g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
        let b = Math.min(255, Math.max(0, (num & 0xff) + amount));
        
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    
    initTheme() {
        // Apply saved theme on startup
        const savedTheme = JSON.parse(localStorage.getItem('ciguang_theme') || 'null');
        if (savedTheme) {
            const root = document.documentElement;
            root.style.setProperty('--bg-primary', savedTheme.bg);
            root.style.setProperty('--bg-secondary', savedTheme.bgSecondary);
            root.style.setProperty('--bg-card', savedTheme.bgCard);
            root.style.setProperty('--bg-hover', savedTheme.bgHover);
            root.style.setProperty('--text-primary', savedTheme.text);
            root.style.setProperty('--text-secondary', savedTheme.textSecondary);
            root.style.setProperty('--text-muted', savedTheme.textMuted);
            root.style.setProperty('--border-color', savedTheme.border);
            root.style.setProperty('--accent', savedTheme.accent);
            if (savedTheme.accent) {
                root.style.setProperty('--glow-1', savedTheme.accent + '66');
            }
        }
    }
    
    resetTheme() {
        // Remove all custom CSS variables to fall back to :root defaults
        const root = document.documentElement;
        const props = ['--bg-primary', '--bg-secondary', '--bg-card', '--bg-hover',
                       '--text-primary', '--text-secondary', '--text-muted',
                       '--border-color', '--accent', '--glow-1'];
        props.forEach(prop => root.style.removeProperty(prop));
        
        // Clear saved theme
        localStorage.removeItem('ciguang_theme');
        
        // Re-render presets to update active state (first card = default)
        this.renderThemePresets();
        this.loadCurrentThemeColors();
    }

    // ===== 单词记忆功能 =====
    switchMemoryMode(mode) {
        this.memoryMode = mode;
        document.querySelectorAll('[data-memory-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.memoryMode === mode);
        });
        
        const letterSelector = document.getElementById('memory-letter-selector');
        if (mode === 'letter') {
            letterSelector.style.display = 'block';
            if (!this.memoryLetter) this.selectMemoryLetter('A');
        } else {
            letterSelector.style.display = 'none';
            this.memoryLetter = '';
        }
        
        this.startMemoryPractice();
    }

    selectMemoryLetter(letter) {
        this.memoryLetter = letter;
        document.querySelectorAll('#memory-letter-options .letter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent === letter);
        });
        this.startMemoryPractice();
    }

    startMemoryPractice() {
        // Prepare word list
        if (this.memoryMode === 'all') {
            // 按频率加权排序，高频词优先
            this.memoryWords = this.shuffleArrayByFrequency([...this.words]);
        } else if (this.memoryMode === 'random') {
            // 频率加权随机打乱
            this.memoryWords = this.shuffleArrayByFrequency([...this.words]);
        } else if (this.memoryMode === 'letter') {
            this.memoryWords = this.words.filter(w => 
                w.word.toLowerCase().startsWith(this.memoryLetter.toLowerCase())
            );
            this.memoryWords = this.shuffleArrayByFrequency(this.memoryWords);
        }
        
        this.memoryCurrentIndex = 0;
        this.startTimer('memory');
        this.showMemoryWord();
    }

    showMemoryWord() {
        if (this.memoryCurrentIndex >= this.memoryWords.length) {
            // Practice complete
            this.showMemoryComplete();
            return;
        }
        
        this.memoryCurrentWord = this.memoryWords[this.memoryCurrentIndex];
        
        // Reset to step 1
        document.getElementById('memory-step1').style.display = 'block';
        document.getElementById('memory-step2-write').style.display = 'none';
        document.getElementById('memory-step2-show').style.display = 'none';
        document.getElementById('memory-step3-result').style.display = 'none';
        
        // Show word
        document.getElementById('memory-word').textContent = this.memoryCurrentWord.word;
        document.getElementById('memory-word-write').textContent = this.memoryCurrentWord.word;
        document.getElementById('memory-word-show').textContent = this.memoryCurrentWord.word;
        
        // Clear input
        document.getElementById('memory-meaning-input').value = '';
    }

    handleRemember() {
        // User remembers - go to step 2 (write meaning)
        document.getElementById('memory-step1').style.display = 'none';
        document.getElementById('memory-step2-write').style.display = 'block';
        document.getElementById('memory-meaning-input').focus();
    }

    handleForget() {
        // User doesn't remember - show meaning
        const word = this.memoryCurrentWord;
        
        document.getElementById('memory-step1').style.display = 'none';
        document.getElementById('memory-step2-show').style.display = 'block';
        
        // Show meaning and example
        document.getElementById('memory-meaning-text').textContent = word.meaning || '暂无释义';
        
        let exampleHtml = '';
        if (word.example_en) {
            exampleHtml += `<div><strong>例句：</strong>${word.example_en}</div>`;
        }
        if (word.example_cn) {
            exampleHtml += `<div style="margin-top:8px;color:var(--text-muted)">${word.example_cn}</div>`;
        }
        document.getElementById('memory-example').innerHTML = exampleHtml;
        
        // Record as wrong (but don't add to collection)
        word.wrong_count = (word.wrong_count || 0) + 1;
        Storage.saveWords(this.words);
        
        Storage.addActivity({
            type: 'wrong',
            message: `单词记忆：不记得 "${word.word}"，已查看释义`
        });
    }

    submitMemoryMeaning() {
        const input = document.getElementById('memory-meaning-input');
        const userMeaning = input.value.trim();
        const word = this.memoryCurrentWord;
        
        if (!userMeaning) {
            alert('请输入单词意思');
            return;
        }
        
        // Check if meaning is correct
        const correctMeaning = word.meaning || '';
        const isCorrect = this.checkMeaningMatch(userMeaning, correctMeaning);
        
        document.getElementById('memory-step2-write').style.display = 'none';
        document.getElementById('memory-step3-result').style.display = 'block';
        
        const resultContent = document.getElementById('memory-result-content');
        
        if (isCorrect) {
            // Correct - add to collection and record
            word.correct_count = (word.correct_count || 0) + 1;
            Storage.saveWords(this.words);
            
            // Add to collection if not already there
            this.addToCollection(word);
            
            Storage.addActivity({
                type: 'correct',
                message: `单词记忆：正确写出 "${word.word}" 的意思`
            });
            
            resultContent.innerHTML = `
                <div class="memory-result-correct">
                    <div class="result-icon">🎉</div>
                    <div class="result-title">回答正确！</div>
                    <div class="result-desc">"${word.word}" 已加入词光</div>
                    <div class="memory-result-meaning">
                        <div class="label">正确释义</div>
                        <div class="text">${correctMeaning}</div>
                    </div>
                </div>
            `;
        } else {
            // Wrong - don't add to collection, record wrong
            word.wrong_count = (word.wrong_count || 0) + 1;
            Storage.saveWords(this.words);
            
            Storage.addActivity({
                type: 'wrong',
                message: `单词记忆：未能正确写出 "${word.word}" 的意思`
            });
            
            resultContent.innerHTML = `
                <div class="memory-result-wrong">
                    <div class="result-icon">😅</div>
                    <div class="result-title">回答错误</div>
                    <div class="result-desc">"${word.word}" 未加入词光</div>
                    <div class="memory-result-meaning">
                        <div class="label">你的答案</div>
                        <div class="text">${userMeaning}</div>
                    </div>
                    <div class="memory-result-meaning">
                        <div class="label">正确释义</div>
                        <div class="text">${correctMeaning}</div>
                    </div>
                </div>
            `;
        }
    }

    checkMeaningMatch(userMeaning, correctMeaning) {
        if (!correctMeaning) return true; // No meaning to check against
        
        const user = userMeaning.toLowerCase().replace(/[，。、；：""''（）【】]/g, '').trim();
        const correct = correctMeaning.toLowerCase().replace(/[，。、；：""''（）【】]/g, '').trim();
        
        // Exact match
        if (user === correct) return true;
        
        // Contains match (user answer contains key parts of correct meaning)
        const correctParts = correct.split(/[,;，；]/).map(p => p.trim()).filter(p => p.length > 1);
        if (correctParts.length > 0) {
            const matchedParts = correctParts.filter(part => user.includes(part));
            return matchedParts.length >= Math.ceil(correctParts.length / 2);
        }
        
        // Simple contains
        return user.length > 0 && (correct.includes(user) || user.includes(correct));
    }

    addToCollection(word) {
        // Check if already in collection
        const exists = this.words.some(w => w.word === word.word);
        if (!exists) {
            this.words.push({
                word: word.word,
                meaning: word.meaning,
                level: word.level || 'medium',
                addedAt: new Date().toISOString()
            });
            Storage.saveWords(this.words);
            this.renderCollection();
        }
    }

    nextMemoryWord() {
        this.memoryCurrentIndex++;
        this.showMemoryWord();
    }

    showMemoryComplete() {
        const elapsed = this.stopTimer('memory');
        
        document.getElementById('memory-step1').style.display = 'none';
        document.getElementById('memory-step2-write').style.display = 'none';
        document.getElementById('memory-step2-show').style.display = 'none';
        document.getElementById('memory-step3-result').style.display = 'block';
        
        document.getElementById('memory-result-content').innerHTML = `
            <div class="memory-result-correct">
                <div class="result-icon">🎊</div>
                <div class="result-title">练习完成！</div>
                <div class="result-desc">共练习 ${this.memoryWords.length} 个单词，用时 ${this.formatTime(elapsed)}</div>
            </div>
        `;
        
        document.getElementById('btn-memory-next').textContent = '重新开始';
        document.getElementById('btn-memory-next').onclick = () => {
            document.getElementById('btn-memory-next').textContent = '下一词';
            document.getElementById('btn-memory-next').onclick = null;
            this.startMemoryPractice();
        };
    }

    // ===== 作文练习功能 =====
    initWritingPage() {
        this.currentWritingPrompt = null;
        this.currentWritingEssay = '';
        this.writingStream = null;

        // 生成题目按钮
        document.getElementById('btn-generate-writing').addEventListener('click', () => this.generateWritingPrompt());

        // 输入方式切换
        document.querySelectorAll('.writing-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const input = e.currentTarget.dataset.input;
                document.querySelectorAll('.writing-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.writing-input-panel').forEach(p => p.classList.remove('active'));
                e.currentTarget.classList.add('active');
                document.getElementById(`panel-${input}`).classList.add('active');
            });
        });

        // 字数统计
        document.getElementById('writing-textarea').addEventListener('input', (e) => {
            const text = e.target.value.trim();
            const words = text ? text.split(/\s+/).length : 0;
            document.getElementById('word-count').textContent = words;
        });

        // 相机功能
        document.getElementById('btn-start-camera').addEventListener('click', () => this.startCamera());
        document.getElementById('btn-take-photo').addEventListener('click', () => this.takePhoto());
        document.getElementById('btn-stop-camera').addEventListener('click', () => this.stopCamera());

        // 文件上传
        document.getElementById('btn-upload-file').addEventListener('click', () => {
            document.getElementById('writing-file-input').click();
        });
        document.getElementById('writing-file-input').addEventListener('change', (e) => this.handleFileUpload(e));

        // 拖拽上传
        const uploadArea = document.getElementById('file-upload-area');
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                this.processFile(e.dataTransfer.files[0]);
            }
        });

        // 提交评分
        document.getElementById('btn-submit-writing').addEventListener('click', () => this.submitWriting());

        // 再写一篇
        document.getElementById('btn-writing-again').addEventListener('click', () => this.resetWritingPage());

        // 保存练习
        document.getElementById('btn-writing-save').addEventListener('click', () => this.saveWritingExercise());
    }

    async generateWritingPrompt() {
        const topic = document.getElementById('writing-topic').value;
        const difficulty = document.getElementById('writing-difficulty').value;
        const topicMap = {
            social: '社会热点', education: '教育学习', technology: '科技发展',
            environment: '环境保护', culture: '文化传承', economy: '经济发展',
            health: '健康生活', career: '职业规划'
        };

        // 尝试后端生成
        this.showLoading('正在生成作文题目...');
        try {
            const result = await agentClient.generateWriting(topicMap[topic], difficulty);
            if (result.success && result.data && result.data.exercise) {
                this.currentWritingPrompt = result.data.exercise;
                this.renderWritingPrompt();
                document.getElementById('writing-content').style.display = 'block';
                this.hideLoading();
                return;
            }
        } catch (err) {
            console.log('后端不可用，使用本地预设题目');
        }
        
        // 本地预设题目
        this.currentWritingPrompt = this.getLocalWritingPrompt(topic, difficulty);
        this.renderWritingPrompt();
        document.getElementById('writing-content').style.display = 'block';
        this.hideLoading();
    }

    getLocalWritingPrompt(topic, difficulty) {
        const prompts = {
            education: [
                {
                    title: 'The Role of Campus Life in Personal Development',
                    prompt: 'Write an essay of about 200 words on the topic "The Role of Campus Life in Personal Development". You should:\n1. Describe the various aspects of campus life (academic activities, social life, extracurricular activities)\n2. Discuss how these experiences contribute to personal growth\n3. Share your own campus experience and its impact on you',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['extracurricular', 'enrich', 'perspective', 'collaborative', 'independence', 'diverse', 'community', 'growth'],
                    sampleOutline: 'Introduction: Campus life as a crucial stage\nBody 1: Academic experiences and intellectual growth\nBody 2: Social activities and interpersonal skills\nBody 3: Extracurricular activities and leadership\nConclusion: Overall impact on personal development'
                },
                {
                    title: 'Online Learning vs Traditional Classroom Education',
                    prompt: 'Write an essay of about 200 words discussing "Online Learning vs Traditional Classroom Education". You should:\n1. Compare the advantages and disadvantages of both methods\n2. Discuss the impact of technology on education\n3. Give your opinion on the future of education',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['flexibility', 'interaction', 'discipline', 'accessible', 'engagement', 'effectiveness', 'hybrid', 'autonomy'],
                    sampleOutline: 'Introduction: The rise of online learning\nBody 1: Advantages of traditional classroom education\nBody 2: Benefits of online learning\nBody 3: Challenges of each approach\nConclusion: The future - blended learning'
                },
                {
                    title: 'Should Students Participate in Social Practice?',
                    prompt: 'Write an essay of about 200 words on whether university students should participate in social practice (volunteer work, internships). You should:\n1. State the importance of social practice for students\n2. Discuss potential benefits and drawbacks\n3. Give your opinion with supporting reasons',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['volunteer', 'internship', 'practical', 'experience', 'responsibility', 'community', 'career', 'skill'],
                    sampleOutline: 'Introduction: Social practice in university education\nBody 1: Benefits of social practice\nBody 2: Potential challenges\nBody 3: My personal experience and recommendation\nConclusion: Balance between study and practice'
                }
            ],
            social: [
                {
                    title: 'The Impact of Social Media on Youth',
                    prompt: 'Write an essay of about 200 words on "The Impact of Social Media on Young People". You should:\n1. Describe the widespread use of social media among youth\n2. Discuss both positive and negative effects\n3. Suggest ways to use social media responsibly',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['connection', 'cyberbullying', 'addiction', 'platform', 'influencer', 'privacy', 'authentic', 'digital'],
                    sampleOutline: 'Introduction: Social media prevalence\nBody 1: Positive effects (connection, information sharing)\nBody 2: Negative effects (addiction, mental health)\nBody 3: Responsible usage suggestions\nConclusion: Balanced approach'
                },
                {
                    title: 'How to Build a Harmonious Society',
                    prompt: 'Write an essay of about 200 words discussing how to build a harmonious society. You should:\n1. Explain what a harmonious society means\n2. Discuss the importance of social harmony\n3. Propose measures to promote social harmony',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['harmony', 'tolerance', 'equality', 'mutual', 'respect', 'welfare', 'coexistence', 'sustainable'],
                    sampleOutline: 'Introduction: Definition of social harmony\nBody 1: Importance of harmony\nBody 2: Current challenges\nBody 3: Proposed measures\nConclusion: Call to action'
                }
            ],
            technology: [
                {
                    title: 'Artificial Intelligence: Opportunities and Challenges',
                    prompt: 'Write an essay of about 200 words on "Artificial Intelligence: Opportunities and Challenges". You should:\n1. Describe the current development of AI technology\n2. Discuss the opportunities AI brings to various fields\n3. Address the challenges and ethical concerns',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['algorithm', 'automation', 'efficiency', 'ethical', 'innovation', 'machine learning', 'privacy', 'transform'],
                    sampleOutline: 'Introduction: AI development overview\nBody 1: Opportunities in healthcare, education, etc.\nBody 2: Challenges (job displacement, ethics)\nBody 3: Responsible AI development\nConclusion: Balanced perspective'
                }
            ],
            environment: [
                {
                    title: 'What Individuals Can Do for Environmental Protection',
                    prompt: 'Write an essay of about 200 words on individual actions for environmental protection. You should:\n1. Describe current environmental problems\n2. Discuss what individuals can do in daily life\n3. Emphasize the importance of collective action',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['sustainable', 'carbon', 'recycle', 'conservation', 'renewable', 'ecosystem', 'footprint', 'green'],
                    sampleOutline: 'Introduction: Environmental challenges\nBody 1: Daily actions (reduce, reuse, recycle)\nBody 2: Lifestyle changes (transport, diet)\nConclusion: Power of collective effort'
                }
            ],
            culture: [
                {
                    title: 'The Importance of Preserving Traditional Culture',
                    prompt: 'Write an essay of about 200 words on preserving traditional culture in modern society. You should:\n1. Explain the value of traditional culture\n2. Discuss threats to cultural heritage\n3. Suggest ways to protect and promote traditional culture',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['heritage', 'tradition', 'preservation', 'identity', 'generation', 'custom', 'diversity', 'modernization'],
                    sampleOutline: 'Introduction: Cultural heritage value\nBody 1: Importance of tradition\nBody 2: Challenges in modern era\nConclusion: Preservation strategies'
                }
            ],
            economy: [
                {
                    title: 'The Pros and Cons of E-commerce',
                    prompt: 'Write an essay of about 200 words discussing e-commerce. You should:\n1. Describe the rapid growth of online shopping\n2. Discuss advantages for consumers and businesses\n3. Address disadvantages and traditional retail concerns',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['convenience', 'competition', 'employment', 'logistics', 'transaction', 'digital', 'retail', 'consumer'],
                    sampleOutline: 'Introduction: E-commerce boom\nBody 1: Advantages\nBody 2: Disadvantages and impacts\nConclusion: Future outlook'
                }
            ],
            health: [
                {
                    title: 'How to Maintain a Healthy Lifestyle',
                    prompt: 'Write an essay of about 200 words on maintaining a healthy lifestyle. You should:\n1. Discuss the importance of physical and mental health\n2. Suggest practical ways to stay healthy\n3. Share your own healthy habits',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['nutrition', 'exercise', 'well-being', 'mental', 'balanced', 'routine', 'stress', 'fitness'],
                    sampleOutline: 'Introduction: Health as foundation\nBody 1: Physical health (diet, exercise)\nBody 2: Mental health (stress management)\nConclusion: Healthy lifestyle commitment'
                }
            ],
            career: [
                {
                    title: 'Choosing a Career: Passion vs Practicality',
                    prompt: 'Write an essay of about 200 words on career choice. You should:\n1. Discuss the factors to consider when choosing a career\n2. Compare following passion versus practical considerations\n3. Give your opinion on balancing both',
                    wordLimit: 200, difficulty: difficulty,
                    vocabularyHints: ['passion', 'stability', 'growth', 'fulfillment', 'market', 'opportunity', 'salary', 'profession'],
                    sampleOutline: 'Introduction: Career choice importance\nBody 1: Following passion\nBody 2: Practical considerations\nConclusion: Finding balance'
                }
            ]
        };
        
        const topicPrompts = prompts[topic] || prompts.education;
        return topicPrompts[Math.floor(Math.random() * topicPrompts.length)];
    }

    renderWritingPrompt() {
        const ex = this.currentWritingPrompt;
        document.getElementById('writing-title').textContent = ex.title || '作文题目';
        document.getElementById('writing-prompt').innerHTML = ex.prompt || '';
        document.getElementById('writing-word-limit').textContent = `字数限制：${ex.wordLimit || 200}词`;
        document.getElementById('writing-difficulty-tag').textContent = `难度：${ex.difficulty === 'easy' ? '简单' : ex.difficulty === 'hard' ? '困难' : '中等'}`;

        const hints = ex.vocabularyHints || [];
        document.getElementById('writing-hints').innerHTML = hints.length > 0
            ? `<strong>词汇提示：</strong>${hints.join('、')}` : '';

        const outline = ex.sampleOutline || '';
        document.getElementById('writing-outline').innerHTML = outline
            ? `<strong>写作大纲：</strong><pre>${outline}</pre>` : '';
    }

    async startCamera() {
        try {
            this.writingStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            const video = document.getElementById('camera-video');
            video.srcObject = this.writingStream;
            video.style.display = 'block';
            document.getElementById('camera-placeholder').style.display = 'none';
            document.getElementById('camera-controls').style.display = 'block';
        } catch (err) {
            alert('无法启动相机：' + err.message);
        }
    }

    stopCamera() {
        if (this.writingStream) {
            this.writingStream.getTracks().forEach(t => t.stop());
            this.writingStream = null;
        }
        document.getElementById('camera-video').style.display = 'none';
        document.getElementById('camera-placeholder').style.display = 'block';
        document.getElementById('camera-controls').style.display = 'none';
        document.getElementById('camera-preview').style.display = 'none';
    }

    takePhoto() {
        const video = document.getElementById('camera-video');
        const canvas = document.getElementById('camera-canvas');
        const preview = document.getElementById('camera-preview');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        preview.src = canvas.toDataURL('image/jpeg');
        preview.style.display = 'block';

        // OCR识别
        this.recognizeImage(canvas);
    }

    async recognizeImage(canvas) {
        this.showLoading('正在识别文字...');
        try {
            canvas.toBlob(async (blob) => {
                const file = new File([blob], 'writing.jpg', { type: 'image/jpeg' });
                const result = await agentClient.analyzeFile(file);
                if (result.success) {
                    const text = result.data && result.data.extractedText ? result.data.extractedText : '';
                    document.getElementById('ocr-result').style.display = 'block';
                    document.getElementById('ocr-text').value = text;
                } else {
                    alert('识别失败：' + (result.errorMessage || '未知错误'));
                }
                this.hideLoading();
            }, 'image/jpeg');
        } catch (err) {
            console.error(err);
            this.hideLoading();
            if (err.message && err.message.includes('Failed to fetch')) {
                alert('无法连接到AI后端服务，请确认后端服务已启动（端口8081）');
            } else {
                alert('识别失败：' + err.message);
            }
        }
    }

    handleFileUpload(e) {
        const file = e.target.files[0];
        if (file) this.processFile(file);
    }

    async processFile(file) {
        this.showLoading('正在处理文件...');
        try {
            const result = await agentClient.analyzeFile(file);
            if (result.success) {
                const text = result.data && result.data.extractedText ? result.data.extractedText : '';
                document.getElementById('file-result').style.display = 'block';
                document.getElementById('file-text').value = text;
            } else {
                alert('文件处理失败：' + (result.errorMessage || '未知错误'));
            }
        } catch (err) {
            console.error(err);
            if (err.message && err.message.includes('Failed to fetch')) {
                alert('无法连接到AI后端服务，请确认后端服务已启动（端口8081）');
            } else {
                alert('文件处理失败');
            }
        } finally {
            this.hideLoading();
        }
    }

    getWritingInputText() {
        const activePanel = document.querySelector('.writing-input-panel.active');
        const id = activePanel ? activePanel.id : 'panel-keyboard';
        if (id === 'panel-keyboard') {
            return document.getElementById('writing-textarea').value.trim();
        } else if (id === 'panel-camera') {
            return document.getElementById('ocr-text').value.trim();
        } else if (id === 'panel-file') {
            return document.getElementById('file-text').value.trim();
        }
        return '';
    }

    async submitWriting() {
        const essay = this.getWritingInputText();
        if (!essay) {
            alert('请输入或上传作文内容');
            return;
        }
        if (!this.currentWritingPrompt) {
            alert('请先生成作文题目');
            return;
        }

        this.showLoading('AI正在评分，请稍候...');
        try {
            const result = await agentClient.evaluateWriting(
                this.currentWritingPrompt.prompt || '',
                essay
            );
            if (result.success && result.data && result.data.evaluation) {
                this.renderWritingEvaluation(result.data.evaluation);
                document.getElementById('writing-evaluation').style.display = 'block';
                document.getElementById('writing-evaluation').scrollIntoView({ behavior: 'smooth' });

                // 学习助手Agent反馈
                const evaScore = result.data.evaluation.totalScore || 0;
                const evaCorrect = evaScore >= 60 ? 1 : 0;
                const evaWrongItems = evaScore < 60 ? [{ score: evaScore }] : [];
                this.showAgentFeedback('writing', evaScore, evaCorrect, 1, evaWrongItems);
            } else {
                alert('评分失败：' + (result.errorMessage || '未知错误'));
            }
        } catch (err) {
            console.error(err);
            alert('评分失败，请检查后端服务是否运行');
        } finally {
            this.hideLoading();
        }
    }

    renderWritingEvaluation(evaluation) {
        document.getElementById('total-score').textContent = evaluation.totalScore || '--';
        document.getElementById('content-score').textContent = (evaluation.contentScore || '--') + '/25';
        document.getElementById('language-score').textContent = (evaluation.languageScore || '--') + '/25';
        document.getElementById('structure-score').textContent = (evaluation.structureScore || '--') + '/25';
        document.getElementById('vocabulary-score').textContent = (evaluation.vocabularyScore || '--') + '/25';

        document.getElementById('content-score-bar').style.width = ((evaluation.contentScore || 0) / 25 * 100) + '%';
        document.getElementById('language-score-bar').style.width = ((evaluation.languageScore || 0) / 25 * 100) + '%';
        document.getElementById('structure-score-bar').style.width = ((evaluation.structureScore || 0) / 25 * 100) + '%';
        document.getElementById('vocabulary-score-bar').style.width = ((evaluation.vocabularyScore || 0) / 25 * 100) + '%';

        document.getElementById('overall-comment').textContent = evaluation.overallComment || '';

        const renderList = (id, items) => {
            const el = document.getElementById(id);
            el.innerHTML = (items || []).map(i => `<li>${i}</li>`).join('');
        };
        renderList('strengths-list', evaluation.strengths);
        renderList('weaknesses-list', evaluation.weaknesses);
        renderList('suggestions-list', evaluation.suggestions);

        const errors = evaluation.grammarErrors || [];
        if (errors.length > 0) {
            document.getElementById('grammar-errors-section').style.display = 'block';
            document.getElementById('grammar-errors-body').innerHTML = errors.map(e =>
                `<tr><td>${e.original || ''}</td><td>${e.correction || ''}</td><td>${e.explanation || ''}</td><td>${e.type || ''}</td></tr>`
            ).join('');
        } else {
            document.getElementById('grammar-errors-section').style.display = 'none';
        }

        document.getElementById('improved-text').innerHTML = evaluation.improvedVersion
            ? `<p>${evaluation.improvedVersion.replace(/\n/g, '</p><p>')}</p>` : '<p>无改进版本</p>';
    }

    // ===== 阅读练习 - 题目来源切换 =====
    switchReadingSource(source) {
        this.readingSource = source;
        // 更新tab按钮状态
        document.querySelectorAll('[data-reading-source]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.readingSource === source);
        });
        // 更新面板显示
        document.querySelectorAll('.source-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        const targetPanel = document.getElementById(`reading-panel-${source}`);
        if (targetPanel) targetPanel.classList.add('active');

        // 切换来源时，如果离开拍照面板，停止相机
        if (source !== 'photo') {
            this.stopReadingCamera();
        }
    }

    // ===== 阅读练习 - 自定义输入 =====
    async startCustomReading() {
        const text = document.getElementById('reading-custom-text').value.trim();
        if (!text) {
            alert('请先输入英文文章内容');
            return;
        }
        // 不再限制字数，允许任意长度的文章

        // 优先尝试AI生成高质量阅读理解题目
        const apiKey = this.settings.apiKey;
        if (apiKey) {
            this.showLoading('AI正在分析文章并生成阅读理解题目...');
            try {
                const passage = await this.callAICustomReading(text);
                this.currentPassage = passage;
                this.readingAnswers = {};
                this.readingCurrentQuestion = 0;

                this.renderPassage(passage);
                this.renderQuestions(passage.questions);

                document.getElementById('reading-result').style.display = 'none';
                document.getElementById('reading-card').style.display = 'block';
                document.getElementById('reading-source-switch').style.display = 'none';
                document.querySelectorAll('.reading-nav-item').forEach(item => {
                    item.classList.remove('nav-correct', 'nav-wrong');
                });

                this.startTimer('reading');
                this.hideLoading();
                return;
            } catch (err) {
                console.error('AI生成阅读理解题目失败，使用本地模板:', err);
                this.hideLoading();
            }
        }

        // 回退：将用户文本解析为passage对象（本地模板）
        const passage = this.parseCustomReadingText(text);
        this.currentPassage = passage;
        this.readingAnswers = {};
        this.readingCurrentQuestion = 0;

        // 渲染文章和题目
        this.renderPassage(passage);
        this.renderQuestions(passage.questions);

        // 显示阅读卡片，隐藏结果和来源选择
        document.getElementById('reading-result').style.display = 'none';
        document.getElementById('reading-card').style.display = 'block';
        document.getElementById('reading-source-switch').style.display = 'none';
        document.querySelectorAll('.reading-nav-item').forEach(item => {
            item.classList.remove('nav-correct', 'nav-wrong');
        });

        // 开始计时
        this.startTimer('reading');
    }

    /**
     * 调用AI为自定义文章生成阅读理解题目
     * 使用qwen-turbo模型，返回与本地模板相同格式的passage对象
     */
    async callAICustomReading(text) {
        const apiKey = this.settings.apiKey;
        const difficulty = this.readingDifficulty || 'easy';
        const difficultyMap = { easy: '简单', medium: '中等', hard: '困难' };

        const prompt = `你是一位考研英语阅读理解出题专家。请根据以下英文文章，生成5道高质量的阅读理解选择题。

文章内容：
${text}

难度要求：${difficultyMap[difficulty] || '中等'}

请严格按照以下JSON格式返回（不要包含任何其他文字）：
{
  "cnText": "文章的中文翻译（每段之间用两个换行分隔）",
  "questions": [
    {
      "text": "英文题目",
      "textCn": "题目中文翻译",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "optionsCn": ["选项A中文", "选项B中文", "选项C中文", "选项D中文"],
      "correct": 0,
      "explanation": "答案解析（中文）"
    }
  ]
}

出题要求：
1. 第1题为主旨大意题，考查对文章整体的理解
2. 第2题为细节理解题，考查对文章具体信息的把握
3. 第3题为词义推断题，从文章中选取一个关键词考查其在语境中的含义
4. 第4题为推理判断题，考查根据文章信息进行合理推断的能力
5. 第5题为作者态度/目的题，考查对作者意图和态度的理解
6. 每道题的4个选项中只有一个正确答案，correct字段为正确答案的索引(0-3)
7. 干扰项要有合理性，不能明显错误
8. 题目和选项必须基于文章内容，不能凭空编造`;

        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'qwen-turbo',
                input: {
                    messages: [
                        { role: 'system', content: '你是考研英语阅读理解出题专家，擅长根据文章内容设计高质量的阅读理解题目。你返回的结果必须是纯JSON格式。' },
                        { role: 'user', content: prompt }
                    ]
                },
                parameters: {
                    result_format: 'message'
                }
            })
        });

        if (!response.ok) {
            throw new Error('AI API请求失败');
        }

        const data = await response.json();
        const content = data.output?.choices?.[0]?.message?.content || '';

        // 解析JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('无法解析AI返回的JSON');
        }

        const aiResult = JSON.parse(jsonMatch[0]);

        // 构建标准passage对象
        const wordCount = text.split(/\s+/).length;

        // 从文本中提取标题（取第一句话的前几个词）
        const firstSentence = text.split(/[.!?]/)[0]?.trim() || '';
        const titleWords = firstSentence.split(/\s+/).slice(0, 5).join(' ');
        const title = titleWords + (firstSentence.length > titleWords.length ? '...' : '');

        // 处理AI返回的题目，确保格式正确
        const questions = (aiResult.questions || []).slice(0, 5).map((q, i) => ({
            text: q.text || `Question ${i + 1}`,
            textCn: q.textCn || '',
            options: (q.options || ['Option A', 'Option B', 'Option C', 'Option D']).slice(0, 4),
            optionsCn: (q.optionsCn || ['', '', '', '']).slice(0, 4),
            correct: typeof q.correct === 'number' ? q.correct : 0,
            explanation: q.explanation || ''
        }));

        // 如果题目不足5道，用本地模板补充
        while (questions.length < 5) {
            const fallbackQ = this.generateFallbackQuestion(text, questions.length);
            questions.push(fallbackQ);
        }

        return {
            title: title || '自定义阅读材料',
            text: text.trim(),
            cnText: aiResult.cnText || '',
            wordCount: wordCount,
            questions: questions
        };
    }

    /**
     * 生成一道备用题目（当AI返回题目不足5道时使用）
     */
    generateFallbackQuestion(text, idx) {
        const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
        const templates = [
            {
                text: 'What can be inferred from the passage?',
                textCn: '从文章中可以推断出什么？',
                options: ['A deeper understanding of the topic can help readers in practical ways', 'No further research is needed on this topic', 'All current practices related to the topic are ineffective', 'Readers should avoid engaging with the topic altogether'],
                optionsCn: ['对该话题更深入的理解可以在实际方面帮助读者', '这个话题不需要进一步研究', '与该话题相关的所有当前实践都是无效的', '读者应该完全避免接触这个话题'],
                correct: 0
            },
            {
                text: "What is the author's primary purpose in writing this passage?",
                textCn: '作者写这篇文章的主要目的是什么？',
                options: ['To inform readers about a topic and encourage thoughtful engagement', 'To persuade readers to adopt a specific political viewpoint', 'To entertain readers with humorous anecdotes', 'To criticize current practices without offering alternatives'],
                optionsCn: ['告知读者一个话题并鼓励深入思考', '说服读者采纳特定的政治观点', '用幽默的轶事来娱乐读者', '批评当前的实践而不提供替代方案'],
                correct: 0
            }
        ];
        return templates[idx % templates.length];
    }

    /**
     * 返回阅读来源选择界面
     */
    backToReadingSource() {
        this.stopTimer('reading');
        document.getElementById('reading-card').style.display = 'none';
        document.getElementById('reading-source-switch').style.display = 'block';
        document.getElementById('reading-result').style.display = 'none';
    }

    /**
     * 将用户输入的文本解析为阅读练习passage对象
     * 生成通用的阅读理解题目
     */
    parseCustomReadingText(text) {
        // 按段落分割
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
        const cleanText = paragraphs.join('\n\n').trim();
        const wordCount = cleanText.split(/\s+/).length;

        // 从文本中提取关键句子用于生成题目
        const sentences = cleanText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
        const firstSentence = sentences[0] || '';
        const lastSentence = sentences[sentences.length - 1] || '';
        const middleSentence = sentences.length > 2 ? sentences[Math.floor(sentences.length / 2)] : sentences[1] || '';

        // 提取文本中较长的词作为考察点
        const allWords = cleanText.split(/\s+/).map(w => w.replace(/[^a-zA-Z'-]/g, '')).filter(w => w.length > 5);
        const uniqueWords = [...new Set(allWords)];
        const keyWords = uniqueWords.slice(0, 4);

        // 生成5道阅读理解题
        const questions = [];

        // Q1: 主旨题
        questions.push({
            text: 'What is the main idea of this passage?',
            textCn: '这篇文章的主旨是什么？',
            options: [
                'The passage discusses its central theme and provides supporting details and examples',
                'A historical overview of events from ancient times to the present day',
                'A personal narrative about the author\'s childhood experiences',
                'A scientific experiment and its detailed methodology'
            ],
            optionsCn: [
                '文章讨论了其核心主题，并提供了支持性细节和例子',
                '从古代到现代事件的历史概述',
                '关于作者童年经历的个人叙述',
                '一项科学实验及其详细方法论'
            ],
            correct: 0
        });

        // Q2: 细节理解题（基于中间句）
        if (middleSentence) {
            const shortDetail = middleSentence.length > 60 ? middleSentence.substring(0, 60) + '...' : middleSentence;
            questions.push({
                text: `According to the passage, which of the following is true?`,
                textCn: '根据文章，以下哪项是正确的？',
                options: [
                    `${shortDetail}`,
                    'The author completely disagrees with all the points mentioned',
                    'The topic is only relevant to a small group of specialists',
                    'None of the information in the passage is supported by evidence'
                ],
                optionsCn: [
                    `${shortDetail}`,
                    '作者完全不同意提到的所有观点',
                    '该话题只与一小部分专家相关',
                    '文章中的信息没有任何证据支持'
                ],
                correct: 0
            });
        } else {
            questions.push({
                text: 'What can be concluded from the passage?',
                textCn: '从文章中可以得出什么结论？',
                options: [
                    'The passage presents a coherent argument on its topic',
                    'The author has no opinion on the subject',
                    'The text is primarily about entertainment',
                    'The passage contradicts itself throughout'
                ],
                optionsCn: [
                    '文章对其主题提出了连贯的论述',
                    '作者对该话题没有看法',
                    '文本主要是关于娱乐的',
                    '文章从头到尾都在自相矛盾'
                ],
                correct: 0
            });
        }

        // Q3: 词汇推断题
        if (keyWords.length >= 1) {
            const targetWord = keyWords[0];
            questions.push({
                text: `Based on the context, what does the word "${targetWord}" most likely mean?`,
                textCn: `根据上下文，"${targetWord}"这个词最可能是什么意思？`,
                options: [
                    'Its meaning can be inferred from the surrounding context of the passage',
                    'It refers to a type of natural disaster',
                    'It is an ancient ritual practice',
                    'It is a mathematical term used in physics'
                ],
                optionsCn: [
                    '其含义可以从文章的上下文中推断出来',
                    '它指的是一种自然灾害',
                    '它是一种古老的仪式',
                    '它是物理学中使用的一个数学术语'
                ],
                correct: 0
            });
        } else {
            questions.push({
                text: 'What does the author imply in the passage?',
                textCn: '作者在文章中暗示了什么？',
                options: [
                    'The topic has significance and deserves further consideration',
                    'The topic is completely irrelevant to modern readers',
                    'The author has no knowledge about this subject',
                    'The passage is meant to be a joke'
                ],
                optionsCn: [
                    '该话题具有重要意义，值得进一步思考',
                    '该话题与现代读者完全无关',
                    '作者对这个主题一无所知',
                    '这篇文章只是一个玩笑'
                ],
                correct: 0
            });
        }

        // Q4: 推断题
        questions.push({
            text: 'What can be inferred from the passage?',
            textCn: '从文章中可以推断出什么？',
            options: [
                'A deeper understanding of the topic can help readers in practical ways',
                'No further research is needed on this topic',
                'All current practices related to the topic are ineffective',
                'Readers should avoid engaging with the topic altogether'
            ],
            optionsCn: [
                '对该话题更深入的理解可以在实际方面帮助读者',
                '这个话题不需要进一步研究',
                '与该话题相关的所有当前实践都是无效的',
                '读者应该完全避免接触这个话题'
            ],
            correct: 0
        });

        // Q5: 作者目的题
        questions.push({
            text: "What is the author's primary purpose in writing this passage?",
            textCn: '作者写这篇文章的主要目的是什么？',
            options: [
                'To inform readers about a topic and encourage thoughtful engagement',
                'To persuade readers to adopt a specific political viewpoint',
                'To entertain readers with humorous anecdotes',
                'To criticize current practices without offering alternatives'
            ],
            optionsCn: [
                '告知读者一个话题并鼓励深入思考',
                '说服读者采纳特定的政治观点',
                '用幽默的轶事来娱乐读者',
                '批评当前的实践而不提供替代方案'
            ],
            correct: 0
        });

        return {
            title: '自定义阅读材料',
            text: cleanText,
            cnText: '', // 自定义输入没有中文翻译
            wordCount: wordCount,
            questions: questions
        };
    }

    // ===== 阅读练习 - 拍照功能 =====
    async startReadingCamera() {
        try {
            this.readingCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            const video = document.getElementById('reading-camera-video');
            video.srcObject = this.readingCameraStream;
            video.style.display = 'block';
            document.getElementById('reading-camera-placeholder').style.display = 'none';
            document.getElementById('reading-camera-controls').style.display = 'block';
            document.getElementById('reading-camera-preview').style.display = 'none';
        } catch (err) {
            alert('无法启动相机：' + err.message);
        }
    }

    stopReadingCamera() {
        if (this.readingCameraStream) {
            this.readingCameraStream.getTracks().forEach(t => t.stop());
            this.readingCameraStream = null;
        }
        const video = document.getElementById('reading-camera-video');
        if (video) video.style.display = 'none';
        const placeholder = document.getElementById('reading-camera-placeholder');
        if (placeholder) placeholder.style.display = 'block';
        const controls = document.getElementById('reading-camera-controls');
        if (controls) controls.style.display = 'none';
        const preview = document.getElementById('reading-camera-preview');
        if (preview) preview.style.display = 'none';
    }

    takeReadingPhoto() {
        const video = document.getElementById('reading-camera-video');
        const canvas = document.getElementById('reading-camera-canvas');
        const preview = document.getElementById('reading-camera-preview');
        if (!video || !canvas || !preview) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        preview.src = canvas.toDataURL('image/jpeg');
        preview.style.display = 'block';

        // 停止相机，进行OCR识别
        this.stopReadingCamera();
        this.recognizeReadingImage(canvas);
    }

    async recognizeReadingImage(canvas) {
        this.showLoading('正在识别文字...');
        try {
            canvas.toBlob(async (blob) => {
                try {
                    const file = new File([blob], 'reading.jpg', { type: 'image/jpeg' });
                    const result = await agentClient.analyzeFile(file);
                    if (result.success && result.data && result.data.extractedText) {
                        const text = result.data.extractedText.trim();
                        if (text && text.split(/\s+/).length >= 30) {
                            // 文字足够，自动进入练习
                            this.startReadingFromText(text);
                        } else if (text) {
                            alert('识别到的文字过短（少于30个单词），请重新拍照或使用文本输入');
                        } else {
                            alert('未能识别到文字，请重新拍照或使用文本输入');
                        }
                    } else {
                        alert('识别失败：' + (result.errorMessage || '未知错误'));
                    }
                } catch (err) {
                    console.error('OCR处理失败', err);
                    if (err.message && err.message.includes('Failed to fetch')) {
                        alert('无法连接到AI后端服务，请确认后端服务已启动（端口8081）');
                    } else {
                        alert('识别失败：' + err.message);
                    }
                }
                this.hideLoading();
            }, 'image/jpeg');
        } catch (err) {
            console.error(err);
            this.hideLoading();
            alert('识别失败：' + err.message);
        }
    }

    // ===== 阅读练习 - 文件上传 =====
    async processReadingFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const imageExts = ['png', 'jpg', 'jpeg'];

        if (imageExts.includes(ext)) {
            // 图片文件，调用OCR
            this.showLoading('正在识别图片中的文字...');
            try {
                const result = await agentClient.analyzeFile(file);
                if (result.success && result.data && result.data.extractedText) {
                    const text = result.data.extractedText.trim();
                    if (text && text.split(/\s+/).length >= 30) {
                        this.startReadingFromText(text);
                    } else if (text) {
                        alert('识别到的文字过短（少于30个单词），请使用文本文件或手动输入');
                    } else {
                        alert('未能从图片中识别到文字');
                    }
                } else {
                    alert('识别失败：' + (result.errorMessage || '未知错误'));
                }
            } catch (err) {
                console.error('文件处理失败', err);
                if (err.message && err.message.includes('Failed to fetch')) {
                    alert('无法连接到AI后端服务，请确认后端服务已启动（端口8081）');
                } else {
                    alert('文件处理失败：' + err.message);
                }
            } finally {
                this.hideLoading();
            }
        } else {
            // 文本文件，直接读取
            this.showLoading('正在读取文件...');
            try {
                const text = await file.text();
                if (text.trim() && text.trim().split(/\s+/).length >= 30) {
                    this.startReadingFromText(text.trim());
                } else {
                    alert('文件内容过短（少于30个单词），请输入更长的英文文章');
                }
            } catch (err) {
                alert('文件读取失败：' + err.message);
            } finally {
                this.hideLoading();
            }
        }
    }

    /**
     * 从文本内容直接开始阅读练习（拍照/文件上传的通用入口）
     */
    startReadingFromText(text) {
        const passage = this.parseCustomReadingText(text);
        this.currentPassage = passage;
        this.readingAnswers = {};
        this.readingCurrentQuestion = 0;

        this.renderPassage(passage);
        this.renderQuestions(passage.questions);

        document.getElementById('reading-result').style.display = 'none';
        document.getElementById('reading-card').style.display = 'block';
        document.querySelectorAll('.reading-nav-item').forEach(item => {
            item.classList.remove('nav-correct', 'nav-wrong');
        });

        this.startTimer('reading');
    }

    resetWritingPage() {
        this.currentWritingPrompt = null;
        this.currentWritingEssay = '';
        document.getElementById('writing-content').style.display = 'none';
        document.getElementById('writing-evaluation').style.display = 'none';
        document.getElementById('writing-textarea').value = '';
        document.getElementById('word-count').textContent = '0';
        document.getElementById('ocr-text').value = '';
        document.getElementById('ocr-result').style.display = 'none';
        document.getElementById('file-text').value = '';
        document.getElementById('file-result').style.display = 'none';
        document.getElementById('camera-preview').style.display = 'none';
        this.stopCamera();
    }

    saveWritingExercise() {
        if (!this.currentWritingPrompt) {
            alert('请先生成作文题目');
            return;
        }
        const exercises = JSON.parse(localStorage.getItem('saved_exercises') || '[]');
        exercises.push({
            type: 'writing',
            title: this.currentWritingPrompt.title,
            prompt: this.currentWritingPrompt.prompt,
            essay: this.getWritingInputText(),
            score: document.getElementById('total-score').textContent,
            savedAt: new Date().toISOString()
        });
        localStorage.setItem('saved_exercises', JSON.stringify(exercises));
        alert('练习已保存！');
    }
}

WordCollectionApp.prototype.switchExerciseDifficulty = function(exerciseType, difficulty) {
    const config = this.exerciseTypes[exerciseType];
    if (!config) {
        console.warn(`[WordCollectionApp] 未知题型: ${exerciseType}`);
        return false;
    }

    if (!config.difficulties.includes(difficulty)) {
        console.warn(`[WordCollectionApp] 题型 ${exerciseType} 不支持难度: ${difficulty}`);
        return false;
    }

    this.currentDifficulty[exerciseType] = difficulty;

    // 保存用户偏好到本地存储
    Storage.set(`difficulty_${exerciseType}`, difficulty);

    // 触发难度切换事件
    this.emit('difficultyChanged', { exerciseType, difficulty });

    console.log(`[WordCollectionApp] ${config.name} 难度已切换为: ${this.getDifficultyLabel(difficulty)}`);

    // 根据题型重新加载对应练习内容
    this.reloadExerciseByType(exerciseType);

    return true;
};

WordCollectionApp.prototype.getDifficultyLabel = function(difficulty) {
    const labels = {
        easy: '简单',
        medium: '中等',
        hard: '困难'
    };
    return labels[difficulty] || difficulty;
};

WordCollectionApp.prototype.renderDifficultySelector = function(exerciseType, containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`[WordCollectionApp] 找不到难度选择器容器: ${containerId}`);
        return;
    }

    const config = this.exerciseTypes[exerciseType];
    if (!config) return;

    const currentDiff = this.currentDifficulty[exerciseType] || 'medium';

    const selectorHtml = `
        <div class="difficulty-selector" data-type="${exerciseType}">
            <span class="selector-label">难度:</span>
            <div class="difficulty-options">
                ${config.difficulties.map(diff => `
                    <button
                        class="difficulty-btn ${diff === currentDiff ? 'active' : ''}"
                        data-difficulty="${diff}"
                        onclick="app.switchExerciseDifficulty('${exerciseType}', '${diff}')"
                    >
                        ${this.getDifficultyLabel(diff)}
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    container.innerHTML = selectorHtml;

    // 添加样式（如果尚未添加）
    this.injectDifficultyStyles();
};

WordCollectionApp.prototype.injectDifficultyStyles = function() {
    if (document.getElementById('difficulty-selector-styles')) return;

    const style = document.createElement('style');
    style.id = 'difficulty-selector-styles';
    style.textContent = `
        .difficulty-selector {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            background: var(--card-bg, #fff);
            border-radius: 8px;
            margin-bottom: 12px;
        }
        .difficulty-selector .selector-label {
            font-size: 14px;
            color: var(--text-secondary, #666);
            font-weight: 500;
        }
        .difficulty-options {
            display: flex;
            gap: 8px;
        }
        .difficulty-btn {
            padding: 4px 14px;
            border: 1px solid var(--border-color, #e0e0e0);
            border-radius: 16px;
            background: var(--btn-bg, #f5f5f5);
            color: var(--text-primary, #333);
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .difficulty-btn:hover {
            background: var(--btn-hover-bg, #e8e8e8);
        }
        .difficulty-btn.active {
            background: var(--primary-color, #4a90d9);
            color: #fff;
            border-color: var(--primary-color, #4a90d9);
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.switchExerciseType = function(exerciseType, customType) {
    const config = this.exerciseTypes[exerciseType];
    if (!config) {
        console.warn(`[WordCollectionApp] 未知题型: ${exerciseType}`);
        return false;
    }

    this.customTypes[exerciseType] = customType;

    // 保存用户偏好
    Storage.set(`customType_${exerciseType}`, customType);

    this.emit('customTypeChanged', { exerciseType, customType });

    console.log(`[WordCollectionApp] ${config.name} 类型已切换为: ${customType}`);

    // 重新加载练习内容
    this.reloadExerciseByType(exerciseType);

    return true;
};

WordCollectionApp.prototype.renderTypeSelector = function(exerciseType, containerId, options) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`[WordCollectionApp] 找不到类型选择器容器: ${containerId}`);
        return;
    }

    const config = this.exerciseTypes[exerciseType];
    if (!config) return;

    const currentType = this.customTypes[exerciseType] || 'general';

    const selectorHtml = `
        <div class="type-selector" data-type="${exerciseType}">
            <span class="selector-label">类型:</span>
            <select class="type-select"
                onchange="app.switchExerciseType('${exerciseType}', this.value)">
                ${options.map(opt => `
                    <option value="${opt.value}" ${opt.value === currentType ? 'selected' : ''}>
                        ${opt.label}
                    </option>
                `).join('')}
            </select>
        </div>
    `;

    container.innerHTML = selectorHtml;

    this.injectTypeSelectorStyles();
};

WordCollectionApp.prototype.injectTypeSelectorStyles = function() {
    if (document.getElementById('type-selector-styles')) return;

    const style = document.createElement('style');
    style.id = 'type-selector-styles';
    style.textContent = `
        .type-selector {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            background: var(--card-bg, #fff);
            border-radius: 8px;
            margin-bottom: 12px;
        }
        .type-selector .selector-label {
            font-size: 14px;
            color: var(--text-secondary, #666);
            font-weight: 500;
        }
        .type-select {
            padding: 6px 12px;
            border: 1px solid var(--border-color, #e0e0e0);
            border-radius: 6px;
            background: var(--input-bg, #fff);
            color: var(--text-primary, #333);
            font-size: 13px;
            cursor: pointer;
            min-width: 120px;
        }
        .type-select:focus {
            outline: none;
            border-color: var(--primary-color, #4a90d9);
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.toggleExerciseTranslation = function(exerciseType) {
    const config = this.exerciseTypes[exerciseType];
    if (!config) {
        console.warn(`[WordCollectionApp] 未知题型: ${exerciseType}`);
        return false;
    }

    if (!config.hasTranslation) {
        console.log(`[WordCollectionApp] ${config.name} 不支持翻译显示`);
        return false;
    }

    this.showTranslation[exerciseType] = !this.showTranslation[exerciseType];

    // 保存用户偏好
    Storage.set(`showTranslation_${exerciseType}`, this.showTranslation[exerciseType]);

    // 更新UI
    this.updateTranslationDisplay(exerciseType);

    this.emit('translationToggled', {
        exerciseType,
        show: this.showTranslation[exerciseType]
    });

    return true;
};

WordCollectionApp.prototype.updateTranslationDisplay = function(exerciseType) {
    const container = document.querySelector(`[data-exercise="${exerciseType}"] .translation-content`);
    if (!container) return;

    const shouldShow = this.showTranslation[exerciseType];
    container.style.display = shouldShow ? 'block' : 'none';

    // 更新切换按钮状态
    const toggleBtn = document.querySelector(`[data-exercise="${exerciseType}"] .translation-toggle-btn`);
    if (toggleBtn) {
        toggleBtn.textContent = shouldShow ? '隐藏翻译' : '显示翻译';
        toggleBtn.classList.toggle('active', shouldShow);
    }
};

WordCollectionApp.prototype.renderTranslation = function(exerciseType, translationText, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const config = this.exerciseTypes[exerciseType];
    if (!config || !config.hasTranslation) return;

    const isVisible = this.showTranslation[exerciseType];

    container.innerHTML = `
        <div class="translation-wrapper" data-exercise="${exerciseType}">
            <button class="translation-toggle-btn ${isVisible ? 'active' : ''}"
                onclick="app.toggleExerciseTranslation('${exerciseType}')">
                ${isVisible ? '隐藏翻译' : '显示翻译'}
            </button>
            <div class="translation-content" style="display: ${isVisible ? 'block' : 'none'}">
                <div class="translation-text">${translationText}</div>
            </div>
        </div>
    `;

    this.injectTranslationStyles();
};

WordCollectionApp.prototype.injectTranslationStyles = function() {
    if (document.getElementById('translation-display-styles')) return;

    const style = document.createElement('style');
    style.id = 'translation-display-styles';
    style.textContent = `
        .translation-wrapper {
            margin-top: 12px;
            padding: 12px;
            background: var(--translation-bg, #f8f9fa);
            border-radius: 8px;
            border-left: 3px solid var(--primary-color, #4a90d9);
        }
        .translation-toggle-btn {
            padding: 4px 12px;
            border: 1px solid var(--border-color, #e0e0e0);
            border-radius: 4px;
            background: var(--btn-bg, #fff);
            color: var(--text-primary, #333);
            font-size: 12px;
            cursor: pointer;
            margin-bottom: 8px;
        }
        .translation-toggle-btn.active {
            background: var(--primary-color, #4a90d9);
            color: #fff;
            border-color: var(--primary-color, #4a90d9);
        }
        .translation-text {
            font-size: 14px;
            line-height: 1.6;
            color: var(--text-secondary, #555);
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.renderFloatingNav = function(exerciseType, items, currentIndex = 0) {
    const config = this.exerciseTypes[exerciseType];
    if (!config || !config.hasFloatingNav) {
        console.log(`[WordCollectionApp] ${config ? config.name : exerciseType} 不支持悬浮导航`);
        return;
    }

    // 移除已有的悬浮导航
    const existingNav = document.getElementById(`floating-nav-${exerciseType}`);
    if (existingNav) existingNav.remove();

    // 初始化导航状态
    this.floatingNavStates[exerciseType] = {
        collapsed: false,
        items: items.map((item, idx) => ({
            ...item,
            index: idx,
            status: 'unanswered' // unanswered / correct / wrong
        })),
        currentIndex: currentIndex
    };

    const navHtml = `
        <div id="floating-nav-${exerciseType}" class="floating-nav" data-exercise="${exerciseType}">
            <div class="floating-nav-header" onclick="app.toggleFloatingNav('${exerciseType}')">
                <span class="floating-nav-title">${config.name}导航</span>
                <span class="floating-nav-toggle">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 6l4 4 4-4" class="nav-arrow"/>
                    </svg>
                </span>
            </div>
            <div class="floating-nav-content">
                ${items.map((item, idx) => `
                    <div class="floating-nav-item ${idx === currentIndex ? 'current' : ''}"
                        data-index="${idx}"
                        onclick="app.jumpToExerciseItem('${exerciseType}', ${idx})">
                        <span class="nav-item-status status-unanswered"></span>
                        <span class="nav-item-label">${item.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // 添加到页面
    const navContainer = document.createElement('div');
    navContainer.innerHTML = navHtml;
    document.body.appendChild(navContainer.firstElementChild);

    this.injectFloatingNavStyles();
};

WordCollectionApp.prototype.updateFloatingNav = function(exerciseType, statusMap) {
    const navState = this.floatingNavStates[exerciseType];
    if (!navState) return;

    const nav = document.getElementById(`floating-nav-${exerciseType}`);
    if (!nav) return;

    Object.entries(statusMap).forEach(([index, status]) => {
        const idx = parseInt(index, 10);
        if (navState.items[idx]) {
            navState.items[idx].status = status;
        }

        const itemEl = nav.querySelector(`.floating-nav-item[data-index="${idx}"] .nav-item-status`);
        if (itemEl) {
            itemEl.className = `nav-item-status status-${status}`;
        }
    });

    // 保存进度
    Storage.set(`navState_${exerciseType}`, navState);
};

WordCollectionApp.prototype.toggleFloatingNav = function(exerciseType) {
    const nav = document.getElementById(`floating-nav-${exerciseType}`);
    if (!nav) return;

    const navState = this.floatingNavStates[exerciseType];
    if (!navState) return;

    navState.collapsed = !navState.collapsed;
    nav.classList.toggle('collapsed', navState.collapsed);

    // 保存状态
    Storage.set(`navCollapsed_${exerciseType}`, navState.collapsed);
};

WordCollectionApp.prototype.jumpToExerciseItem = function(exerciseType, index) {
    const navState = this.floatingNavStates[exerciseType];
    if (!navState || !navState.items[index]) return;

    navState.currentIndex = index;

    // 更新当前项高亮
    const nav = document.getElementById(`floating-nav-${exerciseType}`);
    if (nav) {
        nav.querySelectorAll('.floating-nav-item').forEach((el, idx) => {
            el.classList.toggle('current', idx === index);
        });
    }

    // 触发跳转事件
    this.emit('navItemClicked', { exerciseType, index });

    // 各题型具体的跳转逻辑由对应页面处理
    this.scrollToExerciseItem(exerciseType, index);
};

WordCollectionApp.prototype.scrollToExerciseItem = function(exerciseType, index) {
    const targetEl = document.querySelector(`[data-exercise-item="${exerciseType}-${index}"]`);
    if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

WordCollectionApp.prototype.injectFloatingNavStyles = function() {
    if (document.getElementById('floating-nav-styles')) return;

    const style = document.createElement('style');
    style.id = 'floating-nav-styles';
    style.textContent = `
        .floating-nav {
            position: fixed;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            width: 160px;
            background: var(--card-bg, #fff);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.12);
            z-index: 1000;
            overflow: hidden;
            transition: all 0.3s ease;
        }
        .floating-nav.collapsed {
            width: 48px;
        }
        .floating-nav.collapsed .floating-nav-content {
            display: none;
        }
        .floating-nav.collapsed .floating-nav-title {
            display: none;
        }
        .floating-nav.collapsed .nav-arrow {
            transform: rotate(180deg);
        }
        .floating-nav-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: var(--primary-color, #4a90d9);
            color: #fff;
            cursor: pointer;
            user-select: none;
        }
        .floating-nav-title {
            font-size: 13px;
            font-weight: 500;
        }
        .floating-nav-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .floating-nav-content {
            max-height: 400px;
            overflow-y: auto;
            padding: 8px;
        }
        .floating-nav-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 12px;
        }
        .floating-nav-item:hover {
            background: var(--hover-bg, #f0f0f0);
        }
        .floating-nav-item.current {
            background: var(--primary-light, #e3f2fd);
            font-weight: 500;
        }
        .nav-item-status {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .nav-item-status.status-unanswered {
            background: #ccc;
        }
        .nav-item-status.status-correct {
            background: #4caf50;
        }
        .nav-item-status.status-wrong {
            background: #f44336;
        }
        .nav-item-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        @media (max-width: 768px) {
            .floating-nav {
                right: 10px;
                width: 140px;
            }
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.saveCurrentExercise = function(exerciseType, data) {
    const config = this.exerciseTypes[exerciseType];
    if (!config) {
        console.warn(`[WordCollectionApp] 未知题型: ${exerciseType}`);
        return false;
    }

    const timestamp = Date.now();
    const saveKey = `saved_${exerciseType}`;

    let saveData = {
        type: exerciseType,
        typeName: config.name,
        savedAt: timestamp,
        difficulty: this.currentDifficulty[exerciseType],
        customType: this.customTypes[exerciseType]
    };

    // 根据题型合并具体数据
    switch (exerciseType) {
        case 'practice':
            saveData = this.buildPracticeSaveData(saveData, data);
            break;
        case 'reading':
            saveData = this.buildReadingSaveData(saveData, data);
            break;
        case 'translation':
            saveData = this.buildTranslationSaveData(saveData, data);
            break;
        case 'cloze':
            saveData = this.buildClozeSaveData(saveData, data);
            break;
        case 'writing':
            saveData = this.buildWritingSaveData(saveData, data);
            break;
        case 'memory':
            saveData = this.buildMemorySaveData(saveData, data);
            break;
        default:
            saveData = { ...saveData, ...data };
    }

    // 获取已有保存列表
    const savedList = Storage.get(saveKey) || [];

    // 检查是否已存在相同内容（根据唯一标识）
    const existingIndex = savedList.findIndex(item => item.id === saveData.id);
    if (existingIndex >= 0) {
        // 更新已有记录
        savedList[existingIndex] = saveData;
    } else {
        // 添加新记录，限制最多保存50条
        savedList.unshift(saveData);
        if (savedList.length > 50) {
            savedList.pop();
        }
    }

    Storage.set(saveKey, savedList);

    // 增加经验值奖励
    if (typeof LevelSystem !== 'undefined') {
        LevelSystem.addExp(5, `保存${config.name}`);
    }

    this.showToast(`${config.name} 已保存到"已保存"`);
    this.emit('exerciseSaved', { exerciseType, data: saveData });

    return true;
};

WordCollectionApp.prototype.buildPracticeSaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `practice_${data.word}_${Date.now()}`,
        word: data.word,
        sentence: data.sentence,
        translation: data.translation || ''
    };
};

WordCollectionApp.prototype.buildReadingSaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `reading_${data.articleId}_${Date.now()}`,
        articleId: data.articleId,
        title: data.title,
        content: data.content,
        questions: data.questions || []
    };
};

WordCollectionApp.prototype.buildTranslationSaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `translation_${data.sentenceId}_${Date.now()}`,
        sentenceId: data.sentenceId,
        original: data.original,
        translation: data.translation,
        userAnswer: data.userAnswer || ''
    };
};

WordCollectionApp.prototype.buildClozeSaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `cloze_${data.articleId}_${Date.now()}`,
        articleId: data.articleId,
        title: data.title,
        article: data.article,
        blanks: data.blanks || [],
        answers: data.answers || [],
        userAnswers: data.userAnswers || []
    };
};

WordCollectionApp.prototype.buildWritingSaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `writing_${data.topicId}_${Date.now()}`,
        topicId: data.topicId,
        topic: data.topic,
        requirements: data.requirements,
        userEssay: data.userEssay || '',
        wordCount: data.userEssay ? data.userEssay.length : 0
    };
};

WordCollectionApp.prototype.buildMemorySaveData = function(baseData, data) {
    return {
        ...baseData,
        id: `memory_${data.mode}_${Date.now()}`,
        mode: data.mode,
        words: data.words || [],
        progress: data.progress || 0,
        stats: data.stats || {},
        currentIndex: data.currentIndex || 0
    };
};

WordCollectionApp.prototype.getSavedExercises = function(exerciseType) {
    if (exerciseType) {
        return Storage.get(`saved_${exerciseType}`) || [];
    }

    const allSaved = [];
    Object.keys(this.exerciseTypes).forEach(type => {
        const list = Storage.get(`saved_${type}`) || [];
        allSaved.push(...list);
    });

    // 按保存时间倒序排列
    return allSaved.sort((a, b) => b.savedAt - a.savedAt);
};

WordCollectionApp.prototype.deleteSavedExercise = function(exerciseType, id) {
    const saveKey = `saved_${exerciseType}`;
    const savedList = Storage.get(saveKey) || [];
    const filtered = savedList.filter(item => item.id !== id);
    Storage.set(saveKey, filtered);
    this.emit('exerciseDeleted', { exerciseType, id });
    return true;
};

WordCollectionApp.prototype.getPracticeDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            sentenceLength: 'short',      // 短例句
            wordFrequency: 'high',        // 常用词
            maxWords: 8,
            complexity: 'simple'
        },
        medium: {
            sentenceLength: 'standard',   // 标准例句
            wordFrequency: 'medium',      // 中频词
            maxWords: 15,
            complexity: 'standard'
        },
        hard: {
            sentenceLength: 'long',       // 长难句
            wordFrequency: 'low',         // 低频词
            maxWords: 30,
            complexity: 'complex'
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.getTranslationDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            sentenceLength: 'short',      // 短句
            vocabularyLevel: 'simple',    // 简单词
            grammarComplexity: 'simple',
            maxLength: 50
        },
        medium: {
            sentenceLength: 'standard',   // 标准句
            vocabularyLevel: 'standard',  // 标准词
            grammarComplexity: 'standard',
            maxLength: 100
        },
        hard: {
            sentenceLength: 'long',       // 长句
            vocabularyLevel: 'advanced',  // 复杂词
            grammarComplexity: 'complex', // 复杂结构
            maxLength: 200
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.getWritingDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            wordCount: 150,               // 150词
            topicComplexity: 'simple',    // 简单话题
            requirementCount: 2,
            allowSimpleVocabulary: true
        },
        medium: {
            wordCount: 200,               // 200词
            topicComplexity: 'standard',  // 标准话题
            requirementCount: 3,
            allowSimpleVocabulary: false
        },
        hard: {
            wordCount: 250,               // 250词
            topicComplexity: 'abstract',  // 抽象话题
            requirementCount: 4,
            allowSimpleVocabulary: false
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.getMemoryDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            wordFrequency: 'high',        // 高频词
            batchSize: 10,
            reviewInterval: 24 * 60 * 60 * 1000, // 1天
            hintLevel: 'full'
        },
        medium: {
            wordFrequency: 'medium',      // 中频词
            batchSize: 15,
            reviewInterval: 12 * 60 * 60 * 1000, // 12小时
            hintLevel: 'partial'
        },
        hard: {
            wordFrequency: 'low',         // 低频词
            batchSize: 20,
            reviewInterval: 6 * 60 * 60 * 1000,  // 6小时
            hintLevel: 'none'
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.getDifficultyParams = function(exerciseType, difficulty) {
    const methodMap = {
        practice: 'getPracticeDifficultyParams',
        reading: 'getReadingDifficultyParams',
        translation: 'getTranslationDifficultyParams',
        cloze: 'getClozeDifficultyParams',
        writing: 'getWritingDifficultyParams',
        memory: 'getMemoryDifficultyParams'
    };

    const methodName = methodMap[exerciseType];
    if (methodName && typeof this[methodName] === 'function') {
        return this[methodName](difficulty);
    }

    // 默认返回
    return { difficulty };
};

WordCollectionApp.prototype.getReadingDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            articleLength: 'short',
            vocabularyLevel: 'simple',
            questionCount: 3,
            hasHeading: true
        },
        medium: {
            articleLength: 'standard',
            vocabularyLevel: 'standard',
            questionCount: 4,
            hasHeading: true
        },
        hard: {
            articleLength: 'long',
            vocabularyLevel: 'advanced',
            questionCount: 5,
            hasHeading: false
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.getClozeDifficultyParams = function(difficulty) {
    const params = {
        easy: {
            blankCount: 5,
            wordPoolSize: 8,
            articleLength: 'short',
            distractorSimilarity: 'low'
        },
        medium: {
            blankCount: 10,
            wordPoolSize: 15,
            articleLength: 'standard',
            distractorSimilarity: 'medium'
        },
        hard: {
            blankCount: 15,
            wordPoolSize: 20,
            articleLength: 'long',
            distractorSimilarity: 'high'
        }
    };
    return params[difficulty] || params.medium;
};

WordCollectionApp.prototype.setupPhotoUploadForBlank = function(blankId, exerciseType) {
    const config = this.exerciseTypes[exerciseType];
    if (!config || !config.hasPhotoUpload) {
        console.warn(`[WordCollectionApp] ${exerciseType} 不支持拍照上传`);
        return;
    }

    const container = document.getElementById(blankId);
    if (!container) {
        console.warn(`[WordCollectionApp] 找不到填空容器: ${blankId}`);
        return;
    }

    // 初始化拍照数据存储
    if (!this.photoUploadData[exerciseType]) {
        this.photoUploadData[exerciseType] = {};
    }

    // 创建拍照上传UI
    const uploadHtml = `
        <div class="photo-upload-wrapper" data-blank="${blankId}">
            <input
                type="file"
                id="photo-input-${blankId}"
                class="photo-input"
                accept="image/*"
                capture="environment"
                style="display: none;"
                onchange="app.handlePhotoUpload('${blankId}', '${exerciseType}', this)"
            >
            <button
                class="photo-upload-btn"
                onclick="document.getElementById('photo-input-${blankId}').click()"
                title="拍照上传">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="6" width="18" height="12" rx="2"/>
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M8 6l1.5-2h5L16 6"/>
                </svg>
                <span>拍照</span>
            </button>
            <div class="photo-preview" id="photo-preview-${blankId}" style="display: none;">
                <img src="" alt="拍照预览">
                <button class="photo-remove-btn" onclick="app.removePhoto('${blankId}', '${exerciseType}')">×</button>
            </div>
            <div class="photo-processing" id="photo-processing-${blankId}" style="display: none;">
                <span class="processing-spinner"></span>
                <span>识别中...</span>
            </div>
        </div>
    `;

    // 将上传按钮添加到容器
    const uploadWrapper = document.createElement('div');
    uploadWrapper.innerHTML = uploadHtml;
    container.appendChild(uploadWrapper);

    this.injectPhotoUploadStyles();
};

WordCollectionApp.prototype.handlePhotoUpload = function(blankId, exerciseType, inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
        this.showToast('请选择图片文件');
        return;
    }

    // 检查文件大小（最大 5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        this.showToast('图片大小不能超过5MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const imageData = e.target.result;
        this.processPhotoForBlank(blankId, imageData, exerciseType);
    };
    reader.onerror = () => {
        this.showToast('图片读取失败，请重试');
    };
    reader.readAsDataURL(file);
};

WordCollectionApp.prototype.processPhotoForBlank = function(blankId, imageData, exerciseType) {
    // 显示处理中状态
    const processingEl = document.getElementById(`photo-processing-${blankId}`);
    const previewEl = document.getElementById(`photo-preview-${blankId}`);
    if (processingEl) processingEl.style.display = 'flex';
    if (previewEl) previewEl.style.display = 'none';

    // 存储图片数据
    if (!this.photoUploadData[exerciseType]) {
        this.photoUploadData[exerciseType] = {};
    }
    this.photoUploadData[exerciseType][blankId] = imageData;

    // 模拟OCR识别过程（实际项目中应调用OCR API）
    // 这里使用setTimeout模拟异步识别
    setTimeout(() => {
        // 模拟识别结果
        const mockRecognizedText = this.mockOCRRecognize(imageData);

        // 填入识别结果
        const inputEl = document.querySelector(`#${blankId} input, #${blankId} textarea`);
        if (inputEl) {
            inputEl.value = mockRecognizedText;
            // 触发input事件以更新状态
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 显示预览
        if (previewEl) {
            const img = previewEl.querySelector('img');
            if (img) img.src = imageData;
            previewEl.style.display = 'block';
        }
        if (processingEl) processingEl.style.display = 'none';

        this.showToast('识别完成');

        this.emit('photoProcessed', {
            exerciseType,
            blankId,
            imageData,
            recognizedText: mockRecognizedText
        });
    }, 1500);
};

WordCollectionApp.prototype.mockOCRRecognize = function(imageData) {
    // 实际项目中，这里应该调用OCR服务：
    // return await this.callOCRService(imageData);

    // 模拟返回示例文本
    const mockTexts = [
        'The quick brown fox jumps over the lazy dog.',
        'To be or not to be, that is the question.',
        'All roads lead to Rome.',
        'Practice makes perfect.',
        'Where there is a will, there is a way.'
    ];
    return mockTexts[Math.floor(Math.random() * mockTexts.length)];
};

WordCollectionApp.prototype.callOCRService = async function(imageData) {
    try {
        const response = await fetch('/api/ocr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: imageData })
        });
        const result = await response.json();
        return result.text || '';
    } catch (error) {
        console.error('[WordCollectionApp] OCR识别失败:', error);
        return '';
    }
};

WordCollectionApp.prototype.removePhoto = function(blankId, exerciseType) {
    // 清除存储的数据
    if (this.photoUploadData[exerciseType]) {
        delete this.photoUploadData[exerciseType][blankId];
    }

    // 隐藏预览
    const previewEl = document.getElementById(`photo-preview-${blankId}`);
    if (previewEl) {
        previewEl.style.display = 'none';
        const img = previewEl.querySelector('img');
        if (img) img.src = '';
    }

    // 清空对应输入框
    const inputEl = document.querySelector(`#${blankId} input, #${blankId} textarea`);
    if (inputEl) {
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 重置文件输入
    const fileInput = document.getElementById(`photo-input-${blankId}`);
    if (fileInput) fileInput.value = '';

    this.emit('photoRemoved', { exerciseType, blankId });
};

WordCollectionApp.prototype.injectPhotoUploadStyles = function() {
    if (document.getElementById('photo-upload-styles')) return;

    const style = document.createElement('style');
    style.id = 'photo-upload-styles';
    style.textContent = `
        .photo-upload-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 6px;
        }
        .photo-upload-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            border: 1px dashed var(--border-color, #ccc);
            border-radius: 6px;
            background: var(--btn-bg, #fafafa);
            color: var(--text-secondary, #666);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .photo-upload-btn:hover {
            border-color: var(--primary-color, #4a90d9);
            color: var(--primary-color, #4a90d9);
            background: var(--primary-light, #f0f7ff);
        }
        .photo-preview {
            position: relative;
            display: inline-block;
        }
        .photo-preview img {
            max-width: 80px;
            max-height: 60px;
            border-radius: 4px;
            object-fit: cover;
        }
        .photo-remove-btn {
            position: absolute;
            top: -6px;
            right: -6px;
            width: 18px;
            height: 18px;
            border: none;
            border-radius: 50%;
            background: #f44336;
            color: #fff;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .photo-processing {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--text-secondary, #666);
        }
        .processing-spinner {
            width: 14px;
            height: 14px;
            border: 2px solid var(--border-color, #e0e0e0);
            border-top-color: var(--primary-color, #4a90d9);
            border-radius: 50%;
            animation: photo-spin 0.8s linear infinite;
        }
        @keyframes photo-spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.reloadExerciseByType = function(exerciseType) {
    // 触发重新加载事件，由各页面监听器处理具体逻辑
    this.emit('reloadExercise', {
        exerciseType,
        difficulty: this.currentDifficulty[exerciseType],
        customType: this.customTypes[exerciseType],
        difficultyParams: this.getDifficultyParams(exerciseType, this.currentDifficulty[exerciseType])
    });
};

WordCollectionApp.prototype.showToast = function(message, duration = 2000) {
    // 如果已有toast，先移除
    const existingToast = document.getElementById('app-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 显示动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // 自动隐藏
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);

    this.injectToastStyles();
};

WordCollectionApp.prototype.injectToastStyles = function() {
    if (document.getElementById('app-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'app-toast-styles';
    style.textContent = `
        .app-toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 10px 20px;
            background: rgba(0, 0, 0, 0.75);
            color: #fff;
            font-size: 14px;
            border-radius: 20px;
            z-index: 9999;
            opacity: 0;
            transition: all 0.3s ease;
            pointer-events: none;
            white-space: nowrap;
        }
        .app-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    `;
    document.head.appendChild(style);
};

WordCollectionApp.prototype.emit = function(event, data) {
    if (!this._eventListeners) this._eventListeners = {};
    const listeners = this._eventListeners[event];
    if (listeners) {
        listeners.forEach(callback => {
            try {
                callback(data);
            } catch (e) {
                console.error(`[WordCollectionApp] 事件处理错误 (${event}):`, e);
            }
        });
    }
};

WordCollectionApp.prototype.on = function(event, callback) {
    if (!this._eventListeners) this._eventListeners = {};
    if (!this._eventListeners[event]) this._eventListeners[event] = [];
    this._eventListeners[event].push(callback);
};

WordCollectionApp.prototype.off = function(event, callback) {
    if (!this._eventListeners || !this._eventListeners[event]) return;
    const idx = this._eventListeners[event].indexOf(callback);
    if (idx >= 0) this._eventListeners[event].splice(idx, 1);
};

WordCollectionApp.prototype.restoreUserPreferences = function() {
    // 恢复难度设置
    Object.keys(this.exerciseTypes).forEach(type => {
        const savedDifficulty = Storage.get(`difficulty_${type}`);
        if (savedDifficulty && this.exerciseTypes[type].difficulties.includes(savedDifficulty)) {
            this.currentDifficulty[type] = savedDifficulty;
        }
    });

    // 恢复自定义类型
    Object.keys(this.exerciseTypes).forEach(type => {
        const savedType = Storage.get(`customType_${type}`);
        if (savedType) {
            this.customTypes[type] = savedType;
        }
    });

    // 恢复翻译显示设置
    Object.keys(this.exerciseTypes).forEach(type => {
        const savedShow = Storage.get(`showTranslation_${type}`);
        if (savedShow !== null) {
            this.showTranslation[type] = savedShow;
        }
    });

    // 恢复悬浮导航状态
    Object.keys(this.exerciseTypes).forEach(type => {
        const savedCollapsed = Storage.get(`navCollapsed_${type}`);
        if (savedCollapsed !== null && this.floatingNavStates[type]) {
            this.floatingNavStates[type].collapsed = savedCollapsed;
        }
    });

    console.log('[WordCollectionApp] 用户偏好设置已恢复');
};

WordCollectionApp.prototype.initExerciseConfigSystem = function() {
    // 恢复用户偏好
    this.restoreUserPreferences();

    // 监听题型切换事件，自动清理上一个题型的UI
    this.on('exerciseTypeChanged', ({ from, to }) => {
        // 收起上一个题型的悬浮导航
        if (from && this.exerciseTypes[from] && this.exerciseTypes[from].hasFloatingNav) {
            const nav = document.getElementById(`floating-nav-${from}`);
            if (nav) nav.remove();
        }
    });

    console.log('[WordCollectionApp] 题型配置系统初始化完成');
};

WordCollectionApp.prototype.analyzeReadingMistakes = async function() {
    if (!this.currentPassage || !this.readingAnswers) return;

    const questions = this.currentPassage.questions;
    const wrongQuestions = [];

    questions.forEach((q, idx) => {
        const userAnswer = this.readingAnswers[idx];
        const isCorrect = userAnswer === q.correct;
        if (!isCorrect) {
            wrongQuestions.push({
                index: idx,
                question: q.text,
                questionCn: q.textCn || '',
                userAnswer: userAnswer !== undefined ? q.options[userAnswer] : '未作答',
                correctAnswer: q.options[q.correct],
                options: q.options,
                passage: this.currentPassage.text || this.currentPassage.paragraphs?.map(p => p.en).join('\n') || ''
            });
        }
    });

    if (wrongQuestions.length === 0) {
        // 全对，显示祝贺
        const resultEl = document.getElementById('reading-result');
        const existingAi = resultEl.querySelector('.ai-mistake-analysis');
        if (existingAi) existingAi.remove();
        return;
    }

    this.showLoading('AI正在分析错题，请稍候...');

    try {
        const analyses = [];
        for (const wq of wrongQuestions) {
            const analysis = await this.analyzeSingleMistake(
                wq.question,
                wq.userAnswer,
                wq.correctAnswer,
                wq.passage
            );
            analyses.push({ ...wq, analysis });
        }

        // 生成个性化学习建议
        const mistakeTypes = analyses.map(a => a.analysis.errorType);
        const typeCount = {};
        mistakeTypes.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });
        const mainWeakness = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '综合理解';

        const summary = {
            totalWrong: wrongQuestions.length,
            mainWeakness: mainWeakness,
            analyses: analyses,
            studyAdvice: this.generateStudyAdvice(typeCount)
        };

        this.renderMistakeAnalysis(summary);

        // 将错题加入错题本（已带有AI分析）
        analyses.forEach(a => {
            this.addWrongRecord({
                type: 'reading',
                word: a.correctAnswer,
                meaning: a.questionCn,
                question: a.question,
                correctAnswer: a.correctAnswer,
                userAnswer: a.userAnswer,
                aiAnalysis: a.analysis,
                passageTitle: this.currentPassage.title
            });
        });
    } catch (err) {
        console.error('AI错题分析失败:', err);
    } finally {
        this.hideLoading();
    }
}

WordCollectionApp.prototype.analyzeSingleMistake = async function(question, userAnswer, correctAnswer, passage) {
    const apiKey = this.settings.apiKey;
    if (!apiKey) {
        return {
            errorType: '理解偏差',
            knowledgePoint: '阅读理解',
            reason: '未配置API密钥，使用默认分析',
            suggestion: '建议仔细阅读文章，定位关键信息'
        };
    }

    const prompt = `你是一位考研英语阅读辅导专家。请分析以下错题，指出错误原因并给出改进建议。

文章片段：
${passage.substring(0, 1500)}

题目：${question}
用户答案：${userAnswer}
正确答案：${correctAnswer}

请以JSON格式返回：
{
  "errorType": "错误类型（词汇/语法/理解/推理/细节/主旨）",
  "knowledgePoint": "涉及的知识点",
  "reason": "详细的错误原因分析（中文，100字以内）",
  "suggestion": "针对性的改进建议（中文，100字以内）",
  "keySentence": "文章中对应的关键句"
}`;

    try {
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'qwen-turbo',
                input: {
                    messages: [
                        { role: 'system', content: '你是考研英语阅读理解专家，擅长分析学生错题并提供针对性建议。' },
                        { role: 'user', content: prompt }
                    ]
                },
                parameters: {
                    result_format: 'message'
                }
            })
        });

        if (!response.ok) throw new Error('API请求失败');

        const data = await response.json();
        const content = data.output?.choices?.[0]?.message?.content || '';

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return {
                errorType: result.errorType || '理解偏差',
                knowledgePoint: result.knowledgePoint || '阅读理解',
                reason: result.reason || '未能准确理解题意',
                suggestion: result.suggestion || '建议多做同类题型练习',
                keySentence: result.keySentence || ''
            };
        }
    } catch (e) {
        console.error('AI分析单题失败:', e);
    }

    return {
        errorType: '理解偏差',
        knowledgePoint: '阅读理解',
        reason: '未能准确把握题目要求和文章信息',
        suggestion: '建议重新阅读相关段落，标注关键词句'
    };
}

WordCollectionApp.prototype.generateStudyAdvice = function(typeCount) {
    const adviceMap = {
        '词汇': '建议加强核心词汇积累，特别是熟词僻义',
        '语法': '建议复习长难句分析方法，理清句子结构',
        '理解': '建议提升整体阅读速度和理解能力',
        '推理': '建议练习根据上下文推断隐含意义',
        '细节': '建议养成定位原文、核对细节的习惯',
        '主旨': '建议练习概括段落大意和全文主旨'
    };

    const advices = Object.entries(typeCount).map(([type, count]) => {
        const baseAdvice = adviceMap[type] || '建议加强相关知识点练习';
        return `${type}类错误${count}道：${baseAdvice}`;
    });

    return advices;
}

WordCollectionApp.prototype.renderMistakeAnalysis = function(analysis) {
    const resultEl = document.getElementById('reading-result');
    if (!resultEl) return;

    // 移除旧的AI分析
    const existing = resultEl.querySelector('.ai-mistake-analysis');
    if (existing) existing.remove();

    let html = `
        <div class="ai-mistake-analysis" style="margin-top: 24px; padding: 20px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
            <h3 style="color: var(--accent); margin-bottom: 16px;">🤖 AI错题分析报告</h3>
            <div style="margin-bottom: 16px; padding: 12px; background: var(--bg); border-radius: 8px;">
                <div style="font-weight: 600; margin-bottom: 8px;">主要薄弱点：${analysis.mainWeakness}</div>
                <div style="color: var(--text-muted); font-size: 14px;">共${analysis.totalWrong}道错题</div>
            </div>
    `;

    analysis.analyses.forEach((item, idx) => {
        const a = item.analysis;
        html += `
            <div style="margin-bottom: 16px; padding: 16px; background: var(--bg); border-radius: 8px; border-left: 4px solid var(--error);">
                <div style="font-weight: 600; margin-bottom: 8px;">错题 ${idx + 1}：${a.errorType}</div>
                <div style="margin-bottom: 6px; color: var(--text-muted); font-size: 14px;">📖 ${item.question.substring(0, 60)}...</div>
                <div style="margin-bottom: 6px;"><span style="color: var(--error);">你的答案：${item.userAnswer}</span> → <span style="color: var(--success);">正确答案：${item.correctAnswer}</span></div>
                <div style="margin-bottom: 6px; font-size: 14px;"><strong>错误原因：</strong>${a.reason}</div>
                <div style="font-size: 14px; color: var(--accent);"><strong>💡 改进建议：</strong>${a.suggestion}</div>
                ${a.keySentence ? `<div style="margin-top: 8px; padding: 8px; background: rgba(255,215,0,0.1); border-radius: 4px; font-size: 13px;">📌 关键句：${a.keySentence}</div>` : ''}
            </div>
        `;
    });

    // 学习建议
    html += `
            <div style="margin-top: 16px; padding: 12px; background: rgba(0,123,255,0.05); border-radius: 8px;">
                <div style="font-weight: 600; margin-bottom: 8px; color: var(--accent);">📋 针对性学习建议</div>
                ${analysis.studyAdvice.map(adv => `<div style="font-size: 14px; margin-bottom: 4px;">• ${adv}</div>`).join('')}
            </div>
        </div>
    `;

    resultEl.insertAdjacentHTML('beforeend', html);
}

WordCollectionApp.prototype.submitWritingWithAIGrade = async function() {
    const essay = this.getWritingInputText();
    if (!essay) {
        alert('请输入或上传作文内容');
        return;
    }
    if (!this.currentWritingPrompt) {
        alert('请先生成作文题目');
        return;
    }

    const wordCount = essay.trim().split(/\s+/).length;
    const difficulty = this.currentWritingPrompt.difficulty || 'medium';
    const topic = this.currentWritingPrompt.prompt || '';

    this.showLoading('AI正在评分，请稍候...');

    try {
        const result = await this.callAIWritingGrade(topic, essay, wordCount, difficulty);
        this.renderWritingGradeResult(result);

        // 保存到学习记录
        Storage.addActivity({
            type: result.totalScore >= 60 ? 'correct' : 'wrong',
            message: `作文练习：${this.currentWritingPrompt.title || '作文'}，得分 ${result.totalScore}分`
        });

        // 学习助手Agent反馈
        const writingScore = result.totalScore || 0;
        const writingCorrect = writingScore >= 60 ? 1 : 0;
        const writingWrongItems = writingScore < 60 ? [{
            score: writingScore,
            correctAnswer: '',
            userAnswer: ''
        }] : [];
        this.showAgentFeedback('writing', writingScore, writingCorrect, 1, writingWrongItems);
    } catch (err) {
        console.error('AI作文评分失败:', err);
        alert('评分失败，请检查API配置或稍后重试');
    } finally {
        this.hideLoading();
    }
}

WordCollectionApp.prototype.callAIWritingGrade = async function(topic, essay, wordCount, difficulty) {
    const apiKey = this.settings.apiKey;

    // 如果有后端agentClient，优先使用后端
    if (typeof agentClient !== 'undefined' && agentClient.evaluateWriting) {
        try {
            const backendResult = await agentClient.evaluateWriting(topic, essay);
            if (backendResult.success && backendResult.data && backendResult.data.evaluation) {
                const ev = backendResult.data.evaluation;
                return {
                    totalScore: ev.totalScore || 0,
                    dimensions: {
                        vocabulary: ev.vocabularyScore || 0,
                        grammar: ev.languageScore || 0,
                        structure: ev.structureScore || 0,
                        content: ev.contentScore || 0
                    },
                    detailedComment: ev.overallComment || '',
                    suggestions: ev.suggestions || [],
                    strengths: ev.strengths || [],
                    weaknesses: ev.weaknesses || [],
                    grammarErrors: ev.grammarErrors || [],
                    improvedVersion: ev.improvedVersion || ''
                };
            }
        } catch (e) {
            console.log('后端评分失败，尝试直接调用AI API');
        }
    }

    if (!apiKey) {
        throw new Error('未配置API密钥');
    }

    const difficultyDesc = { easy: '简单', medium: '中等', hard: '困难' };

    const prompt = `你是一位考研英语作文评分专家。请对以下作文进行评分和点评。

作文题目：${topic}
难度：${difficultyDesc[difficulty] || '中等'}
字数：${wordCount}

作文内容：
${essay}

请严格按照以下JSON格式返回（分数均为0-100分制）：
{
  "totalScore": 总分,
  "dimensions": {
    "vocabulary": 词汇运用分数,
    "grammar": 语法正确性分数,
    "structure": 文章结构分数,
    "content": 内容充实度分数
  },
  "detailedComment": "总体评价（中文，200字以内）",
  "suggestions": ["具体改进建议1", "具体改进建议2", "具体改进建议3"],
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "grammarErrors": [
    {"original": "错误原文", "correction": "正确写法", "explanation": "错误说明", "type": "错误类型"}
  ],
  "improvedVersion": "改进后的作文全文"
}`;

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'qwen-turbo',
            input: {
                messages: [
                    { role: 'system', content: '你是考研英语作文评分专家，严格按照评分标准给出公正评分和建设性意见。' },
                    { role: 'user', content: prompt }
                ]
            },
            parameters: {
                result_format: 'message'
            }
        })
    });

    if (!response.ok) throw new Error('API请求失败');

    const data = await response.json();
    const content = data.output?.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
            totalScore: result.totalScore || 0,
            dimensions: {
                vocabulary: result.dimensions?.vocabulary || 0,
                grammar: result.dimensions?.grammar || 0,
                structure: result.dimensions?.structure || 0,
                content: result.dimensions?.content || 0
            },
            detailedComment: result.detailedComment || '',
            suggestions: result.suggestions || [],
            strengths: result.strengths || [],
            weaknesses: result.weaknesses || [],
            grammarErrors: result.grammarErrors || [],
            improvedVersion: result.improvedVersion || ''
        };
    }

    throw new Error('无法解析AI评分结果');
}

WordCollectionApp.prototype.renderWritingGradeResult = function(result) {
    const container = document.getElementById('writing-evaluation');
    if (!container) return;

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });

    // 总分
    const totalEl = document.getElementById('total-score');
    if (totalEl) totalEl.textContent = result.totalScore;

    // 各维度分数条
    const dims = result.dimensions;
    const dimMap = [
        { id: 'vocabulary-score', barId: 'vocabulary-score-bar', val: dims.vocabulary, max: 100, label: '词汇运用' },
        { id: 'grammar-score', barId: 'grammar-score-bar', val: dims.grammar, max: 100, label: '语法正确' },
        { id: 'structure-score', barId: 'structure-score-bar', val: dims.structure, max: 100, label: '文章结构' },
        { id: 'content-score', barId: 'content-score-bar', val: dims.content, max: 100, label: '内容充实' }
    ];

    dimMap.forEach(d => {
        const scoreEl = document.getElementById(d.id);
        const barEl = document.getElementById(d.barId);
        if (scoreEl) scoreEl.textContent = `${d.val}/${d.max}`;
        if (barEl) barEl.style.width = `${(d.val / d.max) * 100}%`;
    });

    // 总体评价
    const commentEl = document.getElementById('overall-comment');
    if (commentEl) commentEl.textContent = result.detailedComment;

    // 优点和不足
    const renderList = (id, items) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = (items || []).map(i => `<li>${i}</li>`).join('');
    };
    renderList('strengths-list', result.strengths);
    renderList('weaknesses-list', result.weaknesses);
    renderList('suggestions-list', result.suggestions);

    // 语法错误表
    const errors = result.grammarErrors || [];
    const errorSection = document.getElementById('grammar-errors-section');
    const errorBody = document.getElementById('grammar-errors-body');
    if (errorSection && errorBody) {
        if (errors.length > 0) {
            errorSection.style.display = 'block';
            errorBody.innerHTML = errors.map(e =>
                `<tr><td>${e.original || ''}</td><td>${e.correction || ''}</td><td>${e.explanation || ''}</td><td>${e.type || ''}</td></tr>`
            ).join('');
        } else {
            errorSection.style.display = 'none';
        }
    }

    // 改进版本
    const improvedEl = document.getElementById('improved-text');
    if (improvedEl) {
        improvedEl.innerHTML = result.improvedVersion
            ? `<p>${result.improvedVersion.replace(/\n/g, '</p><p>')}</p>` : '<p>无改进版本</p>';
    }

    // 如果没有对应的DOM元素，动态构建评分面板
    if (!totalEl) {
        this.renderWritingGradeResultDynamic(result, container);
    }
}

WordCollectionApp.prototype.renderWritingGradeResultDynamic = function(result, container) {
    const dims = result.dimensions;
    const getColor = (score) => score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--accent)' : 'var(--error)';

    let html = `
        <div class="writing-grade-panel" style="padding: 20px;">
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="font-size: 48px; font-weight: 700; color: ${getColor(result.totalScore)};">${result.totalScore}</div>
                <div style="color: var(--text-muted);">总分 · 100分制</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
    `;

    const dimLabels = { vocabulary: '词汇运用', grammar: '语法正确', structure: '文章结构', content: '内容充实' };
    Object.entries(dims).forEach(([key, val]) => {
        html += `
            <div style="padding: 12px; background: var(--bg); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span>${dimLabels[key]}</span>
                    <span style="font-weight: 600; color: ${getColor(val)};">${val}分</span>
                </div>
                <div style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${val}%; height: 100%; background: ${getColor(val)}; transition: width 0.5s;"></div>
                </div>
            </div>
        `;
    });

    html += `</div>`;

    if (result.detailedComment) {
        html += `
            <div style="margin-bottom: 20px; padding: 16px; background: var(--bg); border-radius: 8px;">
                <div style="font-weight: 600; margin-bottom: 8px;">总体评价</div>
                <div style="line-height: 1.6;">${result.detailedComment}</div>
            </div>
        `;
    }

    if (result.suggestions && result.suggestions.length > 0) {
        html += `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 600; margin-bottom: 8px;">改进建议</div>
                ${result.suggestions.map(s => `<div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(0,123,255,0.05); border-radius: 6px; font-size: 14px;">💡 ${s}</div>`).join('')}
            </div>
        `;
    }

    if (result.improvedVersion) {
        html += `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 600; margin-bottom: 8px;">改进版本</div>
                <div style="padding: 16px; background: var(--bg); border-radius: 8px; line-height: 1.8; font-size: 14px;">
                    ${result.improvedVersion.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
}

WordCollectionApp.prototype.addPhotoUploadToTranslationBlank = function(sentenceIndex) {
    const inputEl = document.getElementById(`translation-input-${sentenceIndex}`);
    if (!inputEl) return;

    const container = inputEl.parentElement;
    if (!container) return;

    // 避免重复添加
    if (container.querySelector('.blank-photo-btn')) return;

    const photoBtn = document.createElement('button');
    photoBtn.className = 'blank-photo-btn';
    photoBtn.innerHTML = '📷';
    photoBtn.title = '拍照上传';
    photoBtn.style.cssText = `
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
    `;

    photoBtn.addEventListener('click', () => {
        this.renderBlankPhotoDialog(sentenceIndex);
    });

    // 确保容器有相对定位
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    container.appendChild(photoBtn);
}

WordCollectionApp.prototype.processBlankPhoto = async function(sentenceIndex, imageData) {
    this.showLoading('正在识别图片中的文字...');

    try {
        let extractedText = '';
        let confidence = 0;

        // 优先使用后端OCR服务
        if (typeof agentClient !== 'undefined' && agentClient.analyzeFile) {
            // 将base64转为blob
            const blob = this.base64ToBlob(imageData);
            const file = new File([blob], 'blank_photo.jpg', { type: 'image/jpeg' });
            const result = await agentClient.analyzeFile(file);
            if (result.success && result.data) {
                extractedText = result.data.extractedText || '';
                confidence = result.data.confidence || 0.85;
            }
        }

        // 如果后端不可用或失败，尝试使用前端Tesseract.js（如果已加载）
        if (!extractedText && typeof Tesseract !== 'undefined') {
            const result = await Tesseract.recognize(imageData, 'eng');
            extractedText = result.data.text || '';
            confidence = result.data.confidence ? (result.data.confidence / 100) : 0.7;
        }

        if (!extractedText) {
            alert('未能识别出文字，请尝试重新拍照或手动输入');
            return;
        }

        // 清理识别结果（去除多余空格和换行）
        extractedText = extractedText.replace(/\s+/g, ' ').trim();

        // 填入对应输入框
        const inputEl = document.getElementById(`translation-input-${sentenceIndex}`);
        if (inputEl) {
            inputEl.value = extractedText;
            // 触发input事件以更新状态
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 保存到translationInputs
        if (this.translationInputs) {
            this.translationInputs[sentenceIndex] = extractedText;
        }

        // 显示识别结果和置信度
        this.showBlankOCRResult(sentenceIndex, extractedText, confidence);
    } catch (err) {
        console.error('OCR识别失败:', err);
        alert('识别失败，请检查网络或手动输入');
    } finally {
        this.hideLoading();
    }
}

WordCollectionApp.prototype.base64ToBlob = function(base64) {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const binary = atob(parts[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
}

WordCollectionApp.prototype.showBlankOCRResult = function(sentenceIndex, text, confidence) {
    const inputEl = document.getElementById(`translation-input-${sentenceIndex}`);
    if (!inputEl) return;

    // 移除旧的结果提示
    const parent = inputEl.parentElement;
    const oldTip = parent.querySelector('.blank-ocr-tip');
    if (oldTip) oldTip.remove();

    const confidencePercent = Math.round(confidence * 100);
    const color = confidence >= 0.8 ? 'var(--success)' : confidence >= 0.5 ? 'var(--accent)' : 'var(--error)';

    const tip = document.createElement('div');
    tip.className = 'blank-ocr-tip';
    tip.style.cssText = `
        margin-top: 6px;
        font-size: 12px;
        color: ${color};
        display: flex;
        align-items: center;
        gap: 6px;
    `;
    tip.innerHTML = `
        <span>📝 识别结果："${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"</span>
        <span>（置信度 ${confidencePercent}%）</span>
    `;

    parent.appendChild(tip);

    // 3秒后自动淡出
    setTimeout(() => {
        if (tip.parentElement) {
            tip.style.transition = 'opacity 0.5s';
            tip.style.opacity = '0.5';
        }
    }, 3000);
}

WordCollectionApp.prototype.renderBlankPhotoDialog = function(sentenceIndex) {
    // 移除旧对话框
    const oldDialog = document.getElementById('blank-photo-dialog');
    if (oldDialog) oldDialog.remove();

    const dialog = document.createElement('div');
    dialog.id = 'blank-photo-dialog';
    dialog.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    `;

    dialog.innerHTML = `
        <div style="background: var(--card-bg); border-radius: 16px; padding: 24px; width: 90%; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-size: 18px;">📷 拍照识别第${sentenceIndex + 1}空</h3>
                <button id="blank-photo-close" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted);">&times;</button>
            </div>

            <div style="margin-bottom: 20px;">
                <div id="blank-photo-preview" style="width: 100%; height: 200px; border: 2px dashed var(--border); border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted); cursor: pointer; background: var(--bg);">
                    <div style="font-size: 48px; margin-bottom: 8px;">📷</div>
                    <div>点击拍照或拖拽图片到此处</div>
                    <div style="font-size: 12px; margin-top: 4px;">支持 JPG、PNG 格式</div>
                </div>
                <video id="blank-photo-video" style="width: 100%; border-radius: 12px; display: none;" autoplay playsinline></video>
                <canvas id="blank-photo-canvas" style="display: none;"></canvas>
                <img id="blank-photo-img" style="width: 100%; border-radius: 12px; display: none; margin-top: 12px;" />
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="blank-photo-camera-btn" style="flex: 1; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;">📷 打开相机</button>
                <button id="blank-photo-file-btn" style="flex: 1; padding: 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 14px;">📁 选择文件</button>
            </div>

            <div id="blank-photo-actions" style="display: none; margin-top: 16px; display: flex; gap: 10px;">
                <button id="blank-photo-retake" style="flex: 1; padding: 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">重拍</button>
                <button id="blank-photo-confirm" style="flex: 1; padding: 10px; background: var(--success); color: white; border: none; border-radius: 8px; cursor: pointer;">确认识别</button>
            </div>

            <input type="file" id="blank-photo-file-input" accept="image/*" style="display: none;" />
        </div>
    `;

    document.body.appendChild(dialog);

    // 元素引用
    const previewEl = document.getElementById('blank-photo-preview');
    const videoEl = document.getElementById('blank-photo-video');
    const canvasEl = document.getElementById('blank-photo-canvas');
    const imgEl = document.getElementById('blank-photo-img');
    const actionsEl = document.getElementById('blank-photo-actions');
    const fileInput = document.getElementById('blank-photo-file-input');

    let stream = null;
    let capturedImage = null;

    // 关闭对话框
    document.getElementById('blank-photo-close').addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }
        dialog.remove();
    });

    // 点击遮罩关闭
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            dialog.remove();
        }
    });

    // 打开相机
    document.getElementById('blank-photo-camera-btn').addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            videoEl.srcObject = stream;
            videoEl.style.display = 'block';
            previewEl.style.display = 'none';
            imgEl.style.display = 'none';
            actionsEl.style.display = 'flex';
        } catch (err) {
            alert('无法访问相机，请检查权限设置');
            console.error('相机启动失败:', err);
        }
    });

    // 选择文件
    document.getElementById('blank-photo-file-btn').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            capturedImage = ev.target.result;
            imgEl.src = capturedImage;
            imgEl.style.display = 'block';
            videoEl.style.display = 'none';
            previewEl.style.display = 'none';
            actionsEl.style.display = 'flex';
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
        };
        reader.readAsDataURL(file);
    });

    // 拖拽上传
    previewEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        previewEl.style.borderColor = 'var(--accent)';
        previewEl.style.background = 'rgba(0,123,255,0.05)';
    });
    previewEl.addEventListener('dragleave', () => {
        previewEl.style.borderColor = 'var(--border)';
        previewEl.style.background = 'var(--bg)';
    });
    previewEl.addEventListener('drop', (e) => {
        e.preventDefault();
        previewEl.style.borderColor = 'var(--border)';
        previewEl.style.background = 'var(--bg)';

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                capturedImage = ev.target.result;
                imgEl.src = capturedImage;
                imgEl.style.display = 'block';
                videoEl.style.display = 'none';
                previewEl.style.display = 'none';
                actionsEl.style.display = 'flex';
            };
            reader.readAsDataURL(file);
        }
    });

    // 点击预览区也触发文件选择
    previewEl.addEventListener('click', () => {
        if (previewEl.style.display !== 'none') {
            fileInput.click();
        }
    });

    // 拍照
    const takePhoto = () => {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        canvasEl.getContext('2d').drawImage(videoEl, 0, 0);
        capturedImage = canvasEl.toDataURL('image/jpeg', 0.9);
        imgEl.src = capturedImage;
        imgEl.style.display = 'block';
        videoEl.style.display = 'none';
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
    };

    videoEl.addEventListener('click', takePhoto);

    // 重拍
    document.getElementById('blank-photo-retake').addEventListener('click', () => {
        capturedImage = null;
        imgEl.style.display = 'none';
        previewEl.style.display = 'flex';
        actionsEl.style.display = 'none';
    });

    // 确认识别
    document.getElementById('blank-photo-confirm').addEventListener('click', () => {
        if (capturedImage) {
            this.processBlankPhoto(sentenceIndex, capturedImage);
            dialog.remove();
        } else {
            alert('请先拍照或选择图片');
        }
    });
}

WordCollectionApp.prototype.startMemoryQuickMode = function() {
    if (!this.memoryWords || this.memoryWords.length === 0) {
        // 加载单词
        const letter = this.memoryLetter;
        const mode = this.memoryMode;

        let words = this.words;
        if (mode === 'letter' && letter) {
            words = words.filter(w => w.word.toUpperCase().startsWith(letter));
        } else if (mode === 'favorites') {
            words = words.filter(w => w.is_favorite);
        }

        // 随机打乱
        this.memoryWords = words.sort(() => Math.random() - 0.5);
        this.memoryCurrentIndex = 0;
    }

    if (this.memoryWords.length === 0) {
        alert('当前条件下没有单词');
        return;
    }

    this.memoryCurrentWord = this.memoryWords[this.memoryCurrentIndex];
    this.renderMemoryQuickCard();
}

WordCollectionApp.prototype.renderMemoryQuickCard = function() {
    const word = this.memoryCurrentWord;
    if (!word) return;

    const container = document.getElementById('memory-practice-area');
    if (!container) return;

    container.innerHTML = `
        <div id="memory-quick-card" style="text-align: center; padding: 40px 20px;">
            <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 16px;">
                ${this.memoryCurrentIndex + 1} / ${this.memoryWords.length}
            </div>
            <div id="memory-quick-word" style="font-size: 42px; font-weight: 700; margin-bottom: 32px; color: var(--text); cursor: pointer; user-select: none;">
                ${word.word}
            </div>
            <div id="memory-quick-meaning" style="display: none; font-size: 20px; color: var(--accent); margin-bottom: 32px; padding: 16px; background: var(--bg); border-radius: 12px;">
                ${word.meaning}
            </div>
            <div id="memory-quick-actions" style="display: flex; gap: 16px; justify-content: center;">
                <button id="btn-memory-know" style="padding: 14px 36px; background: var(--success); color: white; border: none; border-radius: 12px; font-size: 16px; cursor: pointer; font-weight: 600;">
                    ✓ 认识
                </button>
                <button id="btn-memory-unknown" style="padding: 14px 36px; background: var(--error); color: white; border: none; border-radius: 12px; font-size: 16px; cursor: pointer; font-weight: 600;">
                    ✗ 不认识
                </button>
            </div>
            <div id="memory-quick-next" style="display: none; margin-top: 24px;">
                <button id="btn-memory-quick-next" style="padding: 12px 32px; background: var(--accent); color: white; border: none; border-radius: 12px; font-size: 16px; cursor: pointer;">
                    下一个 →
                </button>
            </div>
        </div>
    `;

    // 事件绑定
    document.getElementById('btn-memory-know').addEventListener('click', () => {
        this.handleMemoryQuickAnswer(true);
    });

    document.getElementById('btn-memory-unknown').addEventListener('click', () => {
        this.handleMemoryQuickAnswer(false);
    });

    document.getElementById('btn-memory-quick-next').addEventListener('click', () => {
        this.memoryCurrentIndex++;
        if (this.memoryCurrentIndex >= this.memoryWords.length) {
            this.renderMemoryQuickSummary();
        } else {
            this.memoryCurrentWord = this.memoryWords[this.memoryCurrentIndex];
            this.renderMemoryQuickCard();
        }
    });

    // 点击单词显示音标
    document.getElementById('memory-quick-word').addEventListener('click', () => {
        this.speakText(word.word);
    });
}

WordCollectionApp.prototype.handleMemoryQuickAnswer = function(isKnown) {
    const word = this.memoryCurrentWord;
    if (!word) return;

    const actionsEl = document.getElementById('memory-quick-actions');
    const meaningEl = document.getElementById('memory-quick-meaning');
    const nextEl = document.getElementById('memory-quick-next');

    if (actionsEl) actionsEl.style.display = 'none';
    if (meaningEl) meaningEl.style.display = 'block';
    if (nextEl) nextEl.style.display = 'block';

    if (isKnown) {
        // 认识的单词
        this.recordMemoryToCollection(word, true);
        this.lightUpWord(word);

        const wordEl = document.getElementById('memory-quick-word');
        if (wordEl) {
            wordEl.style.color = 'var(--success)';
        }
    } else {
        // 不认识的单词
        this.recordMemoryToCollection(word, false);

        // 添加到错题本
        this.addWrongRecord({
            type: 'memory',
            word: word.word,
            meaning: word.meaning,
            question: `单词记忆：${word.word}`,
            correctAnswer: word.meaning,
            userAnswer: '不认识'
        });

        const wordEl = document.getElementById('memory-quick-word');
        if (wordEl) {
            wordEl.style.color = 'var(--error)';
        }
    }
}

WordCollectionApp.prototype.renderMemoryQuickSummary = function() {
    const container = document.getElementById('memory-practice-area');
    if (!container) return;

    const total = this.memoryWords.length;
    const knownCount = this.memoryWords.filter(w => (w.correct_count || 0) > (w._quickModeBefore || 0)).length;

    container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <div style="font-size: 64px; margin-bottom: 16px;">🎉</div>
            <div style="font-size: 24px; font-weight: 700; margin-bottom: 16px;">快速记忆完成</div>
            <div style="font-size: 18px; color: var(--text-muted); margin-bottom: 32px;">
                本次共复习 ${total} 个单词，认识 ${knownCount} 个
            </div>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button onclick="app.startMemoryQuickMode()" style="padding: 12px 28px; background: var(--accent); color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 15px;">
                    再来一轮
                </button>
                <button onclick="app.switchPage('collection')" style="padding: 12px 28px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; font-size: 15px;">
                    去收藏室查看
                </button>
            </div>
        </div>
    `;
}

WordCollectionApp.prototype.lightUpWord = function(word) {
    // 在收藏室中找到对应单词卡片
    const cards = document.querySelectorAll(`.word-card[data-word="${word.word}"]`);
    if (cards.length === 0) return;

    const level = LevelSystem.getLevel(word.correct_count || 0);
    const levelColors = ['#4caf50', '#2196f3', '#9c27b0', '#ff9800', '#f44336'];
    const glowColor = levelColors[level] || levelColors[0];

    cards.forEach(card => {
        // 更新颜色等级
        card.className = `word-card level-${level}`;

        // 添加发光动画
        card.style.animation = 'none';
        card.offsetHeight; // 触发重排
        card.style.animation = `wordLightUp 1.5s ease-out`;
        card.style.boxShadow = `0 0 20px ${glowColor}80, 0 0 40px ${glowColor}40`;

        // 更新计数显示
        const countEl = card.querySelector('.word-count');
        if (countEl) {
            countEl.textContent = word.correct_count || 0;
        }

        // 1.5秒后恢复正常阴影
        setTimeout(() => {
            card.style.boxShadow = '';
            card.style.animation = '';
        }, 1500);
    });

    // 如果动态样式不存在，添加它
    if (!document.getElementById('word-lightup-style')) {
        const style = document.createElement('style');
        style.id = 'word-lightup-style';
        style.textContent = `
            @keyframes wordLightUp {
                0% { transform: scale(1); box-shadow: 0 0 0px transparent; }
                30% { transform: scale(1.08); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
}

WordCollectionApp.prototype.recordMemoryToCollection = function(word, isCorrect) {
    if (!word) return;

    // 记录快速模式前的正确次数，用于统计
    word._quickModeBefore = word.correct_count || 0;

    if (isCorrect) {
        word.correct_count = (word.correct_count || 0) + 1;
    } else {
        word.wrong_count = (word.wrong_count || 0) + 1;
    }

    // 保存到Storage
    Storage.saveWords(this.words);

    // 如果正确且达到新等级，触发lightUpWord
    if (isCorrect) {
        const oldLevel = LevelSystem.getLevel((word.correct_count || 0) - 1);
        const newLevel = LevelSystem.getLevel(word.correct_count || 0);
        if (newLevel > oldLevel) {
            this.lightUpWord(word);

            // 显示升级提示
            this.showToast(`🎉 "${word.word}" 升级到 ${LevelSystem.getLevelName(newLevel)}！`);
        }
    }

    // 记录活动
    Storage.addActivity({
        type: isCorrect ? 'correct' : 'wrong',
        message: `单词记忆：${isCorrect ? '认识' : '不认识'} "${word.word}"`
    });
}

WordCollectionApp.prototype.renderWrongListByType = function(filter = 'all') {
    const list = document.getElementById('wrong-list');
    if (!list) return;

    // 扩展错误类型分类（在原有type基础上增加errorType）
    const wrongRecords = this.wrongRecords || [];
    const filtered = filter === 'all'
        ? wrongRecords
        : wrongRecords.filter(r => {
            if (['practice', 'reading', 'translation', 'cloze', 'memory'].includes(filter)) {
                return r.type === filter;
            }
            // 按AI分析的错误类型筛选
            return r.aiAnalysis?.errorType === filter;
        });

    // 更新统计数据（扩充分类标签）
    const typeCounts = {
        all: wrongRecords.length,
        practice: wrongRecords.filter(r => r.type === 'practice').length,
        reading: wrongRecords.filter(r => r.type === 'reading').length,
        translation: wrongRecords.filter(r => r.type === 'translation').length,
        cloze: wrongRecords.filter(r => r.type === 'cloze').length,
        memory: wrongRecords.filter(r => r.type === 'memory').length,
        vocabulary: wrongRecords.filter(r => r.aiAnalysis?.errorType === '词汇').length,
        grammar: wrongRecords.filter(r => r.aiAnalysis?.errorType === '语法').length,
        understanding: wrongRecords.filter(r => r.aiAnalysis?.errorType === '理解').length,
        spelling: wrongRecords.filter(r => r.aiAnalysis?.errorType === '拼写').length
    };

    // 更新UI计数
    Object.entries(typeCounts).forEach(([key, count]) => {
        const el = document.getElementById(`wrong-count-${key}`);
        if (el) el.textContent = count;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="wrong-empty"><div class="empty-icon">🎉</div><p>该分类下暂无错题</p></div>';
        return;
    }

    list.innerHTML = filtered.map(record => {
        const typeLabels = {
            practice: '例句练习',
            reading: '阅读理解',
            translation: '翻译练习',
            cloze: '选词填空',
            memory: '单词记忆'
        };

        const errorTypeColor = {
            '词汇': '#ff6b6b',
            '语法': '#feca57',
            '理解': '#48dbfb',
            '推理': '#ff9ff3',
            '细节': '#54a0ff',
            '主旨': '#5f27cd',
            '拼写': '#ff9f43'
        };

        const aiTag = record.aiAnalysis?.errorType
            ? `<span style="display: inline-block; padding: 2px 8px; background: ${errorTypeColor[record.aiAnalysis.errorType] || 'var(--text-muted)'}20; color: ${errorTypeColor[record.aiAnalysis.errorType] || 'var(--text-muted)'}; border-radius: 4px; font-size: 12px; margin-left: 8px;">${record.aiAnalysis.errorType}</span>`
            : '';

        const aiReason = record.aiAnalysis?.reason
            ? `<div style="margin-top: 6px; font-size: 13px; color: var(--text-muted);">🤖 ${record.aiAnalysis.reason}</div>`
            : '';

        const aiSuggestion = record.aiAnalysis?.suggestion
            ? `<div style="margin-top: 4px; font-size: 13px; color: var(--accent);">💡 ${record.aiAnalysis.suggestion}</div>`
            : '';

        return `
            <div class="wrong-item" style="padding: 16px; background: var(--card-bg); border-radius: 12px; margin-bottom: 12px; border: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <span style="display: inline-block; padding: 2px 8px; background: var(--accent); color: white; border-radius: 4px; font-size: 12px;">${typeLabels[record.type] || record.type}</span>
                        ${aiTag}
                    </div>
                    <button onclick="app.removeWrongRecord(${record.id})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">&times;</button>
                </div>
                <div style="font-weight: 600; margin-bottom: 6px;">${record.word || record.question || '未记录题目'}</div>
                ${record.meaning ? `<div style="color: var(--text-muted); font-size: 14px; margin-bottom: 6px;">${record.meaning}</div>` : ''}
                ${record.userAnswer ? `<div style="color: var(--error); font-size: 14px;">你的答案：${record.userAnswer}</div>` : ''}
                ${record.correctAnswer ? `<div style="color: var(--success); font-size: 14px;">正确答案：${record.correctAnswer}</div>` : ''}
                ${aiReason}
                ${aiSuggestion}
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">
                    ${new Date(record.createdAt).toLocaleString('zh-CN')}
                    ${record.passageTitle ? ` · ${record.passageTitle}` : ''}
                </div>
            </div>
        `;
    }).join('');
}

WordCollectionApp.prototype.analyzeWrongPatterns = async function() {
    const wrongRecords = this.wrongRecords || [];
    if (wrongRecords.length === 0) {
        alert('暂无错题记录，多做一些练习再来分析吧！');
        return;
    }

    this.showLoading('AI正在分析错题规律...');

    try {
        // 本地分析错题数据
        const analysis = this.localAnalyzeWrongPatterns(wrongRecords);

        // 如果有API密钥，调用AI进行更深入分析
        const apiKey = this.settings.apiKey;
        if (apiKey && wrongRecords.length >= 3) {
            try {
                const aiAnalysis = await this.callAIWrongPatternAnalysis(wrongRecords, analysis);
                analysis.aiSuggestions = aiAnalysis.suggestions || [];
                analysis.weakTopics = aiAnalysis.weakTopics || analysis.weakTopics;
            } catch (e) {
                console.log('AI深度分析失败，使用本地分析结果');
            }
        }

        this.renderWrongPatternAnalysis(analysis);
    } catch (err) {
        console.error('错题规律分析失败:', err);
        alert('分析失败，请稍后重试');
    } finally {
        this.hideLoading();
    }
}

WordCollectionApp.prototype.localAnalyzeWrongPatterns = function(wrongRecords) {
    // 按题型统计
    const typeStats = {};
    wrongRecords.forEach(r => {
        typeStats[r.type] = (typeStats[r.type] || 0) + 1;
    });

    // 按AI错误类型统计
    const errorTypeStats = {};
    wrongRecords.forEach(r => {
        if (r.aiAnalysis?.errorType) {
            errorTypeStats[r.aiAnalysis.errorType] = (errorTypeStats[r.aiAnalysis.errorType] || 0) + 1;
        }
    });

    // 按时间趋势
    const dailyStats = {};
    wrongRecords.forEach(r => {
        const date = new Date(r.createdAt).toISOString().split('T')[0];
        dailyStats[date] = (dailyStats[date] || 0) + 1;
    });

    // 高频错误单词
    const wordFreq = {};
    wrongRecords.forEach(r => {
        if (r.word) {
            wordFreq[r.word] = (wordFreq[r.word] || 0) + 1;
        }
    });
    const topWords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    // 薄弱知识点TOP10
    const weakTopics = Object.entries(errorTypeStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count }));

    // 计算最近7天趋势
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        last7Days.push({ date: dateStr, count: dailyStats[dateStr] || 0 });
    }

    return {
        totalWrong: wrongRecords.length,
        typeStats,
        errorTypeStats,
        dailyStats,
        topWords,
        weakTopics,
        last7Days,
        suggestions: this.generateLocalSuggestions(typeStats, errorTypeStats, topWords)
    };
}

WordCollectionApp.prototype.generateLocalSuggestions = function(typeStats, errorTypeStats, topWords) {
    const suggestions = [];

    const maxType = Object.entries(typeStats).sort((a, b) => b[1] - a[1])[0];
    if (maxType) {
        const typeNames = { practice: '例句练习', reading: '阅读理解', translation: '翻译练习', cloze: '选词填空', memory: '单词记忆' };
        suggestions.push(`你在${typeNames[maxType[0]] || maxType[0]}中错题最多（${maxType[1]}道），建议重点加强该模块训练`);
    }

    const maxErrorType = Object.entries(errorTypeStats).sort((a, b) => b[1] - a[1])[0];
    if (maxErrorType) {
        suggestions.push(`${maxErrorType[0]}类错误最多（${maxErrorType[1]}道），建议针对性复习相关知识点`);
    }

    if (topWords.length > 0) {
        suggestions.push(`"${topWords[0][0]}"等单词多次出错，建议加入重点记忆列表`);
    }

    suggestions.push('建议每天回顾错题本，重复出错的题目需要特别关注');
    suggestions.push('可以尝试使用快速记忆模式，加强对薄弱单词的识记');

    return suggestions;
}

WordCollectionApp.prototype.callAIWrongPatternAnalysis = async function(wrongRecords, localAnalysis) {
    const apiKey = this.settings.apiKey;
    if (!apiKey) throw new Error('未配置API密钥');

    const prompt = `你是一位考研英语学习顾问。请根据以下学生的错题数据，分析其学习规律并给出针对性建议。

错题统计：
- 总错题数：${localAnalysis.totalWrong}
- 各题型分布：${JSON.stringify(localAnalysis.typeStats)}
- 错误类型分布：${JSON.stringify(localAnalysis.errorTypeStats)}
- 高频错误单词：${localAnalysis.topWords.slice(0, 5).map(w => w[0]).join(', ')}

请以JSON格式返回：
{
  "weakTopics": [
    {"topic": "薄弱知识点1", "count": 估计出现次数, "advice": "针对性建议"}
  ],
  "suggestions": ["具体学习建议1", "具体学习建议2", "具体学习建议3"],
  "studyPlan": "一周学习计划概要（中文，100字以内）"
}`;

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'qwen-turbo',
            input: {
                messages: [
                    { role: 'system', content: '你是考研英语学习顾问，擅长分析学生错题规律并制定针对性学习计划。' },
                    { role: 'user', content: prompt }
                ]
            },
            parameters: {
                result_format: 'message'
            }
        })
    });

    if (!response.ok) throw new Error('API请求失败');

    const data = await response.json();
    const content = data.output?.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }

    throw new Error('无法解析AI分析结果');
}

WordCollectionApp.prototype.renderWrongPatternAnalysis = function(analysis) {
    const container = document.getElementById('wrong-pattern-analysis');
    if (!container) {
        // 如果没有容器，在wrong-list前面插入
        const list = document.getElementById('wrong-list');
        if (!list) return;

        const panel = document.createElement('div');
        panel.id = 'wrong-pattern-analysis';
        panel.style.cssText = 'margin-bottom: 24px;';
        list.parentElement.insertBefore(panel, list);
        return this.renderWrongPatternAnalysis(analysis);
    }

    let html = `
        <div style="padding: 20px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px;">
            <h3 style="margin: 0 0 16px 0; color: var(--accent);">📊 AI错题规律分析</h3>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px;">
                <div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;">
                    <div style="font-size: 32px; font-weight: 700; color: var(--error);">${analysis.totalWrong}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">总错题数</div>
                </div>
    `;

    // 题型分布
    const typeNames = { practice: '例句', reading: '阅读', translation: '翻译', cloze: '完形', memory: '记忆' };
    Object.entries(analysis.typeStats).forEach(([type, count]) => {
        html += `
            <div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;">
                <div style="font-size: 28px; font-weight: 700; color: var(--accent);">${count}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${typeNames[type] || type}</div>
            </div>
        `;
    });

    html += `</div>`;

    // 薄弱知识点TOP10
    if (analysis.weakTopics && analysis.weakTopics.length > 0) {
        html += `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 600; margin-bottom: 12px;">🔍 薄弱知识点 TOP${Math.min(analysis.weakTopics.length, 10)}</div>
        `;
        analysis.weakTopics.forEach((item, idx) => {
            const topic = typeof item === 'string' ? item : item.topic;
            const count = typeof item === 'string' ? '' : `（${item.count}次）`;
            const percent = analysis.totalWrong > 0
                ? Math.round(((typeof item === 'string' ? 1 : item.count) / analysis.totalWrong) * 100)
                : 0;

            html += `
                <div style="display: flex; align-items: center; margin-bottom: 8px;">
                    <span style="width: 24px; color: var(--text-muted); font-size: 14px;">${idx + 1}</span>
                    <span style="flex: 1; font-size: 14px;">${topic}${count}</span>
                    <div style="width: 100px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin: 0 8px;">
                        <div style="width: ${percent}%; height: 100%; background: var(--error); border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 12px; color: var(--text-muted); width: 36px; text-align: right;">${percent}%</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    // 近7天趋势
    if (analysis.last7Days && analysis.last7Days.length > 0) {
        const maxCount = Math.max(...analysis.last7Days.map(d => d.count), 1);
        html += `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 600; margin-bottom: 12px;">📈 近7天错题趋势</div>
                <div style="display: flex; align-items: flex-end; gap: 8px; height: 80px; padding: 8px 0;">
        `;
        analysis.last7Days.forEach(d => {
            const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
            const dateLabel = d.date.slice(5);
            html += `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                    <div style="width: 100%; height: ${Math.max(height, 4)}%; background: ${d.count > 0 ? 'var(--error)' : 'var(--border)'}; border-radius: 4px 4px 0 0; min-height: 4px; transition: height 0.3s;"></div>
                    <div style="font-size: 10px; color: var(--text-muted);">${dateLabel}</div>
                    <div style="font-size: 11px; font-weight: 600;">${d.count}</div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    // 学习建议
    const suggestions = analysis.aiSuggestions || analysis.suggestions || [];
    if (suggestions.length > 0) {
        html += `
            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; margin-bottom: 12px;">💡 学习建议</div>
                ${suggestions.map(s => `<div style="padding: 10px 12px; margin-bottom: 6px; background: rgba(0,123,255,0.05); border-radius: 8px; font-size: 14px; line-height: 1.5;">• ${s}</div>`).join('')}
            </div>
        `;
    }

    // 学习计划
    if (analysis.studyPlan) {
        html += `
            <div style="padding: 12px; background: rgba(76,175,80,0.05); border-radius: 8px; border: 1px solid rgba(76,175,80,0.2);">
                <div style="font-weight: 600; margin-bottom: 6px; color: var(--success);">📅 推荐学习计划</div>
                <div style="font-size: 14px; line-height: 1.6;">${analysis.studyPlan}</div>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
    container.style.display = 'block';
}

WordCollectionApp.prototype.renderDetailedDiagnosis = function() {
    const records = JSON.parse(localStorage.getItem('practice_records') || '[]');
    const wrongRecords = JSON.parse(localStorage.getItem('wrong_records') || '[]');
    const container = document.getElementById('detailed-diagnosis');
    if (!container) return;

    // 计算各题型得分趋势（最近30天）
    const trendData = this.analyzeLearningTrend(30);

    // 词汇掌握度
    const mastery = this.calculateWordMastery();

    // 薄弱知识点
    const weakTopics = this.getWeakTopicsFromWrong(wrongRecords);

    let html = `
        <div style="padding: 20px;">
            <h3 style="margin: 0 0 20px 0; color: var(--accent);">📊 详细学情诊断报告</h3>

            <!-- 词汇掌握度 -->
            <div style="margin-bottom: 24px; padding: 16px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-weight: 600; margin-bottom: 12px;">📚 词汇掌握度分布</div>
                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-size: 14px;">总掌握率</span>
                            <span style="font-weight: 600; color: var(--accent);">${mastery.overallRate}%</span>
                        </div>
                        <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
                            <div style="width: ${mastery.overallRate}%; height: 100%; background: linear-gradient(90deg, var(--success), var(--accent)); border-radius: 4px; transition: width 0.5s;"></div>
                        </div>
                    </div>
                    <div style="margin-left: 20px; text-align: center;">
                        <div style="font-size: 28px; font-weight: 700;">${mastery.mastered}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">已掌握</div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; text-align: center;">
    `;

    const levelNames = ['绿色', '蓝色', '紫色', '金色', '红色'];
    const levelRanges = ['0-2次', '3-5次', '6-10次', '11-20次', '21次+'];
    const levelColors = ['#4caf50', '#2196f3', '#9c27b0', '#ff9800', '#f44336'];

    mastery.levelCounts.forEach((count, idx) => {
        const percent = mastery.total > 0 ? Math.round((count / mastery.total) * 100) : 0;
        html += `
            <div style="padding: 8px; background: var(--bg); border-radius: 6px;">
                <div style="width: 16px; height: 16px; background: ${levelColors[idx]}; border-radius: 50%; margin: 0 auto 4px;"></div>
                <div style="font-size: 12px; font-weight: 600;">${count}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${levelNames[idx]}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${percent}%</div>
            </div>
        `;
    });

    html += `</div></div>`;

    // 学习趋势
    if (trendData && trendData.dailyData.length > 0) {
        html += `
            <div style="margin-bottom: 24px; padding: 16px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-weight: 600; margin-bottom: 12px;">📈 近30天学习趋势</div>
                <div style="display: flex; gap: 16px; margin-bottom: 16px;">
                    <div style="flex: 1; text-align: center; padding: 12px; background: var(--bg); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: 700; color: var(--accent);">${trendData.totalActiveDays}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">活跃天数</div>
                    </div>
                    <div style="flex: 1; text-align: center; padding: 12px; background: var(--bg); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: 700; color: var(--success);">${trendData.avgAccuracy}%</div>
                        <div style="font-size: 12px; color: var(--text-muted);">平均正确率</div>
                    </div>
                    <div style="flex: 1; text-align: center; padding: 12px; background: var(--bg); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: 700; color: var(--error);">${trendData.totalWrong}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">新增错题</div>
                    </div>
                </div>
        `;

        // 正确率趋势图（简化柱状图）
        const dailyData = trendData.dailyData.slice(-14); // 只显示最近14天
        const maxCount = Math.max(...dailyData.map(d => d.total), 1);
        html += `
            <div style="display: flex; align-items: flex-end; gap: 4px; height: 100px; padding: 8px 0; overflow-x: auto;">
        `;
        dailyData.forEach(d => {
            const totalHeight = maxCount > 0 ? (d.total / maxCount) * 100 : 0;
            const correctHeight = d.total > 0 ? (d.correct / d.total) * totalHeight : 0;
            const dateLabel = d.date.slice(5);
            html += `
                <div style="flex: 1; min-width: 24px; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <div style="width: 100%; height: ${Math.max(totalHeight, 2)}%; position: relative; background: var(--error); border-radius: 2px 2px 0 0; overflow: hidden;">
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: ${correctHeight}%; background: var(--success);"></div>
                    </div>
                    <div style="font-size: 9px; color: var(--text-muted); white-space: nowrap;">${dateLabel}</div>
                </div>
            `;
        });
        html += `</div>`;
        html += `<div style="display: flex; gap: 16px; margin-top: 8px; font-size: 12px; justify-content: center;"><span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--success); border-radius: 2px;"></span>正确</span><span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background: var(--error); border-radius: 2px;"></span>错误</span></div>`;
        html += `</div>`;
    }

    // 薄弱知识点TOP10
    if (weakTopics.length > 0) {
        html += `
            <div style="margin-bottom: 24px; padding: 16px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-weight: 600; margin-bottom: 12px;">🔍 薄弱知识点 TOP${Math.min(weakTopics.length, 10)}</div>
        `;
        weakTopics.forEach((topic, idx) => {
            const barWidth = Math.min((topic.count / (weakTopics[0].count || 1)) * 100, 100);
            html += `
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <span style="width: 20px; font-size: 12px; color: var(--text-muted);">${idx + 1}</span>
                    <span style="width: 80px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${topic.name}</span>
                    <div style="flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 0 10px;">
                        <div style="width: ${barWidth}%; height: 100%; background: ${idx < 3 ? 'var(--error)' : idx < 6 ? 'var(--accent)' : 'var(--success)'}; border-radius: 4px;"></div>
                    </div>
                    <span style="width: 30px; text-align: right; font-size: 12px; color: var(--text-muted);">${topic.count}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    // 综合学习建议
    html += `
        <div style="padding: 16px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-weight: 600; margin-bottom: 12px;">💡 综合学习建议</div>
            ${this.generateDetailedSuggestions(mastery, trendData, weakTopics).map(s =>
                `<div style="padding: 10px 12px; margin-bottom: 6px; background: rgba(0,123,255,0.05); border-radius: 8px; font-size: 14px; line-height: 1.5;">• ${s}</div>`
            ).join('')}
        </div>
    `;

    html += `</div>`;
    container.innerHTML = html;
    container.style.display = 'block';
}

WordCollectionApp.prototype.generateDetailedSuggestions = function(mastery, trendData, weakTopics) {
    const suggestions = [];

    if (mastery.overallRate < 30) {
        suggestions.push('词汇掌握度较低，建议从高频核心词汇开始，每天使用快速记忆模式复习50个单词');
    } else if (mastery.overallRate < 60) {
        suggestions.push('词汇掌握度中等，建议加强记忆练习，重点关注蓝色及以下等级的单词');
    } else {
        suggestions.push('词汇基础较好，可以挑战更高难度的阅读和翻译材料');
    }

    if (trendData) {
        if (trendData.avgAccuracy < 50) {
            suggestions.push('近期正确率偏低，建议降低练习难度，先巩固基础再逐步提升');
        } else if (trendData.avgAccuracy < 75) {
            suggestions.push(`近期正确率为${trendData.avgAccuracy}%，有提升空间，建议多回顾错题本`);
        }

        if (trendData.totalActiveDays < 7) {
            suggestions.push('最近学习频率较低，建议制定每日学习计划，保持学习连贯性');
        }
    }

    if (weakTopics.length > 0) {
        suggestions.push(`"${weakTopics[0].name}"是最薄弱的知识点，建议针对性加强练习`);
    }

    suggestions.push('定期使用AI分析错题规律，及时调整学习策略');
    suggestions.push('阅读理解和作文是考研英语的重点，建议每周至少完成2篇阅读练习和1篇作文练习');

    return suggestions;
}

WordCollectionApp.prototype.calculateWordMastery = function() {
    const total = this.words.length;
    const levelCounts = [0, 0, 0, 0, 0];

    this.words.forEach(w => {
        const level = LevelSystem.getLevel(w.correct_count || 0);
        levelCounts[level]++;
    });

    // 已掌握：蓝色及以上（correct_count >= 3）
    const mastered = levelCounts[1] + levelCounts[2] + levelCounts[3] + levelCounts[4];
    const overallRate = total > 0 ? Math.round((mastered / total) * 100) : 0;

    return {
        total,
        mastered,
        overallRate,
        levelCounts,
        levelNames: ['绿色 (初学)', '蓝色 (熟悉)', '紫色 (掌握)', '金色 (精通)', '红色 (巩固)']
    };
}

WordCollectionApp.prototype.analyzeLearningTrend = function(days = 30) {
    const records = JSON.parse(localStorage.getItem('practice_records') || '[]');
    const wrongRecords = JSON.parse(localStorage.getItem('wrong_records') || '[]');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    // 筛选最近N天的记录
    const recentRecords = records.filter(r => r.time && r.time >= cutoffStr);
    const recentWrong = wrongRecords.filter(r => r.createdAt && r.createdAt >= cutoffStr);

    // 按天聚合
    const dailyMap = {};
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyMap[dateStr] = { date: dateStr, total: 0, correct: 0, wrong: 0 };
    }

    recentRecords.forEach(r => {
        const dateStr = r.time.split('T')[0];
        if (dailyMap[dateStr]) {
            dailyMap[dateStr].total++;
            if (r.correct) dailyMap[dateStr].correct++;
            else dailyMap[dateStr].wrong++;
        }
    });

    recentWrong.forEach(r => {
        const dateStr = r.createdAt.split('T')[0];
        if (dailyMap[dateStr]) {
            dailyMap[dateStr].wrong++;
        }
    });

    const dailyData = Object.values(dailyMap);
    const activeDays = dailyData.filter(d => d.total > 0);
    const totalActiveDays = activeDays.length;

    const totalCorrect = recentRecords.filter(r => r.correct).length;
    const totalAttempts = recentRecords.length;
    const avgAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    return {
        dailyData,
        totalActiveDays,
        avgAccuracy,
        totalAttempts,
        totalCorrect,
        totalWrong: recentWrong.length,
        practiceCount: recentRecords.length
    };
}

WordCollectionApp.prototype.getWeakTopicsFromWrong = function(wrongRecords) {
    const topicMap = {};

    wrongRecords.forEach(r => {
        // 从AI分析中提取
        if (r.aiAnalysis?.knowledgePoint) {
            const topic = r.aiAnalysis.knowledgePoint;
            topicMap[topic] = (topicMap[topic] || 0) + 1;
        }
        // 从错误类型中提取
        if (r.aiAnalysis?.errorType) {
            const topic = r.aiAnalysis.errorType;
            topicMap[topic] = (topicMap[topic] || 0) + 1;
        }
        // 从题型中提取
        if (r.type) {
            const typeNames = { practice: '例句练习', reading: '阅读理解', translation: '翻译练习', cloze: '选词填空', memory: '单词记忆' };
            const topic = typeNames[r.type] || r.type;
            topicMap[topic] = (topicMap[topic] || 0) + 1;
        }
        // 从单词中提取
        if (r.word) {
            topicMap[r.word] = (topicMap[r.word] || 0) + 1;
        }
    });

    return Object.entries(topicMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));
}

WordCollectionApp.prototype.addToCollection = function(word) {
    // 复用现有的收藏逻辑，如果已存在则更新
    const existing = this.words.find(w => w.word === word.word);
    if (existing) {
        existing.correct_count = word.correct_count;
        existing.wrong_count = word.wrong_count;
        Storage.saveWords(this.words);
    }
}

WordCollectionApp.prototype.checkMeaningMatch = function(userMeaning, correctMeaning) {
    if (!userMeaning || !correctMeaning) return false;
    const user = userMeaning.toLowerCase().replace(/[，,；;。\.]/g, ' ').trim();
    const correct = correctMeaning.toLowerCase().replace(/[，,；;。\.]/g, ' ').trim();
    return user === correct || correct.includes(user) || user.includes(correct);
}

WordCollectionApp.prototype.speakText = function(text) {
    if (!text) return;
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
    }
}

WordCollectionApp.prototype.getWritingInputText = function() {
    const activePanel = document.querySelector('.writing-input-panel.active');
    if (!activePanel) return '';
    const id = activePanel.id;
    if (id === 'panel-text') {
        return document.getElementById('writing-textarea')?.value.trim() || '';
    } else if (id === 'panel-camera') {
        return document.getElementById('ocr-text')?.value.trim() || '';
    } else if (id === 'panel-file') {
        return document.getElementById('file-text')?.value.trim() || '';
    }
    return '';
}

// ===== 设置按钮外观控制 =====
WordCollectionApp.prototype.toggleSettingsBtnVisibility = function() {
    const checkbox = document.getElementById('btn-hide-settings');
    const btn = document.getElementById('settings-btn');
    if (!checkbox || !btn) return;
    if (checkbox.checked) {
        btn.style.display = 'none';
        localStorage.setItem('ciguang_settings_btn_hidden', 'true');
    } else {
        btn.style.display = 'flex';
        localStorage.removeItem('ciguang_settings_btn_hidden');
    }
}

WordCollectionApp.prototype.setSettingsBtnOpacity = function(value) {
    const btn = document.getElementById('settings-btn');
    const label = document.getElementById('btn-opacity-value');
    if (btn) btn.style.opacity = value;
    if (label) label.textContent = Math.round(value * 100) + '%';
    localStorage.setItem('ciguang_settings_btn_opacity', value);
}

WordCollectionApp.prototype.initSettingsBtnAppearance = function() {
    const hidden = localStorage.getItem('ciguang_settings_btn_hidden') === 'true';
    const opacity = localStorage.getItem('ciguang_settings_btn_opacity');
    const checkbox = document.getElementById('btn-hide-settings');
    const slider = document.getElementById('btn-opacity-settings');
    if (hidden && checkbox) {
        checkbox.checked = true;
        this.toggleSettingsBtnVisibility();
    }
    if (opacity && slider) {
        slider.value = opacity;
        this.setSettingsBtnOpacity(opacity);
    }
}

// ===== 翻译句子拍照上传 =====
WordCollectionApp.prototype.openSentencePhotoDialog = function(idx) {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const status = document.getElementById('sentence-photo-status-' + idx);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (status) status.textContent = '浏览器不支持摄像头';
        return;
    }

    if (status) status.textContent = '正在打开摄像头...';

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            // Create a temporary video element for snapshot
            const tempVideo = document.createElement('video');
            tempVideo.srcObject = stream;
            tempVideo.play();

            // Take photo after a short delay
            setTimeout(() => {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = tempVideo.videoWidth || 640;
                tempCanvas.height = tempVideo.videoHeight || 480;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(tempVideo, 0, 0);

                // Stop stream
                stream.getTracks().forEach(t => t.stop());

                // Process image
                const imageData = tempCanvas.toDataURL('image/jpeg');
                this.processSentencePhoto(idx, imageData);
            }, 800);
        })
        .catch(err => {
            console.error('Camera error:', err);
            if (status) status.textContent = '摄像头打开失败';
        });
}

WordCollectionApp.prototype.handleSentenceFile = function(idx, input) {
    const file = input.files[0];
    const status = document.getElementById('sentence-photo-status-' + idx);
    if (!file) return;
    if (status) status.textContent = '正在识别...';

    const reader = new FileReader();
    reader.onload = (e) => {
        this.processSentencePhoto(idx, e.target.result);
    };
    reader.readAsDataURL(file);
    input.value = '';
}

WordCollectionApp.prototype.processSentencePhoto = function(idx, imageData) {
    const status = document.getElementById('sentence-photo-status-' + idx);
    const textarea = document.getElementById('translation-input-' + idx);

    if (status) status.textContent = '识别中...';

    // Use Tesseract.js for OCR
    if (typeof Tesseract !== 'undefined') {
        Tesseract.recognize(imageData, 'eng', { logger: () => {} })
            .then(result => {
                const text = result.data.text.trim();
                if (textarea) {
                    textarea.value = text;
                    this.translationInputs[idx] = text;
                }
                if (status) status.textContent = '✓ 识别完成';
                setTimeout(() => { if (status) status.textContent = ''; }, 3000);
            })
            .catch(err => {
                console.error('OCR error:', err);
                if (status) status.textContent = '识别失败，请手动输入';
            });
    } else {
        if (status) status.textContent = 'OCR 库未加载';
    }
}

// ===== 拍照提取翻译题目 =====
WordCollectionApp.prototype.extractTranslationTopicByPhoto = function() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('浏览器不支持摄像头功能');
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            const tempVideo = document.createElement('video');
            tempVideo.srcObject = stream;
            tempVideo.play();

            setTimeout(() => {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = tempVideo.videoWidth || 640;
                tempCanvas.height = tempVideo.videoHeight || 480;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(tempVideo, 0, 0);
                stream.getTracks().forEach(t => t.stop());

                const imageData = tempCanvas.toDataURL('image/jpeg');
                this.processExtractTranslationTopic(imageData);
            }, 800);
        })
        .catch(err => {
            console.error('Camera error:', err);
            alert('摄像头打开失败：' + err.message);
        });
}

WordCollectionApp.prototype.processExtractTranslationTopic = function(imageData) {
    const passageEl = document.getElementById('translation-passage');
    if (passageEl) {
        passageEl.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><span>正在识别题目内容...</span></div>';
    }

    if (typeof Tesseract !== 'undefined') {
        Tesseract.recognize(imageData, 'chi_sim+eng', { logger: () => {} })
            .then(result => {
                const text = result.data.text.trim();
                if (text) {
                    this.generateTranslationFromExtractedText(text);
                } else {
                    if (passageEl) passageEl.innerHTML = '<p style="color: var(--text-muted);">未能识别到文字，请重新拍照</p>';
                }
            })
            .catch(err => {
                console.error('OCR error:', err);
                if (passageEl) passageEl.innerHTML = '<p style="color: var(--text-muted);">识别失败，请重试</p>';
            });
    } else {
        if (passageEl) passageEl.innerHTML = '<p style="color: var(--text-muted);">OCR 库未加载</p>';
    }
}

WordCollectionApp.prototype.generateTranslationFromExtractedText = function(text) {
    // 简单解析：按句子分割，生成翻译练习材料
    const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 5);
    const material = {
        title: '拍照提取题目',
        sentences: sentences.slice(0, 5).map((s, i) => ({
            cn: s.trim(),
            keywords: this.extractKeywords(s)
        }))
    };

    // 渲染提取的内容
    const passageEl = document.getElementById('translation-passage');
    if (passageEl) {
        passageEl.innerHTML = `
            <div class="translation-title">📷 拍照提取题目</div>
            <div class="translation-intro">请翻译以下识别出的句子：</div>
        `;
    }

    this.currentTranslationMaterial = material;
    this.translationInputs = {};
    this.renderTranslationSentences(material);
    this.startTimer('translation');
}

WordCollectionApp.prototype.extractKeywords = function(sentence) {
    // 简单提取句子中较长的中文词作为关键词提示
    const words = sentence.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    return words.slice(0, 3);
}

// ===== 季节主题系统 =====
WordCollectionApp.prototype.applySeasonTheme = function(season) {
    this.currentSeason = season;
    
    // 设置body的data-season属性驱动CSS变量切换
    if (season === 'default') {
        document.body.removeAttribute('data-season');
    } else {
        document.body.setAttribute('data-season', season);
    }
    
    // 清除旧粒子容器
    document.querySelectorAll('.season-particles').forEach(el => el.remove());
    
    // 创建粒子效果
    if (season !== 'default') {
        this.createSeasonParticles(season);
    }
    
    // 更新设置弹窗和所有data-season按钮的active状态
    document.querySelectorAll('[data-season]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.season === season);
    });
    
    localStorage.setItem('ciguang_season', season);
}

WordCollectionApp.prototype.createSeasonParticles = function(season) {
    const container = document.createElement('div');
    container.className = 'season-particles';
    container.setAttribute('data-type', season);
    
    if (season === 'summer') {
        // 波浪线
        for (let i = 0; i < 2; i++) {
            const wave = document.createElement('div');
            wave.className = 'wave-line';
            container.appendChild(wave);
        }
        // 浮动光斑
        for (let i = 0; i < 8; i++) {
            const orb = document.createElement('div');
            orb.className = 'glow-orb';
            const size = 40 + Math.random() * 80;
            orb.style.width = size + 'px';
            orb.style.height = size + 'px';
            orb.style.left = Math.random() * 100 + '%';
            orb.style.top = Math.random() * 100 + '%';
            orb.style.animationDelay = (Math.random() * 5) + 's';
            orb.style.animationDuration = (4 + Math.random() * 4) + 's';
            container.appendChild(orb);
        }
    } else if (season === 'spring') {
        for (let i = 0; i < 25; i++) {
            const petal = document.createElement('div');
            petal.className = 'petal';
            petal.style.left = Math.random() * 100 + '%';
            petal.style.animationDuration = (6 + Math.random() * 7) + 's';
            petal.style.animationDelay = Math.random() * 10 + 's';
            const size = 6 + Math.random() * 10;
            petal.style.width = size + 'px';
            petal.style.height = size * 0.7 + 'px';
            const hue = 330 + Math.random() * 40;
            const lightness = 60 + Math.random() * 20;
            petal.style.background = `hsla(${hue}, 80%, ${lightness}%, 0.7)`;
            container.appendChild(petal);
        }
    } else if (season === 'autumn') {
        const emojis = ['🍂', '🍁', '🍃'];
        for (let i = 0; i < 18; i++) {
            const leaf = document.createElement('div');
            leaf.className = 'leaf-particle';
            leaf.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            leaf.style.left = Math.random() * 100 + '%';
            leaf.style.animationDuration = (7 + Math.random() * 9) + 's';
            leaf.style.animationDelay = Math.random() * 12 + 's';
            leaf.style.fontSize = (10 + Math.random() * 8) + 'px';
            container.appendChild(leaf);
        }
    } else if (season === 'winter') {
        for (let i = 0; i < 35; i++) {
            const snow = document.createElement('div');
            snow.className = 'snow';
            snow.style.left = Math.random() * 100 + '%';
            snow.style.animationDuration = (5 + Math.random() * 7) + 's';
            snow.style.animationDelay = Math.random() * 10 + 's';
            const size = 3 + Math.random() * 7;
            snow.style.width = size + 'px';
            snow.style.height = size + 'px';
            snow.style.opacity = (0.3 + Math.random() * 0.5).toString();
            container.appendChild(snow);
        }
    }
    
    document.body.appendChild(container);
}

WordCollectionApp.prototype.initSeasonTheme = function() {
    // 创建氛围光晕（始终存在，由CSS控制opacity）
    let ambient1 = document.querySelector('.season-ambient-1');
    let ambient2 = document.querySelector('.season-ambient-2');
    if (!ambient1) {
        ambient1 = document.createElement('div');
        ambient1.className = 'season-ambient season-ambient-1';
        document.body.appendChild(ambient1);
    }
    if (!ambient2) {
        ambient2 = document.createElement('div');
        ambient2.className = 'season-ambient season-ambient-2';
        document.body.appendChild(ambient2);
    }
    
    // 从localStorage恢复季节
    const saved = localStorage.getItem('ciguang_season');
    if (saved && saved !== 'default') {
        this.applySeasonTheme(saved);
    }
    
    // 绑定设置弹窗中的季节卡片点击
    setTimeout(() => {
        document.querySelectorAll('#season-preset-grid [data-season]').forEach(card => {
            card.addEventListener('click', () => {
                this.applySeasonTheme(card.dataset.season);
            });
        });
    }, 100);
}

// ===== 学习助手Agent =====
WordCollectionApp.prototype.formatStudyTime = function(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
}

WordCollectionApp.prototype.calculateGrowthLevel = function() {
    const stats = this.getAgentStats();
    const xp = stats.totalXP;

    const levels = [
        { name: '初学者', icon: '🌱', minXp: 0, maxXp: 99, color: '#48bb78' },
        { name: '成长者', icon: '🌿', minXp: 100, maxXp: 299, color: '#4a9eff' },
        { name: '进阶者', icon: '🌳', minXp: 300, maxXp: 599, color: '#9f7aea' },
        { name: '熟练者', icon: '⭐', minXp: 600, maxXp: 999, color: '#ecc94b' },
        { name: '词光大师', icon: '🏆', minXp: 1000, maxXp: 99999, color: '#f56565' }
    ];

    let currentLevel = levels[0];
    let nextLevel = levels[1];
    for (let i = 0; i < levels.length; i++) {
        if (xp >= levels[i].minXp && xp <= levels[i].maxXp) {
            currentLevel = levels[i];
            nextLevel = levels[i + 1] || null;
            break;
        }
    }

    const progress = nextLevel
        ? Math.round(((xp - currentLevel.minXp) / (nextLevel.minXp - currentLevel.minXp)) * 100)
        : 100;
    const xpToNext = nextLevel ? nextLevel.minXp - xp : 0;

    return { level: currentLevel, nextLevel, xp, progress, xpToNext, allLevels: levels };
}

WordCollectionApp.prototype.getAgentStats = function() {
    const moduleStats = Storage.getModuleStats();
    const wrongRecords = this.wrongRecords || [];

    // 总答对数
    const totalCorrect = this.words.reduce((sum, w) => sum + (w.correct_count || 0), 0);
    const totalWrong = this.words.reduce((sum, w) => sum + (w.wrong_count || 0), 0);
    const totalAnswers = totalCorrect + totalWrong;
    const accuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;

    // 错题修正次数：错题本中的词现在已掌握（correct_count >= 3）
    const wrongWords = new Set(wrongRecords.map(r => r.word).filter(Boolean));
    let errorCorrections = 0;
    this.words.forEach(w => {
        if (wrongWords.has(w.word) && (w.correct_count || 0) >= 3) {
            errorCorrections++;
        }
    });

    // 练习总数
    const totalExercises = (moduleStats.reading?.passages || 0)
        + (moduleStats.cloze?.passages || 0)
        + (moduleStats.translation?.total || 0);

    // 阅读正确率
    const readingAccuracy = moduleStats.reading && moduleStats.reading.total > 0
        ? Math.round((moduleStats.reading.correct / moduleStats.reading.total) * 100) : 0;

    // 选词正确率
    const clozeAccuracy = moduleStats.cloze && moduleStats.cloze.total > 0
        ? Math.round((moduleStats.cloze.correct / moduleStats.cloze.total) * 100) : 0;

    // 翻译/作文平均分
    const translationScore = moduleStats.translation?.avgScore || 0;

    // 已掌握单词数
    const masteredWords = this.words.filter(w => (w.correct_count || 0) >= 3).length;

    // XP计算
    const totalXP = totalCorrect * 10
        + totalExercises * 5
        + errorCorrections * 15
        + masteredWords * 8
        + (accuracy >= 80 ? 30 : 0);

    return {
        totalCorrect, totalWrong, totalAnswers, accuracy,
        errorCorrections, totalExercises, masteredWords,
        readingAccuracy, clozeAccuracy, translationScore,
        totalStudyTime: this.totalStudyTime || 0,
        wrongCount: wrongRecords.length,
        totalXP
    };
}

WordCollectionApp.prototype.analyzeErrorPatterns = function(wrongItems, exerciseType) {
    if (!wrongItems || wrongItems.length === 0) return null;

    const patterns = {
        reading: {
            vocabulary: 0, detail: 0, mainIdea: 0, inference: 0, grammar: 0
        },
        cloze: {
            vocabulary: 0, grammar: 0, context: 0
        },
        translation: {
            keyword: 0, grammar: 0, expression: 0
        },
        writing: {
            vocabulary: 0, grammar: 0, structure: 0, content: 0
        }
    };

    const typeMap = patterns[exerciseType] || patterns.reading;
    const analysis = { ...typeMap };
    const errors = [];

    wrongItems.forEach(item => {
        if (exerciseType === 'reading') {
            const q = (item.question || '').toLowerCase();
            if (q.includes('main idea') || q.includes('主旨') || q.includes('title') || q.includes('purpose')) {
                analysis.mainIdea++;
                errors.push({ type: 'mainIdea', word: item.word || '' });
            } else if (q.includes('infer') || q.includes('imply') || q.includes('suggest') || q.includes('推断') || q.includes('implies')) {
                analysis.inference++;
                errors.push({ type: 'inference', word: item.word || '' });
            } else if (q.includes('word') || q.includes('meaning') || q.includes('词') || q.includes('replace')) {
                analysis.vocabulary++;
                errors.push({ type: 'vocabulary', word: item.word || '' });
            } else if (q.includes('grammar') || q.includes('语法')) {
                analysis.grammar++;
                errors.push({ type: 'grammar', word: item.word || '' });
            } else {
                analysis.detail++;
                errors.push({ type: 'detail', word: item.word || '' });
            }
        } else if (exerciseType === 'cloze') {
            analysis.vocabulary++;
            errors.push({ type: 'vocabulary', word: item.word || item.correctAnswer || '' });
        } else if (exerciseType === 'translation') {
            if (item.score < 40) {
                analysis.keyword++;
            } else if (item.score < 70) {
                analysis.grammar++;
            } else {
                analysis.expression++;
            }
            errors.push({ type: 'translation', word: '' });
        }
    });

    // 找出最薄弱项
    let maxType = '';
    let maxValue = 0;
    Object.entries(analysis).forEach(([type, count]) => {
        if (count > maxValue) {
            maxValue = count;
            maxType = type;
        }
    });

    const typeNameMap = {
        vocabulary: '词汇理解', detail: '细节定位', mainIdea: '主旨把握',
        inference: '推理判断', grammar: '语法结构', context: '上下文理解',
        keyword: '关键词遗漏', expression: '表达自然度'
    };

    return {
        analysis, errors,
        weakestType: maxType,
        weakestName: typeNameMap[maxType] || maxType,
        totalErrors: wrongItems.length
    };
}

WordCollectionApp.prototype.generateAgentMessage = function(exerciseType, score, correct, total, wrongItems, stats, errorAnalysis) {
    const typeNames = {
        reading: '阅读理解', cloze: '选词填空', translation: '翻译练习', writing: '作文练习'
    };
    const typeName = typeNames[exerciseType] || '练习';
    const allCorrect = correct === total;
    const accuracy = stats.accuracy;

    let message = '';
    let tips = [];

    if (allCorrect) {
        // 全对恭喜
        const congratsMessages = [
            `🎉 太棒了！${typeName}全对！你的努力正在开花结果！`,
            `🌟 完美通关！每一题都答对了，你已经掌握了这些知识点！`,
            `👏 恭喜你！${correct}题全部正确，保持这个状态，继续加油！`,
            `✨ 全对！你的英语水平正在稳步提升，为你骄傲！`
        ];
        message = congratsMessages[Math.floor(Math.random() * congratsMessages.length)];

        if (stats.totalXP >= 300) {
            tips.push(`你已累计获得 ${stats.totalXP} 经验值，距离下一等级只差${this.calculateGrowthLevel().xpToNext}点！`);
        }
        if (accuracy >= 80) {
            tips.push(`整体正确率 ${accuracy}%，你已经是学霸级别了！`);
        }
        if (stats.masteredWords > 0) {
            tips.push(`已掌握 ${stats.masteredWords} 个单词，词汇量稳步增长中！`);
        }
    } else {
        // 有错鼓励
        const correctRate = Math.round((correct / total) * 100);
        const encouragements = [
            `💪 别灰心！这次答对了 ${correct}/${total} 题，每一次练习都是进步！`,
            `🌱 成长需要过程，${correct}/${total} 的正确率说明你已经有了一定基础，继续加油！`,
            `📚 错误是最好的老师，这次做错的题我们一起来分析！`,
            `🔥 坚持就是胜利！你已经完成了 ${stats.totalExercises} 次练习，经验值在不断增加！`
        ];
        message = encouragements[Math.floor(Math.random() * encouragements.length)];

        // 基于错误分析给出建议
        if (errorAnalysis) {
            const adviceMap = {
                vocabulary: '词汇是英语学习的基石，建议每天复习高频词汇，结合例句记忆效果更好',
                detail: '细节题需要精准定位原文，练习时注意圈画关键词，回到原文逐句比对',
                mainIdea: '主旨题要关注文章首尾段和各段首句，把握作者整体意图',
                inference: '推理题要基于原文信息合理推断，避免过度解读或主观臆断',
                grammar: '语法结构是语言框架，建议系统复习从句、非谓语动词等核心语法点',
                context: '上下文理解需要关注逻辑连接词，理清段落间的因果关系',
                keyword: '翻译时注意保留原文关键词，避免遗漏核心信息',
                expression: '表达可以更自然流畅，多读多背优质英文素材培养语感'
            };
            const advice = adviceMap[errorAnalysis.weakestType];
            if (advice) {
                tips.push(`📌 主要薄弱点：${errorAnalysis.weakestName}。${advice}`);
            }
        }

        // 基于历史数据鼓励
        if (stats.errorCorrections > 0) {
            tips.push(`✅ 你已经成功修正了 ${stats.errorCorrections} 个曾经的错题，证明了你的进步能力！`);
        }
        if (accuracy >= 60 && correctRate < accuracy) {
            tips.push(`📈 你的整体正确率是 ${accuracy}%，这次发挥稍有波动，调整心态下次一定更好！`);
        }
        if (stats.totalStudyTime > 0) {
            tips.push(`⏱️ 累计学习 ${this.formatStudyTime(stats.totalStudyTime)}，坚持就是胜利！`);
        }
    }

    return { message, tips };
}

WordCollectionApp.prototype.showAgentFeedback = function(exerciseType, score, correct, total, wrongItems) {
    const stats = this.getAgentStats();
    const errorAnalysis = wrongItems && wrongItems.length > 0
        ? this.analyzeErrorPatterns(wrongItems, exerciseType) : null;
    const { message, tips } = this.generateAgentMessage(exerciseType, score, correct, total, wrongItems, stats, errorAnalysis);
    const growth = this.calculateGrowthLevel();

    this.renderAgentPanel({
        exerciseType, score, correct, total,
        message, tips, stats, growth, errorAnalysis
    });
}

WordCollectionApp.prototype.renderAgentPanel = function(data) {
    let panel = document.getElementById('agent-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'agent-panel';
        panel.className = 'agent-panel';
        document.body.appendChild(panel);
    }

    const { message, tips, stats, growth, score, correct, total, exerciseType } = data;
    const typeNames = {
        reading: '📖 阅读理解', cloze: '📝 选词填空',
        translation: '🌐 翻译练习', writing: '✍️ 作文练习'
    };
    const isAllCorrect = correct === total;

    let tipsHtml = '';
    if (tips && tips.length > 0) {
        tipsHtml = tips.map(t => `<div class="agent-tip">${t}</div>`).join('');
    }

    // 成长等级进度条
    const progressColor = growth.level.color;
    const progressBar = growth.nextLevel
        ? `<div class="agent-progress-bar">
            <div class="agent-progress-fill" style="width:${growth.progress}%;background:${progressColor}"></div>
          </div>
          <div class="agent-progress-text">
            <span>${growth.level.icon} ${growth.level.name}</span>
            <span>距 ${growth.nextLevel.icon} ${growth.nextLevel.name} 还差 ${growth.xpToNext} XP</span>
          </div>`
        : `<div class="agent-progress-bar">
            <div class="agent-progress-fill" style="width:100%;background:${progressColor}"></div>
          </div>
          <div class="agent-progress-text">
            <span>${growth.level.icon} ${growth.level.name}（满级）</span>
            <span>${growth.xp} XP</span>
          </div>`;

    // 迷你统计卡片
    const miniStats = `
        <div class="agent-mini-stats">
            <div class="mini-stat">
                <div class="mini-stat-value">${stats.accuracy}%</div>
                <div class="mini-stat-label">正确率</div>
            </div>
            <div class="mini-stat">
                <div class="mini-stat-value">${stats.masteredWords}</div>
                <div class="mini-stat-label">已掌握</div>
            </div>
            <div class="mini-stat">
                <div class="mini-stat-value">${stats.errorCorrections}</div>
                <div class="mini-stat-label">错题修正</div>
            </div>
            <div class="mini-stat">
                <div class="mini-stat-value">${this.formatStudyTime(stats.totalStudyTime)}</div>
                <div class="mini-stat-label">学习时长</div>
            </div>
        </div>`;

    panel.innerHTML = `
        <div class="agent-header">
            <div class="agent-avatar">${isAllCorrect ? '🎉' : '🤖'}</div>
            <div class="agent-title">
                <div class="agent-name">词光学伴</div>
                <div class="agent-subtitle">${typeNames[exerciseType] || '练习'} · ${correct}/${total} 正确</div>
            </div>
            <button class="agent-close" onclick="document.getElementById('agent-panel').classList.remove('show')">&times;</button>
        </div>
        <div class="agent-body">
            <div class="agent-message ${isAllCorrect ? 'all-correct' : ''}">${message}</div>
            ${tipsHtml ? `<div class="agent-tips">${tipsHtml}</div>` : ''}
            <div class="agent-growth">
                <div class="agent-growth-header">
                    <span>📊 成长等级</span>
                    <span class="agent-xp">${growth.xp} XP</span>
                </div>
                ${progressBar}
            </div>
            ${miniStats}
        </div>
    `;

    // 显示面板（延迟一点让结果先渲染）
    setTimeout(() => {
        panel.classList.add('show');
    }, 600);
}

// ===== 初始化应用 =====
document.addEventListener('DOMContentLoaded', () => {
    window.app = new WordCollectionApp();
    // 初始化认证UI
    updateAuthUI();
    // 初始化设置按钮外观
    setTimeout(() => window.app.initSettingsBtnAppearance(), 500);
});
