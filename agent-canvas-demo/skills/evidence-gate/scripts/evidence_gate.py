#!/usr/bin/env python3
"""Evidence quality gate for the Scholarium research pipeline.

Why this exists
---------------
A pipeline run can complete every mechanical step (search -> dedupe -> download
-> notes -> synthesis -> draft) while resting on almost no full text.  The
2026-07-28 run is the reference failure: 124 candidate records, 1 successful
download, 3 evidence cards -- and it still produced a "manuscript draft".  A
draft that looks finished but is backed by metadata is worse than no draft,
because it launders abstract-level guesses into citable-looking prose.

So the gate is a hard precondition, not advice.  nature-writing and
nature-polishing call evaluate() and refuse to emit a manuscript unless the
evidence floor is met.  When the gate blocks, the run still produces something
useful: a retrieval/download diagnostic instead of a draft.

Run directly:  python evidence_gate.py <workspace> [<json-input-or-file>]
Import:        from evidence_gate import evaluate
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Floors are deliberately low: they are a "is this even arguable" bar, not a
# quality standard.  Passing the gate means a draft is allowed to be attempted,
# never that the evidence is sufficient for a real review.
DEFAULT_THRESHOLDS = {
    "min_fulltext_pdfs": 10,
    "min_download_ratio": 0.20,
    "min_evidence_cards": 20,
}

# Directories under downloaded-pdfs/ that hold deliberately parked files; they
# must not inflate the full-text count.
ARCHIVE_DIR_NAMES = {"_archive-irrelevant", "_archive", "_trash", "_rejected"}

# Publisher login walls and Cloudflare interstitials are frequently saved as
# small HTML-ish blobs with a .pdf name.  Anything this small is not a paper.
MIN_PDF_BYTES = 8 * 1024


def load_input(value):
    if value and Path(value).exists():
        try:
            return json.loads(Path(value).read_text(encoding="utf-8"))
        except Exception:
            return {}
    if value:
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


def _rel(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def candidate_records(root: Path) -> list:
    file = root / "literature" / "exports" / "deduped-records.json"
    if not file.exists():
        return []
    try:
        return json.loads(file.read_text(encoding="utf-8")).get("records", []) or []
    except Exception:
        return []


def downloaded_pdfs(root: Path) -> list[Path]:
    base = root / "literature" / "downloaded-pdfs"
    if not base.exists():
        return []
    found = []
    for pdf in base.rglob("*.pdf"):
        parts = pdf.relative_to(base).parts[:-1]
        if any(part in ARCHIVE_DIR_NAMES for part in parts):
            continue
        try:
            if pdf.stat().st_size < MIN_PDF_BYTES:
                continue
        except OSError:
            continue
        found.append(pdf)
    return found


def evidence_cards(root: Path) -> tuple[list, list]:
    """Return (all cards, cards actually backed by extracted PDF text)."""
    base = root / "literature" / "evidence-cards"
    cards = []
    if base.exists():
        for file in sorted(base.glob("*.json")):
            try:
                cards.append(json.loads(file.read_text(encoding="utf-8")))
            except Exception:
                continue
    direct = [
        card
        for card in cards
        if card.get("evidence_tier") == "direct_pdf_text"
        and any(str(claim).strip() for claim in (card.get("claim_candidates") or []))
    ]
    return cards, direct


def _bucket(result: dict) -> str:
    """Map a raw downloader result onto a fixable failure category.

    Knowing "123 failed" is useless for debugging; knowing "68 no_pdf_found,
    31 needs_login, 12 cloudflare_challenge" tells you what to fix first.

    Signals live in three places: the status, the error text, and the landing
    page itself -- a Cloudflare interstitial reports the generic "no PDF found"
    error and only reveals itself through the page title / `__cf_chl` URL token.
    """
    status = str(result.get("status") or "").strip().lower()
    err = " ".join(
        str(result.get(key) or "") for key in ("error", "title", "page_url", "final_url")
    ).lower()
    if status in {"downloaded", "ok", "success"}:
        return "downloaded"
    if status == "blocked_policy":
        return "blocked_policy"
    if status == "needs_login" or "not logged in" in err or "access expired" in err:
        return "needs_login"
    if "too_many_redirects" in err or "err_too_many_redirects" in err:
        return "redirect_loop"
    if "timeout" in err or "timed out" in err or "etimedout" in err:
        return "timeout"
    if "cf_chl" in err or "just a moment" in err or "cloudflare" in err:
        return "cloudflare_challenge"
    if "not_pdf" in err or "content_type" in err:
        return "not_pdf_download"
    if "no downloadable pdf" in err:
        return "no_pdf_found"
    if status == "manual_required":
        return "manual_required"
    if "net::err" in err or "urlerror" in err or "connection" in err or "ssl" in err:
        return "network_error"
    if status in {"needs_login_or_manual_check"}:
        return "needs_login"
    return "other"


def download_diagnosis(root: Path, max_logs: int = 12) -> dict:
    """Aggregate every downloader log into a per-reason breakdown."""
    log_dir = root / "Scholarium" / "runtime" / "download-logs"
    logs = sorted(log_dir.glob("paper-downloader-*.json"), reverse=True)[:max_logs] if log_dir.exists() else []
    buckets: dict[str, int] = {}
    hosts: dict[str, dict[str, int]] = {}
    examples: dict[str, str] = {}
    latest = {"file": None, "run_at": None, "total": 0, "downloaded": 0}
    total = 0
    for index, log in enumerate(logs):
        try:
            payload = json.loads(log.read_text(encoding="utf-8"))
        except Exception:
            continue
        results = payload.get("results") or []
        if index == 0:
            latest = {
                "file": _rel(root, log),
                "run_at": payload.get("run_at"),
                "total": len(results),
                "downloaded": sum(1 for r in results if _bucket(r) == "downloaded"),
            }
        for result in results:
            total += 1
            bucket = _bucket(result)
            buckets[bucket] = buckets.get(bucket, 0) + 1
            url = str(result.get("page_url") or result.get("url") or "")
            host = urlparse(url).netloc or "unknown"
            hosts.setdefault(bucket, {})
            hosts[bucket][host] = hosts[bucket].get(host, 0) + 1
            if bucket not in examples and result.get("error"):
                examples[bucket] = str(result["error"])[:220]
    top_hosts = {
        bucket: sorted(counts.items(), key=lambda kv: -kv[1])[:5]
        for bucket, counts in hosts.items()
        if bucket != "downloaded"
    }
    return {
        "logs_scanned": len(logs),
        "attempts_total": total,
        "latest_run": latest,
        "by_reason": dict(sorted(buckets.items(), key=lambda kv: -kv[1])),
        "top_hosts_by_reason": top_hosts,
        "example_errors": examples,
    }


def _override(root: Path) -> dict | None:
    """An explicit, written, human override -- never a silent bypass.

    Research/evidence-gate-override.json must name a reason.  Anything produced
    under an override is stamped as not citable, so the escape hatch cannot be
    used to quietly manufacture a clean-looking draft.
    """
    file = root / "Research" / "evidence-gate-override.json"
    if not file.exists():
        return None
    try:
        payload = json.loads(file.read_text(encoding="utf-8"))
    except Exception:
        return None
    reason = str(payload.get("reason") or "").strip()
    if len(reason) < 10:
        return None
    return {"reason": reason, "acknowledged_by": payload.get("acknowledged_by") or "unspecified"}


def evaluate(root: Path, thresholds: dict | None = None) -> dict:
    root = Path(root).resolve()
    limits = dict(DEFAULT_THRESHOLDS)
    for key, value in (thresholds or {}).items():
        if key in limits:
            try:
                limits[key] = float(value) if key == "min_download_ratio" else int(value)
            except (TypeError, ValueError):
                pass

    records = candidate_records(root)
    pdfs = downloaded_pdfs(root)
    cards, direct = evidence_cards(root)
    ratio = (len(pdfs) / len(records)) if records else 0.0

    failed = []
    if len(pdfs) < limits["min_fulltext_pdfs"]:
        failed.append(
            f"fulltext_pdfs={len(pdfs)} < min_fulltext_pdfs={limits['min_fulltext_pdfs']}"
        )
    if not records:
        failed.append("candidate_records=0 (no deduped-records.json; retrieval has not produced a pool yet)")
    elif ratio < limits["min_download_ratio"]:
        failed.append(
            f"download_ratio={ratio:.1%} < min_download_ratio={limits['min_download_ratio']:.0%}"
        )
    if len(direct) < limits["min_evidence_cards"]:
        failed.append(
            f"evidence_cards(direct_pdf_text)={len(direct)} < min_evidence_cards={limits['min_evidence_cards']}"
        )

    override = _override(root) if failed else None
    status = "pass" if not failed else ("override" if override else "blocked")

    return {
        "gate": "evidence-gate",
        "status": status,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "candidate_records": len(records),
            "fulltext_pdfs": len(pdfs),
            "download_ratio": round(ratio, 4),
            "evidence_cards_total": len(cards),
            "evidence_cards_direct": len(direct),
        },
        "thresholds": limits,
        "failed_rules": failed,
        "override": override,
        "writing_allowed": status != "blocked",
        "evidence_claim_ceiling": (
            "manuscript_draft" if status == "pass" else "candidate_pool_and_diagnostics_only"
        ),
        "download_diagnosis": download_diagnosis(root),
    }


def write_diagnostic(root: Path, verdict: dict) -> str:
    """When writing is blocked, this report is the run's actual deliverable."""
    out_dir = root / "Research"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "retrieval-download-diagnostic.md"
    metrics = verdict["metrics"]
    diag = verdict["download_diagnosis"]

    reasons = "\n".join(f"- {rule}" for rule in verdict["failed_rules"]) or "- (none)"
    by_reason = "\n".join(
        f"| {reason} | {count} | {', '.join(f'{h} x{c}' for h, c in diag['top_hosts_by_reason'].get(reason, [])) or '-'} |"
        for reason, count in diag["by_reason"].items()
    ) or "| (no downloader logs found) | 0 | - |"
    examples = "\n".join(
        f"- **{reason}**: `{message}`" for reason, message in diag["example_errors"].items()
    ) or "- (no error samples)"

    content = f"""---
type: retrieval-download-diagnostic
generated_at: {verdict['evaluated_at']}
gate_status: {verdict['status']}
citable: false
---

# 检索与下载诊断报告

本次运行**未通过全文证据门**，因此不生成 manuscript draft。
本文件是这次运行的正式产物；`Research/deep-research-synthesis.json` 只能当作候选文献池的初筛记录，不能当作综述结论。

## 1. 证据体量

| 指标 | 数值 | 阈值 |
| --- | --- | --- |
| 候选记录 candidate_records | {metrics['candidate_records']} | - |
| 本地全文 fulltext_pdfs | {metrics['fulltext_pdfs']} | ≥ {verdict['thresholds']['min_fulltext_pdfs']} |
| 全文覆盖率 download_ratio | {metrics['download_ratio']:.1%} | ≥ {verdict['thresholds']['min_download_ratio']:.0%} |
| 证据卡片（读过全文） | {metrics['evidence_cards_direct']} | ≥ {verdict['thresholds']['min_evidence_cards']} |
| 证据卡片（全部层级） | {metrics['evidence_cards_total']} | - |

未通过的规则：

{reasons}

## 2. 下载失败原因分类

扫描日志数：{diag['logs_scanned']}；累计尝试：{diag['attempts_total']}。
最近一次运行：`{diag['latest_run']['file']}`（{diag['latest_run']['run_at']}），
成功 {diag['latest_run']['downloaded']}/{diag['latest_run']['total']}。

| 失败类别 | 次数 | 主要域名 |
| --- | --- | --- |
{by_reason}

典型报错样本：

{examples}

## 3. 按类别的修复动作

- `needs_login` → 跑 `paper-downloader mode=login`，在可见浏览器里重新完成 WebVPN/CARSI 登录，确认 profile 未过期。
- `no_pdf_found` / `manual_required` → 落地页解析规则不够；优先补 Nature、ScienceDirect/linkinghub、Wiley、ACS、RSC 的 PDF 链接选择器，或改为按 DOI 直连出版商 PDF 端点。
- `cloudflare_challenge` → 该域名不能自动过；标记为人工下载队列，不要重试消耗预算。
- `redirect_loop` → 多为 `http://` 起始的 Cell/Elsevier 链接；统一先升级到 `https://` 再请求。
- `not_pdf_download` → 拿到的是 HTML 登录页/同意页；说明 cookie 或机构授权没生效，按 `needs_login` 处理。
- `timeout` / `network_error` → 单条超时预算与 WebVPN 稳定性问题，考虑降低并发、加重试。

## 4. 结论

在下载链路修好、证据卡片数量达标之前，本课题只允许输出：候选文献池、检索式调试记录、下载诊断。
**不允许**输出：正式综述、研究空白判断、manuscript draft、polished draft。
"""
    target.write_text(content, encoding="utf-8")
    return _rel(root, target)


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    verdict = evaluate(root, payload.get("thresholds") if isinstance(payload, dict) else None)

    out_dir = root / "Research"
    out_dir.mkdir(parents=True, exist_ok=True)
    verdict["gate_record"] = "Research/evidence-gate.json"
    verdict["diagnostic_report"] = (
        write_diagnostic(root, verdict) if verdict["status"] != "pass" else None
    )
    (out_dir / "evidence-gate.json").write_text(
        json.dumps(verdict, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"skill": "evidence-gate", **verdict}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
