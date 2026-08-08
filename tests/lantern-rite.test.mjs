import assert from 'node:assert/strict';
import { createLanternRiteSystem } from '../server/lantern-rite-system.mjs';

const roles=['Explorer','Collector','Guardian','Loner'];
const players=roles.map((archetype,index)=>({
  id:`p${index}`,name:archetype,archetype,realm:'overworld',x:index,z:0,inputX:0,inputZ:0,
  movement:120+index*20,nearSeconds:60+index*10,aloneSeconds:10+index,riskEvents:index,follows:index+1,rescues:index===2?2:0,
  relicIds:new Set(index===1?['a','b']:[]),interactions:{explore:index+2},evolutionBaseline:{movement:0,near:0,alone:0,relics:0},
}));
const room={players:new Map(players.map((p)=>[p.id,p])),finalObjective:{status:'active',phase:'PREPARING',variant:{id:'lantern_rite'}},events:[]};
let completed=false;
const world={
  event(room,type,message,extra={}){room.events.push({type,message,...extra});return room.events.at(-1);},
  completeFinale(room){completed=true;room.finalObjective.status='complete';room.finalObjective.phase='COMPLETE';return {ok:true,complete:true};},
};
const system=createLanternRiteSystem(world);
const started=system.begin(room);assert.equal(started.ok,true);assert.equal(room.finalObjective.lanternRite.phase,'ENTRY');
assert.equal(players.every((p)=>p.realm==='lantern-rite'),true);
assert.equal(system.entities(room).some((e)=>e.type==='lantern-entry-gate'),true);

// All four deliberately cross the threshold before combat begins.
for(const p of players){const gate=system.entities(room).find((e)=>e.type==='lantern-entry-gate');p.x=gate.x;p.z=gate.z;system.interact(room,p,'lantern-enter',gate.id);}
assert.equal(room.finalObjective.lanternRite.phase,'DEFEND');
assert.equal(system.entities(room).some((e)=>e.type==='lantern-core'),true);
assert.equal(system.entities(room).some((e)=>e.type==='lantern-enemy'),true);

// Guardian can heal and shield another player.
const guardian=players.find((p)=>p.archetype==='Guardian'), ally=players[0];guardian.x=ally.x;guardian.z=ally.z;ally.lanternHealth=Math.max(1,ally.lanternMaxHealth-3);
guardian.lanternHealCooldownAt=0;const healed=system.interact(room,guardian,'lantern-guardian-heal',ally.id);assert.equal(healed.ok,true);assert.ok(ally.lanternHealth>ally.lanternMaxHealth-3);
guardian.lanternBarrierCooldownAt=0;const shielded=system.interact(room,guardian,'lantern-guardian-barrier',ally.id);assert.equal(shielded.ok,true);assert.ok(ally.lanternShield>0);

// Defeat every enemy in wave 1 using a nearby player, then repair through the intermission.
while(room.finalObjective.lanternRite.phase==='DEFEND'){
  const enemy=system.entities(room).find((e)=>e.type==='lantern-enemy');if(!enemy)break;
  const p=players[0];p.x=enemy.x;p.z=enemy.z;p.finaleLastAttackAt=0;
  while(!room.finalObjective.lanternRite.enemies.find((x)=>x.id===enemy.id).defeated){p.finaleLastAttackAt=0;system.interact(room,p,'lantern-attack',enemy.id);}
}
assert.equal(room.finalObjective.lanternRite.phase,'REPAIR');
const core=system.entities(room).find((e)=>e.type==='lantern-core');players[0].x=core.x;players[0].z=core.z;
while(room.finalObjective.lanternRite.phase==='REPAIR') system.interact(room,players[0],'lantern-repair','lantern-core');
assert.equal(room.finalObjective.lanternRite.wave,2);

// Skip remaining combat mechanically and enter synchronized switch phase.
const rite=room.finalObjective.lanternRite;rite.wave=rite.waveCount;rite.enemies.forEach((e)=>e.defeated=true);system.tick(room,0.01);
assert.equal(rite.phase,'SWITCHES');
for(const p of players){const sw=system.entities(room).find((e)=>e.role===p.archetype);p.x=sw.x;p.z=sw.z;const result=system.interact(room,p,'lantern-switch',sw.id);if(p===players.at(-1))assert.equal(result.complete,true);}
assert.equal(completed,true);
console.log('Lantern Rite finale tests passed.');
