// Server-authoritative portal trial and temple finale domain.  It is kept
// independent from game-world.mjs so the transport and renderer can adopt it
// without making position, completion, or win decisions on the client.

const FOUR_ROLES = Object.freeze(['Explorer', 'Collector', 'Guardian', 'Loner']);
const GUARDIAN_TRIALS = Object.freeze([
  {
    id: 'wardkeepers-circuit', title: "Wardkeeper's Circuit", theme: 'Restore the forest wards in the order their lanterns awaken.',
    map: 'sunlit-grove', bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 16 }, spawn: { x: 2, z: 8 },
    objectives: [{ id: 'root-ward', label: 'Root Ward', x: 7, z: 4 }, { id: 'brook-ward', label: 'Brook Ward', x: 13, z: 12 }, { id: 'sky-ward', label: 'Sky Ward', x: 20, z: 5 }],
    rule: 'Awaken the three wards in their marked order.',
  },
  {
    id: 'lost-lanterns', title: 'The Lost Lanterns', theme: 'Guide abandoned camp lanterns back into the Guardian’s light.',
    map: 'campfire-clearing', bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 16 }, spawn: { x: 2, z: 8 },
    objectives: [{ id: 'north-lantern', label: 'North Guardian', x: 8, z: 3 }, { id: 'west-lantern', label: 'West Guardian', x: 8, z: 13 }, { id: 'hearth', label: 'Hearth Guardian', x: 20, z: 8 }],
    rule: 'Restore both lost guardian lights, then return their flame to the Hearth Guardian.',
  },
  {
    id: 'shelter-march', title: 'Shelter March', theme: 'Carry a protective blessing through a mountain pass before it fades.',
    map: 'mountain-pass', bounds: { minX: 0, maxX: 28, minZ: 0, maxZ: 14 }, spawn: { x: 2, z: 7 },
    objectives: [{ id: 'pass-gate', label: 'Pass Gate', x: 9, z: 7 }, { id: 'watch-stone', label: 'Watch Stone', x: 17, z: 4 }, { id: 'shelter-gate', label: 'Shelter Gate', x: 25, z: 8 }],
    rule: 'Move the blessing from gate to gate; lingering lets its glow weaken.',
  },
  {
    id: 'shrine-of-return', title: 'Shrine of Return', theme: 'Cleanse a quiet shrine and make it safe for wandering spirits.',
    map: 'shrine-garden', bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 18 }, spawn: { x: 2, z: 9 },
    objectives: [{ id: 'flower-ward', label: 'Flower Ward', x: 7, z: 4 }, { id: 'water-ward', label: 'Water Ward', x: 12, z: 14 }, { id: 'stone-ward', label: 'Stone Ward', x: 18, z: 5 }, { id: 'return-shrine', label: 'Shrine of Return', x: 21, z: 14 }],
    rule: 'Cleanse every ward; the final shrine opens only after the garden is safe.',
  },
]);

const PEDESTALS = Object.freeze({
  Explorer: { id: 'explorer-pillar', label: 'Pathfinder Pillar', x: 10, z: 8 },
  Collector: { id: 'collector-pillar', label: 'Relic Pillar', x: 38, z: 8 },
  Guardian: { id: 'guardian-pillar', label: 'Ward Pillar', x: 10, z: 24 },
  Loner: { id: 'loner-pillar', label: 'Veil Pillar', x: 38, z: 24 },
});
const TEMPLE_BOUNDS = Object.freeze({ minX: 0, maxX: 48, minZ: 0, maxZ: 32 });

const copy = (value) => JSON.parse(JSON.stringify(value));
const distance = (left, right) => Math.hypot(Number(left.x) - Number(right.x), Number(left.z) - Number(right.z));
const inside = (position, bounds) => Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.z))
  && Number(position.x) >= bounds.minX && Number(position.x) <= bounds.maxX && Number(position.z) >= bounds.minZ && Number(position.z) <= bounds.maxZ;
