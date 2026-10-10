# Scholarium 执行计划书 v1.3

> 2026-08-14 更新。本文是当前施工顺序与验收标准；对象字段、ID 和关系约束以 [`schema-v1.md`](./schema-v1.md) 为准。旧版 v1.2 的过程记录可由 Git 历史回溯，不再作为实时状态依据。
>
> 2026-08-16 补充（见 §2.4、P4 末尾追加项）：Experiment 数据来源功能与 Evidence `demonstration` 降级已落地；对抗式自我复核基础设施已上线但未接入真实运行；回归套件复核为 423 passed / 0 failed（以上由 Claude 会话核实）。PR #90（数据画像与清洗）与 PR #92（`985945d`，素材库确定性 SVG 绘图）均已合并 `main`；已确认合并版本不含 AI 脚本执行器，边界安全；本地设备工作区待整合后 pull 生效。

## 1. 这份计划如何使用

### 三个真相源

1. **研究对象与证据**：Vault 中 `Research/` 下的 Markdown 对象；已确认对象必须可从 Markdown 读回。
2. **字段与关系契约**：[`schema-v1.md`](./schema-v1.md)。任何新功能不得绕开 `uid`、定位器、审查状态和生命周期约束。
3. **实施状态**：本文件的阶段表，加上回归测试、Vault 校验和 Action Manifest 的实际输出。

Canvas、检索词包、PDF sidecar、RSS 内存缓存、Agent 运行结果都是可重建的视图或索引，不是研究结论的真相源。

### 当前纪律

- 不把 Agent 的建议、模拟数据或检索命中写成已证实的科研结论。
- Agent 可以检索、起草、排序和执行已授权的低风险动作；**不得自动确认/驳回 Evidence，也不得自动改变 Hypothesis 的正式支持或反驳关系**。
- 任何写入都要有明确对象、可读 Markdown、校验与审计记录；批量删除必须先 dry-run，再确认执行。
- 共享工作目录禁止并发修改同一文件。需要并行开发时使用独立 worktree；未通过完整回归不得发布 `main.js`。
- **一次性数据迁移不得静默执行。** 任何会移动、合并、改写或删除用户已有数据的一次性迁移（含"为了兼容旧格式"的自动搬运），执行前必须向用户弹窗明示：将改动什么、改动多少、目标位置、如何撤销，并在用户确认后才动手；迁移完成后必须留下可读的审计记录（参照 `migration-preflight.example.json` 的 preflight 模式：先扫描出清单，再确认执行）。违反此条的先例：2026-08-17 旧版对话被静默并入当前课题，后改为"归档+提示"（commit `5d02c49`）。

## 2. 2026-08-14 当前盘点

### 2.1 工程与发布门槛

| 项目 | 实测状态 |
| --- | --- |
| 构建产物 | `main.js`：1,342,637 字符 / 39,261 行 |
| 回归套件 | **389 passed / 0 failed** |
| 当前发布门槛 | 已恢复全绿；后续每次修改仍必须维持全绿，不能把回归当作可忽略红灯 |
| 保护措施 | CI、分支保护、LF 约束、构建产物完整性检查、Vault schema 校验、Action Manifest 已存在 |

测试已恢复全绿；它仍是每次发布的硬门槛，而不是一次性检查。

### 2.2 Vault 正式对象

最新只读校验：**55 个对象、0 个结构或关系错误**。

| 对象 | 数量 | 当前状态 |
| --- | ---: | --- |
| Project | 1 | 已迁移 |
| Paper | 12 | 已迁移/按需注册的 PDF 存根 |
| Hypothesis | 3 | 全部 `proposed` |
| Experiment | 5 | 3 `concluded`、1 `integrated`、1 `designed` |
| Evidence | 34 | 12 `confirmed`、22 `rejected`、**0 `pending`** |

已确认 Evidence 中有 5 条进入正式支持关系；当前没有进入正式反驳数组的 Evidence。`QUALIFIES` 与 `DEPENDS_ON` 保留为可追溯关系，但不被误记成支持票。

