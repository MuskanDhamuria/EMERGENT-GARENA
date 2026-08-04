import { io } from 'socket.io-client';

// Everdawn uses the 32px world art from the original CSD prototype.  We render it
// at 16px logical tiles with smoothing disabled, so the shared game stays crisp
// while using proper authored terrain, water, trees and village art.
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 640;
canvas.id = 'game';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const art = {};
function loadArt(name, source) {
  const image = new Image();
  image.src = source;
  image.addEventListener('load', () => { art[name] = image; render(); });
  return image;
}
loadArt('camping', '/game-art/camping-32.png');
loadArt('cave', '/game-art/cave-32.png');
let authoredForest=null;
fetch('/game-art/forest.json').then(response=>response.ok?response.json():null).then(layout=>{authoredForest=layout;render();}).catch(()=>{});

const T = 16, W = 100, H = 76;
const C = { grass:'#72bd58', grass2:'#62ae50', path:'#d8be80', water:'#49afd0', water2:'#68c8dd', deep:'#2780b8', tree:'#2f7a42', tree2:'#57a94f', trunk:'#92592e', cliff:'#746c78', cliff2:'#a4948b', stone:'#c1aa82', roof:'#c9554d', wall:'#f5d99c', ink:'#27324a', pink:'#fa8c9b', gold:'#f7d25c', purple:'#9b75c9' };
const OBSERVATION_SECONDS = 30;

const map = Array.from({length:H}, (_,y) => Array.from({length:W}, (_,x) => ({kind:'grass', zone:''})));
const state = {
  started:false, time:0, paused:false, phase:'observing', notice:'The Game Master is quietly watching...',
  noticeTimer:0, camera:{x:50,y:38}, relics:0, discoveries:new Set(['Starting Village']), evolved:new Set(),
  finalOpen:false, complete:false, demo:false, frame:0, nextEvolutionAt:48, lastWhisper:0,
  network:{connected:false, attempted:false, playerId:null, roomCode:null, lastState:0, lastTelemetry:0},
  privateRule:null, publicEvent:null, finalObjective:null, serverRelics:[], unlockedFeatures:new Set(),
  players:[
    {name:'Mus', x:48, y:40, color:'#ef5b64', dir:2, score:{explore:0,collect:0,guard:0,lone:0}, archetype:null, lead:true},
    {name:'Lio', x:51, y:40, color:'#4b86db', dir:0, score:{explore:5,collect:1,guard:1,lone:0}, archetype:null, bot:'explore'},
    {name:'Nia', x:49, y:42, color:'#f3c650', dir:3, score:{explore:1,collect:5,guard:2,lone:0}, archetype:null, bot:'collect'},
    {name:'Orr', x:52, y:42, color:'#8a6cc8', dir:1, score:{explore:1,collect:0,guard:4,lone:4}, archetype:null, bot:'guard'}
  ]
};
const p = state.players[0];

