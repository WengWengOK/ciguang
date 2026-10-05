#!/usr/bin/env node
/**
 * 词库释义校验器
 *
 * 用途：扫描 words_data.js / words_database.json，找出释义损坏、词性前缀异常、
 *      以及两份词表互相不一致的词条，输出报告，便于修复与防止回归。
 *
 * 用法：
 *   node scripts/validate-words.js                 # 控制台汇总 + 明细
 *   node scripts/validate-words.js --json          # 输出 JSON
 *   node scripts/validate-words.js --out report.csv # 同时导出 CSV
 *   node scripts/validate-words.js --no-fail       # 有问题也返回 0（默认有问题返回 1，可用于 CI）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORDS_JS = path.join(ROOT, 'words_data.js');
const WORDS_JSON = path.join(ROOT, 'words_database.json');

// 词库使用的合法词性前缀
const POS_TAGS = ['n', 'vt', 'vi', 'v', 'adj', 'adv', 'a', 'prep', 'pron',
                  'conj', 'num', 'art', 'aux', 'int', 'det', 'abbr', 'pl'];
const POS_RE = new RegExp('^(' + POS_TAGS.join('|') + ')\\.');
const DOUBLED_DOT_RE = /^[a-z]{1,6}\.\.[\s\u4e00-\u9fa5]/;

// ---------- 读取 ----------

function loadEmbeddedWords(file = WORDS_JS) {
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const match = src.match(/const\s+EMBEDDED_WORDS\s*=\s*(\[[\s\S]*\])\s*;/);
  if (!match) throw new Error('未能在 ' + file + ' 中定位 EMBEDDED_WORDS 数组');
  return JSON.parse(match[1]);
}

function loadJsonWords(file = WORDS_JSON) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------- 检测规则 ----------

/** 去掉括号内的补充说明（如“（等于airplane）”“（名词adverseness，副词adversely）”） */
function stripParens(text) {
  return String(text || '').replace(/（[^）]*）|\([^)]*\)/g, '');
}

/**
 * 检测一条词条的释义问题，返回问题代码数组。
 *  - BAD_POS_PREFIX : 词性前缀不是合法标注（含 nad./nn./vvtt. 这类两种标注被合并的乱码）
 *  - NO_POS_PREFIX  : 完全没有词性前缀
 *  - DOUBLED_DOT    : 前缀出现连续两个点（nn..）
 *  - INTERLEAVED    : 中文之间夹着孤立的小写字母，典型的“两条释义字符交错合并”
 *  - EMPTY_MEANING  : 释义为空
 */
function detectIssues(entry) {
  const issues = [];
  const meaning = String(entry.meaning == null ? '' : entry.meaning);
  const trimmed = meaning.trim();

  if (!trimmed) {
    issues.push('EMPTY_MEANING');
    return issues;
  }

  if (DOUBLED_DOT_RE.test(trimmed)) issues.push('DOUBLED_DOT');

  if (!/^[a-z]{1,6}\./.test(trimmed)) {
    issues.push('NO_POS_PREFIX');
  } else if (!POS_RE.test(trimmed)) {
    issues.push('BAD_POS_PREFIX');
  }

  // 交错检测：去掉括号内容后，仍在中文之间出现 1~4 个小写字母
  const body = stripParens(trimmed);
  if (/[\u4e00-\u9fa5][a-z]{1,4}(?![a-z])/.test(body)) issues.push('INTERLEAVED');

  return issues;
}

// ---------- 主流程 ----------

function collect(entries, source, issues) {
  entries.forEach((entry, index) => {
    const found = detectIssues(entry);
    if (found.length) {
      issues.push({
        source,
        id: entry.id,
        word: entry.word,
        meaning: entry.meaning,
        issues: found
      });
    }
  });
}

function compareFiles(jsWords, jsonWords) {
  if (!jsWords || !jsonWords) return [];
  const byId = new Map(jsonWords.map(w => [w.id, w]));
  const diffs = [];
  jsWords.forEach(w => {
    const other = byId.get(w.id);
    if (other && String(other.meaning || '') !== String(w.meaning || '')) {
      diffs.push({
        id: w.id,
        word: w.word,
        issues: ['CROSS_FILE_DIFF'],
        meaning: `words_data.js: ${w.meaning}  ||  words_database.json: ${other.meaning}`
      });
    }
  });
  return diffs;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const noFail = argv.includes('--no-fail');
  const outIndex = argv.indexOf('--out');
  const outFile = outIndex !== -1 ? argv[outIndex + 1] : null;

  const jsWords = loadEmbeddedWords();
  const jsonWords = loadJsonWords();

  if (!jsWords) {
    console.error('未找到 words_data.js（脚本应放在项目根的 scripts/ 目录下）');
    process.exit(2);
  }

  const issues = [];
  collect(jsWords, 'words_data.js', issues);
  if (jsonWords) collect(jsonWords, 'words_database.json', issues);
  const crossDiffs = compareFiles(jsWords, jsonWords);

  // 统计
  const byIssue = {};
  issues.forEach(item => item.issues.forEach(code => {
    byIssue[code] = (byIssue[code] || 0) + 1;
  }));
  const affectedWords = new Set(issues.map(i => i.source + ':' + i.word)).size;

  const summary = {
    totalInJs: jsWords.length,
    totalInJson: jsonWords ? jsonWords.length : 0,
    entriesWithIssues: issues.length,
    affectedWords,
    byIssue,
    crossFileDiffs: crossDiffs.length
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, issues, crossFileDiffs: crossDiffs }, null, 2));
  } else {
    console.log('==================================================');
    console.log('词库释义校验报告');
    console.log('==================================================');
    console.log('words_data.js       : ' + summary.totalInJs + ' 条');
    console.log('words_database.json : ' + summary.totalInJson + ' 条');
    console.log('有问题的条目        : ' + summary.entriesWithIssues + ' 条（涉及 ' + summary.affectedWords + ' 个词）');
    console.log('两文件释义不一致    : ' + summary.crossFileDiffs + ' 条');
    console.log('');
    console.log('按问题类型统计：');
    Object.entries(byIssue).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => {
      console.log('  ' + code.padEnd(16) + count);
    });
    console.log('');
    console.log('问题词条样例（words_data.js）：');
    issues.filter(i => i.source === 'words_data.js').slice(0, 15).forEach(i => {
      console.log('  #' + String(i.id).padStart(5) + ' ' + String(i.word).padEnd(14) +
        '[' + i.issues.join(',') + ']  ' + String(i.meaning).slice(0, 42));
    });
    console.log('');
    console.log('==================================================');
  }

  if (outFile) {
    const rows = [['source', 'id', 'word', 'issues', 'meaning']];
    issues.forEach(i => rows.push([i.source, i.id, i.word, i.issues.join('|'), i.meaning]));
    crossDiffs.forEach(i => rows.push(['cross-file', i.id, i.word, 'CROSS_FILE_DIFF', i.meaning]));
    const csv = rows.map(r => r.map(cell => '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"').join(',')).join('\n');
    const outPath = path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, '\ufeff' + csv, 'utf8');
    console.log('明细已导出：' + outPath);
  }

  const hasProblems = issues.length > 0 || crossDiffs.length > 0;
  process.exit(hasProblems && !noFail ? 1 : 0);
}

main();
