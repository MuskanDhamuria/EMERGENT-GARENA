// Authoritative game domain. This module owns room state, movement, role
// assignment, interactions, serialization and ticks. It deliberately knows
// nothing about HTTP, Socket.IO, files, or browser rendering.

import { ARCHETYPES, CAVE_DEMON_MAX_HEALTH, CAVE_PLAYER_MAX_HEALTH, CAVE_SHARD_TOTAL, CONTENT_VERSION, DARK_CAVE_POINTS, DARK_CAVE_RIFTS, ENCOUNTER_TACTICS, ENCOUNTER_TACTIC_IDS, ENTITY_DEFINITIONS, EVERDAWN_SHARD_TOTAL, EVOLUTION_LIBRARY, EXPEDITION_FEATURES, EXPEDITION_IDS, FEATURES, HIDDEN_RUINS_POINTS, MAX_PLAYERS, OBSERVATION_MS, ROLE_ABILITIES, RUINS_MUMMY_MAX_HEALTH, RUINS_SHARD_TOTAL, TEMPLE_SHARD_TOTAL, TERRAIN_OVERLAYS, WORLD_EVOLUTIONS } from '../shared/game-content.js';
import { createDirectorRules } from './director-rules.mjs';
import { createEmergentRules } from './emergent-rules.mjs';
import { createPortalSystem } from './portal-system.mjs';
import { createRealmSystem } from './realm-system.mjs';
import { createGameMasterGuidance } from './gm-guidance.mjs';
import { createCollectorSystem } from './collector-system.mjs';
import { createLanternRiteSystem } from './lantern-rite-system.mjs';
import { createFinaleSystem, chooseFinaleVariant, FINALE_COMPLICATIONS } from './finale-system.mjs';

const ACTIVE_PHASES = new Set(['observing', 'evolving', 'finale']);
const ROLE_ACTIONS = Object.freeze({ relic: 'relic', 'discover-temple': 'temple-entrance', 'trace-waystone': 'waystone', 'enter-dark-cave': 'cave', 'exit-dark-cave': 'cave-exit', 'enter-sunken-temple': 'temple-entrance', 'exit-sunken-temple': 'temple-exit', 'enter-hidden-ruins': 'ruins-entrance', 'exit-hidden-ruins': 'ruins-exit', 'activate-shrine': 'shrine', 'enter-spirit-realm': 'spirit-portal', 'enter-shadow-forest': 'realm-portal', 'enter-moon-shrine': 'realm-portal', 'enter-ghost-village': 'realm-portal', 'enter-final-temple': 'finale-entrance', 'offer-relics': 'altar', 'open-final-gate': 'final-gate' });
const MASTERY_ACTIONS = Object.freeze({ relic: 'Echo Water relic', 'discover-temple': 'hidden route', 'enter-dark-cave': 'hidden cavern', 'enter-sunken-temple': 'hidden route', 'enter-hidden-ruins': 'forgotten arch', 'activate-shrine': 'shrine rite', 'enter-spirit-realm': 'spirit path' });
const INTERACTION_MESSAGES = Object.freeze({ relic: (player, entity) => `${player.name} collected ${entity.label}.`, 'discover-temple': (player) => `${player.name} found the hidden temple entrance.`, 'trace-waystone': (player) => `${player.name} traced the route through the old waystone.`, 'enter-dark-cave': (player) => `${player.name} opened the way into the Black Hollow.`, 'exit-dark-cave': (player) => `${player.name} climbed back into the western forest.`, 'enter-sunken-temple': (player) => `${player.name} descended into the Sunken Temple.`, 'exit-sunken-temple': (player) => `${player.name} returned from the Sunken Temple.`, 'enter-hidden-ruins': (player) => `${player.name} crossed the buried arch into the Hidden Ruins.`, 'exit-hidden-ruins': (player) => `${player.name} returned from the Hidden Ruins.`, 'activate-shrine': (player) => `${player.name} awakened the shrine.`, 'enter-spirit-realm': (player) => `${player.name} stepped through the veil.`, 'offer-relics': (player) => `${player.name} offered relics at the altar.`, 'open-final-gate': (player) => `${player.name} turned the final gate's spirit key.` });
const FINALE_TASKS = Object.freeze({ Explorer: 'cross one of the awakened thresholds', Collector: 'complete two AI-shaped relic rites or recover two tale shards', Guardian: 'activate the awakened shrine', Loner: 'open the final gate' });
const SHARD_PREFIX_BY_EXPEDITION = Object.freeze({ 'dark-cave': 'gloom-shard-', 'sunken-temple': 'tideglass-shard-', 'hidden-ruins': 'sunstone-shard-' });
const EVERDAWN_SHARD_PREFIX = 'everdawn-shard-';
const isTaleShard = (room, entity) => room.world.selectedExpeditions.some((id) => entity.id.startsWith(SHARD_PREFIX_BY_EXPEDITION[id])) || entity.id.startsWith(EVERDAWN_SHARD_PREFIX);
// Each tale opens two of three expeditions. The AI still reads behaviour to
// shape roles, encounters, trials, and narration; this small fair rotation
// only prevents one map being starved across a run of otherwise similar tales.
const EXPEDITION_PAIR_CYCLE = Object.freeze([
  Object.freeze(['hidden-ruins', 'dark-cave']),
  Object.freeze(['hidden-ruins', 'sunken-temple']),
  Object.freeze(['dark-cave', 'sunken-temple']),
]);
const AI_EXPEDITION_SOURCES = new Set(['AI Game Master', 'MCP Game Master', 'behaviour-model fallback']);

function freshEmergentState() { return { activeRules: [], history: [], nextId: 0, lastAnalyzedAt: 0, cooldowns: {}, observations: { pairs: {}, guardianSeconds: 0, lonerSeconds: 0 } }; }
function freshPlayerEmergentState() { return { energy: 100, activeRuleIds: [], effects: [] }; }
function freshAiDirector() { return { decisions: [], sequence: 0, milestones: [] }; }
function freshCaveCombat() {
  return {
    cleared: false,
    tacticId: null, tacticSource: null, tacticReason: null, tacticRevision: 0, tacticAnnounced: false,
    enemies: [
      { id: 'claw-fiend', name: 'Claw Fiend', sprite: 'claw-fiend', x: -8, z: -6, health: CAVE_DEMON_MAX_HEALTH, maxHealth: CAVE_DEMON_MAX_HEALTH, lastAttackAt: -Infinity, hitUntil: 0, attackUntil: 0, targetId: null },
      { id: 'bone-wing', name: 'Bone Wing', sprite: 'bone-wing', x: 8, z: -4, health: CAVE_DEMON_MAX_HEALTH, maxHealth: CAVE_DEMON_MAX_HEALTH, lastAttackAt: -Infinity, hitUntil: 0, attackUntil: 0, targetId: null },
      { id: 'night-blade', name: 'Night Blade', sprite: 'night-blade', x: -1, z: 3, health: CAVE_DEMON_MAX_HEALTH, maxHealth: CAVE_DEMON_MAX_HEALTH, lastAttackAt: -Infinity, hitUntil: 0, attackUntil: 0, targetId: null },
    ],
  };
}
function freshRuinsCombat() {
  return {
    cleared: false,
    tacticId: null, tacticSource: null, tacticReason: null, tacticRevision: 0, tacticAnnounced: false,
    enemies: [
      { id: 'mummy-warden', name: 'Mummy Warden', sprite: 'mummy-lord', x: -7, z: -4, health: RUINS_MUMMY_MAX_HEALTH, maxHealth: RUINS_MUMMY_MAX_HEALTH, lastAttackAt: -Infinity, hitUntil: 0, attackUntil: 0, targetId: null, variant: 0 },
      { id: 'mummy-seer', name: 'Mummy Seer', sprite: 'mummy-lord', x: 7, z: -4, health: RUINS_MUMMY_MAX_HEALTH, maxHealth: RUINS_MUMMY_MAX_HEALTH, lastAttackAt: -Infinity, hitUntil: 0, attackUntil: 0, targetId: null, variant: 1 },
    ],
  };
}
function freshTempleCombat() {
  // The Sunken Temple is an exploration space, not another mummy fight.
  // Its Tideglass is ready for the Collector once the party reaches it.
  return {
    cleared: true,
    tacticId: null, tacticSource: null, tacticReason: null, tacticRevision: 0, tacticAnnounced: false,
    enemies: [],
  };
}

/**
 * Create a self-contained world service. Transport callbacks are injected, so
 * tests and alternate hosts can use the same rules without Socket.IO.
 */
