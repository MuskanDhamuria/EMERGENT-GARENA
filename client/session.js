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
    joined: false, preview: null, notice: 'Light a lantern to join a four-player expedition.', noticeTimer: 0,
    camera: { x: 25, y: 17 }, frame: 0,
    network: { connected: false, playerId: null, roomCode: null, lastTelemetry: 0, error: '' },
    world: null, players: [], mine: null, privateRule: null, publicEvent: null, collectorGame: null,
    attackTimer: 0, attackTargetId: null, attackTargetX: 0, attackTargetY: 0, hurtTimer: 0, hurtStrength: 0, lastForgeAssistHeat: 0, aimScreen: { x: 480, y: 320 },
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
  function gameReady() { return Boolean(state.preview) || (state.network.connected && roomPlayerCount() === MAX_PLAYERS); }
  function features() {
    return new Set([...(state.world?.world?.unlocked || state.world?.unlockedFeatures || []), ...(state.world?.world?.privateUnlocks || state.world?.yourPrivateUnlocks || []), ...(state.mine?.evolutions || [])]);
  }
  function abilities() {
    return [...new Set([...(state.mine?.capabilities || state.mine?.abilities || state.mine?.abilityIds || []), ...(state.world?.world?.yourAbilities || state.world?.yourAbilities || []), ...features()])];
  }
  function relics() { return Array.isArray(state.world?.relics) ? state.world.relics : []; }
  function serverEntities() {
    const supplied = state.world?.world?.entities || state.world?.entities || [];
    if (supplied.length) return supplied.filter(Boolean).map((entity, index) => ({ ...entity, id: entity.id || `entity-${index}`, ...mapPoint(entity), label: entity.label || entity.name || entity.id || 'World feature', kind: entity.kind || entity.type || 'feature' }));
    return [...features()].map((feature) => FEATURE_FALLBACK_ENTITIES[feature]).filter(Boolean).map((entity) => ({ ...entity, ...mapPoint(entity), kind: entity.type }));
  }
  function activeEntities() {
    const relicEntities = relics().filter((relic) => !relic.collectedBy).map((relic) => ({ ...relic, ...mapPoint(relic), kind: 'relic', label: relic.name || relic.id.replaceAll('-', ' '), action: 'relic', targetId: relic.id }));
    return [...relicEntities, ...serverEntities().filter((entity) => entity.kind !== 'relic' && entity.type !== 'relic')];
  }
  function nearest(point, list, radius = 3.25) {
    return list.filter(Boolean).map((item) => ({ item, distance: Math.hypot(point.x - item.x, point.y - item.y) })).filter(({ distance }) => distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.item || null;
  }
  function finalAction(entity) {
    if (!entity) return null;
    const finale=state.world?.finalObjective;
    if(finale?.status==='active'){
      if(finale.phase==='TRAVEL'&&entity.id===finale.destination?.targetId)return 'finale-arrive';
      const step=finale.roleSteps?.find((item)=>item.phase===finale.phase);
      if(step&&entity.id===step.targetId&&state.mine?.archetype===step.role)return 'finale-role-step';
      if(finale.phase==='GROUP_RITUAL'&&entity.id===`finale-circle-${state.mine?.archetype?.toLowerCase()}`)return 'finale-ritual';
    }
    if (entity.action) return entity.action;
    if (ENTITY_ACTIONS[entity.id]) return ENTITY_ACTIONS[entity.id];
    const kind = String(entity.kind || entity.type || '').toLowerCase();
    if (kind === 'observation-item') return 'collect-curio';
    if (kind === 'collector-clue') return 'collect-clue';
    if (kind.includes('relic')) return 'relic';
    return entity.interaction || null;
  }
  function applyWorldState(world) {
    if (!world || !Array.isArray(world.players)) return;
    const previousHealth = state.mine?.dungeon?.health, previousRespawns = state.mine?.dungeon?.respawns || 0;
    state.world = world; state.network.roomCode = world.code || state.network.roomCode;
    const previous = new Map(state.players.map((player) => [player.id, player]));
    state.players = world.players.map((player, index) => {
      const target = mapPoint(player), old = previous.get(player.id);
      const changedRealm = old && old.realm !== player.realm;
      return { ...player, x: changedRealm ? target.x : (old?.x ?? target.x), y: changedRealm ? target.y : (old?.y ?? target.y), targetX: target.x, targetY: target.y, color: cssColor(player.color, ['#2563eb', '#db2777', '#f59e0b', '#16a34a'][index % 4]) };
    });
    state.mine = state.players.find((player) => player.id === state.network.playerId) || null;
    const sourceMine = world.players.find((player) => player.id === state.network.playerId);
    if (sourceMine && Number.isFinite(sourceMine.forgeAssistHeat)) {
      const delta = Math.max(0, sourceMine.forgeAssistHeat - state.lastForgeAssistHeat);
      if (delta > 0 && state.collectorGame?.type === 'forge' && state.collectorGame.phase === 'heat') {
        state.collectorGame.heat = Math.min(100, state.collectorGame.heat + delta);
        state.collectorGame.message = `An ally pumps the bellows. +${delta} heat.`;
      }
      state.lastForgeAssistHeat = sourceMine.forgeAssistHeat;
    }
    if (state.mine && sourceMine) Object.assign(state.mine, sourceMine, { x: state.mine.x, y: state.mine.y });
    const currentHealth = state.mine?.dungeon?.health, currentRespawns = state.mine?.dungeon?.respawns || 0;
    if (Number.isFinite(previousHealth) && Number.isFinite(currentHealth) && (currentHealth < previousHealth || currentRespawns > previousRespawns)) { state.hurtTimer = currentRespawns > previousRespawns ? 0.65 : 0.38; state.hurtStrength = currentRespawns > previousRespawns ? 2 : 1; }
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
  function enableShadowForestPreview() {
    const player = { id: 'preview-loner', name: 'Loner', color: '#67d9ec', sprite: 1, facing: 'right', moving: false, x: 1.5, y: 11, targetX: 1.5, targetY: 11, realm: 'shadow-forest', archetype: 'Loner', capabilities: [], shadowForest: { active: true, vx: 0, vy: 0, onGround: true, jumpHeld: false, falls: 0, trapHits: 0, sawTime: 0 } };
    state.preview = 'shadow-forest'; state.joined = true; state.network.connected = true; state.network.playerId = player.id; state.network.roomCode = 'PREVIEW'; state.players = [player]; state.mine = player; state.world = { code: 'PREVIEW', phase: 'evolving', players: [player], world: { unlocked: ['shadow-forest'] }, entities: [], relics: [] }; state.camera.x = player.x; state.camera.y = player.y; note('Shadow Forest preview: reach the trophy.', 5);
  }
  function enableMoonShrinePreview() {
    const player={id:'preview-loner',name:'Loner',color:'#b9d9ff',sprite:1,facing:'right',moving:false,x:2,y:10,targetX:2,targetY:10,realm:'moon-shrine',archetype:'Loner',capabilities:[],moonShrine:{active:true,pathStep:0,lineFailed:false}};
    state.preview='moon-shrine';state.joined=true;state.network.connected=true;state.network.playerId=player.id;state.network.roomCode='PREVIEW';state.players=[player];state.mine=player;state.world={code:'PREVIEW',phase:'evolving',players:[player],world:{unlocked:['moon-shrine']},entities:[],relics:[]};state.camera.x=12;state.camera.y=0;note('Recover three moon echoes, then awaken the shrine.',5);
  }
  function enableGhostVillagePreview(){const ghosts=[{x:5,z:5,vx:1.1,vz:.7},{x:8,z:8,vx:-.8,vz:1},{x:12,z:4,vx:1,vz:-.6},{x:16,z:7,vx:-1.2,vz:.5},{x:20,z:5,vx:.7,vz:1.1},{x:24,z:9,vx:-.9,vz:-.8}].map((ghost,index)=>({id:`ghost-${index+1}`,...ghost,active:true})),player={id:'preview-loner',name:'Loner',color:'#b9d9ff',sprite:1,facing:'right',moving:false,x:1.5,y:11,targetX:1.5,targetY:11,realm:'ghost-village',archetype:'Loner',capabilities:[],ghostVillage:{active:true,caught:0,ghosts,projectiles:[],shotSequence:0,cooldown:0}};state.preview='ghost-village';state.joined=true;state.network.connected=true;state.network.playerId=player.id;state.network.roomCode='PREVIEW';state.players=[player];state.mine=player;state.world={code:'PREVIEW',phase:'evolving',players:[player],world:{unlocked:['ghost-village']},entities:[],relics:[]};state.camera.x=13.5;state.camera.y=0;note('Run with A/D. Aim the arc and click to throw.',5);}
  const previewPlatforms=[{x:0,y:12,w:5},{x:6,y:11,w:4},{x:11,y:12,w:3},{x:15,y:10,w:3},{x:19,y:12,w:6},{x:3,y:8,w:4},{x:8,y:7,w:3},{x:12,y:5,w:4},{x:17,y:7,w:3},{x:21,y:5,w:3}];
  const previewTraps=[{x:7.35,y:11,w:1.1},{x:19.65,y:12,w:1.1}],previewFire=[{x:16.1,y:10,w:1},{x:21.1,y:12,w:.9}],previewTrampoline={x:3.15,y:12,w:1},previewFan={x:12.6,y:12,w:1.1,top:5.2};
  function updateShadowPreview(dt,input) {
    const player=state.mine,mission=player.shadowForest;mission.sawTime+=dt;mission.vx=input.x*5.2;const jump=input.z<-.25;if(jump&&!mission.jumpHeld&&mission.onGround){mission.vy=-15.5;mission.onGround=false;}mission.jumpHeld=jump;mission.vy=Math.min(15,mission.vy+28*dt);const oldY=player.y;let nextX=Math.max(.35,Math.min(24.4,player.x+mission.vx*dt)),nextY=player.y+mission.vy*dt,oldBottom=oldY+.85,nextBottom=nextY+.85;const platform=mission.vy>=0?previewPlatforms.filter((p)=>nextX+.28>p.x&&nextX-.28<p.x+p.w&&oldBottom<=p.y+.08&&nextBottom>=p.y).sort((a,b)=>a.y-b.y)[0]:null;if(platform){nextY=platform.y-.85;mission.vy=0;mission.onGround=true;}else mission.onGround=false;player.x=player.targetX=nextX;player.y=player.targetY=nextY;player.moving=Math.abs(mission.vx)>.1;const bottom=player.y+.85,inZone=(item)=>player.x+.25>item.x&&player.x-.25<item.x+item.w&&bottom>item.y-.55&&bottom<item.y+.2;if(inZone(previewTrampoline)){mission.vy=-13;mission.onGround=false;}if(player.x+.25>previewFan.x&&player.x-.25<previewFan.x+previewFan.w&&player.y>previewFan.top&&player.y<previewFan.y)mission.vy=Math.max(-8,mission.vy-35*dt);const sawX=8.15+(Math.sin(mission.sawTime*2.4)+1)*1.05,hazard=previewTraps.find(inZone)||previewFire.find(inZone)||Math.hypot(player.x-sawX,player.y-5.8)<.72;if(hazard){player.x=player.targetX=1.5;player.y=player.targetY=11;mission.vx=mission.vy=0;mission.trapHits+=1;note('The forest trap returns you to the first branch.',2);return;}if(player.y>15){player.x=player.targetX=1.5;player.y=player.targetY=11;mission.vx=mission.vy=0;mission.falls+=1;note('The shadows return you to the first branch.',2);}}
  const moonPath=[{x:2,y:10},{x:7,y:10},{x:7,y:7},{x:13,y:7},{x:13,y:10},{x:19,y:10},{x:19,y:6},{x:24,y:6},{x:28,y:5}];
  function moonSegmentDistance(point,a,b){const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;return {distance:Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy)),t};}
  function interactMoonPreview(){const player=state.mine,mission=player.moonShrine;if(mission.lineFailed&&Math.hypot(player.x-2,player.y-10)<=1.2){mission.lineFailed=false;mission.pathStep=0;note('The silver line begins again.',3);return;}if(Math.hypot(player.x-28,player.y-5)<=1.8){if(mission.lineFailed){note('Return to the beginning and press E.',3);return;}if(mission.pathStep<moonPath.length-1){note('The full silver route has not been followed.',3);return;}player.x=player.targetX=2;player.y=player.targetY=10;mission.pathStep=0;mission.lineFailed=false;note('Ritual complete. The preview has restarted.',4);return;}note(mission.lineFailed?'Return to the beginning and press E to retry.':'Follow the silver line to the shrine.',3);}
  function interact() {
    if (!gameReady() || !state.mine) return;
    if (state.mine.realm === 'shadow-forest') { if (state.mine.x < 22.4 || state.mine.y >= 6.3) { note('Stand beside the trophy before pressing E.', 3); return; } if (state.preview === 'shadow-forest') { state.mine.x=state.mine.targetX=1.5;state.mine.y=state.mine.targetY=11;state.mine.shadowForest.vx=state.mine.shadowForest.vy=0;note('Crossing complete. The preview has restarted.',4);return; } socket.emit('interact', { type: 'exit-shadow-forest' }, (reply) => note(reply?.ok ? 'You claim the forgotten trophy.' : (reply?.error || 'The trophy remains silent.'), reply?.ok ? 3 : 5)); return; }
    if (state.mine.realm === 'moon-shrine') { if(state.preview==='moon-shrine'){interactMoonPreview();return;} socket.emit('interact', { type: 'moon-shrine-interact' }, (reply) => note(reply?.ok ? (reply.kind==='complete'?'The Moon Shrine recognizes you.':reply.kind==='puzzle'?'Three numbered runes awaken.':reply.kind==='rune'?'A rune ignites.':'A moon echo answers.') : (reply?.error || 'The moonlit stones remain silent.'), reply?.ok ? 3 : 5)); return; }
    if (!['observing','evolving','finale'].includes(state.world?.phase)) { note('Wait for the expedition to begin.', 4); return; }
    const entity = nearest(state.mine, activeEntities()), action = finalAction(entity);
    if (!action) { note('Move near an object marked for your role.', 3); return; }
    socket.emit('interact', { type: action, targetId: entity.targetId || entity.id }, (reply) => {
      if (reply?.ok && action === 'dungeon-attack') { state.attackTimer = 0.28; state.attackTargetId = entity.id; state.attackTargetX = entity.x; state.attackTargetY = entity.y; }
      if(reply?.ok && action==='collector-minigame-start'){ beginCollectorGame(reply,entity); return; }
      if(reply?.ok){
        const label=entity.label || action.replaceAll('-', ' ');
        const verb = action==='collect-clue' ? 'You collected' : action==='collect-curio' ? 'You collected' : action==='dig-crystal' ? 'You excavated' : action==='forge-bellows-assist' ? 'You helped pump' : 'You used';
        note(`${verb} ${label}.`,3);
      } else note(reply?.error || 'That interaction did not work.', 5);
    });
  }
  function aimAt(screenX,screenY,width,height){state.aimScreen={x:screenX,y:screenY};const player=state.mine;if(player?.realm!=='ghost-village'||!player.ghostVillage?.active)return false;const aimX=(screenX+(state.camera.x*20-width/2))/20,aimZ=(screenY+(state.camera.y*20-height/2))/20;if(state.preview==='ghost-village'){const mission=player.ghostVillage;if(mission.cooldown>0)return true;const dx=aimX-player.x,dz=aimZ-(player.y-.4),length=Math.hypot(dx,dz);if(length<.2)return true;mission.projectiles.push({id:`shot-${++mission.shotSequence}`,x:player.x,z:player.y-.4,vx:dx/length*10,vz:dz/length*10,life:2.8});mission.cooldown=.35;return true;}socket.emit('interact',{type:'ghost-village-aim',aimX,aimZ},(reply)=>{if(!reply?.ok)note(reply?.error||'The spirit shard did not launch.',2);});return true;}
  function update(dt, input) {
    state.frame += dt * 10; if (state.noticeTimer > 0) state.noticeTimer -= dt; if (state.hurtTimer > 0) state.hurtTimer = Math.max(0, state.hurtTimer - dt); if (state.attackTimer > 0) { state.attackTimer = Math.max(0, state.attackTimer - dt); if (!state.attackTimer) state.attackTargetId = null; }
    if (state.preview === 'shadow-forest') { updateShadowPreview(dt,input);const mine=state.mine;state.camera.x+=(mine.x-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(mine.y-state.camera.y)*Math.min(1,dt*5);return; }
    if (state.preview === 'moon-shrine') { const mine=state.mine,mission=mine.moonShrine;mine.x=mine.targetX=Math.max(.6,Math.min(29.5,mine.x+input.x*5.2*dt));mine.y=mine.targetY=Math.max(3.5,Math.min(11.5,mine.y+input.z*5.2*dt));mine.moving=Math.hypot(input.x,input.z)>0;if(mission.pathStep<moonPath.length-1){const result=moonSegmentDistance(mine,moonPath[mission.pathStep],moonPath[mission.pathStep+1]);if(result.distance>.85){mine.x=mine.targetX=2;mine.y=mine.targetY=10;mission.pathStep=0;mission.lineFailed=false;note('Misstep! The moonlight returns you to the start.',3);}else if(result.t>.94)mission.pathStep+=1;}state.camera.x+=(12-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(0-state.camera.y)*Math.min(1,dt*5);return; }
    if(state.preview==='ghost-village'){const mine=state.mine,mission=mine.ghostVillage;mine.x=mine.targetX=Math.max(1,Math.min(25,mine.x+input.x*4.5*dt));mine.y=mine.targetY=11;mine.moving=Math.abs(input.x)>0;mission.cooldown=Math.max(0,mission.cooldown-dt);for(const ghost of mission.ghosts)if(ghost.active){ghost.x+=ghost.vx*dt;ghost.z+=ghost.vz*dt;if(ghost.x<3||ghost.x>25){ghost.vx*=-1;ghost.x=Math.max(3,Math.min(25,ghost.x));}if(ghost.z<3||ghost.z>9.5){ghost.vz*=-1;ghost.z=Math.max(3,Math.min(9.5,ghost.z));}}for(const shot of mission.projectiles){shot.x+=shot.vx*dt;shot.z+=shot.vz*dt;shot.vz+=7*dt;shot.life-=dt;const ghost=mission.ghosts.find((item)=>item.active&&Math.hypot(item.x-shot.x,item.z-shot.z)<.8);if(ghost){ghost.active=false;shot.life=0;mission.caught+=1;note(`Ghost caught · ${mission.caught}/6`,2);}}mission.projectiles=mission.projectiles.filter((shot)=>shot.life>0&&shot.x>0&&shot.x<28&&shot.z<13);if(mission.caught===6){mission.ghosts.forEach((ghost)=>ghost.active=true);mission.projectiles=[];mission.caught=0;note('All six caught! The preview has restarted.',4);}state.camera.x+=(13.5-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(0-state.camera.y)*Math.min(1,dt*5);return;}
    for (const player of state.players) { const ease = Math.min(1, dt * 14); player.x += (player.targetX - player.x) * ease; player.y += (player.targetY - player.y) * ease; }
    const collectorGame = state.collectorGame;
    if (collectorGame?.type === 'forge' && collectorGame.phase === 'heat' && collectorGame.heat > 0) collectorGame.heat = Math.max(0, collectorGame.heat - dt * 10);
    const mine = state.mine;
    if (gameReady() && mine) {
      const { x, z } = state.collectorGame ? {x:0,z:0} : input; socket.emit('move', { x, z });
      if (performance.now() - state.network.lastTelemetry > 500) { const landmark = nearest(mine, LANDMARKS, 4); socket.emit('player-telemetry', { locationId: landmark?.label?.toLowerCase().replaceAll(' ', '-') }); state.network.lastTelemetry = performance.now(); }
    }
    if (mine) { const cameraTarget=mine.realm==='moon-shrine'?{x:12,y:0}:mine.realm==='ghost-village'?{x:13.5,y:0}:mine; state.camera.x += (cameraTarget.x - state.camera.x) * Math.min(1, dt * 5); state.camera.y += (cameraTarget.y - state.camera.y) * Math.min(1, dt * 5); }
  }

  socket.on('connect_error', () => { state.network.error = 'Unable to reach the game server.'; });
  socket.on('world-state', applyWorldState);
  socket.on('gm-event', (event) => { if (event?.message) { state.publicEvent = event.message; note(event.message, 6); } });
  socket.on('gm-private', (event) => { if (event?.message) { state.privateRule = event; note(event.message, 7); } });
  socket.on('disconnect', () => { state.network.connected = false; if (state.joined) note('Connection lost. Reconnect to rejoin the four-player expedition.', 10); });

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, relics, activeEntities, joinRoom, enableShadowForestPreview, enableMoonShrinePreview, enableGhostVillagePreview, interact, aimAt, handleGameKey, handleGameClick, handleGamePointerDown, handleGamePointerMove, handleGamePointerUp, update };
}
