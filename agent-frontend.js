/**
 * 词光 - Agent应用前端API客户端
 * 适配Spring AI后端 (端口8081)
 */

const AGENT_API_BASE = 'http://localhost:8081/api/agent';

class AgentClient {
    constructor() {
        this.baseUrl = AGENT_API_BASE;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
            config.body = JSON.stringify(config.body);
        }
        const response = await fetch(url, config);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return response.json();
    }

    // ===== Agent管理 =====
    async listAgents() {
        return this.request('/list');
    }

    // ===== 阅读练习Agent =====
    async generateReading(topic, difficulty = 'medium', wordCount = 500) {
        return this.request('/reading', {
            method: 'POST',
            body: {
                taskType: 'reading',
                content: topic,
                difficulty,
                wordCount,
                parameters: { topic, difficulty, wordCount }
            }
        });
    }

    // ===== 翻译练习Agent =====
    async generateTranslation(direction = 'en-zh', difficulty = 'medium') {
        return this.request('/translation', {
            method: 'POST',
            body: {
                taskType: 'translation',
                difficulty,
                parameters: { direction, difficulty }
            }
        });
    }

    async evaluateTranslation(sourceText, userTranslation, referenceTranslation) {
        return this.request('/translation/evaluate', {
            method: 'POST',
            body: {
                taskType: 'translation-evaluate',
                content: sourceText,
                parameters: { sourceText, userTranslation, referenceTranslation }
            }
        });
    }

    // ===== 选词填空Agent =====
    async generateCloze(topic, difficulty = 'medium') {
        return this.request('/cloze', {
            method: 'POST',
            body: {
                taskType: 'cloze',
                content: topic,
                difficulty,
                parameters: { topic, difficulty }
            }
        });
    }

    // ===== 数据库设计Agent =====
    async designDatabase(requirements) {
        return this.request('/database', {
            method: 'POST',
            body: {
                taskType: 'database-design',
                content: requirements,
                parameters: { requirements }
            }
        });
    }

    // ===== 文档输出Agent =====
    async generateDocument(type, title, content, style = 'academic') {
        return this.request('/document', {
            method: 'POST',
            body: {
                taskType: 'document-output',
                content,
                parameters: { type, title, content, style }
            }
        });
    }

    // ===== 语音Agent =====
    async textToSpeech(text, language = 'zh') {
        return this.request('/voice/tts', {
            method: 'POST',
            body: {
                taskType: 'tts',
                content: text,
                parameters: { text, language }
            }
        });
    }

    async speechToText(audioFile) {
        const formData = new FormData();
        formData.append('file', audioFile);
        return fetch(`${this.baseUrl}/voice/stt`, {
            method: 'POST',
            body: formData
        }).then(r => r.json());
    }

    // ===== 文件接收Agent =====
    async analyzeFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        return fetch(`${this.baseUrl}/file/analyze`, {
            method: 'POST',
            body: formData
        }).then(r => r.json());
    }

    // ===== 作文练习Agent =====
    async generateWriting(topic, difficulty = 'medium') {
        return this.request('/writing', {
            method: 'POST',
            body: {
                taskType: 'writing',
                content: topic,
                difficulty,
                parameters: { topic, difficulty }
            }
        });
    }

    async evaluateWriting(prompt, essay) {
        return this.request('/writing/evaluate', {
            method: 'POST',
            body: {
                taskType: 'writing-evaluate',
                content: essay,
                parameters: { prompt, essay }
            }
        });
    }

    // ===== 批量执行 =====
    async generateStudyPlan(topic, difficulty = 'medium') {
        return this.request('/batch/study-plan', {
            method: 'POST',
            body: {
                taskType: 'study-plan',
                content: topic,
                difficulty,
                parameters: { topic, difficulty }
            }
        });
    }

    // ===== 通用执行 =====
    async executeAgent(agentType, request) {
        return this.request(`/execute/${agentType}`, {
            method: 'POST',
            body: request
        });
    }

    async executeParallel(request) {
        return this.request('/parallel', {
            method: 'POST',
            body: request
        });
    }
}

// 全局实例
const agentClient = new AgentClient();
