import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { ARCHETYPES, ENTITY_DEFINITIONS, EVOLUTION_LIBRARY, FEATURES, MAX_PLAYERS, ROLE_ABILITIES, TERRAIN_OVERLAYS } from './shared/game-content.js';
import { createMcpRouter } from './server/mcp-router.mjs';
import { attachSocketGateway } from './server/socket-gateway.mjs';

// The server owns all game rules. The browser only renders the state below and
// sends intent; it cannot walk through a role gate or collect an invalid relic.
const PORT = Number(process.env.PORT || 8787);
const OBSERVATION_MS = 30_000;
const GM_ASSIGNMENT_GRACE_MS = 12_000;
const WORLD_MIN_X = -29, WORLD_MAX_X = 28, WORLD_MIN_Z = -16, WORLD_MAX_Z = 15;
const MAP_WIDTH = 60, MAP_OFFSET_X = 30, MAP_OFFSET_Z = 17;
const COLORS = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
const SPAWNS = [[-6, 0], [-4, 0], [-5, 2], [-3, 2]];
const rooms = new Map();

let collisionTiles = [];
try {
  const forest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'game-art', 'forest.json'), 'utf8'));
  collisionTiles = forest.layers?.find((layer) => layer.name === 'LAYER WITH COLLISION')?.data || [];
} catch { console.warn('CSD collision map unavailable; using only map boundaries.'); }

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};
function now() { return Date.now(); }
function cleanText(value, fallback = '', max = 220) { return typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function activePlayers(room) { return [...room.players.values()]; }
function getPlayer(room, id) { return room.players.get(id); }
function hasRole(player, role) { return player?.archetype === role; }
function areaContains(area, x, z) { return x >= area.x && x <= area.x + area.w - 1 && z >= area.z && z <= area.z + area.h - 1; }
function terrainAt(x, z) { return TERRAIN_OVERLAYS.find((area) => areaContains(area, Math.round(x), Math.round(z))); }
function isBaseWalkable(x, z) {
  const tx = Math.round(x + MAP_OFFSET_X), ty = Math.round(z + MAP_OFFSET_Z);
  return tx >= 1 && tx <= 58 && ty >= 1 && ty <= 32 && (!collisionTiles.length || collisionTiles[ty * MAP_WIDTH + tx] === 0);
}
function canEnterTile(player, x, z) {
  if (x < WORLD_MIN_X || x > WORLD_MAX_X || z < WORLD_MIN_Z || z > WORLD_MAX_Z) return false;
  const terrain = terrainAt(x, z);
  if (terrain) return hasRole(player, terrain.role);
  return isBaseWalkable(x, z);
}
function locationFor(x, z) {
  if (terrainAt(x, z)?.kind === 'water') return 'lake-of-echoes';
  if (terrainAt(x, z)?.kind === 'hidden-path') return 'hidden-cave';
  if (terrainAt(x, z)?.kind === 'bridge') return 'sacred-shrine';
  if (terrainAt(x, z)?.kind === 'spirit') return 'spirit-realm';
  if (x < -15 && z < -5) return 'whispering-forest';
  if (x > 14 && z > 7) return 'ancient-temple';
  return 'starting-village';
}
function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }

