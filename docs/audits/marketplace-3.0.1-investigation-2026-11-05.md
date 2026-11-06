# Marketplace 3.0.1 investigation

The Obsidian marketplace rejected 3.0.1 with the error “Code creates script elements at runtime”. The registered ID is now `scholarium` and the published version/tag both match 3.0.1. The marketplace also reports that the source build differs from the released `main.js`.

The released `main.js` SHA-256 is `82677a35d8fe5a399e530baba811b3edf04d30454d9255eab99a6c608b8c51a9`. Its `schLoadKetcherRuntime` creates a script element and loads Ketcher from a local Bridge runtime endpoint. The editor's separately bundled `ketcher.js` also contains a PaperScript compiler that creates a script element and contains dynamic code generation. Replacing the spelling of these operations would not remove the behavior.

On 2026-11-05, `npm ci` followed by `npm run build` succeeded in an isolated checkout, but produced a 641,774-byte `main.js` with SHA-256 `e0eee98dacd51ecf4b8bbe85a8cf8da765f8ad7e2d98ceda5d2edf52bebe469`. This is not the released 3,268,299-byte artifact. The checked-in `src/chem/ketcher-host.ts` implements a text editor, not the graphical Ketcher editor; therefore this build cannot replace the release without a functional regression. The generated build was not published.

The regression job also fails on the current main branch: generated bundle/source consistency, frozen 2.0.9-era metadata and asset checks, download-queue routing, queue-consumer isolation/whitelist, and write-surface fingerprint checks. These require investigation against the intended release, not blanket removal or updated fingerprints without review.

Next work: reconstruct the current released functionality in source; integrate a statically bundled graphical Ketcher variant without runtime script/code generation; verify asset provenance and release packaging; test editor create/edit/save in Obsidian; resolve the actual regression failures; then publish a new version and request a fresh marketplace scan. Preserve existing plugin identity and user data.
