# 文献下载链路说明（第 5 步）

面向要改这部分代码的人。所有行号对应当前版本，改动后会漂移，但函数名不会。

---

## 0. 先看这个：三个常见误解

**① `research-pipeline.json` 不是运行时逻辑。**
它从头到尾没被读过。`bridge-ui.js` 里有一行注释明写：

> `research-pipeline.json is documentation only; runResearchPipeline() never reads it at runtime.`

改那个 JSON 不会改变任何行为。真相全在 `bridge-ui.js` 的 `runResearchPipeline()`。

**② SKILL.md 不构成执行许可。**
一个 skill 能不能跑、跑哪个脚本、超时多久，由 `bridge/server.js:162` 的 `SKILL_RUNNERS` 白名单决定。新加 skill 必须在那里注册，否则 Bridge 直接拒绝。

**③ 改脚本不用重启，改前端要重启。**
`skills/**` 下的脚本每次都是新进程 spawn，改完直接生效。
`bridge-ui.js` / `shell-ui.js` / `bridge/server.js` / `start-local.js` 改完必须重启 `npm start`。

---

## 1. 数据流总览

```
第 4 步 reference-export-dedupe
   └─ 产出 literature/exports/deduped-records.json   ← 第 5 步唯一输入
        {"run_at": ..., "records": [{doi, title, venue, pdf_url, landing_page_url, ...}]}

第 5 步（bridge-ui.js 1281–1445）
   │
   ├─ Tier 1  scansci-institutional        ← 主力，静默，走 WebVPN
   │
   ├─ 若 needs_login → paper-downloader mode=auto_login → 重试 Tier 1
   │
   ├─ Tier 2  paper-downloader             ← 浏览器兜底，只跑 Tier 1 的差集
   │
   └─ 合并 → downloadedPaths（本轮 PDF 路径，去重）
        ├─ 第 6 步 nature-reader  ← {pdf_paths: downloadedPaths}
        ├─ 第 9 步 zrl-knowledge-graph ← {card_source_paths: downloadedPaths, graph: Agent语义抽取}
        └─ 第 10 步 deep-research ← {card_source_paths: downloadedPaths}
```

`downloadedPaths` 很关键：第 9/10 步靠它把本轮证据卡片和往期卡片区分开。
`literature/evidence-cards/` 是跨轮次累积的，卡片里**没有 DOI 字段**（只有
`id / source_path / evidence_tier / claim_candidates / reader / limitations`），
所以圈定范围只能按 `source_path` 的文件名做。不传这个参数就会退回「读取整个目录」，
手稿会混进上一个课题的证据。

---

## 2. 主控代码：`bridge-ui.js`

函数 `runResearchPipeline()`，**1050 行**开始。第 5 步在 **1281–1445**。

| 行 | 作用 |
|---|---|
| 1281 | 声明 `results5 / downloadedPaths / downloadedCount` 等出口变量 |
| 1282 | `if (settings.runDownloadStep)` — 下载总开关（设置面板可关） |
| 1283 | `dedupedPath` = 第 4 步产出的 JSON |
| **1299** | **Tier 1**：`runPipelineSkillWithRetry(skills, 'scansci-institutional', dedupedPath, 1)` |
| 1300 | `pollDownloadProgress(rowInst, instRun)` — 挂进度条 |
| 1308–1324 | 会话过期自愈：`auto_login` → 成功则 1318 行重试 Tier 1 |
| 1326–1338 | 解析 Tier 1 结果，写步骤行 |
| 1341–1344 | 算差集：`dedupeRecordsForDownload(combined)` 减去 Tier 1 已拿到的 DOI |
| **1358** | **Tier 2**：`runPipelineSkill(skills, 'paper-downloader', step5Input)` |
| 1366–1373 | 合并结果、按论文数（非尝试次数）计数 |
| 1389–1440 | 汇总行 + 证据安全停止（本轮 0 篇则中止，不生成手稿） |
| 1441 | 关闭下载时的分支说明 |

**辅助函数**（同文件）：

