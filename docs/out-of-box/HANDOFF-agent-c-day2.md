# Agent C · Day 2 交接说明（2026-09-20）：sidecar 载荷关键项与发布判据落地

> 历史交接。2026-10-07 后续集成已关闭下文 browser-pack 与远程下载待办：core
> 已嵌入插件，L2 用包内 Node 真启动系统 Edge/Chrome。当前权威
> 文档是 `runtime-pack-strategy.md` 与 `feature-dependency-matrix.md`。

分支：`agent-c/out-of-box-runtime`（基线 `d429a6d` 之上，Day 1 提交之后）。
纪律复核：未触碰部署工作目录、未动写入面指纹（权威在 A）、全部为新增文件 + 对 C 自有文件的修改。

## C1 · sidecar 提级（完成）

`tools/runtime-pack-assemble.js` 装配顺序：① bridge ② **sidecar（shell-ui.js 等 42 个浏览器载荷文件，与 bridge 同级）** ③ skills ④ 根 tools/ ⑤ node/python 运行时 ⑥ ketcher ⑦ THIRD_PARTY 许可证。缺 shell-ui.js 即响亮失败（测试锁定）。布局完整保留仓库相对结构（bridge/skills 的 `../../tools` 引用不断裂）。

## C2 · 缺失降级（完成，有测试）

现状勘察：三件套环境下 XLSX 入口走 `schMaterialRunSkill → schMaterialBridgeJson`，失败时用户只会看到 `无法读取文件结构：fetch failed / ECONNREFUSED`——正是要消除的静默/费解失败。

交付 `tools/sidecar-notice.js`（零依赖、可内联进冻结 main.js）：`describeXlsxEntryUnavailable(runtimeState, error)` 把错误映射为六类可读中文通知（runtime-absent / degraded / bridge-unreachable / skill-disabled / skill-not-found / unknown），每条都含「是什么坏了 + 怎么办 + 可行动作」，原始错误只进 `detail` 字段。`tests/sidecar-notice.test.js` 8 项测试锁定契约，包括「任何输入不抛错、不返回空通知」。

**集成点（请 A 合入）**：`schOpenMaterialNormalization` 的 catch 与 `schMaterialBridgeJson` 失败路径——先取 `status().state`，再调 `describeXlsxEntryUnavailable`，把 `message` 显示在 modal 状态行，`detail` 折叠展示。

## C3 · 校验失败行为（完成，测试加强，发布判据 4）

`runtime-bootstrap.js` 的校验失败消息为可读中文：指明「SHA-256 不符 / 大小不符」+「已拒绝安装，现有环境未被改动」+「重新安装完整插件包」。测试同时断言 status 不变且无残留。**不存在降级运行或静默跳过路径**——verifyBuffer 之后才有任何写入。

## C4 · 信任模型（完成，措辞待 L-05 入库后复核）

当前信任根是插件内置 manifest 与运行时包的固定大小和 SHA-256。运行时初始化不依赖 HTTPS 或托管方；未来仍可用发布者离线密钥为内置 manifest 增加签名。

## C5 · 干净机复跑（机器一 ✅，机器二待协调方）

机器一（LAPTOP-PH5JUR15, win32 x64）全链路实测 **PASS**：57.1 MB core 包、6.6s 干净根安装、包内 embedded Python 真实跑通 `sch-data-normalize`、包内 Node 语法校验 Bridge 通过。证据 JSON 已录入策略文档 §7.1。

机器二：C 只有一台机器，不伪造结果。`tools/verify-clean-install.js` 已就绪，第二台干净 Windows 机器上一条命令产出可比对 JSON：

```
node verify-clean-install.js --manifest <本地 manifest.json> --pack-dir <本地包目录>
```

## C6 · 许可证集合（完成，构建期强制）

`tools/runtime-licenses/` 持有五份**完整原文**（官方源拉取，非转述）：Node v20.19.0 LICENSE（115 KB 含全部依赖许可）、Python 3.12 PSF LICENSE、Apache-2.0 全文、Ketcher 3.17.2 LICENSE + NOTICE（EPAM，对应 A 已确认的版本与 `THIRD_PARTY_NOTICES.md` 记录）。装配器强制校验五份齐全且 >200 字节（防占位符），缺一即失败并点名「C6 不可裁剪」。测试锁定。

## 额外发现（请 A 注意）

`agent-canvas-demo/bridge/.env` 真实存在于部署目录（已被 `.gitignore` 覆盖）。装配扫描器 fail-closed 拦下了它——机制有效，但发布前请确认该文件内容未进入过任何历史提交/恢复包。

## 测试与指纹

`node tests/run.js`：**703 通过 / 1 失败**（Day 1 为 689/1，新增 14 项全绿）。唯一失败仍为写入面指纹——现 digest `4dbf2261…`（HEAD 既有漂移 +3 bridge-runtime，属 A 的评审；C 分支累计 +32 个写入原语，全部可归因于 C 的四个安装/装配/验证工具文件，`unknown: []`）。C 未动 APPROVED 值。

## 明日（Day 3）候选

1. main.js 侧向导接入补丁草案（status() 探测 + sidecar-notice 接线），供 A 评审合入。
2. browser pack（Playwright Chromium）装配与按需下载路径。
3. 第二台机器证据回收后与机器一并入发布报告。
