# Research Weaver

研究课题证据审计与 Agent 工作流画板。项目采用本地优先方式：画板和 Agent Bridge 运行在使用者自己的电脑上，实验记录、CLI 登录态和 Bridge token 不会上传到仓库。

## 协作者启动

前提：安装 Node.js 20+，并安装和登录至少一个受支持的本地 Agent CLI（当前已验证 Codex）。

```powershell
git clone https://github.com/Tenor-John/research-weaver.git
cd research-weaver
npm install
npm start
```

打开 `http://127.0.0.1:4173`。画板会自动识别由同一条 `npm start` 启动的本机 Bridge；不需要复制、粘贴或在浏览器保存 token。首次运行产生的 token 只供本机启动器与 Bridge 内部通信，绝不提交或分享。

## 安全边界

- Bridge 仅监听 `127.0.0.1:4318`，不向公网开放。
- 真实执行仅允许登记的 Agent、只读任务和允许的本地目录。
- 当前示例已验证 Codex；其他 CLI 必须先验证其非交互参数与权限模型。

## 协作方式

- 用 GitHub 分支和 Pull Request 修改画板、Skill 与工作流模板。
- 每人把自己的实验资料保留在本地 Obsidian Vault。
- 不提交 `bridge/bridge.config.json`、token、实验原始数据或任何 API 密钥。
