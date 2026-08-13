# Crate Dash 3D — local play-data collection

## Run it
Requires [Node.js](https://nodejs.org) — no other install needed, no `npm install`.

```
node server.js
```

Then:
- Play the game: http://localhost:3000
- View collected data: http://localhost:3000/dashboard
- Raw JSON: http://localhost:3000/api/events

Data is stored in `data/events.jsonl` (one JSON object per line — a `game_start`,
`game_over`, `powerup_get`, and `powerup_use` event for every run). This format
is easy to import into a spreadsheet, database, or Excel later — `/api/events`
gives you the same data as a single JSON array if that's easier to work with.

## Letting other people play
Anyone on the same Wi-Fi/network can play by visiting your computer's local IP
instead of `localhost`, e.g. `http://192.168.1.23:3000` (find your IP with
`ipconfig` on Windows or `ifconfig`/`ipconfig getifaddr en0` on Mac). Their
plays will show up in the same dashboard.

## Clearing data (for practice runs before the real experiment)
Useful if students play once as a demo/practice in class, and you want a
clean slate before the real experiment starts.

**1. Enable it** (off by default, for safety):
- Locally: run with `ADMIN_KEY=yourpassword node server.js` instead of the
  plain `node server.js`.
- On Railway: go to your service → **Variables** → add `ADMIN_KEY` = a
  password only you know → redeploy.

**2. Use it:** on `/dashboard`, click **"Clear all data"** (bottom-left link),
enter the key when prompted, confirm. The live data resets to empty — but a
full backup is saved first to `data/backups/` (never deleted automatically),
so nothing is ever actually lost.

**This also resets every player, not just the server's records.** Coins and
the demographics answer are stored in each player's own browser
(`localStorage`), so clearing data on the server alone wouldn't normally
touch them. To handle that, the game checks a small "reset token" from the
server every time it loads; clearing data changes that token, so the next
time each player opens the link, their browser notices, wipes its own saved
coins and demographics answer, and shows the survey again — like a brand new
visitor. No redeploy or action needed on their end.

## Controlling settings for everyone (Dashboard → "Game settings")
There's no more in-game Settings menu — sound, vibration, shadow quality, and
tilt steering are now controlled centrally from the dashboard instead, so
every player gets the same, consistent experience (useful for keeping the
experiment's conditions uniform, or just for keeping a classroom quiet).

Uses the same `ADMIN_KEY` as clearing data (see above — set it first). Then
on `/dashboard`, click **"⚙ Game settings (all players)"**, set each toggle
to Force On / Force Off / No override, enter the admin key, Save. Every
player's game picks up the new values automatically the next time they load
the page — nothing needs to be redeployed. "No override" means that setting
just falls back to the game's normal default (all on).

## What gets tracked
- `demographics`: a one-time survey shown before a player's first run — age,
  gender, nationality, academic major, gaming experience, hours of gaming per
  week, device (phone/laptop/tablet/desktop), and **group (1-4)**. Stored once
  per browser (in `localStorage`), so returning players aren't asked again.
- `game_start`: mode, character, skin, run number, player id
- `game_over`: score, coins earned, zone reached, distance traveled, survival
  time, jump count, left/right move count, character, skin, **group**, and
  per-run totals for how many times each of the three skills (Double Jump,
  Crate Smasher, Slow-Mo) was picked up and used
- `powerup_get` / `powerup_use`: an individual log entry each time a skill is
  picked up or activated, for a moment-by-moment record on top of the run
  totals
- `revive_choice`: fired every time a player leaves the "you died" screen —
  whether they revived with a free ad, revived by spending coins, or declined
  (went to menu instead). Fields: `group`, `reviveChoice` (`'ad'` / `'coins'`
  / `null` if declined), `scoreAtChoice`, `zone`, and — only on the declined
  case — `reviveWasOffered` (false if no revive was even possible, e.g. Daily
  Challenge mode, vs. true if they had the option and chose not to use it).

### The revive experiment (Group 1-4)
Each player is randomly self-assigned a group in the demographics survey.
Groups see different revive pricing on the "you died" screen:

| Group | Free-ad watch time | Coin cost |
|---|---|---|
| 1 | 20s | 10 coins |
| 2 | 20s | 40 coins |
| 3 | 5s | 10 coins |
| 4 | 5s | 40 coins |

To see which revive option people preferred under each pricing combination,
join `game_over` and `revive_choice` events by `sessionId` (or just filter
`revive_choice` events directly — they already carry `group` and
`reviveChoice`). The revive-price constants live near the top of the
`showGameOver` function in `crate-dash-3d.html` if you want to change them
(`REVIVE_GROUPS`).

Each player gets an anonymous ID stored in their browser (`localStorage`), so
you can see repeat plays from the same person without collecting anything
personally identifying.

## Moving online later
When you're ready to host this for real:
1. Deploy `server.js` + `crate-dash-3d.html` to any Node host (Render, Railway,
   Fly.io, a VPS, etc.) — the code doesn't change.
2. Swap the `data/events.jsonl` file storage for a real database (Postgres,
   SQLite, Firebase, etc.) — only the `POST /api/event` and `GET /api/events`
   handlers in `server.js` need to change; the game's `trackEvent()` calls
   don't need to know or care.