### 2.3 数据与智能能力

| 领域 | 已具备 | 未完成/限制 |
| --- | --- | --- |
| 全文源保全 | 新剪藏 raw / clean / meta 三层、哈希、锚点、状态机 | 22 份历史验证码/访问失败归档需在有合法机构访问时重抓；不阻塞新数据 |
| 文献与 PDF | 12 个 Paper、PDF 盘点、链接安全去重审计、18 份 locator-ready PDF sidecar 试点 | 不批量删除重复 PDF；扫描件/加密 PDF 不能作为可定位证据源 |
| 假设—实验—证据 | 创建、状态流、结果块、实验/论文定位器、人工审查、AI 草案均已运行 | 仍需用带原始数据与条件的真实实验来验证研究结论，而非用演示/模拟结果替代 |
| RSS 雷达 | 单源刷新、全量待评分队列、零分缓存的受保护清理、可选高分自动剪藏、Markdown 镜像 | `Research/RadarScores/` 现有 30 条索引、31 条评分、**人工反馈 0/50**；暂不能校准模型 |
| Agent 控制面 | L0/L1 Action Registry、Action Manifest、Bridge 队列、RSS 三项动作、Research Weaver 与知识图谱的 dry-run/apply 视图 | L2/L3 未发布；任何科学结论确认仍由研究者完成 |

### 2.4 2026-08-16 补充

自 08-14 盘点后的新增进展（本次由 Claude 会话核实并同步，方法：重新从设备拉取最新 `main.js`/相关 `tools/*.js`/`tests/*.js` 后重跑全量回归，而非依赖此前的记忆）：

1. **Experiment 数据来源（`data_origin`）功能已完整落地**：`data_origin: planned | measured | simulated | imported`、`raw_data_refs`、`data_provenance_note`、`data_recorded_by`（须为 `user`）、`data_recorded_at`；`planned` 数据不得进入 `concluded`/`integrated`，`simulated` 数据不得进入 `integrated`。落地过程中一度出现两份并行草案冲突——一份在 Claude 会话中草拟，一份已直接在设备上实现——已确认保留设备上的实现，Claude 会话的草案已废弃，测试已改写为验证真实实现（`tests/experiment-data-provenance.test.js`）。
2. **Evidence 新增 `review_status: demonstration`**：把来源已声明 `data_origin: simulated` 的 Experiment Evidence 从"已确认"降级为"流程演示"，脱离 Hypothesis 正式支持/反驳数组与来源 Experiment 的 `produced_evidence`，但保留定位、主张与原因审计；不得再次进入待审队列。这直接回应了 08-14 提出的"已确认 Evidence 不等于数据真实测量"问题。
3. **对抗式自我复核基础设施上线**：`tools/dual-agent-review.js`（生成→批判→打回→修订的确定性终止判定：`passed`/`blocked_by_rejection`/`stalled`/`exhausted`/`revising`，含防死循环）+ 15 条单测 + 新技能 `agent-canvas-demo/skills/dual-agent-review/SKILL.md` + Research Weaver 试点挂载点（其 SKILL.md §4.5，可选）。**这是单模型自我复核，不是两个独立 Agent**；`docs/多Agent科研探索方法.md` 提出的跨 CLI 真实对抗复核暂未实施，仅完成了下一条的可行性确认。
4. **确认 Bridge 已具备真实多 CLI 执行能力**：`agent-canvas-demo/bridge/server.js` + `bridge.config.json` 已配置 5 个可执行 adapter（`codex`/`claude`/`opencode`/`hermes`/`openclaw`），`allowExecution: true`，`GET /v1/agents` 可探测每个 adapter 是否在 PATH 上可解析并汇报安装状态。这是跨 CLI 对抗复核未来若要做的现成基础，目前未接入第 3 条的复核循环。
5. **回归套件**：2026-08-16 复核为 **423 passed / 0 failed**（较 08-14 的 389 新增 34 条，含以上两批新增测试与另一并发会话的其余改动，例如 `demonstrateEvidence` 相关测试）。
6. **PR #90 已合并到 `main`（数据画像与清洗）**：研究者审核并完成安全配置，CI 通过。启用的三项均为只读或"只读 + 需人工确认后才能执行"：数据画像审计、数据类型识别、清洗方案生成。与本计划一贯的 fail-closed、人在回路原则一致。
7. **PR #92 已合并到 `main`（`985945d`，素材库数据绘图，2026-08-16 研究者核实并更正）**：Claude 会话最初读取的是旧的 `origin/afron` 实验分支（commit `4372c0d`，非当前 `main`），该分支上存在的 `sch-data-transform-runner`（自动改写 CSV 的受控转换器）和 `sch-ai-script-runner`（AI 自主写 Python 脚本并由 Bridge 执行，即便有 AST 静态检查沙箱）**均已被研究者确认排除，不在已合并的 `main` 中**。已合并、真实上线的四项数据能力是：`sch-data-profile-audit`（画像审计）、`sch-data-classifier`（字段分类）、`sch-data-cleaning-plan`（清洗建议生成）、`sch-data-plot`（确定性 SVG 绘图，不经 AI 生成代码）。上线边界：CSV/TSV 上传 → 织研者辅助选字段 → 生成 SVG 图与报告；原始数据只读，不被 AI 改写，也不执行 AI 生成代码。研究者同时提出：后续如需要"确认后清洗数据"的能力，应另开一个独立、安全的受控转换功能重新设计，不恢复旧分支里的 AI 脚本执行器。

