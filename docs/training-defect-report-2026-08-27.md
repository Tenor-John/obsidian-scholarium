# 织研者训练缺陷报告 — 2026-08-27（M4/M5 实测）

> 依据 `docs/M4-M5-操作手册.md` 对织研者聊天链路做真实 UI 训练测试时发现。
> 两个缺陷均已端到端实证（浏览器真实操作 + 会话转写 + 文件系统核对），不是推测。
> 证据转写保存在本机私有测试工作区；公开仓库不包含会话转写或原始判定记录。

## DEF-001（P0）：服务端 20000 字符截断，吃掉整个能力清单

### 定位
`agent-canvas-demo/bridge/server.js`
- **L2248**（`POST /v1/tasks`，聊天派发路径）：`prompt: String(input.prompt || '').slice(0, 20000)`
- L1943（`POST /v1/full-tasks/preview`）同款；L1993 的一致性校验也依赖这个 20000 切片

### 机制
`shell-ui.js` 的 `buildResearchChatPrompt`（research-chat-core.js）按此顺序拼 prompt：

```
系统角色 → 课题目标/工作区 → 此前对话 → 本轮问题
→ 【项目状态（Bridge L0 实读）】(project.get ≤12000 + scan_outcomes ≤6000 + drift ≤6000)
→ 项目长期记忆(.scholarium/agent/)
→ 工作协议规则 1–17
→ researchQuestionCoachProtocol()
→ capabilities = laneCapabilities() + scholariumCapabilities()   ← 最末尾
→ 收尾指令
```