export function createGameWorld({ rooms = new Map(), collisionTiles = [], observationMs = OBSERVATION_MS, gmAssignmentGraceMs = 0, emergentOptions = {}, unlockAllLonerPortals = false, emitEvent = () => {}, emitState = () => {}, clock = () => Date.now() } = {}) {
  // The forest artwork is 60 by 34 tiles.  Its southern grass bank occupies
  // the final playable row, so keep it inside the authoritative world rather
  // than leaving a green-but-unreachable strip below the lake.
  const worldBounds = { minX: -29, maxX: 28, minZ: -16, maxZ: 16, mapWidth: 60, offsetX: 30, offsetZ: 17 };
  const colors = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
  const playerSprites = [1, 2, 3, 5];
  const fallbackLonerPlan = Object.freeze(['spirit-realm', 'shadow-forest']);
  const initialUnlocks = () => new Set(unlockAllLonerPortals ? ['starting-village', 'spirit-realm', 'shadow-forest', 'moon-shrine', 'ghost-village'] : ['starting-village']);
  const spawns = [[-6, 0], [-4, 0], [-5, 2], [-3, 2]];
  const now = () => clock();
  const portals = createPortalSystem({ clock: now });
  let realms;
  let collector;
  let lanternRite;
  let muskanFinale;
  let expeditionDraftCursor = 0;
  const cleanText = (value, fallback = '', maximum = 220) => typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum) || fallback : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const players = (room) => [...room.players.values()];
  const getPlayer = (room, id) => room.players.get(id);
  const zoneOf = (item) => item?.zone || 'overworld';
  const distance = (left, right) => zoneOf(left) === zoneOf(right) ? Math.hypot(left.x - right.x, left.z - right.z) : Infinity;
  const hasRole = (player, role) => player?.archetype === role;
  const segmentDistance = (x, z, start, end) => { const dx = end.x - start.x, dz = end.z - start.z, length = dx * dx + dz * dz; const t = length ? Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / length)) : 0; return Math.hypot(x - (start.x + dx * t), z - (start.z + dz * t)); };
  const polygonContains = (points, x, z) => {
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
      const [ix, iz] = points[index], [px, pz] = points[previous];
      if (segmentDistance(x, z, { x: px, z: pz }, { x: ix, z: iz }) <= .25) return true;
      if ((iz > z) !== (pz > z) && x < ((px - ix) * (z - iz)) / (pz - iz) + ix) inside = !inside;
    }
    return inside;
  };
  const areaContains = (area, x, z, padding = 0) => Array.isArray(area.points) && area.points.length > 1
    ? area.points.slice(1).some((point, index) => segmentDistance(x, z, area.points[index], point) <= (area.pathWidth || 1) / 2 + padding)
    : x >= area.x - padding && x <= area.x + area.w - 1 + padding && z >= area.z - padding && z <= area.z + area.h - 1 + padding;
  // This is the shoreline from the authored forest map, expressed in world
  // coordinates.  It deliberately follows the stepped left bank instead of
  // using one large rectangle: grass stays walkable and the visible blue lake
  // is never walkable.  Keep this together with forest.json if the map moves.
  const lakeLeftBank = Object.freeze({ 7: 9, 8: 8, 9: 16, 10: 16, 11: 6, 12: 6, 13: 6, 14: 7, 15: 7, 16: 7 });
  const isLakeWater = (x, z) => Number.isFinite(lakeLeftBank[Math.round(z)]) && x >= lakeLeftBank[Math.round(z)] && x <= 29;
  const terrainAt = (x, z, zone = 'overworld') => zone === 'overworld' ? TERRAIN_OVERLAYS.find((area) => areaContains(area, x, z)) : null;
  const locationFor = (x, z, zone = 'overworld') => zone === 'sunken-temple' ? 'sunken-temple' : zone === 'dark-cave' ? 'dark-cave' : zone === 'hidden-ruins' ? 'hidden-ruins' : isLakeWater(x, z) || terrainAt(x, z)?.kind === 'water' ? 'lake-of-echoes' : terrainAt(x, z)?.kind === 'bridge' ? 'sacred-shrine' : terrainAt(x, z)?.kind === 'spirit' ? 'spirit-realm' : x < -15 && z < -5 ? 'whispering-forest' : x > 14 && z > 7 ? 'ancient-temple' : 'starting-village';
  const riftAt = (x, z) => DARK_CAVE_RIFTS.find((rift) => (((x - rift.x) / rift.radiusX) ** 2 + ((z - rift.z) / rift.radiusZ) ** 2) <= 1);
  const caveWalkable = (x, z) => polygonContains(DARK_CAVE_POINTS, x, z) && !riftAt(x, z);
  const ruinsWalkable = (x, z) => polygonContains(HIDDEN_RUINS_POINTS, x, z);
  const canEnterTile = (room, player, x, z) => {
    if (zoneOf(player) === 'dark-cave') return caveWalkable(x, z);
    if (zoneOf(player) === 'hidden-ruins') return ruinsWalkable(x, z);
    if (zoneOf(player) === 'sunken-temple') {
      return (x >= -16 && x <= 16 && z >= -5 && z <= 5)
        || (x >= -9 && x <= 9 && z >= -11 && z <= -5)
        || (x >= -4 && x <= 4 && z >= 5 && z <= 14);
    }
    if (isLakeWater(x, z)) return false;
    return x >= worldBounds.minX && x <= worldBounds.maxX && z >= worldBounds.minZ && z <= worldBounds.maxZ;
  };
  const event = (room, type, message, options = {}) => {
    const item = { id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, at: now(), type, message: cleanText(message, 'The world shifts.'), ...options };
    room.events.push(item); if (room.events.length > 40) room.events.shift(); emitEvent(room, item); return item;
  };
  const guidance = createGameMasterGuidance({ event, now });
  const recordAiDecision = (room, type, choice, reason, source = 'AI Game Master', details = {}) => {
    room.aiDirector ||= freshAiDirector();
    const decision = {
      id: `ai-${++room.aiDirector.sequence}-${now()}`,
      at: now(), type, choice: cleanText(choice, type, 80),
      reason: cleanText(reason, 'The decision followed the group\'s observed behaviour.', 220),
      source: cleanText(source, 'AI Game Master', 48), ...details,
    };
    room.aiDirector.decisions.push(decision);
    if (room.aiDirector.decisions.length > 30) room.aiDirector.decisions.shift();
    return decision;
  };
  const pendingAiDecisions = (room) => {
    const pending = [];
    if (room.phase === 'observing' && room.observationEndsAt && now() >= room.observationEndsAt && !players(room).some((player) => player.archetype)) pending.push({ type: 'assign-archetypes', priority: 'critical' });
    for (const expeditionId of room.world.selectedExpeditions || []) {
      const combat = expeditionId === 'dark-cave' ? room.caveCombat : expeditionId === 'hidden-ruins' ? room.ruinsCombat : null;
      if (combat && !combat.tacticId) pending.push({ type: 'adapt-encounter', expeditionId, allowedTactics: ENCOUNTER_TACTIC_IDS });
    }
    if (['evolving', 'finale'].includes(room.phase)) for (const player of players(room)) {
      if (player.archetype === 'Loner' && !player.lonerPlan) pending.push({ type: 'choose-loner-missions', playerId: player.id, choices: EVOLUTION_LIBRARY.Loner.map(([feature]) => feature), count: 2, priority: 'high' });
      if (player.archetype && availableEvolutionSteps(room, player)?.some(([feature]) => !player.evolutions.includes(feature))) pending.push({ type: 'evolve-player', playerId: player.id, archetype: player.archetype });
    }
    if (room.phase === 'evolving' && !room.finalObjective && players(room).length === MAX_PLAYERS && players(room).every((player) => player.archetype && player.evolutions.length)) pending.push({ type: 'create-finale', priority: 'high' });
    return pending;
  };

  function guardianTrialIds(player) {
    // A small, explainable behaviour policy: protective company prioritises
    // escort rites, while a more solitary Guardian receives route/ward rites.
    const social = player.nearSeconds + player.follows * 8 + player.rescues * 5;
    return social >= player.aloneSeconds
      ? ['lost-lanterns', 'shrine-of-return']
      : ['wardkeepers-circuit', 'shelter-march'];
  }
  function guardianPortalEntities(room) {
    const guardian = players(room).find((player) => player.archetype === 'Guardian' && player.guardianPortal);
    if (!guardian || !guardian.evolutions.includes('healing-shrine')) return [];
    const ids = guardian.guardianPortal.selectedTrialIds;
    return ids.map((trialId, index) => ({ id: `guardian-portal-${index + 1}`, type: 'guardian-portal', x: 10 + index * 5, z: -5, role: 'Guardian', label: index ? 'Second Warden Portal' : 'Warden Portal', feature: 'healing-shrine', action: 'enter-guardian-portal', trialId }));
  }
  function objectiveCount(player) {
    if (player.archetype === 'Guardian') return player.guardianPortal?.completedTrialIds?.length || 0;
    if (player.archetype === 'Collector') return Math.min(2, Math.max(player.relicIds.size, player.collector?.completed?.size || 0));
    return player.roleObjectives?.size || 0;
  }
  // Explorer and Collector still use ordinary overworld interactions in this
  // build. Until they receive dedicated two-goal portal tracks, the finale
  // gate waits only for the two roles that do have authored personal rites.
  function hasDefinedFinaleObjectives(player) { return ['Guardian', 'Loner'].includes(player.archetype); }
  function recordRoleObjective(room, player, id) {
    player.roleObjectives ||= new Set();
    const before = player.roleObjectives.size; player.roleObjectives.add(id);
    if (player.roleObjectives.size > before) event(room, 'portal-objective', `${player.name} completed a ${player.archetype} rite (${objectiveCount(player)}/2).`, { playerId: player.id, archetype: player.archetype, objectiveId: id });
    maybeRevealFinaleEntrance(room);
  }
  // Muskan's finale reads a compact, inspectable history of what actually
  // emerged in this tale. Keeping that adapter here avoids a second world
  // state machine inside the finale module.
  function worldEvolutionFor(player, feature) {
    return WORLD_EVOLUTIONS.find((item) => item.archetype === player?.archetype && item.feature === feature)
      || WORLD_EVOLUTIONS.find((item) => item.archetype === player?.archetype && item.id === feature)
      || null;
  }
  function recordFinaleEvolution(room, player, feature, { complete = false, source = 'world' } = {}) {
    const evolution = worldEvolutionFor(player, feature);
    if (!evolution) return null;
    room.worldEvolutions ||= [];
    const existing = room.worldEvolutions.find((item) => item.id === evolution.id);
    const record = existing || { ...evolution, awakenedAt: now(), source };
    if (!existing) room.worldEvolutions.push(record);
    if (complete) {
      player.completedEvolutions ||= new Set();
      player.completedEvolutions.add(evolution.id);
      record.completedAt ||= now();
      record.completedBy ||= player.id;
    }
    if (room.finalObjective) room.finalObjective.worldEvolutions = room.worldEvolutions.map((item) => ({ ...item }));
    return record;
  }
  function synchronizeLonerCompletions(room, player) {
    if (player?.archetype !== 'Loner') return;
    for (const completedId of player.completedEvolutions || []) {
      const evolution = WORLD_EVOLUTIONS.find((item) => item.archetype === 'Loner' && item.id === completedId);
      if (evolution) recordFinaleEvolution(room, player, evolution.feature, { complete: true, source: 'realm-completion' });
    }
  }

  function createRoom(code) {
    const createdAt = now();
    return { code, createdAt, phase: 'waiting-for-four', observationEndsAt: null, players: new Map(), entities: ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null })), caveCombat: freshCaveCombat(), ruinsCombat: freshRuinsCombat(), templeCombat: freshTempleCombat(), world: { unlocked: initialUnlocks(), privateUnlocks: new Map(), selectedExpeditions: [] }, worldEvolutions: [], finaleCompositionHistory: [], events: [], finalObjective: null, finaleEntrance: null, templeFinale: null, archetypesAssignedAt: null, gmActiveUntil: 0, aiDirector: freshAiDirector(), directorState: { activeRules: [], history: [], sequence: 0 }, emergentState: freshEmergentState(), director: { narration: 'Four lanterns are needed before this shared tale can begin.', source: 'server', at: createdAt } };
  }
  function createPlayer(id, name, index) {
    const [x, z] = spawns[index];
    return { id, name: cleanText(name, 'Wanderer', 16), color: colors[index], sprite: playerSprites[index], facing: 'down', x, z, zone: 'overworld', realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, inputX: 0, inputZ: 0, locationId: locationFor(x, z), visited: new Set(['starting-village']), relicIds: new Set(), roleObjectives: new Set(), guardianPortal: null, collector: null, completedEvolutions: new Set(), evolutionBaseline: null, interactions: {}, movement: 0, movementSamples: 0, nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, archetype: null, evolutions: [], privateRules: [], guidanceSeen: new Set(), guidance: null, emergent: freshPlayerEmergentState(), health: CAVE_PLAYER_MAX_HEALTH, maxHealth: CAVE_PLAYER_MAX_HEALTH, hurtUntil: 0, lastDamage: 0, caveLocked: false, ruinsLocked: false, templeLocked: false, caveSafeX: 0, caveSafeZ: 11, portalCooldownUntil: 0, lastCombatAttackAt: -Infinity, lastCaveAttackAt: -Infinity, lastTelemetryAt: now() };
  }
  function resetRoomForRoster(room, reason) {
    Object.assign(room, { phase: 'waiting-for-four', observationEndsAt: null, archetypesAssignedAt: null, finalObjective: null, finaleEntrance: null, templeFinale: null, world: { unlocked: initialUnlocks(), privateUnlocks: new Map(), selectedExpeditions: [] }, worldEvolutions: [], finaleCompositionHistory: [], aiDirector: freshAiDirector(), directorState: { activeRules: [], history: [], sequence: 0 }, emergentState: freshEmergentState(), entities: ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null })), caveCombat: freshCaveCombat(), ruinsCombat: freshRuinsCombat(), templeCombat: freshTempleCombat() });
    for (const [index, player] of players(room).entries()) {
      const [x, z] = spawns[index];
      Object.assign(player, { x, z, color: colors[index], sprite: playerSprites[index], facing: 'down', zone: 'overworld', realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, inputX: 0, inputZ: 0, locationId: locationFor(x, z), archetype: null, evolutions: [], visited: new Set(['starting-village']), relicIds: new Set(), roleObjectives: new Set(), guardianPortal: null, collector: null, completedEvolutions: new Set(), evolutionBaseline: null, interactions: {}, movement: 0, movementSamples: 0, nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, privateRules: [], guidanceSeen: new Set(), guidance: null, emergent: freshPlayerEmergentState(), health: CAVE_PLAYER_MAX_HEALTH, maxHealth: CAVE_PLAYER_MAX_HEALTH, hurtUntil: 0, lastDamage: 0, caveLocked: false, ruinsLocked: false, templeLocked: false, caveSafeX: 0, caveSafeZ: 11, portalCooldownUntil: 0, lastCombatAttackAt: -Infinity, lastCaveAttackAt: -Infinity });
    }
    room.director = { narration: reason, source: 'server', at: now() };
  }
  function beginObservation(room) {
    if (room.players.size !== MAX_PLAYERS) return;
    room.phase = 'observing'; room.observationEndsAt = now() + observationMs; room.director = { narration: 'All four lanterns are lit. The Game Master is observing your first choices.', source: 'server', at: now() }; event(room, 'four-player-start', 'All four lanterns are lit. The shared tale has begun.');
    guidance.introduce(room, players(room));
  }
  function playerTelemetry(room, player) {
    const elapsed = Math.max(1, (now() - (room.observationEndsAt ? room.observationEndsAt - observationMs : room.createdAt)) / 1000);
    const base = player.evolutionBaseline || {};
    return { id: player.id, name: player.name, location: player.locationId, locationsDiscovered: player.visited.size, relicsCollected: player.relicIds.size, interactions: player.interactions, distanceTravelled: Math.round(player.movement), nearGroupSeconds: Math.round(player.nearSeconds), aloneSeconds: Math.round(player.aloneSeconds), riskEvents: player.riskEvents, rescues: player.rescues, follows: player.follows, cohesion: Number((player.nearSeconds / elapsed).toFixed(2)), postAssignment: { distanceTravelled: Math.max(0, Math.round(player.movement - (base.movement || 0))), nearGroupSeconds: Math.max(0, Math.round(player.nearSeconds - (base.near || 0))), aloneSeconds: Math.max(0, Math.round(player.aloneSeconds - (base.alone || 0))), relicsCollected: Math.max(0, player.relicIds.size - (base.relics || 0)), riskEvents: Math.max(0, player.riskEvents - (base.risk || 0)), rescues: Math.max(0, player.rescues - (base.rescues || 0)), follows: Math.max(0, player.follows - (base.follows || 0)) } };
  }
  function roomTelemetry(room) { return { roomCode: room.code, phase: room.phase, playerCount: room.players.size, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, players: players(room).map((player) => playerTelemetry(room, player)), relicsCollected: room.entities.filter((entity) => entity.type === 'relic' && entity.collectedBy).length, unlockedFeatures: [...room.world.unlocked], finalObjective: room.finalObjective, emergentRuleTypes: (room.emergentState?.activeRules || []).map((rule) => rule.type), aiDecisionWindows: pendingAiDecisions(room), encounterPlans: { 'dark-cave': room.caveCombat.tacticId, 'hidden-ruins': room.ruinsCombat.tacticId } }; }
  function scoreArchetypes(player) { return { Explorer: player.visited.size * 3 + player.movement / 30 + player.riskEvents * 2, Collector: (player.observationItems?.size || 0) * 14 + (player.interactions['collect-curio'] || 0) * 3 + player.relicIds.size * 9 + (player.interactions.relic || 0) * 2, Guardian: player.nearSeconds / 3 + player.rescues * 8 + (player.interactions['activate-shrine'] || 0) * 2 + player.follows, Loner: player.aloneSeconds / 3 + player.visited.size + (player.interactions['enter-spirit-realm'] || 0) * 3 }; }
  function calculateAssignments(room) {
    const group = players(room); if (group.length !== MAX_PLAYERS) return [];
    let best = { score: -Infinity, choices: [] };
    const search = (index, unused, choices, score) => { if (index === group.length) { if (score > best.score) best = { score, choices: [...choices] }; return; } for (const archetype of unused) search(index + 1, unused.filter((entry) => entry !== archetype), [...choices, { playerId: group[index].id, archetype }], score + scoreArchetypes(group[index])[archetype]); };
    search(0, ARCHETYPES, [], 0); return best.choices;
  }
  function chooseFallbackExpeditions(room) {
    const group = players(room);
    const scores = {
      'dark-cave': group.reduce((sum, player) => sum + player.riskEvents * 10 + player.aloneSeconds + player.movement / 25, 0),
      'sunken-temple': group.reduce((sum, player) => sum + player.nearSeconds + player.rescues * 8 + player.visited.size * 2, 0),
      'hidden-ruins': group.reduce((sum, player) => sum + player.relicIds.size * 8 + Object.values(player.interactions).reduce((total, count) => total + count, 0) * 2 + player.movement / 28, 0),
    };
    const seed = [...room.code].reduce((total, character) => total + character.charCodeAt(0), 0);
    return EXPEDITION_IDS.slice().sort((left, right) => (scores[right] - scores[left]) || ((EXPEDITION_IDS.indexOf(left) + seed) % EXPEDITION_IDS.length) - ((EXPEDITION_IDS.indexOf(right) + seed) % EXPEDITION_IDS.length)).slice(0, 2);
  }
  function selectExpeditions(room, requested, source = 'AI Game Master') {
    if (players(room).some((player) => player.archetype === 'Explorer' && player.evolutions.length)) return { ok: false, error: 'The available expeditions cannot change after the Explorer has awakened a destination.' };
    const requestedSelection = Array.isArray(requested) ? requested : chooseFallbackExpeditions(room);
    if (requestedSelection.length !== 2 || new Set(requestedSelection).size !== 2 || requestedSelection.some((id) => !EXPEDITION_IDS.includes(id))) return { ok: false, error: 'Choose exactly two different expeditions from the available three.' };
    // Keep a room's draft stable if a Game Master retries the same decision.
    if (room.world.selectedExpeditions.length === 2) return { ok: true, expeditions: [...room.world.selectedExpeditions], reused: true };
    const aiControlled = AI_EXPEDITION_SOURCES.has(source);
    const selection = aiControlled
      ? [...EXPEDITION_PAIR_CYCLE[expeditionDraftCursor++ % EXPEDITION_PAIR_CYCLE.length]]
      : [...requestedSelection];
    room.world.selectedExpeditions = [...selection];
    room.director = { narration: 'Two distant thresholds answer the group. Their locations remain for the Explorer to discover.', source, at: now() };
    recordAiDecision(room, 'expedition-draft', selection.join(' + '), aiControlled
      ? 'The Game Master balanced destinations across tales, then shapes the selected encounters from this group\'s observed behaviour.'
      : 'Two destinations were selected from the group\'s exploration, risk, cohesion, and collecting signals.', source, { expeditions: [...selection], requestedExpeditions: requestedSelection, behaviourSelected: true });
    return { ok: true, expeditions: [...selection] };
  }
  const selectedExplorerSteps = (room) => {
    if (room.world.selectedExpeditions.length !== 2) selectExpeditions(room, null, 'behaviour-model fallback');
    const features = new Set(room.world.selectedExpeditions.map((id) => EXPEDITION_FEATURES[id]));
    return EVOLUTION_LIBRARY.Explorer.filter(([feature]) => features.has(feature));
  };
  const availableEvolutionSteps = (room, player) => player.archetype === 'Explorer'
    ? selectedExplorerSteps(room)
    : player.archetype === 'Collector'
      ? collector.availableSteps(player)
      : player.archetype === 'Loner'
        ? (player.lonerPlan || fallbackLonerPlan).map((feature) => EVOLUTION_LIBRARY.Loner.find(([id]) => id === feature)).filter(Boolean)
        : EVOLUTION_LIBRARY[player.archetype];
  function canAssign(room) { return room.players.size === MAX_PLAYERS && room.phase === 'observing' && room.observationEndsAt && now() >= room.observationEndsAt; }
  function assignArchetypes(room, assignments, source = 'server', expeditionIds = null) {
    if (!canAssign(room)) return { ok: false, error: 'Roles can be assigned only after all four players finish the observation period.' };
    if (!Array.isArray(assignments) || assignments.length !== MAX_PLAYERS) return { ok: false, error: 'Exactly four distinct player assignments are required.' };
    const playerIds = new Set(), roles = new Set();
    for (const assignment of assignments) {
      if (!getPlayer(room, assignment?.playerId) || !ARCHETYPES.includes(assignment?.archetype) || playerIds.has(assignment.playerId) || roles.has(assignment.archetype)) return { ok: false, error: 'Assignments must contain every current player and every unique role exactly once.' };
      playerIds.add(assignment.playerId); roles.add(assignment.archetype);
    }
    const selected = selectExpeditions(room, expeditionIds, source); if (!selected.ok) return selected;
    for (const { playerId, archetype } of assignments) {
      const player = getPlayer(room, playerId);
      player.archetype = archetype;
      if (archetype === 'Loner') player.lonerPlan = null;
      // The finale reads what happened after the role was revealed, so it
      // responds to continued play rather than re-scoring the opening minute.
      player.evolutionBaseline = { movement: player.movement, near: player.nearSeconds, alone: player.aloneSeconds, relics: player.relicIds.size, risk: player.riskEvents, rescues: player.rescues, follows: player.follows };
    }
    // Roles are personal information. Broadcasting every assignment made a
    // room of default-named "Wanderers" look as if the local player had been
    // assigned several different callings.
    event(room, 'archetypes-awakened', 'Four callings awaken. Your own is shown in the upper-left corner.', { assignments: assignments.map(({ playerId, archetype }) => ({ playerId, archetype })) });
    for (const { playerId } of assignments) guidance.roleAwakened(room, getPlayer(room, playerId));
    const collectorPlayer = players(room).find((player) => player.archetype === 'Collector');
    if (collectorPlayer) {
      const plan = collector.initialize(collectorPlayer);
      guidance.collectorPlan(room, collectorPlayer, plan);
      recordAiDecision(room, 'collector-trials', plan.plan.map((feature) => collector.featureLabel(feature)).join(' + '), `The Collector's two relic trials were selected from how they gathered, travelled, and stayed near the party: ${plan.plan.map((feature) => plan.reasons[feature]).join('; ')}.`, source, { playerId: collectorPlayer.id, features: [...plan.plan] });
    }
    recordAiDecision(room, 'role-assignment', assignments.map(({ playerId, archetype }) => `${getPlayer(room, playerId)?.name}:${archetype}`).join(', '), 'Each role was inferred from the player\'s movement, proximity, collecting, exploration, and risk-taking.', source, { assignments: assignments.map(({ playerId, archetype }) => ({ playerId, archetype })) });
    room.phase = 'evolving'; room.archetypesAssignedAt = now(); room.director = { narration: 'Four distinct callings have awakened. Each opens a different way through Everdawn.', source, at: now() }; return { ok: true, assignments, expeditions: selected.expeditions };
  }
  function markGmActive(room) { room.gmActiveUntil = now() + 45_000; }
  function unlock(room, feature, message, options = {}) {
    if (!FEATURES.has(feature)) return { ok: false, error: 'Unknown world feature.' };
    const expedition = EXPEDITION_IDS.find((id) => EXPEDITION_FEATURES[id] === feature);
    if (expedition && room.world.selectedExpeditions.length === 2 && !room.world.selectedExpeditions.includes(expedition)) return { ok: false, error: 'That destination was not chosen for this tale.' };
    if (options.privateTo && !getPlayer(room, options.privateTo)) return { ok: false, error: 'Unknown private audience.' };
    if (options.privateTo) { const unlocked = room.world.privateUnlocks.get(options.privateTo) || new Set(); unlocked.add(feature); room.world.privateUnlocks.set(options.privateTo, unlocked); event(room, 'private-unlock', message || `${feature} is visible only to you.`, { privateTo: options.privateTo, feature, playerId: options.privateTo }); }
    else { const fresh = !room.world.unlocked.has(feature); room.world.unlocked.add(feature); if (fresh || message) event(room, 'world-unlocked', message || `${feature} is now accessible.`, { feature }); }
    return { ok: true, feature };
  }
  function createFinalObjective(room, source = 'server') {
    if (room.finalObjective) return room.finalObjective;
    const group = players(room); if (group.length !== MAX_PLAYERS || !group.every((player) => player.archetype && player.evolutions.length)) return null;
    const shardTotal = room.entities.filter((entity) => isTaleShard(room, entity)).length;
    const seed = room.createdAt + (room.worldEvolutions?.length || 0);
    const variant = chooseFinaleVariant(room, seed);
    const complication = FINALE_COMPLICATIONS[Math.abs(seed) % FINALE_COMPLICATIONS.length];
    const roleSteps = group.map((player) => {
      const evolution = [...(room.worldEvolutions || [])].reverse().find((item) => item.archetype === player.archetype)
        || worldEvolutionFor(player, player.evolutions.at(-1));
      return {
        role: player.archetype,
        phase: `${player.archetype.toUpperCase()}_STEP`,
        powers: [...(ROLE_ABILITIES[player.archetype] || [])],
        evolutionId: evolution?.id || `${player.archetype.toLowerCase()}-memory`,
        feature: evolution?.feature || player.evolutions.at(-1),
        landmark: evolution?.title || `${player.archetype} Memory`,
        completed: false,
      };
    });
    room.phase = 'finale';
    room.finalObjective = {
      id: `finale-${room.createdAt}`,
      title: 'The Finale Portal Is Forming',
      description: `The Game Master is watching the completed rites to shape ${variant.title}. The Guardian and Loner must each complete two authored personal objectives before the entrance can appear.`,
      createdAt: now(), source, status: 'awaiting-rites', phase: 'PREPARING',
      variant,
      destination: { evolutionId: 'finale-portal-awakens', feature: 'ancient-temple', title: variant.title, targetId: 'finale-entrance' },
      roleSteps,
      complication: { ...complication, active: true },
      groupRitual: { windowMs: 10_000, startedAt: null, participants: {} },
      worldEvolutions: (room.worldEvolutions || []).map((item) => ({ ...item })),
      required: group.map((player) => ({ playerId: player.id, archetype: player.archetype, task: FINALE_TASKS[player.archetype], completed: false })),
    };
    recordAiDecision(room, 'finale-composition', variant.title, `The finale variant was chosen from the group’s continued cooperation, separation, risk, rescues, and following behaviour. ${complication.narration}`, source, { shardTotal, variantId: variant.id, complicationId: complication.id });
    event(room, 'finale-preparing', `The finale portal remains hidden. The Game Master is preparing ${variant.title} from how this party kept playing. When the required personal missions are complete, the portal will appear at the center of the original map.`, { objective: room.finalObjective });
    return room.finalObjective;
  }
  const maybeCreateFinale = (room, source) => { if (players(room).length === MAX_PLAYERS && players(room).every((player) => player.archetype && player.evolutions.length)) createFinalObjective(room, source); };
  function maybeRevealFinaleEntrance(room) {
    const requiredPlayers = players(room).filter(hasDefinedFinaleObjectives);
    if (!room.finalObjective || room.finaleEntrance || !requiredPlayers.length || !requiredPlayers.every((player) => objectiveCount(player) >= 2)) return null;
    room.phase = 'finale'; room.world.unlocked.add('ancient-temple');
    room.finalObjective.status = 'entrance-revealed'; room.finalObjective.title = 'The Finale Portal Has Awakened';
    room.finaleEntrance = { revealedAt: now(), arrivals: new Set() };
    room.director = { narration: `The required missions are complete. A shared portal to ${room.finalObjective.variant?.title || 'the finale'} has appeared at the center of the original map—enter together.`, source: 'portal-director', at: now() };
    event(room, 'finale-entrance-revealed', room.director.narration, { objective: room.finalObjective });
    return room.finaleEntrance;
  }
  function enterFinalTemple(room, player) {
    if (!room.finaleEntrance) return { ok: false, error: 'The finale portal has not appeared yet.' };
    if (hasDefinedFinaleObjectives(player) && objectiveCount(player) < 2) return { ok: false, error: 'Complete two personal objectives before entering the Temple.' };
    room.finaleEntrance.arrivals.add(player.id);
    event(room, 'finale-entrance-entered', `${player.name} enters the shared finale portal.`, { playerId: player.id });
    if (room.finaleEntrance.arrivals.size < MAX_PLAYERS) return { ok: true, waitingFor: MAX_PLAYERS - room.finaleEntrance.arrivals.size };
    room.finalObjective.status = 'active';
    room.templeFinale = null;
    const variantId = room.finalObjective.variant?.id || 'lantern_rite';
    if (variantId === 'echo_accord') {
      const started = muskanFinale?.activateVariant(room, 'echo_accord');
      if (!started?.ok) return started || { ok: false, error: 'The Echo Accord could not awaken.' };
      for (const bearer of players(room)) guidance.finaleVariantEntered(room, bearer, room.finalObjective.variant);
      return { ok: true, entered: true, echoAccord: true };
    }
    const started = lanternRite.begin(room);
    if (!started.ok) return started;
    for (const bearer of players(room)) guidance.finaleVariantEntered(room, bearer, room.finalObjective.variant, started.state);
    return { ok: true, entered: true, lanternRite: true };
  }
  function evolve(room, playerId, source = 'server') {
    const player = getPlayer(room, playerId); if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'The shared world has not started evolving.' }; if (!player?.archetype) return { ok: false, error: 'That player has no assigned role.' };
    const step = availableEvolutionSteps(room, player).find(([feature]) => !player.evolutions.includes(feature)); if (!step) return { ok: false, error: 'This role has already reached its available evolution.' };
    return awakenEvolution(room, player, step, source);
  }
  function awakenEvolution(room, player, step, source) {
    let [feature, narration] = step;
    const collectorAwakening = player.archetype === 'Collector' ? collector.awaken(room, player, feature) : { ok: true };
    if (!collectorAwakening.ok) return collectorAwakening;
    player.evolutions.push(feature); const privateTo = player.archetype === 'Loner' ? player.id : null; const unlocked = unlock(room, feature, narration, privateTo ? { privateTo } : {}); if (!unlocked.ok) { player.evolutions.pop(); return unlocked; }
    // Exploration itself completes an Explorer's discovery; the other roles
    // receive an evolution now but prove it through their authored rite.
    recordFinaleEvolution(room, player, feature, { complete: player.archetype === 'Explorer', source: 'ability-awakening' });
    if (privateTo) player.privateRules.push({ id: feature, title: 'Private Vision', message: 'Only you can see the Veil Path and the Spirit Portal.' });
    if (player.archetype === 'Guardian') {
      player.guardianPortal = portals.createGuardianState({ playerId: player.id, selectedTrialIds: guardianTrialIds(player) });
      const chosen = player.guardianPortal.selectedTrialIds.map((id) => portals.guardianTrials().find((trial) => trial.id === id)?.title).filter(Boolean).join(' and ');
      narration = `${narration} The Game Master has shaped ${chosen} for this Guardian.`;
    }
    if (player.archetype === 'Collector') guidance.collectorTrial(room, player, collectorAwakening.challenge);
    recordAiDecision(room, 'ability-evolution', `${player.name}:${feature}`, `The ${player.archetype} ability was awakened after the player\'s behaviour made it relevant.`, source, { playerId: player.id, archetype: player.archetype, feature }); room.director = { narration, source, at: now() }; event(room, 'archetype-evolved', `${player.name}'s ${player.archetype} has evolved.`, { playerId: player.id, archetype: player.archetype, feature }); guidance.evolutionAwakened(room, player, feature); maybeCreateFinale(room, source); return { ok: true, playerId: player.id, archetype: player.archetype, feature };
  }
  function chooseGuardianTrials(room, playerId, trialIds, source = 'MCP Game Master') {
    const player = getPlayer(room, playerId);
    if (!player || player.archetype !== 'Guardian' || !player.evolutions.includes('healing-shrine')) return { ok: false, error: 'Choose trials only for the evolved Guardian.' };
    if (player.guardianPortal?.activeTrialId || player.guardianPortal?.completedTrialIds?.length) return { ok: false, error: 'Guardian trials cannot change after a portal has been entered.' };
    const choice = portals.chooseGuardianTrials(trialIds); if (!choice.ok) return choice;
    player.guardianPortal = portals.createGuardianState({ playerId: player.id, selectedTrialIds: trialIds });
    const labels = choice.trials.map((trial) => trial.title).join(' and ');
    room.director = { narration: `The Game Master observed ${player.name}'s guardianship and chose ${labels}.`, source, at: now() };
    event(room, 'guardian-trials-chosen', room.director.narration, { playerId, trialIds });
    return { ok: true, trials: choice.trials };
  }
  function chooseLonerMissions(room, playerId, missionIds, reason = '', source = 'MCP Game Master') {
    const player = getPlayer(room, playerId), allowed = new Set(EVOLUTION_LIBRARY.Loner.map(([feature]) => feature));
    if (!player || player.archetype !== 'Loner') return { ok: false, error: 'Choose missions only for the current Loner.' };
    if (!Array.isArray(missionIds) || missionIds.length !== 2 || new Set(missionIds).size !== 2 || missionIds.some((id) => !allowed.has(id))) return { ok: false, error: 'Choose exactly two different authored Loner missions.' };
    if (player.evolutions.length || player.realm !== 'overworld') return { ok: false, error: 'The Loner mission order locks when the first portal awakens.' };
    player.lonerPlan = [...missionIds];
    const explanation = cleanText(reason, 'The selection follows how the Loner explored, separated from the group, and approached risk.', 220);
    recordAiDecision(room, 'loner-missions', missionIds.join(' + '), explanation, source, { playerId, missions: [...missionIds] });
    event(room, 'loner-missions-chosen', 'The Game Master shapes two private paths from what the Loner revealed.', { privateTo: player.id, playerId, missionIds: [...missionIds] });
    return { ok: true, missionIds: [...missionIds] };
  }
  function discoverExplorerEvolution(room, player, x, z) {
    if (player.archetype !== 'Explorer' || zoneOf(player) !== 'overworld' || !['evolving', 'finale'].includes(room.phase)) return null;
    const discovery = selectedExplorerSteps(room).find(([feature]) => {
      if (player.evolutions.includes(feature)) return false;
      const area = TERRAIN_OVERLAYS.find((terrain) => terrain.feature === feature);
      if (!area) return false;
      return areaContains(area, x, z, 1.75);
    });
    return discovery ? awakenEvolution(room, player, discovery, 'exploration') : null;
  }
  const maybeAutoEvolve = (room, player, reason) => {
    const collectorCanContinue = player.archetype === 'Collector' && collector.availableSteps(player).length > 0;
    const lonerCompleted = [...(player.completedEvolutions || [])].filter((id) => WORLD_EVOLUTIONS.some((item) => item.archetype === 'Loner' && item.id === id)).length;
    const lonerCanContinue = player.archetype === 'Loner' && player.evolutions.length < 2 && lonerCompleted >= player.evolutions.length;
    if (room.gmActiveUntil > now() || (player.evolutions.length && !collectorCanContinue && !lonerCanContinue)) return;
    const result = evolve(room, player.id, 'role-mastery');
    if (result.ok) event(room, 'role-mastery', `${player.name} mastered the ${reason}.`, { playerId: player.id });
  };
  function completeObjectiveTask(room, player, action, entity) {
    const objective = room.finalObjective; if (!objective || objective.status !== 'active') return { ok: true, finale: false };
    const task = objective.required.find((entry) => entry.playerId === player.id); if (!task || task.completed) return { ok: true, finale: false };
    const expected = { Collector: 'offer-relics', Guardian: 'activate-shrine', Loner: 'open-final-gate' }[player.archetype];
    const explorerExpedition = { 'enter-dark-cave': 'dark-cave', 'enter-sunken-temple': 'sunken-temple', 'enter-hidden-ruins': 'hidden-ruins' }[action];
    if (player.archetype === 'Explorer' ? !explorerExpedition : action !== expected) return { ok: true, finale: false };
    const valid = (player.archetype === 'Explorer' && room.world.selectedExpeditions.includes(explorerExpedition)) || (player.archetype === 'Collector' && action === 'offer-relics' && entity.id === 'final-altar' && objectiveCount(player) >= 2) || (player.archetype === 'Guardian' && action === 'activate-shrine' && entity.id === 'guardian-shrine') || (player.archetype === 'Loner' && action === 'open-final-gate' && entity.id === 'final-gate');
    if (!valid) return { ok: false, error: 'That is not your valid finale rite yet.' };
    task.completed = true; event(room, 'finale-progress', `${player.name} completed the ${player.archetype} rite.`, { playerId: player.id, archetype: player.archetype }); if (objective.required.every((entry) => entry.completed)) { objective.status = 'complete'; objective.completedAt = now(); event(room, 'finale-complete', 'The final gate opens. Everdawn remembers the four stories written here.', { objective }); } return { ok: true, finale: true };
  }
  function interactGuardianTrial(room, player, targetId) {
    const result = portals.activateGuardianObjective(player.guardianPortal, targetId);
    if (!result.ok) return result;
    if (result.complete) {
      const completedTrials = player.guardianPortal.completedTrialIds.length;
      const evolutionFeature = completedTrials === 1 ? 'healing-shrine' : 'protective-barrier';
      if (evolutionFeature !== 'healing-shrine') unlock(room, evolutionFeature, 'A Warden Barrier rises beside the restored sanctuary.');
      recordFinaleEvolution(room, player, evolutionFeature, { complete: true, source: 'guardian-trial' });
      recordRoleObjective(room, player, `guardian-${result.trialId}`);
      room.director = { narration: result.guardianReadyForFinale ? 'Two guardian sanctums are restored. The temple is listening.' : 'One sanctuary is safe. Another portal still waits.', source: 'portal-director', at: now() };
    }
    event(room, 'guardian-ward', result.complete ? 'A Guardian trial is complete.' : 'A Guardian ward is restored.', { playerId: player.id, targetId });
    return { ok: true, trialComplete: Boolean(result.complete) };
  }
  function guardGuardianTrial(room, player) {
    if (player.archetype !== 'Guardian' || player.guardianPortal?.status !== 'in-trial') return { ok: false, error: 'Only the active Guardian can raise a ward here.' };
    const result = portals.guardGuardianTrial(player.guardianPortal);
    if (result.ok && result.defeated) {
      room.director = { narration: 'The Game Master observes a spirit yield to the Guardian’s protection.', source: 'portal-director', at: now() };
      event(room, 'guardian-spirit-banished', room.director.narration, { playerId: player.id, threatId: result.targetId });
    }
    return result;
  }
  function interactTemple(room, player) {
    const result = portals.activatePillar(room.templeFinale, player.id);
    if (result.ok) {
      const temple = portals.serializeFinale(room.templeFinale);
      room.director = { narration: result.won ? 'The Game Master: every choice mattered. You did not follow a story â€” you made one.' : 'A temple pillar answers. Hold your places until every story has awakened.', source: 'portal-director', at: now() };
      event(room, result.won ? 'temple-victory' : 'temple-pillar', result.message || `${player.name}'s pillar is awake.`, { playerId: player.id, temple });
    }
    return result;
  }
  function completeFinale(room) {
    const objective = room.finalObjective;
    if (!objective) return { ok: false, error: 'There is no prepared finale.' };
    if (objective.status === 'complete') return { ok: true, complete: true };
    return muskanFinale?.complete(room) || { ok: false, error: 'The finale system is unavailable.' };
  }
  function ejectFromCave(room, player) {
    player.health = 0; player.caveLocked = true; player.zone = 'overworld'; player.x = -20; player.z = -8;
    player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    event(room, 'cave-defeat', `${player.name}'s lantern went dark. The Black Hollow will not admit them again this tale.`, { playerId: player.id });
  }
  function ejectFromRuins(room, player) {
    player.health = 0; player.ruinsLocked = true; player.zone = 'overworld'; player.x = 6; player.z = -7;
    player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    event(room, 'ruins-defeat', `${player.name} was cast out by the mummy wardens. The buried arch seals against them.`, { playerId: player.id });
  }
  function ejectFromTemple(room, player) {
    player.health = 0; player.templeLocked = true; player.zone = 'overworld'; player.x = 20; player.z = -5;
    player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    event(room, 'temple-defeat', `${player.name} was driven back up the submerged steps. The Tide Wardens will not admit them again this tale.`, { playerId: player.id });
  }
  const combatForExpedition = (room, expeditionId) => expeditionId === 'dark-cave' ? room.caveCombat : expeditionId === 'hidden-ruins' ? room.ruinsCombat : null;
  function chooseFallbackEncounterTactic(room) {
    const group = players(room), collector = group.find((player) => player.archetype === 'Collector');
    if (collector && (collector.relicIds.size || collector.interactions.relic)) return 'guard-collector';
    const near = group.reduce((sum, player) => sum + player.nearSeconds, 0), alone = group.reduce((sum, player) => sum + player.aloneSeconds, 0);
    return near >= alone ? 'pressure-cluster' : 'hunt-straggler';
  }
  function announceEncounterTactic(room, expeditionId) {
    const combat = combatForExpedition(room, expeditionId), tactic = combat && ENCOUNTER_TACTICS[combat.tacticId];
    if (!combat || !tactic || combat.tacticAnnounced) return;
    combat.tacticAnnounced = true;
    event(room, 'ai-encounter-adapted', `The world learned from your group: ${tactic.message}`, { expeditionId, tacticId: combat.tacticId, decisionSource: combat.tacticSource });
  }
  function adaptEncounter(room, expeditionId, tacticId, reason = '', source = 'AI Game Master') {
    if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'Encounter tactics can change only after the roles awaken.' };
    if (!room.world.selectedExpeditions.includes(expeditionId)) return { ok: false, error: 'The AI can adapt only an expedition selected for this tale.' };
    const combat = combatForExpedition(room, expeditionId), tactic = ENCOUNTER_TACTICS[tacticId];
    if (!combat) return { ok: false, error: 'That expedition has no hostile encounter to adapt.' };
    if (!tactic || !ENCOUNTER_TACTIC_IDS.includes(tacticId)) return { ok: false, error: 'Choose one safe authored encounter tactic.' };
    if (combat.cleared) return { ok: false, error: 'That encounter has already been cleared.' };
    if (combat.tacticId && combat.tacticSource !== 'behaviour-model fallback') return { ok: false, error: 'The AI has already shaped this encounter for the current tale.' };
    combat.tacticId = tacticId; combat.tacticSource = cleanText(source, 'AI Game Master', 48); combat.tacticReason = cleanText(reason, 'The tactic responds to the party\'s observed formation.', 220); combat.tacticRevision += 1; combat.tacticAnnounced = false;
    recordAiDecision(room, 'encounter-tactic', `${expeditionId}:${tacticId}`, combat.tacticReason, combat.tacticSource, { expeditionId, tacticId });
    if (players(room).some((player) => zoneOf(player) === expeditionId)) announceEncounterTactic(room, expeditionId);
    return { ok: true, expeditionId, tacticId, tactic: { label: tactic.label, message: tactic.message }, source: combat.tacticSource };
  }
  function ensureEncounterTactic(room, expeditionId) {
    const combat = combatForExpedition(room, expeditionId);
    if (!combat?.tacticId) adaptEncounter(room, expeditionId, chooseFallbackEncounterTactic(room), 'The encounter changed in response to how tightly the party travelled and who carried relics.', 'behaviour-model fallback');
    announceEncounterTactic(room, expeditionId);
    return combat;
  }
  const nearestAllyDistance = (candidate, candidates) => candidates.filter((other) => other.id !== candidate.id).reduce((closest, other) => Math.min(closest, distance(candidate, other)), Infinity);
  function selectEncounterTarget(enemy, candidates, tacticId) {
    const ranked = candidates.map((candidate) => ({ candidate, enemyDistance: Math.hypot(enemy.x - candidate.x, enemy.z - candidate.z), allyDistance: nearestAllyDistance(candidate, candidates) }));
    if (tacticId === 'guard-collector') {
      const collector = ranked.filter(({ candidate }) => candidate.archetype === 'Collector').sort((left, right) => left.enemyDistance - right.enemyDistance)[0];
      if (collector) return collector.candidate;
    }
    ranked.sort((left, right) => tacticId === 'hunt-straggler'
      ? (right.allyDistance - left.allyDistance) || (left.enemyDistance - right.enemyDistance)
      : tacticId === 'pressure-cluster'
        ? (left.allyDistance - right.allyDistance) || (left.enemyDistance - right.enemyDistance)
        : left.enemyDistance - right.enemyDistance);
    return ranked[0]?.candidate || null;
  }
  function damagePlayer(room, player, amount) {
    const zone = zoneOf(player);
    if (!['dark-cave', 'hidden-ruins'].includes(zone) || player.health <= 0 || (zone === 'dark-cave' ? player.caveLocked : player.ruinsLocked)) return;
    const damage = Math.max(0, amount); player.health = Math.max(0, player.health - damage); player.lastDamage = damage; player.hurtUntil = now() + 550;
    if (player.health <= 0) (zone === 'dark-cave' ? ejectFromCave : ejectFromRuins)(room, player);
  }
  function attackEncounter(room, player) {
    if (player.guardianPortal?.status === 'in-trial') return guardGuardianTrial(room, player);
    const zone = zoneOf(player);
    if (!['evolving', 'finale'].includes(room.phase) || !['dark-cave', 'hidden-ruins'].includes(zone)) return { ok: false, error: 'You can only fight inside a hostile expedition.' };
    const ruins = zone === 'hidden-ruins', combat = ruins ? room.ruinsCombat : room.caveCombat;
    const locked = ruins ? player.ruinsLocked : player.caveLocked;
    if (locked || player.health <= 0) return { ok: false, error: `${ruins ? 'The buried arch' : 'The Black Hollow'} no longer answers your lantern.` };
    const lastAttackAt = Math.max(player.lastCombatAttackAt ?? -Infinity, player.lastCaveAttackAt ?? -Infinity);
    if (now() - lastAttackAt < 380) return { ok: false, cooldown: true, error: 'Your weapon is still recovering.' };
    const target = combat.enemies.filter((enemy) => enemy.health > 0).sort((left, right) => Math.hypot(player.x - left.x, player.z - left.z) - Math.hypot(player.x - right.x, player.z - right.z))[0];
    if (!target || Math.hypot(player.x - target.x, player.z - target.z) > 3.4) return { ok: false, error: `Move closer to a ${ruins ? 'mummy' : 'demon'} before striking.` };
    player.lastCombatAttackAt = now(); player.lastCaveAttackAt = now(); target.health = Math.max(0, target.health - 22); target.hitUntil = now() + 180;
    if (target.health === 0) event(room, ruins ? 'ruins-enemy-defeated' : 'cave-enemy-defeated', `${player.name} and the party defeated the ${target.name}.`, { playerId: player.id, targetId: target.id });
    if (combat.enemies.every((enemy) => enemy.health <= 0) && !combat.cleared) {
      combat.cleared = true;
      event(room, ruins ? 'ruins-cleared' : 'cave-cleared', ruins ? 'The two mummy wardens collapse. Four Sunstones glimmer between the broken pillars.' : 'The three demons fall. The Black Hollow is safe enough for the Collector to search its deepest grottoes.');
    }
    return { ok: true, targetId: target.id, damage: 22, targetHealth: target.health, defeated: target.health === 0 };
  }
  const attackDarkCave = attackEncounter;
  function tickCaveCombat(room, delta) {
    const cavePlayers = players(room).filter((player) => zoneOf(player) === 'dark-cave' && !player.caveLocked && player.health > 0);
    if (!cavePlayers.length || room.caveCombat.cleared) return;
    const combat = ensureEncounterTactic(room, 'dark-cave'), tactic = ENCOUNTER_TACTICS[combat.tacticId] || ENCOUNTER_TACTICS['hunt-straggler'];
    for (const enemy of room.caveCombat.enemies) {
      if (enemy.health <= 0) continue;
      const target = selectEncounterTarget(enemy, cavePlayers, combat.tacticId);
      if (!target || zoneOf(target) !== 'dark-cave') continue;
      const dx = target.x - enemy.x, dz = target.z - enemy.z, range = Math.hypot(dx, dz);
      if (range > 1.65) {
        const step = Math.min(range - 1.45, 1.35 * tactic.speedMultiplier * delta), nextX = enemy.x + dx / range * step, nextZ = enemy.z + dz / range * step;
        if (caveWalkable(nextX, nextZ)) { enemy.x = nextX; enemy.z = nextZ; }
      } else if (now() - enemy.lastAttackAt >= tactic.attackCooldownMs) {
        enemy.lastAttackAt = now(); enemy.attackUntil = now() + 550; enemy.targetId = target.id; damagePlayer(room, target, 5);
      }
    }
  }
  function tickRuinsCombat(room, delta) {
    const ruinsPlayers = players(room).filter((player) => zoneOf(player) === 'hidden-ruins' && !player.ruinsLocked && player.health > 0);
    if (!ruinsPlayers.length || room.ruinsCombat.cleared) return;
    const combat = ensureEncounterTactic(room, 'hidden-ruins'), tactic = ENCOUNTER_TACTICS[combat.tacticId] || ENCOUNTER_TACTICS['hunt-straggler'];
    for (const enemy of room.ruinsCombat.enemies) {
      if (enemy.health <= 0) continue;
      const target = selectEncounterTarget(enemy, ruinsPlayers, combat.tacticId);
      if (!target || zoneOf(target) !== 'hidden-ruins') continue;
      const dx = target.x - enemy.x, dz = target.z - enemy.z, range = Math.hypot(dx, dz);
      if (range > 1.65) {
        // Mummies are deliberate, but they must still be able to close the
        // distance in the wide Ruins chamber before the party simply walks
        // away. Their pace is intentionally much faster than cave demons.
        const step = Math.min(range - 1.45, 3.2 * tactic.speedMultiplier * delta), nextX = enemy.x + dx / range * step, nextZ = enemy.z + dz / range * step;
        if (ruinsWalkable(nextX, nextZ)) { enemy.x = nextX; enemy.z = nextZ; }
      } else if (now() - enemy.lastAttackAt >= tactic.attackCooldownMs) {
        enemy.lastAttackAt = now(); enemy.attackUntil = now() + 550; enemy.targetId = target.id; damagePlayer(room, target, 5);
      }
    }
  }
  function interact(room, player, type, targetId, intent = {}) {
    const action = cleanText(type, '', 32), cleanTargetId = cleanText(targetId, '', 48);
    if (room.phase === 'observing' && action === 'collect-curio') {
      const curio = room.entities.find((entity) => entity.id === cleanTargetId && entity.type === 'observation-item');
      if (!curio || curio.collectedBy) return { ok: false, error: 'That curiosity is no longer available.' };
      if (distance(player, curio) > 3.25) return { ok: false, error: 'Move closer to inspect it.' };
      curio.collectedBy = player.id; player.observationItems ||= new Set(); player.observationItems.add(curio.id);
      player.interactions['collect-curio'] = (player.interactions['collect-curio'] || 0) + 1;
      event(room, 'curio-collected', `${player.name} pockets ${curio.label}.`, { playerId: player.id, targetId: curio.id });
      return { ok: true, targetId: curio.id };
    }
    if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'Wait until all four players have received their roles.' };
    const realmResult = realms?.interact(room, player, action, cleanTargetId, intent);
    if (realmResult) {
      if (realmResult.ok && ['dungeon-exit', 'exit-shadow-forest', 'moon-shrine-interact'].includes(action)) recordRoleObjective(room, player, `${player.archetype.toLowerCase()}-${action}`);
      if (realmResult.ok) {
        synchronizeLonerCompletions(room, player);
        maybeAutoEvolve(room, player, 'veil rite');
      }
      return realmResult;
    }
    if (action.startsWith('lantern-')) return lanternRite?.interact(room, player, action, cleanTargetId) || { ok: false, error: 'The Lantern Rite is not active.' };
    if (['collect-clue', 'dig-crystal', 'collector-minigame-start', 'collector-minigame-complete', 'forge-bellows-assist'].includes(action)) {
      const result = action === 'collect-clue' ? collector.collectClue(room, player, cleanTargetId)
        : action === 'dig-crystal' ? collector.dig(room, player, cleanTargetId)
          : action === 'collector-minigame-start' ? collector.start(room, player, cleanTargetId)
            : action === 'collector-minigame-complete' ? collector.complete(room, player, cleanTargetId)
              : collector.assist(room, player, cleanTargetId);
      if (result.ok && action === 'collector-minigame-complete') {
        recordFinaleEvolution(room, player, result.feature, { complete: true, source: 'collector-trial' });
        recordRoleObjective(room, player, `collector-${result.feature}`);
        guidance.collectorCompleted(room, player, result.feature, result.completed, result.total);
        maybeAutoEvolve(room, player, 'relic rite');
      }
      if (result.ok && action === 'collector-minigame-start') guidance.collectorStarted(room, player, result.feature);
      return result;
    }
    if (room.templeFinale) return action === 'activate-temple-pillar' ? interactTemple(room, player) : { ok: false, error: 'The temple asks you to stand at your own pillar.' };
    if (player.guardianPortal?.status === 'in-trial') return action === 'guardian-objective' ? interactGuardianTrial(room, player, cleanTargetId) : action === 'guardian-guard' ? guardGuardianTrial(room, player) : { ok: false, error: 'Restore the next ward inside the Guardian sanctum.' };
    const dynamicEntities = guardianPortalEntities(room), entity = [...room.entities, ...dynamicEntities].find((entry) => entry.id === cleanTargetId);
    if (action === 'enter-guardian-portal') {
      if (!entity || entity.type !== 'guardian-portal' || !hasRole(player, 'Guardian') || distance(player, entity) > 3.25) return { ok: false, error: 'Move beside one of the Guardian portals first.' };
      const entered = portals.enterGuardianPortal(player.guardianPortal, entity.trialId);
      if (entered.ok) { room.director = { narration: `The ${entered.trial.title} opens around ${player.name}. The Game Master still watches every step.`, source: 'portal-director', at: now() }; event(room, 'guardian-portal-entered', room.director.narration, { playerId: player.id, trialId: entity.trialId }); guidance.guardianTrialEntered(room, player, entity.trialId); }
      return entered;
    }
    if (!entity || !Object.hasOwn(ROLE_ACTIONS, action)) return { ok: false, error: 'That interaction target is invalid.' };
    const interactionRadius = ['temple-entrance', 'cave', 'ruins-entrance'].includes(entity.type) ? 7 : ['temple-exit', 'cave-exit', 'ruins-exit'].includes(entity.type) ? 4 : 3.25;
    if (distance(player, entity) > interactionRadius) return { ok: false, error: 'Move closer to interact with that object.' };
    if (action === 'enter-final-temple') {
      if (entity.type !== 'finale-entrance') return { ok: false, error: 'That is not the shared finale portal.' };
      return enterFinalTemple(room, player);
    }
    if (action === 'enter-dark-cave') {
      if (player.caveLocked) return { ok: false, error: 'Your lantern was extinguished here. The Black Hollow will not admit you again this tale.' };
      room.world.unlocked.add('dark-cave-open'); player.zone = 'dark-cave'; player.x = 0; player.z = 11; player.inputX = 0; player.inputZ = 0; player.locationId = 'dark-cave'; player.visited.add('dark-cave'); player.health = player.maxHealth; player.caveSafeX = 0; player.caveSafeZ = 11; player.portalCooldownUntil = 0; ensureEncounterTactic(room, 'dark-cave');
    } else if (action === 'exit-dark-cave') {
      player.zone = 'overworld'; player.x = -20; player.z = -8; player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    } else if (action === 'enter-sunken-temple') {
      room.world.unlocked.add('sunken-temple-open'); player.zone = 'sunken-temple'; player.x = 0; player.z = 12; player.inputX = 0; player.inputZ = 0; player.locationId = 'sunken-temple'; player.visited.add('sunken-temple'); player.health = player.maxHealth;
    } else if (action === 'exit-sunken-temple') {
      player.zone = 'overworld'; player.x = 20; player.z = -5; player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    } else if (action === 'enter-hidden-ruins') {
      if (player.ruinsLocked) return { ok: false, error: 'The mummy wardens cast you out. The buried arch will not admit you again this tale.' };
      room.world.unlocked.add('hidden-ruins-open'); player.zone = 'hidden-ruins'; player.x = 0; player.z = 11; player.inputX = 0; player.inputZ = 0; player.locationId = 'hidden-ruins'; player.visited.add('hidden-ruins'); player.health = player.maxHealth; ensureEncounterTactic(room, 'hidden-ruins');
    } else if (action === 'exit-hidden-ruins') {
      player.zone = 'overworld'; player.x = 6; player.z = -7; player.inputX = 0; player.inputZ = 0; player.locationId = locationFor(player.x, player.z);
    } else if (entity.role && !hasRole(player, entity.role)) return { ok: false, error: `Only the ${entity.role} can use ${entity.label}.` };
    const expedition = { 'enter-dark-cave': 'dark-cave', 'enter-sunken-temple': 'sunken-temple', 'enter-hidden-ruins': 'hidden-ruins' }[action];
    if (expedition) guidance.expeditionEntered(room, player, expedition);
    if (entity.id.startsWith('gloom-shard-') && !room.caveCombat.cleared) return { ok: false, error: 'The demons guard this shard. The party must clear the Black Hollow first.' };
    if (entity.id.startsWith('sunstone-shard-') && !room.ruinsCombat.cleared) return { ok: false, error: 'The mummy wardens guard this shard. The party must defeat both of them first.' };
    if (entity.type !== ROLE_ACTIONS[action]) return { ok: false, error: 'That action does not match this object.' };
    if (entity.feature && !room.world.unlocked.has(entity.feature) && !(room.world.privateUnlocks.get(player.id) || new Set()).has(entity.feature)) return { ok: false, error: 'That place has not awakened yet.' };
    const realmFeature = action === 'enter-spirit-realm' ? 'spirit-realm' : action === 'enter-shadow-forest' ? 'shadow-forest' : action === 'enter-moon-shrine' ? 'moon-shrine' : action === 'enter-ghost-village' ? 'ghost-village' : null;
    if (realmFeature) {
      const entered = realms.enter(room, player, realmFeature);
      if (entered.ok) { event(room, 'realm-entered', `${player.name} steps into the ${entity.label}.`, { playerId: player.id, realm: player.realm }); guidance.realmEntered(room, player, player.realm); }
      return entered;
    }
    const emergentInteraction = world.emergentRules.validateInteraction(room, player, action, entity); if (!emergentInteraction.ok) return emergentInteraction;
    if (entity.type === 'relic' || entity.type === 'discovery-shard') {
      if (entity.collectedBy) return { ok: false, error: 'That object was already claimed.' };
      entity.collectedBy = player.id;
      if (entity.type === 'relic') {
        player.relicIds.add(entity.id);
        recordRoleObjective(room, player, `relic-${entity.id}`);
      }
    }
    player.interactions[action] = (player.interactions[action] || 0) + 1; if (MASTERY_ACTIONS[action]) maybeAutoEvolve(room, player, MASTERY_ACTIONS[action]);
    const finale = completeObjectiveTask(room, player, action, entity); if (!finale.ok) return finale;
    if (['discover-temple', 'enter-dark-cave', 'enter-sunken-temple', 'enter-hidden-ruins', 'trace-waystone'].includes(action)) recordRoleObjective(room, player, `${player.archetype.toLowerCase()}-${action}`);
    world.emergentRules.completeInteraction(room, player, action, entity);
    const shardCount = room.entities.filter((item) => item.id.startsWith('tideglass-shard-') && item.collectedBy).length;
    const gloomCount = room.entities.filter((item) => item.id.startsWith('gloom-shard-') && item.collectedBy).length;
    const sunstoneCount = room.entities.filter((item) => item.id.startsWith('sunstone-shard-') && item.collectedBy).length;
    const everdawnCount = room.entities.filter((item) => item.id.startsWith(EVERDAWN_SHARD_PREFIX) && item.collectedBy).length;
    const isTideglass = entity.id.startsWith('tideglass-shard-'), isGloom = entity.id.startsWith('gloom-shard-'), isSunstone = entity.id.startsWith('sunstone-shard-'), isEverdawn = entity.id.startsWith(EVERDAWN_SHARD_PREFIX);
    const message = isTideglass
      ? `Tideglass recovered — ${shardCount}/${TEMPLE_SHARD_TOTAL}.${shardCount === TEMPLE_SHARD_TOTAL ? ' The temple collection is complete.' : ''}`
      : isGloom ? `Gloom shard recovered — ${gloomCount}/${CAVE_SHARD_TOTAL}.`
      : isSunstone ? `Sunstone recovered — ${sunstoneCount}/${RUINS_SHARD_TOTAL}.`
      : isEverdawn ? `Everdawn shard recovered — ${everdawnCount}/${EVERDAWN_SHARD_TOTAL}.`
      : INTERACTION_MESSAGES[action](player, entity);
    event(room, action === 'relic' ? 'relic-collected' : 'role-interaction', message, { playerId: player.id, targetId: entity.id, ...((isTideglass || isGloom || isSunstone || isEverdawn) ? { privateTo: player.id } : {}) }); return { ok: true, targetId: entity.id };
  }
  function recordTelemetry(room, player, payload = {}, positionIsAuthoritative = false) {
    if (!ACTIVE_PHASES.has(room.phase)) return;
    if (player.realm && player.realm !== 'overworld') return;
    const temple = zoneOf(player) === 'sunken-temple';
    const x = positionIsAuthoritative ? clamp(payload.x ?? payload.position?.x, temple ? -16 : worldBounds.minX, temple ? 16 : worldBounds.maxX) : player.x;
    const z = positionIsAuthoritative ? clamp(payload.z ?? payload.position?.z, temple ? -14 : worldBounds.minZ, temple ? 14 : worldBounds.maxZ) : player.z;
    if (positionIsAuthoritative) discoverExplorerEvolution(room, player, x, z);
    if (positionIsAuthoritative && zoneOf(player) === 'dark-cave') {
      const rift = riftAt(x, z);
      if (rift?.setback && now() >= player.portalCooldownUntil) {
        player.x = rift.returnX; player.z = rift.returnZ; player.caveSafeX = player.x; player.caveSafeZ = player.z; player.portalCooldownUntil = now() + 1_500;
        damagePlayer(room, player, 5);
        if (zoneOf(player) === 'dark-cave') event(room, 'cave-rift', `${player.name} was thrown backward by a false floor.`, { playerId: player.id, privateTo: player.id });
        return;
      }
    }
    // Resolve blocked diagonal movement one axis at a time. Without this,
    // brushing a tree or shoreline rejects the entire step and makes adjacent
    // open grass feel like an invisible wall.
    let next = { x: player.x, z: player.z };
    if (canEnterTile(room, player, x, z)) next = { x, z };
    else if (canEnterTile(room, player, x, player.z)) next = { x, z: player.z };
    else if (canEnterTile(room, player, player.x, z)) next = { x: player.x, z };
    const travelled = Math.min(2, Math.hypot(next.x - player.x, next.z - player.z)); if (travelled) { player.movement += travelled; player.movementSamples += 1; }
    player.x = next.x; player.z = next.z; player.locationId = locationFor(next.x, next.z, zoneOf(player)); player.visited.add(player.locationId); player.lastTelemetryAt = now();
    if (zoneOf(player) === 'dark-cave' && !riftAt(player.x, player.z)) { player.caveSafeX = player.x; player.caveSafeZ = player.z; }
  }
  function advanceRoom(room) { if (room.phase === 'observing' && room.players.size === MAX_PLAYERS && room.observationEndsAt && now() >= room.observationEndsAt + gmAssignmentGraceMs) { event(room, 'gm-narration', 'The observation ends. Four distinct callings awaken.'); assignArchetypes(room, calculateAssignments(room), 'behaviour-model fallback'); } }
  function entityVisibleTo(entity, viewer, room) {
    const privateFeatures = viewer ? room.world.privateUnlocks.get(viewer.id) || new Set() : new Set();
    if (entity.feature && !room.world.unlocked.has(entity.feature) && !privateFeatures.has(entity.feature)) return false;
    if (!viewer) return true;
    if (entity.zone === 'lantern-rite') return viewer.realm === 'lantern-rite';
    if (entity.collectorChallenge) {
      if (viewer.archetype === 'Collector') return true;
      const active = players(room).find((player) => player.archetype === 'Collector')?.collector?.active;
      return entity.feature === 'relic-forge' && entity.type === 'collector-landmark' && active?.started && !active?.completed;
    }
    // A route found by the Explorer becomes a shared landmark immediately.
    // Every teammate can then join the expedition.
    if (entity.feature && ['hidden-cave-appears', 'temple-staircase-uncovered', 'forgotten-ruins-emerge'].includes(entity.feature) && room.world.unlocked.has(entity.feature)) return true;
    if (entity.id === 'hidden-temple-entrance' && room.world.unlocked.has('sunken-temple-open')) return true;
    if (entity.id === 'hidden-cave-mouth' && room.world.unlocked.has('dark-cave-open')) return true;
    if (entity.id === 'hidden-ruins-entrance' && room.world.unlocked.has('hidden-ruins-open')) return true;
    if (entity.type === 'relic') return viewer.archetype === 'Collector';
    return entity.role === viewer.archetype || !entity.role;
  }
  function serializeRoom(room, viewerId = null) {
    advanceRoom(room); const viewer = viewerId && getPlayer(room, viewerId), privateUnlocks = viewer ? [...(room.world.privateUnlocks.get(viewer.id) || [])] : [], directorRules = room.directorState || { activeRules: [], history: [] }, visibleRules = (directorRules.activeRules || []).filter((rule) => !rule.playerId || !viewerId || rule.playerId === viewerId);
    const entities = [...room.entities, ...guardianPortalEntities(room), ...(viewer ? realms.entities(viewer) : []), ...(viewer ? (lanternRite?.entities(room) || []).map((entity) => ({ ...entity, zone: 'lantern-rite' })) : [])]
      .filter((entity) => entityVisibleTo(entity, viewer, room))
      .map(({ id, type, x, z, tileX, tileY, zone, label, role, terrain, collectedBy, feature, action, trialId, active, hp, maxHealth, maxHp, defeated, sprite, collectorChallenge, readyCount, activeBy, enemyType }) => ({ id, type, x, z, tileX, tileY, zone: zone || (String(type || '').startsWith('lantern-') ? 'lantern-rite' : 'overworld'), label, role, requiredRole: role, terrain, collectedBy, feature, action, trialId, active, hp, maxHealth, maxHp, defeated, sprite, collectorChallenge, readyCount, activeBy, enemyType }));
    const visibleTerrain = TERRAIN_OVERLAYS.filter((area) => (!viewer || area.role === viewer.archetype || (area.feature && ['hidden-cave-appears', 'temple-staircase-uncovered', 'forgotten-ruins-emerge'].includes(area.feature) && room.world.unlocked.has(area.feature)) || (area.id === 'temple-staircase-ground' && room.world.unlocked.has('sunken-temple-open')) || (area.id === 'hidden-cave-clearing' && room.world.unlocked.has('dark-cave-open')) || (area.id === 'forgotten-ruins-site' && room.world.unlocked.has('hidden-ruins-open'))) && (!area.feature || room.world.unlocked.has(area.feature))).map(({ id, kind, role, feature, label, x, z, w, h, points, pathWidth }) => ({ id, kind, requiredRole: role, feature, label, x, z, w, h, points, pathWidth }));
    const viewerShardCount = viewer?.archetype === 'Collector' ? [...viewer.relicIds].filter((id) => id.startsWith('tideglass-shard-')).length : 0;
    const shardProgress = viewerShardCount > 0 ? { collected: viewerShardCount, total: TEMPLE_SHARD_TOTAL, objectiveRevealed: viewerShardCount >= TEMPLE_SHARD_TOTAL } : null;
    const viewerCaveShardCount = viewer?.archetype === 'Collector' ? [...viewer.relicIds].filter((id) => id.startsWith('gloom-shard-')).length : 0;
    const caveShardProgress = viewer?.archetype === 'Collector' && (zoneOf(viewer) === 'dark-cave' || viewerCaveShardCount > 0) ? { collected: viewerCaveShardCount, total: CAVE_SHARD_TOTAL } : null;
    const viewerRuinsShardCount = viewer?.archetype === 'Collector' ? [...viewer.relicIds].filter((id) => id.startsWith('sunstone-shard-')).length : 0;
    const ruinsShardProgress = viewer?.archetype === 'Collector' && (zoneOf(viewer) === 'hidden-ruins' || viewerRuinsShardCount > 0) ? { collected: viewerRuinsShardCount, total: RUINS_SHARD_TOTAL } : null;
    const viewerEverdawnShardCount = viewer?.archetype === 'Collector' ? [...viewer.relicIds].filter((id) => id.startsWith(EVERDAWN_SHARD_PREFIX)).length : 0;
    const everdawnShardProgress = viewer?.archetype === 'Collector' && (zoneOf(viewer) === 'overworld' || viewerEverdawnShardCount > 0) ? { collected: viewerEverdawnShardCount, total: EVERDAWN_SHARD_TOTAL } : null;
    const finalObjective = room.finalObjective ? { ...room.finalObjective, required: room.finalObjective.required.map((entry) => entry.archetype === 'Collector' && viewer?.id !== entry.playerId ? { ...entry, task: 'An undiscovered rite.' } : { ...entry }) } : null;
    const caveCombat = !viewer || zoneOf(viewer) === 'dark-cave' ? { cleared: room.caveCombat.cleared, tacticId: room.caveCombat.tacticId, tacticLabel: ENCOUNTER_TACTICS[room.caveCombat.tacticId]?.label || null, tacticSource: room.caveCombat.tacticSource, rifts: DARK_CAVE_RIFTS, enemies: room.caveCombat.enemies.map((enemy) => ({ id: enemy.id, name: enemy.name, sprite: enemy.sprite, x: enemy.x, z: enemy.z, health: enemy.health, maxHealth: enemy.maxHealth, alive: enemy.health > 0, hit: enemy.hitUntil > now(), attacking: enemy.attackUntil > now(), targetId: enemy.targetId })) } : undefined;
    const ruinsCombat = !viewer || zoneOf(viewer) === 'hidden-ruins' ? { cleared: room.ruinsCombat.cleared, tacticId: room.ruinsCombat.tacticId, tacticLabel: ENCOUNTER_TACTICS[room.ruinsCombat.tacticId]?.label || null, tacticSource: room.ruinsCombat.tacticSource, enemies: room.ruinsCombat.enemies.map((enemy) => ({ id: enemy.id, name: enemy.name, sprite: enemy.sprite, variant: enemy.variant, x: enemy.x, z: enemy.z, health: enemy.health, maxHealth: enemy.maxHealth, alive: enemy.health > 0, hit: enemy.hitUntil > now(), attacking: enemy.attackUntil > now(), targetId: enemy.targetId })) } : undefined;
    return {
      contentVersion: CONTENT_VERSION,
      code: room.code,
      phase: room.phase,
      playerCount: room.players.size,
      requiredPlayers: MAX_PLAYERS,
      observationEndsAt: room.observationEndsAt,
      observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null,
      ...(shardProgress ? { shardProgress } : {}),
      ...(caveShardProgress ? { caveShardProgress } : {}),
      ...(ruinsShardProgress ? { ruinsShardProgress } : {}),
      ...(everdawnShardProgress ? { everdawnShardProgress } : {}),
      ...(caveCombat ? { caveCombat } : {}),
      ...(ruinsCombat ? { ruinsCombat } : {}),
      players: players(room).map((player, index) => ({
        id: player.id,
        name: player.name,
        color: colors[index],
        sprite: player.sprite,
        facing: player.facing,
        moving: Math.hypot(player.inputX, player.inputZ) > 0,
        x: player.x,
        z: player.z,
        tileX: player.realm !== 'overworld' ? player.x : undefined,
        tileY: player.realm !== 'overworld' ? player.z : undefined,
        zone: zoneOf(player),
        locationId: player.locationId,
        archetype: player.archetype,
        health: player.health,
        maxHealth: player.maxHealth,
        hurt: player.hurtUntil > now(),
        lastDamage: player.lastDamage,
        caveLocked: player.id === viewerId ? player.caveLocked : undefined,
        ruinsLocked: player.id === viewerId ? player.ruinsLocked : undefined,
        templeLocked: player.id === viewerId ? player.templeLocked : undefined,
        capabilities: player.id === viewerId ? ROLE_ABILITIES[player.archetype] || [] : undefined,
        emergentStatus: player.id === viewerId ? { energy: player.emergent?.energy ?? 100, effects: player.emergent?.effects || [] } : undefined,
        relicCount: player.id === viewerId ? player.relicIds.size : undefined,
        objectiveCount: objectiveCount(player),
        evolutions: player.evolutions,
        completedEvolutions: player.id === viewerId ? [...(player.completedEvolutions || [])] : undefined,
        lanternHealth: player.realm === 'lantern-rite' ? player.lanternHealth : undefined,
        lanternMaxHealth: player.realm === 'lantern-rite' ? player.lanternMaxHealth : undefined,
        lanternShield: player.realm === 'lantern-rite' ? player.lanternShield : undefined,
        lanternDownedUntil: player.realm === 'lantern-rite' ? player.lanternDownedUntil : undefined,
        echoTrail: player.realm === 'echo-accord' ? (player.echoTrail || []).map((point) => ({ ...point })) : undefined,
        echoCollected: player.realm === 'echo-accord' ? player.echoCollected : undefined,
        echoAlive: player.realm === 'echo-accord' ? player.echoAlive : undefined,
        echoColor: player.realm === 'echo-accord' ? player.echoColor : undefined,
        ...(player.id === viewerId ? realms.snapshot(player) : { realm: player.realm }),
      })),
      relics: entities.filter((entity) => entity.type === 'relic'),
      entities,
      terrain: visibleTerrain,
      world: { unlocked: [...room.world.unlocked], privateUnlocks, selectedExpeditions: [...room.world.selectedExpeditions] },
      finalObjective,
      finaleEntrance: room.finaleEntrance && { revealedAt: room.finaleEntrance.revealedAt, enteredPlayerIds: [...room.finaleEntrance.arrivals] },
      guardianTrial: viewer?.guardianPortal ? portals.serializeGuardian(viewer.guardianPortal) : null,
      templeFinale: room.templeFinale ? portals.serializeFinale(room.templeFinale) : null,
      collectorTrial: viewer?.archetype === 'Collector' ? collector.snapshot(viewer) : null,
      lanternRite: viewer?.realm === 'lantern-rite' ? room.finalObjective?.lanternRite || null : null,
      director: room.director,
      aiDirector: {
        pending: pendingAiDecisions(room),
        decisions: (room.aiDirector?.decisions || []).slice(-12),
        encounterPlans: { 'dark-cave': room.caveCombat.tacticId, 'hidden-ruins': room.ruinsCombat.tacticId },
      },
      directorRules: { activeRules: visibleRules, history: (directorRules.history || []).slice(-8) },
      emergentRules: world.emergentRules.serialize(room, viewerId),
      events: room.events.filter((item) => !item.privateTo || item.privateTo === viewerId).slice(-8),
      yourPrivateRules: viewer?.privateRules || [],
      yourGuidance: viewer?.guidance || null,
    };
  }
  function broadcastState(room) { for (const player of players(room)) emitState(player.id, serializeRoom(room, player.id)); }
  function tickRoom(room, delta) {
    world.directorRules.expire(room);
    const rules = room.directorState?.activeRules || [];
    const hasObstacle = rules.some((rule) => rule.card === 'temporary_obstacle');
    if (ACTIVE_PHASES.has(room.phase)) for (const player of players(room)) {
      const magnitude = Math.hypot(player.inputX, player.inputZ);
      if (magnitude) {
        const swiftStep = rules.some((rule) => rule.card === 'temporary_boon' && rule.playerId === player.id && rule.boonId === 'swift_step');
        const speed = 8 * (swiftStep ? 1.35 : 1) * (hasObstacle ? 0.82 : 1) * world.emergentRules.movementMultiplier(room, player);
        const dx = player.inputX / magnitude * speed * delta;
        const dz = player.inputZ / magnitude * speed * delta;
        if (room.templeFinale) {
          const position = room.templeFinale.players[player.id]?.position;
          if (position) portals.moveFinale(room.templeFinale, player.id, { x: position.x + dx, z: position.z + dz });
        } else if (player.guardianPortal?.status === 'in-trial') {
          const speed = portals.guardianMovementMultiplier(player.guardianPortal);
          portals.moveGuardian(player.guardianPortal, { x: player.guardianPortal.position.x + dx * speed, z: player.guardianPortal.position.z + dz * speed });
        } else if (player.realm === 'lantern-rite') {
          const nextX = player.x + dx, nextZ = player.z + dz;
          if (lanternRite?.canEnter(room, player, nextX, nextZ)) { player.x = nextX; player.z = nextZ; }
        } else if (player.realm === 'echo-accord') {
          // Muskan's finale system advances the living trails in its own
          // authoritative tick, so the shared-world mover must not move twice.
        } else if (player.realm && player.realm !== 'overworld') {
          const nextX = player.x + dx, nextZ = player.z + dz;
          if (realms.move(player, nextX, nextZ)) { player.x = nextX; player.z = nextZ; }
        } else {
          recordTelemetry(room, player, { x: player.x + dx, z: player.z + dz }, true);
        }
      }
      if (player.guardianPortal?.status === 'in-trial') {
        const nudge = portals.tickGuardian(player.guardianPortal);
        if (nudge) {
          room.director = { narration: nudge.message, source: 'portal-director', at: now() };
          event(room, nudge.type, nudge.message, { playerId: player.id });
        }
      }
      if (player.realm && player.realm !== 'overworld' && player.realm !== 'lantern-rite' && player.realm !== 'echo-accord') {
        realms.tick(room, player, delta);
        synchronizeLonerCompletions(room, player);
        maybeAutoEvolve(room, player, 'veil rite');
      }
      const nearest = players(room).filter((other) => other.id !== player.id).reduce((closest, other) => Math.min(closest, distance(player, other)), Infinity);
      if (nearest <= 9) player.nearSeconds += delta; else player.aloneSeconds += delta;
    }
    tickCaveCombat(room, delta);
    tickRuinsCombat(room, delta);
    lanternRite?.tick(room, delta);
    muskanFinale?.tick(room, delta);
    muskanFinale?.advance(room);
    world.emergentRules.tick(room, delta);
    maybeRevealFinaleEntrance(room);
    advanceRoom(room);
    const fallbackLoner = players(room).find((player) => player.archetype === 'Loner');
    if (['evolving', 'finale'].includes(room.phase) && fallbackLoner && !fallbackLoner.evolutions.length && now() >= room.gmActiveUntil && now() >= (room.archetypesAssignedAt || 0) + gmAssignmentGraceMs) {
      fallbackLoner.lonerPlan = [...fallbackLonerPlan];
      recordAiDecision(room, 'loner-missions', fallbackLonerPlan.join(' + '), 'The AI did not provide a mission selection in time, so the authored fallback order was used.', 'behaviour-model fallback', { playerId: fallbackLoner.id, missions: [...fallbackLonerPlan] });
      evolve(room, fallbackLoner.id, 'behaviour-model fallback');
    }
  }

  const world = { rooms, observationMs, cleanText, clamp, getPlayer, createRoom, createPlayer, resetRoomForRoster, beginObservation, playerTelemetry, roomTelemetry, markGmActive, event, assignArchetypes, selectExpeditions, adaptEncounter, unlock, evolve, chooseGuardianTrials, chooseLonerMissions, createFinalObjective, serializeRoom, broadcastState, recordTelemetry, interact, attackDarkCave, attackEncounter, guardGuardianTrial, completeFinale, tickRoom };
  world.directorRules = createDirectorRules(world);
  world.emergentRules = createEmergentRules(world, emergentOptions);
  collector = createCollectorSystem({ event, now });
  lanternRite = createLanternRiteSystem(world);
  muskanFinale = createFinaleSystem(world);
  realms = createRealmSystem(world);
  return world;
}
