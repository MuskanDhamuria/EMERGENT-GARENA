// Loner realm coordinator. Individual realm rules remain in their own modules;
// this is the only adapter the shared game world needs to know about.
import { createDungeonSystem } from './dungeon-system.mjs';
import { createGhostVillageSystem } from './ghost-village-system.mjs';
import { createMoonShrineSystem } from './moon-shrine-system.mjs';
import { createShadowForestSystem } from './shadow-forest-system.mjs';

const ENTRY_BY_FEATURE = Object.freeze({
  'spirit-realm': 'dungeon',
  'shadow-forest': 'shadow-forest',
  'moon-shrine': 'moon-shrine',
  'ghost-village': 'ghost-village',
});

export function createRealmSystem(world) {
  const systems = Object.freeze({
    dungeon: createDungeonSystem(world),
    'shadow-forest': createShadowForestSystem(world),
    'moon-shrine': createMoonShrineSystem(world),
    'ghost-village': createGhostVillageSystem(world),
  });

  function enter(room, player, feature) {
    const realm = ENTRY_BY_FEATURE[feature], system = systems[realm];
    if (!system) return { ok: false, error: 'That realm has no authored entry.' };
    return system.enter(room, player);
  }

  function interact(room, player, action, targetId, intent = {}) {
    if (action === 'ghost-village-aim') return systems['ghost-village'].shoot(room, player, { x: Number(intent.aimX), z: Number(intent.aimZ) });
    if (player.realm === 'dungeon' && action.startsWith('dungeon-')) return systems.dungeon.interact(room, player, action, targetId);
    if (player.realm === 'shadow-forest' && action === 'exit-shadow-forest') return systems['shadow-forest'].exit(room, player);
    if (player.realm === 'moon-shrine' && action === 'moon-shrine-interact') return systems['moon-shrine'].interact(room, player);
    return null;
  }

  function tick(room, player, delta) {
    const system = systems[player.realm];
    if (system?.tick) system.tick(room, player, delta);
  }

  function move(player, x, z) {
    return player.realm === 'dungeon' ? systems.dungeon.canEnter(x, z) : true;
  }

  function entities(player) {
    if (player.realm === 'dungeon') return systems.dungeon.entities(player);
    if (player.realm === 'shadow-forest') return [{ id: 'shadow-forest-exit', type: 'realm-exit', tileX: 22.5, tileY: 5, label: 'Forgotten Trophy', action: 'exit-shadow-forest' }];
    if (player.realm === 'moon-shrine') return [{ id: 'moon-shrine-altar', type: 'realm-altar', tileX: 28, tileY: 5, label: 'Moon Shrine Altar', action: 'moon-shrine-interact' }];
    return [];
  }

  function snapshot(player) {
    return {
      realm: player.realm || 'overworld',
      dungeon: player.dungeon,
      shadowForest: player.shadowForest,
      moonShrine: player.moonShrine,
      ghostVillage: player.ghostVillage,
    };
  }

  return Object.freeze({ enter, interact, tick, move, entities, snapshot, realmForFeature: (feature) => ENTRY_BY_FEATURE[feature] || null });
}
