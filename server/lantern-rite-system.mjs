const CORE = Object.freeze({ id:'lantern-core', type:'lantern-core', x:16, z:10, label:'Emergent Energy Core' });
const ENTRY_GATE = Object.freeze({ id:'lantern-entry-gate', type:'lantern-entry-gate', x:16, z:18.8, label:'Lantern Rite Threshold' });
const CORRIDORS = Object.freeze([
  { id:'west', x:2, z:10 },
  { id:'east', x:30, z:10 },
  { id:'north', x:16, z:2 },
  { id:'south', x:16, z:18 },
]);
const SWITCHES = Object.freeze([
  { id:'lantern-switch-explorer', type:'lantern-switch', x:13, z:7, role:'Explorer', label:'Explorer Switch' },
  { id:'lantern-switch-collector', type:'lantern-switch', x:19, z:7, role:'Collector', label:'Collector Switch' },
  { id:'lantern-switch-guardian', type:'lantern-switch', x:13, z:13, role:'Guardian', label:'Guardian Switch' },
  { id:'lantern-switch-loner', type:'lantern-switch', x:19, z:13, role:'Loner', label:'Loner Switch' },
]);
const ARENA_SPAWNS = Object.freeze([
  { x:14, z:15.6 }, { x:18, z:15.6 }, { x:14.8, z:13.8 }, { x:17.2, z:13.8 },
]);
const STAGING_SPAWNS = Object.freeze([
  { x:12.8, z:25.0 }, { x:15.0, z:25.7 }, { x:17.0, z:25.7 }, { x:19.2, z:25.0 },
]);
const ENEMY_TYPES = Object.freeze({
  swift: Object.freeze({ label:'Veil Runner', hp:2, speed:2.25, damage:1, sprite:2, attackMs:700 }),
  brute: Object.freeze({ label:'Stone Warden', hp:7, speed:0.82, damage:2, sprite:22, attackMs:1100 }),
  raider: Object.freeze({ label:'Lantern Raider', hp:4, speed:1.35, damage:1, sprite:0, attackMs:850 }),
});

function party(room){ return [...room.players.values()]; }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function distance(a,b){ return Math.hypot(a.x-b.x,a.z-b.z); }
function telemetry(player){
  const base=player.evolutionBaseline||{};
  return {
    movement:Math.max(0,player.movement-(base.movement||0)),
    near:Math.max(0,player.nearSeconds-(base.near||0)),
    alone:Math.max(0,player.aloneSeconds-(base.alone||0)),
    relics:Math.max(0,player.relicIds.size-(base.relics||0)),
    risk:Math.max(0,player.riskEvents||0),
    follows:Math.max(0,player.follows||0),
    interactions:Object.values(player.interactions||{}).reduce((sum,n)=>sum+Number(n||0),0),
  };
}
function makePlan(room){
  const byRole=Object.fromEntries(party(room).map((p)=>[p.archetype,telemetry(p)]));
  const explorer=byRole.Explorer||{}, collector=byRole.Collector||{}, guardian=byRole.Guardian||{}, loner=byRole.Loner||{};
  const pressure=(guardian.near||0)+(collector.interactions||0)+(explorer.movement||0)/8+(loner.risk||0)*5;
  const waveCount=pressure>45?4:3;
  const fastBias=clamp(Math.round(((explorer.movement||0)/70)+(loner.alone||0)/18),1,4);
  const bruteBias=clamp(Math.round(((guardian.near||0)/28)+(collector.relics||0)/2),1,3);
  const repairGoal=clamp(8+Math.round((guardian.near||0)/18),8,14);
  const coreMax=clamp(18+Math.round((guardian.near||0)/20),18,24);
  const playerMax=clamp(9+Math.round((guardian.near||0)/55),9,12);
  const guardianHeal=clamp(3+Math.round((guardian.near||0)/70),3,5);
  const barrierStrength=clamp(3+Math.round((guardian.near||0)/85),3,5);
  const order=[explorer.movement||0,collector.interactions||0,guardian.near||0,loner.alone||0]
    .map((score,index)=>({score,index})).sort((a,b)=>b.score-a.score).map((x)=>x.index);
  const waves=[];
  for(let wave=1;wave<=waveCount;wave++){
    const count=4+wave*2;
    const enemies=[];
    for(let i=0;i<count;i++){
      const corridor=order[(i+wave-1)%order.length];
      const type=i<fastBias?'swift':(i%Math.max(2,5-bruteBias)===0?'brute':'raider');
      enemies.push({ corridor, type });
    }
    waves.push(enemies);
  }
  return { waveCount, fastBias, bruteBias, repairGoal, coreMax, playerMax, guardianHeal, barrierStrength, corridorOrder:order, waves };
}

