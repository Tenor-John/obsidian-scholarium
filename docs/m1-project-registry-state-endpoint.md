# M1 · 课题注册表 + state 读端点（已实现并联调）

**状态：2026-08-17 已完成。** 对应 [`self-evolving-agent-design.md`](./self-evolving-agent-design.md) 里程碑 M1。回归测试 456 全绿（新增 15 个用例），Bridge 真实起服务联调通过。

## 一句话

面板和本地 Agent 现在可以**看见** vault 里的课题、假设结算和未结算实验结果了——三个 L0 只读动作 + 一个 Bridge 直读端点，**不需要 Obsidian 打开，不经过队列，毫秒级返回**。

## 架构决策：L0 读由 Bridge 直答，不走队列

既有动作通道是「Bridge 校验白名单 → 写 `Research/_runs/queue/` → 插件消费者 20 秒轮询执行」。这条通道对**写**完全正确（写必须由插件在 Obsidian 进程内完成，带 live context 和审计清单），但对**读**有两个不能接受的问题：

1. **延迟**：点一下"切换课题"要等最多 20 秒；
2. **依赖 Obsidian 打开**：队列消费者不在，读就挂起。

而 schema-v1 §7.1 早已规定 Markdown 是课题/假设/实验/证据的**真相源**。所以 L0 读动作由 Bridge 进程直接执行 `tools/research-state.js`（纯 Markdown 扫描，零依赖），`GET /v1/scholarium/state` 同步返回。队列通道只留给 L1+ 写动作，一条原则：**读直答，写入队**。

## 三个动作（tools/action-registry.js 已注册）

| 动作 | 级别 | 输入 | 输出 |
|---|---|---|---|
| `project.list` | L0 | 无 | 每个课题：uid / display_id / title / status / stage / path / 四类对象计数 / open_questions / **unsettled_experiments**（已出结论但未整合的实验数——闭环仪表盘的核心数字） |
| `project.get` | L0 | `{ project_uid }` 或 `{ display_id }`（display_id 仅为方便，内部立即解析成 uid 查找，遵守 §2.2） | 完整 Project 对象 + 假设列表（每条带 **settlement 结算账本**：supports / contradicts / qualifies / pending / rejected）+ 实验列表 + 问题列表 |
| `experiment.scan_outcomes` | L0 | 可选 `{ project_uid }` 限定范围 | 实验按生命周期分桶：**awaiting_integration**（concluded 但未 integrated，含结论摘要和 tests_hypotheses 的 display_id 解析）/ in_progress / settled / planned 计数 |

结算账本的口径（与工作总结文档中 "HYP-001 = 0 支持 / 0 反驳 / 4 限定 / 19 驳回" 一致）：

- 只有 `review_status: confirmed` 的 Evidence 计入 supports/contradicts/qualifies 正式票；
- `pending`（待审积压）和 `rejected`（已驳回）单独计数——Agent 必须能区分"没有证据"和"证据还没审"；
- `demonstration` 不计票（§4.5：流程演示不是证据）；
- 旧 Evidence 缺 `review_status` 时按 §4.5 兼容规则从 `verified_by_user` 推断。

## Bridge 端点

```
GET /v1/scholarium/state?action=project.list
GET /v1/scholarium/state?action=project.get&input={"display_id":"PRJ-001"}
GET /v1/scholarium/state?action=experiment.scan_outcomes&input={"project_uid":"<uuidv7>"}
```

- 认证：既有 `x-agent-bridge-token` 头，token 检查先于所有 `/v1/scholarium/*` 路由（有测试断言）。
- 门闸顺序与 POST 写路由一致（有测试断言）：`scholarium.enabled` → `vaultRoot` 存在 → `allowedActions` 白名单。
- **L0 以外的动作一律 409**，错误信息直接告诉调用者改用 `POST /v1/scholarium/actions`（实测：`rss.refresh_feed` 被正确拒绝）。
- 以 `dryRun: true` 执行，读操作**不写** `Research/_runs/actions/` 审计文件——轮询式读不该把审计目录刷爆（有测试断言 dry-run 不落盘、真跑才落盘）。
- 该路由内不得出现 `scholariumQueue.submit` / `spawn` / 任何文件写调用（有静态测试断言）。

响应形状：

```json
{ "action": "project.list", "at": "<ISO8601>", "result": { ... } }
```

## 实测（2026-08-17，真实 vault）

```
project.list  → PRJ-001：hypotheses 3 / experiments 5 / evidence 34，unsettled_experiments 3
scan_outcomes → awaiting_integration 首位是 EXP-005（同步/交替光照时序对照），
                tests_hypotheses 正确解析为 HYP-003，conclusion 摘要完整
无 token → 401；L1 动作 → 409；未白名单动作 → 403
```

## 改动清单

| 文件 | 改动 |
|---|---|
| `tools/research-state.js` | 新增：三个 handler + vault 索引 + 结算账本；只读 Markdown，不碰 data.json/live 对象 |
| `tools/action-registry.js` | 注册三个 L0 动作 |
| `agent-canvas-demo/bridge/server.js` | 新增 `GET /v1/scholarium/state`；`defaultScholariumConfig().allowedActions` 补三个动作 |
| `agent-canvas-demo/bridge/bridge.config.json`（本机真实配置，不进 git） | `allowedActions` 补三个动作 |
| `agent-canvas-demo/bridge/bridge.config.example.json` | 同步示例与说明 |
| `tests/research-state.test.js` | 新增 10 个用例：fixture 用 `schema-objects` 建真对象写真 Markdown，覆盖计数、结算账本、分桶、scope、错误路径、审计落盘语义 |
| `tests/scholarium-bridge-endpoints.test.js` | 新增 5 个静态安全检查：门闸顺序、L0-only、禁队列/禁 spawn/禁写、dry-run 语义、默认白名单 |

**没有动 main.js。** 读通道完全在插件进程外闭环，1.4MB bundle 零改动——这也是本里程碑能当天落地的原因。

## 已知边界（写进路线图的）

1. 扫描范围是 `Research/` 下的 schema-v1 对象。`agent-canvas-demo/EXPERIMENT_SCHEMA.md` 那套工作区级 `Experiments/` frontmatter（`outcome: supports/refutes/...` 字段）是另一套约定，P7 闭环回扫接入时要把 `outcome` 映射进 awaiting_integration 桶（或反过来：工作区实验结算后产出 schema-v1 Evidence）。
2. 读的是 Markdown 落盘态。Obsidian 里刚编辑未保存的内容不可见——对面板轮询场景可接受。
3. `data.json` 里的活态（RSS 缓存、评分）**故意不读**——Bridge 永不碰 data.json 的纪律不变；活态读取是 M4+ 的事，走插件侧供给。
