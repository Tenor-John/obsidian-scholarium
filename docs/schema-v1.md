# Scholarium Schema v1 · ID 注册表与首闭环对象定义

> 状态：**ID 规则与 13 类前缀已冻结**；6 类首闭环对象的字段 schema 已冻结；其余 7 类仅保留注册位。
> 版本：`schema_version: 1` · 2026-08-09
> 变更本文件需走 PR，并附带迁移脚本与守恒校验（见 §7）。
>
> 修订记录 · 2026-08-12：§4.4 追加本地 PDF 存根 Paper 的可选字段；新增 §6.1 本地 PDF 定位变体（随 PR #71–#73 的实现补记，不改变既有冻结项）。

---

## 1. 为什么先冻结 ID 而不是字段

当前 `projectId` 就是文件夹名。改名、导入、复制 Vault 都会让全部关系断裂——这是**已经存在**的缺陷，不是假想风险。

反过来，为尚不存在的对象设计字段，冻结出来的多半是错的。所以本文件做两件不同强度的事：

| | 强度 | 范围 |
|---|---|---|
| ID 规则与前缀 | **冻结** | 全部 13 类 |
| 字段 schema | **冻结** | 仅 6 类首闭环对象 |
| 字段 schema | 不预设 | 其余 7 类，仅保留注册位与扩展契约 |

---

## 2. 双 ID 规则（冻结）

每个对象同时持有两个标识符，**职责严格分离**：

```yaml
uid: 01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b   # 机器真 ID
display_id: HYP-003                          # 人类可读编号
```

### 2.1 `uid` — 不可变机器 ID

- 格式：**UUIDv7**（RFC 9562）
- 生成：`crypto.randomUUID()` 不保证 v7；须使用显式 v7 生成器（48 位毫秒时间戳 + 版本位 + 随机位）
- **一经写入永不改变**：改名、移动文件、重命名文件夹、跨 Vault 导入、复制课题，`uid` 都不变
- **所有关系只引用 `uid`**，不引用 `display_id`、不引用文件路径、不引用标题

选 UUIDv7 而非 v4 的理由：v7 前缀按时间单调递增，索引与排序有局部性；同时保留全局唯一性，跨 Vault 合并不会冲突。

### 2.2 `display_id` — 可读编号

- 格式：`<前缀>-<序号>`，如 `HYP-003`
- **仅用于展示与人类口头引用**
- 在一个 Vault 内全局唯一；按类型高水位单调分配，不填补空号
- 对象删除或无法恢复后，原编号进入 Decision 的 `retired_display_ids`，不得再次分配
- **任何代码路径都不得以 `display_id` 作为查找键**

### 2.3 冲突与导入

- 导入时遇到已存在的 `uid` → 视为同一对象，走合并流程，**不重新生成**
- 缺失 `uid` 的历史文件 → 迁移时补写，并在 `uid_assigned_at` 记录补写时间
- 导入时 `display_id` 冲突 → 自动分配高水位后的新编号，不影响任何 uid 关系；原编号写入迁移审计

---

## 3. 13 类一级对象注册表（冻结）

| # | 对象 | 前缀 | 字段 schema | 说明 |
|---|---|---|---|---|
| 1 | Project | `PRJ` | **已冻结** | 研究主对象 |
| 2 | Question | `Q` | **已冻结** | 科学问题 |
| 3 | Hypothesis | `HYP` | **已冻结** | 可检验假设 |
| 4 | Paper | `PAPER` | **已冻结** | 文献 |
| 5 | Evidence | `EVD` | **已冻结** | 证据 |
| 6 | Experiment | `EXP` | **已冻结** | 实验 |
| 7 | Claim | `CLM` | 仅注册 | 科学主张 |
| 8 | Decision | `DEC` | 仅注册 | 科研决策 |
| 9 | Problem | `PRB` | 仅注册 | 阻塞 / 科研债务 |
| 10 | Method | `MTH` | 仅注册 | 科研方法 |
| 11 | Protocol | `SOP` | 仅注册 | 实验流程 |
| 12 | Asset | `AST` | 仅注册 | 原始资产 |
| 13 | AgentRun | `RUN` | 仅注册 | Agent 审计记录 |

