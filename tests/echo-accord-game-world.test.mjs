import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';

let stamp = 1_000;
const world = createGameWorld({ clock: () => stamp });
const room = world.createRoom('ECHO');
world.rooms.set(room.code, room);
for (const [index, archetype] of ['Explorer', 'Collector', 'Guardian', 'Loner'].entries()) {
  const player = world.createPlayer(`p${index}`, archetype, index);
  player.archetype = archetype;
  player.evolutions = ['awakened'];
  player.aloneSeconds = 32;
  player.riskEvents = 4;
  room.players.set(player.id, player);
}
room.phase = 'evolving';
const players = [...room.players.values()];
players.find((player) => player.archetype === 'Guardian').guardianPortal = { selectedTrialIds: ['lost-lanterns', 'shrine-of-return'], completedTrialIds: ['lost-lanterns', 'shrine-of-return'], activeTrialId: null, position: null, activatedObjectiveIds: [], narration: [] };
players.find((player) => player.archetype === 'Loner').roleObjectives = new Set(['veil', 'moon']);

assert.equal(world.createFinalObjective(room)?.variant.id, 'echo_accord', 'continued separation and risk select Muskan\'s alternate finale');
world.tickRoom(room, 0);
for (const player of players) {
  player.x = 0; player.z = 0;
  world.interact(room, player, 'enter-final-temple', 'finale-entrance');
}
assert.equal(players.every((player) => player.realm === 'echo-accord'), true, 'the selected Echo Accord owns the final arena');
const before = players[0].x;
world.tickRoom(room, .2);
assert.notEqual(players[0].x, before, 'the finale system advances living echoes authoritatively');
const snapshot = world.serializeRoom(room, players[0].id);
assert.equal(snapshot.finalObjective?.echoAccord?.mode, 'LAST_SNAKE_STANDING');
assert.ok(snapshot.players.every((player) => Array.isArray(player.echoTrail)), 'each client receives the public trail state needed to render the arena');

console.log('Muskan Echo Accord selection and authoritative arena tests passed.');
