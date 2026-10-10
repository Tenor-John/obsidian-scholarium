# Scholarium 执行状态（2026-08-13）

本文件补充 [`execution-plan.md`](./execution-plan.md)：计划与真实交付不一致时，以本状态表和 Vault 校验结果为准。

## 已完成

- **Phase 0 工程地基**：回归套件、CI、分支保护、行尾约束与构建产物检查已启用。
- **Phase 0.5 新剪藏源保全**：新的全文剪藏会记录 raw / clean / meta 三层和可核验锚点；历史验证码归档仍是外部访问限制，不阻塞新数据。
- **Phase 1 Schema 与 ID**：13 类 ID 前缀已冻结；首闭环对象字段与证据定位契约已落盘。
- **Phase 2 主体迁移**：Project、Paper 和带附件的论文包已迁移并通过守恒与回滚演练。
- **Phase 3 对象闭环**：Project → Hypothesis → Experiment → Result block → Evidence → Hypothesis 已可运行；实验来源 Evidence 采用 `scholarium://experiment/<uid>` 定位并锁定取证时正文哈希。

## 本次新增（四项）

1. **实验状态流**：`idea → designed → ready → running → data_pending → analyzing → concluded → integrated`。每次只允许前进一步，必须填写理由，并在 `Research/_runs/actions/` 写入 Action Manifest。
2. **评分 Markdown 索引**：已有 RSS 评分与人工反馈同步到 `Research/RadarScores/`。索引只含文章元数据、评分和反馈，绝不包含 API Key、端点或其他插件设置；可从 Markdown 独立重建。
3. **Action Registry / 权限**：L0–L3 政策已定义；当前仅发布 L0 只读校验与 L1 可逆实验状态变更。L2/L3 没有已发布 Action，Agent 也没有确认 Evidence 或绕过人工确认的权限。
4. **Benchmark 前置**：评分索引可统计真实人工反馈；达到 50 条前只记录基线，不调整评分权重、不宣称已校准。

## 当前实测

- Vault schema 校验：49 个对象，无结构或关系问题。
- RSS：1500 篇文章，其中 13 篇已有评分已同步至 `Research/RadarScores/`；当前人工反馈为 0/50。
- 活性物种检验：`EXP-004` 处于 `designed`，等实验准备完成后通过“研究对象：更新当前实验状态”推进到 `ready`。

## 下一步的真实分工

**研究者**：执行 EXP-004，按阶段推进状态，并从结果块创建/审核 Evidence。

**系统**：保存可复核的结果、证据与状态历史；持续同步评分反馈；在获得至少 50 条人工反馈后才进行评分校准评估。

**仍未开始或未完成**：22 篇历史验证码页需在有机构访问时重抓；L2/L3 Action、嵌入索引、完整 Evidence Engine 与常驻 Agent 不在当前交付范围内。
