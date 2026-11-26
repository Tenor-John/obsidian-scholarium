# Scholarium 3.0.6 marketplace correction — 2026-11-26

The supplied 3.0.5 marketplace scan failed with exactly one blocking Error: obsidianmd/no-static-styles-assignment at src/rss-feed-board.ts:3109. The summary progress bar assigned a constant width through element.style. It now uses the sch-matrix-progress CSS class with the same 100% width.

Automated verification: production builds run scripts/check-marketplace-styles.mjs using the actual eslint-plugin-obsidianmd rule across all 52 TypeScript source files. A negative control must produce the rule error; a class-based positive control must pass. The rule is enforced before TypeScript compilation and bundling.

This is a marketplace correction, not evidence of marketplace approval. The size, filesystem/shell access, dependency and other Warning/Recommendation findings remain outside this minimal fix. The existing 3.0.5 features and their acceptance boundaries remain unchanged.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 44612857 | `2077CB2170D09D7517D031CE161CF736609EB5782B3ECAFB3C3DCB06C868E17B` |
| `manifest.json` | 284 | `CA2A3CB6564DB64C4D7F22936CCFD1882DBADC1975967786C5EA1B89E107CADE` |
| `styles.css` | 777195 | `D0CEDFA0BE55DA522ED7E0CF865F0FC4674BCD2A59A72832EE3DDF4CB37BF65B` |

Persistence inventory is unchanged from 3.0.5: 622 sites; digest 7231e5ce40faccd8c6bd44d70352047cda155ab4e1db06b8c23c010dbb7815ad; no unclassified sites. No new writes or permissions are introduced by the style fix or the lint gate.

A new release tag triggers GitHub artifact production and the marketplace automatic rescan. Confirm the later marketplace scan independently; an uploaded Release alone is not approval.
