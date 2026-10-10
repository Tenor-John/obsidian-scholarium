# 实验记录 schema（v1，唯一权威）

正式实验对象只位于 `Research/Experiments/*.md`。可执行契约是
`tools/schema-objects.js`，创建与正文投影由 `tools/experiment-store.js` 负责。
根目录 `Experiments/` 是 legacy 日期式/图片识别笔记区，不参与 schema-v1 校验。

## 所有新建入口共用的契约

- 手动“新建实验对象”调用 `experiment-store.saveNew()`。
- 织研者的 `scholarium-draft` 与课题模式草稿在 `/v1/drafts/batch` 预览阶段调用
  `experiment-store.canonicalizeBody()`。
- Bridge 生成/覆盖 `uid`、`display_id`、`schema_version`、`project_uid`、时间和 AI 草稿审计字段。
- AI 不得声明 `confidence`，也不得冒充研究者填写
  `data_origin` / `data_recorded_by` / `data_recorded_at`。
- 初次创建时正文统一投影为：实验方案与过程 → 数据来源 → 结果 → 结论。
  创建后，字段级更新必须保留研究者在正文中的自由笔记。

模板标记是 `<!-- scholarium-experiment-template:v1 -->`。缺少标记只表示旧正文或研究者
自定义正文，不是 schema 错误；frontmatter 才是机器契约。

## 目录

```text
Research/
  Experiments/
    EXP-001 实验标题.md
  experiment-index.json       # 可重建索引，不是权威源
```

## 核心字段

| 字段 | 约束 |
|---|---|
| `uid` | UUIDv7；对象关系只引用 uid |
| `display_id` | `EXP-NNN`；人类可读编号，由服务端单调分配 |
| `schema_version` | `1` |
| `type` | `experiment` |
| `created_at` / `updated_at` | ISO 8601 |
| `project_uid` | 已存在 Project 的 UUIDv7 |
| `title` | 非空标题 |
| `tests_hypotheses` | Hypothesis UUIDv7 数组，可为空 |
| `status` | 正常链：`idea` / `designed` / `ready` / `running` / `data_pending` / `analyzing` / `concluded` / `integrated`；审计终态：`invalidated` |
| `result` / `conclusion` | 结构化结果与结论；正文是可读投影 |
| `produced_evidence` | 由本实验结果产生的 Evidence uid 数组 |

可选的方案字段（如 `variables`、`blocked_by`、`estimated_hours`）可以保留在
frontmatter；其值仍须满足 `schema-objects.js` 的通用类型约束。

## 数据来源门禁

`data_origin` 可取 `planned`、`measured`、`simulated`、`imported`、
`demonstration`、`unknown`、`unverifiable`。它是研究者声明，不是 AI 推断：

- `measured` / `imported` 必须同时登记 `raw_data_refs`、
  `data_provenance_note`、`data_recorded_by: user` 和时间。
- `planned` 不能进入 `concluded` / `integrated`。
- 未声明按 `unknown` 处理；不能进入终态或产出 Evidence。
- `unverifiable` 表示研究者已完成追溯但无法核实，不是 `unknown` 的别名；必须记录追溯范围与失败原因，并同时进入 `invalidated`。
- `simulated` 可用于演练但不能进入 `integrated`。

## 生命周期

```text
idea → designed → ready → running → data_pending → analyzing → concluded → integrated
```

状态变更走字段级的 `experiment.transition`，一次只前进一步并保留正文。过程观察走
`experiment.append_note`。`invalidated` 不在普通前进链中：只允许经研究者确认的
`experiment.invalidate_provenance` 事务进入；该事务先写完整恢复快照，再同步清空
Experiment 的 `produced_evidence`、降级来源 Evidence、撤出 Hypothesis 正式关系，
并在三类对象中留下原因历史。从结果创建 Evidence 时，引用的是带哈希的结果块，
而不是正文标题。

## 校验与 legacy 隔离

```bash
node skills/experiment-record/scripts/validate_experiments.js <workspace>
```

校验器复用 `schema-objects.js`，不维护第二套枚举。`Experiments/` 只作为
`legacy.files` 列出：旧模板不会再让正式面板产生 schema 红错，也不会被静默迁移。
迁移必须另做预览、映射课题/假设并由研究者确认。