| 行 | 函数 | 作用 |
|---|---|---|
| 523 | `pipelineSkillId()` | 按 slug 找 SKILL.md，优先本项目目录 |
| 539 | `runPipelineSkill()` | POST `/v1/skills/run` |
| 546 | `runPipelineSkillWithRetry()` | 同上，失败返回 `{manifest:{error}}` 而不抛 |
| 585 | `DOWNLOAD_PROGRESS_PATH` | `Scholarium/runtime/download-progress.json` |
| 598 | `renderProgress()` | 画进度条 |
| 612 | `pollDownloadProgress()` | 1.5s 轮询；用 `started_at` 排除上一轮的陈旧文件 |
| 650 | `refreshWebvpnSession()` | 「登录/刷新 WebVPN」按钮：先 auto_login，失败回落手动 |
| 725 | `normalizeDoiKey()` | DOI 归一化（去 `https://doi.org/`、小写） |
| 730 | `dedupeRecordsForDownload()` | 复刻 export_dedupe.py 的去重键，用于算差集 |
| 753 | `PIPELINE_SETTINGS_DEFAULTS` | `runDownloadStep` / `downloadHeaded` 等开关的真实默认值 |

---

## 3. Tier 1：`scansci-institutional`

```
skills/scansci-institutional/scripts/scansci_download.js   ← Node 外壳
skills/scansci-institutional/scripts/shibboleth_login.py   ← entityID 深链
```

Node 外壳负责解析输入、定位 Python、把一段**内嵌 Python**（`const PY`，87 行起）
喂给解释器。内嵌 Python 调 `scansci_pdf.sources.batch_download()`。

### 3.1 运行时补丁（不改 site-packages）

补丁写在内嵌 Python 里，pip 升级冲不掉，结果会出现在 manifest 的 `patches` 字段——
将来 scansci-pdf 改了内部函数名导致补丁失效，你能直接看见。

**补丁 1（~150–173 行）：机构名**
`publisher_strategies._IDP_MAP["中国科学技术大学"]` 出厂值是 `"USTC"`，填进出版商的机构
搜索框匹配不上。改成全称，**同时**把 `_school_auth_patterns` 钉死返回 `("ustc",)`——
因为同一个 dict 还被用来派生 IDP **URL** 匹配 token，只保留长度 >3 的词，换成全称会变成
`("university","science","technology","china")`：既匹配不到 `ustc.edu.cn`，又会误伤一大片。

**补丁 2（~176–343 行）：层级顺序**
`instsci.try_instsci()` 出厂顺序是**浏览器优先**（1087 行）、HTTP 兜底（1096 行），
且 `headless=False` 硬编码在 718 行（连配置里的 `browser_headless` 都不读）。
结果是每篇论文弹一个可见 Chrome，而带 WebVPN cookie 的静默 HTTP 路径被饿死。

补丁把两层对调。**打补丁的位置有讲究**：`vpnsci.py:20` 是
`from .instsci import try_instsci`，自己持有引用，改外层函数无效；但 `try_instsci` 函数体内
是按**模块全局**查找 tier 的，所以重绑 `instsci._try_instsci_browser` 能穿透。

打完补丁后的实际顺序：

```
HTTP（WebVPN 改写 URL + cookie，静默）
  └─ 失败 → 出版商机构登录（每个出版商每轮只跑一次，信号量串行）
       ├─ shibboleth_login.py   entityID 深链
       └─ webvpn_auto_login.py  --mode publisher（选择器方案）
            └─ 成功后回到 HTTP 重下
                 └─ 仍失败 → scansci 自带 CARSI 浏览器（默认关闭）
```

### 3.2 输入参数

```json
{
  "records": [{"doi": "..."}],        // 或 "dois": [...]，或传 deduped-records.json 路径
  "output_dir": "literature/downloaded-pdfs",
  "use_vpnsci": true,
  "allow_browser": true,              // false = 只跑 HTTP，永不弹窗（止血开关）
  "browser_workers": 1,               // 同时最多几个浏览器窗口
  "publisher_login": true,            // 用 webvpn_auto_login.py 走出版商流程
  "publisher_login_timeout": 300,
  "shibboleth_login": true,           // entityID 深链
  "entity_id": "https://idp.ustc.edu.cn/idp/shibboleth",
  "scansci_browser_fallback": false   // 把 scansci 自带 CARSI 浏览器开回来
}
```

### 3.3 输出

```json
{
  "results": [{"status": "downloaded|needs_login|access_denied|not_found|error",
               "path": "...", "doi": "...", "source": "WebVPN"}],
  "downloaded_paths": ["..."],
  "patches": ["idp_name=full_english+auth_patterns_pinned", "tier_order=http_first,..."],
  "needs_login": true,                // 会话过期时才有，触发上层自愈
  "requested": 74
}
```

### 3.4 进度文件

`Scholarium/runtime/download-progress.json`，每篇写一次（`os.replace` 原子写入，
多 worker 加锁）：

