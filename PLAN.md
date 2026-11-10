# Puffer

_Formerly "Krillion Latin". The repo and the GitHub Pages address are still `krillion-latin`; internal names (`KRILLION_CONFIG`, `kl-` storage keys, `krillion-puffer-` channels) stay so saved data and rooms keep working._

A pixel-art learning website for practicing Latin with your class. It's live at <https://allenyanchen.github.io/krillion-latin/>.

## The site
A left sidebar (a bottom tab bar on phones) links to four pages.

| Page | What's there |
|---|---|
| **Dashboard** | A greeting, a quick join-by-code box, *Host a game* and *Create a set* shortcuts, your stats (games, wins, correct answers, sets created), the Pufferfish Party feature card, and recent sets |
| **Sets** | All sets, with search and an All / Built-in / My sets filter. **Create set** opens the editor. Each set has a page listing every question with its correct answer highlighted. Built-in sets can be duplicated and edited; your own sets can be edited or deleted. |
| **Characters** | One character for now (**Bloop**), with your display name, color, hat and eyes |
| **Join Game** | Its own page: enter the 4-letter code and your name, then join |
| **Profile** (click your name card in the sidebar) | Your character, account and stats, plus the **site theme**: 9 presets (7 dark, 2 light) or a custom theme built from an accent color (hue and vibrance sliders, color picker, hex box), dark or light mode, and a background-tint slider. A live preview shows the contrast check for every important text color. |

**Hosting** opens its own page:
1. Pick a set.
2. Pick a game mode. Pufferfish Party is available now; *Quiz Race* and *Team Tide* are placeholders marked "coming soon".
3. Choose your settings: hearts per player, the starting timer, and whether you're playing too.
4. **Create room**.

### Sets and questions
- Each question has a prompt, an optional label (e.g. "present active"), and **any number of answer choices** (4 by default, up to 8), with one marked correct.
- Pufferfish Party uses only the correct answer, typed. Future multiple-choice modes can use all the choices.
- **Built-in sets** come from the two Blooket PDFs, with all four original choices for every question:
  - *Subjunctive Set* (all 92)
  - *Present Subjunctive* (48)
  - *Imperfect Subjunctive* (44)
- **Your sets:** signed out, they're saved in your browser. Signed in, they're saved to your account in Supabase.

## Accounts
- **Sign in** with Google, or with an emailed sign-in link. The sidebar has a Sign in button; the dashboard has a reminder.
- **Signed in:** your name, character, stats and sets sync to your account (the `profiles` and `sets` tables), so they follow you to any device.
- **Moving browser sets:** whenever you're signed in, the site looks for sets saved in this browser that are valid and not already in your account (matched by content). If it finds any, it lists them so you can pick which to move. *Not now* remembers your choice, and the Sets page shows a *Review & move* banner so you can move them later.
- **No account needed to play:** anyone can join a game with just a name.
- **Privacy rules:** Row Level Security means each person can only read and change their own rows.
- **Theme sync:** when signed in, your site theme is stored in `profiles.theme` and applied on any device. This needs one column, added once in the Supabase SQL Editor:
  ```sql
  alter table public.profiles add column if not exists theme jsonb;
  ```
  Without the column, everything else still syncs and the theme stays in the browser.

## The game page (full screen)
- **Top bar:**
  - Leave
  - set name and round
  - room code with a copy-invite-link button
  - player count
  - chat toggle
- **Lobby card** (left): the big join code. The host also gets the hearts setting, the *I'm playing too* toggle, and **Start game**.
- **Side panel** (right), with two tabs:
  - **Chat:** live room chat. Messages are capped at 200 characters and limited to one every 0.7 s. Join and leave notices appear here too.
  - **Updates:** the game log.
  - An unread badge shows when the panel is closed.
- **Customize drawer:** click the arrow at the bottom to slide it up and change your character's color mid-game. It closes automatically when it's your turn.
- **Unique colors:** no two players in a room share a color, out of 18. Colors other players have are greyed out and crossed through. If you join with a taken color, you're switched to a free one automatically. With more than 18 players, colors have to repeat.
- **Unique names:** joining with a name someone in the room already has, ignoring capitals and spaces, is turned away with an error on the Join page.
- **Idle rooms close** after 1 hour with no activity (no answers, throws, chat or joins), and everyone sees a "Room closed" message. When every tab is closed, the room is already gone, because rooms only exist while the host's tab is open.

