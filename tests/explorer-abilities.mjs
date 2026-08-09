import assert from 'node:assert/strict';
import { createGameWorld } from '../server/game-world.mjs';
import { CAVE_DEMON_MAX_HEALTH, CAVE_PLAYER_MAX_HEALTH, EVOLUTION_LIBRARY, EXPEDITION_IDS, RUINS_MUMMY_MAX_HEALTH } from '../shared/game-content.js';

let clock = 0;
const timedWorld = createGameWorld({ collisionTiles: [], observationMs: 40_000, gmAssignmentGraceMs: 0, clock: () => clock });
const timedRoom = timedWorld.createRoom('CLOCK'); timedWorld.rooms.set(timedRoom.code, timedRoom);
for (let index = 0; index < 4; index += 1) { const player = timedWorld.createPlayer(`clock-${index}`, `Clock ${index}`, index); timedRoom.players.set(player.id, player); }
timedWorld.beginObservation(timedRoom); clock = 39_999;
assert.equal(timedWorld.serializeRoom(timedRoom).phase, 'observing');
assert.equal(timedWorld.serializeRoom(timedRoom).observationSecondsRemaining, 1);
clock = 40_000;
assert.equal(timedWorld.serializeRoom(timedRoom).phase, 'evolving', 'roles should awaken exactly when the 40-second observation ends');

const world = createGameWorld({ collisionTiles: [] });
const room = world.createRoom('SCOUT');
world.rooms.set(room.code, room);
const explorer = world.createPlayer('explorer', 'Ari', 0);
explorer.archetype = 'Explorer';
room.players.set(explorer.id, explorer);
room.phase = 'evolving';
assert.equal(world.selectExpeditions(room, ['dark-cave', 'sunken-temple'], 'test').ok, true);

const expected = [
  'hidden-cave-appears',
  'temple-staircase-uncovered',
];

assert.deepEqual(EVOLUTION_LIBRARY.Explorer.map(([feature]) => feature), ['hidden-cave-appears', 'temple-staircase-uncovered', 'forgotten-ruins-emerge']);
assert.deepEqual(EXPEDITION_IDS, ['dark-cave', 'sunken-temple', 'hidden-ruins']);

// The Game Master may shape each selected realm, but it cannot starve one
// destination across new tales: all three appear twice in a three-tale cycle.
const fairWorld = createGameWorld({ collisionTiles: [] });
const fairPairs = [];
for (const code of ['FAIR-ONE', 'FAIR-TWO', 'FAIR-THREE']) {
  const fairRoom = fairWorld.createRoom(code); fairWorld.rooms.set(code, fairRoom); fairRoom.phase = 'evolving';
  fairPairs.push(fairWorld.selectExpeditions(fairRoom, ['dark-cave', 'sunken-temple'], 'MCP Game Master').expeditions);
}
assert.deepEqual(fairPairs, [
  ['hidden-ruins', 'dark-cave'],
  ['hidden-ruins', 'sunken-temple'],
  ['dark-cave', 'sunken-temple'],
]);
assert.deepEqual(Object.fromEntries(EXPEDITION_IDS.map((id) => [id, fairPairs.flat().filter((choice) => choice === id).length])), {
  'dark-cave': 2,
  'sunken-temple': 2,
  'hidden-ruins': 2,
});

for (const [index, feature] of expected.entries()) {
  const result = world.evolve(room, explorer.id, 'test');
  assert.equal(result.ok, true);
  assert.equal(result.feature, feature);
  assert.deepEqual(explorer.evolutions, expected.slice(0, index + 1));

  const state = world.serializeRoom(room, explorer.id);
  assert.ok(state.world.unlocked.includes(feature), `${feature} should be unlocked`);
  assert.ok(state.entities.some((entity) => entity.feature === feature), `${feature} should reveal an entity`);
  assert.ok(state.terrain.some((area) => area.feature === feature), `${feature} should reveal terrain`);
  for (const locked of expected.slice(index + 1)) {
    assert.equal(state.entities.some((entity) => entity.feature === locked), false, `${locked} should remain hidden`);
    assert.equal(state.terrain.some((area) => area.feature === locked), false, `${locked} terrain should remain hidden`);
  }
}

assert.equal(world.evolve(room, explorer.id, 'test').ok, false, 'a third Explorer evolution must be rejected');

