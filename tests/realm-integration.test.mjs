import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';
import { ghostVillageAimPoint } from '../client/session.js';
import { applyRealmPreview } from '../client/realm-preview.js';

assert.deepEqual(ghostVillageAimPoint(74, 110), { x: 0, z: 0 });
assert.deepEqual(ghostVillageAimPoint(886, 518), { x: 28, z: 14 });
assert.deepEqual(ghostVillageAimPoint(480, 314), { x: 14, z: 7 });
for (const feature of ['spirit-realm', 'shadow-forest', 'moon-shrine', 'ghost-village']) {
  const preview = { network:{} };
  assert.equal(applyRealmPreview(preview, feature), true);
  assert.equal(preview.mine.archetype, 'Loner');
  assert.equal(preview.world.code, 'PREVIEW');
}
assert.equal(applyRealmPreview({network:{}}, 'not-a-realm'), false);

const portalTestWorld = createGameWorld({ unlockAllLonerPortals: true });
const portalTestRoom = portalTestWorld.createRoom('PORTALS');
for (const feature of ['spirit-realm', 'shadow-forest', 'moon-shrine', 'ghost-village']) assert.equal(portalTestRoom.world.unlocked.has(feature), true);

let stamp = 10_000;
const world = createGameWorld({ clock: () => stamp });
const room = world.createRoom('REALM');
world.rooms.set(room.code, room);
for (const [index, role] of ['Explorer', 'Collector', 'Guardian', 'Loner'].entries()) {
  const player = world.createPlayer(`p${index}`, role, index);
  player.archetype = role;
  room.players.set(player.id, player);
}
room.phase = 'evolving';
const loner = room.players.get('p3');

// A realm entry is a normal world interaction: feature gate, distance and role
// are validated by the shared world, while the realm system owns its internals.
world.unlock(room, 'spirit-realm', 'The veil opens.');
loner.x = -3; loner.z = 10;
assert.equal(world.interact(room, loner, 'enter-spirit-realm', 'spirit-portal').ok, true);
assert.equal(loner.realm, 'dungeon');
let snapshot = world.serializeRoom(room, loner.id);
assert.equal(snapshot.players.find((player) => player.id === loner.id).realm, 'dungeon');
assert.ok(snapshot.entities.some((entity) => entity.type === 'dungeon-enemy'));
assert.equal(world.interact(room, loner, 'dungeon-attack', 'dungeon-warden-1').ok, false, 'dungeon distance remains server validated');

// Later Loner evolutions are separate, feature-gated realms and do not alter
// Guardian portals or Temple state.
loner.realm = 'overworld'; loner.x = -20; loner.z = 5;
world.unlock(room, 'shadow-forest', 'The second forest wakes.', { privateTo: loner.id });
assert.equal(room.world.unlocked.has('shadow-forest'), false, 'Loner realm remains private');
assert.equal(world.interact(room, loner, 'enter-shadow-forest', 'shadow-forest-gate').ok, true);
assert.equal(loner.realm, 'shadow-forest');
snapshot = world.serializeRoom(room, loner.id);
assert.ok(snapshot.entities.some((entity) => entity.id === 'shadow-forest-exit'));

console.log('Realm coordinator integration tests passed.');
