// Shared, browser-safe game content.  Change this file when designing roles,
// world gates, collectible placement, or a finale action.  Neither the client
// nor the server should define a second version of these rules.

export const MAX_PLAYERS = 4;
export const OBSERVATION_MS = 40_000;
export const CONTENT_VERSION = '2026-08-08-ai-encounter-director-v1';
export const TEMPLE_SHARD_TOTAL = 9;
export const CAVE_SHARD_TOTAL = 2;
export const RUINS_SHARD_TOTAL = 3;
export const CAVE_PLAYER_MAX_HEALTH = 100;
export const CAVE_DEMON_MAX_HEALTH = 75;
export const RUINS_MUMMY_MAX_HEALTH = 80;
export const TEMPLE_WARDEN_MAX_HEALTH = 80;

export const EXPEDITION_IDS = Object.freeze(['dark-cave', 'sunken-temple', 'hidden-ruins']);
export const EXPEDITION_FEATURES = Object.freeze({
  'dark-cave': 'hidden-cave-appears',
  'sunken-temple': 'temple-staircase-uncovered',
  'hidden-ruins': 'forgotten-ruins-emerge',
});

// The AI may change who an encounter pressures, but it cannot invent damage,
// health, geometry, or an impossible rule.  Keeping the tactic catalogue in
// shared data makes every Game Master decision constrained and testable.
export const ENCOUNTER_TACTIC_IDS = Object.freeze(['hunt-straggler', 'pressure-cluster', 'guard-collector']);
export const ENCOUNTER_TACTICS = Object.freeze({
  'hunt-straggler': Object.freeze({
    label: 'The Straggler Hunt',
    message: 'The hunters have noticed who walks alone. They turn toward isolated lanterns.',
    speedMultiplier: 1.08,
    attackCooldownMs: 1_100,
  }),
  'pressure-cluster': Object.freeze({
    label: 'The Formation Breaker',
    message: 'The wardens have learned the group\'s formation. They press its tightest cluster.',
    speedMultiplier: 1,
    attackCooldownMs: 1_200,
  }),
  'guard-collector': Object.freeze({
    label: 'The Relic Ward',
    message: 'The guardians sense the relic-bearer. The Collector will need protection.',
    speedMultiplier: 0.94,
    attackCooldownMs: 1_250,
  }),
});

// One shared silhouette drives both the cave renderer and authoritative
// collision, so the darkness outside the rock wall is never walkable.
export const DARK_CAVE_POINTS = Object.freeze([
  Object.freeze([-4, 14]), Object.freeze([4, 14]), Object.freeze([5, 10]),
  Object.freeze([9, 8]), Object.freeze([14, 8]), Object.freeze([17, 4]),
  Object.freeze([17, -2]), Object.freeze([14, -6]), Object.freeze([10, -8]),
  Object.freeze([8, -13]), Object.freeze([3, -15]), Object.freeze([-3, -14]),
  Object.freeze([-7, -11]), Object.freeze([-8, -8]), Object.freeze([-13, -8]),
  Object.freeze([-17, -5]), Object.freeze([-18, 0]), Object.freeze([-16, 5]),
  Object.freeze([-12, 7]), Object.freeze([-7, 8]), Object.freeze([-5, 11]),
]);

// Two rifts are solid hazards. The southern rift is a false floor that throws
// a player back into the room and takes a small amount of life.
export const DARK_CAVE_RIFTS = Object.freeze([
  Object.freeze({ id: 'rift-west', x: -10, z: -1, radiusX: 3.6, radiusZ: 2.2, setback: false }),
  Object.freeze({ id: 'rift-east', x: 8, z: 5, radiusX: 3.2, radiusZ: 1.8, setback: false }),
  Object.freeze({ id: 'rift-setback', x: 3, z: -7, radiusX: 2.4, radiusZ: 1.4, setback: true, returnX: 0, returnZ: 4 }),
]);

export const HIDDEN_RUINS_POINTS = Object.freeze([
  Object.freeze([-5, 14]), Object.freeze([5, 14]), Object.freeze([6, 9]),
  Object.freeze([13, 9]), Object.freeze([17, 5]), Object.freeze([17, -7]),
  Object.freeze([12, -12]), Object.freeze([5, -14]), Object.freeze([-5, -14]),
  Object.freeze([-12, -12]), Object.freeze([-17, -7]), Object.freeze([-17, 5]),
  Object.freeze([-13, 9]), Object.freeze([-6, 9]),
]);

