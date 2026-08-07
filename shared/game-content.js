// Shared, browser-safe game content.  Change this file when designing roles,
// world gates, collectible placement, or a finale action.  Neither the client
// nor the server should define a second version of these rules.

export const MAX_PLAYERS = 4;
export const OBSERVATION_MS = 30_000;

export const ARCHETYPES = Object.freeze(['Explorer', 'Collector', 'Guardian', 'Loner']);

export const ROLE_ABILITIES = Object.freeze({
  Explorer: Object.freeze(['hidden-paths', 'temple-sight']),
  Collector: Object.freeze(['water-travel', 'relic-lore']),
  Guardian: Object.freeze(['bridge-ward', 'shrine-rite']),
  Loner: Object.freeze(['spirit-sight', 'spirit-walk']),
});

export const FEATURES = new Set([
  'hidden-cave', 'secret-path', 'invisible-bridge', 'forgotten-ruins',
  'relic-vault', 'evolving-artifacts', 'treasure-cache', 'healing-shrine',
  'protective-barrier', 'revival-monument', 'spirit-realm', 'illusion-passage',
  'hidden-portal', 'ancient-temple', 'final-gate',
]);

// Coordinates are server-world coordinates.  The browser converts them to map
// tiles by adding (30, 17), keeping placement data independent of the camera.
export const TERRAIN_OVERLAYS = Object.freeze([
  Object.freeze({ id: 'echo-water', kind: 'water', role: 'Collector', label: 'Echo Water', x: 8, z: 4, w: 8, h: 6, blocksEveryoneElse: true }),
  Object.freeze({ id: 'moss-trail', kind: 'hidden-path', role: 'Explorer', label: 'Moss Trail', x: -22, z: -11, w: 6, h: 4, blocksEveryoneElse: true }),
  Object.freeze({ id: 'guardian-bridge', kind: 'bridge', role: 'Guardian', label: 'Warden Bridge', x: 9, z: -3, w: 7, h: 2, blocksEveryoneElse: true }),
  Object.freeze({ id: 'spirit-path', kind: 'spirit', role: 'Loner', label: 'Veil Path', x: -6, z: 8, w: 6, h: 5, blocksEveryoneElse: true }),
]);

export const ENTITY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'river-pearl', type: 'relic', x: 12, z: 7, role: 'Collector', terrain: 'echo-water', label: 'River Pearl' }),
  Object.freeze({ id: 'drowned-idol', type: 'relic', x: 10, z: 5, role: 'Collector', terrain: 'echo-water', label: 'Drowned Idol' }),
  Object.freeze({ id: 'vault-amber', type: 'relic', x: 14, z: 8, role: 'Collector', terrain: 'echo-water', label: 'Vault Amber' }),
  Object.freeze({ id: 'hidden-temple-entrance', type: 'temple-entrance', x: -19, z: -9, role: 'Explorer', terrain: 'moss-trail', label: 'Hidden Temple Entrance' }),
  Object.freeze({ id: 'guardian-shrine', type: 'shrine', x: 14, z: -2, role: 'Guardian', terrain: 'guardian-bridge', label: 'Awakened Shrine' }),
  Object.freeze({ id: 'spirit-portal', type: 'spirit-portal', x: -3, z: 10, role: 'Loner', terrain: 'spirit-path', label: 'Spirit Portal' }),
  Object.freeze({ id: 'explorer-waystone', type: 'waystone', x: -16, z: -10, role: 'Explorer', terrain: 'moss-trail', label: 'Trail Waystone', feature: 'hidden-cave' }),
  Object.freeze({ id: 'veil-mirror', type: 'veil-mirror', x: -1, z: 10, role: 'Loner', terrain: 'spirit-path', label: 'Veil Mirror', feature: 'spirit-realm' }),
  Object.freeze({ id: 'final-altar', type: 'altar', x: 19, z: 9, role: 'Collector', label: 'Relic Altar', feature: 'ancient-temple' }),
  // This is deliberately beside the altar, on a walkable tile.  The former
  // position at (20, 10) was surrounded by collision tiles, making the final
  // Loner interaction impossible despite its 3.25-unit interaction radius.
  Object.freeze({ id: 'final-gate', type: 'final-gate', x: 19, z: 6, role: 'Loner', label: 'Final Gate', feature: 'final-gate' }),
]);

export const EVOLUTION_LIBRARY = Object.freeze({
  Explorer: Object.freeze([Object.freeze(['hidden-cave', 'The Explorer has mapped the Moss Trail and revealed the temple entrance.'])]),
  Collector: Object.freeze([Object.freeze(['relic-vault', 'The Collector has learned the language of the Echo Water relics.'])]),
  Guardian: Object.freeze([Object.freeze(['healing-shrine', 'The Guardian has awakened the shrine beyond the Warden Bridge.'])]),
  Loner: Object.freeze([Object.freeze(['spirit-realm', 'The Loner can now read the paths behind the veil.'])]),
});

// Client input is translated through this single lookup.  When adding a new
// interaction, update this mapping and the server's expected action together.
export const ENTITY_ACTIONS = Object.freeze({
  'hidden-temple-entrance': 'discover-temple',
  'guardian-shrine': 'activate-shrine',
  'spirit-portal': 'enter-spirit-realm',
  'final-altar': 'offer-relics',
  'final-gate': 'open-final-gate',
  'explorer-waystone': 'trace-waystone',
  'veil-mirror': 'read-veil',
  'guardian-portal-1': 'enter-guardian-portal',
  'guardian-portal-2': 'enter-guardian-portal',
  'temple-pillar': 'activate-temple-pillar',
});

// Used only if a client receives an older server snapshot without `entities`.
export const FEATURE_FALLBACK_ENTITIES = Object.freeze({
  'hidden-cave': ENTITY_DEFINITIONS[3],
  'relic-vault': ENTITY_DEFINITIONS[0],
  'healing-shrine': ENTITY_DEFINITIONS[4],
  'spirit-realm': ENTITY_DEFINITIONS[5],
  'ancient-temple': ENTITY_DEFINITIONS[6],
  'final-gate': ENTITY_DEFINITIONS[7],
});