const unique = (values) => new Set(values).size === values.length;

export { GUARDIAN_TRIALS, PEDESTALS };

export function guardianTrialCatalog() { return copy(GUARDIAN_TRIALS); }

export function chooseGuardianTrials(trialIds) {
  if (!Array.isArray(trialIds) || trialIds.length !== 2 || !unique(trialIds)) return { ok: false, error: 'The Game Master must choose two different Guardian trials.' };
  const trials = trialIds.map((id) => GUARDIAN_TRIALS.find((trial) => trial.id === id));
  return trials.every(Boolean) ? { ok: true, trials: copy(trials) } : { ok: false, error: 'An unknown Guardian trial was selected.' };
}

export function createGuardianPortalState({ playerId, selectedTrialIds, now = Date.now() } = {}) {
  if (!playerId) throw new Error('A Guardian player id is required.');
  const selection = chooseGuardianTrials(selectedTrialIds);
  if (!selection.ok) throw new Error(selection.error);
  return {
    kind: 'guardian-portals', playerId, selectedTrialIds: selection.trials.map((trial) => trial.id), activeTrialId: null,
    completedTrialIds: [], position: null, activatedObjectiveIds: [], nextObjectiveIndex: 0,
    lastMovedAt: now, lastNudgeAt: 0, status: 'ready', narration: [],
  };
}

function activeTrial(state) { return GUARDIAN_TRIALS.find((trial) => trial.id === state?.activeTrialId) || null; }
function tell(state, type, message, now, details = {}) {
  const entry = { type, message, at: now, ...details };
  state.narration.push(entry); if (state.narration.length > 16) state.narration.shift(); return entry;
}

export function enterGuardianPortal(state, trialId, now = Date.now()) {
  if (!state || state.kind !== 'guardian-portals') return { ok: false, error: 'Invalid Guardian portal state.' };
  if (!state.selectedTrialIds.includes(trialId)) return { ok: false, error: 'That portal was not chosen for this Guardian.' };
  if (state.completedTrialIds.includes(trialId)) return { ok: false, error: 'That portal has already been restored.' };
  const trial = GUARDIAN_TRIALS.find((entry) => entry.id === trialId);
  state.activeTrialId = trialId; state.position = copy(trial.spawn); state.activatedObjectiveIds = []; state.nextObjectiveIndex = 0;
  state.lastMovedAt = now; state.lastNudgeAt = 0; state.status = 'in-trial';
  tell(state, 'portal-entered', `The ${trial.title} opens. ${trial.rule}`, now, { trialId });
  return { ok: true, trial: copy(trial), position: copy(state.position) };
}

export function moveGuardianInTrial(state, position, now = Date.now()) {
  const trial = activeTrial(state);
  if (!trial || state.status !== 'in-trial') return { ok: false, error: 'The Guardian is not inside an active portal trial.' };
  if (!inside(position, trial.bounds)) return { ok: false, error: 'That movement leaves the trial bounds.' };
  const next = { x: Number(position.x), z: Number(position.z) };
  if (distance(next, state.position) > 0.08) state.lastMovedAt = now;
  state.position = next;
  return { ok: true, position: copy(next) };
}

function canActivate(trial, state, objective) {
  // The circuit and march are intentionally ordered; the camp and shrine ask
  // the Guardian to protect each place before returning to the final beacon.
  const finalObjective = objective.id === trial.objectives.at(-1).id;
  if (trial.id === 'wardkeepers-circuit' || trial.id === 'shelter-march') return trial.objectives[state.nextObjectiveIndex]?.id === objective.id;
  if (trial.id === 'lost-lanterns') return !finalObjective || state.activatedObjectiveIds.length === 2;
  if (trial.id === 'shrine-of-return') return !finalObjective || state.activatedObjectiveIds.length === trial.objectives.length - 1;
  return true;
}

