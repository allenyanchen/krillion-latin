# Krillion Latin: Pufferfish Party (Subjunctive Set)

## The idea
Krillion Latin is a classroom game site with exactly **one** game mode: **Pufferfish Party**, played with the **Subjunctive Set** of questions.

It's hot potato with a pufferfish. Whoever holds the fish has to **type** the correct Latin subjunctive form (no multiple choice). The fish gets bigger the longer a round goes on, and nobody knows exactly when it will pop.

### Rules
1. The host creates a room and gets a 4-letter code. Everyone else joins with that code, or with the invite link.
2. The game needs **at least 2 players**, so it is multiplayer-only by design.
3. A random player starts with the pufferfish and gets a question, e.g. *"Form the present passive subjunctive of **mitteris**"*.
4. **Correct answer:** +100 points, then tap any other player to pass the fish to them.
5. **Wrong answer:** the correct form is shown, the fuse loses 4 seconds, and you get a new question. You still hold the fish.
6. Each round's fuse is a hidden 25–40 seconds. When it runs out, the fish **POPs** and whoever is holding it loses a life.
7. A player with 0 lives is out but can keep watching. The last player standing wins. Points break ties.

### Host settings
- Question set: Present (48), Imperfect (44), or Both (92).
- Lives per player: 1–5 (default 3).

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
| `index.html` | Page layout: home, lobby, game, and game-over screens |
| `style.css` | Underwater theme |
| `game.js` | Game logic, the host-run game, Supabase and local connections, the pufferfish animation |
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
