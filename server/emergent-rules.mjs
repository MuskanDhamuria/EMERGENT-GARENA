// Behaviour-to-rule compiler for Emergent.  It is deliberately independent of
// the socket and HTTP layers: pass the small world API into the factory, then
// call `tick` from the authoritative server clock and `serialize` from the
// world-state serializer.
//
// The compiler never changes an assigned archetype, teleports a player, or
// deletes earned progress.  Its rules are time-bounded and derived only from
// server-owned positions, interactions, relic inventories, and role data.

const ACTIVE_PHASES = new Set(['evolving', 'finale']);
const RULE_TYPES = Object.freeze(['bond', 'explorer_vision', 'hoard_value', 'guardian_protection', 'solitary_vision']);

export const EMERGENT_RULE_TYPES = RULE_TYPES;
export const EMERGENT_TRIGGER_IDS = Object.freeze(['exclusive_pair', 'explorer_travel', 'collector_relics', 'guardian_cohesion', 'loner_isolation']);
export const EMERGENT_EFFECT_IDS = Object.freeze(['tether_energy', 'private_marker', 'shared_marker', 'group_altar', 'recovery_aura', 'movement_boon']);
export const EMERGENT_MARKERS = Object.freeze({
  silver_trail: Object.freeze({ x: -19, z: -9, label: 'Silver Trail' }),
  pale_gate: Object.freeze({ x: 19, z: 6, label: 'Pale Gate' }),
  echo_altar: Object.freeze({ x: 19, z: 9, label: 'Echo Altar' }),
  warden_ring: Object.freeze({ x: 15, z: 7, label: 'Warden Ring' }),
  lantern_grove: Object.freeze({ x: -10, z: 8, label: 'Lantern Grove' }),
});

const EFFECT_POLICIES = Object.freeze({
  tether_energy: Object.freeze({ triggers: ['exclusive_pair'], visibility: ['shared', 'participants'], target: 'pair' }),
  private_marker: Object.freeze({ triggers: ['explorer_travel', 'loner_isolation'], visibility: ['private'], target: 'subject', marker: true }),
  shared_marker: Object.freeze({ triggers: EMERGENT_TRIGGER_IDS, visibility: ['shared', 'participants'], target: 'subject', marker: true }),
  group_altar: Object.freeze({ triggers: ['collector_relics'], visibility: ['shared', 'participants'], target: 'subject' }),
  recovery_aura: Object.freeze({ triggers: ['guardian_cohesion'], visibility: ['shared', 'participants'], target: 'subject' }),
  movement_boon: Object.freeze({ triggers: ['explorer_travel', 'loner_isolation'], visibility: ['private', 'participants'], target: 'subject' }),
});

export const EMERGENT_DEFAULTS = Object.freeze({
  analysisIntervalMs: 2_000,
  maxActiveRules: 5,
  cooldownMs: 25_000,
  bondRange: 4.5,
  bondSeconds: 15,
  bondDurationMs: 75_000,
  bondSeparationRange: 9,
  bondEnergyLossPerSecond: 7,
  bondEnergyRecoveryPerSecond: 3,
  explorerDistance: 30,
  explorerLocations: 3,
  explorerDurationMs: 75_000,
  hoardRelics: 1,
  hoardDurationMs: 100_000,
  guardianRange: 6,
  guardianAllies: 2,
  guardianSeconds: 12,
  guardianDurationMs: 75_000,
  guardianRecoveryPerSecond: 9,
  lonerRange: 9,
  lonerSeconds: 12,
  lonerDurationMs: 60_000,
  maxEnergy: 100,
});

