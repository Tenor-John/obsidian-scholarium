# Obsidian Scholarium

Scholarium is a local-first research workspace for Obsidian. It combines literature management, AI-assisted research workflows, notes, experiment records, and the Research Weaver panel.

## 3.0.1 source-built release candidate

This working branch is a **release candidate, not a published product release**. It reconstructs the installed 3.0.1 functionality in reviewable source and statically bundles the graphical Ketcher editor. It has not been accepted by the Obsidian Community Plugin Directory.

- Plugin version: `3.0.1`
- Minimum Obsidian version: `1.10.0`
- Primary evaluation target: Windows x64 desktop Obsidian
- The candidate supports the standard three-file Obsidian/BRAT installation: `main.js`, `manifest.json`, and `styles.css`
- No runtime script-element loader or separate Ketcher assets are required
- Automated source, bundle, and regression checks do not replace real-Obsidian clean-install/upgrade/rollback acceptance
- Graphical structure creation, editing, and Markdown persistence still require real-Obsidian acceptance
- A second clean Windows machine and Linux x64 real-machine acceptance remain pending

The current byte identity and verification boundaries are recorded in [the candidate audit](docs/audits/release-candidate-3.0.1-2026-11-05.md). The older preview records remain historical evidence and do not authorize this candidate.

## Install the candidate for acceptance

Copy exactly `main.js`, `manifest.json`, and `styles.css` from the same reviewed build into:

```text
<vault>/.obsidian/plugins/obsidian-scholarium/
```

Restart Obsidian and enable **Scholarium** under Community plugins. Use a disposable acceptance Vault, not a research Vault containing irreplaceable data. Do not delete or replace an existing `data.json`; it contains local settings and may contain credentials. Upgrade and rollback procedures remain acceptance tests, not validated release claims.

## Public-release boundaries

The candidate package contains only the three runtime files required by Obsidian. It intentionally excludes:

- personal research vaults, literature, PDFs, notes, and experiment records;
- `data.json`, API keys, tokens, cookies, and Bridge configuration;
- local logs, backups, runtime history, and browser profiles;
- machine-specific absolute paths and internal working-tree locations.

Optional features may contact external services only when configured or used. Credentials must remain in environment variables or ignored local files and must never be committed.

## Source and development

Use the release pipeline below rather than repacking an installed artifact:

```powershell
npm ci
npm test
npm run build:release
```

`build:release` type-checks the source, bundles Ketcher and its styles statically, embeds the reviewed runtime assets, checks for dynamic script/code-generation constructs, and validates JavaScript syntax. Candidate hashes are meaningful only for the three files produced together by this command; see the candidate audit for the actual reproducibility result.

Before contributing, review `.gitignore` and ensure no local configuration, Vault content, downloaded literature, browser storage, tokens, or institutional cookies are staged.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