### Pufferfish Party rules
1. Players stand on rocks in a ring around a **spike pit**, and you're always at the bottom of your own screen.
2. The host presses **Start**. Hearts pop in above everyone and the pufferfish **drops onto a random player**.
3. **Only the holder sees the question.** Everyone else sees "Gaius is answering…".
4. **Correct:** +100 points. Then aim with the mouse and click a player to **throw** the fish.
5. **Wrong:** a red **−4s** floats up and you get a new question.
6. **Timer:** it resets for every new holder. It starts at the host's chosen value (10, 15, 20, 25 or 30 s; default **15 s**) and drops **2 s per turn**, down to 5 s. It goes back to the starting value after anyone loses a heart.
7. **Pop:** the holder loses a heart. Everyone hears **faaah + a vine boom**, and *fah → fahh → fahhh…* grows on screen.
8. **Out:** a player with no hearts left leaps into the spike pit and watches as a ghost. The last player standing wins. Points only order the rest of the standings.
9. **Music:** background music loops quietly and dips while the faaah plays.
10. **Look:** the same pieces as Factory and Island. An **info card** top-left shows who has the pufferfish, the fuse as a bar, and everyone's hearts and points (the holder's row is highlighted, players who are out are crossed off). Pops are announced in the shared **banner** ("Livia popped! 2 hearts left"). The holder's question card uses the shared quiz look (tag chips, the word to change in big pixel letters) but you still **type** the answer. Your **+100** only shows on your own screen. The seafloor has coral along the back, boulders, and swaying kelp in the corners with rising bubbles. The ring makes room for the info card, the chat panel and the question card, so no one is ever hidden behind them.

### Factory rules
1. **The world:** a **2.5D factory floor** with real depth. You walk left, right, toward the back wall and toward the front with **WASD** or the arrow keys, and diagonally too. The floor is drawn in one-point perspective, and the machines are 3D blocks with top, front and side faces. Players are drawn in front of or behind machines depending on where they stand, and they can't walk through them. Behind the back wall, parallax layers of tanks, pipes, vats and chains scroll at different speeds, with a dark foreground of girders and railings in front.
2. **Your section:** each player owns one section, in lobby order.
   - Against the back wall: a grey **spawner** (screen, status light, hopper) pumps items onto a **conveyor** with moving cleats, and the belt carries them into a grey **compactor** (piston, warning beacon, hazard stripes) where they disappear.
   - Out on the floor, further forward: your yellow holographic **sell pad** and your **SELL bin**, with SELL painted onto its front in pixels and a dashed walkway leading to it.
3. **Controls:**
   - Move with **WASD** or the arrow keys. On touch screens there's an on-screen D-pad and an E button.
   - To pick up from the belt, stand in front of it.
   - Next to an item on *your own* conveyor, a prompt says **Press E to pick up**. You carry **one item at a time**.
   - Press **E** at your bin to drop the item in.
4. **Selling:** the bin sells one item every **10 s**, or every **1 s** while you stand on your pad. Each sale pops a **+$** next to the bin in the item's rarity color.
5. **Rarities:**

   20 items in 6 tiers. A tier's chance is split evenly between its items.

   | Rarity | Items | Value | Tier chance |
   |---|---|---|---|
   | Common | Clay Pot, Bread Loaf, Wax Tablet, Amphora, Wool Ball | $4–7 | 54% |
   | Uncommon | Bronze Coin, Papyrus Scroll, Leather Sandal, Grape Bunch | $10–14 | 26% |
   | Rare | Oil Lamp, Silver Denarius, Mosaic Tile, Bronze Helmet | $28–34 | 12.5% |
   | Epic | Gladius, Laurel Wreath, Marble Bust | $70–85 | 5.3% |
   | Legendary | Golden Aquila, Golden Lyre | $200–220 | 1.7% |
   | Mythical | Orb of Jupiter, Trident of Neptune | $500–550 | 0.5% |

   Which item comes next is decided by a seeded hash of (game seed, player section, spawn number), so every browser agrees, each player's conveyor gets its own sequence, and an item that would repeat the one just before it is re-rolled once.

   A held item shows its rarity above your head for anyone on screen. **Legendary and Mythical** pickups are announced to everyone.
6. **Energy and questions:**
   - Everyone starts with **0 energy**. A correct answer gives **+100** by default (the host can pick +50, +100, +150 or +200 when hosting or in the lobby). Energy drains **10 per second** while walking; standing still costs nothing.
   - At **0 you're frozen** (shown in an ice block) and **drop what you're holding** on the floor next to you. Anyone can pick it up: stand on it, press **E** and stay still for a moment (walking away cancels). Answer questions to move again.
   - Press **Space** or click **Answer questions** to open a **full-screen question screen**: the set's question at the top, its answer choices as big colored tiles below. Click a tile or press **1–4**. Right answers flash green with "+100 ⚡". Wrong ones flash red and show the correct answer. The result stays up until you **click or press any key** (tap on phones); after a wrong answer you must wait **3 seconds** first, with a countdown, so you read the right answer. **Space** or **Esc** always take you back to the game (if the result was ready to continue, a new question is waiting when you come back).
   - The screen opens automatically when the game starts. Each player gets their own shuffled order of questions. The host keeps the right answers and checks them.
