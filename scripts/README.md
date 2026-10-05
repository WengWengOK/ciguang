# 词库校验与修复脚本

`words_data.js` / `words_database.json` 里的部分词条释义存在两类损坏：

1. **字符交错合并** —— 相邻两条释义被逐段交织成一个字符串，例如
   `sphere -> "nad. 范j. 辛围辣；的球；体香的，多香料的；下流"`
   （其实是 `n. 范围；球；体` 与 `adj. 辛辣的；香的，多香料的；下流` 交织在一起）
2. **释义错位 / 截断** —— 释义串到了别的词上，例如 `body -> "水桶；铲斗；一桶的量"`、
   `bizarre -> "等）"`、`analyze -> "任何人；任何一个"`

这类损坏在本仓库的 git 历史里**从初始提交就存在**，`words_database.json` 比
`words_data.js` 更旧、更不完整，所以仓库内没有可用来还原的干净副本。

## 1. 校验

```bash
node scripts/validate-words.js
node scripts/validate-words.js --out reports/words-corruption-report.csv
node scripts/validate-words.js --json
```

检测规则：

| 代码 | 含义 |
|------|------|
| `BAD_POS_PREFIX` | 词性前缀非法（含 `nad.` `nn.` `vvtt.` 这类两种标注被合并的乱码） |
| `NO_POS_PREFIX` | 完全没有词性前缀 |
| `DOUBLED_DOT` | 前缀出现连续两个点（`nn..`） |
| `INTERLEAVED` | 中文之间夹着孤立小写字母，典型的交错合并特征 |
| `EMPTY_MEANING` | 释义为空 |
| `CROSS_FILE_DIFF` | 两个词表文件对同一条目的释义不一致 |

默认发现问题时退出码为 1，可以直接挂到 CI 或 pre-commit 上防回归；
只想看报告不想失败时加 `--no-fail`。

## 2. 修复

准备一份正确释义对照表（参考 `words-corrections.example.json`）：

```json
{
  "spicy": "adj. 辛辣的；香的，多香料的",
  "id:202": "vt. 分析；解析；分解"
}
```

先空跑确认改动范围，再落盘：

```bash
node scripts/fix-words.js --corrections scripts/words-corrections.json --dry-run
node scripts/fix-words.js --corrections scripts/words-corrections.json
node scripts/fix-words.js --corrections scripts/words-corrections.json --import-db
```

安全措施：

- 写入前先做**无改动重写自检**，确认序列化格式与原文件逐字节一致，否则中止（不会改乱格式）
- 覆盖前把原文件备份到 `scripts/.backup/`
- `--import-db` 会把修复同步进 `backend/database/word_collection.db`，否则需要重跑
  `npm run import-words`

## 3. 修复后

```bash
node scripts/validate-words.js          # 复验
cd backend && npm test                  # 回归测试
```
