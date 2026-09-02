---
name: literature-partition
description: 把文献笔记按证据层级分仓：读过全文的进 fulltext-read/，其余（含已下载未读）进 metadata-only/，并回写 reading_status 与全文路径。
---
# Literature Partition

Run `scripts/partition_literature.py <workspace> [<json-input-or-file>]`。
先用 `{"dry_run": true}` 预览，再正式执行。

## 为什么需要它

所有笔记堆在一个目录里，会让"70 篇候选"在视觉上等同于"70 篇读过"。
物理分仓让证据层级无法被误读。

## 分仓判据

| 目录 | 条件 | 可用于 |
| --- | --- | --- |
| `literature/fulltext-read/` | 本地有 PDF **且**该 PDF 已生成 `direct_pdf_text` 证据卡 | 综述结论、空白判断、manuscript 论断 |
| `literature/metadata-only/` | 其余全部 | 仅候选线索 |

`metadata-only/` 内部再用 frontmatter 区分：

- `reading_status: metadata_only` — 没有本地全文。
- `reading_status: pdf_downloaded_unread` — PDF 已下载但未读，**仍不算证据**。

匹配方式：先按 DOI 在 PDF 文件名中比对（兼容 `/` 被写成 `-` `_` `.` 的情况），
再退回标题词元重合（≥3 个长词）。匹配到的路径写入 `fulltext_path`。

## 输出

- 迁移后的笔记（frontmatter 增加 `reading_status` / `evidence_shelf` / `fulltext_path`）
- 每个分仓目录下的 `README.md`
- `literature/_partition-index.json` — 本次迁移清单

重复运行是幂等的；读完全文并生成证据卡后再跑一次，笔记会自动从 `metadata-only/`
升级到 `fulltext-read/`。

## 边界

- 只处理 frontmatter 含 `type: literature-note` 的笔记。
- 其他子目录（如 `Photocatalysis/`）中的笔记不动，只在 manifest 里列出待人工归位。