const discoveryWorld = createGameWorld({ collisionTiles: [] });
const discoveryRoom = discoveryWorld.createRoom('ROUTE');
discoveryWorld.rooms.set(discoveryRoom.code, discoveryRoom);
const routeExplorer = discoveryWorld.createPlayer('route-explorer', 'Nova', 0);
routeExplorer.archetype = 'Explorer'; discoveryRoom.players.set(routeExplorer.id, routeExplorer); discoveryRoom.phase = 'evolving';
assert.equal(discoveryWorld.selectExpeditions(discoveryRoom, ['dark-cave', 'sunken-temple'], 'test').ok, true);

// Walking to the temple staircase first must awaken it first: Explorer discoveries
// are spatial and independent, not a forced two-step quest chain.
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: 20, z: -4 }, true);
assert.deepEqual(routeExplorer.evolutions, ['temple-staircase-uncovered']);
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: -21, z: -11 }, true);
assert.deepEqual(routeExplorer.evolutions, ['temple-staircase-uncovered', 'hidden-cave-appears']);

// Expedition discoveries are private to the Explorer. The party remains in
// the shared overworld while the Explorer handles the solo expedition.
const discoveryCollector = discoveryWorld.createPlayer('discovery-collector', 'Mira', 1);
discoveryCollector.archetype = 'Collector'; discoveryRoom.players.set(discoveryCollector.id, discoveryCollector);
const collectorDiscoveryState = discoveryWorld.serializeRoom(discoveryRoom, discoveryCollector.id);
assert.equal(collectorDiscoveryState.entities.some((entity) => entity.id === 'hidden-cave-mouth'), false, 'the Collector should not see the Explorer cave');
assert.equal(collectorDiscoveryState.terrain.some((area) => area.id === 'hidden-cave-clearing'), false, 'the cave clearing should remain private to the Explorer');
assert.equal(collectorDiscoveryState.entities.some((entity) => entity.id === 'hidden-temple-entrance'), false, 'the Collector should not see the Explorer temple entrance');
assert.equal(collectorDiscoveryState.terrain.some((area) => area.id === 'temple-staircase-ground'), false, 'the temple approach should remain private to the Explorer');
discoveryCollector.x = -21; discoveryCollector.z = -11;
assert.match(discoveryWorld.interact(discoveryRoom, discoveryCollector, 'enter-dark-cave', 'hidden-cave-mouth').error, /Only the Explorer/i, 'only the Explorer may enter the cave');
discoveryCollector.x = 20; discoveryCollector.z = -3;
assert.match(discoveryWorld.interact(discoveryRoom, discoveryCollector, 'enter-sunken-temple', 'hidden-temple-entrance').error, /Only the Explorer/i, 'only the Explorer may enter the Sunken Temple');

const enterCave = discoveryWorld.interact(discoveryRoom, routeExplorer, 'enter-dark-cave', 'hidden-cave-mouth');
assert.equal(enterCave.ok, true, 'the Explorer should discover and enter the Black Hollow');
assert.equal(routeExplorer.zone, 'dark-cave');
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: 0, z: 11 }, 'the cave should place arrivals beside its southern passage');
assert.equal(discoveryRoom.world.unlocked.has('dark-cave-open'), true);
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: 0, z: 15 }, true);
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: 0, z: 11 }, 'the cavern wall must stop players from entering the black void');
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: -14, z: -2 }, true);
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: -14, z: -2 }, 'the western shard grotto should be walkable');
routeExplorer.x = 0; routeExplorer.z = 12;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'exit-dark-cave', 'dark-cave-exit').ok, true, 'the southern passage should return the Explorer to Everdawn');
assert.equal(routeExplorer.zone, 'overworld');

