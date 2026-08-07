const SIGILS = Object.freeze([
  { id:'dungeon-sigil-1', type:'dungeon-sigil', x:4, z:4, label:'Whisper Seal' },
  { id:'dungeon-sigil-2', type:'dungeon-sigil', x:15, z:4, label:'Memory Seal' },
  { id:'dungeon-sigil-3', type:'dungeon-sigil', x:15, z:12, label:'Shadow Seal' },
]);
const ALTAR = Object.freeze({ id:'dungeon-altar', type:'dungeon-altar', x:10, z:7, label:'Veil Altar' });
const EXIT = Object.freeze({ id:'dungeon-exit', type:'dungeon-exit', x:2, z:13, label:'Return Portal' });
const ENEMIES = Object.freeze([
  { id:'dungeon-warden-1', type:'dungeon-enemy', x:5, z:5, label:'Bone Warden', sprite:0 },
  { id:'dungeon-warden-2', type:'dungeon-enemy', x:14, z:5, label:'Veil Reaver', sprite:2 },
  { id:'dungeon-warden-3', type:'dungeon-enemy', x:12, z:12, label:'Blue Revenant', sprite:22 },
]);

export function dungeonWalkable(x,z){
  const tx=Math.round(x),tz=Math.round(z);if(tx<1||tx>18||tz<1||tz>14)return false;
  if(tx===9&&tz>=2&&tz<=6&&tz!==4)return false;
  if(tz===8&&tx>=3&&tx<=16&&![7,10,14].includes(tx))return false;
  return true;
}

