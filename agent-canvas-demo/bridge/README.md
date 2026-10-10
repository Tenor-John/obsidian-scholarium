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

真实执行仍有三层不可绕过的限制：

- 只允许配置中登记的 Agent；网页不能提交任意 shell 命令。
- 只允许 `permission: "read"` 的任务；不能写入笔记或代码。
- 只允许 `allowedRoots` 中的本地目录；子进程以 `shell: false` 启动。

Bridge 会探测 Claude Code、Codex、OpenCode、Hermes 和 OpenClaw；只有真实通过 `--version` 探针的路径才会写入配置。Claude/Codex 的只读与研究车道使用仓库内固定的能力档案，探测过程不会自行删减工具参数。

## 云端向量 RAG

在设置中心的 API 钥匙串中配置 `HF_TOKEN` 后，`rag-ingest` 会调用 Hugging Face Inference Providers 生成归一化多语种 Embedding，并在本地保存带模型、维度、内容哈希和来源定位的索引。查询默认融合向量召回与 BM25；Token 缺失或云端故障会在结果中明确标记降级。`POST /v1/rag/graph` 可从同一份 RAG chunks 生成只含可追溯 `MENTIONS` 边的知识图谱。
