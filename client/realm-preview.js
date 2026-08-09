const REALMS = new Set(['spirit-realm', 'shadow-forest', 'moon-shrine', 'ghost-village']);

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
  state.camera = { x: player.x, y: player.y };
  state.world = { code:'PREVIEW', phase:'evolving', players:[player], entities:realm==='dungeon'?dungeonEntities():[], terrain:[], relics:[], world:{unlocked:[requestedRealm],privateUnlocks:[requestedRealm]}, events:[] };
  state.notice = ''; state.noticeTimer = 0; state.guidance = null; state.privateRule = null;
  return true;
}
