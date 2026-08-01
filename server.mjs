import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();

const port = Number(process.env.PORT || 8787);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const allowedRuleIds = new Set(['bond', 'archive', 'sight', 'ripple']);
const WORLD_LIMIT = 38;
const PLAYER_COLORS = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
const SPAWNS = [[0, -10], [-3, -6], [9, -4], [-9, 4]];
const ARTIFACT_SPAWNS = [[4, -7], [-4, -3], [5, 3], [-13, 9], [12, 11], [-17, -12], [19, -3], [-5, 18], [3, -20], [20, 18], [-20, 17], [14, -18]];
const rooms = new Map();

const RULE_LIBRARY = {
  bond: { id: 'bond', title: 'Unwanted Bond', body: 'Stay close to your bonded partner. If either of you strays too far, both of you continuously lose life.', duration: 70, counterplay: 'Stay within the pink tether range.' },
  archive: { id: 'archive', title: 'The Archive Demands Witnesses', body: 'You gathered too much alone. Keep another player near your archive, or its weight continuously drains your life.', duration: 65, counterplay: 'Bring a teammate within range of the collector.' },
  sight: { id: 'sight', title: 'Private Vision', body: 'The city shows you a hidden layer, but it needs solitude. Let someone get too close and your life continuously drains.', duration: 60, counterplay: 'The Seer must explore alone while guiding the group.' },
  ripple: { id: 'ripple', title: 'Restless Physics', body: 'Momentum has chosen you. Keep moving, or standing still continuously drains your life.', duration: 50, counterplay: 'The Runner must keep moving.' },
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function clampText(value, fallback, max = 220) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[<>]/g, '').trim().slice(0, max) || fallback;
}

function parseModelContent(content) {
  if (typeof content !== 'string') return {};
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const object = (fenced ? fenced[1] : content).match(/\{[\s\S]*\}/);
  try { return JSON.parse(object ? object[0] : content); } catch { return {}; }
}

function validateDecision(candidates, response) {
  const candidateIds = candidates.map((candidate) => candidate.id);
  const modelRuleIsAllowed = candidateIds.includes(response?.ruleId) && allowedRuleIds.has(response.ruleId);
  const ruleId = modelRuleIsAllowed ? response.ruleId : candidateIds[0];
  const selected = candidates.find((candidate) => candidate.id === ruleId) || {};
  return {
    ruleId,
    title: clampText(modelRuleIsAllowed ? response?.title : selected.title, 'The city responds.', 56),
    body: clampText(modelRuleIsAllowed ? response?.body : selected.body, 'A new survival rule is taking hold.'),
    reason: clampText(modelRuleIsAllowed ? response?.reason : selected.observedPattern, 'The Game Master recognised a group pattern.', 160),
    source: modelRuleIsAllowed ? 'model' : 'fallback',
  };
}

async function chooseRule(telemetry, candidates) {
  const allowedCandidates = candidates.filter((candidate) => allowedRuleIds.has(candidate.id));
  if (!allowedCandidates.length) return { ruleId: null, source: 'waiting' };
  const fallback = validateDecision(allowedCandidates, {});
  if (!process.env.GM_API_URL || !process.env.GM_API_KEY || !process.env.GM_MODEL) return fallback;

  const prompt = [
    'You are the Game Master for Emergent, a social survival game.',
    'Choose exactly one rule from the supplied candidates. You may only select an allowed id.',
    'Every rule is pre-implemented and balanced by the server. Do not invent mechanics, objectives, damage, or exceptions.',
    'Write direct, intriguing survival copy: players must understand what action prevents life loss, but need not know what behaviour triggered the rule.',
    'Return strict JSON only: {"ruleId":"...","title":"...","body":"...","reason":"..."}.',
    `Observed room telemetry: ${JSON.stringify(telemetry)}`,
    `Allowed candidates: ${JSON.stringify(allowedCandidates.map(({ id, title, body, counterplay, observedPattern }) => ({ id, title, body, counterplay, observedPattern })))}.`,
  ].join('\n');

  try {
    const response = await fetch(process.env.GM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GM_API_KEY}` },
      body: JSON.stringify({ model: process.env.GM_MODEL, temperature: 0.55, max_tokens: 220, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 700);
      throw new Error(`Model returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    return validateDecision(allowedCandidates, parseModelContent(data?.choices?.[0]?.message?.content));
  } catch (error) {
    console.warn(`Game Master model unavailable: ${error.message}`);
    return fallback;
  }
}

function createRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    players: new Map(),
    artifacts: ARTIFACT_SPAWNS.map(([x, z], index) => ({ index, x, z, collectedBy: null })),
    pairSeconds: new Map(),
    activeRule: null,
    lastDecisionAt: 0,
    deciding: false,
    director: { source: 'watching', reason: 'The city is watching how this group survives.', telemetry: {} },
  };
}

