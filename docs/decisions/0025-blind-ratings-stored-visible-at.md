# 0025. Blind ratings: a stored `visible_at` with a column-level update grant

- **Status:** Proposed
- **Date:** 2026-11-16
- **Area:** Architecture
- **Agent:** software-architect

## Context
E5-3: a rating becomes visible to the rated user only once both sides have rated, or when the 7-day window ends, so nobody can retaliate. Ratings are immutable (`haide_api` has no UPDATE on `app.ratings`). The rating summary (average shown from 3 ratings) is read in several places: the public profile, search results, request cards and booking views. Today those queries count every rating, which leaks blind ratings.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Compute visibility on read: counter-rating exists on the same booking, or `ride.completed_at + 7 d <= now` | No schema change, no writes | Every summary query joins ratings to bookings and rides and to itself. Easy to forget in one of the four call sites | Low to build, high to keep right |
| B. Column `ratings.visible_at`, set on insert to `completed_at + 7 d`, and pulled to `now` for both ratings when the counter-rating arrives. `haide_api` gets `UPDATE (visible_at)` only | Every reader filters `visible_at <= now` on an index. Stars and tags stay immutable by grant | One column grant and one extra update per second rating | Low |
| C. Pending ratings in a separate table, moved on reveal by the tick | The public table only ever holds visible rows | A second table and a job for a two-line rule | Medium |

## Decision
Option B. The rating transaction locks the booking row (`FOR UPDATE`), so two parties rating at the same time serialise and the second one always sees the first. The rule `visible_at = least(existing, now)` only ever moves visibility earlier. One shared SQL fragment computes the summary (`count` and `avg` over `visible_at <= now`) for every caller.

## Consequences
- Positive: one indexed predicate. pgTAP proves the grant (`UPDATE` only on `visible_at`). Integration tests prove that the ratee's average does not move before both have rated or day 7.
- Negative / accepted risks: with 3 or more visible ratings, a user who watches their average can sometimes infer one rating. Accepted at pilot scale.
- What would trigger revisiting: editable ratings, or showing individual reviews.

## Sources
- `docs/product/backlog.md` E5-3
- `docs/architecture/data-model.md` §4.5
