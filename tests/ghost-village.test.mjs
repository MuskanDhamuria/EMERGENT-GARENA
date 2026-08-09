import assert from 'node:assert/strict';
import {createGhostVillageSystem} from '../server/ghost-village-system.mjs';

const events = [];
const world = {event(_room, type, message, data) { events.push({type, message, data}); }};
const system = createGhostVillageSystem(world);
const room = {world: {unlocked: new Set(['ghost-village'])}};
const player = {
  id: 'loner', archetype: 'Loner', realm: 'overworld', x: -16, z: 11,
  inputX: 0, inputZ: 0, interactions: {}
};

assert.equal(system.enter(room, {...player, archetype: 'Explorer'}).ok, false);
assert.equal(system.enter(room, player).ok, true);
assert.equal(player.x, 1.5);
assert.equal(player.z, 11);
assert.equal(player.ghostVillage.ghosts.length, 6);

player.inputX = 1;
player.inputZ = -1;
system.tick(room, player, 0.1);
assert.ok(player.x > 1.5, 'left/right input should move the player');
assert.equal(player.z, 11, 'up/down input must not move the player');
player.inputX = 0;
player.x = 5;

for (const ghost of player.ghostVillage.ghosts) {
  ghost.x = player.x + 0.3;
  ghost.z = 9.4;
  ghost.vx = 0;
  ghost.vz = 0;
  player.ghostVillage.cooldown = 0;
  assert.equal(system.shoot(room, player, {x: ghost.x, z: ghost.z}).ok, true);
  system.tick(room, player, 0.06);
  assert.equal(ghost.active, false, `${ghost.id} should be caught by the arcing shard`);
}

assert.equal(player.realm, 'overworld');
assert.equal(player.interactions['ghost-village-cleared'], 1);
assert.equal(player.completedEvolutions.has('ghost-village-appears'), true);
assert.ok(events.some((event) => event.type === 'ghost-village-complete'));
console.log('Ghost Village tests passed.');
