// Safe, data-driven rule cards for an AI Game Master.  This module deliberately
// does not accept arbitrary code, locations, entity changes, or stat changes:
// the AI can only choose one of these authored cards and parameter values.

import { ARCHETYPES, FEATURES, MAX_PLAYERS } from '../shared/game-content.js';

export const DIRECTOR_CARD_TYPES = Object.freeze([
  'private_hint',
  'unlock_shortcut',
  'role_request',
  'cooperation_request',
  'world_mood',
  'temporary_boon',
  'temporary_obstacle',
  'story_turn',
  'finale_variant',
]);

export const SHORTCUTS = Object.freeze({
  lantern_path: Object.freeze({ feature: 'secret-path', label: 'Lantern Path', roles: ['Explorer', 'Loner'] }),
  warden_way: Object.freeze({ feature: 'invisible-bridge', label: 'Warden Way', roles: ['Guardian'] }),
  veil_passage: Object.freeze({ feature: 'hidden-portal', label: 'Veil Passage', roles: ['Loner'] }),
});

export const ROLE_REQUESTS = Object.freeze({
  explorer_scout: Object.freeze({ role: 'Explorer', title: 'Trace the Unseen', description: 'Find the next hidden landmark for the party.' }),
  collector_recover: Object.freeze({ role: 'Collector', title: 'Echoes in the Water', description: 'Recover a relic from Echo Water.' }),
  guardian_watch: Object.freeze({ role: 'Guardian', title: 'Hold the Line', description: 'Lead the group safely to the shrine.' }),
  loner_omen: Object.freeze({ role: 'Loner', title: 'Read the Veil', description: 'Seek an omen beyond the Spirit Portal.' }),
});

export const WORLD_MOODS = Object.freeze({
  dawn: Object.freeze({ label: 'Dawn', description: 'Warm lanternlight reveals the party’s next objective.' }),
  mist: Object.freeze({ label: 'Whispering Mist', description: 'A soft mist settles over Everdawn; hidden signs glow.' }),
  storm: Object.freeze({ label: 'Warden Storm', description: 'Thunder rolls across the shrine, heightening the tale.' }),
  starlight: Object.freeze({ label: 'Veil Starlight', description: 'Starlight exposes spirit traces and old routes.' }),
});

export const BOONS = Object.freeze({
  guiding_light: Object.freeze({ label: 'Guiding Light', description: 'A private light points toward the active objective.' }),
  swift_step: Object.freeze({ label: 'Swift Step', description: 'A short burst of confidence makes travel feel lighter.' }),
  shared_sight: Object.freeze({ label: 'Shared Sight', description: 'The party can see the bearer’s next discovery.' }),
});

// Obstacles are narrative/visual modifiers until a matching map mechanic is
// explicitly implemented.  None can change collision or remove a valid route.
export const OBSTACLES = Object.freeze({
  mist_bank: Object.freeze({ label: 'Mist Bank', description: 'Landmarks blur, but glowing signs remain visible.' }),
  echo_current: Object.freeze({ label: 'Echo Current', description: 'Echo Water churns, calling for the Collector’s attention.' }),
  fallen_leaves: Object.freeze({ label: 'Fallen Leaves', description: 'A path is obscured, but never closed.' }),
});

// A story turn is selected and resolved by the AI Director. It intentionally
// exposes no player voting or arbitrary feature selection surface.
export const STORY_TURNS = Object.freeze({
  shrine_or_vault: Object.freeze({
    prompt: 'Which memory should Everdawn protect first?',
    options: Object.freeze([
      Object.freeze({ id: 'shrine', label: 'Protect the shrine', feature: 'healing-shrine' }),
      Object.freeze({ id: 'vault', label: 'Pursue the relic vault', feature: 'relic-vault' }),
    ]),
  }),
  path_or_veil: Object.freeze({
    prompt: 'Where should the tale turn next?',
    options: Object.freeze([
      Object.freeze({ id: 'path', label: 'Follow the hidden path', feature: 'secret-path' }),
      Object.freeze({ id: 'veil', label: 'Listen beyond the veil', feature: 'spirit-realm' }),
    ]),
  }),
});

export const FINALE_VARIANTS = Object.freeze({
  lantern_rite: Object.freeze({ title: 'Lantern Rite', description: 'Gather the four callings around the awakened temple.' }),
  echo_accord: Object.freeze({ title: 'Echo Accord', description: 'Let relic, shrine, temple, and veil answer one another.' }),
});

