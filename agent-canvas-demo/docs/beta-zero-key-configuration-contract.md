# Beta 零密钥配置契约

状态：已定义并由 `beta-config-core.js` 单元测试覆盖；尚未接入新的 Obsidian 插件入口。

## 范围

Beta 只交付本地数据规范化、确定性绘图和基于 manifest 的图表改版。它不包含 RAG、MinerU、文献检索、云端 embedding 或任何第三方 API 配置。`sch-data-normalize` 与 `sch-data-plot` 是本地 Python 工具；它们不需要网络或 API key。

聊天是可选增强：只使用研究者已在本机登录的 Claude CLI 或 Codex CLI。Beta 不读取、保存、迁移或提示填写任何第三方 API key，也不依赖 cc-switch。

## 用户配置

唯一的 Beta 用户配置形状由 `beta-config-core.js` 定义：

```json
{
  "schemaVersion": 1,
  "vaultRoot": null,
  "execution": {
    "enabled": false,
    "preferredCli": "auto"
  }
}
```

- `execution.enabled` 默认 `false`。只有研究者在界面中明确选择“启用本机 Agent”后才能变为 `true`。
- `preferredCli` 仅可为 `auto`、`claude` 或 `codex`；CLI 路径、检测细节和适配器参数不是用户配置字段。
- 运行时状态机 `executionStateForConfig(config, detectedCli)` 必须接收**完整配置对象**，而不是 `config.execution` 子对象；它先验证整个配置再决定是否允许 CLI 执行。
- 未检测到所选 CLI 时，界面必须明确显示缺失原因并降级为“仅本地技能”，不能崩溃或伪称 Agent 可用。
- `vaultRoot` 在首次由研究者选择 Vault 后填写；发布包、示例文件和源码不得包含开发者的 Vault 路径。
- 配置拒绝未知字段，因此 API key、token、代理/cc-switch 设置和未来未经审查的扩展不能悄悄进入 Beta 配置。

## 本地 profile 隔离

新插件入口实现时，必须把下列运行时状态放在 Vault 与插件包之外、由操作系统用户账户保护的本地应用数据目录中：

- Bridge bearer token；
- 自动 CLI 探测结果与临时 adapter 配置；
- Bridge 审计 JSONL 与运行时 pidfile；
- 每个 Vault 对应的 profile 目录。

profile 目录名采用 Vault 规范路径的 SHA-256 截断值，而不是绝对路径文字。审计记录只写操作所需的相对路径、哈希、确认状态和最终提交的 recipe；不得写 bearer token、CLI 登录信息、API key 或完整本机路径。

Bridge bearer token 是本机进程间认证材料，不是第三方 API key；它不得进入 Obsidian `data.json`、Vault、发布包或版本库。

## 开箱体验与降级

1. 没有 CLI：显示“本地规范化与绘图可用；安装并登录 Claude CLI 或 Codex CLI 后可启用自然语言入口”。本地技能仍可运行。
2. 检测到 CLI、但未启用：显示检测结果和“启用本机 Agent”按钮；不得自动拉起 Agent。
3. 研究者确认启用：仅允许已验证的本机 CLI；审计 `source: local-cli`、真实 CLI 名称和 `route: 本机已登录 CLI`。
4. cc-switch 存在与否不得改变 Beta 可用性。它不是配置前提，也不得被记录为默认 provider。

## 实现前置

该契约是最小插件入口的输入。入口实现前还必须采用 `runtime-port-consistency-2026-09-17.md` 的运行时端口设计：动态端口、实际 origin、隔离 pidfile，并以真实 HTTP origin 探测验证 CORS/postMessage。

## 非目标

本契约不修改既有 `bridge.config.json`、`.env`、设置页面或 v2 `main.js`，也不迁移现有用户凭据。它们属于当前产品的旧能力面，不是 Beta 发布范围。
