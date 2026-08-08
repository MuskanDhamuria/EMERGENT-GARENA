import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';

let stamp = 1_000;
const world = createGameWorld({ clock: () => stamp });
const room = world.createRoom('LANTERN');
world.rooms.set(room.code, room);
for (const [index, archetype] of ['Explorer', 'Collector', 'Guardian', 'Loner'].entries()) {
  const player = world.createPlayer(`p${index}`, archetype, index);
  player.archetype = archetype; player.evolutions = ['awakened'];
  room.players.set(player.id, player);
}
room.phase = 'evolving';
const players = [...room.players.values()];
players.find((player) => player.archetype === 'Guardian').guardianPortal = { selectedTrialIds: ['lost-lanterns', 'shrine-of-return'], completedTrialIds: ['lost-lanterns', 'shrine-of-return'], activeTrialId: null, position: null, activatedObjectiveIds: [], narration: [] };
players.find((player) => player.archetype === 'Loner').roleObjectives = new Set(['veil', 'moon']);
assert.ok(world.createFinalObjective(room));
world.tickRoom(room, 0);
assert.ok(room.finaleEntrance, 'the authored Guardian and Loner gates still reveal the shared entrance');

assert.equal(world.directorRules.apply(room, { card: 'finale_variant', payload: { variantId: 'lantern_rite' } }).ok, true, 'the MCP-facing Director can select the cooperative Lantern Rite');
for (const player of players) {
  player.x = 16; player.z = 8;
  const result = world.interact(room, player, 'enter-final-temple', 'finale-entrance');
  if (player === players.at(-1)) assert.equal(result.lanternRite, true);
}
assert.equal(players.every((player) => player.realm === 'lantern-rite'), true, 'the rite moves all four players into one cooperative final arena');
assert.equal(room.templeFinale, null, 'the older Temple pillar finale is not started alongside Muskan\'s finale');
const viewerState = world.serializeRoom(room, players[0].id);
assert.equal(viewerState.lanternRite.phase, 'ENTRY');
assert.equal(viewerState.entities.some((entity) => entity.type === 'lantern-entry-gate'), true);

console.log('Lantern Rite world-entry and Director-variant integration tests passed.');
