# Card: Via Golf (2D mini golf mode)

## Outcome
The host picks **Via Golf** on the host page, chooses 3 or 6 holes and the time per hole, and opens a room. Everyone waits at the first hole's tee in the lobby, nobody can shoot. When the host starts, everyone plays the same hole at the same time; balls pass through each other. Each correct answer in the shared quiz gives one shot (up to 3 saved). With a shot saved and your ball at rest, you drag back from anywhere on the hole (mouse or finger) and let go: the ball rolls off the walls, bounces off columns, slows in sand, rolls down slopes, and goes back to where you hit it from with +1 stroke if it lands in water. When every ball is in the cup or the hole's time runs out (unfinished players score par + 3, or their strokes + 1 if that is more), the next hole starts after a short recap. After the last hole the lowest total wins and only the results show. The holes are Roman landmarks (Via Appia, Forum fountain, aqueduct, Circus, Tiber bridge, Colosseum) in the site's pixel style.

## Applies
ORTH-02 ORTH-06 ORTH-08 UX-01 UX-04 UX-07 UX-09 UX-10 IOS-01 IOS-04 IOS-05

## New files
- golf.js

## Existing files
- game.js
- app.js
- index.html
- style.css
- store.js
- tools/ui-audit.js

## Invariants
Pufferfish Party, Factory and Survival Island behave exactly as before (same lobby, quiz, HUD and results). The shared quiz, info card, banner and touch controls keep their markup and ids; Golf only adds its own canvases, shot counter and lobby options. No stored data changes: nothing new is saved to localStorage or Supabase. The sign-in, sets, characters and profile pages are untouched except the host page's mode list.

## Replaces
none. The "Team Tide (coming soon)" card stays as it is.

## Standard approach
Follow the existing movement-mode pattern in island.js and factory.js: an IIFE global (`window.Golf`) with `attach`, `host` (`initState`, `assignSections`, `start`, `reset`, `onMessage`, `tick`), `onState`, `onPos`, `onQuestion`, `deactivate`, `statusText`, `isActive`; registered in game.js `modOf` / `LABELS` / `renderOver`, a mode card and options in app.js, lobby options in index.html, CSS scoped with `.game-page[data-mode="golf"]` in style.css. The shared quiz (`#fxQuiz`, `fx-q` / `fx-ans` / `fx-qa` messages) and the info card (`.fx-hud`) are reused as in island.js. Pointer input uses the browser's Pointer Events with `setPointerCapture` (https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) and `touch-action: none` on the canvas so a drag never scrolls the page.

## Deviation
none

## Expectations
CORE-01: Pointer Events with setPointerCapture handle mouse and touch drags in one code path, and `touch-action: none` on #gfCanvas stops the browser's own pan and zoom only on the hole; the page and every HUD control keep native scrolling and taps, which is the native behavior I take over and the place a drag could break.
CORE-02: When a shot is taken the shot counter, the info card scorecard, the ball on every screen and the hole status in the top bar update together; when a hole ends the balls, strokes and timer reset while each player's total and saved shots stay; at game over golf.js hides its canvas, shot counter and prompt and game.js renderOver shows the golf standings.
CORE-03: Drag-and-release on #gfCanvas shoots and nothing else; the keyboard/D-pad path (A/D or ◀▶ to aim, W/S or ▲▼ for power, E or the E button to shoot) is the button equivalent of the same shot and sends the same `gf-shot` message; Space only opens or closes the quiz as in the other modes.
CORE-04: While nobody acts the only work is the existing requestAnimationFrame loop that draws the hole (it stops in deactivate when the mode ends) and the host's existing 200 ms tick; the ball simulation runs once per shot, not per frame, and no new timers or polling are added.
CORE-05: Two real browsers through the live Supabase room: host with I'm playing too plus a joining phone guest, both screens checked in the lobby (no shooting before start), shots by mouse drag, by touch drag and by keyboard, a water shot, a sink, a hole timing out, then the results; repeat-shot without a saved shot and dragging during the quiz are checked too, while real-device finger feel and slow-network shots are not covered by headless tests.
UI-01: The hole's colors, ball size and effects are compared with Survival Island's pixel scenery and Factory's floor in Parchment and Lantern; the hole is never drawn under the info card, chat panel or bottom HUD at 1366x768 or 390x844, and the shot counter sits in the energy bar's place in the HUD stack.

## Won't do
No ball-to-ball collisions, no moving obstacles, no 3D replay, no saved scores or leaderboards, no hole editor, no new sound effects. No change to how questions are picked or checked.

