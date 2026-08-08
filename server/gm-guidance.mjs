// Contextual, player-scoped narration. These are authored guardrails for a
// first playthrough, not quests: the Game Master only speaks when a player's
// current space exposes a new verb or rule.

const ROLE_GUIDANCE = Object.freeze({
  Explorer: 'Explorer: uncover entrances and press E beside them.',
  Collector: 'Collector: claim glowing relics with E.',
  Guardian: 'Guardian: enter sanctums with E and protect their wards.',
  Loner: 'Loner: purple paths answer you. Press E to enter.',
});

const EVOLUTION_GUIDANCE = Object.freeze({
  'hidden-cave-appears': 'Hidden Cave found. Enter with E; strike demons with SPACE.',
  'temple-staircase-uncovered': 'Sunken Temple found. Gather there and press E.',
  'forgotten-ruins-emerge': 'Forgotten Ruins found. Press E; defeat mummies with SPACE.',
  'relic-vault': 'Glowing relics can be claimed with E.',
  'healing-shrine': 'Guardian sanctums are open. Enter a portal with E.',
  'spirit-realm': 'A purple portal is open. Press E beside it.',
  'shadow-forest': 'Move right, jump with W, and reach the trophy.',
  'moon-shrine': 'Follow the silver line. Press E at the altar.',
  'ghost-village': 'Click toward ghosts. Catch all six echoes to return.',
});

const TRIAL_GUIDANCE = Object.freeze({
  'wardkeepers-circuit': 'Clear each spirit with SPACE, then awaken Root, Brook, Sky with E.',
  'lost-lanterns': 'Clear wisps with SPACE. Carry each lantern to the hearth with E.',
  'shelter-march': 'Clear spirits, start the gate with E, then reach each marker.',
  'shrine-of-return': 'Clear spirits, then hold still while each ward cleanses.',
});

const EXPEDITION_GUIDANCE = Object.freeze({
  'dark-cave': 'Defeat nearby demons with SPACE. Then claim shards with E.',
  'sunken-temple': 'Explore together. The Collector claims Tideglass with E.',
  'hidden-ruins': 'Defeat nearby mummies with SPACE. Then claim Sunstones with E.',
});

const REALM_GUIDANCE = Object.freeze({
  dungeon: 'Press E repeatedly at wardens, collect seals, then return.',
  'shadow-forest': 'Move right, jump with W, and reach the trophy.',
  'moon-shrine': 'Stay on the silver line and press E at the altar.',
  'ghost-village': 'Click toward ghosts. Catch all six to leave.',
});

export function createGameMasterGuidance({ event, now = () => Date.now() } = {}) {
  if (typeof event !== 'function') throw new Error('Game Master guidance requires the authoritative event function.');

  function speak(room, player, id, message) {
    if (!room || !player || !message) return null;
    player.guidanceSeen ||= new Set();
    if (player.guidanceSeen.has(id)) return null;
    player.guidanceSeen.add(id);
    player.guidance = { id, message, at: now() };
    return event(room, 'gm-guidance', message, { privateTo: player.id, playerId: player.id, guidanceId: id, at: player.guidance.at });
  }

  return Object.freeze({
    introduce(room, players) {
      return players.map((player) => speak(room, player, 'first-steps', 'I will watch before I name you. Move with WASD or the arrow keys. Explore together or apart, and press E beside a glowing object. There is no fixed quest.')).filter(Boolean);
    },
    roleAwakened: (room, player) => speak(room, player, `role:${player.archetype}`, ROLE_GUIDANCE[player.archetype]),
    evolutionAwakened: (room, player, feature) => speak(room, player, `evolution:${feature}`, EVOLUTION_GUIDANCE[feature]),
    guardianTrialEntered: (room, player, trialId) => speak(room, player, `guardian-trial:${trialId}`, TRIAL_GUIDANCE[trialId]),
    expeditionEntered: (room, player, expeditionId) => speak(room, player, `expedition:${expeditionId}`, EXPEDITION_GUIDANCE[expeditionId]),
    realmEntered: (room, player, realmId) => speak(room, player, `realm:${realmId}`, REALM_GUIDANCE[realmId]),
    templeOpened: (room, player) => speak(room, player, 'ancient-temple', 'Find your court. When all four arrive, press E at your pillar.'),
  });
}
