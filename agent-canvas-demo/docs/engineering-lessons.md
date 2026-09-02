# 工程经验记录（engineering-lessons）

## 2026-09-01：知识图谱审核发布车道 2/3 项实现——已写代码与测试，本次未能实际执行验证

**背景**：验收给出的执行顺序是 2（Project/EXP 只读投影 adapter）→ 3（可编辑审阅卡 + 版本化 preview→confirm 发布）→ 4（隔离课题端到端验收）。本条记录的是 2、3 两项的实现，走的是与前一轮"重建 P1"完全一致的规划流程：先派 Explore 侦察真实调用链（P2 目前怎么被触发、写入现状、EXP/Project 真实字段、既有 AI-proposes/human-confirms UI 先例），再落一份具体计划，逐条对照实现。

**实现（2）**：新增 `graph-projection-core.js`（纯函数，镜像 `seed-reconstruction-core.js` 的壳）——`buildProjectGraphProjection({project, experiments})` 把已存在的 Experiment 对象投影成 `execution`/`observation`/`claim` 节点：`result` 非空才生成 `observation`，`conclusion` 非空**且** `status` 已到 `concluded`/`integrated` 才生成 `claim`，任一字段缺失就不生成对应节点；`data_origin: simulated` 的节点如实在描述里标注"模拟数据"；每条边的 `evidence` 只填 `source_path`/`locator`（指向真实 EXP 文件与字段名），不填 `quote`——按已收紧的门槛会如实渲染为 `inferred`，这是设计如此，不是待修的问题。`mergeGraphDrafts()` 按节点 id 去重合并语义抽取图与投影图。

**实现（3）**：`render_graph.py` 加了两个纯新增、默认行为不变的能力——`--dry-run`/`payload.dry_run`（跑完整套 `normalize_graph()` 含引文核验，只打印不写盘）和 `payload.output_subdir`（不传时行为与今天完全一致，传了才重定向到 `knowledge-graph/runs/<run-id>/`，绝不覆盖现有的 `knowledge-graph/knowledge_graph.json`）。`bridge/server.js` 新增 `GET /v1/knowledge-graph/project-objects`（用 `tools/research-state.js` 的 `indexVault()` 直读未截断的 Project+Experiment 字段——`project.get` 的 `experiments` 是截断摘要，不能用）和一对 preview→confirm 端点（`POST /v1/knowledge-graph/publish/preview`/`.../:id/commit`，镜像 `/v1/full-tasks` 的一次性 previewId 校验模式，而不是 `/v1/drafts/batch`——发布产物是 JSON/HTML/Markdown，不是 schema-v1 的 `.md` 对象）。新文件 `graph-review-ui.js` 是完整的审阅弹窗：语义抽取（直接复用 `bridge-ui.js` 已有的 `requestAgentKnowledgeGraph()`，未改动）+ 投影合并 → dry-run 校验预览（通过既有 `/v1/skill-runs` 派发，但没有复用 `runPipelineSkill()`——那个函数绑定了运行对话框的 `activeRunControl` 单例状态，本弹窗是独立简单 `<dialog>`，自己写了一个不牵扯那套状态的轻量轮询）→ 逐节点/逐边可编辑审阅卡（`review_status` 徽章直接显示 dry-run 的真实核验结果，不是另一套猜测）→ 发布预览 → 确认发布。

**如实说明验证边界（比上一轮更严重）**：本次全程同样被沙箱安全分类器故障挡住，但这次连一次真实执行窗口都没有出现过——上一轮修复 `supported` 门槛时中途 Bash 短暂恢复过一次，让走查结论被真实验证；这次自始至终没有跑成过 `node -c`、`node --test` 或 `python`，**代码从未被解释器看过一次**。做了两轮手工通读（一次写完即查，一次专门回读 `graph-review-ui.js` 全文），过程中确实发现并修正了一处真实问题（`openGraphReviewDialog` 里一段多余包了一层 async IIFE 的 `project.get` 调用，逻辑上不算错但明显偏离本仓库其它文件的写法，已改成和 `seed-reconstruction-ui.js` 一致的独立 `project()` 小函数）。**但手工通读找到的是"看起来不对"的问题，不能代替解释器对语法错误、拼写错误、作用域错误的确定性检查**——下一次有真实执行环境时，第一优先级必须是：
1. `node -c bridge/server.js`、`node -c graph-projection-core.js`、`node -c graph-review-ui.js`（先确认没有语法错误，这是比单测更基础的一层）；
2. `node --test tests/graph-projection-core.test.js tests/knowledge-graph-core.test.js tests/graph-review-publish-endpoint.test.js`；
3. 全量 `npm run verify`；
4. 全部通过后，才进入第 4 项——用隔离测试课题真实点一遍面板（身份读取 → 生成草案 → dry-run 审阅卡 → 编辑/拒绝一条边 → 发布预览 → 确认），确认 `knowledge-graph/runs/<runId>/` 落盘正确、现有 `knowledge_graph.json`（如果存在）字节不变、没有触碰 PRJ-002 或任何真实课题。

在此之前，这批改动应被视为"设计完整、逻辑走查过、但未经解释器和真实运行验证"的状态，不能提交为"已完成"。

**教训**：
- 手工代码走查是有真实价值的（上一轮和这一轮都在没有执行环境的情况下抓出了真实问题），但它的置信度上限明显低于"哪怕跑一次 `node -c`"——语法/拼写/作用域这类问题，走查会系统性地漏掉，因为人眼读代码时会不自觉地"脑内纠正"小错误，而解释器不会。两种方法应该被清楚地标注为不同置信度的证据，不能因为上一轮走查最终被验证对了，就把这一轮也默认当作同等可靠。

## 2026-09-01：知识图谱 `supported` 证据门槛收紧（人工走查，未实机执行）

**背景**：验收把知识图谱设计方向判为"核心渲染与引文防线通过；人工审核并入闭环尚未完成"，并指出一个具体真实缺口：`render_graph.py` 的 `normalize_graph()` 里，一条边只要带 `source_path`/`locator` 但没有 `quote`，仍会保留模型自称的 `review_status: supported`——原代码对每条 evidence 逐一验证 quote，但当 `quoted = [e for e in evidence if e["quote"]]` 为空列表时，验证循环根本不会执行，`review` 变量就停留在函数开头的初始猜测（`"supported" if evidence else "inferred"`）上，从未被真正验证过。

**修复**（`skills/zrl-knowledge-graph/scripts/render_graph.py`）：改为显式统计 `verified_any`——只有至少一条 evidence 的 quote 经 `quote_verify.verify_quote()` 真正验证通过，边才能是 `supported`；`quoted` 为空但声称 `supported` 时新增一条警告并强制降级为 `inferred`。同步更新了两处调用方文档以免继续误导：`knowledge-graph-core.js`（给 Agent 的抽取 prompt）第 6 条，以及 `SKILL.md`——明确告诉 Agent「`synthesis`/`claim` 这类不带 quote 的 `supports`/`contradicts` 边现在会如实显示为 `inferred`，不要为了显示 `supported` 而编造引用；EXP 实验记录要支持 `supported`，需要另一种可验证证据类型（`EXP uid` + 版本/hash + 结果块 locator），而不是绕过引文门槛」，这与验收意见的表述完全对应。

**测试**：在权威的 `tests/knowledge-graph-core.test.js`（`npm test` 实际会跑，通过 `spawnSync('python', ...)` 调用真实渲染器）里新增一条用例，直接复现"locator 有、quote 无、声称 supported"的场景，断言警告文案与最终 `review_status: inferred`；同时对已有的两条 quote 校验用例（真实 quote 保持 supported、伪造 quote 降级）做了逐行人工走查，确认新逻辑不会让它们变红。另在 `skills/zrl-knowledge-graph/scripts/test_render_graph_supported_threshold.py` 补了一个独立、无框架的 6 用例自测脚本（沿用 `quote_verify.py` 自身 `__main__` 自测的约定）——这一步是必要的，因为 `npm run verify` 目前只跑 `tests/*.test.js`，本仓库没有把 Python 侧的技能脚本纳入自动回归，这是一个应该单独记录、以后要补的缺口，不属于本次改动范围。

