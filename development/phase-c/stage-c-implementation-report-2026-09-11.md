# Stage C implementation report — 2026-09-11

## Scope and deployment status

This change implements only the two Stage C items authorized after the
dual-baseline and pre-fix-contract work:

1. make the research-lane capability minimum durable in source and in the
   automatic adapter generator; and
2. make Bridge authority mandatory for schema-v1 batches, then converge the
   Project, Idea, Seed and chat callers.

The work was performed in the isolated worktree on branch
`codex/phase-a-prefx-20260910`. It does not modify the deployed dirty tree,
the Vault, `data.json`, API keys, or generated `main.js`. The isolated
`main.js` remains clean with SHA-256
`2df5d15ade11b36a118b5c2d1592e73d0b600137bb528c3969a4cfb37b7e945c`.
No live acceptance probe is claimed in this report.

## C1 — durable research-lane capability minimum

`tools/agent-capabilities.js` is now the single source of truth for the
research adapter. The only built-in tools are `Read`, `Grep`, `Glob`,
`WebFetch`, and `WebSearch`; the only additional capabilities are the four
bounded Scholarium MCP reads/checkpoint endpoint names. `Bash`, `PowerShell`,
`Write`, and `Edit` are absent.

The same constants are consumed by both the Bridge default configuration and
`tools/agent-detect.js`, the automatic adapter generator recovered from the
deployed R06 dirty cluster. The generator's matching root test is included so
the adopted source is not an untested orphan.

Bridge startup checks every adapter whose `lane` is `research`. It fails
closed when either capability flag is missing, when a forbidden tool appears,
or when the declared set differs from the canonical minimum. A valid but
unsafe JSON config reports the capability error itself rather than being
misreported as malformed JSON.

The path-scope probe now treats direct-write capabilities being unreachable as
success. The pre/post cwd snapshot remains as defense-in-depth for net tree
changes only; it is not described as a filesystem sandbox. This Stage C item
does not create an OS-level sandbox and does not detect write-then-restore or
read/exfiltration behavior.

## C2 — Bridge-owned schema creation

For `base: "scholarium-vault"`, any batch containing a known schema-v1 type is
rejected unless it enters the Bridge-managed path. The endpoint, not the UI,
now owns:

- UUIDv7 and monotonic `display_id` allocation, including concurrent preview
  reservations and retired-id history;
- canonical object directory and filename;
- current Project binding for project-scoped types;
- creation/update timestamps and `created_by: ai`;
- initial lifecycle state and pending review state;
- removal of caller-supplied human confidence, provenance, verification,
  rejection, demonstration, invalidation and transition-history claims;
- empty formal Evidence relations for new Hypotheses/Experiments; and
- relation resolution against the live Vault or another object in the same
  atomic batch.

The Project, Idea, Seed and chat clients all request managed metadata and pass
the bound Project display id. Idea-mode Question ids use the schema `Q-`
prefix, locally produced UUIDs are UUIDv7, and Question/Hypothesis drafts
require a real Project uid. If the topic is not bound or Bridge is unavailable,
the UI reports the failure and preserves the current form; no legacy direct
write fallback exists.

Unknown/non-schema notes retain the existing byte-for-byte batch behavior.
This is necessary for artifacts such as Project schedule proposals and is not
a schema-authority bypass because they do not parse as a registered object
type.

## Verification evidence

Commands and results:

- `node tests/run.js` — **641 passed, 0 failed** (the repository's custom
  `it()` harness).
- focused Stage C Node tests (authority, schema metadata, topology, Idea,
  Project, Seed, capability contract, runtime lane, probes and UI messages) —
  **104 passed, 0 failed**.
- all `agent-canvas-demo/tests/*.test.js` except the two explicitly isolated
  pre-existing contract files below — **323 passed, 0 failed**.
- `node --test agent-canvas-demo/tests/research-chat-core.test.js` —
  **24 passed, 1 failed**. The remaining assertion is the Stage B Decision
  rule-15 no-fabrication contract, outside the authorized Stage C scope.
- `node --test agent-canvas-demo/tests/manual-capture.test.js` —
  **0 passed, 10 failed, 4 skipped**. All ten are the previously identified
  missing manual-capture implementation contract, not regressions in the
  Stage C files. They remain visible rather than being skipped or relabeled.
- `node --check` over every changed JavaScript file — passed.
- `git diff --check` — passed.

## Still open

- Stage C is committed in an isolated worktree but is not merged into or
  activated in the deployed dirty tree. A live Bridge/UI probe must follow the
  controlled integration step.
- The capability minimum removes the immediately reachable shell/write
  primitives but is not the separately planned OS/process isolation boundary.
- P1 prompt transport, R05 generated `main.js` creators, R07
  `experiment-index.json`, EXP-008's researcher-only provenance correction,
  Vault migrations and API-key work are unchanged and outside this scope.
- The Decision prompt and manual-capture red contracts remain explicit work;
  neither was made green by weakening its assertion.
