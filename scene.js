import { io } from 'socket.io-client';

// The browser is deliberately a view/controller only.  The room server owns
// positions, collisions, roles, relic ownership, abilities and finale state.
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 640;
canvas.id = 'game';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const T = 20, W = 60, H = 34;
const C = { grass: '#72bd58', path: '#d8be80', water: '#49afd0', ink: '#27324a', gold: '#f7d25c', purple: '#9b75c9' };
const art = {};
let authoredForest = null;

function loadArt(name, source) {
  const image = new Image();
  image.src = source;
  image.addEventListener('load', () => { art[name] = image; render(); });
}
loadArt('camping', '/game-art/camping-32.png');
fetch('/game-art/forest.json').then((response) => response.ok ? response.json() : null).then((layout) => {
  authoredForest = layout;
  render();
}).catch(() => {});

const state = {
  joined: false,
  notice: 'Light a lantern to join a four-player expedition.',
  noticeTimer: 0,
  camera: { x: 25, y: 17 },
  frame: 0,
  network: { connected: false, playerId: null, roomCode: null, lastTelemetry: 0, error: '' },
  world: null,
  players: [],
  mine: null,
  privateRule: null,
  publicEvent: null,
};

const FEATURE_ENTITIES = {
  'hidden-cave': { id: 'hidden-cave', x: 50, y: 6, kind: 'cave', label: 'Hidden Cave' },
  'invisible-bridge': { id: 'invisible-bridge', x: 43, y: 24, kind: 'bridge', label: 'Glasswater Bridge' },
  'forgotten-ruins': { id: 'forgotten-ruins', x: 30, y: 6, kind: 'ruins', label: 'Forgotten Ruins' },
  'relic-vault': { id: 'relic-vault', x: 30, y: 7, kind: 'vault', label: 'Relic Vault' },
  'evolving-artifacts': { id: 'evolving-artifacts', x: 32, y: 7, kind: 'relic', label: 'Evolving Artifacts' },
  'treasure-cache': { id: 'treasure-cache', x: 29, y: 8, kind: 'vault', label: 'Treasure Cache' },
  'healing-shrine': { id: 'healing-shrine', x: 48, y: 17, kind: 'shrine', label: 'Healing Shrine', action: 'shrine' },
  'protective-barrier': { id: 'protective-barrier', x: 46, y: 17, kind: 'barrier', label: 'Protective Barrier' },
  'revival-monument': { id: 'revival-monument', x: 47, y: 19, kind: 'shrine', label: 'Revival Monument', action: 'shrine' },
  'spirit-realm': { id: 'spirit-realm', x: 26, y: 28, kind: 'gate', label: 'Spirit Realm', action: 'spirit-gate' },
  'illusion-passage': { id: 'illusion-passage', x: 25, y: 27, kind: 'gate', label: 'Illusion Passage', action: 'spirit-gate' },
  'hidden-portal': { id: 'hidden-portal', x: 27, y: 28, kind: 'gate', label: 'Hidden Portal', action: 'spirit-gate' },
  'ancient-temple': { id: 'temple-entrance', x: 53, y: 28, kind: 'temple', label: 'Ancient Temple Entrance', action: 'temple-entrance' },
  'final-gate': { id: 'altar', x: 51, y: 28, kind: 'altar', label: 'Temple Altar', action: 'altar' },
};
const LANDMARKS = [
  { x: 20, y: 17, label: 'Starting Village' }, { x: 7, y: 7, label: 'Whispering Forest' },
  { x: 43, y: 25, label: 'Lake of Glass' }, { x: 50, y: 6, label: 'Crystal Cave' },
  { x: 48, y: 17, label: 'Sacred Shrine' }, { x: 26, y: 28, label: 'Small Graveyard' },
  { x: 53, y: 28, label: 'Ancient Temple' },
];