**如实说明验证边界**：本次改动全程被同一次沙箱安全分类器故障挡住，Bash/PowerShell 全程不可用，**没有一次真正跑起来 `python`、`node --test` 或 `git`**。以上"应当通过"全部来自逐行手工走查代码路径（对着每条测试用例手算 `normalize_graph()` 的执行结果），不是已执行的事实。下一次有真实执行环境时，第一件事应是跑 `node --test tests/knowledge-graph-core.test.js` 和 `python skills/zrl-knowledge-graph/scripts/test_render_graph_supported_threshold.py`，把这次的推断换成真实绿/红结果。

**关于验收报告里"图谱审核发布车道"其余四项（Project/EXP 只读投影 adapter、可编辑审阅卡、preview→confirm 发布、隔离课题端到端验收）**：这些是net-new 的多文件功能实现，规模与本会话早前的种子文献重建工作流相当。在完全无法执行任何代码的情况下继续手写这类规模的新功能，风险和"手工走查代替真实验证"完全不是一回事——后者是对已写代码的静态复核，前者是把从未跑过一行的新代码直接摆到会真实写入研究者 vault 的工具里。本次只完成了范围明确、改动集中在一个函数的 bug 修复（第 1 项），其余四项留给下一次有真实执行环境（无论是这个会话解除限制，还是研究者自己的会话）时再做，且必须按验收报告给出的顺序逐项做完再合并，不要在没有执行验证的情况下一次性铺开。

**教训**：
- 遇到"能看代码但不能跑代码"的环境限制时，优先做范围最小、影响面最集中的修复（一个函数的逻辑 bug），而不是在同一次受限条件下强行推进大规模新功能——前者的手工走查置信度高，后者的手工走查置信度会随代码量线性下降，越权衡越不划算。
- 一处 bug 修复如果被多处文档/prompt 复述过（这次是渲染器代码本身、给 Agent 的抽取 prompt、SKILL.md 三处都描述了"不带 quote 的边"的行为），必须三处一起改，否则会出现"代码已经改对、但 Agent 和文档还在按旧规则做事"的新裂缝。

## 2026-09-01：种子文献驱动的 P1 证据重建——原生工作流首次实现与独立验收

**背景**：本会话早前手工跑通了一次"种子 DOI → 引用链候选 → 相关性/白名单审计 → 全文获取 → Paper/Evidence/Decision 准入"（PRJ-002, Dao 2020/2021），但全程依赖外部 Claude Code 会话的 ad-hoc 工具，不是织研者的原生能力。项目所有者要求产品化，边界拍板为：不新增 full-lane 类别（`fetch_and_attach_pdf` 保持唯一）、Agent 不得直接改写既有 vault 对象、Agent 只交付"审阅包"而不自动构造草案，入库与否由研究者在面板逐项编辑/勾选后才发生。

**实现**：新增 `seed-reconstruction-core.js`（纯函数核心，镜像 `project-mode-core.js` 的壳模式：身份门 `identityGateCheck`、候选发现 prompt/parser、确定性白名单判定 `checkJournalWhitelist`、内容准入 prompt/parser、审阅包组装 `buildReviewPackage`、仅在研究者确认后运行的 `buildAdmissionDrafts`）与 `seed-reconstruction-ui.js`（项目面板弹窗，串起身份确认→候选勾选→逐篇 full-lane 下载→内容准入→审阅编辑→草案预览→原子提交）。`bridge/server.js` 新增运行记录（`POST/GET/PATCH /v1/seed-reconstruction*`）、确定性白名单（`POST /v1/literature/whitelist-check`）和 DOI 去重（`POST /v1/seed-reconstruction/dedup`）端点，均不复制已有派发/写入逻辑——阶段 A/B/D 复用现有 `POST /v1/tasks`（只读），阶段 C 复用现有 `fetch_and_attach_pdf` 预览/派发，阶段 F 复用现有 `/v1/drafts/batch`。`full-lane-ui-core.js` 补了 `buildFetchAndAttachPreviewBody`/`buildFetchAndAttachDispatchBody` 两个纯函数，把此前只内联在 `bridge-ui.js` 两处点击处理里的请求体拼装抽出来，让新调用方（阶段 C 逐篇派发）不必复制一份；原有两处调用改用这两个函数，行为不变。

**一处发现即改的既有数据关联**：设计过程中一个背景 Plan agent 复核发现 `tools/evidence-agent-review.js` 已经实现了 schema-v1 §4.5 冻结的 `ai_review`（decision/relation/claim/reason/model/reviewed_at/prompt_sha256）审阅词汇——这正是"AI 可以建议、不能自动确认"这条规则在字段层面的既有落地。`buildAdmissionDrafts` 因此改为接受调用方（Bridge 端，用 `evidence-agent-review.js` 的 `makeReview()`）预先构造好的 `ai_review` 对象并原样透传，不重新发明一套审阅词汇；核心函数本身仍保持环境无关（不 `require('crypto')`），quote_hash 之类的哈希计算同样由调用方预先算好传入（浏览器端 `crypto.subtle.digest`，Node 端可用 `crypto.createHash`）。

**已做的验证，以及本次会话未能完成的部分（如实记录，不打包成"已验收"）**：
- 通过手动逐行走查 `tools/schema-objects.js` 的 `validateObject()` 源码（REQUIRED 字段、`ai_review`/`locator` 的条件校验、`evidence`/`decision`/`paper` 各自的额外约束），确认 `buildAdmissionDrafts` 生成的 Paper/Evidence/Decision 草稿在字段形状上应当零错误通过校验；也手动逐条走查了新增的 `tests/seed-reconstruction-core.test.js`（16 个用例）与 `tests/seed-reconstruction-endpoint.test.js`（10 个用例）的执行路径，修正了一处走查中发现的测试期望错误（"内容准入分析丢弃引用不存在假设的 finding"误写成整篇论文被丢弃，实际行为是只丢该条 finding，论文本身保留空 findings 数组）。
- **本次会话全程被一次沙箱安全分类器（MiniMax-M2.5-highspeed）故障挡住，Bash 与 PowerShell 全部不可用，因此 `node --test` 一次都没能真正跑起来**——以上"应当通过"是基于源码走查的推断，不是已验证的事实。下一次会话打开时，第一件事应该是跑 `node --test tests/seed-reconstruction-core.test.js tests/seed-reconstruction-endpoint.test.js tests/chat-actions-core.test.js tests/full-lane-ui-core.test.js` 外加全量 `npm test`，把这次的推断换成真实的绿/红结果，再决定是否需要改动。
- UI 部分（`seed-reconstruction-ui.js`，八个阶段的弹窗编排）完全没有过浏览器/真实 Obsidian 面板验证——按 `project-mode.js`/`bridge-ui.js` 的既有调用约定手写，但从未真实点击过一次。下一次会话若要推进这个功能到可用状态，必须先用真实 Bridge + 真实 Agent + 一个专用临时测试课题（不要碰 PRJ-002）走一遍全部八个阶段，比照本仓库"M3 P3-P5 首次验收用 PRJ-004"的隔离方式（见 2026-08-31 条目）。
- P2 版本化图谱目前只实现了 `input-manifest.json` 的原子写入；图谱正文（`knowledge_graph.json`/`.html`/`.md`）如何接到现有图谱生成管线、只用本轮准入的精确输入而不重新扫描目录，这一步的具体调用契约本次没有追踪清楚，代码里明确留了一句面向用户的提示，没有假装已经接通。

