// Authoritative game domain. This module owns room state, movement, role
// assignment, interactions, serialization and ticks. It deliberately knows
// nothing about HTTP, Socket.IO, files, or browser rendering.

import { ARCHETYPES, ENTITY_DEFINITIONS, EVOLUTION_LIBRARY, FEATURES, MAX_PLAYERS, ROLE_ABILITIES, TERRAIN_OVERLAYS } from '../shared/game-content.js';
import { createDirectorRules } from './director-rules.mjs';
import { createEmergentRules } from './emergent-rules.mjs';
import { createPortalSystem } from './portal-system.mjs';
import { createRealmSystem } from './realm-system.mjs';

const ACTIVE_PHASES = new Set(['observing', 'evolving', 'finale']);
const ROLE_ACTIONS = Object.freeze({ relic: 'relic', 'discover-temple': 'temple-entrance', 'trace-waystone': 'waystone', 'activate-shrine': 'shrine', 'enter-spirit-realm': 'spirit-portal', 'read-veil': 'veil-mirror', 'enter-shadow-forest': 'realm-portal', 'enter-moon-shrine': 'realm-portal', 'enter-ghost-village': 'realm-portal', 'offer-relics': 'altar', 'open-final-gate': 'final-gate' });
const MASTERY_ACTIONS = Object.freeze({ relic: 'Echo Water relic', 'discover-temple': 'hidden route', 'activate-shrine': 'shrine rite', 'enter-spirit-realm': 'spirit path' });
const INTERACTION_MESSAGES = Object.freeze({ relic: (player, entity) => `${player.name} collected ${entity.label}.`, 'discover-temple': (player) => `${player.name} found the hidden temple entrance.`, 'trace-waystone': (player) => `${player.name} traced the route through the old waystone.`, 'activate-shrine': (player) => `${player.name} awakened the shrine.`, 'enter-spirit-realm': (player) => `${player.name} stepped through the veil.`, 'read-veil': (player) => `${player.name} read the Veil Mirror's hidden omen.`, 'offer-relics': (player) => `${player.name} offered relics at the altar.`, 'open-final-gate': (player) => `${player.name} turned the final gate's spirit key.` });
const FINALE_TASKS = Object.freeze({ Explorer: 'discover the hidden temple entrance', Collector: 'offer three relics at the altar', Guardian: 'activate the awakened shrine', Loner: 'open the final gate' });

function freshEmergentState() { return { activeRules: [], history: [], nextId: 0, lastAnalyzedAt: 0, cooldowns: {}, observations: { pairs: {}, guardianSeconds: 0, lonerSeconds: 0 } }; }
function freshPlayerEmergentState() { return { energy: 100, activeRuleIds: [], effects: [] }; }

/**
 * Create a self-contained world service. Transport callbacks are injected, so
 * tests and alternate hosts can use the same rules without Socket.IO.
 */