export const DIRECTOR_RULE_CARDS = Object.freeze({
  private_hint: Object.freeze({ audience: 'one player', phases: ['evolving', 'finale'], durationMs: 45_000 }),
  unlock_shortcut: Object.freeze({ audience: 'party', phases: ['evolving', 'finale'], durationMs: 0 }),
  role_request: Object.freeze({ audience: 'one role', phases: ['evolving', 'finale'], durationMs: 90_000 }),
  cooperation_request: Object.freeze({ audience: 'two to four roles', phases: ['evolving', 'finale'], durationMs: 90_000 }),
  world_mood: Object.freeze({ audience: 'party', phases: ['evolving', 'finale'], durationMs: 60_000 }),
  temporary_boon: Object.freeze({ audience: 'one player', phases: ['evolving', 'finale'], durationMs: 45_000 }),
  temporary_obstacle: Object.freeze({ audience: 'party', phases: ['evolving', 'finale'], durationMs: 45_000 }),
  // The Director chooses the branch immediately. Players see the consequence,
  // but never vote on or override the AI's authored turn.
  story_turn: Object.freeze({ audience: 'party', phases: ['evolving', 'finale'], durationMs: 0 }),
  finale_variant: Object.freeze({ audience: 'party', phases: ['finale'], durationMs: 0 }),
});

const MAX_MESSAGE_LENGTH = 280;
const MAX_ACTIVE_RULES = 6;
const MIN_DURATION_MS = 5_000;
const MAX_DURATION_MS = 120_000;

function stamp() { return Date.now(); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function result(ok, payload) { return ok ? { ok: true, ...payload } : { ok: false, ...payload }; }
function safeText(world, value, fallback, max = MAX_MESSAGE_LENGTH) {
  return typeof world.cleanText === 'function' ? world.cleanText(value, fallback, max) : String(value || fallback).slice(0, max);
}
function allPlayers(room) { return [...room.players.values()]; }
function playerForRole(room, role) { return allPlayers(room).find((player) => player.archetype === role); }
function activeState(room) {
  if (!room.directorState) room.directorState = { activeRules: [], history: [], sequence: 0 };
  room.directorState.activeRules ||= [];
  room.directorState.history ||= [];
  room.directorState.sequence ||= 0;
  return room.directorState;
}
function requestedDuration(card, directive) {
  if (!DIRECTOR_RULE_CARDS[card].durationMs) return 0;
  const raw = Number(directive.durationMs);
  return Number.isFinite(raw) ? Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(raw))) : DIRECTOR_RULE_CARDS[card].durationMs;
}
function normalizeDirective(directive) {
  if (!isObject(directive)) return null;
  const card = directive.card || directive.type;
  const payload = isObject(directive.payload) ? { ...directive, ...directive.payload } : directive;
  return typeof card === 'string' ? { card, payload } : null;
}
function assignedGame(room) { return room.players.size === MAX_PLAYERS && ['evolving', 'finale'].includes(room.phase); }
function ensureWorldApi(world) {
  const missing = ['getPlayer', 'event', 'unlock'].filter((key) => typeof world?.[key] !== 'function');
  return missing.length ? `Director rules need world.${missing.join(', world.')}().` : null;
}
function validationContext(world, room, directive) {
  const parsed = normalizeDirective(directive);
  if (!parsed || !DIRECTOR_CARD_TYPES.includes(parsed.card)) return result(false, { error: 'Unknown director card.' });
  const apiError = ensureWorldApi(world); if (apiError) return result(false, { error: apiError });
  expireDirectorRules(room);
  if (!assignedGame(room)) return result(false, { error: 'Director cards require four assigned players in an active game.' });
  const definition = DIRECTOR_RULE_CARDS[parsed.card];
  if (!definition.phases.includes(room.phase)) return result(false, { error: `${parsed.card} is not available during ${room.phase}.` });
  if (definition.durationMs && activeState(room).activeRules.length >= MAX_ACTIVE_RULES) return result(false, { error: 'Too many active director rules; wait for one to expire.' });
  return result(true, { ...parsed, definition });
}
function publicNarration(world, room, type, message, metadata = {}) {
  return world.event(room, type, safeText(world, message, 'The world shifts.'), metadata);
}
function recordRule(room, card, data, durationMs, now) {
  const state = activeState(room);
  const rule = { id: `director-${++state.sequence}-${now}`, card, createdAt: now, expiresAt: durationMs ? now + durationMs : null, ...data };
  if (rule.expiresAt) state.activeRules.push(rule);
  state.history.push(rule); if (state.history.length > 24) state.history.shift();
  return rule;
}
function knownFeature(feature) { return FEATURES.has(feature); }
function cardMessage(world, payload, fallback) { return safeText(world, payload.message, fallback); }

/**
 * Checks a proposed AI decision without changing game state.  Directives may
 * put card arguments beside `card`, or inside a `payload` object.
 */