// Multiplayer is optional: a solo browser tab remains a complete local demo, while
// a room served by server.mjs supplies the shared truth and Game Master decisions.
const socket = io({ autoConnect:false, timeout:2500, reconnectionAttempts:1 });
function cssColor(color, fallback) { return typeof color==='string' ? color : Number.isFinite(color) ? `#${Math.max(0, color).toString(16).padStart(6,'0').slice(-6)}` : fallback; }
function playerWorldPosition(player) {
  // The server's compact world uses -38..38; retain support for future tile-space states.
  return Math.abs(Number(player.x)) <= 40 && Math.abs(Number(player.z ?? player.y)) <= 40
    ? { x:48 + Number(player.x), y:38 + Number(player.z ?? player.y) }
    : { x:Number(player.x), y:Number(player.y ?? player.z) };
}
function applyWorldState(world) {
  if (!world || !Array.isArray(world.players)) return;
  state.network.lastState=performance.now(); state.network.roomCode=world.code || state.network.roomCode;
  const mine=world.players.find(pl=>pl.id===state.network.playerId);
  if (mine) {
    const q=playerWorldPosition(mine); Object.assign(p,{name:mine.name||p.name,color:cssColor(mine.color,p.color),health:mine.health,dead:mine.dead,artifactCount:mine.relicCount ?? mine.artifactCount});
    if(!Number.isFinite(p.targetX)){p.x=q.x;p.y=q.y;} p.targetX=q.x;p.targetY=q.y;
    if (mine.archetype) p.archetype=mine.archetype;
    for(const feature of mine.evolutions||[]) state.unlockedFeatures.add(feature);
  }
  const strangers=world.players.filter(pl=>pl.id!==state.network.playerId).map((pl,index)=>{
    const q=playerWorldPosition(pl); return {id:pl.id,name:pl.name||`Wanderer ${index+1}`,x:q.x,y:q.y,color:cssColor(pl.color,['#4b86db','#f3c650','#8a6cc8'][index%3]),dir:2,archetype:null,remote:true,health:pl.health,dead:pl.dead};
  });
  state.players=[p,...strangers];
  state.phase=world.phase||state.phase; state.serverRelics=world.relics||state.serverRelics;
  for(const feature of world.world?.unlocked||[]) state.unlockedFeatures.add(feature);
  if (world.director?.reason) state.publicEvent=world.director.reason;
  if (world.finalObjective) { state.finalObjective=world.finalObjective; state.finalOpen=true; state.phase='finale'; }
  const privateRules=world.yourPrivateRules||[];
  state.privateRule=privateRules.length ? {...privateRules[privateRules.length-1],body:privateRules[privateRules.length-1].message} : null;
}
function connectToRoom(name, roomCode) {
  state.network.attempted=true;
  socket.connect();
  const soloFallback=setTimeout(()=>{ if(!state.network.connected && !state.started){ state.demo=true; state.started=true; note('No lanterns answered. The Game Master will watch this solitary tale.',6); } },3200);
  socket.once('connect',()=>socket.emit('join-room',{name,roomCode},reply=>{
    clearTimeout(soloFallback);
    if(!reply?.ok) { state.network.attempted=false; showLanternGate(); return; }
    state.network.connected=true; state.network.playerId=reply.playerId; state.network.roomCode=reply.code; state.started=true;
    note(`Lanterns gather in ${reply.code}. The Game Master is listening.`,5);
  }));
}
socket.on('world-state',applyWorldState);
socket.on('gm-event',event=>{ if(event?.message){state.publicEvent=event.message;note(event.message,6);} if(event?.type==='finale-created'&&event.objective){state.finalObjective=event.objective;state.finalOpen=true;state.phase='finale';} });
socket.on('gm-private',event=>{ if(event?.message){state.privateRule={title:event.type==='private-unlock'?'A PATH ONLY YOU CAN SEE':'A LAW ONLY YOU CAN HEAR',body:event.message};note(event.message,8);} if(event?.feature)state.unlockedFeatures.add(event.feature); });
socket.on('gm-rule',rule=>{
  if(rule?.participants?.includes(state.network.playerId)) { state.privateRule=rule; note(`A private law finds you: ${rule.title}. ${rule.body}`,9); }
  else { state.publicEvent='The Game Master changed the world for someone else.'; note('The air shifts. Someone has received a private law.',5); }
});
socket.on('archetype-assigned',event=>{
  if(event?.playerId===state.network.playerId) { p.archetype=event.archetype; note(`“I have seen your nature.” You awaken as the ${event.archetype}.`,7); }
  else note('A distant lantern changes colour. Another story has awakened.',4);
});
socket.on('world-evolved',event=>{ if(event?.message) { state.publicEvent=event.message; note(event.message,7); } });
socket.on('feed',message=>{ if(message) state.publicEvent=message; });
socket.on('disconnect',()=>{ if(state.network.connected){state.network.connected=false;note('The shared tale went quiet. Your local world remains.',5);} });

function rect(x,y,w,h,kind) { for(let j=y;j<y+h;j++) for(let i=x;i<x+w;i++) if(i>=0&&j>=0&&i<W&&j<H) map[j][i] = {kind, zone:map[j][i].zone}; }
function zone(x,y,w,h,name) { for(let j=y;j<y+h;j++) for(let i=x;i<x+w;i++) if(map[j]?.[i]) map[j][i].zone=name; }
function path(x,y,w,h) { rect(x,y,w,h,'path'); }
function water(x,y,w,h) { rect(x,y,w,h,'water'); }
function trees(x,y,w,h) { for(let j=y;j<y+h;j++) for(let i=x;i<x+w;i++) if((i*13+j*7)%3!==0) map[j][i]={kind:'tree',zone:map[j][i].zone}; }
function cliffs(x,y,w,h) { rect(x,y,w,h,'cliff'); }

