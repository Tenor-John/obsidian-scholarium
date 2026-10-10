# 织研者 · 自学习/自进化 Agent 方案设计

**版本 v0.1 · 2026-08-17**

> 目标：给 Agent 一个课题主题，它能完成从「检索 → 建档 → 假设 → 实验 → 排程 → 回填 → 结算 → 修订」的全闭环，并且每跑一圈，课题画像、检索策略、实验安排都比上一圈更准。
>
> 前置文档：[`schema-v1.md`](./schema-v1.md)、[`bridge-control-plane.md`](./bridge-control-plane.md)、[`../agent-canvas-demo/EXPERIMENT_SCHEMA.md`](../agent-canvas-demo/EXPERIMENT_SCHEMA.md)、`research-pipeline.json`。

---

## 0. 一句话设计

**闭环不是一条流水线，而是一个控制回路：感知（读实验结果/新文献）→ 对齐（假设×实验×证据结算）→ 决策（修订画像与计划）→ 行动（排新实验/深化检索）→ 记忆（沉淀纠正与洞察）→ 再感知。** 现有的 12 步 Pipeline 只是这个回路的「第一圈的前半圈」。

---

## 1. 两种模式

### 1.1 Idea 模式（轻量，分钟级）

```
主题输入 → 检索式生成 → 多源 API 检索（OpenAlex/PubMed/S2/Scopus）
        → 去重 → 相关性初筛 → Idea 总结卡片
```

- 只读，不下载 PDF，不写 vault（除了一张 Idea 卡片）。
- 产出：**Idea 卡片**（见 §5.1），含主题概览、研究热点聚类、关键文献 Top-N、明显的空白点、以及一个「是否升级为课题」的建议。
- 出口有两个：**丢弃**（留档）或**一键升级为课题模式**（Idea 卡片直接成为课题画像 v0 的输入）。

### 1.2 课题模式（完整闭环，持续运行）

在 Idea 模式的基础上追加：文献下载 → 全文处理 → 知识图谱 → 课题画像与项目安排 → 假设群 → 实验方案入库 → 博士工作台排程 → 实验结果回填 → 假设结算 → 画像修订 → 下一圈。

两种模式共用同一条动作通道（action-registry 白名单）和同一套权限分级，区别只在**启用的阶段集合**。

---

## 2. 总体架构（四层）

```
┌─────────────────────────────────────────────────────────┐
│ 调度层  Orchestrator（模式路由 / DAG 执行 / 触发器）        │
│   - idea-dag.json  ·  project-dag.json（闭环回路 DAG）     │
│   - 触发：手动 / 事件（实验 outcome 变更、RSS 新高分文）/ 周期 │
├─────────────────────────────────────────────────────────┤
│ 动作层  action-registry（唯一写入通道）                     │
│   - L0 只读 / L1 可逆写 / L2 提议待确认 / L3 禁止           │
│   - 全部经 Research/_runs/queue/ → 插件消费者 → 审计清单    │
├─────────────────────────────────────────────────────────┤
│ 对象层  schema-v1（唯一真相）                               │
│   Project · Hypothesis · Experiment · Evidence · Paper    │
│   + 新增：Idea 卡片 · 课题画像（版本化） · 进化记忆条目       │
├─────────────────────────────────────────────────────────┤
│ 记忆层  两类记忆，分开存放、分开作用                          │
│   - 课题记忆：画像版本链、假设结算史、实验史（随课题走）       │
│   - 进化记忆：纠正/洞察/偏好（跨课题，作用于后续 prompt 与参数）│
└─────────────────────────────────────────────────────────┘
```

关键纪律（沿用既有原则，不在本方案中退化）：

- Agent 对实验记录只做 **frontmatter 字段级写入**，正文永远归研究者。
- Evidence 永不自动 confirm；假设结算（supports/refutes）以 **propose** 形式落盘，人工确认后生效。
- Bridge 只听 127.0.0.1，`shell:false`，动作全白名单。

---

## 3. 课题模式的八个阶段

```
P0 立项 ──→ P1 文献建档 ──→ P2 知识图谱 ──→ P3 假设生成
   ↑                                            │
   │                                            ▼
P7 闭环回扫 ←── P6 执行回填 ←── P5 排程 ←── P4 实验设计
   │
   └──→ P8 写作闸门（随时可手动触发，受 evidence-gate 硬约束）
```