**仍未解决，本次同步时确认依旧受阻**：

- P0 第 3 项（按责任人拆分并发改动分别提交）依旧受阻：Claude 会话没有可用的设备端 shell（`device_bash` 全程报 "Workspace unavailable"），无法在设备上执行 `git`。
- Claude 会话仍未获得 `Research/` 目录（真正的 Vault 数据）的访问授权，两次申请均超时未回应；§2.2 的对象计数因此**未在本次复核中重新核实**，仍以 08-14 的数字为准，不代表当前真实状态。

## 3. 阶段总览

| 阶段 | 目标 | 当前判定 | 下一道门 |
| --- | --- | --- | --- |
| Phase 0 | 工程地基 | ✅ 完成 | 后续发布持续维持完整套件全绿 |
| Phase 0.5 | 新剪藏源保全 | ✅ 新数据已完成 | 有访问条件时补抓 22 份历史失败来源 |
| Phase 1 | Schema 与 ID 冻结 | ✅ 完成 | 仅允许有迁移说明的增量契约变更 |
| Phase 2 | 迁移与索引重建 | 🟡 研究对象主体完成，雷达 Markdown 镜像已落地 | 验证 `data.json` 删除/重建演练；不迁移凭据 |
| Phase 3 | 最小研究对象闭环 | 🟡 软件闭环已通；已确认 Evidence 仍需补齐原始数据溯源，不能自动等同真实研究验证 | 用真实实验数据与原始数据引用形成可复核的支持或反驳 Evidence |
| Phase 4 | Agent / Action 控制面 | 🟡 L0/L1 MVP 已可用 | 完成队列发布验收、权限说明与 Run Manifest 汇总；L2/L3 继续冻结 |
| Phase 5 | 雷达闭环与 Benchmark | 🟡 同步与执行路径已有 | 收集 50 条人工反馈后才评估/调参 |
| Phase 6+ | Evidence Engine、知识演化、常驻 Agent | ⬜ 不排期 | 仅在前五阶段稳定且有真实使用数据后评审 |

## 4. 接下来按顺序执行

### P0 — 保持发布绿灯（持续）

**状态**：2026-08-14 已达到 **389 passed / 0 failed**。

**目标**：让工程护栏持续可信，禁止在红灯下继续叠加 UI 或自动化。

1. 每次合并前运行 `node tests/run.js`，验收为 **0 failed**。
2. 检查 Bridge 默认禁用、Token 保护、队列白名单仅含：
   - `rss.refresh_feed`
   - `rss.score_feed`
   - `rss.clip_high_score`