前缀不得复用、不得更改。新增对象类型须走 PR 追加，不得占用已有前缀。

### 3.1 已裁决：文献总结不设一级对象

盘点发现 20 篇「文献总结 / LitReview」笔记在注册表中无处安放。**裁决：不新增 `NOTE` 一级对象。**

理由：它们是 Paper 的**衍生人类知识层**，不应为此仓促扩充冻结注册表。首轮迁移**原位保留**其 Markdown 与关联路径，不写成 schema 对象。待出现明确的检索、版本或独立关系需求时再重议。

清单中它们取 `exclude` 终态，`reason: derived_knowledge_layer_retained_in_place_no_v1_object_type`，并带 `retained_in_place: true`。**此处 `exclude` 意为「不迁移」，绝不意为「丢弃」。** 不用 `candidate` 是因为该状态定义为「进入人工归类队列」，而此事已裁决，用 `candidate` 会把已决之事错报为悬而未决。

---

## 4. 六类首闭环对象字段（冻结）

通用字段，**每个对象都必须有**：

```yaml
uid: <uuidv7>
display_id: <PREFIX-NNN>
schema_version: 1
type: project | question | hypothesis | paper | evidence | experiment
created_at: <ISO8601>
updated_at: <ISO8601>
```

### 4.1 Project

```yaml
title: string                    # 必填
thesis: string                   # 一句话核心命题
stage: string                    # 当前阶段
status: active | paused | archived
active_hypothesis_uids: [<uuidv7>] # 正式关系；一律引用 Hypothesis.uid
legacy_hypothesis_summaries: [string] # 兼容 profile v2 的摘要，不得作为关系查找键
current_problems: [string]       # 当前真正卡住的地方
methods_needed: [string]         # 想做但还没做/还不会的方法
excluded_topics: [string]        # 明确不关心的方向，命中则降权
primary_system: string
secondary_system: string
wavelengths: [string]
next_gate: string
tags: [string]
```

> `legacy_hypothesis_summaries` 等摘要字段已在 profile v2 落地。迁移后，文献雷达的正式关系锚点是 `active_hypothesis_uids`；旧摘要仅供兼容展示，不能参与关系查询或写回。

### 4.2 Question

```yaml
project_uid: <uuidv7>            # 必填
statement: string                # 必填
status: open | partial | answered | blocked | abandoned
best_answer_so_far: string
missing_evidence: [string]
related_hypotheses: [<uuidv7>]
```

### 4.3 Hypothesis

```yaml
project_uid: <uuidv7>            # 必填
statement: string                # 必填，必须是可证伪的陈述句
status: proposed | plausible | supported | challenged | rejected | superseded
confidence: 0.0-1.0              # 仅人工设定
confidence_set_by: user          # AI 只能提交建议草案
supporting_evidence: [<uuidv7>]
contradicting_evidence: [<uuidv7>]
assumptions: [string]
alternative_explanations: [string]
required_tests: [string]
next_test: <uuidv7>              # Experiment
history: [{at, from_status, to_status, from_conf, to_conf, cause_uid, by}]
```

**约束**：`confidence` 字段只接受人工写入。AI 产出一律落在草案区，经确认后才更新，并在 `history` 记录 `cause_uid`。

### 4.4 Paper

```yaml
title: string
source: url
doi: string
journal: string
year: number
authors: [string]
keywords: [string]
projects: [<uuidv7>]             # 一篇 Paper 可关联 0~N 个 Project，不复制
source_raw_sha256: string        # 见 §6
source_clean_sha256: string
markdown_source: rendered_dom | http_response | none
# 以下为本地 PDF 存根 Paper 的可选字段（2026-08-12 追加，见 §6.1）
source_kind: local_pdf_sidecar     # 仅当 Paper 是本地 PDF 的存根时存在
source_pdf_path: string            # PDF 的 Vault 相对路径
source_pdf_sha256: string          # PDF 字节的 SHA-256
source_pdf_sidecar_path: string    # 锚点 sidecar 的 Vault 相对路径
bibliographic_status: doi_only     # 书目信息尚未人工补全
```

