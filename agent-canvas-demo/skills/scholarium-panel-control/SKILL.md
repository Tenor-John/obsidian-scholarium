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

## 实验记录（experiment.append_note）

| 动作 | 输入 | 说明 |
| --- | --- | --- |
| `experiment.append_note` | `experiment_uid`, `text` | 往实验 frontmatter 的 `log` 列表追加 `{at, text, by}`，by 如实记录调用者（队列链路里为 `agent:research-weaver`）。不改 status、不走生命周期门槛；状态迁移仍用 `experiment.transition` |

experiment_uid 用 `experiment.scan_outcomes`（L0）或 M1 读通道查到。

## 失败处理

- 写动作返回 `scholarium_live_context_required`：Obsidian 没开或插件未
  加载新版 main.js——如实告诉用户，不要假装成功。
- 队列项一直 pending：检查两个开关；超时就如实报告未结算。
- `timeblock_not_found` / `article_not_found` 等：先用对应 L0 读动作拿
  最新 id 再重试，不要编造 id。
