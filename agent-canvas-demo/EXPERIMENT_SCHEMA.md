# 实验记录 schema（v1）

把「文献 → 证据」的单向链，补成「假设 ⇄ 实验 ⇄ 证据」的闭环。

## 契约

**frontmatter 是唯一真相；正文完全归你。**

- Agent 只做**结构化编辑**：读写 frontmatter 的具体字段，不重写整个文件，不碰 `---` 之后的任何内容。
- 你在正文里怎么写都行——贴图、贴仪器输出、写吐槽、写中途想到的岔路，都不会被覆盖。
- 你也可以手改 frontmatter。改坏了由校验脚本报出来，而不是被 Agent 默默改回去。

这条规则的代价是：Agent **不能**用「重新生成整个笔记」的方式更新实验记录。任何写入都必须是字段级的。

## 目录结构

```
Experiments/
  README.md
  _TEMPLATE.md                      ← 复制这个开新实验
  EXP-001-urea-concentration/
    experiment.md                   ← 记录本体，frontmatter 是契约
    data/
      raw/                          ← 仪器原始输出，只进不改
      processed/                    ← 清洗后，绘图和分析的输入
    figures/                        ← 绘图产出
  EXP-002-.../
```

`data/raw/` 视为不可变。清洗、裁剪、重命名一律输出到 `processed/`，
这样任何结论都能回溯到未经处理的原始文件。

## 字段

### 必填

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `experiment` | 固定值，与 `literature-note` 并列 |
| `id` | `EXP-\d{3}` | 稳定标识，等于目录名前缀，**定了不要改** |
| `title` | string | 一句话说清这个实验在测什么 |
| `status` | enum | `planned` / `running` / `done` / `abandoned` |
| `created_at` | ISO 8601 | |
| `updated_at` | ISO 8601 | 每次字段级写入都要更新 |

### 闭环字段（缺了闭环就断）

| 字段 | 类型 | 说明 |
|---|---|---|
| `hypothesis_id` | string | 对应 `research-theory-memory.json` 里的假设编号 |
| `hypothesis` | string | 假设原文，冗余保存，便于脱离记忆文件阅读 |
| `predicts` | string | **如果假设成立，会观察到什么**。写不出来说明假设不可证伪 |
| `falsified_if` | string | **什么结果会推翻它**。同上 |
| `outcome` | enum | `pending` / `supports` / `refutes` / `inconclusive` |
| `conclusion` | string | 一两句话，`outcome` 非 pending 时必填 |

`predicts` / `falsified_if` 是刻意要求的。事后再解释数据太容易，
先写死预测，实验才有裁决力。

### 数据与产物

| 字段 | 类型 | 说明 |
|---|---|---|
| `data_raw` | list[path] | 相对本实验目录 |
| `data_processed` | list[path] | 绘图/分析 skill 的输入 |
| `figures` | list[path] | |

### 关联

| 字段 | 类型 | 说明 |
|---|---|---|
| `linked_evidence` | list[string] | 证据卡片 id，如 `evidence-a3f2c1` |
| `linked_records` | list[string] | DOI，指向 `deduped-records.json` 里的文献 |

### 变量（选填，但强烈建议）

```yaml
independent: { name: 尿素浓度, unit: mol/L, levels: [0, 0.05, 0.1, 0.2] }
dependent:   [ { name: 晶面比, method: XRD, unit: ratio } ]
controlled:  [ { name: 温度, value: 180, unit: "°C" } ]
replicates: 3
```

没有这一块也能跑，但 `project-status` 判断「这个实验能不能区分假设与备择解释」时会退化成只看 `outcome`。

### 调度

| 字段 | 类型 | 说明 |
|---|---|---|
| `next_actions` | list[string] | 这个实验做完之后该干什么 |
| `blocked_by` | list[string] | 阻塞它的实验 id 或外部条件（如「等 XRD 排期」） |

## 状态机

```
planned ──→ running ──→ done
   │            │
   └────────────┴──→ abandoned
```

- `done` 要求 `outcome != pending` 且 `conclusion` 非空。
- `abandoned` 要求 `conclusion` 写明放弃原因——放弃本身是信息，别让它变成空洞。
- `outcome: inconclusive` 是**合法终态**，不是失败。硬把不确定的结果写成 supports 才是。

## 闭环怎么走

```
文献证据 ─┐
          ├→ theory-dialogue 提假设 ──→ 实验卡草稿（planned）
实验结果 ─┘                                    ↓
    ↑                                   你做实验、填数据、写结论
    └──── 扫 Experiments/ 读回 outcome ────────┘
                    ↓
   project-status：对齐 假设 × 实验 × 证据
                    ↓
   outcome 回填 problem_bank：supports/refutes → resolved
                              inconclusive     → 仍 open，附上已排除的可能
```

关键是那条反向箭头。现在 `deep-research` 的 `next_actions` 完全从文献推导，
做完实验也不会变；接上之后，「下一步做什么」才会反映你的真实进度。

## 校验

```bash
node bridge/server.js   # 或直接跑：
python skills/experiment-record/scripts/validate_experiments.py <workspace>
```

校验器只做两件事：**报错，不自动修**。因为 frontmatter 是双向契约，
擅自改写你手写的内容会破坏「正文和字段都归你」这个前提。

## 为什么不用 JSON 作为权威源

试过的三种：

- **笔记优先，Agent 只读**——你完全掌控，但 Agent 无法把「这个实验推翻了 H1」写回去，闭环缺一半。
- **JSON 优先，笔记是渲染产物**——结构最可靠，但你在正文里写的过程记录会被下次生成冲掉。实验记录里最有价值的往往恰恰是那些非结构化的观察。
- **frontmatter 双向**（当前选择）——字段归机器、正文归人，两边都不憋屈。代价是 Agent 必须实现字段级编辑。
