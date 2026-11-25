# Scholarium 3.0.5 — 2026-11-25

Requested GitHub update: literature matrix improvements and source-built Weaver sidebar registration.

Persistence review: the previous 615-site fingerprint gains seven sites: three Bridge task-session persistence operations (directory creation, temporary JSON write, atomic rename in `persistChatTask`), and two literature-tag operations (creating a linked metadata note and updating frontmatter), present in source and the generated bundle. The tag operation is initiated by the user's Add tag control; it preserves existing metadata and uses the linked literature record. No new persistence surface is unclassified. Current inventory: 622 sites; digest `7231e5ce40faccd8c6bd44d70352047cda155ab4e1db06b8c23c010dbb7815ad`. Surface counts: agent UI 40, Bridge 97, skill runtime 46, generated main 169, domain tools 128, native Weaver vendor 15, gated source 124, build tooling 3. The task-session store contains local session state and is not a release asset.

Automated verification: production build, TypeScript, source regressions and bundle regressions. The sidebar registers its view, ribbon and command during plugin onload; no Agent execution is started by registration.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 44612889 | `B256BC5AF8D9E4600B54F5EE7F3A5951E3FE58A3D850D14E6BFB205B357E69E0` |
| `manifest.json` | 284 | `3637EB95385F9646BFED6F649C876093813210E1B491A861A1999F036197A002` |
| `styles.css` | 777134 | `DEB922B6C20C0078E9B162415CEA00E92BA066B0253668BF50E650E89DA604B4` |

Validation boundaries: the matrix height was checked in Chromium; isolated source and bundle tests cover local-fulltext selection, tag persistence, concurrency and sidebar registration. Real-Obsidian fresh installation on a second machine and Linux desktop interaction have not been validated. Upstream model availability is external to the plugin.

Generated main.js is built by the release workflow and attached as an asset. Local Vault data, credentials, node_modules, test artifacts and runtime profiles are excluded from the commit.
