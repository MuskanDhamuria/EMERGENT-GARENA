import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';

let time = 1_000;
const world = createGameWorld({ clock: () => time });
const room = world.createRoom('GATE');
world.rooms.set(room.code, room);
for (const [index, role] of ['Explorer', 'Collector', 'Guardian', 'Loner'].entries()) {
  const player = world.createPlayer(`p${index}`, role, index);
  player.archetype = role; player.evolutions = ['awakened'];
  room.players.set(player.id, player);
}
room.phase = 'evolving';

assert.ok(world.createFinalObjective(room), 'the GM can prepare the hidden finale after roles evolve');
assert.equal(room.world.unlocked.has('ancient-temple'), false, 'the entrance is not visible merely because the finale is prepared');

const [explorer, collector, guardian, loner] = [...room.players.values()];
explorer.roleObjectives = new Set();
collector.relicIds = new Set();
guardian.guardianPortal = { selectedTrialIds: ['wardkeepers-circuit', 'lost-lanterns'], completedTrialIds: ['wardkeepers-circuit', 'lost-lanterns'], activeTrialId: null, position: null, activatedObjectiveIds: [], narration: [] };
loner.roleObjectives = new Set(['veil', 'moon']);
world.tickRoom(room, 0);

assert.equal(room.world.unlocked.has('ancient-temple'), true, 'the Guardian and Loner two-objective gates reveal the entrance while other tracks are not authored');
assert.equal(room.templeFinale, null, 'seeing the entrance does not teleport the party into the finale');
assert.ok(world.serializeRoom(room, explorer.id).entities.some((entity) => entity.id === 'finale-entrance'));
const lonerView = world.serializeRoom(room, loner.id);
assert.equal(lonerView.entities.some((entity) => entity.id === 'final-gate'), false, 'the obsolete Loner-only final gate stays hidden');
assert.equal(lonerView.entities.some((entity) => entity.id === 'finale-entrance'), true, 'the Loner sees the same shared finale entrance as everyone else');
const finalePortal = lonerView.entities.find((entity) => entity.id === 'finale-entrance');
assert.deepEqual({ x: finalePortal.x, z: finalePortal.z, label: finalePortal.label }, { x: 0, z: 0, label: 'Finale Portal' }, 'the shared finale portal appears in the middle of the original map');

for (const player of [explorer, collector, guardian, loner]) {
  player.x = 0; player.z = 0;
  const result = world.interact(room, player, 'enter-final-temple', 'finale-entrance');
  if (player !== loner) assert.equal(result.lanternRite, undefined, 'the party waits at the entrance for every player');
  else assert.equal(result.lanternRite, true, 'the fourth arrival launches Muskan\'s cooperative Lantern Rite');
}
assert.equal(room.templeFinale, null, 'the legacy split-screen Temple finale is not launched');
assert.equal([...room.players.values()].every((player) => player.realm === 'lantern-rite'), true, 'Muskan\'s finale moves all four into its shared arena');
assert.equal(room.finalObjective.variant.id, 'lantern_rite');
console.log('Muskan finale entrance gate tests passed.');
