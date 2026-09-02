# 织研者 Agent Bridge

这个 Bridge 只监听 `127.0.0.1:4318`，把画板与本机 CLI 连接起来；它不会向局域网或公网开放端口。

在 `agent-canvas-demo` 目录中，推荐使用 npm 一键启动网页和 Bridge：

```powershell
npm install
npm start
```

然后访问 `http://127.0.0.1:4173`。启动器会自动识别本机 Bridge，并在内部附带 token；使用者无需复制或粘贴 token。

```powershell
node .\bridge\server.js
```

首次启动会生成 `bridge.config.json`。该文件含本机 token，不要上传、提交或分享。

当前演示配置允许真实执行，但有三层不可绕过的限制：

- 只允许配置中登记的 Agent；网页不能提交任意 shell 命令。
- 只允许 `permission: "read"` 的任务；不能写入笔记或代码。
- 只允许 `allowedRoots` 中的本地目录；子进程以 `shell: false` 启动。

已验证的适配器是 Codex。Windows 上它通过 Node 直接调用全局 npm 的 `@openai/codex` 入口，避免 npm 的 `.cmd` 包装和 Windows Store 可执行文件限制。Claude Code、OpenCode、Hermes、OpenClaw 仍需分别核对各自的非交互命令和权限模型后再启用。