export function validateDirectorDirective(world, room, directive) {
  const context = validationContext(world, room, directive);
  if (!context.ok) return context;
  const { card, payload } = context;
  const player = (id) => world.getPlayer(room, String(id || ''));

  if (card === 'private_hint' || card === 'temporary_boon') {
    const target = player(payload.playerId);
    if (!target?.archetype) return result(false, { error: 'Choose one currently assigned player.' });
    if (card === 'private_hint' && !safeText(world, payload.message, '')) return result(false, { error: 'A private hint needs a message.' });
    if (card === 'temporary_boon' && !BOONS[payload.boonId]) return result(false, { error: 'Unknown boon.' });
  }
  if (card === 'unlock_shortcut' && !SHORTCUTS[payload.shortcutId]) return result(false, { error: 'Unknown shortcut.' });
  if (card === 'role_request') {
    const request = ROLE_REQUESTS[payload.requestId];
    if (!request || !playerForRole(room, request.role)) return result(false, { error: 'Choose an available role request.' });
  }
  if (card === 'cooperation_request') {
    const roles = Array.isArray(payload.roles) ? [...new Set(payload.roles)] : [];
    if (roles.length < 2 || roles.length > MAX_PLAYERS || roles.some((role) => !ARCHETYPES.includes(role) || !playerForRole(room, role))) return result(false, { error: 'A cooperation request needs two to four assigned, unique roles.' });
    if (!safeText(world, payload.title, '') || !safeText(world, payload.message, '')) return result(false, { error: 'A cooperation request needs a title and message.' });
  }
  if (card === 'world_mood' && !WORLD_MOODS[payload.moodId]) return result(false, { error: 'Unknown world mood.' });
  if (card === 'temporary_obstacle' && !OBSTACLES[payload.obstacleId]) return result(false, { error: 'Unknown safe obstacle.' });
  if (card === 'story_turn') {
    const turn = STORY_TURNS[payload.turnId];
    if (!turn) return result(false, { error: 'Unknown story turn.' });
    if (!turn.options.some((option) => option.id === payload.optionId)) return result(false, { error: 'The AI must select one valid story option.' });
  }
  if (card === 'finale_variant' && (!room.finalObjective || !['awaiting-rites', 'entrance-revealed', 'active'].includes(room.finalObjective.status) || !FINALE_VARIANTS[payload.variantId])) return result(false, { error: 'A prepared finale and a known finale variant are required.' });
  return context;
}

/** Remove expired temporary rules. Call this from the existing server tick. */
export function expireDirectorRules(room, now = stamp()) {
  const state = activeState(room);
  const expired = state.activeRules.filter((rule) => rule.expiresAt && rule.expiresAt <= now);
  if (!expired.length) return [];
  state.activeRules = state.activeRules.filter((rule) => !rule.expiresAt || rule.expiresAt > now);
  const expiredIds = new Set(expired.map((rule) => rule.id));
  for (const player of allPlayers(room)) player.privateRules = (player.privateRules || []).filter((rule) => !expiredIds.has(rule.id));
  return expired;
}

/**
 * Executes one validated, whitelisted card.  The result is serializable and
 * can be returned directly by an MCP route.  No card changes player roles,
 * movement collision, earned relics, or finale completion state.
 */
