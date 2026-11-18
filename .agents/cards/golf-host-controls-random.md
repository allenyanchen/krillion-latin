# Card: Via Golf host controls and random holes

## Outcome
On the host page and in the lobby, the host picks the time per hole (1, 1.5, 2 or 3 minutes, or No limit) and the course: **Roman landmarks** (the six designed holes) or **Random**. During a game the host has a **Next hole** button in the info card that moves everyone on at any moment (after a confirm); unfinished players score as if time ran out. With No limit, a hole ends only when every ball is in or the host presses Next hole. Random holes are new every game: a fairway that bends once or twice from the tee to the cup, with sand, columns, a pond off the line and sometimes a slope; each one is checked by rolling real shots and kept only if it can be sunk in 1 or 2 shots, so par is 2 or 3. Every screen plays the same random holes.

## Applies
ORTH-02 ORTH-06 ORTH-08 UX-01 UX-03 UX-04 UX-05 UX-09 IOS-01

## New files
- none

## Existing files
- golf.js
- game.js
- app.js
- index.html
- style.css
- tools/ui-audit.js

## Invariants
Roman landmarks plays exactly as before (same six maps, same pars, same physics). Pufferfish Party, Factory and Survival Island are untouched. Nothing new is stored in localStorage or Supabase; random holes live only in the room's state for that game. Players who are not the host never see the Next hole button.

## Replaces
The fixed 1 / 1.5 / 2 minute choice is replaced by 1 / 1.5 / 2 / 3 minutes / No limit in the same seg controls on the host page (app.js) and in the lobby (index.html); nothing else is removed.

## Standard approach
Extend golf.js the way it already works: holes are text maps parsed by the same code as HOLES, the host decides and broadcasts state in `S.fx` (host-authoritative pattern of island.js and factory.js), lobby options go through `Host.configure({ fx })` in game.js like `#gfHolesSeg`, and the confirm uses `UI.confirm()` from store.js. A seeded random generator (mulberry32) makes a hole reproducible for tests; the generated maps travel in `S.fx.maps` so every screen uses the host's exact holes.

## Deviation
none

## Expectations
CORE-01: The browser has nothing for course generation, so golf.js builds maps with its own small seeded random generator and checks them with the existing simulate(); the confirm before skipping uses the site's UI.confirm (store.js), not window.confirm, and the time and course options reuse the existing .seg controls.
CORE-02: When the host presses Next hole, the info card, top-bar timer, banners, balls and strokes move on exactly as when time runs out; with No limit the top bar says "no time limit" instead of a countdown; with Random the info card, the recap banners and game.js renderOver read par and names from S.fx.maps instead of HOLES, while Roman landmarks keeps reading HOLES.
CORE-03: The Next hole button does one thing (end the current hole for everyone) and only the host sees it; time running out and every ball being in still end the hole the same way, all three going through host.endHole so scoring stays in one place.
CORE-04: Nothing runs while idle beyond the existing frame loop and the host's 200 ms tick; random holes are generated once when the host starts (a short burst of simulate() calls, measured below) and never during play.
CORE-05: Two real browsers through the live Supabase room: host picks Random and No limit in the lobby, a phone guest joins, both screens show the same random holes (map text equal), the host presses Next hole mid-hole and both move on with the right scores, the game reaches the results; a seeded batch of 200 random holes is generated in Node and each is checked solvable in 1-2 shots with par 2-3, and the time it takes is measured. Not covered: real teachers' timing preferences, more than two players.
UI-01: The Next hole button uses the existing .btn small style inside the info card (fx-hud), the same size class as other card buttons, and on phones keeps the 44 px touch minimum; random holes use the same tiles and colors as the designed holes, so they look like they belong next to them.

## Won't do
No hole editor, no saving or sharing random courses, no difficulty setting for random holes, no moving obstacles, no host "previous hole" or pause.

## Expected behavior
- On the host page and in the lobby, the host can pick time per hole (1, 1.5, 2, 3 min or No limit) and the course (Roman landmarks or Random); the lobby shows the current choice.
  - PASS: headless Chrome: the host page offers 1 min, 1.5 min, 2 min, 3 min, No limit and Roman landmarks / Random; in the lobby the host switched to Random and No limit and the lobby shows them selected [evidence: .agents/cards/evidence/golf-host-controls-random/sweep.txt]
- During a game the host sees a Next hole button in the info card and other players don't; pressing it asks to confirm, then everyone moves to the next hole (or the results after the last), and unfinished players score par + 3 (or strokes + 1 if more).
  - PASS: two real browsers through the live Supabase room: only the host sees Next hole; pressing it asks 'Move on to the next hole?', then both screens go to hole 2 and both unfinished players score par + 3 (6 on a par 3) with 'The host moved on. Hole 1 counts as 6 strokes'; on the last hole it reads Finish the game and leads to the results [evidence: .agents/cards/evidence/golf-host-controls-random/next-hole-confirm.png]
- With No limit, the top bar shows the hole without a countdown and the hole only ends when every ball is in or the host presses Next hole.
  - PASS: two-player run: both top bars read 'Hole 1/3 · no time limit' and the hole was still open after 5 s; it ended only when the host pressed Next hole [evidence: .agents/cards/evidence/golf-host-controls-random/sweep.txt]
- With Random, each hole is a new course with par 2 or 3, the host's and the guest's screens show exactly the same holes, and scoring and results use those pars.
  - PASS: two-player run: the host's and the guest's random holes are identical (names, pars, every map row), pars 3/2/3, the info card and banners show those names and pars, and the results say par 8 = the course's real par; Roman landmarks still uses par 9 for its first three [evidence: .agents/cards/evidence/golf-host-controls-random/lobby-random-guest-phone.png]
- Every random hole can be sunk: a batch of 200 seeded random holes is each solvable in 1 or 2 shots by the real physics, with par 2 or 3, and generating a 6-hole course takes under a second.
  - PASS: Node, the real simulate(): 204 seeded random holes, every one sinkable in 1 or 2 shots, par 2: 112 / par 3: 92, no fallbacks; a 6-hole course builds in 76 ms (median), 245 ms at worst; the same seed gives the same course [evidence: .agents/cards/evidence/golf-host-controls-random/random-holes.txt]
- Roman landmarks still plays the six designed holes with their pars, and the UI audit shows 0 issues in every theme.
  - PASS: the full Roman-landmarks two-player test passes unchanged (same holes, pars, sink, water, time-up, results); the six designed holes check out as before; UI audit 0 issues in all 9 themes with desktop golf on a random course; platform check: no problems; Pufferfish, Factory and Island two-player runs pass [evidence: .agents/cards/evidence/golf-host-controls-random/sweep.txt]

## Review
self-review: the owner has not asked for a helper agent, so no independent review ran. My review found and fixed: the game starting on a different random course than the lobby had shown (the reset at start threw it away; now only Play again makes a new one), and the recap saying "Time's up!" when the host had moved everyone on. Not covered: how teachers like the random holes' difficulty, more than two players.
