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

## What gets tracked
- `game_start`: mode, character, skin, run number, player id
- `game_over`: score, coins earned, zone reached, distance traveled, survival
  time, jump count, left/right move count, character, skin, and per-run
  totals for how many times each of the three skills (Double Jump, Crate
  Smasher, Slow-Mo) was picked up and used
- `powerup_get` / `powerup_use`: an individual log entry each time a skill is
  picked up or activated, for a moment-by-moment record on top of the run
  totals

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


