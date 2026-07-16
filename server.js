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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '');

function readEvents() {
  const raw = fs.readFileSync(EVENTS_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const CHAR_LABELS = { dax: 'Dax', nova: 'Nova' };
const SKILL_LABELS = { dj: '🦅 Double Jump', smash: '🔨 Crate Smasher', slow: '⏳ Slow-Mo' };
const SKILL_KEYS = ['dj', 'smash', 'slow'];

function countBy(events, key) {
  const counts = {};
  for (const e of events) {
    const v = e[key] || 'unknown';
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function barRows(counts, labelMap, total) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="barrow"><span class="barlabel">No data yet</span></div>';
  return entries.map(([key, count]) => {
    const pct = total ? Math.round((count / total) * 100) : 0;
    const label = (labelMap && labelMap[key]) || key;
    return `
    <div class="barrow">
      <span class="barlabel">${escapeHtml(label)}</span>
      <div class="bartrack"><div class="barfill" style="width:${pct}%"></div></div>
      <span class="barcount">${count} (${pct}%)</span>
    </div>`;
  }).join('');
}

// Groups every event by sessionId (one row per run) so the dashboard
// can show, per run: who played, what they picked, and what they did.
function buildRunRows(events) {
  const bySession = new Map();
  for (const e of events) {
    const sid = e.sessionId || ('no-session-' + (e.playerId || 'unknown'));
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(e);
  }

  const rows = [];
  for (const [sid, evs] of bySession) {
    const start = evs.find(e => e.type === 'game_start');
    const over = evs.find(e => e.type === 'game_over');
    const gets = evs.filter(e => e.type === 'powerup_get');
    const uses = evs.filter(e => e.type === 'powerup_use');
    const first = evs[0];

    // Prefer the totals carried on game_over (present on runs recorded with
    // the newer client); fall back to counting individual pickup/use events
    // for older recordings that don't have them.
    const getCount = k => (over && over[k + 'Gets'] != null) ? over[k + 'Gets'] : gets.filter(e => e.skill === k).length;
    const useCount = k => (over && over[k + 'Uses'] != null) ? over[k + 'Uses'] : uses.filter(e => e.skill === k).length;
    const totalGets = SKILL_KEYS.reduce((a, k) => a + getCount(k), 0);
    const totalUses = SKILL_KEYS.reduce((a, k) => a + useCount(k), 0);

    rows.push({
      'Session ID': sid,
      'Player ID': (start || over || first || {}).playerId || '',
      'Started At': start ? new Date(start.ts || start._receivedAt).toLocaleString() : '',
      'Ended At': over ? new Date(over.ts || over._receivedAt).toLocaleString() : '',
      'Mode': (start || over || {}).mode || '',
      'Character': (start || over || {}).character || '',
      'Skin': (start || over || {}).skin || '',
      'Completed': over ? 'Yes' : 'No',
      'Score': over ? (over.score ?? '') : '',
      'Coins Earned': over ? (over.coinsEarned ?? '') : '',
      'Zone Reached': over ? (over.zone ?? '') : '',
      'Distance': over ? (over.distance ?? '') : '',
      'Survival Time (s)': over ? (over.survivalTime ?? '') : '',
      'Jumps': over ? (over.jumps ?? '') : '',
      'Moves': over ? (over.moves ?? '') : '',
      'Double Jump Picked Up': getCount('dj'),
      'Double Jump Used': useCount('dj'),
      'Crate Smasher Picked Up': getCount('smash'),
      'Crate Smasher Used': useCount('smash'),
      'Slow-Mo Picked Up': getCount('slow'),
      'Slow-Mo Used': useCount('slow'),
      'Total Skills Picked Up': totalGets,
      'Total Skills Used': totalUses,
      'Skill Use Rate': totalGets ? Math.round((totalUses / totalGets) * 100) + '%' : '0%',
      '_sortTs': (start || over || first || {}).ts || (start || over || first || {})._receivedAt || 0
    });
  }

  rows.sort((a, b) => a._sortTs - b._sortTs);
  rows.forEach(r => delete r._sortTs);
  return rows;
}

function buildDashboard(events) {
  const starts = events.filter(e => e.type === 'game_start');
  const overs = events.filter(e => e.type === 'game_over');
  const gets = events.filter(e => e.type === 'powerup_get');
  const uses = events.filter(e => e.type === 'powerup_use');
  const players = new Set(events.map(e => e.playerId).filter(Boolean));
  const scores = overs.map(e => e.score || 0);
  const totalRuns = overs.length;
  const avgScore = totalRuns ? (scores.reduce((a, b) => a + b, 0) / totalRuns).toFixed(1) : '0';
  const bestScore = scores.length ? Math.max(...scores) : 0;
  const totalCoins = overs.reduce((a, e) => a + (e.coinsEarned || 0), 0);
  const avgZone = totalRuns ? (overs.reduce((a, e) => a + (e.zone || 0), 0) / totalRuns).toFixed(1) : '0';
  const avgDistance = totalRuns ? Math.round(overs.reduce((a, e) => a + (e.distance || 0), 0) / totalRuns) : 0;
  const avgSurvival = totalRuns ? (overs.reduce((a, e) => a + (e.survivalTime || 0), 0) / totalRuns).toFixed(1) : '0';

  const modeCounts = countBy(overs, 'mode');
  const charCounts = countBy(starts, 'character');
  const skinCounts = countBy(starts, 'skin');

  const getCounts = countBy(gets, 'skill');
  const useCounts = countBy(uses, 'skill');
  const skillRows = SKILL_KEYS.map(k => {
    const g = getCounts[k] || 0, u = useCounts[k] || 0;
    const rate = g ? Math.round((u / g) * 100) : 0;
    return `<tr>
      <td>${SKILL_LABELS[k]}</td>
      <td>${g}</td>
      <td>${u}</td>
      <td>${rate}%</td>
    </tr>`;
  }).join('');

  const runRows = buildRunRows(events).filter(r => r['Completed'] === 'Yes').reverse().slice(0, 50);
  const recentRows = runRows.map(r => `
    <tr>
      <td>${escapeHtml(r['Ended At'])}</td>
      <td>${escapeHtml(r['Player ID'])}</td>
      <td>${escapeHtml(r['Mode'])}</td>
      <td>${escapeHtml(CHAR_LABELS[r['Character']] || r['Character'])}</td>
      <td>${escapeHtml(r['Skin'])}</td>
      <td>${r['Score']}</td>
      <td>${r['Coins Earned']}</td>
      <td>${r['Zone Reached']}</td>
      <td>${r['Distance']}</td>
      <td>${r['Survival Time (s)']}</td>
      <td>${r['Jumps']}</td>
      <td>${r['Moves']}</td>
      <td>${r['Double Jump Picked Up']} / ${r['Double Jump Used']}</td>
      <td>${r['Crate Smasher Picked Up']} / ${r['Crate Smasher Used']}</td>
      <td>${r['Slow-Mo Picked Up']} / ${r['Slow-Mo Used']}</td>
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
  .panels { display:flex; gap:32px; flex-wrap:wrap; }
  .panel { flex:1; min-width:280px; }
  .barrow { display:flex; align-items:center; gap:8px; margin:8px 0; }
  .barlabel { width:140px; flex-shrink:0; font-size:13px; color:#d7e6dc; }
  .bartrack { flex:1; background:#1a3324; border-radius:6px; height:14px; overflow:hidden; }
  .barfill { background:#6dff9c; height:100%; }
  .barcount { width:90px; flex-shrink:0; font-size:12px; color:#9fb4a6; text-align:right; }
</style></head>
<body>
  <h1>Crate Dash 3D — Play Data</h1>
  <p><a href="/">&larr; Back to game</a> &nbsp;|&nbsp; <a href="/api/events">Raw JSON</a></p>
  <div class="stats">
    <div class="card"><b>${players.size}</b>Players</div>
    <div class="card"><b>${totalRuns}</b>Runs completed</div>
    <div class="card"><b>${starts.length}</b>Runs started</div>
    <div class="card"><b>${avgScore}</b>Avg score</div>
    <div class="card"><b>${bestScore}</b>Best score</div>
    <div class="card"><b>${avgZone}</b>Avg zone reached</div>
    <div class="card"><b>${avgDistance}</b>Avg distance</div>
    <div class="card"><b>${avgSurvival}</b>Avg survival (s)</div>
    <div class="card"><b>${totalCoins}</b>Total coins earned</div>
  </div>

  <div class="panels">
    <div class="panel">
      <h2>Character usage (by runs started)</h2>
      ${barRows(charCounts, CHAR_LABELS, starts.length)}
    </div>
    <div class="panel">
      <h2>Game mode</h2>
      ${barRows(modeCounts, { endless: 'Endless', daily: 'Daily Challenge' }, overs.length)}
    </div>
    <div class="panel">
      <h2>Skin usage</h2>
      ${barRows(skinCounts, null, starts.length)}
    </div>
  </div>

  <h2>Special skills — pickups vs. uses</h2>
  <table>
    <tr><th>Skill</th><th>Total picked up</th><th>Total used</th><th>Use rate</th></tr>
    ${skillRows}
  </table>
  <p style="color:#7d947f; font-size:12px;">"Use rate" is how often a picked-up skill actually gets activated before the run ends — useful for spotting skills people collect but forget to use.</p>

  <h2>Most recent runs <span style="color:#7d947f; font-weight:normal; font-size:12px;">(skill columns show Picked up / Used)</span></h2>
  <table>
    <tr>
      <th>Time</th><th>Player</th><th>Mode</th><th>Character</th><th>Skin</th>
      <th>Score</th><th>Coins</th><th>Zone</th><th>Distance</th><th>Time (s)</th><th>Jumps</th><th>Moves</th>
      <th>🦅 Double Jump</th><th>🔨 Crate Smasher</th><th>⏳ Slow-Mo</th>
    </tr>
    ${recentRows || '<tr><td colspan="15">No runs yet — go play!</td></tr>'}
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