routeExplorer.x = 20; routeExplorer.z = -3;
const enterTemple = discoveryWorld.interact(discoveryRoom, routeExplorer, 'enter-sunken-temple', 'hidden-temple-entrance');
assert.equal(enterTemple.ok, true, 'the Explorer should awaken and enter the Sunken Temple');
assert.equal(routeExplorer.zone, 'sunken-temple');
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: 0, z: 12 }, 'the temple should place arrivals beside the return staircase');
assert.equal(discoveryRoom.world.unlocked.has('sunken-temple-open'), true);
assert.equal(discoveryWorld.serializeRoom(discoveryRoom, routeExplorer.id).templeCombat, undefined, 'the Sunken Temple should remain a peaceful exploration space with no mummies');
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: -12, z: 0 }, true);
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: -12, z: 0 }, 'the original west chamber should be walkable');
discoveryWorld.recordTelemetry(discoveryRoom, routeExplorer, { x: -22, z: 14 }, true);
assert.deepEqual({ x: routeExplorer.x, z: routeExplorer.z }, { x: -16, z: 0 }, 'players should slide along the wall without crossing into a corner void');
routeExplorer.x = 0; routeExplorer.z = 12;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'exit-sunken-temple', 'sunken-temple-exit').ok, true, 'the return staircase should lead back to Everdawn');
assert.equal(routeExplorer.zone, 'overworld');

const collector = discoveryWorld.createPlayer('temple-collector', 'Mira', 1);
collector.archetype = 'Collector'; collector.x = -21; collector.z = -11; discoveryRoom.players.set(collector.id, collector);
assert.match(discoveryWorld.interact(discoveryRoom, collector, 'enter-dark-cave', 'hidden-cave-mouth').error, /Only the Explorer/i, 'the cave should not admit the Collector');
assert.equal(discoveryWorld.serializeRoom(discoveryRoom, collector.id).caveShardProgress, undefined, 'the Collector should not receive the Explorer shard counter');
// The shard room opens only after its demons have been cleared; combat itself is exercised below.
discoveryRoom.caveCombat.cleared = true;
routeExplorer.x = -21; routeExplorer.z = -11;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'enter-dark-cave', 'hidden-cave-mouth').ok, true, 'the Explorer should re-enter the private cave to recover its shards');
routeExplorer.x = -14; routeExplorer.z = -2;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'relic', 'gloom-shard-west').ok, true, 'the Explorer should claim the Umbral Shard');
routeExplorer.x = 13; routeExplorer.z = -3;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'relic', 'gloom-shard-east').ok, true, 'the Explorer should claim the Fossil Shard');
let finalCaveShard;
for (const [id, x, z] of [['gloom-shard-north', 0, -10], ['gloom-shard-deep', -6, 5]]) {
  routeExplorer.x = x; routeExplorer.z = z;
  finalCaveShard = discoveryWorld.interact(discoveryRoom, routeExplorer, 'relic', id);
  assert.equal(finalCaveShard.ok, true, `${id} should be collectible by the Explorer after the demons fall`);
}
assert.deepEqual(discoveryWorld.serializeRoom(discoveryRoom, routeExplorer.id).caveShardProgress, { collected: 4, total: 4 }, 'all four cave shards should be tracked privately for the Explorer');
assert.equal(discoveryWorld.serializeRoom(discoveryRoom, collector.id).caveShardProgress, undefined, 'the Collector must not receive the Explorer shard counter');
assert.equal(finalCaveShard.missionComplete?.expedition, 'dark-cave', 'the final cave shard should trigger a completion return');
assert.equal(routeExplorer.zone, 'overworld', 'collecting the final cave shard should return the Explorer to the overworld');

collector.x = 20; collector.z = -3;
assert.match(discoveryWorld.interact(discoveryRoom, collector, 'enter-sunken-temple', 'hidden-temple-entrance').error, /Only the Explorer/i, 'the temple should not admit the Collector');
assert.equal(discoveryWorld.serializeRoom(discoveryRoom, collector.id).shardProgress, undefined, 'the temple shard counter should stay hidden from the Collector');
routeExplorer.x = 20; routeExplorer.z = -3;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'enter-sunken-temple', 'hidden-temple-entrance').ok, true, 'the Explorer should enter the private temple');
routeExplorer.x = -14; routeExplorer.z = 0;
assert.equal(discoveryWorld.interact(discoveryRoom, routeExplorer, 'relic', 'tideglass-shard-west').ok, true, 'the Explorer should claim a temple shard');
assert.equal(routeExplorer.relicIds.has('tideglass-shard-west'), true);
const shardState = discoveryWorld.serializeRoom(discoveryRoom, routeExplorer.id);
assert.deepEqual(shardState.shardProgress, { collected: 1, total: 4, objectiveRevealed: false }, 'the Explorer should privately discover temple shard progress after the first pickup');
assert.equal(discoveryWorld.serializeRoom(discoveryRoom, collector.id).shardProgress, undefined, 'other roles must not receive the Explorer shard counter');

