# Fix: phone tap targets too small, D-pad down arrow partly dead

## Broke
On a phone (390x844, touch), the D-pad's down arrow on Factory and Survival Island is a 52x52 button, but only its top 30 px respond to a tap; tapping its lower part does nothing. Many other controls are smaller than a fingertip (44 px): the game top bar's Leave, copy-code and chat buttons (about 35 px tall), the lobby option buttons such as game length and energy (33 px), Copy invite link and Change (29 px), Back to set (19 px), the quiz and shop close buttons (39 px), and the Customize handle (34 px showing). Measured by hit-testing every screen; full list in .agents/cards/evidence/fix-phone-tap-targets/before-geometry.txt.

## Root cause
The closed Customize drawer (`.drawer` in style.css) is pushed down so only its handle peeks out, but the whole drawer box, full width, still sits over the bottom 34 px of the screen and takes the taps meant for the D-pad. The other controls use desktop paddings (`.g-btn`, `.seg button`, `.btn.small`, `.back`, inputs) with no larger size for touch screens.

## Existing files
- style.css

## Expected behavior
- On a phone, tapping anywhere on the D-pad's down arrow (including its lower half) moves the character forward.
  - PASS: headless Chrome 390x844 touch, hit-tested the D-pad's down arrow on Factory, Island and Golf play and lobby screens; the whole 52x52 now responds (before: 52x30) [evidence: .agents/cards/evidence/fix-phone-tap-targets/after-geometry.txt]
- On a phone, every button, link and field on every screen is at least 44 px tall and wide where a finger reaches it (hit-tested probe over all screens finds none smaller).
  - PASS: headless Chrome 390x844 touch, hit-tested every control on every phone game screen (all four modes) plus dashboard, sets, characters, join, profile, host, set and sign-in pages; 0 game-screen controls under 44 px; the only page items reported are the color swatches (46x46, partly under the tab bar until scrolled) and two inline text links in the sign-in sentence [evidence: .agents/cards/evidence/fix-phone-tap-targets/after-geometry.txt]
- The phone layout still fits: the top bar, lobby card, info card and bottom HUD do not overlap or spill (UI audit 0 issues, phone screenshots look right).
  - PASS: tools/ui-audit.js over every page and game state in all 9 themes, desktop and phone: 0 distinct issues; phone screenshots checked by eye (info card now 10 px below the taller top bar) [evidence: .agents/cards/evidence/sweep-2026-11-17.txt]
- Desktop sizes are unchanged.
  - PASS: same probe on 29 desktop screens before and after: Leave, Start game, Copy invite link, Answer questions and Send have identical boxes [evidence: .agents/cards/evidence/fix-phone-tap-targets/after-geometry.txt]

## Review
self-review: the host's rules allow helper agents only when the owner asks, and the owner did not ask for one in this request, so no independent reviewer ran. I re-ran the hit-test probe after each change, which also found the 38 px wide lobby option buttons (fixed with a 44 px minimum width) and the info card touching the taller top bar (moved down).