## Expected behavior
- On the host page, Via Golf appears as a game mode with options for 3 or 6 holes and time per hole; creating a room shows the first hole with everyone lined up at the tee, and dragging does nothing until the host starts.
  - PASS: headless Chrome, host page shows the Via Golf card with 3/6 holes and 1/1.5/2 min; in a two-player room both screens show both golfers at the first tee and a guest drag before the start sends no shot [evidence: .agents/cards/evidence/golf/lobby-guest-phone.png]
- After the start, the quiz opens for everyone; a correct answer adds one shot to the shot counter (up to 3); a wrong answer adds none and makes you wait 3 seconds as in the other modes.
  - PASS: two-player run: the quiz opens at the start, a wrong answer leaves 0 shots after the 3 s wait, right answers give 3 and 2 shots; on a phone a right answer with 3 saved says 'Right! You already have 3 shots saved.' and stays at 3 [evidence: .agents/cards/evidence/golf/phone-controls.txt]
- With a shot saved, dragging back on the hole shows an aim line and power; letting go rolls the ball the opposite way, uses one shot and adds one stroke; the ball moves the same way and stops at the same spot on the host's and the guest's screens.
  - PASS: two-player run: host mouse drag and guest finger drag (CDP touch) each use one shot, add one stroke, and stop at exactly the same coordinates on the host's state, the host's screen and the guest's screen; the shooter's own ball never moves again once stopped (3 shots sampled every 25 ms) [evidence: .agents/cards/evidence/sweep-2026-11-17.txt]
- With no shot saved, dragging shows "Answer a question to get a shot" and nothing is sent.
  - PASS: two-player run: with 0 shots a drag shows the banner 'Answer a question to get a shot', the prompt says the same, and no shot is sent [evidence: .agents/cards/evidence/sweep-2026-11-17.txt]
- The ball bounces off walls and columns, slows down in sand, rolls along slopes, and a ball that lands in water goes back to where it was hit from with +1 stroke and a splash.
  - PASS: the real simulate() on small test holes: a wall bounces the ball back, a column deflects the same shot, sand stops a 330 px/s roll 75 px sooner, a ball at rest on '>' rolls right, water ends the roll; in the live run a water shot returned the ball to the tee with 2 strokes [evidence: .agents/cards/evidence/golf/physics.txt]
- A ball that rolls slowly over the cup drops in: the player sees how they did (e.g. "Birdie!"), others see a short banner, and that player can't shoot again on this hole.
  - PASS: two-player run: the host's ball sinks, the host sees the score name and 'In the cup! Waiting for the others' and can't shoot again; the guest sees 'Marcus sank it in 3!' [evidence: .agents/cards/evidence/golf/sunk-guest-phone.png]
- When everyone has sunk their ball or time runs out, a recap shows and the next hole starts with everyone back at the tee; unfinished players get par + 3 (or strokes + 1 if more).
  - PASS: two-player run: time running out turns the guest's 0 strokes into 6 on a par 3 with 'Time's up! Hole 2 counts as 6 strokes', then the next hole starts with every ball back at its tee and 'Hole 3: Aqueduct · Par 4' [evidence: .agents/cards/evidence/golf/recap-guest-phone.png]
- After the last hole the results show only the standings by total strokes (with "to par"), the HUD is hidden, and Play again returns everyone to the lobby.
  - PASS: two-player run: both screens show the winner and standings by strokes with to-par, the info card, shot counter and prompt are hidden, and Play again returns both to the lobby [evidence: .agents/cards/evidence/golf/results-host.png]
- On a phone (390x844, touch) the whole hole fits on screen without overlapping the info card or the touch controls, a finger drag shoots, and the D-pad and E button aim and shoot as the button equivalent.
  - PASS: headless Chrome 390x844 touch: the hole fills the width at 1.35x between the info card and the prompt, nothing overlaps (UI audit 0 issues), a finger drag shoots, and E then ◀ and ▲ then E shoots one stroke [evidence: .agents/cards/evidence/golf/phone-dpad-aim.png]
- Pufferfish Party, Factory and Survival Island still pass their two-player tests, and the UI audit shows 0 issues in every theme including the golf screens.
  - PASS: two-player runs of all three modes play to the results with no errors; UI audit 0 issues in all 9 themes including the golf screens; platform check: no problems found [evidence: .agents/cards/evidence/sweep-2026-11-17.txt]

## Review
self-review: the host's rules allow helper agents only when the owner asks, and the owner did not ask for one, so no independent reviewer ran. My own review against the card found and fixed one defect (the shooter's ball jumped back for about 0.2 s when the host's copy took over; now it waits until both copies finish, verified by sampling). Not covered: real fingers on a real phone, slow networks, more than two players at once. One combined run of every check failed partway when the guest stopped receiving room updates from Supabase; each test passed when re-run one at a time, so I logged it as a live-connection hiccup, not a code fault.
