# 运行时端口一致性：启动器、Bridge 与 iframe

状态：**已实现**（本文档的诊断结论已落地；测试侧迁移于 2026-09-24 完成，豁免已移除）。

> 说明：本工作副本不是 git 仓库，无法就地核对提交号，因此下表以「文件:行」作为落点证据。

## 原诊断（2026-09-17，保留作为背景）

当时 `start-local.js` 将 `AGENT_CANVAS_PORT`、`AGENT_BRIDGE_PORT` 当作启动时常量：传入 `0` 后 canvas 的真实端口不回读，pidfile 记录 `0`，origin 校验期待 `http://127.0.0.1:0`；Bridge 的真实端口也不回报给启动器，其 CORS 回退白名单仍以默认 `4173` 为基准。因此 `local-launcher.test.js` 的 `freePort()` 被给了一个有明确退出条件的暂时豁免。

该结论现已过期。`freePort()` 的先占后放本身是 TOCTOU——探针关闭到子进程 bind 之间存在窗口，本机实测过 6 个测试同时失败。

## 所需的同一笔运行时改动：逐项落地证据

| # | 要求 | 落点 | 本机实测 |
|---|---|---|---|
| 1 | canvas 在 `listen()` 成功后回读 `server.address().port`，后续 URL、pidfile、origin 校验均用实际端口 | `start-local.js:312-314`（回读）、`:297`（URL 基准）、`:153`/`:165`（CORS 与本地来源校验）、`:224`（代理目标） | 以 `AGENT_CANVAS_PORT=0` 启动，三次分别得到 canvas 端口 **3854 / 3857 / 2504** |
| 2 | Bridge 监听成功后，若有 IPC 通道则回报实际端口 | `bridge/server.js:5305-5308`（`{ type:'listening', service:'bridge', port: actualPort }`），失败时 `:5300` 回报 `listen-error` | 命中：启动器收到 `service:'bridge'` 消息并取用 |
| 3 | 启动器用 Bridge 实际端口更新代理与 pidfile | `start-local.js:90-92`（接收，`Number(message.port)`）、`:93`（写 pidfile）、`:86`（把实际 canvas 端口传给 Bridge） | IPC 实测：`{"type":"listening","canvasPort":8682,"bridgePort":8683,"launcherPid":44460,"bridgePid":43044}` |
| 4 | pidfile 名称不再由请求端口拼接／由显式 `AGENT_WEAVER_PIDFILE` 隔离 | `start-local.js:21-23`（默认名用 `process.pid`，非端口）、`:45`（写入 `actualCanvasPort`/`actualBridgePort`）、`:49`（删除前校验 `launcherPid === process.pid`，两个并发启动器不会互删） | 实测 pidfile：`canvasPort: 8682, bridgePort: 8683`（均非 0）；本机另一存活实例 `D:\ScholariumRuntime\runtime\profiles\v1ytx2fu\weaver.pid.json` 为 `canvasPort: 4461, bridgePort: 4462`，与 `netstat` 一致 |
| 5 | Bridge CORS 只接受运行时 canvas origin 与 `app://obsidian.md`，并以非默认 Origin 的真实 HTTP 请求回归 | `bridge/server.js:44-51`（`CANVAS_ORIGINS` 由 `AGENT_CANVAS_PORT` 构造）、`:1773-1775`（精确反射 origin）；启动器侧 `start-local.js:153`/`:165` | `local-launcher.test.js` 首个测试：真实 HTTP 断言精确反射动态 canvas origin，并拒绝 `http://127.0.0.1:4173` 与 `<origin>.evil.example` 后缀攻击 |
| 6 | 迁移 `local-launcher.test.js`，移除 `freePort()` 豁免 | `tests/local-launcher.test.js`、`tests/bridge-port-isolation-guard.test.js`（本次改动） | 见下 |

## 测试侧迁移（本次）

`local-launcher.test.js` 现在以 `AGENT_CANVAS_PORT=0`、`AGENT_BRIDGE_PORT=0` 启动启动器，从子进程的 `listening` IPC 消息中取真实端口，全程用这两个端口构造 URL。迁移同时加入了来源断言，防止"测试自己挑端口"或"回报常量"的回归：

- `reported.launcherPid === launcher.pid`——消息确实来自本测试 spawn 的那个进程；
- 两个端口均为 `> 0` 的整数，且互不相同；
- `bridge-port-isolation-guard.test.js` 的豁免分支已删除，改为断言所有 `*.test.js` 中该先占后放的辅助函数出现 **0** 次，并新增一条断言禁止 `PORT-HARNESS-EXEMPT` 标记本身回归（否则豁免机制可以自我复活）。

`start-local.js`、`bridge/server.js` 等生产代码**未作任何改动**——迁移的前提正是生产已支持。

## 验收

- `AGENT_CANVAS_PORT=0` 与 `AGENT_BRIDGE_PORT=0` 时，启动器报告两个非零、不同的实际端口 —— **通过**（IPC 与 pidfile 双证）；
- 动态 canvas Origin 的 Bridge CORS 响应精确反射该 origin —— **通过**（真实 HTTP 回归）；
- `local-launcher.test.js` 独立连续运行 —— **通过**，连续 6 次均为 `tests 16 / pass 16 / fail 0 / skipped 0`；全量 `npm test` 为 `tests 612 / pass 609 / fail 0 / skipped 3`（3 个 skip 为既有的 RDKit 未安装 ×2 与 DEC-008 闸门 ×1，与端口无关）；
- 两个并发启动器使用不同 pidfile，互不删除对方记录 —— **已实现**（`start-local.js:21-23`、`:49`），但**没有专门的并发回归测试**覆盖。

## 仍未完成 / 残留风险

1. **iframe 的代理调用与 postMessage 已通过实际 canvas origin；但宿主 `main.js` 仍有两处硬编码 `http://127.0.0.1:4173/bridge`**：
   - `main.js:34264` 的 `Md` 常量，使用点 `main.js:2118`（`runTheoryCli`）与 `main.js:36291`（`bridgeFetch`）。
   - `main.js` 是 esbuild 生成物，且不在本次允许改动的路径内，因此**未改动**。同文件中的现代路径（`main.js:43133`、`43165`）已改用 `ports.canvasPort`。这是本项契约目前唯一已知的未闭合点。
2. `main.js:652` 的 `const sourceOrigin = "http://127.0.0.1:4173"` **不是缺陷**：它是 legacy 共享 4173 页面的状态迁移源，注释已写明"copy it once into the dedicated-port iframe"，其回投方向用的是 `new URL(url).origin`（真实端口）。
3. 上文验收第 4 条（并发 pidfile 隔离）缺回归测试。
