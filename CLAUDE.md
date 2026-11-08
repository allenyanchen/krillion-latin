# Krillion Latin: working rules

A static site (vanilla JS, no build step) hosted on GitHub Pages, with Supabase for logins and realtime multiplayer.
`PLAN.md` describes every page and game mode. Keep it updated whenever rules or files change.

## Hard rules
- Never put the Supabase service_role / secret key in the site. `config.js` holds only the public key.
- Keep `*.pdf` (source worksheets) out of the repo (already in `.gitignore`).
- Never show the owner's email on public pages.
- Before every commit, bump the cache version in `index.html` on all assets at once:
  `sed -i '' -E "s/\?v=[0-9]{12}/?v=$(date +%Y%m%d%H%M)/g" index.html`

## Colors and themes (the most common source of bugs)
Every color comes from `theme.js`, which generates tokens from one accent color for 9 presets: 7 dark and 2 light (Parchment, Marble).
- **Never pair a fixed color with a theme color.** For example, a fixed dark background with `var(--ink)` text becomes dark-on-dark in light themes. Either:
  - use theme tokens for **both** the background and the text, or
  - use fixed colors for **both**, which is only right on fixed-color art such as quiz tiles, set banners, `kbd` keys and canvas drawings.
- **Surfaces:**

  | Token | Use for |
  |---|---|
  | `--bg` | page background |
  | `--panel` / `--panel-2` / `--panel-3` | cards and raised controls |
  | `--well` / `--well-2` | inset areas, bar tracks, inputs |
  | `--side-1` | sidebar |
  | `--hud` | any floating panel over a game canvas (top bar, energy, backpack, key hints, touch buttons) |

- **Text:**

  | Token | Use for |
  |---|---|
  | `--ink` | main text |
  | `--muted` | secondary text |
  | `--dim` | quietest text |
  | `--accent-hi` | highlighted text: codes, prices, focus words |
  | `--good`, `--bad`, `--teal`, `--pink` | status text |
  | `--energy` | energy numbers |
  | `--ice` | frozen state |

  All of these are generated to reach 4.5:1 contrast on every surface. Add new text colors to `theme.js` with `ensure(...)` rather than hardcoding them.
- **Accent:** `--accent` is a button and outline color (3:1), so don't use it for small text; use `--accent-hi`. Text on an accent background uses `--accent-ink`.
- **Fading:** never fade text with `opacity` below 0.7 to show a state. Change its color to `--muted`, or fade only the icon or art.
- **Light-mode exceptions** go in the `html[data-mode="light"]` block of `style.css`.

## Look and feel
- Pixel style:
  - Square-ish corners with `var(--radius)`.
  - Chunky edges via `box-shadow: 0 0 0 var(--px) var(--edge)`.
  - `image-rendering: pixelated` on canvases and sprites.
- Fonts: Pixelify Sans / Silkscreen for headings, buttons, labels and numbers; Nunito for body text.
- Icons are pixel SVGs in `ICONS` (`store.js`). Use them with `<i data-icon="name"></i>`; `paintIcons()` fills them in.
- Use `UI.toast()` and `UI.confirm()` for messages and confirmations, never `alert` or `confirm`.
- Copy is plain and friendly for students. Name things by what players see.

## Game modes
- **Module and registration:**
  - Each movement mode is an IIFE global, e.g. `window.Factory` or `window.Island`. It exposes `attach`, `host` (host-side rules: `initState`, `assignSections`, `start`, `reset`, `onMessage`, `tick`), `onState`, `onPos`, `onQuestion`, `deactivate`, `statusText` and `isActive`.
  - Register a new mode in `game.js` (`modOf`, `LABELS`, `renderOver`).
  - Add its `<script>` before `game.js` in `index.html`.
  - Add a mode card and options in `app.js` (host page), and lobby options in `index.html` (`#…Opts`).
- **The host is authoritative.** Clients send requests (`is-dig`, `fx-ans`, …); the host validates them and broadcasts state `S` (mode data in `S.fx`, events in `S.fx.evs`).
- **Shared pieces** that all movement modes should reuse so players recognize them:
  - Factory's 20 `ITEMS` (antiques).
  - The full-screen quiz `#fxQuiz`. After an answer, it waits for a click or key; after a wrong answer, it waits 3 s first.
  - The energy bar and "Answer questions" button.
  - `#fxPrompt` for "press E" actions.
  - `#fxBanner` for announcements.
- **CSS scoping:**
  - Mode-specific CSS is scoped with `.game-page[data-mode="…"]`.
  - Phase-specific CSS uses `.game-page[data-phase="lobby|play|voyage|over"]`.
  - Hide HUD pieces in phases where they don't apply. At game over, show only the results.
- **HUD stack** (bottom-left, in px from the bottom):

  | Layout | Bottom-left stack | Elsewhere |
  |---|---|---|
  | Desktop | key hints 12, energy 48, answer button 100, backpack 152 | prompt centered at 64 |
  | Touch (`pointer: coarse`) | D-pad, then energy 186, answer button 238, backpack 290 | prompt 342 |

  The top bar is `.g-top` and the info card is `.fx-hud`. New HUD pieces must fit this stack. Touch overrides go at the **end** of `style.css` so they win.
- **Touch:** no keyboard hints (hide `kbd`); every action needs an on-screen button.

## Checking work
- Serve locally: `python3 -m http.server 8765`. Tests use playwright-core with system Chrome (headless) and go through the real Supabase.
- **After any visual change, run the UI audit:**
  `node tools/ui-audit.js <out-dir> [--themes lantern,parchment] [--only island]`
  - It visits every page and game state in every theme.
  - It flags low-contrast, spilling or off-screen text.
  - It saves screenshots.
  - Expect `0 distinct issues`, then look at the light-theme and phone screenshots yourself.
- Always check: a dark and a light theme, desktop (1366×768), and phone (390×844, touch).
