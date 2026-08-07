import { buildDirectorInstruction, normalizeDirectorState } from './director-copy.js';
import { buildEmergentInstruction, normalizeEmergentState } from './emergent-copy.js';

// Canvas presentation only.  Keep visual changes here; game state lives in
// session.js and remains server-authoritative.
const T = 20, W = 60, H = 34;
const C = { grass: '#72bd58', ink: '#27324a', gold: '#f7d25c', purple: '#9b75c9' };

export function createRenderer(canvas, session) {
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const art = {}, templeArt = {}; let authoredForest = null, templeMap = null; const trialMaps = {};
  const { state, mapPoint, relics, activeEntities, abilities, gameReady } = session;
  const image = new Image(); image.src = '/game-art/camping-32.png'; image.addEventListener('load', () => { art.camping = image; render(); });
  [['trialTerrain', '/game-art/guardian-trials/terrain-map4.png'], ['trialGarden', '/game-art/guardian-trials/garden-map4.png'], ['trialVillas', '/game-art/guardian-trials/villas-map4.png'], ['player1', '/game-art/retro-characters/player-1.png'], ['player2', '/game-art/retro-characters/player-2.png'], ['player3', '/game-art/retro-characters/player-3.png'], ['player4', '/game-art/retro-characters/player-5.png']].forEach(([key, src]) => { const asset = new Image(); asset.src = src; asset.addEventListener('load', () => { art[key] = asset; render(); }); });
  fetch('/game-art/forest.json').then((response) => response.ok ? response.json() : null).then((layout) => { authoredForest = layout; render(); }).catch(() => {});
  [['guardian-garden', '/game-art/guardian-trials/guardian-garden.json'], ['guardian-mountain', '/game-art/guardian-trials/mountain.json']].forEach(([key, src]) => fetch(src).then((response) => response.ok ? response.json() : null).then((layout) => { if (layout) { trialMaps[key] = layout; render(); } }).catch(() => {}));
  fetch('/game-art/finale/ancient-temple.json').then((response) => response.ok ? response.json() : null).then((layout) => {
    if (!layout) return;
    templeMap = layout;
    for (const [key, src] of Object.entries(layout.assets || {})) {
      const asset = new Image(); asset.src = src; asset.addEventListener('load', () => { templeArt[key] = asset; render(); });
    }
    render();
  }).catch(() => {});

  function px(x) { return Math.floor(x * T - (state.camera.x * T - canvas.width / 2)); }
  function py(y) { return Math.floor(y * T - (state.camera.y * T - canvas.height / 2)); }
  function panel(x, y, w, h) { ctx.fillStyle = 'rgba(29,47,68,.9)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#f5dd8a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
  function sheetTile(gid, X, Y) { const tile = gid - 1, columns = Math.floor(art.camping.width / 32); ctx.drawImage(art.camping, (tile % columns) * 32, Math.floor(tile / columns) * 32, 32, 32, X, Y, T, T); }
  function drawTile(x, y) { const X = px(x), Y = py(y), index = y * W + x; if (!authoredForest || !art.camping || x < 0 || y < 0 || x >= W || y >= H) { ctx.fillStyle = C.grass; ctx.fillRect(X, Y, T, T); return; } for (const layer of authoredForest.layers || []) { const gid = layer.data?.[index] || 0; if (gid) sheetTile(gid, X, Y); } }
  function drawTerrain(area) { const point = mapPoint(area), width = Math.max(1, Number(area.w) || 1) * T, height = Math.max(1, Number(area.h) || 1) * T, kind = String(area.kind || '').toLowerCase(); if (kind.includes('water')) { ctx.fillStyle = 'rgba(57,161,211,.72)'; ctx.fillRect(px(point.x), py(point.y), width, height); } else if (kind.includes('bridge')) { ctx.fillStyle = '#7d5536'; ctx.fillRect(px(point.x), py(point.y) + 6, width, Math.max(7, height - 10)); } else if (kind.includes('spirit')) { ctx.fillStyle = 'rgba(123,80,175,.42)'; ctx.fillRect(px(point.x), py(point.y), width, height); } else { ctx.fillStyle = 'rgba(208,194,112,.58)'; ctx.fillRect(px(point.x), py(point.y), width, height); } }
  function drawEntity(entity) { const X = px(entity.x), Y = py(entity.y), kind = String(entity.kind || entity.type || '').toLowerCase(); if (kind.includes('relic')) { ctx.fillStyle = C.gold; ctx.fillRect(X + 6, Y + 4, 8, 12); ctx.fillStyle = '#fff4b5'; ctx.fillRect(X + 8, Y + 2, 4, 5); } else if (kind.includes('gate') || kind.includes('spirit')) { ctx.fillStyle = '#4f376f'; ctx.fillRect(X + 3, Y + 2, 14, 16); ctx.fillStyle = '#d9b4ff'; ctx.fillRect(X + 6, Y + 5, 8, 11); } else if (kind.includes('shrine')) { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 3, Y + 7, 14, 10); ctx.fillStyle = C.purple; ctx.fillRect(X + 7, Y + 1, 6, 9); } else if (kind.includes('temple') || kind.includes('altar')) { ctx.fillStyle = '#b9a882'; ctx.fillRect(X, Y + 5, 20, 15); ctx.fillStyle = kind.includes('altar') ? C.gold : '#706879'; ctx.fillRect(X + 7, Y + 8, 6, 12); } else { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 4, Y + 4, 12, 12); } }
  function character(player, X = px(player.x), Y = py(player.y), size = T) { const key = `player${(state.players.findIndex((entry) => entry.id === player.id) + 1) || 1}`, sprite = art[key] || art.player1; if (sprite) ctx.drawImage(sprite, 0, 0, 24, 32, Math.floor(X + size * .12), Math.floor(Y - size * .15), Math.floor(size * .76), Math.floor(size * 1.02)); else { ctx.fillStyle = player.color; ctx.fillRect(X + 5, Y + 5, 8, 8); } if (player.id === state.mine?.id) { ctx.strokeStyle = '#fff5b4'; ctx.lineWidth = 2; ctx.strokeRect(X + 1, Y + 1, size - 2, size - 2); } }
  function label(text, x, y, color = '#fff7d5') { ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.fillText(text, px(x) + 1, py(y) - 6); ctx.fillStyle = color; ctx.fillText(text, px(x), py(y) - 7); }
  function wrap(text, x, y, max, line) { const words = String(text || '').split(' '); let current = '', yy = y; for (const word of words) { if (ctx.measureText(`${current}${word}`).width > max) { ctx.fillText(current, x, yy); current = `${word} `; yy += line; } else current += `${word} `; } ctx.fillText(current, x, yy); }
  function drawDirectorHud() {
    const { directives } = normalizeDirectorState(state.world, state.network.playerId);
    if (!directives.length) return;
    const instruction = buildDirectorInstruction(state.world, state.network.playerId);
    panel(14, 214, 365, 56); ctx.textAlign = 'left'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#9de3ff'; ctx.fillText('THE GAME MASTER SHIFTS THE WORLD', 27, 234); ctx.fillStyle = '#fff7d5'; ctx.font = '10px monospace'; wrap(instruction, 27, 251, 335, 12);
  }
  function drawEmergentMarker(marker) { const point = mapPoint(marker); ctx.save(); ctx.translate(px(point.x) + 10, py(point.y) + 10); ctx.rotate(Math.PI / 4); ctx.fillStyle = 'rgba(181,236,255,.88)'; ctx.fillRect(-5, -5, 10, 10); ctx.strokeStyle = '#fff4b5'; ctx.strokeRect(-5, -5, 10, 10); ctx.restore(); }
  function drawEmergentHud() {
    const { rules, status } = normalizeEmergentState(state.world, state.network.playerId);
    if (!rules.length && !status.available) return;
    const instruction = buildEmergentInstruction(state.world, state.network.playerId);
    panel(14, 278, 365, 58); ctx.textAlign = 'left'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#b7f1ff';
    const energy = status.energy === null ? 'ENERGY UNKNOWN' : `ENERGY ${Math.round(status.energy)}/${Math.round(status.maxEnergy)} · ${status.label.toUpperCase()}`;
    ctx.fillText(`A LAW HAS EMERGED · ${energy}`, 27, 298); ctx.fillStyle = '#fff7d5'; ctx.font = '10px monospace'; wrap(instruction || rules[0]?.message, 27, 317, 335, 12);
  }
  function drawHud() { const mine = state.mine; panel(14, 14, 306, 62); ctx.textAlign = 'left'; ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('EVERDAWN', 27, 35); ctx.font = '11px monospace'; ctx.fillStyle = '#d2f0cf'; ctx.fillText(!state.network.connected ? 'CONNECTING TO THE WORLD…' : !gameReady() ? `GATHERING LANTERNS · ${state.players.length}/4` : state.world?.phase === 'observing' ? `THE GM OBSERVES · ${state.world.observationSecondsRemaining ?? '?'}s` : `YOUR ROLE · ${mine?.archetype || 'awakening'}`, 27, 55); panel(600, 14, 148, 43); ctx.font = '10px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText('MOVE  WASD / ARROWS', 613, 33); ctx.fillText('INTERACT  E  ·  FULLSCREEN  F', 613, 48); panel(760, 14, 186, 104); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText(`LANTERNS · ${state.network.roomCode || '—'}`, 774, 34); state.players.forEach((player, index) => { ctx.fillStyle = player.color; ctx.fillRect(775, 43 + index * 15, 7, 7); ctx.fillStyle = '#fff'; ctx.fillText(`${player.name} · ${player.archetype || 'observed'}`, 788, 50 + index * 15); }); const target = mine && relics().filter((r) => !r.collectedBy).map((r) => ({ relic: r, ...mapPoint(r) })).sort((a, b) => Math.hypot(mine.x - a.x, mine.y - a.y) - Math.hypot(mine.x - b.x, mine.y - b.y))[0]; if (target) { panel(325, 14, 265, 43); ctx.fillText(`RELIC SIGNAL ${target.relic.id.replaceAll('-', ' ')}`, 338, 40); } if (mine?.archetype || abilities().length) { panel(14, 88, 365, 50); ctx.fillStyle = '#f4c7ff'; ctx.fillText(`ROLE · ${mine?.archetype || 'UNREAD'}`, 27, 108); ctx.fillStyle = '#fff7d5'; wrap(abilities().slice(0, 4).join(' · '), 27, 125, 335, 12); } if (state.privateRule) { panel(14, 146, 365, 58); ctx.fillStyle = '#f4c7ff'; ctx.fillText('A LAW ONLY YOU CAN HEAR', 27, 166); ctx.fillStyle = '#fff7d5'; wrap(state.privateRule.message || state.privateRule.title, 27, 184, 335, 12); } if (state.noticeTimer > 0 || !gameReady()) { panel(165, 548, 630, 66); ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5'; wrap(state.notice, 480, 573, 570, 16); } }
  function map4Tile(sourceX, sourceY, x, y, size = 32) { if (art.trialTerrain) ctx.drawImage(art.trialTerrain, sourceX, sourceY, 32, 32, Math.round(x), Math.round(y), size, size); else { ctx.fillStyle = '#78bd5d'; ctx.fillRect(x, y, size, size); } }
  function map4Patch(sourceX, sourceY, x, y, width, height, tile = 28) { for (let yy = y; yy < y + height; yy += tile) for (let xx = x; xx < x + width; xx += tile) map4Tile(sourceX, sourceY, xx, yy, tile); }
  function drawTiledTrialMap(box, mapKey, view = {}) {
    const map = trialMaps[mapKey]; if (!map) return false;
    const sources = { '1_Terrains_and_Fences_32x32': art.trialTerrain, '17_Garden_32x32': art.trialGarden, '7_Villas_32x32': art.trialVillas };
    const sets = [...(map.tilesets || [])].sort((a, b) => Number(a.firstgid) - Number(b.firstgid)); if (!sets.length) return false;
    const tile = Number(view.tile || 12), startX = Math.max(0, Number(view.startX || 0)), startY = Math.max(0, Number(view.startY || 0)), mapW = Math.ceil(box.w / tile), mapH = Math.ceil(box.h / tile), x = Math.round(box.x + (box.w - mapW * tile) / 2), y = Math.round(box.y + (box.h - mapH * tile) / 2);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); ctx.fillStyle = '#4d9d5f'; ctx.fillRect(box.x, box.y, box.w, box.h);
    for (const layer of map.layers || []) { if (!Array.isArray(layer.data)) continue; for (let row = 0; row < mapH; row += 1) for (let col = 0; col < mapW; col += 1) { const sourceRow = startY + row, sourceCol = startX + col; if (sourceRow >= Number(map.height || H) || sourceCol >= Number(map.width || W)) continue; const gid = Number(layer.data[sourceRow * Number(map.width || W) + sourceCol] || 0); if (!gid) continue; const set = sets.filter((entry) => Number(entry.firstgid) <= gid).at(-1); const source = sources[set?.name]; if (!source) continue; const tileIndex = gid - Number(set.firstgid), columns = Math.floor(source.width / 32); ctx.drawImage(source, (tileIndex % columns) * 32, Math.floor(tileIndex / columns) * 32, 32, 32, x + col * tile, y + row * tile, tile, tile); } }
    ctx.restore(); return true;
  }
  // Map4's terrain sheet has several transition tiles next to the clean grass.
  // Keep those transitions at authored edges; using them as a random floor created
  // the noisy, repeated "spike" pattern that made the trials look unfinished.
  function grassFloor(box) { ctx.fillStyle = '#4d9d5f'; ctx.fillRect(box.x, box.y, box.w, box.h); }
  function waterBody(points, tile = 28) {
    ctx.save(); ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = '#3d9bca'; ctx.fill(); ctx.clip();
    const minX = Math.min(...points.map(([x]) => x)), maxX = Math.max(...points.map(([x]) => x)), minY = Math.min(...points.map(([, y]) => y)), maxY = Math.max(...points.map(([, y]) => y));
    // 608+ is the open-water portion of the Map4 autotile.  The 512–576
    // tiles are shoreline transitions, so they must never be used as the
    // middle of a lake or river.
    ctx.globalAlpha = .34; for (let y = minY + tile; y < maxY - tile / 2; y += tile) for (let x = minX; x < maxX; x += tile) map4Tile(608, 352, x, y, tile); ctx.globalAlpha = 1;
    ctx.restore(); ctx.save(); ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.strokeStyle = '#257fa9'; ctx.lineWidth = 5; ctx.stroke(); ctx.restore();
  }
  function completeTreehouse(x, y) { if (art.trialVillas) ctx.drawImage(art.trialVillas, 256, 1504, 288, 288, x, y, 176, 176); }
  function flowerBed(x, y, variant = 0) { if (!art.trialGarden) return; const choices = [[0, 1728], [128, 1728], [256, 1760], [384, 1792], [512, 1824]]; const [sx, sy] = choices[variant % choices.length]; ctx.drawImage(art.trialGarden, sx, sy, 96, 64, x, y, 72, 48); }
  function gardenFountain(x, y, variant = 0) { if (!art.trialGarden) return; const sources = [[320, 704], [416, 704], [512, 704], [608, 704]]; const [sx, sy] = sources[variant % sources.length]; ctx.drawImage(art.trialGarden, sx, sy, 96, 160, x, y, 60, 100); }
  function terrainIsland(x, y) { if (art.trialTerrain) ctx.drawImage(art.trialTerrain, 256, 192, 96, 96, x, y, 96, 96); }
  function stonePath(x, y, width, height, tile = 28) { map4Patch(0, 672, x, y, width, height, tile); }
  function trialBackdrop(box, theme) {
    const tile = 28; grassFloor(box);
    const mapKey = theme === 'mountain-pass' || theme === 'shrine-garden' ? 'guardian-mountain' : 'guardian-garden';
    const view = theme === 'sunlit-grove' ? { startX: 0, startY: 10, tile: 16 } : theme === 'mountain-pass' ? { startX: 0, startY: 12, tile: 19 } : theme === 'shrine-garden' ? { startX: 24, startY: 12, tile: 19 } : {};
    if (drawTiledTrialMap(box, mapKey, view)) { ctx.strokeStyle = '#315f49'; ctx.lineWidth = 5; ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4); return; }
    // Every scene begins with a different, deliberate composition rather than a
    // procedural tile soup.  All props below are Map4 crops from the paid pack.
    if (theme === 'sunlit-grove') {
      waterBody([[box.x, box.y + 214], [box.x + 130, box.y + 184], [box.x + 286, box.y + 192], [box.x + 430, box.y + 172], [box.x + box.w, box.y + 202], [box.x + box.w, box.y + 310], [box.x + 474, box.y + 284], [box.x + 310, box.y + 296], [box.x + 142, box.y + 276], [box.x, box.y + 302]], tile);
      stonePath(box.x + 246, box.y + 220, 182, 40, tile);
    }
    if (theme === 'campfire-clearing') {
      stonePath(box.x + 220, box.y + 156, 230, 126, tile);
      completeTreehouse(box.x + 28, box.y + 18); flowerBed(box.x + box.w - 152, box.y + 114, 0);
      gardenFountain(box.x + box.w * .455, box.y + box.h * .36, 2);
      ctx.fillStyle = '#f2bf51'; ctx.fillRect(box.x + box.w * .49, box.y + box.h * .48, 16, 16);
      ctx.fillStyle = '#fff2a0'; ctx.fillRect(box.x + box.w * .49 + 4, box.y + box.h * .48 - 4, 8, 9);
      forestCluster(box.x + 8, box.y + box.h - 88); forestCluster(box.x + box.w - 112, box.y + box.h - 88, true);
    }
    if (theme === 'mountain-pass') {
      ctx.fillStyle = '#7a9669'; ctx.fillRect(box.x, box.y, box.w, 88); ctx.fillRect(box.x, box.y + box.h - 88, box.w, 88);
      map4Patch(832, 416, box.x, box.y + 22, box.w, 64, tile); map4Patch(832, 416, box.x, box.y + box.h - 86, box.w, 64, tile);
      stonePath(box.x, box.y + box.h / 2 - 30, box.w, 60, tile);
    }
    if (theme === 'shrine-garden') {
      waterBody([[box.x + 170, box.y + 154], [box.x + 272, box.y + 118], [box.x + 444, box.y + 122], [box.x + 526, box.y + 182], [box.x + 548, box.y + 288], [box.x + 486, box.y + 352], [box.x + 354, box.y + 374], [box.x + 230, box.y + 342], [box.x + 146, box.y + 270]], tile);
      terrainIsland(box.x + 290, box.y + 214); stonePath(box.x + 320, box.y + 300, 42, 90, tile);
      flowerBed(box.x + 142, box.y + 136, 4); flowerBed(box.x + box.w - 214, box.y + 136, 3);
      gardenFountain(box.x + box.w * .46, box.y + box.h * .33, 3);
    }
    ctx.strokeStyle = '#315f49'; ctx.lineWidth = 5; ctx.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);
  }
  function drawGuardianAngel(ward, point, restored) {
    ctx.save();
    ctx.globalAlpha = restored ? .58 : 1;
    // This statue is a complete 5x10-tile composition in the Map4 garden
    // sheet. The previous crop began halfway down it, clipping its halo,
    // wings, and pedestal before stretching the remainder into place.
    if (art.trialGarden) ctx.drawImage(art.trialGarden, 0, 544, 160, 320, point.x - 24, point.y - 72, 48, 96);
    else { ctx.fillStyle = '#78685e'; ctx.fillRect(point.x - 15, point.y - 20, 30, 35); }
    ctx.restore();
    ctx.fillStyle = restored ? '#bff7cf' : '#f7d776';
    ctx.fillRect(point.x - 4, point.y - 38, 8, 8);
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#19354a';
    ctx.fillText(ward.label, point.x, point.y - 77);
  }
  function drawGuardianTrial() {
    const trialState = state.world?.guardianTrial, trial = trialState?.activeTrial;
    if (!trial) return false;
    ctx.fillStyle = '#bde7e9'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const box = { x: 144, y: 108, w: 672, h: 424 };
    trialBackdrop(box, trial.map);
    const toScreen = (point) => ({ x: box.x + (point.x / trial.bounds.maxX) * box.w, y: box.y + (point.z / trial.bounds.maxZ) * box.h });
    for (const ward of trial.objectives) drawGuardianAngel(ward, toScreen(ward), trialState.activatedObjectiveIds.includes(ward.id));
    const playerPoint = toScreen(trialState.position || trial.spawn);
    character(state.mine, playerPoint.x - 14, playerPoint.y - 14, 28);
    const mechanic = trialState.mechanic || {}, channelLeft = Math.max(0, Number(mechanic.channelEndsAt || 0) - Date.now());
    if (mechanic.carriedLanternId) { ctx.fillStyle = '#fff3a2'; ctx.beginPath(); ctx.arc(playerPoint.x, playerPoint.y - 23, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e28c39'; ctx.fillRect(playerPoint.x - 2, playerPoint.y - 27, 4, 8); }
    if (mechanic.channelObjectiveId) { ctx.strokeStyle = '#d8f6dc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(playerPoint.x, playerPoint.y, 22, 0, Math.PI * 2 * Math.min(1, 1 - channelLeft / 1500)); ctx.stroke(); }
    const status = mechanic.id === 'ordered-circuit' ? `SEQUENCE ${trialState.activatedObjectiveIds.length + 1}/${trial.objectives.length} · MOVE + E`
      : mechanic.id === 'carry-lanterns' ? (mechanic.carriedLanternLabel ? `CARRYING ${mechanic.carriedLanternLabel.toUpperCase()} · RETURN TO HEARTH` : `FLAMES DELIVERED ${mechanic.deliveredLanternIds?.length || 0}/2 · MOVE + E`)
        : mechanic.id === 'timed-relay' ? (mechanic.blessingExpiresAt ? `BLESSING ${Math.max(0, Math.ceil((mechanic.blessingExpiresAt - Date.now()) / 1000))}s · RUN THE RELAY` : 'BEGIN THE RELAY · MOVE + E')
          : mechanic.channelObjectiveId ? `CHANNELING ${Math.ceil(channelLeft / 1000)}s · DO NOT MOVE` : `CLEANSED ${trialState.activatedObjectiveIds.length}/${trial.objectives.length} · MOVE + E`;
    panel(20, 18, 920, 74); ctx.textAlign = 'left'; ctx.font = 'bold 18px monospace'; ctx.fillStyle = '#fff3bd'; ctx.fillText(`GUARDIAN SANCTUM · ${trial.title.toUpperCase()}`, 38, 45); ctx.font = '11px monospace'; ctx.fillStyle = '#ddf3e7'; wrap(trial.rule, 38, 65, 650, 13); ctx.fillStyle = '#f7d776'; ctx.fillText(status, 708, 65);
    panel(20, 548, 920, 68); ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5'; wrap(state.publicEvent || 'The Game Master watches the paths you choose.', 480, 575, 850, 16);
    return true;
  }
  const TEMPLE_ROLE_COLORS = { Explorer: '#76d7c4', Collector: '#f3c969', Guardian: '#83b9f5', Loner: '#c999ed' };
  function templeLayer(name) { return templeMap?.layers?.find((layer) => layer.name === name); }
  function templeMapPoint(point) {
    const tile = Number(templeMap?.tilewidth || 16), world = templeMap?.world || { offsetX: 6, offsetZ: 4 };
    return { x: (Number(point?.x) + Number(world.offsetX || 0)) * tile, y: (Number(point?.z) + Number(world.offsetZ || 0)) * tile };
  }
  function templeView(box, focus = null) {
    const width = Number(templeMap?.width || 60) * Number(templeMap?.tilewidth || 16), height = Number(templeMap?.height || 40) * Number(templeMap?.tileheight || 16);
    if (!focus) return { x: 0, y: 0, w: width, h: height, scaleX: box.w / width, scaleY: box.h / height };
    const center = templeMapPoint(focus), viewW = box.w, viewH = box.h;
    return { x: Math.max(0, Math.min(width - viewW, center.x - viewW / 2)), y: Math.max(0, Math.min(height - viewH, center.y - viewH / 2)), w: viewW, h: viewH, scaleX: 1, scaleY: 1 };
  }
  function templeScreenPoint(box, view, mapX, mapY) { return { x: box.x + (mapX - view.x) * view.scaleX, y: box.y + (mapY - view.y) * view.scaleY }; }
  function drawTempleZone(box, view, zone) {
    const tile = Number(templeMap?.tilewidth || 16), palette = templeMap?.palette || {}, mapX = zone.x * tile, mapY = zone.y * tile, mapW = zone.width * tile, mapH = zone.height * tile;
    const p = templeScreenPoint(box, view, mapX, mapY), w = mapW * view.scaleX, h = mapH * view.scaleY;
    if (zone.type === 'outer') {
      ctx.fillStyle = palette.outer || '#293e45'; ctx.fillRect(p.x, p.y, w, h);
      for (let yy = mapY; yy < mapY + mapH; yy += tile) for (let xx = mapX; xx < mapX + mapW; xx += tile) { const q = templeScreenPoint(box, view, xx, yy); ctx.strokeStyle = (Math.floor(xx / tile) + Math.floor(yy / tile)) % 2 ? '#40535a' : '#344951'; ctx.strokeRect(q.x, q.y, tile * view.scaleX, tile * view.scaleY); }
      return;
    }
    if (zone.type === 'grass') {
      ctx.fillStyle = palette.grass || '#648b68'; ctx.fillRect(p.x, p.y, w, h);
      for (let yy = mapY; yy < mapY + mapH; yy += tile) for (let xx = mapX; xx < mapX + mapW; xx += tile) { const q = templeScreenPoint(box, view, xx, yy); ctx.fillStyle = (Math.floor(xx / tile) + Math.floor(yy / tile)) % 3 ? (palette.grass || '#648b68') : (palette.grassLight || '#719873'); ctx.fillRect(q.x, q.y, tile * view.scaleX, tile * view.scaleY); }
      return;
    }
    if (zone.type === 'stone') {
      ctx.fillStyle = palette.stone || '#9ba5a0'; ctx.fillRect(p.x, p.y, w, h);
      for (let yy = mapY; yy < mapY + mapH; yy += tile) for (let xx = mapX; xx < mapX + mapW; xx += tile) { const q = templeScreenPoint(box, view, xx, yy); ctx.fillStyle = (Math.floor(xx / tile) + Math.floor(yy / tile)) % 2 ? (palette.stone || '#9ba5a0') : (palette.stoneLight || '#b5bbb1'); ctx.fillRect(q.x + 1, q.y + 1, tile * view.scaleX - 2, tile * view.scaleY - 2); }
      ctx.strokeStyle = palette.stoneDark || '#6e7d7b'; ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, w, h); return;
    }
    if (zone.type.startsWith('court-')) {
      const role = zone.type.slice(6), color = { explorer: '#7bcaba', collector: '#d9b95d', guardian: '#75a8d7', loner: '#aa82c7' }[role] || '#9ba5a0';
      ctx.fillStyle = palette.garden || '#456c58'; ctx.fillRect(p.x, p.y, w, h); ctx.fillStyle = palette.stone || '#9ba5a0'; ctx.fillRect(p.x + 8 * view.scaleX, p.y + 8 * view.scaleY, w - 16 * view.scaleX, h - 16 * view.scaleY); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(p.x + 5, p.y + 5, w - 10, h - 10); return;
    }
    if (zone.type === 'nexus') {
      ctx.fillStyle = palette.stoneDark || '#6e7d7b'; ctx.fillRect(p.x, p.y, w, h); ctx.fillStyle = palette.stoneLight || '#b5bbb1'; ctx.fillRect(p.x + 10, p.y + 10, w - 20, h - 20); ctx.strokeStyle = '#f2d887'; ctx.lineWidth = 3; ctx.strokeRect(p.x + 18, p.y + 18, w - 36, h - 36);
    }
  }
  function drawTempleMap(box, focus = null) {
    const view = templeView(box, focus), tile = Number(templeMap?.tilewidth || 16);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = templeMap?.palette?.outer || '#293e45'; ctx.fillRect(box.x, box.y, box.w, box.h);
    for (const zone of templeLayer('Terrain')?.objects || []) drawTempleZone(box, view, zone);
    for (const prop of [...(templeLayer('Architecture and Gardens')?.objects || [])].sort((a, b) => a.y - b.y)) {
      const asset = templeArt[prop.asset]; if (!asset) continue; const p = templeScreenPoint(box, view, prop.x * tile, prop.y * tile);
      const width = asset.width * view.scaleX, height = asset.height * view.scaleY;
      // A split camera should never show half a chapel, tree, or gate. Small
      // ground details may cross the edge naturally; large structures must be
      // fully contained in the pane or remain outside it.
      if (focus && (width > 32 || height > 32) && (p.x < box.x || p.y < box.y || p.x + width > box.x + box.w || p.y + height > box.y + box.h)) continue;
      ctx.drawImage(asset, Math.round(p.x), Math.round(p.y), Math.round(width), Math.round(height));
    }
    ctx.restore(); return view;
  }
  function drawTemplePillar(box, view, pane, compact = false) {
    const mapPoint = templeMapPoint(pane.pedestal), p = templeScreenPoint(box, view, mapPoint.x, mapPoint.y), color = TEMPLE_ROLE_COLORS[pane.archetype] || '#f2d887', size = compact ? 26 : 32;
    ctx.save(); ctx.globalAlpha = pane.pillarActivated ? .9 : .48; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, compact ? 22 : 29, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    const monument = templeArt[pane.archetype === 'Explorer' || pane.archetype === 'Guardian' ? 'monument1' : 'monument2'];
    if (monument) ctx.drawImage(monument, Math.round(p.x - size / 2), Math.round(p.y - size * .78), size, size); else { ctx.fillStyle = color; ctx.fillRect(p.x - 8, p.y - 18, 16, 22); }
    ctx.strokeStyle = pane.pillarActivated ? '#fff5b7' : color; ctx.lineWidth = 2; ctx.strokeRect(p.x - size / 2 - 2, p.y - size * .78 - 2, size + 4, size + 4); ctx.restore();
    if (!compact) { ctx.textAlign = 'center'; ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#f9f2d6'; ctx.fillText(pane.archetype.toUpperCase(), p.x, p.y + 24); }
  }
  function drawSharedTemple(temple) {
    const box = { x: 0, y: 0, w: canvas.width, h: canvas.height }, view = drawTempleMap(box), panes = temple.panes || [];
    for (const pane of panes) drawTemplePillar(box, view, pane);
    for (const pane of panes) { const mapPoint = templeMapPoint(pane.position), p = templeScreenPoint(box, view, mapPoint.x, mapPoint.y); character({ ...pane, color: TEMPLE_ROLE_COLORS[pane.archetype] }, p.x - 10, p.y - 13, 22); }
    panel(190, 4, 580, 64); ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#fff3bd'; ctx.fillText('THE ANCIENT TEMPLE · GATHER AT YOUR CALLING', 480, 27); ctx.font = '10px monospace'; ctx.fillStyle = '#dff0df'; ctx.fillText(`${panes.filter((pane) => pane.atPedestal).length}/4 BEARERS IN POSITION · THE VISION DIVIDES WHEN ALL ARRIVE`, 480, 45); ctx.fillStyle = '#fff7d5'; ctx.fillText('FOLLOW THE STONE AVENUES TO YOUR ARCHETYPE COURT', 480, 60);
  }
  function drawSplitTemple(temple) {
    const panes = temple.panes || [], cells = [[0, 0], [480, 0], [0, 320], [480, 320]];
    ctx.fillStyle = '#172f43'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    panes.forEach((pane, index) => {
      const [x, y] = cells[index], box = { x: x + 4, y: y + 4, w: 472, h: 312 }, view = drawTempleMap(box, pane.position);
      drawTemplePillar(box, view, pane, true); const mapPoint = templeMapPoint(pane.position), p = templeScreenPoint(box, view, mapPoint.x, mapPoint.y); character({ ...pane, color: TEMPLE_ROLE_COLORS[pane.archetype] }, p.x - 11, p.y - 13, 22);
      ctx.fillStyle = 'rgba(24,42,52,.8)'; ctx.fillRect(box.x + 6, box.y + 6, 250, 38); ctx.textAlign = 'left'; ctx.font = 'bold 11px monospace'; ctx.fillStyle = TEMPLE_ROLE_COLORS[pane.archetype] || '#fff3bd'; ctx.fillText(`${pane.name} · ${pane.archetype}`, box.x + 13, box.y + 21); ctx.font = '10px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${pane.completedObjectives}/2 RITES · ${pane.pillarActivated ? 'PILLAR AWAKE' : pane.atPedestal ? 'PRESS E' : 'RETURN TO YOUR PILLAR'}`, box.x + 13, box.y + 37);
      ctx.strokeStyle = pane.id === state.network.playerId ? '#fff1a4' : (TEMPLE_ROLE_COLORS[pane.archetype] || '#6b8c94'); ctx.lineWidth = 3; ctx.strokeRect(x + 2, y + 2, 476, 316);
    });
    panel(226, 273, 508, 94); ctx.textAlign = 'center'; ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#fff3bd'; ctx.fillText(temple.status === 'won' ? 'EVERDAWN REMEMBERS YOUR LEGEND' : 'FOUR VISIONS · ONE FINAL RITE', 480, 300); ctx.font = '11px monospace'; ctx.fillStyle = '#e3f3eb'; wrap(temple.narration?.at(-1)?.message || 'All four have gathered. Remain at your pillar and press E.', 480, 322, 460, 15);
    if (temple.status === 'won') { ctx.fillStyle = 'rgba(253,220,112,.3)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }
  function drawTempleFinale() {
    const temple = state.world?.templeFinale; if (!temple) return false;
    if (temple.status === 'assembling') drawSharedTemple(temple); else drawSplitTemple(temple);
    return true;
  }
  function drawStart() { ctx.fillStyle = '#70b957'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textAlign = 'center'; ctx.font = 'bold 54px monospace'; ctx.fillStyle = C.ink; ctx.fillText('EVERDAWN', 482, 179); ctx.fillStyle = '#fff3b8'; ctx.fillText('EVERDAWN', 480, 175); ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#fff9de'; ctx.fillText('A four-player living tale.', 480, 215); panel(245, 264, 470, 128); ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#f8de90'; ctx.fillText('THE WORLD OPENS ONLY FOR FOUR.', 480, 296); ctx.font = '11px monospace'; ctx.fillStyle = '#e4f1dc'; ctx.fillText('Each wanderer receives a distinct role and a unique ability.', 480, 328); ctx.fillText('CLICK TO LIGHT A LANTERN', 480, 445); }
  function drawLobby() { ctx.fillStyle = 'rgba(20,42,57,.74)'; ctx.fillRect(0, 0, canvas.width, canvas.height); panel(212, 214, 536, 188); ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('GATHERING THE EXPEDITION', 480, 255); ctx.font = 'bold 44px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${state.players.length} / 4`, 480, 315); ctx.font = '12px monospace'; ctx.fillStyle = '#d2f0cf'; ctx.fillText('The game begins exactly when four lanterns are present.', 480, 347); }
  function render() { ctx.clearRect(0, 0, canvas.width, canvas.height); if (!state.joined) { drawStart(); return; } if (drawTempleFinale() || drawGuardianTrial()) return; const minX = Math.floor(state.camera.x - 25), maxX = Math.ceil(state.camera.x + 25), minY = Math.floor(state.camera.y - 17), maxY = Math.ceil(state.camera.y + 17); for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) drawTile(x, y); (state.world?.terrain || []).forEach(drawTerrain); const mood = state.world?.director?.mood || state.world?.directorRules?.activeRules?.find((rule) => rule.card === 'world_mood')?.moodId; if (mood === 'mist') { ctx.fillStyle = 'rgba(220,236,242,.18)'; ctx.fillRect(0, 0, canvas.width, canvas.height); } if (mood === 'storm') { ctx.fillStyle = 'rgba(54,67,105,.18)'; ctx.fillRect(0, 0, canvas.width, canvas.height); } if (mood === 'starlight') { ctx.fillStyle = 'rgba(82,57,132,.16)'; ctx.fillRect(0, 0, canvas.width, canvas.height); } (state.world?.emergentRules?.markers || []).forEach(drawEmergentMarker); activeEntities().forEach(drawEntity); state.players.forEach(character); state.players.forEach((player) => label(player.name, player.x, player.y, player.color)); drawHud(); drawDirectorHud(); drawEmergentHud(); if (!gameReady()) drawLobby(); }
  return { render };
}
