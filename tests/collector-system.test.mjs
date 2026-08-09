import assert from 'node:assert/strict';
import { createCollectorSystem } from '../server/collector-system.mjs';

let stamp = 1_000;
const events = [];
const system = createCollectorSystem({
  now: () => stamp,
  event: (_room, type, message, extra = {}) => {
    const item = { type, message, ...extra }; events.push(item); return item;
  },
});

const collector = {
  id: 'collector', name: 'Mira', archetype: 'Collector', x: 0, z: 0,
  relicIds: new Set(['river-pearl', 'drowned-idol']), visited: new Set(['village', 'forest', 'lake']),
  interactions: { relic: 2 }, movement: 96, nearSeconds: 28, aloneSeconds: 4, riskEvents: 0, follows: 2,
};
const helper = { id: 'helper', name: 'Ari', archetype: 'Guardian', x: 0, z: 0, interactions: {} };
const room = { players: new Map([[collector.id, collector], [helper.id, helper]]), entities: [] };

const inferred = system.initialize(collector);
assert.equal(inferred.plan.length, 2, 'the GM always chooses exactly two Collector trials');
assert.equal(new Set(inferred.plan).size, 2, 'the two selected Collector trials are distinct');
const curioCollector = { ...collector, id: 'curio-collector', collector: null, relicIds: new Set(), observationItems: new Set(['curio-coin-1','curio-gem-1','curio-key-1','curio-shard-1']), interactions: { 'collect-curio': 4 }, movement: 0, visited: new Set(), nearSeconds: 0, aloneSeconds: 0, follows: 0 };
assert.ok(system.choosePlan(curioCollector).plan.includes('treasure-cache'), 'Muskan observation-curio variety influences the selected Collector trials');

// Drive a deterministic pair so each authoritative interaction can be checked.
collector.collector = { plan: ['crystal-mine', 'relic-forge'], reasons: {}, completed: new Set(), active: null };
const first = system.awaken(room, collector, 'crystal-mine');
assert.equal(first.ok, true);
assert.equal(room.entities.filter((entity) => entity.type === 'collector-dig').length, 5);
for (const dig of room.entities.filter((entity) => entity.type === 'collector-dig')) {
  collector.x = dig.x; collector.z = dig.z;
  assert.equal(system.dig(room, collector, dig.id).ok, true);
}
const mine = room.entities.find((entity) => entity.type === 'collector-landmark');
collector.x = mine.x; collector.z = mine.z;
assert.equal(system.start(room, collector, mine.id).ok, true, 'the Crystal Heart opens only after every fragment is excavated');
assert.equal(system.complete(room, collector, mine.id).ok, true);
assert.deepEqual([...collector.collector.completed], ['crystal-mine']);

stamp += 1;
const second = system.awaken(room, collector, 'relic-forge');
assert.equal(second.ok, true, 'the second selected rite emerges only after the first is complete');
const forge = room.entities.find((entity) => entity.type === 'collector-landmark');
for (const clue of room.entities.filter((entity) => entity.type === 'collector-clue')) {
  collector.x = clue.x; collector.z = clue.z;
  assert.equal(system.collectClue(room, collector, clue.id).ok, true);
}
collector.x = forge.x; collector.z = forge.z;
assert.equal(system.start(room, collector, forge.id).ok, true, 'the Forge opens only after its private notes are found');
helper.x = forge.x; helper.z = forge.z;
assert.equal(system.assist(room, helper, forge.id).ok, true, 'another role can make the Forge warmer without seeing its private puzzle');
assert.equal(system.complete(room, collector, forge.id).ok, true);

const snapshot = system.snapshot(collector);
assert.deepEqual(snapshot.completedFeatures, ['crystal-mine', 'relic-forge']);
assert.equal(snapshot.active.completed, true);
assert.ok(events.filter((event) => event.type === 'collector-clue').every((event) => event.privateTo === collector.id), 'Collector clue text stays private');
assert.equal(events.find((event) => event.type === 'forge-bellows-assist')?.privateTo, collector.id, 'Forge support feedback is private to the Collector');

console.log('Collector trial selection, clue gates, collaboration, and privacy tests passed.');