### 4.5 Evidence

```yaml
claim: string                    # 常规 Evidence 必填；仅检索候选见 candidate_only
source_type: paper | experiment | asset
source_uid: <uuidv7>             # 必填；分别指向 Paper / Experiment / Asset
target_uid: <uuidv7>             # 指向 Hypothesis / Question
relation: SUPPORTS | CONTRADICTS | QUALIFIES | REPLICATES | FAILS_TO_REPLICATE | DEPENDS_ON
strength: 0-5
limitations: string
conditions: string
created_by: user | ai
verified_by_user: false          # 默认 false
verified_at: <ISO8601>
review_status: pending | confirmed | rejected | demonstration
rejection_reason: string         # rejected 时必填；记录为何此引文不构成该关系
rejected_at: <ISO8601>           # rejected 时必填
rejected_by: user
demonstration_reason: string     # demonstration 时必填；记录为何仅保留为流程演示
demonstrated_at: <ISO8601>       # demonstration 时必填
demonstrated_by: user
candidate_only: true             # 仅限 created_by: ai、pending/rejected：出处已定位但尚未形成科研主张
ai_review:                       # 可选：Agent 的可编辑建议，不是人工确认
  decision: confirm | reject | uncertain
  relation: <同上；仅 decision=confirm 时必填>
  claim: string                  # 仅 decision=confirm 时必填
  reason: string                 # 引用与假设匹配/不匹配的具体理由
  target_uid: <uuidv7>
  model: string
  reviewed_at: <ISO8601>
  prompt_sha256: string
locator:                         # 见 §6，四项缺一不可
  source_sha256: string
  anchor: string
  quote_hash: string
  original_url: url
```

**约束**：`verified_by_user: false` 的 Evidence **不得**进入正式 Research State，只能作为候选展示。`candidate_only: true` 的候选不得写入占位 `claim`，也不得直接确认；AI 初审或研究者必须先形成可核对的主张、删除该标记，之后才可确认。这样“检索命中”不会冒充科研命题。

**审核状态（v1 追加并冻结）**：`pending` 表示尚未由研究者审核；`confirmed` 必须同时有 `verified_by_user: true` 与 `verified_at`；`rejected` 必须保持 `verified_by_user: false`，并记录 `rejection_reason`、`rejected_at` 和 `rejected_by`。驳回不是“未处理”：它是研究者对“该出处与该目标/关系不成立”的可读判断，不能进入 Hypothesis 的正式支持或反驳数组。`demonstration` 仅能由研究者将来源已明确声明为 `data_origin: simulated` 的 Experiment Evidence 显式改写：它保留定位、主张和原因审计，但必须保持 `verified_by_user: false`，同时退出 Hypothesis 的正式支持/反驳数组以及来源 Experiment 的 `produced_evidence`。这不是驳回，也不得再次进入待审队列。旧 Evidence 缺少 `review_status` 时，为兼容读取按 `verified_by_user` 推断为 `pending` 或 `confirmed`；所有新 Evidence 必须显式写入该字段。

**Agent 边界**：Agent 可以创建 `created_by: ai`、`review_status: pending` 的候选，并可写入 `ai_review` 提供采纳/驳回/不确定建议及理由；不得自动改为 `confirmed`、`rejected` 或 `demonstration`，也不得自动写入或移出正式支持/反驳关系。研究者可修改建议后点击采纳；此点击才会完成确认或驳回。这样驳回记录既防止同一无关段落反复入队，也构成后续评估候选精确率的标注信号。

