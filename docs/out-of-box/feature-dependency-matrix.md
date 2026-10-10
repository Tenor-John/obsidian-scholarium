# 功能—依赖—降级方式清单（Agent C · Day 1）

基线：部署仓库 `HEAD`（`d429a6d`）+ 部署目录只读勘察（2026-09-20）。
证据均为仓库内实际文件与行号；标注「待确认」的条目需要 Agent A/B 复核。

分级按任务书：A 本地零配置 / B 首次确认 / C 外部 CLI 登录 / D 外部 API key / E 网络·机构授权。

---

## A. 本地零配置（安装后即应可用，无需任何人工步骤）

| 功能 | 实际依赖 | 证据 | 缺失时降级 |
|---|---|---|---|
| 插件本体（六个 Tab、设置、对象管理、schema 校验、漂移审计、动作队列消费） | Obsidian ≥ 1.10.0 桌面端（Electron 内建 Node API） | `manifest.json` `minAppVersion`, `isDesktopOnly: true` | 无降级；手机端本就不支持 |
| Bridge 本地服务（61 路由、技能执行、代理调度） | `main.js` 内置的校验过的 core 运行时包（含 Node `20.19.0`） | `main.js` 的 `schInstallBundledRuntime` / `schResolveRuntimeLaunchSpec` / `schSpawnLocalRuntime` | 不读取系统 Node、不联网。内置包缺失或哈希不符时拒绝启动并提示重新安装完整插件包 |
| Bridge Node 依赖 | core 包内置 `node_modules`，并把 Playwright / playwright-core 当作生产运行时依赖强制检查 | `tools/runtime-pack-assemble.js`; `tools/verify-clean-install.js` | 无需 `npm install`；缺任一 Playwright 模块或许可证时装配直接失败 |
| 全部 24 个 Python 技能（normalize / plot / profile-audit / classifier / cleaning-plan / evidence-gate / json-canvas / 各检索 / nature-* / deep-research / pdf 等） | core 包内置 Windows embeddable Python；技能均为纯标准库实现 | `agent-canvas-demo/bridge/server.js`（`resolvePython`）；`skills/*/scripts/*.py` | 不读取系统 Python，不需要 pip；包校验失败时响亮拒绝 |
| Node 技能（research-weaver / paper-knowledge-graph / rag-ingest / rss-refresh-and-score / experiment-record / paper-downloader / scansci-institutional） | 与 Bridge 同一个 node（`process.execPath`） | `server.js:2321` | 随 Bridge 运行时一并解决 |
| Ketcher 化学结构编辑器 | core 包内置 Ketcher `3.17.2` JS/CSS 与完整 LICENSE/NOTICE | `tools/runtime-pack-assemble.js`; `start-local.js` 的 `/runtime-assets/ketcher/` 白名单路由 | 插件从校验过的本机 core 包加载；不再依赖 BRAT 不会安装的插件目录额外文件 |
| Bridge 配置与访问令牌 | `%LOCALAPPDATA%/Scholarium/runtime/profiles/<vault-hash>/bridge.config.json` | `main.js` 的 `schRuntimeLaunchSpec` | 自动生成、按 Vault 隔离，不进入 Vault、插件目录或发布包 |
| pidfile 与端口 | 同一 profile 下的 `weaver.pid.json`；canvas/Bridge 各自 `listen(0)` 后 IPC 回报 | `start-local.js`; `bridge/server.js`; `tests/runtime-bundle-wiring.test.js` | 不预选固定端口，不受 Windows 排除端口区间与 free-port TOCTOU 影响；卸载先 IPC 清理，超时才杀进程树 |

## B. 首次确认（本地可运行，但首次使用需用户显式确认）

| 功能 | 确认内容 | 证据 |
|---|---|---|
| 技能真实执行 | `allowExecution` + `execute: true` 双闸门 | `server.js` SKILL_RUNNERS 注释（rss-refresh-and-score 条目） |
| 织研者动作写回 Vault | 设置 `allowResearchWeaverActions`，且队列消费在插件侧二次把关 | 同上 |
| 素材库写入（normalize/plot） | 三段式确认；normalize 只产出 `Materials/_normalized/` 不可变 CSV+manifest，原文件字节级只读 | `server.js` sch-data-normalize 注释；DEC-008 例外文档 |
| 首次启动向导 | 只显示真实状态：本地技能就绪 / CLI 未安装 / CLI 已装未启用 / 指定 CLI 不存在 / 外部服务需登录或 key | 任务书；状态来源 `tools/agent-detect.js`（detected/broken/missing 三分） |