function event(room, type, message, options = {}) {
  const item = { id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, at: now(), type, message: cleanText(message, 'The world shifts.'), ...options };
  room.events.push(item); if (room.events.length > 40) room.events.shift();
  if (options.privateTo) io.to(options.privateTo).emit('gm-private', item); else io.to(room.code).emit('gm-event', item);
  return item;
}
function createRoom(code) {
  const createdAt = now();
  return {
    code, createdAt, phase: 'waiting-for-four', observationEndsAt: null, players: new Map(),
    entities: ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null })),
    world: { unlocked: new Set(['starting-village']), privateUnlocks: new Map() }, events: [], finalObjective: null,
    archetypesAssignedAt: null, gmActiveUntil: 0,
    director: { narration: 'Four lanterns are needed before this shared tale can begin.', source: 'server', at: createdAt },
  };
}
function createPlayer(id, name, index) {
  const [x, z] = SPAWNS[index];
  return { id, name: cleanText(name, 'Wanderer', 16), color: COLORS[index], x, z, inputX: 0, inputZ: 0,
    locationId: locationFor(x, z), visited: new Set(['starting-village']), relicIds: new Set(), interactions: {}, movement: 0, movementSamples: 0,
    nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, archetype: null, evolutions: [], privateRules: [], lastTelemetryAt: now() };
}
function resetRoomForRoster(room, reason) {
  room.phase = 'waiting-for-four'; room.observationEndsAt = null; room.archetypesAssignedAt = null; room.finalObjective = null;
  room.world = { unlocked: new Set(['starting-village']), privateUnlocks: new Map() };
  room.entities = ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null }));
  for (const [index, player] of activePlayers(room).entries()) {
    const [x, z] = SPAWNS[index]; Object.assign(player, { x, z, inputX: 0, inputZ: 0, locationId: locationFor(x, z), archetype: null, evolutions: [] });
    player.relicIds.clear(); player.privateRules = [];
  }
  room.director = { narration: reason, source: 'server', at: now() };
}
function beginObservation(room) {
  if (room.players.size !== MAX_PLAYERS) return;
  room.phase = 'observing'; room.observationEndsAt = now() + OBSERVATION_MS;
  room.director = { narration: 'All four lanterns are lit. The Game Master is observing your first choices.', source: 'server', at: now() };
  event(room, 'four-player-start', 'All four lanterns are lit. The shared tale has begun.');
}
function playerTelemetry(room, player) {
  const elapsed = Math.max(1, (now() - (room.observationEndsAt ? room.observationEndsAt - OBSERVATION_MS : room.createdAt)) / 1000);
  return { id: player.id, name: player.name, location: player.locationId, locationsDiscovered: player.visited.size, relicsCollected: player.relicIds.size,
    interactions: player.interactions, distanceTravelled: Math.round(player.movement), nearGroupSeconds: Math.round(player.nearSeconds), aloneSeconds: Math.round(player.aloneSeconds),
    riskEvents: player.riskEvents, rescues: player.rescues, follows: player.follows, cohesion: Number((player.nearSeconds / elapsed).toFixed(2)) };
}
function roomTelemetry(room) { return { roomCode: room.code, phase: room.phase, playerCount: room.players.size, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, players: activePlayers(room).map((p) => playerTelemetry(room, p)), relicsCollected: room.entities.filter((e) => e.type === 'relic' && e.collectedBy).length, unlockedFeatures: [...room.world.unlocked], finalObjective: room.finalObjective }; }
function closestDistance(room, player) { return activePlayers(room).filter((p) => p.id !== player.id).reduce((best, p) => Math.min(best, distance(player, p)), Infinity); }
function archetypeScores(player) { return { Explorer: player.visited.size * 3 + player.movement / 30 + player.riskEvents * 2, Collector: player.relicIds.size * 9 + (player.interactions.relic || 0) * 2, Guardian: player.nearSeconds / 3 + player.rescues * 8 + (player.interactions['activate-shrine'] || 0) * 2 + player.follows, Loner: player.aloneSeconds / 3 + player.visited.size + (player.interactions['enter-spirit-realm'] || 0) * 3 }; }
function calculateAssignments(room) {
  const players = activePlayers(room); if (players.length !== MAX_PLAYERS) return [];
  let best = { score: -Infinity, choices: [] };
  function search(index, unused, choices, score) { if (index === players.length) { if (score > best.score) best = { score, choices: [...choices] }; return; } for (const type of unused) search(index + 1, unused.filter((x) => x !== type), [...choices, [players[index].id, type]], score + archetypeScores(players[index])[type]); }
  search(0, ARCHETYPES, [], 0); return best.choices;
}
function canAssign(room) { return room.players.size === MAX_PLAYERS && room.phase === 'observing' && room.observationEndsAt && now() >= room.observationEndsAt; }
function assignArchetypes(room, assignments, source = 'server') {
  if (!canAssign(room)) return { ok: false, error: 'Roles can be assigned only after all four players finish the observation period.' };
  if (!Array.isArray(assignments) || assignments.length !== MAX_PLAYERS) return { ok: false, error: 'Exactly four distinct player assignments are required.' };
  const players = new Set(), roles = new Set();
  for (const item of assignments) if (!getPlayer(room, item?.playerId) || !ARCHETYPES.includes(item?.archetype) || players.has(item.playerId) || roles.has(item.archetype)) return { ok: false, error: 'Assignments must contain every current player and every unique role exactly once.' }; else { players.add(item.playerId); roles.add(item.archetype); }
  for (const { playerId, archetype } of assignments) { const player = getPlayer(room, playerId); player.archetype = archetype; event(room, 'archetype-awakened', `${player.name} has awakened as the ${archetype}.`, { playerId, archetype }); }
  room.phase = 'evolving'; room.archetypesAssignedAt = now(); room.director = { narration: 'Four distinct callings have awakened. Each opens a different way through Everdawn.', source, at: now() };
  return { ok: true, assignments };
}
function markGmActive(room) { room.gmActiveUntil = now() + 45_000; }
function unlock(room, feature, message, options = {}) {
  if (!FEATURES.has(feature)) return { ok: false, error: 'Unknown world feature.' };
  if (options.privateTo && !getPlayer(room, options.privateTo)) return { ok: false, error: 'Unknown private audience.' };
  if (options.privateTo) { const set = room.world.privateUnlocks.get(options.privateTo) || new Set(); set.add(feature); room.world.privateUnlocks.set(options.privateTo, set); event(room, 'private-unlock', message || `${feature} is visible only to you.`, { privateTo: options.privateTo, feature, playerId: options.privateTo }); }
  else { const fresh = !room.world.unlocked.has(feature); room.world.unlocked.add(feature); if (fresh || message) event(room, 'world-unlocked', message || `${feature} is now accessible.`, { feature }); }
  return { ok: true, feature };
}
function evolve(room, playerId, source = 'server') {
  const player = getPlayer(room, playerId); if (room.phase !== 'evolving' && room.phase !== 'finale') return { ok: false, error: 'The shared world has not started evolving.' };
  if (!player?.archetype) return { ok: false, error: 'That player has no assigned role.' };
  const step = EVOLUTION_LIBRARY[player.archetype][player.evolutions.length]; if (!step) return { ok: false, error: 'This role has already reached its available evolution.' };
  const [feature, narration] = step; player.evolutions.push(feature); const privateTo = player.archetype === 'Loner' ? player.id : null;
  const result = unlock(room, feature, narration, privateTo ? { privateTo } : {}); if (!result.ok) return result;
  if (privateTo) player.privateRules.push({ id: feature, title: 'Private Vision', message: 'Only you can see the Veil Path and the Spirit Portal.' });
  room.director = { narration, source, at: now() }; event(room, 'archetype-evolved', `${player.name}'s ${player.archetype} has evolved.`, { playerId, archetype: player.archetype, feature });
  maybeCreateFinale(room, source); return { ok: true, playerId, archetype: player.archetype, feature };
}
function maybeAutoEvolve(room, player, reason) {
  // Natural evolution is activity-triggered. An active MCP Game Master has a
  // short exclusive window, so the fallback never races a live GM decision.
  if (room.gmActiveUntil > now() || player.evolutions.length) return;
  const result = evolve(room, player.id, 'role-mastery'); if (result.ok) event(room, 'role-mastery', `${player.name} mastered the ${reason}.`, { playerId: player.id });
}
function createFinalObjective(room, source = 'server') {
  if (room.finalObjective) return room.finalObjective;
  const players = activePlayers(room);
  if (players.length !== MAX_PLAYERS || !players.every((p) => p.archetype && p.evolutions.length)) return null;
  room.world.unlocked.add('ancient-temple'); room.world.unlocked.add('final-gate'); room.phase = 'finale';
  room.finalObjective = { id: `temple-${room.createdAt}`, title: 'The Ancient Temple Has Awakened', description: 'Each of the four roles must perform its own rite.', createdAt: now(), source, status: 'active', required: players.map((p) => ({ playerId: p.id, archetype: p.archetype, task: ({ Explorer: 'discover the hidden temple entrance', Collector: 'offer three relics at the altar', Guardian: 'activate the awakened shrine', Loner: 'open the final gate' })[p.archetype], completed: false })) };
  event(room, 'finale-created', 'The Ancient Temple has awakened. All four roles are needed at the final gate.', { objective: room.finalObjective }); return room.finalObjective;
}
function maybeCreateFinale(room, source) { if (activePlayers(room).length === MAX_PLAYERS && activePlayers(room).every((p) => p.archetype && p.evolutions.length)) createFinalObjective(room, source); }
function completeObjectiveTask(room, player, type, entity) {
  const objective = room.finalObjective; if (!objective || objective.status !== 'active') return { ok: true, finale: false };
  const task = objective.required.find((entry) => entry.playerId === player.id); if (!task || task.completed) return { ok: true, finale: false };
  const valid = (player.archetype === 'Explorer' && type === 'discover-temple' && entity.id === 'hidden-temple-entrance') || (player.archetype === 'Collector' && type === 'offer-relics' && entity.id === 'final-altar' && player.relicIds.size >= 3) || (player.archetype === 'Guardian' && type === 'activate-shrine' && entity.id === 'guardian-shrine') || (player.archetype === 'Loner' && type === 'open-final-gate' && entity.id === 'final-gate');
  if (!valid) return { ok: false, error: 'That is not your valid finale rite yet.' };
  task.completed = true; event(room, 'finale-progress', `${player.name} completed the ${player.archetype} rite.`, { playerId: player.id, archetype: player.archetype });
  if (objective.required.every((entry) => entry.completed)) { objective.status = 'complete'; objective.completedAt = now(); event(room, 'finale-complete', 'The final gate opens. Everdawn remembers the four stories written here.', { objective }); }
  return { ok: true, finale: true };
}
function getEntity(room, targetId) { return room.entities.find((entity) => entity.id === targetId); }
function interact(room, player, type, targetId) {
  if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'Wait until all four players have received their roles.' };
  const action = cleanText(type, '', 32), entity = getEntity(room, cleanText(targetId, '', 48));
  if (!entity || !['relic', 'discover-temple', 'activate-shrine', 'enter-spirit-realm', 'offer-relics', 'open-final-gate'].includes(action)) return { ok: false, error: 'That interaction target is invalid.' };
  if (distance(player, entity) > 3.25) return { ok: false, error: 'Move closer to interact with that object.' };
  if (!hasRole(player, entity.role)) return { ok: false, error: `Only the ${entity.role} can use ${entity.label}.` };
  const expected = { relic: 'relic', 'discover-temple': 'temple-entrance', 'activate-shrine': 'shrine', 'enter-spirit-realm': 'spirit-portal', 'offer-relics': 'altar', 'open-final-gate': 'final-gate' }[action];
  if (entity.type !== expected) return { ok: false, error: 'That action does not match this object.' };
  if (entity.feature && !room.world.unlocked.has(entity.feature)) return { ok: false, error: 'That place has not awakened yet.' };
  if (entity.type === 'relic') { if (entity.collectedBy) return { ok: false, error: 'That relic was already claimed.' }; entity.collectedBy = player.id; player.relicIds.add(entity.id); }
  player.interactions[action] = (player.interactions[action] || 0) + 1;
  const mastery = { relic: 'Echo Water relic', 'discover-temple': 'hidden route', 'activate-shrine': 'shrine rite', 'enter-spirit-realm': 'spirit path' }[action];
  if (mastery) maybeAutoEvolve(room, player, mastery);
  const finale = completeObjectiveTask(room, player, action, entity); if (!finale.ok) return finale;
  const messages = { relic: `${player.name} collected ${entity.label}.`, 'discover-temple': `${player.name} found the hidden temple entrance.`, 'activate-shrine': `${player.name} awakened the shrine.`, 'enter-spirit-realm': `${player.name} stepped through the veil.`, 'offer-relics': `${player.name} offered relics at the altar.`, 'open-final-gate': `${player.name} turned the final gate's spirit key.` };
  event(room, action === 'relic' ? 'relic-collected' : 'role-interaction', messages[action], { playerId: player.id, targetId: entity.id }); return { ok: true, targetId: entity.id };
}
function entityVisibleTo(entity, viewer, room) {
  if (!viewer) return true;
  if (entity.type === 'relic') return viewer.archetype === 'Collector';
  if (entity.feature && !room.world.unlocked.has(entity.feature)) return false;
  return entity.role === viewer.archetype || !entity.role;
}
function serializeRoom(room, viewerId = null) {
  advanceRoom(room); const viewer = viewerId && getPlayer(room, viewerId); const privateUnlocks = viewer ? [...(room.world.privateUnlocks.get(viewer.id) || [])] : [];
  const entities = room.entities.filter((entity) => entityVisibleTo(entity, viewer, room)).map(({ id, type, x, z, label, role, terrain, collectedBy, feature }) => ({ id, type, x, z, label, requiredRole: role, terrain, collectedBy, feature }));
  const visibleTerrain = TERRAIN_OVERLAYS.filter((area) => !viewer || area.role === viewer.archetype).map(({ id, kind, role, label, x, z, w, h }) => ({ id, kind, requiredRole: role, label, x, z, w, h }));
  return { code: room.code, phase: room.phase, playerCount: room.players.size, requiredPlayers: MAX_PLAYERS, observationEndsAt: room.observationEndsAt, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null,
    players: activePlayers(room).map((p) => ({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, locationId: p.locationId, archetype: p.archetype, capabilities: p.id === viewerId ? ROLE_ABILITIES[p.archetype] || [] : undefined, relicCount: p.relicIds.size, evolutions: p.evolutions })),
    relics: entities.filter((entity) => entity.type === 'relic'), entities, terrain: visibleTerrain,
    world: { unlocked: [...room.world.unlocked], privateUnlocks }, finalObjective: room.finalObjective, director: room.director, events: room.events.slice(-8), yourPrivateRules: viewer?.privateRules || [] };
}
function broadcastState(room) { for (const player of activePlayers(room)) io.to(player.id).emit('world-state', serializeRoom(room, player.id)); }
function recordTelemetry(room, player, payload = {}, positionIsAuthoritative = false) {
  if (!['observing', 'evolving', 'finale'].includes(room.phase)) return;
  // Browser telemetry is behavioural context, not a movement authority. Only the
  // fixed server tick can supply a position, preventing client-side teleports.
  const x = positionIsAuthoritative ? clamp(payload.x ?? payload.position?.x, WORLD_MIN_X, WORLD_MAX_X) : player.x;
  const z = positionIsAuthoritative ? clamp(payload.z ?? payload.position?.z, WORLD_MIN_Z, WORLD_MAX_Z) : player.z;
  const next = canEnterTile(player, x, z) ? { x, z } : { x: player.x, z: player.z };
  const travelled = Math.min(2, Math.hypot(next.x - player.x, next.z - player.z)); if (travelled) { player.movement += travelled; player.movementSamples += 1; }
  // Discovery is derived exclusively from the server-accepted position.  Do not
  // accept client-reported visited locations: they feed role assignment scores.
  player.x = next.x; player.z = next.z; player.locationId = locationFor(next.x, next.z); player.visited.add(player.locationId); player.lastTelemetryAt = now();
}
function tickRoom(room, delta) {
  if (['observing', 'evolving', 'finale'].includes(room.phase)) for (const player of activePlayers(room)) { const magnitude = Math.hypot(player.inputX, player.inputZ); if (magnitude) recordTelemetry(room, player, { x: player.x + player.inputX / magnitude * 8 * delta, z: player.z + player.inputZ / magnitude * 8 * delta }, true); const closest = closestDistance(room, player); if (closest <= 9) player.nearSeconds += delta; else player.aloneSeconds += delta; }
  advanceRoom(room);
}
function advanceRoom(room) {
  // A live Game Master gets a short decision window after observation; the
  // deterministic model remains available as a no-stall fallback.
  if (room.phase === 'observing' && room.players.size === MAX_PLAYERS && room.observationEndsAt && now() >= room.observationEndsAt + GM_ASSIGNMENT_GRACE_MS) {
    event(room, 'gm-narration', 'The observation ends. Four distinct callings awaken.');
    assignArchetypes(room, calculateAssignments(room), 'behaviour-model fallback');
  }
}

