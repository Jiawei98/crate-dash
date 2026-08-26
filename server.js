// Crate Dash 3D — local play-data collection server
// Run with:  node server.js
// Then open: http://localhost:3000
// Dashboard: http://localhost:3000/dashboard
//
// No npm install needed — uses only Node's built-in modules.
// Data is appended as JSON lines to data/events.jsonl, one line per event,
// and is also available as JSON at /api/events for building your own
// exports (Excel, spreadsheet, database, etc.) later.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const GAME_FILE = path.join(ROOT, 'crate-dash-3d.html');
// DATA_DIR can be overridden (e.g. DATA_DIR=/data) to point at a mounted
// persistent volume on hosts like Railway/Fly.io. Defaults to a local
// ./data folder for running on your own machine.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const RESET_FILE = path.join(DATA_DIR, 'reset-token.json');
// Set ADMIN_KEY (env var) to enable clearing data via the dashboard's
// "Clear all data" button or POST /api/clear. Left unset, clearing is
// disabled — a safer default once this is deployed publicly.
const ADMIN_KEY = process.env.ADMIN_KEY || '';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '');

function readEvents() {
  const raw = fs.readFileSync(EVENTS_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

// Every browser remembers a "reset token" alongside its own coins/save data
// and demographics answer. Whenever the dashboard clears data, this token
// changes — so the next time each player's browser loads the game, it
// notices the mismatch and wipes its own local coins/save/demographics too,
// putting everyone back to a clean first-time state.
function readResetToken() {
  try {
    return JSON.parse(fs.readFileSync(RESET_FILE, 'utf8')).token;
  } catch (e) {
    const token = String(Date.now());
    try { fs.writeFileSync(RESET_FILE, JSON.stringify({ token })); } catch (e2) {}
    return token;
  }
}
function bumpResetToken() {
  const token = String(Date.now());
  fs.writeFileSync(RESET_FILE, JSON.stringify({ token }));
  return token;
}

// Moves the current data to a timestamped backup file (never deletes
// outright) and starts a fresh, empty events file.
function clearEvents() {
  const events = readEvents();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `events-${stamp}.jsonl`);
  fs.copyFileSync(EVENTS_FILE, backupPath);
  fs.writeFileSync(EVENTS_FILE, '');
  const resetToken = bumpResetToken();
  return { clearedCount: events.length, backupFile: path.basename(backupPath), resetToken };
}

// Global game settings (sound/vibration/shadows/tilt) that override every
// player's local preference. A key is only present here when a researcher
// has explicitly forced it via the dashboard — otherwise the game just uses
// its normal built-in defaults.
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) { return {}; }
}
function writeSettings(obj) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2));
}