let ruinsClock = 0;
const ruinsWorld = createGameWorld({ collisionTiles: [], clock: () => ruinsClock });
const ruinsRoom = ruinsWorld.createRoom('RUINS'); ruinsWorld.rooms.set(ruinsRoom.code, ruinsRoom); ruinsRoom.phase = 'evolving';
const ruinsExplorer = ruinsWorld.createPlayer('ruins-explorer', 'Sage', 0); ruinsExplorer.archetype = 'Explorer'; ruinsRoom.players.set(ruinsExplorer.id, ruinsExplorer);
const ruinsCollector = ruinsWorld.createPlayer('ruins-collector', 'Mina', 1); ruinsCollector.archetype = 'Collector'; ruinsRoom.players.set(ruinsCollector.id, ruinsCollector);
assert.equal(ruinsWorld.selectExpeditions(ruinsRoom, ['hidden-ruins', 'dark-cave'], 'test').ok, true, 'the AI draft should accept exactly two distinct destinations');
assert.equal(ruinsWorld.selectExpeditions(ruinsRoom, ['hidden-ruins'], 'test').ok, false, 'a one-map draft must be rejected');
const activeTaleShardCount = ruinsRoom.entities.filter((entity) => (
  entity.id.startsWith('sunstone-shard-')
  || entity.id.startsWith('gloom-shard-')
  || entity.id.startsWith('everdawn-shard-')
)).length;
assert.equal(activeTaleShardCount, 13, 'two selected expeditions should provide eight shards, supplemented by five Everdawn shards');
const adaptivePlan = ruinsWorld.adaptEncounter(ruinsRoom, 'hidden-ruins', 'guard-collector', 'The Collector gathered most often, so the wardens should force the party to protect them.', 'AI Game Master test');
assert.equal(adaptivePlan.ok, true, 'the AI should be able to shape a selected hostile expedition');
assert.equal(ruinsWorld.adaptEncounter(ruinsRoom, 'hidden-ruins', 'hunt-straggler', 'Try a second plan.', 'AI Game Master test').ok, false, 'one AI plan should remain authoritative for the encounter');
ruinsWorld.recordTelemetry(ruinsRoom, ruinsExplorer, { x: 12, z: -9 }, true);
assert.deepEqual(ruinsExplorer.evolutions, ['forgotten-ruins-emerge'], 'walking near the buried arch should awaken the selected Hidden Ruins');
assert.equal(ruinsWorld.unlock(ruinsRoom, 'temple-staircase-uncovered').ok, false, 'the unused third expedition must remain unavailable');
ruinsCollector.x = 12; ruinsCollector.z = -9;
assert.equal(ruinsWorld.serializeRoom(ruinsRoom, ruinsCollector.id).entities.some((entity) => entity.id === 'hidden-ruins-entrance'), false, 'the Collector should not see the Hidden Ruins entrance');
assert.match(ruinsWorld.interact(ruinsRoom, ruinsCollector, 'enter-hidden-ruins', 'hidden-ruins-entrance').error, /Only the Explorer/i, 'only the Explorer should enter the Hidden Ruins');
assert.equal(ruinsWorld.interact(ruinsRoom, ruinsExplorer, 'enter-hidden-ruins', 'hidden-ruins-entrance').ok, true);
assert.equal(ruinsExplorer.zone, 'hidden-ruins');
ruinsWorld.recordTelemetry(ruinsRoom, ruinsExplorer, { x: 0, z: 16 }, true);
assert.deepEqual({ x: ruinsExplorer.x, z: ruinsExplorer.z }, { x: 0, z: 11 }, 'the sandstone perimeter must keep players inside the ruins');
const ruinsState = ruinsWorld.serializeRoom(ruinsRoom, ruinsExplorer.id);
assert.equal(ruinsState.ruinsCombat.enemies.length, 2, 'two mummy wardens should inhabit the Hidden Ruins');
assert.equal(ruinsState.entities.filter((entity) => entity.id.startsWith('sunstone-shard-')).length, 4, 'the Explorer should see all four Sunstones');
assert.equal(ruinsWorld.serializeRoom(ruinsRoom, ruinsCollector.id).entities.filter((entity) => entity.id.startsWith('sunstone-shard-')).length, 0, 'other roles should not see Explorer-only Sunstones');
assert.equal(ruinsState.ruinsCombat.tacticId, 'guard-collector', 'the AI-selected encounter tactic should reach every client');
assert.equal(ruinsState.aiDirector.decisions.some((decision) => decision.type === 'encounter-tactic' && decision.choice === 'hidden-ruins:guard-collector'), true, 'the AI decision trail should record why the encounter changed');
assert.ok(ruinsState.ruinsCombat.enemies.every((enemy) => enemy.maxHealth === RUINS_MUMMY_MAX_HEALTH && enemy.maxHealth === 80), 'each mummy should have 80% of a player health bar');
const mummy = ruinsRoom.ruinsCombat.enemies[0];
ruinsExplorer.x = mummy.x - 1; ruinsExplorer.z = mummy.z;
ruinsClock += 400; assert.equal(ruinsWorld.attackEncounter(ruinsRoom, ruinsExplorer).ok, true);
const mummyAfterExplorer = mummy.health;
ruinsClock += 400; assert.equal(ruinsWorld.attackEncounter(ruinsRoom, ruinsExplorer).ok, true);
assert.ok(mummy.health < mummyAfterExplorer, 'the Explorer should damage the authoritative mummy');
ruinsRoom.ruinsCombat.enemies[1].health = 0;
mummy.x = ruinsExplorer.x; mummy.z = ruinsExplorer.z; mummy.lastAttackAt = -Infinity;
ruinsExplorer.health = CAVE_PLAYER_MAX_HEALTH;
ruinsClock += 1_200; ruinsWorld.tickRoom(ruinsRoom, 0);
assert.equal(ruinsExplorer.health, 95, 'a mummy strike should deal exactly 5% of a full player health bar');
const mummyStrikeState = ruinsWorld.serializeRoom(ruinsRoom, ruinsExplorer.id);
assert.equal(mummyStrikeState.players.find((player) => player.id === ruinsExplorer.id).hurt, true, 'the mummy victim should receive a visible hurt state');
assert.equal(mummyStrikeState.ruinsCombat.enemies.find((enemy) => enemy.id === mummy.id).attacking, true, 'the striking mummy should expose its attack animation state');
assert.equal(mummyStrikeState.ruinsCombat.enemies.find((enemy) => enemy.id === mummy.id).targetId, ruinsExplorer.id, 'the mummy should pursue the solo Explorer');
// The Explorer should be able to target the visible Sunstone before it is
// unlocked, and receive the actual guardian requirement rather than a vague
// proximity error.
ruinsExplorer.x = 0; ruinsExplorer.z = 5.9;
const guardedSunstone = ruinsWorld.interact(ruinsRoom, ruinsExplorer, 'relic', 'sunstone-shard-heart');
assert.equal(guardedSunstone.ok, false, 'a Sunstone should remain locked while its wardens are alive');
assert.match(guardedSunstone.error, /mummy wardens guard/i, 'the Explorer should be told why the nearby Sunstone is locked');
for (const enemy of ruinsRoom.ruinsCombat.enemies) enemy.health = 0;
ruinsRoom.ruinsCombat.cleared = true;
// The visible glow should be enough to claim a Sunstone; players should not
// have to stand on the exact centre of its tile.
ruinsExplorer.x = 0; ruinsExplorer.z = 5.9;
assert.equal(
  ruinsWorld.interact(ruinsRoom, ruinsExplorer, 'relic', 'sunstone-shard-heart').ok,
  true,
  'the Explorer should claim a Sunstone from its visible glow radius',
);
let finalSunstone;
for (const [id, x, z] of [['sunstone-shard-west', -12, 5], ['sunstone-shard-east', 12, 5], ['sunstone-shard-crown', 0, -11]]) {
  ruinsExplorer.x = x; ruinsExplorer.z = z;
  finalSunstone = ruinsWorld.interact(ruinsRoom, ruinsExplorer, 'relic', id);
  assert.equal(finalSunstone.ok, true, `${id} should become collectible by the Explorer after both mummies fall`);
}
assert.deepEqual(ruinsWorld.serializeRoom(ruinsRoom, ruinsExplorer.id).ruinsShardProgress, { collected: 4, total: 4 }, 'all four Sunstones should be tracked privately for the Explorer');
assert.equal(ruinsWorld.serializeRoom(ruinsRoom, ruinsCollector.id).ruinsShardProgress, undefined, 'other roles must not receive the Explorer Sunstone counter');
assert.equal(finalSunstone.missionComplete?.expedition, 'hidden-ruins', 'the final Sunstone should trigger a completion return');
assert.equal(ruinsExplorer.zone, 'overworld', 'collecting the final Sunstone should return the Explorer to the overworld');