export function activateGuardianObjective(state, objectiveId, now = Date.now()) {
  const trial = activeTrial(state);
  if (!trial || state.status !== 'in-trial') return { ok: false, error: 'There is no active Guardian trial.' };
  const objective = trial.objectives.find((entry) => entry.id === objectiveId);
  if (!objective) return { ok: false, error: 'That objective does not belong to this portal.' };
  if (state.activatedObjectiveIds.includes(objectiveId)) return { ok: false, error: 'That ward is already safe.' };
  if (distance(state.position, objective) > 1.6) return { ok: false, error: 'Move to the ward before restoring it.' };
  if (!canActivate(trial, state, objective)) return { ok: false, error: 'Another place needs the Guardian’s protection first.' };
  state.activatedObjectiveIds.push(objectiveId); state.nextObjectiveIndex += 1; state.lastMovedAt = now;
  tell(state, 'ward-restored', `${objective.label} shines with a protective light.`, now, { trialId: trial.id, objectiveId });
  if (state.activatedObjectiveIds.length !== trial.objectives.length) return { ok: true, complete: false, objective: copy(objective) };
  state.completedTrialIds.push(trial.id); state.activeTrialId = null; state.status = state.completedTrialIds.length === 2 ? 'all-trials-complete' : 'ready';
  tell(state, 'trial-complete', `${trial.title} is restored. The temple remembers this act of guardianship.`, now, { trialId: trial.id });
  return { ok: true, complete: true, trialId: trial.id, guardianReadyForFinale: state.completedTrialIds.length === 2 };
}

export function tickGuardianPortal(state, now = Date.now(), { inactivityMs = 8_000, nudgeCooldownMs = 8_000 } = {}) {
  const trial = activeTrial(state);
  if (!trial || state.status !== 'in-trial' || now - state.lastMovedAt < inactivityMs || now - state.lastNudgeAt < nudgeCooldownMs) return null;
  state.lastNudgeAt = now;
  const next = trial.objectives[state.nextObjectiveIndex];
  return tell(state, 'gm-nudge', `The Game Master whispers: “The warding light moves with you. Seek ${next?.label || 'the next sanctuary'}.”`, now, { trialId: trial.id, objectiveId: next?.id || null });
}

export function serializeGuardianPortal(state) {
  const trial = activeTrial(state);
  return {
    status: state.status, selectedTrialIds: [...state.selectedTrialIds], completedTrialIds: [...state.completedTrialIds],
    activeTrial: trial ? copy(trial) : null, position: state.position && copy(state.position), activatedObjectiveIds: [...state.activatedObjectiveIds],
    narration: copy(state.narration.slice(-8)),
  };
}

function validFinalePlayers(players) {
  return Array.isArray(players) && players.length === 4 && unique(players.map((player) => player.id))
    && unique(players.map((player) => player.archetype)) && players.every((player) => player.id && FOUR_ROLES.includes(player.archetype));
}

export function createTempleFinale({ players, completedObjectives = {}, now = Date.now() } = {}) {
  if (!validFinalePlayers(players)) throw new Error('The finale requires exactly one player for each of the four archetypes.');
  return {
    kind: 'temple-finale', status: 'assembling', bounds: copy(TEMPLE_BOUNDS), createdAt: now, narration: [],
    players: Object.fromEntries(players.map((player) => [player.id, {
      id: player.id, name: player.name || player.id, archetype: player.archetype,
      completedObjectives: Math.max(0, Number(completedObjectives[player.id] ?? player.completedObjectives ?? 0)),
      position: { x: 24, z: 16 }, atPedestal: false, pillarActivated: false,
    }])),
  };
}

export function setFinaleObjectiveCount(state, playerId, completedObjectives) {
  const player = state?.players?.[playerId];
  if (!player) return { ok: false, error: 'Unknown temple player.' };
  player.completedObjectives = Math.max(0, Number(completedObjectives) || 0);
  return { ok: true, completedObjectives: player.completedObjectives };
}

