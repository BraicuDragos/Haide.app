---
name: decision-record
description: Record a product, brand, UX or architecture decision as a numbered ADR in docs/decisions and update the index. Use every time an agent makes a significant decision.
---

# Decision record (ADR)

## Where
`docs/decisions/NNNN-short-kebab-title.md` — `NNNN` = next free number (check existing files with Glob).
Then add a row to the table in `docs/decisions/README.md`.

## Template (write in English)
```markdown
# NNNN. <Decision title>

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD
- **Area:** Business | Brand | UX | Architecture | Infrastructure
- **Agent:** <agent name>

## Context
What problem we are solving and which constraints apply (2–5 sentences).

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A | | | |
| B | | | |
| C | | | |

## Decision
What we chose, in one sentence. Why (tied to the criteria in Context).

## Consequences
- Positive:
- Negative / accepted risks:
- What would trigger revisiting this decision:

## Sources
- [title](url)
```

## Rules
- 2–3 real options, not straw men.
- Status is `Accepted` once the owner merges the PR containing it; set `Proposed` when writing.
- Never edit an accepted ADR's decision; write a new ADR that supersedes it.
