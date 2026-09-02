---
name: rag-ingest
description: 把 PDF（经 MinerU 云解析为 Markdown）和 Markdown 文献切块入库，并对入库语料做 BM25 检索；为 Agent 提供"读过的文献语料"查询能力。
---

# RAG 文献入库与检索

## 用途

把课题相关文献（PDF / Markdown）变成 Agent 可检索的语料库。PDF 通过
MinerU API 解析为结构化 Markdown（表格保留、公式跳过 OCR 公式识别以省
额度），Markdown 直接读取；统一切块后写入本地索引，支持关键词/混合
中英文检索。

## 运行方式

由 Bridge 的 `/v1/skills/run` 调度（skillId 为本 skill 的 file id），
`input` 为 JSON：

入库：
```json
{"mode": "ingest", "paths": ["Experiments/Literature/xxx.pdf", "Research/Notes/yyy.md"]}
```

检索：
```json
{"mode": "query", "query": "单原子 光催化 CO2 还原 选择性", "k": 5}
```

## 产出

- 解析语料：`Scholarium/runtime/rag-corpus/<hash>-<文件名>.md`
- 检索索引：`Scholarium/runtime/rag-index/chunks.jsonl`（每行一个块，
  含 source_path / title / heading / text，embedding 字段预留）
- manifest（stdout）：ingest 返回每文件的块数与错误清单；query 返回
  top-k 片段（来源路径 + 所在小节 + 得分 + 摘要）

## 边界

- 路径必须在传入的 workspace root 之内，越界即拒绝。
- 同一文件重复入库按内容哈希替换旧块，不会产生重复副本。
- MinerU key 只经环境变量传入，不落盘、不写进任何产出文件。
- 检索目前是 BM25 词项匹配（中英文都可用），不是向量语义检索；
  升级 embedding 时索引格式不变。
