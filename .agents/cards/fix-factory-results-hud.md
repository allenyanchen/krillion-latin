# Fix: Factory leaves its info card on the results screen

## Broke
In Factory, when the game ends (time runs out or someone reaches the money goal), the results card appears but the info card with the minimap and money leaderboard stays visible behind it at the top left, on both the host's and the guest's screen. Survival Island, Via Golf and Pufferfish Party hide theirs. Seen in a two-player run; screenshot in .agents/cards/evidence/fix-factory-results-hud/before-host.png.

## Root cause
style.css hides `.fx-hud` at game over only for Survival Island (`.game-page[data-mode="island"][data-phase="over"] .fx-hud`) and Via Golf; the general game-over rule hides the key hints, energy, answer button and touch controls but not the info card, so Factory keeps it.

## Existing files
- style.css

## Expected behavior
- At the end of a Factory game, the host and the guest see only the results card: no info card, energy bar or controls.
  - PASS: two real browsers through the live Supabase room (desktop host playing, phone guest), Factory played to the end: the info card is hidden on both screens and only the results card shows [evidence: .agents/cards/evidence/fix-factory-results-hud/after-host.png]
- Survival Island and Via Golf still hide their info card at the end, and during play the Factory info card still shows.
  - PASS: same two-player runs for Pufferfish Party, Survival Island and Via Golf report the info card hidden at the results on both screens; the UI audit's factory-play screens still show it during play, 0 issues [evidence: .agents/cards/evidence/sweep-2026-11-17.txt]

## Review
self-review: no helper agent was requested by the owner, so no independent review ran; the one-line rule was checked against all four modes in two-player runs.