7. **Stealing:** walk to another player's bin and press E to take a **random** item from it. The owner is notified. You can't take items from someone's hands or their conveyor.
8. **HUD:** an energy bar, a minimap of every section with colored player dots and your view box, plus a live money leaderboard.
9. **Winning:** the host picks **Most money** (2, 3, 5 or 8 minutes; richest wins) or **First to goal** ($1k, $2.5k or $5k). The game needs at least 1 player.
10. **Networking:** the host decides pickups, bins, money, energy and the clock. Conveyor items come from a shared random seed, so every browser shows the same belts without sending them. Positions use *dead reckoning*: a player sends their position and walking direction only when they start, stop or turn, plus a 1-second correction while walking (about 1–2 messages a second). Other browsers predict the movement in between.

### Survival Island rules
1. **The island:** a large top-down pixel island (about 3×3 screens) with beaches, grassland, forest, rocky hills, a village plaza and a harbor. The island's shape is fixed so players learn it; treasure and coins move every game. Walk with **WASD / arrows** in all directions; trees, rocks, stalls and the sea block you. In the lobby everyone (the host too, if playing) waits in a line in the village plaza; nobody can walk until the game starts. Factory works the same way: no walking before the countdown ends.
2. **Energy:** the same rules as Factory: correct answers give energy (host picks +50/+100/+150/+200), walking uses 10 a second, standing still is free, and at 0 you freeze until you answer more. Freezing **spills your backpack** on the ground around you; anyone (you too, once you can move) picks them up with **E**, staying still for half a second. The question screen opens automatically at the start.
3. **Antiques (hidden):** buried around the island, invisible until you're close. A glint flashes within a few steps, and an **X** appears when you're right next to one. Press **E** and stay still for about a second to dig it up (walking away cancels). They are the **same 20 items as Factory**. Spots in the **forest and hills** roll twice and keep the rarer item, so exploring deeper pays off. Your **backpack holds 5**. A new antique is buried somewhere else whenever one is dug up.
4. **Coins:** visible gold coins scattered around (some hide under trees). Stand on one and press **E** (stay still for half a second) to pick it up. Coins are plain cash, added straight to your money.
5. **Trader (village):** press E to sell everything in your backpack at once. Only the seller sees the money: a small card above the Trader's stall counts up to the total (e.g. **+$594**) with a coin burst, then fades after about 3 seconds.
6. **Shipwright (village):** press E to open the shop: ship preview, stats, a storm forecast and 21 parts. Hull, sail and keel come in tiers: a ship has one of each, so buying a better one **replaces** the old one and its stats don't add up. So the cards show only what you'd really gain over what you have (with an Oak Hull, Copper-Clad shows +3 Hull, not +8), and buying confirms "it replaced your Oak Hull". Extras are one of each and do add up.

   | Slot | Parts (price) |
   |---|---|
   | Hull | Log Raft (start), Plank Hull ($60), Oak Hull ($180), Copper-Clad Hull ($420) |
   | Sails | Patched Sail ($40), Canvas Sail ($140), Twin Masts ($360) |
   | Keel | Ballast Stones ($50), Wooden Keel ($130), Iron Keel ($300) |
   | Extras | Oars, Rope Coil, Tar Barrel, Bilge Pump, Anchor, Lantern, Compass, Spyglass, Water Barrels, Food Crates, Fishing Net, Golden Figurehead |

   Parts add to five stats: **Hull, Speed, Balance, Navigation, Supplies**. Hull points = 3 + Hull. Every player's ship sits at their own pier in the harbor and visibly changes as they buy parts.
