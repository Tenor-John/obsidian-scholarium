# Scholarium 2.0.9 release readiness

Date: 2026-09-22
Candidate branch: `codex/release-2.0.9-preview`

## Prepared assets

The exact local staging directory is:

`D:\scholarium-release\2.0.9-preview.4`

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 1,714,406 | `160e10f085a93e16b9966820cfb1872f9fb7dafb8ad437f3794fabd8abe329c0` |
| `manifest.json` | 286 | `f0bea496a4430065b46b88e8b3e7314020a12bf70d82173ac4c084a5d0067a6b` |
| `styles.css` | 482,328 | `c1f7baefce9e1a685a350ef8ddb75486e858ddea1dafdbf62165b8b09f89e228` |
| `obsidian-scholarium-2.0.9.zip` | 535,888 | `a462bd7b2e6953c3f16542dbfbdaaaf8a860b5ecc64479ce43e598106e7c12de` |
| `scholarium-runtime-manifest-2.0.9-preview.4.json` | 557 | `b3cf62be30a322b1f39c40cc11cf1960dd250b3173cf17588ec87da51602620e` |
| `scholarium-runtime-core-2.0.9-preview.4-win32-x64.tar.gz` | 57,147,381 | `91c7e74e46c2da635a8092badefc072d93a48f6131155fd7be2eff1c296257f0` |

The plugin ZIP contains exactly `main.js`, `manifest.json`, and `styles.css`.
The reviewed logo bytes are embedded in `main.js` and tied to
`assets/logo.png` by SHA-256, so the real product mark is present without an
unshipped fourth file. Runtime tools and Ketcher are loaded only from the
hash-verified external core.

## Automated evidence completed

- Root suite: `714 pass / 0 fail`, three consecutive runs.
- Native release/runtime guards: `32 pass / 0 fail`, including deterministic
  logo embedding and both R1 deployment-preflight paths.
- Agent Canvas: `561 pass / 0 fail / 1 explicit manual-capture skip`, three
  consecutive runs.
- Release L2: `4 pass / 0 fail`, covering real TXT, DAT, ambiguous input, and
  the canonical legacy/image Experiment route with a real TIFF fixture.
- Runtime core: two independent preview.4 builds are byte-identical.
- Clean runtime install: `14/14` payload checks, status `ready`.
- Runtime launch: packaged Node/Python, 108 skills, Ketcher, Playwright with
  system Edge DOM probe, and packaged canonical Experiment modules all pass.
- Headless three-file lifecycle: clean install, 2.0.8→2.0.9 upgrade, and
  rollback each pass twice while preserving plugin data, Materials, and
  Research fixtures.
- Write surface: 419 classified sites, `unknown: []`; this includes C-P0-1's
  reviewed runtime-root junction resolution in both the source bootstrap and
  its mechanically embedded copy.
- R1 deployment preflight: the current machine reports installed
  `2.0.9-preview.4` with rollback pointer `2.0.9-preview.1`; the independent
  local-package path verifies manifest pin, version, platform, size and hash
  without changing the active runtime.

## External release gates still open

These are release evidence, not additional feature implementation:

1. **Credential-history block:** rotate the historical MinerU credential and
   remove `agent-canvas-demo/bridge/.env` from every Git ref before making the
   private repository or release public. See
   `docs/audits/release-secret-history-audit-2026-09-21.md`.
2. Create the `2.0.9` GitHub Release and upload the exact six assets above.
   The release did not exist when this record was written. After upload, run a
   clean install using the public manifest URL and verify every downloaded
   hash. Do not substitute a locally resolved pack for this check.
3. In real Obsidian, run clean-Vault install, 2.0.8→2.0.9 upgrade, and rollback
   twice each. Record screenshots/logs and verify the user's plugin data,
   Materials, and Research files remain unchanged across upgrade/rollback.
4. On a second clean Windows x64 machine, run `tools/verify-clean-install.js`
   against the public manifest and then `tools/verify-runtime-launch.js`.
   System Edge or Chrome must launch through packaged Playwright.

Until all four gates pass, describe this build as a **tested release
candidate**, not as a completed public product release.
