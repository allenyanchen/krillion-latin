# Krillion Latin

A pixel-art learning website for practicing Latin with your class. It's live at <https://allenyanchen.github.io/krillion-latin/>.

## The site
A left sidebar (a bottom tab bar on phones) links to four pages.

| Page | What's there |
|---|---|
| **Dashboard** | A greeting, a quick join-by-code box, *Host a game* and *Create a set* shortcuts, your stats (games, wins, correct answers, sets created), the Pufferfish Party feature card, and recent sets |
| **Sets** | All sets, with search and an All / Built-in / My sets filter. **Create set** opens the editor. Each set has a page listing every question with its correct answer highlighted. Built-in sets can be duplicated and edited; your own sets can be edited or deleted. |
| **Characters** | One character for now (**Bloop**), with your display name, color, hat and eyes |
| **Join Game** | Its own page: enter the 4-letter code and your name, then join |

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
| `store.js` | Local storage (profile, sets, stats) plus shared UI helpers: pixel icons, toasts, confirm dialogs |
| `game.js` | Multiplayer, host game logic, chat, drawer, music and sounds |
| `scene.js` | Pixel renderer: seafloor, rocks, characters, pufferfish, effects |
| `questions.js` | Built-in sets |
| `config.js` | Supabase URL and public key |
| `sounds/` | faaah, vine boom, background music |

## Future ideas
- Share sets with your class (the `is_public` column is ready for this).
- More characters.
- Quiz Race (multiple choice) and Team Tide modes.
- Host tools: kick a player, mute chat.
