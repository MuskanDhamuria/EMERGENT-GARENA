// Pure, browser-safe presentation helpers for rules the AI has made from the
// party's behaviour. The server stays authoritative: this module only makes
// already-serialized state safe and useful for a player HUD.

const EMPTY = Object.freeze([]);
const DEFAULT_MAX_ENERGY = 100;

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : EMPTY;
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim()
    ? value.replace(/\s+/g, ' ').trim()
    : fallback;
}

function boundedNumber(value, fallback, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function titleCase(value) {
  return cleanText(String(value || '').replaceAll(/[-_]/g, ' '))
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ruleType(rule = {}) {
  return cleanText(rule.type || rule.kind || rule.ruleType || rule.card).toLowerCase();
}

function ruleTargets(rule = {}) {
  return [...new Set([
    ...asList(rule.playerIds),
    ...asList(rule.participantIds),
    ...asList(rule.partnerIds),
    ...asList(rule.targets),
    ...asList(rule.playerId),
    ...asList(rule.targetPlayerId),
  ].map((target) => typeof target === 'object' ? target.id : target).filter(Boolean))];
}

function playerIndex(world = {}) {
  return new Map(asList(world.players).filter((player) => player?.id).map((player) => [player.id, player]));
}

function playerName(players, id) {
  return cleanText(players.get(id)?.name, 'another wanderer');
}

function durationSeconds(rule, now) {
  const expiresAt = boundedNumber(rule?.expiresAt, null);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

function isPrivateRule(rule) {
  const visibility = cleanText(rule?.visibility || rule?.scope).toLowerCase();
  return rule?.private === true || ['private', 'personal', 'hidden'].includes(visibility);
}

function isVisibleToPlayer(rule, playerId) {
  if (!playerId || !isPrivateRule(rule)) return true;
  return ruleTargets(rule).includes(playerId);
}

function rawEmergentState(world = {}) {
  return world?.emergentRules || world?.world?.emergentRules || {};
}

function statusForPlayer(world, state, playerId) {
  const player = playerIndex(world).get(playerId) || {};
  const statuses = state.playerStatus || state.statusByPlayer || state.statuses || {};
  const listed = asList(statuses).find((status) => status?.playerId === playerId || status?.id === playerId);
  const mapped = statuses && !Array.isArray(statuses) ? statuses[playerId] : null;
  return { ...player.emergentStatus, ...player.status, ...mapped, ...listed, ...player };
}

/**
 * Turns an energy/status payload into stable values that a canvas or DOM HUD
 * can draw. `available` avoids inventing an energy meter before the server
 * has supplied one.
 */
export function formatEnergyStatus(status = {}) {
  const hasEnergy = Number.isFinite(Number(status.energy ?? status.currentEnergy));
  const maxEnergy = Math.max(1, boundedNumber(status.maxEnergy ?? status.energyMax, DEFAULT_MAX_ENERGY, 1));
  const energy = hasEnergy ? boundedNumber(status.energy ?? status.currentEnergy, maxEnergy, 0, maxEnergy) : null;
  const ratio = energy === null ? null : energy / maxEnergy;
  const state = cleanText(status.state || status.condition || status.status).toLowerCase();
  const depleted = energy !== null && energy <= 0;
  const weakened = depleted || state === 'weakened' || (ratio !== null && ratio <= 0.3);
  const effects = asList(status.effects || status.activeEffects || status.tags)
    .map((effect) => typeof effect === 'string' ? effect : effect?.label || effect?.id)
    .map((effect) => cleanText(effect))
    .filter(Boolean);
  const label = depleted ? 'Drained' : weakened ? 'Weakened' : state ? titleCase(state) : 'Steady';
  return {
    available: hasEnergy || Boolean(state) || effects.length > 0,
    energy,
    maxEnergy,
    ratio,
    label,
    tone: depleted ? 'danger' : weakened ? 'warning' : 'steady',
    effects,
  };
}

/** Formats one social rule for a player without exposing other players' private data. */
export function formatSocialRule(rule = {}, world = {}, playerId = null, now = Date.now()) {
  const players = playerIndex(world);
  const type = ruleType(rule);
  const targets = ruleTargets(rule);
  const partners = targets.filter((id) => id !== playerId).map((id) => playerName(players, id));
  const partnerText = partners.length ? partners.join(' and ') : 'your linked wanderer';
  const status = formatEnergyStatus(statusForPlayer(world, rawEmergentState(world), playerId));
  const defaultMessage = {
    bond: `You are linked to ${partnerText}. Stay close; distance weakens you both.`,
    tether: `You are linked to ${partnerText}. Stay close; distance weakens you both.`,
    explorer_vision: 'Only you can see hidden paths. Lead the party when you find one.',
    path_sight: 'Only you can see hidden paths. Lead the party when you find one.',
    explorer_sight: 'Only you can see hidden paths. Lead the party when you find one.',
    hoard_value: 'The objects you gathered have become valuable. The party may need them.',
    hoarder: 'The objects you gathered have become valuable. The party may need them.',
    guardian_protection: 'Your proximity protects nearby wanderers. Stay close when they need you.',
    guardian_aura: 'Your proximity protects nearby wanderers. Stay close when they need you.',
    protector: 'Your proximity protects nearby wanderers. Stay close when they need you.',
    solitary_vision: 'You alone can see a clue the party will need.',
    private_vision: 'You alone can see a clue the party will need.',
    lone_vision: 'You alone can see a clue the party will need.',
  }[type] || 'The Game Master has changed a law of this world.';
  const message = cleanText(rule.message || rule.description || rule.instruction, defaultMessage);
  const secondsRemaining = durationSeconds(rule, now);
  const active = secondsRemaining === null || secondsRemaining > 0;
  return {
    id: cleanText(rule.id, type || 'emergent-rule'),
    type: type || 'emergent_rule',
    title: cleanText(rule.title || rule.label, titleCase(type || 'New world law')),
    message,
    private: isPrivateRule(rule),
    targetIds: targets,
    expiresAt: boundedNumber(rule.expiresAt, null),
    secondsRemaining,
    active,
    status,
  };
}

/**
 * Normalizes the current player's visible emergent rules and energy status.
 * It accepts both the direct `world.emergentRules` shape and a nested world
 * shape, keeping rendering code independent from server serialization details.
 */
export function normalizeEmergentState(world = {}, playerId = null, now = Date.now()) {
  const state = rawEmergentState(world);
  const rules = asList(state.activeRules || state.rules || state.active || world.activeEmergentRules)
    .filter((rule) => isVisibleToPlayer(rule, playerId))
    .map((rule) => formatSocialRule(rule, world, playerId, now))
    .filter((rule) => rule.active);
  const status = formatEnergyStatus(statusForPlayer(world, state, playerId));
  return { rules, status };
}

/** Returns the one concise instruction most relevant to the current player. */
export function buildEmergentInstruction(world = {}, playerId = null, now = Date.now()) {
  const { rules, status } = normalizeEmergentState(world, playerId, now);
  if (status.available && status.tone === 'danger') return 'Your strength is gone. Rejoin your linked allies.';
  if (status.available && status.tone === 'warning') return 'You are weakening. Change your course before the bond breaks.';
  const privateRule = rules.find((rule) => rule.private);
  if (privateRule) return privateRule.message;
  return rules[0]?.message || '';
}
