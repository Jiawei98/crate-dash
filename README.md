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

## Clearing data
Useful if you want a clean slate before a new class/session.

**1. Enable it** (off by default, for safety):
- Locally: run with `ADMIN_KEY=yourpassword node server.js` instead of the
  plain `node server.js`.
- On Railway: go to your service → **Variables** → add `ADMIN_KEY` = a
  password only you know → redeploy.

**2. Use it:** on `/dashboard`, click **"Clear all data"** (bottom-left link),
enter the key when prompted, confirm. The live data resets to empty — but a
full backup is saved first to `data/backups/` (never deleted automatically),
so nothing is ever actually lost.

**This also resets every player, not just the server's records.** Coins, the
demographics answer, the assigned experiment group, and the practice/real
clock are all stored in each player's own browser (`localStorage`), so
clearing data on the server alone wouldn't normally touch them. To handle
that, the game checks a small "reset token" from the server every time it
loads; clearing data changes that token, so the next time each player opens
the link, their browser notices and wipes all of that — showing the survey
again and drawing a fresh random group, like a brand new visitor. No redeploy
or action needed on their end.

## Controlling settings for everyone (Dashboard → "Game settings")
There's no more in-game Settings menu — sound, vibration, shadow quality,
tilt steering, the practice window length, the real session time limit, and
each group's revive pricing are all controlled centrally from the dashboard
instead, so every player gets the same, consistent experience.

Uses the same `ADMIN_KEY` as clearing data (see above — set it first). Then
on `/dashboard`, click **"⚙ Game settings (all players)"**:
- Sound / Vibration / Shadows / Tilt: Force On / Force Off / No override
  (falls back to the game's normal default).
- **Practice window (minutes)**: how long the practice phase lasts before
  automatically moving into the real session. Leave blank to skip practice
  entirely — players go straight into the real, counted session.
- **Real session time limit (minutes)**: how long the real phase lasts once
  it starts. Leave blank for no limit.
- **Revive pricing by group**: the ad-watch seconds and coin cost for each
  of the 4 experiment groups.

Save, and every player's game picks up the new values automatically the next
time they load the page — nothing needs to be redeployed.

## What gets tracked
- `demographics`: a one-time survey shown before a player's first run — age,
  gender, nationality, academic major, gaming experience, hours of gaming per
  week, and device (phone/laptop/tablet). Stored once per browser
  (`localStorage`), so returning players aren't asked again.
- `game_start`: mode, character, skin, player id, and `phase`. Fired once at
  the very start (phase `'practice'`, or `'real'` directly if no practice
  window is configured), and fired again when a player moves from practice
  into the real session (phase `'real'`) — so there are at most two per
  player. There's no way back to the main menu once someone clicks Play, so
  it can't happen more than that.
- `game_over`: fired on **every death**, including ones a player then revives
  from — not just their final death. Carries score, coins earned, zone
  reached, distance traveled, survival time, jump/move counts, character,
  skin, **group**, **phase**, that attempt's Crate Smasher pickups/uses, and
  `endReason`: `'died'` (a real collision), `'time_out'` (the practice window
  or the real time limit ran out mid-attempt), or `'left_page'` (they closed
  the tab or locked the screen instead of actually dying).
- `powerup_get` / `powerup_use`: an individual log entry each time the Crate
  Smasher (the only power-up in the game) is picked up or activated. Carries
  `phase` too.
- `revive_choice`: fired right after each `game_over`, once the player acts —
  whether they revived with a free ad, revived by spending coins, or the
  attempt ended without a revive (declined, or time ran out). Fields:
  `group`, `phase`, `reviveChoice` (`'ad'` / `'coins'` / `null`),
  `scoreAtChoice`, `zone`, and — only when `reviveChoice` is `null` —
  `reviveWasOffered` (whether a revive was actually available at that point).

**Each row in the dashboard's "Most recent runs" table is one attempt** (one
life), not one player — a player's first try is row 1, and every revive after
that adds another row with the same `sessionId` but a higher "Attempt #",
continuing across both the practice and real phases. This is possible because
each player only ever plays once (no menu to restart from), so every attempt
anyone makes is naturally part of their one continuous session. The summary
cards at the top of the dashboard only count **real**-phase attempts, so
practice play doesn't skew the numbers — but the attempts table itself shows
both phases (with a Phase column) so you can still spot-check practice
behavior if you want to.

### Practice → real
Every player goes through the configured practice window first — playing
normally, revives and all, at the same per-group pricing as the real session
— then automatically gets prompted to start the real, counted session once
that window elapses (a "🏁 Start the real challenge" button replaces the
revive options on their next "you died" screen). Starting the real session
resets their coin balance to the default starting amount and resets their
personal best, so the group's coin-cost manipulation means the same thing
for everyone regardless of how practice went. Their assigned group carries
over unchanged.

### The revive experiment (Group 1-4)
Each player is assigned to a group the moment their anonymous player ID is
first created — a pure random draw (`Math.random()`, 25% each), completely
independent of anything they fill in on the survey. The assignment is drawn
once and reused for both the practice window and the real session. Default
pricing (editable from the dashboard, see above):

| Group | Free-ad watch time | Coin cost |
|---|---|---|
| 1 | 20s | 10 coins |
| 2 | 20s | 40 coins |
| 3 | 5s | 10 coins |
| 4 | 5s | 40 coins |

To see which revive option people preferred under each pricing combination,
join `game_over` and `revive_choice` events by `sessionId` (or just filter
`revive_choice` events directly — they already carry `group` and
`reviveChoice`).

### Time limits
Both the practice window and the real session time limit are set from the
dashboard's "⚙ Game settings" panel (see above) — enter minutes, or leave
blank to skip that limit entirely. Each clock starts the moment its phase
begins and counts down continuously (through ad-watching and revive
decisions too) — a countdown shows during gameplay and on the "you died"
screen. Once a limit runs out, that phase ends (practice moves the player
into a "start the real challenge" prompt; the real limit running out ends the
session for good). Clearing data from the dashboard also resets everyone's
clock along with their coins, demographics answer, and group.

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
3. After deploying, using Ctrl+Alt+R (Control+Option+R on Mac) should now correctly bring up the password prompt.