export const ARCHETYPES = Object.freeze(['Explorer', 'Collector', 'Guardian', 'Loner']);

export const ROLE_ABILITIES = Object.freeze({
  Explorer: Object.freeze([
    'hidden-cave-appears', 'temple-staircase-uncovered', 'forgotten-ruins-emerge',
  ]),
  Collector: Object.freeze(['water-travel', 'relic-lore']),
  Guardian: Object.freeze(['bridge-ward', 'shrine-rite']),
  Loner: Object.freeze(['spirit-sight', 'spirit-walk']),
});

export const FEATURES = new Set([
  'hidden-cave', 'secret-path', 'invisible-bridge',
  'hidden-cave-appears', 'temple-staircase-uncovered', 'forgotten-ruins-emerge',
  'sunken-temple-open', 'dark-cave-open', 'hidden-ruins-open',
  'relic-vault', 'evolving-artifacts', 'treasure-cache', 'healing-shrine',
  'protective-barrier', 'revival-monument', 'spirit-realm', 'illusion-passage',
  'hidden-portal', 'crystal-mine', 'shadow-forest', 'moon-shrine', 'ghost-village', 'ancient-temple', 'final-gate',
]);

// Coordinates are server-world coordinates.  The browser converts them to map
// tiles by adding (30, 17), keeping placement data independent of the camera.
export const TERRAIN_OVERLAYS = Object.freeze([
  Object.freeze({ id: 'hidden-cave-clearing', kind: 'cave', role: 'Explorer', feature: 'hidden-cave-appears', label: 'Hidden Cave', x: -23, z: -12, w: 5, h: 4, blocksEveryoneElse: true }),
  Object.freeze({ id: 'temple-staircase-ground', kind: 'staircase', role: 'Explorer', feature: 'temple-staircase-uncovered', label: 'Temple Staircase', x: 18, z: -6, w: 5, h: 5, blocksEveryoneElse: true }),
  Object.freeze({ id: 'forgotten-ruins-site', kind: 'ruins', role: 'Explorer', feature: 'forgotten-ruins-emerge', label: 'Forgotten Ruins', x: 4, z: -11, w: 5, h: 5, blocksEveryoneElse: true }),
  Object.freeze({ id: 'guardian-bridge', kind: 'bridge', role: 'Guardian', label: 'Warden Bridge', x: 9, z: -3, w: 7, h: 2, blocksEveryoneElse: true }),
  Object.freeze({ id: 'spirit-path', kind: 'spirit', role: 'Loner', label: 'Veil Path', x: -6, z: 8, w: 6, h: 5, blocksEveryoneElse: true }),
]);

