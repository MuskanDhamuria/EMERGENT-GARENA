// Contextual, player-scoped narration. These are authored guardrails for a
// first playthrough, not fixed quests: the Game Master speaks privately only
// when a player's current role, realm, or puzzle reveals a useful new verb.

const ROLE_GUIDANCE = Object.freeze({
  Explorer: 'I saw you testing the edges of Emergent. You are the Explorer. Follow unusual terrain, uncover entrances, and press E beside a landmark once you reach it.',
  Collector: 'I saw what you chose to keep. You are the Collector. Your relics reveal a pair of personal rites; their clues and answers are yours alone to read.',
  Guardian: 'I saw you remain when others moved on. You are the Guardian. Enter a sanctum with E, protect its wards with SPACE, then restore each marked objective with E.',
  Loner: 'I saw you listen at the edge of the group. You are the Loner. Purple paths answer only you; step into a portal with E and trust the signs hidden in the veil.',
});

const EVOLUTION_GUIDANCE = Object.freeze({
  'hidden-cave-appears': 'A crack has opened in the northern forest. Find the Hidden Cave entrance and press E. Inside Black Hollow, use SPACE near demons and collect the shards they guarded.',
  'temple-staircase-uncovered': 'The water has lowered around an old stair. Gather at the Sunken Temple entrance and press E. It is a quiet exploration space: the Explorer can recover Tideglass with E.',
  'forgotten-ruins-emerge': 'A buried arch has surfaced in the east. Press E at the Forgotten Ruins entrance. Mummies guard its Sunstones; move close and use SPACE before collecting them with E.',
  'relic-vault': 'A relic rite has taken shape from your habits. Read the private instructions I send you, gather any required clues, then press E at its landmark to begin.',
  'healing-shrine': 'Guardian sanctums have opened. Stand beside a portal and press E. Each trial has its own rule—watch the objective text, protect the wards, and restore the marked sites.',
  'spirit-realm': 'The Veil Portal is visible to you. Press E beside it. Your separate realm still affects the shared story, and I will warn you if you linger where movement matters.',
  'shadow-forest': 'The Shadow Forest is a side-scrolling spirit route. Move right, use W to jump, and reach the trophy before returning to Emergent.',
  'moon-shrine': 'Moonlight has drawn a narrow silver route. Stay on the line, then press E at the altar when you reach it.',
  'ghost-village': 'The Haunted Library has awakened. Follow the aiming path and click toward each echo to catch all six before the veil closes.',
});

const TRIAL_GUIDANCE = Object.freeze({
  'wardkeepers-circuit': 'Three wards need a steady Guardian. Use SPACE to clear nearby spirits, then restore Root, Brook, and Sky with E in the order the trial reveals.',
  'lost-lanterns': 'Clear nearby wisps with SPACE. Bring each found lantern to the hearth with E; the hearth will tell you how many are still missing.',
  'shelter-march': 'Keep the group safe. Clear spirits with SPACE, begin the gate with E, then move through every rescue marker before the route fades.',
  'shrine-of-return': 'The shrine rewards patience. Clear the spirits, then remain on each ward long enough for its cleansing light to finish.',
});

const EXPEDITION_GUIDANCE = Object.freeze({
  'dark-cave': 'Black Hollow is hostile: approach a demon, press SPACE, and once the party clears the threat let the Explorer claim its Gloom shards with E.',
  'sunken-temple': 'The Sunken Temple is peaceful. Explore its flooded rooms together; the Explorer alone can claim Tideglass relics with E.',
  'hidden-ruins': 'The Hidden Ruins are guarded. Move close to a mummy, use SPACE until it falls, and then let the Explorer claim the Sunstones with E.',
});

const REALM_GUIDANCE = Object.freeze({
  dungeon: 'In the Spirit Realm, press E repeatedly beside wardens until they yield, collect their seals with E, and find the exit when the last answer is revealed.',
  'shadow-forest': 'Keep moving right through the Shadow Forest. W jumps; the trophy at the far end is the way home.',
  'moon-shrine': 'The silver line is safe. Step off it and the shrine returns you to the previous point, so take each corner carefully.',
  'ghost-village': 'Aim with the mouse and follow the visible arc, then click toward a ghost. Each echo needs a direct hit.',
});

const COLLECTOR_TRIAL_GUIDANCE = Object.freeze({
  'crystal-mine': 'I chose this because you returned to overlooked objects. Find all five glowing crystal fractures first, excavate each with E, then rebuild the Crystal Heart at the mine.',
  'ancient-vault': 'I chose this because you travelled far. Gather the four carved clue scrolls, then enter the rune order at the Ancient Vault.',
  'treasure-cache': 'I chose this because you noticed varied relics. Read every appraisal clue, then identify exactly the three genuine objects in the cache.',
  'relic-forge': 'I chose this because you worked close to others. Read the forge notes, assemble the balanced recipe, hold orange heat, strike the marked pattern, then quench in oil. Allies can pump the bellows.',
  'sunken-relic': 'I chose this because you travelled boldly. Read the current clues and steer through the flooded passages to the Sunken Crown without fighting the water.',
});

