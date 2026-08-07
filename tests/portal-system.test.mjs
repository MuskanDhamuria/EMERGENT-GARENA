import assert from 'node:assert/strict';
import {
  chooseGuardianTrials, createGuardianPortalState, enterGuardianPortal, moveGuardianInTrial,
  activateGuardianObjective, tickGuardianPortal, createTempleFinale, moveTemplePlayer, PEDESTALS,
  activateTemplePillar, serializeTempleFinale,
} from '../server/portal-system.mjs';

const chosen = ['wardkeepers-circuit', 'lost-lanterns'];
assert.equal(chooseGuardianTrials(chosen).ok, true);
assert.equal(chooseGuardianTrials([chosen[0], chosen[0]]).ok, false, 'the GM cannot give a duplicate portal');

// A Guardian cannot activate wards remotely or out of sequence. Completing
// both AI-selected portals makes exactly two personal objectives available to
// the temple finale.
const guardian = createGuardianPortalState({ playerId: 'g', selectedTrialIds: chosen, now: 0 });
assert.equal(enterGuardianPortal(guardian, chosen[0], 10).ok, true);
assert.equal(activateGuardianObjective(guardian, 'root-ward', 20).ok, false, 'must walk to a ward');
assert.equal(moveGuardianInTrial(guardian, { x: 7, z: 4 }, 30).ok, true);
assert.equal(activateGuardianObjective(guardian, 'root-ward', 40).ok, true);
assert.equal(moveGuardianInTrial(guardian, { x: 20, z: 5 }, 50).ok, true);
assert.equal(activateGuardianObjective(guardian, 'sky-ward', 60).ok, false, 'the circuit remains ordered');
assert.equal(moveGuardianInTrial(guardian, { x: 13, z: 12 }, 70).ok, true);
assert.equal(activateGuardianObjective(guardian, 'brook-ward', 80).ok, true);
assert.equal(moveGuardianInTrial(guardian, { x: 20, z: 5 }, 90).ok, true);
assert.equal(activateGuardianObjective(guardian, 'sky-ward', 100).complete, true);
assert.equal(enterGuardianPortal(guardian, chosen[1], 110).ok, true);
for (const [id, point] of [['north-lantern', { x: 8, z: 3 }], ['west-lantern', { x: 8, z: 13 }], ['hearth', { x: 20, z: 8 }]]) {
  moveGuardianInTrial(guardian, point, 120); activateGuardianObjective(guardian, id, 130);
}
assert.deepEqual(guardian.completedTrialIds, chosen);

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