const socket = io({ autoConnect: false, timeout: 5_000, reconnectionAttempts: 3 });
const keys = {};

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
function gameReady() { return state.network.connected && roomPlayerCount() === 4; }
function features() {
  const publicFeatures = state.world?.world?.unlocked || state.world?.unlockedFeatures || [];
  const privateFeatures = state.world?.world?.privateUnlocks || state.world?.yourPrivateUnlocks || [];
  return new Set([...publicFeatures, ...privateFeatures, ...(state.mine?.evolutions || [])]);
}
function abilities() {
  const fromPlayer = state.mine?.capabilities || state.mine?.abilities || state.mine?.abilityIds || [];
  const fromWorld = state.world?.world?.yourAbilities || state.world?.yourAbilities || [];
  return [...new Set([...fromPlayer, ...fromWorld, ...features()])];
}
function relics() { return Array.isArray(state.world?.relics) ? state.world.relics : []; }
function serverEntities() {
  const supplied = state.world?.world?.entities || state.world?.entities || [];
  const normalized = supplied.filter(Boolean).map((entity, index) => ({
    ...entity, id: entity.id || `entity-${index}`, ...mapPoint(entity),
    label: entity.label || entity.name || entity.id || 'World feature', kind: entity.kind || entity.type || 'feature',
  }));
  if (normalized.length) return normalized;
  return [...features()].map((feature) => FEATURE_ENTITIES[feature]).filter(Boolean);
}
function activeEntities() {
  const relicEntities = relics().filter((relic) => !relic.collectedBy).map((relic) => ({
    ...relic, ...mapPoint(relic), kind: 'relic', label: relic.name || relic.id.replaceAll('-', ' '), action: 'relic', targetId: relic.id,
  }));
  // The server exposes `relics` as a convenient subset of `entities`; render a
  // relic once, using that subset for the collector compass as well.
  return [...relicEntities, ...serverEntities().filter((entity) => entity.kind !== 'relic' && entity.type !== 'relic')];
}

function applyWorldState(world) {
  if (!world || !Array.isArray(world.players)) return;
  state.world = world;
  state.network.roomCode = world.code || state.network.roomCode;
  const previous = new Map(state.players.map((player) => [player.id, player]));
  state.players = world.players.map((player, index) => {
    const target = mapPoint(player);
    const old = previous.get(player.id);
    return {
      ...player, x: old?.x ?? target.x, y: old?.y ?? target.y, targetX: target.x, targetY: target.y,
      color: cssColor(player.color, ['#2563eb', '#db2777', '#f59e0b', '#16a34a'][index % 4]),
    };
  });
  state.mine = state.players.find((player) => player.id === state.network.playerId) || null;
  const sourceMine = world.players.find((player) => player.id === state.network.playerId);
  if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y });
  const privateRules = world.yourPrivateRules || [];
  state.privateRule = privateRules.at(-1) || null;
  if (world.director?.narration) state.publicEvent = world.director.narration;
  if (!gameReady() && state.joined) state.notice = `Waiting for all four lanterns — ${roomPlayerCount()}/4 joined.`;
}

function joinRoom(name, roomCode) {
  state.network.error = '';
  socket.connect();
  socket.once('connect', () => socket.emit('join-room', { name, roomCode }, (reply) => {
    if (!reply?.ok) {
      state.network.error = reply?.error || 'Unable to join this room.';
      socket.disconnect();
      showLanternGate();
      return;
    }
    state.joined = true;
    state.network.connected = true;
    state.network.playerId = reply.playerId;
    state.network.roomCode = reply.code;
    note('Your lantern is lit. Waiting for exactly four players.', 8);
    socket.emit('request-world-state');
  }));
}

socket.on('connect_error', () => { state.network.error = 'Unable to reach the game server.'; });
socket.on('world-state', applyWorldState);
socket.on('gm-event', (event) => {
  if (event?.message) { state.publicEvent = event.message; note(event.message, 6); }
});
socket.on('gm-private', (event) => {
  if (event?.message) { state.privateRule = event; note(event.message, 7); }
});
socket.on('gm-rule', (rule) => { if (rule?.participants?.includes(state.network.playerId)) state.privateRule = rule; });
socket.on('disconnect', () => {
  state.network.connected = false;
  if (state.joined) note('Connection lost. Reconnect to rejoin the four-player expedition.', 10);
});

