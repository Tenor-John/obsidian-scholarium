#!/usr/bin/env python3
"""Read-only inventory of research sources in one authorized workspace."""
import json, sys
from pathlib import Path

EVIDENCE = {'.pdf', '.ris', '.bib', '.csv', '.tsv', '.xlsx', '.xls', '.ipynb'}
NOTES = {'.md', '.txt'}
EXCLUDE_DIRS = {'.git', 'node_modules', '.obsidian', 'agent-output'}

def classify(path: Path):
    suffix = path.suffix.lower()
    lower = path.name.lower()
    if suffix in EVIDENCE:
        return 'candidate_scientific_evidence'
    if suffix in NOTES and any(key in lower for key in ('experiment', 'record', 'lab', 'literature', 'paper', 'reference', 'roadmap', '课题', '实验', '文献', '路线')):
        return 'candidate_scientific_evidence'
    return 'operational_or_unclassified'

def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: inventory.py <authorized-workspace>')
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        raise SystemExit('authorized workspace does not exist or is not a directory')
    files = []
    for item in root.rglob('*'):
        if not item.is_file() or any(part in EXCLUDE_DIRS for part in item.relative_to(root).parts):
            continue
        kind = classify(item)
        files.append({'path': item.relative_to(root).as_posix(), 'kind': kind, 'bytes': item.stat().st_size})
    evidence = [item for item in files if item['kind'] == 'candidate_scientific_evidence']
    print(json.dumps({'workspace': str(root), 'candidate_evidence_count': len(evidence), 'no_scientific_sources_found': not evidence, 'candidate_evidence': evidence[:500], 'files_scanned': len(files)}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
