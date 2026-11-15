# 0020. Copy: one sanctioned exclamation mark, the "Haide!" wordmark in the launch moment

- **Status:** Accepted
- **Date:** 2026-11-15
- **Area:** UX
- **Agent:** ux-designer (decision taken by the orchestrator for the owner, no owner question needed)

## Context
The copy rules (`docs/ux/copy.md`, brand guide section 7) ban exclamation marks: the voice is neighbourly, plain and dependable, never hype. The E-DM brief names a signature motion moment "The Haide! moment": the main Publish or Join action launches with a short, satisfying animation (ADR 0016, `docs/ux/motion.md` moment 7). The design direction first said "Haide is the name of the moment, not on-screen text". The orchestrator decided that the wordmark may appear in that one moment. We need a rule narrow enough that the ban stays meaningful everywhere else.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. Keep the ban, no on-screen word | Voice stays perfectly consistent. Nothing to police | The moment loses its one piece of brand personality. The name "Haide" ("let's go") is the best word we have for a departure | None |
| B. **One exception: the wordmark "Haide!" inside the launch moment of Publish and Join** | Personality exactly where the product "leaves". Tiny, testable surface: one string, two buttons. Everything else stays plain | A second voice rule to remember. Risk of creep ("Haide!" on empty states, toasts) | Low |
| C. Allow exclamation marks in celebratory success messages | Friendlier overall | Breaks the "no hype" promise, leaks into errors and toasts, hard to police | Medium |

## Decision
**Option B.** The string `launch.haide` = `Haide!` is the only exclamation mark allowed in product copy. Rules:
1. It appears **only** inside the launch moment of the **Publish ride** and **Request seat** (Join) buttons, as a transient wordmark (about 400 ms) between the button label and the confirmed text.
2. It is **never** in a toast, status line, banner, email, notification, error, empty state, loading state, push text, document title or the live region. The confirmation people read (and screen readers announce) stays plain: "Seat requested", "Ride published".
3. It is decorative: `aria-hidden="true"`, not in the accessible name, no sound. Shown only with motion on. With reduced motion the label changes straight to the confirmed text.
4. It appears only when the action really left (server accepted). An offline-queued request shows "Request saved" with no "Haide!". Never on a failure path.
5. Sora 600, sentence-case "H", `on-tint` role colour on the tint fill. Same string in every language (it is the brand name, not a translated sentence). It is not part of the logo files: the logo wordmark stays lowercase "haide".
6. The test for the exception: `grep` for `!` in `STR` values must return exactly one hit, `launch.haide`. `docs/ux/prototype/tools/check-copy.mjs` enforces it.

## Consequences
- Positive: the signature moment has a voice, the ban elsewhere keeps its weight, and the exception is one greppable string.
- Negative / accepted risks: needs a lint rule in the i18n resource check (frontend-dev) so no other value contains `!`. Copy reviewers must refuse requests to widen it.
- What would trigger revisiting: usability feedback that the flash is read as hype, or a Romanian/English mix concern (the word is Romanian, the UI is English). Widening to any other screen needs a new ADR.

## Sources
- [docs/ux/copy.md](../ux/copy.md) rules and key `launch.haide`
- [docs/ux/motion.md](../ux/motion.md) moment 7
- [docs/brand/design-direction.md](../brand/design-direction.md), [ADR 0016](0016-visual-direction-quiet-futurism-headlight.md)
