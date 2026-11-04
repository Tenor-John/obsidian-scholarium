# Obsidian Scholarium

Scholarium is a local-first research workspace for Obsidian. It combines literature management, AI-assisted research workflows, notes, experiment records, and the Research Weaver panel.

## 3.0.0 acceptance build

This branch contains a sanitized desktop acceptance build based on the currently installed Scholarium 3.0.0 plugin. It is intended for independent-machine verification, not an Obsidian Community Plugin Directory release.

- Plugin version: `3.0.0`
- Minimum Obsidian version: `1.10.0`
- Primary acceptance target: Windows x64 desktop Obsidian
- Linux x64 real-machine acceptance remains pending
- No formal release tag is created for this acceptance build

See [ACCEPTANCE.md](ACCEPTANCE.md) for the verification checklist and [PREVIEW-RELEASE.md](PREVIEW-RELEASE.md) for installation, privacy, and rollback instructions.

## Install the acceptance package

Download `release/3.0.0-acceptance/obsidian-scholarium-3.0.0-acceptance.zip` from this branch and verify it against the adjacent `SHA256SUMS.txt`. Extract `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/obsidian-scholarium/
```

Restart Obsidian and enable **Scholarium** under Community plugins. Do not delete or replace the existing `data.json` when upgrading; it contains local settings and may contain credentials.

## Public-release boundaries

The acceptance package contains only the three runtime files required by Obsidian. It intentionally excludes:

- personal research vaults, literature, PDFs, notes, and experiment records;
- `data.json`, API keys, tokens, cookies, and Bridge configuration;
- local logs, backups, runtime history, and browser profiles;
- machine-specific absolute paths and internal working-tree locations.

Optional features may contact external services only when configured or used. Credentials must remain in environment variables or ignored local files and must never be committed.

## Source and development

The repository retains the existing source and test snapshot. The distributed `main.js` is a generated plugin artifact; the acceptance branch updates the tested artifact without claiming that the full source-to-artifact reconstruction is complete.

For the existing source snapshot:

```powershell
npm install
npm test
npm run build
```

Before contributing, review `.gitignore` and ensure no local configuration, Vault content, downloaded literature, browser storage, tokens, or institutional cookies are staged.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
