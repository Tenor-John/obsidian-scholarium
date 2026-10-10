# Obsidian Scholarium

Local-first research-workflow tools for Obsidian, including the Research Weaver
panel, a localhost-only Agent Bridge, evidence-gated literature workflows, and
reviewable knowledge-graph publishing. The literature layer supports batch
PDF/Markdown ingestion, Hugging Face cloud embeddings, vector+BM25 hybrid
retrieval, and provenance-preserving RAG-to-graph projection.

## 2.0.9 Preview status

The Windows desktop deployment candidate is frozen and regression-tested. It
supports the standard three-file Obsidian/BRAT installation and uses a
version-pinned core runtime outside the Vault. The verified core runtime is
embedded in `main.js` and initialized locally on first enable, so installing
Scholarium is the only installation step: there is no second GitHub request,
online/offline mode, or separate runtime package for the user to manage. The
core contains Node, Python, skills, Ketcher, and Playwright; browser automation
reuses Windows Edge/Chrome and requires no npm or command-line setup.

This is a **GitHub/BRAT preview release**, not an Obsidian Community Plugin
Directory release. It is currently verified for Windows x64 desktop Obsidian.
See [PREVIEW-RELEASE.md](PREVIEW-RELEASE.md) for installation, privacy, and
known limitations.

## Public-release boundaries

This repository contains source code, templates, fixtures, and documentation.
It intentionally excludes personal research vaults, PDFs, notes, credentials,
cookies, local Bridge configuration, logs, runtime history, browser profiles,
and backups. Start from
[`agent-canvas-demo/bridge/bridge.config.example.json`](agent-canvas-demo/bridge/bridge.config.example.json)
and create your own ignored local configuration.

## Local development

```powershell
cd agent-canvas-demo
npm install
npm run verify
npm start
```

The Bridge listens on localhost only. It is designed to present generated
research objects for review before any vault write; credentials must be kept in
environment variables or ignored local files, never committed.

## Installed-vault rebuild gate

`main.js` is the tested preview artifact distributed with the GitHub release.
The runtime-bearing plugin entry point is still being reconstructed into a
fully reproducible source build. Do not claim this preview is ready for the
Obsidian Community Plugin Directory until that work is complete.

## Repository hygiene

Before contributing, run `npm run verify` in `agent-canvas-demo`, and make sure
`git status --ignored` does not show any local configuration as tracked. Do not
commit project workspaces, downloaded literature, browser storage, tokens, or
institutional cookies.