```json
{"done": 39, "total": 74, "downloaded": 18, "failed": 21,
 "resolved": 39, "skipped_or_resumed": 0, "current": "10.1021/...",
 "status": "running|finished|needs_login|error", "started_at": 1754...}
```

注意 `done ≠ downloaded + failed`：`batch_download` 的 `done` 包含 resume 跳过的条目，
那些不触发回调。差值放在 `skipped_or_resumed`。

---

## 4. Tier 2：`paper-downloader`

```
skills/paper-downloader/scripts/browser_downloader.js
```

一个文件五种模式，`main()` 在 729 行：

| 模式 | 行 | 用途 |
|---|---|---|
| `direct_cookie_jar` | 734 | 旧的 Netscape cookie 罐下载（仅限已知直链 PDF） |
| `auto_login` | 741 | 调 `~/.scansci-pdf/webvpn_auto_login.py` 全自动 CAS 登录 |
| `dry_run` | 762 | 只解析不下载 |
| `session_status` | 841 | 查登录态 |
| `login` | 870 | 手动浏览器登录 |
| （默认） | — | 下载：Playwright 持久化 profile 打开 URL 抓 PDF |

### 4.1 关键函数

| 行 | 函数 | 说明 |
|---|---|---|
| 41 | `hasWebvpnTicket()` | 判断 jar 里有没有 `wengine_vpn_ticket…` |
| 52 | `scansciTargets()` | 解析 scansci-pdf 的 cookie 文件路径（含 `_cfg` 的空串陷阱） |
| 85 | `exportScansciSession()` | 把 Playwright 会话导出成 scansci 读的三种格式 |
| 119 | `webvpnPageState()` | 页面分类：`portal` / `login` / `unknown` |
| 143 | `webvpnCredentialsAvailable()` | 启动前检查凭证，避免脚本卡在 `input()` |
| 183 | `runAutoLogin()` | 派生 webvpn_auto_login.py，再用 `_validate_session` 复核 |
| 252 | `waitForWebvpnLogin()` | 三条件登录判定（见下） |
| 317 | `loadJournalWhitelist()` | 期刊白名单（硬编码指向 `T:\...\期刊分区白名单\`） |
| 414 | `urlsFrom()` | **把每条记录展开成多个 URL** — 计数口径差异的根源 |
| 673 | `downloadOne()` | 单个 URL 的下载与分类 |

### 4.2 登录判定为什么是三条件

必须**同时**满足，然后再做一次主动探测：

1. `wengine_vpn_ticket…` cookie 存在
2. 当前页在 `wvpn.ustc.edu.cn` 而非 `id.ustc.edu.cn`
3. 重新打开门户仍停在 `wvpn.ustc.edu.cn`（不被弹回 CAS）

两条便宜信号单独用都会骗人，方向还相反：

- **URL 子串不能用**：CAS 登录成功后的落地页是
  `https://wvpn.ustc.edu.cn/login?cas_login=true`，本身带 `login`。
  「URL 不含 login/cas/sso」永远不触发——scansci-pdf 自带的
  `browser_login.open_login_browser` 就死在这里，空转到 `max_wait=600`，
  用户关窗口后反而报 "Browser closed by user"，一个 cookie 都不存。
- **只看 ticket cookie 也不能用**：它的寿命比签发它的 CAS 会话长得多。
  只认 cookie 会导致窗口一闪而过、报告成功、然后导出一份**死会话**——
  这比不导出更糟，因为机构通道会以为自己有 cookie，于是逐篇失败而不是干脆报
  `needs_login`。

### 4.3 cookie 双向同步

- 登录/下载成功后 → 导出到 `~/.scansci-pdf/cache/`（`instsci-cookies.json`、
  `.txt` Netscape、`browser_state.json`），供 Tier 1 使用。
- 出版商登录可能全程不碰 `wvpn.ustc.edu.cn`，直接覆写会**丢掉 WebVPN ticket**，
  所以写回时按 `(name, domain, path)` 做并集，新的赢。

---

## 5. Bridge 调度层：`bridge/server.js`

| 行 | 内容 |
|---|---|
| **162** | `SKILL_RUNNERS` — 唯一的执行白名单 |
| 279 | `spawnCollect()` — 异步 spawn，返回结构对齐 `spawnSync` |
| 308 | `executableSkill()` — 派发；`isWebVpnLogin` 分支走 detached |
| 479 | `POST /v1/skills/run` |
| 606 | `GET /v1/workspace-file` — UI 轮询进度文件用的只读接口 |

下载相关的两条注册：