const world = { rooms, cleanText, clamp, getPlayer, createRoom, createPlayer, resetRoomForRoster, beginObservation, roomTelemetry, markGmActive, event, assignArchetypes, unlock, evolve, createFinalObjective, serializeRoom, broadcastState, recordTelemetry, interact };
const handleMcpApi = createMcpRouter(world);

const server = createServer(async (request, response) => {
  const pathname = (request.url || '/').split('?')[0]; if (pathname.startsWith('/api/mcp/')) { await handleMcpApi(request, response, pathname); return; }
  if (request.method === 'GET' && pathname === '/api/game-master') { sendJson(response, 200, { ok: true, message: 'Use the narrow /api/mcp endpoints to observe or alter a room.' }); return; }
  const urlPath = pathname === '/' ? '/index.html' : pathname, filePath = normalize(join('dist', urlPath));
  if (!filePath.startsWith(normalize('dist')) || !existsSync(filePath)) { response.writeHead(404); response.end('Build the app first with npm run build.'); return; }
  try { response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' }); response.end(await readFile(filePath)); } catch { response.writeHead(500); response.end('Unable to read application file.'); }
});
const io = new Server(server, { cors: { origin: true } });
attachSocketGateway(io, world);
let lastTick = now(); setInterval(() => { const stamp = now(), delta = Math.min(0.2, (stamp - lastTick) / 1000); lastTick = stamp; for (const room of rooms.values()) { tickRoom(room, delta); broadcastState(room); } }, 100);
const lan = Object.values(networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal)?.address;
server.listen(PORT, '0.0.0.0', () => { console.log(`Emergent server running at http://127.0.0.1:${PORT}`); if (lan) console.log(`LAN: http://${lan}:${PORT}`); });