function makePlayer(id, name, index) {
  const [x, z] = SPAWNS[index] || [0, 0];
  return { id, name: name.slice(0, 16), color: PLAYER_COLORS[index], x, z, inputX: 0, inputZ: 0, health: 100, dead: false, stillSeconds: 0, movement: 0, proximity: 0, isolation: 0, sharedMomentum: 0, visited: new Set(), artifactCount: 0 };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function livePlayers(room) { return [...room.players.values()].filter((player) => !player.dead); }
function pairKey(a, b) { return [a.id, b.id].sort().join(':'); }

function getRoomTelemetry(room) {
  const players = livePlayers(room);
  const seconds = Math.max(1, (Date.now() - room.createdAt) / 1000);
  return {
    playersObserved: players.length,
    averageCohesion: Number((players.reduce((total, player) => total + player.proximity / seconds, 0) / Math.max(players.length, 1)).toFixed(2)),
    totalArtifactsCollected: room.artifacts.filter((artifact) => artifact.collectedBy).length,
    explorers: players.filter((player) => player.visited.size >= 4).length,
    isolatedPlayers: players.filter((player) => player.isolation > 5).length,
    activeRule: room.activeRule?.id || null,
  };
}

function getCandidates(room) {
  const players = livePlayers(room);
  const candidates = [];
  const strongestPair = [...room.pairSeconds.entries()].sort((a, b) => b[1] - a[1])[0];
  if (strongestPair?.[1] >= 5) {
    const ids = strongestPair[0].split(':');
    const pair = ids.map((id) => room.players.get(id)).filter(Boolean);
    if (pair.length === 2) candidates.push({ ...RULE_LIBRARY.bond, participants: ids, observedPattern: `${pair[0].name} and ${pair[1].name} repeatedly stayed together.` });
  }
  const collector = players.find((player) => player.artifactCount >= 2);
  if (collector) candidates.push({ ...RULE_LIBRARY.archive, participants: [collector.id], observedPattern: `${collector.name} repeatedly gathered objects alone.` });
  const explorer = players.sort((a, b) => b.isolation - a.isolation || b.visited.size - a.visited.size)[0];
  if (explorer && (explorer.isolation >= 6 || explorer.visited.size >= 5)) candidates.push({ ...RULE_LIBRARY.sight, participants: [explorer.id], observedPattern: `${explorer.name} separated from the group to explore.` });
  const runner = players.sort((a, b) => b.movement - a.movement)[0];
  if (runner && runner.movement >= 28 && runner.sharedMomentum >= 3) candidates.push({ ...RULE_LIBRARY.ripple, participants: [runner.id], observedPattern: `${runner.name} repeatedly moved with urgency near the group.` });
  return candidates;
}

function ruleViolation(room, player) {
  const rule = room.activeRule;
  if (!rule || !rule.participants.includes(player.id)) return false;
  const companions = livePlayers(room).filter((other) => other.id !== player.id);
  const nearest = companions.reduce((best, other) => Math.min(best, distance(player, other)), Infinity);
  if (rule.id === 'bond') {
    const partner = room.players.get(rule.participants.find((id) => id !== player.id));
    return !partner || partner.dead || distance(player, partner) > 14;
  }
  if (rule.id === 'archive') return nearest > 9;
  if (rule.id === 'sight') return nearest < 7;
  if (rule.id === 'ripple') return player.stillSeconds > 2.5;
  return false;
}

function serializeRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(({ id, name, color, x, z, health, dead, artifactCount }) => ({ id, name, color, x, z, health: Math.round(health), dead, artifactCount })),
    artifacts: room.artifacts,
    activeRule: room.activeRule && { id: room.activeRule.id, title: room.activeRule.title, body: room.activeRule.body, counterplay: room.activeRule.counterplay, participants: room.activeRule.participants, endsAt: room.activeRule.endsAt },
    director: room.director,
  };
}

async function decideForRoom(room) {
  if (room.deciding || room.activeRule || Date.now() - room.lastDecisionAt < 12_000) return;
  if (livePlayers(room).length < 2) {
    room.director = { source: 'watching', reason: 'The city is waiting for at least two players before it writes a survival rule.', telemetry: getRoomTelemetry(room) };
    return;
  }
  const candidates = getCandidates(room);
  if (!candidates.length) { room.director = { source: 'watching', reason: 'The city is waiting for a distinct survival pattern.', telemetry: getRoomTelemetry(room) }; return; }
  room.deciding = true;
  room.lastDecisionAt = Date.now();
  const telemetry = getRoomTelemetry(room);
  const decision = await chooseRule(telemetry, candidates);
  const selected = candidates.find((candidate) => candidate.id === decision.ruleId);
  if (selected && !room.activeRule) {
    room.activeRule = { ...selected, ...decision, endsAt: Date.now() + selected.duration * 1000 };
    room.director = { source: decision.source === 'model' ? 'configured AI model' : 'local Game Master fallback', reason: decision.reason, telemetry };
    io.to(room.code).emit('gm-rule', room.activeRule);
  }
  room.deciding = false;
}