**检索词包工件**：`Research/QueryPacks/` 中的 `artifact: evidence_query_expansion` 文件不是新的科研对象类型，也不修改 Hypothesis 的冻结字段。它记录 LLM 提出的英文检索短语、生成器、时间与提示词哈希；正常词包的每个 `concept_group` 必须显式标为 `required: true|false`，至少一组必需、至少一组可选：候选必须命中全部必需组，并命中至少一组可选组。LLM 格式失败时的确定性回退不猜测哪组最关键，而将所有从假设文字安全识别出的实体/条件都设为必需，宁可返回零候选。每个由该词包产生的 AI Evidence 都以 `retrieval_matched_terms`、`retrieval_matched_phrases`、`retrieval_matched_concept_groups`、`retrieval_matched_required_concept_groups`、`retrieval_matched_optional_concept_groups` 与 `retrieval_query_pack_path` 记录可追溯依据。词包仅影响候选召回，不能决定 `relation`、不能确认 Evidence。

> 数据集、图像和图表在 v1 中均通过 `Asset` 引用；不得使用没有注册 `uid` 的 `dataset` 或 `figure` 对象类型。

### 4.6 Experiment

```yaml
title: string                     # 必填；实验记录的人类可读标题（首次实现时追加并冻结）
project_uid: <uuidv7>            # 必填
tests_hypotheses: [<uuidv7>]     # 本实验测试哪些假设
status: idea | designed | ready | running | data_pending | analyzing | concluded | integrated | invalidated
result: string
conclusion: string               # 进入 concluded 前必填
produced_evidence: [<uuidv7>]
method_uid: <uuidv7>
protocol_uid: <uuidv7>
data_origin: planned | measured | simulated | imported | demonstration | unknown | unverifiable
raw_data_refs: [string]          # 仪器原始文件、Vault 相对路径、受控数据仓库 DOI/URL 等审计入口；不是对象关系
data_provenance_note: string     # 样品、仪器/批次、导入范围或模拟假设的简要说明
data_recorded_by: user           # Agent 不得把模拟或推断声明成实测
data_recorded_at: <ISO8601>
invalidation_reason: string      # status=invalidated 时必填
invalidated_at: <ISO8601>        # status=invalidated 时必填
invalidated_by: user             # 只能由研究者确认
```

**数据来源约束（2026-08-14 追加并冻结）**：新建或主动编辑的 Experiment 必须声明 `data_origin`；旧记录缺失该字段时只按“遗留 / 未声明”读取，绝不反推为实测。`measured` 与 `imported` 必须至少给出一条 `raw_data_refs` 和非空的 `data_provenance_note`；`simulated` 也必须说明模拟假设。`raw_data_refs` 是人工复核入口，**不是**对象关系，因此不能替代 `uid` 引用。`planned` 不得进入 `concluded` 或 `integrated`；`simulated` 可用于流程演练和待确认 Evidence，但不得进入 `integrated`，从而不会被表示为已由实测整合的科研结论。

**追溯失败与失效（2026-09-09 追加）**：`unknown` 表示来源尚未由研究者判定；`unverifiable` 表示研究者已经完成追溯，但在记录的检查范围内仍无法核实来源。后者必须填写 `data_provenance_note`，且只允许和 `status: invalidated` 同时出现。`invalidated` 不属于正常单向生命周期，不能用 `experiment.transition` 进入；必须通过确认门禁后的 provenance 失效事务，同步撤出该实验产生的 Evidence 与 Hypothesis 正式关系，并在写入前留下可恢复快照。即便来源原先声明为 `measured` 或 `imported`，一旦实验为 `invalidated`，也不再是 evidence-grade。

**生命周期约束**：`status` 进入 `concluded` 前 `conclusion` 必填；进入 `integrated` 前 `produced_evidence` 必须非空，并满足上述数据来源约束。`invalidated` 必须记录 `invalidation_reason`、`invalidated_at`、`invalidated_by: user`，且 `produced_evidence` 必须为空。

---

## 5. 其余 7 类的扩展契约

仅冻结三件事，其余留空：

1. 必须有 `uid`（UUIDv7）与注册表中的 `display_id` 前缀
2. 必须有 `schema_version`
3. 关系一律引用 `uid`

**不预设**任何业务字段。首次实现时通过 PR 追加，追加即冻结。

