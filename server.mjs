import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { ARCHETYPES, ENTITY_DEFINITIONS, FEATURES, MAX_PLAYERS, ROLE_ABILITIES, TERRAIN_OVERLAYS, WORLD_EVOLUTIONS } from './shared/game-content.js';
import { createDirectorRules } from './server/director-rules.mjs';
import { createMcpRouter } from './server/mcp-router.mjs';
import { attachSocketGateway } from './server/socket-gateway.mjs';
import { createFinaleSystem } from './server/finale-system.mjs';
import { createDungeonSystem } from './server/dungeon-system.mjs';
import { createShadowForestSystem } from './server/shadow-forest-system.mjs';
import { createMoonShrineSystem } from './server/moon-shrine-system.mjs';
import { createGhostVillageSystem } from './server/ghost-village-system.mjs';

// The server owns all game rules. The browser only renders the state below and
// sends intent; it cannot walk through a role gate or collect an invalid relic.
const PORT = Number(process.env.PORT || 8787);
function configuredDuration(name, fallback, minimum) { const value = Number(process.env[name]); return Number.isFinite(value) ? Math.max(minimum, value) : fallback; }
const OBSERVATION_MS = configuredDuration('GAME_TEST_OBSERVATION_MS', 30_000, 100);
const GM_ASSIGNMENT_GRACE_MS = configuredDuration('GAME_TEST_GM_ASSIGNMENT_GRACE_MS', 12_000, 0);
const EVOLUTION_MIN_MS = configuredDuration('GAME_TEST_EVOLUTION_MIN_MS', 45_000, 100);
const EVOLUTION_MAX_MS = configuredDuration('GAME_TEST_EVOLUTION_MAX_MS', 60_000, EVOLUTION_MIN_MS);
const EVOLUTION_GM_GRACE_MS = configuredDuration('GAME_TEST_EVOLUTION_GM_GRACE_MS', 12_000, 0);
const FINALE_MIN_MATCH_MS = configuredDuration('GAME_TEST_FINALE_MIN_MATCH_MS', 180_000, 100);
const FINALE_GM_GRACE_MS = configuredDuration('GAME_TEST_FINALE_GM_GRACE_MS', 12_000, 0);
const FINALE_RESET_MS = configuredDuration('GAME_TEST_FINALE_RESET_MS', 30_000, 100);
const WORLD_MIN_X = -29, WORLD_MAX_X = 28, WORLD_MIN_Z = -16, WORLD_MAX_Z = 15;
const MAP_WIDTH = 60, MAP_OFFSET_X = 30, MAP_OFFSET_Z = 17;
const COLORS = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
const SPAWNS = [[-6, 0], [-4, 0], [-5, 2], [-3, 2]];
const PLAYER_SPRITES = [1, 2, 3, 5];
const OBSERVATION_ITEMS = Object.freeze([
  { id:'curio-coin-1', type:'observation-item', x:-10, z:-2, label:'Unidentified Coin', sprite:'ancient-coin' },
  { id:'curio-shard-1', type:'observation-item', x:1, z:-5, label:'Shiny Fragment', sprite:'relic-shard' },
  { id:'curio-gem-1', type:'observation-item', x:6, z:2, label:'Unusual Gem', sprite:'glowing-gem-cluster' },
  { id:'curio-coin-2', type:'observation-item', x:-14, z:5, label:'Weathered Coin', sprite:'ancient-coin' },
  { id:'curio-key-1', type:'observation-item', x:3, z:8, label:'Ornate Key', sprite:'ornate-key' },
  { id:'curio-shard-2', type:'observation-item', x:17, z:-4, label:'Golden Relic Shard', sprite:'relic-shard' },
  { id:'curio-gem-2', type:'observation-item', x:-4, z:11, label:'Strange Crystal', sprite:'glowing-gem-cluster' },
  { id:'curio-coin-3', type:'observation-item', x:12, z:10, label:'Ancient Token', sprite:'ancient-coin' },
]);
const COLLECTOR_CLUE_POSITIONS = Object.freeze([
  [-21,-10],[-13,12],[-2,-12],[7,12],[18,-11],[24,8],[-18,3],[-7,-7],[4,4],[15,10],[23,-2],[1,13]
]);
const COLLECTOR_SEQUENCE = Object.freeze(['crystal-mine','ancient-vault','treasure-cache','relic-forge','sunken-relic']);
// TEMP TEST SWITCH: set to false to restore the normal AI-selected top-2 Collector evolutions.
const COLLECTOR_TEST_ALL_EVOLUTIONS = false;
const CRYSTAL_DIG_POSITIONS = Object.freeze([[-24,-6],[-12,13],[2,-13],[17,12],[25,-8]]);
const COLLECTOR_CLUES = Object.freeze({
  'crystal-mine': [
    ['Miner Survey','Five buried fragments lie far apart where the ground leaks blue light.','clue-scroll'],
    ['Crystal Sketch','The five fragments reconnect around one bright central core.','clue-scroll'],
    ['Fracture Note','Pieces lock only when their numbered edge matches the glowing socket.','clue-scroll'],
    ['Resonance Rubbing','When every fragment is seated, the mine awakens completely.','clue-scroll'],
  ],
  'ancient-vault': [
    ['Gem Chronicle','The Gem is pressed before the Moon.','clue-scroll'],
    ['Lunar Rubbing','The Moon sits immediately before the Flame.','clue-scroll'],
    ['Ember Seal','The Flame is not the final rune.','clue-scroll'],
    ['Key Inscription','The Key closes the lock.','clue-scroll'],
  ],
  'treasure-cache': [
    ['Appraiser Ledger','The Ancient Idol is genuine and worth three.','clue-scroll'],
    ['Merchant Note','The Golden Compass is a replica worth nothing.','clue-scroll'],
    ['Curse Warning','The Cursed Crown is valuable, but cursed.','clue-scroll'],
    ['Reliquary Slip','The Reliquary Box is genuine and worth two.','clue-scroll'],
  ],
  'relic-forge': [
    ['Recipe Scrap','Energy begins the balanced core. Stability rests between Energy and Iron.','clue-scroll'],
    ['Heat Note','Work the forge only while the metal glows orange.','clue-scroll'],
    ['Hammer Diagram','Strike the right mark, then the left, then the upper mark.','clue-scroll'],
    ['Quenching Manual','A balanced core must be quenched in oil.','clue-scroll'],
  ],
  'sunken-relic': [],
});
const LEGACY_START_RELIC_IDS = new Set(['river-pearl','drowned-idol','vault-amber']);
const INITIAL_ENTITY_DEFINITIONS = ENTITY_DEFINITIONS.filter((entity) => !LEGACY_START_RELIC_IDS.has(entity.id));
const rooms = new Map();
let finaleSystem;
let dungeonSystem;
let shadowForestSystem;
let moonShrineSystem;
let ghostVillageSystem;

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
    entities: [...INITIAL_ENTITY_DEFINITIONS, ...OBSERVATION_ITEMS].map((entity) => ({ ...entity, collectedBy: null })),
    world: { unlocked: new Set(['starting-village']), privateUnlocks: new Map() }, events: [], finalObjective: null,
    archetypesAssignedAt: null, nextEvolutionAt: null, worldEvolutions: [], finaleCompositionHistory: [], gmActiveUntil: 0, directorState: { activeRules: [], history: [], sequence: 0 },
    director: { narration: 'Four lanterns are needed before this shared tale can begin.', source: 'server', at: createdAt },
  };
}
function createPlayer(id, name, index) {
  const [x, z] = SPAWNS[index];
  return { id, name: cleanText(name, 'Wanderer', 16), color: COLORS[index], sprite: PLAYER_SPRITES[index], facing: 'down', x, z, realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, inputX: 0, inputZ: 0,
    locationId: locationFor(x, z), visited: new Set(['starting-village']), relicIds: new Set(), interactions: {}, movement: 0, movementSamples: 0,
    nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, observationItems: new Set(), collectorClues: new Set(), collectorProgress: null, collectorEvolutionPlan: [], collectorEvolutionReasons: {}, collectorEvolutionIndex: 0, archetype: null, evolutions: [], evolutionBaseline: null, privateRules: [], lastTelemetryAt: now() };
}
function resetRoomForRoster(room, reason) {
  room.phase = 'waiting-for-four'; room.observationEndsAt = null; room.archetypesAssignedAt = null; room.nextEvolutionAt = null; room.worldEvolutions = []; room.finalObjective = null;
  room.world = { unlocked: new Set(['starting-village']), privateUnlocks: new Map() };
  room.directorState = { activeRules: [], history: [], sequence: 0 };
  room.entities = [...INITIAL_ENTITY_DEFINITIONS, ...OBSERVATION_ITEMS].map((entity) => ({ ...entity, collectedBy: null }));
  for (const [index, player] of activePlayers(room).entries()) {
    const [x, z] = SPAWNS[index]; Object.assign(player, { x, z, sprite: PLAYER_SPRITES[index], facing: 'down', realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, inputX: 0, inputZ: 0, locationId: locationFor(x, z), archetype: null, evolutions: [], evolutionBaseline: null });
    player.visited = new Set(['starting-village']); player.relicIds.clear(); player.interactions = {};
    player.movement = 0; player.movementSamples = 0; player.nearSeconds = 0; player.aloneSeconds = 0;
    player.riskEvents = 0; player.rescues = 0; player.follows = 0; player.observationItems = new Set(); player.collectorClues = new Set(); player.collectorProgress = null; player.collectorEvolutionPlan = []; player.collectorEvolutionReasons = {}; player.collectorEvolutionIndex = 0; player.privateRules = [];
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
  const baseline = player.evolutionBaseline;
  const postAssignment = baseline ? { distanceTravelled: Math.max(0, Math.round(player.movement - baseline.movement)), relicsCollected: Math.max(0, player.relicIds.size - baseline.relics), nearGroupSeconds: Math.max(0, Math.round(player.nearSeconds - baseline.near)), aloneSeconds: Math.max(0, Math.round(player.aloneSeconds - baseline.alone)), riskEvents: Math.max(0, player.riskEvents - baseline.risk), rescues: Math.max(0, player.rescues - baseline.rescues), interactions: Object.fromEntries(Object.entries(player.interactions).map(([key, value]) => [key, Math.max(0, value - (baseline.interactions[key] || 0))])) } : null;
  return { id: player.id, name: player.name, location: player.locationId, locationsDiscovered: player.visited.size, relicsCollected: player.relicIds.size, observationItemsCollected: player.observationItems?.size || 0,
    interactions: player.interactions, distanceTravelled: Math.round(player.movement), nearGroupSeconds: Math.round(player.nearSeconds), aloneSeconds: Math.round(player.aloneSeconds),
    riskEvents: player.riskEvents, rescues: player.rescues, follows: player.follows, cohesion: Number((player.nearSeconds / elapsed).toFixed(2)), postAssignment };
}
function roomTelemetry(room) { return { roomCode: room.code, phase: room.phase, playerCount: room.players.size, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, evolutionSecondsRemaining: room.nextEvolutionAt ? Math.max(0, Math.ceil((room.nextEvolutionAt - now()) / 1000)) : null, worldEvolutions: room.worldEvolutions, players: activePlayers(room).map((p) => playerTelemetry(room, p)), relicsCollected: room.entities.filter((e) => e.type === 'relic' && e.collectedBy).length, unlockedFeatures: [...room.world.unlocked], finalObjective: room.finalObjective }; }
function closestDistance(room, player) { return activePlayers(room).filter((p) => p.id !== player.id).reduce((best, p) => Math.min(best, distance(player, p)), Infinity); }
function archetypeScores(player) { return { Explorer: player.visited.size * 3 + player.movement / 30 + player.riskEvents * 2, Collector: (player.observationItems?.size || 0) * 14 + (player.interactions['collect-curio'] || 0) * 3 + player.relicIds.size * 9 + (player.interactions.relic || 0) * 2, Guardian: player.nearSeconds / 3 + player.rescues * 8 + (player.interactions['activate-shrine'] || 0) * 2 + player.follows, Loner: player.aloneSeconds / 3 + player.visited.size + (player.interactions['enter-spirit-realm'] || 0) * 3 }; }
function collectorObservationProfile(player) {
  const ids=[...(player.observationItems||[])];
  const categories=new Set(ids.map((id)=>id.includes('coin')?'coin':id.includes('gem')?'gem':id.includes('key')?'key':id.includes('shard')?'shard':'other'));
  const interactions=Object.values(player.interactions||{}).reduce((sum,value)=>sum+(Number(value)||0),0);
  return {
    items:ids.length,
    variety:categories.size,
    visited:player.visited?.size||0,
    movement:Number(player.movement)||0,
    risk:Number(player.riskEvents)||0,
    near:Number(player.nearSeconds)||0,
    alone:Number(player.aloneSeconds)||0,
    follows:Number(player.follows)||0,
    interactions,
  };
}
function chooseCollectorEvolutionPlan(player) {
  const p=collectorObservationProfile(player);
  // Collecting is already what qualifies someone to become the Collector, so
  // evolution choice should not reward raw item count twice.  The five paths
  // emphasise different *styles* of collecting instead.
  const repeatCollecting=Math.max(0,p.items-p.variety);
  const scores={
    // Focused gatherer: many pickups, especially repeated/similar curios.
    'crystal-mine': p.items*3.2 + repeatCollecting*7 + Math.min(8,p.interactions)*1.4,
    // Roaming puzzle-solver: broad exploration and movement matter most.
    'ancient-vault': p.visited*4 + p.movement/50 + p.variety,
    // Appraiser: variety is the main signal; ordinary Collector pickups add little.
    'treasure-cache': Math.max(0,p.variety-2)*7 + p.items*0.7 + Math.min(6,p.interactions)*0.5,
    // Social crafter: stay near/follow the group and interact often.
    'relic-forge': p.near/2.5 + p.follows*6 + p.interactions*3 + Math.min(3,p.items),
    // Adventurous diver: risk, distance and time away from the group.
    'sunken-relic': p.risk*10 + p.movement/36 + p.alone/7 + p.visited*1.2,
  };
  const reasons={
    'crystal-mine': `you gathered persistently, including ${repeatCollecting} repeated/similar curios`,
    'ancient-vault': `you ranged across the map and discovered ${p.visited} locations`,
    'treasure-cache': `you deliberately collected a broad variety (${p.variety} curio types)`,
    'relic-forge': `you stayed close to the group, followed others and interacted often`,
    'sunken-relic': `you travelled boldly, spent time alone and took ${p.risk} recorded risks`,
  };
  const ranked=COLLECTOR_SEQUENCE.map((feature,index)=>({feature,index,score:scores[feature]||0})).sort((a,b)=>b.score-a.score || a.index-b.index);
  // During testing, run every Collector evolution in the original sequence so
  // each minigame can be exercised in one session. Flip the flag above to false
  // to immediately restore the behaviour-based top-2 AI selection.
  const plan=COLLECTOR_TEST_ALL_EVOLUTIONS ? [...COLLECTOR_SEQUENCE] : ranked.slice(0,2).map((item)=>item.feature);
  const selectedReasons=Object.fromEntries(plan.map((feature)=>[feature,COLLECTOR_TEST_ALL_EVOLUTIONS ? 'temporary full minigame test rotation' : reasons[feature]]));
  return { plan, reasons:selectedReasons, scores };
}
function calculateAssignments(room) {
  const players = activePlayers(room); if (players.length !== MAX_PLAYERS) return [];
  // Collector is behaviour-locked first: the player who gathered the most
  // observation curios becomes Collector. This prevents the global role-balancing
  // pass from assigning the strongest gatherer to another role.
  const collector = [...players].sort((a, b) => {
    const countDelta = (b.observationItems?.size || 0) - (a.observationItems?.size || 0);
    if (countDelta) return countDelta;
    const interactionDelta = (b.interactions['collect-curio'] || 0) - (a.interactions['collect-curio'] || 0);
    if (interactionDelta) return interactionDelta;
    return archetypeScores(b).Collector - archetypeScores(a).Collector;
  })[0];
  const remainingPlayers = players.filter((player) => player.id !== collector.id);
  const remainingRoles = ARCHETYPES.filter((role) => role !== 'Collector');
  let best = { score: -Infinity, choices: [] };
  function search(index, unused, choices, score) {
    if (index === remainingPlayers.length) { if (score > best.score) best = { score, choices: [...choices] }; return; }
    for (const type of unused) search(index + 1, unused.filter((x) => x !== type), [...choices, { playerId: remainingPlayers[index].id, archetype: type }], score + archetypeScores(remainingPlayers[index])[type]);
  }
  search(0, remainingRoles, [], 0);
  return [{ playerId: collector.id, archetype: 'Collector' }, ...best.choices];
}
function canAssign(room) { return room.players.size === MAX_PLAYERS && room.phase === 'observing' && room.observationEndsAt && now() >= room.observationEndsAt; }
function assignArchetypes(room, assignments, source = 'server') {
  if (!canAssign(room)) return { ok: false, error: 'Roles can be assigned only after all four players finish the observation period.' };
  if (!Array.isArray(assignments) || assignments.length !== MAX_PLAYERS) return { ok: false, error: 'Exactly four distinct player assignments are required.' };
  const players = new Set(), roles = new Set();
  for (const item of assignments) if (!getPlayer(room, item?.playerId) || !ARCHETYPES.includes(item?.archetype) || players.has(item.playerId) || roles.has(item.archetype)) return { ok: false, error: 'Assignments must contain every current player and every unique role exactly once.' }; else { players.add(item.playerId); roles.add(item.archetype); }
  for (const { playerId, archetype } of assignments) { const player = getPlayer(room, playerId); player.archetype = archetype; player.evolutionBaseline = { movement: player.movement, visited: player.visited.size, relics: player.relicIds.size, near: player.nearSeconds, alone: player.aloneSeconds, risk: player.riskEvents, rescues: player.rescues, interactions: { ...player.interactions }, observationItems: player.observationItems?.size || 0 }; event(room, 'archetype-awakened', `${player.name} has awakened as the ${archetype}.`, { playerId, archetype }); }
  room.phase = 'evolving'; room.archetypesAssignedAt = now(); room.director = { narration: 'Four distinct callings have awakened. The sleeping world begins to listen.', source, at: now() };
  const collector = activePlayers(room).find((item) => item.archetype === 'Collector');
  if (collector) {
    const selection=chooseCollectorEvolutionPlan(collector);
    collector.collectorEvolutionPlan=selection.plan;
    collector.collectorEvolutionReasons=selection.reasons;
    collector.collectorEvolutionIndex=0;
    const labels=selection.plan.map((feature)=>WORLD_EVOLUTIONS.find((item)=>item.archetype==='Collector'&&item.feature===feature)?.title||feature);
    event(room,'collector-plan',COLLECTOR_TEST_ALL_EVOLUTIONS ? `Collector test mode is active. All ${selection.plan.length} Collector evolutions will run in sequence: ${labels.join(', ')}.` : `The Game Master chose two Collector evolutions from your observation behaviour: ${labels.join(' and ')}.`,{playerId:collector.id,privateTo:collector.id,features:selection.plan,reasons:selection.reasons});
    room.nextEvolutionAt = now();
    const openingEvolution = evolve(room, collector.id, 'AI observation selection');
    if (!openingEvolution?.ok) room.nextEvolutionAt = scheduleEvolution();
  } else {
    room.nextEvolutionAt = scheduleEvolution();
  }
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
function scheduleEvolution() { return now() + EVOLUTION_MIN_MS + Math.floor(Math.random() * (EVOLUTION_MAX_MS - EVOLUTION_MIN_MS + 1)); }
function evolutionReady(room) { return ['evolving', 'finale'].includes(room.phase) && room.nextEvolutionAt && now() >= room.nextEvolutionAt; }
function setupCollectorChallenge(room, player, definition) {
  const games = {
    'crystal-mine': { title:'Restore the Crystal Heart', instruction:'Find five cracked patches, dig up every crystal fragment, then return to the mine to rebuild the crystal.', minigame:'crystal-rebuild', goal:5 },
    'ancient-vault': { title:'Decode the Ancient Vault', instruction:'Find rune clues and press the four vault tiles in the correct sequence.', minigame:'sequence', goal:4 },
    'treasure-cache': { title:'Curate the Treasure Cache', instruction:'Use appraisal clues to identify and choose the three genuine relics.', minigame:'appraisal', goal:8 },
    'relic-forge': { title:'Forge the Resonance Core', instruction:'Discover the recipe, heat, hammer and quench the artifact.', minigame:'forge', goal:4 },
    'sunken-relic': { title:'Recover the Sunken Crown', instruction:'Navigate the flooded ruin, avoid broken pillars, use the currents, and reach the crown chamber.', minigame:'current', goal:5 },
  };
  const game=games[definition.feature]; if(!game) return;
  // Remove clue/dig entities from the previous Collector challenge so each stage feels clean.
  room.entities = room.entities.filter((entity)=>!['collector-clue','collector-dig'].includes(entity.type));
  const clues=(COLLECTOR_CLUES[definition.feature]||[]).map(([title,text,sprite],index)=>({id:`clue-${definition.feature}-${index+1}`,title,text,sprite}));
  const positions=[...COLLECTOR_CLUE_POSITIONS].sort(()=>Math.random()-.5).slice(0,clues.length);
  const bonusCount=0;
  player.collectorClues = new Set();
  player.collectorProgress={ evolutionId:definition.id, feature:definition.feature, title:game.title, instruction:game.instruction, minigame:game.minigame, progress:0, goal:game.goal, completed:false, started:false, attempts:0, clues, bonusCount, fragmentsFound:0, forgeAssistHeat:0 };
  if(definition.feature==='crystal-mine') {
    CRYSTAL_DIG_POSITIONS.forEach(([x,z],index)=>room.entities.push({id:`crystal-dig-${index+1}`,type:'collector-dig',x,z,role:'Collector',label:`Buried Crystal Fragment ${index+1}`,sprite:'glowing-gem-cluster',collectedBy:null,interaction:'dig-crystal'}));
  }
  if(definition.feature!=='crystal-mine') clues.forEach((clue,index)=>{const [x,z]=positions[index]||COLLECTOR_CLUE_POSITIONS[index];room.entities.push({id:clue.id,type:'collector-clue',x,z,role:'Collector',label:clue.title,sprite:clue.sprite,clueText:clue.text,collectedBy:null,interaction:'collect-clue'});});
}
function collectorObjectiveText(progress, player){ if(!progress) return null; const found=player?.collectorClues?.size||0; const crystal=progress.feature==='crystal-mine'; const noClues=progress.clues.length===0; const progressText=progress.completed?'Complete':crystal?`${progress.fragmentsFound||0}/5 fragments · ${found}/${progress.clues.length} clues`:noClues?'No clues needed':`${found}/${progress.clues.length} clues`; return { ...progress, clues:progress.clues.filter((clue)=>player?.collectorClues?.has(clue.id)), clueCount:found, clueTotal:progress.clues.length, status:progress.completed?'complete':'active', progressText }; }
function evolveWorld(room, evolutionId, narration, source = 'AI Game Master') {
  if (!evolutionReady(room)) return { ok: false, error: 'The world is still observing how the players respond.' };
  const definition = WORLD_EVOLUTIONS.find((item) => item.id === evolutionId);
  if (!definition) return { ok: false, error: 'Unknown world evolution.' };
  if (room.worldEvolutions.some((item) => item.id === definition.id)) return { ok: false, error: 'That evolution already occurred in this match.' };
  const player = activePlayers(room).find((item) => item.archetype === definition.archetype);
  if (!player) return { ok: false, error: 'That evolution has no matching archetype.' };
  if(definition.archetype==='Collector') {
    const plan=player.collectorEvolutionPlan||[];
    const collectorUsed=room.worldEvolutions.filter((item)=>item.archetype==='Collector').length;
    if(plan.length && !plan.includes(definition.feature)) return {ok:false,error:'The Game Master did not select that Collector evolution for this run.'};
    const collectorLimit=plan.length || (COLLECTOR_TEST_ALL_EVOLUTIONS ? COLLECTOR_SEQUENCE.length : 2);
    if(collectorUsed>=collectorLimit) return {ok:false,error:COLLECTOR_TEST_ALL_EVOLUTIONS?'All Collector test evolutions have already occurred.':'The Collector has already received both AI-selected evolutions for this run.'};
    const expected=plan[Math.min(player.collectorEvolutionIndex||0, plan.length-1)];
    if(expected && definition.feature!==expected) return {ok:false,error:`The next AI-selected Collector evolution is ${expected}.`};
  }
  const message = cleanText(narration, definition.narration, 280);
  room.world.unlocked.add(definition.feature); player.evolutions.push(definition.feature);
  room.entities.push({ ...definition.entity, collectedBy: null });
  if (definition.archetype === 'Collector') setupCollectorChallenge(room, player, definition);
  const entry = { id: definition.id, archetype: definition.archetype, title: definition.title, feature: definition.feature, narration: message, at: now(), source };
  room.worldEvolutions.push(entry); room.nextEvolutionAt = scheduleEvolution();
  room.director = { narration: message, source, at: entry.at, evolutionId: definition.id };
  event(room, 'world-evolution', message, { evolution: entry }); maybeCreateFinale(room, source);
  return { ok: true, evolution: entry, nextEvolutionAt: room.nextEvolutionAt };
}
function evolve(room, playerId, source = 'server') {
  const player = getPlayer(room, playerId); if (!player?.archetype) return { ok: false, error: 'That player has no assigned role.' };
  let candidate;
  if(player.archetype==='Collector') {
    const plan=player.collectorEvolutionPlan?.length ? player.collectorEvolutionPlan : chooseCollectorEvolutionPlan(player).plan;
    if(!player.collectorEvolutionPlan?.length) { player.collectorEvolutionPlan=[...plan]; player.collectorEvolutionReasons=chooseCollectorEvolutionPlan(player).reasons; }
    const index=Math.max(0,player.collectorEvolutionIndex||0);
    const feature=plan[index];
    candidate=feature ? WORLD_EVOLUTIONS.find((item)=>item.archetype==='Collector'&&item.feature===feature&&!room.worldEvolutions.some((used)=>used.id===item.id)) : null;
  } else candidate = WORLD_EVOLUTIONS.find((item) => item.archetype === player.archetype && !room.worldEvolutions.some((used) => used.id === item.id));
  return candidate ? evolveWorld(room, candidate.id, candidate.narration, source) : { ok: false, error: 'No unused evolution remains for that calling.' };
}
function fallbackEvolution(room) {
  const used = new Set(room.worldEvolutions.map((item) => item.id));
  const collector = activePlayers(room).find((player)=>player.archetype==='Collector'); const expectedCollectorFeature=collector?.collectorEvolutionPlan?.[collector.collectorEvolutionIndex||0]; const candidates = WORLD_EVOLUTIONS.filter((item) => !used.has(item.id) && activePlayers(room).some((player) => player.archetype === item.archetype) && !(item.archetype==='Collector' && (!expectedCollectorFeature || item.feature!==expectedCollectorFeature || (collector?.collectorProgress && !collector.collectorProgress.completed))));
  if (!candidates.length) { room.nextEvolutionAt = null; return null; }
  const score = (item) => { const player = activePlayers(room).find((p) => p.archetype === item.archetype); const base = player.evolutionBaseline || {}; const proxy = { ...player, movement: player.movement - (base.movement || 0), visited: { size: Math.max(0, player.visited.size - (base.visited || 0)) }, nearSeconds: player.nearSeconds - (base.near || 0), aloneSeconds: player.aloneSeconds - (base.alone || 0), riskEvents: player.riskEvents - (base.risk || 0), rescues: player.rescues - (base.rescues || 0), relicIds: { size: player.relicIds.size - (base.relics || 0) }, interactions: Object.fromEntries(Object.entries(player.interactions).map(([key,value]) => [key, value - (base.interactions?.[key] || 0)])) }; return (archetypeScores(proxy)[item.archetype] || 0) - room.worldEvolutions.filter((e) => e.archetype === item.archetype).length * 8 + Math.random() * 3; };
  const chosen = [...candidates].sort((a, b) => score(b) - score(a))[0];
  return evolveWorld(room, chosen.id, chosen.narration, 'behaviour-model fallback');
}
function createFinalObjective(room, source = 'server', proposal = {}) { const result = finaleSystem.compose(room, source, proposal); return result.ok ? result.objective : null; }
function maybeCreateFinale() { /* The AI decision window is handled in advanceRoom. */ }
function getEntity(room, targetId) { return room.entities.find((entity) => entity.id === targetId); }
function interact(room, player, type, targetId, intent = {}) {
  if (!['observing', 'evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'Wait until the expedition begins.' };
  const action = cleanText(type, '', 32);
  if (action.startsWith('dungeon-')) return dungeonSystem.interact(room, player, action, cleanText(targetId, '', 48));
  if (action === 'exit-shadow-forest') return shadowForestSystem.exit(room, player);
  if (action === 'moon-shrine-interact') return moonShrineSystem.interact(room, player);
  if (action === 'ghost-village-aim') return ghostVillageSystem.shoot(room, player, { x: Number(intent.aimX), z: Number(intent.aimZ) });
  const entity = getEntity(room, cleanText(targetId, '', 48));
  if (!entity || !['collect-curio','collect-clue','dig-crystal','collector-minigame-start','collector-minigame-complete','forge-bellows-assist','relic', 'discover-temple', 'activate-shrine', 'enter-spirit-realm', 'offer-relics', 'open-final-gate', 'explore-evolution', 'finale-arrive', 'finale-role-step', 'finale-ritual'].includes(action)) return { ok: false, error: 'That interaction target is invalid.' };
  if (distance(player, entity) > 3.25) return { ok: false, error: 'Move closer to interact with that object.' };
  if (action === 'collect-curio') {
    if (room.phase !== 'observing' || entity.type !== 'observation-item') return { ok:false, error:'That object is no longer part of the observation.' };
    if (entity.collectedBy) return { ok:false, error:'Another wanderer already gathered it.' };
    entity.collectedBy=player.id; player.observationItems.add(entity.id); player.interactions[action]=(player.interactions[action]||0)+1;
    event(room,'curio-collected',`${player.name} gathered ${entity.label}.`,{playerId:player.id,targetId:entity.id}); return {ok:true,targetId:entity.id};
  }
  if (action === 'collect-clue') {
    if (!hasRole(player,'Collector') || entity.type !== 'collector-clue') return {ok:false,error:'Only the Collector can interpret this clue.'};
    if (entity.collectedBy) return {ok:false,error:'That clue was already recovered.'};
    const progress=player.collectorProgress; if(!progress || !progress.clues.some((clue)=>clue.id===entity.id)) return {ok:false,error:'This clue does not belong to your active evolution.'};
    entity.collectedBy=player.id; player.collectorClues.add(entity.id); player.interactions[action]=(player.interactions[action]||0)+1;
    event(room,'collector-clue',`${player.name} deciphered ${entity.label}.`,{playerId:player.id,targetId:entity.id,privateTo:player.id}); return {ok:true,targetId:entity.id,clueText:entity.clueText};
  }
  if (action === 'dig-crystal') {
    if (!hasRole(player,'Collector') || entity.type !== 'collector-dig') return {ok:false,error:'Only the Collector can excavate this glowing fracture.'};
    const progress=player.collectorProgress; if(!progress || progress.feature!=='crystal-mine' || progress.completed) return {ok:false,error:'The Crystal Mine is not your active challenge.'};
    if(entity.collectedBy) return {ok:false,error:'This fragment has already been excavated.'};
    entity.collectedBy=player.id; progress.fragmentsFound=(progress.fragmentsFound||0)+1; player.interactions[action]=(player.interactions[action]||0)+1;
    const clueIndex=Math.min(progress.fragmentsFound-1, progress.clues.length-1); const revealedClue=progress.clues[clueIndex];
    if(revealedClue) player.collectorClues.add(revealedClue.id);
    const finished=progress.fragmentsFound>=5; if(finished) progress.instruction='All five fragments are recovered. Return to the Crystal Mine and rebuild the Crystal Heart.';
    event(room,'crystal-excavated',finished?`${player.name} uncovered the final crystal fragment. The Crystal Mine is ready for reconstruction.`:`${player.name} uncovered a buried crystal fragment (${progress.fragmentsFound}/5).`,{playerId:player.id,targetId:entity.id,privateTo:player.id});
    return {ok:true,targetId:entity.id,fragmentsFound:progress.fragmentsFound,readyToRebuild:finished};
  }
  if (action === 'forge-bellows-assist') {
    if (entity.type !== 'world-evolution' || entity.feature !== 'relic-forge') return {ok:false,error:'The bellows can only be helped at the active Relic Forge.'};
    if (hasRole(player,'Collector')) return {ok:false,error:'The Collector already controls the forge directly.'};
    const collector=activePlayers(room).find((candidate)=>candidate.archetype==='Collector' && candidate.collectorProgress?.feature==='relic-forge' && candidate.collectorProgress?.started && !candidate.collectorProgress?.completed);
    if(!collector) return {ok:false,error:'The Collector must begin the Relic Forge challenge first.'};
    collector.collectorProgress.forgeAssistHeat=(collector.collectorProgress.forgeAssistHeat||0)+8;
    player.interactions[action]=(player.interactions[action]||0)+1;
    event(room,'forge-bellows-assist',`${player.name} helps pump the Relic Forge bellows.`,{playerId:player.id,targetId:entity.id,privateTo:collector.id});
    return {ok:true,targetId:entity.id,assistHeat:8};
  }
  if (action === 'collector-minigame-start') {
    if (!hasRole(player,'Collector') || entity.type !== 'world-evolution') return {ok:false,error:'Only the Collector can begin this challenge.'};
    const progress=player.collectorProgress; if(!progress || progress.feature !== entity.feature) return {ok:false,error:'This is not your active Collector evolution.'};
    if(progress.completed) return {ok:false,error:'This Collector challenge is already complete.'};
    if(progress.feature==='crystal-mine' && (progress.fragmentsFound||0)<5) return {ok:false,error:`Excavate all five crystal fragments first (${progress.fragmentsFound||0}/5).`};
    const recoveredClues=progress.clues.filter((clue)=>player.collectorClues.has(clue.id)).length;
    if(progress.feature==='treasure-cache' && recoveredClues < progress.clues.length) return {ok:false,error:`Find all appraisal clues before opening the Treasure Cache (${recoveredClues}/${progress.clues.length}).`};
    progress.started=true; progress.attempts += 1; player.interactions[action]=(player.interactions[action]||0)+1;
    return {ok:true,minigame:progress.minigame,feature:progress.feature,title:progress.title,instruction:progress.instruction,goal:progress.goal,clues:progress.clues.filter((clue)=>player.collectorClues.has(clue.id)),clueTotal:progress.clues.length,observationBonus:progress.bonusCount};
  }
  if (action === 'collector-minigame-complete') {
    if (!hasRole(player,'Collector') || entity.type !== 'world-evolution') return {ok:false,error:'Only the Collector can complete this challenge.'};
    const progress=player.collectorProgress; if(!progress || progress.feature !== entity.feature || !progress.started) return {ok:false,error:'Begin the Collector challenge first.'};
    if(progress.completed) return {ok:false,error:'This Collector challenge is already complete.'};
    progress.progress=progress.goal; progress.completed=true; player.interactions[action]=(player.interactions[action]||0)+1;
    const finishedFeature=progress.feature;
    player.collectorEvolutionIndex=Math.min((player.collectorEvolutionIndex||0)+1, (player.collectorEvolutionPlan||[]).length);
    const hasNext=(player.collectorEvolutionIndex||0)<(player.collectorEvolutionPlan||[]).length;
    const total=(player.collectorEvolutionPlan||[]).length;
    const completed=Math.min(player.collectorEvolutionIndex||0,total);
    const msg=hasNext?`${player.name} completed ${progress.title}. Collector evolution ${completed+1} of ${total} begins to awaken.`:`${player.name} completed ${progress.title}. All ${total} Collector evolutions in this run are complete.`;
    event(room,'collector-evolution-complete',msg,{playerId:player.id,feature:finishedFeature,collectorPlan:player.collectorEvolutionPlan});
    let nextEvolution=null;
    if(hasNext){
      const nextFeature=player.collectorEvolutionPlan[player.collectorEvolutionIndex];
      const nextDef=WORLD_EVOLUTIONS.find((item)=>item.archetype==='Collector'&&item.feature===nextFeature);
      if(nextDef && !room.worldEvolutions.some((used)=>used.id===nextDef.id)){ room.nextEvolutionAt=now(); const result=evolveWorld(room,nextDef.id,nextDef.narration,'AI observation selection'); if(result.ok) nextEvolution=result.evolution; }
    } else {
      room.entities=room.entities.filter((item)=>!['collector-clue','collector-dig'].includes(item.type));
      room.nextEvolutionAt=scheduleEvolution();
    }
    return {ok:true,completed:true,nextEvolution,collectorEvolutionsComplete:!hasNext};
  }
  if (action.startsWith('finale-')) return finaleSystem.interact(room, player, action, entity);
  if (action === 'explore-evolution' && entity.id === 'evolution-shadow-forest-awakens') return shadowForestSystem.enter(room, player);
  if (action === 'explore-evolution' && entity.id === 'evolution-moon-shrine-visible') return moonShrineSystem.enter(room, player);
  if (action === 'explore-evolution' && entity.id === 'evolution-ghost-village-appears') return ghostVillageSystem.enter(room, player);
  if (!hasRole(player, entity.role)) return { ok: false, error: `Only the ${entity.role} can use ${entity.label}.` };
  const expected = { relic: 'relic', 'discover-temple': 'temple-entrance', 'activate-shrine': 'shrine', 'enter-spirit-realm': 'spirit-portal', 'offer-relics': 'altar', 'open-final-gate': 'final-gate', 'explore-evolution': 'world-evolution' }[action];
  if (entity.type !== expected) return { ok: false, error: 'That action does not match this object.' };
  if (entity.feature && !room.world.unlocked.has(entity.feature)) return { ok: false, error: 'That place has not awakened yet.' };
  if (action === 'enter-spirit-realm') return dungeonSystem.enter(room, player);
  if (entity.type === 'relic') { if (entity.collectedBy) return { ok: false, error: 'That relic was already claimed.' }; entity.collectedBy = player.id; player.relicIds.add(entity.id); }
  player.interactions[action] = (player.interactions[action] || 0) + 1;
  const messages = { relic: `${player.name} collected ${entity.label}.`, 'discover-temple': `${player.name} found the hidden temple entrance.`, 'activate-shrine': `${player.name} awakened the shrine.`, 'enter-spirit-realm': `${player.name} stepped through the veil.`, 'offer-relics': `${player.name} offered relics at the altar.`, 'open-final-gate': `${player.name} turned the final gate's spirit key.`, 'explore-evolution': `${player.name} explored the changed world at ${entity.label}.` };
  event(room, action === 'relic' ? 'relic-collected' : 'role-interaction', messages[action], { playerId: player.id, targetId: entity.id }); return { ok: true, targetId: entity.id };
}
function entityVisibleTo(entity, viewer, room) {
  if (!viewer) return true;
  if (entity.finaleOnly) return true;
  if (entity.type === 'observation-item') return room.phase === 'observing' && !entity.collectedBy;
  if (entity.type === 'collector-clue') return viewer.archetype === 'Collector' && !entity.collectedBy;
  if (entity.type === 'collector-dig') return viewer.archetype === 'Collector' && !entity.collectedBy && viewer.collectorProgress?.feature==='crystal-mine';
  if (entity.type === 'world-evolution') return room.world.unlocked.has(entity.feature);
  if (entity.type === 'relic') return viewer.archetype === 'Collector';
  if (entity.feature && !room.world.unlocked.has(entity.feature)) return false;
  return entity.role === viewer.archetype || !entity.role;
}
function serializeRoom(room, viewerId = null) {
  advanceRoom(room); const viewer = viewerId && getPlayer(room, viewerId); const privateUnlocks = viewer ? [...(room.world.privateUnlocks.get(viewer.id) || [])] : [];
  const directorRules = room.directorState || { activeRules: [], history: [] };
  const visibleRules = (directorRules.activeRules || []).filter((rule) => !rule.playerId || !viewerId || rule.playerId === viewerId);
  const entities = room.entities.filter((entity) => entityVisibleTo(entity, viewer, room)).map(({ id, type, x, z, label, role, terrain, collectedBy, feature, interaction, transformed, sprite }) => ({ id, type, x, z, label, requiredRole: role, role, terrain, collectedBy, feature, interaction, action: type === 'observation-item' ? 'collect-curio' : type === 'collector-clue' ? 'collect-clue' : type === 'collector-dig' ? 'dig-crystal' : (type === 'world-evolution' && role === 'Collector' ? (viewer?.archetype === 'Collector' ? 'collector-minigame-start' : (feature === 'relic-forge' && activePlayers(room).some((p)=>p.archetype==='Collector' && p.collectorProgress?.feature==='relic-forge' && p.collectorProgress?.started && !p.collectorProgress?.completed) ? 'forge-bellows-assist' : interaction)) : interaction), transformed, sprite }));
  if (viewer?.realm === 'dungeon') entities.push(...dungeonSystem.entities(viewer));
  const visibleTerrain = TERRAIN_OVERLAYS.filter((area) => !viewer || area.role === viewer.archetype).map(({ id, kind, role, label, x, z, w, h }) => ({ id, kind, requiredRole: role, label, x, z, w, h }));
  return { code: room.code, phase: room.phase, playerCount: room.players.size, requiredPlayers: MAX_PLAYERS, observationEndsAt: room.observationEndsAt, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, nextEvolutionAt: room.nextEvolutionAt, evolutionSecondsRemaining: room.nextEvolutionAt ? Math.max(0, Math.ceil((room.nextEvolutionAt - now()) / 1000)) : null, finaleSecondsRemaining: room.archetypesAssignedAt ? Math.max(0, Math.ceil((room.archetypesAssignedAt + FINALE_MIN_MATCH_MS - now()) / 1000)) : null, finaleEligible: Boolean(finaleSystem?.eligibility(room).ok), worldEvolutions: room.worldEvolutions, evolutionHistory: room.worldEvolutions,
    players: activePlayers(room).map((p) => ({ id: p.id, name: p.name, color: p.color, sprite: p.sprite, facing: p.facing, moving: Math.hypot(p.inputX,p.inputZ)>0, x: p.x, z: p.z, tileX: p.realm !== 'overworld' ? p.x : undefined, tileY: p.realm !== 'overworld' ? p.z : undefined, realm: p.realm || 'overworld', dungeon: p.id === viewerId ? p.dungeon : undefined, shadowForest: p.id === viewerId ? p.shadowForest : undefined, moonShrine: p.id === viewerId ? p.moonShrine : undefined, ghostVillage: p.id === viewerId ? p.ghostVillage : undefined, locationId: p.locationId, archetype: p.archetype, capabilities: p.id === viewerId ? ROLE_ABILITIES[p.archetype] || [] : undefined, relicCount: p.relicIds.size, observationCount: p.observationItems?.size || 0, forgeAssistHeat: p.id === viewerId ? (p.collectorProgress?.forgeAssistHeat || 0) : undefined, collectorEvolutionPlan: p.id === viewerId && p.archetype === 'Collector' ? p.collectorEvolutionPlan : undefined, collectorEvolutionReasons: p.id === viewerId && p.archetype === 'Collector' ? p.collectorEvolutionReasons : undefined, collectorObjective: p.id === viewerId ? collectorObjectiveText(p.collectorProgress,p) : (p.archetype === 'Collector' && p.collectorProgress ? { title:p.collectorProgress.title, completed:p.collectorProgress.completed, status:p.collectorProgress.completed?'complete':'in-progress' } : null), evolutions: p.evolutions, dungeonCompletions: p.dungeonCompletions || 0 })),
    relics: entities.filter((entity) => entity.type === 'relic'), entities, terrain: visibleTerrain,
    world: { unlocked: [...room.world.unlocked], privateUnlocks }, finalObjective: room.finalObjective, director: room.director,
    directorRules: { activeRules: visibleRules, history: (directorRules.history || []).slice(-8) }, events: room.events.slice(-8), yourPrivateRules: viewer?.privateRules || [] };
}
function broadcastState(room) { for (const player of activePlayers(room)) io.to(player.id).emit('world-state', serializeRoom(room, player.id)); }
function recordTelemetry(room, player, payload = {}, positionIsAuthoritative = false) {
  if (!['observing', 'evolving', 'finale'].includes(room.phase)) return;
  // Browser telemetry is behavioural context, not a movement authority. Only the
  // fixed server tick can supply a position, preventing client-side teleports.
  const x = positionIsAuthoritative ? clamp(payload.x ?? payload.position?.x, WORLD_MIN_X, WORLD_MAX_X) : player.x;
  const z = positionIsAuthoritative ? clamp(payload.z ?? payload.position?.z, WORLD_MIN_Z, WORLD_MAX_Z) : player.z;
  const next = (player.realm === 'dungeon' ? dungeonSystem.canEnter(x, z) : canEnterTile(player, x, z)) ? { x, z } : { x: player.x, z: player.z };
  const travelled = Math.min(2, Math.hypot(next.x - player.x, next.z - player.z)); if (travelled) { player.movement += travelled; player.movementSamples += 1; }
  // Discovery is derived exclusively from the server-accepted position.  Do not
  // accept client-reported visited locations: they feed role assignment scores.
  player.x = next.x; player.z = next.z; player.locationId = player.realm === 'dungeon' ? 'spirit-dungeon' : locationFor(next.x, next.z); if (player.realm !== 'dungeon') player.visited.add(player.locationId); player.lastTelemetryAt = now();
}
function tickRoom(room, delta) {
  world.directorRules.expire(room);
  const activeRules = room.directorState?.activeRules || [];
  const hasObstacle = activeRules.some((rule) => rule.card === 'temporary_obstacle');
  if (['observing', 'evolving', 'finale'].includes(room.phase)) for (const player of activePlayers(room)) { const magnitude = Math.hypot(player.inputX, player.inputZ); if (magnitude && !['shadow-forest', 'moon-shrine', 'ghost-village'].includes(player.realm)) { const swiftStep = activeRules.some((rule) => rule.card === 'temporary_boon' && rule.playerId === player.id && rule.boonId === 'swift_step'); const speed = 8 * (swiftStep ? 1.35 : 1) * (hasObstacle ? 0.82 : 1); recordTelemetry(room, player, { x: player.x + player.inputX / magnitude * speed * delta, z: player.z + player.inputZ / magnitude * speed * delta }, true); } const closest = closestDistance(room, player); if (closest <= 9) player.nearSeconds += delta; else player.aloneSeconds += delta; }
  for (const player of activePlayers(room)) if (player.realm === 'dungeon') dungeonSystem.tick(room, player, delta);
  for (const player of activePlayers(room)) if (player.realm === 'shadow-forest') shadowForestSystem.tick(room, player, delta);
  for (const player of activePlayers(room)) if (player.realm === 'moon-shrine') moonShrineSystem.tick(room, player, delta);
  for (const player of activePlayers(room)) if (player.realm === 'ghost-village') ghostVillageSystem.tick(room, player, delta);
  advanceRoom(room);
}
function advanceRoom(room) {
  // A live Game Master gets a short decision window after observation; the
  // deterministic model remains available as a no-stall fallback.
  if (room.phase === 'observing' && room.players.size === MAX_PLAYERS && room.observationEndsAt && now() >= room.observationEndsAt + GM_ASSIGNMENT_GRACE_MS) {
    event(room, 'gm-narration', 'The observation ends. Four distinct callings awaken.');
    assignArchetypes(room, calculateAssignments(room), 'behaviour-model fallback');
  }
  // Give the live AI one decision grace period, then guarantee that the world
  // still evolves on schedule when no external Game Master is running.
  if (evolutionReady(room) && now() >= room.nextEvolutionAt + EVOLUTION_GM_GRACE_MS) fallbackEvolution(room);
  if (!room.finalObjective && room.archetypesAssignedAt && now() - room.archetypesAssignedAt >= FINALE_MIN_MATCH_MS + FINALE_GM_GRACE_MS && finaleSystem.eligibility(room).ok) finaleSystem.compose(room, 'behaviour-model fallback');
  finaleSystem.advance(room);
}

const world = { rooms, observationMs: OBSERVATION_MS, cleanText, clamp, getPlayer, playerTelemetry, createRoom, createPlayer, resetRoomForRoster, beginObservation, roomTelemetry, markGmActive, event, assignArchetypes, unlock, evolve, evolveWorld, createFinalObjective, serializeRoom, broadcastState, recordTelemetry, interact };
finaleSystem = createFinaleSystem(world, { minimumMatchMs: FINALE_MIN_MATCH_MS, resetAfterMs: FINALE_RESET_MS });
dungeonSystem = createDungeonSystem(world);
shadowForestSystem = createShadowForestSystem(world);
moonShrineSystem = createMoonShrineSystem(world);
ghostVillageSystem = createGhostVillageSystem(world);
world.directorRules = createDirectorRules(world);
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