`scholariumCapabilities()`（shell-ui.js L626-673）长约 **5529 字符**，包含：
L0 只读端点的完整 URL 格式（`GET {base}/v1/scholarium/state?action=...`，含 `workspace.rescan_pending`）、
全部修改动作的 input 规范、```scholarium-action 围栏的**标准信封格式 `{"action","input","reason"}`**、
能力规则 9（回扫程序）、`rescan-checkpoint-mark` 端点地址。

它排在 prompt 最末。实测当前课题（PRJ-002，4 实验 3 假设 + 漂移数据 + agent-memory）拼出的完整
prompt ≈ **27377 字符**，超过 20000 上限约 7400 字符——**能力清单整块 + 教练协议 + 规则17尾部
（经验草稿 frontmatter 规范）被静默切掉**。截断无任何日志、告警，响应照常 202。

### 实证
A1 测试（新会话首条消息，应触发规则16全量回扫）：
- claude 会话 `3d9c373e-...` 收到的 user message **恰好 20000 字符**，尾部停在规则17中段
  `"…你不得声"`（`你不得声称已保存` 的截断处）——其后一切全部丢失。
- 结果：0 次工具调用、无 `workspace.task_add` 卡片、`Research/_runs/rescan/` checkpoint 目录不存在。
  回扫机械链（rescan_pending → 去重 → ≤8 卡片 → checkpoint-mark）一步都没走。
- 模型正文质量反而很高（凭预取上下文正确识别了全部漂移）——**不是模型能力问题，是它没拿到端点地址和围栏规范**。
- codex 车道两次复现同样失败（且 codex 沙箱禁网，本来也打不了 WebFetch——默认车道选 codex 是次生问题，见文末）。

### 影响面
规则 16（M4 回扫）、规则 17 尾部（M5 经验草稿格式）、所有 L0 读取端点、所有 L1 动作信封规范全部失效。
对话越长（历史/项目状态越大）丢失越多。两条车道都中招。

### 修复方向（供评审，不限定）
1. 聊天车道的上限大幅提高或取消（CLI 侧上下文窗口足够；20000 是拍脑袋值，无注释说明来由）。
2. 重排 prompt 顺序：能力清单是"怎么动手"的规范，应放在规则之后、大块状态之前；或给各段做预算分配，状态块（可压缩）先让位，规范块（不可缺）保底。
3. 若保留截断：必须留审计日志/在响应里标记 `truncated:true`，最好直接拒绝派发而不是静默阉割。
4. 注意 L1993 的 preview 一致性校验与 20000 耦合，改动需同步。

## DEF-002（P0，DEF-001 下游）：动作信封解析静默吞掉空 input

### 定位
`agent-canvas-demo/chat-actions-core.js` `parseActionRequests` **L27**：

```js
input: parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input) ? parsed.input : {},
```

`input` 键缺失/写错时静默回落 `{}`，围栏照样剥离、卡片照样渲染，无任何警示。

### 实证（B1 回填测试，端到端）
研究员报告某时间块完成并给出数据。模型（claude）因拿不到信封规范（被 DEF-001 截掉），把键写成
`"params"` 而非 `"input"`——**其余内容全部正确**（围栏格式、action 名、timeblock id、
execution_status、experiment_uid 都对着预取状态取对了）：

```
{"action":"workspace.timeblock_update","params":{"id":"mt7gileha9lu","execution_status":"completed",...}}
```

解析结果 `{action:"…", input:{}}` → 卡片正常显示"改日程/实验日志"→ 点击"确认执行"→
预检 dry-run 双双拒绝：`id_required`、`note_text_required`。研究员给出的真实实验数据一条没写进去，
只看到一行看不懂的错误。（安全兜底有效：空载荷被预检挡下，没有脏写；但机制整体失效。）

### 修复方向
1. 解析端兼容常见别名（`params`/`arguments`/`payload` → input），或
2. `input` 为空对象/缺失时**不剥离、不渲染卡片**，让格式错误的块留在正文可见（与现有"格式错的块原样保留"策略一致），并在卡片/系统消息里给出可读原因；
3. 根本解仍是 DEF-001：把信封规范完整送达模型。

## 复现方法

1. 启动织研者前后端（4173 静态 + 4318 bridge），浏览器打开面板，绑定任一有漂移数据的课题。
2. 清空该 flow 的 localStorage 聊天记录并重载页面，选 claude-research 车道。
3. 发任意首条消息 → 检查 `Research/_runs/rescan/` 是否生成（当前：不会）。
4. 第二轮报告某已排期时间块完成 → 检查转写里的围栏键名与卡片 input（当前：`params`、空 input、确认即失败）。

## 附带观察（低优先级，未单独立卡）

- **默认车道是 codex（沙箱禁网）**：规则16/能力规则9 要求 WebFetch，codex 车道原理上不可能完成；
  UI 的 agent 下拉默认值不随持久化选择更新（`chatProfile()` 优先读 `window.weaverOrchestrator.getSelectedAgent()`，下拉框 DOM 不是权威源）。
- 规则16 要求会话第一条消息触发回扫，但判断依据是"此前对话=暂无此前对话"——只要能力清单送达，
  建议同时验证多轮后重开会话（前端存储 200 条上限）的行为。
- B1 中模型自发遵守了 experiment.transition 边界（只建议手动推进、不输出动作块）、主动追问其余未回填块，
  说明规则 13/14 的正文部分（在截断线之前）执行良好——问题集中在被截掉的尾部。

## 验收标准（修复后复测）

1. A1：新会话首条消息 → 能力清单完整送达（转写中可见 WebFetch 端点段）→ 模型调用
   `workspace.rescan_pending` → due=true 时产出 ≤8 张带 RESCAN marker 的 task_add 卡片 →
   `Research/_runs/rescan/last-checked.json` 生成。
2. B1 复测：回填消息 → 卡片 input 含真实 id/execution_status/note → 确认后
   data.json 对应 timeblock 的 `executionStatus/executionNote/executionRecordedAt` 写入，
   EXP-007 日志出现 append_note 内容。
3. `npm test`（agent-canvas-demo 与插件根 tests/）全绿；`npm run check` 语法通过。

---

## DEF-005（P0，第二轮训练新发现，2026-08-27 12:00）：聊天草稿落盘被 allowedRoots 拦截，DEC/LES 文件永远写不进 vault

### 定位
`agent-canvas-demo/bridge/server.js`
- **L742-761** `draftBaseRoot()`：`allowedRoot(status.vaultRoot)` 不通过即抛 `scholarium.vaultRoot is outside configured allowedRoots`（L760）
- L909-916 `allowedRoot()`：只允许 target 落在 `config.allowedRoots` 各根**之下**（相对路径不得以 `..` 开头）
- 对照先例 **L930-937 `allowedSkillRoot()`**：2026-08-18 已为素材库 Skill 补过"vaultRoot 作为额外许可根"的豁免（长注释说明同源问题），但草稿路径没做同样处理
- L807 promotion target 检查同类结构，疑似同样受影响（未实测）

### 机制
本机 `bridge.config.json`：
- `allowedRoots` = 某个课题子文件夹 `<vault>/Projects/<project>`
- `scholarium.vaultRoot` = `<vault>`（**父目录**，不是子目录）

`allowedRoot()` 的包含关系检查要求 vaultRoot 是 allowedRoots 的**后代**，而实际部署里 vault 必然是课题文件夹的**祖先**——方向天然相反，该检查在任何正常部署下都必然失败。
`shell-ui.js executeDraftRequests` 已按注释要求固定传 `base:'scholarium-vault'`（2026-08-26 修过一次错位），所以请求参数没问题，是服务端校验逻辑与部署拓扑矛盾。

### 实证（S3-C1 决策草稿测试，端到端）
1. 聊天中要求"把 EXP-009 排期定稿，起草决策记录存档"→ 模型正确产出 `scholarium-draft` 卡片：
   `Research/Decisions/DEC-001.md`（1673 字符，frontmatter 含 type/uid/display_id/schema_version/project_uid/decision/rationale/trigger_condition/relates_to，内容质量高）+ 2 条 `workspace.timeblock_add`。
2. 点"确认写入"后页面系统消息：
   `✘ 未写入 Research/Decisions/DEC-001.md：scholarium.vaultRoot is outside configured allowedRoots`
3. curl 直接复现（绕过 UI）：
   `POST http://127.0.0.1:4173/bridge/v1/drafts/batch` body `{"items":[{"path":"Research/Decisions/DEC-REPRO-TEST.md","content":"---\ntype: decision\n---\nrepro"}],"base":"scholarium-vault"}`
   → `{"error":"scholarium.vaultRoot is outside configured allowedRoots"}`
