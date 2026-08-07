import { io } from 'socket.io-client';
import { ENTITY_ACTIONS, FEATURE_FALLBACK_ENTITIES, MAX_PLAYERS } from '../shared/game-content.js';

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
    network: { connected: false, playerId: null, roomCode: null, lastTelemetry: 0, error: '' },
    world: null, players: [], mine: null, privateRule: null, publicEvent: null,
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
    return [...new Set([...(state.mine?.capabilities || state.mine?.abilities || state.mine?.abilityIds || []), ...(state.world?.world?.yourAbilities || state.world?.yourAbilities || []), ...features()])];
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
    return [...relicEntities, ...serverEntities().filter((entity) => entity.kind !== 'relic' && entity.type !== 'relic')];
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
    const previous = new Map(state.players.map((player) => [player.id, player]));
    state.players = world.players.map((player, index) => {
      const target = mapPoint(player), old = previous.get(player.id);
      return { ...player, x: old?.x ?? target.x, y: old?.y ?? target.y, targetX: target.x, targetY: target.y, color: cssColor(player.color, ['#2563eb', '#db2777', '#f59e0b', '#16a34a'][index % 4]) };
    });
    state.mine = state.players.find((player) => player.id === state.network.playerId) || null;
    const sourceMine = world.players.find((player) => player.id === state.network.playerId);
    if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y });
    state.privateRule = (world.yourPrivateRules || []).at(-1) || null;
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
    if (!['evolving', 'finale'].includes(state.world?.phase)) {
      note('Roles are still awakening. Interactions unlock when the observation ends.', 4);
      return;
    }
    const trial = guardianTrial(), temple = templeFinale();
    // Portal coordinates belong to their separate dimension. Once its trial is
    // complete, use the overworld player position again so the next portal can
    // be found and interacted with normally.
    const position = trial?.activeTrial && trial.position ? { x: trial.position.x, y: trial.position.z } : temple?.panes?.find((pane) => pane.id === state.network.playerId)?.position ? { x: temple.panes.find((pane) => pane.id === state.network.playerId).position.x, y: temple.panes.find((pane) => pane.id === state.network.playerId).position.z } : state.mine;
    const entity = nearest(position, activeEntities()), action = finalAction(entity);
    if (!action) { note('Move near an object marked for your role.', 3); return; }
    socket.emit('interact', { type: action, targetId: entity.targetId || entity.id }, (reply) => {
      note(reply?.ok ? `You used ${entity.label || action.replaceAll('-', ' ')}.` : (reply?.error || 'That interaction did not work.'), reply?.ok ? 3 : 5);
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
    }
    if (mine) { state.camera.x += (mine.x - state.camera.x) * Math.min(1, dt * 5); state.camera.y += (mine.y - state.camera.y) * Math.min(1, dt * 5); }
  }

  socket.on('connect_error', () => { state.network.error = 'Unable to reach the game server.'; });
  socket.on('world-state', applyWorldState);
  socket.on('gm-event', (event) => { if (event?.message) { state.publicEvent = event.message; note(event.message, 6); } });
  socket.on('gm-private', (event) => { if (event?.message) { state.privateRule = event; note(event.message, 7); } });
  socket.on('disconnect', () => { state.network.connected = false; if (state.joined) note('Connection lost. Reconnect to rejoin the four-player expedition.', 10); });

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, relics, guardianTrial, templeFinale, activeEntities, joinRoom, interact, aimAt, update };
}
