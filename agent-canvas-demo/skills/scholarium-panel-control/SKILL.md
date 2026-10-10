---
name: scholarium-panel-control
description: 让织研者直接读取和操作 Scholarium 插件的每一个面板——博士工作台（日程 timeblock、考勤 checkin、习惯 habit、心情 emotion、任务 task、专注 focus、速记 capture）、文献订阅（改单篇评分、标已读/收藏）、素材库（登记/改名/移除条目）、实验记录（追加日志）。读操作离线可用；写操作走队列，需要 Obsidian 开着且两个开关都打开。
---

# Scholarium 面板全面控制

织研者对 Scholarium 各面板的读写通道。所有动作经
`POST /v1/scholarium/actions`（Bridge）→ `Research/_runs/queue/` →
Obsidian 内的 `schPollScholariumQueue` 消费者执行，与
rss-refresh-and-score 是同一条队列、同一份白名单、同一份审计记录
（`Research/_runs/actions/*.json`）。

## 前提条件

- **读操作**（`workspace.get_state`、`material.list`）：L0，Bridge 直接读
  磁盘上的 data.json，Obsidian 关着也能用。注意 Obsidian 可能有数秒的
  内存态未落盘，读到的是最近一次保存。
- **写操作**（其余全部）：L1，必须满足——
  - Obsidian 正在运行且插件为最新版本；
  - `bridge.config.json` 里 `scholarium.enabled: true`；
  - 插件设置里"允许织研者执行 Scholarium 动作"开关打开；
  - 用户在面板上确认该动作（L1 一律 requires_confirmation）。
- 写入一律走插件的 `loadData()/saveData()`（workspace/material）或
  board 的既有保存路径（rss），**绝不直接写 data.json**——直接写会被
  Obsidian 内存态静默覆盖。

## 博士工作台（workspace.*）

数据在 data.json 的 `workspace` 键下。

| 动作 | 输入 | 说明 |
| --- | --- | --- |
| `workspace.get_state` | `section?` | L0。不给 section 返回各分区摘要；给了返回该分区完整内容。section ∈ checkin/timeblocks/tasks/captures/focus/habits/food/emotions/journal/phone/submissions/leave |
| `workspace.timeblock_add` | `date`(YYYY-MM-DD), `start`, `end`(HH:MM), `title`, `category?`(默认 research), `note?` | 排一个日程块。"明天 9-11 点做 HPLC"就用这个 |
| `workspace.timeblock_update` | `id`, 任意待改字段 | 改已有日程块 |
| `workspace.timeblock_remove` | `id` | 删除日程块 |
| `workspace.checkin_upsert` | `date`, `period`(morning/afternoon/evening), `note?`, `clear?` | 打卡考勤；clear=true 清空该时段 |
| `workspace.habit_add` | `name`, `cadence?`(默认 daily) | 新建习惯 |
| `workspace.habit_log` | `habit_id`, `date?`, `done?`(默认 true), `note?` | 记一次习惯完成 |
| `workspace.emotion_log` | `mood`, `score?`, `note?`, `date?` | 记一条心情 |
| `workspace.task_add` | `title`, `due?`, `note?` | 加任务 |
| `workspace.task_update` | `id`, `title?/status?/due?/note?` | 改任务（如 status: done） |
| `workspace.task_remove` | `id` | 删除一条任务；先用 `workspace.get_state` 取得真实 id |
| `workspace.focus_log` | `title`, `date?`, `start?/end?/minutes?` | 补记一段专注 |
| `workspace.capture_add` | `text` | 速记一条 |

写返回里带新条目的 `id`，后续 update/remove 用它。

## 文献订阅（rss.*，补充动作）

| 动作 | 输入 | 说明 |
| --- | --- | --- |
| `rss.set_article_score` | `article_id`, `overall_score`(0-100), `reason`(必填) | 改单篇文章评分。写入的 relevance 固定标 `model: agent-override`、`basis: manual_agent`，与模型打分可区分；reason 必填供审计 |
| `rss.mark_article` | `article_id`, `read?`, `starred?` | 标已读/未读、收藏/取消收藏 |

article_id 从 `workspace.get_state` 拿不到——用 Bridge 的
`GET /v1/scholarium/state` 或 rss 面板数据查。批量自动评分仍用
`rss.score_feed`（见 rss-refresh-and-score skill），本动作是"改某一
篇"的人工修正通道。

## 素材库（material.*）

数据在 data.json 的 `materialLibrary` 键下。

| 动作 | 输入 | 说明 |
| --- | --- | --- |
| `material.list` | 无 | L0。返回全部条目和分类 |
| `material.add` | `path`(vault 相对路径), `name?`, `category?` | 把库里已有文件登记进素材库；path 必须真实存在，防 `..` 越界，防重复登记 |
| `material.update` | `id`, `name?/category?` | 改名/改分类 |
| `material.remove` | `id` | 只移除登记，**绝不删文件** |
| `material.category_add` | `name` | 加分类 |
| `material.category_remove` | `name` | 仅删除没有任何材料使用的分类；仍在使用时会拒绝，绝不改动材料条目 |