export const ENTITY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'river-pearl', type: 'relic', x: 12, z: 7, role: 'Collector', terrain: 'echo-water', label: 'River Pearl' }),
  Object.freeze({ id: 'drowned-idol', type: 'relic', x: 10, z: 5, role: 'Collector', terrain: 'echo-water', label: 'Drowned Idol' }),
  Object.freeze({ id: 'vault-amber', type: 'relic', x: 14, z: 8, role: 'Collector', terrain: 'echo-water', label: 'Vault Amber' }),
  Object.freeze({ id: 'hidden-cave-mouth', type: 'cave', x: -21, z: -11, role: 'Explorer', terrain: 'hidden-cave-clearing', feature: 'hidden-cave-appears', label: 'Hidden Cave' }),
  Object.freeze({ id: 'hidden-temple-entrance', type: 'temple-entrance', x: 20, z: -8, role: 'Explorer', terrain: 'temple-staircase-ground', feature: 'temple-staircase-uncovered', label: 'Hidden Temple Entrance' }),
  Object.freeze({ id: 'hidden-ruins-entrance', type: 'ruins-entrance', x: 6, z: -9, role: 'Explorer', terrain: 'forgotten-ruins-site', feature: 'forgotten-ruins-emerge', label: 'Buried Ruins Arch' }),
  Object.freeze({ id: 'sunken-temple-exit', type: 'temple-exit', x: 0, z: 13, zone: 'sunken-temple', label: 'Return Staircase' }),
  Object.freeze({ id: 'tideglass-shard-west', type: 'relic', x: -14, z: 0, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Western Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-north', type: 'relic', x: 0, z: -10, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Northern Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-east', type: 'relic', x: 14, z: 0, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Eastern Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-northwest', type: 'relic', x: -7, z: -11, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Northwest Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-northeast', type: 'relic', x: 7, z: -11, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Northeast Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-heart', type: 'relic', x: 0, z: 0, zone: 'sunken-temple', role: 'Collector', feature: 'sunken-temple-open', label: 'Heart Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-southwest', type: 'relic', x: -12, z: 9, role: 'Collector', feature: 'sunken-temple-open', label: 'Wayward Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-southeast', type: 'relic', x: 2, z: -7, role: 'Collector', feature: 'sunken-temple-open', label: 'Wayward Tideglass Shard' }),
  Object.freeze({ id: 'tideglass-shard-depths', type: 'relic', x: 17, z: 2, role: 'Collector', feature: 'sunken-temple-open', label: 'Wayward Tideglass Shard' }),
  Object.freeze({ id: 'guardian-shrine', type: 'shrine', x: 14, z: -2, role: 'Guardian', terrain: 'guardian-bridge', label: 'Awakened Shrine' }),
  Object.freeze({ id: 'spirit-portal', type: 'spirit-portal', x: -3, z: 10, role: 'Loner', terrain: 'spirit-path', label: 'Spirit Portal' }),
  Object.freeze({ id: 'explorer-waystone', type: 'waystone', x: -16, z: -10, role: 'Explorer', terrain: 'moss-trail', label: 'Trail Waystone', feature: 'hidden-cave' }),
  Object.freeze({ id: 'veil-mirror', type: 'veil-mirror', x: -1, z: 10, role: 'Loner', terrain: 'spirit-path', label: 'Veil Mirror', feature: 'spirit-realm' }),
  Object.freeze({ id: 'shadow-forest-gate', type: 'realm-portal', x: -20, z: 5, role: 'Loner', label: 'Shadow Forest Crossing', feature: 'shadow-forest' }),
  Object.freeze({ id: 'moon-shrine-gate', type: 'realm-portal', x: -9, z: 12, role: 'Loner', label: 'Moon Shrine', feature: 'moon-shrine' }),
  Object.freeze({ id: 'ghost-village-gate', type: 'realm-portal', x: -16, z: 11, role: 'Loner', label: 'Ghost Village', feature: 'ghost-village' }),
  Object.freeze({ id: 'final-altar', type: 'altar', x: 19, z: 9, role: 'Collector', label: 'Relic Altar', feature: 'ancient-temple' }),
  Object.freeze({ id: 'finale-entrance', type: 'finale-entrance', x: 16, z: 8, label: 'Ancient Temple Entrance', feature: 'ancient-temple' }),
  // This is deliberately beside the altar, on a walkable tile.  The former
  // position at (20, 10) was surrounded by collision tiles, making the final
  // Loner interaction impossible despite its 3.25-unit interaction radius.
  Object.freeze({ id: 'final-gate', type: 'final-gate', x: 19, z: 6, role: 'Loner', label: 'Final Gate', feature: 'final-gate' }),
  Object.freeze({ id: 'dark-cave-exit', type: 'cave-exit', x: 0, z: 12, zone: 'dark-cave', label: 'Forest Passage' }),
  Object.freeze({ id: 'gloom-shard-west', type: 'relic', x: -14, z: -2, zone: 'dark-cave', role: 'Collector', feature: 'dark-cave-open', label: 'Umbral Shard' }),
  Object.freeze({ id: 'gloom-shard-east', type: 'relic', x: 13, z: -3, zone: 'dark-cave', role: 'Collector', feature: 'dark-cave-open', label: 'Fossil Shard' }),
  Object.freeze({ id: 'hidden-ruins-exit', type: 'ruins-exit', x: 0, z: 12, zone: 'hidden-ruins', label: 'Sunlit Archway' }),
  Object.freeze({ id: 'sunstone-shard-west', type: 'relic', x: -12, z: 5, zone: 'hidden-ruins', role: 'Collector', feature: 'hidden-ruins-open', label: 'Western Sunstone Shard' }),
  Object.freeze({ id: 'sunstone-shard-east', type: 'relic', x: 12, z: 5, zone: 'hidden-ruins', role: 'Collector', feature: 'hidden-ruins-open', label: 'Eastern Sunstone Shard' }),
  Object.freeze({ id: 'sunstone-shard-crown', type: 'relic', x: 0, z: -11, zone: 'hidden-ruins', role: 'Collector', feature: 'hidden-ruins-open', label: 'Crown Sunstone Shard' }),
]);

