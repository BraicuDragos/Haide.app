# 0038. Web push: own RFC 8291/8292 sender on WebCrypto, one outbox row per channel, labels-only payloads

- **Status:** Proposed
- **Date:** 2026-11-19
- **Area:** Architecture
- **Agent:** software-architect

## Context
E8-4: web push for the E4-6 events, opt-in only after the first booking or ride, email stays the fallback. Sending runs in the `tick` Edge Function (Deno). A push needs a VAPID JWT (RFC 8292, ES256) and an encrypted payload (RFC 8291, aes128gcm). The email channel has a hard 300/day free cap (Brevo); push services are free. The server POSTs to a URL the client supplies, which is an SSRF vector. Payloads cross third-party push services and appear on lock screens.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. npm `web-push` through Deno's npm compatibility | Mature, widely used | Built on Node `crypto`/`https`; larger cold start and compatibility risk on the Edge Runtime | Low code, medium risk |
| B. `jsr:@negrel/webpush` (WebCrypto, Deno-native) | Small, made for Deno | Single maintainer, states it is not crypto-reviewed; another pinned dependency | Low |
| C. Own module: VAPID JWT with the already-pinned `jose`, aes128gcm with WebCrypto (ECDH P-256, HKDF, AES-GCM), ~150 lines behind a `PushProvider` port, proven by the RFC 8291 Appendix A test vector | No new dependency; deterministic test against the RFC; same port pattern as email (console provider for CI) | We own crypto glue code (mitigated by the RFC vector and JWT verification tests) | Medium |

## Decision
Option C; if the RFC vector cannot be matched, swap the port's implementation for option B pinned, without touching callers. Delivery: **one outbox row per channel**. Lifecycle templates get the email row as today plus a `push` row when the recipient has a subscription; alert matches are **push-first** (email only without a subscription, or after the push finally fails). Push rows are claimed in their own tick step with no daily cap, and the email cap counts email rows only. Payload = `{title, body, path, tag}` with area labels and local times only: no first names, ids only inside the path. Endpoints must be `https` on known push-service hosts (FCM, Mozilla, Apple, Windows). 404/410 deletes the subscription. The pre-prompt "Not now" is a UI preference in `localStorage` (like theme), exempt under ePrivacy 5(3) as UI customisation.

## Consequences
- Positive: no heavy dependency; email budget protected; one retry/backoff model; no SSRF; nothing sensitive on lock screens or at push services.
- Negative / accepted risks: iOS needs an installed PWA (16.4+); a user with push and email gets both for lifecycle events (email is the record); push services (Google, Mozilla, Apple, Microsoft) become recipients listed in the DPIA.
- Revisit if: users ask to choose channels per event, or email volume nears 250/day (then make lifecycle push-first too).

## Sources
- [RFC 8291 Message Encryption for Web Push](https://www.rfc-editor.org/rfc/rfc8291) (Appendix A test vector)
- [RFC 8292 VAPID](https://www.rfc-editor.org/rfc/rfc8292)
- [negrel/webpush](https://github.com/negrel/webpush) · [web-push-libs/web-push](https://github.com/web-push-libs/web-push)
- [Article 29 WP Opinion 04/2012 on cookie consent exemption](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf)
- ADR 0022 (outbox, tick, Brevo); spec `docs/architecture/e8-liquidity-spec.md` §5
