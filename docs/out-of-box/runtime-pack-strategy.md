# 运行时包策略决策：插件自包含本地运行时

**当前部署决策：采用「插件自包含本地运行时」——经过校验的运行时压缩包直接嵌入 `main.js`。用户只安装 Scholarium 一次；插件首次启用时在本机静默展开，不访问 GitHub，不区分在线/离线版本，也不要求用户管理 `incoming/` 或执行命令行。**

状态：Day 1 原型已落地（`tools/runtime-bootstrap.js` + `tools/runtime-pack-build.js` + `tests/runtime-bootstrap.test.js`）。

---

## 1. 为什么采用自包含 bundle

| 维度 | 插件自包含（当前） | 外置下载（已弃用） |
|---|---|---|
| 用户安装 | 只安装 Scholarium 一次 | 安装插件后还需第二次安装运行时 |
| 网络要求 | 安装来源可由 Obsidian 或用户自行选择；运行时不再联网 | 插件启动时需要连接运行时托管地址 |
| 内容构成 | `main.js` 内含压缩后的 core；首次启用时本机校验并展开 | core 位于独立远程资产 |
| 升级 | 新版插件携带匹配版本，自动切换 | 插件与远程运行时可能错配 |
| 失败恢复 | 重新加载可从内置包恢复；完整性失败则重新安装插件 | 依赖网络、代理或手动离线包 |
| 用户界面 | 不显示在线/离线选择，不要求运行时目录管理 | 需要下载、离线包和目录诊断流程 |

当前选择自包含方案，以更大的 `main.js` 换取单一安装入口和完全本地运行。用户不需要理解或管理单独的运行时。

## 2. 运行时包分层

| 包 | 内容 | 体积估算 | 何时提供 |
|---|---|---|---|
| `core`（必需） | 按 C1 顺序装配：① bridge（server + start-local.js + 生产 node_modules）② **sidecar 浏览器载荷（shell-ui.js 等，载荷关键项，与 bridge 同级）** ③ skills ④ 仓库根 tools/（bridge 的 `../../tools` 依赖）⑤ node + python embeddable 运行时 ⑥ ketcher.js/css ⑦ THIRD_PARTY 许可证集合 | 实测 57.1 MB（2.0.9-preview.4，含双解释器） | 构建时嵌入 `main.js`；首次启用时本机展开 |
| 浏览器自动化（并入 `core`） | Playwright `1.62.0` JavaScript 模块及完整 LICENSE/NOTICE/ThirdPartyNotices；浏览器进程复用 Windows 10/11 自带 Edge，若用户另装 Chrome 则作为第二候选 | Playwright 模块约 18.5 MB（已计入 core 实测体积） | 随 core 一次安装；不要求 npm、`npx playwright install` 或环境变量 |

第一阶段只做 `win32-x64`（对应 Windows 10/11 x64 的 Preview 定位）；manifest 结构按平台字段预留 macOS/Linux。Preview 不再分发 Chrome for Testing 二进制：它既会把首次下载再增加约 300 MB，也会引入单独的浏览器再分发许可审查。发布判据改为用**包内 Node + 包内 Playwright 真启动系统 Edge/Chrome并读取页面 DOM**；该 L2 探针失败的机器不得宣称 WebVPN/机构下载可用。

## 3. 安装位置（移出 Vault 与插件目录）

| 平台 | 运行时根目录 |
|---|---|
| Windows | `%LOCALAPPDATA%\Scholarium\runtime\` |
| macOS | `~/Library/Application Support/Scholarium/runtime/` |
| Linux | `~/.local/share/scholarium/runtime/` |

布局：

```
<root>/
  versions/<runtime-version>/<pack>/…   # 解包后的各版本运行时，可并存
  staging/                              # 首次本机展开的临时区，完成后清空
  current.json                          # 原子切换的版本指针（含 previous，供回滚）
  config/bridge.config.json             # per-install 令牌与配置（Day 2+：再细化 per-vault）
  logs/                                 # 审计与诊断