### P0 立项（课题画像 v0）

- 输入：课题主题一句话（或 Idea 卡片升级）。
- 动作：`project.create`（L1）。
- 产出：
  - schema-v1 `PRJ-xxx` 对象；
  - **课题画像 v0**：研究问题、边界（做什么/不做什么）、核心概念表、关键词中英对照、已知约束（仪器、经费、时间）、成功标准（什么结果算"这个课题成了"）。
- 画像一旦创建即版本化（见 §4.2），之后每圈闭环 +1。

### P1 文献建档

- 直接复用现有 `research-pipeline.json` 第 1–8.5 步（检索式生成 → 多源检索 → 去重 → 机构通道下载 → 全文读卡 → 分层上架）。
- 全部 stop_rules 与 evidence_floor 原样保留——**证据地板是闭环可信度的前提**。
- 新增：每条检索式的命中率/低相关率写入**检索式表现日志**，喂给 §4.3 的检索式进化。

### P2 知识图谱

- 复用 `json-canvas` / `paper-knowledge-graph` skill。
- 产出 `Canvases/research-knowledge-graph.canvas`：实体 = 材料/方法/性能/机制/文献；边 = 证据支撑关系。
- 图谱不是展示品，是 P3 的输入：**假设从图谱的"结构空洞"（两簇实体之间缺边）和"冲突边"（两条边结论相反）里生成**。

### P3 假设生成

- 复用 `research-theory-dialogue`，但输入从"文献笔记"升级为"知识图谱 + 课题画像"。
- 产出假设群 `HYP-xxx`，每个假设强制带 `predicts` / `falsified_if`（写不出来 = 假设不可证伪，直接打回重写）。
- 假设按两个维度打分排序：**区分度**（能区分几个竞争解释）× **可行性**（现有仪器/工时能否做）。

### P4 实验设计

- 每个高优先级假设 → 至少一张实验卡草稿（`status: planned`），含变量表（independent/dependent/controlled/replicates）。
- 优先排**区分性实验**（参考 EXP-002 的定位：一个实验同时裁决多个假设）。
- 动作：`experiment.create_draft`（L1）；实验卡从 planned → running 的 transition 永远人工触发。

### P5 博士工作台排程

- 把 planned 实验 + 前置依赖（`blocked_by`）+ 仪器排期约束，排成**周计划**（本周做哪几个实验的哪几步）和**日计划**（今天的具体操作清单）。
- 产出位置：课题目录下 `Schedule/2026-W34.md` 形式的周计划笔记 + 博士工作台对应视图的数据。
- 动作：`schedule.propose_week`（**L2 提议制**——排程是人机博弈最强的地方，Agent 出草案，人拖拽确认后才生效）。
- 排程算法第一版不必聪明：拓扑排序（依赖）+ 贪心装箱（每日可用工时）就够；智能度交给后续进化记忆迭代。

### P6 执行回填

- 研究者做实验，在 `experiment.md` 填 `outcome` / `conclusion` / 数据路径。这一步**完全是人的**，Agent 只读。
- Agent 侧新增能力：`experiment.scan_outcomes`（L0）——扫 `Experiments/`，返回所有 `outcome != pending` 但尚未结算的实验。

### P7 闭环回扫（自进化核心，本方案的心脏）

触发条件（任一）：

1. `experiment.scan_outcomes` 发现未结算结果（事件触发）；
2. RSS 刷新出现高分新文献（事件触发，`rss.clip_high_score` 落库后）；
3. 每周固定时间（周期触发，周回顾）。

执行五步：

```
1) 结算   project-status：对齐 假设 × 实验 × 证据
          outcome=supports → 提议该假设 +1 支持
          outcome=refutes  → 提议该假设 +1 反驳，回填 problem_bank（resolved/仍 open）
          inconclusive     → 合法终态，记录"已排除了什么"，不得硬写成 supports
2) 诊断   若假设被反驳：给出"最可能的替代解释"候选（从知识图谱冲突边找）
          若 inconclusive：检查变量表——是不是控制变量漏了？重复次数不够？
3) 修订   课题画像 +1 版本：更新"已知/未知/争议"三栏，附 diff 说明改了什么、为什么
4) 再规划 生成下一批假设/实验提案（propose 制，人工确认后入库）
          同步修订周计划草案：已完成的划掉，新排入的标注来源假设
5) 记忆   本圈提炼 纠正/洞察/偏好 → 进化记忆（§4.4）
```

