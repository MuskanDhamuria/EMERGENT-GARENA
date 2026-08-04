import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';

/*
 * The game client is deliberately dumb: it renders this state and reports what a
 * player did.  This file is the authority for identity, rules, unlocks and the
 * finale.  An AI Game Master (through emergent-mcp.mjs) may only make the
 * validated changes exposed by /api/mcp below.
 */
const PORT = Number(process.env.PORT || 8787);
const OBSERVATION_MS = 30_000;
// Server coordinates map to the authored 60 x 34 CSD map via x + 30, z + 17.
// The bounds are the map edge, matching the client exactly.
const WORLD_MIN_X = -29, WORLD_MAX_X = 28;
const WORLD_MIN_Z = -16, WORLD_MAX_Z = 15;
const MAX_PLAYERS = 4;
const COLORS = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
// These compact coordinates map to the clear ground beside the CSD camp.
const SPAWNS = [[-6, 0], [-4, 0], [-5, 2], [-3, 2]];
const rooms = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

const LOCATIONS = [
  'starting-village', 'whispering-forest', 'crystal-cave', 'lake-of-echoes',
  'forgotten-ruins', 'sacred-shrine', 'mountain-pass', 'abandoned-camp',
  'small-graveyard', 'secret-grove', 'hidden-cave', 'ancient-temple',
];
const FEATURES = new Set([
  'hidden-cave', 'secret-path', 'invisible-bridge', 'forgotten-ruins',
  'relic-vault', 'evolving-artifacts', 'treasure-cache', 'healing-shrine',
  'protective-barrier', 'revival-monument', 'spirit-realm', 'illusion-passage',
  'hidden-portal', 'ancient-temple', 'final-gate',
]);
const ARCHETYPES = ['Explorer', 'Collector', 'Guardian', 'Loner'];
const RELICS = [
  ['moss-compass', -23, -10], ['sun-shard', 13, 8], ['moon-bell', 18, 0],
  ['river-pearl', -4, 10], ['root-key', -18, 8], ['cave-amber', 6, 3],
  ['ember-stone', 22, -11], ['star-seed', -22, 14], ['temple-sigil', 0, -11],
];
const EVOLUTION_LIBRARY = {
  Explorer: [
    ['hidden-cave', 'Your curiosity has opened the Hidden Cave.'],
    ['invisible-bridge', 'An invisible bridge now answers the Explorer’s gaze.'],
    ['forgotten-ruins', 'New ruins have emerged in the northern forest.'],
  ],
  Collector: [
    ['relic-vault', 'The relic vault has recognised a discerning collector.'],
    ['evolving-artifacts', 'Gathered relics have begun to evolve and reveal their stories.'],
    ['treasure-cache', 'Hidden treasure caches now glitter beneath the old world.'],
  ],
  Guardian: [
    ['healing-shrine', 'A healing shrine rises to shelter the group.'],
    ['protective-barrier', 'A protective barrier now guards those who travel together.'],
    ['revival-monument', 'A revival monument remembers the Guardian’s care.'],
  ],
  Loner: [
    ['spirit-realm', 'The veil thins: the Loner may enter the spirit realm.'],
    ['illusion-passage', 'Illusion passages become visible to a solitary eye.'],
    ['hidden-portal', 'A hidden portal has opened beyond ordinary sight.'],
  ],
};