const lakeWorld = createGameWorld({ collisionTiles: [] });
const lakeRoom = lakeWorld.createRoom('LAKE'); lakeWorld.rooms.set(lakeRoom.code, lakeRoom); lakeRoom.phase = 'evolving';
const dryExplorer = lakeWorld.createPlayer('dry-explorer', 'Dry Explorer', 0); dryExplorer.archetype = 'Explorer'; dryExplorer.x = 7; dryExplorer.z = 7; lakeRoom.players.set(dryExplorer.id, dryExplorer);
lakeWorld.recordTelemetry(lakeRoom, dryExplorer, { x: 9, z: 7 }, true);
assert.deepEqual({ x: dryExplorer.x, z: dryExplorer.z }, { x: 7, z: 7 }, 'the Explorer must not walk into the visible lake');
const waterCollector = lakeWorld.createPlayer('water-collector', 'Water Collector', 1); waterCollector.archetype = 'Collector'; waterCollector.x = 7; waterCollector.z = 7; lakeRoom.players.set(waterCollector.id, waterCollector);
lakeWorld.recordTelemetry(lakeRoom, waterCollector, { x: 9, z: 7 }, true);
assert.deepEqual({ x: waterCollector.x, z: waterCollector.z }, { x: 7, z: 7 }, 'water must be blocked for every role for now');

