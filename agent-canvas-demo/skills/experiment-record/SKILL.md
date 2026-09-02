---
name: experiment-record
description: Validate and index the researcher's experiment notes under Experiments/, turning hand-written frontmatter into a machine-readable state file that later steps (project-status, plotting, analysis) can consume. Reports schema violations; never rewrites the notes.
---
# Experiment Record

```bash
python scripts/validate_experiments.py <workspace>
```

## 它在闭环里的位置

`deep-research` 的 `next_actions` 完全从文献推导，做完实验也不会变。这个 skill 是那条
**反向箭头**的第一段：把 `Experiments/**/experiment.md` 里人写的 frontmatter 读成结构化
状态，写到 `Research/experiment-index.json`，供 `project-status` 与假设、文献证据对齐。

完整字段定义见仓库根目录的 `EXPERIMENT_SCHEMA.md`。

## 只报错，不修改

frontmatter 是双向契约：Agent 可以做**字段级**写入，研究者可以手改，正文完全归研究者。
校验器因此只输出错误，不自动修正——擅自改写会破坏「正文和字段都归你」这个前提，
而实验记录里最有价值的往往正是那些非结构化的过程观察。

同理，任何更新实验记录的 Agent 都**不允许**用「重新生成整个笔记」的方式写入。

## 校验规则

**错误**（`valid: false`）：

- 缺 `type` / `id` / `title` / `status` / `created_at` / `updated_at`
- `id` 不符合 `EXP-\d{3}`，或与目录名前缀不一致
- `status` / `outcome` 不在枚举内
- `status: done` 但 `outcome` 仍是 `pending`，或 `conclusion` 为空
- `status: abandoned` 但没写放弃原因

最后两条是这个 schema 存在的主要理由：一个「已完成」却没有裁决的实验，
在看板上像是有进展，实际对它要检验的假设没有任何贡献。

**警告**（不阻断）：

- 闭环字段（`hypothesis_id` / `hypothesis` / `predicts` / `falsified_if` / `outcome`）为空
  —— 这条实验无法参与 `project-status` 的对齐
- `data_raw` / `data_processed` / `figures` 里的路径不存在
- 非 `planned` 状态却没声明自变量 —— 严谨性检查退化为只看 `outcome`

## 输出

```json
{
  "count": 3, "valid": true, "error_count": 0,
  "by_status":  {"done": 1, "planned": 2},
  "by_outcome": {"inconclusive": 1, "pending": 2},
  "experiments": [{
    "id": "EXP-001", "status": "done", "hypothesis_id": "H1",
    "outcome": "inconclusive", "conclusion": "...",
    "data_processed": [...], "figures": [...],
    "linked_evidence": [...], "linked_records": [...],
    "next_actions": [...], "blocked_by": [...],
    "errors": [], "warnings": []
  }]
}
```

同时落盘到 `Research/experiment-index.json`。

## 边界

- 不解析正文，不读数据文件内容，不画图。
- 不创建实验目录（那是 `experiment-planner` 的事，尚未实现）。
- YAML 解析器是为本 schema 的扁平结构手写的（标量、行内 `{}` / `[]`、`- ` 列表、
  `>` 块标量）。项目不依赖 PyYAML；读不了的结构会报成校验错误而不是崩溃。