function allAtPedestals(state) { return Object.values(state.players).every((player) => player.atPedestal); }
function allPillarsActivated(state) { return Object.values(state.players).every((player) => player.pillarActivated); }

export function moveTemplePlayer(state, playerId, position, now = Date.now()) {
  const player = state?.players?.[playerId];
  if (!player || state.status === 'won') return { ok: false, error: 'That player cannot move in this finale.' };
  if (!inside(position, TEMPLE_BOUNDS)) return { ok: false, error: 'That movement leaves the temple.' };
  player.position = { x: Number(position.x), z: Number(position.z) };
  const pedestal = PEDESTALS[player.archetype]; player.atPedestal = distance(player.position, pedestal) <= 1.7;
  if (allAtPedestals(state) && state.status === 'assembling') { state.status = 'ready-to-activate'; tell(state, 'temple-ready', 'The four pillars answer together. Each bearer may now awaken their pillar.', now); }
  return { ok: true, atPedestal: player.atPedestal, allAtPedestals: allAtPedestals(state) };
}

export function activateTemplePillar(state, playerId, now = Date.now()) {
  const player = state?.players?.[playerId];
  if (!player || state.status === 'won') return { ok: false, error: 'That player cannot awaken a temple pillar.' };
  if (!allAtPedestals(state)) return { ok: false, error: 'All four adventurers must stand at their own pillars first.' };
  if (!player.atPedestal) return { ok: false, error: 'Stand at your archetype’s pillar first.' };
  if (player.completedObjectives < 2) return { ok: false, error: 'Complete two personal portal objectives before awakening the pillar.' };
  if (player.pillarActivated) return { ok: false, error: 'That pillar is already awake.' };
  player.pillarActivated = true; tell(state, 'pillar-awakened', `${player.name} awakens the ${PEDESTALS[player.archetype].label}.`, now, { playerId, archetype: player.archetype });
  if (!allPillarsActivated(state)) return { ok: true, won: false };
  state.status = 'won'; state.completedAt = now;
  tell(state, 'finale-won', 'The Ancient Temple opens in daylight. Four different paths became one shared legend.', now, { congratulations: true });
  return { ok: true, won: true, message: 'The Game Master congratulates the party: your choices wrote this ending together.' };
}

export function serializeTempleFinale(state) {
  return {
    status: state.status, bounds: copy(state.bounds), narration: copy(state.narration.slice(-12)),
    // The renderer can use one entry per camera pane in its 2×2 split screen.
    panes: Object.values(state.players).map((player) => ({ ...copy(player), pedestal: copy(PEDESTALS[player.archetype]) })),
    allAtPedestals: allAtPedestals(state), allPillarsActivated: allPillarsActivated(state),
  };
}

/** Convenience façade for transports which want a single injected service. */
export function createPortalSystem({ clock = () => Date.now() } = {}) {
  const now = () => clock();
  return Object.freeze({
    guardianTrials: guardianTrialCatalog,
    chooseGuardianTrials,
    createGuardianState: (args) => createGuardianPortalState({ ...args, now: args?.now ?? now() }),
    enterGuardianPortal: (state, trialId) => enterGuardianPortal(state, trialId, now()),
    moveGuardian: (state, position) => moveGuardianInTrial(state, position, now()),
    activateGuardianObjective: (state, objectiveId) => activateGuardianObjective(state, objectiveId, now()),
    tickGuardian: (state, options) => tickGuardianPortal(state, now(), options),
    serializeGuardian: serializeGuardianPortal,
    createFinale: (args) => createTempleFinale({ ...args, now: args?.now ?? now() }),
    moveFinale: (state, playerId, position) => moveTemplePlayer(state, playerId, position, now()),
    setFinaleObjectiveCount,
    activatePillar: (state, playerId) => activateTemplePillar(state, playerId, now()),
    serializeFinale: serializeTempleFinale,
  });
}
