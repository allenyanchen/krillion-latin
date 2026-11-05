# Krillion Latin: Pufferfish Party (Subjunctive Set)

## The idea
Krillion Latin is a classroom game site with exactly **one** game mode: **Pufferfish Party**, played with the **Subjunctive Set** of questions.

It's hot potato with a pufferfish. Whoever holds the fish has to **type** the correct Latin subjunctive form (no multiple choice). The fish gets bigger the longer a round goes on, and nobody knows exactly when it will pop.

### The scene
A 2D pixel-art seafloor seen from an angled top-down view. Players stand on mossy rocks arranged in a ring around a **spike pit**, and you're always at the bottom of your own screen. When you load the site you're standing on your own rock. A side panel lets you host, join, and customize your character.

### Rules
1. **Host** creates a room and gets a 4-letter code. Each player who joins gets a new platform, which rises into the scene.
2. Before the game starts, everyone can **customize** their character's color, hat (laurel, crown, cap, Roman galea, wizard, bow) and eyes. Changes show up live for everyone.
3. The host chooses whether they're **playing too** or just running the game.
4. When the host presses **Play**, hearts pop in above every player and the pufferfish **drops from above** onto a random player.
5. **Only the holder sees the question.** Everyone else just sees "Gaius is answering…".
6. **Correct:** +100 points. Then the holder aims with the mouse (a dotted arc follows the cursor) and clicks a player to **throw** the fish.
7. **Wrong:** a red **−4s** floats up, the fish puffs, and the holder sees the right answer plus a new question.
8. The fish shows its **countdown** and swells and turns red as time runs low. **The timer resets for every new holder**, starting at 30 s and getting 1.5 s shorter each turn, down to a minimum of **5 s**. Whenever someone loses a heart, it goes back to 30 s. When it hits 0 it **POPs** and the holder loses a heart. Everyone hears **"faaah" + a vine boom** (`sounds/faaah.mp3`, `sounds/vine-boom.mp3`), and the word *fah → fahh → fahhh…* pops up, grows, and fades for as long as the faaah lasts.

### Music
Background music (`sounds/the_mountain-retro-game-593063.mp3`) loops quietly (12% volume) and dips to 4% while the faaah plays. It starts on your first click, since browsers block sound before then.
9. When a player loses their last heart, they leap into the spike pit and come back as a ghost to watch. The last player standing wins (confetti).

The game needs **at least 2 players**, so it is multiplayer-only by design.

### Host settings
- Question set: Present (48), Imperfect (44), or Both (92).
- Hearts per player: 1–5 (default 3).
- "I'm playing too" toggle.

## Questions
Transcribed from the two Blooket PDFs into `questions.js`:
- **Present Subjunctive set:** 24 active and 24 passive questions.
- **Imperfect Subjunctive set:** 22 imperfect active, 10 imperfect passive, and 10 present-review questions, including *sum* and *possum*.

How answers are checked:
- Capitals, spaces and macrons are ignored, and *j* counts as *i*.
- For passive 2nd-person singular answers, the alternate *-re* ending is also accepted (e.g. *mittare* for *mittaris*).

Answers worth a teacher double-check, since the source wording is unusual:
- Present #11 *volatis → voletis* (assumes *volāre*, "to fly").
- Imperfect #24 *manetur → maneretur*.
- Imperfect #29 *interficiebam → interficerer* (the question asks for passive).

## Can GitHub host multiplayer?
**Not by itself.** GitHub Pages (and Vercel's free plan) only serve the web page. They can't hold the live connections a real-time game needs. The solution is to split the work:

| Job | Service | Cost |
|---|---|---|
| Hosting the page | **GitHub Pages** | Free |
| Real-time multiplayer | **Supabase Realtime** (Broadcast + Presence) | Free tier |

- **No game server:** the **host's browser runs the game**. It tracks the fuse, turns, lives and answer checking, and sends the game state to everyone through a Supabase channel.
- **What players send:** only "my answer" and "pass to X".
- **No database:** Supabase Presence shows who is in the room, so no tables are needed.
- **Free-tier limits:** about 200 people connected at once and 2M messages/month, which is plenty for a class.
- **Caveats:**
  - Free Supabase projects **pause after about 7 days unused**. Click *Restore* in the dashboard before class.
  - If the host closes their tab, that game ends.

## Files
| File | What it does |
|---|---|
| `index.html` | Canvas plus UI overlays: side panel, question card, HUD, game-over screen |
| `style.css` | Pixel-style UI panels and animations |
| `scene.js` | Pixel renderer: platforms, characters, hats, hearts, pufferfish, throws, particles |
| `game.js` | The host-run game logic, Supabase and local connections, UI wiring |
| `questions.js` | Subjunctive Set question bank (92 questions) |
| `config.js` | Your Supabase URL and key go here |

## Setup
### 1. Supabase (multiplayer)
1. Create a free project at <https://supabase.com>.
2. Go to **Project Settings → API**. Copy the **Project URL** and the **anon / publishable key** into `config.js`. That key is designed to be public.
3. No tables are needed. Under **Realtime → Settings**, leave public channel access enabled (the default).

If `config.js` is left blank, the game runs in **local test mode**. Rooms then only work between tabs in the same browser, which is handy for trying it out.

### 2. GitHub Pages (hosting)
1. Create a new GitHub repository and upload `index.html`, `style.css`, `game.js`, `questions.js` and `config.js`.
2. Go to **Settings → Pages → Build and deployment**. Choose *Deploy from a branch*, then `main` / `(root)`.
3. After about a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.

The PDFs don't need to be uploaded. Leaving them out keeps the Blooket printouts off a public repo.

## Testing done
I simulated a 3-player game in headless Chrome using local test mode. It checked:
- Lobby join
- Wrong-answer penalty
- Correct answers and passing
- POP and life loss
- Elimination and the winner screen

No console errors. Online mode (Supabase) still needs a quick real test once `config.js` is filled in.

## Future ideas
- Sound effects (inflate, pop, correct ding).
- Option to skip the pass step and give the fish to a random player.
- Host can kick players.
- More question sets (pluperfect and perfect subjunctive, *ut* / *cum* clauses).
