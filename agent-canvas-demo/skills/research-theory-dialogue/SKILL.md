---
name: research-theory-dialogue
description: Conduct a persistent, evidence-grounded research-design dialogue after literature and local evidence collection. Use to identify missing constraints, formulate falsifiable hypotheses, iteratively propose and audit experiment plans, and retain project memory for later troubleshooting.
---

# Research Theory Dialogue

Use this after, never before, the evidence collection stages. Treat missing evidence as a reason to ask or retrieve, not as permission to invent.

## Loop

1. Summarize the evidence dossier as direct evidence, indirect leads, and unknowns.
2. Ask no more than five high-information questions about objective, system, available materials/instruments, time/budget, success criterion, and non-negotiable constraints.
3. Create one falsifiable primary hypothesis and the strongest competing explanations.
4. Propose a staged plan: feasibility, discriminating test, replication/mechanism, and decision gates.
5. Audit the plan against evidence quality, controls, feasibility, safety, statistics, and whether it can distinguish the hypothesis from alternatives.
6. If any gate fails, state the missing information or revised retrieval/experiment action, then repeat. Do not label a plan ready merely because it is detailed.

## Required final plan

Only emit a `ready` plan when it includes: research question, H0/H1, evidence boundary, one primary route, alternative route, controls, measured covariates, minimum replication, analysis rule, stop/go rules, risks, and the next researcher action.

Keep a compact project memory: decisions, answers, evidence IDs, rejected routes, unresolved questions, experiment observations, and next action. Later conversations must update rather than overwrite this memory.

## Cross-session memory (implemented, not just a prompt instruction)

The canvas-side "科研论主 Agent" mode backs this memory with a real, durable store rather than relying on the Agent to remember on its own:

- Memory is keyed by workspace root alone (one workspace = one ongoing topic), so rephrasing the task goal between sessions no longer resets the history.
- It is persisted to `Research/research-theory-memory.json` inside the workspace via the Bridge's `GET`/`PUT /v1/theory-memory` endpoints, with a browser `localStorage` copy kept only as a fast cache/offline fallback. The JSON file is human-readable if you want to inspect or hand-edit what the system currently remembers.
- Beyond free-form `turns`/`decisions`, memory carries a persistent `problem_bank`: every question the Agent raises is added as an `open` entry; each turn, the Agent is asked to mark previously open entries `resolved`/`superseded` (with a note) via `memory_update.problem_bank_updates`. This is the running backlog for "what still needs digging into", independent of the current turn's immediate questions.
- Each turn also pulls in a best-effort summary of `Canvases/research-knowledge-graph.canvas` (via `GET /v1/workspace-file`) so the dialogue can reason over the same node relationships shown on the canvas, not only raw search/download text.
- The prompt's embedded memory is built from a bounded view (last 8 turns + all decisions + the open problem bank) rather than blindly truncating the serialized JSON to a fixed character count, so long-running projects don't silently lose arbitrary chunks of history.
- The rendered dialogue panel shows the accumulated open problem-bank items with a one-click "用作下一次检索任务目标" button that copies the item into the task-goal field, so a durable question can be turned into a fresh literature search without retyping it. This is a manual, click-triggered action — there is no background/scheduled re-search.
