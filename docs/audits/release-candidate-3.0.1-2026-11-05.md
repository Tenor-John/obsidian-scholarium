# Scholarium 3.0.1 source-built candidate record — 2026-11-05

**Candidate only; not an approved public release.** This record pins the current
three-file source-built candidate for acceptance testing. It does not claim
Obsidian marketplace acceptance, a successful resubmission, or completion of
real-Obsidian installation and editor acceptance.

## Candidate byte identity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 44,359,561 | `F632CEBC938343AD7563A0FC285C79144CE4C3A5F8EAB623B11CA8549696E108` |
| `manifest.json` | 284 | `2AC8247DE2B47289CB34031F9B67A93765E5C750EFAD77EDD9E5842BB50A2480` |
| `styles.css` | 572,838 | `5ECA450BDBDB6D77C781A91A30478AEF7532E26D6A41892A8B1B23B01D80809E` |

Two consecutive `npm run build:release` runs produced the byte counts and
SHA-256 values above. `cmp` reported no difference for any of the three files.
The 3.0.2 release manifest changes only the version from the tested 3.0.1
candidate; the tested main.js and styles.css bytes remain unchanged.
The release embed step normalizes inherited and vendored CSS line endings to LF;
this also makes the `core.autocrlf=true` checkout byte-identical.
The release command also ran type checking, style-scope validation, static
forbidden-construct scanning, and `node --check main.js` successfully.

## Source and asset boundary

The graphical editor is built from `ketcher-core`, `ketcher-react`, and
`ketcher-standalone` 3.18.0 with React 18.3.1. Ketcher CSS is embedded as text in
`main.js`; there is no runtime script-element loader and no separate
`ketcher.js` or `ketcher.css` candidate asset. The old standalone assets and all
one-time `previous-release-*` / `recovered-*` inputs were removed. The release
build does not read an installed historical bundle.

The candidate contains experiment/project creation and assignment, the Research
Deduction Room loading/error path, RSS automatic clipping, material plotting,
and cloud material operations restored in source. These are implementation and
automated-test statements, not proof that every real-Obsidian interaction has
been accepted.

## Dependency audit

`npm audit fix --ignore-scripts` applied compatible updates and removed the
three high-severity findings. The final `npm audit --json` reports **17
moderate, 0 high, and 0 critical** findings; `npm audit` still exits nonzero.

- `ketcher-core` / `ketcher-react` 3.18.0 retain the moderate
  `dpdm -> glob -> minimatch` advisory chain. npm's automatic forced remedy
  proposes a breaking downgrade to 3.16.2 and was not applied. Bundle scanning
  found no `dpdm`, `glob`, or `minimatch` module markers in `main.js`.
- The external `obsidian` package retains its `moment` moderate advisory. The
  host provides Obsidian at runtime; no compatible audit fix is offered.
- The remaining findings are in lint/development tooling chains, principally
  `eslint-plugin-obsidianmd` and `typescript-eslint`.

This is a recorded residual-risk boundary, not a claim that the dependency tree
is vulnerability-free.

## Persistence review

The current write-surface review is
`write-path-matrix-2026-11-05-market-candidate.md`: 609 sites, zero unknown
surfaces, fingerprint
`d61024fce3c77e3ea2177d30e55bfcec3a87a3ff5494239853c1347b71d0a010`.
Cloud deletion is restricted to `<materialRoot>/_analysis/`; cloud folder and
move operations are restricted to the configured material root and reject empty,
`.`, and `..` path segments.

## Final automated regression

The previous candidate passed **795 automated checks**: 731 custom regression
checks, 37 Node release/runtime checks, and 27 source unit tests. This total
includes material plotting, cloud-sync behavior, Ketcher molecule/reaction
serialization, RSS and queue behavior, experiment/project workflows, native
Weaver embedding, write-surface review, and the temporary-repository
`core.autocrlf=true` checkout test. The three candidate hashes were rechecked
after the regression run.

## Acceptance still required

The following remain release blockers:

1. A visible, interactive real-Obsidian verification of graphical Ketcher
   drawing and editing, in addition to the isolated automated run below.
2. A marketplace-delivered upgrade with real-world settings, and rollback,
   after the release version is advanced. The synthetic test below does not
   cover marketplace update discovery.
3. Acceptance on a second clean Windows machine; Linux real-machine testing is
   also still pending.
4. A fresh marketplace scan after an authorized version bump and publication.
   No commit, push, tag, publication, or marketplace approval is implied here.

## Isolated Obsidian test — 2026-11-06

The original candidate failed SVG export because Indigo rejected `#ffffff`.
The source now passes `255, 255, 255`, and the candidate hashes above identify
the rebuilt bundle. Two release builds produced the same SHA-256.

An isolated Windows profile and disposable Vault loaded this bundle under
Obsidian 1.15.0 with plugin ID `scholarium`. Browser automation selected the
benzene and reaction-arrow controls and sent mouse events to the actual Ketcher
canvas. A molecule and a reaction were saved with KET/SMILES and nonempty SVG;
the reaction re-opened with 12 atoms. An existing molecule block was re-opened,
edited and saved. The test used automated input in a hidden test instance, so
it does not replace a visible user-interaction acceptance or second-machine
testing. Before updating this record, the custom regression had 733 passes and
the Node suite had 35 passes and two failures caused by this outdated pin;
the source unit suite had 27 passes. After updating this record, the full
regression was repeated: 733 custom checks and all 37 Node release/runtime
checks passed; the source unit suite passed all 27 tests. The test instance
was closed without changing the user's active Obsidian profile or Vault.

## Marketplace-ID replacement and rollback — 2026-11-06

In an isolated Windows profile and Vault under Obsidian 1.15.0, the published
3.0.1 release was installed under `.obsidian/plugins/scholarium`. Two synthetic
settings and two chemical-block notes were prepared. After stopping the test
instance, only the three plugin files were replaced with this candidate;
`data.json` was retained. The restarted plugin loaded, both settings matched,
and the reaction block rendered. The published 3.0.1 files were then restored
and the instance restarted: the plugin and settings loaded and the reaction
block rendered. At all three points, `data.json` and both notes retained
identical SHA-256 hashes. Both manifests say 3.0.1; this is manual file
replacement, not verification of marketplace update discovery, version
ordering, real credentials, or a different computer.
