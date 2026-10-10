# 织研者 M4/M5 训练报告 — 2026-08-27

> 训练者：QoderWork 自主训练会话 · 依据 `docs/M4-M5-操作手册.md`
> 方式：真实浏览器 UI 操作（非仅改文件）驱动 claude-research 车道，端到端核验信封、队列流转与文件系统落盘；发现的缺陷按既定工作流交给本机 claude 与 codex 两个 CLI 在隔离副本中独立修复，再对比合并回主库。

## 一、训练范围与结论速览

本轮覆盖手册 §2–§8 的核心能力：全量回扫（规则16）、执行回填、漂移审计、决策记录（DEC）草稿、经验候选（LES）草稿、回扫节流。共执行 11 个用例，**首轮 3 个缺陷（DEF-001/002/003）修复后 10 个通过、1 个部分通过；第二轮训练中新发现 1 个 P0 缺陷（DEF-005），当日修复并复核闭环**。另处置 1 个预防项（DEF-004）。

| 用例 | 能力点 | 结果 |
|---|---|---|
| S1-A1 | 首消息全量回扫：rescan_pending → 去重 → ≤8 卡片 → checkpoint | PASS（修复后）：8 卡片全带 marker，checkpoint 落地 |
| S2-B1 | 完成回填：timeblock_update + EXP 日志 | PASS：data.json 三字段 + EXP-007 日志双写 |
| S2-B3 | 无状态负例：只给备注不给状态 | PASS（超额）：追问状态、拒绝猜填，还指出前置依赖矛盾 |
| S2-B2 | 阻塞回填：blocked 不冒充完成 | PASS（超额）：blocked 正确，还分析了丢组对假设判别力的影响 |
| S2-B4 | 幻觉负例：回填不存在的块 | PASS（超额）：查无此块、抓出时间线矛盾、零副作用 |
| S2-D1 | 证据不足：拒绝硬凑经验 | PASS（超额）：引用 ≥2 证据门槛，还纠正了问题与实际工作的偏差 |
| S2-E1 | 漂移审计复核 | PASS：unbackfilled 4→2，stale 分类准确，未来块不误报 |
| S3-A3 | 回扫去重（checkpoint 回拨强制触发） | PASS：8 条既有任务零重复，仅 2 条真增量 |
| S3-C1 | 决策草稿：EXP-009 排期 → DEC-001 | 卡片/信封/时间块通过；落盘一度被 DEF-005 阻塞，修复后落盘 |
| S3-D2 | 经验候选：≥2 证据 → LES-001 | 草稿合规（3 证据引用、scope 诚实）；落盘同上 |
| S4-A2 | 回扫节流：新会话 due=false | PASS：checkpoint 未重标、零卡片、任务数不变 |

## 二、缺陷与双 CLI 修复流程

### 第一轮（S1 实测暴露）
- **DEF-001（P0）**：服务端 20000 字符截断吃掉 prompt 末尾的整个能力清单，回扫机械链一步都走不了。
- **DEF-002（P0）**：信封解析把缺失/别名 `input` 静默吞成 `{}`，渲染出确认即失败的假卡片。
- **DEF-003**：能力清单给的是相对路径 `/bridge`，CLI 进程无 origin 可用，模型猜错端口。

两个 CLI 在隔离副本中独立修复：claude 提出"能力清单前置 + 26000 预算分配"的结构方案（但会话被一次偶发证书错误打断，产出部分且含一处引号损坏）；codex 交付了完整验证的解析别名 + 截断移除方案（206+50 全绿）。合并策略：取 claude 的结构设计 + codex 的实现与测试，修复合并引入的引号问题后主库 206+50 全绿。（以上均为当时阶段的串行计数；现行基线见 `docs/regression-baseline.md`。）

### 第二轮（S3-C1 实测暴露）
- **DEF-005（P0）**：草稿落盘端点要求 `scholarium.vaultRoot` 位于 `allowedRoots` 之下，而任何正常部署里 vault 都是课题文件夹的**祖先**——方向相反，DEC/LES 等新建记录永远写不进 vault。动作队列路径不受影响，因此缺陷很隐蔽。

两个 CLI 再次独立修复，这次**根因与方向完全收敛**（都把 vaultRoot 作为受控草稿路径的额外许可根，且都拒绝放宽 `allowedRoots` 以保住 full 车道沙箱）。差异在实现粒度：

| | codex | claude |
|---|---|---|
| 助手函数 | 新增 `allowedScholariumVaultPath()` + `allowedDraftTarget(base, target)` | 泛化 `allowedSkillRoot` → `allowedVaultRoot` |
| 豁免范围 | 仅 `base==='scholarium-vault'` 时（分层最窄） | 所有草稿/晋升路径统一适用 |
| 覆盖点 | drafts preview+commit、promotion、idea status | 同左 + draftBaseRoot 保留检查 + skill 路径合并 |
| 测试 | 210+50（改造 2 个既有测试为生产拓扑——它们原本用 `allowedRoots=[vault]` 恰好掩盖了此缺陷） | 211+50（新增生产拓扑正/负例与 vaultRoot 缺失 fail-closed 例） |