const COLLECTOR_TITLES = Object.freeze({
  'crystal-mine': 'Crystal Heart',
  'ancient-vault': 'Ancient Vault',
  'treasure-cache': 'Treasure Cache',
  'relic-forge': 'Relic Forge',
  'sunken-relic': 'Sunken Crown',
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
      return players.map((player) => speak(room, player, 'first-steps', 'For forty seconds, I watch. Move with WASD or the arrow keys. Explore together or apart, and press E beside what answers. There is no fixed quest. Your choices decide what this world becomes.')).filter(Boolean);
    },
    roleAwakened: (room, player) => speak(room, player, `role:${player.archetype}`, ROLE_GUIDANCE[player.archetype]),
    evolutionAwakened: (room, player, feature) => speak(room, player, `evolution:${feature}`, EVOLUTION_GUIDANCE[feature]),
    guardianTrialEntered: (room, player, trialId) => speak(room, player, `guardian-trial:${trialId}`, TRIAL_GUIDANCE[trialId]),
    expeditionEntered: (room, player, expeditionId) => speak(room, player, `expedition:${expeditionId}`, EXPEDITION_GUIDANCE[expeditionId]),
    realmEntered: (room, player, realmId) => speak(room, player, `realm:${realmId}`, REALM_GUIDANCE[realmId]),
    collectorPlan(room, player, plan) {
      const first = plan?.plan?.[0], second = plan?.plan?.[1];
      if (!first) return null;
      const firstTitle = COLLECTOR_TITLES[first] || first;
      const secondTitle = COLLECTOR_TITLES[second] || second;
      return speak(room, player, 'collector-plan', `I watched how you gathered, travelled, and stayed near the party. I have shaped two relic rites for you: ${firstTitle}, then ${secondTitle}. The first will emerge when your calling evolves.`);
    },
    collectorTrial: (room, player, challenge) => challenge && speak(room, player, `collector-trial:${challenge.feature}`, COLLECTOR_TRIAL_GUIDANCE[challenge.feature] || challenge.instruction),
    collectorStarted: (room, player, feature) => speak(room, player, `collector-started:${feature}`, `The ${COLLECTOR_TITLES[feature] || feature} is listening. Complete its rule carefully; I am still observing the choices you make inside it.`),
    collectorCompleted(room, player, feature, completed, total) {
      const remaining = Math.max(0, Number(total || 0) - Number(completed || 0));
      const next = remaining ? ' A second rite will now emerge from your story.' : ' Both of your selected relic rites are complete; your answer will matter at the final altar.';
      return speak(room, player, `collector-completed:${feature}`, `You completed the ${COLLECTOR_TITLES[feature] || feature}.${next}`);
    },
    templeOpened: (room, player) => speak(room, player, 'ancient-temple', 'Find the court marked with your calling. The screen separates so every player can reach their own pillar; press E only when you are standing at it.'),
    lanternRiteEntered(room, player, rite) {
      const waves = rite?.plan?.waveCount || rite?.waveCount || 3;
      const guardianNote = player.archetype === 'Guardian' ? ' During the defense, target a nearby ally with Q to heal or R to raise a barrier.' : '';
      return speak(room, player, 'lantern-rite', `The Game Master shaped a Lantern Rite around this party. Step to the glowing threshold and press E; all four must enter before ${waves} adaptive waves begin.${guardianNote}`);
    },
    finaleVariantEntered(room, player, variant, rite) {
      if (variant?.id === 'echo_accord') {
        const roleNote = {
          Explorer: 'Read the arena edge before committing to a turn; your route is the first warning the group receives.',
          Collector: 'Gather scattered light to lengthen your echo, but do not let a tempting orb trap your trail.',
          Guardian: 'Watch the other trails and call danger early; steady choices keep the echoes from colliding.',
          Loner: 'Your instinct for empty space matters here. Keep a route open when the arena becomes crowded.',
        }[player.archetype] || 'Keep a living route open.';
        return speak(room, player, 'echo-accord', `The Game Master chose the Echo Accord from how this group moved apart. ${roleNote}`);
      }
      const waves = rite?.plan?.waveCount || rite?.waveCount || 3;
      const roleNote = {
        Explorer: 'Scout the corridors and call out incoming raiders before they reach the core.',
        Collector: 'Stay alert between waves: the core needs deliberate repairs before the next assault.',
        Guardian: 'During the defense, target a nearby ally with Q to heal or R to raise a barrier.',
        Loner: 'Circle the outer paths and intercept threats that slip past the group.',
      }[player.archetype] || '';
      const title = variant?.title || 'Lantern Rite';
      return speak(room, player, `finale:${variant?.id || 'lantern_rite'}`, `The Game Master shaped ${title} around this party. Step to the glowing threshold and press E; all four must enter before ${waves} adaptive waves begin. ${roleNote}`);
    },
  });
}