function nearest(point, list, radius = 3.25) {
  return list.filter(Boolean).map((item) => ({ item, distance: Math.hypot(point.x - item.x, point.y - item.y) }))
    .filter(({ distance }) => distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.item || null;
}
function finalAction(entity) {
  if (!entity) return null;
  if (entity.action) return entity.action;
  const id = String(entity.id || '');
  const authoritativeActions = {
    'hidden-temple-entrance': 'discover-temple',
    'guardian-shrine': 'activate-shrine',
    'spirit-portal': 'enter-spirit-realm',
    'final-altar': 'offer-relics',
    'final-gate': 'open-final-gate',
  };
  if (authoritativeActions[id]) return authoritativeActions[id];
  const kind = String(entity.kind || entity.type || '').toLowerCase();
  if (kind.includes('relic')) return 'relic';
  if (kind.includes('shrine')) return 'activate-shrine';
  if (kind.includes('temple') || kind.includes('entrance')) return 'discover-temple';
  if (kind.includes('altar')) return 'offer-relics';
  if (kind.includes('gate') || kind.includes('spirit')) return 'open-final-gate';
  return entity.interaction || null;
}
function interact() {
  if (!gameReady() || !state.mine) return;
  const entity = nearest(state.mine, activeEntities());
  let action = finalAction(entity);
  if (!action && state.world?.finalObjective?.status === 'active') {
    const roleAction = { Explorer: 'temple-entrance', Collector: 'altar', Guardian: 'shrine', Loner: 'spirit-gate' }[state.mine.archetype];
    const fallback = Object.values(FEATURE_ENTITIES).find((item) => item.action === roleAction);
    if (fallback && Math.hypot(state.mine.x - fallback.x, state.mine.y - fallback.y) <= 3.5) action = roleAction;
  }
  if (!action) { note('Move near a relic, shrine, temple entrance, altar, or spirit gate.', 3); return; }
  socket.emit('interact', { type: action, targetId: entity?.targetId || entity?.id });
  note(`You reach for ${entity?.label || action.replaceAll('-', ' ')}.`, 2);
}

addEventListener('keydown', (event) => {
  keys[event.key.toLowerCase()] = true;
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); interact(); }
  if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen();
});
addEventListener('keyup', (event) => { keys[event.key.toLowerCase()] = false; });
canvas.addEventListener('click', () => { if (!state.joined && !document.getElementById('lantern-gate')) showLanternGate(); });

function showLanternGate() {
  if (document.getElementById('lantern-gate')) return;
  const gate = document.createElement('form');
  gate.id = 'lantern-gate';
  gate.innerHTML = `<div class="gate-card"><div class="gate-title">LIGHT A LANTERN</div><p>This world begins only when exactly four players have gathered.</p><label>NAME<input name="name" maxlength="16" required value="Wanderer"></label><label>ROOM CODE<input name="room" maxlength="6" required value="DAWN"></label><button>JOIN THE EXPEDITION</button><small>There is no solo mode. Invite three fellow wanderers to the same room code.</small></div>`;
  document.body.appendChild(gate);
  gate.querySelector('input[name="name"]').focus();
  gate.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(gate);
    gate.remove();
    joinRoom(String(data.get('name')), String(data.get('room')).toUpperCase());
  });
}