export function applyDirectorDirective(world, room, directive, options = {}) {
  const checked = validateDirectorDirective(world, room, directive);
  if (!checked.ok) return checked;
  const { card, payload } = checked;
  const now = Number.isFinite(options.now) ? options.now : stamp();
  expireDirectorRules(room, now);
  const durationMs = requestedDuration(card, payload);
  const source = safeText(world, options.source, 'AI Game Master', 48);
  let rule, event, unlockResult;

  if (card === 'private_hint') {
    const target = world.getPlayer(room, String(payload.playerId));
    const message = cardMessage(world, payload, 'A faint light points the way.');
    rule = recordRule(room, card, { playerId: target.id, message, source }, durationMs, now);
    target.privateRules ||= []; target.privateRules.push({ id: rule.id, title: 'Private Hint', message, expiresAt: rule.expiresAt });
    event = world.event(room, 'director-private-hint', message, { privateTo: target.id, playerId: target.id, ruleId: rule.id });
  }

  if (card === 'unlock_shortcut') {
    const shortcut = SHORTCUTS[payload.shortcutId];
    if (!knownFeature(shortcut.feature)) return result(false, { error: 'Shortcut points to an unavailable world feature.' });
    unlockResult = world.unlock(room, shortcut.feature, cardMessage(world, payload, `${shortcut.label} has opened.`));
    if (!unlockResult.ok) return unlockResult;
    rule = recordRule(room, card, { shortcutId: payload.shortcutId, feature: shortcut.feature, source }, 0, now);
  }

  if (card === 'role_request') {
    const request = ROLE_REQUESTS[payload.requestId];
    rule = recordRule(room, card, { requestId: payload.requestId, role: request.role, title: request.title, message: request.description, source }, durationMs, now);
    event = publicNarration(world, room, 'director-role-request', `${request.role}: ${request.title} — ${request.description}`, { ruleId: rule.id, role: request.role });
  }

  if (card === 'cooperation_request') {
    const roles = [...new Set(payload.roles)];
    const title = safeText(world, payload.title, 'Shared Rite', 80);
    const message = safeText(world, payload.message, 'Work together to answer the world.', MAX_MESSAGE_LENGTH);
    rule = recordRule(room, card, { roles, title, message, source }, durationMs, now);
    event = publicNarration(world, room, 'director-cooperation-request', `${title}: ${roles.join(', ')} — ${message}`, { ruleId: rule.id, roles });
  }

  if (card === 'world_mood') {
    const mood = WORLD_MOODS[payload.moodId];
    rule = recordRule(room, card, { moodId: payload.moodId, label: mood.label, message: mood.description, source }, durationMs, now);
    room.director = { narration: mood.description, source, at: now, mood: payload.moodId, expiresAt: rule.expiresAt };
    event = publicNarration(world, room, 'director-world-mood', `${mood.label}: ${mood.description}`, { ruleId: rule.id, moodId: payload.moodId });
  }

  if (card === 'temporary_boon') {
    const target = world.getPlayer(room, String(payload.playerId));
    const boon = BOONS[payload.boonId];
    rule = recordRule(room, card, { playerId: target.id, boonId: payload.boonId, label: boon.label, message: boon.description, source }, durationMs, now);
    target.privateRules ||= []; target.privateRules.push({ id: rule.id, title: boon.label, message: boon.description, expiresAt: rule.expiresAt });
    event = world.event(room, 'director-boon', `${boon.label}: ${boon.description}`, { privateTo: target.id, playerId: target.id, ruleId: rule.id });
  }

  if (card === 'temporary_obstacle') {
    const obstacle = OBSTACLES[payload.obstacleId];
    rule = recordRule(room, card, { obstacleId: payload.obstacleId, label: obstacle.label, message: obstacle.description, source }, durationMs, now);
    event = publicNarration(world, room, 'director-safe-obstacle', `${obstacle.label}: ${obstacle.description}`, { ruleId: rule.id, obstacleId: payload.obstacleId });
  }

  if (card === 'story_turn') {
    const turn = STORY_TURNS[payload.turnId];
    const selected = turn.options.find((option) => option.id === payload.optionId);
    if (!knownFeature(selected.feature)) return result(false, { error: 'Story turn points to an unavailable world feature.' });
    unlockResult = world.unlock(room, selected.feature, `${turn.prompt} The Director chose: ${selected.label}.`);
    if (!unlockResult.ok) return unlockResult;
    rule = recordRule(room, card, { turnId: payload.turnId, selectedOptionId: selected.id, label: selected.label, feature: selected.feature, source }, durationMs, now);
    event = publicNarration(world, room, 'director-story-turn', `${turn.prompt} The Director chose: ${selected.label}.`, { ruleId: rule.id, turnId: payload.turnId, optionId: selected.id });
  }

  if (card === 'finale_variant') {
    const variant = FINALE_VARIANTS[payload.variantId];
    room.finalObjective.variant = { id: payload.variantId, title: variant.title, description: variant.description, chosenAt: now, source };
    room.director = { ...room.director, narration: variant.description, source, at: now, finaleVariant: payload.variantId };
    rule = recordRule(room, card, { variantId: payload.variantId, title: variant.title, message: variant.description, source }, 0, now);
    event = publicNarration(world, room, 'director-finale-variant', `${variant.title}: ${variant.description}`, { variantId: payload.variantId });
  }

  if (typeof world.markGmActive === 'function') world.markGmActive(room);
  if (typeof world.broadcastState === 'function') world.broadcastState(room);
  return result(true, { card, rule, event, unlock: unlockResult?.feature || null });
}

/** Factory form for dependency injection in routes, sockets, or a game tick. */
export function createDirectorRules(world, options = {}) {
  return Object.freeze({
    cards: DIRECTOR_RULE_CARDS,
    validate: (room, directive) => validateDirectorDirective(world, room, directive),
    apply: (room, directive) => applyDirectorDirective(world, room, directive, options),
    expire: (room, now) => expireDirectorRules(room, now),
  });
}