// A single hand-authored world, laid out like a classic route map rather than disconnected levels.
zone(0,0,W,H,'Meadow');
zone(40,33,20,16,'Starting Village'); path(0,40,100,3); path(48,0,3,76); path(29,36,25,3); path(53,51,3,18); path(24,58,30,3);
zone(4,6,31,28,'Whispering Forest'); trees(3,4,34,31); path(32,15,17,3); zone(12,10,9,8,'Secret Grove'); rect(12,10,9,8,'grass'); trees(12,10,9,8);
zone(2,45,22,18,'Lake of Glass'); water(2,45,23,17); path(16,49,8,2); path(16,56,8,2);
zone(4,64,22,9,'Mountain Pass'); cliffs(2,64,28,12); path(8,68,32,3); zone(28,62,13,9,'Abandoned Camp'); rect(28,62,13,9,'grass');
zone(60,5,23,22,'Crystal Cave'); cliffs(60,5,25,24); path(48,18,16,3); zone(65,9,8,7,'Hidden Cave');
zone(69,31,22,14,'Forgotten Ruins'); rect(69,31,22,14,'grass'); path(57,36,17,3);
zone(73,48,18,13,'Sacred Shrine'); rect(73,48,18,13,'grass'); path(60,54,16,3);
zone(38,65,18,8,'Small Graveyard'); rect(38,65,18,8,'grass');
zone(76,63,19,10,'Ancient Temple'); cliffs(75,62,21,12); path(56,68,22,3);
// make village clear, lake banks natural, and passages open.
rect(39,32,22,18,'grass'); path(41,39,18,3); path(49,33,3,18);
for (const [x,y] of [[60,18],[65,12],[70,36],[82,53],[84,68],[14,68]]) map[y][x]={kind:'cave',zone:map[y][x].zone};
// A two-tile scenic rim sits outside the shared movement limits: sea at the
// east/west sides and mountain cliffs north/south, never an interior tree wall.
for(let x=2;x<=94;x++){map[2][x]={kind:'cliff',zone:'World Rim'};map[3][x]={kind:'cliff',zone:'World Rim'};map[73][x]={kind:'cliff',zone:'World Rim'};map[74][x]={kind:'cliff',zone:'World Rim'};}
for(let y=2;y<=74;y++){map[y][2]={kind:'water',zone:'World Rim'};map[y][3]={kind:'water',zone:'World Rim'};map[y][93]={kind:'water',zone:'World Rim'};map[y][94]={kind:'water',zone:'World Rim'};}

const ruins=[{x:73,y:34},{x:79,y:37},{x:86,y:34},{x:76,y:42}];
const flowers=[[38,35],[39,47],[62,42],[58,50],[29,59],[32,65],[25,40],[34,29],[72,49],[89,55],[20,62],[22,34],[47,30],[62,33]];
const relicNodes=[{x:17,y:13,name:'Grove Dewdrop',type:'explorer',taken:false},{x:65,y:14,name:'Crystal Shard',type:'collector',taken:false},{x:80,y:53,name:'Sanctuary Bell',type:'guardian',taken:false},{x:45,y:68,name:'Moonstone',type:'loner',taken:false},{x:85,y:37,name:'Sun Tablet',type:'collector',taken:false}];
const landmarks=[
 {x:48,y:40,name:'Starting Village',kind:'village'}, {x:20,y:24,name:'Whispering Forest',kind:'forest'}, {x:15,y:13,name:'Secret Grove',kind:'grove'}, {x:17,y:53,name:'Lake of Glass',kind:'lake'}, {x:14,y:68,name:'Mountain Pass',kind:'mountain'}, {x:35,y:66,name:'Abandoned Camp',kind:'camp'}, {x:65,y:14,name:'Crystal Cave',kind:'cave'}, {x:70,y:36,name:'Forgotten Ruins',kind:'ruin'}, {x:82,y:53,name:'Sacred Shrine',kind:'shrine'}, {x:46,y:68,name:'Small Graveyard',kind:'grave'}, {x:85,y:68,name:'Ancient Temple',kind:'temple'}
];