export const EVOLUTION_LIBRARY = Object.freeze({
  Explorer: Object.freeze([
    Object.freeze(['hidden-cave-appears', 'Stone and ivy part: a hidden cave has appeared in the western forest.']),
    Object.freeze(['temple-staircase-uncovered', 'Roots withdraw from weathered stone: the temple staircase is uncovered.']),
    Object.freeze(['forgotten-ruins-emerge', 'The sand exhales around a broken arch: forgotten ruins have emerged.']),
  ]),
  Collector: Object.freeze([Object.freeze(['relic-vault', 'The Collector has learned the language of the Echo Water relics.'])]),
  Guardian: Object.freeze([Object.freeze(['healing-shrine', 'The Guardian has awakened the shrine beyond the Warden Bridge.'])]),
  Loner: Object.freeze([
    Object.freeze(['spirit-realm', 'The Loner can now read the paths behind the veil.']),
    Object.freeze(['shadow-forest', 'The Loner sees a second forest growing beneath the first.']),
    Object.freeze(['moon-shrine', 'Moon-white stones emerge where only the Loner can follow them.']),
    Object.freeze(['ghost-village', 'A village of echoes appears at the edge of the shared world.']),
  ]),
});

// Compatibility data for the alternate dynamic-finale composition module.
// The active game uses the newer Temple finale, but this immutable catalogue
// keeps the standalone composition system independently runnable and reviewable.
const worldEvolution = (id, archetype, title, feature, x, z) => Object.freeze({
  id, archetype, title, feature,
  entity: Object.freeze({ id: `evolution-${id}`, type: 'world-evolution', x, z, role: archetype, feature, label: title, interaction: 'explore-evolution' }),
});
export const WORLD_EVOLUTIONS = Object.freeze([
  worldEvolution('hidden-cave-appears', 'Explorer', 'Hidden Cave', 'hidden-cave', -22, -10),
  worldEvolution('forgotten-ruins-emerge', 'Explorer', 'Forgotten Ruins', 'forgotten-ruins', -14, -7),
  worldEvolution('crystal-mine-awakens', 'Collector', 'Crystal Mine', 'crystal-mine', 12, 7),
  worldEvolution('healing-shrine-awakens', 'Guardian', 'Healing Shrine', 'healing-shrine', 14, -2),
  worldEvolution('spirit-portal-opens', 'Loner', 'Spirit Portal', 'spirit-realm', -3, 10),
]);

// Client input is translated through this single lookup.  When adding a new
// interaction, update this mapping and the server's expected action together.
export const ENTITY_ACTIONS = Object.freeze({
  'hidden-cave-mouth': 'enter-dark-cave',
  'dark-cave-exit': 'exit-dark-cave',
  'hidden-temple-entrance': 'enter-sunken-temple',
  'sunken-temple-exit': 'exit-sunken-temple',
  'hidden-ruins-entrance': 'enter-hidden-ruins',
  'hidden-ruins-exit': 'exit-hidden-ruins',
  'guardian-shrine': 'activate-shrine',
  'spirit-portal': 'enter-spirit-realm',
  'final-altar': 'offer-relics',
  'final-gate': 'open-final-gate',
  'explorer-waystone': 'trace-waystone',
  'veil-mirror': 'read-veil',
  'shadow-forest-gate': 'enter-shadow-forest',
  'moon-shrine-gate': 'enter-moon-shrine',
  'ghost-village-gate': 'enter-ghost-village',
  'finale-entrance': 'enter-final-temple',
  'guardian-portal-1': 'enter-guardian-portal',
  'guardian-portal-2': 'enter-guardian-portal',
  'temple-pillar': 'activate-temple-pillar',
});

// Used only if a client receives an older server snapshot without `entities`.
const entityById = (id) => ENTITY_DEFINITIONS.find((entity) => entity.id === id);
export const FEATURE_FALLBACK_ENTITIES = Object.freeze({
  'hidden-cave-appears': entityById('hidden-cave-mouth'),
  'temple-staircase-uncovered': entityById('hidden-temple-entrance'),
  'forgotten-ruins-emerge': entityById('hidden-ruins-entrance'),
  'hidden-cave': entityById('hidden-cave-mouth'),
  'relic-vault': entityById('river-pearl'),
  'healing-shrine': entityById('guardian-shrine'),
  'spirit-realm': entityById('spirit-portal'),
  'ancient-temple': entityById('final-altar'),
  'final-gate': entityById('final-gate'),
});
