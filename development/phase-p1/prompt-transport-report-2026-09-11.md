# P1 Prompt Transport — implementation and probe record

Date: 2026-09-11 (Asia/Shanghai)

## Outcome

Verified Codex, Claude and OpenCode adapters now receive prompts through stdin.
Prompt text is absent from their process argument list, so Windows
`CreateProcess`'s roughly 32767-character command-line ceiling no longer limits
research-chat history, project state, memory or RAG context.

Unknown legacy adapters remain on the old `{{prompt}}` argv contract. They are
bounded at 24000 characters and fail with `prompt_transport_argv_limit` instead
of launching with a silently truncated prompt.

## Local binary evidence

- Codex: `codex-cli 0.149.1`; `codex exec --help` explicitly says a missing
  prompt or `-` reads instructions from stdin. Live echo probe returned
  `SCHOLARIUM_STDIN_CODEX`.
- Claude Code: `2.1.247`; `claude -p --help` exposes text stdin through print
  mode. Live echo probe returned `SCHOLARIUM_STDIN_CLAUDE`, with
  `permission_denials: []`.
- OpenCode: `1.18.29`; although `opencode run --help` does not document stdin,
  a live piped echo probe returned `SCHOLARIUM_STDIN_OPENCODE`.

These probes used no tools and wrote no files.

## Implementation

- `tools/prompt-transport.js` is the single preparation layer for normal tasks,
  full-task probes and full-task dispatch.
- `tools/agent-detect.js`, Bridge defaults and the example configuration all
  emit `promptTransport: "stdin"` for the three verified CLI families.
- Old real Codex/Claude/OpenCode configurations are upgraded in memory at
  startup. Synthetic/test adapters and unknown commands are not reclassified.
- `spawnCollect()` and the normal task launcher pipe the exact prompt and close
  stdin. Tool substitutions remain argv-only policy data.
- Research prompt budget is now 120000 application characters. Explicit dropped
  block guards remain as a model-context safety mechanism, not an OS workaround.

## Additional defect found by the long-prompt test

The first 70008-character Chinese prompt arrived as 70011 characters. The HTTP
body reader had concatenated each raw Buffer chunk independently; a multi-byte
UTF-8 character split at a TCP boundary became replacement characters. Calling
`req.setEncoding('utf8')` before collecting chunks fixed the corruption. The
integration test now verifies the exact length and final marker after Bridge →
child-process transport.

## Verification

- Real CLI stdin probes: all three returned the requested exact marker.
- Bridge synthetic research-lane probe: 70008-character CJK prompt arrived
  exactly, including `END-MARK`.
- Root custom harness after P1: 646 passed, 0 failed.
- Focused research/full-lane/prompt tests: 45 passed, 0 failed.
- JavaScript syntax, example JSON parse and `git diff --check`: passed.

## Deployment boundary

This report describes the clean integration branch. It is not evidence that the
currently running dirty deployment has been updated. Deployment still requires
the controlled reconciliation and live Bridge/UI probe; generated `main.js`
remains outside this change.
