const REALMS = new Set(['spirit-realm', 'shadow-forest', 'moon-shrine', 'ghost-village']);
const COLLECTOR_PREVIEWS = new Set(['collector-crystal-mine', 'collector-ancient-vault', 'collector-treasure-cache', 'collector-relic-forge', 'collector-sunken-relic']);
const FINALE_PREVIEWS = new Set(['finale-lantern-rite', 'finale-echo-accord']);

function dungeonEntities() {
  return [
    { id:'dungeon-warden-1', type:'dungeon-enemy', tileX:5, tileY:5, label:'Bone Warden', hp:3 },
    { id:'dungeon-warden-2', type:'dungeon-enemy', tileX:14, tileY:5, label:'Veil Reaver', hp:2 },
    { id:'dungeon-sigil-1', type:'dungeon-sigil', tileX:4, tileY:4, label:'Whisper Seal' },
    { id:'dungeon-altar', type:'dungeon-altar', tileX:10, tileY:7, label:'Veil Altar' },
    { id:'dungeon-exit', type:'dungeon-exit', tileX:2, tileY:13, label:'Return Portal' },
  ];
}

export function applyRealmPreview(state, requestedRealm) {
  if (!REALMS.has(requestedRealm)) return false;
  const realm = requestedRealm === 'spirit-realm' ? 'dungeon' : requestedRealm;
  const player = { id:'preview-loner', name:'Loner Preview', archetype:'Loner', color:'#c999ed', sprite:5, facing:'right', moving:false, realm, zone:'overworld', x: realm==='moon-shrine'?13:realm==='ghost-village'?5:realm==='shadow-forest'?8:2, y: realm==='moon-shrine'?7:realm==='ghost-village'?11:realm==='shadow-forest'?6.15:12, evolutions:[requestedRealm], completedEvolutions:[] };
  if (realm === 'dungeon') player.dungeon = { active:true, phase:'DEFEAT_WARDENS', health:4, maxHealth:5, defeatedCount:1, collected:[] };
  if (realm === 'shadow-forest') player.shadowForest = { active:true, falls:1, trapHits:1, sawTime:1.5 };
  if (realm === 'moon-shrine') player.moonShrine = { active:true, pathStep:3, lineFailed:false };
  if (realm === 'ghost-village') player.ghostVillage = { active:true, caught:2, ghosts:Array.from({length:6},(_,index)=>({id:`ghost-${index+1}`,x:4+index*4,z:4+(index%3)*2,active:index>=2})),projectiles:[{x:10,z:8}] };
  state.joined = true; state.network.connected = false; state.network.playerId = player.id; state.network.roomCode = 'PREVIEW';
  state.players = [player]; state.mine = player;
  state.camera = { x: player.x, y: realm === 'ghost-village' ? 1 : player.y };
  state.world = { code:'PREVIEW', phase:'evolving', players:[player], entities:realm==='dungeon'?dungeonEntities():[], terrain:[], relics:[], world:{unlocked:[requestedRealm],privateUnlocks:[requestedRealm]}, events:[] };
  state.notice = ''; state.noticeTimer = 0; state.guidance = null; state.privateRule = null;
  return true;
}

