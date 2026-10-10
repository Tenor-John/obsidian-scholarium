# Bridge 控制面：RSS 三项动作（设计 + 实现，已全部接入并统一）

状态：2026-08-14（已完成统一）。对应本次会话的诊断——Bridge（`agent-canvas-demo/bridge/server.js`）
与 Scholarium 插件运行时之间原本没有任何动作通道，`tools/action-registry.js` 硬编码只读，Bridge
的 `allowedRoots` 只覆盖 `新建研究主题` 子目录而非整个 Vault。本文档记录三项动作的接口规格；
下方"⚠ 与已存在的 `rss-refresh-and-score`"一节记录了这次统一之前发现的重叠实现，"本次已实现并
测试的部分"和"`main.js` 接入（已完成）"两节记录最终落地的样子——`main.js` 的队列消费者
（`schPollScholariumQueue`）已经接入，旧的 `agent-requests/` / `schRunAgentAction` /
`schPollAgentRequests` 机制已移除，两套实现统一成了一条队列。

## 架构总览

```
织研者 / Claude
      │  POST /v1/scholarium/actions {action, input}
      ▼
Bridge (agent-canvas-demo/bridge/server.js)          ← 已实现
      │  校验 scholarium.enabled、vaultRoot、action 白名单
      │  预检 dry-run（不需要 live board，只验证输入）
      │  tools/bridge-action-queue.js: submit()
      ▼
<vaultRoot>/Research/_runs/queue/<id>.json            ← 文件落盘，Bridge 到此为止
      │
      │  Obsidian 进程内，Scholarium 插件轮询（main.js: schPollScholariumQueue，← 已接入）
      │  受 settings.allowResearchWeaverActions 开关控制，默认关闭
      ▼
tools/action-registry.js runAsync(action, input,      ← 已实现（三个动作定义 + runAsync）
  { dryRun: false, confirmed: true, by: "agent:research-weaver",
    live: { board: <throwaway RssFeedBoard>,
            settings: plugin.settings } })
      │  L0-L3 权限检查 → 执行 tools/rss-actions.js 中的 handler
      │  handler 调用 RssFeedBoard 已有方法，不新造写入路径
      ▼
写入 Research/_runs/actions/<manifest>.json（审计清单，机制与现有 experiment.transition 相同）
      │
      ▼
tools/bridge-action-queue.js: settle() → Research/_runs/queue-archive/<id>.json
      │
      ▼
Bridge GET /v1/scholarium/actions/:id                 ← 已实现，供织研者读取结果
```

Bridge 进程本身**永远不**触碰 `data.json`，也不直接调用 RSS 抓取/评分/剪藏——它只做白名单校验
和文件落盘。真正执行动作的，始终是 Scholarium 插件自己已有的方法（`refreshOneFeed`、
`scoreNewArticles`、`autoClipHighScoredArticles`），跑在 Obsidian 进程里。`schPollScholariumQueue`
用一个**临时新建的** `RssFeedBoard` 实例（`new Ys(plugin.app, plugin)`）执行，而不是
`window.__scholariumRssBoard`（那个全局只在 Scholarium 主面板视图打开时才存在）——这保留了
`rss-refresh-and-score` skill 原有的"不依赖主面板打开"这个技术优势，同时统一到了同一条队列、
同一份白名单、同一份审计记录。

## ⚠ 与已存在的 `rss-refresh-and-score` / `schPollAgentRequests` 的关系（已统一，历史记录）

写这份文档、改 `main.js` 的过程中，磁盘上的 `main.js` 和
`agent-canvas-demo/bridge/server.js` 曾被另一个进程并发修改——当时已经有一套**独立、更早落地**
的方案在跑：一个专门的 `agent-requests/` 文件队列 + `main.js` 里的 `schRunAgentAction` /
`schPollAgentRequests`，暴露成 `agent-canvas-demo/skills/rss-refresh-and-score/` 这个 Skill，
走 `allowExecution` + `execute:true` 开关，和本文档设计的 `Research/_runs/queue/` +
`scholarium.enabled` 是两套互不知道对方存在的执行路径，同一次"刷新+评分"可能被分别触发两次。

**这个重叠已经按你的决定解决**：保留旧方案里"不依赖 `window.__scholariumRssBoard`、用临时
`RssFeedBoard` 实例执行"这个技术优势，把它下沉进 `schPollScholariumQueue`；旧的
`agent-requests/` 目录、`schAgentRequestsDir`、`schRunAgentAction`、`schPollAgentRequests`
全部移除；`rss-refresh-and-score` skill 的 `scripts/request_and_wait.js` 改为向同一条
`Research/_runs/queue/` 投递 `rss.refresh_feed` + `rss.score_feed` 这对细粒度动作，而不是
自己再维护一套请求/结果文件协议。现在只有一条队列、一份白名单、一个消费者、一份审计记录、
一个执行开关（`settings.allowResearchWeaverActions`，配合 Bridge 侧的
`scholarium.enabled`）。