3. 将当前未提交的并发改动按责任人拆分，不混合提交。

**完成定义**：全量测试全绿；没有凭文案绕过安全策略的测试；变更能在独立 worktree 重放。

### P1 — 真实实验验证，而不是继续堆演示对象

**目标**：用已设计的实验产生一条可被复核的真实证据链。

1. 为每个将执行的 Experiment 明确记录：原始数据位置、仪器/样品、对照、重复次数、异常与结论边界。当前 schema 能验证文本与定位器，**尚不能从 Evidence 本身证明数据是实测而非模拟**。
2. 先执行实验室可行的活性物种检验及其必要对照；不可实施的 `EXP-002` 保留为设计，不伪装成完成。
3. 从一个具体结果块创建 Evidence；AI 可以起草 `claim`、relation 和理由，研究者审阅后确认或驳回。
4. 只有在 `concluded`、有实质结果且至少一条 Evidence 经确认后，Experiment 才可推进到 `integrated`。

**完成定义**：至少一条来源为真实实验记录、附原始数据位置或数据文件哈希、定位器可复核、关系经过人工确认的 Evidence；其结论不依赖模拟/占位数据。

### P2 — 关闭 Phase 2 的数据重建承诺

**目标**：让研究层不再依赖含凭据的插件私有 blob。

1. 通过雷达同步将**仅含文章元数据、评分与人工反馈**的投影写入 `Research/RadarScores/`；绝不写 API Key、Token、S3/WebDAV 密码或完整 `data.json`。
2. 对副本执行重建演练：从 `Research/RadarScores/` 读取评分与反馈基线，验证记录完整性和无凭据泄露。
3. 仅在演练通过后，才评估是否缩减 `data.json` 的可再生评分缓存；不得为节省内存删除原始订阅、用户反馈或近期阅读保护窗口。

**完成定义**：索引可从 Markdown 重建；同步、重建和清理均有 dry-run/审计记录；凭据扫描为零。

### P3 — 雷达从“能评分”变成“经校准的评分”

**目标**：先得到人类标注，再谈模型权重、提示词或自动采集阈值。

1. 每次单源评分后可运行受保护的零分缓存清理：只处理确认零分、无反馈、且不在保护窗口内的旧缓存。
2. 每篇被评分文献由研究者给出简单正/负反馈；反馈与对应 Project/Profile version 一起同步。
3. 达到 **50 条人工反馈** 后，计算项目级 precision/recall、覆盖率和探索值表现，再调整权重。
4. 高分自动剪藏保持 opt-in：只抓已可公开访问或当前持久浏览器会话可访问的页面；遇到登录墙只记录失败/重试，不尝试绕过认证。

**完成定义**：反馈不少于 50；校准报告可由 `Research/RadarScores/` 重建；阈值调整有前后对比，而不是凭感觉改分。

### P4 — Agent 与 Research Weaver 的安全交付

**目标**：让织研者能执行已授权的操作，但不把它升级为无人监督的科研决策者。

1. Bridge 仅在设置显式启用、持有本地 Token、且 Action 白名单命中时接受队列请求。
2. 每次真实 L1 Action 写入 `Research/_runs/actions/` Manifest，记录 actor、输入、结果、时间、风险级别与哈希。
3. Research Weaver 的默认调用必须是 dry-run；显式结构化 `{"mode":"apply"}` 才能生成时间戳化的 Canvas/报告视图。
4. Paper Knowledge Graph 只使用已定位的引用关系，输出到 `Canvases/` 与 `Research/WeaveRuns/`；不创建平行 Paper/Evidence 真相源。
5. 保持禁止项：Agent 不得确认/驳回 Evidence、不得改写正式假设关系、不得执行 L2/L3 动作。

**完成定义**：真实队列动作可审计、可拒绝、可定位；Graph/Weaver 输出可删除后重建；没有自动科研确认路径。

**2026-08-16 追加下一步**（承接 §2.4，按建议优先级排列）：

