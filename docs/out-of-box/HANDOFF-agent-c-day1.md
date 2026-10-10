# Agent C · Day 1 交接说明（2026-09-20）

> 历史交接。2026-10-07 的后续集成已改为插件自包含运行时：core 嵌入
> `main.js`，首次启用只在本机展开；下文早期的远程下载和独立 browser pack 方案均已被取代。
> 当前权威文档是 `runtime-pack-strategy.md` 与
> `feature-dependency-matrix.md`。

分支：`agent-c/out-of-box-runtime`（worktree：`D:\scholarium-worktrees\out-of-box-runtime`，基线 `d429a6d`）
范围纪律：未触碰部署工作目录、未修改 `main.js`/`agent-canvas-demo/`、全部为新增文件。

## 今日交付

| 交付物 | 位置 | 说明 |
|---|---|---|
| 功能—依赖—降级清单 | `docs/out-of-box/feature-dependency-matrix.md` | 24 个 Python 技能经核实**全部纯标准库**（绘图为 dependency-free SVG 渲染器）→ embeddable Python 约 12 MB 即可覆盖；Ketcher 31 MB 与整个 `agent-canvas-demo/` 都过不了 BRAT 三件套，必须进运行时包 |
| 方案选型决策 | `docs/out-of-box/runtime-pack-strategy.md` | 当前权威决策为插件自包含运行时；固定版本包 + SHA-256 + 原子安装 + 回滚，但不再提供远程或手动安装分支 |
| 可运行原型 | `tools/runtime-bootstrap.js`（安装/校验/回滚/状态）、`tools/runtime-pack-build.js`（确定性 tar.gz + manifest 构建） | 纯 Node ≥20 标准库，零新依赖 |
| 原型测试 | `tests/runtime-bootstrap.test.js` | 当前测试覆盖确定性构建、安装回环、哈希拒绝、Zip Slip、升级回滚、本地包约束与平台路径 |

## 测试结果

`node tests/run.js`：**689 通过 / 1 失败**。唯一失败是 `write-surface-audit` 指纹，构成如下，**未代 Agent A 做指纹评审更新**：

| 基线 | digest | count | 备注 |
|---|---|---|---|
| 测试内 APPROVED | `30bcc7bc…` | 340（bridge-runtime 91） | 仓库内登记值 |
| 干净 HEAD `d429a6d` | `faee5b90…` | 343（bridge-runtime 94） | **既有漂移 bridge-runtime +3，属 Agent A 已知的「写入面 fingerprint 漂移」回归** |
| HEAD + 本分支新增 | `876c0e7b…` | 359（domain-and-maintenance-tools 86） | 增量 +16 全部来自本分支两个安装器文件，`unknown: []`，无未分类写入原语 |

建议：A 评审 bridge-runtime +3 的既有漂移时，可将本分支 +16 一并评审后更新 APPROVED。

## 需要 Agent A 集成的事项

1. 发布流水线用 `tools/runtime-pack-build.js` 产出 `core`，再用 `tools/embed-runtime-pack.js` 将经 SHA-256 校验的包嵌入 `main.js`。
2. `main.js` 注入运行时版本、大小与 SHA-256；插件运行期间不获取远程 manifest 或运行时资产。
3. 首次启动向导接 `status()` 状态机（absent/ready/degraded），状态显示只来自真实探测。
4. Ketcher 来源/版本/许可证确认仍在 A 侧。

## 需要 Agent B 吸收的事项

1. Bridge 启动器解释器解析顺序改为：①运行时包内 node/python → ②系统解释器（向后兼容）。改造点仅两处：`main.js` 的 `spawn("node", [launcher], …)` 与 `server.js:2173-2322` 的 `resolvePython`。
2. per-vault token/profile/pidfile 请在策略文档 §3 的目录布局（`<root>/config/`）下扩展；运行时根目录已在 Vault 与插件目录之外。
3. 运行时包构建是确定性的（排序 + mtime 归零 + 固定 mode），与 B 的「两干净目录逐字一致」目标兼容。

## 明日（Day 2）计划

1. `core` 包内容装配脚本：从 Agent A 冻结基线自动收集 bridge/skills/ketcher/node/python 为 staging 目录。
2. `main.js` 侧的最小接入补丁草案（仍由 A 合入）：启动时 `status()` 探测 + 向导 UI 草图。
3. Bridge 使用运行时内解释器的兼容补丁（供 B 评审）。
