import assert from 'node:assert/strict';
import {
  chooseGuardianTrials, createGuardianPortalState, enterGuardianPortal, moveGuardianInTrial,
  activateGuardianObjective, guardGuardianTrial, tickGuardianPortal, createTempleFinale, moveTemplePlayer, PEDESTALS,
  activateTemplePillar, serializeTempleFinale,
} from '../server/portal-system.mjs';

const chosen = ['wardkeepers-circuit', 'lost-lanterns'];
assert.equal(chooseGuardianTrials(chosen).ok, true);
assert.equal(chooseGuardianTrials([chosen[0], chosen[0]]).ok, false, 'the GM cannot give a duplicate portal');
function banish(state, objectiveId, stamp) {
  const threat = state.guardianThreats.find((entry) => entry.blocksObjectiveId === objectiveId && !entry.defeated);
  if (!threat) return stamp;
  stamp = Math.max(stamp, Number(state.lastGuardStrikeAt || 0) + 300);
  moveGuardianInTrial(state, threat, stamp);
  while (!threat.defeated) { stamp += 300; assert.equal(guardGuardianTrial(state, stamp).ok, true); }
  return stamp;
}

// A Guardian cannot activate wards remotely or out of sequence. Completing
// both AI-selected portals makes exactly two personal objectives available to
// the temple finale.
const guardian = createGuardianPortalState({ playerId: 'g', selectedTrialIds: chosen, now: 0 });
assert.equal(enterGuardianPortal(guardian, chosen[0], 10).ok, true);
assert.equal(activateGuardianObjective(guardian, 'root-ward', 20).ok, false, 'must walk to a ward');
banish(guardian, 'root-ward', 25);
assert.equal(moveGuardianInTrial(guardian, { x: 7, z: 4 }, 30).ok, true);
assert.equal(activateGuardianObjective(guardian, 'root-ward', 40).ok, true);
assert.equal(moveGuardianInTrial(guardian, { x: 20, z: 5 }, 50).ok, true);
assert.equal(activateGuardianObjective(guardian, 'sky-ward', 60).ok, false, 'the circuit remains ordered');
banish(guardian, 'brook-ward', 65);
assert.equal(moveGuardianInTrial(guardian, { x: 13, z: 12 }, 70).ok, true);
assert.equal(activateGuardianObjective(guardian, 'brook-ward', 80).ok, true);
banish(guardian, 'sky-ward', 85);
assert.equal(moveGuardianInTrial(guardian, { x: 20, z: 5 }, 90).ok, true);
assert.equal(activateGuardianObjective(guardian, 'sky-ward', 100).complete, true);
assert.equal(enterGuardianPortal(guardian, chosen[1], 110).ok, true);
banish(guardian, 'north-lantern', 115);
moveGuardianInTrial(guardian, { x: 8, z: 3 }, 120); assert.equal(activateGuardianObjective(guardian, 'north-lantern', 130).carrying, 'north-lantern');
banish(guardian, 'hearth', 135);
moveGuardianInTrial(guardian, { x: 20, z: 8 }, 140); assert.equal(activateGuardianObjective(guardian, 'hearth', 150).complete, false);
banish(guardian, 'west-lantern', 155);
moveGuardianInTrial(guardian, { x: 8, z: 13 }, 160); assert.equal(activateGuardianObjective(guardian, 'west-lantern', 170).carrying, 'west-lantern');
banish(guardian, 'hearth', 175);
moveGuardianInTrial(guardian, { x: 20, z: 8 }, 180); assert.equal(activateGuardianObjective(guardian, 'hearth', 190).complete, true);
assert.deepEqual(guardian.completedTrialIds, chosen);

// The other two trials use real-time mechanics rather than another
// collection route: the pass relay expires and garden wards need stillness.
const relay = createGuardianPortalState({ playerId: 'relay', selectedTrialIds: ['shelter-march', 'shrine-of-return'], now: 0 });
enterGuardianPortal(relay, 'shelter-march', 0);
banish(relay, 'pass-gate', 50);
moveGuardianInTrial(relay, { x: 9, z: 7 }, 100); activateGuardianObjective(relay, 'pass-gate', 100);
assert.equal(tickGuardianPortal(relay, 14_101)?.type, 'blessing-faded', 'the mountain relay resets when its blessing expires');
assert.equal(relay.activatedObjectiveIds.length, 0);
moveGuardianInTrial(relay, { x: 9, z: 7 }, 15_000); activateGuardianObjective(relay, 'pass-gate', 15_000);
banish(relay, 'watch-stone', 15_050);
moveGuardianInTrial(relay, { x: 17, z: 4 }, 15_100); activateGuardianObjective(relay, 'watch-stone', 15_100);
banish(relay, 'shelter-gate', 15_150);
moveGuardianInTrial(relay, { x: 25, z: 8 }, 15_200); assert.equal(activateGuardianObjective(relay, 'shelter-gate', 15_200).complete, true);
enterGuardianPortal(relay, 'shrine-of-return', 16_000);
banish(relay, 'flower-ward', 16_050);
moveGuardianInTrial(relay, { x: 7, z: 4 }, 16_100); assert.equal(activateGuardianObjective(relay, 'flower-ward', 16_100).channeling, 'flower-ward');
moveGuardianInTrial(relay, { x: 7.2, z: 4 }, 16_200); assert.equal(relay.channelObjectiveId, null, 'moving breaks a cleansing channel');
activateGuardianObjective(relay, 'flower-ward', 16_300); tickGuardianPortal(relay, 17_801);
for (const [id, point, time] of [['water-ward', { x: 12, z: 14 }, 18_000], ['stone-ward', { x: 18, z: 5 }, 20_000]]) {
  banish(relay, id, time - 50);
  moveGuardianInTrial(relay, point, time); activateGuardianObjective(relay, id, time); tickGuardianPortal(relay, time + 1_501);
}
banish(relay, 'return-shrine', 21_900);
moveGuardianInTrial(relay, { x: 21, z: 14 }, 22_000); assert.equal(activateGuardianObjective(relay, 'return-shrine', 22_000).complete, true);
assert.deepEqual(relay.completedTrialIds, ['shelter-march', 'shrine-of-return']);

const idle = createGuardianPortalState({ playerId: 'idle', selectedTrialIds: chosen, now: 0 });
enterGuardianPortal(idle, chosen[0], 0);
assert.equal(tickGuardianPortal(idle, 8_001)?.type, 'gm-nudge', 'an inactive trial receives a GM movement nudge');

const players = [
  { id: 'e', name: 'E', archetype: 'Explorer' }, { id: 'c', name: 'C', archetype: 'Collector' },
  { id: 'g', name: 'G', archetype: 'Guardian' }, { id: 'l', name: 'L', archetype: 'Loner' },
];
const finale = createTempleFinale({ players, completedObjectives: { e: 2, c: 2, g: 2, l: 2 }, now: 0 });
const points = { e: PEDESTALS.Explorer, c: PEDESTALS.Collector, g: PEDESTALS.Guardian, l: PEDESTALS.Loner };
for (const [id, point] of Object.entries(points)) moveTemplePlayer(finale, id, point, 10);
assert.equal(activateTemplePillar(finale, 'e', 20).won, false);
assert.equal(activateTemplePillar(finale, 'c', 20).won, false);
assert.equal(activateTemplePillar(finale, 'g', 20).won, false);
assert.equal(activateTemplePillar(finale, 'l', 20).won, true);
assert.equal(serializeTempleFinale(finale).status, 'won');

console.log('Portal system tests passed.');
