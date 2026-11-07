# Scholarium 3.0.3 marketplace remediation candidate — 2026-11-07

Candidate only; not an approved public release. This source-built candidate addresses Obsidian's 3.0.2 source-review errors. GitHub marketplace review has not yet been repeated. Do not treat previous Ketcher or upgrade acceptance as testing this new byte identity.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 44,180,653 | `2A76E6B6A79CD93E646ABE12133C5F7BAF8A71B941C8412F733D5044C773E678` |
| `manifest.json` | 284 | `D11194F13FD114B52CC45BFBD90E18F03C7C20457B09090E37501238E5B43E28` |
| `styles.css` | 754,246 | `8E7E8A2F0D97734AB18C67491989AE0EF2D6E7FFA7F31D6399A949D4D2051061` |

The Ketcher stylesheet is included in styles.css at build time; the agent-environment stylesheet is also static. Previously dynamic HTML is passed through Obsidian's `sanitizeHTMLToDom`; an isolated Obsidian test verified a representative SVG and subscript survived while script and event attributes were removed. Dynamic view sizing still uses Obsidian DOM helpers; fixed container layout uses CSS classes.

Ketcher's bundled third-party Emotion dependencies still create style elements at runtime; an isolated Obsidian run observed three `style[data-emotion]` elements with the editor open. The source changes remove the two application-owned dynamic style insertions reported by the marketplace, not all runtime style creation by dependencies. The next marketplace review must determine whether this remaining behavior is accepted.

The release retains the >5 MB main.js warning and the noted moderate dependency advisories. The separate runtime, external AI streaming-stop, visible manual acceptance, and testing on a second Windows and on Linux remain outside this candidate's completed acceptance.