export function createGameWorld({ rooms = new Map(), collisionTiles = [], observationMs = 30_000, gmAssignmentGraceMs = 12_000, emergentOptions = {}, emitEvent = () => {}, emitState = () => {}, clock = () => Date.now() } = {}) {
  const worldBounds = { minX: -29, maxX: 28, minZ: -16, maxZ: 15, mapWidth: 60, offsetX: 30, offsetZ: 17 };
  const colors = [0x2563eb, 0xdb2777, 0xf59e0b, 0x16a34a];
  const spawns = [[-6, 0], [-4, 0], [-5, 2], [-3, 2]];
  const now = () => clock();
  const portals = createPortalSystem({ clock: now });
  let realms;
  const cleanText = (value, fallback = '', maximum = 220) => typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum) || fallback : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const players = (room) => [...room.players.values()];
  const getPlayer = (room, id) => room.players.get(id);
  const distance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);
  const hasRole = (player, role) => player?.archetype === role;
  const terrainAt = (x, z) => TERRAIN_OVERLAYS.find((area) => x >= area.x && x <= area.x + area.w - 1 && z >= area.z && z <= area.z + area.h - 1);
  const locationFor = (x, z) => terrainAt(x, z)?.kind === 'water' ? 'lake-of-echoes' : terrainAt(x, z)?.kind === 'hidden-path' ? 'hidden-cave' : terrainAt(x, z)?.kind === 'bridge' ? 'sacred-shrine' : terrainAt(x, z)?.kind === 'spirit' ? 'spirit-realm' : x < -15 && z < -5 ? 'whispering-forest' : x > 14 && z > 7 ? 'ancient-temple' : 'starting-village';
  const isBaseWalkable = (x, z) => {
    const tileX = Math.round(x + worldBounds.offsetX), tileY = Math.round(z + worldBounds.offsetZ);
    return tileX >= 1 && tileX <= 58 && tileY >= 1 && tileY <= 32 && (!collisionTiles.length || collisionTiles[tileY * worldBounds.mapWidth + tileX] === 0);
  };
  const canEnterTile = (player, x, z) => x >= worldBounds.minX && x <= worldBounds.maxX && z >= worldBounds.minZ && z <= worldBounds.maxZ && (terrainAt(x, z) ? hasRole(player, terrainAt(x, z).role) : isBaseWalkable(x, z));
  const event = (room, type, message, options = {}) => {
    const item = { id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, at: now(), type, message: cleanText(message, 'The world shifts.'), ...options };
    room.events.push(item); if (room.events.length > 40) room.events.shift(); emitEvent(room, item); return item;
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
    if (player.archetype === 'Collector') return Math.min(2, player.relicIds.size);
    return player.roleObjectives?.size || 0;
  }
  function recordRoleObjective(room, player, id) {
    player.roleObjectives ||= new Set();
    const before = player.roleObjectives.size; player.roleObjectives.add(id);
    if (player.roleObjectives.size > before) event(room, 'portal-objective', `${player.name} completed a ${player.archetype} rite (${objectiveCount(player)}/2).`, { playerId: player.id, archetype: player.archetype, objectiveId: id });
    maybeBeginTemple(room);
  }

  function createRoom(code) {
    const createdAt = now();
    return { code, createdAt, phase: 'waiting-for-four', observationEndsAt: null, players: new Map(), entities: ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null })), world: { unlocked: new Set(['starting-village']), privateUnlocks: new Map() }, events: [], finalObjective: null, templeFinale: null, archetypesAssignedAt: null, gmActiveUntil: 0, directorState: { activeRules: [], history: [], sequence: 0 }, emergentState: freshEmergentState(), director: { narration: 'Four lanterns are needed before this shared tale can begin.', source: 'server', at: createdAt } };
  }
  function createPlayer(id, name, index) {
    const [x, z] = spawns[index];
    return { id, name: cleanText(name, 'Wanderer', 16), color: colors[index], x, z, inputX: 0, inputZ: 0, realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, locationId: locationFor(x, z), visited: new Set(['starting-village']), relicIds: new Set(), roleObjectives: new Set(), guardianPortal: null, interactions: {}, movement: 0, movementSamples: 0, nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, archetype: null, evolutions: [], privateRules: [], emergent: freshPlayerEmergentState(), lastTelemetryAt: now() };
  }
  function resetRoomForRoster(room, reason) {
    Object.assign(room, { phase: 'waiting-for-four', observationEndsAt: null, archetypesAssignedAt: null, finalObjective: null, templeFinale: null, world: { unlocked: new Set(['starting-village']), privateUnlocks: new Map() }, directorState: { activeRules: [], history: [], sequence: 0 }, emergentState: freshEmergentState(), entities: ENTITY_DEFINITIONS.map((entity) => ({ ...entity, collectedBy: null })) });
    for (const [index, player] of players(room).entries()) {
      const [x, z] = spawns[index];
      Object.assign(player, { x, z, inputX: 0, inputZ: 0, realm: 'overworld', dungeon: null, shadowForest: null, moonShrine: null, ghostVillage: null, dungeonCompletions: 0, locationId: locationFor(x, z), archetype: null, evolutions: [], visited: new Set(['starting-village']), relicIds: new Set(), roleObjectives: new Set(), guardianPortal: null, interactions: {}, movement: 0, movementSamples: 0, nearSeconds: 0, aloneSeconds: 0, riskEvents: 0, rescues: 0, follows: 0, privateRules: [], emergent: freshPlayerEmergentState() });
    }
    room.director = { narration: reason, source: 'server', at: now() };
  }
  function beginObservation(room) {
    if (room.players.size !== MAX_PLAYERS) return;
    room.phase = 'observing'; room.observationEndsAt = now() + observationMs; room.director = { narration: 'All four lanterns are lit. The Game Master is observing your first choices.', source: 'server', at: now() }; event(room, 'four-player-start', 'All four lanterns are lit. The shared tale has begun.');
  }
  function playerTelemetry(room, player) {
    const elapsed = Math.max(1, (now() - (room.observationEndsAt ? room.observationEndsAt - observationMs : room.createdAt)) / 1000);
    return { id: player.id, name: player.name, location: player.locationId, locationsDiscovered: player.visited.size, relicsCollected: player.relicIds.size, interactions: player.interactions, distanceTravelled: Math.round(player.movement), nearGroupSeconds: Math.round(player.nearSeconds), aloneSeconds: Math.round(player.aloneSeconds), riskEvents: player.riskEvents, rescues: player.rescues, follows: player.follows, cohesion: Number((player.nearSeconds / elapsed).toFixed(2)) };
  }
  function roomTelemetry(room) { return { roomCode: room.code, phase: room.phase, playerCount: room.players.size, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, players: players(room).map((player) => playerTelemetry(room, player)), relicsCollected: room.entities.filter((entity) => entity.type === 'relic' && entity.collectedBy).length, unlockedFeatures: [...room.world.unlocked], finalObjective: room.finalObjective, emergentRuleTypes: (room.emergentState?.activeRules || []).map((rule) => rule.type) }; }
  function scoreArchetypes(player) { return { Explorer: player.visited.size * 3 + player.movement / 30 + player.riskEvents * 2, Collector: player.relicIds.size * 9 + (player.interactions.relic || 0) * 2, Guardian: player.nearSeconds / 3 + player.rescues * 8 + (player.interactions['activate-shrine'] || 0) * 2 + player.follows, Loner: player.aloneSeconds / 3 + player.visited.size + (player.interactions['enter-spirit-realm'] || 0) * 3 }; }
  function calculateAssignments(room) {
    const group = players(room); if (group.length !== MAX_PLAYERS) return [];
    let best = { score: -Infinity, choices: [] };
    const search = (index, unused, choices, score) => { if (index === group.length) { if (score > best.score) best = { score, choices: [...choices] }; return; } for (const archetype of unused) search(index + 1, unused.filter((entry) => entry !== archetype), [...choices, { playerId: group[index].id, archetype }], score + scoreArchetypes(group[index])[archetype]); };
    search(0, ARCHETYPES, [], 0); return best.choices;
  }
  function canAssign(room) { return room.players.size === MAX_PLAYERS && room.phase === 'observing' && room.observationEndsAt && now() >= room.observationEndsAt; }
  function assignArchetypes(room, assignments, source = 'server') {
    if (!canAssign(room)) return { ok: false, error: 'Roles can be assigned only after all four players finish the observation period.' };
    if (!Array.isArray(assignments) || assignments.length !== MAX_PLAYERS) return { ok: false, error: 'Exactly four distinct player assignments are required.' };
    const playerIds = new Set(), roles = new Set();
    for (const assignment of assignments) {
      if (!getPlayer(room, assignment?.playerId) || !ARCHETYPES.includes(assignment?.archetype) || playerIds.has(assignment.playerId) || roles.has(assignment.archetype)) return { ok: false, error: 'Assignments must contain every current player and every unique role exactly once.' };
      playerIds.add(assignment.playerId); roles.add(assignment.archetype);
    }
    for (const { playerId, archetype } of assignments) { const player = getPlayer(room, playerId); player.archetype = archetype; event(room, 'archetype-awakened', `${player.name} has awakened as the ${archetype}.`, { playerId, archetype }); }
    room.phase = 'evolving'; room.archetypesAssignedAt = now(); room.director = { narration: 'Four distinct callings have awakened. Each opens a different way through Everdawn.', source, at: now() }; return { ok: true, assignments };
  }
  function markGmActive(room) { room.gmActiveUntil = now() + 45_000; }
  function unlock(room, feature, message, options = {}) {
    if (!FEATURES.has(feature)) return { ok: false, error: 'Unknown world feature.' };
    if (options.privateTo && !getPlayer(room, options.privateTo)) return { ok: false, error: 'Unknown private audience.' };
    if (options.privateTo) { const unlocked = room.world.privateUnlocks.get(options.privateTo) || new Set(); unlocked.add(feature); room.world.privateUnlocks.set(options.privateTo, unlocked); event(room, 'private-unlock', message || `${feature} is visible only to you.`, { privateTo: options.privateTo, feature, playerId: options.privateTo }); }
    else { const fresh = !room.world.unlocked.has(feature); room.world.unlocked.add(feature); if (fresh || message) event(room, 'world-unlocked', message || `${feature} is now accessible.`, { feature }); }
    return { ok: true, feature };
  }
  function createFinalObjective(room, source = 'server') {
    if (room.finalObjective) return room.finalObjective;
    const group = players(room); if (group.length !== MAX_PLAYERS || !group.every((player) => player.archetype && player.evolutions.length)) return null;
    room.world.unlocked.add('ancient-temple'); room.world.unlocked.add('final-gate'); room.phase = 'finale'; room.finalObjective = { id: `temple-${room.createdAt}`, title: 'The Ancient Temple Has Awakened', description: 'Each of the four roles must perform its own rite.', createdAt: now(), source, status: 'active', required: group.map((player) => ({ playerId: player.id, archetype: player.archetype, task: FINALE_TASKS[player.archetype], completed: false })) }; event(room, 'finale-created', 'The Ancient Temple has awakened. All four roles are needed at the final gate.', { objective: room.finalObjective }); return room.finalObjective;
  }
  const maybeCreateFinale = (room, source) => { if (players(room).length === MAX_PLAYERS && players(room).every((player) => player.archetype && player.evolutions.length)) createFinalObjective(room, source); };
  function maybeBeginTemple(room) {
    if (!room.finalObjective || room.templeFinale || !players(room).every((player) => objectiveCount(player) >= 2)) return null;
    room.templeFinale = portals.createFinale({ players: players(room), completedObjectives: Object.fromEntries(players(room).map((player) => [player.id, objectiveCount(player)])) });
    room.director = { narration: 'The Ancient Temple opens. Four pillars await four different stories.', source: 'portal-director', at: now() };
    event(room, 'temple-opened', 'The Game Master gathers every completed path inside the Ancient Temple.', { temple: portals.serializeFinale(room.templeFinale) });
    return room.templeFinale;
  }
  function evolve(room, playerId, source = 'server') {
    const player = getPlayer(room, playerId); if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'The shared world has not started evolving.' }; if (!player?.archetype) return { ok: false, error: 'That player has no assigned role.' };
    const step = EVOLUTION_LIBRARY[player.archetype][player.evolutions.length]; if (!step) return { ok: false, error: 'This role has already reached its available evolution.' };
    let [feature, narration] = step; player.evolutions.push(feature); const privateTo = player.archetype === 'Loner' ? player.id : null; const unlocked = unlock(room, feature, narration, privateTo ? { privateTo } : {}); if (!unlocked.ok) return unlocked;
    if (privateTo) player.privateRules.push({ id: feature, title: 'Private Vision', message: 'Only you can see the Veil Path and the Spirit Portal.' });
    if (player.archetype === 'Guardian') {
      player.guardianPortal = portals.createGuardianState({ playerId: player.id, selectedTrialIds: guardianTrialIds(player) });
      const chosen = player.guardianPortal.selectedTrialIds.map((id) => portals.guardianTrials().find((trial) => trial.id === id)?.title).filter(Boolean).join(' and ');
      narration = `${narration} The Game Master has shaped ${chosen} for this Guardian.`;
    }
    room.director = { narration, source, at: now() }; event(room, 'archetype-evolved', `${player.name}'s ${player.archetype} has evolved.`, { playerId, archetype: player.archetype, feature }); maybeCreateFinale(room, source); return { ok: true, playerId, archetype: player.archetype, feature };
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
  const maybeAutoEvolve = (room, player, reason) => { if (room.gmActiveUntil > now() || player.evolutions.length) return; const result = evolve(room, player.id, 'role-mastery'); if (result.ok) event(room, 'role-mastery', `${player.name} mastered the ${reason}.`, { playerId: player.id }); };
  function completeObjectiveTask(room, player, action, entity) {
    const objective = room.finalObjective; if (!objective || objective.status !== 'active') return { ok: true, finale: false };
    const task = objective.required.find((entry) => entry.playerId === player.id); if (!task || task.completed) return { ok: true, finale: false };
    const valid = (player.archetype === 'Explorer' && action === 'discover-temple' && entity.id === 'hidden-temple-entrance') || (player.archetype === 'Collector' && action === 'offer-relics' && entity.id === 'final-altar' && player.relicIds.size >= 3) || (player.archetype === 'Guardian' && action === 'activate-shrine' && entity.id === 'guardian-shrine') || (player.archetype === 'Loner' && action === 'open-final-gate' && entity.id === 'final-gate');
    if (!valid) return { ok: true, finale: false };
    task.completed = true; event(room, 'finale-progress', `${player.name} completed the ${player.archetype} rite.`, { playerId: player.id, archetype: player.archetype }); if (objective.required.every((entry) => entry.completed)) { objective.status = 'complete'; objective.completedAt = now(); event(room, 'finale-complete', 'The final gate opens. Everdawn remembers the four stories written here.', { objective }); } return { ok: true, finale: true };
  }
  function interactGuardianTrial(room, player, targetId) {
    const result = portals.activateGuardianObjective(player.guardianPortal, targetId);
    if (!result.ok) return result;
    if (result.complete) {
      recordRoleObjective(room, player, `guardian-${result.trialId}`);
      room.director = { narration: result.guardianReadyForFinale ? 'Two guardian sanctums are restored. The temple is listening.' : 'One sanctuary is safe. Another portal still waits.', source: 'portal-director', at: now() };
    }
    event(room, 'guardian-ward', result.complete ? 'A Guardian trial is complete.' : 'A Guardian ward is restored.', { playerId: player.id, targetId });
    return { ok: true, trialComplete: Boolean(result.complete) };
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
  function interact(room, player, type, targetId, intent = {}) {
    if (!['evolving', 'finale'].includes(room.phase)) return { ok: false, error: 'Wait until all four players have received their roles.' };
    const action = cleanText(type, '', 32), cleanTargetId = cleanText(targetId, '', 48);
    const realmResult = realms?.interact(room, player, action, cleanTargetId, intent);
    if (realmResult) {
      if (realmResult.ok && ['dungeon-exit', 'exit-shadow-forest', 'moon-shrine-interact'].includes(action)) recordRoleObjective(room, player, `${player.archetype.toLowerCase()}-${action}`);
      return realmResult;
    }
    if (room.templeFinale) return action === 'activate-temple-pillar' ? interactTemple(room, player) : { ok: false, error: 'The temple asks you to stand at your own pillar.' };
    if (player.guardianPortal?.status === 'in-trial') return action === 'guardian-objective' ? interactGuardianTrial(room, player, cleanTargetId) : { ok: false, error: 'Restore the next ward inside the Guardian sanctum.' };
    const dynamicEntities = guardianPortalEntities(room), entity = [...room.entities, ...dynamicEntities].find((entry) => entry.id === cleanTargetId);
    if (action === 'enter-guardian-portal') {
      if (!entity || entity.type !== 'guardian-portal' || !hasRole(player, 'Guardian') || distance(player, entity) > 3.25) return { ok: false, error: 'Move beside one of the Guardian portals first.' };
      const entered = portals.enterGuardianPortal(player.guardianPortal, entity.trialId);
      if (entered.ok) { room.director = { narration: `The ${entered.trial.title} opens around ${player.name}. The Game Master still watches every step.`, source: 'portal-director', at: now() }; event(room, 'guardian-portal-entered', room.director.narration, { playerId: player.id, trialId: entity.trialId }); }
      return entered;
    }
    if (!entity || !Object.hasOwn(ROLE_ACTIONS, action)) return { ok: false, error: 'That interaction target is invalid.' };
    if (distance(player, entity) > 3.25) return { ok: false, error: 'Move closer to interact with that object.' };
    if (!hasRole(player, entity.role)) return { ok: false, error: `Only the ${entity.role} can use ${entity.label}.` };
    if (entity.type !== ROLE_ACTIONS[action]) return { ok: false, error: 'That action does not match this object.' };
    if (entity.feature && !room.world.unlocked.has(entity.feature) && !(room.world.privateUnlocks.get(player.id) || new Set()).has(entity.feature)) return { ok: false, error: 'That place has not awakened yet.' };
    const realmFeature = action === 'enter-spirit-realm' ? 'spirit-realm' : action === 'enter-shadow-forest' ? 'shadow-forest' : action === 'enter-moon-shrine' ? 'moon-shrine' : action === 'enter-ghost-village' ? 'ghost-village' : null;
    if (realmFeature) {
      const entered = realms.enter(room, player, realmFeature);
      if (entered.ok) event(room, 'realm-entered', `${player.name} steps into the ${entity.label}.`, { playerId: player.id, realm: player.realm });
      return entered;
    }
    const emergentInteraction = world.emergentRules.validateInteraction(room, player, action, entity); if (!emergentInteraction.ok) return emergentInteraction;
    if (entity.type === 'relic') { if (entity.collectedBy) return { ok: false, error: 'That relic was already claimed.' }; entity.collectedBy = player.id; player.relicIds.add(entity.id); recordRoleObjective(room, player, `relic-${entity.id}`); }
    player.interactions[action] = (player.interactions[action] || 0) + 1; if (MASTERY_ACTIONS[action]) maybeAutoEvolve(room, player, MASTERY_ACTIONS[action]);
    const finale = completeObjectiveTask(room, player, action, entity); if (!finale.ok) return finale;
    if (action === 'discover-temple' || action === 'trace-waystone' || action === 'enter-spirit-realm' || action === 'read-veil') recordRoleObjective(room, player, entity.id);
    world.emergentRules.completeInteraction(room, player, action, entity); event(room, action === 'relic' ? 'relic-collected' : 'role-interaction', INTERACTION_MESSAGES[action](player, entity), { playerId: player.id, targetId: entity.id }); return { ok: true, targetId: entity.id };
  }
  function recordTelemetry(room, player, payload = {}, positionIsAuthoritative = false) {
    if (!ACTIVE_PHASES.has(room.phase)) return;
    if (player.realm && player.realm !== 'overworld') return;
    const x = positionIsAuthoritative ? clamp(payload.x ?? payload.position?.x, worldBounds.minX, worldBounds.maxX) : player.x, z = positionIsAuthoritative ? clamp(payload.z ?? payload.position?.z, worldBounds.minZ, worldBounds.maxZ) : player.z;
    const next = canEnterTile(player, x, z) ? { x, z } : { x: player.x, z: player.z }; const travelled = Math.min(2, Math.hypot(next.x - player.x, next.z - player.z)); if (travelled) { player.movement += travelled; player.movementSamples += 1; }
    player.x = next.x; player.z = next.z; player.locationId = locationFor(next.x, next.z); player.visited.add(player.locationId); player.lastTelemetryAt = now();
  }
  function advanceRoom(room) { if (room.phase === 'observing' && room.players.size === MAX_PLAYERS && room.observationEndsAt && now() >= room.observationEndsAt + gmAssignmentGraceMs) { event(room, 'gm-narration', 'The observation ends. Four distinct callings awaken.'); assignArchetypes(room, calculateAssignments(room), 'behaviour-model fallback'); } }
  function entityVisibleTo(entity, viewer, room) { const privateFeatures = viewer ? room.world.privateUnlocks.get(viewer.id) || new Set() : new Set(); return !viewer || entity.type === 'relic' ? !viewer || viewer.archetype === 'Collector' : entity.feature && !room.world.unlocked.has(entity.feature) && !privateFeatures.has(entity.feature) ? false : entity.role === viewer.archetype || !entity.role; }
  function serializeRoom(room, viewerId = null) {
    advanceRoom(room); const viewer = viewerId && getPlayer(room, viewerId), privateUnlocks = viewer ? [...(room.world.privateUnlocks.get(viewer.id) || [])] : [], directorRules = room.directorState || { activeRules: [], history: [] }, visibleRules = (directorRules.activeRules || []).filter((rule) => !rule.playerId || !viewerId || rule.playerId === viewerId);
    const entities = [...room.entities, ...guardianPortalEntities(room), ...(viewer ? realms.entities(viewer) : [])].filter((entity) => entityVisibleTo(entity, viewer, room)).map(({ id, type, x, z, tileX, tileY, label, role, terrain, collectedBy, feature, action, trialId, active, hp, defeated }) => ({ id, type, x, z, tileX, tileY, label, role, requiredRole: role, terrain, collectedBy, feature, action, trialId, active, hp, defeated }));
    const visibleTerrain = TERRAIN_OVERLAYS.filter((area) => !viewer || area.role === viewer.archetype).map(({ id, kind, role, label, x, z, w, h }) => ({ id, kind, requiredRole: role, label, x, z, w, h }));
    return { code: room.code, phase: room.phase, playerCount: room.players.size, requiredPlayers: MAX_PLAYERS, observationEndsAt: room.observationEndsAt, observationSecondsRemaining: room.observationEndsAt ? Math.max(0, Math.ceil((room.observationEndsAt - now()) / 1000)) : null, players: players(room).map((player) => ({ id: player.id, name: player.name, color: player.color, x: player.x, z: player.z, tileX: player.realm !== 'overworld' ? player.x : undefined, tileY: player.realm !== 'overworld' ? player.z : undefined, locationId: player.locationId, archetype: player.archetype, capabilities: player.id === viewerId ? ROLE_ABILITIES[player.archetype] || [] : undefined, emergentStatus: player.id === viewerId ? { energy: player.emergent?.energy ?? 100, effects: player.emergent?.effects || [] } : undefined, relicCount: player.relicIds.size, objectiveCount: objectiveCount(player), evolutions: player.evolutions, ...(player.id === viewerId ? realms.snapshot(player) : { realm: player.realm }) })), relics: entities.filter((entity) => entity.type === 'relic'), entities, terrain: visibleTerrain, world: { unlocked: [...room.world.unlocked], privateUnlocks }, finalObjective: room.finalObjective, guardianTrial: viewer?.guardianPortal ? portals.serializeGuardian(viewer.guardianPortal) : null, templeFinale: room.templeFinale ? portals.serializeFinale(room.templeFinale) : null, director: room.director, directorRules: { activeRules: visibleRules, history: (directorRules.history || []).slice(-8) }, emergentRules: world.emergentRules.serialize(room, viewerId), events: room.events.slice(-8), yourPrivateRules: viewer?.privateRules || [] };
  }
  function broadcastState(room) { for (const player of players(room)) emitState(player.id, serializeRoom(room, player.id)); }
  function tickRoom(room, delta) {
    world.directorRules.expire(room);
    const rules = room.directorState?.activeRules || [], hasObstacle = rules.some((rule) => rule.card === 'temporary_obstacle');
    if (ACTIVE_PHASES.has(room.phase)) for (const player of players(room)) {
      const magnitude = Math.hypot(player.inputX, player.inputZ);
      if (magnitude) {
        const swiftStep = rules.some((rule) => rule.card === 'temporary_boon' && rule.playerId === player.id && rule.boonId === 'swift_step');
        const speed = 8 * (swiftStep ? 1.35 : 1) * (hasObstacle ? 0.82 : 1) * world.emergentRules.movementMultiplier(room, player);
        const dx = player.inputX / magnitude * speed * delta, dz = player.inputZ / magnitude * speed * delta;
        if (room.templeFinale) portals.moveFinale(room.templeFinale, player.id, { x: room.templeFinale.players[player.id].position.x + dx, z: room.templeFinale.players[player.id].position.z + dz });
        else if (player.guardianPortal?.status === 'in-trial') portals.moveGuardian(player.guardianPortal, { x: player.guardianPortal.position.x + dx, z: player.guardianPortal.position.z + dz });
        else if (player.realm === 'dungeon' && realms.move(player, player.x + dx, player.z + dz)) { player.x += dx; player.z += dz; }
        else if (player.realm === 'overworld') recordTelemetry(room, player, { x: player.x + dx, z: player.z + dz }, true);
      }
      if (player.guardianPortal?.status === 'in-trial') {
        const nudge = portals.tickGuardian(player.guardianPortal);
        if (nudge) { room.director = { narration: nudge.message, source: 'portal-director', at: now() }; event(room, nudge.type, nudge.message, { playerId: player.id }); }
      }
      if (player.realm !== 'overworld') realms.tick(room, player, delta);
      const nearest = players(room).filter((other) => other.id !== player.id).reduce((closest, other) => Math.min(closest, distance(player, other)), Infinity);
      if (nearest <= 9) player.nearSeconds += delta; else player.aloneSeconds += delta;
    }
    world.emergentRules.tick(room, delta); advanceRoom(room);
  }

  const world = { rooms, observationMs, cleanText, clamp, getPlayer, createRoom, createPlayer, resetRoomForRoster, beginObservation, roomTelemetry, markGmActive, event, assignArchetypes, unlock, evolve, chooseGuardianTrials, createFinalObjective, serializeRoom, broadcastState, recordTelemetry, interact, tickRoom };
  world.directorRules = createDirectorRules(world); world.emergentRules = createEmergentRules(world, emergentOptions); realms = createRealmSystem(world);
  return world;
}
