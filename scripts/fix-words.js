#!/usr/bin/env node
/**
 * 词库释义修复器
 *
 * 用一份"正确释义"对照表去修复 words_data.js / words_database.json 里损坏的词条。
 * 对照表格式（JSON，键可以是单词，也可以是 id:编号）：
 *   {
 *     "spicy":   "adj. 辛辣的；香的，多香料的",
 *     "id:202":  "vt. 分析；解析；分解"
 *   }
 * 以 "_" 开头的键会被忽略，可用来写注释。
 *
 * 用法：
 *   node scripts/fix-words.js --corrections scripts/words-corrections.json --dry-run
 *   node scripts/fix-words.js --corrections scripts/words-corrections.json
 *   node scripts/fix-words.js --corrections scripts/words-corrections.json --import-db
 *
 * 安全措施：
 *   1. 写文件前先把原文件备份到 scripts/.backup/
 *   2. 写入前会用"无改动重写"自检，确认序列化格式与原文件完全一致，避免把格式改乱
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORDS_JS = path.join(ROOT, 'words_data.js');
const WORDS_JSON = path.join(ROOT, 'words_database.json');
const DEFAULT_DB = path.join(ROOT, 'backend', 'database', 'word_collection.db');
const BACKUP_DIR = path.join(__dirname, '.backup');

// ---------- 读取 / 序列化 ----------

function readWordsJs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const match = src.match(/const\s+EMBEDDED_WORDS\s*=\s*(\[[\s\S]*\])\s*;/);
  if (!match) throw new Error('未能在 ' + file + ' 中定位 EMBEDDED_WORDS 数组');
  return { words: JSON.parse(match[1]), raw: src };
}

/** 还原成与仓库中一致的格式（2 空格缩进 + 结尾分号） */
function serializeWordsJs(words) {
  return 'const EMBEDDED_WORDS = ' + JSON.stringify(words, null, 2) + ';\n';
}

/** 无改动重写自检：确保序列化不会改变原文件（格式/字段顺序一致） */
function assertRoundTrip(file) {
  const { words, raw } = readWordsJs(file);
  const rebuilt = serializeWordsJs(words);
  if (rebuilt !== raw) {
    const rLines = raw.split('\n');
    const bLines = rebuilt.split('\n');
    for (let i = 0; i < Math.max(rLines.length, bLines.length); i++) {
      if (rLines[i] !== bLines[i]) {
        console.error('原文件第 ' + (i + 1) + ' 行与重写结果不一致：');
        console.error('  原: ' + JSON.stringify(rLines[i]));
        console.error('  新: ' + JSON.stringify(bLines[i]));
        break;
      }
    }
    throw new Error('无改动重写自检失败：' + file + ' 的格式与脚本预期不一致，已中止以免改坏文件');
  }
}

function backup(file) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, path.basename(file) + '.' + stamp + '.bak');
  fs.copyFileSync(file, target);
  return target;
}

// ---------- 修复 ----------

function buildIndex(corrections) {
  const byWord = new Map();
  const byId = new Map();
  Object.entries(corrections).forEach(([key, value]) => {
    if (key.startsWith('_')) return;
    if (typeof value !== 'string' || !value.trim()) return;
    if (key.toLowerCase().startsWith('id:')) byId.set(String(Number(key.slice(3))), value.trim());
    else byWord.set(key.trim(), value.trim());
  });
  return { byWord, byId };
}

function applyTo(words, index) {
  const applied = [];
  const usedWords = new Set();
  const usedIds = new Set();
  words.forEach(entry => {
    const byId = index.byId.get(String(entry.id));
    const byWord = index.byWord.get(String(entry.word));
    const next = byId !== undefined ? byId : byWord;
    if (next === undefined) return;
    if (String(entry.meaning) === next) return;
    applied.push({ id: entry.id, word: entry.word, from: entry.meaning, to: next });
    entry.meaning = next;
    if (byId !== undefined) usedIds.add(String(entry.id));
    if (byWord !== undefined) usedWords.add(String(entry.word));
  });
  const missing = [];
  index.byWord.forEach((_v, k) => { if (!usedWords.has(k)) missing.push(k); });
  index.byId.forEach((_v, k) => { if (!usedIds.has(k)) missing.push('id:' + k); });
  return { applied, missing };
}

