---
name: rss-refresh-and-score
description: 刷新 Scholarium 里全部 RSS/Atom/Crossref 订阅源，并对每个源的新文章跑一遍 Research Radar 打分（title_abstract 档）。真实执行：会消耗 AI 打分调用额度并写入 data.json，不是 dry-run。
---

# RSS 刷新 + 打分

驱动 Obsidian 里 Scholarium 插件的 RSS 订阅刷新与打分，不需要人在 Obsidian
里点按钮。

## 什么时候用

- 需要拿到最新一批订阅源文章的评分结果，且当前没有人守在 Obsidian 前面点刷新。
- 作为定时任务的一环，周期性把订阅源刷到最新。

## 它做了什么

这个 skill 现在只是把「按订阅源逐一投递动作」这件事包了一层方便的一次性
入口，实际执行走的是和 Bridge 的 `POST /v1/scholarium/actions`、以及未来
其它 Scholarium 动作完全相同的一条队列：

1. 对每个订阅源，向 `Research/_runs/queue/`（`tools/bridge-action-queue.js`）
   投递一对动作：`rss.refresh_feed` 和 `rss.score_feed`。
2. Obsidian 里的 Scholarium 插件（必须正在运行，且已加载这次改动之后的
   main.js）每 20 秒轮询同一条队列（`schPollScholariumQueue`），对每个
   排队项：
   - 校验动作名在白名单 `SCH_SCHOLARIUM_QUEUE_ACTIONS` 内（完整清单见
     main.js，含 rss.* / workspace.* / material.* / experiment.append_note
     等；面板操作类动作见 scholarium-panel-control skill）；
   - 用一个不依赖主面板打开的、临时的 `RssFeedBoard` 实例执行动作
     （`refreshFeed` 走 RSS/Atom 或 Crossref，按既有的 per-feed 200 篇 /
     全局 6000 篇上限裁剪；`scoreFeed` 调用「文献雷达」批量打分，只打没打
     过分的新文章）；
   - 把结果写回同一个 `data.json`（走插件自带的串行写队列，不会和你手动
     操作互相覆盖）；
   - 无论成功失败，都在 `Research/_runs/actions/` 写一条审计记录
     （`tools/action-registry.js` 的 `runAsync`）。
3. 本工具轮询 `Research/_runs/queue/` 下每个投递项的结算状态（不再是旧的
   `agent-requests/<id>.result.json`），等到全部结算或超时后打印汇总结果
   并退出。

旧的 `.obsidian/plugins/obsidian-scholarium/agent-requests/` 目录、
`schRunAgentAction`、`schPollAgentRequests` 机制已经被这次改动移除——
统一到一条队列之后，只有一份白名单、一份审计记录、一个开关，不会再出现
两套互相不知道对方存在的执行路径。

## 前提条件

- Obsidian 必须开着，且这个 vault 里的 Scholarium 插件是这次改动之后的
  版本（main.js 里包含 `schPollScholariumQueue`）。没有满足这一条时，
  本工具会在超时后如实报告"没有等到结果"，不会假装成功。
- **两个开关都要打开，缺一不可：**
  - Bridge 侧：`bridge.config.json` 里 `scholarium.enabled` 必须为
    `true`（这是本工具检查的第一件事，不满足直接报错退出，不会投递任何
    队列项）。
  - 插件侧：Scholarium 设置面板里的"允许织研者执行 Scholarium 动作"
    （`settings.allowResearchWeaverActions`）开关必须打开。这个开关默认
    关闭；关闭时，投递的队列项会一直安静地停在待处理状态，
    `schPollScholariumQueue` 会直接跳过它们，本工具最终会等到超时后如实
    报告未结算，而不是假装成功。
- 会真实调用你在插件设置里配置的 AI 打分服务（DeepSeek/Claude/GPT，按
  `rssAiProvider` 设置），消耗你自己的 API 额度。

## 输出

一个 JSON 对象：

```json
{
  "status": "ok | partial",
  "feeds": 3,
  "newlyScored": 12,
  "newArticles": 5,
  "perFeed": [
    {
      "feedId": "...",
      "title": "...",
      "refresh": { "status": "completed | failed | timeout", "...": "action result fields", "error": "..." },
      "score": { "status": "completed | failed | timeout", "...": "action result fields", "error": "..." }
    }
  ]
}
```

`status` 在任意一个订阅源的 `refresh` 或 `score` 未成功结算时变为
`"partial"`；具体原因看对应 `perFeed[].refresh.error` /
`perFeed[].score.error`。