function nearest(a, list, radius=2) { return list.find(o => Math.hypot(a.x-o.x,a.y-o.y)<radius); }
function tileAt(x,y) { return map[Math.max(0,Math.min(H-1,Math.round(y)))][Math.max(0,Math.min(W-1,Math.round(x)))]; }
// Inside edge of the visible CSD forest belt. These coordinates map directly
// to the server's compact min/max bounds, so touching an edge only blocks
// motion â€” it cannot snap a player elsewhere.
const BOUNDS={minX:7,maxX:90,minY:8,maxY:67};
function passable(x,y) { if(x<BOUNDS.minX||x>BOUNDS.maxX||y<BOUNDS.minY||y>BOUNDS.maxY) return false; const k=tileAt(x,y).kind; return !['tree','water','cliff'].includes(k); }
function note(text, duration=4) { state.notice=text; state.noticeTimer=duration; }
function discover(land) { if (!state.discoveries.has(land.name)) { state.discoveries.add(land.name); p.score.explore += 3; note(`✦ ${land.name} discovered — curiosity is noted.`); } }
function collect(r) { r.taken=true; state.relics++; p.score.collect += 4; note(`✦ You found ${r.name}. The world remembers what you treasure.`); evolveCheck(); }
function unlockWorld(archetype) {
 const changes={
  Explorer:()=>rect(60,12,6,2,'path'),
  Collector:()=>rect(86,39,4,3,'path'),
  Guardian:()=>{ rect(15,53,10,2,'path'); },
  Loner:()=>rect(47,66,3,3,'path')
 };
 changes[archetype]?.();
}
function evolve(archetype) {
 if(state.evolved.has(archetype)) return;
 state.evolved.add(archetype); unlockWorld(archetype);
 const unlock={Explorer:'A mossy passage has opened to the Hidden Cave.',Collector:'A relic vault has surfaced among the Forgotten Ruins.',Guardian:'A radiant bridge now spans the Lake of Glass.',Loner:'A spirit portal shimmers beside the graveyard.'};
 note(`✦ ${archetype} has evolved. ${unlock[archetype]}`,6);
 if(state.evolved.size===4) finalObjective();
}
function evolveCheck() {
 if(state.phase!=='evolving' || !p.archetype) return;
 const unlock={Explorer:'A mossy door opens in the northern forest.',Collector:'A relic vault rises near the forgotten ruins.',Guardian:'A healing shrine glows beside the lake.',Loner:'A spirit portal shimmers in the graveyard.'};
 const order=['Explorer','Collector','Guardian','Loner'];
 const needed=order.find(a=>!state.evolved.has(a));
 if(needed && (p.score.explore+p.score.collect+p.score.guard+p.score.lone)>=8+state.evolved.size*3) evolve(needed);
 }
function interact() {
 if(!state.started || state.complete) return;
 if(state.network.connected) {
   const serverRelic=(state.serverRelics||[]).filter(r=>!r.collectedBy).map(r=>({...r,...playerWorldPosition(r)})).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
   const landmark=nearest(p,landmarks,3.5);
   if(serverRelic&&Math.hypot(serverRelic.x-p.x,serverRelic.y-p.y)<4) socket.emit('interact',{type:'relic',targetId:serverRelic.id});
   else if(landmark) { const type=landmark.kind==='temple'?'discover-temple':landmark.kind==='shrine'?'activate-shrine':'object'; socket.emit('interact',{type,targetId:landmark.name}); note(`You study ${landmark.name}. The Game Master notices.`,3); }
   else socket.emit('interact',{type:'object'});
   return;
 }
 const r=nearest(p,relicNodes.filter(n=>!n.taken),3.25); if(r) { collect(r); return; }
 const l=nearest(p,landmarks,3.25); if(l) { discover(l); if(l.kind==='shrine') p.score.guard+=3; if(l.kind==='grave') p.score.lone+=3; evolveCheck(); return; }
 if(state.finalOpen && Math.hypot(p.x-85,p.y-68)<4) { state.complete=true; note('The Temple welcomes the four stories you have written. Everdawn remembers.',99); }
 note('Wildflowers rustle in the warm breeze.');
}

function assignArchetypes() {
 if(state.phase!=='observing') return;
 const types=['Explorer','Collector','Guardian','Loner'];
 state.players.forEach((pl,i)=> { if(pl===p) { const s=pl.score; pl.archetype=types[[s.explore,s.collect,s.guard,s.lone].indexOf(Math.max(s.explore,s.collect,s.guard,s.lone))]; } else pl.archetype=types[i===1?0:i===2?1:i===3?2:3]; });
 // ensure the player keeps their best role while all four roles are represented
 const used=new Set(); state.players.forEach(pl=>{ if(used.has(pl.archetype)) { pl.archetype=types.find(t=>!used.has(t)); } used.add(pl.archetype); });
 state.phase='evolving'; note(`“I've observed your curiosity.” Mus has awakened as the ${p.archetype}. The living world responds.`,7);
}
function finalObjective() { state.finalOpen=true; state.phase='finale'; note('“The Ancient Temple has awakened.” Find its hidden entrance and carry the four stories within.',8); }