### 5.1 Decision / Lesson 的历史引用边界（2026-09-09 补记）

Decision 与 Lesson 已进入实际使用后，出现了两类不能伪装成活对象关系的来源：已按决策删除的验收对象，以及 `Research/_runs/` 中的时间块/动作审计。它们使用以下专用字段：

```yaml
retired_object_uids: [<uuidv7>]       # 已删除或不可恢复对象的原 uid；仅作墓碑，不参与关系解析
retired_display_ids: [EXP-007]        # 与上述墓碑对应的旧展示编号；参与分配保留，不参与关系解析
audit_refs: [<vault-relative path>]   # 仅允许 Research/_runs/actions、queue-archive、recovery 下的文件
```

`relates_to` 与 `evidence_refs` 仍然只表示当前可解析的 schema 对象关系，校验时必须存在。Lesson 的依据可以是非空 `evidence_refs`，也可以是非空 `audit_refs`；二者不得同时为空。迁移旧记录时不得为了消除红错删除历史 uid，也不得把运行记录虚构成一级对象：应将失效 uid 移入 `retired_object_uids`，并尽量登记可复核的 `audit_refs`。

---

## 6. 证据定位契约（冻结）

Evidence 的 `locator` 四项**缺一不可**：

| 字段 | 作用 |
|---|---|
| `source_sha256` | 锁定到哪一次抓取的哪一份字节 |
| `anchor` | `source.clean.html` 中的 `data-sch-anchor` 值 |
| `quote_hash` | 该锚点归一化文本的哈希，DOM 漂移后仍可重定位 |
| `original_url` | 人工复核入口 |

**禁止**以出版社 CSS selector 或 XPath 作为定位依据——它们会随改版失效。

### 6.1 本地 PDF 定位变体（2026-08-12 追加）

当 Evidence 的来源不是网页归档、而是 Vault 内的 PDF 时，`locator` 四项映射为：

| 字段 | 本地 PDF 取值 |
|---|---|
| `source_sha256` | PDF 文件字节的 SHA-256 |
| `anchor` | 锚点 sidecar 中的文本块 id（`p0001` 形态） |
| `quote_hash` | 该块归一化文本的哈希，规则与 HTML 锚点一致 |
| `original_url` | DOI 落地页 `https://doi.org/<doi>` |

**无 DOI 的 PDF 不得作为 Evidence 来源**：没有权威复核入口的定位是断链。此类 PDF 的 sidecar 记为 `evidence_locator_status: missing_original_url`，在人工补全 DOI 前不进入候选检索；脚本不得猜测或编造 DOI。

锚点 sidecar（`.scholarium/pdf-sidecars/<source_sha256>.json`）是**可重建索引**：不是 schema 对象、不是证据。它由 `tools/pdf-anchor-sidecar.js` 经 `pdftotext` 提取生成，写入前必须通过守恒校验；同一份 PDF 字节重算必须得到同一组块 id 与哈希，否则拒绝写入。PDF 本体类比 `source.raw.html`——不可重建，不得删除。

PDF 只有在研究者显式创建待确认 Evidence 时，才注册为 §4.4 的存根 Paper（`source_kind: local_pdf_sidecar`），Evidence 的 `source_uid` 指向该存根；sidecar 本身永远不做 `source_uid`。

### 6.2 实验来源定位变体（2026-08-12 追加）

§4.5 从冻结起就允许 `source_type: experiment`，但 §6 的四项全部是为网页归档写的。结果是**整条 Hypothesis → Experiment → Evidence 链在契约层被堵死**——不是代码没写，是「暗态对照下 CO 产率未上升」这种结论根本无法表达。四项仍然缺一不可，改变的只是它们指向什么：

| 字段 | 实验来源取值 |
|---|---|
| `source_sha256` | 取证时该实验记录正文的归一化哈希 |
| `anchor` | 实验记录内的块 id（如 `r0003` 指某次运行或某项测量） |
| `quote_hash` | 该块归一化文本的哈希，规则与 HTML/PDF 锚点一致 |
| `original_url` | `scholarium://experiment/<experiment uid>` |

