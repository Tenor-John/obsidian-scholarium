# Write-surface review — 2.0.9 preview.4 candidate — 2026-10-10

Reviewed against the previous fingerprint
(`224471ff…8044c`, 443 sites, `write-path-matrix-2026-09-26-native-weaver.md`).
The public source snapshot additionally includes the TypeScript build source
and its version-bump helper, which are not present in the host-only worktree.

## Result

```text
digest  7988e80632f3f38f907b8f9f497b77a6571d324b47fcab8bbd4008208b384546
count   544
unknown 0
```

| Surface | 2026-09-26 | Now | Δ |
| --- | ---: | ---: | ---: |
| Agent UI state | 40 | 40 | 0 |
| Bridge runtime | 94 | 94 | 0 |
| Skill runtime | 47 | 46 | -1 |
| Ketcher generated bundle | 14 | 14 | 0 |
| Generated `main.js` | 128 | 150 | +22 |
| Domain and maintenance tools | 114 | 128 | +14 |
| Native Weaver vendor | 6 | 15 | +9 |
| Gated build source | 0 | 55 | +55 |
| Build tooling | 0 | 2 | +2 |

The fixed-Bridge-address repair in this candidate (研究推演室 `bridgeFetch`
now resolves this Vault's runtime port through `schDeductionBridgeBase`)
adds **no** persistence site; it only changes where requests are sent.

## Native Weaver vendor (+9) — confirmed file cards

`src/features/files/obsidian-vault-files.ts` (v2 source) gives the page
Obsidian-API file operations for cards the researcher confirms one by one:
`createBinary`/`writeBinary` (saving a generated figure), `createFolder`/
`adapter.mkdir`, `create`, `modify`/`adapter.write`, `rename`/
`adapter.rename`. Every call is reached only from a confirmation card with a
before/after preview; nothing overwrites an existing file (free name with a
numeric suffix), deletion goes to the trash, and each card records an undo
manifest. Paths are Vault-relative and validated.

## Host tool `tools/native-weaver-host.js` (+5) and its embedded copy in `main.js` (+5)

`imageService.save`: read-modify-write of the `imageGeneration` section of
Scholarium's secrets file (outside the Vault): `mkdirSync`, `writeFileSync`
(temp file, mode 0600), `renameSync`, fallback `copyFileSync` + `rmSync` of
the temp file. Triggered only by 设置中心 → AI 生图 → 保存. Other sections of
the file are preserved; an absent file is refused, never created here.

## Secrets-file region in `main.js` (+5)

`SCHOLARIUM_SECRETS_FILE` (from `tools/secrets-file.jsfrag`): the same atomic
temp-and-rename write of the secrets file outside the Vault when settings are
saved. Keys are removed from `data.json`.

## Manual-capture batch region in `main.js` (+3)

`SCHOLARIUM_MANUAL_CAPTURE_BATCH_METHODS`: writes of researcher-captured
PDF/WebClip artifacts into the configured literature folder after a manual,
human-verified browser session.

## Maintenance tools (+9 besides the host glue)

Build-time only, never shipped as runtime code paths: the board-section patch
(`patch-experiment-board-sections.js`, 2: `main.js`, `styles.css`), the
region patchers for manual capture, runtime diagnosis and secrets
(`patch-*.js`, 1 each), and `sync-native-weaver-into-plugin.js` (4: `.bak`
copies, then `main.js` and `styles.css` of the test-vault plugin).

This review does not authorize installation into a research Vault and does
not lift DEC-008.

## Public source snapshot (+57)

The 55 `src/` sites and 2 `version-bump.mjs` sites are the original build
source for the preview bundle and its release-version helper. They are
included so the public repository can reproduce the candidate rather than
depending on an opaque bundle. They are classified as `gated-build-source`
and `build-tooling`; the scan reports no unknown persistence surface.