1. 挑一次真实的 Research Weaver 运行，把候选问题草案接入其 SKILL.md §4.5 的对抗式复核试点，产出至少一份 `Research/_runs/review/` 审计记录，验证这套机制在真实草稿上（不只是单测）能收敛，而不只是停在单元测试层面。
2. 补齐 `schema-v1.md` 顶部的修订记录：目前只记到 08-12，08-14 的 `data_origin`/`demonstration` 与本次的对抗式复核基础设施都还没写入修订记录，找个时间统一补一次，避免文档落后于代码。
3. 若要推进"跨 CLI 真实对抗复核"（researcher 与 critic 用不同的 Agent CLI），需要先决定范围：是把已安装但未接入的 CLI（`.cursor`/`.copilot`/`.kimi-code`/`.qoder-cli`/`.marscode` 等）补进 `bridge.config.json` 的 `adapters`，还是先只用已配置好的 5 个（`codex`/`claude`/`opencode`/`hermes`/`openclaw`）做一次真实的两 CLI 配对试跑。这两件事目前都还没做，需要研究者先定范围。
4. 授权 Claude 会话访问 `Research/` 目录，这样才能直接核对 Vault 里的对象与证据现状，而不是依赖另一个会话的转述。
5. 待本地设备工作区的并发未提交改动清理或整合完毕后，`git pull main`（纳入 PR #90 与已确认的 PR #92）并重启 Bridge，让画像审计、字段分类、清洗建议、`sch-data-plot` 绘图这四项已合并但尚未生效的能力真正可被织研者调用；界面上会出现"从素材库数据绘图"入口。
6. 如果确实需要"确认后清洗数据"（即真正改写/落盘处理后数据，而不只是生成建议），按研究者 2026-08-16 的意见另开一个独立、安全的受控转换功能重新设计，不复用旧 `origin/afron` 分支里已被排除的 `sch-data-transform-runner`/`sch-ai-script-runner`。

### P5 — 语料与历史债务（按需，不阻塞主线）

- 有合法访问会话时重抓历史 22 份验证码页，沿用 raw / clean / meta 状态契约。
- PDF 仅扩展到有权威 DOI/URL、文本可稳定提取且与研究问题相关的来源；先做小批可复现试点，再扩大。
- 保留 PDF 去重审计结果。已被 Vault 链接或 basename 有歧义的副本不自动删除。
- 不引入学校专有 WebVPN/CARSI 流程；持久浏览器会话只复用用户自己已完成的认证。

## 5. 明确不做

| 不做的事 | 原因 |
| --- | --- |
| Big-bang 恢复/重写全部 TypeScript | 当前 bundle 有大量已验证行为；采用 strangler 方式逐步抽离 |
| 自动确认或自动驳回科研 Evidence | 出处验证不等于相关性判断；会把 `verified_by_user` 变成装饰 |
| 以 0 分直接删除全部 RSS 文献 | 评分是当前画像下的判断，不是文献的永久价值；仅允许有保护条件的缓存清理 |
| 为历史补抓植入某所高校登录逻辑 | 不可移植，也不能可靠处理出版社认证 |
| 让 Canvas、sidecar、Agent 报告替代 Markdown 对象 | 它们都是重建视图，不承载正式研究关系 |
| 在没有 50 条反馈前“校准”雷达 | 这会用噪声调参，无法衡量改进 |

## 6. 下一次阶段评审的输入

下一次评审不以“又新增了多少功能”为标准，而以以下证据为准：

1. 全量回归是否恢复全绿；
2. 是否形成一条来自真实实验数据的、可定位且已确认的 Evidence；
3. 雷达人工反馈是否接近或达到 50 条；
4. Agent Action Manifest 是否证明每次真实动作都遵守 L0/L1 边界；
5. `Research/` 是否仍可被 `schema-objects` 无错误读回。

满足 1–5 后，再决定是否进入更深的 Evidence Engine、embedding 检索、Question/Claim 等未实现对象，或常驻 Agent。