## C. 外部 CLI 登录（需用户自己安装并登录）

| 功能 | 依赖 | 缺失时降级 |
|---|---|---|
| Claude 代理通道（`claude-full` / `claude-research`） | Claude Code CLI，PATH 或常见安装位置，实际执行 `--version` 验证 | `tools/agent-detect.js` | 代理功能不可用；对象管理、校验、审计等本地功能不受影响 |
| Codex 代理通道（`codex-full`） | Codex CLI，同上 | 同上 | 同上 |
| opencode 通道（`opencode-full`） | opencode CLI | `server.js` 适配器表 | 同上 |
| 机构通道下载（scansci-institutional） | 用户本机已装的 `scansci-pdf` Python 包（解释器逐个探测 `import scansci_pdf`）+ WebVPN/CARSI/EZproxy 人工登录 | `skills/scansci-institutional/scripts/scansci_download.js:51`；`WEBVPN_COOKIE_SETUP.md` | 机构 PDF 下载不可用；开放获取链路（CORE/Unpaywall/Europe PMC/OpenAlex）不受影响 |

## D. 外部 API key（用户在设置中填写后可用）

| 功能 | 依赖 | 缺失时降级 |
|---|---|---|
| RAG：PDF → Markdown | MinerU 云解析 API key（`https://mineru.net/api/v4`，key 经 env 注入不落盘） | `skills/rag-ingest/scripts/rag.js:34`；`server.js` rag-ingest 注释 | Markdown 仍可入库；PDF 无法解析 |
| RAG：语义向量 | Hugging Face token（`@huggingface/inference`） | `INSTALL.md` | 明确降级为 BM25 检索 |
| Scopus 检索 | Scopus API key（待确认：需复核 `search_scopus.py` 的 key 读取方式） | `skills/scopus-search/scripts/search_scopus.py` | 该源不可用，其余源正常 |

## E. 网络 / 机构授权（无需 key 但需要网络，或需要机构身份）

| 功能 | 依赖 | 缺失时降级 |
|---|---|---|
| OpenAlex 检索（open-access-literature / nature-academic-search / pop8-scholar-search） | 网络可达 `api.openalex.org`，纯 stdlib urllib | 各脚本 | 离线时检索不可用，本地库功能正常 |
| PubMed / Semantic Scholar 检索 | 网络可达对应 API | 同上 | 同上 |
| RSS 订阅刷新与评分 | 网络可达各 feed；且经 Bridge 动作队列回写 | `skills/rss-refresh-and-score/scripts/request_and_wait.js` | 订阅不刷新，已入库内容不受影响 |
| WebVPN 人工登录 | core 内置 Playwright `1.62.0`，在 Windows Preview 上依次真启动系统 Edge、Chrome | `paper-downloader/scripts/browser_downloader.js`; `tools/verify-runtime-launch.js` | 无需 npm 或命令行。若两个兼容浏览器都不存在，响亮报告浏览器启动失败；该机器不计入“全部功能开箱即用”验收 |

---

## 对「三件套」硬阻塞的当前结论

Obsidian/BRAT 仍只安装 `main.js` + `manifest.json` + `styles.css`。候选插件现已内置下载、哈希校验、原子安装和回滚逻辑，并从固定 Release URL 获取 core 包。以下核心缺口已关闭：

1. `agent-canvas-demo/`、生产依赖与 Skills 随 core 包安装；
2. Ketcher 随 core 包并由本机白名单路由提供；
3. Node 与 Python 随 core 包，不读取系统安装；
4. Bridge token/config/pidfile 自动写入 Vault 外的 per-Vault profile。

Playwright 模块与真实浏览器启动已进入 core 和 L2 发布闸门，不再要求用户手装 browser pack。剩余发布级外部验证是第二台干净 Windows 机器复验，以及真实 Obsidian 的首装/升级/回滚演练；完成前仍不能宣称“全部功能开箱即用”。方案与信任模型见 [`runtime-pack-strategy.md`](runtime-pack-strategy.md)。
