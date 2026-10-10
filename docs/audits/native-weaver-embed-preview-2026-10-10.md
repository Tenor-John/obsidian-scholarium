# Native Weaver embedding preview record — 2.0.9 preview.4 candidate

Date: 2026-10-10

Supersedes `native-weaver-embed-preview-2026-09-26.md` for the release
hygiene pin. Adds: 识别点 fine edits and undo, P2 panel anchors, stop button,
settings pickers, figure cards (SVG / Vault-data charts / AI generation),
设置中心 folding sections and AI 生图 settings, and the 研究推演室 Bridge
address now resolved from this Vault's runtime port (no fixed 4173).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 2,846,037 | `0F69847839619CC15475D61B385F0C4814C9F463CE19FA1F08590DE89404035C` |
| `manifest.json` | 286 | `F0BEA496A4430065B46B88E8B3E7314020A12BF70D82173AC4C084A5D0067A6B` |
| `styles.css` | 564,501 | `D5161973C7A2B3E641A375D55B7770B66EC25047E8DC58AAB3855022332604B1` |
| `ketcher.js` | 31,023,361 | `DD0DDDAD135F275C32CF6EF45FCEC7C92DF268C8F6481A58003E1FEDFE289FF2` |
| `ketcher.css` | 182,906 | `5E38B4CA9D0A4A6F402EC7EAE71C207A0AEE1E416E78A6472D77672295690123` |

The write review is `write-path-matrix-2026-10-10-preview4.md`. This record
does not approve a public release or an installation into a user research
Vault.

The reviewed integration baseline for the `B-sync` generated-bundle guard is
`35ab710`. The three preceding P1/P2 embedding commits are covered by this
record and the paired write-surface review; every later `main.js` commit must
carry an explicit symbol-level `B-sync:` trailer.