export function createDungeonSystem(world){
  function enter(room,player){
    if(player.archetype!=='Loner')return {ok:false,error:'Only the Loner can cross this threshold.'};
    if(player.dungeon?.active)return {ok:false,error:'You are already beyond the veil.'};
    player.dungeon={active:true,phase:'DEFEAT_WARDENS',returnPosition:{x:player.x,z:player.z},collected:[],enemies:ENEMIES.map((item)=>({id:item.id,x:item.x,z:item.z,hp:3,defeated:false,lastAttackAt:0})),defeatedCount:0,health:5,maxHealth:5,respawns:0,invulnerableUntil:0,altarAwake:false,enteredAt:Date.now(),lastAttackAt:0};
    player.realm='dungeon';player.x=2;player.z=12;player.inputX=0;player.inputZ=0;
    world.event(room,'dungeon-entered','The portal closes behind the Loner. Three wardens stir between the living and the seals.',{privateTo:player.id,playerId:player.id});
    return {ok:true,dungeon:player.dungeon};
  }
  function entities(player){
    if(!player.dungeon?.active)return [];
    const collected=new Set(player.dungeon.collected);
    return [
      ...ENEMIES.map((item)=>({...item,...player.dungeon.enemies.find((enemy)=>enemy.id===item.id),tileX:item.x,tileY:item.z,action:'dungeon-attack'})).filter((item)=>!item.defeated),
      ...SIGILS.filter((item)=>!collected.has(item.id)).map((item)=>({...item,tileX:item.x,tileY:item.z,action:'dungeon-collect'})),
      {...ALTAR,tileX:ALTAR.x,tileY:ALTAR.z,action:'dungeon-altar',active:player.dungeon.altarAwake},
      {...EXIT,tileX:EXIT.x,tileY:EXIT.z,action:'dungeon-exit',active:player.dungeon.phase==='ESCAPE'},
    ];
  }
  function target(player,id){return entities(player).find((item)=>item.id===id);}
  function interact(room,player,action,targetId){
    if(!player.dungeon?.active)return {ok:false,error:'You are not inside the spirit dungeon.'};
    const entity=target(player,targetId);if(!entity)return {ok:false,error:'That dungeon object is no longer present.'};
    if(Math.hypot(player.x-entity.x,player.z-entity.z)>2.25)return {ok:false,error:'Move closer within the dungeon.'};
    if(action==='dungeon-attack'&&entity.type==='dungeon-enemy'){
      const stamp=Date.now();if(stamp-player.dungeon.lastAttackAt<250)return {ok:false,error:'Wait for your spirit blade to reform.'};player.dungeon.lastAttackAt=stamp;
      const enemy=player.dungeon.enemies.find((item)=>item.id===entity.id);if(!enemy||enemy.defeated)return {ok:false,error:'That warden has already fallen.'};
      enemy.hp=Math.max(0,enemy.hp-1);player.interactions['dungeon-attack']=(player.interactions['dungeon-attack']||0)+1;
      if(enemy.hp===0){enemy.defeated=true;player.dungeon.defeatedCount+=1;world.event(room,'dungeon-combat',`${entity.label} dissolves into quiet ash.`,{privateTo:player.id,targetId:entity.id});if(player.dungeon.defeatedCount===3){player.dungeon.phase='FIND_SIGILS';world.event(room,'dungeon-mission','The wardens are gone. Three forgotten seals begin to shine.',{privateTo:player.id});}}
      return {ok:true,hit:true,hp:enemy.hp,defeated:enemy.defeated,remaining:3-player.dungeon.defeatedCount};
    }
    if(action==='dungeon-collect'&&entity.type==='dungeon-sigil'){
      if(player.dungeon.defeatedCount<3)return {ok:false,error:'The wardens bind the seals. Defeat all three first.'};
      player.dungeon.collected.push(entity.id);player.interactions['dungeon-sigil']=(player.interactions['dungeon-sigil']||0)+1;
      if(player.dungeon.collected.length===3){player.dungeon.phase='AWAKEN_ALTAR';world.event(room,'dungeon-mission','The three seals agree. Carry their memory to the altar.',{privateTo:player.id});}
      else world.event(room,'dungeon-mission',`${entity.label} joins the Loner. ${3-player.dungeon.collected.length} seals remain.`,{privateTo:player.id});
      return {ok:true,phase:player.dungeon.phase,collected:player.dungeon.collected.length};
    }
    if(action==='dungeon-altar'&&entity.type==='dungeon-altar'){
      if(player.dungeon.defeatedCount<3||player.dungeon.collected.length<3)return {ok:false,error:'The altar requires three fallen wardens and three recovered seals.'};
      if(player.dungeon.altarAwake)return {ok:false,error:'The altar is already awake.'};
      player.dungeon.altarAwake=true;player.dungeon.phase='ESCAPE';player.interactions['dungeon-altar']=(player.interactions['dungeon-altar']||0)+1;
      world.event(room,'dungeon-mission','The Veil Altar remembers its name. The return portal burns blue once more.',{privateTo:player.id});return {ok:true,phase:'ESCAPE'};
    }
    if(action==='dungeon-exit'&&entity.type==='dungeon-exit'){
      if(player.dungeon.phase!=='ESCAPE')return {ok:false,error:'The return portal has no path to follow yet.'};
      const returned=player.dungeon.returnPosition;player.realm='overworld';player.x=returned.x;player.z=returned.z;player.inputX=0;player.inputZ=0;
      player.dungeon={...player.dungeon,active:false,phase:'COMPLETE',completedAt:Date.now()};player.dungeonCompletions=(player.dungeonCompletions||0)+1;
      world.event(room,'dungeon-complete','The Loner returns carrying a silence that now knows the way home.',{playerId:player.id});return {ok:true,escaped:true};
    }
    return {ok:false,error:'That action does not answer this dungeon object.'};
  }
  function tick(room,player,delta){
    const mission=player.dungeon;if(!mission?.active)return;
    const stamp=Date.now();
    for(const enemy of mission.enemies){
      if(enemy.defeated)continue;
      const dx=player.x-enemy.x,dz=player.z-enemy.z,distance=Math.hypot(dx,dz);
      if(distance>1.15){
        const step=Math.min(distance,1.35*delta),nx=enemy.x+(dx/distance)*step,nz=enemy.z+(dz/distance)*step;
        if(dungeonWalkable(nx,enemy.z))enemy.x=nx;if(dungeonWalkable(enemy.x,nz))enemy.z=nz;
      }else if(stamp-enemy.lastAttackAt>=900&&stamp>=mission.invulnerableUntil){
        enemy.lastAttackAt=stamp;mission.health=Math.max(0,mission.health-1);mission.invulnerableUntil=stamp+450;
        world.event(room,'dungeon-damage',`${ENEMIES.find((item)=>item.id===enemy.id)?.label||'A warden'} strikes through the veil.`,{privateTo:player.id,health:mission.health});
        if(mission.health===0){
          mission.health=mission.maxHealth;mission.respawns+=1;mission.invulnerableUntil=stamp+1500;player.x=2;player.z=12;player.inputX=0;player.inputZ=0;
          world.event(room,'dungeon-respawn','The dungeon casts you back to its entrance, but the seals remember your progress.',{privateTo:player.id,respawns:mission.respawns});
          break;
        }
      }
    }
  }
  return Object.freeze({enter,entities,interact,tick,canEnter:dungeonWalkable});
}
