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
guardian.guardianPortal = { completedTrialIds: ['wardkeepers-circuit', 'lost-lanterns'] };
loner.roleObjectives = new Set(['veil', 'moon']);
world.tickRoom(room, 0);

assert.equal(room.world.unlocked.has('ancient-temple'), true, 'the Guardian and Loner two-objective gates reveal the entrance while other tracks are not authored');
assert.equal(room.templeFinale, null, 'seeing the entrance does not teleport the party into the finale');
assert.ok(world.serializeRoom(room, explorer.id).entities.some((entity) => entity.id === 'finale-entrance'));

for (const player of [explorer, collector, guardian, loner]) {
  player.x = 16; player.z = 8;
  const result = world.interact(room, player, 'enter-final-temple', 'finale-entrance');
  if (player !== loner) assert.equal(result.templeOpened, undefined, 'the party waits at the entrance for every player');
  else assert.equal(result.templeOpened, true, 'the fourth arrival opens the shared Temple');
}
assert.ok(room.templeFinale);
console.log('Finale entrance gate tests passed.');