```js
'paper-downloader':      { script: 'browser_downloader.js', argsShape: ['root','input'],
                           timeoutMs: 1800000, async: true },
'scansci-institutional': { script: 'scansci_download.js',   argsShape: ['root','input'],
                           timeoutMs: 2400000, async: true },
```

`async: true` 是必须的。`spawnSync` 会阻塞 Node 单线程事件循环——下载跑 30 分钟，
Bridge 就 30 分钟答不了任何请求，进度条根本轮询不到。只有这两个慢任务是异步的，
其余 10 个步骤仍是 `spawnSync`，超时/清理行为不变。

另外 `start-local.js:19` 的 `LONG_BRIDGE_TIMEOUT_MS = 45min` 必须大于最大的 runner
预算（40min）。原来是 240 秒，代理会在 4 分钟切连接返 504，UI 报「机构通道不可用」，
而下载其实还在正常跑。

---

## 6. 密钥与凭证

| 文件 | 用途 |
|---|---|
| `<vault>/Scholarium/secrets/*-api-key.txt` | openalex / pubmed / semantic-scholar / scopus / lens |
| `<workspace>/Scholarium/runtime/webvpn-browser-profile/` | Playwright 持久化 profile |
| `<workspace>/Scholarium/runtime/webvpn-login-status.json` | auto_login 结果（UI 轮询） |
| `~/.scansci-pdf/config.json` | `vpnsci_enabled` / `vpnsci_school` / `vpnsci_base_url` |
| `~/.scansci-pdf/cache/instsci-cookies.json` | WebVPN cookie（Tier 1 的 HTTP 路径读它） |
| `~/.scansci-pdf/webvpn_credentials.json` | **明文账号密码**，auto_login 用 |

密钥查找会**向上逐层**（最多 6 层）。新建研究主题会把工作区指向子目录，
而 `Scholarium/secrets/` 不跟着搬——密钥是「研究者级」不是「课题级」的，
所以继承父目录的副本是正确行为。

---

## 7. 已知问题与可改的地方

**① 出版商反爬是硬墙，不是页面结构问题。**
实测 Wiley：`/action/ssostart`、`/Shibboleth.sso/Login`、**以及普通文章页**
`/doi/10.1002/anie.202106259` 三者全被 Cloudflare 拦。ACS 同样。
所以「把每家出版商的机构登录页面都学一遍」解决不了——自动化浏览器根本进不了门。
上一轮的 20 条 `anti_bot_challenge` 是这个原因。

可以尝试的方向：
- Tier 2 从 headless 改成有头 + 复用真实 Chrome profile（headless 是强反爬信号）
- 拦不住的导出成人工队列（DOI + 直达链接），别让脚本反复撞墙

**② 正规 OA 源还没接进来。**
`skills/paper-downloader/scripts/api_resolver.js` 已经存在，做的正是
PubMed/OpenAlex/S2/Scopus → OA PDF 解析，但 Pipeline **从没调用过它**。
插在 `bridge-ui.js:1299` 之前是提高填充率最省事的切入点，不用新写代码。
Unpaywall / Europe PMC / CORE / arXiv 都无反爬、比 WebVPN 更快、完全合法。

**③ 盗版镜像不在选项内。**
`BANNED_DOMAINS` 正则 + 每次调用强制 `scihub_enabled=False`，两处都是有意的硬规则。

**④ 重复下载。**
`urlsFrom()` 把每条记录展开成 `pdf_url` + `landing_page_url` + `doi` 多个 URL，
同一篇会被存成 `x.pdf` 和 `x-2.pdf`。某轮 86 个新文件里只有 35 个唯一内容，
还混进了 `41560_2019_490_MOESM1_ESM.pdf` 这类补充材料。
计数已经改成按论文算，但**文件本身仍然重复**，值得在 `savePdfBuffer` 里加内容哈希去重。

---

## 8. 改动检查清单

```bash
cd .obsidian/plugins/obsidian-scholarium/agent-canvas-demo
npm run check          # 语法：含 skills 下三个 JS
npm test               # tests/embedded-python.test.js + local-launcher.test.js
```

`tests/embedded-python.test.js` 专门守一个坑：**内嵌 Python 里不能出现反引号**。
它宿主是 JS 模板字符串，注释里一个 `` ` `` 就会提前闭合字符串，
症状是运行时报 `SyntaxError: Unexpected identifier`。这个坑踩过两次。
该测试做过变异验证（注入 bug 确认会红）。

注：`tests/local-launcher.test.js` 的第 5 项（draft notes）是**既有失败**，
与下载链路无关，改动前后都是红的。