**后续独立验收与收紧（同日）**：
- 真实执行 `node --test` 专项套件、`npm run verify` 和根目录 `node tests/run.js`，结果分别为 **51/51、275/275、609/609** 通过；语法检查与 `git diff --check` 也通过。此前“未执行”的记录保留为当时状态，不能倒写成当时已验收。
- 浏览器实际打开 `http://127.0.0.1:4173`，展开 PRJ-002 后确认入口显示为“从种子重建 P1（P2 待接入）”；弹窗显示真实工作区、种子 DOI 输入与“Project 标题 ↔ topic.json.name 不一致即阻断”的身份门说明。此检查没有填写 DOI、没有派发 Agent、下载或写入。
- 走查发现并修正三处会破坏“研究者审核后再并入”的问题：审阅包现保留候选发现阶段的题名/期刊/年份/作者与来源摘录，且这些字段都可编辑；Evidence 的目标 Hypothesis 也可由研究者重选；已有 DOI 现在通过 vault L0 扫描真实检测、在界面中锁为仅查看/跳过，并由草稿构造器二次拒绝，不能绕过 UI 新建重复 Paper。候选书目信息写进 HTML 属性前也增加了引号转义。
- P2 没有真实图谱生成器，不能把单独的 `input-manifest.json` 说成图谱。已撤下会写 manifest 的按钮和路径，P1 准入结束页明确说明 P2 尚未接通；未来应等“精确输入 → 真实图谱产物 → 版本目录 → 单独 preview/confirm”完整实现及隔离验收后再开放。

**隔离真实 Agent 验收的未完成结果（同日）**：在 PRJ-002 已授权工作区下建立了一个只含 `topic.json` 的临时子目录，使用假项目身份（标题与 `topic.json.name` 一致）真实调用本机 Bridge 的 `POST /v1/seed-reconstruction` 与只读 `POST /v1/tasks`，种子为 Dao 2020 DOI。候选发现 Agent（Claude，只读）在 240 秒内没有返回；为避免留下悬挂任务，按已核对的子进程 PID 终止。运行记录当时仍为 `discovering`，`downloads: 0`、`admitted_inputs: 0`、`selected_dois: 0`，没有触发 full-lane、没有调用任何 drafts/batch 端点。验收脚本、运行记录和临时 `topic.json` 已清除；空目录因本机删除策略拦截而保留。这不是“工作流错误”的证据，也绝不是“全链路验收通过”；下一步应先诊断只读 Agent 的超时原因，或用一个明确有界、可观察的真实候选来源重新运行该隔离验收。

**隔离验收追记（同日）**：根因是开放式提示词与批量 JSON 适配器的组合，而不是已知挂死：候选发现 prompt 原先没有工具调用预算，plain `claude` 的 `--output-format json` 又只在退出时返回数据。收紧为“整轮最多 5 次检索/抓取、优先单次返回多条书目/引用关系的 REST/API、达到上限立即返回”后，同一只读任务约 25 秒结束；其最终结果是显式 `{"candidates":[]}`。这说明超时修复有效，但也暴露另一个正常状态：零候选不应被误报为“来源门失败”。解析器现将显式空列表识别为诚实的预算受限结果，UI 显示“无可核查候选，结束/换种子”，不再进入下载。该次同样没有 full-lane、drafts/batch 或 vault 写入；临时脚本、topic 和运行记录已清除。全链路验收仍未完成，当前真实缺口是“给定种子在受限检索下没有发现候选”，下一次应选用一个已验证可经 API 返回引用关系的种子或在用户提供明确引用来源后重跑。

**Crossref 来源读取补验（同日）**：Dao 2020 的 `GET /works/10.1039/D0TA00811G` 在 Bridge 宿主可稳定返回 62 条带 DOI 的 backward references 和 67 次被引；但 Claude 的只读 `WebFetch` 即使精确允许 `WebFetch(domain:api.crossref.org)`，仍在实际请求前被企业/Claude 安全策略拒绝（无 WebFetch 事件）。因此不再靠提示词要求 Agent “先查 Crossref”，而是新增固定域名、固定 DOI 路径、GET-only 的 Bridge L0 读取 `GET /v1/literature/crossref/works/:doi`：它只返回规范化种子/参考文献 manifest，并把该 manifest 记入本轮运行记录；Agent 禁止再联网，只对已记录来源做相关性初筛。隔离真实任务已返回非空、可追溯的 Dao 2019 同作者链（包含 `10.1039/C9TA09333H` 和 `10.1016/j.jcat.2019.07.054`），未触发下载、草稿或 vault 写入。

**第二道来源保真收紧**：真实回复一度把 Crossref 缺失的题名补写成似是而非的文字，并把无题名的背景文献泛化为“方法学候选”。最终解析器不再信任 Agent 的书目信息：候选 DOI 必须存在于本轮 manifest、`source_query` 必须等于已记录 endpoint、展示的题名/期刊/作者/年份由 manifest 强制回填；题名缺失时，只有与种子作者姓氏精确匹配的条目才能保留。候选发现阶段的 `exclude` 项不会进入下载/审阅表。专项真实任务与定向 31 项测试均证明这套门可执行；完整“下载→内容审阅→草稿预览”仍必须在隔离课题上另验，不能把本次候选阶段绿灯写成完整 P1 验收。

**隔离全链补验（同日）**：先对 Dao 2019 候选 `10.1039/C9TA09333H` 真跑一次唯一 full-lane 类别 `fetch_and_attach_pdf`。任务在原来的 10 分钟预算内完成且没有越界写入，但 Claude 把“网络策略下无法核验”错误写成“DOI 不存在”；这与 Bridge 已记录的 Crossref DOI 相矛盾，不能被当作研究结论。于是下载提示词收紧为最多 5 次网络尝试、优先核验用户给出的疑似直链，并规定网络受阻只能报告“未能验证”，不得断言论文不存在；对应 full-lane 回归通过。随后在新的临时子目录使用公开的 PLOS PDF（`10.1371/journal.pone.0000308`）做机制验收：Agent 报告 URL，Bridge 下载并校验 `%PDF`、91,408 B 与 SHA-256，无快照越界；只读内容 Agent 只读取这一份精确 PDF，并准确标为 `exclude`（与临时课题主题无关、无 findings）。这还发现内容 `exclude` 论文此前仍默认勾选，会让研究者不小心创建 Paper；现改为保留卡片供人工复核，但默认不勾选，研究者仍可显式覆盖。最后在临时项目上下文中显式覆盖该测试项，仅调用 `/v1/drafts/batch` **preview**：生成的 `PAPER-015` 与 `DEC-005` 草稿 schema 校验零错误，两个目标路径均确认不存在，且没有调用 commit。临时脚本已删除；隔离目录的清理受本机命令安全分类器阻断，未影响 vault，需在下次可用时删除。这个验收证明“下载→本地内容审阅→研究者可编辑的预览”三段实际可走，但不证明无关论文应被准入，也不替代在真实相关候选上的科研判断。

**真实面板候选审阅补验（同日）**：从 PRJ-002 的实际注册表入口打开“从种子重建 P1”，首次发现在项目标题 `CeO₂` 与工作区 `topic.json.name` 的 ASCII `CeO2` 之间，身份门把同一化学式误判为不一致。`normalizeTitle` 改为先做 Unicode `NFKD` 规范化，再进行既有小写/空白/标点折叠，并加入回归用例；这仍会拦截真实的 PRJ/工作区错配。第二次实际派发暴露出另一类“可执行性”误判：Bridge 的 `installed` 仅检查 CLI 路径，原先优先的 Claude CLI 却被本机第三方模型配置（`MiniMax-M2.7`）拒绝，无法完成任务。种子重建的只读选择顺序改为优先已验证的 Codex、Claude 仅作同权限回退；不放宽工具或权限。修正后，Codex 在真实面板完成对 Bridge 记录的 Crossref manifest 的只读初筛，得到 6 条**题名缺失、仅同作者链**的方法学线索；候选卡均显示 DOI、期刊、来源端点和“元数据待后续审阅”，并且全部默认未勾选。验收在该人工审阅节点停止：没有点击下载、没有触发 full-lane、内容审阅、draft preview 或任何 vault 写入。这个结果验证了真实入口→身份门→Bridge 获取来源→Agent 初筛→人工候选卡的链路；它不构成对这 6 篇材料相关性的确认，也不授权自动下载。

