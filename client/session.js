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
  { x: 30, y: 17, label: 'Finale Portal' },
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
      state.camera.y = state.mine.realm === 'ghost-village' ? 1 : state.mine.y;
    }
    const sourceMine = world.players.find((player) => player.id === state.network.playerId);
    if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y, color: state.mine.color });
    if (state.mine?.realm === 'lantern-rite') state.mine.lanternRite = world.lanternRite;
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
  function finishCollectorGame() {
    const game=state.collectorGame; if(!game) return;
    socket.emit('interact', { type:'collector-minigame-complete', targetId:game.targetId }, (reply) => {
      if(reply?.ok){ note('Collector challenge complete. Its reward will carry into the finale.',6); state.collectorGame=null; }
      else note(reply?.error || 'The challenge could not be completed.',5);
    });
  }
  function beginCollectorGame(reply, entity) {
    const base={ type:reply.minigame, feature:reply.feature, title:reply.title, instruction:reply.instruction, goal:reply.goal, targetId:entity.id, progress:0, message:'', clues:reply.clues||[], clueTotal:reply.clueTotal ?? 4, hitboxes:[] };
    if(reply.minigame==='crystal-rebuild') {
      const crystalClues = [
        { title:'Miner Survey', text:'Five buried fragments lie far apart where the ground leaks blue light.' },
        { title:'Crystal Sketch', text:'The shattered Crystal Heart reforms into one complete core when every shard returns to its own crack.' },
        { title:'Fracture Note', text:'Each shard has a unique silhouette. Match the shape of the shard to the matching socket.' },
        { title:'Resonance Rubbing', text:'When every fragment is seated, the mine awakens completely.' }
      ];
      Object.assign(base, {
        instruction:'All five fragments are recovered. Return to the Crystal Mine and rebuild the Crystal Heart.',
        clues: crystalClues,
        clueTotal: crystalClues.length,
        pieces:[
          {x:150,y:258,homeX:150,homeY:258,targetX:475,targetY:328,locked:false},
          {x:280,y:300,homeX:280,homeY:300,targetX:565,targetY:328,locked:false},
          {x:150,y:388,homeX:150,homeY:388,targetX:520,targetY:394,locked:false},
          {x:282,y:430,homeX:282,homeY:430,targetX:478,targetY:399,locked:false},
          {x:196,y:500,homeX:196,homeY:500,targetX:562,targetY:399,locked:false}
        ],
        dragging:null,
        selectedPiece:null,
        dragOffset:{x:0,y:0}
      });
    }
    if(reply.minigame==='sequence') Object.assign(base,{ symbols:['MOON','KEY','GEM','FLAME'], answer:[2,0,3,1], entered:[], resetAt:0 });
    if(reply.minigame==='appraisal') Object.assign(base,{ items:[{name:'Ancient Idol',value:3,risk:'Genuine',sprite:'ancient-idol'},{name:'Jeweled Goblet',value:3,risk:'Genuine',sprite:'jeweled-goblet'},{name:'Reliquary Box',value:2,risk:'Genuine',sprite:'reliquary-box'},{name:'Cursed Crown',value:5,risk:'Cursed',sprite:'sunken-crown'},{name:'Golden Compass',value:0,risk:'Replica',sprite:'ornate-key'}], chosen:[] });
    if(reply.minigame==='forge') Object.assign(base,{ phase:'ingredients', components:['STABILITY','MEMORY','ENERGY','EMBER','IRON'], recipe:[], recipeAnswer:[2,0,4], bellows:0, heat:0, hammerStep:0, hammerPattern:[4,0,2,1,3], quench:null });
    if(reply.minigame==='current') Object.assign(base,{ clueTotal:0, clues:[], diver:{x:0,y:5}, goal:{x:7,y:0}, blocked:['1,0','5,0','1,1','3,1','5,1','7,1','1,2','3,2','7,2','3,3','5,3','7,3','1,4','5,4','3,5','7,5'], currents:{'0,4':'right','2,4':'up','4,2':'right','5,2':'right'}, setbacks:{'0,3':{direction:'down',x:0,y:5},'4,4':{direction:'left',x:3,y:4},'6,4':{direction:'left',x:4,y:4},'7,4':{direction:'left',x:6,y:4}}, width:8, height:6 });
    state.collectorGame=base;
    note(`${reply.title}: ${reply.instruction}`,6);
  }
  function collectorHitboxes(game) {
    const boxes=[];
    if(game.type==='crystal-rebuild') {
      game.pieces.forEach((piece,index)=>{ if(!piece.locked) boxes.push({x:piece.x-52,y:piece.y-52,w:104,h:104,action:'crystal-piece',index}); boxes.push({x:piece.targetX-50,y:piece.targetY-50,w:100,h:100,action:'crystal-socket',index}); });
    } else if(game.type==='sequence') {
      [[125,220],[355,220],[125,355],[355,355]].forEach(([x,y],index)=>boxes.push({x,y,w:180,h:105,action:'rune',index}));
    } else if(game.type==='appraisal') {
      game.items.forEach((_,index)=>boxes.push({x:80+(index%3)*180,y:215+Math.floor(index/3)*125,w:155,h:100,action:'item',index}));
      boxes.push({x:410,y:470,w:210,h:46,action:'confirm'});
    } else if(game.type==='forge') {
      if(game.phase==='ingredients') game.components.forEach((_,index)=>boxes.push({x:82+index*105,y:235,w:94,h:84,action:'component',index}));
      else if(game.phase==='heat') boxes.push({x:468,y:238,w:122,h:40,action:'bellows'});
      else if(game.phase==='hammer') [[340,246],[390,226],[440,238],[490,222],[540,248]].forEach(([cx,cy],index)=>boxes.push({x:cx-26,y:cy-26,w:52,h:52,action:'hammer',index}));
      else ['WATER','OIL','SPIRIT'].forEach((kind,index)=>boxes.push({x:110+index*165,y:265,w:135,h:120,action:'quench',kind}));
    } else if(game.type==='current') {
      [['up',628,236],['left',580,296],['right',680,296],['down',628,356]].forEach(([direction,bx,by])=>boxes.push({x:bx,y:by,w:64,h:48,action:'current',direction}));
    }
    return boxes;
  }
  function forgeHelperCount() { const mine = state.mine; if (!mine) return 0; return state.players.filter((player) => player.id !== mine.id && (player.realm || 'overworld') === (mine.realm || 'overworld')).length; }
  function clickHit(game,x,y){ const boxes=(Array.isArray(game.hitboxes)&&game.hitboxes.length)?game.hitboxes:collectorHitboxes(game); for(let i=boxes.length-1;i>=0;i-=1){ const box=boxes[i]; if(x>=box.x&&x<=box.x+box.w&&y>=box.y&&y<=box.y+box.h) return box; } return null; }
  function handleGamePointerDown(x,y){
    const game=state.collectorGame; if(!game || game.type!=='crystal-rebuild') return false;
    const hit=clickHit(game,x,y); if(!hit) return true;
    if(hit.action==='close'){ state.collectorGame=null; note('Challenge paused. Return to the landmark to continue.',4); return true; }
    if(hit.action==='crystal-piece'){
      const piece=game.pieces[hit.index]; game.dragging=hit.index; game.selectedPiece=hit.index; game.dragOffset={x:x-piece.x,y:y-piece.y}; game.dragMoved=false; game.message='Shard selected. Drag it back into the matching crack.'; return true;
    }
    if(hit.action==='crystal-socket'){
      if(game.selectedPiece===null){ game.message='Select a shard first.'; return true; }
      if(hit.index!==game.selectedPiece){ game.message='That shard does not fit this socket.'; return true; }
      const piece=game.pieces[game.selectedPiece];
      piece.x=piece.targetX; piece.y=piece.targetY; piece.locked=true; game.progress=game.pieces.filter((item)=>item.locked).length; game.selectedPiece=null; game.message='The crystal shard settles back into the Crystal Heart.';
      if(game.pieces.every((item)=>item.locked)) finishCollectorGame();
      return true;
    }
    return true;
  }
  function handleGamePointerMove(x,y){
    const game=state.collectorGame; if(!game || game.type!=='crystal-rebuild' || game.dragging===null) return false;
    const piece=game.pieces[game.dragging]; if(!piece || piece.locked) return true;
    piece.x=Math.max(90,Math.min(630,x-game.dragOffset.x)); piece.y=Math.max(205,Math.min(520,y-game.dragOffset.y)); game.dragMoved=true; return true;
  }
  function handleGamePointerUp(x,y){
    const game=state.collectorGame; if(!game || game.type!=='crystal-rebuild' || game.dragging===null) return false;
    const index=game.dragging, piece=game.pieces[index]; game.dragging=null; if(!game.dragMoved){ return true; }
    const distance=Math.hypot(piece.x-piece.targetX,piece.y-piece.targetY);
    if(distance<=48){piece.x=piece.targetX;piece.y=piece.targetY;piece.locked=true;game.selectedPiece=null;game.progress=game.pieces.filter((item)=>item.locked).length;game.message='The crystal shard settles back into the Crystal Heart.';}
    else {piece.x=piece.homeX;piece.y=piece.homeY;game.message='That crack is not the right fit. Try a different socket.';}
    if(game.pieces.every((item)=>item.locked)) finishCollectorGame(); return true;
  }
  function handleGameClick(x,y){
    const game=state.collectorGame; if(!game) return false;
    const hit=clickHit(game,x,y); if(!hit) return true;
    if(game.type==='crystal-rebuild'){
      if(hit.action==='crystal-piece'){game.selectedPiece=hit.index;game.message='Shard selected. Drag it or click the matching socket.';return true;}
      if(hit.action==='crystal-socket'){
        if(game.selectedPiece===null){game.message='Select a shard first.';return true;}
        const piece=game.pieces[game.selectedPiece];
        if(hit.index!==game.selectedPiece){game.message='That shard does not fit this socket.';return true;}
        piece.x=piece.targetX;piece.y=piece.targetY;piece.locked=true;game.progress=game.pieces.filter((item)=>item.locked).length;game.selectedPiece=null;game.message='The crystal shard settles back into the Crystal Heart.';
        if(game.pieces.every((item)=>item.locked)) finishCollectorGame();return true;
      }
      return true;
    }
    if(hit.action==='close'){ state.collectorGame=null; note('Challenge paused. Return to the landmark to continue.',4); return true; }
    if(game.type==='sequence'&&hit.action==='rune'){
      if(Date.now()<game.resetAt)return true;
      const expected=game.answer[game.entered.length];
      if(hit.index===expected){game.entered.push(hit.index);game.progress=game.entered.length;const name=game.symbols[hit.index];game.message=game.entered.length===game.answer.length?'The final bolt retracts. The vault opens.':`${name} settles into the mechanism.`;}else{game.message=`${game.symbols[hit.index]} is not the next rune. The stone tiles spring back.`;game.resetAt=Date.now()+700;setTimeout(()=>{if(state.collectorGame===game){game.entered=[];game.progress=0;}},700);}
      if(game.entered.length===game.answer.length) finishCollectorGame();return true;
    }
    if(game.type==='appraisal'&&hit.action==='item'){
      const i=hit.index, pos=game.chosen.indexOf(i); if(pos>=0)game.chosen.splice(pos,1);else if(game.chosen.length<3)game.chosen.push(i);
      game.progress=game.chosen.reduce((sum,index)=>sum+game.items[index].value,0);game.message=game.clues.length<game.clueTotal?'You can select relics now, but full values remain hidden until every clue is found.':`Selected value: ${game.progress}.`;
      return true;
    }
    if(game.type==='appraisal'&&hit.action==='confirm'){
      const allCluesFound = game.clues.length >= game.clueTotal;
      const allGenuine = game.chosen.every((index)=>game.items[index]?.risk === 'Genuine');
      if(!allCluesFound) game.message='Find every appraisal clue before locking in your choice.';
      else if(game.chosen.length!==3) game.message='Choose exactly three relics.';
      else if(!allGenuine || game.progress < 8) game.message='That set does not match the appraisal notes. The three genuine relics together are worth eight.';
      else finishCollectorGame();
      return true;
    }
    if(game.type==='forge'){
      if(game.phase==='ingredients'&&hit.action==='component'){
        if(!game.recipe.includes(hit.index)&&game.recipe.length<3) game.recipe.push(hit.index);
        if(game.recipe.length===3){
          const correct=game.recipe.length===game.recipeAnswer.length && game.recipe.every((value,idx)=>value===game.recipeAnswer[idx]);
          if(correct){ game.phase='heat'; game.message='The recipe is balanced. Pump the bellows until the metal glows orange.'; }
          else { game.recipe=[]; game.message='That recipe sputters out. Re-read the forge clues and try another combination.'; }
        }
        return true;
      }
      if(game.phase==='heat'&&hit.action==='bellows'){game.bellows+=1;game.heat=Math.min(100,game.heat+8);if(game.heat>=82&&game.heat<=89){game.phase='hammer';game.message='The workpiece glows orange. Follow the hammer pattern.';}else if(game.heat>91){game.heat=34;game.message='Overheated! The forge spits sparks and the metal cools back down.';}else{game.message='You pump the bellows. +8 heat. Keep clicking before the forge cools.';}return true;}
      if(game.phase==='hammer'&&hit.action==='hammer'){const expected=game.hammerPattern[game.hammerStep];if(hit.index===expected){game.hammerStep+=1;game.message='A clean strike rings across the anvil.';}else{game.hammerStep=0;game.message='The pattern slipped. Start the hammer diagram again.';}if(game.hammerStep>=game.hammerPattern.length){game.phase='quench';game.message='The core holds shape. Choose the correct quenching basin.';}return true;}
      if(game.phase==='quench'&&hit.action==='quench'){if(hit.kind==='OIL'){finishCollectorGame();}else{game.phase='heat';game.heat=34;game.hammerStep=0;game.message='That quench cracks the core. Reheat it and choose a different basin.';}return true;}
    }
    if(game.type==='current'&&hit.action==='current'){
      const dirs={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
      const [dx,dy]=dirs[hit.direction]||[0,0];
      let nx=game.diver.x+dx, ny=game.diver.y+dy;
      const blocked=(x,y)=>x<0||y<0||x>=game.width||y>=game.height||game.blocked.includes(`${x},${y}`);
      if(blocked(nx,ny)){ game.message='Broken masonry blocks that route.'; return true; }
      game.diver={x:nx,y:ny};
      const push=game.currents[`${nx},${ny}`];
      if(push){ const [pdx,pdy]=dirs[push]; const tx=nx+pdx, ty=ny+pdy; if(!blocked(tx,ty)){ game.diver={x:tx,y:ty}; game.message='The current catches you and carries you onward.'; } else { game.message='A current nudges you, but the rubble holds.'; } } else { game.message='You move through the flooded corridor.'; }
      const setback=game.setbacks?.[`${game.diver.x},${game.diver.y}`];
      if(setback){ game.diver={x:setback.x,y:setback.y}; game.message='A treacherous current throws you backwards! Find another route.'; }
      game.progress=Math.max(0, 10-(Math.abs(game.goal.x-game.diver.x)+Math.abs(game.goal.y-game.diver.y)));
      if(game.diver.x===game.goal.x && game.diver.y===game.goal.y){ finishCollectorGame(); }
      return true;
    }
    return true;
  }
  function handleGameKey(key) {
    const game=state.collectorGame; if(!game) return false;
    if(String(key).toLowerCase()==='escape'){state.collectorGame=null;note('Challenge paused. Return to the landmark to continue.',4);return true;}
    return true;
  }
  function lanternSupport(kind) {
    if (!gameReady() || state.mine?.realm !== 'lantern-rite' || state.mine?.archetype !== 'Guardian') return false;
    const target = state.players.filter((player) => player.id !== state.mine.id && player.realm === 'lantern-rite').sort((left, right) => Math.hypot(state.mine.x - left.x, state.mine.y - left.y) - Math.hypot(state.mine.x - right.x, state.mine.y - right.y))[0];
    if (!target) { note('Move beside an ally to share a Guardian blessing.', 3); return true; }
    const type = kind === 'heal' ? 'lantern-guardian-heal' : 'lantern-guardian-barrier';
    socket.emit('interact', { type, targetId: target.id }, (reply) => note(reply?.ok ? (kind === 'heal' ? `Healing light reaches ${target.name}.` : `${target.name} is shielded.`) : (reply?.error || 'That blessing cannot reach an ally yet.'), 3));
    return true;
  }
  const finalePreviewActive = () => state.network.roomCode === 'PREVIEW' && state.world?.finalObjective?.phase !== 'COMPLETE' && ['lantern-rite','echo-accord'].includes(state.mine?.realm);
  function syncLanternPreviewEntities() {
    const rite=state.mine.lanternRite;
    if(rite.phase==='ENTRY') state.world.entities=[{id:'lantern-entry-gate',type:'lantern-entry-gate',zone:'lantern-rite',x:16,z:18.5,readyCount:Object.keys(rite.entry.ready).length,action:'lantern-enter'}];
    else if(rite.phase==='DEFEND') state.world.entities=[{id:'lantern-core',type:'lantern-core',zone:'lantern-rite',x:16,z:10,health:rite.core.health,maxHealth:rite.core.maxHealth},...rite.enemies.filter((enemy)=>!enemy.defeated).map((enemy)=>({...enemy,zone:'lantern-rite',type:'lantern-enemy',action:'lantern-attack'}))];
    else state.world.entities=[{id:'lantern-core',type:'lantern-core',zone:'lantern-rite',x:16,z:10,health:rite.core.health,maxHealth:rite.core.maxHealth},...['Explorer','Collector','Guardian','Loner'].map((role,index)=>({id:`lantern-switch-${role.toLowerCase()}`,type:'lantern-switch',zone:'lantern-rite',x:[13,19,13,19][index],z:[7,7,13,13][index],role,action:'lantern-switch'}))];
  }
  function interactFinalePreview(){
    const mine=state.mine;
    if(mine.realm==='echo-accord'){note('Steer continuously with WASD or the arrow keys. Gather light and avoid every trail.',4);return true;}
    const rite=mine.lanternRite,entity=nearest(mine,activeEntities(),3);
    if(!entity){note('Move closer to the glowing objective, then press E.',3);return true;}
    if(rite.phase==='ENTRY'&&entity.type==='lantern-entry-gate'){
      rite.entry.ready=Object.fromEntries(state.players.map((player)=>[player.id,Date.now()]));rite.phase='DEFEND';rite.task='Test wave: press E beside each enemy to attack.';mine.x=14;mine.y=15.6;
      rite.enemies=[{id:'preview-runner',enemyType:'swift',label:'Veil Runner',x:13,z:11,hp:2,maxHp:2,sprite:2},{id:'preview-raider',enemyType:'raider',label:'Lantern Raider',x:18,z:11,hp:3,maxHp:3,sprite:0},{id:'preview-brute',enemyType:'brute',label:'Stone Warden',x:16,z:7,hp:4,maxHp:4,sprite:22}];syncLanternPreviewEntities();note('All four previews entered. Defeat the test wave with E.',4);return true;
    }
    if(rite.phase==='DEFEND'&&entity.type==='lantern-enemy'){
      const enemy=rite.enemies.find((item)=>item.id===entity.id);enemy.hp-=1;state.attackTimer=.28;state.attackTargetId=enemy.id;state.attackTargetX=enemy.x;state.attackTargetY=enemy.z;if(enemy.hp<=0)enemy.defeated=true;
      if(rite.enemies.every((item)=>item.defeated)){rite.phase='SWITCHES';rite.task='Test wave cleared. Find YOUR GUARDIAN SWITCH and press E.';note('Wave cleared. Activate the Guardian switch.',4);}syncLanternPreviewEntities();return true;
    }
    if(rite.phase==='SWITCHES'&&entity.type==='lantern-switch'){
      if(entity.role!==mine.archetype){note(`That is the ${entity.role} switch. Find the Guardian switch.`,3);return true;}rite.switches.participants=Object.fromEntries(state.players.map((player)=>[player.id,Date.now()]));rite.task='Finale preview complete!';state.world.finalObjective.phase='COMPLETE';note('Lantern Rite preview complete!',8);syncLanternPreviewEntities();return true;
    }
    return true;
  }
  function interact() {
    if (!gameReady() || !state.mine) return;
    if (finalePreviewActive()) { interactFinalePreview(); return; }
    if (state.network.serverOutdated) { note('The game server is out of date. Restart npm run api, then refresh this tab.', 10); return; }
    const observing = state.world?.phase === 'observing';
    if (!observing && !['evolving', 'finale'].includes(state.world?.phase)) {
      note('Roles are still awakening. Interactions unlock when the observation ends.', 4);
      return;
    }
    const trial = guardianTrial(), temple = templeFinale();
    // Portal coordinates belong to their separate dimension. Once its trial is
    // complete, use the overworld player position again so the next portal can
    // be found and interacted with normally.
    const position = trial?.activeTrial && trial.position ? { x: trial.position.x, y: trial.position.z } : temple?.panes?.find((pane) => pane.id === state.network.playerId)?.position ? { x: temple.panes.find((pane) => pane.id === state.network.playerId).position.x, y: temple.panes.find((pane) => pane.id === state.network.playerId).position.z } : state.mine;
    const nearby = observing ? activeEntities().filter((entity) => entity.type === 'observation-item' || entity.kind === 'observation-item') : activeEntities();
    const entity = nearest(position, nearby) || nearest(position, nearby.filter((item) => ['hidden-cave-mouth', 'hidden-temple-entrance', 'hidden-ruins-entrance'].includes(item.id)), 7);
    const action = finalAction(entity);
    if (!action) { note('Move near an object marked for your role.', 3); return; }
    socket.emit('interact', { type: action, targetId: entity.targetId || entity.id }, (reply) => {
      if (reply?.ok && action === 'dungeon-attack') state.dungeonAttack = { timer: .28, targetX: entity.x, targetY: entity.y };
      if (reply?.ok && action === 'collector-minigame-start') { beginCollectorGame(reply, entity); return; }
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
    if(state.attackTimer>0)state.attackTimer=Math.max(0,state.attackTimer-dt);
    if(finalePreviewActive()){
      const mine=state.mine,{x,z}=input,speed=5;
      if(mine.realm==='lantern-rite'){
        const nx=mine.x+x*speed*dt,ny=mine.y+z*speed*dt;if(nx>=1&&nx<=31&&ny>=1&&ny<=27.5){mine.x=nx;mine.y=ny;}syncLanternPreviewEntities();
      }else{
        const game=state.world.finalObjective.echoAccord,mag=Math.hypot(x,z);if(mag>.15){const next={x:x/mag,z:z/mag},current=mine.echoDirection||next;if(next.x*current.x+next.z*current.z>-.7)mine.echoDirection=next;}
        const direction=mine.echoDirection||{x:1,z:0};mine.x+=direction.x*5.2*dt;mine.y+=direction.z*5.2*dt;mine.echoStepAt=(mine.echoStepAt||0)+dt;if(mine.echoStepAt>=.085){mine.echoStepAt=0;mine.echoTrail.unshift({x:mine.x,z:mine.y});mine.echoTrail.length=Math.min(mine.echoTrail.length,7+(mine.echoCollected||0));}
        for(const orb of game.echoes)if(orb.active&&Math.hypot(mine.x-orb.x,mine.y-orb.z)<.85){orb.active=false;mine.echoCollected+=1;break;}if(mine.x<game.arena.minX||mine.x>game.arena.maxX||mine.y<game.arena.minZ||mine.y>game.arena.maxZ){mine.x=24;mine.y=16;mine.echoTrail=[];note('Trail reset after touching the arena wall.',3);}
      }
      state.camera.x+=(mine.x-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(mine.y-state.camera.y)*Math.min(1,dt*5);return;
    }
    for (const player of state.players) { const ease = Math.min(1, dt * 14); player.x += (player.targetX - player.x) * ease; player.y += (player.targetY - player.y) * ease; }
    const mine = state.mine;
    if (gameReady() && mine) {
      if (state.collectorGame) {
        socket.emit('move', { x: 0, z: 0 });
        if (state.collectorGame.type === 'forge' && state.collectorGame.phase === 'heat') state.collectorGame.heat = Math.max(0, state.collectorGame.heat - dt * 10);
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
      const cameraTargetY = mine.realm === 'ghost-village' ? 1 : interior ? 17 : mine.y;
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

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, abilityProgress, relics, guardianTrial, templeFinale, collectorTrial, activeEntities, joinRoom, interact, attack, aimAt, handleGameKey, handleGameClick, handleGamePointerDown, handleGamePointerMove, handleGamePointerUp, lanternSupport, update };
}