采纳 codex 实现 + 双方测试并集：合并完成时主库 **215 + 50 全绿**（阶段计数），`npm run check` 干净；当前基线以 `docs/regression-baseline.md` 最新一次串行实测为准（2026-08-27 14:36 复测仍为 215 + 50 全绿）。生产 Bridge 重启后双路径复核：curl 复现件与页面代理路径均 `commit ok`，DEC-001.md（1673 字符）与 LES-001.md（1352 字符）带完整 frontmatter 真实落盘。

### 预防项
- **DEF-004**：claude 的 WebFetch 把本机 http 地址自动升级成 https 导致连接错误（模型两次都自行用 PowerShell 恢复）。已在能力清单中加固定提示：遇证书/版本类错误改用 `Invoke-RestMethod` 原样请求，不要改 https、不要放弃。

## 三、被训练出的行为质量（超出机械链路的部分)

这一轮最有价值的观察不是"链路通了"，而是模型在拿到完整能力清单后表现出的科研判断：

- **拒猜**：无状态回填时明确说"不想猜"；幻觉块直接拒绝并给出记录空档。
- **守恒检查**：主动发现"08-24 XRD 时 Au 核还没制备"的时间线矛盾、"3 组样品对 2 天日程"的数量矛盾、"表征在做但前序包壳未回填"的依赖矛盾。
- **假设意识**：阻塞回填时分析丢失中间梯度组对 HYP-005（单调）/HYP-006（火山型）判别力的影响，并追问剩余两组的 Ce/Au 比例。
- **门槛纪律**：证据不足时逐条解释为什么不够（引用 ≥2 独立证据规则），证据充分时草稿诚实限定 scope（"目前证据全部来自 EXP-007 单实验"）。
- **状态区分**：清楚区分 unbackfilled（从没回填）与 stale（回填了但实验正式记录没跟上），并把后者上升为 LES-001 的候选模式。

## 四、遗留与建议

1. **stale 落差需要人工决策入口**：EXP-007 出现"执行已回填、正式记录停在 designed"的重复落差，但 `experiment.transition` 通道尚不支持，织研者只能口头建议。建议下一迭代把受控的状态迁移（含确认卡片）接入动作通道。
2. **队列消费节拍**：动作队列 20 秒/条，批量确认时等待感明显；可考虑同批动作一次消费。
3. **claude 车道偶发 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`（假设待证，已建诊断并常驻采集）**：本轮两次打断（本地 08-27 02:28 修复会话、09:49 训练回合），均重试即恢复；转写回填还发现更早一次（08-20 18:59 本地，当时 provider 尚非 claude-official）。报告初稿曾归因"疑似 cc-switch 本地代理证书链"，**该归因目前只是假设，且已被现有证据削弱**：
   - 错误全部发生在 **Claude → 模型服务**方向（转写分类）；与 DEF-004 的 `WRONG_VERSION_NUMBER`（WebFetch 把本地 Bridge 的 http 升级成 https）是两类不同问题，诊断工具已分开记录。
   - cc-switch 本地代理**运行时是关闭的**（`proxy_config.proxy_enabled=0`），其代理日志从无证书错误——错误未经过它的代理。边界说明：这只能排除 cc-switch 代理这一层，不能单独证明请求未经过任何其它中间层。
   - 错误**不聚集在切换/重启之后**（最近配置变更 08-25 00:22、进程重启 08-26 16:15，本地）。
   - 已排查方向：时钟漂移实测 <1s（但 W32Time 服务停止，属长期风险）；根证书库近 30 天无新增；无 Fiddler/Charles/mitmproxy 类拦截工具（仅火绒与 Defender 自带组件）；即时探测到模型端点的 TLSv1.3 链校验通过、证书在有效期——与"瞬态"特征一致。
   - 工具与证据：工作区 `cert-diag/`（对 cc-switch 配置只读；诊断输出落盘于 `cert-diag/out/`）。监听日志只落枚举字段（类别/错误码/时间/provider/目标主机/转写文件名+路径哈希），不保存转写原文；摘要与停止方法见 `cert-diag/README.md`。观察期 14 天（至 2026-09-10），当前结论维持"偶发、重试恢复、即时探测正常，需继续积累现场样本"；剩余候选：瞬时网络路径中间设备、TLS 会话复用异常、模型端点侧短暂异常。
4. **验收建议**：明日可自然复测 A2 的 due=true 分支（cadence=1 天到期），无需手工回拨 checkpoint。

## 五、产出物索引

- 缺陷报告：`docs/training-defect-report-2026-08-27.md`（含逐条实证、修复进展）
- 回归基线记录（串行实测、带时间戳）：`docs/regression-baseline.md`
- 证书错误诊断（对 cc-switch 只读，输出落盘）：工作区 `cert-diag/`（README + snapshot/watcher/tls-probe/clock-drift + `out/` 证据，观察期至 2026-09-10）
- 实验矩阵与判定流水：工作区 `experiment-matrix.md`、`verdicts.md`
- 证据转写：工作区 `evidence/`；双 CLI 隔离副本与日志：`fix-{claude,codex}{,-r2}/`、`*-fix*-log.txt`
- 新增/修改代码：`bridge/server.js`（DEF-005）、`shell-ui.js`（DEF-003/004）、`research-chat-core.js` 与 `chat-actions-core.js`（DEF-001/002，第一轮）、5 个新增回归测试文件
- 落盘研究记录：`Research/Decisions/DEC-001.md`、`Research/Lessons/LES-001.md`、EXP-007 三条执行日志