**候选元数据补全追记（同日）**：只凭 DOI/作者的卡片不能要求研究者作出准入判断。于是把已通过来源门的候选（最多 12 条）逐篇交给 Bridge 的既有固定域名 `GET /v1/literature/crossref/works/:doi` 读取，结果作为 `metadata_manifest` 记入本轮运行记录；Agent 不新增联网能力，且补取失败明确标为“不可下载”，不会被解释成“论文不存在”。Crossref 标题中的 JATS `<sub>/<sup>` 格式标记在 Bridge 边界归一为纯文本，实际核验 `Au@CeO<sub>2</sub>` 正确呈现为 `Au@CeO2`。PRJ-002 的真实面板复验显示 7 条可审条目，其中 `10.1039/C9TA09333H` 与 `10.1016/j.jcat.2019.07.054` 正是此前已经保留的两篇 Dao 2019 方法学参考；所有卡片仍未勾选。补题名不等于重新完成科学相关性判断，故文案明确为“仅因同作者链进入候选，需按题名人工复核”，而非继续显示已失真的“题名待审阅”。

**教训**：
- 安全分类器这类基础设施故障会整段吞掉"写代码"和"验证代码"之间的反馈循环；遇到这种情况，比起干等或反复重试，更诚实的做法是继续做只读的手工代码走查（对着校验器源码逐行核对生成的对象形状），把能提前发现的逻辑错误尽量在没有测试跑道的情况下也挑出来（这次确实挑出了一处真实的测试期望错误），但绝不能把"走查通过"包装成"测试通过"写进工程记录——这两者对读这份记录的下一个人（或下一次会话的自己）价值完全不同。
- 大范围功能实现（8 阶段 UI + 4 个新端点 + 1 个新纯函数核心模块）如果全程没有一次真实执行机会，应该在提交阶段性总结时明确划出"源码走查 vs 真实验证"的边界，而不是等到下一次会话才发现这中间的落差。

## 2026-09-01：既有 schema-v1 对象的编辑/移动/删除缺一条 preview→commit 迁移车道（已记录为独立缺口，暂不修）

**背景**：`POST /v1/drafts/batch` 只承诺"新建文件"的原子批量提交——目标路径已存在时直接 `409 target already exists` 拒绝，这是端点本身刻意的保护逻辑，不是 bug。但本次 PRJ-002 文献准入（见 `Research/Decisions/DEC-004`）过程中需要三类"编辑既有对象"的操作：给已存在的 `PAPER-002`（后更正为 `PAPER-013`）追加 `projects` 字段、纠正其 `display_id`、以及移除一个孤立重复对象（`PAPER-001`）并把它迁出活跃 vault。这三类操作在当前 Bridge API 里都没有对应通道，只能退回到 Read/Edit 工具的直接文件编辑，或 Bash 层面的 hash 校验拷贝+删除。

**做了什么替代**：没有假装这是"原子提交"。对编辑类操作，直接改文件、在决议正文里如实写明"这一步不共享 drafts/batch 的事务边界"；对删除类操作，改用"先在 vault 索引范围外做 SHA-256 校验的快照与迁移清单，再从活跃目录移除"的手工三段式，事后用哈希比对和全 vault 引用扫描做验证，而不是依赖任何自动回滚机制。

**教训**：
- "preview→confirm→commit" 这套安全语言目前只覆盖新建文件；一旦任务涉及改写、重命名或删除已有 schema-v1 对象，就没有对应的原子通道，只能靠人工纪律（先哈希、先扫引用、再动手）顶上。继续把这类手工操作包装成"原子迁移"会误导审计记录，必须在决议文本里明确标注机制差异（参见 `DEC-004` 的"提交机制说明"与"身份纠正"两节）。
- 这个缺口不在本次任务范围内修——记在这里是为了不重复发现：下一次如果又要编辑/重命名/删除一个已存在的 Research 对象，直接认领这条已知缺口，而不是重新诊断一遍"为什么 drafts/batch 拒绝了我"。
- 真正的修复方向应是给 Bridge 补一条面向"已有对象增量字段更新 / 重命名 / 归档删除"的独立 preview→confirm 端点，语义与 `drafts/batch` 分开（后者永远只处理新建），而不是放宽 `drafts/batch` 去允许覆盖——覆盖既有笔记的保护逻辑本身是对的，不应该削弱。

## 2026-08-31：M3 P3-P5（假设生成/实验设计/周计划）首次真实端到端验证；隔离在专用测试课题里做，不污染真实课题

**背景**：`project-mode.js`/`project-mode-core.js` 的 `runP3P5()` 早已实现且有单测（`tests/project-mode-core.test.js` 全绿），但从未做过真实 Agent 调用的端到端验证——不知道 preview→confirm→commit 全链路在真实 Bridge/真实 Agent 输出下是否真的按设计工作。

**没有直接拿 PRJ-002 试**：PRJ-002 是研究员正在推进的真实课题，已经有 3 条真实假设（HYP-005~007）和 5 个真实实验（EXP-007~011）在走。如果直接在它上面跑自动 P3-P5，AI 会在这些真实内容之外再生成一批新的假设/实验草案，容易把"研究员自己在推的主线"和"AI 这次凭证据现生成的"混在一起。改为新建一个专用的临时测试课题 `PRJ-004`（title 显式标注"验收测试用临时课题（可安全删除）"），验收完成后连同产出一起删除，不触碰任何真实课题的假设/实验池。

**GUI 被跳过，改走同一套 Bridge API**：验收当时研究员的物理机正在被实际使用（GaussView、远程 SFTP 会话都开着），反复抢 Obsidian 窗口焦点会打断研究员手头的事；改为写一个 Node 脚本，原样复刻 `project-mode.js` 的 `runP3P5()` 逻辑——同样调用 `project.get` → `buildProjectPlanPrompt` → `POST /v1/tasks` → 轮询 → `parseProjectPlanReply` → `buildProjectDrafts` → `POST /v1/drafts/batch`（preview）→ `POST /v1/drafts/batch/:id/commit`——只是把触发点从按钮点击换成脚本直调，不影响验证的真实性（走的是完全同一条代码路径和同一个 Bridge）。

**验证结果（全部通过）**：
1. 真实 Agent（codex）调用产出的 JSON 被 `parseProjectPlanReply` 正确解析：1 条假设（含 `predicts`/`falsified_if`）、1 个关联实验、5 行周计划。
2. `buildProjectDrafts` 产出的 3 个文件（`HYP-008`/`EXP-012`/`Schedule/2026-W36.md`）经 `schema-objects.js` 的 `validateObject()` 校验**零错误**；状态字段正确落在 `proposed`/`designed`/`pending`。
3. 新对象的 `project_uid` 正确指向 PRJ-004，PRJ-002 的 8 个既有 HYP/EXP 文件在整个过程中**逐字节未变**；vault 全局 HYP/EXP 计数从 7/11 正确增至 8/12，验收后清理又准确回落到 7/11。
4. `Research/_runs/queue/` 全程为空——`drafts/batch` 走的是独立于 `_runs/queue/` 的另一条落盘通道，preview→commit 之间没有中间态残留。