function update(dt) {
  state.frame += dt * 10;
  if (state.noticeTimer > 0) state.noticeTimer -= dt;
  for (const player of state.players) {
    const ease = Math.min(1, dt * 14);
    player.x += (player.targetX - player.x) * ease;
    player.y += (player.targetY - player.y) * ease;
  }
  const mine = state.mine;
  if (gameReady() && mine) {
    let dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    let dz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    if (dx || dz) {
      const magnitude = Math.hypot(dx, dz); dx /= magnitude; dz /= magnitude;
      socket.emit('move', { x: dx, z: dz });
    } else socket.emit('move', { x: 0, z: 0 });
    if (performance.now() - state.network.lastTelemetry > 500) {
      const landmark = nearest(mine, LANDMARKS, 4);
      socket.emit('player-telemetry', { x: mine.x - 30, z: mine.y - 17, locationId: landmark?.label?.toLowerCase().replaceAll(' ', '-') });
      state.network.lastTelemetry = performance.now();
    }
  }
  if (mine) {
    state.camera.x += (mine.x - state.camera.x) * Math.min(1, dt * 5);
    state.camera.y += (mine.y - state.camera.y) * Math.min(1, dt * 5);
  }
}

function px(x) { return Math.floor(x * T - (state.camera.x * T - canvas.width / 2)); }
function py(y) { return Math.floor(y * T - (state.camera.y * T - canvas.height / 2)); }
function panel(x, y, w, h) { ctx.fillStyle = 'rgba(29,47,68,.9)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#f5dd8a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
function sheetTile(gid, X, Y) {
  const image = art.camping;
  if (!image) return false;
  const tile = gid - 1, columns = Math.floor(image.width / 32);
  ctx.drawImage(image, (tile % columns) * 32, Math.floor(tile / columns) * 32, 32, 32, X, Y, T, T);
  return true;
}
function drawTile(x, y) {
  const X = px(x), Y = py(y), index = y * W + x;
  if (!authoredForest || x < 0 || y < 0 || x >= W || y >= H) { ctx.fillStyle = C.grass; ctx.fillRect(X, Y, T, T); return; }
  for (const layer of authoredForest.layers || []) { const gid = layer.data?.[index] || 0; if (gid) sheetTile(gid, X, Y); }
}
function drawEntity(entity) {
  const X = px(entity.x), Y = py(entity.y), kind = String(entity.kind || '').toLowerCase();
  if (kind.includes('relic')) {
    ctx.fillStyle = C.gold; ctx.fillRect(X + 6, Y + 4, 8, 12); ctx.fillStyle = '#fff4b5'; ctx.fillRect(X + 8, Y + 2, 4, 5);
  } else if (kind.includes('gate') || kind.includes('spirit')) {
    ctx.fillStyle = '#4f376f'; ctx.fillRect(X + 3, Y + 2, 14, 16); ctx.fillStyle = '#d9b4ff'; ctx.fillRect(X + 6, Y + 5, 8, 11);
  } else if (kind.includes('shrine')) {
    ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 3, Y + 7, 14, 10); ctx.fillStyle = C.purple; ctx.fillRect(X + 7, Y + 1, 6, 9);
  } else if (kind.includes('temple') || kind.includes('altar')) {
    ctx.fillStyle = '#b9a882'; ctx.fillRect(X, Y + 5, 20, 15); ctx.fillStyle = kind.includes('altar') ? C.gold : '#706879'; ctx.fillRect(X + 7, Y + 8, 6, 12);
  } else if (kind.includes('bridge')) {
    ctx.fillStyle = '#7d5536'; ctx.fillRect(X, Y + 7, 20, 7);
  } else if (kind.includes('vault')) {
    ctx.fillStyle = '#7b607f'; ctx.fillRect(X + 1, Y + 6, 18, 11); ctx.fillStyle = C.gold; ctx.fillRect(X + 3, Y + 3, 14, 6);
  } else {
    ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 4, Y + 4, 12, 12);
  }
}
function drawTerrain(area) {
  const point = mapPoint(area);
  const width = Math.max(1, Number(area.w) || 1) * T;
  const height = Math.max(1, Number(area.h) || 1) * T;
  const kind = String(area.kind || '').toLowerCase();
  if (kind.includes('water')) {
    ctx.fillStyle = 'rgba(57, 161, 211, .72)'; ctx.fillRect(px(point.x), py(point.y), width, height);
    ctx.fillStyle = 'rgba(210, 246, 255, .55)';
    for (let x = 3; x < width; x += 12) ctx.fillRect(px(point.x) + x, py(point.y) + 5 + (x % 8), 7, 2);
  } else if (kind.includes('bridge')) {
    ctx.fillStyle = '#7d5536'; ctx.fillRect(px(point.x), py(point.y) + 6, width, Math.max(7, height - 10));
  } else if (kind.includes('spirit')) {
    ctx.fillStyle = 'rgba(123, 80, 175, .42)'; ctx.fillRect(px(point.x), py(point.y), width, height);
  } else if (kind.includes('path')) {
    ctx.fillStyle = 'rgba(208, 194, 112, .58)'; ctx.fillRect(px(point.x), py(point.y), width, height);
  }
}
function character(player) {
  const X = px(player.x), Y = py(player.y), bob = player === state.mine && (keys.w || keys.a || keys.s || keys.d) ? Math.sin(state.frame) : 0;
  ctx.fillStyle = C.ink; ctx.fillRect(X + 4, Y + 4 + bob, 10, 11);
  ctx.fillStyle = player.color; ctx.fillRect(X + 5, Y + 5 + bob, 8, 8);
  ctx.fillStyle = '#f3c28b'; ctx.fillRect(X + 5, Y + 1 + bob, 8, 5);
  if (player === state.mine) { ctx.strokeStyle = '#fff5b4'; ctx.strokeRect(X + 1, Y + 1, 16, 16); }
}
function label(text, x, y, color = '#fff7d5') { ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.fillText(text, px(x) + 1, py(y) - 7 + 1); ctx.fillStyle = color; ctx.fillText(text, px(x), py(y) - 7); }
function wrap(text, x, y, max, line) { const words = String(text || '').split(' '); let current = '', yy = y; for (const word of words) { if (ctx.measureText(`${current}${word}`).width > max) { ctx.fillText(current, x, yy); current = `${word} `; yy += line; } else current += `${word} `; } ctx.fillText(current, x, yy); }