export function lanternRiteWalkable(x,z){
  if(x<1||x>31||z<1||z>27.5)return false;
  const center=Math.hypot(x-16,(z-10)*1.35)<=10.5;
  const horizontal=z>=8&&z<=12;
  const vertical=x>=13&&x<=19&&z<=19.4;
  // A broader forecourt outside the ritual threshold lets the party explore
  // the approach before committing to the arena.
  const forecourt=x>=10&&x<=22&&z>=19.4&&z<=27.5;
  const approach=x>=13&&x<=19&&z>=18.4&&z<=27.5;
  return center||horizontal||vertical||forecourt||approach;
}

export function createLanternRiteSystem(world){
  function state(room){ return room.finalObjective?.lanternRite || null; }
  function canEnter(room,player,x,z){
    if(!lanternRiteWalkable(x,z))return false;
    const rite=state(room);
    if(rite?.phase==='ENTRY'&&!rite.entry.ready[player.id]&&z<18.35)return false;
    if(player.lanternDownedUntil&&Date.now()<player.lanternDownedUntil)return false;
    return true;
  }
  function resetPlayerCombat(player,maxHealth,index){
    player.lanternMaxHealth=maxHealth; player.lanternHealth=maxHealth; player.lanternShield=0; player.lanternShieldExpiresAt=0;
    player.lanternDownedUntil=0; player.finaleLastAttackAt=0; player.lanternHealCooldownAt=0; player.lanternBarrierCooldownAt=0;
    player.x=STAGING_SPAWNS[index].x; player.z=STAGING_SPAWNS[index].z; player.inputX=0; player.inputZ=0;
  }
  function begin(room){
    const finale=room.finalObjective;if(!finale||finale.status!=='active')return {ok:false,error:'No active finale.'};
    if(finale.lanternRite?.active)return {ok:true,state:finale.lanternRite};
    const plan=makePlan(room);
    finale.phase='LANTERN_ENTRY';
    finale.variant ||= {id:'lantern_rite',title:'Lantern Rite',description:'Defend the central energy core together.'};
    finale.lanternRite={
      active:true, phase:'ENTRY', wave:1, waveCount:plan.waveCount, plan,
      core:{health:plan.coreMax,maxHealth:plan.coreMax}, enemies:[], enemySequence:0,
      repair:{progress:0,goal:plan.repairGoal}, switches:{windowMs:6500,startedAt:null,participants:{}},
      entry:{ready:{}},
      task:'Approach the glowing threshold and press E. The assault begins only when all four enter the arena.', startedAt:Date.now(), lastWaveAt:null,
    };
    party(room).forEach((player,index)=>{
      player.finaleReturnPosition={x:player.x,z:player.z,realm:player.realm||'overworld'};
      player.realm='lantern-rite'; resetPlayerCombat(player,plan.playerMax,index);
    });
    const message=`The Game Master chose the Lantern Rite. The party gathers outside the arena before ${plan.waveCount} adaptive waves begin.`;
    room.director={narration:message,source:'Game Master',at:Date.now(),finalePhase:'LANTERN_ENTRY',finaleVariant:'lantern_rite'};
    world.event(room,'lantern-rite-entry',message,{plan:{waveCount:plan.waveCount,repairGoal:plan.repairGoal,fastBias:plan.fastBias,bruteBias:plan.bruteBias,playerMax:plan.playerMax}});
    return {ok:true,state:finale.lanternRite};
  }
  function startDefense(room){
    const rite=state(room);if(!rite)return;
    party(room).forEach((player,index)=>{player.x=ARENA_SPAWNS[index].x;player.z=ARENA_SPAWNS[index].z;player.inputX=0;player.inputZ=0;});
    room.finalObjective.phase='LANTERN_DEFEND';
    spawnWave(room);
  }
  function spawnWave(room){
    const rite=state(room); if(!rite)return;
    const specs=rite.plan.waves[rite.wave-1]||[];
    rite.enemies=specs.map((spec,index)=>{
      const corridor=CORRIDORS[spec.corridor%CORRIDORS.length], def=ENEMY_TYPES[spec.type]||ENEMY_TYPES.raider;
      const jitter=(index%3-1)*0.65;
      const x=corridor.id==='north'||corridor.id==='south'?corridor.x+jitter:corridor.x;
      const z=corridor.id==='west'||corridor.id==='east'?corridor.z+jitter:corridor.z;
      return {id:`lantern-enemy-${rite.wave}-${++rite.enemySequence}`,type:'lantern-enemy',enemyType:spec.type,label:def.label,x,z,hp:def.hp,maxHp:def.hp,speed:def.speed,damage:def.damage,attackMs:def.attackMs,sprite:def.sprite,lastCoreHitAt:0,lastPlayerHitAt:{},defeated:false};
    });
    rite.phase='DEFEND'; rite.task=`Wave ${rite.wave}/${rite.waveCount}: defend the core. Press E near enemies to attack.`; rite.lastWaveAt=Date.now();
    room.finalObjective.phase='LANTERN_DEFEND';
    world.event(room,'lantern-wave',`Wave ${rite.wave} begins. ${rite.enemies.length} enemies pour through the corridors.`,{wave:rite.wave,count:rite.enemies.length});
  }
  function entities(room){
    const rite=state(room);if(!rite?.active)return [];
    const list=[];
    if(rite.phase==='ENTRY')list.push({...ENTRY_GATE,tileX:ENTRY_GATE.x,tileY:ENTRY_GATE.z,action:'lantern-enter',readyCount:Object.keys(rite.entry.ready).length});
    if(rite.phase!=='ENTRY')list.push({...CORE,tileX:CORE.x,tileY:CORE.z,action:rite.phase==='REPAIR'?'lantern-repair':null,health:rite.core.health,maxHealth:rite.core.maxHealth});
    if(rite.phase==='DEFEND') list.push(...rite.enemies.filter((e)=>!e.defeated).map((e)=>({...e,tileX:e.x,tileY:e.z,action:'lantern-attack'})));
    if(rite.phase==='SWITCHES') list.push(...SWITCHES.map((s)=>({...s,tileX:s.x,tileY:s.z,action:'lantern-switch',activeBy:Object.keys(rite.switches.participants).find((pid)=>room.players.get(pid)?.archetype===s.role)||null})));
    return list;
  }
  function target(room,id){return entities(room).find((e)=>e.id===id);}
  function guardianSupport(room,player,action,targetId){
    const rite=state(room);if(!rite?.active||player.realm!=='lantern-rite')return {ok:false,error:'The Lantern Rite is not active here.'};
    if(player.archetype!=='Guardian')return {ok:false,error:'Only the Guardian can use this support ability.'};
    if(rite.phase==='ENTRY')return {ok:false,error:'Guardian support awakens when the defense begins.'};
    const ally=room.players.get(targetId);if(!ally||ally.id===player.id||ally.realm!=='lantern-rite')return {ok:false,error:'Choose another party member.'};
    if(distance(player,ally)>5)return {ok:false,error:'Move closer to your ally.'};
    if(ally.lanternDownedUntil&&Date.now()<ally.lanternDownedUntil)return {ok:false,error:'That ally is reforming at the lantern.'};
    const stamp=Date.now();
    if(action==='lantern-guardian-heal'){
      if(stamp-(player.lanternHealCooldownAt||0)<1800)return {ok:false,error:'Healing light is still recharging.'};
      if(ally.lanternHealth>=ally.lanternMaxHealth)return {ok:false,error:`${ally.name} is already at full health.`};
      player.lanternHealCooldownAt=stamp;const before=ally.lanternHealth;ally.lanternHealth=Math.min(ally.lanternMaxHealth,ally.lanternHealth+rite.plan.guardianHeal);
      world.event(room,'lantern-guardian-heal',`${player.name} restores ${ally.name}.`,{playerId:player.id,targetId:ally.id,amount:ally.lanternHealth-before});
      return {ok:true,amount:ally.lanternHealth-before,targetId:ally.id};
    }
    if(action==='lantern-guardian-barrier'){
      if(stamp-(player.lanternBarrierCooldownAt||0)<4500)return {ok:false,error:'Protective barrier is still recharging.'};
      player.lanternBarrierCooldownAt=stamp;ally.lanternShield=Math.max(ally.lanternShield||0,rite.plan.barrierStrength);ally.lanternShieldExpiresAt=stamp+8500;
      world.event(room,'lantern-guardian-barrier',`${player.name} shields ${ally.name} with a protective barrier.`,{playerId:player.id,targetId:ally.id,shield:ally.lanternShield});
      return {ok:true,shield:ally.lanternShield,targetId:ally.id};
    }
    return {ok:false,error:'Unknown Guardian support action.'};
  }
  function interact(room,player,action,targetId){
    const rite=state(room);if(!rite?.active||player.realm!=='lantern-rite')return {ok:false,error:'The Lantern Rite is not active here.'};
    if(action==='lantern-guardian-heal'||action==='lantern-guardian-barrier')return guardianSupport(room,player,action,targetId);
    const entity=target(room,targetId);if(!entity)return {ok:false,error:'That finale target is not active.'};
    if(distance(player,entity)>2.6)return {ok:false,error:'Move closer to interact.'};
    if(action==='lantern-enter'&&entity.type==='lantern-entry-gate'){
      if(rite.entry.ready[player.id])return {ok:false,error:'You are already inside the arena.'};
      rite.entry.ready[player.id]=Date.now();
      const index=Math.max(0,party(room).findIndex((p)=>p.id===player.id));player.x=ARENA_SPAWNS[index].x;player.z=ARENA_SPAWNS[index].z;
      const ready=Object.keys(rite.entry.ready).length;rite.task=`Enter the Lantern Rite arena (${ready}/4 ready). The first wave starts when everyone crosses the threshold.`;
      if(ready===party(room).length)startDefense(room);
      return {ok:true,ready,total:party(room).length};
    }
    if(player.lanternDownedUntil&&Date.now()<player.lanternDownedUntil)return {ok:false,error:'Your lantern is reforming.'};
    if(action==='lantern-attack'&&entity.type==='lantern-enemy'){
      if(rite.phase!=='DEFEND')return {ok:false,error:'There are no enemies to strike right now.'};
      const enemy=rite.enemies.find((e)=>e.id===entity.id);if(!enemy||enemy.defeated)return {ok:false,error:'That enemy has already fallen.'};
      const stamp=Date.now();player.finaleLastAttackAt ||=0;if(stamp-player.finaleLastAttackAt<220)return {ok:false,error:'Your weapon needs a moment.'};player.finaleLastAttackAt=stamp;
      enemy.hp=Math.max(0,enemy.hp-1);player.interactions['lantern-attack']=(player.interactions['lantern-attack']||0)+1;
      if(enemy.hp===0){enemy.defeated=true;world.event(room,'lantern-enemy-defeated',`${player.name} defeated ${enemy.label}.`,{playerId:player.id,targetId:enemy.id});}
      checkWave(room);return {ok:true,hit:true,hp:enemy.hp,defeated:enemy.defeated};
    }
    if(action==='lantern-repair'&&entity.type==='lantern-core'){
      if(rite.phase!=='REPAIR')return {ok:false,error:'Repair the core only between waves.'};
      rite.repair.progress=Math.min(rite.repair.goal,rite.repair.progress+1);rite.core.health=Math.min(rite.core.maxHealth,rite.core.health+1);
      player.interactions['lantern-repair']=(player.interactions['lantern-repair']||0)+1;
      if(rite.repair.progress>=rite.repair.goal){rite.wave+=1;rite.repair.progress=0;if(rite.wave>rite.waveCount)beginSwitches(room);else spawnWave(room);}
      else rite.task=`Repair the core between waves (${rite.repair.progress}/${rite.repair.goal}). Stand near it and press E.`;
      return {ok:true,progress:rite.repair.progress,goal:rite.repair.goal,coreHealth:rite.core.health};
    }
    if(action==='lantern-switch'&&entity.type==='lantern-switch'){
      if(rite.phase!=='SWITCHES')return {ok:false,error:'The switches are dormant until the final wave is cleared.'};
      if(entity.role!==player.archetype)return {ok:false,error:`This switch answers the ${entity.role}. Your switch is ${player.archetype}.`};
      const stamp=Date.now(),sw=rite.switches;
      if(sw.startedAt&&stamp-sw.startedAt>sw.windowMs){sw.startedAt=null;sw.participants={};world.event(room,'lantern-switch-reset','The switches fall out of resonance. All four must activate them together.',{});}
      if(sw.participants[player.id])return {ok:false,error:'Your switch is already active.'};
      sw.startedAt ||= stamp;sw.participants[player.id]=stamp;const count=Object.keys(sw.participants).length;
      rite.task=`Activate all four switches together (${count}/4). Window: ${Math.ceil(sw.windowMs/1000)}s.`;
      if(count===4){rite.active=false;return world.completeFinale?.(room)||{ok:true,complete:true};}
      return {ok:true,participants:count,windowMs:sw.windowMs};
    }
    return {ok:false,error:'That action does not match this finale objective.'};
  }
  function checkWave(room){
    const rite=state(room);if(!rite||rite.phase!=='DEFEND'||rite.enemies.some((e)=>!e.defeated))return;
    if(rite.wave>=rite.waveCount)beginSwitches(room);
    else{rite.phase='REPAIR';room.finalObjective.phase='LANTERN_REPAIR';rite.repair.progress=0;rite.task=`Wave ${rite.wave} cleared. Repair the core (${rite.repair.progress}/${rite.repair.goal}) before the next wave.`;world.event(room,'lantern-repair-phase','The corridor lights dim. Repair the core before the next wave arrives.',{wave:rite.wave,goal:rite.repair.goal});}
  }
  function beginSwitches(room){
    const rite=state(room);rite.phase='SWITCHES';room.finalObjective.phase='LANTERN_SWITCHES';rite.enemies=[];rite.switches.startedAt=null;rite.switches.participants={};rite.task='Final step: find the switch labelled with your role and press E. All four must activate within the same 6.5-second window.';
    world.event(room,'lantern-switch-phase','The last wave breaks. Four role-marked switches ignite around the core. All four callings must answer together.',{});
  }
  function damagePlayer(room,rite,enemy,player,stamp){
    const key=player.id;enemy.lastPlayerHitAt[key]||=0;if(stamp-enemy.lastPlayerHitAt[key]<(enemy.attackMs||850))return false;enemy.lastPlayerHitAt[key]=stamp;
    let damage=enemy.damage;
    if(player.lanternShieldExpiresAt&&stamp>player.lanternShieldExpiresAt){player.lanternShield=0;player.lanternShieldExpiresAt=0;}
    if((player.lanternShield||0)>0){const absorbed=Math.min(player.lanternShield,damage);player.lanternShield-=absorbed;damage-=absorbed;}
    if(damage>0)player.lanternHealth=Math.max(0,(player.lanternHealth||0)-damage);
    world.event(room,'lantern-player-hit',`${enemy.label} strikes ${player.name}.`,{playerId:player.id,health:player.lanternHealth,maxHealth:player.lanternMaxHealth,shield:player.lanternShield});
    if(player.lanternHealth===0&&!player.lanternDownedUntil){player.lanternDownedUntil=stamp+4000;player.inputX=0;player.inputZ=0;world.event(room,'lantern-player-downed',`${player.name}'s lantern is extinguished for a moment.`,{playerId:player.id});}
    return true;
  }
  function tick(room,delta){
    const rite=state(room);if(!rite?.active)return;const stamp=Date.now();
    for(const [index,player] of party(room).entries()){
      if(player.lanternShieldExpiresAt&&stamp>player.lanternShieldExpiresAt){player.lanternShield=0;player.lanternShieldExpiresAt=0;}
      if(player.lanternDownedUntil&&stamp>=player.lanternDownedUntil){player.lanternDownedUntil=0;player.lanternHealth=Math.max(1,Math.ceil(player.lanternMaxHealth*.6));player.lanternShield=0;const spawn=ARENA_SPAWNS[index]||ARENA_SPAWNS[0];player.x=spawn.x;player.z=spawn.z;world.event(room,'lantern-player-revived',`${player.name}'s lantern reignites.`,{playerId:player.id,health:player.lanternHealth});}
    }
    if(rite.phase==='DEFEND'){
      const activeParty=party(room).filter((p)=>p.realm==='lantern-rite'&&!(p.lanternDownedUntil&&stamp<p.lanternDownedUntil));
      for(const enemy of rite.enemies){
        if(enemy.defeated)continue;
        const nearby=activeParty.map((p)=>({p,d:distance(enemy,p)})).filter((x)=>x.d<=4.5).sort((a,b)=>a.d-b.d)[0];
        const target=nearby?.p||CORE;const dx=target.x-enemy.x,dz=target.z-enemy.z,dist=Math.hypot(dx,dz);
        if(dist>1.15){const step=Math.min(dist,enemy.speed*delta);const nx=enemy.x+dx/dist*step,nz=enemy.z+dz/dist*step;if(lanternRiteWalkable(nx,nz)){enemy.x=nx;enemy.z=nz;}}
        else if(nearby){damagePlayer(room,rite,enemy,nearby.p,stamp);}
        else if(stamp-enemy.lastCoreHitAt>=800){enemy.lastCoreHitAt=stamp;rite.core.health=Math.max(0,rite.core.health-enemy.damage);world.event(room,'lantern-core-hit',`${enemy.label} strikes the energy core.`,{health:rite.core.health,maxHealth:rite.core.maxHealth});if(rite.core.health===0){rite.core.health=Math.ceil(rite.core.maxHealth*.55);rite.enemies.forEach((e)=>{e.defeated=true;});rite.phase='REPAIR';room.finalObjective.phase='LANTERN_REPAIR';rite.repair.progress=0;rite.task='The core destabilised. Repair it before the assault resumes.';world.event(room,'lantern-core-collapse','The core collapses into emergency light. The current wave is broken, but the party must repair it.',{});break;}}
      }
      checkWave(room);
    }
    if(rite.phase==='SWITCHES'&&rite.switches.startedAt&&stamp-rite.switches.startedAt>rite.switches.windowMs){rite.switches.startedAt=null;rite.switches.participants={};rite.task='The switches lost resonance. Try again: all four activate within 6.5 seconds.';}
  }
  return Object.freeze({begin,entities,interact,tick,canEnter});
}