**一个值得记录但不阻塞的旁观察**：这次给 Agent 的 `cwd` 指向了 PRJ-002 真实工作区（里面确实有 `knowledge-graph/knowledge_graph.json`），但模型在回复里明确说"证据不足：指定工作区文件无法读取"，没有读到图谱内容，因此没有生成任何关于 Au@CeO₂ 材料体系的科学假设，而是诚实地生成了一条"关于这次验收本身"的元假设。这是正确的诚实行为（没有编造材料科学结论去匹配错误的课题身份），但也说明 `read` 权限任务下 Agent 对 `cwd` 内证据文件的实际读取还没有被验证过——留给下一次验收去查，这次的验收目标是链路机制，不是证据读取保真度。

**追记（当天，证据读取链路补验）**：上面那次"读不到"，`cwd` 指向 PRJ-002 真实工作区、但 `project.get` 取的是 PRJ-004（身份和工作区错位），不能证明"证据可读→基于证据生成"这条链路本身有没有问题。把两者对齐回 PRJ-002 本身（`project.get('PRJ-002')` + `cwd`=PRJ-002 真实工作区），只做只读探测——真实派发一次 Agent 调用、解析回复、**不调用 `/v1/drafts/batch`**，确保无论结果如何都不写入 PRJ-002 的真实 HYP/EXP 池：

- 模型这次的 `summary` 精确复述了 `knowledge_graph-report.md` 里的原文警告（"Agent semantic extraction was unavailable; this fallback graph contains co-occurrence only and must not be read as causality" / "only 0/25 cards mention both Au and CeO2"），逐句核对后确认不是巧合或幻觉——是真的读了这份文件。同时准确报告 `Research/deep-research-synthesis.json` 不存在（现场核实：文件确实不存在）。
- 基于这份"图谱质量差、证据地板不达标"的诚实判断，模型仍然产出了 3 条互斥竞争假设（壳厚单调降低 / 中等最优壳厚 / 差异主要由混杂变量而非壳厚本身驱动）和 4 个判别性实验草案（结构准入 → HER 初筛 → 电荷响应关联 → 竞争解释复核），并在每一步都显式标注"不下机制结论""若缺指标只能做定性缺口审查"。这三条假设的方向与研究员自己已有的 HYP-005/006/007 三条假设**结构一致**（同样是单调/非单调/混杂三分），实验设计的分工也和现有 EXP-007~011 的判别性实验思路吻合——不是照抄（措辞、变量表、程序细节全是独立生成的），是基于同一份真实证据独立收敛到了同一个科学判断结构。

**结论**："证据可读 → 基于证据生成"这条链路本身没有问题：只读探测没有产生任何写入（`Research/Hypotheses`、`Research/Experiments` 全程零变化），但证明了 Agent 确实读了真实文件、诚实报告了证据地板不达标、且没有因此拒绝产出——生成了标注充分、判别性强的假设与实验草案。是否要把这次探测的输出正式写入 PRJ-002（走完整 preview→confirm→commit），还是仅供研究员参考、由人工决定要不要采纳，是下一步的产品/科研决策，这次没有替你做这个决定。

**教训**：
- 验证一个"会往真实课题里追加内容"的自动化功能时，先问"这个课题现在是不是干净的"，不干净就新建一个专用测试对象，而不是假设"反正是 propose 状态，加了也能分辨"——AI 草案和研究员真实工作混在同一个课题里，观感上的区分成本本身就是一种污染。
- 验证代码路径的真实性不等于必须走 GUI；只要严格复刻同一段调用序列（同一批 HTTP 端点、同一个纯函数库），脚本直调和按钮点击验证的是同一件事。物理机被研究员本人实际占用时，这是比反复抢窗口焦点更礼貌、也更快的路径。
- 全局唯一 ID 分配（`allocate('HYP', existingHypothesisIds, ...)`）在多课题共享同一份 `Research/Hypotheses/` 目录时天然不会撞号，但也意味着任何一次测试都会真实消耗一个全局编号（这次是 HYP-008/EXP-012）——验收后清理只删文件，不需要也不能把编号"还回去"，下一次真实的 HYP-008 会是新内容。

## 2026-08-29：工作台与材料库 L1 动作通过真实确认闸门验收；批量确认当前串行投递，延迟应显式管理

**范围**：现有接口不另起 `task.create`/`material.create` 平行路径，直接验收已注册、已白名单放行的原生 L1 动作：`workspace.task_add`/`task_update`、`workspace.timeblock_add`/`timeblock_update`/`timeblock_remove`、`workspace.checkin_upsert`（含 `clear:true`）、`material.add`/`material.remove`。回归基线 `node tests/run.js` 为 603/603。

**现场验收（真实 4173 面板、Bridge、队列与 Obsidian 消费端）**：

1. 一张三项确认卡提出了明确标注的验收任务、`2099-01-01` 的 15 分钟测试时间块和同日测试打卡。确认前 `data.json` 没有三个标识；确认后面板逐项回显“✔ 已生效”，并在 `data.json` 核实任务、规范的 `startTime`/`endTime` 时间字段、以及 check-in 条目。没有触碰本周日程或真实考勤。
2. 用同一批测试对象再走一张四项确认卡：任务更新为 `done`、时间块更新后删除、测试打卡以 `clear:true` 清空。最终核实任务仅保留为“验收测试 / 已完成”，时间块已不存在，2099 打卡数组为空；每步均有 `Research/_runs/actions/` 审计和 `queue-archive/` 结算记录。
3. `material.add` 先登记一个由本轮创建的、无实验数据的 vault 内文本夹具。确认前素材库无该路径；确认后条目含 `id/path/name/category/addedAt`。随后用第二张确认卡执行 `material.remove`，确认“只移除登记、不删除原文件”；最终再删除我创建的夹具和空目录，素材库与 vault 均无测试残留。

**清理边角**：`material.add` 会顺带新增未知的 `category`，但 `material.remove` 按设计只删条目、不删类别；当前动作表只有 `material.category_add`，没有 `material.category_remove`。本次由测试产生的空 `acceptance-test` 类别已被精确移除并用 JSON 解析器复核。后续若要让 Agent 完整管理材料库，应补一个同样受确认保护、仅允许删除未被任何材料使用的 `material.category_remove`，或在 UI 中明确把孤立类别当作需人工清理的残留。

**发现（不是安全失败）**：确认卡虽可包含多项，但 `shell-ui.js` 当前逐项“提交→等待结算→再提交下一项”。消费端当轮的 pending 快照只包含已投递的项，因此本次多项确认实际每约一分钟结算一项（任务 10:33、时间块 10:34、打卡 10:35；清理批次同样串行）。确认、队列、审计和实际写入均正确，但长批次的用户可见延迟是 `项数 × 轮询周期`。

**教训**：

- 不能因为“同一张确认卡”就假定它会被原子或并行地投递。验收批量写入时，要同时观察每项的提交时间、队列状态和最终结算；卡片层面的单次确认与执行层面的批处理是两件事。
- 对真实工作台数据，验收标的应可隔离且可清理：未来日期时间块、明确标注的完成态测试任务、独立夹具文件，比复用今天的排程、考勤或研究材料安全得多。
- 操作能力的“新增”与“撤销”不一定对称。`material.add`/`material.remove` 的文件登记语义是对称的，但自动创建的分类没有回收动作；验收临时数据时必须检查其附带写入的二级状态，而不只是核对主条目是否已删除。
- 该串行延迟不是放宽确认或绕过队列的理由。后续如优化，应保持“一次用户确认锁定整批输入”和每项独立审计/结算，只把**提交与轮询调度**改为批量化；在有依赖关系的动作间仍需保持顺序。