// ---------- 主流程 ----------

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const importDb = argv.includes('--import-db');
  const ci = argv.indexOf('--corrections');

  if (ci === -1 || !argv[ci + 1]) {
    console.error('用法：node scripts/fix-words.js --corrections <对照表.json> [--dry-run] [--import-db]');
    process.exit(2);
  }
  const correctionsFile = path.isAbsolute(argv[ci + 1]) ? argv[ci + 1] : path.join(process.cwd(), argv[ci + 1]);
  if (!fs.existsSync(correctionsFile)) {
    console.error('对照表不存在：' + correctionsFile);
    process.exit(2);
  }

  const corrections = JSON.parse(fs.readFileSync(correctionsFile, 'utf8'));
  const index = buildIndex(corrections);
  console.log('对照表条目：按单词 ' + index.byWord.size + ' 条，按 id ' + index.byId.size + ' 条');

  // 先做无改动重写自检，确认格式可控
  assertRoundTrip(WORDS_JS);
  console.log('格式自检通过：重写不会改动文件格式');

  const { words } = readWordsJs(WORDS_JS);
  const { applied, missing } = applyTo(words, index);

  console.log('');
  console.log('将修复 ' + applied.length + ' 条：');
  applied.slice(0, 20).forEach(item => {
    console.log('  #' + String(item.id).padStart(5) + ' ' + String(item.word).padEnd(14));
    console.log('        旧: ' + String(item.from).slice(0, 56));
    console.log('        新: ' + String(item.to).slice(0, 56));
  });
  if (applied.length > 20) console.log('  ...（其余 ' + (applied.length - 20) + ' 条略）');

  if (missing.length) {
    console.log('');
    console.log('对照表中未匹配到词条的键（' + missing.length + ' 个）：' + missing.slice(0, 20).join(', '));
  }

  if (dryRun) {
    console.log('');
    console.log('（--dry-run：未写入任何文件）');
    process.exit(0);
  }
  if (applied.length === 0) {
    console.log('');
    console.log('没有需要修改的词条，未写入。');
    process.exit(0);
  }

  // 备份 + 写入
  console.log('');
  console.log('备份 ' + path.basename(WORDS_JS) + ' -> ' + backup(WORDS_JS));
  fs.writeFileSync(WORDS_JS, serializeWordsJs(words), 'utf8');
  console.log('已写入 ' + WORDS_JS);

  if (fs.existsSync(WORDS_JSON)) {
    const jsonWords = JSON.parse(fs.readFileSync(WORDS_JSON, 'utf8'));
    const jsonApply = applyTo(jsonWords, index);
    if (jsonApply.applied.length) {
      console.log('备份 ' + path.basename(WORDS_JSON) + ' -> ' + backup(WORDS_JSON));
      fs.writeFileSync(WORDS_JSON, JSON.stringify(jsonWords, null, 2) + '\n', 'utf8');
      console.log('已写入 ' + WORDS_JSON + '（修复 ' + jsonApply.applied.length + ' 条）');
    }
  }

  if (importDb) {
    const dbFile = fs.existsSync(argv[argv.indexOf('--import-db') + 1] || '')
      ? argv[argv.indexOf('--import-db') + 1]
      : DEFAULT_DB;
    if (!fs.existsSync(dbFile)) {
      console.log('数据库不存在，跳过入库：' + dbFile);
    } else {
      const sqlite3 = require(path.join(ROOT, 'backend', 'node_modules', 'sqlite3'));
      const db = new sqlite3.Database(dbFile);
      let done = 0;
      db.serialize(() => {
        db.run('BEGIN');
        applied.forEach(item => {
          db.run('UPDATE words SET meaning = ? WHERE id = ?', [item.to, item.id], () => {
            if (++done === applied.length) {
              db.run('COMMIT', () => {
                console.log('已同步到数据库：' + dbFile + '（' + done + ' 条）');
                db.close();
              });
            }
          });
        });
      });
    }
  }
}

main();
