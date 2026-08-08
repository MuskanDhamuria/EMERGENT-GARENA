// Contextual, player-scoped narration. These are authored guardrails for a
// first playthrough, not quests: the Game Master only speaks when a player's
// current space exposes a new verb or rule.

const ROLE_GUIDANCE = Object.freeze({
  Explorer: 'I watched your curiosity. You are the Explorer. Follow newly revealed landmarks; when you reach an entrance, press E to lead the way through.',
  Collector: 'You keep finding value in abandoned things. You are the Collector. Walk beside a glowing relic and press E; your finds can change what the group needs.',
  Guardian: 'You make room for others to breathe. You are the Guardian. When a sanctuary portal appears, stand beside it and press E. Inside, protect each ward I reveal.',
  Loner: 'You listened where the others passed by. You are the Loner. Purple paths and portals answer only you. Stand beside one and press E, then trust the rule I give you there.',
});

const EVOLUTION_GUIDANCE = Object.freeze({
  'hidden-cave-appears': 'I parted ivy in the western forest. Find the Hidden Cave and press E at its mouth; once inside, stay close to a foe and press SPACE to strike.',
  'temple-staircase-uncovered': 'I uncovered stairs near the lake. Lead the group to the Sunken Temple entrance, then press E. Tide Wardens only yield when you are close enough to strike with SPACE.',
  'forgotten-ruins-emerge': 'I uncovered a buried arch. Find the Forgotten Ruins and press E; clear the mummy wardens with SPACE before the relics can be claimed.',
  'relic-vault': 'The relics have begun answering you. Follow their glow, press E to collect them, and remember where you found each one.',
  'healing-shrine': 'I raised two Guardian sanctums near the bridge. Enter either glowing portal with E. I will teach that sanctuary\'s rule once you cross its threshold.',
  'spirit-realm': 'I opened a private way through the veil. Follow the purple portal that only you can see and press E when you reach it.',
  'shadow-forest': 'The Shadow Forest has turned sideways. Move right and use W or Up to leap; avoid the traps and press E beside the forgotten trophy.',
  'moon-shrine': 'A silver route leads to the Moon Shrine. Stay on its line exactly; a misstep returns you to the start. Press E at the altar only after every turn is remembered.',
  'ghost-village': 'The Ghost Village answers your spirit shard. Click toward a moving ghost to throw it; catch all six echoes to return.',
});

const TRIAL_GUIDANCE = Object.freeze({
  'wardkeepers-circuit': 'Begin at the Root Ward. Stand near its purple spirit and press SPACE until it fades, then press E at the ward. Restore Root, Brook, then Sky in that order.',
  'lost-lanterns': 'Banish a camp wisp with SPACE, then press E to carry its lantern. Take one flame at a time to the Hearth Guardian and press E. A Flame Hunter can knock the flame loose.',
  'shelter-march': 'Banish the spirit beside each marker with SPACE. Press E at the Pass Gate to start the blessing, then reach Watch Stone and Shelter Gate before its light expires.',
  'shrine-of-return': 'Banish each purple spirit with SPACE. Press E at a ward to begin cleansing, then do not move until its ring completes. Cleanse three wards before the Return Shrine.',
});

const EXPEDITION_GUIDANCE = Object.freeze({
  'dark-cave': 'The Black Hollow is hostile. Stay near a demon and press SPACE to strike. When the room is safe, the Collector can gather its shards with E.',
  'sunken-temple': 'The Tide Wardens guard this hall. Stay near one and press SPACE to strike. Once all fall, the Collector may recover Tideglass with E.',
  'hidden-ruins': 'The mummy wardens guard these pillars. Stand close and press SPACE to strike. When both collapse, the Sunstones can be claimed with E.',
});

const REALM_GUIDANCE = Object.freeze({
  dungeon: 'Three wardens block the Veil Altar. Stand beside a warden and press E repeatedly, then collect the three seals with E. Awaken the altar and take the return portal.',
  'shadow-forest': 'The forest has become a side-on crossing. Move right and use W or Up to leap; avoid thorns, fire, and the saw before pressing E at the trophy.',
  'moon-shrine': 'Follow the silver route without stepping away from it. Each correct turn is remembered; press E only when you reach the distant altar.',
  'ghost-village': 'Six ghosts are moving through the library. Click in a ghost\'s direction to throw your spirit shard. Catch all six to leave the village.',
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
    templeOpened: (room, player) => speak(room, player, 'ancient-temple', 'Four courts are waiting. Walk to the court bearing your calling. When every bearer is standing at their pillar, each player presses E to awaken it.'),
  });
}
