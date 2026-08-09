import { io } from 'socket.io-client';
import { CONTENT_VERSION, ENTITY_ACTIONS, FEATURE_FALLBACK_ENTITIES, MAX_PLAYERS, ROLE_ABILITIES } from '../shared/game-content.js';

// A room is always four distinct lanterns. Keep the visual identity stable
// even when someone reconnects into a room that was created by an older server.
const PLAYER_COLORS = ['#2563eb', '#db2777', '#f59e0b', '#16a34a'];

// Owns browser-side state and server communication.  This module never draws
// pixels; it turns player input into server intent and exposes render-ready data.
export const LANDMARKS = [
  { x: 20, y: 17, label: 'Starting Village' }, { x: 7, y: 7, label: 'Whispering Forest' },
  { x: 43, y: 25, label: 'Lake of Glass' }, { x: 50, y: 6, label: 'Crystal Cave' },
  { x: 48, y: 17, label: 'Sacred Shrine' }, { x: 26, y: 28, label: 'Small Graveyard' },
  { x: 53, y: 28, label: 'Ancient Temple' },
];

export function ghostVillageAimPoint(screenX, screenY, camera = null) {
  if (camera) return {
    x: Math.max(0, Math.min(28, (Number(screenX) + Number(camera.x) * 20 - 480) / 20)),
    z: Math.max(0, Math.min(14, (Number(screenY) + Number(camera.y) * 20 - 320) / 20)),
  };
  return {
    x: Math.max(0, Math.min(28, (Number(screenX) - 74) / 812 * 28)),
    z: Math.max(0, Math.min(14, (Number(screenY) - 110) / 408 * 14)),
  };
}