function now() { return Date.now(); }
function cleanText(value, fallback = '', max = 220) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function locationFor(x, z) {
  // Coarse server-side regions; exact tile decoration remains a client concern.
  if (z < -16) return 'mountain-pass';
  if (x > 16 && z < -3) return 'whispering-forest';
  if (x > 13 && z > 10) return 'forgotten-ruins';
  if (x < -15 && z > 8) return 'small-graveyard';
  if (x < -14 && z < -5) return 'crystal-cave';
  if (z > 12) return 'lake-of-echoes';
  if (Math.abs(x) < 10 && Math.abs(z) < 10) return 'starting-village';
  return 'abandoned-camp';
}
function event(room, type, message, options = {}) {
  const item = { id: `${now()}-${Math.random().toString(36).slice(2, 7)}`, at: now(), type, message: cleanText(message, 'The world shifts.'), ...options };
  room.events.push(item);
  if (room.events.length > 40) room.events.shift();
  if (options.privateTo) io.to(options.privateTo).emit('gm-private', item);
  else io.to(room.code).emit('gm-event', item);
  return item;
}
function createRoom(code) {
  const createdAt = now();
  return {
    code, createdAt, observationEndsAt: createdAt + OBSERVATION_MS, phase: 'observing',
    players: new Map(), relics: RELICS.map(([id, x, z]) => ({ id, x, z, collectedBy: null })),
    world: { unlocked: new Set(['starting-village', 'whispering-forest', 'lake-of-echoes']), privateUnlocks: new Map() },
    events: [], archetypesAssignedAt: null, lastEvolutionAt: 0, finalObjective: null,
    director: { narration: 'No quest has been written. The Game Master is listening.', source: 'server', at: createdAt },
  };
}
function createPlayer(id, name, index) {
  const [x, z] = SPAWNS[index] || [0, 0];
  return {
    id, name: cleanText(name, 'Wanderer', 16), color: COLORS[index], x, z,
    inputX: 0, inputZ: 0, locationId: locationFor(x, z), visited: new Set(['starting-village']),
    relicIds: new Set(), interactions: {}, movement: 0, movementSamples: 0,
    nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0,
    archetype: null, evolutions: [], privateRules: [], lastTelemetryAt: now(),
  };
}
function activePlayers(room) { return [...room.players.values()]; }
function getPlayer(room, playerId) { return room.players.get(playerId); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function closestDistance(room, player) {
  return activePlayers(room).filter((other) => other.id !== player.id).reduce((best, other) => Math.min(best, distance(player, other)), Infinity);
}
function playerTelemetry(room, player) {
  const elapsed = Math.max(1, (now() - room.createdAt) / 1000);
  return {
    id: player.id, name: player.name, location: player.locationId,
    locationsDiscovered: player.visited.size, relicsCollected: player.relicIds.size,
    interactions: player.interactions, distanceTravelled: Math.round(player.movement),
    nearGroupSeconds: Math.round(player.nearSeconds), aloneSeconds: Math.round(player.aloneSeconds),
    riskEvents: player.riskEvents, rescues: player.rescues, follows: player.follows,
    cohesion: Number((player.nearSeconds / elapsed).toFixed(2)),
  };
}
function roomTelemetry(room) {
  return {
    roomCode: room.code, phase: room.phase,
    observationSecondsRemaining: Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)),
    players: activePlayers(room).map((player) => playerTelemetry(room, player)),
    relicsCollected: room.relics.filter((relic) => relic.collectedBy).length,
    unlockedFeatures: [...room.world.unlocked], finalObjective: room.finalObjective,
  };
}

