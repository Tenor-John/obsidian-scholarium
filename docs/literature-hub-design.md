# 文献中心（Literature Hub）设计与实施记录

日期：2026-08-21
状态：阶段 1、2 已实现；阶段 3+ 为后续增量

## 背景问题

原「文献订阅」面板把三类不同生命周期的东西混在一个页面里：

1. 长期订阅流（RSS/Crossref 订阅、评分、已读、收藏）——需要持久、不被打扰；
2. Pipeline 待手动下载任务（`manualDownloadQueue`）——临时任务队列，挤在订阅流顶部；
3. 临时浏览器/检索（`directWeb`、`searchResults`）——即用即走。

结果：订阅内容被任务队列和检索结果遮挡，且 Pipeline 下载的保存目录依赖调用方自觉传 `targetWorkspace`。

## 目标架构

顶部一级标签 `文献订阅` 更名为 **文献中心**（`panelTabs`，main.js 约 1399 行），内部四个子面板，由 `rssBoard`（类 `Ys`）的 `hubTab` 状态切换，持久化在 `data.json` 的 `rssBoard.hubTab`：

| 子面板 | hubTab | 内容 | 数据来源 |
|---|---|---|---|
| 订阅流 | `feed` | 添加订阅、全部刷新、研究画像雷达、订阅源侧栏、文章流、阅读窗 | `data.rssBoard.feeds/articles` |
| 检索与下载 | `search` | 关键词/DOI/URL 直开、Crossref+OpenAlex 检索结果表、抓取全文、下载目标选择器、内置浏览器 | `searchResults` / `directWeb` |
| Zotero 文库 | `zotero` | Zotero 本地 API（默认 `http://localhost:23119/api`）浏览集合与条目、搜索、打开 PDF、复制 DOI、加入课题 | Zotero 桌面端本地 API + 数据目录 |
| Pipeline 待处理 | `pipeline` | 待手动下载队列，按 pipelineRunId/课题分组，每项显示目标目录 | `manualDownloadQueue` |

关键行为约定：

- `openDirectPage()` 会根据是否携带 `manualQueueId` 自动切到 `pipeline` 或 `search` 子面板，保证内置浏览器（`directWeb` 渲染的 webview）总在当前可见面板里。
- 订阅流面板不再渲染下载队列、检索结果和临时浏览器——订阅文章永远可见。
- 「Pipeline 待处理」只是角标 + 独立页面，不再占据订阅流主体。

## Zotero 联动（本地 API，只读优先）

- 走 Zotero 官方本地 API（`http://localhost:23119/api`，需在 Zotero 设置中开启「允许本机其他应用与 Zotero 通信」），**不直接读 `zotero.sqlite`**。
- 配置持久化在 `data.rssBoard.zotero`：`apiBase`、`dataDir`（Zotero 数据目录，用于解析 storage 附件）、`pdfDir`（链接附件基础目录）。
- 已实现：连接测试、集合列表、条目浏览/搜索（标题/作者/年份/DOI）、在 Zotero 中打开（`zotero://select`）、复制 DOI、打开/复制 PDF（linked_file 用 `data.path`，imported 用 `<dataDir>/storage/<key>/<filename>`）、加入课题（复制 PDF 到 `<课题>/literature/downloaded-pdfs/`）。
- 未做（后续）：Zotero 写入、增量同步、网盘链接附件索引。

## 检索与下载（PoP 工作流的内部复刻）

- 后端沿用现有 Crossref + OpenAlex 公开检索（`searchLiterature`，DOI 去重、OA 标记）。
- 检索结果表增加「下载到」目标选择器（默认文献库 / 各课题），抓取全文时通过 `article.targetWorkspace` 传入统一下载上下文。
- 未做（后续）：Boolean 进阶检索式、Scopus/PubMed 源、检索历史快照、批量全文、RIS/BibTeX 导出、合并后统一相关性质量门。

## 统一下载上下文（阶段 2，已落地）

路由规则（实现在 `clipAndSummarize` 的 PDF 直连路由，main.js 约 22182 行）：

- **Pipeline 发起**（带 `manualQueueId`）：强制保存到 `targetWorkspace` 指定的课题目录；若上下文缺失或目录无效——**直接报错阻止**，不再悄悄回落到 vault 根目录的默认文献库。
- **检索面板手动下载**：使用「下载到」选择器选中的课题；选「默认文献库」才写 vault 根目录。
- 下载成功后仍走原有回写链：`completeManualDownload` 移除队列项 → postMessage `scholarium:manual-download-completed` 回 Pipeline iframe → 织研者续跑。

## 实施清单（本次提交）

- [x] `panelTabs` 标签更名 文献订阅 → 文献中心
- [x] `Ys` 构造/load/save 增加 `hubTab` 与 `zotero` 配置持久化
- [x] `renderHubTabs()` 二级导航（Pipeline 待处理带角标计数）
- [x] 订阅流面板剥离下载队列/检索/临时浏览器
- [x] `renderPipelineTab()` 按 pipelineRunId/课题分组、显示目标目录
- [x] `renderZoteroTab()` 本地 API 浏览 + 附件打开/复制 + 加入课题
- [x] 检索结果表「下载到」目标选择器
- [x] 下载路由：Pipeline 上下文缺失时禁止回落默认目录
- [ ] Zotero 增量刷新 / 写入
- [ ] 检索历史快照、批量全文、RIS/BibTeX 导出、统一质量门
