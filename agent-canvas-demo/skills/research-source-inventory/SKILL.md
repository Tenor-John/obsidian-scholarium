---
name: research-source-inventory
description: Inventory an authorized local research workspace before literature or experiment analysis. Use when an agent needs to determine whether experiment records, PDFs, reference exports, datasets, or Obsidian notes actually exist and to produce a structured evidence manifest without treating generated reports or application files as scientific evidence.
---

# Research Source Inventory

Run `scripts/inventory.py <authorized-workspace>` before making scientific claims.

Classify only these as candidate scientific evidence: experiment records, PDFs, reference exports (`.ris`, `.bib`, `.csv`), datasets, and research notes. Classify program code, configuration, and prior generated reports as operational material, never scientific evidence.

Return the generated JSON manifest. State `no_scientific_sources_found` when the inventory contains no candidate evidence. Do not infer that missing files do not exist outside the authorized workspace.

Use the manifest to decide the next Skill:

- PDFs/reference exports exist: run literature extraction.
- Experiment records/datasets exist: run evidence extraction.
- No candidate evidence exists: stop scientific adjudication and request the correct Vault or project folder.