// Must match DEFAULT_SAVE.coins in crate-dash-3d.html (the balance every
// player starts the real phase with) and REVIVE_DEFAULTS in the dashboard's
// settings panel below (the built-in per-group coin cost, unless overridden
// via Game Settings).
const STARTING_COINS = 50;
const REVIVE_COST_DEFAULTS = { '1': 10, '2': 40, '3': 10, '4': 40 };
function getCoinCostForGroup(group) {
  const gid = String(group);
  const settings = readSettings();
  const override = settings.revive && settings.revive[gid] && settings.revive[gid].coinCost;
  return typeof override === 'number' ? override : (REVIVE_COST_DEFAULTS[gid] ?? REVIVE_COST_DEFAULTS['1']);
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const CHAR_LABELS = { dax: 'Dax', nova: 'Nova' };

// Groups every event by sessionId, then produces ONE ROW PER ATTEMPT (per
// game_over event) rather than one row per session — since players can no
// longer return to the menu to start a fresh session, a single session now
// naturally contains every attempt a person made: their first try, then one
// row per revive after that. Each row is paired with whatever revive
// decision immediately followed that particular death (if any).
function buildRunRows(events) {
  const bySession = new Map();
  for (const e of events) {
    const sid = e.sessionId || ('no-session-' + (e.playerId || 'unknown'));
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(e);
  }

  const rows = [];
  for (const [sid, evsRaw] of bySession) {
    const evs = evsRaw.slice().sort((a, b) => (a.ts || a._receivedAt || 0) - (b.ts || b._receivedAt || 0));
    const start = evs.find(e => e.type === 'game_start');
    const overs = evs.filter(e => e.type === 'game_over');
    const revives = evs.filter(e => e.type === 'revive_choice');

    overs.forEach((over, i) => {
      const overTs = over.ts || over._receivedAt || 0;
      const nextOverTs = overs[i + 1] ? (overs[i + 1].ts || overs[i + 1]._receivedAt || Infinity) : Infinity;
      // The revive decision (if any) made right after this specific death,
      // before the next one.
      const matchingRevive = revives.find(r => {
        const rTs = r.ts || r._receivedAt || 0;
        return rTs >= overTs && rTs < nextOverTs;
      });
      const reviveMethod = matchingRevive ? (matchingRevive.reviveChoice == null ? 'none' : matchingRevive.reviveChoice) : '';

      rows.push({
        'Session ID': sid,
        'Player ID': over.playerId || (start || {}).playerId || '',
        'Attempt #': i + 1,
        'Group': over.group ?? (matchingRevive || {}).group ?? '',
        'Phase': over.phase || '',
        'Ended At': new Date(overTs).toLocaleString(),
        'Character': over.character || (start || {}).character || '',
        'Skin': over.skin || (start || {}).skin || '',
        'Coins Earned': over.coinsEarned ?? '',
        'Zone Reached': over.zone ?? '',
        'Distance': over.distance ?? '',
        'Survival Time (s)': over.survivalTime ?? '',
        'Jumps': over.jumps ?? '',
        'Moves': over.moves ?? '',
        'Crate Smasher Picked Up': over.smashGets ?? 0,
        'Crate Smasher Used': over.smashUses ?? 0,
        'Revive Method': reviveMethod,
        'End Reason': over.endReason || 'died',
        '_sortTs': overTs
      });
    });
  }

  rows.sort((a, b) => a._sortTs - b._sortTs);
  rows.forEach(r => delete r._sortTs);
  return rows;
}

// One row per player, aggregating only their real-phase attempts (practice
// is deliberately excluded here — it's not part of the experiment result).
function buildPlayerSummaries(events) {
  const isReal = e => !e.phase || e.phase === 'real';
  const byPlayer = new Map();
  for (const e of events) {
    if (!e.playerId || !isReal(e)) continue;
    if (!byPlayer.has(e.playerId)) byPlayer.set(e.playerId, []);
    byPlayer.get(e.playerId).push(e);
  }

  const rows = [];
  for (const [playerId, evs] of byPlayer) {
    const overs = evs.filter(e => e.type === 'game_over');
    const revives = evs.filter(e => e.type === 'revive_choice');
    if (overs.length === 0) continue; // never actually finished a real attempt

    const group = overs.find(e => e.group != null)?.group
      ?? revives.find(e => e.group != null)?.group ?? '';
    const totalCoins = overs.reduce((a, e) => a + (e.coinsEarned || 0), 0);
    const avgCoins = (totalCoins / overs.length).toFixed(1);
    const totalDistance = Math.round(overs.reduce((a, e) => a + (e.distance || 0), 0));
    const totalJumps = overs.reduce((a, e) => a + (e.jumps || 0), 0);
    const totalMoves = overs.reduce((a, e) => a + (e.moves || 0), 0);
    const smashGets = overs.reduce((a, e) => a + (e.smashGets || 0), 0);
    const smashUses = overs.reduce((a, e) => a + (e.smashUses || 0), 0);
    const reviveCounts = { ad: 0, coins: 0, none: 0 };
    revives.forEach(r => {
      const c = r.reviveChoice == null ? 'none' : r.reviveChoice;
      if (reviveCounts[c] !== undefined) reviveCounts[c]++;
    });
    // Prefer the amount actually recorded at the moment of each coin-revive
    // (accurate even if pricing is changed later, e.g. between class
    // sessions). Only estimate from current settings for older events that
    // predate this field being tracked.
    const coinReviveEvents = revives.filter(r => r.reviveChoice === 'coins');
    const fallbackCoinCost = group !== '' ? getCoinCostForGroup(group) : REVIVE_COST_DEFAULTS['1'];
    const coinsSpent = coinReviveEvents.reduce(
      (a, r) => a + (typeof r.coinsCost === 'number' ? r.coinsCost : fallbackCoinCost), 0
    );
    const finalBalance = STARTING_COINS + totalCoins - coinsSpent;

    rows.push({
      'Player ID': playerId,
      'Group': group,
      'Attempts': overs.length,
      'Final Balance': finalBalance,
      'Total Coins': totalCoins,
      'Avg Coins/Attempt': avgCoins,
      'Total Distance': totalDistance,
      'Total Jumps': totalJumps,
      'Total Moves': totalMoves,
      'Smasher Picked Up': smashGets,
      'Smasher Used': smashUses,
      'Revive: Ad': reviveCounts.ad,
      'Revive: Coins': reviveCounts.coins,
      'Revive: None': reviveCounts.none
    });
  }
  rows.sort((a, b) => b['Total Coins'] - a['Total Coins']);
  return rows;
}

function buildDashboard(events) {
  // Events from before this feature existed have no `phase` field at all —
  // treat those as real (there was no practice concept back then). The top
  // summary cards only count the real, counted session so practice attempts
  // don't skew the numbers a researcher actually cares about; the full
  // history (both phases) is still visible in the attempts table below.
  const isReal = e => !e.phase || e.phase === 'real';
  const starts = events.filter(e => e.type === 'game_start' && isReal(e));
  const overs = events.filter(e => e.type === 'game_over' && isReal(e));
  const players = new Set(events.map(e => e.playerId).filter(Boolean));
  const coinsPerRun = overs.map(e => e.coinsEarned || 0);
  const totalRuns = overs.length; // used as the averages' denominator, not shown as its own card
  const avgCoins = totalRuns ? (coinsPerRun.reduce((a, b) => a + b, 0) / totalRuns).toFixed(1) : '0';
  const maxCoins = coinsPerRun.length ? Math.max(...coinsPerRun) : 0;
  const avgZone = totalRuns ? (overs.reduce((a, e) => a + (e.zone || 0), 0) / totalRuns).toFixed(1) : '0';
  const avgDistance = totalRuns ? Math.round(overs.reduce((a, e) => a + (e.distance || 0), 0) / totalRuns) : 0;

  const runRows = buildRunRows(events).reverse().slice(0, 50);
  const recentRows = runRows.map(r => `
    <tr>
      <td>${escapeHtml(r['Ended At'])}</td>
      <td>${escapeHtml(r['Player ID'])}</td>
      <td>${r['Attempt #']}</td>
      <td>${escapeHtml(String(r['Group'] ?? ''))}</td>
      <td>${escapeHtml(r['Phase'] || '')}</td>
      <td>${escapeHtml(CHAR_LABELS[r['Character']] || r['Character'])}</td>
      <td>${r['Coins Earned']}</td>
      <td>${r['Zone Reached']}</td>
      <td>${r['Distance']}</td>
      <td>${r['Survival Time (s)']}</td>
      <td>${r['Jumps']}</td>
      <td>${r['Moves']}</td>
      <td>${r['Crate Smasher Picked Up']} / ${r['Crate Smasher Used']}</td>
      <td>${escapeHtml(r['Revive Method'] || 'none')}</td>
      <td>${escapeHtml(r['End Reason'] || '')}</td>
    </tr>`).join('');

  const playerRows = buildPlayerSummaries(events);
  const playerSummaryRows = playerRows.map(r => `
    <tr>
      <td>${escapeHtml(r['Player ID'])}</td>
      <td>${escapeHtml(String(r['Group'] ?? ''))}</td>
      <td>${r['Attempts']}</td>
      <td>${r['Final Balance']}</td>
      <td>${r['Total Coins']}</td>
      <td>${r['Avg Coins/Attempt']}</td>
      <td>${r['Total Distance']}</td>
      <td>${r['Total Jumps']}</td>
      <td>${r['Total Moves']}</td>
      <td>${r['Smasher Picked Up']} / ${r['Smasher Used']}</td>
      <td>ad ${r['Revive: Ad']} · coins ${r['Revive: Coins']} · none ${r['Revive: None']}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Crate Dash — Play Data</title>
<style>
  body { font-family: system-ui, sans-serif; background:#0a1a12; color:#eaf5ee; margin:0; padding:24px; }
  h1 { color:#6dff9c; }
  h2 { color:#ffcf4d; margin-top:36px; font-size:18px; }
  .stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
  .card { background:#122a1c; border:1px solid #2c4436; border-radius:12px; padding:14px 20px; min-width:140px; }
  .card b { display:block; font-size:26px; color:#ffcf4d; }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  th, td { border-bottom:1px solid #2c4436; padding:6px 10px; text-align:left; }
  th { color:#9fb4a6; }
  a { color:#6dff9c; }
  .tabs { display:flex; gap:8px; margin:20px 0 4px; border-bottom:1px solid #2c4436; }
  .tabBtn { background:transparent; border:none; color:#9fb4a6; padding:10px 16px; font-size:14px; cursor:pointer; border-bottom:2px solid transparent; }
  .tabBtn.active { color:#6dff9c; border-bottom:2px solid #6dff9c; }
</style></head>
<body>
  <h1>Crate Dash 3D — Play Data</h1>
  <p><a href="/">&larr; Back to game</a> &nbsp;|&nbsp; <a href="/api/events">Raw JSON</a> &nbsp;|&nbsp; <a href="#" onclick="clearData(); return false;" style="color:#ff8080;">Clear all data</a> &nbsp;|&nbsp; <a href="#" onclick="openSettingsPanel(); return false;" style="color:#6dff9c;">⚙ Game settings (all players)</a></p>

  <div id="settingsOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100;align-items:center;justify-content:center;">
    <div style="background:#122a1c;border:1px solid #2c4436;border-radius:14px;padding:24px;width:320px;max-width:90vw;">
      <h3 style="margin:0 0 4px;color:#6dff9c;">Game Settings</h3>
      <p style="margin:0 0 16px;font-size:12px;color:#9fb4a6;">Forces this setting for every player's game, overriding their own device preference. "No override" leaves it up to each player (or its normal default).</p>
      <div id="settingsFields" style="display:flex;flex-direction:column;gap:12px;font-size:13px;"></div>
      <div style="margin:16px 0 8px;font-size:12px;color:#9fb4a6;border-top:1px solid #2c4436;padding-top:14px;">
        Revive pricing by group (used to randomly assign each player)
      </div>
      <div id="reviveFields" style="display:flex;flex-direction:column;gap:8px;font-size:12px;"></div>
      <input type="password" id="settingsAdminKey" placeholder="Admin key" autocomplete="off" style="width:100%;margin-top:16px;padding:8px;border-radius:8px;border:1px solid #2c4436;background:#0e2417;color:#eaf5ee;">
      <div id="settingsMsg" style="font-size:12px;color:#ff8080;margin-top:6px;display:none;"></div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button onclick="saveSettingsPanel()" style="flex:1;padding:9px;border-radius:8px;border:none;background:#6dff9c;color:#0a1a12;font-weight:700;cursor:pointer;">Save</button>
        <button onclick="closeSettingsPanel()" style="flex:1;padding:9px;border-radius:8px;border:1px solid #2c4436;background:transparent;color:#d7e6dc;cursor:pointer;">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    async function clearData() {
      const key = prompt('Enter admin key to clear all play data (a timestamped backup is kept on the server, but the dashboard will reset to empty):');
      if (key === null) return;
      if (!confirm('Really clear ALL play data? This cannot be undone from the dashboard.')) return;
      try {
        const res = await fetch('/api/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.ok) {
          alert('Cleared ' + data.clearedCount + ' events. Backup saved as ' + data.backupFile + '.');
          location.reload();
        } else {
          alert('Could not clear data: ' + data.error);
        }
      } catch (e) {
        alert('Request failed: ' + e.message);
      }
    }

    const SETTINGS_DEFS = [
      { key: 'sound', label: 'Sound', type: 'bool' },
      { key: 'haptics', label: 'Vibration', type: 'bool' },
      { key: 'shadows', label: 'Shadows (quality)', type: 'bool' },
      { key: 'tilt', label: 'Tilt steering', type: 'bool' },
      { key: 'practiceWindowMinutes', label: 'Practice window (minutes)', type: 'number' },
      { key: 'timeLimitMinutes', label: 'Real session time limit (minutes)', type: 'number' }
    ];
    const REVIVE_GROUP_IDS = ['1', '2', '3', '4'];
    const REVIVE_DEFAULTS = {
      '1': { adSeconds: 20, coinCost: 10 },
      '2': { adSeconds: 20, coinCost: 40 },
      '3': { adSeconds: 5, coinCost: 10 },
      '4': { adSeconds: 5, coinCost: 40 }
    };

    async function openSettingsPanel() {
      document.getElementById('settingsFields').innerHTML = SETTINGS_DEFS.map(d => {
        const control = d.type === 'number'
          ? '<input type="number" min="1" step="1" id="setf_' + d.key + '" placeholder="No limit" style="width:90px;padding:6px;border-radius:6px;border:1px solid #2c4436;background:#0e2417;color:#eaf5ee;">'
          : '<select id="setf_' + d.key + '" style="padding:6px;border-radius:6px;border:1px solid #2c4436;background:#0e2417;color:#eaf5ee;">' +
              '<option value="">No override</option>' +
              '<option value="true">Force On</option>' +
              '<option value="false">Force Off</option>' +
            '</select>';
        return '<label style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><span>' + d.label + '</span>' + control + '</label>';
      }).join('');
      document.getElementById('reviveFields').innerHTML =
        '<div style="display:flex;gap:8px;color:#7d947f;"><span style="width:56px;flex-shrink:0;"></span><span style="width:78px;">Ad seconds</span><span style="width:78px;">Coin cost</span></div>' +
        REVIVE_GROUP_IDS.map(gid =>
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="width:56px;flex-shrink:0;">Group ' + gid + '</span>' +
            '<input type="number" min="0" step="1" id="rev_ad_' + gid + '" style="width:70px;padding:6px;border-radius:6px;border:1px solid #2c4436;background:#0e2417;color:#eaf5ee;">' +
            '<input type="number" min="0" step="1" id="rev_coin_' + gid + '" style="width:70px;padding:6px;border-radius:6px;border:1px solid #2c4436;background:#0e2417;color:#eaf5ee;">' +
          '</div>'
        ).join('');
      document.getElementById('settingsMsg').style.display = 'none';
      document.getElementById('settingsOverlay').style.display = 'flex';
      try {
        const res = await fetch('/api/settings');
        const current = await res.json();
        SETTINGS_DEFS.forEach(d => {
          if (d.type === 'number') {
            if (typeof current[d.key] === 'number') document.getElementById('setf_' + d.key).value = current[d.key];
          } else if (typeof current[d.key] === 'boolean') {
            document.getElementById('setf_' + d.key).value = String(current[d.key]);
          }
        });
        REVIVE_GROUP_IDS.forEach(gid => {
          const cfg = (current.revive && current.revive[gid]) || REVIVE_DEFAULTS[gid];
          document.getElementById('rev_ad_' + gid).value = cfg.adSeconds;
          document.getElementById('rev_coin_' + gid).value = cfg.coinCost;
        });
      } catch (e) {}
    }

    function closeSettingsPanel() {
      document.getElementById('settingsOverlay').style.display = 'none';
    }

    async function saveSettingsPanel() {
      const key = document.getElementById('settingsAdminKey').value;
      const msg = document.getElementById('settingsMsg');
      const settings = {};
      SETTINGS_DEFS.forEach(d => {
        const v = document.getElementById('setf_' + d.key).value;
        if (d.type === 'number') {
          settings[d.key] = v === '' ? null : Number(v);
        } else {
          settings[d.key] = v === '' ? null : v === 'true';
        }
      });
      const revive = {};
      REVIVE_GROUP_IDS.forEach(gid => {
        const adVal = document.getElementById('rev_ad_' + gid).value;
        const coinVal = document.getElementById('rev_coin_' + gid).value;
        revive[gid] = {
          adSeconds: adVal === '' ? REVIVE_DEFAULTS[gid].adSeconds : Number(adVal),
          coinCost: coinVal === '' ? REVIVE_DEFAULTS[gid].coinCost : Number(coinVal)
        };
      });
      settings.revive = revive;
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, settings })
        });
        const data = await res.json();
        if (data.ok) {
          closeSettingsPanel();
          alert('Saved. Every player will pick these up the next time they load the game.');
        } else {
          msg.textContent = data.error;
          msg.style.display = 'block';
        }
      } catch (e) {
        msg.textContent = 'Request failed: ' + e.message;
        msg.style.display = 'block';
      }
    }
  </script>

  <div class="tabs">
    <button class="tabBtn active" id="tabBtnAttempt" onclick="showTab('attempt')">By attempt</button>
    <button class="tabBtn" id="tabBtnPlayer" onclick="showTab('player')">By player</button>
  </div>
  <script>
    function showTab(name) {
      document.getElementById('tabAttempt').style.display = name === 'attempt' ? 'block' : 'none';
      document.getElementById('tabPlayer').style.display = name === 'player' ? 'block' : 'none';
      document.getElementById('tabBtnAttempt').classList.toggle('active', name === 'attempt');
      document.getElementById('tabBtnPlayer').classList.toggle('active', name === 'player');
    }
  </script>

  <div id="tabAttempt">
    <div class="stats">
      <div class="card"><b>${players.size}</b>Players</div>
      <div class="card"><b>${starts.length}</b>Runs started</div>
      <div class="card"><b>${avgCoins}</b>Avg coin</div>
      <div class="card"><b>${maxCoins}</b>Max coin</div>
      <div class="card"><b>${avgZone}</b>Avg zone reached</div>
      <div class="card"><b>${avgDistance}</b>Avg distance</div>
    </div>

    <h2>Most recent runs <span style="color:#7d947f; font-weight:normal; font-size:12px;">(one row per attempt, practice and real both shown — the summary cards above count real attempts only)</span> &nbsp;<a href="/api/export/attempts.csv" style="font-size:12px;">⬇ Export CSV (all rows)</a></h2>
    <table>
      <tr>
        <th>Time</th><th>Player</th><th>Attempt #</th><th>Group</th><th>Phase</th><th>Character</th>
        <th>Coins</th><th>Zone</th><th>Distance</th><th>Time (s)</th><th>Jumps</th><th>Moves</th>
        <th>🔨 Crate Smasher (picked up / used)</th><th>Revive Method</th><th>End Reason</th>
      </tr>
      ${recentRows || '<tr><td colspan="15">No runs yet — go play!</td></tr>'}
    </table>
  </div>

  <div id="tabPlayer" style="display:none;">
    <h2>By player <span style="color:#7d947f; font-weight:normal; font-size:12px;">(real-phase attempts only — practice is excluded from every column here)</span> &nbsp;<a href="/api/export/players.csv" style="font-size:12px;">⬇ Export CSV</a></h2>
    <table>
      <tr>
        <th>Player</th><th>Group</th><th>Real Attempts</th><th>Final Balance</th><th>Total Coins Earned</th><th>Avg Coins/Attempt</th>
        <th>Total Distance</th><th>Total Jumps</th><th>Total Moves</th>
        <th>🔨 Crate Smasher (picked up / used)</th><th>Revive Method breakdown</th>
      </tr>
      ${playerSummaryRows || '<tr><td colspan="11">No real-phase attempts yet.</td></tr>'}
    </table>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Turns an array of same-shaped objects into a CSV string (using the first
// row's keys as the header). Quotes any value containing a comma, quote, or
// newline, doubling internal quotes per the CSV spec.
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const cell = v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(headers.map(h => cell(row[h])).join(','));
  return lines.join('\r\n');
}
function sendCSV(res, filename, csv) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(csv)
  });
  res.end(csv);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/event') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        event._receivedAt = Date.now();
        event._ip = req.socket.remoteAddress;
        fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
        sendJSON(res, 200, { ok: true });
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: 'invalid json' });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    return sendJSON(res, 200, readEvents());
  }

  // CSV downloads of both dashboard tables — the full dataset, not just the
  // most recent 50 rows shown on screen.
  if (req.method === 'GET' && url.pathname === '/api/export/attempts.csv') {
    const rows = buildRunRows(readEvents());
    return sendCSV(res, 'crate-dash-attempts.csv', toCSV(rows));
  }
  if (req.method === 'GET' && url.pathname === '/api/export/players.csv') {
    const rows = buildPlayerSummaries(readEvents());
    return sendCSV(res, 'crate-dash-players.csv', toCSV(rows));
  }

  // Public: every player's game checks this on load to know whether the
  // researcher has cleared data since this browser last visited.
  if (req.method === 'GET' && url.pathname === '/api/reset-token') {
    return sendJSON(res, 200, { token: readResetToken() });
  }

  // Lightweight check only — no side effects. Used by the game's own
  // "Restart (admin only)" link on the "experiment ended" screen, so a
  // teacher can reset just one device's local progress without touching
  // the dashboard or anyone else's data.
  if (req.method === 'POST' && url.pathname === '/api/verify-admin-key') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      if (!ADMIN_KEY) {
        return sendJSON(res, 403, { ok: false, error: 'Restart is disabled. Set the ADMIN_KEY environment variable to enable it.' });
      }
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (e) {
        return sendJSON(res, 400, { ok: false, error: 'invalid json' });
      }
      sendJSON(res, 200, { ok: parsed.key === ADMIN_KEY });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/clear') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      if (!ADMIN_KEY) {
        return sendJSON(res, 403, { ok: false, error: 'Clearing is disabled. Set the ADMIN_KEY environment variable to enable it.' });
      }
      let key = url.searchParams.get('key') || req.headers['x-admin-key'] || '';
      if (!key) { try { key = JSON.parse(body || '{}').key || ''; } catch (e) {} }
      if (key !== ADMIN_KEY) {
        return sendJSON(res, 401, { ok: false, error: 'Wrong or missing admin key.' });
      }
      try {
        const result = clearEvents();
        sendJSON(res, 200, { ok: true, ...result });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  // Public: every player's game fetches this on load to pick up any
  // researcher-forced overrides (sound/vibration/shadows/tilt).
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return sendJSON(res, 200, readSettings());
  }

  // Admin-key protected: the dashboard's "Game Settings" panel uses this to
  // save overrides. Sending a key with value null/'' clears that override.
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      if (!ADMIN_KEY) {
        return sendJSON(res, 403, { ok: false, error: 'Settings control is disabled. Set the ADMIN_KEY environment variable to enable it.' });
      }
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch (e) {
        return sendJSON(res, 400, { ok: false, error: 'invalid json' });
      }
      const key = parsed.key || url.searchParams.get('key') || req.headers['x-admin-key'] || '';
      if (key !== ADMIN_KEY) {
        return sendJSON(res, 401, { ok: false, error: 'Wrong or missing admin key.' });
      }
      try {
        const current = readSettings();
        const updated = { ...current, ...(parsed.settings || {}) };
        for (const k of Object.keys(updated)) {
          if (updated[k] === null || updated[k] === '') delete updated[k];
        }
        writeSettings(updated);
        sendJSON(res, 200, { ok: true, settings: updated });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/dashboard') {
    const html = buildDashboard(readEvents());
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(GAME_FILE, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Game file not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crate Dash server running:`);
  console.log(`  Game:      http://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  Raw data:  http://localhost:${PORT}/api/events`);
  console.log(`  Storage:   ${EVENTS_FILE}`);
});
