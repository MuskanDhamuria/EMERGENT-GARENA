// Collector trials are kept separate from the shared world so the Game Master
// can choose a pair from observed behaviour without coupling puzzle details to
// networking, rendering, or the other archetypes.

export const COLLECTOR_FEATURES = Object.freeze([
  'crystal-mine',
  'ancient-vault',
  'treasure-cache',
  'relic-forge',
  'sunken-relic',
]);

const CHALLENGES = Object.freeze({
  'crystal-mine': Object.freeze({ title: 'Restore the Crystal Heart', minigame: 'crystal-rebuild', goal: 5, instruction: 'Excavate five scattered fragments, then rebuild the Crystal Heart.' }),
  'ancient-vault': Object.freeze({ title: 'Decode the Ancient Vault', minigame: 'rune-sequence', goal: 4, instruction: 'Gather the rune clues and enter the four seals in their hidden order.' }),
  'treasure-cache': Object.freeze({ title: 'Curate the Treasure Cache', minigame: 'appraisal', goal: 3, instruction: 'Read every appraisal clue, then identify the three genuine relics.' }),
  'relic-forge': Object.freeze({ title: 'Forge the Resonance Core', minigame: 'forge', goal: 4, instruction: 'Balance the recipe, heat the core, follow the hammer pattern, and quench it correctly.' }),
  'sunken-relic': Object.freeze({ title: 'Recover the Sunken Crown', minigame: 'current-navigation', goal: 1, instruction: 'Navigate the flooded corridors and use the currents to reach the crown chamber.' }),
});

const CLUES = Object.freeze({
  'ancient-vault': Object.freeze([
    ['Gem Chronicle', 'The Gem is pressed before the Moon.'],
    ['Lunar Rubbing', 'The Moon sits immediately before the Flame.'],
    ['Ember Seal', 'The Flame is not the final rune.'],
    ['Key Inscription', 'The Key closes the lock.'],
  ]),
  'treasure-cache': Object.freeze([
    ['Appraiser Ledger', 'The Ancient Idol is genuine and worth three.'],
    ['Merchant Note', 'The Golden Compass is a replica worth nothing.'],
    ['Curse Warning', 'The Cursed Crown is valuable, but cursed.'],
    ['Reliquary Slip', 'The Reliquary Box is genuine and worth two.'],
  ]),
  'relic-forge': Object.freeze([
    ['Recipe Scrap', 'Energy begins the balanced core. Stability rests between Energy and Iron.'],
    ['Heat Note', 'Work the forge only while the metal glows orange.'],
    ['Hammer Diagram', 'Strike right, then left, then the upper mark.'],
    ['Quenching Manual', 'A balanced core must be quenched in oil.'],
  ]),
});

const LANDMARKS = Object.freeze({
  'crystal-mine': Object.freeze({ x: -19, z: -7, sprite: 'crystal-mine' }),
  'ancient-vault': Object.freeze({ x: 16, z: -4, sprite: 'ancient-vault' }),
  'treasure-cache': Object.freeze({ x: 3, z: 5, sprite: 'treasure-cache' }),
  'relic-forge': Object.freeze({ x: 8, z: -3, sprite: 'relic-forge' }),
  'sunken-relic': Object.freeze({ x: 17, z: 5, sprite: 'sunken-relic' }),
});

const CLUE_POSITIONS = Object.freeze([
  Object.freeze([-22, -10]), Object.freeze([-13, 12]), Object.freeze([-2, -12]), Object.freeze([5, 3]),
  Object.freeze([18, -11]), Object.freeze([-18, 3]), Object.freeze([-7, -7]), Object.freeze([3, -4]),
  Object.freeze([15, -2]), Object.freeze([1, 13]), Object.freeze([-15, 7]), Object.freeze([-1, 7]),
]);
const DIG_POSITIONS = Object.freeze([
  Object.freeze([-24, -6]), Object.freeze([-14, 13]), Object.freeze([-2, -13]), Object.freeze([5, 4]), Object.freeze([18, -8]),
]);

function featureLabel(feature) { return CHALLENGES[feature]?.title || feature.replaceAll('-', ' '); }
function publicEvent(event, room, type, message, options = {}) { return event(room, type, message, options); }