export function createSession() {
  const state = {
    joined: false, notice: 'Light a lantern to join a four-player expedition.', noticeTimer: 0,
    camera: { x: 25, y: 17 }, frame: 0,
    encounterHintTarget: null, aimScreen: null, dungeonAttack: null,
    combatHintsShown: {},
    network: { connected: false, playerId: null, roomCode: null, lastTelemetry: 0, error: '', serverOutdated: false },
    world: null, players: [], mine: null, privateRule: null, guidance: null, publicEvent: null,
    // Puzzle state is intentionally local presentation. The selected trials,
    // clues, landmark, and completion remain authoritative on the server.
    collectorGame: null,
  };
  const socket = io({ autoConnect: false, timeout: 5_000, reconnectionAttempts: 3 });

  function cssColor(color, fallback = '#fff') {
    return typeof color === 'string' ? color : Number.isFinite(color)
      ? `#${Math.max(0, color).toString(16).padStart(6, '0').slice(-6)}` : fallback;
  }
  function mapPoint(item = {}) {
    if (Number.isFinite(item.tileX) && Number.isFinite(item.tileY)) return { x: item.tileX, y: item.tileY };
    if (Number.isFinite(item.mapX) && Number.isFinite(item.mapY)) return { x: item.mapX, y: item.mapY };
    return { x: Number(item.x || 0) + 30, y: Number(item.z ?? item.y ?? 0) + 17 };
  }
  function note(text, duration = 4) { state.notice = text; state.noticeTimer = duration; }
  function roomPlayerCount() { return state.world?.players?.length || 0; }
  function gameReady() { return state.network.connected && roomPlayerCount() === MAX_PLAYERS; }
  function features() {
    return new Set([...(state.world?.world?.unlocked || state.world?.unlockedFeatures || []), ...(state.world?.world?.privateUnlocks || state.world?.yourPrivateUnlocks || []), ...(state.mine?.evolutions || [])]);
  }
  function abilities() {
    return ROLE_ABILITIES[state.mine?.archetype] || state.mine?.capabilities || [];
  }
  function abilityProgress() {
    const labels = {
      'hidden-cave-appears': 'Hidden Cave',
      'temple-staircase-uncovered': 'Temple Staircase',
      'forgotten-ruins-emerge': 'Hidden Ruins',
    };
    const collector = state.world?.collectorTrial;
    if (state.mine?.archetype === 'Loner') {
      const titles = { 'spirit-realm': 'Spirit Realm', 'shadow-forest': 'Shadow Forest', 'moon-shrine': 'Moon Shrine', 'ghost-village': 'Haunted Library' };
      const completionIds = { 'spirit-realm': 'spirit-portal-opens', 'shadow-forest': 'shadow-forest-awakens', 'moon-shrine': 'moon-shrine-visible', 'ghost-village': 'ghost-village-appears' };
      const complete = new Set(state.mine.completedEvolutions || []);
      return (state.mine.evolutions || []).map((id) => ({ id, label: titles[id] || id.replaceAll('-', ' '), awakened: complete.has(completionIds[id]) }));
    }
    if (state.mine?.archetype === 'Collector' && collector?.plan?.length) {
      const titles = { 'crystal-mine': 'Crystal Heart', 'ancient-vault': 'Ancient Vault', 'treasure-cache': 'Treasure Cache', 'relic-forge': 'Relic Forge', 'sunken-relic': 'Sunken Crown' };
      const complete = new Set(collector.completedFeatures || []);
      return collector.plan.map((id) => ({ id, label: titles[id] || id.replaceAll('-', ' '), awakened: complete.has(id) || collector.active?.feature === id }));
    }
    const awakened = new Set(state.mine?.evolutions || []);
    return abilities().map((id) => ({ id, label: labels[id] || id.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), awakened: awakened.has(id) }));
  }
  function relics() { return Array.isArray(state.world?.relics) ? state.world.relics : []; }
  function guardianTrial() { return state.world?.guardianTrial || null; }
  function templeFinale() { return state.world?.templeFinale || null; }
  function collectorTrial() { return state.world?.collectorTrial || null; }
  function serverEntities() {
    const supplied = state.world?.world?.entities || state.world?.entities || [];
    if (supplied.length) return supplied.filter(Boolean).map((entity, index) => ({ ...entity, id: entity.id || `entity-${index}`, ...mapPoint(entity), label: entity.label || entity.name || entity.id || 'World feature', kind: entity.kind || entity.type || 'feature' }));
    return [...features()].map((feature) => FEATURE_FALLBACK_ENTITIES[feature]).filter(Boolean).map((entity) => ({ ...entity, ...mapPoint(entity), kind: entity.type }));
  }
  function activeEntities() {
    const trial = guardianTrial(), temple = templeFinale();
    if (trial?.activeTrial) {
      const mechanic = trial.mechanic || {}, objectives = trial.activeTrial.objectives;
      let interactable = objectives.filter((objective) => !trial.activatedObjectiveIds.includes(objective.id));
      if (mechanic.id === 'carry-lanterns') interactable = mechanic.carriedLanternId
        ? objectives.filter((objective) => objective.id === 'hearth')
        : objectives.filter((objective) => objective.id !== 'hearth' && !mechanic.deliveredLanternIds.includes(objective.id));
      if (mechanic.id === 'stillness-channel' && mechanic.channelObjectiveId) interactable = [];
      return interactable.map((objective) => ({ ...objective, y: objective.z, kind: 'guardian-objective', action: 'guardian-objective', targetId: objective.id }));
    }
    if (temple) {
      const minePane = temple.panes?.find((pane) => pane.id === state.network.playerId);
      return minePane ? [{ ...minePane.pedestal, y: minePane.pedestal.z, kind: 'temple-pillar', action: 'activate-temple-pillar', targetId: 'temple-pillar', label: minePane.pedestal.label }] : [];
    }
    if (state.mine?.realm === 'lantern-rite') return serverEntities().filter((entity) => entity.zone === 'lantern-rite');
    if (state.mine?.realm === 'echo-accord') return [];
    const relicEntities = relics().filter((relic) => !relic.collectedBy).map((relic) => ({ ...relic, ...mapPoint(relic), kind: 'relic', label: relic.name || relic.id.replaceAll('-', ' '), action: 'relic', targetId: relic.id }));
    const zone = state.mine?.zone || 'overworld';
    return [...relicEntities, ...serverEntities().filter((entity) => !entity.collectedBy && entity.kind !== 'relic' && entity.type !== 'relic')].filter((entity) => (entity.zone || 'overworld') === zone);
  }
  function nearest(point, list, radius = 3.25) {
    return list.filter(Boolean).map((item) => ({ item, distance: Math.hypot(point.x - item.x, point.y - item.y) })).filter(({ distance }) => distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.item || null;
  }
  function finalAction(entity) {
    if (!entity) return null;
    if (entity.action) return entity.action;
    if (ENTITY_ACTIONS[entity.id]) return ENTITY_ACTIONS[entity.id];
    const kind = String(entity.kind || entity.type || '').toLowerCase();
    if (kind.includes('relic')) return 'relic';
    return entity.interaction || null;
  }
  function applyWorldState(world) {
    if (!world || !Array.isArray(world.players)) return;
    state.world = world; state.network.roomCode = world.code || state.network.roomCode;
    state.network.serverOutdated = world.contentVersion !== CONTENT_VERSION;
    const previous = new Map(state.players.map((player) => [player.id, player]));
    state.players = world.players.map((player, index) => {
      const target = mapPoint(player), old = previous.get(player.id);
      const changedRealm = old && old.realm !== player.realm;
      return { ...player, x: changedRealm ? target.x : old?.x ?? target.x, y: changedRealm ? target.y : old?.y ?? target.y, targetX: target.x, targetY: target.y, color: PLAYER_COLORS[index % PLAYER_COLORS.length] };
    });
    state.mine = state.players.find((player) => player.id === state.network.playerId) || null;
    const previousMine = previous.get(state.network.playerId);
    if (state.mine && previousMine && previousMine.realm !== state.mine.realm) {
      state.camera.x = state.mine.x;
      state.camera.y = state.mine.y;
    }
    const sourceMine = world.players.find((player) => player.id === state.network.playerId);
    if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y, color: state.mine.color });
    if (world.phase === 'observing' && /waiting|lantern is lit/i.test(state.notice)) {
      state.notice = '';
      state.noticeTimer = 0;
    }
    state.privateRule = (world.yourPrivateRules || []).at(-1) || null;
    // An authoritative completion always closes the local puzzle overlay,
    // including after a reconnect or a server-side GM decision.
    if (state.collectorGame && world.collectorTrial?.active?.completed) state.collectorGame = null;
    if (state.collectorGame?.feature === 'relic-forge') {
      const assisted = Number(world.collectorTrial?.active?.forgeAssistHeat || 0);
      const previousAssist = Number(state.collectorGame.serverAssistHeat || 0);
      if (assisted > previousAssist) state.collectorGame.heat = Math.min(100, state.collectorGame.heat + assisted - previousAssist);
      state.collectorGame.serverAssistHeat = assisted;
    }
    // A reconnect receives its player-specific guidance in the authoritative
    // event history, so it never loses the current instruction mid-rite.
    const latestGuidance = world.yourGuidance || (world.events || []).filter((event) => event?.type === 'gm-guidance').at(-1);
    if (latestGuidance) state.guidance = latestGuidance;
    if (world.director?.narration) state.publicEvent = world.director.narration;
    if (!gameReady() && state.joined) state.notice = `Waiting for all ${MAX_PLAYERS} lanterns — ${roomPlayerCount()}/${MAX_PLAYERS} joined.`;
  }
  function joinRoom(name, roomCode, onRejected) {
    state.network.error = ''; socket.connect();
    socket.once('connect', () => socket.emit('join-room', { name, roomCode }, (reply) => {
      if (!reply?.ok) { state.network.error = reply?.error || 'Unable to join this room.'; socket.disconnect(); onRejected?.(state.network.error); return; }
      state.joined = true; state.network.connected = true; state.network.playerId = reply.playerId; state.network.roomCode = reply.code;
      note('Your lantern is lit. Waiting for exactly four players.', 8); socket.emit('request-world-state');
    }));
  }
  function startCollectorGame(reply, entity) {
    const feature = reply?.feature;
    if (!feature) return;
    const shared = {
      feature,
      title: reply.title || 'Relic Rite',
      instruction: reply.instruction || 'Read the clues and complete the rite.',
      minigame: reply.minigame,
      landmarkId: entity.targetId || entity.id,
      clueTotal: reply.clueTotal || 0,
      clues: reply.clues || [],
      hitboxes: [],
    };
    const puzzles = {
      'crystal-mine': { ...shared, phase: 'rebuild', placed: [], order: [2, 4, 1, 3, 0] },
      'ancient-vault': { ...shared, phase: 'decode', entered: [], order: ['gem', 'moon', 'flame', 'key'] },
      'treasure-cache': { ...shared, phase: 'appraise', selected: [], genuine: [0, 2, 3] },
      'relic-forge': { ...shared, phase: 'recipe', recipe: [], recipeOrder: ['energy', 'stability', 'iron'], heat: 58, serverAssistHeat: Number(reply.forgeAssistHeat || 0), hammer: [], hammerOrder: ['right', 'left', 'up'] },
      'sunken-relic': { ...shared, phase: 'navigate', step: 0, route: ['right', 'up', 'up', 'right', 'down', 'right'] },
    };
    state.collectorGame = puzzles[feature] || null;
    if (state.collectorGame) note(`The ${state.collectorGame.title} has opened. Follow the Game Master's private rule.`, 5);
  }
  function completeCollectorGame() {
    const game = state.collectorGame;
    if (!game) return;
    socket.emit('interact', { type: 'collector-minigame-complete', targetId: game.landmarkId }, (reply) => {
      if (reply?.ok) { note(`Rite complete: ${game.title}. The Game Master is shaping what comes next.`, 5); state.collectorGame = null; }
      else note(reply?.error || 'The landmark needs one more answer.', 4);
    });
  }
  function collectorMistake(game, message) {
    game.mistakes = (game.mistakes || 0) + 1;
    note(message, 2.6);
  }
  function handleCollectorPointer(hit) {
    const game = state.collectorGame;
    if (!game || !hit) return false;
    const { action, value } = hit;
    if (action === 'close') { state.collectorGame = null; note('The relic rite waits at its landmark.', 2); return true; }
    if (game.feature === 'crystal-mine' && action === 'crystal') {
      const expected = game.order[game.placed.length];
      if (value !== expected) collectorMistake(game, 'That fragment does not resonate with this socket.');
      else { game.placed.push(value); if (game.placed.length === game.order.length) completeCollectorGame(); }
      return true;
    }
    if (game.feature === 'ancient-vault' && action === 'rune') {
      const expected = game.order[game.entered.length];
      if (value !== expected) { game.entered = []; collectorMistake(game, 'The vault rejects the order. Read the carvings again.'); }
      else { game.entered.push(value); if (game.entered.length === game.order.length) completeCollectorGame(); }
      return true;
    }
    if (game.feature === 'treasure-cache') {
      if (action === 'relic-card') {
        game.selected = game.selected.includes(value) ? game.selected.filter((item) => item !== value) : [...game.selected, value].slice(-3);
      } else if (action === 'confirm-appraisal') {
        const correct = game.selected.length === 3 && game.genuine.every((item) => game.selected.includes(item));
        if (correct) completeCollectorGame(); else { game.selected = []; collectorMistake(game, 'The cache hums coldly. Reconsider which objects are truly relics.'); }
      }
      return true;
    }
    if (game.feature === 'relic-forge') {
      if (game.phase === 'recipe' && action === 'ingredient') {
        const expected = game.recipeOrder[game.recipe.length];
        if (value !== expected) { game.recipe = []; collectorMistake(game, 'The ingredients lose their balance. Start the recipe again.'); }
        else { game.recipe.push(value); if (game.recipe.length === game.recipeOrder.length) { game.phase = 'heat'; note('The core is assembled. Work it only while it glows orange.', 3); } }
      } else if (game.phase === 'heat' && action === 'bellows') {
        game.heat = Math.min(100, game.heat + 8);
      } else if (game.phase === 'heat' && action === 'temper') {
        if (game.heat >= 76 && game.heat <= 88) { game.phase = 'hammer'; note('The metal is ready. Strike right, left, then upper.', 3); }
        else if (game.heat > 88) { game.heat = 52; collectorMistake(game, 'The core overheats and cools. Bring it back to orange.'); }
        else collectorMistake(game, 'The core is still too cold. Pump the bellows.');
      } else if (game.phase === 'hammer' && action === 'hammer') {
        const expected = game.hammerOrder[game.hammer.length];
        if (value !== expected) { game.hammer = []; collectorMistake(game, 'The resonance cracks. Begin the hammer pattern again.'); }
        else { game.hammer.push(value); if (game.hammer.length === game.hammerOrder.length) { game.phase = 'quench'; note('One final choice: quench the balanced core in oil.', 3); } }
      } else if (game.phase === 'quench' && action === 'quench') {
        if (value === 'oil') completeCollectorGame(); else collectorMistake(game, 'That liquid scatters the resonance. Only oil will set the core.');
      }
      return true;
    }
    if (game.feature === 'sunken-relic' && action === 'current') {
      const expected = game.route[game.step];
      if (value !== expected) { game.step = 0; collectorMistake(game, 'The current pushes you back to the first flooded chamber.'); }
      else { game.step += 1; if (game.step === game.route.length) completeCollectorGame(); }
      return true;
    }
    return false;
  }
  function handleCollectorKey(key) {
    const direction = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[key];
    if (state.collectorGame?.feature === 'sunken-relic' && direction) return handleCollectorPointer({ action: 'current', value: direction });
    if (key === 'escape' && state.collectorGame) return handleCollectorPointer({ action: 'close' });
    return false;
  }
  function lanternSupport(kind) {
    if (!gameReady() || state.mine?.realm !== 'lantern-rite' || state.mine?.archetype !== 'Guardian') return false;
    const target = state.players.filter((player) => player.id !== state.mine.id && player.realm === 'lantern-rite').sort((left, right) => Math.hypot(state.mine.x - left.x, state.mine.y - left.y) - Math.hypot(state.mine.x - right.x, state.mine.y - right.y))[0];
    if (!target) { note('Move beside an ally to share a Guardian blessing.', 3); return true; }
    const type = kind === 'heal' ? 'lantern-guardian-heal' : 'lantern-guardian-barrier';
    socket.emit('interact', { type, targetId: target.id }, (reply) => note(reply?.ok ? (kind === 'heal' ? `Healing light reaches ${target.name}.` : `${target.name} is shielded.`) : (reply?.error || 'That blessing cannot reach an ally yet.'), 3));
    return true;
  }
  function interact() {
    if (!gameReady() || !state.mine) return;
    if (state.network.serverOutdated) { note('The game server is out of date. Restart npm run api, then refresh this tab.', 10); return; }
    if (!['evolving', 'finale'].includes(state.world?.phase)) {
      note('Roles are still awakening. Interactions unlock when the observation ends.', 4);
      return;
    }
    const trial = guardianTrial(), temple = templeFinale();
    // Portal coordinates belong to their separate dimension. Once its trial is
    // complete, use the overworld player position again so the next portal can
    // be found and interacted with normally.
    const position = trial?.activeTrial && trial.position ? { x: trial.position.x, y: trial.position.z } : temple?.panes?.find((pane) => pane.id === state.network.playerId)?.position ? { x: temple.panes.find((pane) => pane.id === state.network.playerId).position.x, y: temple.panes.find((pane) => pane.id === state.network.playerId).position.z } : state.mine;
    const nearby = activeEntities();
    const entity = nearest(position, nearby) || nearest(position, nearby.filter((item) => ['hidden-cave-mouth', 'hidden-temple-entrance', 'hidden-ruins-entrance'].includes(item.id)), 7);
    const action = finalAction(entity);
    if (!action) { note('Move near an object marked for your role.', 3); return; }
    socket.emit('interact', { type: action, targetId: entity.targetId || entity.id }, (reply) => {
      if (reply?.ok && action === 'dungeon-attack') state.dungeonAttack = { timer: .28, targetX: entity.x, targetY: entity.y };
      if (reply?.ok && action === 'collector-minigame-start') { startCollectorGame(reply, entity); return; }
      if (reply?.ok && action === 'collect-clue' && reply.clueText) { note(reply.clueText, 7); return; }
      const shard = String(entity.id || '').startsWith('tideglass-shard-');
      const caveShard = String(entity.id || '').startsWith('gloom-shard-');
      const ruinsShard = String(entity.id || '').startsWith('sunstone-shard-');
      const everdawnShard = String(entity.id || '').startsWith('everdawn-shard-');
      const progress = state.world?.shardProgress || { collected: 0, total: 4 };
      const caveProgress = state.world?.caveShardProgress || { collected: 0, total: 4 };
      const ruinsProgress = state.world?.ruinsShardProgress || { collected: 0, total: 4 };
      const everdawnProgress = state.world?.everdawnShardProgress || { collected: 0, total: 5 };
      const nextShardCount = Math.min(progress.total, progress.collected + (shard ? 1 : 0));
      const nextCaveShardCount = Math.min(caveProgress.total, caveProgress.collected + (caveShard ? 1 : 0));
      const nextRuinsShardCount = Math.min(ruinsProgress.total, ruinsProgress.collected + (ruinsShard ? 1 : 0));
      const nextEverdawnShardCount = Math.min(everdawnProgress.total, everdawnProgress.collected + (everdawnShard ? 1 : 0));
      const success = action === 'enter-dark-cave' ? 'Cold air rises from the Black Hollow.' : action === 'exit-dark-cave' ? 'You climb back into the western forest.' : action === 'enter-sunken-temple' ? 'The temple stretches far beneath the lake.' : action === 'exit-sunken-temple' ? 'You return to Everdawn.' : action === 'enter-hidden-ruins' ? 'Dry air and old bandages stir beyond the buried arch.' : action === 'exit-hidden-ruins' ? 'You step back into Everdawn.' : everdawnShard ? `Everdawn shard recovered — ${nextEverdawnShardCount}/${everdawnProgress.total}.` : ruinsShard ? `Sunstone recovered — ${nextRuinsShardCount}/${ruinsProgress.total}.` : caveShard ? `Gloom shard recovered — ${nextCaveShardCount}/${caveProgress.total}.` : shard ? `Tideglass recovered — ${nextShardCount}/${progress.total}.${nextShardCount === progress.total ? ' The collection is complete.' : ''}` : `You activated ${entity.label || action.replaceAll('-', ' ')}.`;
      note(reply?.ok ? success : (reply?.error || 'That interaction did not work.'), reply?.ok ? 3 : 5);
    });
  }
  function attack() {
    const trial = guardianTrial();
    if (!gameReady() || !state.mine || (!trial?.activeTrial && !['dark-cave', 'hidden-ruins'].includes(state.mine.zone))) return;
    socket.emit('attack', (reply) => {
      if (reply?.ok) {
        if (trial?.activeTrial && reply.defeated) { note('Your ward scatters the spirit. The Game Master watches your resolve.', 2.5); return; }
        if (reply.defeated) note(state.mine.zone === 'hidden-ruins' ? 'The mummy collapses. One warden may still be moving.' : 'The demon falls. Stay together—the others are still hunting.', 2.5);
      } else if (!reply?.cooldown) note(reply?.error || 'The strike did not connect.', 2.5);
    });
  }
  function aimAt(screenX, screenY, width = 960, height = 640, shoot = true) {
    if (state.mine?.realm !== 'ghost-village') return false;
    const scaledX = Number(screenX) * 960 / Math.max(1, Number(width));
    const scaledY = Number(screenY) * 640 / Math.max(1, Number(height));
    const { x: aimX, z: aimZ } = ghostVillageAimPoint(scaledX, scaledY, state.camera);
    state.aimScreen = { x: scaledX, y: scaledY, worldX: aimX, worldZ: aimZ };
    if (!shoot) return true;
    socket.emit('interact', { type: 'ghost-village-aim', aimX, aimZ }, (reply) => {
      if (!reply?.ok) note(reply?.error || 'The spirit shard does not answer that throw.', 2);
    });
    return true;
  }
  function update(dt, input) {
    state.frame += dt * 10; if (state.noticeTimer > 0) state.noticeTimer -= dt;
    if (state.dungeonAttack) { state.dungeonAttack.timer -= dt; if (state.dungeonAttack.timer <= 0) state.dungeonAttack = null; }
    for (const player of state.players) { const ease = Math.min(1, dt * 14); player.x += (player.targetX - player.x) * ease; player.y += (player.targetY - player.y) * ease; }
    const mine = state.mine;
    if (gameReady() && mine) {
      if (state.collectorGame) {
        socket.emit('move', { x: 0, z: 0 });
        if (state.collectorGame.feature === 'relic-forge' && state.collectorGame.phase === 'heat') state.collectorGame.heat = Math.max(0, state.collectorGame.heat - dt * 2.5);
      } else {
      const { x, z } = input; socket.emit('move', { x, z });
      if (performance.now() - state.network.lastTelemetry > 500) { const landmark = nearest(mine, LANDMARKS, 4); socket.emit('player-telemetry', { locationId: landmark?.label?.toLowerCase().replaceAll(' ', '-') }); state.network.lastTelemetry = performance.now(); }
      const doorway = nearest(mine, activeEntities().filter((entity) => ['hidden-cave-mouth', 'dark-cave-exit', 'hidden-temple-entrance', 'sunken-temple-exit', 'hidden-ruins-entrance', 'hidden-ruins-exit'].includes(entity.id)), 7);
      if (doorway && state.encounterHintTarget !== doorway.id) {
        state.encounterHintTarget = doorway.id;
        const hints = {
          'hidden-cave-mouth': 'Enter with E. Strike nearby demons with SPACE.',
          'dark-cave-exit': 'Press E to leave.',
          'hidden-temple-entrance': 'Press E to enter.',
          'sunken-temple-exit': 'Press E to leave.',
          'hidden-ruins-entrance': 'Enter with E. Strike nearby mummies with SPACE.',
          'hidden-ruins-exit': 'Press E to leave.',
        };
        note(hints[doorway.id], 4);
      }
      if (!doorway) state.encounterHintTarget = null;
      if (['dark-cave', 'hidden-ruins'].includes(mine.zone) && !state.combatHintsShown[mine.zone]) {
        state.combatHintsShown[mine.zone] = true;
        note(mine.zone === 'hidden-ruins' ? 'Mummies guard these halls. Press SPACE near one to deal damage.' : 'Demons hunt in the dark. Press SPACE near one to deal damage.', 5);
      }
      }
    }
    if (mine) {
      // Interior worlds fit inside one screen. Frame the room itself instead
      // of centering on the doorway and exposing empty void.
      const interior = ['sunken-temple', 'dark-cave', 'hidden-ruins'].includes(mine.zone);
      const cameraTargetX = interior ? 30 : mine.x;
      const cameraTargetY = interior ? 17 : mine.y;
      state.camera.x += (cameraTargetX - state.camera.x) * Math.min(1, dt * 5);
      state.camera.y += (cameraTargetY - state.camera.y) * Math.min(1, dt * 5);
    }
  }

  socket.on('connect_error', () => { state.network.error = 'Unable to reach the game server.'; });
  socket.on('world-state', applyWorldState);
  socket.on('gm-event', (event) => { if (event?.message) { state.publicEvent = event.message; note(event.message, 6); } });
  socket.on('gm-private', (event) => {
    if (!event?.message) return;
    if (event.type === 'gm-guidance') state.guidance = event;
    else state.privateRule = event;
    note(event.message, 7);
  });
  socket.on('disconnect', () => { state.network.connected = false; if (state.joined) note('Connection lost. Reconnect to rejoin the four-player expedition.', 10); });

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, abilityProgress, relics, guardianTrial, templeFinale, collectorTrial, activeEntities, joinRoom, interact, attack, aimAt, handleCollectorPointer, handleCollectorKey, lanternSupport, update };
}