const shorelineWalker = lakeWorld.createPlayer('shoreline-walker', 'Shoreline Walker', 2); shorelineWalker.x = 3; shorelineWalker.z = 7; lakeRoom.players.set(shorelineWalker.id, shorelineWalker);
lakeWorld.recordTelemetry(lakeRoom, shorelineWalker, { x: 6, z: 7 }, true);
assert.deepEqual({ x: shorelineWalker.x, z: shorelineWalker.z }, { x: 6, z: 7 }, 'the visible grass west of the lake must not be treated as water');
lakeWorld.recordTelemetry(lakeRoom, shorelineWalker, { x: 5, z: 16 }, true);
assert.deepEqual({ x: shorelineWalker.x, z: shorelineWalker.z }, { x: 5, z: 16 }, 'the final southern grass row must remain reachable');

const grassWorld = createGameWorld({ collisionTiles: new Array(60 * 34).fill(1) });
const grassRoom = grassWorld.createRoom('GRASS'); grassWorld.rooms.set(grassRoom.code, grassRoom); grassRoom.phase = 'evolving';
const grassWalker = grassWorld.createPlayer('grass-walker', 'Grass Walker', 0); grassRoom.players.set(grassWalker.id, grassWalker);
grassWorld.recordTelemetry(grassRoom, grassWalker, { x: 0, z: 0 }, true);
assert.deepEqual({ x: grassWalker.x, z: grassWalker.z }, { x: 0, z: 0 }, 'authored props must no longer create invisible walls across grass');