function stamp() { return Date.now(); }
function players(room) { return room?.players instanceof Map ? [...room.players.values()] : []; }
function distance(left, right) { return Math.hypot(Number(left?.x) - Number(right?.x), Number(left?.z) - Number(right?.z)); }
function safeNumber(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function activeGame(room) { return Boolean(room && ACTIVE_PHASES.has(room.phase) && players(room).length === 4); }
function rolePlayer(room, archetype) { return players(room).find((player) => player.archetype === archetype); }
function hasRelics(player) { return player?.relicIds instanceof Set ? player.relicIds.size : Array.isArray(player?.relicIds) ? player.relicIds.length : 0; }
function ensurePlayerState(player, settings) {
  player.emergent ||= {};
  player.emergent.energy = clamp(safeNumber(player.emergent.energy, settings.maxEnergy), 0, settings.maxEnergy);
  player.emergent.activeRuleIds ||= [];
  player.emergent.effects ||= [];
  return player.emergent;
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function ruleVisibleTo(rule, viewerId) {
  if (rule.privateTo) return rule.privateTo === viewerId;
  return rule.visibility !== 'participants' || Boolean(viewerId && rule.playerIds?.includes(viewerId));
}
function publicRule(rule) {
  const { privateTo, privateMessage, ...visible } = rule;
  return { ...visible, visibility: privateTo ? 'private' : 'shared' };
}

function ensureState(room) {
  room.emergentState ||= {};
  const state = room.emergentState;
  state.activeRules ||= [];
  state.history ||= [];
  state.nextId ||= 0;
  state.lastAnalyzedAt ||= 0;
  state.cooldowns ||= {};
  state.observations ||= { pairs: {}, guardianSeconds: 0, lonerSeconds: 0 };
  state.observations.pairs ||= {};
  return state;
}

function emit(world, room, type, message, options = {}) {
  return typeof world?.event === 'function' ? world.event(room, type, message, options) : null;
}

function addPrivateRule(player, rule) {
  player.privateRules ||= [];
  player.privateRules.push({ id: rule.id, title: rule.title, message: rule.privateMessage || rule.description, expiresAt: rule.expiresAt });
}

function removePrivateRule(room, ruleId) {
  for (const player of players(room)) {
    if (Array.isArray(player.privateRules)) player.privateRules = player.privateRules.filter((entry) => entry.id !== ruleId);
    if (Array.isArray(player.emergent?.activeRuleIds)) player.emergent.activeRuleIds = player.emergent.activeRuleIds.filter((id) => id !== ruleId);
  }
}

function isCoolingDown(state, type, now) { return safeNumber(state.cooldowns[type]) > now; }
function hasActiveType(state, type) { return state.activeRules.some((rule) => rule.type === type); }
function activeRuleForPlayer(state, type, playerId) { return state.activeRules.some((rule) => rule.type === type && rule.playerIds.includes(playerId)); }

function makeRule(room, state, specification, now) {
  const rule = {
    id: `emergent-${++state.nextId}-${now}`,
    source: 'behaviour-compiler',
    createdAt: now,
    expiresAt: now + specification.durationMs,
    ...specification,
  };
  state.activeRules.push(rule);
  state.history.push(rule);
  if (state.history.length > 32) state.history.shift();
  state.cooldowns[rule.type] = rule.expiresAt + specification.cooldownMs;
  for (const playerId of rule.playerIds) {
    const player = room.players.get(playerId);
    if (player) player.emergent.activeRuleIds.push(rule.id);
  }
  if (rule.privateTo) addPrivateRule(room.players.get(rule.privateTo), rule);
  return rule;
}

function announceRule(world, room, rule) {
  if (rule.privateTo) return emit(world, room, 'emergent-private-rule', rule.privateMessage, { privateTo: rule.privateTo, playerId: rule.privateTo, ruleId: rule.id, ruleType: rule.type });
  return emit(world, room, 'emergent-rule', rule.description, { ruleId: rule.id, ruleType: rule.type, playerIds: rule.playerIds });
}

function canCreate(state, type, now, settings) {
  return state.activeRules.length < settings.maxActiveRules && !hasActiveType(state, type) && !isCoolingDown(state, type, now);
}

function observationDelta(state, now, fallbackMs) {
  const previous = safeNumber(state.lastAnalyzedAt, now - fallbackMs);
  return clamp((now - previous) / 1000, 0, 5);
}

function pairKey(left, right) { return [left.id, right.id].sort().join(':'); }

function observePairs(room, state, deltaSeconds, settings) {
  const current = new Set();
  const group = players(room);
  for (let index = 0; index < group.length; index += 1) for (let next = index + 1; next < group.length; next += 1) {
    const left = group[index], right = group[next], key = pairKey(left, right);
    current.add(key);
    // A starting cluster is not a social bond. The pair becomes meaningful
    // only once both players keep choosing one another over the rest of the party.
    const exclusivePair = group.filter((player) => player.id !== left.id && player.id !== right.id)
      .every((player) => distance(left, player) > settings.bondRange && distance(right, player) > settings.bondRange);
    state.observations.pairs[key] = distance(left, right) <= settings.bondRange && exclusivePair
      ? safeNumber(state.observations.pairs[key]) + deltaSeconds
      : 0;
  }
  for (const key of Object.keys(state.observations.pairs)) if (!current.has(key)) delete state.observations.pairs[key];
}

function createBond(world, room, state, now, settings) {
  if (!canCreate(state, 'bond', now, settings)) return null;
  const entry = Object.entries(state.observations.pairs)
    .find(([, seconds]) => safeNumber(seconds) >= settings.bondSeconds);
  if (!entry) return null;
  const [leftId, rightId] = entry[0].split(':');
  const left = room.players.get(leftId), right = room.players.get(rightId);
  if (!left || !right) return null;
  const rule = makeRule(room, state, {
    type: 'bond', title: 'Entwined Lanterns', playerIds: [left.id, right.id],
    description: `${left.name} and ${right.name}'s lanterns are entwined. Stay close or both lights will weaken.`,
    durationMs: settings.bondDurationMs, cooldownMs: settings.cooldownMs,
    separationRange: settings.bondSeparationRange, energyLossPerSecond: settings.bondEnergyLossPerSecond,
    energyRecoveryPerSecond: settings.bondEnergyRecoveryPerSecond, separatedSeconds: 0,
  }, now);
  announceRule(world, room, rule);
  return rule;
}

function createExplorerVision(world, room, state, now, settings) {
  if (!canCreate(state, 'explorer_vision', now, settings)) return null;
  const explorer = rolePlayer(room, 'Explorer');
  if (!explorer || activeRuleForPlayer(state, 'explorer_vision', explorer.id)) return null;
  const locations = explorer.visited instanceof Set ? explorer.visited.size : 0;
  if (safeNumber(explorer.movement) < settings.explorerDistance && locations < settings.explorerLocations) return null;
  const rule = makeRule(room, state, {
    type: 'explorer_vision', title: 'Path-Sight', playerIds: [explorer.id], privateTo: explorer.id,
    description: 'The Explorer reads the shape of paths hidden from the party.',
    privateMessage: 'Only you can see a silver trail through the next hidden route. Follow it and tell the others what you find.',
    durationMs: settings.explorerDurationMs, cooldownMs: settings.cooldownMs,
    grants: ['hidden-path-insight'], marker: { x: -19, z: -9, label: 'Silver Trail' },
  }, now);
  announceRule(world, room, rule);
  return rule;
}

function createHoardValue(world, room, state, now, settings) {
  if (!canCreate(state, 'hoard_value', now, settings)) return null;
  const collector = rolePlayer(room, 'Collector');
  if (!collector || hasRelics(collector) < settings.hoardRelics) return null;
  const rule = makeRule(room, state, {
    type: 'hoard_value', title: 'Echo Debt', playerIds: [collector.id],
    description: `${collector.name}'s recovered relics now carry a shared echo. The party must bring them to the final altar together.`,
    durationMs: settings.hoardDurationMs, cooldownMs: settings.cooldownMs,
    objective: { kind: 'share-relics', collectorId: collector.id, requiredRelics: hasRelics(collector), status: 'active' },
  }, now);
  announceRule(world, room, rule);
  return rule;
}

function createGuardianProtection(world, room, state, now, deltaSeconds, settings) {
  const guardian = rolePlayer(room, 'Guardian');
  if (!guardian) return null;
  const nearby = players(room).filter((player) => player.id !== guardian.id && distance(player, guardian) <= settings.guardianRange);
  state.observations.guardianSeconds = nearby.length >= settings.guardianAllies
    ? safeNumber(state.observations.guardianSeconds) + deltaSeconds : 0;
  if (!canCreate(state, 'guardian_protection', now, settings) || state.observations.guardianSeconds < settings.guardianSeconds) return null;
  const rule = makeRule(room, state, {
    type: 'guardian_protection', title: "Warden's Shelter", playerIds: [guardian.id],
    description: `${guardian.name}'s steady presence shelters nearby allies; their lantern energy recovers while they stay close.`,
    durationMs: settings.guardianDurationMs, cooldownMs: settings.cooldownMs,
    radius: settings.guardianRange, recoveryPerSecond: settings.guardianRecoveryPerSecond,
  }, now);
  announceRule(world, room, rule);
  return rule;
}

function createSolitaryVision(world, room, state, now, deltaSeconds, settings) {
  const loner = rolePlayer(room, 'Loner');
  if (!loner) return null;
  const alone = players(room).filter((player) => player.id !== loner.id).every((player) => distance(player, loner) > settings.lonerRange);
  state.observations.lonerSeconds = alone ? safeNumber(state.observations.lonerSeconds) + deltaSeconds : 0;
  if (!canCreate(state, 'solitary_vision', now, settings) || state.observations.lonerSeconds < settings.lonerSeconds) return null;
  const rule = makeRule(room, state, {
    type: 'solitary_vision', title: 'Veil Omen', playerIds: [loner.id], privateTo: loner.id,
    description: 'The Loner hears a secret beyond the Veil.',
    privateMessage: 'The Veil shows you a private omen: a pale gate answers only after the party has awakened the shrine and gathered relics.',
    durationMs: settings.lonerDurationMs, cooldownMs: settings.cooldownMs,
    grants: ['private-omen'], marker: { x: 19, z: 6, label: 'Pale Gate Omen' },
  }, now);
  announceRule(world, room, rule);
  return rule;
}

function behaviourCandidates(room, state, settings) {
  const candidates = {};
  const paired = Object.entries(state.observations.pairs)
    .find(([, seconds]) => safeNumber(seconds) >= settings.bondSeconds);
  if (paired) candidates.exclusive_pair = { playerIds: paired[0].split(':') };

  const explorer = rolePlayer(room, 'Explorer');
  if (explorer && (safeNumber(explorer.movement) >= settings.explorerDistance || (explorer.visited instanceof Set ? explorer.visited.size : 0) >= settings.explorerLocations)) {
    candidates.explorer_travel = { playerIds: [explorer.id], subjectId: explorer.id };
  }
  const collector = rolePlayer(room, 'Collector');
  if (collector && hasRelics(collector) >= settings.hoardRelics) candidates.collector_relics = { playerIds: [collector.id], subjectId: collector.id };

  const guardian = rolePlayer(room, 'Guardian');
  if (guardian && safeNumber(state.observations.guardianSeconds) >= settings.guardianSeconds) candidates.guardian_cohesion = { playerIds: [guardian.id], subjectId: guardian.id };

  const loner = rolePlayer(room, 'Loner');
  if (loner && safeNumber(state.observations.lonerSeconds) >= settings.lonerSeconds) candidates.loner_isolation = { playerIds: [loner.id], subjectId: loner.id };
  return candidates;
}

function directiveText(world, value, fallback, maximum) {
  return typeof world?.cleanText === 'function' ? world.cleanText(value, fallback, maximum) : String(value || fallback).replace(/[<>]/g, '').trim().slice(0, maximum);
}

function requestedDuration(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? clamp(Math.round(seconds * 1000), 10_000, 120_000) : fallback;
}

/**
 * Validate and materialize one AI-selected combination of safe primitives.
 * The AI supplies no code, positions, stat values, or roles; it can only bind
 * an observed behaviour to a compatible reversible effect from this catalog.
 */
export function applyEmergentDirective(world, room, directive, now = stamp(), options = {}) {
  const settings = { ...EMERGENT_DEFAULTS, ...options };
  if (!activeGame(room)) return { ok: false, error: 'Emergent rules require four assigned players in an active game.' };
  if (!directive || typeof directive !== 'object' || Array.isArray(directive)) return { ok: false, error: 'An emergent rule directive is required.' };
  const triggerId = String(directive.triggerId || '').trim();
  const effectId = String(directive.effectId || '').trim();
  const visibility = String(directive.visibility || 'shared').trim();
  const policy = EFFECT_POLICIES[effectId];
  if (!EMERGENT_TRIGGER_IDS.includes(triggerId) || !policy || !policy.triggers.includes(triggerId)) return { ok: false, error: 'That behaviour and effect cannot safely be combined.' };
  if (!policy.visibility.includes(visibility)) return { ok: false, error: 'That visibility is not safe for the selected effect.' };
  const state = ensureState(room);
  for (const player of players(room)) ensurePlayerState(player, settings);
  const candidate = behaviourCandidates(room, state, settings)[triggerId];
  if (!candidate) return { ok: false, error: 'The selected behaviour is not currently evidenced by the group.' };
  const cooldownKey = `ai:${triggerId}:${effectId}`;
  if (state.activeRules.length >= settings.maxActiveRules || isCoolingDown(state, cooldownKey, now)) return { ok: false, error: 'That emergent law is already active or cooling down.' };
  const marker = policy.marker ? EMERGENT_MARKERS[String(directive.markerId || '')] : null;
  if (policy.marker && !marker) return { ok: false, error: 'Select one known world marker for this information rule.' };
  const subject = room.players.get(candidate.subjectId || candidate.playerIds[0]);
  const durationMs = requestedDuration(directive.durationSeconds, 60_000);
  const title = directiveText(world, directive.title, 'A New Law', 64);
  const description = directiveText(world, directive.message, 'The Game Master has changed a law of this world.', 280);
  const privateTo = visibility === 'private' ? subject?.id : null;
  const effect = effectId === 'tether_energy' ? { kind: effectId, separationRange: settings.bondSeparationRange, energyLossPerSecond: settings.bondEnergyLossPerSecond, energyRecoveryPerSecond: settings.bondEnergyRecoveryPerSecond }
    : effectId === 'recovery_aura' ? { kind: effectId, radius: settings.guardianRange, recoveryPerSecond: settings.guardianRecoveryPerSecond }
      : effectId === 'group_altar' ? { kind: effectId, objective: { kind: 'share-relics', collectorId: subject?.id, requiredRelics: hasRelics(subject), status: 'active' } }
        : effectId === 'movement_boon' ? { kind: effectId, multiplier: 1.2 } : { kind: effectId };
  const rule = makeRule(room, state, {
    type: effectId, triggerId, title, description, playerIds: candidate.playerIds, visibility, privateTo,
    durationMs, cooldownMs: settings.cooldownMs, marker: marker ? { ...marker } : undefined, effect,
  }, now);
  state.cooldowns[cooldownKey] = rule.expiresAt + settings.cooldownMs;
  announceRule(world, room, rule);
  return { ok: true, rule: publicRule(rule) };
}

/**
 * Remove expired rules and their reversible player effects.  This is safe to
 * call every server tick; it returns the rules which expired on this call.
 */
export function expireEmergentRules(world, room, now = stamp()) {
  const state = ensureState(room);
  const expired = state.activeRules.filter((rule) => rule.expiresAt <= now);
  if (!expired.length) return [];
  state.activeRules = state.activeRules.filter((rule) => rule.expiresAt > now);
  for (const rule of expired) {
    removePrivateRule(room, rule.id);
    emit(world, room, 'emergent-rule-expired', `${rule.title} fades as the group changes.`, { ruleId: rule.id, ruleType: rule.type });
  }
  return expired;
}

/**
 * Analyze the latest server-owned behaviour and produce at most one new rule.
 * This throttling makes a rule feel like a considered GM decision, rather than
 * a noisy reaction to every movement packet.
 */
export function analyzeEmergentRules(world, room, now = stamp(), options = {}) {
  const settings = { ...EMERGENT_DEFAULTS, ...options };
  if (!activeGame(room)) return { created: null, reason: 'A full assigned four-player game is required.' };
  const state = ensureState(room);
  if (now - state.lastAnalyzedAt < settings.analysisIntervalMs) return { created: null, reason: 'Analysis interval has not elapsed.' };
  const deltaSeconds = observationDelta(state, now, settings.analysisIntervalMs);
  state.lastAnalyzedAt = now;
  for (const player of players(room)) ensurePlayerState(player, settings);
  observePairs(room, state, deltaSeconds, settings);

  const created = createBond(world, room, state, now, settings)
    || createExplorerVision(world, room, state, now, settings)
    || createHoardValue(world, room, state, now, settings)
    || createGuardianProtection(world, room, state, now, deltaSeconds, settings)
    || createSolitaryVision(world, room, state, now, deltaSeconds, settings);
  return { created, reason: created ? null : 'No new behaviour pattern crossed a rule threshold.' };
}

function applyBondEnergy(room, rule, deltaSeconds, settings) {
  const [left, right] = rule.playerIds.map((id) => room.players.get(id));
  if (!left || !right) return;
  const separated = distance(left, right) > rule.separationRange;
  rule.separatedSeconds = separated ? safeNumber(rule.separatedSeconds) + deltaSeconds : 0;
  const change = (separated ? -rule.energyLossPerSecond : rule.energyRecoveryPerSecond) * deltaSeconds;
  for (const player of [left, right]) {
    const state = ensurePlayerState(player, settings);
    state.energy = clamp(state.energy + change, 0, settings.maxEnergy);
    if (separated) state.effects.push('bond-separated');
  }
}

function applyGuardianRecovery(room, rule, deltaSeconds, settings) {
  const guardian = room.players.get(rule.playerIds[0]);
  if (!guardian) return;
  for (const player of players(room)) if (player.id !== guardian.id && distance(player, guardian) <= rule.radius) {
    const state = ensurePlayerState(player, settings);
    state.energy = clamp(state.energy + rule.recoveryPerSecond * deltaSeconds, 0, settings.maxEnergy);
    state.effects.push('warded');
  }
}

function updateHoardObjective(room, rule) {
  const collector = room.players.get(rule.objective.collectorId);
  if (!collector) { rule.objective.status = 'lost'; return; }
  const finaleActive = room.finalObjective?.status === 'active';
  rule.objective.currentRelics = hasRelics(collector);
  if (finaleActive && rule.objective.currentRelics >= rule.objective.requiredRelics) rule.objective.status = 'ready';
}

/** Apply active mechanical effects from the authoritative game clock. */
export function tickEmergentRules(world, room, deltaSeconds, now = stamp(), options = {}) {
  const settings = { ...EMERGENT_DEFAULTS, ...options };
  if (!room) return { expired: [], analysis: null };
  const safeDelta = clamp(safeNumber(deltaSeconds), 0, 0.25);
  for (const player of players(room)) { const state = ensurePlayerState(player, settings); state.effects = []; }
  const expired = expireEmergentRules(world, room, now);
  if (activeGame(room)) for (const rule of ensureState(room).activeRules) {
    const effect = rule.effect?.kind;
    if (rule.type === 'bond' || effect === 'tether_energy') applyBondEnergy(room, effect ? { ...rule, ...rule.effect } : rule, safeDelta, settings);
    if (rule.type === 'guardian_protection' || effect === 'recovery_aura') applyGuardianRecovery(room, effect ? { ...rule, ...rule.effect } : rule, safeDelta, settings);
    if (rule.type === 'hoard_value') updateHoardObjective(room, rule);
    if (effect === 'group_altar') updateHoardObjective(room, rule.effect);
    if (effect === 'movement_boon') for (const playerId of rule.playerIds) room.players.get(playerId)?.emergent.effects.push('swift');
  }
  for (const player of players(room)) {
    const state = ensurePlayerState(player, settings);
    if (state.energy <= settings.maxEnergy * 0.3) state.effects.push('weakened');
  }
  const analysis = analyzeEmergentRules(world, room, now, settings);
  return { expired, analysis };
}

/**
 * Viewer-safe data for the existing world-state response. Private vision text
 * is included only for its owner; other players can still discover its effect
 * through play.
 */
export function serializeEmergentRules(room, viewerId = null, now = stamp()) {
  const state = ensureState(room);
  const viewer = viewerId ? room.players.get(viewerId) : null;
  const visibleRules = state.activeRules.filter((rule) => ruleVisibleTo(rule, viewerId));
  return {
    activeRules: visibleRules.map(publicRule),
    recentHistory: state.history.slice(-12).filter((rule) => ruleVisibleTo(rule, viewerId)).map(publicRule),
    markers: visibleRules.map((rule) => rule.marker).filter(Boolean),
    yourState: viewer ? {
      energy: ensurePlayerState(viewer, EMERGENT_DEFAULTS).energy,
      activeRuleIds: [...ensurePlayerState(viewer, EMERGENT_DEFAULTS).activeRuleIds],
      effects: [...(ensurePlayerState(viewer, EMERGENT_DEFAULTS).effects || [])],
      privateRules: (viewer.privateRules || []).filter((rule) => !rule.expiresAt || rule.expiresAt > now),
    } : null,
  };
}

/** Interaction constraints created by a social rule, kept out of server.mjs. */
export function validateEmergentInteraction(room, player, action, entity) {
  const rule = ensureState(room).activeRules.find((item) => (item.type === 'hoard_value' ? item.objective : item.effect?.kind === 'group_altar' ? item.effect.objective : null)?.collectorId === player?.id);
  if (!rule || action !== 'offer-relics' || entity?.id !== 'final-altar') return { ok: true };
  const nearbyAllies = players(room).filter((other) => distance(other, entity) <= 6).length;
  return nearbyAllies >= 3 ? { ok: true, rule } : { ok: false, error: 'The relic echo needs at least three lanterns gathered at the altar.' };
}

export function completeEmergentInteraction(room, player, action, entity) {
  const outcome = validateEmergentInteraction(room, player, action, entity);
  if (outcome.ok && outcome.rule) (outcome.rule.effect?.objective || outcome.rule.objective).status = 'fulfilled';
  return outcome;
}

export function emergentMovementMultiplier(room, player, settings = EMERGENT_DEFAULTS) {
  const energy = ensurePlayerState(player, settings).energy;
  const energyMultiplier = energy <= 0 ? 0.5 : energy <= settings.maxEnergy * 0.3 ? 0.7 : 1;
  const boonMultiplier = (ensureState(room).activeRules || []).filter((rule) => rule.effect?.kind === 'movement_boon' && rule.playerIds.includes(player.id))
    .reduce((highest, rule) => Math.max(highest, safeNumber(rule.effect.multiplier, 1)), 1);
  return energyMultiplier * boonMultiplier;
}

/**
 * Dependency-injected façade. The only optional world API member is `event`,
 * used to notify clients; game state remains valid without it, which keeps the
 * compiler easy to test in isolation.
 */
export function createEmergentRules(world, options = {}) {
  const settings = Object.freeze({ ...EMERGENT_DEFAULTS, ...options });
  return Object.freeze({
    types: EMERGENT_RULE_TYPES,
    analyze: (room, now) => analyzeEmergentRules(world, room, now, settings),
    tick: (room, deltaSeconds, now) => tickEmergentRules(world, room, deltaSeconds, now, settings),
    expire: (room, now) => expireEmergentRules(world, room, now),
    serialize: (room, viewerId, now) => serializeEmergentRules(room, viewerId, now),
    validateInteraction: (room, player, action, entity) => validateEmergentInteraction(room, player, action, entity),
    completeInteraction: (room, player, action, entity) => completeEmergentInteraction(room, player, action, entity),
    movementMultiplier: (room, player) => emergentMovementMultiplier(room, player, settings),
    apply: (room, directive, now) => applyEmergentDirective(world, room, directive, now, settings),
  });
}
