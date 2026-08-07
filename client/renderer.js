import { buildDirectorInstruction, normalizeDirectorState } from './director-copy.js';

// Canvas presentation only.  Keep visual changes here; game state lives in
// session.js and remains server-authoritative.
const T = 20, W = 60, H = 34;
const C = { grass: '#72bd58', ink: '#27324a', gold: '#f7d25c', purple: '#9b75c9' };

export function createRenderer(canvas, session) {
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const art = {}; let authoredForest = null;
  const collectorAssetNames = ['crystal-mine','ancient-vault','treasure-cache','relic-forge','sunken-relic','relic-shard','ancient-coin','glowing-gem-cluster','ornate-key','treasure-map','collector-satchel','excavation-pickaxe','relic-detector','inventory-bag','relic-attraction','collector-emblem','sunken-crown','vault-seal','ancient-idol','jeweled-goblet','reliquary-box','clue-scroll','vault-moon','vault-key','vault-gem','vault-flame'];
  const uiAssets = {
    uiFrame: '/game-art/ui/ui-frame.png',
    uiHeader: '/game-art/ui/ui-header.png',
    uiButton: '/game-art/ui/ui-button-sheet.png',
    uiCompass: '/game-art/ui/ui-compass.png',
    uiScroll: '/game-art/ui/ui-scroll.png',
    uiArrowLeft: '/game-art/ui/ui-left-arrow-sheet.png',
    uiArrowRight: '/game-art/ui/ui-right-arrow-sheet.png',
    uiArrowUp: '/game-art/ui/ui-up-arrow-sheet.png',
    uiArrowDown: '/game-art/ui/ui-down-arrow-sheet.png',
    uiClose: '/game-art/ui/ui-close-sheet.png',
    forgeBellows: '/game-art/generated/forge-bellows.png',
    forgeFlame: '/game-art/generated/forge-flame.png',
    forgeHammer: '/game-art/generated/forge-hammer.png',
    forgeHearth: '/game-art/generated/forge-hearth.png',
    forgeAnvil: '/game-art/generated/forge-anvil.png',
    forgeIngot: '/game-art/generated/forge-ingot.png',
    quenchWater: '/game-art/generated/quench-water.png',
    quenchOil: '/game-art/generated/quench-oil.png',
    quenchSpirit: '/game-art/generated/quench-spirit.png'
  };
  const { state, mapPoint, relics, activeEntities, abilities, gameReady } = session;
  const image = new Image(); image.src = '/game-art/camping-32.png'; image.addEventListener('load', () => { art.camping = image; render(); });
  const dungeonTiles = new Image(); dungeonTiles.src = '/game-art/dungeon/Dungeon_Tileset.png'; dungeonTiles.addEventListener('load', () => { art.dungeon = dungeonTiles; render(); });
  const dungeonChest = new Image(); dungeonChest.src = '/game-art/dungeon/chest_1.png'; dungeonChest.addEventListener('load', () => { art.dungeonChest = dungeonChest; render(); });
  const dungeonSeal = new Image(); dungeonSeal.src = '/game-art/dungeon/coin_1.png'; dungeonSeal.addEventListener('load', () => { art.dungeonSeal = dungeonSeal; render(); });
  const dungeonCharacters = new Image(); dungeonCharacters.src = '/game-art/dungeon/Dungeon_Character.png'; dungeonCharacters.addEventListener('load', () => { art.dungeonCharacters = dungeonCharacters; render(); });
  for (const id of [1, 2, 3, 5]) { const sprite = new Image(); sprite.src = `/game-art/retro-characters/player-${id}.png`; sprite.addEventListener('load', () => { art[`player${id}`] = sprite; render(); }); }
  collectorAssetNames.forEach((name) => { const sprite = new Image(); sprite.src = `/game-art/collector/${name}.png`; sprite.addEventListener('load', () => { art[name] = sprite; render(); }); });
  Object.entries(uiAssets).forEach(([name, src]) => { const sprite = new Image(); sprite.src = src; sprite.addEventListener('load', () => { art[name] = sprite; render(); }); });
  fetch('/game-art/forest.json').then((response) => response.ok ? response.json() : null).then((layout) => { authoredForest = layout; render(); }).catch(() => {});

  function px(x) { const shake=state.hurtTimer>0?(Math.floor(state.frame*8)%2?1:-1)*3*state.hurtStrength:0; return Math.floor(x * T - (state.camera.x * T - canvas.width / 2) + shake); }
  function py(y) { const shake=state.hurtTimer>0?(Math.floor(state.frame*8)%2?-1:1)*2*state.hurtStrength:0; return Math.floor(y * T - (state.camera.y * T - canvas.height / 2) + shake); }
  function panel(x, y, w, h) { ctx.save(); ctx.fillStyle = 'rgba(18,30,43,.94)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#e9cf78'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.restore(); }
  function sheetTile(gid, X, Y) { const tile = gid - 1, columns = Math.floor(art.camping.width / 32); ctx.drawImage(art.camping, (tile % columns) * 32, Math.floor(tile / columns) * 32, 32, 32, X, Y, T, T); }
  function drawTile(x, y) { const X = px(x), Y = py(y), index = y * W + x; if (!authoredForest || !art.camping || x < 0 || y < 0 || x >= W || y >= H) { ctx.fillStyle = C.grass; ctx.fillRect(X, Y, T, T); return; } for (const layer of authoredForest.layers || []) { const gid = layer.data?.[index] || 0; if (gid) sheetTile(gid, X, Y); } }
  function dungeonWall(x, y) { return x < 1 || x > 18 || y < 1 || y > 14 || (x === 9 && y >= 2 && y <= 6 && y !== 4) || (y === 8 && x >= 3 && x <= 16 && ![7, 10, 14].includes(x)); }
  function drawDungeonTile(x, y) { const X = px(x), Y = py(y), wall = dungeonWall(x, y); ctx.fillStyle = wall ? '#231b2d' : '#35243e'; ctx.fillRect(X, Y, T, T); if (art.dungeon) ctx.drawImage(art.dungeon, wall ? 16 : 32, wall ? 0 : 32, 16, 16, X, Y, T, T); }
  function drawSprite(name, X, Y, width, height, alpha = 1) { const sprite = art[name]; if (!sprite) return false; const scale = Math.min(width / sprite.width, height / sprite.height), drawW = Math.max(1, Math.round(sprite.width * scale)), drawH = Math.max(1, Math.round(sprite.height * scale)); ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(sprite, Math.round(X + (width - drawW) / 2), Math.round(Y + (height - drawH)), drawW, drawH); ctx.restore(); return true; }

  function drawUiSprite(name, sx, sy, sw, sh, dx, dy, dw, dh, alpha = 1) { const sprite = art[name]; if (!sprite) return false; ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh); ctx.restore(); return true; }
  function drawNineSlice(name, x, y, w, h, border = 16, alpha = 1) {
    const sprite = art[name];
    if (!sprite) { rounded(x, y, w, h, 12, 'rgba(20,29,40,.97)', '#e6c674'); return false; }
    const sw = sprite.width, sh = sprite.height, innerW = sw - border * 2, innerH = sh - border * 2;
    const dw = Math.max(1, w - border * 2), dh = Math.max(1, h - border * 2);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, 0, 0, border, border, x, y, border, border);
    ctx.drawImage(sprite, border, 0, innerW, border, x + border, y, dw, border);
    ctx.drawImage(sprite, sw - border, 0, border, border, x + w - border, y, border, border);
    ctx.drawImage(sprite, 0, border, border, innerH, x, y + border, border, dh);
    ctx.drawImage(sprite, border, border, innerW, innerH, x + border, y + border, dw, dh);
    ctx.drawImage(sprite, sw - border, border, border, innerH, x + w - border, y + border, border, dh);
    ctx.drawImage(sprite, 0, sh - border, border, border, x, y + h - border, border, border);
    ctx.drawImage(sprite, border, sh - border, innerW, border, x + border, y + h - border, dw, border);
    ctx.drawImage(sprite, sw - border, sh - border, border, border, x + w - border, y + h - border, border, border);
    ctx.restore();
    return true;
  }
  function drawUiHeader(x, y, w, label, iconName = null) {
    if (art.uiHeader) ctx.drawImage(art.uiHeader, 0, 0, art.uiHeader.width, art.uiHeader.height, x, y, w, 28);
    else rounded(x, y, w, 28, 8, '#3f2f46', '#e6c674');
    if (iconName) drawSprite(iconName, x + 6, y + 4, 20, 20);
    ctx.fillStyle = '#47311f'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.fillText(label, x + (iconName ? 28 : 12), y + 18);
  }
  function drawUiButton(x, y, w, h, label, variant = 0) {
    const sprite = art.uiButton;
    if (sprite) {
      const fw = sprite.width / 4;
      drawUiSprite('uiButton', fw * variant, 0, fw, sprite.height, x, y, w, h);
    } else rounded(x, y, w, h, 10, '#344656', '#a6cde5');
    ctx.fillStyle = '#fff8e1'; ctx.font = `bold ${Math.max(10, Math.floor(h * 0.4))}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + h * 0.67); ctx.textAlign = 'left';
  }
  function drawArrowGlyph(direction, x, y, w, h) {
    const map = { left:['uiArrowLeft',3], right:['uiArrowRight',3], up:['uiArrowUp',2], down:['uiArrowDown',2] };
    const [name, frames] = map[direction] || [];
    const sprite = art[name];
    if (sprite) {
      const fw = sprite.width / frames;
      drawUiSprite(name, 0, 0, fw, sprite.height, x, y, w, h);
      return;
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.fillText({ left:'←', right:'→', up:'↑', down:'↓' }[direction], x + w / 2, y + h * 0.68); ctx.textAlign = 'left';
  }
  function drawFeatureBadge(game, x, y) {
    const feature=String(game.feature||'');
    const icon = feature.includes('crystal-mine') ? 'crystal-mine' : feature.includes('ancient-vault') ? 'ancient-vault' : feature.includes('treasure-cache') ? 'treasure-cache' : feature.includes('relic-forge') ? 'relic-forge' : feature.includes('sunken-relic') ? 'sunken-relic' : 'collector-emblem';
    drawSprite(icon, x, y, 38, 38);
    return icon;
  }

  function relicSprite(entity) { if (entity.sprite) return entity.sprite; const label=String(entity.label||'').toLowerCase(); if(label.includes('idol')) return 'ancient-idol'; if(label.includes('crown')) return 'sunken-crown'; if(label.includes('goblet')||label.includes('chalice')) return 'jeweled-goblet'; if(label.includes('box')||label.includes('cache')||label.includes('vault')) return 'reliquary-box'; if(label.includes('map')) return 'treasure-map'; if(label.includes('key')||label.includes('compass')) return 'ornate-key'; if(label.includes('coin')||label.includes('token')) return 'ancient-coin'; if(label.includes('amber')) return 'vault-seal'; if(label.includes('shard')||label.includes('fragment')) return 'relic-shard'; if(label.includes('gem')||label.includes('crystal')) return 'glowing-gem-cluster'; const names = ['relic-shard', 'ancient-coin', 'ornate-key', 'treasure-map']; const seed = String(entity.id || entity.label || 'relic').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0); return names[seed % names.length]; }
  function drawTerrain(area) { const point = mapPoint(area), width = Math.max(1, Number(area.w) || 1) * T, height = Math.max(1, Number(area.h) || 1) * T, kind = String(area.kind || '').toLowerCase(); if (kind.includes('water')) { return; } else if (kind.includes('bridge')) { ctx.fillStyle = '#7d5536'; ctx.fillRect(px(point.x), py(point.y) + 6, width, Math.max(7, height - 10)); } else if (kind.includes('spirit')) { ctx.fillStyle = 'rgba(123,80,175,.42)'; ctx.fillRect(px(point.x), py(point.y), width, height); } else { ctx.fillStyle = 'rgba(208,194,112,.58)'; ctx.fillRect(px(point.x), py(point.y), width, height); } }
  function glow(X, Y, radius=22, color='rgba(255,214,96,.55)') {
    const pulse=0.9+Math.sin(state.frame*0.8)*0.08, gradient=ctx.createRadialGradient(X,Y,2,X,Y,radius*pulse);
    gradient.addColorStop(0,color); gradient.addColorStop(.38,color.replace(/\.[0-9]+\)/,'.22)')); gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=gradient; ctx.beginPath(); ctx.arc(X,Y,radius*pulse,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  function drawEntity(entity) {
    const X = px(entity.x), Y = py(entity.y), kind = String(entity.kind || entity.type || '').toLowerCase();
    if (kind.includes('dungeon-enemy')) {
      const sprite=Number(entity.sprite)||0, sx=(sprite%7)*16, sy=Math.floor(sprite/7)*16;
      if(art.dungeonCharacters) ctx.drawImage(art.dungeonCharacters,sx,sy,16,16,X,Y,20,20);
      if(state.attackTimer>0&&state.attackTargetId===entity.id){ctx.fillStyle=`rgba(255,245,210,${Math.min(1,state.attackTimer*3)})`;ctx.fillRect(X+2,Y+2,16,16);}
      ctx.fillStyle='#35151f';ctx.fillRect(X+2,Y-4,16,3);ctx.fillStyle='#e45b69';ctx.fillRect(X+2,Y-4,Math.round(16*(entity.hp/3)),3);
    }
    else if (kind.includes('dungeon-sigil')) { if (art.dungeonSeal) ctx.drawImage(art.dungeonSeal, X + 2, Y + 2, 16, 16); else { ctx.fillStyle='#8ce8ff';ctx.fillRect(X+6,Y+4,8,12); } }
    else if (kind.includes('dungeon-altar')) { if (art.dungeonChest) ctx.drawImage(art.dungeonChest, X + 2, Y + 2, 16, 16); ctx.strokeStyle=entity.active?'#8ce8ff':'#775b85';ctx.strokeRect(X,Y,20,20); }
    else if (kind.includes('dungeon-exit')) { ctx.fillStyle=entity.active?'#76d9ee':'#433650';ctx.fillRect(X+3,Y+2,14,17);ctx.fillStyle='#171322';ctx.fillRect(X+7,Y+6,6,13); }
    else if (kind.includes('finale-circle')) { ctx.strokeStyle = entity.role === state.mine?.archetype ? '#fff2a8' : '#9ed7c0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X + 10, Y + 10, 9, 0, Math.PI * 2); ctx.stroke(); }
    else if (kind.includes('finale-destination')) { glow(X+10,Y+10,28,'rgba(117,230,189,.48)'); ctx.fillStyle = entity.transformed ? '#ecfcb7' : '#bd9f65'; ctx.fillRect(X, Y + 5, 20, 15); ctx.fillStyle = entity.transformed ? '#75e6bd' : '#625877'; ctx.fillRect(X + 6, Y, 8, 15); }
    else if (kind === 'collector-dig') {
      glow(X+10,Y+10,18,'rgba(96,215,255,.42)');
      ctx.save(); ctx.strokeStyle='rgba(69,92,87,.95)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(X+3,Y+7); ctx.lineTo(X+9,Y+10); ctx.lineTo(X+6,Y+15); ctx.moveTo(X+9,Y+10); ctx.lineTo(X+15,Y+5); ctx.moveTo(X+9,Y+10); ctx.lineTo(X+16,Y+16); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha=.72; drawSprite('glowing-gem-cluster',X+4,Y+7,12,12); ctx.restore();
    }
    else if (kind === 'observation-item' || kind === 'collector-clue' || kind.includes('relic')) { const hue=kind==='collector-clue'?'rgba(115,219,255,.52)':'rgba(255,210,92,.48)'; glow(X+10,Y+10,20,hue); if (!drawSprite(relicSprite(entity), X - 7, Y - 11, 34, 34)) { ctx.fillStyle = C.gold; ctx.fillRect(X + 6, Y + 4, 8, 12); } }
    else if (kind === 'world-evolution') {
      const feature = String(entity.feature || '').toLowerCase();
      const collectorSprite = ['crystal-mine','ancient-vault','treasure-cache','relic-forge','sunken-relic'].includes(feature) ? feature : null;
      if (collectorSprite) { glow(X+10,Y+7,38, feature==='relic-forge'?'rgba(184,108,255,.42)':'rgba(113,229,205,.42)'); drawSprite(collectorSprite, X - 22, Y - 34, 64, 64); }
      else { glow(X+10,Y+10,27,'rgba(145,238,184,.34)'); ctx.fillStyle = '#c9b875'; ctx.fillRect(X + 1, Y + 7, 18, 11); ctx.fillStyle = '#8ce1b0'; ctx.fillRect(X + 5, Y + 3, 10, 11); }
    }
    else if (kind.includes('gate') || kind.includes('spirit')) { ctx.fillStyle = '#4f376f'; ctx.fillRect(X + 3, Y + 2, 14, 16); ctx.fillStyle = '#d9b4ff'; ctx.fillRect(X + 6, Y + 5, 8, 11); }
    else if (kind.includes('shrine')) { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 3, Y + 7, 14, 10); ctx.fillStyle = C.purple; ctx.fillRect(X + 7, Y + 1, 6, 9); }
    else if (kind.includes('temple') || kind.includes('altar')) { ctx.fillStyle = '#b9a882'; ctx.fillRect(X, Y + 5, 20, 15); ctx.fillStyle = kind.includes('altar') ? C.gold : '#706879'; ctx.fillRect(X + 7, Y + 8, 6, 12); }
    else { ctx.fillStyle = '#d8d4bd'; ctx.fillRect(X + 4, Y + 4, 12, 12); }
  }
  function character(player) { const X = px(player.x), Y = py(player.y), sprite=art[`player${player.sprite}`], rows={down:0,left:1,right:2,up:3}, row=rows[player.facing]??0, frame=player.moving?Math.floor(state.frame*1.4)%3:1; if(sprite)ctx.drawImage(sprite,frame*32,row*32,32,32,X-6,Y-10,32,32);else{ctx.fillStyle=C.ink;ctx.fillRect(X+4,Y+4,10,11);ctx.fillStyle=player.color;ctx.fillRect(X+5,Y+5,8,8);}ctx.fillStyle=player.color;ctx.fillRect(X+3,Y+18,14,2);if(player===state.mine&&state.hurtTimer>0&&Math.floor(state.frame*12)%2===0){ctx.fillStyle='rgba(255,240,230,.75)';ctx.fillRect(X-4,Y-8,28,28);} }
  function drawAttack() { const player=state.mine;if(!player||state.attackTimer<=0||player.realm!=='dungeon')return;const X=px(player.x)+10,Y=py(player.y)+10,dx=state.attackTargetX-player.x,dy=state.attackTargetY-player.y,angle=Math.atan2(dy,dx),progress=1-state.attackTimer/.28,swing=angle-.9+progress*1.8;ctx.save();ctx.translate(X,Y);ctx.rotate(swing);ctx.fillStyle='#d9e7ee';ctx.fillRect(8,-2,15,4);ctx.fillStyle='#fff8c9';ctx.fillRect(20,-1,7,2);ctx.fillStyle='#8b6b46';ctx.fillRect(4,-3,6,6);ctx.restore(); }
  function label(text, x, y, color = '#fff7d5') { ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; const tx = px(x), ty = py(y) - 14; const width = Math.max(32, ctx.measureText(text).width + 14); ctx.fillStyle = 'rgba(12,22,33,.90)'; ctx.fillRect(Math.round(tx - width / 2), ty - 10, width, 14); ctx.fillStyle = color; ctx.fillRect(Math.round(tx - width / 2 + 3), ty - 7, 4, 4); ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 3; ctx.strokeText(text, tx + 3, ty); ctx.fillStyle = '#ffffff'; ctx.fillText(text, tx + 3, ty); }
  function wrap(text, x, y, max, line, maxLines=6) { const words = String(text || '').split(/\s+/); let current='', yy=y, lines=0; for (const word of words) { const next=current ? `${current} ${word}` : word; if (ctx.measureText(next).width > max && current) { ctx.fillText(current,x,yy); lines++; if(lines>=maxLines) return yy; current=word; yy+=line; } else current=next; } if(current && lines<maxLines) ctx.fillText(current,x,yy); return yy; }
  function drawDirectorHud() {
    const { directives } = normalizeDirectorState(state.world, state.network.playerId);
    if (!directives.length) return;
    const instruction = buildDirectorInstruction(state.world, state.network.playerId);
    panel(14, 214, 365, 56); ctx.textAlign = 'left'; ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#9de3ff'; ctx.fillText('THE GAME MASTER SHIFTS THE WORLD', 27, 234); ctx.fillStyle = '#fff7d5'; ctx.font = '10px monospace'; wrap(instruction, 27, 251, 335, 12);
  }
  function drawHud() {
    const mine=state.mine, observing=state.world?.phase==='observing';
    panel(14,14,312,66); ctx.textAlign='left'; ctx.font='bold 13px monospace'; ctx.fillStyle='#fff1b8'; ctx.fillText('EVERDAWN',27,35);
    ctx.font='11px monospace'; ctx.fillStyle='#d9f3e1'; ctx.fillText(!state.network.connected?'CONNECTING…':!gameReady()?`LANTERNS ${state.players.length}/4`:observing?`THE GM OBSERVES · ${state.world.observationSecondsRemaining ?? '?'}s`:`YOUR ROLE · ${mine?.archetype||'AWAKENING'}`,27,57);
    panel(336,14,252,52); ctx.font='10px monospace'; ctx.fillStyle='#fff8dc'; ctx.fillText('MOVE  WASD / ARROWS',349,34); ctx.fillText('INTERACT  E  ·  FULLSCREEN  F',349,51);
    panel(760,14,186,106); ctx.font='bold 10px monospace'; ctx.fillStyle='#fff1b8'; ctx.fillText(`LANTERNS · ${state.network.roomCode||'—'}`,774,34);
    state.players.forEach((player,index)=>{ctx.fillStyle=player.color;ctx.fillRect(775,44+index*16,8,8);ctx.fillStyle='#ffffff';const role=player.archetype||'observed';ctx.fillText(`${String(player.name).slice(0,11)} · ${role}`,789,52+index*16);});
    if(observing){ panel(14,90,374,76); ctx.fillStyle='#ffe49b'; ctx.font='bold 11px monospace'; ctx.fillText('OBSERVATION',27,111); ctx.fillStyle='#ffffff'; ctx.font='10px monospace'; wrap('Explore naturally. Shiny objects can be gathered with E; the Game Master is watching who notices what others ignore.',27,130,348,13,3); }
    if(mine?.archetype||abilities().length){ panel(14,observing?174:90,374,62); ctx.fillStyle='#f0c8ff';ctx.font='bold 10px monospace';ctx.fillText(`ROLE · ${mine?.archetype||'UNREAD'}`,27,observing?195:111);ctx.fillStyle='#fff';ctx.font='10px monospace';wrap(abilities().slice(0,4).join(' · '),27,observing?213:129,348,12,3); }
    if(mine?.archetype==='Collector' && mine.collectorObjective){
      const objective=mine.collectorObjective, y=130; panel(642,y,304,78); drawSprite('collector-emblem',652,y+11,28,28); ctx.fillStyle=objective.completed?'#9ff0b8':'#ffe49b';ctx.font='bold 10px monospace';ctx.fillText(objective.completed?'COLLECTOR OBJECTIVE · COMPLETE':'COLLECTOR OBJECTIVE',688,y+23);
      ctx.fillStyle='#ffffff'; ctx.font='bold 10px monospace'; ctx.fillText(objective.title,652,y+45);
      ctx.font='10px monospace'; ctx.fillStyle='#f4f0df'; wrap(objective.completed?'Its reward will carry into the finale.':`${objective.progressText} · ${objective.instruction}`,652,y+61,282,12,2);
    }
    if(state.noticeTimer>0||!gameReady()){panel(180,552,600,64);ctx.textAlign='center';ctx.font='bold 12px monospace';ctx.fillStyle='#ffffff';wrap(state.notice,480,575,540,16,3);}
  }
  function drawStart() { ctx.fillStyle = '#70b957'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textAlign = 'center'; ctx.font = 'bold 54px monospace'; ctx.fillStyle = C.ink; ctx.fillText('EVERDAWN', 482, 179); ctx.fillStyle = '#fff3b8'; ctx.fillText('EVERDAWN', 480, 175); ctx.font = 'bold 15px monospace'; ctx.fillStyle = '#fff9de'; ctx.fillText('A four-player living tale.', 480, 215); panel(245, 264, 470, 128); ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#f8de90'; ctx.fillText('THE WORLD OPENS ONLY FOR FOUR.', 480, 296); ctx.font = '11px monospace'; ctx.fillStyle = '#e4f1dc'; ctx.fillText('Each wanderer receives a distinct role and a unique ability.', 480, 328); ctx.fillText('CLICK TO LIGHT A LANTERN', 480, 445); }
  function drawLobby() { ctx.fillStyle = 'rgba(20,42,57,.74)'; ctx.fillRect(0, 0, canvas.width, canvas.height); panel(212, 214, 536, 188); ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#fff2bd'; ctx.fillText('GATHERING THE EXPEDITION', 480, 255); ctx.font = 'bold 44px monospace'; ctx.fillStyle = '#fff7d5'; ctx.fillText(`${state.players.length} / 4`, 480, 315); ctx.font = '12px monospace'; ctx.fillStyle = '#d2f0cf'; ctx.fillText('The game begins exactly when four lanterns are present.', 480, 347); }
  function rounded(x,y,w,h,r=8,fill='#243444',stroke='#e8cf7a'){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}

function uiPanel(x,y,w,h,fill='rgba(11,18,40,.96)',stroke='#d39f53',line=2,r=12){
  ctx.save(); ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill(); if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=line; ctx.stroke(); } ctx.restore();
}
function uiInset(x,y,w,h,fill='rgba(20,32,66,.86)',stroke='rgba(125,155,214,.35)',line=1,r=10){
  ctx.save(); ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill(); if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=line; ctx.stroke(); } ctx.restore();
}
function drawDivider(x,y,w,color='rgba(219,169,90,.55)'){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke(); ctx.restore(); }
function drawCollectorWindow(game){
  const showJournal = (game.clueTotal||0) > 0 || (game.clues||[]).length > 0;
  const box = { x:28, y:18, w:930, h:612, innerX:48, innerY:150, innerW: showJournal ? 620 : 858, innerH: 424, showJournal, journalX: showJournal ? 688 : 0, journalW: 250 };
  ctx.fillStyle='rgba(4,8,18,.84)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  uiPanel(box.x, box.y, box.w, box.h, 'rgba(8,12,34,.97)', '#d4974d', 2, 16);
  uiInset(box.x+14, box.y+14, box.w-28, 66, 'rgba(16,18,50,.94)', 'rgba(232,192,112,.20)', 1, 12);
  drawFeatureBadge(game, box.x+24, box.y+22);
  ctx.textAlign='left'; ctx.fillStyle='#fff3d8'; ctx.font='bold 18px monospace'; ctx.fillText(game.title, box.x+76, box.y+46);
  const closeX=box.x+box.w-54, closeY=box.y+24;
  uiInset(closeX, closeY, 30, 30, 'rgba(34,26,52,.96)', 'rgba(232,192,112,.42)', 1, 8);
  if(art.uiClose){ const fw=art.uiClose.width/4; drawUiSprite('uiClose',0,0,fw,art.uiClose.height,closeX+5,closeY+5,20,20); }
  else { ctx.fillStyle='#fff2df'; ctx.font='bold 17px monospace'; ctx.textAlign='center'; ctx.fillText('×',closeX+15,closeY+21); ctx.textAlign='left'; }
  game.hitboxes.push({x:closeX,y:closeY,w:30,h:30,action:'close'});
  uiInset(box.x+20, box.y+92, box.w-40, 52, 'rgba(12,18,48,.82)', 'rgba(97,125,204,.18)', 1, 10);
  ctx.fillStyle='#edf2ff'; ctx.font='11px monospace'; wrap(game.instruction, box.x+34, box.y+113, box.w-68, 13, 3);
  if (showJournal) drawClueJournal(game, box);
  return box;
}
function crystalTemplate(index){
  const pieces=[
    [[-78,-72],[0,-42],[0,12],[-102,-5]],
    [[0,-42],[78,-72],[102,-5],[0,12]],
    [[0,12],[38,52],[-38,52]],
    [[-102,-5],[0,12],[-38,52],[0,112],[-72,48]],
    [[0,12],[102,-5],[72,48],[0,112],[38,52]]
  ];
  const points=pieces[index%5];
  const cx=points.reduce((sum,[x])=>sum+x,0)/points.length;
  const cy=points.reduce((sum,[,y])=>sum+y,0)/points.length;
  return points.map(([x,y])=>[x-cx,y-cy]);
}
function crystalHeartOutline(){
  return [[-78,-72],[0,-42],[78,-72],[102,-5],[72,48],[0,112],[-72,48],[-102,-5]];
}
function traceCrystal(cx, cy, points, scale = 1){
  ctx.beginPath(); points.forEach(([px,py],i)=>{ const x=cx+px*scale, y=cy+py*scale; if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.closePath();
}
function drawCrystalShard(cx, cy, index, options={}){
  const { selected=false, locked=false, alpha=1, socket=false } = options; const points=crystalTemplate(index), scale=socket ? 1.0 : 1.0;
  ctx.save(); ctx.globalAlpha=alpha; traceCrystal(cx, cy, points, scale);
  if(socket){
    ctx.fillStyle='rgba(72,118,192,.20)'; ctx.fill();
    ctx.strokeStyle= selected ? '#d7fbff' : '#7de1ff'; ctx.lineWidth= selected ? 4 : 3; ctx.stroke();
    ctx.save(); ctx.shadowBlur=16; ctx.shadowColor='rgba(120,225,255,.5)'; ctx.stroke(); ctx.restore();
  }
  else {
    const grad=ctx.createLinearGradient(cx-18, cy-48, cx+28, cy+50); grad.addColorStop(0, locked ? '#f3ffff' : '#dbfbff'); grad.addColorStop(.45, locked ? '#b4f4ff' : '#9ae7ff'); grad.addColorStop(1, locked ? '#58c8ff' : '#43a8f0');
    ctx.shadowBlur = selected ? 28 : 18; ctx.shadowColor = selected ? 'rgba(221,251,255,.98)' : 'rgba(106,230,255,.92)'; ctx.fillStyle=grad; ctx.fill(); ctx.shadowBlur=0;
    ctx.strokeStyle='#eefcff'; ctx.lineWidth=3; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.24)'; traceCrystal(cx-6, cy-10, [[-2,-16],[13,-8],[10,16],[-6,18],[-14,0]], 1.2); ctx.fill();
  }
  ctx.restore();
}
function drawAppraisalCard(x,y,w,h,item,selected,revealed){
  uiInset(x,y,w,h, selected ? 'rgba(42,52,88,.98)' : 'rgba(18,24,60,.95)', selected ? '#f7d98f' : 'rgba(122,150,224,.28)', selected ? 2 : 1, 12);
  if(selected){ ctx.save(); ctx.shadowBlur=18; ctx.shadowColor='rgba(255,232,157,.38)'; ctx.strokeStyle='rgba(255,232,157,.55)'; ctx.lineWidth=2; ctx.strokeRect(x+4,y+4,w-8,h-8); ctx.restore(); }
  drawSprite(item.sprite, x+10, y+12, 54, 54); ctx.fillStyle='#fff4d0'; ctx.font='bold 10px monospace'; wrap(item.name, x+68, y+28, w-84, 12, 2);
  if(selected){ ctx.fillStyle='#ffe595'; ctx.font='bold 10px monospace'; ctx.fillText('SELECTED', x+w-78, y+18); }
  ctx.fillStyle=revealed ? (item.risk==='Cursed' ? '#ffb1a8' : item.risk==='Replica' ? '#bdc7d3' : '#b7f0bf') : '#d8dfef'; ctx.font='10px monospace';
  wrap(revealed ? `${item.value} value · ${item.risk}` : 'Appraise with clues', x+12, y+h-18, w-24, 11, 2);
}
function drawQuenchBasin(x,y,w,h,label,selected=false){
  uiInset(x,y,w,h, selected ? 'rgba(42,52,88,.98)' : 'rgba(18,24,60,.95)', selected ? '#f7d98f' : 'rgba(122,150,224,.28)', selected ? 2 : 1, 12);
  const spriteName = label === 'WATER' ? 'quenchWater' : label === 'OIL' ? 'quenchOil' : 'quenchSpirit';
  const sprite = art[spriteName];
  if(sprite) ctx.drawImage(sprite, x+22, y+28, w-44, h-48);
  else {
    ctx.fillStyle='#6f4b3b'; ctx.fillRect(x+26,y+58,w-52,20);
    ctx.fillStyle='#4e3025'; ctx.fillRect(x+18,y+76,w-36,30);
    ctx.strokeStyle='#8b5e49'; ctx.strokeRect(x+18,y+76,w-36,30);
    ctx.fillStyle='#86b3cd'; ctx.fillRect(x+28,y+64,w-56,10);
  }
  ctx.fillStyle='#fff5d8'; ctx.font='bold 12px monospace'; ctx.textAlign='center'; ctx.fillText(label, x+w/2, y+20); ctx.textAlign='left';
}
function helperCountForForge(){ const mine=state.mine; if(!mine) return 0; return state.players.filter((player)=>player.id!==mine.id && (player.realm||'overworld')===(mine.realm||'overworld')).length; }

  function hit(game,x,y,w,h,action,extra={}){game.hitboxes.push({x,y,w,h,action,...extra});}


function drawClueJournal(game, box){
  const x=box.journalX, y=box.innerY, w=box.journalW, h=box.innerH;
  uiInset(x,y,w,h,'rgba(13,20,52,.92)','rgba(234,192,112,.22)',1,12);
  ctx.fillStyle='#fff4d8'; ctx.font='bold 12px monospace'; ctx.fillText(`CLUE JOURNAL · ${game.clues.length}/${game.clueTotal}`, x+14, y+22);
  drawDivider(x+12, y+30, w-24);
  if(!game.clues.length){
    if(art.uiScroll) ctx.drawImage(art.uiScroll, x+70, y+84, 52, 58);
    ctx.fillStyle='#dce6ff'; ctx.font='11px monospace'; wrap('No clues found yet. Search the wider map for parchment scrolls that glow beside your role.', x+18, y+180, w-36, 14, 6);
    return;
  }
  let cy=y+46;
  game.clues.forEach((clue, index)=>{
    const cardH = 88;
    uiInset(x+12, cy, w-24, cardH, 'rgba(17,24,60,.96)', 'rgba(104,130,212,.28)', 1, 10);
    if(art.uiScroll) ctx.drawImage(art.uiScroll, x+20, cy+16, 24, 30); else drawSprite('clue-scroll', x+18, cy+16, 24, 30);
    ctx.fillStyle='#fff0c7'; ctx.font='bold 10px monospace'; wrap(`${index+1}. ${clue.title}`, x+52, cy+22, w-74, 12, 2);
    ctx.fillStyle='#d8e3ff'; ctx.font='10px monospace'; wrap(clue.text, x+52, cy+44, w-74, 12, 3);
    cy += cardH + 10;
  });
}
function drawCollectorGame(){
  const game=state.collectorGame; if(!game) return; game.hitboxes=[];
  const box=drawCollectorWindow(game);
  const leftX=box.innerX, topY=box.innerY, contentW=box.innerW, contentH=box.innerH;
  if(game.type==='crystal-rebuild'){
    ctx.fillStyle='#fff2d1'; ctx.font='bold 12px monospace'; ctx.fillText('CRYSTAL MINE REASSEMBLY', leftX, topY+16);
    uiInset(leftX, topY+38, 260, 370, 'rgba(17,22,55,.96)', 'rgba(92,123,211,.22)', 1, 12);
    ctx.fillStyle='#a9b9df'; ctx.font='10px monospace'; wrap('Recovered fragments', leftX+18, topY+62, 170, 12, 1);
    uiInset(leftX+280, topY+38, 340, 370, 'rgba(8,18,62,.95)', 'rgba(92,123,211,.22)', 1, 12);
    ctx.fillStyle='#a9b9df'; ctx.font='10px monospace'; wrap('Restore the Crystal Heart', leftX+298, topY+62, 220, 12, 1);

    const heartCenterX=520, heartCenterY=355;
    ctx.save();
    ctx.globalAlpha=.16;
    traceCrystal(heartCenterX,heartCenterY,crystalHeartOutline(),1.08);
    ctx.fillStyle='rgba(78,138,205,.28)'; ctx.fill();
    ctx.strokeStyle='rgba(126,226,255,.40)'; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();

    game.pieces.forEach((piece,index)=>{
      drawCrystalShard(piece.targetX,piece.targetY,index,{socket:true,selected:game.selectedPiece===index});
    });
    game.pieces.forEach((piece,index)=>{
      drawCrystalShard(piece.x,piece.y,index,{selected:game.selectedPiece===index,locked:piece.locked});
      if(!piece.locked) game.hitboxes.push({x:piece.x-55,y:piece.y-55,w:110,h:110,action:'crystal-piece',index});
      if(game.selectedPiece===index && !piece.locked) game.hitboxes.push({x:piece.targetX-42,y:piece.targetY-42,w:84,h:84,action:'crystal-socket',index});
    });

    uiInset(leftX, topY+418, 620, 46, 'rgba(15,22,56,.88)', 'rgba(92,123,211,.22)', 1, 12);
    ctx.fillStyle='#dfe8ff'; ctx.font='11px monospace'; wrap('Drag each fragment into the matching section. When all five are seated, they join into one complete Crystal Heart.', leftX+14, topY+437, 594, 13, 2);
    ctx.fillStyle='#fff4d8'; ctx.font='bold 11px monospace'; ctx.fillText(`FRAGMENTS LOCKED · ${game.pieces.filter((piece)=>piece.locked).length}/5`, leftX, topY+482);
  } else if(game.type==='sequence'){
    ctx.fillStyle='#fff2d1'; ctx.font='bold 12px monospace'; ctx.fillText('ANCIENT LOCKING PLATE', leftX, topY+18);
    const tilePos=[[leftX+24,topY+46],[leftX+302,topY+46],[leftX+24,topY+214],[leftX+302,topY+214]], runeArt=['vault-moon','vault-key','vault-gem','vault-flame'];
    game.symbols.forEach((name,i)=>{ const [x,y]=tilePos[i], active=game.entered.includes(i); uiInset(x,y,250,140, active ? 'rgba(38,48,84,.98)' : 'rgba(17,24,60,.95)', active ? '#f4ca6e' : 'rgba(104,130,212,.28)', active ? 2 : 1, 12); drawSprite(runeArt[i], x+72, y+24, 92, 72); ctx.textAlign='center'; ctx.fillStyle='#fff5d8'; ctx.font='bold 14px monospace'; ctx.fillText(name, x+125, y+116); ctx.textAlign='left'; game.hitboxes.push({x,y,w:250,h:140,action:'rune',index:i}); });
    ctx.fillStyle='#dce7ff'; ctx.font='11px monospace'; ctx.fillText('Vault mechanism:', leftX, topY+392);
    for(let i=0;i<4;i+=1){ const x=leftX+144+i*105; uiInset(x,topY+372,92,42, i<game.entered.length ? 'rgba(44,54,90,.98)' : 'rgba(17,24,60,.95)', i<game.entered.length ? '#f4ca6e' : 'rgba(104,130,212,.28)', 1, 10); ctx.textAlign='center'; ctx.fillStyle=i<game.entered.length ? '#fff1b5' : '#b6c1dc'; ctx.font='bold 11px monospace'; ctx.fillText(i<game.entered.length ? game.symbols[game.answer[i]] : '?', x+46, topY+398); ctx.textAlign='left'; }
    ctx.fillStyle='#fff4d8'; ctx.font='bold 11px monospace'; ctx.fillText(`LOCKS TURNED · ${game.entered.length}/4`, leftX, topY+438);
  } else if(game.type==='appraisal'){
    ctx.fillStyle='#fff2d1'; ctx.font='bold 12px monospace'; ctx.fillText('APPRAISER TABLE · CHOOSE THREE', leftX, topY+20);
    const revealed=game.clues.length>=game.clueTotal;
    game.items.forEach((item,i)=>{ const x=leftX+(i%3)*202, y=topY+48+Math.floor(i/3)*148; drawAppraisalCard(x,y,184,126,item,game.chosen.includes(i),revealed); game.hitboxes.push({x,y,w:184,h:126,action:'item',index:i}); });
    ctx.fillStyle='#ffe7a8'; ctx.font='bold 11px monospace'; ctx.fillText(`SELECTED VALUE · ${game.progress}`, leftX+214, topY+382);
    drawUiButton(leftX+178, topY+396, 252, 42, 'CONFIRM TREASURES', 1); ctx.strokeStyle='rgba(14,20,36,.75)'; ctx.lineWidth=2; ctx.strokeRect(leftX+178, topY+396, 252, 42); game.hitboxes.push({x:leftX+178,y:topY+396,w:252,h:42,action:'confirm'});
    ctx.fillStyle='#cfdaf2'; ctx.font='10px monospace'; wrap('Only the three genuine relics satisfy the full appraisal notes.', leftX, topY+458, 430, 12, 2);
  } else if(game.type==='forge'){
    ctx.fillStyle='#fff2d1'; ctx.font='bold 12px monospace'; ctx.fillText(`FORGE STAGE · ${game.phase.toUpperCase()}`, leftX, topY+20);
    if(game.phase==='ingredients'){
      uiInset(leftX, topY+42, 620, 188, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      game.components.forEach((name,i)=>{ const x=leftX+18+i*120, y=topY+84, chosen=game.recipe.includes(i); uiInset(x,y,102,92, chosen ? 'rgba(42,52,88,.98)' : 'rgba(17,24,60,.95)', chosen ? '#f7d98f' : 'rgba(104,130,212,.28)', chosen ? 2 : 1, 10); ctx.textAlign='center'; ctx.fillStyle=chosen?'#fff1b5':'#e2e9ff'; ctx.font='bold 11px monospace'; wrap(name,x+51,y+44,78,12,2); ctx.textAlign='left'; game.hitboxes.push({x,y,w:102,h:92,action:'component',index:i}); });
      ctx.fillStyle='#dce7ff'; ctx.font='11px monospace'; ctx.fillText(`Selected recipe · ${game.recipe.map((i)=>game.components[i]).join(' → ') || 'none'}`, leftX+18, topY+214);
    } else if(game.phase==='heat'){
      const heat=game.heat, target=heat>=82&&heat<=89;
      uiInset(leftX, topY+42, 392, 312, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      if(art.forgeHearth) ctx.drawImage(art.forgeHearth, leftX+24, topY+88, 344, 246);
      if(art.forgeIngot) ctx.drawImage(art.forgeIngot, leftX+118, topY+72, 132, 62);
      else { ctx.fillStyle='#9b7b63'; ctx.fillRect(leftX+120, topY+90, 122, 20); }
      if(art.forgeHammer) ctx.drawImage(art.forgeHammer, leftX+262, topY+58, 56, 56);
      if(art.forgeFlame) { const scale=0.88 + heat/140; const fw=156*scale, fh=156*scale; ctx.drawImage(art.forgeFlame, leftX+121-(fw-156)/2, topY+152-(fh-156)/2, fw, fh); }
      if(target){ ctx.save(); ctx.shadowBlur=18; ctx.shadowColor='rgba(255,198,90,.9)'; ctx.strokeStyle='rgba(255,214,112,.95)'; ctx.lineWidth=2; ctx.strokeRect(leftX+116, topY+70, 136, 66); ctx.restore(); }
      uiInset(leftX+412, topY+42, 208, 312, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      if(art.forgeBellows) ctx.drawImage(art.forgeBellows, leftX+434, topY+80, 164, 118);
      ctx.fillStyle='#fff4d8'; ctx.font='bold 14px monospace'; ctx.textAlign='center'; ctx.fillText('BELLOWS', leftX+516, topY+214); ctx.fillText(`${Math.round(heat)}% HEAT`, leftX+516, topY+292); ctx.textAlign='left';
      drawUiButton(leftX+456, topY+232, 122, 40, 'PUMP', 2); game.hitboxes.push({x:leftX+456,y:topY+232,w:122,h:40,action:'bellows'});
      ctx.fillStyle='#d2dcf2'; ctx.font='10px monospace'; wrap('Rapidly cooling forge. Each pump adds +2 heat. Other players can stand at the Relic Forge and press E to help pump.', leftX+430, topY+316, 172, 12, 6);
      uiInset(leftX, topY+372, 620, 58, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      ctx.fillStyle='#263550'; ctx.fillRect(leftX+16, topY+392, 588, 14); ctx.fillStyle='#6f3425'; ctx.fillRect(leftX+16, topY+392, 200, 14); ctx.fillStyle='#cb642a'; ctx.fillRect(leftX+216, topY+392, 120, 14); ctx.fillStyle='#f0a646'; ctx.fillRect(leftX+336, topY+392, 130, 14); ctx.fillStyle='#efe0a4'; ctx.fillRect(leftX+466, topY+392, 138, 14); ctx.strokeStyle='#a4bdd8'; ctx.strokeRect(leftX+16, topY+392, 588, 14); ctx.fillStyle='rgba(255,204,94,.24)'; ctx.fillRect(leftX+16+588*0.82, topY+388, 588*0.08, 22); const markerX=leftX+16+(588*Math.max(0,Math.min(100,heat))/100); ctx.fillStyle='#f5fbff'; ctx.beginPath(); ctx.moveTo(markerX,386); ctx.lineTo(markerX-7,379); ctx.lineTo(markerX+7,379); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#c7d9ef'; ctx.font='10px monospace'; ctx.fillText('COLD', leftX+16, topY+418); ctx.fillText('BUILD HEAT', leftX+236, topY+418); ctx.fillText('ORANGE TARGET', leftX+376, topY+418); ctx.fillText('OVERHEAT', leftX+528, topY+418);
    } else if(game.phase==='hammer'){
      uiInset(leftX, topY+42, 620, 320, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      if(art.forgeAnvil) ctx.drawImage(art.forgeAnvil, leftX+190, topY+88, 250, 230);
      if(art.forgeHammer) ctx.drawImage(art.forgeHammer, leftX+474, topY+86, 92, 92);
      const marks=[[leftX+270, topY+126],[leftX+320, topY+108],[leftX+370, topY+120],[leftX+420, topY+104],[leftX+470, topY+130]];
      marks.forEach(([cx,cy],i)=>{ const active=i===game.hammerPattern[game.hammerStep]; ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,17,0,Math.PI*2); ctx.fillStyle=active?'rgba(255,235,135,.38)':'rgba(96,128,202,.15)'; ctx.fill(); ctx.strokeStyle=active?'#ffe79a':'#7892c8'; ctx.lineWidth=active?3:2; if(active){ctx.shadowBlur=16;ctx.shadowColor='rgba(255,226,126,.9)';} ctx.stroke(); ctx.restore(); game.hitboxes.push({x:cx-24,y:cy-24,w:48,h:48,action:'hammer',index:i}); });
      ctx.fillStyle='#dce7ff'; ctx.font='11px monospace'; ctx.fillText(`Strike the glowing marks in order · ${game.hammerStep}/5`, leftX+18, topY+334);
    } else {
      uiInset(leftX, topY+42, 620, 232, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
      ['WATER','OIL','SPIRIT'].forEach((name,i)=>{ const x=leftX+28+i*196, y=topY+88; drawQuenchBasin(x,y,168,130,name,false); game.hitboxes.push({x,y,w:168,h:130,action:'quench',kind:name}); });
      ctx.fillStyle='#dce7ff'; ctx.font='11px monospace'; wrap('Every basin shares the same blue sheen. Only the recovered forge clues reveal which liquid safely tempers the core.', leftX+18, topY+292, 592, 14, 3);
    }
  } else if(game.type==='current'){
    ctx.fillStyle='#fff2d1'; ctx.font='bold 12px monospace'; ctx.fillText('FLOODED RUIN NAVIGATION', leftX, topY+20);
    const size=60, gx=leftX+18, gy=topY+68;
    uiInset(leftX, topY+42, 530, 410, 'rgba(10,20,52,.95)', 'rgba(92,123,211,.22)', 1, 12);
    for(let row=0; row<game.height; row+=1) for(let col=0; col<game.width; col+=1){ const x=gx+col*size, y=gy+row*size, key=`${col},${row}`; uiInset(x,y,52,52,'rgba(14,26,70,.92)','rgba(92,123,211,.18)',1,8); if(game.blocked.includes(key)){ ctx.fillStyle='#51667a'; ctx.fillRect(x+16,y+6,8,40); ctx.fillRect(x+28,y+6,8,40); } else { ctx.fillStyle='rgba(96,181,224,.08)'; ctx.fillRect(x+8,y+8,36,36); } const current=game.currents[key]; if(current){ drawArrowGlyph(current,x+10,y+14,32,20); } const setback=game.setbacks?.[key]; if(setback){ ctx.save(); ctx.fillStyle='rgba(137,45,56,.34)'; ctx.fillRect(x+5,y+5,42,42); ctx.strokeStyle='rgba(255,140,126,.75)'; ctx.lineWidth=2; ctx.strokeRect(x+6,y+6,40,40); ctx.restore(); drawArrowGlyph(setback.direction,x+10,y+14,32,20); } if(col===game.goal.x && row===game.goal.y){ drawSprite('sunken-crown',x+8,y+6,38,38); } if(col===game.diver.x && row===game.diver.y){ ctx.save(); ctx.shadowBlur=18; ctx.shadowColor='rgba(135,235,255,.92)'; ctx.fillStyle='#b7f6ff'; ctx.beginPath(); ctx.arc(x+26,y+26,11,0,Math.PI*2); ctx.fill(); ctx.restore(); } }
    uiInset(leftX+552, topY+42, 286, 410, 'rgba(13,19,48,.95)', 'rgba(92,123,211,.22)', 1, 12);
    ctx.fillStyle='#dce7ff'; ctx.font='11px monospace'; wrap('Reach the crown chamber. Broken pillars block the ruin, and currents can push the swimmer one extra tile.', leftX+570, topY+72, 248, 14, 5);
    drawDivider(leftX+566, topY+152, 258, 'rgba(104,130,212,.28)');
    [['up',leftX+664,topY+190],['left',leftX+606,topY+250],['right',leftX+722,topY+250],['down',leftX+664,topY+310]].forEach(([dir,x,y])=>{ drawUiButton(x,y,64,44,'',2); drawArrowGlyph(dir,x+12,y+12,40,20); game.hitboxes.push({x,y,w:64,h:44,action:'current',direction:dir}); });
    ctx.fillStyle='#fff4d8'; ctx.font='bold 11px monospace'; ctx.fillText(`DIVER POSITION · ${game.diver.x+1},${game.diver.y+1}`, leftX+572, topY+378);
    ctx.fillStyle='#b7d5f0'; ctx.font='10px monospace'; wrap('Blue currents can help. Red setback arrows throw the swimmer backwards, so plan your route carefully.', leftX+572, topY+400, 244, 12, 3);
  }
  if(game.message){ uiInset(leftX, box.y+box.h-48, box.showJournal ? 620 : 858, 34, 'rgba(41,28,58,.96)', 'rgba(221,158,223,.24)', 1, 10); ctx.fillStyle='#ffd1ff'; ctx.font='bold 11px monospace'; wrap(game.message, leftX+12, box.y+box.h-27, (box.showJournal ? 596 : 834), 12, 2); }
}
  function drawReflection() { const finale = state.world?.finalObjective, reflection = finale?.reflection; if (!reflection || finale.phase !== 'COMPLETE') return; ctx.fillStyle = 'rgba(14,28,39,.88)'; ctx.fillRect(0, 0, canvas.width, canvas.height); panel(105, 65, 750, 510); ctx.textAlign = 'left'; ctx.fillStyle = '#f7d25c'; ctx.font = 'bold 18px monospace'; ctx.fillText('THE WORLD REMEMBERS', 135, 102); ctx.font = '11px monospace'; ctx.fillStyle = '#fff7d5'; reflection.lines.forEach((line, index) => wrap(line, 135, 138 + index * 28, 690, 14)); ctx.fillStyle = '#9de3ff'; ctx.fillText(`DESTINATION · ${finale.destination.title}`, 135, 310); ctx.fillText(`COMPLICATION · ${finale.complication.title}`, 135, 334); ctx.fillStyle = '#d2f0cf'; ctx.fillText(`ROLES · ${reflection.assignedRoles.map((item) => `${item.name}: ${item.archetype}`).join(' · ')}`, 135, 372); wrap(`EVOLVED WORLD · ${reflection.worldEvolutions.map((item) => item.title).join(' · ')}`, 135, 410, 690, 16); ctx.fillStyle = '#f4c7ff'; ctx.font = 'bold 14px monospace'; ctx.fillText('SO I CREATED THIS WORLD.', 135, 520); }
  function drawDungeonHud() { const mission=state.mine?.dungeon;if(!mission?.active)return;panel(315,14,330,72);ctx.textAlign='center';ctx.font='bold 11px monospace';ctx.fillStyle='#9de3ff';ctx.fillText('BEYOND THE VEIL',480,33);ctx.fillStyle='#fff7d5';const text=mission.phase==='DEFEAT_WARDENS'?`DEFEAT THE THREE WARDENS · ${mission.defeatedCount}/3`:mission.phase==='FIND_SIGILS'?`RECOVER THE THREE SEALS · ${mission.collected.length}/3`:mission.phase==='AWAKEN_ALTAR'?'AWAKEN THE VEIL ALTAR':'RETURN TO THE BLUE PORTAL';ctx.fillText(text,480,52);ctx.fillStyle='#371b29';ctx.fillRect(385,65,190,8);ctx.fillStyle='#e96370';ctx.fillRect(385,65,190*(mission.health/mission.maxHealth),8);ctx.strokeStyle='#fff0d0';ctx.strokeRect(384,64,192,10); }
  function drawHurtEffect() { if(state.hurtTimer<=0||state.mine?.realm!=='dungeon')return;const alpha=Math.min(.34,state.hurtTimer*.7);ctx.fillStyle=`rgba(190,25,48,${alpha})`;ctx.fillRect(0,0,canvas.width,12*state.hurtStrength);ctx.fillRect(0,canvas.height-12*state.hurtStrength,canvas.width,12*state.hurtStrength);ctx.fillRect(0,0,12*state.hurtStrength,canvas.height);ctx.fillRect(canvas.width-12*state.hurtStrength,0,12*state.hurtStrength,canvas.height); }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.joined) { drawStart(); return; }
    const dungeon=state.mine?.realm==='dungeon';
    const minX=Math.floor(state.camera.x-25),maxX=Math.ceil(state.camera.x+25),minY=Math.floor(state.camera.y-17),maxY=Math.ceil(state.camera.y+17);
    if(dungeon){
      ctx.fillStyle='#120f19';ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)drawDungeonTile(x,y);
    }else{
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)drawTile(x,y);
      (state.world?.terrain||[]).forEach(drawTerrain);
    }
    const mood=state.world?.director?.mood||state.world?.directorRules?.activeRules?.find((rule)=>rule.card==='world_mood')?.moodId;
    if(!dungeon&&mood==='mist'){ctx.fillStyle='rgba(220,236,242,.18)';ctx.fillRect(0,0,canvas.width,canvas.height);}
    if(!dungeon&&mood==='storm'){ctx.fillStyle='rgba(54,67,105,.18)';ctx.fillRect(0,0,canvas.width,canvas.height);}
    if(!dungeon&&mood==='starlight'){ctx.fillStyle='rgba(82,57,132,.16)';ctx.fillRect(0,0,canvas.width,canvas.height);}
    activeEntities().filter((entity)=>dungeon?String(entity.kind).startsWith('dungeon-'):!String(entity.kind).startsWith('dungeon-')).forEach(drawEntity);
    const visiblePlayers=state.players.filter((player)=>(player.realm||'overworld')===(state.mine?.realm||'overworld'));
    visiblePlayers.forEach(character);
    drawAttack();
    visiblePlayers.forEach((player)=>label(player.name,player.x,player.y,player.color));
    drawHurtEffect();
    drawHud();
    drawDirectorHud();
    if(dungeon) drawDungeonHud();
    if(!gameReady()) drawLobby();
    drawCollectorGame();
    drawReflection();
  }
  return { render };
}
