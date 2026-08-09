import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';

// Guidance is an intentionally private channel. These checks cover both the
// isolated messages and their real world-flow integration points.
let stamp = 0;
const delivered = [];
const world = createGameWorld({
  clock: () => stamp,
  observationMs: 100,
  emitEvent: (_room, item) => delivered.push(item),
});
const room = world.createRoom('GUIDE01');
const players = ['Ari', 'Bea', 'Cy', 'Dee'].map((name, index) => world.createPlayer(`player-${index}`, name, index));
for (const player of players) room.players.set(player.id, player);

world.beginObservation(room);
const introductions = delivered.filter((item) => item.type === 'gm-guidance' && item.guidanceId === 'first-steps');
assert.equal(introductions.length, 4, 'every player receives their own opening instruction');
assert.equal(new Set(introductions.map((item) => item.privateTo)).size, 4, 'an opening instruction is never shared with another player');
assert.ok(introductions.every((item) => item.privateTo === item.playerId), 'all guidance uses the private recipient channel');
assert.match(introductions[0].message, /forty seconds/i, 'opening guidance explains the observation period');
assert.match(introductions[0].message, /WASD or the arrow keys/i, 'opening guidance includes movement controls');

stamp = 100;
const assignments = [
  { playerId: players[0].id, archetype: 'Explorer' },
  { playerId: players[1].id, archetype: 'Collector' },
  { playerId: players[2].id, archetype: 'Guardian' },
  { playerId: players[3].id, archetype: 'Loner' },
];
assert.equal(world.assignArchetypes(room, assignments, 'test', ['dark-cave', 'sunken-temple']).ok, true);
const roleGuides = delivered.filter((item) => item.type === 'gm-guidance' && item.guidanceId.startsWith('role:'));
assert.equal(roleGuides.length, 4, 'each revealed role gets exactly one personal explanation');
assert.equal(roleGuides.find((item) => item.privateTo === players[2].id)?.message.includes('Guardian'), true);
assert.equal(roleGuides.find((item) => item.privateTo === players[3].id)?.message.includes('Loner'), true);

const guardian = players[2];
assert.equal(world.evolve(room, guardian.id, 'test').ok, true);
guardian.x = 10; guardian.z = -5;
assert.equal(world.interact(room, guardian, 'enter-guardian-portal', 'guardian-portal-1').ok, true);
const guardianTrialGuide = delivered.find((item) => item.guidanceId === 'guardian-trial:lost-lanterns');
assert.equal(guardianTrialGuide?.privateTo, guardian.id, 'the Guardian alone sees their trial instructions');
assert.match(guardianTrialGuide.message, /SPACE.*E/, 'the Guardian guide names the exact controls');
assert.equal(world.serializeRoom(room, guardian.id).yourGuidance?.id, 'guardian-trial:lost-lanterns', 'a reconnect retains only the Guardian\'s current instruction');

const loner = players[3];
assert.equal(world.evolve(room, loner.id, 'test').ok, true);
loner.x = -3; loner.z = 10;
assert.equal(world.interact(room, loner, 'enter-spirit-realm', 'spirit-portal').ok, true);
const realmGuide = delivered.find((item) => item.guidanceId === 'realm:dungeon');
assert.equal(realmGuide?.privateTo, loner.id, 'the Loner alone sees their hidden-realm rule');
assert.match(realmGuide.message, /press E repeatedly/i);
assert.equal(delivered.some((item) => item.type === 'gm-guidance' && item.privateTo !== item.playerId), false, 'guidance never leaks to a different player');

console.log('Player-specific Game Master guidance tests passed.');