**闭环的反向箭头是灵魂**：现在 `deep-research` 的 `next_actions` 完全从文献推导，做完实验也不会变；接上 P7 之后，"下一步做什么"才反映真实进度。

### P8 写作闸门

- 随时可手动触发，但 `evidence-gate` 硬约束不变：证据地板不达标就只出检索/下载诊断，不出稿子。
- 新增输入维度：除了文献证据，综述/初稿现在还可以引用**已结算的自有实验结论**——这是闭环跑通后写作质量真正的跃迁点。

---

## 4. 自学习/自进化的四个机制

"自进化"不能是一句口号，必须拆成四个可验证的机制，每个都有明确的输入、输出和落盘位置。

### 4.1 假设结算引擎（学习"这个世界是什么样"）

- 输入：实验 outcome + 证据卡 + 假设的 predicts/falsified_if。
- 输出：每个假设的结算账本（支持/反驳/限定/驳回计数，类似现有 HYP-001 = 0/0/4/19）。
- 落盘：schema-v1 Hypothesis 对象的 `settlement` 字段（propose → 人工确认 → 生效）。

### 4.2 课题画像版本链（学习"这个课题现在进行到哪"）

- 画像每次闭环 +1 版本，永不覆盖旧版。
- 每版强制带三栏：**已知（有证据的）/ 未知（假设待裁决的）/ 争议（证据冲突的）**。
- diff 可读：第 n+1 版相对第 n 版改了什么、由哪个实验/哪篇新文献触发——这是"进化"最直观的可展示形态，也是面板上"进化"标签页的数据源。

### 4.3 检索式进化（学习"怎么查更准"）

- 每条检索式记录表现：命中数、去重后保留数、低相关率、最终进入证据卡的比例。
- 表现沉淀为偏好（例："本课题加 `photocatalysis` 反而掉准度"、"`facet ratio` 比 `exposed facet` 命中质量高"），下次 P1 自动应用。
- 与现有"低相关度自动深化检索"质量门互补：质量门是当圈补救，检索式进化是跨圈学习。

### 4.4 进化记忆（学习"怎么和你协作更好"）

- 每条记忆 = `{ type: correction | insight | preference, content, source_run, confidence, 适用范围 }`。
- 作用点明确：
  - correction → 注入后续同类任务的 prompt（"上次把 XRD 半峰宽误读成晶粒尺寸，这次注意"）；
  - insight → 进入课题画像候选修订；
  - preference → 修改默认参数（排程每日工时、检索源优先级）。
- **记忆必须可审计、可删除、可降权**——面板的"进化记忆"栏目前是占位符，这里就是它的数据源。错误记忆比没有记忆更糟。

---

## 5. 新增数据结构

### 5.1 Idea 卡片（schema-v1 新增对象 `Idea`）

```yaml
type: idea
id: IDEA-001
title: 一句话主题
created_at: ISO 8601
status: exploring | promoted | shelved   # promoted = 已升级为课题
summary: 主题概览（Agent 生成）
hotspots: [研究热点聚类]
key_papers: [DOI 列表，Top-N]
gaps: [识别到的空白点]
promoted_to: PRJ-xxx | null              # 升级后回填
```

### 5.2 课题画像（随 PRJ 对象走）

```yaml
profile_version: 3
research_question: ...
boundaries: { do: [...], dont: [...] }
known: [ { claim, evidence_ids } ]
unknown: [ { open_question, hypothesis_ids } ]
controversial: [ { conflict, evidence_ids } ]
success_criteria: ...
revision_note: 本版相对上版改了什么、触发源（EXP-xxx / DOI）
```

### 5.3 进化记忆条目

```yaml
type: evolution-memory
id: EVO-001
scope: global | PRJ-001
kind: correction | insight | preference
content: ...
source: { run_id, step, date }
confidence: low | medium | high
status: active | deprecated | deleted
```

---

## 6. 动作注册表扩展清单

全部走 `Research/_runs/queue/` 既有通道，按 L 分级：