function updateRoom(room, delta) {
  const players = livePlayers(room);
  for (const player of players) {
    const length = Math.hypot(player.inputX, player.inputZ);
    if (length > 0) {
      const speed = 8 * delta;
      player.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.x + (player.inputX / length) * speed));
      player.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.z + (player.inputZ / length) * speed));
      player.movement += speed;
      player.stillSeconds = 0;
    } else player.stillSeconds += delta;
    player.visited.add(`${Math.floor((player.x + WORLD_LIMIT) / 9)}:${Math.floor((player.z + WORLD_LIMIT) / 9)}`);
    const others = players.filter((other) => other.id !== player.id);
    if (others.length) {
      const nearest = others.reduce((best, other) => Math.min(best, distance(player, other)), Infinity);
      if (nearest < 8) player.proximity += delta;
      if (nearest > 17) player.isolation += delta;
      if (nearest < 6 && length > 0) player.sharedMomentum += delta;
    }
  }

  for (let index = 0; index < players.length; index++) {
    for (let otherIndex = index + 1; otherIndex < players.length; otherIndex++) {
      const a = players[index]; const b = players[otherIndex]; const key = pairKey(a, b);
      const current = room.pairSeconds.get(key) || 0;
      room.pairSeconds.set(key, distance(a, b) < 8 ? current + delta : Math.max(0, current - delta * 0.5));
    }
  }

  for (const artifact of room.artifacts) {
    if (artifact.collectedBy) continue;
    const collector = players.find((player) => distance(player, artifact) < 1.5);
    if (collector) { artifact.collectedBy = collector.id; collector.artifactCount += 1; io.to(room.code).emit('feed', `${collector.name} gathered an artifact.`); }
  }

  if (room.activeRule && Date.now() >= room.activeRule.endsAt) {
    io.to(room.code).emit('feed', 'The city releases its rule and starts watching again.');
    room.activeRule = null;
  }
  for (const player of players) {
    if (ruleViolation(room, player)) player.health = Math.max(0, player.health - delta * 8);
    else if (room.activeRule?.participants.includes(player.id)) player.health = Math.min(100, player.health + delta * 1.5);
    if (player.health <= 0 && !player.dead) { player.dead = true; player.inputX = 0; player.inputZ = 0; io.to(room.code).emit('player-died', { id: player.id, name: player.name }); }
  }
  void decideForRoom(room);
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/game-master') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 20_000) request.destroy(); });
    request.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        sendJson(response, 200, await chooseRule(payload.telemetry || {}, Array.isArray(payload.candidates) ? payload.candidates : []));
      } catch { sendJson(response, 400, { error: 'Invalid Game Master request.' }); }
    });
    return;
  }
  const urlPath = request.url === '/' ? '/index.html' : request.url?.split('?')[0] || '/index.html';
  const filePath = normalize(join('dist', urlPath));
  if (!filePath.startsWith(normalize('dist')) || !existsSync(filePath)) { response.writeHead(404); response.end('Build the app first with npm run build.'); return; }
  try { response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' }); response.end(await readFile(filePath)); }
  catch { response.writeHead(500); response.end('Unable to read application file.'); }
});

const io = new Server(server, { cors: { origin: true } });
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomCode, name }, callback = () => {}) => {
    const code = String(roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const cleanName = String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16);
    if (code.length < 4 || !cleanName) return callback({ ok: false, error: 'Enter a 4–6 character room code and a name.' });
    const room = rooms.get(code) || createRoom(code);
    if (!rooms.has(code)) rooms.set(code, room);
    if (room.players.size >= 4) return callback({ ok: false, error: 'This room already has four players.' });
    socket.join(code); socket.data.roomCode = code;
    room.players.set(socket.id, makePlayer(socket.id, cleanName, room.players.size));
    callback({ ok: true, code, playerId: socket.id });
    io.to(code).emit('feed', `${cleanName} entered the city.`);
    io.to(code).emit('world-state', serializeRoom(room));
  });
  socket.on('move', ({ x, z }) => {
    const room = rooms.get(socket.data.roomCode); const player = room?.players.get(socket.id);
    if (!player || player.dead) return;
    player.inputX = Math.max(-1, Math.min(1, Number(x) || 0));
    player.inputZ = Math.max(-1, Math.min(1, Number(z) || 0));
  });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.get(socket.id); room.players.delete(socket.id);
    if (player) io.to(room.code).emit('feed', `${player.name} left the city.`);
    if (!room.players.size) rooms.delete(room.code); else io.to(room.code).emit('world-state', serializeRoom(room));
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(); const delta = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  for (const room of rooms.values()) { updateRoom(room, delta); io.to(room.code).emit('world-state', serializeRoom(room)); }
}, 50);

const lanAddress = Object.values(networkInterfaces()).flat().find((network) => network && network.family === 'IPv4' && !network.internal)?.address;
server.listen(port, '0.0.0.0', () => {
  console.log(`Emergent running at http://127.0.0.1:${port}`);
  if (lanAddress) console.log(`Friends on the same Wi-Fi can join at http://${lanAddress}:${port}`);
});
