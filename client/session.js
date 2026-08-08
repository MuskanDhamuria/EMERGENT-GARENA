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
    world: null, players: [], mine: null, privateRule: null, publicEvent: null,
    attackTimer: 0, attackTargetId: null, attackTargetX: 0, attackTargetY: 0, hurtTimer: 0, hurtStrength: 0, aimScreen: { x: 480, y: 320 },
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
    if (state.mine.realm === 'shadow-forest') {
      if (state.mine.x < 22.4 || state.mine.y >= 6.3) { note('Stand beside the trophy before pressing E.', 3); return; }
      if (state.preview === 'shadow-forest') { state.mine.x=state.mine.targetX=1.5;state.mine.y=state.mine.targetY=11;state.mine.shadowForest.vx=state.mine.shadowForest.vy=0;note('Crossing complete. The preview has restarted.',4);return; }
      socket.emit('interact', { type: 'exit-shadow-forest' }, (reply) => note(reply?.ok ? 'You claim the forgotten trophy.' : (reply?.error || 'The trophy remains silent.'), reply?.ok ? 3 : 5)); return;
    }
    if (state.mine.realm === 'moon-shrine') { if(state.preview==='moon-shrine'){interactMoonPreview();return;}socket.emit('interact', { type: 'moon-shrine-interact' }, (reply) => note(reply?.ok ? (reply.kind==='complete'?'The Moon Shrine recognizes you.':reply.kind==='puzzle'?'Three numbered runes awaken.':reply.kind==='rune'?'A rune ignites.':'A moon echo answers.') : (reply?.error || 'The moonlit stones remain silent.'), reply?.ok ? 3 : 5)); return; }
    if (!['evolving', 'finale'].includes(state.world?.phase)) {
      note('Roles are still awakening. Interactions unlock when the observation ends.', 4);
      return;
    }
    const candidates=activeEntities(),finale=state.world?.finalObjective;
    const finaleTarget=finale?.status==='active'&&finale.phase==='TRAVEL'?candidates.find((item)=>item.id===finale.destination?.targetId):null;
    const entity=finaleTarget&&Math.hypot(state.mine.x-finaleTarget.x,state.mine.y-finaleTarget.y)<=3.25?finaleTarget:nearest(state.mine,candidates),action=finalAction(entity);
    if (!action) { note('Move near an object marked for your role.', 3); return; }
    socket.emit('interact', { type: action, targetId: entity.targetId || entity.id }, (reply) => {
      if (reply?.ok && action === 'dungeon-attack') { state.attackTimer = 0.28; state.attackTargetId = entity.id; state.attackTargetX = entity.x; state.attackTargetY = entity.y; }
      note(reply?.ok ? `You used ${entity.label || action.replaceAll('-', ' ')}.` : (reply?.error || 'That interaction did not work.'), reply?.ok ? 3 : 5);
    });
  }
  function aimAt(screenX,screenY,width,height){state.aimScreen={x:screenX,y:screenY};const player=state.mine;if(player?.realm!=='ghost-village'||!player.ghostVillage?.active)return false;const aimX=(screenX+(state.camera.x*20-width/2))/20,aimZ=(screenY+(state.camera.y*20-height/2))/20;if(state.preview==='ghost-village'){const mission=player.ghostVillage;if(mission.cooldown>0)return true;const dx=aimX-player.x,dz=aimZ-(player.y-.4),length=Math.hypot(dx,dz);if(length<.2)return true;mission.projectiles.push({id:`shot-${++mission.shotSequence}`,x:player.x,z:player.y-.4,vx:dx/length*10,vz:dz/length*10,life:2.8});mission.cooldown=.35;return true;}socket.emit('interact',{type:'ghost-village-aim',aimX,aimZ},(reply)=>{if(!reply?.ok)note(reply?.error||'The spirit shard did not launch.',2);});return true;}
  function update(dt, input) {
    state.frame += dt * 10; if (state.noticeTimer > 0) state.noticeTimer -= dt; if (state.hurtTimer > 0) state.hurtTimer = Math.max(0, state.hurtTimer - dt); if (state.attackTimer > 0) { state.attackTimer = Math.max(0, state.attackTimer - dt); if (!state.attackTimer) state.attackTargetId = null; }
    if (state.preview === 'shadow-forest') { updateShadowPreview(dt,input);const mine=state.mine;state.camera.x+=(mine.x-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(mine.y-state.camera.y)*Math.min(1,dt*5);return; }
    if (state.preview === 'moon-shrine') { const mine=state.mine,mission=mine.moonShrine;mine.x=mine.targetX=Math.max(.6,Math.min(29.5,mine.x+input.x*5.2*dt));mine.y=mine.targetY=Math.max(3.5,Math.min(11.5,mine.y+input.z*5.2*dt));mine.moving=Math.hypot(input.x,input.z)>0;if(mission.pathStep<moonPath.length-1){const result=moonSegmentDistance(mine,moonPath[mission.pathStep],moonPath[mission.pathStep+1]);if(result.distance>.85){mine.x=mine.targetX=2;mine.y=mine.targetY=10;mission.pathStep=0;mission.lineFailed=false;note('Misstep! The moonlight returns you to the start.',3);}else if(result.t>.94)mission.pathStep+=1;}state.camera.x+=(12-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(0-state.camera.y)*Math.min(1,dt*5);return; }
    if(state.preview==='ghost-village'){const mine=state.mine,mission=mine.ghostVillage;mine.x=mine.targetX=Math.max(1,Math.min(25,mine.x+input.x*4.5*dt));mine.y=mine.targetY=11;mine.moving=Math.abs(input.x)>0;mission.cooldown=Math.max(0,mission.cooldown-dt);for(const ghost of mission.ghosts)if(ghost.active){ghost.x+=ghost.vx*dt;ghost.z+=ghost.vz*dt;if(ghost.x<3||ghost.x>25){ghost.vx*=-1;ghost.x=Math.max(3,Math.min(25,ghost.x));}if(ghost.z<3||ghost.z>9.5){ghost.vz*=-1;ghost.z=Math.max(3,Math.min(9.5,ghost.z));}}for(const shot of mission.projectiles){shot.x+=shot.vx*dt;shot.z+=shot.vz*dt;shot.vz+=7*dt;shot.life-=dt;const ghost=mission.ghosts.find((item)=>item.active&&Math.hypot(item.x-shot.x,item.z-shot.z)<.8);if(ghost){ghost.active=false;shot.life=0;mission.caught+=1;note(`Ghost caught · ${mission.caught}/6`,2);}}mission.projectiles=mission.projectiles.filter((shot)=>shot.life>0&&shot.x>0&&shot.x<28&&shot.z<13);if(mission.caught===6){mission.ghosts.forEach((ghost)=>ghost.active=true);mission.projectiles=[];mission.caught=0;note('All six caught! The preview has restarted.',4);}state.camera.x+=(13.5-state.camera.x)*Math.min(1,dt*5);state.camera.y+=(0-state.camera.y)*Math.min(1,dt*5);return;}
    for (const player of state.players) { const ease = Math.min(1, dt * 14); player.x += (player.targetX - player.x) * ease; player.y += (player.targetY - player.y) * ease; }
    const mine = state.mine;
    if (gameReady() && mine) {
      const { x, z } = input; socket.emit('move', { x, z });
      if (performance.now() - state.network.lastTelemetry > 500) { const landmark = nearest(mine, LANDMARKS, 4); socket.emit('player-telemetry', { locationId: landmark?.label?.toLowerCase().replaceAll(' ', '-') }); state.network.lastTelemetry = performance.now(); }
    }
    if (mine) { const cameraTarget=mine.realm==='moon-shrine'?{x:12,y:0}:mine.realm==='ghost-village'?{x:13.5,y:0}:mine;state.camera.x += (cameraTarget.x - state.camera.x) * Math.min(1, dt * 5); state.camera.y += (cameraTarget.y - state.camera.y) * Math.min(1, dt * 5); }
  }

  socket.on('connect_error', () => { state.network.error = 'Unable to reach the game server.'; });
  socket.on('world-state', applyWorldState);
  socket.on('gm-event', (event) => { if (event?.message) { state.publicEvent = event.message; note(event.message, 6); } });
  socket.on('gm-private', (event) => { if (event?.message) { state.privateRule = event; note(event.message, 7); } });
  socket.on('disconnect', () => { state.network.connected = false; if (state.joined) note('Connection lost. Reconnect to rejoin the four-player expedition.', 10); });

  return { state, note, mapPoint, roomPlayerCount, gameReady, abilities, relics, activeEntities, joinRoom, enableShadowForestPreview, enableMoonShrinePreview, enableGhostVillagePreview, interact, aimAt, update };
}