let combatClock = 0;
const combatWorld = createGameWorld({ collisionTiles: [], clock: () => combatClock });
const combatRoom = combatWorld.createRoom('FIGHT'); combatWorld.rooms.set(combatRoom.code, combatRoom); combatRoom.phase = 'evolving';
assert.equal(combatWorld.selectExpeditions(combatRoom, ['dark-cave', 'hidden-ruins'], 'test').ok, true, 'the cave combat scenario should use a selected expedition');
combatRoom.world.unlocked.add('hidden-cave-appears');
const fighterOne = combatWorld.createPlayer('fighter-one', 'Fighter One', 0); fighterOne.archetype = 'Explorer'; fighterOne.x = -21; fighterOne.z = -11; combatRoom.players.set(fighterOne.id, fighterOne);
const fighterTwo = combatWorld.createPlayer('fighter-two', 'Fighter Two', 1); fighterTwo.archetype = 'Collector'; fighterTwo.x = -21; fighterTwo.z = -11; combatRoom.players.set(fighterTwo.id, fighterTwo);
assert.equal(combatWorld.interact(combatRoom, fighterOne, 'enter-dark-cave', 'hidden-cave-mouth').ok, true);
assert.match(combatWorld.interact(combatRoom, fighterTwo, 'enter-dark-cave', 'hidden-cave-mouth').error, /Only the Explorer/i, 'the cave must remain a solo Explorer expedition');
const combatState = combatWorld.serializeRoom(combatRoom, fighterOne.id);
assert.equal(combatState.caveCombat.enemies.length, 3, 'three demons should guard the Black Hollow');
assert.ok(combatState.caveCombat.enemies.every((enemy) => enemy.maxHealth === CAVE_DEMON_MAX_HEALTH && enemy.maxHealth === CAVE_PLAYER_MAX_HEALTH * .75), 'each demon should have 75% of a player health bar');
assert.equal(fighterOne.health, CAVE_PLAYER_MAX_HEALTH);

const sharedTarget = combatRoom.caveCombat.enemies[0];
fighterOne.x = sharedTarget.x - 1; fighterOne.z = sharedTarget.z;
combatClock += 400;
assert.equal(combatWorld.attackDarkCave(combatRoom, fighterOne).ok, true);
const afterFirstStrike = sharedTarget.health;
combatClock += 400;
assert.equal(combatWorld.attackDarkCave(combatRoom, fighterOne).ok, true);
assert.ok(sharedTarget.health < afterFirstStrike, 'the Explorer should damage the authoritative enemy state');

const setbackHealth = fighterOne.health;
combatClock += 2_000;
combatWorld.recordTelemetry(combatRoom, fighterOne, { x: 3, z: -7 }, true);
assert.deepEqual({ x: fighterOne.x, z: fighterOne.z }, { x: 0, z: 4 }, 'the false-floor portal should throw the player backward');
assert.equal(fighterOne.health, setbackHealth - 5, 'the false floor should cost exactly 5% health');
combatWorld.recordTelemetry(combatRoom, fighterOne, { x: -10, z: -1 }, true);
assert.notDeepEqual({ x: fighterOne.x, z: fighterOne.z }, { x: -10, z: -1 }, 'the other black pools should be solid hazards, not walkable floor');

for (const enemy of combatRoom.caveCombat.enemies) enemy.health = 0;
const executioner = combatRoom.caveCombat.enemies[0]; executioner.health = CAVE_DEMON_MAX_HEALTH; executioner.x = fighterOne.x; executioner.z = fighterOne.z; executioner.lastAttackAt = -Infinity;
combatRoom.caveCombat.cleared = false; fighterOne.health = CAVE_PLAYER_MAX_HEALTH;
combatClock += 1_300; combatWorld.tickRoom(combatRoom, 0);
assert.equal(fighterOne.health, 95, 'a demon strike should deal exactly 5% of a full player health bar');
const demonStrikeState = combatWorld.serializeRoom(combatRoom, fighterOne.id);
assert.equal(demonStrikeState.players.find((player) => player.id === fighterOne.id).hurt, true, 'the demon victim should receive a visible hurt state');
assert.equal(demonStrikeState.caveCombat.enemies.find((enemy) => enemy.id === executioner.id).attacking, true, 'the striking demon should expose its attack animation state');
for (let strike = 1; strike < 20; strike += 1) { combatClock += 1_300; combatWorld.tickRoom(combatRoom, 0); }
assert.equal(fighterOne.health, 0, 'the Explorer can be reduced to zero health in the cave');
assert.equal(fighterOne.zone, 'overworld', 'zero health should eject the Explorer from the cave');
assert.equal(fighterOne.caveLocked, true, 'a defeated Explorer should be locked out for the remainder of the match');
fighterOne.x = -21; fighterOne.z = -11;
const lockedReturn = combatWorld.interact(combatRoom, fighterOne, 'enter-dark-cave', 'hidden-cave-mouth');
assert.equal(lockedReturn.ok, false);
assert.match(lockedReturn.error, /will not admit/i, 'the defeated player must receive a clear re-entry denial');

console.log('Two-of-three expedition drafting, Explorer discoveries, Hidden Ruins mummy combat, Black Hollow, Sunken Temple, and role-gated shards passed.');
