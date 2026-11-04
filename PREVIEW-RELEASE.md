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

## Acceptance coverage

Independent review supports:

- clean installation;
- the minimum functional workflow.

The following are **not covered** by the current acceptance result:

- upgrade from a previous installed version;
- rollback to the previous version;
- manually stopping an in-progress streaming response;
- Linux x64 real-machine acceptance.

This preview must not be described as having passed those tests. Upgrade, rollback, and manual streaming-stop tests against this same ZIP are required before a formal release.

## Clean installation

1. Create or select a test Vault. Back up any Vault that contains important data.
2. Download the fixed ZIP and verify its SHA-256 against `SHA256SUMS.txt`.
3. Extract the archive and confirm that it contains exactly the three package files.
4. Place those files in `<vault>/.obsidian/plugins/obsidian-scholarium/`.
5. Restart Obsidian, open **Settings → Community plugins**, and enable **Scholarium**.
6. Confirm that the installed manifest reports version `3.0.0` and minimum Obsidian version `1.10.0`.

No `data.json` is supplied. A clean installation starts without personal settings or credentials.

## Upgrade and rollback procedure — not yet validated

The following procedure describes what the remaining test must exercise; it is not a claim that upgrade or rollback has passed.

Before upgrading, back up the existing plugin directory. Replace only the three package files and keep the existing `data.json`. Restart Obsidian and verify settings and plugin behavior.

To roll back, disable Scholarium, restore the previously backed-up `main.js`, `manifest.json`, and `styles.css`, then restart Obsidian. Keep the original `data.json` unless a separate verified settings backup is available.

## Data and privacy

- Research notes, generated records, and literature stay in the selected local Vault unless a sync or external service is explicitly used.
- API keys, login cookies, Bridge configuration, browser profiles, runtime state, and backups are local-only and excluded from the package.
- Optional features may contact configured AI providers, OpenAlex, Crossref, Unpaywall, MinerU, Hugging Face, RSS feeds, WebDAV/S3 storage, or institutional WebVPN services.
- The local Bridge is intended to listen on localhost; it is not a remote server.

Use [ACCEPTANCE.md](ACCEPTANCE.md) to record the remaining tests and any machine-specific failures.