| 动作 | 级别 | 说明 |
|---|---|---|
| `project.list / get` | L0 | 课题注册表读取（多课题切换的基础） |
| `project.create / update_profile` | L1 / L2 | 画像更新是 L2 提议制 |
| `idea.create / promote` | L1 | promote 会级联创建 PRJ，走 L2 |
| `literature.search / import` | L1 | 复用现有 pipeline 1–4 步 |
| `experiment.create_draft` | L1 | 仅 planned 状态 |
| `experiment.scan_outcomes` | L0 | P7 的感知入口 |
| `experiment.propose_transition` | L2 | running/done/abandoned 全要人工确认 |
| `hypothesis.propose / settle_propose` | L2 | 结算永不自动生效 |
| `schedule.propose_week / commit_week` | L2 / L1 | 草案 → 人确认 → 提交 |
| `evidence.list / propose` | L0 / L1 | **不设 confirm 动作**（现有红线保留） |
| `memory.write / deprecate` | L1 | 进化记忆写入带 source，可撤销 |
| `graph.query` | L0 | 知识图谱读取，供 P3/P7 使用 |

---

## 7. 面板 UX 对应改动

1. **模式开关**：新建入口分成「💡 Idea」/「🧪 课题」两个按钮；Idea 卡片列表页带"升级为课题"。
2. **课题注册表侧栏**：替代现在的单个 `workspaceRoot` 输入框；每个课题显示 画像版本号 / 未结算实验数 / 假设健康度（支持 vs 反驳）。
3. **闭环时间线**：每个课题一条时间线，标注每圈闭环的触发源与画像 diff——"自进化"的可视化证据。
4. **本周计划卡片**：P5 产出，支持拖拽调整后一键 commit。
5. **假设结算看板**：四列（待裁决 / 支持 / 反驳 / 存疑），卡片可点开看裁决实验。
6. **进化记忆栏**：从占位符变成真实列表，支持单条降权/删除。
7. **快捷键**（命令面板内）：`⇧⌘I` 新 Idea、`⇧⌘P` 新课题、`⌘1~9` 切课题、`⌘R` 触发闭环回扫、`⌘W` 本周计划。

---

## 8. 触发与运行模型

| 触发方式 | 场景 | 实现 |
|---|---|---|
| 手动 | 跑 P1–P4 首圈、随时触发 P7、P8 写作 | 面板按钮 / 快捷键 |
| 事件 | 实验 outcome 变更；RSS 高分文落库 | 插件内 `fs.watch` / vault 事件 → 投递队列（替代/补充现有 20s 轮询） |
| 周期 | 每周闭环回扫 + 周计划草案；每日 RSS 刷新 | 插件内定时器，写周计划草案为 L2 提议 |

---

## 9. 红线与失败模式（写死，不许退化）

1. Evidence 不自动 confirm；假设结算、实验 transition、周计划全是 propose 制。
2. 证据地板不达标，P8 不出稿，只出诊断。
3. `inconclusive` 是合法终态；任何"把不确定写成支持"的行为视为 bug。
4. 实验记录正文永不重写；frontmatter 字段级写入，改坏由校验器报错而非自动修。
5. 画像只增版本，不覆盖历史。
6. 进化记忆必须带来源、可删除；不得有无来源的"幽灵记忆"。
7. 下载只走机构通道 + 登记的 fallback；盗版镜像开关强制关闭（现有 hard_rule 保留）。

---

## 10. 分阶段实施路线

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 读通道 + 课题注册表 | `project.list/get`、`experiment.scan_outcomes`、面板课题侧栏 | 面板能列出全部 PRJ 并切换上下文 |
| M2 Idea 模式 | `idea-dag.json`、Idea 卡片对象与列表页 | 输入主题 10 分钟内出 Idea 卡片 |
| M3 首圈闭环（P0–P5） | 课题模式到排程为止，全部手动触发 | 一个新课题从主题到周计划草案全流程走通 |
| M4 回扫闭环（P6–P7） | 结算引擎、画像版本链、problem_bank 回填 | 做完一个实验填 outcome 后，画像 +1 版本且 diff 正确 |
| M5 进化机制 | 检索式表现日志、进化记忆写入与 UI | 第二圈检索的低相关率相对第一圈可度量地下降 |
| M6 触发器 + 周计划自动化 | 事件/周期触发、周计划 propose/commit | 每周一自动出周计划草案，人工确认后生效 |

M1–M2 不依赖任何新 skill，纯动作层扩展；M3 起才逐圈引入闭环逻辑。每个里程碑独立可交付，不做大爆炸式重写。