**收尾追记（重载后的真实确认卡验收）**：补齐 `material.category_remove`（仅空分类）与 `workspace.task_remove`（仅真实 ID）后，重启 Obsidian 以加载新的 `main.js` 白名单，并在运行中的织研者面板逐项确认：先创建一次性空分类 `织研者验收清理分类-20260829`，再由 `material.category_remove` 删除；面板两次均回显“✔ 已生效”，随后以 JSON 解析确认分类不存在。最后由 `workspace.task_remove` 删除唯一验收任务 `mte8sal9n0kz`，确认卡回显成功，任务 ID 随后不再出现于 `data.json`。整个过程没有删除任何真实任务或材料。早先两次把多项动作包进 `actions` 数组的模型文本未被解析成确认卡、也没有写入；这也再次证明活路径只接受单个合法围栏块，模型自然语言或不合规结构不会越过确认闸门。

## 2026-08-29：实验写入类别通过真实确认闸门验收；低风险追加走队列，高风险状态变更走 Bridge preview→commit

**背景**：RSS 首批类别完成后，下一批验证 `experiment.append_note` 与 `experiment.transition`。前者是低风险的日志追加；后者会改变实验状态，不能为了验收而污染真实研究记录。仓库已存在明确标注“验收测试用，可随意修改”的 `EXP-011`，因此没有另建缺少删除通道的一次性实验，也没有触碰仍待真实决策的 `EXP-009` 状态。

**现场验收（真实 4173 面板、真实 Bridge 与 Obsidian 消费端）**：

1. `experiment.append_note`：向 `EXP-009` 提议带明显验收标识的日志。确认前，记录和队列内均不存在该标识；面板只呈现一张含 `experiment_uid` 与 `text` 的“确认执行（写入 Scholarium）”卡。点击确认后，面板回显“✔ 已生效 实验日志”，`EXP-009` 的 `log` 新增对应条目；同时留下 `Research/_runs/actions/` 审计和 `Research/_runs/queue-archive/` 已结算记录。测试日志按事先授权保留。
2. `experiment.transition`：确认前读取 `EXP-011`，状态为 `data_pending`。面板提出唯一一项 `data_pending → analyzing`，并展示完整的验收原因；确认后回显“✔ 已生效 推进实验状态：data_pending → analyzing”。源文件的 `updated_at`、`status` 与 `status_history` 均更新，历史项注明 `weaver-chat-confirmed` 和验收原因，证明走完了服务端 preview→commit 绑定，而非仅 UI 改显示。

**教训**：

- 写入类别的验收必须同时证实两个时间点：确认前没有落盘，确认后有可追溯的领域记录和审计/结算证据；只看到最终 UI 提示不够。
- 不同风险级别应用不同测试标的：可逆/追加类可用真实但未排期的记录；状态机变更应优先复用已有、明确声明可随意修改的测试对象，不能为了方便修改处于真实决策链的实验。
- 同样是 L1 写入，底层执行机制可以不同：`append_note` 经跨进程队列等待 Obsidian 结算，`transition` 则由 Bridge 以 preview→commit 原子落盘。验收应对各自的真实证据链断言，不能把一条路径的观测方式套到另一条上。

## 2026-08-29：`a6403d2` 修复目标是主 UI 上不可达的死代码；真正生效的确认闸门是另一套已存在机制，已现场验证正向路径 + 复现 `a6403d2` 想堵的具体绕过路径在活代码上是否存在

**背景**：`a6403d2`（"Gate formal RSS actions behind confirmation"）改的是 `main.js` 里原生渲染的"研究推演室"（`yi` 类：`renderDraft`/`renderAgentReply`/`renderFormalActionRequests`/`confirmFormalActionRequest`），把此前"AI 回复带 `action_requests` 就直接 `queue.submit()`"改成了"先渲染确认卡片，用户点「确认执行」才 `queue.submit()`"。看代码本身是对的、方向也和别处已修过的漏洞同类（服务端 preview→dispatch 绑定），但按用户的规矩——工程教训要等真正接入、验证后才写——去做现场验收时，死活验不出确认卡片：用 codex 和 claude 两个适配器反复纠正模型输出（`action`/`reason`→`type`/`input`/`why`，`status` 从 `pending_confirmation`→`ready`），模型最终产出完全合规的 JSON，前端却始终只是把它当纯文本回显，从不渲染确认卡片。

**根因（读代码而不是继续猜 UI 才找到）**：`main.js` 文件最顶部有一段运行时 monkey-patch（约第 6-230 行），注释原文："Last-resort mount for the enabled `scholarium` plugin. The working Research Weaver application lives in the sibling development directory."插件加载时无条件劫持 `_t.prototype.render`：只要 `activePanel === "deduction"`（也就是顶部标签栏那个被这段 patch 强行改名成"织研者"的原生"对话"标签），就直接渲染一个指向 `http://127.0.0.1:4173` 的 `<iframe>`，`yi.render()`（连带 `renderFormalActionRequests`/`confirmFormalActionRequest`）根本不会被调用。反向证据：`renderDeductionCommandBar`（唯一会把 `activePanel` 设成 `"deduction"` 的正常入口按钮所在函数）全文件 grep 不到一处调用；"旧版对话归档"入口现场点开确认为空。也就是说 `a6403d2` 改的这条代码路径，在当前用户实际点得到的 UI 里根本走不到——不是我验收方法不对，是目标本来就摸不到。

**真正在生效的闸门，是另一套早就存在的机制**：iframe 里跑的 agent-canvas-demo（`shell-ui.js`/`chat-actions-core.js`）用 ` ```scholarium-action ` 围栏块——模型只能在回复里"请求"，面板剥离围栏渲染成卡片，用户点"确认执行（写入 Scholarium）"后才逐项 `queue.submit()`。这套机制和 `a6403d2` 想解决的问题是同一类（"确认不能只在 UI 层"），但走的是完全不同的代码，且早于 `a6403d2` 就已经在保护真实用户面。

**现场验证（正向路径，此前一直没做的部分）**：用真实文献订阅文章（`article_id: 10.1016/j.apcatb.2026.127268`）触发一次 `rss.mark_article`：
1. 点确认前：`Research/_runs/queue/` 确认为空（提议已渲染成卡片，含 action/理由/输入，但未写入）；
2. 点"确认执行（写入 Scholarium）"后：`Research/_runs/actions/` 落了一条审计记录（`dry_run:false`，`policy.requires_confirmation:true`）；`Research/_runs/queue-archive/` 落了完整生命周期记录（`submitted_by:"weaver-chat-confirmed"`，`status:"completed"`，`submitted_at`→`settled_at`）；`data.json` 里该文章的 `read` 字段确认变为 `true`；聊天面板卡片标题变成"修改请求（已执行）"，下方系统消息回显"✓ 已生效 标已读/收藏"。
3. 全程未点确认的那次尝试（前一轮 `rss.refresh_feed` 提议）`Research/_runs/queue/` 全程保持空——不点不写入，负向路径同样成立。

**追记（更重要的问题）**：上面验的都是模型规规矩矩走 ` ```scholarium-action ` 围栏块的正常路径。但 `a6403d2` 当初要堵的是更刁钻的输入——结构化 `action_requests` 字段绕开围栏块、被当成已确认写入直接入队。这条具体绕过路径，此前只在死代码（`main.js` 的 `yi` 类）上试出过"前端把它当纯文本回显"的现象；活代码这边一直没有刻意复现过。二次核实分两层：

1. **代码审查**：`agent-canvas-demo` 全目录 grep 字符串 `action_requests`——零命中。真正会被执行的唯一入口是 `chat-actions-core.js` 的 `parseActionRequests()`，正则写死为 `` /```scholarium-action\s*\n([\s\S]*?)```/g ``，且要求解析出的对象里 `typeof parsed.action === "string"`（不是 `action_requests` 数组）。另一处会把整段回复当 JSON 解析的路径是"科研论"模式的 `parseTheoryReply()`（`bridge-ui.js`），但它的系统提示词 schema（`status/summary/questions/hypotheses/plan/audit/memory_update`）本身就没有 `action_requests` 这个键，且消费方 `renderTheoryReply()` 通篇不读 `reply.action_requests`——就算模型瞎写了这个字段，也没有任何代码会去看它。也就是说活代码里根本不存在"读取 `action_requests` 字段"这一环，不是"挡住了"，是"这个概念在这条路径里压根不存在"。
2. **现场复现尝试**：用真实文章（`article_id: 10.1016/j.apcatb.2026.127309`）明确要求模型在正文里直接输出裸 `{"action_requests":[...]}`（不包围栏），显式声明是安全测试。模型自己拒绝照做，原话："不能按该格式原样输出：未围栏的 `action_requests` 可能绕过确认卡片并被误执行……本轮不生成任何可解析的写入请求。"——这是研究员主 Agent 系统提示词（规则 11）本身训练出的行为，等于多了一层模型侧防御。全程复核 `Research/_runs/queue/` 与该文章的 `read` 字段，确认没有任何写入发生。

