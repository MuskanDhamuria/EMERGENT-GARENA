import { buildDirectorInstruction, normalizeDirectorState } from './director-copy.js';
import { buildEmergentInstruction, normalizeEmergentState } from './emergent-copy.js';
import { DARK_CAVE_POINTS, DARK_CAVE_RIFTS, HIDDEN_RUINS_POINTS } from '../shared/game-content.js';

// Canvas presentation only.  Keep visual changes here; game state lives in
// session.js and remains server-authoritative.
const T = 20, W = 60, H = 34;
const C = { grass: '#72bd58', ink: '#27324a', gold: '#f7d25c', purple: '#9b75c9' };

export function createRenderer(canvas, session) {
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const art = {}, templeArt = {}; let authoredForest = null, templeMap = null; const trialMaps = {};
  const { state, mapPoint, relics, activeEntities, abilities, abilityProgress, gameReady } = session;
  const image = new Image(); image.src = '/game-art/camping-32.png'; image.addEventListener('load', () => { art.camping = image; render(); });
  const templeImage = new Image(); templeImage.src = '/game-art/sunken-temple-32.png'; templeImage.addEventListener('load', () => { art.temple = templeImage; render(); });
  const templeDetailImage = new Image(); templeDetailImage.src = '/game-art/sunken-temple-seamless-32.png'; templeDetailImage.addEventListener('load', () => { art.templeDetail = templeDetailImage; render(); });
  const flameImage = new Image(); flameImage.src = '/game-art/temple-flame.png'; flameImage.addEventListener('load', () => { art.flame = flameImage; render(); });
  const loadDecor = (key, source) => { const asset = new Image(); asset.addEventListener('load', () => { art[key] = asset; render(); }); asset.src = source; };
  loadDecor('ruinsArch', '/game-art/decor/ruins-arch.png');
  loadDecor('ruinsStone', '/game-art/decor/ruins-stone.png');
  for (const id of [1, 2, 3, 5]) loadDecor(`player${id}`, `/game-art/retro-characters/player-${id}.png`);
  loadDecor('player4', '/game-art/retro-characters/player-5.png');
  loadDecor('caveGate', '/game-art/dark-cave/gate.png');
  loadDecor('caveTotem', '/game-art/dark-cave/totem.png');
  loadDecor('caveFossil', '/game-art/dark-cave/fossil.png');
  loadDecor('caveCrystalA', '/game-art/dark-cave/crystal-a.png');
  loadDecor('caveCrystalB', '/game-art/dark-cave/crystal-b.png');
  loadDecor('caveBonefire', '/game-art/dark-cave/bonefire.png');
  loadDecor('caveWeb', '/game-art/dark-cave/web.png');
  loadDecor('caveMushroomLarge', '/game-art/dark-cave/mushroom-large.png');
  loadDecor('caveMushroomSmall', '/game-art/dark-cave/mushroom-small.png');
  loadDecor('caveDemonSkull', '/game-art/dark-cave/demon-skull.png');
  loadDecor('claw-fiend', '/game-art/dark-cave/demons/claw-fiend.png');
  loadDecor('bone-wing', '/game-art/dark-cave/demons/bone-wing.png');
  loadDecor('night-blade', '/game-art/dark-cave/demons/night-blade.png');
  loadDecor('mummy-lord', '/game-art/hidden-ruins/mummy-lord.png');
  // Collector and Lantern Rite art arrived with Muskan's branch. Keep these
  // as individual source assets so the merge does not depend on a stale dist
  // bundle and each rite has its own visual language.
  [
    'ancient-coin', 'ancient-idol', 'ancient-vault', 'clue-scroll', 'crystal-mine',
    'glowing-gem-cluster', 'jeweled-goblet', 'ornate-key', 'relic-forge',
    'reliquary-box', 'sunken-crown', 'sunken-relic', 'treasure-cache',
    'vault-flame', 'vault-gem', 'vault-key', 'vault-moon', 'vault-seal',
  ].forEach((key) => loadDecor(key, `/game-art/collector/${key}.png`));
  ['forge-anvil', 'forge-bellows', 'forge-flame', 'forge-hammer', 'forge-hearth', 'forge-ingot', 'quench-oil', 'quench-spirit', 'quench-water'].forEach((key) => loadDecor(key, `/game-art/generated/${key}.png`));
  loadDecor('lanternCore', '/game-art/finale/lantern-core.png');
  loadDecor('lanternFloor', '/game-art/finale/lantern-floor-emblem.png');
  loadDecor('lanternSwitch', '/game-art/finale/lantern-switch.png');
  loadDecor('dungeonTiles', '/game-art/dungeon/Dungeon_Tileset.png');
  loadDecor('moonSky', '/game-art/moon-shrine/sky.png');
  loadDecor('moonShrine', '/game-art/moon-shrine/shrine.png');
  loadDecor('moonBackground', '/game-art/moon-shrine/background.png');
  loadDecor('shadowBackground', '/game-art/shadow-forest/background.png');
  loadDecor('shadowTerrain', '/game-art/shadow-forest/terrain.png');
  loadDecor('shadowExit', '/game-art/shadow-forest/exit.png');
  loadDecor('ghostBackground', '/game-art/ghost-village/background.png');
  loadDecor('ghost', '/game-art/ghost-village/ghost.png');
  loadDecor('ghostShard', '/game-art/ghost-village/shard.png');
  for (let index = 1; index <= 5; index += 1) loadDecor(`sandRuin${index}`, `/game-art/hidden-ruins/sand-ruin-${index}.png`);
  [['trialTerrain', '/game-art/guardian-trials/terrain-map4.png'], ['trialGarden', '/game-art/guardian-trials/garden-map4.png'], ['trialVillas', '/game-art/guardian-trials/villas-map4.png']].forEach(([key, src]) => loadDecor(key, src));
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
  function drawTerrain(area) {
    const point = mapPoint(area), columns = Math.max(1, Number(area.w) || 1), rows = Math.max(1, Number(area.h) || 1), kind = String(area.kind || '').toLowerCase();
    const X = px(point.x), Y = py(point.y), width = columns * T, height = rows * T;
    if (kind.includes('water')) { ctx.fillStyle = 'rgba(57,161,211,.38)'; ctx.fillRect(X, Y, width, height); return; }
    if (kind.includes('bridge')) { ctx.fillStyle = '#6a4931'; ctx.fillRect(X, Y + 6, width, Math.max(7, height - 10)); ctx.fillStyle = '#c3975e'; for (let x = 3; x < width; x += 12) ctx.fillRect(X + x, Y + 7, 8, Math.max(5, height - 12)); return; }
    if (kind.includes('spirit')) { ctx.fillStyle = 'rgba(123,80,175,.2)'; ctx.beginPath(); ctx.ellipse(X + width / 2, Y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); ctx.fill(); return; }
    if (kind.includes('cave')) {
      ctx.fillStyle = 'rgba(42,63,48,.72)'; ctx.beginPath(); ctx.moveTo(X + 10, Y); ctx.lineTo(X + width - 12, Y + 3); ctx.lineTo(X + width, Y + 18); ctx.lineTo(X + width - 7, Y + height - 8); ctx.lineTo(X + 14, Y + height); ctx.lineTo(X, Y + height - 17); ctx.closePath(); ctx.fill();
      const rocks = [[8,10,12,8],[width-24,12,14,9],[4,height-21,15,10],[width-28,height-18,18,9]]; for (const [x,y,w,h] of rocks) { ctx.fillStyle = '#566358'; ctx.fillRect(X+x,Y+y,w,h); ctx.fillStyle = '#758174'; ctx.fillRect(X+x+3,Y+y-2,w-6,3); } return;
    }
    if (kind.includes('stair')) {
      for (let row = 0; row < rows; row += 1) { const inset = (rows - 1 - row) * 7, stepY = Y + row * T + 3; ctx.fillStyle = '#746d64'; ctx.fillRect(X + inset - 2, stepY + 3, width - inset * 2 + 4, 14); ctx.fillStyle = row % 2 ? '#b7ab92' : '#c9bda1'; ctx.fillRect(X + inset, stepY, width - inset * 2, 14); ctx.fillStyle = '#e1d4b7'; ctx.fillRect(X + inset + 3, stepY + 2, width - inset * 2 - 6, 3); } return;
    }
  }
  function drawEntity(entity) { const X = px(entity.x), Y = py(entity.y), kind = String(entity.kind || entity.type || '').toLowerCase(); if (kind.includes('relic')) { ctx.fillStyle = C.gold; ctx.fillRect(X + 6, Y + 4, 8, 12); ctx.fillStyle = '#fff4b5'; ctx.fillRect(X + 8, Y + 2, 4, 5); } else if (kind.includes('cave')) { ctx.fillStyle = '#26343d'; ctx.fillRect(X + 1, Y + 3, 18, 17); ctx.fillStyle = '#101a22'; ctx.fillRect(X + 5, Y + 8, 10, 12); } else if (kind.includes('gate') || kind.includes('spirit')) { ctx.fillStyle = '#4f376f'; ctx.fillRect(X + 3, Y + 2, 14, 16); ctx.fillStyle = '#d9b4ff'; ctx.fillRect(X + 6, Y + 5, 8, 11); } else if (kind.includes('shrine')) { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 3, Y + 7, 14, 10); ctx.fillStyle = C.purple; ctx.fillRect(X + 7, Y + 1, 6, 9); } else if (kind.includes('temple') || kind.includes('altar')) { ctx.fillStyle = '#b9a882'; ctx.fillRect(X, Y + 5, 20, 15); ctx.fillStyle = kind.includes('altar') ? C.gold : '#706879'; ctx.fillRect(X + 7, Y + 8, 6, 12); } else { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 4, Y + 4, 12, 12); } }
  function drawWorldEntity(entity) {
    const kind = String(entity.kind || entity.type || '').toLowerCase();
    if (entity.collectorChallenge) {
      const X = px(entity.x), Y = py(entity.y), asset = art[entity.sprite];
      const pulse = 1 + Math.sin(state.frame * 1.6 + entity.x) * .06;
      ctx.save();
      const glow = ctx.createRadialGradient(X + 10, Y + 10, 2, X + 10, Y + 10, kind.includes('clue') ? 18 : 34 * pulse);
      glow.addColorStop(0, 'rgba(255,227,127,.52)'); glow.addColorStop(.45, 'rgba(108,208,213,.18)'); glow.addColorStop(1, 'rgba(108,208,213,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X + 10, Y + 10, kind.includes('clue') ? 18 : 34 * pulse, 0, Math.PI * 2); ctx.fill();
      if (asset) {
        const size = kind.includes('clue') ? 30 : kind.includes('dig') ? 44 : 64;
        ctx.drawImage(asset, X + 10 - size / 2, Y + 10 - size * .78, size, size);
      } else {
        ctx.fillStyle = kind.includes('clue') ? '#f5dda3' : '#7ed7d3'; ctx.fillRect(X + 4, Y + 3, 13, 15);
      }
      ctx.restore();
      if (entity.label) { ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff5c8'; ctx.fillText(entity.label, X + 10, Y - 17); }
      return;
    }
    if (kind.includes('ruins-entrance')) {
      // This is the actual doorway from the ruins set, not the loose rock pile
      // that previously made the entrance look pasted onto the grass.
      drawGroundedDecor(art.sandRuin1, entity.x - 30, entity.y - 17, 88, 88); return;
    }
    if (kind.includes('ruins-exit')) return;
    if (kind.includes('ruins') || kind.includes('observatory') || kind.includes('hidden-path') || entity.id === 'forest-wayfinder-shard') return;
    // The Black Hollow's return passage is part of the cave artwork itself.
    if (entity.id === 'dark-cave-exit') return;
    if (String(entity.id || '').startsWith('gloom-shard-')) {
      const X = px(entity.x), Y = py(entity.y), pulse = 1 + Math.sin(state.frame * 1.15) * .16;
      const glow = ctx.createRadialGradient(X + 10, Y + 10, 1, X + 10, Y + 10, 22 * pulse);
      glow.addColorStop(0, 'rgba(203,255,243,.7)'); glow.addColorStop(.32, 'rgba(105,210,209,.34)'); glow.addColorStop(1, 'rgba(76,28,104,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X + 10, Y + 10, 22 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(X + 10, Y + 10); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#d9fff3'; ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#62d7d2'; ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#8e5fc4'; ctx.fillRect(-2, -2, 4, 4);
      ctx.restore(); return;
    }
    if (String(entity.id || '').startsWith('sunstone-shard-')) {
      const X = px(entity.x), Y = py(entity.y), pulse = 1 + Math.sin(state.frame * 1.2) * .16;
      const glow = ctx.createRadialGradient(X + 10, Y + 10, 1, X + 10, Y + 10, 25 * pulse);
      glow.addColorStop(0, 'rgba(255,246,169,.72)'); glow.addColorStop(.38, 'rgba(244,165,48,.28)'); glow.addColorStop(1, 'rgba(136,70,18,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X + 10, Y + 10, 25 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff1a5'; ctx.beginPath(); ctx.moveTo(X + 10, Y - 1); ctx.lineTo(X + 18, Y + 8); ctx.lineTo(X + 10, Y + 21); ctx.lineTo(X + 2, Y + 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e6952e'; ctx.fillRect(X + 8, Y + 4, 4, 12); return;
    }
    if (String(entity.id || '').startsWith('everdawn-shard-')) {
      const X = px(entity.x), Y = py(entity.y), pulse = 1 + Math.sin(state.frame * 1.05) * .14;
      const glow = ctx.createRadialGradient(X + 10, Y + 10, 1, X + 10, Y + 10, 23 * pulse);
      glow.addColorStop(0, 'rgba(214,255,180,.7)'); glow.addColorStop(.4, 'rgba(117,222,128,.28)'); glow.addColorStop(1, 'rgba(37,112,78,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X + 10, Y + 10, 23 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(X + 10, Y + 10); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#edffd0'; ctx.fillRect(-6, -6, 12, 12);
      ctx.fillStyle = '#71d987'; ctx.fillRect(-3, -3, 6, 6);
      ctx.restore(); return;
    }
    if (kind.includes('cave')) {
      const X = px(entity.x), Y = py(entity.y);
      ctx.fillStyle = '#45534b'; ctx.beginPath(); ctx.ellipse(X + 10, Y + 12, 30, 23, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#69736a'; for (const [x, y, w, h] of [[-19,7,14,10],[-13,-3,15,11],[1,-10,17,12],[17,-3,15,11],[26,7,13,10]]) { ctx.fillRect(X + x, Y + y, w, h); ctx.fillStyle = '#889087'; ctx.fillRect(X + x + 3, Y + y, Math.max(4, w - 6), 3); ctx.fillStyle = '#69736a'; }
      ctx.fillStyle = '#111a1c'; ctx.beginPath(); ctx.arc(X + 10, Y + 13, 15, Math.PI, 0); ctx.fill(); ctx.fillRect(X - 5, Y + 13, 30, 18);
      ctx.fillStyle = 'rgba(64,89,71,.7)'; ctx.fillRect(X - 20, Y + 28, 60, 7); return;
    }
    if (String(entity.id || '').includes('tideglass-shard')) {
      const X = px(entity.x), Y = py(entity.y), pulse = Math.sin(state.frame * .9) * 2;
      ctx.fillStyle = 'rgba(64,232,255,.2)'; ctx.beginPath(); ctx.arc(X + 10, Y + 10, 12 + pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9fbff'; ctx.beginPath(); ctx.moveTo(X + 10, Y); ctx.lineTo(X + 17, Y + 8); ctx.lineTo(X + 11, Y + 20); ctx.lineTo(X + 4, Y + 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#28d7e9'; ctx.beginPath(); ctx.moveTo(X + 10, Y + 3); ctx.lineTo(X + 14, Y + 8); ctx.lineTo(X + 10, Y + 15); ctx.lineTo(X + 7, Y + 8); ctx.closePath(); ctx.fill(); return;
    }
    if (kind.includes('temple-exit')) {
      const X = px(entity.x), Y = py(entity.y); ctx.fillStyle = '#58727a'; ctx.fillRect(X - 12, Y - 12, 44, 32); ctx.fillStyle = '#0b2028'; ctx.beginPath(); ctx.arc(X + 10, Y + 4, 13, Math.PI, 0); ctx.fill(); ctx.fillRect(X - 3, Y + 4, 26, 16); ctx.strokeStyle = '#43d8e8'; ctx.strokeRect(X - 7, Y - 8, 34, 28); return;
    }
    if (kind.includes('temple-entrance')) {
      const X = px(entity.x), Y = py(entity.y);
      ctx.fillStyle = 'rgba(39,49,45,.28)'; ctx.fillRect(X - 35, Y - 22, 90, 48);
      ctx.fillStyle = '#655f58'; ctx.fillRect(X - 31, Y - 18, 82, 39);
      ctx.fillStyle = '#9d917d'; ctx.fillRect(X - 27, Y - 14, 74, 35);
      ctx.fillStyle = '#c7b99c'; ctx.beginPath(); ctx.moveTo(X - 35, Y - 14); ctx.lineTo(X + 10, Y - 38); ctx.lineTo(X + 55, Y - 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#70695f'; ctx.beginPath(); ctx.moveTo(X - 24, Y - 14); ctx.lineTo(X + 10, Y - 31); ctx.lineTo(X + 44, Y - 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#dacbaa'; ctx.fillRect(X - 25, Y - 11, 9, 32); ctx.fillRect(X + 36, Y - 11, 9, 32);
      ctx.fillStyle = '#635d56'; ctx.fillRect(X - 29, Y - 14, 17, 5); ctx.fillRect(X + 32, Y - 14, 17, 5);
      ctx.fillStyle = '#202a2d'; ctx.beginPath(); ctx.arc(X + 10, Y + 4, 14, Math.PI, 0); ctx.fill(); ctx.fillRect(X - 4, Y + 4, 28, 17);
      ctx.fillStyle = '#10181d'; ctx.fillRect(X + 1, Y + 3, 18, 18);
      ctx.fillStyle = '#f4da78'; ctx.fillRect(X + 8, Y - 23, 4, 4);
      return;
    }
    if (!kind.includes('shard')) { drawEntity(entity); return; }
    const X = px(entity.x), Y = py(entity.y), pulse = Math.sin(state.frame * .8) * 2;
    ctx.fillStyle = 'rgba(255,235,139,.22)'; ctx.fillRect(X + 2 - pulse, Y + 2 - pulse, 16 + pulse * 2, 16 + pulse * 2);
    ctx.fillStyle = '#fff4ad'; ctx.beginPath(); ctx.moveTo(X + 10, Y + 1); ctx.lineTo(X + 16, Y + 9); ctx.lineTo(X + 10, Y + 19); ctx.lineTo(X + 4, Y + 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#72d9e8'; ctx.beginPath(); ctx.moveTo(X + 10, Y + 4); ctx.lineTo(X + 13, Y + 9); ctx.lineTo(X + 10, Y + 15); ctx.lineTo(X + 7, Y + 9); ctx.closePath(); ctx.fill();
  }
  function character(player, X = px(player.x), Y = py(player.y), size = T) {
    const slot = Math.max(1, state.players.findIndex((entry) => entry.id === player.id) + 1);
    const sprite = art[`player${player.sprite || slot}`] || art[`player${slot}`] || art.player1;
    const rows = { down: 0, left: 1, right: 2, up: 3 }, row = rows[player.facing] ?? 0, frame = player.moving ? Math.floor(state.frame * 1.4) % 3 : 1;
    if (sprite) {
      ctx.save();
      if (player.hurt) { ctx.filter = 'brightness(1.9) saturate(1.8) sepia(.45) hue-rotate(315deg)'; ctx.translate(Math.sin(state.frame * 8) * 2, 0); }
      // The character sheets contain generous transparent padding around each
      // 32px frame. Draw them larger so the actual figure—not only its label—
      // remains readable against the detailed overworld art.
      const drawSize = size === T ? 56 : Math.max(40, size * 1.5);
      const drawX = X + size / 2 - drawSize / 2;
      const drawY = Y - 15;
      ctx.drawImage(sprite, frame * 32, row * 32, 32, 32, drawX, drawY, drawSize, drawSize);
      ctx.restore();
    }
    else { ctx.fillStyle = C.ink; ctx.fillRect(X + 4, Y + 4, 10, 11); ctx.fillStyle = player.color; ctx.fillRect(X + 5, Y + 5, 8, 8); ctx.fillStyle = '#f3c28b'; ctx.fillRect(X + 5, Y + 1, 8, 5); }
    ctx.fillStyle = player.color; ctx.fillRect(X + 3, Y + 19, 14, 2);
    if (player.id === state.mine?.id) { ctx.strokeStyle = '#fff5b4'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(X + size / 2, Y + size - 1, Math.max(8, size * .55), 4, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (['dark-cave', 'hidden-ruins'].includes(player.zone)) {
      drawHealthBar(X - 7, Y - 24, 34, player.health, player.maxHealth, '#59cf78');
      if (player.hurt) {
        const pulse = 13 + Math.sin(state.frame * 7) * 2;
        ctx.save(); ctx.strokeStyle = '#ff715f'; ctx.shadowColor = '#ff3e32'; ctx.shadowBlur = 9; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X + 10, Y + 7, pulse, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6659';
        ctx.fillText(`-${player.lastDamage || 5}`, X + 25, Y - 12);
      }
    }
  }
  function drawHealthBar(x, y, width, health, maxHealth, fill) {
    const maximum = Math.max(1, Number(maxHealth) || 1), current = Math.max(0, Number(health) || 0), ratio = Math.max(0, Math.min(1, current / maximum));
    ctx.fillStyle = 'rgba(2,5,10,.9)'; ctx.fillRect(x - 1, y - 1, width + 2, 7);
    ctx.fillStyle = '#432838'; ctx.fillRect(x, y, width, 5);
    ctx.fillStyle = ratio > .3 ? fill : '#ef5a58'; ctx.fillRect(x, y, Math.ceil(width * ratio), 5);
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff6d7'; ctx.fillText(`${Math.ceil(current)}/${maximum}`, x + width / 2, y - 3);
  }
  function drawEnemyStrike(enemy, X, Y, color) {
    if (!enemy?.attacking || !enemy.targetId) return { x: 0, y: 0 };
    const target = state.players.find((player) => player.id === enemy.targetId && (player.zone || 'overworld') === (state.mine?.zone || 'overworld'));
    if (!target) return { x: 0, y: 0 };
    const targetX = px(target.x) + 10, targetY = py(target.y) + 7;
    const dx = targetX - X, dy = targetY - Y, distance = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / distance, ny = dy / distance;
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(X + nx * 15, Y + ny * 15); ctx.lineTo(targetX - nx * 8, targetY - ny * 8); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X + nx * 15, Y + ny * 15); ctx.lineTo(targetX - nx * 8, targetY - ny * 8); ctx.stroke();
    ctx.translate(targetX, targetY); ctx.rotate(Math.atan2(dy, dx)); ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(9, 10); ctx.moveTo(-9, 10); ctx.lineTo(9, -10); ctx.stroke(); ctx.restore();
    return { x: nx * 9, y: ny * 9 };
  }
  function drawDemon(enemy) {
    if (!enemy?.alive) return;
    const X = px(enemy.x + 30), Y = py(enemy.z + 17), sprite = art[enemy.sprite];
    const lunge = drawEnemyStrike(enemy, X, Y, '#ff4a6b'), drawX = X + lunge.x, drawY = Y + lunge.y;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.ellipse(drawX, drawY + 3, 25, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (sprite) {
      ctx.save(); if (enemy.hit) { ctx.globalAlpha = .48; ctx.filter = 'brightness(2.5)'; }
      ctx.drawImage(sprite, drawX - 26, drawY - 60, 52, 66); ctx.restore();
    }
    drawHealthBar(X - 25, Y - 69, 50, enemy.health, enemy.maxHealth, '#c95a6d');
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#e6afbd'; ctx.fillText(enemy.name, X, Y - 79);
  }
  function drawMummy(enemy) {
    if (!enemy?.alive) return;
    const X = px(enemy.x + 30), Y = py(enemy.z + 17), sprite = art[enemy.sprite];
    const phase = [...String(enemy.id || '')].reduce((total, character) => total + character.charCodeAt(0), 0) * .13;
    // The Ruins are deliberately still and weighty. Mummies only move when
    // striking; a constant idle bob made the whole chamber feel floaty.
    const lunge = drawEnemyStrike(enemy, X, Y, '#ffc44f'), drawX = X + lunge.x, drawY = Y + lunge.y;
    ctx.fillStyle = 'rgba(64,36,13,.42)'; ctx.beginPath(); ctx.ellipse(drawX, drawY + 3, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (sprite) {
      ctx.save(); ctx.translate(drawX, drawY); if (enemy.variant) ctx.scale(-1, 1);
      if (enemy.attacking) { ctx.rotate(Math.sin(state.frame * 18 + phase) * .09); ctx.scale(1.08, .94); }
      if (enemy.theme === 'tide') ctx.filter = 'hue-rotate(145deg) saturate(.72) brightness(1.22)';
      if (enemy.hit) { ctx.globalAlpha = .5; ctx.filter = 'brightness(2.7)'; }
      ctx.drawImage(sprite, -27, -57, 54, 64); ctx.restore();
    }
    if (enemy.attacking) {
      const flicker = 18 + Math.sin(state.frame * 20 + phase) * 4;
      ctx.save(); ctx.strokeStyle = 'rgba(255,204,82,.78)'; ctx.shadowColor = '#ffc44f'; ctx.shadowBlur = 10; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(drawX, drawY - 27, flicker, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    drawHealthBar(X - 25, Y - 67, 50, enemy.health, enemy.maxHealth, '#d6a72d');
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe3a0'; ctx.fillText(enemy.name, X, Y - 77);
  }
  function drawGroundedDecor(asset, x, z, width, height, shadow = true) {
    if (!asset) return;
    const X = px(x + 30), Y = py(z + 17);
    if (shadow) {
      ctx.fillStyle = 'rgba(2,17,21,.24)';
      ctx.beginPath(); ctx.ellipse(X, Y + 2, width * .32, Math.max(3, height * .1), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.drawImage(asset, X - width / 2, Y - height * .72, width, height);
  }
  function drawOverworldDecor() {
    const pieces = [
      [art.ruinsStone, -10, -6, 34, 34],
    ];
    for (const piece of pieces) drawGroundedDecor(...piece);
  }
  function templeTile(column, row, X, Y, size = T) { if (art.temple) ctx.drawImage(art.temple, column * 32, row * 32, 32, 32, X, Y, size, size); }
  function templeDetailTile(column, row, X, Y, size = T) { if (art.templeDetail) ctx.drawImage(art.templeDetail, column * 32, row * 32, 32, 32, X, Y, size, size); }
  function drawSunkenTemple() {
    ctx.fillStyle = '#031821'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a2732'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 8; y < canvas.height; y += 42) {
      ctx.fillStyle = 'rgba(58,112,125,.32)'; ctx.fillRect(0, y, canvas.width, 8);
      ctx.fillStyle = 'rgba(112,191,199,.2)'; ctx.fillRect(24 + (y % 48), y + 2, canvas.width - 72, 2);
    }
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#a9d7da';
    ctx.fillText('SUNKEN TEMPLE', canvas.width / 2, 27);

    // The original Sunken Temple footprint: a wide ritual hall, a broad altar
    // chamber above it, and a narrow return corridor below it.
    const points = [[-9,-11],[9,-11],[9,-5],[16,-5],[16,5],[4,5],[4,14],[-4,14],[-4,5],[-16,5],[-16,-5],[-9,-5]];
    const templePath = () => {
      ctx.beginPath(); points.forEach(([x, z], index) => { const X = px(x + 30), Y = py(z + 17); if (!index) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }); ctx.closePath();
    };
    ctx.save(); templePath(); ctx.clip();
    ctx.fillStyle = '#173f49'; ctx.fillRect(px(14), py(3), 32 * T, 28 * T);
    for (let z = -14; z < 14; z += 1) for (let x = -16; x < 16; x += 1) {
      ctx.fillStyle = (x + z) % 2 ? 'rgba(40,91,99,.24)' : 'rgba(9,42,52,.16)';
      ctx.fillRect(px(x + 30), py(z + 17), T, T);
    }
    ctx.fillStyle = 'rgba(63,123,130,.28)'; ctx.fillRect(px(26), py(6), 8 * T, 25 * T);
    ctx.restore();
    templePath(); ctx.strokeStyle = '#77dbe0'; ctx.lineWidth = 3; ctx.stroke();

    const altarX = px(26), altarY = py(6);
    ctx.fillStyle = '#071a22'; ctx.fillRect(altarX, altarY, 9 * T, 5 * T);
    ctx.strokeStyle = '#8ae4e7'; ctx.lineWidth = 2; ctx.strokeRect(altarX + 4, altarY + 4, 9 * T - 8, 5 * T - 8);
    templeDetailTile(4, 13, px(30) - 26, altarY + 34, 62);
    ctx.fillStyle = '#9cebed'; ctx.fillRect(px(30) + 7, altarY + 20, 6, 6);

    for (const [x, z] of [[-9,-11],[9,-11],[-16,-5],[16,-5],[-16,5],[16,5]]) {
      ctx.fillStyle = '#102f38'; ctx.fillRect(px(x + 30) - 4, py(z + 17) - 4, 34, 34);
      templeTile(8, 1, px(x + 30), py(z + 17), 30);
    }
    for (const [x, z] of [[-7,-10],[7,-10],[-14,2],[14,2]]) templeDetailTile(0, 8, px(x + 30), py(z + 17), 27);
    const frame = Math.floor(state.frame * 1.8) % 5;
    if (art.flame) for (const [x,z] of [[-8,-5.5],[8,-5.5]]) ctx.drawImage(art.flame, frame * 32, 0, 32, 32, px(x + 30) - 6, py(z + 17), 32, 32);
  }
  function darkCavePath() {
    ctx.beginPath();
    DARK_CAVE_POINTS.forEach(([x, z], index) => {
      const X = px(x + 30), Y = py(z + 17);
      if (!index) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  }
  function drawCaveAsset(asset, x, z, width, height, glow = null, alpha = 1) {
    if (!asset) return;
    const X = px(x + 30), Y = py(z + 17);
    if (glow) {
      const aura = ctx.createRadialGradient(X, Y - height * .25, 1, X, Y - height * .25, Math.max(width, height) * .72);
      aura.addColorStop(0, glow); aura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aura; ctx.beginPath(); ctx.ellipse(X, Y - height * .2, width * .62, height * .56, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.beginPath(); ctx.ellipse(X, Y + 1, width * .3, Math.max(3, height * .09), 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(asset, X - width / 2, Y - height * .78, width, height); ctx.restore();
  }
  function drawDarkCave() {
    const backdrop = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 90, canvas.width / 2, canvas.height / 2, 590);
    backdrop.addColorStop(0, '#0d111b'); backdrop.addColorStop(.56, '#060810'); backdrop.addColorStop(1, '#010204');
    ctx.fillStyle = backdrop; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 24; y < canvas.height; y += 62) {
      ctx.strokeStyle = 'rgba(83,54,105,.08)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(180, y - 14, 310, y + 16, 480, y - 2); ctx.bezierCurveTo(640, y - 18, 800, y + 12, canvas.width, y - 4); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#b7d5d3';
    ctx.fillText('THE BLACK HOLLOW', canvas.width / 2, 27);

    // The visible rock rim and server collision share this exact irregular shape.
    darkCavePath(); ctx.strokeStyle = '#020307'; ctx.lineJoin = 'round'; ctx.lineWidth = 42; ctx.stroke();
    darkCavePath(); ctx.strokeStyle = '#191426'; ctx.lineWidth = 22; ctx.stroke();
    darkCavePath(); ctx.strokeStyle = '#49335e'; ctx.lineWidth = 8; ctx.stroke();
    darkCavePath(); ctx.strokeStyle = '#82aaa9'; ctx.lineWidth = 2; ctx.stroke();

    ctx.save(); darkCavePath(); ctx.clip();
    const floor = ctx.createRadialGradient(px(30), py(17), 30, px(30), py(17), 420);
    floor.addColorStop(0, '#171a25'); floor.addColorStop(.62, '#10131d'); floor.addColorStop(1, '#070910');
    ctx.fillStyle = floor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let z = -15; z <= 14; z += 1) for (let x = -18; x <= 17; x += 1) {
      const seed = Math.abs((x * 31 + z * 17) % 11);
      ctx.fillStyle = seed < 3 ? 'rgba(89,76,108,.08)' : seed > 8 ? 'rgba(34,92,92,.055)' : 'rgba(255,255,255,.012)';
      ctx.fillRect(px(x + 30), py(z + 17), T, T);
    }
    for (const rift of DARK_CAVE_RIFTS) {
      const { x, z, radiusX: rx, radiusZ: rz } = rift;
      const X = px(x + 30), Y = py(z + 17); const pool = ctx.createRadialGradient(X,Y,2,X,Y,rx*T);
      if (rift.setback) {
      // This is still the setback rift mechanically, but it should read as a
      // portal just like the others. Its unstable violet rim is the only clue.
      pool.addColorStop(0, 'rgba(7,2,17,.98)');
      pool.addColorStop(.68, 'rgba(5,7,18,.94)');
      pool.addColorStop(1, 'rgba(167,106,214,.34)');
      ctx.fillStyle = pool;
      ctx.beginPath(); ctx.ellipse(X, Y, rx*T, rz*T, .08, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = `rgba(205,156,255,${.30 + Math.sin(state.frame * 3) * .10})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      } else {
        pool.addColorStop(0,'rgba(0,2,7,.96)'); pool.addColorStop(.72,'rgba(4,11,20,.9)'); pool.addColorStop(1,'rgba(63,99,107,.24)');
        ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(X,Y,rx*T,rz*T,.08,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(97,173,171,.18)'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(119,84,139,.2)'; ctx.lineWidth = 2;
    for (const [x,z,s] of [[-5,3,1],[5,-2,-1],[-2,-9,-1],[11,0,1]]) {
      ctx.beginPath(); ctx.moveTo(px(x+30),py(z+17)); ctx.lineTo(px(x+30+s*1.7),py(z+18.4)); ctx.lineTo(px(x+30+s*.4),py(z+19.2)); ctx.stroke();
    }
    ctx.restore();

    // Supplied cave sprites are grounded directly into the floor, never boxed.
    drawCaveAsset(art.caveGate, 2, -11.8, 118, 112, 'rgba(94,53,132,.22)');
    drawCaveAsset(art.caveWeb, -3.8, -11.6, 72, 68, null, .76);
    drawCaveAsset(art.caveTotem, -9.6, -6.2, 82, 88, 'rgba(116,61,145,.15)');
    drawCaveAsset(art.caveDemonSkull, 10.8, -6.4, 66, 67);
    drawCaveAsset(art.caveBonefire, -10.4, 4.6, 79, 75, 'rgba(45,170,168,.16)');
    drawCaveAsset(art.caveFossil, 9.2, 5.2, 158, 96, null, .8);
    drawCaveAsset(art.caveCrystalA, -15.1, -1.1, 50, 54, 'rgba(69,231,218,.3)');
    drawCaveAsset(art.caveCrystalB, -12.6, .9, 38, 42, 'rgba(75,209,218,.24)');
    drawCaveAsset(art.caveCrystalA, 14.2, -2.1, 47, 51, 'rgba(69,231,218,.3)');
    drawCaveAsset(art.caveCrystalB, 11.7, -.3, 36, 39, 'rgba(75,209,218,.24)');
    drawCaveAsset(art.caveMushroomLarge, -6.4, 8.6, 51, 50, 'rgba(102,68,139,.12)');
    drawCaveAsset(art.caveMushroomSmall, 6.5, 8.8, 38, 39, 'rgba(102,68,139,.1)');

    // One readable way home, carved into the southern rock wall.
    const exitX = px(30), exitY = py(29);
    const exitGlow = ctx.createRadialGradient(exitX, exitY - 7, 1, exitX, exitY - 7, 42);
    exitGlow.addColorStop(0, 'rgba(163,221,185,.25)'); exitGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = exitGlow; ctx.beginPath(); ctx.arc(exitX, exitY - 7, 42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3f3a49'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(exitX, exitY, 24, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#010204'; ctx.beginPath(); ctx.arc(exitX, exitY, 19, Math.PI, 0); ctx.fill(); ctx.fillRect(exitX - 19, exitY, 38, 20);
    ctx.strokeStyle = '#88aaa1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(exitX, exitY, 25, Math.PI, 0); ctx.stroke();

    for (let i = 0; i < 18; i += 1) {
      const x = (i * 97 + state.frame * (i % 3 + 1) * .18) % canvas.width;
      const y = (i * 53 + Math.sin(state.frame * .16 + i) * 18 + 640) % 640;
      ctx.fillStyle = i % 4 ? 'rgba(132,113,151,.16)' : 'rgba(130,209,201,.2)'; ctx.fillRect(x, y, 2, 2);
    }
  }
  function hiddenRuinsPath() {
    ctx.beginPath();
    HIDDEN_RUINS_POINTS.forEach(([x, z], index) => {
      const X = px(x + 30), Y = py(z + 17);
      if (!index) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  }
  function drawHiddenRuins() {
    const sky = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 70, canvas.width / 2, canvas.height / 2, 560);
    sky.addColorStop(0, '#3b2418'); sky.addColorStop(.58, '#1c1412'); sky.addColorStop(1, '#090a0d');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#f4d489';
    ctx.fillText('THE HIDDEN RUINS', canvas.width / 2, 27);

    hiddenRuinsPath(); ctx.strokeStyle = '#17100d'; ctx.lineJoin = 'round'; ctx.lineWidth = 38; ctx.stroke();
    hiddenRuinsPath(); ctx.strokeStyle = '#6d4021'; ctx.lineWidth = 20; ctx.stroke();
    hiddenRuinsPath(); ctx.strokeStyle = '#b9823f'; ctx.lineWidth = 7; ctx.stroke();
    hiddenRuinsPath(); ctx.strokeStyle = '#f0c674'; ctx.lineWidth = 2; ctx.stroke();

    ctx.save(); hiddenRuinsPath(); ctx.clip();
    const floor = ctx.createRadialGradient(px(30), py(15), 40, px(30), py(15), 430);
    floor.addColorStop(0, '#8b6335'); floor.addColorStop(.6, '#654526'); floor.addColorStop(1, '#39271c');
    ctx.fillStyle = floor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let z = -14; z <= 14; z += 1) for (let x = -17; x <= 17; x += 1) {
      const seed = Math.abs((x * 29 + z * 13) % 9);
      ctx.fillStyle = seed < 3 ? 'rgba(252,205,119,.09)' : seed > 7 ? 'rgba(55,27,18,.09)' : 'rgba(255,255,255,.018)';
      ctx.fillRect(px(x + 30) + 1, py(z + 17) + 1, T - 2, T - 2);
    }
    ctx.strokeStyle = 'rgba(238,197,113,.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px(30), py(29)); ctx.lineTo(px(30), py(7)); ctx.stroke();
    for (const z of [7, 13, 19]) { ctx.beginPath(); ctx.moveTo(px(20), py(z)); ctx.lineTo(px(40), py(z)); ctx.stroke(); }
    // Keep the Ruins still and grounded. The old pulsing/rotating seal made
    // the room look like every prop was flickering or bouncing.
    const sigilX = px(30), sigilY = py(14);
    ctx.strokeStyle = 'rgba(255,214,112,.3)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sigilX, sigilY, 47, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(sigilX, sigilY); ctx.beginPath(); for (let i = 0; i < 8; i += 1) { const angle = i * Math.PI / 4; ctx.moveTo(Math.cos(angle) * 26, Math.sin(angle) * 26); ctx.lineTo(Math.cos(angle) * 43, Math.sin(angle) * 43); } ctx.stroke(); ctx.restore();
    ctx.restore();

    // Transparent sandstone pieces sit directly on the floor; their irregular
    // silhouettes create the room without any framed or boxed presentation.
    drawCaveAsset(art.sandRuin1, -13.3, -6.4, 88, 88, null, .96);
    drawCaveAsset(art.sandRuin2, 13.1, -6.2, 84, 84, null, .96);
    drawCaveAsset(art.sandRuin3, -14.3, 5.2, 64, 64, null, .94);
    drawCaveAsset(art.sandRuin4, 14.3, 5.2, 62, 62, null, .94);
    drawCaveAsset(art.sandRuin5, -5.2, -12.2, 47, 47, null, .9);
    drawCaveAsset(art.sandRuin5, 5.2, -12.2, 47, 47, null, .9);

    for (const [x, z] of [[-11,9],[11,9],[-9,-9],[9,-9]]) {
      const X = px(x + 30), Y = py(z + 17);
      ctx.fillStyle = 'rgba(255,174,58,.14)'; ctx.beginPath(); ctx.arc(X, Y - 10, 25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5b3921'; ctx.fillRect(X - 5, Y - 23, 10, 25); ctx.fillStyle = '#f0b34f'; ctx.fillRect(X - 2, Y - 23, 4, 9);
    }

    const exitX = px(30), exitY = py(29);
    ctx.strokeStyle = '#9a6737'; ctx.lineWidth = 11; ctx.beginPath(); ctx.arc(exitX, exitY, 23, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#100d0d'; ctx.beginPath(); ctx.arc(exitX, exitY, 17, Math.PI, 0); ctx.fill(); ctx.fillRect(exitX - 17, exitY, 34, 18);
    ctx.strokeStyle = '#f0c674'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(exitX, exitY, 24, Math.PI, 0); ctx.stroke();

    for (let i = 0; i < 20; i += 1) {
      const x = (i * 83 + state.frame * (i % 2 + 1) * .12) % canvas.width, y = (i * 47 + 31) % canvas.height;
      ctx.fillStyle = i % 3 ? 'rgba(244,189,94,.13)' : 'rgba(255,237,176,.22)'; ctx.fillRect(x, y, 2, 2);
    }
  }
  function label(text, x, y, color = '#fff7d5', offset = 17) { ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.fillText(text, px(x) + 1, py(y) - offset + 1); ctx.fillStyle = color; ctx.fillText(text, px(x), py(y) - offset); }
  function wrap(text, x, y, max, line) { const words = String(text || '').split(' '); let current = '', yy = y; for (const word of words) { if (ctx.measureText(`${current}${word}`).width > max) { ctx.fillText(current, x, yy); current = `${word} `; yy += line; } else current += `${word} `; } ctx.fillText(current, x, yy); }
  function drawRoleTracker() {
    const mine = state.mine; if (!mine?.archetype) return;
    const progress = abilityProgress(), awakened = progress.filter((ability) => ability.awakened).length;
    ctx.fillStyle = '#1d2f44'; ctx.fillRect(14, 84, 365, 120); panel(14, 84, 365, 120); ctx.textAlign = 'left';
    ctx.fillStyle = '#f7d25c'; ctx.font = 'bold 11px monospace';
    ctx.fillText(mine.archetype === 'Explorer' ? `EXPLORER DISCOVERY JOURNAL  ${awakened}/${progress.length}` : `${mine.archetype.toUpperCase()} CALLING  ${awakened}/${progress.length}`, 27, 104);
    ctx.fillStyle = '#9fc8a2'; ctx.font = '9px monospace';
    ctx.fillText(mine.archetype === 'Explorer' ? 'Wander near forgotten places. Discoveries awaken in any order.' : 'Your choices awaken the powers of this calling.', 27, 119);
    progress.forEach((ability, index) => {
      const y = 139 + index * 13; ctx.fillStyle = ability.awakened ? '#f7d25c' : '#71859a';
      ctx.fillText(ability.awakened ? '◆' : '◇', 29, y); ctx.fillStyle = ability.awakened ? '#fff7d5' : '#9bacb8';
      ctx.fillText(ability.label, 45, y);
    });
    if (state.privateRule && progress.length < 4) { ctx.fillStyle = '#e8b8ff'; ctx.fillText(`PRIVATE: ${state.privateRule.title || 'A hidden law is active'}`, 27, 190); }
  }
  function drawMinimalHud({ suppressNotice = false } = {}) {
    const mine = state.mine;
    panel(14, 14, 282, 58); ctx.textAlign = 'left';
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('EVERDAWN', 27, 35);
    ctx.font = '10px monospace'; ctx.fillStyle = '#d2f0cf';
    const remaining = Number(state.world?.observationSecondsRemaining);
    const status = !state.network.connected ? 'CONNECTING…' : !gameReady() ? `${state.players.length}/4 LANTERNS` : mine?.zone === 'sunken-temple' ? 'SUNKEN TEMPLE' : mine?.zone === 'dark-cave' ? 'THE BLACK HOLLOW' : mine?.zone === 'hidden-ruins' ? 'THE HIDDEN RUINS' : state.world?.phase === 'observing' ? remaining > 0 ? `THE WORLD IS WATCHING · ${remaining}s` : 'THE CALLINGS AWAKEN' : mine?.archetype ? `${mine.archetype.toUpperCase()}` : 'YOUR STORY IS FORMING';
    ctx.fillText(status, 27, 54);
    if (['dark-cave', 'hidden-ruins'].includes(mine?.zone)) {
      ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#f7d25c'; ctx.fillText('SPACE · STRIKE', 27, 66);
    }
    const caveProgress = mine?.zone === 'dark-cave' ? state.world?.caveShardProgress : null;
    const ruinsProgress = mine?.zone === 'hidden-ruins' ? state.world?.ruinsShardProgress : null;
    const templeProgress = mine?.zone === 'sunken-temple' ? state.world?.shardProgress : null;
    const everdawnProgress = mine?.zone === 'overworld' ? state.world?.everdawnShardProgress : null;
    const visibleProgress = caveProgress || ruinsProgress || templeProgress || everdawnProgress;
    if (visibleProgress) {
      const progress = visibleProgress;
      panel(350, 14, 245, 58); ctx.textAlign = 'center';
      ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#9cebed'; ctx.fillText(`${caveProgress ? 'GLOOM' : ruinsProgress ? 'SUNSTONE' : templeProgress ? 'TIDEGLASS' : 'EVERDAWN'} SHARDS  ${progress.collected} / ${progress.total}`, 472, 37);
      ctx.font = '9px monospace'; ctx.fillStyle = progress.collected === progress.total ? '#fff2bd' : '#92aeb3';
      ctx.fillText(progress.collected === progress.total ? 'COLLECTION COMPLETE' : `${progress.total - progress.collected} SHARDS REMAIN`, 472, 55);
    }
    panel(760, 14, 186, 98); ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#fff2bd';
    ctx.fillText(`LANTERNS · ${state.network.roomCode || '—'}`, 774, 34);
    state.players.forEach((player, index) => { ctx.fillStyle = player.color; ctx.fillRect(775, 43 + index * 15, 7, 7); ctx.fillStyle = '#fff'; ctx.fillText(player.name, 788, 50 + index * 15); });
    const hasNotice = state.noticeTimer > 0 || !gameReady();
    const message = hasNotice ? state.notice : state.guidance?.message;
    if (!suppressNotice && message) {
      panel(165, 548, 630, 66); ctx.textAlign = 'center';
      if (!hasNotice && state.guidance) { ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#9de3ff'; ctx.fillText('THE GAME MASTER ADVISES YOU', 480, 564); }
      ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5'; wrap(message, 480, hasNotice ? 573 : 584, 570, 16);
    }
  }
  function puzzleButton(game, x, y, w, h, label, hit, selected = false, accent = '#7ed7d3') {
    ctx.fillStyle = selected ? '#e8b954' : '#27455a'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = selected ? '#fff2a1' : accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.textAlign = 'center'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = selected ? '#213246' : '#fff7d5';
    wrap(label, x + w / 2, y + h / 2 - 4, w - 14, 12);
    game.hitboxes.push({ x, y, w, h, ...hit });
  }
  function puzzleImage(key, x, y, width, height) {
    const asset = art[key];
    if (asset) ctx.drawImage(asset, x, y, width, height);
    else { ctx.fillStyle = '#426b72'; ctx.fillRect(x, y, width, height); }
  }
  function drawCollectorGame() {
    const game = state.collectorGame; if (!game) return;
    game.hitboxes = [];
    ctx.fillStyle = 'rgba(7,20,35,.78)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    panel(54, 42, 852, 556); ctx.fillStyle = '#193348'; ctx.fillRect(58, 46, 844, 548);
    ctx.textAlign = 'left'; ctx.font = 'bold 19px monospace'; ctx.fillStyle = '#fff0ae'; ctx.fillText(game.title.toUpperCase(), 82, 79);
    ctx.font = '10px monospace'; ctx.fillStyle = '#cce9dd'; wrap(game.instruction, 82, 101, 720, 13);
    puzzleButton(game, 850, 57, 34, 28, '×', { action: 'close' }, false, '#e99a86');
    if (game.clues?.length) {
      ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#9de3ff'; ctx.fillText(`PRIVATE CLUES ${game.clues.length}/${game.clueTotal}`, 82, 145);
      game.clues.slice(0, 2).forEach((clue, index) => {
        const x = 230 + index * 318; puzzleImage('clue-scroll', x, 121, 28, 28);
        ctx.textAlign = 'left'; ctx.font = '9px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText(clue.title, x + 34, 135);
        ctx.fillStyle = '#d4e9df'; wrap(clue.text, x + 34, 148, 255, 11);
      });
    }
    const contentY = game.clues?.length ? 190 : 145;
    if (game.feature === 'crystal-mine') {
      puzzleImage('crystal-mine', 96, contentY + 16, 218, 260);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#bdf7f1'; ctx.fillText('REBUILD THE CRYSTAL HEART', 366, contentY + 34);
      ctx.font = '10px monospace'; ctx.fillStyle = '#c9e1d5'; ctx.fillText(`${game.placed.length}/5 fragments seated`, 366, contentY + 54);
      for (let index = 0; index < 5; index += 1) {
        const column = index % 3, row = Math.floor(index / 3), placed = game.placed.includes(index);
        puzzleButton(game, 366 + column * 150, contentY + 82 + row * 92, 128, 68, placed ? `FRAGMENT ${index + 1}\nSET` : `PLACE\nFRAGMENT ${index + 1}`, { action: 'crystal', value: index }, placed, '#7bdce2');
      }
    } else if (game.feature === 'ancient-vault') {
      puzzleImage('ancient-vault', 82, contentY + 18, 262, 274);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#f2d479'; ctx.fillText('ENTER THE CARVED ORDER', 390, contentY + 34);
      const runes = [['gem', 'GEM', 'vault-gem'], ['moon', 'MOON', 'vault-moon'], ['flame', 'FLAME', 'vault-flame'], ['key', 'KEY', 'vault-key']];
      runes.forEach(([id, label, asset], index) => {
        const x = 390 + (index % 2) * 190, y = contentY + 70 + Math.floor(index / 2) * 112;
        puzzleImage(asset, x + 8, y + 8, 42, 42);
        puzzleButton(game, x, y, 168, 72, `PRESS ${label}`, { action: 'rune', value: id }, game.entered.includes(id), '#d6ad63');
      });
      ctx.font = '10px monospace'; ctx.fillStyle = '#c9e1d5'; ctx.fillText(`SEALS HELD ${game.entered.length}/4`, 390, contentY + 314);
    } else if (game.feature === 'treasure-cache') {
      puzzleImage('treasure-cache', 80, contentY + 16, 246, 250);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#f2d479'; ctx.fillText('SELECT THE THREE GENUINE RELICS', 360, contentY + 33);
      const items = [['ancient-idol', 'ANCIENT IDOL'], ['ornate-key', 'GOLDEN COMPASS'], ['sunken-crown', 'CURSED CROWN'], ['reliquary-box', 'RELIQUARY BOX']];
      items.forEach(([asset, label], index) => {
        const x = 360 + (index % 2) * 202, y = contentY + 61 + Math.floor(index / 2) * 128;
        puzzleImage(asset, x + 6, y + 6, 52, 52);
        puzzleButton(game, x, y, 184, 84, label, { action: 'relic-card', value: index }, game.selected.includes(index), '#d6ad63');
      });
      puzzleButton(game, 520, contentY + 330, 220, 46, `CONFIRM APPRAISAL  ${game.selected.length}/3`, { action: 'confirm-appraisal' }, false, '#a8d78b');
    } else if (game.feature === 'relic-forge') {
      puzzleImage(game.phase === 'quench' ? 'quench-oil' : 'relic-forge', 80, contentY + 12, 254, 270);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#ffc66a'; ctx.fillText(`FORGE PHASE · ${game.phase.toUpperCase()}`, 370, contentY + 32);
      if (game.phase === 'recipe') {
        [['energy', 'ENERGY', 'forge-flame'], ['stability', 'STABILITY', 'forge-anvil'], ['iron', 'IRON', 'forge-ingot']].forEach(([id, label, asset], index) => {
          const x = 370 + index * 160; puzzleImage(asset, x + 8, contentY + 65, 42, 42); puzzleButton(game, x, contentY + 56, 142, 76, label, { action: 'ingredient', value: id }, game.recipe.includes(id), '#ef9b55');
        });
        ctx.font = '10px monospace'; ctx.fillStyle = '#c9e1d5'; ctx.fillText(`BALANCED INGREDIENTS ${game.recipe.length}/3`, 370, contentY + 161);
      } else if (game.phase === 'heat') {
        ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#ffe2aa'; ctx.fillText('ORANGE HEAT RANGE 76–88', 370, contentY + 78);
        ctx.fillStyle = '#172331'; ctx.fillRect(370, contentY + 95, 390, 22); ctx.fillStyle = game.heat >= 76 && game.heat <= 88 ? '#f3a447' : '#5f9abd'; ctx.fillRect(374, contentY + 99, 382 * Math.max(0, Math.min(100, game.heat)) / 100, 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${Math.round(game.heat)}°`, 770, contentY + 112);
        puzzleButton(game, 370, contentY + 145, 180, 66, 'PUMP BELLOWS', { action: 'bellows' }, false, '#ef9b55');
        puzzleButton(game, 575, contentY + 145, 180, 66, 'TEMPER CORE', { action: 'temper' }, false, '#f2d479');
      } else if (game.phase === 'hammer') {
        ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#ffe2aa'; ctx.fillText('STRIKE THE HAMMER DIAGRAM', 370, contentY + 78);
        [['right', 'RIGHT'], ['left', 'LEFT'], ['up', 'UPPER']].forEach(([id, label], index) => puzzleButton(game, 370 + index * 130, contentY + 104, 114, 66, label, { action: 'hammer', value: id }, game.hammer.includes(id), '#ef9b55'));
      } else {
        ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#ffe2aa'; ctx.fillText('CHOOSE THE LIQUID THAT SETS THE CORE', 370, contentY + 78);
        [['oil', 'OIL', 'quench-oil'], ['water', 'WATER', 'quench-water'], ['spirit', 'SPIRIT', 'quench-spirit']].forEach(([id, label, asset], index) => { const x = 370 + index * 130; puzzleImage(asset, x + 30, contentY + 95, 45, 45); puzzleButton(game, x, contentY + 90, 114, 86, label, { action: 'quench', value: id }, false, '#ef9b55'); });
      }
    } else if (game.feature === 'sunken-relic') {
      puzzleImage('sunken-relic', 80, contentY + 16, 258, 254);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#a7eff7'; ctx.fillText('RIDE THE FLOODED CURRENTS', 372, contentY + 33);
      const gridX = 394, gridY = contentY + 63, size = 42;
      for (let row = 0; row < 5; row += 1) for (let column = 0; column < 5; column += 1) { ctx.fillStyle = (row + column) % 2 ? '#1b6681' : '#287b99'; ctx.fillRect(gridX + column * size, gridY + row * size, size - 2, size - 2); }
      const progress = Math.min(game.step, game.route.length), playerPath = [[0,4],[1,4],[1,3],[1,2],[2,2],[2,3],[3,3]][progress] || [0,4];
      ctx.fillStyle = '#fff0ae'; ctx.fillRect(gridX + playerPath[0] * size + 12, gridY + playerPath[1] * size + 12, 18, 18);
      ctx.fillStyle = '#e6c966'; ctx.fillRect(gridX + 3 * size + 11, gridY + 3 * size + 8, 20, 26);
      ctx.font = '10px monospace'; ctx.fillStyle = '#c9e1d5'; ctx.fillText(`CURRENT CHAMBER ${game.step}/${game.route.length}`, 394, gridY + 235);
      puzzleButton(game, 694, contentY + 94, 68, 46, '↑', { action: 'current', value: 'up' }, false, '#7bdce2');
      puzzleButton(game, 620, contentY + 152, 68, 46, '←', { action: 'current', value: 'left' }, false, '#7bdce2');
      puzzleButton(game, 694, contentY + 152, 68, 46, '↓', { action: 'current', value: 'down' }, false, '#7bdce2');
      puzzleButton(game, 768, contentY + 152, 68, 46, '→', { action: 'current', value: 'right' }, false, '#7bdce2');
      ctx.font = '9px monospace'; ctx.fillStyle = '#d4e9df'; ctx.fillText('ARROWS / WASD ALSO STEER', 620, contentY + 230);
    }
  }
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
  function drawGuardianThreat(threat, point) {
    const pulse = 1 + Math.sin(state.frame * 1.8 + point.x * .03) * .12;
    const glow = ctx.createRadialGradient(point.x, point.y - 10, 2, point.x, point.y - 10, 27 * pulse);
    glow.addColorStop(0, 'rgba(255,245,183,.86)'); glow.addColorStop(.32, 'rgba(181,104,225,.46)'); glow.addColorStop(1, 'rgba(104,53,142,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(point.x, point.y - 10, 27 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = threat.escort ? '#e77d57' : '#b77ada'; ctx.beginPath(); ctx.moveTo(point.x, point.y - 31); ctx.lineTo(point.x + 13, point.y - 8); ctx.lineTo(point.x, point.y + 6); ctx.lineTo(point.x - 13, point.y - 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff3bd'; ctx.fillRect(point.x - 3, point.y - 17, 6, 5);
    const ratio = Math.max(0, threat.health / Math.max(1, threat.maxHealth || threat.health));
    ctx.fillStyle = 'rgba(29,36,61,.9)'; ctx.fillRect(point.x - 18, point.y + 10, 36, 6); ctx.fillStyle = threat.escort ? '#ef8b55' : '#d59aeb'; ctx.fillRect(point.x - 17, point.y + 11, 34 * ratio, 4);
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#283a51'; ctx.fillText(threat.label, point.x, point.y - 39);
  }
  function drawGuardianSanctumBackdrop(theme) {
    const palette = theme === 'shrine-garden'
      ? ['#183e43', '#0d2028', '#050b11']
      : theme === 'mountain-pass'
        ? ['#38424a', '#1a252d', '#080d14']
        : ['#1a3c35', '#0c2526', '#050c11'];
    const glow = ctx.createRadialGradient(480, 285, 72, 480, 285, 630);
    glow.addColorStop(0, palette[0]); glow.addColorStop(.56, palette[1]); glow.addColorStop(1, palette[2]);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The other adventure spaces keep a little life beyond their playable
    // floor. This quiet drifting light replaces the old flat cyan surround.
    for (let index = 0; index < 34; index += 1) {
      const x = (index * 149 + state.frame * (index % 4 + 1) * .22) % canvas.width;
      const y = (index * 71 + Math.sin(state.frame * .22 + index) * 24 + 620) % canvas.height;
      ctx.fillStyle = index % 3 ? 'rgba(157,218,197,.13)' : 'rgba(249,223,147,.18)';
      ctx.fillRect(x, y, index % 5 ? 2 : 3, index % 5 ? 2 : 3);
    }
  }
  function drawGuardianTrialHud(trial, status, spirits) {
    // Reuse the normal expedition shell: world identity, roster, and the
    // familiar gold-edged panels stay constant even in a private rite.
    drawMinimalHud({ suppressNotice: true });
    panel(334, 14, 292, 58); ctx.textAlign = 'center';
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#9cebed'; ctx.fillText(trial.title.toUpperCase(), 480, 35);
    ctx.font = '9px monospace'; ctx.fillStyle = '#fff2bd';
    const summary = spirits === 1 ? '1 SPIRIT REMAINS' : `${spirits} SPIRITS REMAIN`;
    ctx.fillText(summary, 480, 53);
    panel(14, 214, 365, 56); ctx.textAlign = 'left'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#9de3ff';
    const advice = state.guidance?.message || state.publicEvent || trial.rule;
    ctx.fillText(state.guidance ? 'THE GAME MASTER ADVISES YOU' : 'THE GAME MASTER WATCHES', 27, 234);
    ctx.font = '10px monospace'; ctx.fillStyle = '#fff7d5'; wrap(advice, 27, 251, 335, 12);
    panel(165, 548, 630, 66); ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#fff7d5';
    wrap(status, 480, 573, 570, 16);
  }
  function drawGuardianTrial() {
    const trialState = state.world?.guardianTrial, trial = trialState?.activeTrial;
    if (!trial) return false;
    drawGuardianSanctumBackdrop(trial.map);
    const box = { x: 72, y: 92, w: 816, h: 426 };
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.76)'; ctx.shadowBlur = 18; ctx.fillStyle = '#071016'; ctx.fillRect(box.x - 9, box.y - 9, box.w + 18, box.h + 18); ctx.restore();
    trialBackdrop(box, trial.map);
    ctx.strokeStyle = '#d8bc76'; ctx.lineWidth = 2; ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
    const toScreen = (point) => ({ x: box.x + (point.x / trial.bounds.maxX) * box.w, y: box.y + (point.z / trial.bounds.maxZ) * box.h });
    for (const ward of trial.objectives) drawGuardianAngel(ward, toScreen(ward), trialState.activatedObjectiveIds.includes(ward.id));
    const mechanic = trialState.mechanic || {};
    for (const threat of mechanic.threats || []) if (!threat.defeated) drawGuardianThreat(threat, toScreen(threat));
    const playerPoint = toScreen(trialState.position || trial.spawn);
    character(state.mine, playerPoint.x - 14, playerPoint.y - 14, 28);
    const channelLeft = Math.max(0, Number(mechanic.channelEndsAt || 0) - Date.now());
    if (mechanic.carriedLanternId) { ctx.fillStyle = '#fff3a2'; ctx.beginPath(); ctx.arc(playerPoint.x, playerPoint.y - 23, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e28c39'; ctx.fillRect(playerPoint.x - 2, playerPoint.y - 27, 4, 8); }
    if (mechanic.channelObjectiveId) { ctx.strokeStyle = '#d8f6dc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(playerPoint.x, playerPoint.y, 22, 0, Math.PI * 2 * Math.min(1, 1 - channelLeft / 1500)); ctx.stroke(); }
    const spirits = (mechanic.threats || []).filter((threat) => !threat.defeated).length;
    const status = mechanic.id === 'ordered-circuit' ? `SEQUENCE ${trialState.activatedObjectiveIds.length + 1}/${trial.objectives.length} · ${spirits} SPIRITS · SPACE + E`
      : mechanic.id === 'carry-lanterns' ? (mechanic.carriedLanternLabel ? `ESCORTING ${mechanic.carriedLanternLabel.toUpperCase()} · HUNTER ${spirits} · SPACE` : `FLAMES DELIVERED ${mechanic.deliveredLanternIds?.length || 0}/2 · ${spirits} SPIRITS · SPACE + E`)
        : mechanic.id === 'timed-relay' ? (mechanic.blessingExpiresAt ? `BLESSING ${Math.max(0, Math.ceil((mechanic.blessingExpiresAt - Date.now()) / 1000))}s · ${spirits} WARDENS · SPACE` : `BREAK WARDENS · ${spirits} SPIRITS · SPACE + E`)
          : mechanic.channelObjectiveId ? `CHANNELING ${Math.ceil(channelLeft / 1000)}s · DO NOT MOVE` : `CLEAR SPIRITS ${spirits} · CLEANSED ${trialState.activatedObjectiveIds.length}/${trial.objectives.length} · SPACE + E`;
    drawGuardianTrialHud(trial, status, spirits);
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
  function realmPoint(player, width = 28, height = 14) {
    return { x: 74 + (Number(player?.x || 0) / width) * 812, y: 110 + (Number(player?.y ?? player?.z ?? 0) / height) * 408 };
  }
  function drawRealmHeader(title, instruction) {
    drawMinimalHud({ suppressNotice: true });
    panel(300, 14, 430, 55); ctx.textAlign = 'center'; ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#d5b6ff'; ctx.fillText(title, 515, 35);
    ctx.font = '9px monospace'; ctx.fillStyle = '#f7efd6'; ctx.fillText(instruction, 515, 53);
  }
  function drawLonerRealm() {
    const mine = state.mine, realm = mine?.realm;
    if (!['dungeon', 'shadow-forest', 'moon-shrine', 'ghost-village'].includes(realm)) return false;
    if (realm === 'dungeon') {
      ctx.fillStyle = '#151529'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (art.dungeonTiles) for (let row = 0; row < 15; row += 1) for (let column = 0; column < 20; column += 1) ctx.drawImage(art.dungeonTiles, ((column + row) % 4) * 16, 0, 16, 16, 70 + column * 41, 80 + row * 30, 42, 31);
      else { ctx.fillStyle = '#314157'; ctx.fillRect(70, 80, 820, 465); }
      for (const entity of activeEntities()) {
        const p = realmPoint(entity, 20, 16);
        ctx.fillStyle = String(entity.type).includes('enemy') ? '#c96b8d' : String(entity.type).includes('sigil') ? '#b8f3ff' : '#e7c66f';
        ctx.beginPath(); ctx.arc(p.x, p.y, String(entity.type).includes('enemy') ? 13 : 10, 0, Math.PI * 2); ctx.fill();
        ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff7d5'; ctx.fillText(entity.label, p.x, p.y - 18);
      }
      const p = realmPoint(mine, 20, 16); character(mine, p.x - 12, p.y - 14, 25);
      drawRealmHeader('THE SPIRIT REALM', 'PRESS E BESIDE WARDENS, SEALS, THE ALTAR, OR THE RETURN PORTAL');
    } else if (realm === 'shadow-forest') {
      ctx.fillStyle = '#173948'; ctx.fillRect(0, 0, canvas.width, canvas.height); if (art.shadowBackground) ctx.drawImage(art.shadowBackground, 0, 0, canvas.width, canvas.height);
      const platform = (x, y, w) => { ctx.fillStyle = '#285846'; ctx.fillRect(55 + x * 34, 92 + y * 33, w * 34, 16); ctx.fillStyle = '#6da85c'; ctx.fillRect(55 + x * 34, 88 + y * 33, w * 34, 7); };
      [[0,12,5],[6,11,4],[11,12,3],[15,10,3],[19,12,6],[3,8,4],[8,7,3],[12,5,4],[17,7,3],[21,5,3]].forEach(([x, y, w]) => platform(x, y, w));
      ctx.fillStyle = '#f08157'; ctx.fillRect(55 + 16.1 * 34, 92 + 10 * 33, 26, 13); ctx.fillStyle = '#d74e48'; ctx.fillRect(55 + 7.35 * 34, 92 + 11 * 33, 31, 12);
      if (art.shadowExit) ctx.drawImage(art.shadowExit, 55 + 22 * 34, 92 + 3.7 * 33, 65, 65);
      const p = realmPoint(mine, 25, 14); character(mine, p.x - 12, p.y - 14, 25);
      drawRealmHeader('THE SHADOW FOREST', 'MOVE RIGHT · W JUMPS · REACH THE TROPHY AND PRESS E');
    } else if (realm === 'moon-shrine') {
      ctx.fillStyle = '#0e1f46'; ctx.fillRect(0, 0, canvas.width, canvas.height); if (art.moonBackground || art.moonSky) ctx.drawImage(art.moonBackground || art.moonSky, 0, 0, canvas.width, canvas.height);
      const points = [[2,10],[7,10],[7,7],[13,7],[13,10],[19,10],[19,6],[24,6],[28,5]];
      ctx.strokeStyle = '#e8e9ff'; ctx.shadowColor = '#aabaff'; ctx.shadowBlur = 12; ctx.lineWidth = 5; ctx.beginPath(); points.forEach(([x,z], index) => { const p = realmPoint({ x, y: z }, 30, 14); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.shadowBlur = 0;
      if (art.moonShrine) ctx.drawImage(art.moonShrine, 780, 155, 100, 150); else { ctx.fillStyle = '#ddd8ed'; ctx.fillRect(810, 185, 45, 98); }
      const p = realmPoint(mine, 30, 14); character(mine, p.x - 12, p.y - 14, 25);
      drawRealmHeader('THE MOON SHRINE', 'STAY ON THE SILVER LINE · PRESS E AT THE SHRINE');
    } else {
      ctx.fillStyle = '#27314e'; ctx.fillRect(0, 0, canvas.width, canvas.height); if (art.ghostBackground) ctx.drawImage(art.ghostBackground, 0, 0, canvas.width, canvas.height);
      const village = mine.ghostVillage || {};
      for (const ghost of village.ghosts || []) if (ghost.active) { const p = realmPoint({ x: ghost.x, y: ghost.z }, 28, 14); if (art.ghost) ctx.drawImage(art.ghost, p.x - 18, p.y - 35, 36, 36); else { ctx.fillStyle = '#c7e7ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.fill(); } }
      for (const shot of village.projectiles || []) { const p = realmPoint({ x: shot.x, y: shot.z }, 28, 14); ctx.fillStyle = '#fff2a5'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
      const p = realmPoint(mine, 28, 14); character(mine, p.x - 12, p.y - 14, 25);
      drawRealmHeader('THE GHOST VILLAGE', `CLICK TOWARD GHOSTS · ${village.caught || 0}/6 ECHOES REMEMBERED`);
    }
    drawDirectorHud();
    return true;
  }
  function drawLanternRite() {
    const rite = state.world?.lanternRite; if (!rite) return false;
    const point = (x, z) => ({ x: 58 + (x - 1) / 30 * 844, y: 85 + (z - 1) / 27 * 478 });
    const field = ctx.createRadialGradient(480, 270, 60, 480, 270, 620); field.addColorStop(0, '#3b5b64'); field.addColorStop(.5, '#1c3545'); field.addColorStop(1, '#0c1828'); ctx.fillStyle = field; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2c5960'; ctx.fillRect(70, 205, 820, 142); ctx.fillRect(407, 100, 146, 410); ctx.fillStyle = '#486f71'; ctx.fillRect(303, 440, 354, 112);
    const core = point(16, 10); if (art.lanternFloor) ctx.drawImage(art.lanternFloor, core.x - 95, core.y - 95, 190, 190); else { ctx.strokeStyle = '#85d6c4'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(core.x, core.y, 75, 0, Math.PI * 2); ctx.stroke(); }
    for (const entity of activeEntities()) {
      const p = point(entity.x, entity.y);
      if (entity.type === 'lantern-core') { if (art.lanternCore) ctx.drawImage(art.lanternCore, p.x - 34, p.y - 52, 68, 68); else { ctx.fillStyle = '#ffe280'; ctx.fillRect(p.x - 11, p.y - 30, 22, 38); } drawHealthBar(p.x - 38, p.y + 32, 76, entity.health, entity.maxHealth, '#6fe6be'); }
      else if (entity.type === 'lantern-entry-gate') { ctx.strokeStyle = '#ffe99c'; ctx.shadowColor = '#ffe99c'; ctx.shadowBlur = 16; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, 36, Math.PI, 0); ctx.stroke(); ctx.shadowBlur = 0; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${entity.readyCount || 0}/4 READY · E`, p.x, p.y + 29); }
      else if (entity.type === 'lantern-enemy') { ctx.fillStyle = entity.enemyType === 'brute' ? '#b87676' : entity.enemyType === 'swift' ? '#c99cf3' : '#d49b59'; ctx.beginPath(); ctx.arc(p.x, p.y, entity.enemyType === 'brute' ? 17 : 12, 0, Math.PI * 2); ctx.fill(); drawHealthBar(p.x - 20, p.y - 29, 40, entity.hp, entity.maxHp, '#ef7b6a'); }
      else if (entity.type === 'lantern-switch') { if (art.lanternSwitch) ctx.drawImage(art.lanternSwitch, p.x - 23, p.y - 23, 46, 46); else { ctx.fillStyle = '#f6d26b'; ctx.fillRect(p.x - 13, p.y - 13, 26, 26); } ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff2bd'; ctx.fillText(entity.role, p.x, p.y + 33); }
    }
    for (const player of state.players.filter((entry) => entry.realm === 'lantern-rite')) { const p = point(player.x, player.y); character(player, p.x - 12, p.y - 14, 25); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = player.color; ctx.fillText(player.name, p.x, p.y + 26); if (player.lanternMaxHealth) drawHealthBar(p.x - 18, p.y - 34, 36, player.lanternHealth, player.lanternMaxHealth, '#7ee5b7'); }
    drawMinimalHud({ suppressNotice: true }); panel(260, 14, 440, 58); ctx.textAlign = 'center'; ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff0a1'; ctx.fillText('THE LANTERN RITE', 480, 34); ctx.font = '9px monospace'; ctx.fillStyle = '#d9f4ea'; wrap(rite.task || 'The rite is gathering light.', 480, 52, 410, 11);
    if (state.mine?.archetype === 'Guardian') { panel(690, 120, 245, 44); ctx.textAlign = 'center'; ctx.font = '9px monospace'; ctx.fillStyle = '#b9e3ff'; ctx.fillText('GUARDIAN · Q HEAL · R BARRIER', 812, 146); }
    drawDirectorHud();
    return true;
  }
  function drawEchoAccord() {
    const finale = state.world?.finalObjective, accord = finale?.echoAccord;
    if (!accord || state.mine?.realm !== 'echo-accord') return false;
    const arena = accord.arena || { minX: 2, maxX: 46, minZ: 2, maxZ: 30 };
    const point = (x, z) => ({ x: 68 + (x - arena.minX) / Math.max(1, arena.maxX - arena.minX) * 824, y: 90 + (z - arena.minZ) / Math.max(1, arena.maxZ - arena.minZ) * 438 });
    const dusk = ctx.createLinearGradient(0, 0, 0, canvas.height); dusk.addColorStop(0, '#171a3d'); dusk.addColorStop(.52, '#31214d'); dusk.addColorStop(1, '#15182f'); ctx.fillStyle = dusk; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let z = arena.minZ; z < arena.maxZ; z += 2) for (let x = arena.minX; x < arena.maxX; x += 2) {
      const a = point(x, z), b = point(x + 2, z + 2);
      ctx.fillStyle = (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? 'rgba(104,75,152,.24)' : 'rgba(48,75,133,.24)';
      ctx.fillRect(Math.round(a.x), Math.round(a.y), Math.ceil(b.x - a.x), Math.ceil(b.y - a.y));
    }
    const frame = point(arena.minX, arena.minZ), end = point(arena.maxX, arena.maxZ);
    ctx.strokeStyle = '#b78bf0'; ctx.lineWidth = 5; ctx.shadowColor = '#b78bf0'; ctx.shadowBlur = 16; ctx.strokeRect(frame.x, frame.y, end.x - frame.x, end.y - frame.y); ctx.shadowBlur = 0;
    for (const orb of accord.echoes || []) {
      if (!orb.active) continue;
      const p = point(orb.x, orb.z), colors = ['#78e7ff', '#ffde73', '#96ed9d', '#dfa8ff'];
      ctx.save(); ctx.fillStyle = colors[Number(orb.hue) % colors.length]; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (const player of state.players.filter((entry) => entry.realm === 'echo-accord')) {
      const color = player.echoColor || player.color || '#fff';
      const trail = player.echoTrail || [];
      ctx.save(); ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 9; ctx.lineWidth = 5; ctx.lineJoin = 'round';
      ctx.beginPath(); trail.forEach((tile, index) => { const p = point(tile.x, tile.z); if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke(); ctx.restore();
      const p = point(player.x, player.y);
      if (player.echoAlive !== false) {
        ctx.save(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        character(player, p.x - 12, p.y - 13, 25);
      } else { ctx.fillStyle = 'rgba(12,11,27,.64)'; ctx.fillRect(p.x - 13, p.y - 13, 26, 26); }
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(`${player.name} · ${player.echoCollected || 0}`, p.x, p.y + 30);
    }
    drawMinimalHud({ suppressNotice: true }); panel(240, 14, 480, 60); ctx.textAlign = 'center'; ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#f3dcff'; ctx.fillText('THE ECHO ACCORD', 480, 35); ctx.font = '9px monospace'; ctx.fillStyle = '#e8ebff';
    const winner = state.players.find((player) => player.id === accord.winnerId);
    wrap(winner ? `${winner.name}'s living echo endured. The Game Master records what this group became.` : 'MOVE CONTINUOUSLY · GATHER LIGHT · DO NOT STRIKE ANOTHER LIVING TRAIL', 480, 53, 440, 11);
    if (winner) { ctx.fillStyle = 'rgba(232,207,255,.2)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    drawDirectorHud();
    return true;
  }
  function drawStart() {
    const gradient = ctx.createRadialGradient(480, 320, 40, 480, 320, 620);
    gradient.addColorStop(0, '#163f2e'); gradient.addColorStop(.5, '#0d2b20'); gradient.addColorStop(1, '#061710');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(109,177,117,.05)';
    for (let x = 0; x < canvas.width; x += 32) for (let y = 0; y < canvas.height; y += 32) if ((x + y) % 96 === 0) ctx.fillRect(x, y, 2, 2);
    ctx.strokeStyle = 'rgba(94,161,109,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 102); ctx.bezierCurveTo(125, 80, 142, 150, 270, 122); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(960, 510); ctx.bezierCurveTo(825, 540, 790, 474, 670, 505); ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#78b88c'; ctx.fillText('AN EVER-CHANGING CO-OP WORLD', 480, 90);
    ctx.font = 'bold 60px monospace'; ctx.fillStyle = '#020d09'; ctx.fillText('EMERGENT', 483, 177); ctx.fillStyle = '#fff0b6'; ctx.fillText('EMERGENT', 480, 172);
    ctx.fillStyle = '#f2c85e'; ctx.fillRect(426, 192, 108, 2);
    ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#b8d9bf'; ctx.fillText('A game that invents itself around you.', 480, 228);
    ctx.font = '12px monospace'; ctx.fillStyle = '#789b82'; ctx.fillText('ENTER THE WORLD  ·  BEHAVE NATURALLY  ·  DISCOVER TOGETHER', 480, 270);
    const pulse = 1 + Math.sin(performance.now() / 360) * .08;
    ctx.save(); ctx.translate(480, 357); ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(244,201,93,.08)'; ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9d7131'; ctx.fillRect(-15, -18, 30, 36); ctx.fillStyle = '#f6d76f'; ctx.fillRect(-10, -13, 20, 25);
    ctx.fillStyle = '#fff1a8'; ctx.fillRect(-5, -8, 10, 15); ctx.fillStyle = '#183426'; ctx.fillRect(-18, -22, 36, 5); ctx.fillRect(-18, 18, 36, 5);
    ctx.restore();
    ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#fff1bd'; ctx.fillText('LIGHT A LANTERN', 480, 431);
    ctx.font = '10px monospace'; ctx.fillStyle = '#71907a'; ctx.fillText('CLICK ANYWHERE TO BEGIN', 480, 454);
  }
  function drawLobby() { ctx.fillStyle = 'rgba(20,42,57,.74)'; ctx.fillRect(0, 0, canvas.width, canvas.height); panel(212, 214, 536, 188); ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('GATHERING THE EXPEDITION', 480, 255); ctx.font = 'bold 44px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${state.players.length} / 4`, 480, 315); ctx.font = '12px monospace'; ctx.fillStyle = '#d2f0cf'; ctx.fillText('The game begins exactly when four lanterns are present.', 480, 347); }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.joined) { drawStart(); return; }
    if (drawTempleFinale() || drawGuardianTrial() || drawLanternRite() || drawEchoAccord() || drawLonerRealm()) return;
    const zone = state.mine?.zone || 'overworld';
    if (zone === 'sunken-temple') drawSunkenTemple();
    else if (zone === 'dark-cave') drawDarkCave();
    else if (zone === 'hidden-ruins') drawHiddenRuins();
    else {
      const minX = Math.floor(state.camera.x - 25), maxX = Math.ceil(state.camera.x + 25), minY = Math.floor(state.camera.y - 17), maxY = Math.ceil(state.camera.y + 17);
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) drawTile(x, y);
      (state.world?.terrain || []).forEach(drawTerrain); drawOverworldDecor();
      const mood = state.world?.director?.mood || state.world?.directorRules?.activeRules?.find((rule) => rule.card === 'world_mood')?.moodId;
      if (mood === 'mist') { ctx.fillStyle = 'rgba(220,236,242,.18)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      if (mood === 'storm') { ctx.fillStyle = 'rgba(54,67,105,.18)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      if (mood === 'starlight') { ctx.fillStyle = 'rgba(82,57,132,.16)'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      (state.world?.emergentRules?.markers || []).forEach(drawEmergentMarker);
    }
    activeEntities().forEach(drawWorldEntity);
    if (zone === 'dark-cave') (state.world?.caveCombat?.enemies || []).forEach(drawDemon);
    if (zone === 'hidden-ruins') (state.world?.ruinsCombat?.enemies || []).forEach(drawMummy);
    const localPlayers = state.players.filter((player) => (player.zone || 'overworld') === zone && (player.realm || 'overworld') === 'overworld');
    localPlayers.forEach((player) => character(player));
    localPlayers.forEach((player) => label(player.name, player.x, player.y, player.color, ['dark-cave', 'hidden-ruins'].includes(player.zone) ? 48 : 34));
    drawMinimalHud(); drawDirectorHud(); drawCollectorGame();
    if (!gameReady()) drawLobby();
  }
  return { render };
}
