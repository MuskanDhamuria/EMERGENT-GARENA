// Shared, browser-safe game content.  Change this file when designing roles,
// world gates, collectible placement, or a finale action.  Neither the client
// nor the server should define a second version of these rules.

export const MAX_PLAYERS = 4;
export const OBSERVATION_MS = 30_000;

export const ARCHETYPES = Object.freeze(['Explorer', 'Collector', 'Guardian', 'Loner']);

export const ROLE_ABILITIES = Object.freeze({
  Explorer: Object.freeze(['hidden-paths', 'temple-sight']),
  Collector: Object.freeze(['water-travel', 'relic-lore', 'relic-sense', 'object-appraisal']),
  Guardian: Object.freeze(['bridge-ward', 'shrine-rite']),
  Loner: Object.freeze(['spirit-sight', 'spirit-walk']),
});

export const FEATURES = new Set([
  'hidden-cave', 'secret-path', 'invisible-bridge', 'forgotten-ruins',
  'relic-vault', 'evolving-artifacts', 'treasure-cache', 'healing-shrine',
  'protective-barrier', 'revival-monument', 'spirit-realm', 'illusion-passage',
  'hidden-portal', 'ancient-temple', 'final-gate',
  'hidden-forest-path', 'ancient-observatory', 'temple-staircase',
  'crystal-mine', 'ancient-vault', 'relic-forge', 'sunken-relic',
  'sacred-tree', 'ancient-bell', 'sanctuary', 'illusion-walls',
  'ghost-village', 'shadow-forest', 'moon-shrine',
]);

// These are possibilities, not a sequence. The Game Master chooses any unused
// entry whose archetype exists, using post-assignment behaviour as evidence.
const evolution = (id, archetype, title, feature, x, z, narration) => Object.freeze({
  id, archetype, title, feature, narration,
  entity: Object.freeze({ id: `evolution-${id}`, type: 'world-evolution', x, z, role: archetype, feature, label: title, interaction: 'explore-evolution' }),
});
export const WORLD_EVOLUTION_LIBRARY = Object.freeze({
  Explorer: Object.freeze([
    evolution('hidden-cave-appears','Explorer','Hidden Cave','hidden-cave',-22,-10,'I have watched curiosity pull at every boundary. The northern roots loosen. A hidden cave exhales its first breath in centuries.'),
    evolution('forgotten-ruins-emerge','Explorer','Forgotten Ruins','forgotten-ruins',-14,-7,'Your footsteps keep returning to forgotten ground. Stone answers stone. Ruins rise through the moss.'),
    evolution('hidden-forest-path-opens','Explorer','Hidden Forest Path','hidden-forest-path',-18,-3,'No thicket has turned you aside. The forest remembers that courage. A path parts beneath the oldest branches.'),
    evolution('observatory-revealed','Explorer','Ancient Observatory','ancient-observatory',-10,-12,'You kept looking beyond the road. Above the sleeping trees, old brass catches the light. An observatory remembers the sky.'),
    evolution('temple-staircase-uncovered','Explorer','Temple Staircase','temple-staircase',18,8,'The buried stones have felt your searching steps. Vines retreat from a descending stair. The temple offers a way forward.'),
  ]),
  Collector: Object.freeze([
    evolution('crystal-mine-awakens','Collector','Crystal Mine','crystal-mine',-10,-10,'Every small treasure has held your attention. Deep crystal answers that care. The mountain mine begins to glow.'),
    evolution('ancient-vault-unlocks','Collector','Ancient Vault','ancient-vault',14,9,'You have treated each relic as a memory, not a prize. Ancient locks turn beneath the earth. The vault opens one watchful eye.'),
    evolution('treasure-cache-appears','Collector','Treasure Cache','treasure-cache',5,10,'Nothing discarded has escaped your notice. The riverbank gives up its secret. A weathered cache appears among the reeds.'),
    evolution('relic-forge-activates','Collector','Relic Forge','relic-forge',11,-5,'The relics hum when you draw near. A cold furnace takes a breath. The old forge waits for worthy hands.'),
    evolution('sunken-relic-emerges','Collector','Sunken Relic','sunken-relic',12,7,'The lake has measured your patience. Its glassy surface breaks without a wave. A sunken relic rises into the light.'),
  ]),
  Guardian: Object.freeze([
    evolution('healing-shrine-awakens','Guardian','Healing Shrine','healing-shrine',14,-2,'I have seen you remain when others wandered. Warmth returns to weathered stone. The healing shrine awakens.'),
    evolution('sacred-tree-blooms','Guardian','Sacred Tree','sacred-tree',7,-8,'You have made safety wherever you stood. The oldest tree feels that promise. Silver blossoms open all at once.'),
    evolution('protective-barrier-appears','Guardian','Protective Barrier','protective-barrier',2,3,'Again and again, you placed yourself between danger and another. The valley has learned your shape. A protective ward rises.'),
    evolution('ancient-bell-activates','Guardian','Ancient Bell','ancient-bell',16,-6,'Your watchfulness has not gone unheard. Bronze stirs in the ruined tower. The ancient bell sounds once.'),
    evolution('sanctuary-opens','Guardian','Sanctuary','sanctuary',19,2,'The road behind you has become gentler for everyone. Sealed doors recognize their keeper. The sanctuary opens.'),
  ]),
  Loner: Object.freeze([
    evolution('spirit-portal-opens','Loner','Spirit Portal','spirit-realm',-3,10,'You listened where the others heard only silence. The veil bends toward you. A spirit portal opens between two breaths.'),
    evolution('illusion-walls-fade','Loner','Faded Illusion Walls','illusion-walls',-8,7,'Solitude taught you which walls were only stories. Their edges flicker and fail. A passage remains.'),
    evolution('ghost-village-appears','Loner','Ghost Village','ghost-village',-16,11,'You carried silence without fearing it. Pale lanterns answer from an empty field. A village of echoes becomes visible.'),
    evolution('shadow-forest-awakens','Loner','Shadow Forest','shadow-forest',-20,5,'The dim paths know your unaccompanied steps. Shadows gather without menace. Another forest wakes beneath this one.'),
    evolution('moon-shrine-visible','Loner','Moon Shrine','moon-shrine',-9,12,'You noticed the light that daylight hides. Moon-white stones emerge from the mist. A shrine waits in quiet recognition.'),
  ]),
});

export const WORLD_EVOLUTIONS = Object.freeze(Object.values(WORLD_EVOLUTION_LIBRARY).flat());

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
  ...Object.fromEntries(WORLD_EVOLUTIONS.map((item) => [item.entity.id, 'explore-evolution'])),
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