## 三项动作接口规格

### 1. `rss.refresh_feed` — 刷新指定订阅源

- level: `L1`（本地可逆写入），risk: `network_fetch`
- input: `{ feed_id: string }`
- 底层调用：`board.refreshOneFeed(feed)`，`feed = board.data.feeds.find(f => f.id === feed_id)`
- 前置条件：Scholarium 主面板视图已打开（否则 `live` 不可用）；`feed_id` 必须存在
- dry-run 输出：`{ feed_id, feed_title, cached_articles, last_fetched }`
- 正式执行输出：`{ feed_id, feed_title, articles_before, articles_after, new_articles, feed_error }`
- 副作用：对该订阅源发起一次网络请求（RSS/Atom 或 Crossref），去重后追加新文章到
  `data.json` 的 `rssBoard.articles`；不写 `Research/`，不创建 schema-v1 对象。

### 2. `rss.score_feed` — 对指定订阅源的新文章评分

- level: `L1`，risk: `external_api_call`（会消耗已配置的评分 API Key 额度）
- input: `{ feed_id: string }`
- 底层调用：临时设置 `board.selectedFeedId = feed_id`，调用 `board.scoreNewArticles()`，
  结束后恢复原 `selectedFeedId`（不改变用户当前 UI 选中状态）
- 前置条件：同上，且需要 Scholarium 设置里已配置评分 API Key（这是现有前置条件，本动作不
  会触碰 Key）
- dry-run 输出：`{ feed_id, feed_title, candidates }`（待评分文章数）
- 正式执行输出：`{ feed_id, feed_title, candidates_before, scored, unscored_remaining, note }`
- **重要提示（已在 note 字段中体现，不是隐藏行为）**：`scoreNewArticles()` 本身还会做两件事——
  清理零分缓存（`radarPrune`），以及如果 Scholarium 设置里 `rssAutoCaptureEnabled` 已开启，
  会自动触发高分剪藏。这是插件原有的链式行为，本动作只是复用它，不是新增的。

### 3. `rss.clip_high_score` — 对达到阈值的文章执行现有剪藏

- level: `L1`，risk: `reversible`
- input: `{ feed_id: string }`（不接受阈值/批量上限的覆盖参数——统一读取 Scholarium 设置里
  已有的 `rssAutoCaptureMinScore` / `rssAutoCaptureMaxPerBatch`，避免织研者绕过用户自己配置
  的口径）
- 底层调用：`board.autoClipHighScoredArticles(pool)`，`pool` 为该订阅源下当前评分 ≥ 阈值的文章
- **前置条件（双重开关）**：
  1. Scholarium 设置里 `rssAutoCaptureEnabled === true`（用户已有的开关，本动作直接复用，
     不绕过）
  2. Bridge 侧 `scholarium.enabled === true` 且该 action 在 `allowedActions` 白名单内
  3. 插件侧（见"剩余工作"）研究者开启的"允许织研者执行 Scholarium 动作"开关
- dry-run 输出：`{ feed_id, feed_title, enabled, threshold, qualifying_articles }`
- 正式执行输出：`autoClipHighScoredArticles()` 原有返回值（`enabled, started, completed,
  needsInteraction, failed` 等）+ `feed_id, feed_title, threshold`
- 未开启 `rssAutoCaptureEnabled` 时不报错，返回 `{ enabled: false, note: "..." }`，提示去
  Scholarium 设置里开启。

**明确不做的三件事**（延续既有的 `action-registry.js` 设计原则，`tests/action-registry-ui.test.js`
已有静态检查确保不出现 `evidence.confirm` 之类的自动确认动作）：不自动确认正式 Evidence、
不删除 Vault 文件、不修改 API Key 或覆盖已有研究对象。三项动作都只触碰 RSS 缓存
（`data.json` 里的 `rssBoard`）和剪藏笔记，不touch `Research/` 下的 schema-v1 对象。

## 本次已实现并测试的部分

全部改动都在 `node tests/run.js` 下验证过（381 passed, 0 failed，含 22 个新用例：12 个来自
Bridge 侧控制面，10 个来自 `main.js` 队列消费者的静态接入检查），并对 Bridge 新增的 4 个
HTTP 端点做了真实起服务的手工联调（enabled=false 时 409、未授权 action 名 403、缺参数 400、
正常请求 202 落盘、GET 列表/单条查询、无 token 401、未知 id 404 均验证通过）。