```

要点：`current.json` 永远先写临时文件再 rename（同目录 rename 在 NTFS/POSIX 上都是原子的）；旧版本目录保留一个，回滚 = 指针指回 `previous`，零数据移动。

## 4. 安全模型与信任根（C4）

**信任根声明（与协调记录 L-05 对齐；L-05 文本尚未落入任何我可读的仓库，以下按协调原话确认措辞，待 L-05 入库后复核）：**

> 当前部署的信任根是 **本地经过校验的 manifest 与运行时包**。插件不访问 GitHub。

措辞准确性确认（C 逐条核对实现后认可）：

1. **当前信任根是本地校验链**：manifest 内的 `sha256` 与 `size` 防止本地运行时包损坏、错配或半成品安装。
2. **哈希链仍然必要**：manifest 哈希钉定 + 逐包 SHA-256/大小校验，保证用户拿到的字节与发布者构建的字节一致（防损坏、防错配、防半成品），并支撑回滚与审计。
3. **后续演进路径**：可用离线签名密钥对内置 manifest 做签名；当前先使用构建时固定的 SHA-256 和大小校验。

实现层安全措施（不变）：

1. `main.js` 内固定发布版本号和 manifest SHA-256；当前部署不使用远程 manifest URL。
2. 读取 `main.js` 内置运行时 → 按 manifest 的 `sha256`+`size` 校验，**全部字节校验通过前不触碰最终目录**。
3. 解包在 `staging/` 完成并二次校验文件树，然后 `rename` 进 `versions/<version>/`；任何一步失败，staging 清空，现有可用运行时不受影响。
4. tar 解包器拒绝绝对路径、`..` 穿越与符号链接（Zip Slip 防护）。
5. token 由安装器生成并写入 `<root>/config/`，权限仅限当前用户；不进 Vault、不进插件目录、不进 git。

## 5. 包格式与构建

- 包文件：`scholarium-runtime-<pack>-<version>-<platform>.tar.gz`。
- 选择 tar.gz 而非 zip：Node 内建 `zlib` 可直接处理，无需任何第三方依赖；`tools/runtime-pack-build.js` 内置确定性 ustar 写入器（排序条目、mtime 归零、固定 mode），**同一内容两次构建逐字节一致**，与 Agent B「两个干净目录生成逐字一致产物」的要求对齐。
- manifest：`scholarium-runtime-manifest-<version>.json`，schema 见 `tools/runtime-bootstrap.js` 顶部注释（`scholarium-runtime-pack/1`）。

## 6. 首次启动向导状态机（只显示真实状态）

```
检查 current.json
├─ 运行时就绪        → 显示「本地技能已就绪」，附带逐项探测结果（CLI 未安装 /
│                      已装未启用 / 指定 CLI 不存在 / 外部服务需登录或 key，
│                      状态全部来自 tools/agent-detect.js 的真实探测，不假成功）
├─ 无运行时          → 从 main.js 内置包静默校验并展开，不发起网络请求
│   └─ 成功          → 同上「就绪」
│   └─ 失败          → 提示重新安装完整插件包，不要求用户另找运行时
└─ 有运行时但损坏     → 提示并自动回滚到 previous；无 previous 时回到「无运行时」
```

## 7. 验收指标对齐（外部 Beta）

原型直接支撑：升级成功率 100%（原子切换+回滚）、零凭据泄漏（token 出 Vault/插件目录、manifest 全链路哈希）、零跨 Vault 写入（运行时根目录与 Vault 完全分离）。首次初始化速度只取决于本机解码、校验和解包，不依赖网络或 CDN。

## 7.1 实测证据（2026-09-20，机器一 LAPTOP-PH5JUR15 / win32 x64 / 10.0.26200）

以脱敏冻结基线（移除 gitignored 的 `bridge.config.json` 与 `bridge/.env`，二者均已被 `.gitignore` 覆盖、不会出现在干净克隆中）全链路实测：

| 步骤 | 结果 |
|---|---|
| 装配（`runtime-pack-assemble.js`） | bridge=14 / sidecar=42 / skills=83 / tools=41，共 3722 文件；**fail-closed 实战立功：扫描器拦下了基线副本中残留的 `bridge/.env`** |
| 打包（`runtime-pack-build.js`） | `scholarium-runtime-core-2.0.9-preview.1-win32-x64.tar.gz`，**57.1 MB**（含 Node 20.19.0 + Python 3.12.10 embeddable + Ketcher + 全部许可证），sha256 `6b104f09…facfe6` |
| 干净根安装（`verify-clean-install.js`） | **PASS，6.6 秒**，status=ready，8 项关键载荷全部落位（含 sidecar `shell-ui.js` 与 4 份许可证） |
| 包内解释器功能探针 | 安装后的 embedded Python 真实运行 `sch-data-normalize` 处理 CSV 并产出带源哈希的规范 manifest；包内 Node `--check` 通过 `bridge/server.js` 与 `start-local.js` |

**判据 2（两台机器）状态：机器一 ✅；机器二待协调方执行** — `tools/verify-clean-install.js` 已就绪，在第二台干净 Windows 机器上运行同一命令即产出可比对的 JSON 证据。C 只有一台机器可用，不伪造第二台结果。

## 8. 交接与边界

- **给发布维护者**：`tools/runtime-pack-build.js` 产出 core 包，`tools/embed-runtime-pack.js` 校验固定大小与 SHA-256 后嵌入 `main.js`。发布前必须运行内置包测试与真实启动探针。
- **给 Agent B**：源码化时请将「Bridge 启动器解析 node/python 的顺序」改为：①运行时包内解释器 → ②系统解释器（向后兼容）；`resolvePython` 与 `spawn("node", …)` 是仅有的两个改造点（`main.js`、`server.js:2173-2322`）。运行时目录约定见 §3，per-vault token/pidfile 请在此布局下扩展。
- **C 不自做**：Bridge 路由源码化、per-vault 隔离、Ketcher 许可证确认（A）、DEC-008 解闸（B 申请、用户批准）、写入面指纹评审（A）。