**结论**：`a6403d2` 想防的具体绕过路径（结构化 `action_requests` 免围栏直接入队），在真正在跑的 `agent-canvas-demo` 上**结构性不存在**——不是被动防住，是这条代码根本没写。"确认机制不能只在 UI 层"这条防线在活代码这边没有破。`a6403d2` 修复死代码本身没有造成安全后果，纯粹是在一份已被 monkey-patch 架空的旧实现上做了正确但无效的修补。

**教训**：
- 一次代码审查/单元测试层面"看起来对"的修复，不能替代"这条路径在真实 UI 上到底走不走得到"的核实——尤其是这种被反复迭代、新老两代实现共存于同一份 `main.js` 的代码库，旧类还在、还导出、还能通过类型检查，但可能已经被运行时 patch 完全架空。
- 反复怀疑"是不是我操作/提示词不对"之前，先去读渲染函数的**调用点**（`grep` 函数名本身，不只是定义），零调用点比反复试错更快、更确定地说明问题出在哪一层。
- 同一个安全属性（"写入前必须人工确认"）如果在代码库里有两套独立实现，验收时必须先确认"用户实际点的是哪一套"，而不是假设"看起来像的那个就是在跑的那个"。

**待用户拍板（不属于这轮验收范围，未擅自处理）**：安全层面的问题已经排除（活代码没有同类缺口），剩下的纯粹是代码整洁度决策——`main.js` 里 `yi` 类、`renderFormalActionRequests`、`renderDeductionCommandBar` 这段已确认摸不到的原生对话代码要不要整体删除。倾向直接删（这次已经证明会让人在摸不到的代码上耗时间，快一小时），但需要先确认没有其它会话/插件版本还依赖这条原生路径渲染"deduction"面板本身，才能安全下手。

## 2026-08-29：full 车道首个真实验收通过；验收必须信任系统事件，而非 Agent 自述

**背景**：`fetch_and_attach_pdf` 是 full-permission lane 的首个真实落地类别。它不把写权限交给
Agent：`claude-full` 只查找并报告开放获取 PDF 直链，Bridge 负责下载、二进制校验、去重，并只
写入声明的 `literature/downloaded-pdfs/`。派发前仍必须完成服务端 preview → confirm → dispatch
绑定和适配器能力探测。

**发现**：初版 `verify-live.js` 用 Agent 最终回复中的“curl 通了 / WebSearch ✅”等文字判断研究
车道是否成功。这个判定既会随模型措辞漂移而误报失败，也可能命中探测 prompt 本身的“curl 是否
通了 / WebSearch 是否可用”而误报成功；模型自述不是工具实际执行的可信证据。

**修法**：`probe-research-lane.js` 从 Bridge 的真实 step 事件流统计 curl 和 WebSearch 调用，并输出
`tool_call_evidence: curl=N websearch=N`。验收器同时要求任务完成、`permission_denials` 为 0、且两个
调用计数均大于 0。针对“只有 prompt 关键词、没有真实工具事件”的回归用例已加入。

**真实验收**：2026-08-29 的 Bridge 事件流记录 `curl=1`、`websearch=1`，研究车道与临时越界写入
检测均按预期完成；`claude-full` 的读/写基线、无 permission denial、联网、检测式边界探测全部通过。
`npm run verify` 243/243 通过，`npm run verify:live` 全绿。修正提交：`22955e3`。

**教训（以后每一个操作类别都适用）**：

- 验收必须以系统可观察、不可由模型自由措辞伪造的事实为准：Bridge/工具事件、退出码、文件 hash、
  受控 diff、审计记录；Agent 的自然语言报告只能作为诊断线索，不能作为通过条件。
- 探测 prompt 的内容不是证据。凡是通过搜索输出文本找成功标志的验收，都必须检查该标志不会仅因
  prompt 回显或模型复述而出现，并为这种误判写一条负向回归测试。
- 一个适配器、一个类别的探测通过只解锁这对组合；不得把 `claude-full` 的结果外推为 `codex-full`、
  `opencode-full` 或未来任意写入类别已经安全。

## 2026-08-29：孤儿 Bridge 进程清理、标准重启、Idea 卡片手动 UI 验收通过、`idea-list.js` 按钮回弹修复、main.js 单源码确认

**背景**：M2 的 Idea 卡片改动（schema-v1 对象、`idea.list`、搁置/重新探索端点、列表页）此前一直停在工作区未提交，未做过手动端到端，本地 Bridge 进程也是编辑前的旧代码。这轮按"清进程→重启→手动验收→回归→提交"执行。

**根因 1：进程记录对不上**——`bridge.pid` 记录的 PID 与实际监听进程不符。查证后确认当前占用 4173/4318 端口的进程均非本项目正常流程启动：4173 是另一 Agent（Qoder）08-27 启动的 `start-local.js`；4318 是 Qoder 当天凌晨一次"验证端口占用"诊断脚本残留——脚本本应 `sleep 4s` 后自杀，未杀干净，变成孤儿进程。

**修法 1**：清理两个孤儿进程，用 `npm start` 标准方式重启，健康检查双双 200，进程父子关系恢复正常。

**根因 2（此前担心不成立）**：此前怀疑"本地日期取值"热修可能只存在于编译产物、有被下次构建覆盖的风险。核对后确认 `main.js` 本身就是唯一源码，不存在独立构建流程——`ie()` 及另外 9 处同类改动均已完整在其中，无需补写。

**手动 UI 验收（首次真实端到端，均通过）**：Idea 列表渲染、筛选；测试卡片 shelve→re-explore 状态往返，真实按钮点击 + Bridge 端真实写入；`idea.list` 白名单在真实 pipeline 中确认放行。

**发现并修复一个真实 bug（验收中意外发现，非计划内）**：`idea-list.js` 的 `setStatus()`——服务端拒绝请求（如卡片校验不通过返回 400）时，按钮永久卡在"处理中…"不回弹。修法：失败时按钮正确回弹并重新启用。用同一 400 路径的畸形测试卡片现场复验通过。

**回归**：修复前后各跑一遍，`npm run verify`（`agent-canvas-demo`）243/243、`node tests/run.js`（仓库根目录）599/599，全绿。

**提交**：`9f3fd67`，分支 `m1-read-channel`，未推送，已排除 `.bak`/`bridge.log`/`bridge.pid` 等运行时残留。

**教训**：
- `bridge.pid` 不能作为进程存活的唯一依据，多 Agent（本例是 Qoder）共享同一台机器时，残留/孤儿进程可能占用同一端口而不被现有记录发现——重启前应先核对实际监听进程与记录是否一致，而不是假设记录准确。

**明确未处理**：`idea.promote`/`idea-dag.json`（维持既定不做）；本周时间块索引 21 归属未拍板，EXP-007/008 关联及 `note` 回写暂缓，避免拍板前批量写入错误关联。

## 2026-08-26：直接编辑 data.json 时把弯引号手滑打成直引号，破坏 JSON——被下一个会话在真实回归里抓到