| 文件 | 改动 | 说明 |
|---|---|---|
| `tools/bridge-action-queue.js` | 新增 | Bridge ↔ 插件的文件队列：`submit/listPending/read/recentArchive/settle` |
| `tools/rss-actions.js` | 新增 | 三个动作的 handler，通过鸭子类型 `live.board` 包装既有 RssFeedBoard 方法 |
| `tools/action-registry.js` | 扩展 | 新增 `runAsync()`（`run()` 原有同步契约完全不变，`main.js` 里
  `schOpenExperimentTransition` 等现有调用点不受影响）；新增三项 `ACTIONS` 白名单条目 |
| `agent-canvas-demo/bridge/server.js` | 扩展 | 新增 `scholarium` 配置块（默认 `enabled:false`，
  与现有 `allowExecution` 同样的失败关闭原则）；新增 `GET /v1/scholarium/status`、
  `POST /v1/scholarium/actions`、`GET /v1/scholarium/actions`、`GET /v1/scholarium/actions/:id`；
  `SKILL_RUNNERS['rss-refresh-and-score']` 的注释更新为描述统一后的单队列流程 |
| `agent-canvas-demo/bridge/bridge.config.example.json` | 扩展 | 记录新配置块的写法 |
| `agent-canvas-demo/skills/rss-refresh-and-score/scripts/request_and_wait.js` | 重写 | 不再自己
  维护 `agent-requests/` 请求/结果文件协议，改为按订阅源向 `Research/_runs/queue/` 投递
  `rss.refresh_feed` + `rss.score_feed`，复用 `tools/bridge-action-queue.js` |
| `agent-canvas-demo/skills/rss-refresh-and-score/SKILL.md` | 更新 | 描述统一后的行为、两个必需开关
  （`scholarium.enabled` + `settings.allowResearchWeaverActions`）、新的输出结构 |
| `main.js` | 接入 | 见下节 |
| `tests/rss-actions.test.js`、`tests/bridge-action-queue.test.js`、
  `tests/scholarium-bridge-endpoints.test.js`、`tests/scholarium-queue-consumer.test.js` | 新增 |
  单元测试 + Bridge 路由/`main.js` 接入的静态安全检查 |
| `tests/harness.js`、`tests/run.js` | 修复 | `run()` 原来不 `await` 测试函数，异步测试即使
  抛错也会被记成通过；改为 `async run()` 并在 `run.js` 里 `await`。所有既有同步测试行为不变
  （对同步返回值 `await` 是空操作）。 |

## `main.js` 接入（已完成）

`schEvidenceTools(plugin)` 现在多返回 `root`（vault 内插件目录的绝对路径）和 `queue`
（`tools/bridge-action-queue.js`）两个字段。默认设置里新增：

```js
allowResearchWeaverActions: !1,   // 默认关闭；关闭时 schPollScholariumQueue 直接 return
```

设置面板里、"🧰 科研库"标题之前，加了一个对应的开关"允许织研者执行 Scholarium 动作"。

队列消费者本身：

```js
const SCH_SCHOLARIUM_QUEUE_ACTIONS = ["rss.refresh_feed", "rss.score_feed", "rss.clip_high_score"];
async function schPollScholariumQueue() {
  if (this._schScholariumBusy) return;
  if (!this.settings || !this.settings.allowResearchWeaverActions) return;
  // schEvidenceTools(this) → tools.queue.listPending(tools.vault)
  // 用 new Ys(this.app, this) 建一个临时 RssFeedBoard（不碰 window.__scholariumRssBoard），
  // 对每个排队项：白名单里才执行，调用 tools.actions.runAsync(vault, action, input, {
  //   dryRun: false, confirmed: true, by: "agent:research-weaver",
  //   allowedLevels: ["L0", "L1"], live: { board, settings: this.settings } })，
  // 无论成功失败都 tools.queue.settle(vault, item.id, outcome)，最后 board.save() 一次。
}
```

`onload()` 里用 `this.registerInterval(window.setInterval(() => schPollScholariumQueue.call(this), 20000))`
挂一个 20 秒轮询，卸载插件时自动清理。旧的 `schAgentRequestsDir` / `schRunAgentAction` /
`schPollAgentRequests` 三个符号已从 `main.js` 中完全移除——`tests/scholarium-queue-consumer.test.js`
里有一条测试专门断言它们不再存在，防止未来无意中复活两套并行机制。

至此，四项用户要求全部落地：(1) 队列消费者已接入 `main.js`；(2) 默认 dry-run 语义保留在
`action-registry.js` 的 `runAsync()` 层，只有 `allowResearchWeaverActions` 打开时消费者才会
显式传 `dryRun:false, confirmed:true`；(3) 仅开放 `rss.refresh_feed` / `rss.score_feed` /
`rss.clip_high_score` 三项，所有写操作审计到 `Research/_runs/actions/`；(4) 旧的
`rss-refresh-and-score` 便捷入口已改为向同一条队列投递任务，同时保留了"不依赖主面板打开"的
技术优势。