export function applyCollectorPreview(state, requestedPreview) {
  if (!COLLECTOR_PREVIEWS.has(requestedPreview)) return false;
  const feature=requestedPreview.replace('collector-',''),player={id:'preview-collector',name:'Collector Preview',archetype:'Collector',color:'#f3c969',sprite:2,facing:'down',moving:false,realm:'overworld',zone:'overworld',x:0,y:0,evolutions:[feature],completedEvolutions:[]};
  const shared={feature,title:{'crystal-mine':'Restore the Crystal Heart','ancient-vault':'Decode the Ancient Vault','treasure-cache':'Curate the Treasure Cache','relic-forge':'Forge the Resonance Core','sunken-relic':'Recover the Sunken Crown'}[feature],instruction:{'crystal-mine':'Seat the five crystal fragments in their resonant order.','ancient-vault':'Enter the four seals in the order revealed by the private clues.','treasure-cache':'Identify the three genuine relics from the appraisal notes.','relic-forge':'Balance, heat, hammer, and quench the Resonance Core.','sunken-relic':'Navigate the flooded currents to reach the crown chamber.'}[feature],targetId:`collector-landmark-${feature}`,clueTotal:feature==='sunken-relic'?0:4,clues:feature==='sunken-relic'?[]:[{title:'Recovered Note',text:'This preview includes a sample of the Collector’s private evidence.'}],hitboxes:[],progress:0,message:''};
  const games={
    'crystal-mine':{...shared,type:'crystal-rebuild',pieces:[{x:150,y:258,homeX:150,homeY:258,targetX:475,targetY:328,locked:false},{x:280,y:300,homeX:280,homeY:300,targetX:565,targetY:328,locked:false},{x:150,y:388,homeX:150,homeY:388,targetX:520,targetY:394,locked:false},{x:282,y:430,homeX:282,homeY:430,targetX:478,targetY:399,locked:false},{x:196,y:500,homeX:196,homeY:500,targetX:562,targetY:399,locked:false}],dragging:null,selectedPiece:null,dragOffset:{x:0,y:0}},
    'ancient-vault':{...shared,type:'sequence',symbols:['MOON','KEY','GEM','FLAME'],answer:[2,0,3,1],entered:[],resetAt:0},
    'treasure-cache':{...shared,type:'appraisal',items:[{name:'Ancient Idol',value:3,risk:'Genuine',sprite:'ancient-idol'},{name:'Jeweled Goblet',value:3,risk:'Genuine',sprite:'jeweled-goblet'},{name:'Reliquary Box',value:2,risk:'Genuine',sprite:'reliquary-box'},{name:'Cursed Crown',value:5,risk:'Cursed',sprite:'sunken-crown'},{name:'Golden Compass',value:0,risk:'Replica',sprite:'ornate-key'}],chosen:[]},
    'relic-forge':{...shared,type:'forge',phase:'ingredients',components:['STABILITY','MEMORY','ENERGY','EMBER','IRON'],recipe:[],recipeAnswer:[2,0,4],bellows:0,heat:0,hammerStep:0,hammerPattern:[4,0,2,1,3],quench:null},
    'sunken-relic':{...shared,type:'current',clueTotal:0,clues:[],diver:{x:0,y:5},goal:{x:7,y:0},blocked:['1,0','5,0','1,1','3,1','5,1','7,1','1,2','3,2','7,2','3,3','5,3','7,3','1,4','5,4','3,5','7,5'],currents:{'0,4':'right','2,4':'up','4,2':'right','5,2':'right'},setbacks:{'0,3':{direction:'down',x:0,y:5},'4,4':{direction:'left',x:3,y:4},'6,4':{direction:'left',x:4,y:4},'7,4':{direction:'left',x:6,y:4}},width:8,height:6},
  };
  player.collectorObjective={feature,title:shared.title,completed:false};
  state.joined=true;state.network.connected=false;state.network.playerId=player.id;state.network.roomCode='PREVIEW';state.players=[player];state.mine=player;state.camera={x:30,y:17};state.collectorGame=games[feature];
  state.world={code:'PREVIEW',phase:'evolving',players:[player],entities:[],terrain:[],relics:[],world:{unlocked:[feature],privateUnlocks:[]},collectorTrial:{plan:[feature],completedFeatures:[],active:{feature,title:shared.title,completed:false}},events:[]};
  state.notice='';state.noticeTimer=0;state.guidance=null;state.privateRule=null;return true;
}

export function applyFinalePreview(state, requestedPreview) {
  if (!FINALE_PREVIEWS.has(requestedPreview)) return false;
  const lantern = requestedPreview === 'finale-lantern-rite';
  const realm = lantern ? 'lantern-rite' : 'echo-accord';
  const roles = ['Explorer', 'Collector', 'Guardian', 'Loner'];
  const colors = ['#76d7c4', '#f3c969', '#83b9f5', '#c999ed'];
  const players = roles.map((archetype, index) => ({
    id:`preview-${index}`,name:['Ari','Bea','Cy','Dee'][index],archetype,color:colors[index],sprite:[1,2,3,5][index],
    facing:'down',moving:false,realm,zone:'overworld',x:lantern?[14,18,14,18][index]:[8,40,8,40][index],
    y:lantern?[21,21,24,24][index]:[8,8,24,24][index],lanternHealth:9,lanternMaxHealth:9,
    echoAlive:true,echoCollected:index,echoColor:colors[index],echoTrail:[],evolutions:[],completedEvolutions:[],
  }));
  state.joined=true;state.network.connected=false;state.network.playerId=players[2].id;state.network.roomCode='PREVIEW';
  state.players=players;state.mine=players[2];state.camera={x:16,y:17};state.notice='';state.noticeTimer=0;state.guidance=null;state.privateRule=null;
  const finalObjective=lantern
    ? {status:'active',phase:'LANTERN_ENTRY',variant:{id:'lantern_rite',title:'Lantern Rite'}}
    : {status:'active',phase:'ECHO_ACCORD',variant:{id:'echo_accord',title:'Echo Accord'},echoAccord:{mode:'LAST_SNAKE_STANDING',arena:{minX:2,maxX:46,minZ:2,maxZ:30},echoes:[{id:'orb-a',x:18,z:12,active:true,hue:0},{id:'orb-b',x:28,z:18,active:true,hue:2}]}};
  state.world={code:'PREVIEW',phase:'finale',players,entities:lantern?[{id:'lantern-entry-gate',type:'lantern-entry-gate',zone:'lantern-rite',x:16,z:18.5,readyCount:2}]:[],terrain:[],relics:[],world:{unlocked:[],privateUnlocks:[]},finalObjective,lanternRite:lantern?{phase:'ENTRY',task:'All four players must cross the glowing threshold together.',wave:0,waveCount:3,entry:{ready:{}}}:null,events:[]};
  if (lantern) state.mine.lanternRite={active:true,...state.world.lanternRite,core:{health:100,maxHealth:100},enemies:[],switches:{participants:{}},repair:{progress:0,goal:10}};
  return true;
}

