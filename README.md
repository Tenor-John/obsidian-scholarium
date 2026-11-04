# Obsidian Scholarium

Scholarium is a local-first research workspace for Obsidian. It combines literature management, AI-assisted research workflows, notes, experiment records, and the Research Weaver panel.

## 3.0.0 artifact-based preview

This branch contains a sanitized desktop preview assembled from the installed Scholarium 3.0.0 plugin artifact. It is intended for independent-machine evaluation, not a formal stable release or an Obsidian Community Plugin Directory submission.

- Plugin version: `3.0.0`
- Minimum Obsidian version: `1.10.0`
- Primary evaluation target: Windows x64 desktop Obsidian
- Clean installation and the minimum functional workflow are supported by the independent acceptance review
- Upgrade, rollback, and manual streaming-stop behavior are not covered yet
- Linux x64 real-machine acceptance remains pending
- Source-workspace alignment and reproducible source builds are not claimed

See [PREVIEW-RELEASE.md](PREVIEW-RELEASE.md) for the fixed package identity, provenance boundary, installation instructions, and release limitations. Use [ACCEPTANCE.md](ACCEPTANCE.md) for the remaining verification checklist.

## Install the fixed preview package

Download `release/3.0.0-acceptance/obsidian-scholarium-3.0.0-acceptance.zip` and verify it against the adjacent `SHA256SUMS.txt`. The expected ZIP SHA-256 is:

```text
217171296d5431d741ae002dd5d34539bcfa7d3fb925a63c686f7528f1cd7a24
```

Extract exactly `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/obsidian-scholarium/
```

Restart Obsidian and enable **Scholarium** under Community plugins. Do not delete or replace an existing `data.json`; it contains local settings and may contain credentials. Upgrade and rollback procedures are documented for the remaining tests, not presented as already validated.

## Public-release boundaries

The preview package contains only the three runtime files required by Obsidian. It intentionally excludes:

- personal research vaults, literature, PDFs, notes, and experiment records;
- `data.json`, API keys, tokens, cookies, and Bridge configuration;
- local logs, backups, runtime history, and browser profiles;
- machine-specific absolute paths and internal working-tree locations.

Optional features may contact external services only when configured or used. Credentials must remain in environment variables or ignored local files and must never be committed.

## Source and development

The repository retains the existing source and test snapshot. The distributed `main.js` is a generated plugin artifact. The source workspace and installed artifact were not hash-identical, and this branch does not claim that the source snapshot reproduces the preview package.

For the existing source snapshot:

```powershell
npm install
npm test
npm run build
```

A build produced by these commands must not be substituted for the fixed preview ZIP during its acceptance run. Source alignment is a separate formal-release gate.

Before contributing, review `.gitignore` and ensure no local configuration, Vault content, downloaded literature, browser storage, tokens, or institutional cookies are staged.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