4. 同批的 2 条 timeblock_add 走 Obsidian 插件队列，正常落盘——**只有草稿路径（DEC/LES/EXP/HYP/Idea 新建）全灭**。

### 影响面
M5 经验候选（LES）、决策记录（DEC）、以及一切经 `/v1/drafts/batch` 的新建记录都无法落盘。
动作队列路径（timeblock/task/experiment.append_note）不受影响。

### 修复方向（供评审，不限定）
1. 参照 `allowedSkillRoot()` 先例：`draftBaseRoot()`（及 L807 promotion 检查）把 `scholarium.vaultRoot` 视为额外许可根——草稿写的从来都是 schema-v1 vault 级对象，且路径由服务端 `draftBaseRoot()` 自己拼接，不是 full-lane 任意写盘，放宽不削弱 claude-full/codex-full 的沙箱边界。
2. 不建议反向把 vault 加进 `config.allowedRoots`：代码注释明确 allowedRoots 是限制 full 权限车道写盘范围的，整体放宽会削弱沙箱。
3. 请同步检查 L807 promotion target、以及任何其它调用 `allowedRoot(vaultRoot 相关路径)` 的位置。

### 验收标准
1. 上述 curl 复现返回 200/批次 id，commit 后 `Research/Decisions/DEC-REPRO-TEST.md` 真实出现在 vault，随后可删除。
2. 聊天内重发 DEC 草稿确认 → `✔ 已写入`；M5 LES 草稿同路径验证。
3. `npm test`（agent-canvas-demo 与插件根）全绿；`npm run check` 通过；不引入 allowedRoots 配置变更。

---

## 修复进展记录（2026-08-27 下午更新）

### DEF-001 / DEF-002 / DEF-003 —— 已修复（第一轮，claude+codex 双提案合并）
- DEF-001：能力清单移到状态块之前 + 26000 字符预算分配（可压缩块按序让位、截断带提示）；服务端三处 20000 切片移除、full-task 一致性校验改逐字比对。
- DEF-002：`parseActionRequests` 接受 input/params/arguments/payload 别名；空/非法载荷不再剥离渲染，留在正文可见。
- DEF-003：`scholariumCapabilities()` 的 base 改为 `new URL(zhiyanBridge.url, location.href).href` 绝对地址。
- 复测：A1 回扫全链路（8 卡片+checkpoint）、B1 回填（data.json 三字段+EXP-007 日志）全部通过。