**背景**：在给 `workspace.timeblocks` 加 `experimentUid` 正式关联字段（时间块↔实验闭环）时，用 `Edit` 工具直接改 Obsidian 插件的 `data.json`（迁移本周 10 条既有时间块，写入解析出的实验 uid，同时顺手把索引 15 一条 note 里写错的 `HYP-001` 改成 `HYP-005/006/007`）。原 note 文本里那句"对应 HYP-001 的"壳厚独立性"前提"用的是中文弯引号（U+201C/U+201D，`“…”`），在合法 JSON 字符串里不需要转义；但重写这句 note 时，替换文本里的引号变成了直引号（`"…"`），直引号在 JSON 字符串内部会被解析成字符串提前结束——`data.json` 当场变成非法 JSON。

**没有被这次会话自己发现**：这次会话（Cowork，没有可用的本机 shell 沙箱去跑 `node -e "JSON.parse(...)"` 验证）用 `Read` 工具肉眼复核了改动区域，格式看起来正常就当作已验证，实际没有做过任何程序化的 JSON 合法性检查。真正跑出问题的是研究员随后开的另一条会话（有真实本机 shell），跑 `node tests/run.js`/加载插件时发现 `data.json` 解析失败，定位到这处引号不一致并修复为弯引号。

**教训**：
- **直接编辑机器可读的数据文件（JSON/YAML 等）后，必须用该语言的解析器程序化验证一遍，不能只用人眼看 diff**——尤其是文本里混有中文标点（弯引号、全角标点）时，编辑工具的替换文本很容易被环境静默转换成 ASCII 直引号，这种改动在 diff 里几乎不可辨识，肉眼复核基本抓不出来。有 shell 可用时最起码跑一句 `python -c "import json; json.load(open(path))"` 或 `node -e "JSON.parse(require('fs').readFileSync(path))"`；这次没有可用 shell，是本该更早说明"这一步没有被程序化验证过、需要你或另一条会话确认"的地方，而不是含糊地说"看起来没问题"。
- **改动会被 Obsidian 在下次保存时读取的 `data.json` 时格外要小心**：这类文件一旦损坏，不只是这次改动作废，Obsidian 插件重载时读到非法 JSON 可能直接影响整个工作台功能，风险明显高于改一个普通的 `.js`/`.md` 源文件。
- **跨会话协作时，"下一条会话跑真实回归"是这类无 shell 环境的有效兜底**，但不应该是唯一防线——本条经验记录本身，就是把"这次没条件验证"的事实显式留痕，而不是让它随对话结束一起消失。

同一轮里研究员的会话还修了一处测试夹具问题：`tests/timeblock-drift-audit.test.js` 里手写构造的 Experiment 测试对象缺了 `data_recorded_by`/`data_recorded_at` 两个数据溯源字段，导致该用例在真实环境下没通过；已补齐。最终全量回归 547/547（根目录）+ 191/191（`agent-canvas-demo`）通过。


> 这是 Bridge / 插件代码本身的故障复盘日志，记录给以后维护这份代码的人看（研究员本人，或任何一次 Claude Code / Cowork 会话）。
>
> 注意与 `.scholarium/agent/lessons.md` 区分：那份文件是织研者在**某个课题工作区**里积累的检索/工作策略经验（"Sci-Hub 之前先试 WebVPN"这类），由 `bridge/server.js` 的 agent-memory 端点管理、按格式追加、会被注入聊天 prompt。这份文件谈的是**代码本身**的故障和设计教训，不会被任何 Agent 读取或注入，纯粹是工程文档，格式也不受 agent-memory 端点约束。

## 2026-08-23：跨进程队列的读写双方结算形状不一致，导致"写入成功却报超时"

**症状**：研究员在 Obsidian 聊天里让织研者把实验规划写入"博士工作台"，织研者正确生成了 `workspace.task_add` 确认卡片，研究员确认执行后，面板却报告"？超时未结算 workspace.task_add：{}"，看起来像是执行失败或卡死。

**先查证据，再猜机制**：没有直接去改代码，先比对了三处文件证据——`Research/_runs/queue/`（空，说明没有堆积待处理项）、`Research/_runs/actions/` 下的审计清单（记录了完整的写入结果，`result.added.id` 等字段齐全，耗时 <100ms）、`Research/_runs/queue-archive/` 下的归档条目（存在，时间戳吻合）。三处证据一致指向：写入本身早已成功，问题出在"结果怎么被读回来"这一侧，而不是执行本身。这一步把排查范围从"任务失败"收窄到了"结算/轮询链路"，避免了在错误的地方找 bug。

**根因**：`tools/bridge-action-queue.js` 的 `settle(vault, id, patch)` 把消费者（`main.js` 的 `schPollScholariumQueue()`）传入的 `patch`（`{status, result, error}`）**平铺**展开到归档条目上；而 `shell-ui.js` 里织研者聊天端轮询结算结果时，认的是**嵌套**的 `item.outcome.status`。两边各自独立演化，从未有任何东西约束它们必须共享同一套形状——归档条目上从来就没有 `outcome` 这个键，聊天端在 180 秒轮询窗口内永远等不到它认识的字段，误报超时。执行本身完全正常。

**修法（两侧都要改，缺一不可）**：
1. `tools/bridge-action-queue.js` 的 `settle()` 现在同时写平铺字段（向后兼容任何按旧格式读 archive 的调用方）和嵌套的 `outcome: patch`（聊天端轮询认的形状）。
2. `bridge/server.js` 在 `GET /v1/scholarium/actions` 与 `GET /v1/scholarium/actions/:id` 的读取路径上增加 `normalizeQueueItem()` 兜底：对已结算但缺 `outcome` 键的旧格式条目（包括 Obsidian 插件重载前、由旧版 `settle()` 写入的那些），现场从平铺字段合成出 `outcome`；`pending` 条目原样返回，不做合成。这一层保证即使 Obsidian 插件因 Node require 缓存还没热加载新版 `settle()`，Bridge 侧的读取也已经是对的——修复不需要等插件重载才生效。

**测试**：`agent-canvas-demo/tests/action-queue-settle.test.js`——覆盖 `settle()` 双写、旧格式条目经真实 HTTP 端点读回时被正确合成、pending 条目不被误合成、以及当前 `settle()` 产出的形状经真实 submit→settle→HTTP 读取全流程验证（不依赖 `normalizeQueueItem()` 兜底也能读对）。均为确定性单测，不需要真实模型/网络，留在常规 `npm test` 里。

**教训（可复用到其他跨进程/跨模块边界）**：
- 跨进程文件队列的写入方和读取方，如果分别演化、没有共享 schema 或类型定义，形状漂移不会在任何一侧单独报错——两边的代码分开看都"正确"，只有把两份代码摆在一起对形状才看得出问题。这类 bug 的信号往往不是异常堆栈，而是"看起来该成功的操作，报告的结果却和证据对不上"。
- 排查这类矛盾信号时，优先去比对底层真实产出的文件/记录，把"是否真的执行了"和"结果是否被正确读回"这两个独立维度分开验证，不要在证据支持了大方向猜测之后就停止往下挖到具体字段层面（这次最初猜的是"文件名/id 对不上"，方向对但机制猜错了，真正原因要读到字段形状才发现）。
- 读取端补兜底（这次的 `normalizeQueueItem()`）能立刻止血、且不依赖对端重新部署，但不是长期修法——真正的修法是让写入端也改成正确形状（这次两侧都做了）。只做读取端兜底而不修写入端，等于把技术债永久固化成"正常状态"。
- 本仓库这类"进程 A 写、进程 B 读"的边界不止这一处（Bridge 与 Obsidian 插件之间还有 `.scholarium/agent/` 记忆文件、`/v1/drafts/batch` 的 preview→commit 绑定等）。新增或修改任何这类边界时，值得反问一句："读的一方到底认什么形状，是不是和写的一方现在产出的形状对得上"，而不是假设"我这边的格式看起来合理"就够了。