// The score model is explainable and deterministic. The MCP agent may request a
// different assignment, but can never duplicate an archetype or name a player it
// cannot see.
function archetypeScores(player) {
  return {
    Explorer: player.visited.size * 3 + player.movement / 30 + player.riskEvents * 2,
    Collector: player.relicIds.size * 9 + (player.interactions.relic || 0) * 2 + (player.interactions.object || 0),
    Guardian: player.nearSeconds / 3 + player.rescues * 8 + (player.interactions.shrine || 0) * 2 + player.follows,
    Loner: player.aloneSeconds / 3 + player.visited.size + (player.interactions.secret || 0) * 3,
  };
}
function calculateAssignments(room) {
  const players = activePlayers(room);
  const available = ARCHETYPES.slice(0, players.length);
  let best = { score: -Infinity, choices: [] };
  function search(index, unused, choices, score) {
    if (index === players.length) { if (score > best.score) best = { score, choices: [...choices] }; return; }
    for (const archetype of unused) {
      const next = unused.filter((item) => item !== archetype);
      search(index + 1, next, [...choices, [players[index].id, archetype]], score + archetypeScores(players[index])[archetype]);
    }
  }
  search(0, available, [], 0);
  return best.choices;
}
function assignArchetypes(room, assignments, source = 'server') {
  if (room.phase !== 'observing' && room.phase !== 'awakening') return { ok: false, error: 'Archetypes have already been assigned.' };
  if (!Array.isArray(assignments) || assignments.length !== room.players.size) return { ok: false, error: 'Every current player requires one assignment.' };
  const seenPlayers = new Set(); const seenArchetypes = new Set();
  for (const item of assignments) {
    if (!getPlayer(room, item.playerId) || !ARCHETYPES.includes(item.archetype) || seenPlayers.has(item.playerId) || seenArchetypes.has(item.archetype)) return { ok: false, error: 'Assignments must use distinct valid players and archetypes.' };
    seenPlayers.add(item.playerId); seenArchetypes.add(item.archetype);
  }
  for (const { playerId, archetype } of assignments) {
    const player = getPlayer(room, playerId); player.archetype = archetype;
    event(room, 'archetype-awakened', `${player.name} has awakened as the ${archetype}.`, { playerId, archetype });
  }
  room.phase = 'evolving'; room.archetypesAssignedAt = now();
  room.director = { narration: 'I have observed your choices. Now I will grow a world that answers them.', source, at: now() };
  return { ok: true, assignments };
}
function unlock(room, feature, message, options = {}) {
  if (!FEATURES.has(feature)) return { ok: false, error: 'Unknown world feature.' };
  const player = options.playerId && getPlayer(room, options.playerId);
  if (options.privateTo && !player) return { ok: false, error: 'Unknown private audience.' };
  if (options.privateTo) {
    const privateSet = room.world.privateUnlocks.get(options.privateTo) || new Set();
    privateSet.add(feature); room.world.privateUnlocks.set(options.privateTo, privateSet);
    event(room, 'private-unlock', message || `${feature} has become visible only to you.`, { privateTo: options.privateTo, feature, playerId: options.privateTo });
  } else {
    const fresh = !room.world.unlocked.has(feature); room.world.unlocked.add(feature);
    if (fresh || message) event(room, 'world-unlocked', message || `${feature} is now accessible.`, { feature });
  }
  return { ok: true, feature };
}
function evolve(room, playerId, source = 'server') {
  const player = getPlayer(room, playerId);
  if (!player?.archetype) return { ok: false, error: 'This player has no archetype.' };
  const path = EVOLUTION_LIBRARY[player.archetype];
  const step = path[player.evolutions.length];
  if (!step) return { ok: false, error: 'This archetype has reached its current evolution limit.' };
  const [feature, narration] = step;
  player.evolutions.push(feature);
  const privateUnlock = ['spirit-realm', 'illusion-passage', 'hidden-portal'].includes(feature);
  const result = unlock(room, feature, narration, privateUnlock ? { privateTo: player.id, playerId } : {});
  if (!result.ok) return result;
  // Asymmetric information is a mechanic, not merely private UI copy.
  if (privateUnlock) player.privateRules.push({ id: feature, title: 'Private Vision', message: 'Only you can see this path. Decide what to tell the others.' });
  room.director = { narration, source, at: now() };
  event(room, 'archetype-evolved', `${player.name}'s ${player.archetype} identity has evolved: ${feature.replaceAll('-', ' ')}.`, { playerId, archetype: player.archetype, feature });
  maybeCreateFinale(room, source);
  return { ok: true, playerId, archetype: player.archetype, feature };
}
function createFinalObjective(room, source = 'server') {
  if (room.finalObjective) return room.finalObjective;
  const required = activePlayers(room).filter((player) => player.archetype).map((player) => ({
    playerId: player.id, archetype: player.archetype,
    task: ({ Explorer: 'discover the hidden temple entrance', Collector: 'place three gathered relics in the altar', Guardian: 'activate the awakened shrine', Loner: 'cross the spirit realm and open the final gate' })[player.archetype],
    completed: false,
  }));
  if (!required.length) return null;
  room.world.unlocked.add('ancient-temple'); room.world.unlocked.add('final-gate');
  room.finalObjective = { id: `temple-${room.createdAt}`, title: 'The Ancient Temple Has Awakened', description: 'The finale was shaped by this group’s discovered identities.', required, status: 'active', createdAt: now(), source };
  event(room, 'finale-created', 'The Ancient Temple has awakened. Each identity is now needed to open the final gate.', { objective: room.finalObjective });
  return room.finalObjective;
}
function maybeCreateFinale(room, source) {
  const players = activePlayers(room);
  if (players.length && players.every((player) => player.archetype && player.evolutions.length > 0)) createFinalObjective(room, source);
}
function completeObjectiveTask(room, player, action) {
  const objective = room.finalObjective;
  if (!objective || objective.status !== 'active' || !player.archetype) return;
  const task = objective.required.find((item) => item.playerId === player.id);
  if (!task || task.completed) return;
  const valid = (player.archetype === 'Explorer' && ['discover-temple', 'temple-entrance'].includes(action))
    || (player.archetype === 'Collector' && ['offer-relics', 'altar'].includes(action) && player.relicIds.size >= 3)
    || (player.archetype === 'Guardian' && ['activate-shrine', 'shrine'].includes(action))
    || (player.archetype === 'Loner' && ['open-final-gate', 'spirit-gate'].includes(action));
  if (!valid) return;
  task.completed = true;
  event(room, 'finale-progress', `${player.name} fulfilled the ${player.archetype} rite.`, { playerId: player.id, archetype: player.archetype });
  if (objective.required.every((item) => item.completed)) {
    objective.status = 'complete'; objective.completedAt = now();
    event(room, 'finale-complete', 'The final gate opens. This world has learned how you play together.', { objective });
  }
}
function collectRelic(room, player, relicId) {
  const relic = room.relics.find((item) => item.id === relicId && !item.collectedBy);
  if (!relic) return { ok: false, error: 'That relic is unavailable.' };
  if (distance(player, relic) > 4) return { ok: false, error: 'Move closer to collect that relic.' };
  relic.collectedBy = player.id; player.relicIds.add(relic.id);
  player.interactions.relic = (player.interactions.relic || 0) + 1;
  event(room, 'relic-collected', `${player.name} collected the ${relic.id.replaceAll('-', ' ')}.`, { playerId: player.id, relicId });
  return { ok: true, relicId };
}
function serializeRoom(room, viewerId = null) {
  // State reads are also a safe advancement point. This keeps a room progressing
  // even if a host/browser pauses its timer or there are no movement packets.
  advanceRoom(room);
  // A final, side-effect-safe guard at the serialization boundary guarantees the
  // observation promise: a room cannot remain roleless once its window closes.
  if (room.phase === 'observing' && now() - room.createdAt >= OBSERVATION_MS && room.players.size) {
    const assignments = calculateAssignments(room);
    if (assignments.length === room.players.size) {
      for (const [playerId, archetype] of assignments) room.players.get(playerId).archetype = archetype;
      room.phase = 'evolving'; room.archetypesAssignedAt = now();
      room.director = { narration: 'I have observed your choices. Your identities are awake.', source: 'behaviour model', at: now() };
      event(room, 'archetype-awakened', 'The Game Master has assigned four unique identities from the group’s behaviour.');
    }
  }
  const viewer = viewerId && getPlayer(room, viewerId);
  const privateUnlocks = viewer ? [...(room.world.privateUnlocks.get(viewer.id) || [])] : [];
  return {
    code: room.code, phase: room.phase, observationEndsAt: room.observationEndsAt,
    observationSecondsRemaining: Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)),
    players: activePlayers(room).map((player) => ({ id: player.id, name: player.name, color: player.color, x: player.x, z: player.z, locationId: player.locationId, archetype: player.archetype, relicCount: player.relicIds.size, evolutions: player.evolutions })),
    relics: room.relics.map(({ id, x, z, collectedBy }) => ({ id, x, z, collectedBy })),
    world: { unlocked: [...room.world.unlocked], privateUnlocks }, finalObjective: room.finalObjective,
    director: room.director, events: room.events.slice(-8), yourPrivateRules: viewer?.privateRules || [],
  };
}
function broadcastState(room) {
  for (const player of activePlayers(room)) io.to(player.id).emit('world-state', serializeRoom(room, player.id));
}
function recordTelemetry(room, player, payload = {}) {
  const x = clamp(payload.x ?? payload.position?.x, WORLD_MIN_X, WORLD_MAX_X);
  const z = clamp(payload.z ?? payload.position?.z, WORLD_MIN_Z, WORLD_MAX_Z);
  const travelled = Math.min(8, Math.hypot(x - player.x, z - player.z));
  if (travelled) { player.movement += travelled; player.movementSamples += 1; }
  player.x = x; player.z = z; player.locationId = LOCATIONS.includes(payload.locationId) ? payload.locationId : locationFor(x, z); player.visited.add(player.locationId);
  if (Array.isArray(payload.visitedLocations)) for (const location of payload.visitedLocations) if (LOCATIONS.includes(location)) player.visited.add(location);
  if (Number.isFinite(payload.riskEvents)) player.riskEvents = Math.max(player.riskEvents, Math.min(50, Number(payload.riskEvents)));
  if (Number.isFinite(payload.rescues)) player.rescues = Math.max(player.rescues, Math.min(50, Number(payload.rescues)));
  if (Number.isFinite(payload.follows)) player.follows = Math.max(player.follows, Math.min(100, Number(payload.follows)));
  player.lastTelemetryAt = now();
}
function tickRoom(room, delta) {
  for (const player of activePlayers(room)) {
    const magnitude = Math.hypot(player.inputX, player.inputZ);
    if (magnitude > 0) recordTelemetry(room, player, { x: player.x + player.inputX / magnitude * 8 * delta, z: player.z + player.inputZ / magnitude * 8 * delta });
    const nearest = closestDistance(room, player);
    if (nearest <= 9) player.nearSeconds += delta;
    else if (activePlayers(room).length > 1) player.aloneSeconds += delta;
  }
  advanceRoom(room);
}
function advanceRoom(room) {
  if (room.phase === 'observing' && now() >= room.observationEndsAt && room.players.size) {
    event(room, 'gm-narration', "I've observed your curiosity, caution, and connection. Your identities are awakening.");
    assignArchetypes(room, calculateAssignments(room), 'behaviour model');
  }
  if (room.phase === 'evolving' && now() - room.lastEvolutionAt > 15_000) {
    const target = activePlayers(room).filter((player) => player.evolutions.length < 1).sort((a, b) => b.movement + b.relicIds.size * 5 - (a.movement + a.relicIds.size * 5))[0];
    if (target) { room.lastEvolutionAt = now(); evolve(room, target.id, 'behaviour model'); }
  }
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 50_000) throw new Error('Request body too large.'); }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Invalid JSON body.'); }
}
function endpointRoom(payload) { return rooms.get(String(payload.roomCode || '').toUpperCase()); }
async function handleMcpApi(request, response, pathname) {
  let payload;
  try { payload = request.method === 'GET' ? Object.fromEntries(new URL(request.url, 'http://localhost').searchParams) : await readBody(request); }
  catch (error) { sendJson(response, 400, { ok: false, error: error.message }); return; }
  if (pathname === '/api/mcp/rooms') { sendJson(response, 200, { ok: true, rooms: [...rooms.values()].map((room) => ({ roomCode: room.code, phase: room.phase, playerCount: room.players.size })) }); return; }
  const room = endpointRoom(payload);
  if (!room) { sendJson(response, 404, { ok: false, error: 'Unknown room.' }); return; }
  if (pathname === '/api/mcp/world-state') { sendJson(response, 200, { ok: true, state: serializeRoom(room) }); return; }
  if (pathname === '/api/mcp/telemetry') { sendJson(response, 200, { ok: true, telemetry: roomTelemetry(room) }); return; }
  let result;
  if (pathname === '/api/mcp/narrate') {
    const message = cleanText(payload.message, '', 280); if (!message) { sendJson(response, 400, { ok: false, error: 'A narration message is required.' }); return; }
    result = { ok: true, event: event(room, 'gm-narration', message, payload.privateTo ? { privateTo: payload.privateTo } : {}) };
  } else if (pathname === '/api/mcp/assign-archetypes') result = assignArchetypes(room, payload.assignments, 'MCP Game Master');
  else if (pathname === '/api/mcp/unlock') result = unlock(room, payload.feature, cleanText(payload.message), payload.privateTo ? { privateTo: payload.privateTo, playerId: payload.privateTo } : {});
  else if (pathname === '/api/mcp/evolve') result = evolve(room, payload.playerId, 'MCP Game Master');
  else if (pathname === '/api/mcp/finale') result = { ok: true, objective: createFinalObjective(room, 'MCP Game Master') };
  else { sendJson(response, 404, { ok: false, error: 'Unknown MCP endpoint.' }); return; }
  broadcastState(room); sendJson(response, result.ok ? 200 : 400, result);
}