**`source_sha256` 的理由在这里发生了一次有启发的转向。** 对论文，它锁定的是**我们控制不了的字节**，防的是出版社改版后引文悄悄挪位。对实验，它锁定的是**我们自己的记录在取证那一刻的样子**——因为研究者一定会继续修改实验记录，而**建立在已被推翻的结果之上的结论，和指向重渲染页面的引用一样是断的**。同一条保证，防的是不同的风险。

**`original_url` 不得使用 Vault 路径。** §2.1 拒绝以路径作为关系锚点，正是因为改名会打断它；一个改名即失效的复核入口，并不比断链的引文更好。uid 不会移动。

`original_url` 中的 uid 必须与 `source_uid` 一致——两者不一致意味着这条证据自称出自某个实验，复核入口却指向另一个。

**不新增 `Result` 对象类型。** §3 的 13 类里没有 Result，也不应为此扩充：实验结论存于 §4.6 的 `result` 字段，正式证据通过 `produced_evidence` 与 `source_uid` 双向连接。这与文献总结、`QUALIFIES` 两次的处置一致——**不给冻结注册表硬塞位置**。

---

## 7. 真相源边界与迁移契约

### 7.1 真相源

| 类别 | 真相源 | 可否重建 |
|---|---|---|
| 用户确认过的 Project / Question / Hypothesis / Experiment / **已确认 Evidence** | **Markdown** | 索引删除后可完整重建 |
| 机器候选 Evidence、评分、embedding、图关系 | SQLite / JSON 索引 | 可丢弃、可重算 |
| 原始来源 | `source.raw.html` + `source.meta.json` | 不可重建，须归档 |

> 底线：**插件消失后，用户确认过的科研认知必须仍可从 Markdown 读出。** 机器候选丢失可以接受。

### 7.2 迁移契约

任何 `schema_version` 变更必须同时提供：

1. 迁移脚本
2. **先于迁移编写**的守恒校验器（对象计数守恒、正文哈希守恒、关系可解析率不下降）
3. 自动备份与一条命令回滚
4. 读到未知字段时保留原值透传，不得丢弃

**迁移运行日志必须交代它碰过的每一个路径**，分入 `created_paths` / `modified_paths` / `deleted_paths`。搬迁会删除来源；漏记这条删除，回滚就没有任何代码路径去恢复它——而回滚仍会报告成功，文件却始终不在。因此 `rollbackPlan` 额外校验：**备份中任一 `role: "source"` 若已从 Vault 消失且运行日志未记录删除，一律拒绝回滚。**

回滚执行**先恢复、后删除**。校验只保证回滚「可以安全开始」，不保证「可以安全被打断」：断电或磁盘写满仍可能停在中途。先恢复则中断后原件已在位、只余少量迁移产物，可恢复；先删除则原件已失而尚未复原。

### 7.3 迁移前守恒校验器（冻结）

迁移脚本执行前，必须先生成只读 preflight 清单并运行：

```powershell
node tools/migration-conservation.js docs/migration-preflight.example.json
```

校验器只读取清单、向标准输出 JSON 报告，**不写入 Vault，不读取或输出 `data.json` 的凭据**。清单中每个发现来源必须恰有一个终态：

- `migrate`：须指定 Schema v1 对象类型、目标相对路径，且目标声明的 `source_sha256` 必须等于来源正文哈希。
- `candidate`：进入人工归类队列，不能偷偷当作已迁移对象；`Experiments/` 根目录和 `Literature/` 的历史笔记先使用此状态。
- `exclude`：明确排除并给出原因；所有 `.` 开头的备份目录必须显式列在这里，不能靠扫描器偶然忽略。
- `retained_settings`：保留在原位；`data.json` 只能取此终态，唯一允许声明的提取范围是 `rssBoard.articles[].radarScores`。

旧来源归档缺少 `capture_state` 时，迁移清单应标为 `unknown`（作为 `candidate` 的分类理由），**不得**根据文件存在或哈希一致推定为 `verified`。

