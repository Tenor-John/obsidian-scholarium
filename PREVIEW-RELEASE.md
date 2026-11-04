# Scholarium 3.0.0 artifact-based preview

This is a sanitized preview package for independent-machine evaluation. It is not a formal stable release and has not been submitted to the Obsidian Community Plugin Directory.

## Fixed preview artifact

The package is `release/3.0.0-acceptance/obsidian-scholarium-3.0.0-acceptance.zip`.

- Plugin version in `manifest.json`: `3.0.0`
- Minimum Obsidian version: `1.10.0`
- ZIP SHA-256: `217171296d5431d741ae002dd5d34539bcfa7d3fb925a63c686f7528f1cd7a24`
- Package contents: exactly `main.js`, `manifest.json`, and `styles.css`

The ZIP and its adjacent `SHA256SUMS.txt` are publicly available in this branch. Verification does not depend on any local machine path. All further preview acceptance must use this exact ZIP and hash.

## Provenance boundary

This package was assembled from the installed test-Vault plugin artifact and sanitized for distribution. It was not produced by a clean source-workspace build. The source workspace and installed `main.js` were not hash-identical, so source-to-package equivalence and reproducible builds are not claimed.

The existing source snapshot remains in the repository for development, but it is not evidence that it reproduces this preview artifact. Source alignment is a separate formal-release gate.

## Acceptance coverage — overall BLOCKED

The fixed ZIP was retested on Windows 11 x64 with Obsidian 1.15.0 on 2026-11-04.

| Check | Result and boundary |
| --- | --- |
| Clean installation and minimum functional workflow | PASS from the preceding independent review |
| 2.0.8 → 3.0.0 upgrade | PASS within startup, settings retention, synthetic literature reading, and note-saving checks |
| Rollback to 2.0.8 | PASS within the same local scope; the upgraded `data.json` was retained without restoring the old configuration |
| Complete external AI workflow after version switching | NOT RETESTED in the upgrade/rollback copies |
| Manual stop while partial response text is visibly streaming | **BLOCKED / NOT COVERED**: two long responses completed, but the required observable state was not captured |
| Stop during the thinking phase | PASS as an auxiliary check |
| Same-session request recovery after stopping | PASS; no duplicate writes or cross-session writes were observed in the recorded scope |
| Linux x64 real-machine acceptance | PENDING |

The blocked streaming-stop result does not establish a product defect: the test did not reach the state needed to evaluate that behavior. It also must not be counted as a pass. The overall three-item follow-up gate remains **BLOCKED**, and this preview must not be described as having passed all acceptance gates.

See [ACCEPTANCE-RESULT-2026-11-04.md](ACCEPTANCE-RESULT-2026-11-04.md) for the sanitized result summary.

## Clean installation

1. Create or select a test Vault. Back up any Vault that contains important data.
2. Download the fixed ZIP and verify its SHA-256 against `SHA256SUMS.txt`.
3. Extract the archive and confirm that it contains exactly the three package files.
4. Place those files in `<vault>/.obsidian/plugins/obsidian-scholarium/`.
5. Restart Obsidian, open **Settings → Community plugins**, and enable **Scholarium**.
6. Confirm that the installed manifest reports version `3.0.0` and minimum Obsidian version `1.10.0`.

No `data.json` is supplied. A clean installation starts without personal settings or credentials.

## Validated upgrade and rollback scope

The 2.0.8 → 3.0.0 upgrade retained the existing `data.json` and passed startup, settings, synthetic literature reading, and note-saving checks. Rollback restored the 2.0.8 three-file artifact while retaining the upgraded `data.json`; startup, settings, existing notes, and continued note editing passed.

These results are limited to the synthetic test baseline and do not establish compatibility with every configuration, real long-term Vault, or the complete external AI workflow after version switching.

## Data and privacy

- Research notes, generated records, and literature stay in the selected local Vault unless a sync or external service is explicitly used.
- API keys, login cookies, Bridge configuration, browser profiles, runtime state, and backups are local-only and excluded from the package.
- Optional features may contact configured AI providers, OpenAlex, Crossref, Unpaywall, MinerU, Hugging Face, RSS feeds, WebDAV/S3 storage, or institutional WebVPN services.
- The local Bridge is intended to listen on localhost; it is not a remote server.

Use [ACCEPTANCE.md](ACCEPTANCE.md) to record the remaining tests and any machine-specific failures.
