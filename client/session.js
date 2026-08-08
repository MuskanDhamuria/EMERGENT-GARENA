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

export function createSession() {
  const state = {
    joined: false, notice: 'Light a lantern to join a four-player expedition.', noticeTimer: 0,
    camera: { x: 25, y: 17 }, frame: 0,
    encounterHintTarget: null,
    combatHintsShown: {},
    network: { connected: false, playerId: null, roomCode: null, lastTelemetry: 0, error: '', serverOutdated: false },
    world: null, players: [], mine: null, privateRule: null, guidance: null, publicEvent: null,
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
    const awakened = new Set(state.mine?.evolutions || []);
    return abilities().map((id) => ({ id, label: labels[id] || id.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), awakened: awakened.has(id) }));
  }
  function relics() { return Array.isArray(state.world?.relics) ? state.world.relics : []; }
  function guardianTrial() { return state.world?.guardianTrial || null; }
  function templeFinale() { return state.world?.templeFinale || null; }
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
      return { ...player, x: old?.x ?? target.x, y: old?.y ?? target.y, targetX: target.x, targetY: target.y, color: PLAYER_COLORS[index % PLAYER_COLORS.length] };
    });
    state.mine = state.players.find((player) => player.id === state.network.playerId) || null;
    const sourceMine = world.players.find((player) => player.id === state.network.playerId);
    if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y, color: state.mine.color });
    if (world.phase === 'observing' && /waiting|lantern is lit/i.test(state.notice)) {
      state.notice = '';
      state.noticeTimer = 0;
    }
    state.privateRule = (world.yourPrivateRules || []).at(-1) || null;
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
      const shard = String(entity.id || '').startsWith('tideglass-shard-');
      const caveShard = String(entity.id || '').startsWith('gloom-shard-');
      const ruinsShard = String(entity.id || '').startsWith('sunstone-shard-');
      const progress = state.world?.shardProgress || { collected: 0, total: 9 };
      const caveProgress = state.world?.caveShardProgress || { collected: 0, total: 2 };
      const ruinsProgress = state.world?.ruinsShardProgress || { collected: 0, total: 3 };
      const nextShardCount = Math.min(progress.total, progress.collected + (shard ? 1 : 0));
      const nextCaveShardCount = Math.min(caveProgress.total, caveProgress.collected + (caveShard ? 1 : 0));
      const nextRuinsShardCount = Math.min(ruinsProgress.total, ruinsProgress.collected + (ruinsShard ? 1 : 0));
      const success = action === 'enter-dark-cave' ? 'Cold air rises from the Black Hollow.' : action === 'exit-dark-cave' ? 'You climb back into the western forest.' : action === 'enter-sunken-temple' ? 'The temple stretches far beneath the lake.' : action === 'exit-sunken-temple' ? 'You return to Everdawn.' : action === 'enter-hidden-ruins' ? 'Dry air and old bandages stir beyond the buried arch.' : action === 'exit-hidden-ruins' ? 'You step back into Everdawn.' : ruinsShard ? `Sunstone recovered — ${nextRuinsShardCount}/${ruinsProgress.total}.` : caveShard ? `Gloom shard recovered — ${nextCaveShardCount}/${caveProgress.total}.` : shard ? `Tideglass recovered — ${nextShardCount}/${progress.total}.${nextShardCount === 5 ? ' The fragments reveal a purpose: carry the complete set to the ancient altar.' : nextShardCount === progress.total ? ' The collection is complete.' : ''}` : `You activated ${entity.label || action.replaceAll('-', ' ')}.`;
      note(reply?.ok ? success : (reply?.error || 'That interaction did not work.'), reply?.ok ? 3 : 5);
    });
  }
  function attack() {
    const trial = guardianTrial();
    if (!gameReady() || !state.mine || (!trial?.activeTrial && !['dark-cave', 'hidden-ruins', 'sunken-temple'].includes(state.mine.zone))) return;
    socket.emit('attack', (reply) => {
      if (reply?.ok) {
        if (trial?.activeTrial && reply.defeated) { note('Your ward scatters the spirit. The Game Master watches your resolve.', 2.5); return; }
        if (reply.defeated) note(state.mine.zone === 'hidden-ruins' ? 'The mummy collapses. One warden may still be moving.' : 'The demon falls. Stay together—the others are still hunting.', 2.5);
      } else if (!reply?.cooldown) note(reply?.error || 'The strike did not connect.', 2.5);
    });
  }
  function aimAt(screenX, screenY, width = 960, height = 640) {
    if (state.mine?.realm !== 'ghost-village') return false;
    const tile = 20;
    const aimX = (screenX + state.camera.x * tile - width / 2) / tile;
    const aimZ = (screenY + state.camera.y * tile - height / 2) / tile;
    socket.emit('interact', { type: 'ghost-village-aim', aimX, aimZ }, (reply) => {
      if (!reply?.ok) note(reply?.error || 'The spirit shard does not answer that throw.', 2);
    });
    return true;
  }
  function update(dt, input) {
    state.frame += dt * 10; if (state.noticeTimer > 0) state.noticeTimer -= dt;
    for (const player of state.players) { const ease = Math.min(1, dt * 14); player.x += (player.targetX - player.x) * ease; player.y += (player.targetY - player.y) * ease; }
    const mine = state.mine;
    if (gameReady() && mine) {
      const { x, z } = input; socket.emit('move', { x, z });
      if (performance.now() - state.network.lastTelemetry > 500) { const landmark = nearest(mine, LANDMARKS, 4); socket.emit('player-telemetry', { locationId: landmark?.label?.toLowerCase().replaceAll(' ', '-') }); state.network.lastTelemetry = performance.now(); }
      const doorway = nearest(mine, activeEntities().filter((entity) => ['hidden-cave-mouth', 'dark-cave-exit', 'hidden-temple-entrance', 'sunken-temple-exit', 'hidden-ruins-entrance', 'hidden-ruins-exit'].includes(entity.id)), 7);
      if (doorway && state.encounterHintTarget !== doorway.id) {
        state.encounterHintTarget = doorway.id;
        const hints = {
          'hidden-cave-mouth': 'A breath of cold air moves behind the stone. Press E to enter.',
          'dark-cave-exit': 'The forest air reaches you through the passage. Press E to leave.',
          'hidden-temple-entrance': 'The submerged doorway answers your lantern. Press E to enter.',
          'sunken-temple-exit': 'The return staircase leads back to Everdawn. Press E to leave.',
          'hidden-ruins-entrance': 'Sand slips from a sealed arch. Press E to cross the threshold.',
          'hidden-ruins-exit': 'Warm daylight reaches through the archway. Press E to leave.',
        };
        note(hints[doorway.id], 4);
      }
      if (!doorway) state.encounterHintTarget = null;
      if (['dark-cave', 'hidden-ruins', 'sunken-temple'].includes(mine.zone) && !state.combatHintsShown[mine.zone]) {
        state.combatHintsShown[mine.zone] = true;
        note(mine.zone === 'hidden-ruins' ? 'Bandages stir between the pillars. Stay close and press SPACE to strike.' : 'Three shapes move in the dark. Stay close and press SPACE to strike.', 5);
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

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, abilityProgress, relics, guardianTrial, templeFinale, activeEntities, joinRoom, interact, attack, aimAt, update };
}