const server = createServer(async (request, response) => {
  const pathname = (request.url || '/').split('?')[0];
  if (pathname.startsWith('/api/mcp/')) { await handleMcpApi(request, response, pathname); return; }
  if (request.method === 'GET' && pathname === '/api/game-master') { sendJson(response, 200, { ok: true, message: 'Use the narrow /api/mcp endpoints to observe or alter a room.' }); return; }
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join('dist', urlPath));
  if (!filePath.startsWith(normalize('dist')) || !existsSync(filePath)) { response.writeHead(404); response.end('Build the app first with npm run build.'); return; }
  try { response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' }); response.end(await readFile(filePath)); }
  catch { response.writeHead(500); response.end('Unable to read application file.'); }
});

const io = new Server(server, { cors: { origin: true } });
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomCode, name } = {}, callback = () => {}) => {
    const code = String(roomCode).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const cleanName = cleanText(name, '', 16);
    if (code.length < 4 || !cleanName) { callback({ ok: false, error: 'Enter a 4–6 character room code and a name.' }); return; }
    const room = rooms.get(code) || createRoom(code); if (!rooms.has(code)) rooms.set(code, room);
    if (room.players.size >= MAX_PLAYERS) { callback({ ok: false, error: 'This adventure already has four players.' }); return; }
    socket.join(code); socket.data.roomCode = code;
    const player = createPlayer(socket.id, cleanName, room.players.size); room.players.set(socket.id, player);
    callback({ ok: true, code, playerId: socket.id, observationSeconds: OBSERVATION_MS / 1000 });
    event(room, 'player-joined', `${player.name} entered the world.`); broadcastState(room);
  });
  socket.on('move', ({ x, z } = {}) => { const room = rooms.get(socket.data.roomCode); const player = room && getPlayer(room, socket.id); if (player) { player.inputX = clamp(x, -1, 1); player.inputZ = clamp(z, -1, 1); } });
  socket.on('player-telemetry', (payload = {}) => { const room = rooms.get(socket.data.roomCode); const player = room && getPlayer(room, socket.id); if (!player) return; recordTelemetry(room, player, payload); if (payload.relicId) collectRelic(room, player, cleanText(payload.relicId, '', 32)); broadcastState(room); });
  socket.on('interact', ({ type, targetId } = {}) => {
    const room = rooms.get(socket.data.roomCode); const player = room && getPlayer(room, socket.id); if (!player) return;
    const action = cleanText(type, '', 32); player.interactions[action] = (player.interactions[action] || 0) + 1;
    if (action === 'relic') collectRelic(room, player, cleanText(targetId, '', 32));
    else if (action === 'help') player.rescues += 1;
    else if (action === 'follow') player.follows += 1;
    else if (action) completeObjectiveTask(room, player, action);
    broadcastState(room);
  });
  socket.on('request-world-state', () => { const room = rooms.get(socket.data.roomCode); if (room) socket.emit('world-state', serializeRoom(room, socket.id)); });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.get(socket.id); room.players.delete(socket.id);
    if (!room.players.size) rooms.delete(room.code); else { event(room, 'player-left', `${player?.name || 'A wanderer'} left the world.`); broadcastState(room); }
  });
});

let lastTick = now();
setInterval(() => {
  const stamp = now(); const delta = Math.min(0.2, (stamp - lastTick) / 1000); lastTick = stamp;
  for (const room of rooms.values()) { tickRoom(room, delta); broadcastState(room); }
}, 100);

const lan = Object.values(networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal)?.address;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Emergent server running at http://127.0.0.1:${PORT}`);
  if (lan) console.log(`LAN: http://${lan}:${PORT}`);
});
