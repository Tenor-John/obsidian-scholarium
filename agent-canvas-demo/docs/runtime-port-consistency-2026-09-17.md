# 运行时端口一致性：启动器、Bridge 与 iframe

状态：诊断完成，尚未授权实现。

## 事实

`start-local.js` 将 `AGENT_CANVAS_PORT`、`AGENT_BRIDGE_PORT` 作为启动时常量使用。若传入 `0`，canvas 绑定后的真实端口不会回读；pidfile 仍记录 `0`，iframe 的 postMessage origin 校验也会错误期待 `http://127.0.0.1:0`。

同时，Bridge 的真实监听端口没有回报给启动器。`server.js` 的 CORS 回退白名单仍以默认 `4173` 为基准，不能覆盖动态 canvas origin。

因此，`local-launcher.test.js` 当前的 `freePort()` 属于有明确依据的暂时豁免：直接替换为端口 `0` 会测试一个生产实现尚不支持的模式，而不是修复测试。

## 所需的同一笔运行时改动

1. canvas 在 `listen()` 成功后读取 `server.address().port`，后续 URL、pidfile 与 origin 校验均使用实际端口；
2. Bridge 在监听成功后，若存在 IPC 通道则向启动器回报实际端口；
3. 启动器用 Bridge 实际端口更新代理与 pidfile；
4. pidfile 名称不再由请求端口拼接，或始终由显式 `AGENT_WEAVER_PIDFILE` 隔离；
5. Bridge CORS 只接受运行时 canvas origin 与 `app://obsidian.md`，并以非默认 Origin 的真实 HTTP 请求回归验证；
6. 完成上述实现和真实探测后，迁移 `local-launcher.test.js`，移除 `freePort()` 豁免。

## 验收

- `AGENT_CANVAS_PORT=0` 与 `AGENT_BRIDGE_PORT=0` 时，启动器报告两个非零、不同的实际端口；
- iframe 的代理调用与 postMessage 通过实际 canvas origin；
- 动态 canvas Origin 的 Bridge CORS 响应精确反射该 origin；
- 两个并发启动器使用不同 pidfile，互不删除对方记录；
- `local-launcher.test.js` 独立连续运行三次稳定，再纳入整体回归。

在这些条件满足前，端口回潮守卫可仅对 `local-launcher.test.js` 的 `freePort()` 设带本文件链接的显式豁免；不得放宽其他测试文件。
