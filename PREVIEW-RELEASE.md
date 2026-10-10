# Scholarium v2.0.9-preview.4

This is a Windows x64 desktop preview distributed through GitHub and BRAT. It
is not currently submitted to the Obsidian Community Plugin Directory.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from this release.
2. Put the three files in `<vault>/.obsidian/plugins/obsidian-scholarium/`.
3. Reload Obsidian and enable **Scholarium** under Community plugins.

The first enable initializes the bundled local runtime outside the vault. The
plugin does not require a separate GitHub download during normal startup.

## Data and privacy

- Research notes and generated records stay in the selected local vault.
- API keys, login cookies, Bridge configuration, browser profiles, runtime
  state, and backups are local-only and intentionally excluded from this
  repository and release assets.
- Optional features may contact services that you enable or configure, such as
  an AI provider, OpenAlex, Crossref, Unpaywall, MinerU, Hugging Face, RSS
  feeds, WebDAV/S3 storage, or institutional WebVPN.
- The Bridge listens only on `127.0.0.1`; it is not a remote server.

## Known limitations

- Windows x64 desktop Obsidian only.
- This preview has not yet completed fresh-install, upgrade, and rollback
  testing on two independent clean Windows machines.
- The runtime-bearing `main.js` artifact is included with the release, but the
  full source-to-artifact reconstruction required for Community Directory
  submission is still in progress.