export function applyFinalePortalPreview(state, requestedPreview) {
  if (requestedPreview !== 'finale-portal') return false;
  const roles=['Explorer','Collector','Guardian','Loner'],players=roles.map((archetype,index)=>{const x=[28,32,28,32][index],y=[15,15,19,19][index];return{id:`portal-${index}`,name:['Ari','Bea','Cy','Dee'][index],archetype,color:['#76d7c4','#f3c969','#83b9f5','#c999ed'][index],sprite:[1,2,3,5][index],facing:'down',moving:false,realm:'overworld',zone:'overworld',x,y,targetX:x,targetY:y,evolutions:[],completedEvolutions:[]};});
  state.joined=true;state.network.connected=true;state.network.playerId=players[0].id;state.network.roomCode='PREVIEW';state.players=players;state.mine=players[0];state.camera={x:30,y:17};state.notice='';state.noticeTimer=0;
  state.world={code:'PREVIEW',phase:'finale',players,entities:[{id:'finale-entrance',type:'finale-entrance',x:0,z:0,label:'Finale Portal',feature:'ancient-temple',action:'enter-final-temple'}],terrain:[],relics:[],world:{unlocked:['ancient-temple'],privateUnlocks:[]},finalObjective:{status:'entrance-revealed',variant:{id:'lantern_rite',title:'Lantern Rite'}},events:[]};
  return true;
}

export function applyEndingPreview(state, requestedPreview) {
  if(requestedPreview!=='finale-ending')return false;
  const roles=['Explorer','Collector','Guardian','Loner'];
  const players=roles.map((archetype,index)=>({id:`ending-${index}`,name:['Ari','Bea','Cy','Dee'][index],archetype,color:['#76d7c4','#f3c969','#83b9f5','#c999ed'][index],sprite:[1,2,3,5][index],realm:'echo-accord',zone:'overworld',x:8+index*8,y:8+index*3,targetX:8+index*8,targetY:8+index*3,evolutions:[],completedEvolutions:[]}));
  const playerRecaps=players.map((player,index)=>({playerId:player.id,name:player.name,archetype:player.archetype,travelled:[382,214,167,305][index],placesVisited:[12,8,7,10][index],relicsCollected:index===1?7:0,curiosCollected:index===1?5:0,objectivesCompleted:2,missionsCompleted:2,secondsTogether:[94,121,188,42][index],secondsAlone:[18,25,9,146][index],rescues:[1,0,5,0][index],riskEvents:[3,1,0,6][index]}));
  state.joined=true;state.network.connected=true;state.network.playerId=players[0].id;state.network.roomCode='PREVIEW';state.players=players;state.mine=players[0];state.camera={x:16,y:17};state.notice='';state.noticeTimer=0;
  state.world={code:'PREVIEW',phase:'complete',players,entities:[],terrain:[],relics:[],world:{unlocked:[],privateUnlocks:[]},finalObjective:{status:'complete',phase:'COMPLETE',completedAt:Date.now()-9000,variant:{id:'echo_accord',title:'Last Snake Standing'},reflection:{finale:{title:'Last Snake Standing',winnerId:players[3].id,winnerName:players[3].name},playerRecaps,worldEvolutions:[{title:'The Spirit Realm Awakened'},{title:'The Crystal Heart Was Restored'},{title:'The Guardian Sanctums Endured'},{title:'The Hidden Ruins Emerged'}],highlights:['The party uncovered a passage into the Black Hollow.','Five lost crystal fragments returned to the Crystal Heart.','Four callings entered the shared finale portal together.'],lines:[]}},events:[]};return true;
}
