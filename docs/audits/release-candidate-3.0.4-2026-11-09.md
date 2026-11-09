# Scholarium 3.0.4 marketplace remediation candidate — 2026-11-09

Candidate only; not an approved public release. The marketplace rejected 3.0.3 because five `global` directive comments lacked descriptions. This candidate describes the actual bundled globals; the same ESLint rule passes with a negative control. Marketplace re-review is pending.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 44,180,653 | `2A76E6B6A79CD93E646ABE12133C5F7BAF8A71B941C8412F733D5044C773E678` |
| `manifest.json` | 284 | `E91399DF19DAFF6573A8311A63EE65908A9345F89603B230E06A12D2B2CC6300` |
| `styles.css` | 754,246 | `8E7E8A2F0D97734AB18C67491989AE0EF2D6E7FFA7F31D6399A949D4D2051061` |

The compiled main.js and styles.css are byte-identical to 3.0.3; only the manifest version differs. Earlier acceptance limitations remain: visible manual interaction, external AI streaming-stop, second Windows and Linux have not been validated for this candidate. Ketcher's third-party Emotion dependencies generate style elements at runtime.
