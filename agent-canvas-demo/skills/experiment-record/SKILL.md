---
name: experiment-record
description: Validate and index canonical schema-v1 Experiment objects under Research/Experiments. Reports legacy Experiments/ notes separately without treating their old frontmatter as schema errors; never rewrites notes.
---
# Experiment Record

```bash
node scripts/validate_experiments.js <workspace>
```

## 它在闭环里的位置

这个 skill 把 `Research/Experiments/*.md` 的 schema-v1 frontmatter 读成结构化状态，
写到可重建的 `Research/experiment-index.json`，供课题状态、绘图和分析入口使用。

完整字段定义见仓库根目录的 `EXPERIMENT_SCHEMA.md`。

## 只报错，不修改

frontmatter 是双向契约；正文模板只用于让新记录的阅读结构一致，不是合法性条件。
旧正文或研究者自由修改过的正文只产生兼容性提示，不产生 schema 错误。

同理，任何更新实验记录的 Agent 都**不允许**用「重新生成整个笔记」的方式写入。

## 校验规则

错误完全复用 `tools/schema-objects.js` 的 schema-v1 校验，包括 UUIDv7、
`display_id`、时间、课题/假设引用、生命周期和数据来源门禁；不再维护第二份字段枚举。

**警告**（不阻断）：

- 正文未带当前 `scholarium-experiment-template` 版本标记。记录仍然可读，且不会因为
  标题或小节不同而报错；只有今后的新建记录会统一模板。

## 输出

```json
{
  "count": 3, "valid": true, "error_count": 0,
  "by_status":  {"concluded": 1, "designed": 2},
  "by_data_origin": {"measured": 1, "unknown": 2},
  "experiments": [{
    "display_id": "EXP-001", "status": "concluded",
    "tests_hypotheses": [...], "data_origin": "measured",
    "produced_evidence": [...], "raw_data_refs": [...],
    "errors": [], "warnings": []
  }]
}
```

同时落盘到 `Research/experiment-index.json`。

## `Experiments/` 的边界

根目录 `Experiments/` 是旧的日期式/图片识别笔记区。它会以 `legacy.files` 列出，
但不会进入 schema-v1 项目状态，也不会因旧字段不同制造红色错误。迁移必须另做预览与
人工确认；本 skill 不自动搬运或改写任何旧笔记。