**`migrate` 采用白名单**：只有 `capture_state === "verified"` 才可迁移。`suspect` / `challenge` / `failed` / `pending` 一律不可。用「排除若干已知坏状态」的黑名单写法会让新增状态默认落入合格侧——`suspect` 正是这样一度被放进了 `migrate`。

### 7.4 离线重新评估（`reassessed_capture_state`）

`tools/source-reassess.js` 重新读取已归档的 `source.raw.html` / `source.meta.json`，判定是否为验证页、是否正文充分。这与 §7.3 禁止的推定不同：**禁止的是从「文件存在」或「哈希一致」推定合格，而重读字节内容是另一类证据。**

三条硬约束：

1. **只读。** 历史 `capture_state` 是当时发生了什么的记录，不得改写；结论写入独立报告的 `reassessed_capture_state`，两者并列可查。
2. **判定复用出厂检测器。** 主判定调用 `main.js` 中的 `sourceCaptureAssessment`，不另写一份；两份实现必然漂移，届时审计的就不是真正在跑的那一份。
3. **通过不等于合格。** 通过只意味着「归档内容没有任何一点与'这是正文'相矛盾」，不意味着「这是权威版本」。离线检查无法确立后者，**因此通过只能让来源进入人工复核，永远不能直接变成 `migrate`。**

结构性特征（如 Cloudflare 的 `challenge-platform` 脚本路径）只作**旁证**，不可单独定罪：Cloudflare 会把该脚本注入**正常返回**的页面，单凭它曾误杀一篇 200 状态、170 锚点的真实正文。

### 7.5 重复抓取：一篇文献只出一个 Paper（冻结）

同一篇文章会被多次剪藏（失败后重试、或经不同入口抵达）。**每份拷贝都迁移就会为一篇文献铸造多个 Paper**，此后指向任一个的关系都只是半张图。

**裁决**：保留最完整的 `verified` 抓取为 Paper；其余**原位保留为原始剪藏**，记录 `duplicate_of`（指向胜出者的 `source_path`；preflight 阶段尚无 `uid`）。**不删除任何一份**——重复抓取仍是出版社当日返回内容的证据。

胜出顺序：`verified` 优先 → 锚点数多者优先 → 文件夹名字典序在前者优先。最后一条不是修饰：**清单若在两次运行间重排，就无法审阅、无法 diff。**

分组用**并查集合并所有标识符**（DOI、落地 URL、以及从 `/doi/<doi>` 形式 URL 反解出的 DOI），而非为每份拷贝挑一个「最佳」标识符。单一键在真实数据上会失败：

- 只按 DOI 分组，会拆散一对共享 Nature URL、DOI 却不同的拷贝——其中一份的 DOI 是从正文引文里刮到的，属于另一本期刊。
- 只按 URL 分组，会拆散一份被拦截的抓取和它经另一路径成功抓到的孪生。

**组内 DOI 不一致时不得迁移**，标 `duplicate_group_disagrees_on_doi_requires_user_review`。带错 DOI 的 Paper 比迟到的 Paper 更糟。

**已迁移的 Paper 也参与分组，且不再被重新评判。** 去重索引必须**递归**扫描 `Research/Papers/`（扁平与论文包两种形状），并把已迁移 Paper 当作既有胜出者。否则论文一迁出 `WebClips`，它压住的副本就会立刻上位——首批迁移后实测复现过一次。

### 7.6 论文包与随行附件（冻结）

正文用相对路径引图（`assets/img-01.png`）时，笔记**不能单独移动**。两种布局：

| 情形 | 目标 |
|---|---|
| 只有远程图片 URL | `Research/Papers/<原文件名>.md`（扁平） |
| 有相对路径引图 | `Research/Papers/<原文件名>/<原文件名>.md` + `assets/`（论文包） |

**必须一包一论文，不得共用 `Research/Papers/assets/`。** 实测：当前 vault 里 `img-03.png`、`img-04.png`、`img-05.svg` 各出现在**两篇不同论文**中；共用目录会静默覆盖。其中两个文件**字节完全相同但文件名不同**，所以按内容哈希去重同样救不了——冲突纯粹来自文件名。

