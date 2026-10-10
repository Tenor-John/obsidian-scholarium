---
name: rag-ingest
description: 批量解析 PDF/Markdown，以 Hugging Face 云端模型生成归一化 Embedding，建立本地可追溯索引，执行向量+BM25 混合检索，并从同一批 RAG chunks 生成论文知识图谱。
---

# RAG 文献入库与检索

## 用途

把课题相关文献（PDF / Markdown）变成 Agent 可检索、可定位、可重建的语料库。
PDF 通过 MinerU API 解析为结构化 Markdown，Markdown 直接读取；按标题和
语义边界切块后，由 Hugging Face Inference Providers 的多语种模型生成归一化
Embedding。查询默认使用向量与 BM25 的 RRF 混合召回，并限制单篇文献占据
top-k 的数量。

## 运行方式

由 Bridge 的 `/v1/skills/run` 调度（skillId 为本 skill 的 file id），
`input` 为 JSON：

入库：
```json
{"mode":"ingest","paths":["Literature/xxx.pdf","Notes/yyy.md"],"embedding":"auto"}
```

检索：
```json
{"mode":"query","query":"单原子光催化 CO2 还原选择性","k":5,"retrieval":"hybrid"}
```

旧索引补算或模型切换后重算：
```json
{"mode":"reindex"}
```

只读诊断：
```json
{"mode":"status"}
```

用人工标注的小型查询集评估 Recall@k 与 MRR：
```json
{"mode":"evaluate","retrieval":"hybrid","k":5,"cases":[{"query":"Au 纳米星的种子生长方法","expected_sources":["Literature/au-nanostar.md"]}]}
```

从同一份 RAG 索引生成知识图谱计划（默认 dry-run）：
```json
{"mode":"graph","graph":{"limit":20,"keywords":["Au","CeO2"]}}
```

批量入库后立即构图；只有 `apply:true` 才写入时间戳视图：
```json
{"mode":"ingest-and-graph","paths":["Literature/a.pdf"],"embedding":"required","apply":true}
```

## 产出

- 解析语料：`Scholarium/runtime/rag-corpus/<hash>-<文件名>.md`
- 检索索引：`Scholarium/runtime/rag-index/chunks.jsonl`（每行一个块，
  含来源哈希、字符定位、正文、归一化向量和 embedding 元数据）
- 索引状态：`Scholarium/runtime/rag-index/index-meta.json`
- manifest（stdout）：ingest 返回每文件的块数与错误清单；query 返回
  top-k 片段、BM25/向量分项分数、实际检索模式与降级告警
- evaluate 返回 Recall@k、MRR、逐问题首个命中名次和降级次数

## 边界

- 路径必须在传入的 workspace root 之内，越界即拒绝。
- 同一文件重复入库按内容哈希替换旧块，不会产生重复副本。
- `MINERU_API_KEY` 和 `HF_TOKEN` 只经环境变量传入，不落盘、不写入 manifest。
- 默认模型：`ibm-granite/granite-embedding-311m-multilingual-r2`；模型、提供方、
  维度、归一化状态和内容哈希随每个向量记录，禁止混用不同向量空间。
- `embedding:auto` 在无 Token 或云端故障时会明确降级 BM25；
  `embedding:required` 会拒绝写入未向量化索引。
- `retrieval:vector` 无可用向量时直接失败；`retrieval:hybrid` 才允许明确降级。
- 知识图谱的边仍只表示 `MENTIONS`，每条边保留 source hash、chunk id、
  文本哈希和字符区间；不会自动创建或确认正式 Evidence。
