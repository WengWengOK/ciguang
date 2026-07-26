/**
 * 将 words_data.js 中的单词数据导入到 SQLite 数据库
 * 运行方式: cd backend && node database/import_words.js
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./db');

async function importWords() {
    console.log('开始导入单词数据...');
    
    // 读取 words_data.js 文件
    const wordsDataPath = path.join(__dirname, '../../words_data.js');
    const wordsContent = fs.readFileSync(wordsDataPath, 'utf-8');
    
    // 提取 JSON 数据
    const jsonMatch = wordsContent.match(/const EMBEDDED_WORDS = (\[.*?\]);/s);
    if (!jsonMatch) {
        console.error('无法从 words_data.js 中提取单词数据');
        return;
    }
    
    const words = JSON.parse(jsonMatch[1]);
    console.log(`共读取到 ${words.length} 个单词`);
    
    // 批量插入
    let inserted = 0;
    const batchSize = 500;
    
    for (let i = 0; i < words.length; i += batchSize) {
        const batch = words.slice(i, i + batchSize);
        
        for (const word of batch) {
            try {
                await run(`
                    INSERT OR REPLACE INTO words (id, word, phonetic, meaning, first_letter, freq, example_en, example_cn)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    word.id,
                    word.word,
                    word.phonetic || '',
                    word.meaning || '',
                    word.first_letter || word.word.charAt(0).toUpperCase(),
                    word.freq || 3,
                    word.example_en || '',
                    word.example_cn || ''
                ]);
                inserted++;
            } catch (err) {
                console.error(`导入单词 ${word.word} 失败:`, err.message);
            }
        }
        
        console.log(`已导入 ${Math.min(i + batchSize, words.length)} / ${words.length} 个单词`);
    }
    
    console.log(`导入完成！成功导入 ${inserted} 个单词`);
}

importWords().catch(console.error);