export function createCollectorSystem({ event, now = () => Date.now() } = {}) {
  if (typeof event !== 'function') throw new Error('Collector trials require the authoritative event function.');

  function profile(player) {
    const interactions = Object.values(player.interactions || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const relicTypes = new Set([...player.relicIds || []].map((id) => String(id).split('-')[0]));
    return {
      relics: player.relicIds?.size || 0,
      variety: relicTypes.size,
      movement: Number(player.movement) || 0,
      visited: player.visited?.size || 0,
      near: Number(player.nearSeconds) || 0,
      alone: Number(player.aloneSeconds) || 0,
      risk: Number(player.riskEvents) || 0,
      follows: Number(player.follows) || 0,
      interactions,
    };
  }

  function choosePlan(player) {
    const data = profile(player);
    const repeated = Math.max(0, data.relics - data.variety);
    const scores = {
      'crystal-mine': data.relics * 3 + repeated * 6 + data.interactions,
      'ancient-vault': data.visited * 4 + data.movement / 48 + data.variety,
      'treasure-cache': data.variety * 6 + data.relics + Math.min(data.interactions, 8),
      'relic-forge': data.near / 2.5 + data.follows * 6 + data.interactions * 2,
      'sunken-relic': data.risk * 10 + data.movement / 34 + data.alone / 6 + data.visited,
    };
    const reasons = {
      'crystal-mine': `you kept returning to forgotten objects (${data.relics} finds)`,
      'ancient-vault': `you ranged widely and discovered ${data.visited} places`,
      'treasure-cache': `you gave attention to a broad variety of relics`,
      'relic-forge': `you stayed near companions and interacted with the world`,
      'sunken-relic': `you travelled boldly and embraced risk`,
    };
    const plan = COLLECTOR_FEATURES
      .map((feature, index) => ({ feature, index, score: scores[feature] }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 2)
      .map(({ feature }) => feature);
    return { plan, reasons: Object.fromEntries(plan.map((feature) => [feature, reasons[feature]])), scores };
  }

  function initialize(player) {
    if (player.collector?.plan?.length) return player.collector;
    const selection = choosePlan(player);
    player.collector = {
      plan: selection.plan,
      reasons: selection.reasons,
      completed: new Set(),
      active: null,
      selectedAt: now(),
    };
    return player.collector;
  }

  function active(player) { return player.collector?.active || null; }
  function isComplete(player, feature) { return Boolean(player.collector?.completed?.has(feature)); }
  function nextFeature(player) {
    const state = initialize(player);
    return state.plan.find((feature) => !state.completed.has(feature) && state.active?.feature !== feature) || null;
  }
  function availableSteps(player) {
    const current = active(player);
    if (current && !current.completed) return [];
    const feature = nextFeature(player);
    return feature ? [[feature, `The Collector's ${featureLabel(feature)} has emerged from the choices they made.`]] : [];
  }

  function clearChallengeEntities(room) {
    room.entities = room.entities.filter((entity) => !entity.collectorChallenge);
  }

  function createClues(feature) {
    return (CLUES[feature] || []).map(([title, text], index) => ({ id: `collector-clue-${feature}-${index + 1}`, title, text, sprite: 'clue-scroll' }));
  }

  function awaken(room, player, feature) {
    if (player.archetype !== 'Collector') return { ok: false, error: 'Only the Collector can awaken a relic trial.' };
    const state = initialize(player), current = active(player);
    if (!CHALLENGES[feature]) return { ok: false, error: 'Unknown Collector trial.' };
    if (!state.plan.includes(feature)) return { ok: false, error: 'The Game Master did not select that Collector trial for this match.' };
    if (current && !current.completed) return { ok: false, error: 'Finish the active Collector trial before the next landmark appears.' };
    if (state.completed.has(feature)) return { ok: false, error: 'That Collector trial is already complete.' };
    const expected = state.plan.find((candidate) => !state.completed.has(candidate));
    if (feature !== expected) return { ok: false, error: `The next relic trial is ${featureLabel(expected)}.` };
    clearChallengeEntities(room);
    const definition = CHALLENGES[feature], landmark = LANDMARKS[feature], clues = createClues(feature);
    const challenge = {
      id: `collector-${feature}-${now()}`,
      feature,
      title: definition.title,
      instruction: definition.instruction,
      minigame: definition.minigame,
      goal: definition.goal,
      started: false,
      completed: false,
      attempts: 0,
      clues,
      collectedClueIds: new Set(),
      fragmentsFound: 0,
      forgeAssistHeat: 0,
      landmarkId: `collector-landmark-${feature}`,
    };
    state.active = challenge;
    room.entities.push({
      id: challenge.landmarkId, type: 'collector-landmark', collectorChallenge: true,
      x: landmark.x, z: landmark.z, role: 'Collector', feature, label: definition.title,
      action: 'collector-minigame-start', sprite: landmark.sprite,
    });
    if (feature === 'crystal-mine') {
      DIG_POSITIONS.forEach(([x, z], index) => room.entities.push({
        id: `collector-dig-${index + 1}`, type: 'collector-dig', collectorChallenge: true,
        x, z, role: 'Collector', feature, label: `Buried Crystal Fragment ${index + 1}`,
        action: 'dig-crystal', sprite: 'glowing-gem-cluster',
      }));
    } else {
      clues.forEach((clue, index) => {
        const [x, z] = CLUE_POSITIONS[(index + state.plan.indexOf(feature) * 3) % CLUE_POSITIONS.length];
        room.entities.push({
          id: clue.id, type: 'collector-clue', collectorChallenge: true,
          x, z, role: 'Collector', feature, label: clue.title,
          action: 'collect-clue', sprite: clue.sprite,
        });
      });
    }
    publicEvent(event, room, 'collector-trial-awakened', `${player.name}'s ${definition.title} emerges from the world.`, { playerId: player.id });
    return { ok: true, challenge };
  }

  function entity(room, targetId) { return room.entities.find((candidate) => candidate.id === targetId && candidate.collectorChallenge); }
  function near(player, target, radius = 3.25) { return target && Math.hypot(player.x - target.x, player.z - target.z) <= radius; }

  function collectClue(room, player, targetId) {
    const target = entity(room, targetId), current = active(player);
    if (player.archetype !== 'Collector' || target?.type !== 'collector-clue' || target.feature !== current?.feature) return { ok: false, error: 'Only the active Collector can read this clue.' };
    if (!near(player, target)) return { ok: false, error: 'Move closer to the clue.' };
    if (target.collectedBy) return { ok: false, error: 'That clue has already been recovered.' };
    target.collectedBy = player.id;
    current.collectedClueIds.add(target.id);
    player.interactions['collect-clue'] = (player.interactions['collect-clue'] || 0) + 1;
    const clue = current.clues.find((item) => item.id === target.id);
    publicEvent(event, room, 'collector-clue', `${player.name} deciphers ${target.label}.`, { privateTo: player.id, playerId: player.id, clueText: clue?.text || '' });
    return { ok: true, clueText: clue?.text || '', clueCount: current.collectedClueIds.size, clueTotal: current.clues.length };
  }

  function dig(room, player, targetId) {
    const target = entity(room, targetId), current = active(player);
    if (player.archetype !== 'Collector' || target?.type !== 'collector-dig' || current?.feature !== 'crystal-mine') return { ok: false, error: 'Only the active Collector can excavate this fragment.' };
    if (!near(player, target)) return { ok: false, error: 'Move closer to the glowing fracture.' };
    if (target.collectedBy) return { ok: false, error: 'This crystal fragment was already excavated.' };
    target.collectedBy = player.id;
    current.fragmentsFound += 1;
    player.interactions['dig-crystal'] = (player.interactions['dig-crystal'] || 0) + 1;
    const ready = current.fragmentsFound >= current.goal;
    publicEvent(event, room, 'crystal-excavated', ready ? 'The final fragment answers the Crystal Heart.' : `A buried crystal fragment rises (${current.fragmentsFound}/${current.goal}).`, { privateTo: player.id, playerId: player.id });
    return { ok: true, fragmentsFound: current.fragmentsFound, goal: current.goal, ready };
  }

  function start(room, player, targetId) {
    const target = entity(room, targetId), current = active(player);
    if (player.archetype !== 'Collector' || target?.type !== 'collector-landmark' || target.feature !== current?.feature) return { ok: false, error: 'Only the active Collector can begin this relic trial.' };
    if (!near(player, target)) return { ok: false, error: 'Move closer to the awakened landmark.' };
    if (current.completed) return { ok: false, error: 'That relic trial is already complete.' };
    if (current.feature === 'crystal-mine' && current.fragmentsFound < current.goal) return { ok: false, error: `Excavate every fragment first (${current.fragmentsFound}/${current.goal}).` };
    if (current.clues.length && current.collectedClueIds.size < current.clues.length) return { ok: false, error: `Find every private clue first (${current.collectedClueIds.size}/${current.clues.length}).` };
    current.started = true;
    current.attempts += 1;
    player.interactions['collector-minigame-start'] = (player.interactions['collector-minigame-start'] || 0) + 1;
    return { ok: true, targetId, feature: current.feature, title: current.title, instruction: current.instruction, minigame: current.minigame, goal: current.goal, clues: current.clues.filter((clue) => current.collectedClueIds.has(clue.id)), clueTotal: current.clues.length, fragmentsFound: current.fragmentsFound, forgeAssistHeat: current.forgeAssistHeat };
  }

  function complete(room, player, targetId) {
    const target = entity(room, targetId), current = active(player);
    if (player.archetype !== 'Collector' || target?.type !== 'collector-landmark' || target.feature !== current?.feature || !current.started) return { ok: false, error: 'Begin the active Collector trial before completing it.' };
    if (current.completed) return { ok: false, error: 'That relic trial is already complete.' };
    current.completed = true;
    player.collector.completed.add(current.feature);
    player.interactions['collector-minigame-complete'] = (player.interactions['collector-minigame-complete'] || 0) + 1;
    publicEvent(event, room, 'collector-trial-complete', `${player.name} completes ${current.title}.`, { playerId: player.id });
    return { ok: true, feature: current.feature, completed: player.collector.completed.size, total: player.collector.plan.length };
  }

  function assist(room, player, targetId) {
    const target = entity(room, targetId), collector = [...room.players.values()].find((candidate) => candidate.archetype === 'Collector');
    const current = collector && active(collector);
    if (!target || target.feature !== 'relic-forge' || !current || current.feature !== 'relic-forge' || !current.started || current.completed) return { ok: false, error: 'The Relic Forge is not asking for help yet.' };
    if (player.id === collector.id) return { ok: false, error: 'The Collector already controls the forge directly.' };
    if (!near(player, target)) return { ok: false, error: 'Move beside the forge to pump its bellows.' };
    current.forgeAssistHeat += 8;
    player.interactions['forge-bellows-assist'] = (player.interactions['forge-bellows-assist'] || 0) + 1;
    publicEvent(event, room, 'forge-bellows-assist', `${player.name} pumps the Relic Forge bellows.`, { privateTo: collector.id, playerId: player.id, assistHeat: 8 });
    return { ok: true, assistHeat: 8 };
  }

  function snapshot(player) {
    const state = player.collector;
    if (!state) return null;
    const current = state.active;
    return {
      plan: [...state.plan], reasons: { ...state.reasons }, completedFeatures: [...state.completed],
      active: current && {
        feature: current.feature, title: current.title, instruction: current.instruction,
        minigame: current.minigame, goal: current.goal, started: current.started,
        completed: current.completed, attempts: current.attempts, fragmentsFound: current.fragmentsFound,
        clueCount: current.collectedClueIds.size, clueTotal: current.clues.length,
        clues: current.clues.filter((clue) => current.collectedClueIds.has(clue.id)).map((clue) => ({ id: clue.id, title: clue.title, text: clue.text })),
        forgeAssistHeat: current.forgeAssistHeat, landmarkId: current.landmarkId,
      },
    };
  }

  return Object.freeze({
    features: COLLECTOR_FEATURES,
    initialize,
    choosePlan,
    availableSteps,
    awaken,
    collectClue,
    dig,
    start,
    complete,
    assist,
    snapshot,
    active,
    isComplete,
    featureLabel,
  });
}