7. **The storm:** when the timer ends, everyone is teleported onto their ship ("Time's up! All aboard!") and the storm plays as a short hand-drawn 3D film (Three.js, flat cartoon shading with black ink outlines and paper-card captions). Each obstacle checks one or two stats; failing costs hull points, and at 0 the ship sinks.
   - **Story:** the last evening in the harbor → each captain introduced on their ship (your own first, up to 6) → "Ropes off!" → one segment per danger → dawn at the lighthouse harbor (or "Lost at sea" with floating planks if no ship made it).
   - **Each danger** has three shots: a b-roll of the danger with a story line, the ship facing it ("Needs Balance 2 · your ship has 4"), and a reaction (the captain turns to the camera; "Cleared!" or "−2 ♥"), plus everyone's result for that danger.
   - Ships are built from the parts each player bought, with that player's own pixel character at the helm, drawn exactly as they customized it (a flat cutout that always faces the camera). The film follows your ship; once it sinks you watch it go down, then the film follows the leader. Sunk ships never appear again.
   - About 7 s per danger, roughly 75 s in total; dangers after every ship has sunk are skipped. The host can **Skip to results**.
   - The film is a pure function of time from the voyage start, so everyone sees the same shot, and late joiners land in the right place. Three.js (cdnjs) loads in the background while people play; slow machines drop resolution automatically, and without WebGL the old 2D pixel storm plays on the same timeline.

   | Obstacle | Checks | Easy / Medium / Hard | Damage |
   |---|---|---|---|
   | Choppy Waters | Balance | 1 / 2 / 3 | 1 |
   | Reef Rocks | Navigation | 2 / 3 / 4 | 2 |
   | Lightning Squall | Speed | 2 / 4 / 5 | 2 |
   | Whirlpool | Speed + Balance | 5 / 9 / 12 | 2 |
   | Fog Bank | Navigation | 4 / 6 / 8 | 2 |
   | Huge Wave | Hull + Balance | 7 / 12 / 16 | 5 |
   | The Kraken (Hard only) | Hull + Navigation | 14 | 4 |
   | Long Haul Home | Supplies | 2 / 4 / 5 | 2 |

   Results are decided by the ship alone (no luck), so the shop's forecast is exactly what will happen. A route bar shows every player's ship moving along; if yours sinks, the camera follows the leader.
8. **Difficulty:** Easy has 46 antiques and 30 coins ($5–10), Medium 36 and 22 ($4–8), Hard 28 and 16 ($3–6) plus the Kraken. Time on the island: 4, 6, 8 or 10 minutes (default 6).
9. **Winning:** the ship that gets furthest wins; ties go to most hull points left, then the stronger ship, then money left.
10. **Networking:** same as Factory: the host decides digs, coins, sales, purchases, energy and the voyage results; positions are dead-reckoned. Treasure contents stay on the host until someone digs them up.

### Answer checking
- Capitals, spaces and macrons are ignored, and *j* counts as *i*.
- For passive 2nd-person singular answers, the alternate *-re* ending is also accepted.

Answers worth a teacher double-check:
- Present #11 *volatis → voletis* (assumes *volāre*, "to fly").
- Imperfect #24 *manetur → maneretur*.
- Imperfect #29 *interficiebam → interficerer* (the question asks for passive).

## How multiplayer works
GitHub Pages only serves files, so live play goes through **Supabase Realtime** (free tier).
- **No game server:** the host's browser runs the game and broadcasts its state to everyone.
- **What players send:** answers, throws and chat messages.
- **Who's in the room:** Supabase Presence tracks this, so no database tables are needed.
- **Free projects pause after about 7 days unused.** Click *Restore* in the Supabase dashboard before class.
- **If the host leaves, the game ends.** Players see a "host left" dialog.

## Files
| File | What it does |
|---|---|
| `index.html` | App shell (sidebar and main area) plus the game page markup |
| `style.css` | UI for every page. Pixelify Sans for headings, buttons and labels; Nunito for body text so it's easy to read. In-game names and numbers are drawn on a sharp text layer over the pixel scene. |
| `app.js` | Router and pages: dashboard, sets, set view, set editor, characters, join, host |
| `theme.js` | Theme engine: builds every color from one accent in OKLCH, tints the backgrounds, and checks text contrast (WCAG 4.5:1 / 3:1). Loaded before the page draws, so there's no flash. |
| `store.js` | Local storage (profile, sets, stats) plus shared UI helpers: pixel icons, toasts, confirm dialogs |
| `game.js` | Multiplayer, host game logic, chat, drawer, music and sounds |
| `factory.js` | Factory mode: parallax renderer, conveyors, items, movement, bins and stealing, host rules, minimap |
| `island.js` | Survival Island: island generator and renderer, digging, coins, trader, shipwright shop, ships, storm voyage, host rules, minimap |
| `voyage3d.js` | Survival Island's storm film: Three.js scene, ink-outline pass, ships built from parts, characters, camera shots, story captions |
| `scene.js` | Pixel renderer: seafloor, rocks, characters, pufferfish, effects |
| `questions.js` | Built-in sets |
| `config.js` | Supabase URL and public key |
| `sounds/` | faaah, vine boom, background music |

## Future ideas
- Share sets with your class (the `is_public` column is ready for this).
- More characters.
- Quiz Race (multiple choice) and Team Tide modes.
- Host tools: kick a player, mute chat.