## 实验记录（experiment.append_note / experiment.insert_chem）

| 动作 | 输入 | 说明 |
| --- | --- | --- |
| `experiment.append_note` | `experiment_uid`, `text` | 往实验 frontmatter 的 `log` 列表追加 `{at, text, by}`，by 如实记录调用者（队列链路里为 `agent:research-weaver`）。不改 status、不走生命周期门槛；状态迁移仍用 `experiment.transition` |
| `experiment.validate_chem` | `smiles?` / `reaction_smiles?`（至少一个） | L0 只读化学门禁：用本机 RDKit 检查结构能否解析；反应式还检查左右两侧逐元素守恒和净电荷守恒。返回 `status: balanced` 才能称为已配平 |
| `experiment.insert_chem` | `experiment_uid`, `smiles?` / `reaction_smiles?`（至少一个）, `title?`, `type?`, `molfile?`, `ket?`, `block_id?`, `allow_duplicate?`, `strict_validation?` | 往实验**正文**末尾追加一个 ` ```scholarium-chem ` 块。研究员在笔记里能直接看到结构图，点"编辑"用 Ketcher 打开继续画；织研者必须先通过 `experiment.validate_chem`，再以 `strict_validation: true` 写入完整反应式 |

experiment_uid 用 `experiment.scan_outcomes`（L0）或 M1 读通道查到。

### insert_chem 的约束

### 化学严谨性协议（强制）

`experiment.insert_chem` 只能固化“来源明确”的结构表示，不能把它当成化学方程式验证器。调用前必须先区分：Ketcher 图、SMILES/RXN 是结构/反应的编码；能渲染、能解析或箭头画得出来，都不代表反应真实、已经配平或机理成立。

- 反应式必须先确认每个物种的身份和来源，明确反应物/产物边界；溶剂、催化剂、条件、旁观离子和未确认副产物不能悄悄省略或改写成产物。
- 对完整反应式逐元素核对原子数，并核对净电荷；涉及氧化还原时还要核对电子/氧化数，涉及离子或配位物时核对价态与配位数。任一项无法核对，就只能写“方程式不完整/待核验”，不能声称“已配平”。
- 系数必须化为最小整数比，并同时给出人类可读方程式。RXN/SMILES 中重复同一物种只是编码系数的方式；Ketcher 可能将重复物种画成多个图形，不能把图形数量当成已经显示的系数。
- 不得从截图、名称或常见反应经验反推缺失结构、产物、系数、条件或机理；不得编造 SMILES、molfile、分子式或守恒结论。拿不准时先问研究员，或使用 `experiment.append_note` 记录文字描述。
- 写入前在回复或动作理由中明确状态：`已验证/已配平` 只允许用于元素、净电荷、结构有效性和来源都已核实的反应；否则使用 `待核验`，并列出缺失的物种、守恒项或验证工具。不要用“已验证”标题掩盖不完整反应。
- 反应式写入的固定动作顺序是：先调用 `experiment.validate_chem`；只有返回 `valid: true` 且 `status: balanced`，才可调用 `experiment.insert_chem` 并传 `strict_validation: true`。验证器返回 `unbalanced`、`invalid` 或 `unavailable` 时禁止写入反应式；改用 `experiment.append_note` 记录待核验文字。

- `reaction_smiles` 必须含 `>`（渲染端就是靠它判定"这是一条反应式"），否则
  报 `reaction_smiles_must_contain_reaction_arrow`。单个分子走 `smiles`。
- SMILES 里不能有空白字符，否则报 `*_must_not_contain_whitespace`——把一整句
  自然语言塞进结构字段是最常见的错法。
- `type` 只能是 `molecule|cycle|scheme|reaction`（默认按有没有反应式推断），
  `format` 只能是 `ket|rxn|mol`（默认按实际给了哪个字段推断）。
- 只给 SMILES 时块能正常渲染；`molfile`/`ket` 是可选的原始结构，给了的话研究员
  点"编辑"时 Ketcher 能拿到原始坐标，而不是从 SMILES 重新布局。
- frontmatter 的 `smiles`/`reaction_smiles` **只在为空时**补写（决定看板卡片
  的缩略图）；已有不同的值时不覆盖，在结果的 `frontmatter_skipped` 里如实列出。
- 正文里已有同一条结构时返回 `{noop: true, reason: "structure_already_present"}`
  而不是写第二份；确实要重复插入才传 `allow_duplicate: true`。
- **绝不编造结构**：一条杜撰的 SMILES 在笔记里和一条真实结构长得一模一样，
  事后没人分得清。结构必须来自研究员的话、文献原文或已有记录；拿不准就问，
  或退回 `experiment.append_note` 用文字描述。

## 失败处理

- 写动作返回 `scholarium_live_context_required`：Obsidian 没开或插件未
  加载新版 main.js——如实告诉用户，不要假装成功。
- 队列项一直 pending：检查两个开关；超时就如实报告未结算。
- `timeblock_not_found` / `article_not_found` 等：先用对应 L0 读动作拿
  最新 id 再重试，不要编造 id。