const keys={}; addEventListener('keydown',e=>{ keys[e.key.toLowerCase()]=true; if(e.key.toLowerCase()==='e') interact(); if(e.key.toLowerCase()==='p'&&!state.network.connected) { state.time=OBSERVATION_SECONDS; assignArchetypes(); } if(e.key.toLowerCase()==='f') document.fullscreenElement?document.exitFullscreen():canvas.requestFullscreen(); });
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener('click',()=>{ if(!state.started&&!state.network.attempted) showLanternGate(); });

function showLanternGate(){
 if(document.getElementById('lantern-gate')) return;
 const gate=document.createElement('form'); gate.id='lantern-gate';
 gate.innerHTML='<div class="gate-card"><div class="gate-title">LIGHT A LANTERN</div><p>Enter a shared tale. The world will decide what you become.</p><label>NAME<input name="name" maxlength="16" required value="Wanderer"></label><label>ROOM CODE<input name="room" maxlength="6" required value="DAWN"></label><button>ENTER THE WORLD</button><button type="button" class="alone">WANDER ALONE</button><small>No roles. No quest log. Only what the world notices.</small></div>';
 document.body.appendChild(gate);
 gate.querySelector('input[name="name"]').focus();
 gate.addEventListener('submit',event=>{event.preventDefault(); const data=new FormData(gate); gate.remove(); connectToRoom(String(data.get('name')),String(data.get('room')).toUpperCase());});
 gate.querySelector('.alone').addEventListener('click',()=>{gate.remove();state.demo=true;state.started=true;note('A lone lantern enters Everdawn. The Game Master is quietly watching.',6);});
}

function update(dt) {
 if(!state.started||state.complete) return;
 state.time+=dt; state.frame+=dt*10; if(state.noticeTimer>0) state.noticeTimer-=dt;
 if(state.network.connected&&Number.isFinite(p.targetX)){const ease=Math.min(1,dt*14);p.x+=(p.targetX-p.x)*ease;p.y+=(p.targetY-p.y)*ease;}
 if(!state.network.connected && state.phase==='observing' && state.time>=OBSERVATION_SECONDS) assignArchetypes();
 let dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0), dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);
 if(dx||dy) { const d=Math.hypot(dx,dy), sprint=keys.shift||keys[' ']; dx/=d;dy/=d; p.dir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:3):(dy>0?2:0); if(state.network.connected){ socket.emit('move',{x:dx*(sprint?1.35:1),z:dy*(sprint?1.35:1)}); } else { const speed=sprint?13:8.2, nx=p.x+dx*dt*speed,ny=p.y+dy*dt*speed; if(passable(nx,p.y))p.x=nx;if(passable(p.x,ny))p.y=ny; p.score.explore+=dt*(sprint?.42:.30); } }
 else if(state.network.connected) socket.emit('move',{x:0,z:0});
 if(state.network.connected && performance.now()-state.network.lastTelemetry>550) { const landmark=nearest(p,landmarks,4); socket.emit('player-telemetry',{x:p.x-48,z:p.y-38,locationId:landmark?.name?.toLowerCase().replaceAll(' ','-')}); state.network.lastTelemetry=performance.now(); }
 // The three companions visibly roam according to their observed tendencies.
 if(!state.network.connected) state.players.slice(1).forEach((b,i)=>{ const a=state.time*.35+i*2; const tx=i===0?35:i===1?65:52, ty=i===0?22:i===1?17:52; const nx=tx+Math.cos(a)*(3+i),ny=ty+Math.sin(a*.7)*(2+i); if(passable(nx,ny)){b.x=nx;b.y=ny;} });
 const l=nearest(p,landmarks,2.4); if(l) discover(l);
 if(state.phase==='observing' && state.time-state.lastWhisper>18){ state.lastWhisper=state.time; const whispers=['“You followed a road no map marked.”','“The relics are answering your footsteps.”','“The others learn from the space between you.”','“What you repeat becomes your legend.”']; note(whispers[Math.floor(state.time/18)%whispers.length],4); }
 state.camera.x=Math.max(31,Math.min(69,state.camera.x+(p.x-state.camera.x)*Math.min(1,dt*5))); state.camera.y=Math.max(22,Math.min(54,state.camera.y+(p.y-state.camera.y)*Math.min(1,dt*5)));
 if(!state.network.connected&&state.phase==='evolving' && state.time>=state.nextEvolutionAt && state.evolved.size<4) { evolve(['Explorer','Collector','Guardian','Loner'].find(a=>!state.evolved.has(a))); state.nextEvolutionAt+=12; }
}

