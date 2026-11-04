# Scholarium 3.0.0 acceptance build

This package is distributed for independent-machine acceptance through GitHub. It is not a formal stable release and has not been submitted to the Obsidian Community Plugin Directory.

## Clean installation

1. Create or select a test Vault. Back up any Vault that contains important data.
2. Download `release/3.0.0-acceptance/obsidian-scholarium-3.0.0-acceptance.zip`.
3. Verify the ZIP hash using `SHA256SUMS.txt` in the same directory.
4. Extract the archive. Confirm that it contains exactly `main.js`, `manifest.json`, and `styles.css`.
5. Place those files in `<vault>/.obsidian/plugins/obsidian-scholarium/`.
6. Restart Obsidian, open **Settings → Community plugins**, and enable **Scholarium**.
7. Confirm that the installed manifest reports version `3.0.0` and minimum Obsidian version `1.10.0`.

No `data.json` is supplied. A clean installation starts without personal settings or credentials.

## Upgrade and rollback

Before upgrading, back up the existing plugin directory. Replace only the three package files; keep the existing `data.json` so local settings remain intact. Restart Obsidian after replacement.

To roll back, disable Scholarium, restore the previously backed-up `main.js`, `manifest.json`, and `styles.css`, then restart Obsidian. Keep the original `data.json` unless you have a separate, verified settings backup.

## Data and privacy

- Research notes, generated records, and literature stay in the selected local Vault unless a sync or external service is explicitly used.
- API keys, login cookies, Bridge configuration, browser profiles, runtime state, and backups are local-only and excluded from the package.
- Optional features may contact configured AI providers, OpenAlex, Crossref, Unpaywall, MinerU, Hugging Face, RSS feeds, WebDAV/S3 storage, or institutional WebVPN services.
- The local Bridge is intended to listen on localhost; it is not a remote server.

## Acceptance scope and limitations

- Windows x64 desktop Obsidian is the primary target for this independent-machine run.
- Linux x64 real-machine acceptance remains pending and must not be inferred from this package.
- This branch is an acceptance vehicle, not a formal release tag or Community Directory submission.
- The runtime-bearing `main.js` artifact is included. Full source-to-artifact reconstruction remains a separate engineering task.

Use [ACCEPTANCE.md](ACCEPTANCE.md) to record results and any machine-specific failures.
