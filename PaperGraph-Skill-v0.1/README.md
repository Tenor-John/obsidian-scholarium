# PaperGraph Skill v0.1

基于 LLM + RAG 的科研论文 PDF 知识图谱生成系统。

目标：
PDF -> Docling/GROBID -> Structured JSON -> LLM Schema Extraction -> Knowledge Graph -> Visualization

核心能力：

- PDF论文结构化解析
- 标题/作者/机构抽取
- 关键词聚类
- 实验方法抽取
- 耗材与测试方法关联
- 实验数据与实验结论关联
- 原文证据溯源
- 图谱导出与可视化

参考开源项目：

- Docling
- GROBID
- Docling-Graph
- LLM-Wiki
- GraphRAG