### DEF-005 —— 已修复（第二轮，双 CLI 同根因收敛）
- claude 与 codex 独立给出同方向方案：把 `scholarium.vaultRoot` 作为受控草稿/晋升路径的额外许可根，`config.allowedRoots` 不动（full 车道沙箱边界保持）。
- 采纳 codex 实现（`allowedScholariumVaultPath()` + `allowedDraftTarget(base, target)`，vault 豁免仅在 `base==='scholarium-vault'` 时生效，分层最窄）；测试取双方并集（codex 改造 2 个既有测试为生产拓扑 + 新增 1 个；claude 新增 2 个）。
- 验证：合并完成时 agent-canvas-demo 215 通过、插件根 50 通过、`npm run check` 干净（当时阶段计数；后续以 `docs/regression-baseline.md` 最新串行实测为准，2026-08-27 14:36 复测仍 215 + 50 全绿）；生产 Bridge 重启后 curl 复现件与页面代理路径双双落盘成功（DEC-001.md / LES-001.md 带完整 frontmatter 写入 vault）。
- 被否决：把 vault 加进 `allowedRoots`（会放宽 full 权限车道写盘沙箱）。

### DEF-004 —— 已处置（预防性）
- 现象：claude 的 WebFetch 会把本机 `http://127.0.0.1:4173` 自动升级成 https，对纯 HTTP 服务发起 TLS 握手，触发 `WRONG_VERSION_NUMBER`（`error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER`）；模型能自行改用 PowerShell Invoke-RestMethod 恢复，但靠自觉。
- **归类澄清（2026-08-27 补）**：这属于"**模型/Agent → 本地 Bridge HTTP**"方向的协议/版本类错误——对端根本没在说 TLS。它与"**Claude → 模型服务**"方向的 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`（真·证书校验失败）是两类问题，不可混为一谈；诊断口径见下节。
- 处置：能力清单读取端点段落后增加一条固定提示——遇证书/版本类错误不要改 https、不要放弃，改用 PowerShell Invoke-RestMethod 原样请求。增量约 150 字符，预算模拟仍在 26000 内。

### 证书错误诊断（2026-08-27 起常驻采集；对 cc-switch 只读，未改任何配置）
- 读写边界（准确表述）：工具对 `~/.cc-switch/` 与 `~/.claude/` **只读**（不改任何配置）；但工具自身的日志/断点/心跳**会落盘**到 `cert-diag/out/`，且 `watcher.js` 常驻运行。故称"对被诊断对象只读、自身输出落盘"，不称绝对只读。
- 工具：工作区 `cert-diag/`（快照 `snapshot.js`、增量监听 `watcher.js`、链探测 `tls-probe.js`、时钟漂移 `clock-drift.js`），说明、停止方法与日志保留期见 `cert-diag/README.md`。
- 日志字段（2026-08-27 收紧）：只落枚举/结构化字段——类别、错误码、时间、provider、目标主机、转写文件名与路径哈希（`transcriptFile` + `transcriptSha256`）、cc-switch 上下文。**不再保存任何转写原文片段**；不依赖"脱敏正则全覆盖"这类无法自证的假设。
- 已核实事实（截至 08-27 下午）：
  - 历次 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` 共 3 条（转写时间 08-20、08-26、08-27），全部属"Claude → 模型服务"类；均重试即恢复。
  - cc-switch 本地代理运行时关闭（`proxy_enabled=0`），其代理日志从无证书错误 → 错误未经过该代理，"代理证书链"假设被削弱但未被排除；且此事实不能单独证明请求未经过任何其它中间层。
  - 错误不聚集在 cc-switch 切换/重启之后；时钟漂移 <1s（W32Time 服务停止，为长期隐患）；根证书库近 30 天无新增；无常见 TLS 拦截工具。
  - 即时 `tls-probe` 到模型端点校验通过（TLSv1.3，证书有效期内）。
- 结论：维持"偶发、重试恢复、即时探测正常、待证"定性；观察期 14 天（至 2026-09-10），继续由 `watcher.js` 采集每次错误的时间/provider/目标主机/错误码，不改任何配置，直到证据足以定位。
