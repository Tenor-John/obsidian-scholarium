# Write-surface review — 3.0.1 marketplace candidate — 2026-11-05

This is a candidate-only review. It does not approve a public release, a
marketplace resubmission, or installation into an irreplaceable research Vault.

## Method and result

Ran `node tools/write-surface-audit.js` after removing the one-time recovery
inputs, test artifacts from the production scan, and the superseded standalone
`ketcher.js` / `ketcher.css` assets. The scanner output was compared with a
fresh scan of `git archive HEAD`; current source call sites were then inspected
by file and operation. No fingerprint was copied from the stale preview record.

```text
digest  d61024fce3c77e3ea2177d30e55bfcec3a87a3ff5494239853c1347b71d0a010
count   609
unknown 0
```

| Surface | HEAD rescan | Candidate | Δ |
| --- | ---: | ---: | ---: |
| Agent UI state | 40 | 40 | 0 |
| Bridge runtime | 94 | 94 | 0 |
| Skill runtime | 46 | 46 | 0 |
| Superseded Ketcher generated bundle | 14 | 0 | -14 |
| Generated `main.js` | 163 | 166 | +3 |
| Domain and maintenance tools | 128 | 128 | 0 |
| Native Weaver vendor | 15 | 15 | 0 |
| Gated build source | 55 | 118 | +63 |
| Build tooling | 2 | 2 | 0 |
| **Total** | **557** | **609** | **+52** |

The earlier approved preview fingerprint covered a different 544-site tree;
the HEAD rescan above is the like-for-like comparison for this candidate.

## Reviewed source changes

### Experiments, projects, and AI creation

`src/ai-chat-modal.ts`, `src/dashboard-view.ts`, and `src/project-profile.ts`
restore explicit experiment/note creation, project assignment, project profile
creation/update, and frontmatter persistence. Writes target configured
experiment/project locations or existing researcher-selected records. The new
AI creation route resolves an optional project before using the same experiment
preparation path as the graphical creator; it does not add an arbitrary Vault
write primitive.

### Material datasets and generated plots

`src/material-library.ts` and `src/material-plotting.ts` persist library state,
import researcher-selected files, create material folders, move records, update
plot manifests, and delete selected generated versions. Local version deletion
is limited to the selected `_analysis` output. Folder move and import behavior
is covered by the material regression group; raw measurement files are not
rewritten by plotting.

`src/cloud-sync.ts` adds no local Vault write. Its remote folder/move operations
are restricted to the configured material root, and remote deletion is limited
to `<materialRoot>/_analysis/`. Every path segment is checked for empty, `.`,
and `..` segments. WebDAV paths remain relative to the provider's configured
root; S3 paths receive exactly one normalized prefix.

### RSS, deduction, and runtime state

`src/rss-feed-board.ts` restores plugin-state updates, clip/note/asset creation,
frontmatter updates, and bounded local cache/staging writes used by the existing
RSS and browser integrations. Automatic clipping uses the established clip and
summary path; it does not introduce a new general filesystem destination.

`src/research-deduction-room.ts` writes researcher-requested notes/snapshots and
plugin state. `src/runtime-manager.ts` creates the local runtime profile
directory. `src/secrets-file.ts` retains the reviewed atomic temporary-file,
rename, and fallback-copy behavior for settings secrets; it does not move
credentials into `data.json`.

### Generated bundle and removed standalone editor

The generated `main.js` write sites are the bundled counterparts of the source
and reviewed embedded runtime surfaces above. The graphical Ketcher editor is
statically bundled and has no separate Vault persistence API. The old standalone
Ketcher bundle and its 14 scanned write sites were removed rather than retained
as unused release inputs.

## Verification boundary

The source unit tests cover cloud prefix handling, recursive sync, move/delete
path guards, and Ketcher structure serialization. They do not prove real
Obsidian rendering or user interaction. Clean install, upgrade, rollback, and
Ketcher create/edit/save acceptance remain release blockers.