附件挂在论文自己的 migrate 条目下：

```json
"target": {
  "type": "paper",
  "target_path": "Research/Papers/<名字>/<名字>.md",
  "attachments": [
    { "from": "Experiments/WebClips/<名字>/assets/img-01.png",
      "to":   "Research/Papers/<名字>/assets/img-01.png",
      "sha256": "<64 hex>" }
  ]
}
```

约束：

1. **附件不是对象**，不得带 `type`——§5 尚未冻结 Asset 字段。
2. **`to` 必须位于本论文包内**，否则一包一论文的隔离性并不真正存在。
3. **`to` 在整个清单内全局唯一**，与 `target_path` 共用同一命名空间。
4. 每个附件必须有 `sha256`。
5. **正文字节不得改写。** 打包正是为此：不改链接，相对路径靠目录一起移动而继续有效，§7.2 的正文哈希守恒不受影响。
6. 链接指向 `assets/` 之外、或目标文件已缺失时**不得打包**——打包修不好这两种情况，分别标 `relative_asset_links_outside_assets_directory` 与 `relative_asset_link_target_missing`。
7. 备份须以 `role: "attachment"` 覆盖附件；运行日志须登记每个附件的创建与删除；回滚的「来源消失但日志未记删除」检查同样适用于附件。
8. **不删除清空后的 `assets/` 目录**——删空目录是回滚无法撤销的操作。

### 7.5 备份、运行日志与回滚（冻结）

真实迁移前先执行 `backup`；无 `--execute` 时只显示计划、**不写入任何文件**。备份目录必须在 Vault 外：

```powershell
node tools/migration-transaction.js backup --vault <vault> --preflight <preflight.json> --backup-root <vault 外目录> --execute
```

备份只包含 preflight 中 `migrate` 项的来源文件，以及已经存在、可能被覆盖的目标文件。它逐个校验来源正文哈希，preflight 生成后发生过编辑即拒绝继续。快照保存 `backup_id`、文件路径、字节数与 SHA-256。

未来迁移器必须在同一备份目录写出 `scholarium-migration-run` 运行日志，精确列出 `created_paths` 与 `modified_paths` 及其迁移后 SHA-256。回滚命令只接受该日志：

```powershell
node tools/migration-transaction.js rollback --vault <vault> --backup <备份目录> --run <migration-run.json> --execute
```

回滚先完整验证再动手：它只删除日志列出的新建文件，只恢复快照列出的被修改文件；任一文件在迁移后被用户改过、哈希不匹配时，整次回滚拒绝执行，不覆盖用户新工作。

### 7.6 写入器（冻结）

`tools/migration-write.js` 只处理 preflight 中已经通过白名单的 `Paper` 与 `Project`。默认只输出写入计划；真实执行必须同时提供同一份 preflight 的外部备份，并显式加入 `--execute`：

```powershell
node tools/migration-write.js --vault <vault> --preflight <preflight.json> --backup <备份目录> --execute
```

每个操作先把运行日志写入备份目录，再写入目标文件并校验哈希，最后才删除来源。日志预先声明 `created_paths` 与 `deleted_paths`，因此断电发生在任意一步时都可以由 §7.5 的回滚器审计并恢复。目标文件已存在、来源在 preflight 后变化、备份不匹配，或 Paper 的 `source.meta.json` 不再是 `capture_state: verified` 时，写入器一律拒绝执行。

---

## 8. 校验

`tests/schema.test.js` 须断言（样例采用 JSON，以便在无依赖环境下验证）：

- `docs/examples/` 下每类样例符合本文件定义
- `uid` 全局唯一且为合法 UUIDv7
- 所有 `*_uid` 引用可解析
- 六类必填字段齐全
- `verified_by_user: false` 的 Evidence 不出现在正式状态

---

*本文件是冻结契约。修改须走 PR，并说明为何现有约束不足。*