function px(x){return Math.floor(x*T-(state.camera.x*T-canvas.width/2));} function py(y){return Math.floor(y*T-(state.camera.y*T-canvas.height/2));}
function fill(color,x,y,w=T,h=T){ctx.fillStyle=color;ctx.fillRect(px(x),py(y),w,h)}
function sheetTile(sheet, gid, X, Y, width=T, height=T) {
 const image=art[sheet]; if(!image) return false;
 const tile=gid-1, columns=Math.floor(image.width/32);
 ctx.drawImage(image,(tile%columns)*32,Math.floor(tile/columns)*32,32,32,X,Y,width,height);
 return true;
}
function drawAuthoredForest(x,y,X,Y) {
 const originX=4, originY=4;
 // The forest route uses a tree-and-water section of the CSD map. The camp
 // section is reserved for the starting village stamp, avoiding a duplicated
 // camp or any partial buildings at the route boundary.
 const sourceX=25+(x-originX), sourceY=y-originY;
 if(!authoredForest || sourceX<0 || sourceY<0 || sourceX>=authoredForest.width || sourceY>=authoredForest.height) return false;
 const index=sourceY*authoredForest.width+sourceX;
 for(const layer of authoredForest.layers||[]) { const gid=layer.data?.[index]||0; if(gid) sheetTile('camping',gid,X,Y); }
 return true;
}
function drawForestStamp(sourceX,sourceY,width,height,destX,destY) {
 if(!authoredForest) return;
 for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  const sourceIndex=(sourceY+y)*authoredForest.width+sourceX+x;
  for(const layer of authoredForest.layers||[]) {
   const gid=layer.data?.[sourceIndex]||0;
   if(gid) sheetTile('camping',gid,px(destX+x),py(destY+y));
  }
 }
}
function drawTile(x,y,t) {
 const X=px(x),Y=py(y), wave=(Math.floor(state.frame/5)+x+y)%2;
 if((t.zone==='Whispering Forest' || t.zone==='Secret Grove') && drawAuthoredForest(x,y,X,Y)) return;
 // All terrain art below is from the CSD authored forest/camping sheet.
 if(t.kind==='water') { sheetTile('camping',121,X,Y); return; }
 if(t.kind==='path') { sheetTile('camping',66,X,Y); return; }
 if(t.kind==='cave') { sheetTile('cave',42,X,Y); return; }
 sheetTile('camping',84,X,Y);
}
function startingVillage(){
 // One intact camp stamp from the authored CSD forest: no cut-up sprites and
 // no cross-pack style clash. It is the players' Lantern Village at dawn.
 drawForestStamp(6,10,18,13,40,33);
}
function drawCsdBoundary(){
 // Four uninterrupted belts assembled from the dense tree section of the
 // same authored CSD map. They are visual and collision boundaries together.
 for(let x=2;x<98;x+=12){drawForestStamp(0,0,12,6,x,2);drawForestStamp(0,0,12,6,x,68);}
 for(let y=2;y<74;y+=6){drawForestStamp(0,0,5,6,2,y);drawForestStamp(0,0,5,6,91,y);}
}
function bridge(x,y,w){fill('#7d5536',x,y,w*T,8);ctx.fillStyle='#c49a62';for(let i=0;i<w;i++)ctx.fillRect(px(x+i)+1,py(y)+1,14,5)}
function flower(x,y){ctx.fillStyle='#f9e3ef';ctx.fillRect(px(x)+5,py(y)+5,5,5);ctx.fillStyle=C.pink;ctx.fillRect(px(x)+6,py(y)+4,3,7);}
function ruin(r){const X=px(r.x),Y=py(r.y);ctx.fillStyle='#917d73';ctx.fillRect(X+3,Y+3,8,13);ctx.fillStyle='#d1b99a';ctx.fillRect(X+4,Y+2,6,3);ctx.fillStyle='#655e69';ctx.fillRect(X+5,Y+8,2,5);}
function shrine(){const X=px(82),Y=py(53);ctx.fillStyle='#d8d4bd';ctx.fillRect(X+2,Y+6,12,10);ctx.fillStyle='#a887bd';ctx.fillRect(X+5,Y,6,8);ctx.fillStyle='#f7db82';ctx.fillRect(X+7,Y+3,2,3);}
function temple(){const X=px(82),Y=py(65);ctx.fillStyle='#b9a882';ctx.fillRect(X,Y+7,48,30);ctx.fillStyle='#d2bd8e';ctx.fillRect(X+4,Y+3,40,9);ctx.fillStyle='#706879';ctx.fillRect(X+19,Y+18,10,19); if(state.finalOpen){ctx.fillStyle='#7c5ab0';ctx.fillRect(X+21,Y+21,6,14);}}
function evolutionObjects(){
 const has=(...features)=>features.some(feature=>state.unlockedFeatures.has(feature));
 if(state.evolved.has('Explorer')||has('hidden-cave','secret-path','invisible-bridge')){const X=px(64),Y=py(12);ctx.fillStyle='#b8df71';ctx.fillRect(X+2,Y+3,12,10);ctx.fillStyle='#385a42';ctx.fillRect(X+5,Y+5,6,8);}
 if(state.evolved.has('Collector')||has('relic-vault','evolving-artifacts','treasure-cache')){const X=px(87),Y=py(40);ctx.fillStyle='#7b607f';ctx.fillRect(X,Y+5,18,11);ctx.fillStyle='#f0c866';ctx.fillRect(X+2,Y+3,14,6);ctx.fillStyle='#fff2a0';ctx.fillRect(X+7,Y+6,3,3);}
 if(state.evolved.has('Guardian')||has('healing-shrine','protective-barrier','revival-monument')){const X=px(17),Y=py(53);ctx.fillStyle='#9169c4';ctx.fillRect(X+4,Y,8,16);ctx.fillStyle='#bfe9e1';ctx.fillRect(X+6,Y+2,4,9);ctx.fillStyle='#ffe99c';ctx.fillRect(X+7,Y+4,2,2);}
 if(state.evolved.has('Loner')||has('spirit-realm','illusion-passage','hidden-portal')){const X=px(48),Y=py(67);ctx.fillStyle='#4f376f';ctx.fillRect(X+3,Y+2,10,14);ctx.fillStyle='#b483e0';ctx.fillRect(X+5,Y+4,6,10);ctx.fillStyle='#e8ceff';ctx.fillRect(X+7,Y+6,2,6);}
}
function character(pl){const X=px(pl.x),Y=py(pl.y);const bob=(keys.w||keys.a||keys.s||keys.d)&&pl===p?Math.sin(state.frame)*1:0;ctx.fillStyle='#27324a';ctx.fillRect(X+4,Y+4+bob,8,10);ctx.fillStyle=pl.color;ctx.fillRect(X+5,Y+5+bob,6,7);ctx.fillStyle='#f3c28b';ctx.fillRect(X+5,Y+1+bob,6,5);ctx.fillStyle='#fff';ctx.fillRect(X+6,Y+3+bob,1,1); if(pl===p){ctx.strokeStyle='#fff5b4';ctx.strokeRect(X+1,Y+1,14,15);} }
function label(txt,x,y,color='#fff7d5'){ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillStyle='#253047';ctx.fillText(txt,px(x)+1,py(y)-7+1);ctx.fillStyle=color;ctx.fillText(txt,px(x),py(y)-7);}

