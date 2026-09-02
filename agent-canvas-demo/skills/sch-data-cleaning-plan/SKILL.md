---
name: sch-data-cleaning-plan
description: Convert a data profile manifest into a conservative, auditable cleaning plan. It proposes strategies but does not modify data.
---

# Scholarium Data Cleaning Plan

Run `scripts/cleaning_plan.py <workspace> <json-profile-or-file>` after `sch-data-profile-audit`.

## Output Contract

Return JSON with:

- `skill`: `sch-data-cleaning-plan`
- `plan`: recommended missing-value, outlier, normalization and plotting decisions
- `requires_confirmation`: always `true`

## Boundaries

- This Skill proposes a plan only. It never edits data.
- AI agents may cite this plan as a suggestion, not as a completed transformation.
- A researcher must confirm the plan before `sch-data-transform-runner` executes it.