function drawHUD() {
  const mine = state.mine;
  panel(14, 14, 306, 62); ctx.textAlign = 'left'; ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('EVERDAWN', 27, 35);
  ctx.font = '11px monospace'; ctx.fillStyle = '#d2f0cf';
  const status = !state.network.connected ? 'CONNECTING TO THE WORLD…' : !gameReady() ? `GATHERING LANTERNS · ${roomPlayerCount()}/4` : state.world?.phase === 'observing' ? `THE GM OBSERVES · ${state.world?.observationSecondsRemaining ?? '?'}s` : `YOUR ROLE · ${mine?.archetype || 'awakening'}`;
  ctx.fillText(status, 27, 55);
  panel(760, 14, 186, 104); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText(`LANTERNS · ${state.network.roomCode || '—'}`, 774, 34);
  state.players.forEach((player, index) => { ctx.fillStyle = player.color; ctx.fillRect(775, 43 + index * 15, 7, 7); ctx.fillStyle = '#fff'; ctx.fillText(`${player.name} · ${player.archetype || 'observed'}`, 788, 50 + index * 15); });
  const target = mine && relics().filter((relic) => !relic.collectedBy).map((relic) => ({ relic, ...mapPoint(relic) })).sort((a, b) => Math.hypot(mine.x - a.x, mine.y - a.y) - Math.hypot(mine.x - b.x, mine.y - b.y))[0];
  if (target && mine) { panel(325, 14, 265, 43); const dx = target.x - mine.x, dy = target.y - mine.y; const arrow = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '→' : '←') : (dy > 0 ? '↓' : '↑'); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText(`RELIC SIGNAL ${arrow} ${target.relic.id.replaceAll('-', ' ')}`, 338, 40); }
  if (mine?.archetype || abilities().length) { panel(14, 88, 365, 50); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#f4c7ff'; ctx.fillText(`ROLE · ${mine?.archetype || 'UNREAD'}`, 27, 108); ctx.fillStyle = '#fff7d5'; ctx.font = '10px monospace'; wrap(abilities().slice(0, 4).join(' · ') || 'Your unique ability will emerge from the Game Master.', 27, 125, 335, 12); }
  if (state.privateRule) { panel(14, 146, 365, 58); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#f4c7ff'; ctx.fillText('A LAW ONLY YOU CAN HEAR', 27, 166); ctx.fillStyle = '#fff7d5'; wrap(state.privateRule.message || state.privateRule.body || state.privateRule.title || '', 27, 184, 335, 12); }
  if (state.world?.finalObjective) { panel(575, 122, 371, 54); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText(state.world.finalObjective.title || 'THE FINAL RITE', 588, 142); ctx.fillStyle = '#fff'; wrap(state.world.finalObjective.description || 'Complete each role’s rite.', 588, 159, 340, 12); }
  if (state.noticeTimer > 0 || !gameReady()) { panel(165, 548, 630, 66); ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5'; wrap(state.notice, 480, 573, 570, 16); }
}
function drawStart() {
  ctx.fillStyle = '#70b957'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 80; i++) { ctx.fillStyle = i % 2 ? '#57a94f' : '#81c963'; ctx.fillRect((i * 79) % 960, (i * 131) % 640, 16, 16); }
  ctx.textAlign = 'center'; ctx.font = 'bold 54px monospace'; ctx.fillStyle = C.ink; ctx.fillText('EVERDAWN', 482, 179); ctx.fillStyle = '#fff3b8'; ctx.fillText('EVERDAWN', 480, 175);
  ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#fff9de'; ctx.fillText('A four-player living tale.', 480, 215);
  panel(245, 264, 470, 128); ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#f8de90'; ctx.fillText('THE WORLD OPENS ONLY FOR FOUR.', 480, 296); ctx.font = '11px monospace'; ctx.fillStyle = '#e4f1dc'; ctx.fillText('Each wanderer receives a distinct role and a unique ability.', 480, 328); ctx.fillText('No solo expedition. Bring three companions with the same room code.', 480, 353); ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#ffef9c'; ctx.fillText('CLICK TO LIGHT A LANTERN', 480, 445);
}
function drawLobby() {
  ctx.fillStyle = 'rgba(20, 42, 57, .74)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  panel(212, 214, 536, 188); ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('GATHERING THE EXPEDITION', 480, 255); ctx.font = 'bold 44px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${roomPlayerCount()} / 4`, 480, 315); ctx.font = '12px monospace'; ctx.fillStyle = '#d2f0cf'; ctx.fillText('The game begins exactly when four lanterns are present.', 480, 347); ctx.fillText(`Room code: ${state.network.roomCode || '—'}`, 480, 374);
}
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.joined) { drawStart(); return; }
  const minX = Math.floor(state.camera.x - 25), maxX = Math.ceil(state.camera.x + 25), minY = Math.floor(state.camera.y - 17), maxY = Math.ceil(state.camera.y + 17);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) drawTile(x, y);
  (state.world?.terrain || []).forEach(drawTerrain);
  activeEntities().forEach(drawEntity);
  state.players.forEach(character); state.players.forEach((player) => label(player.name, player.x, player.y, player.color));
  drawHUD();
  if (!gameReady()) drawLobby();
}

let last = performance.now();
function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; update(dt); render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
window.render_game_to_text = () => JSON.stringify({ mode: state.joined ? (gameReady() ? 'adventure' : 'lobby') : 'title', room: state.network.roomCode, playerCount: roomPlayerCount(), phase: state.world?.phase || 'unjoined', player: state.mine && { x: +state.mine.x.toFixed(1), y: +state.mine.y.toFixed(1), archetype: state.mine.archetype }, relics: relics().filter((relic) => !relic.collectedBy).map((relic) => relic.id), abilities: abilities(), finalObjective: state.world?.finalObjective?.status || null });
