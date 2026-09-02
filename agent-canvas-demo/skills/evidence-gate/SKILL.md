---
name: evidence-gate
description: 全文证据质量门。统计候选记录/本地全文/证据卡片，判定本次运行是否允许进入写作阶段；不通过时输出检索与下载诊断报告，并给出下载失败原因分类。
---
# Evidence Gate

Run `scripts/evidence_gate.py <workspace> [<json-input-or-file>]`.

## 为什么需要它

流程跑完 ≠ 证据成立。一次运行可以在 124 条候选、1 篇全文、3 张证据卡的情况下，
照样产出一份看起来完整的 manuscript draft——这比不产出更危险，因为它把摘要级猜测
包装成了可引用的正文。本门是**硬前置**，不是提示。

## 判定规则（默认阈值）

| 规则 | 阈值 |
| --- | --- |
| `min_fulltext_pdfs` | 本地有效全文 PDF ≥ 10 |
| `min_download_ratio` | 全文 / 候选记录 ≥ 20% |
| `min_evidence_cards` | `evidence_tier == direct_pdf_text` 的证据卡 ≥ 20 |

任何一条不满足 → `status: blocked`，`writing_allowed: false`。
可通过输入 `{"thresholds": {...}}` 覆盖阈值（仅用于调参，不要用来放水）。

有效全文的口径：`literature/downloaded-pdfs/` 下 ≥ 8 KB 的 PDF，排除 `_archive-*` 目录
（登录墙/Cloudflare 拦截页常被存成几 KB 的伪 PDF，必须剔除）。

## 输出

- `Research/evidence-gate.json` — 判定记录，永远写。
- `Research/retrieval-download-diagnostic.md` — 仅在未通过时生成；此时它就是这次运行的正式产物。

诊断报告含下载失败分类：`needs_login` / `no_pdf_found` / `manual_required` /
`cloudflare_challenge` / `redirect_loop` / `not_pdf_download` / `timeout` /
`network_error` / `blocked_policy` / `other`，并列出每类的主要域名与典型报错。

## 例外

`Research/evidence-gate-override.json` 中写明 `reason`（≥10 字符）可强行放行，
状态变为 `override`，产出的稿件会被强制打上 `citable: false` 与显著警告横幅。
这是留痕用的逃生门，不是常规路径。

## 边界

- 不通过时禁止运行 `nature-writing` / `nature-polishing`。
- 通过只意味着"允许尝试起草"，不代表证据充分。
