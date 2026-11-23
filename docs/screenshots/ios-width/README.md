# iOS width: Find screen, "Leave around"

Screenshots of `/find` at 320, 375 and 430 px, Playwright WebKit (iPhone 13 profile).

- `find-after-<w>.png`: the current code (custom time button, hardened grid and controls).
- `find-before-<w>.png`: the pre-PR-28 markup, reproduced in the DOM: the time button is replaced by
  `<input type="time" class="control min-h-12 border border-border-strong">`, with the old `1fr` columns and auto
  min-width restored.

Honest limits: Playwright WebKit on Windows does not render the native iOS time control (the BEFORE input draws as an
empty box) and has no iOS intrinsic input width. BEFORE is a faithful DOM reproduction, not a real iPhone capture, and
it does not show the reported overflow. The problem could not be reproduced here. Real-device confirmation is needed.

Regenerate: `E12_SHOTS=1 npx playwright test e12-screenshots-webkit --project=webkit-iphone`.