function panel(x,y,w,h){ctx.fillStyle='rgba(29,47,68,.88)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#f5dd8a';ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,w-2,h-2);}
function drawHUD(){
 panel(14,14,300,58);ctx.textAlign='left';ctx.font='bold 13px monospace';ctx.fillStyle='#fff2bd';ctx.fillText('EVERDAWN',27,35);ctx.font='11px monospace';ctx.fillStyle='#d2f0cf';
 const timer=state.phase==='observing'?`A presence is watching · ${Math.max(0,OBSERVATION_SECONDS-Math.floor(state.time))}s`:`YOUR STORY · ${p.archetype||'still unread'}`;ctx.fillText(timer,27,55);
 const target=relicNodes.filter(r=>!r.taken).sort((a,b)=>Math.hypot(p.x-a.x,p.y-a.y)-Math.hypot(p.x-b.x,p.y-b.y))[0];
 if(target){panel(325,14,265,43);const dx=target.x-p.x,dy=target.y-p.y,arrow=Math.abs(dx)>Math.abs(dy)?(dx>0?'→':'←'):(dy>0?'↓':'↑');ctx.textAlign='left';ctx.font='bold 10px monospace';ctx.fillStyle='#fff2bd';ctx.fillText(`RELIC SIGNAL  ${arrow}  ${target.name}`,338,40);}
 panel(760,14,186,98);ctx.textAlign='left';ctx.font='bold 10px monospace';ctx.fillStyle='#fff2bd';ctx.fillText(state.network.connected?`LANTERNS · ${state.network.roomCode}`:'NEARBY LANTERNS',774,34);state.players.forEach((pl,i)=>{ctx.fillStyle=pl.color;ctx.fillRect(775,43+i*15,7,7);ctx.fillStyle='#fff';ctx.fillText(`${pl.name}  ${pl===p?(pl.archetype||'unread'):'their story is hidden'}`,788,50+i*15);});
 if(state.privateRule){panel(14,84,340,74);ctx.textAlign='left';ctx.font='bold 10px monospace';ctx.fillStyle='#f4c7ff';ctx.fillText('A LAW ONLY YOU CAN HEAR',27,104);ctx.fillStyle='#fff7d5';ctx.font='bold 11px monospace';ctx.fillText(state.privateRule.title||'Private Vision',27,122);ctx.font='10px monospace';wrap(state.privateRule.body||state.privateRule.counterplay||'',184,141,310,12);}
 if(state.noticeTimer>0||state.complete){panel(165,548,630,66);ctx.textAlign='center';ctx.font='bold 12px monospace';ctx.fillStyle='#fff7d5';wrap(state.notice,480,573,570,16);}
 if(state.phase==='finale'&&!state.complete){ctx.textAlign='center';ctx.font='bold 11px monospace';ctx.fillStyle='#fff2bd';ctx.fillText(state.finalObjective?.title||'FINAL CALLING · The Ancient Temple has awakened',480,94);}
}
function wrap(txt,x,y,max,line){const words=txt.split(' ');let s='',yy=y;for(const word of words){if(ctx.measureText(s+word).width>max){ctx.fillText(s,x,yy);s=word+' ';yy+=line;}else s+=word+' ';}ctx.fillText(s,x,yy);}
function drawStart(){ctx.fillStyle='#70b957';ctx.fillRect(0,0,960,640); for(let i=0;i<80;i++){ctx.fillStyle=i%2?'#57a94f':'#81c963';ctx.fillRect((i*79)%960,(i*131)%640,16,16);}ctx.textAlign='center';ctx.font='bold 54px monospace';ctx.fillStyle='#26304a';ctx.fillText('EVERDAWN',482,179);ctx.fillStyle='#fff3b8';ctx.fillText('EVERDAWN',480,175);ctx.font='bold 15px monospace';ctx.fillStyle='#fff9de';ctx.fillText('A living tale, shaped by the way you wander.',480,215); panel(245,264,470,128);ctx.font='bold 13px monospace';ctx.fillStyle='#f8de90';ctx.fillText('NO ONE HAS TOLD YOU WHAT THIS WORLD IS FOR.',480,296);ctx.font='11px monospace';ctx.fillStyle='#e4f1dc';ctx.fillText('It will learn from the choices you make together.',480,328);ctx.fillText('Some laws will be shared. Some will belong to only one of you.',480,353);ctx.font='bold 14px monospace';ctx.fillStyle='#ffef9c';ctx.fillText('CLICK TO LIGHT A LANTERN',480,445);}
function render(){ctx.clearRect(0,0,canvas.width,canvas.height);if(!state.started){drawStart();return;} const minX=Math.floor(state.camera.x-31),maxX=Math.ceil(state.camera.x+31),minY=Math.floor(state.camera.y-22),maxY=Math.ceil(state.camera.y+22);for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)if(map[y]?.[x])drawTile(x,y,map[y][x]);drawCsdBoundary();startingVillage();bridge(16,49,8);bridge(16,56,8);flowers.forEach(f=>flower(...f));ruins.forEach(ruin);shrine();temple();evolutionObjects(); relicNodes.filter(r=>!r.taken).forEach(r=>{ctx.fillStyle=C.gold;ctx.fillRect(px(r.x)+5,py(r.y)+3,6,10);ctx.fillStyle='#fff0a8';ctx.fillRect(px(r.x)+6,py(r.y)+2,3,3);});state.players.forEach(character);state.players.forEach(pl=>label(pl.name,pl.x,pl.y,pl.color));drawHUD();}
let last=performance.now();function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;update(dt);render();requestAnimationFrame(loop);}requestAnimationFrame(loop);
window.advanceTime=(ms)=>{const steps=Math.max(1,Math.round(ms/(1000/60)));for(let i=0;i<steps;i++)update(1/60);render();};
window.render_game_to_text=()=>JSON.stringify({coordinates:'tile origin top-left; x east, y south',mode:state.started?'adventure':'title',phase:state.phase,seconds:Math.floor(state.time),player:{x:+p.x.toFixed(1),y:+p.y.toFixed(1),archetype:p.archetype},relics:state.relics,discoveries:[...state.discoveries],evolved:[...state.evolved],finalObjective:state.finalOpen,nearby:nearest(p,landmarks,4)?.name||null});
