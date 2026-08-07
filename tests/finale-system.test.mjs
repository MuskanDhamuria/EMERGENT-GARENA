import assert from 'node:assert/strict';
import { ARCHETYPES, WORLD_EVOLUTIONS } from '../shared/game-content.js';
import { createFinaleSystem } from '../server/finale-system.mjs';

function fixture(createdAt=12345){
  const chosen=['hidden-cave-appears','crystal-mine-awakens','healing-shrine-awakens','spirit-portal-opens'].map((id)=>WORLD_EVOLUTIONS.find((item)=>item.id===id));
  const playerList=ARCHETYPES.map((archetype,index)=>({id:`p${index}`,name:['Mei','Yun','Mus','Nar'][index],archetype,x:0,z:0,movement:100+index*20,nearSeconds:40+index,aloneSeconds:20+index,relicIds:new Set(index===1?['r1','r2']:[]),evolutionBaseline:{movement:0,near:0,alone:0,relics:0},evolutions:[chosen[index].feature]}));
  const room={createdAt,archetypesAssignedAt:Date.now()-10_000,phase:'evolving',players:new Map(playerList.map((p)=>[p.id,p])),world:{unlocked:new Set(chosen.map((item)=>item.feature))},worldEvolutions:chosen.map((item,index)=>({id:item.id,archetype:item.archetype,title:item.title,feature:item.feature,at:index})),entities:chosen.map((item)=>({...item.entity})),events:[],finalObjective:null,finaleCompositionHistory:[]};
  return {room,playerList};
}
const world={event(room,type,message,extra={}){const item={type,message,...extra};room.events.push(item);return item;},playerTelemetry(room,player){return {postAssignment:{distanceTravelled:player.movement,relicsCollected:player.relicIds.size}};},resetRoomForRoster(room){room.phase='waiting-for-four';room.finalObjective=null;room.resetCount=(room.resetCount||0)+1;}};
const options={minimumMatchMs:100,preparationMs:0,ritualWindowMs:10_000,resetAfterMs:0};

// Valid, deterministic, evolution-only composition.
const first=fixture();const system=createFinaleSystem(world,options);const made=system.compose(first.room,'fallback');
assert.equal(made.ok,true);assert.equal(made.objective.roleSteps.length,4);assert.deepEqual(new Set(made.objective.roleSteps.map((s)=>s.role)),new Set(ARCHETYPES));
assert.equal(made.objective.roleSteps.every((step)=>first.room.worldEvolutions.some((e)=>e.id===step.evolutionId)),true);
const same=fixture();const sameMade=createFinaleSystem(world,options).compose(same.room,'fallback');assert.equal(sameMade.objective.compositionKey,made.objective.compositionKey);

// Inactive landmarks and duplicate finale creation are rejected.
const invalid=fixture();const invalidResult=system.compose(invalid.room,'AI',{destinationEvolutionId:'forgotten-ruins-emerge'});assert.equal(invalidResult.ok,false);
assert.equal(system.compose(first.room,'again').ok,false);

// Server-owned phase order, role validation and duplicate-step protection.
system.advance(first.room);assert.equal(first.room.finalObjective.phase,'TRAVEL');
const destination=first.room.entities.find((e)=>e.id==='finale-destination');first.playerList[0].x=destination.x;first.playerList[0].z=destination.z;
assert.equal(system.interact(first.room,first.playerList[0],'finale-role-step',destination).ok,false);
assert.equal(system.interact(first.room,first.playerList[0],'finale-arrive',destination).ok,true);
for(const role of ARCHETYPES){const step=first.room.finalObjective.roleSteps.find((s)=>s.role===role);const player=first.playerList.find((p)=>p.archetype===role);const target=first.room.entities.find((e)=>e.id===step.targetId);player.x=target.x;player.z=target.z;
  if(role==='Explorer')assert.equal(system.interact(first.room,first.playerList[1],'finale-role-step',target).ok,false);
  assert.equal(system.interact(first.room,player,'finale-role-step',target).ok,true);
  assert.equal(system.interact(first.room,player,'finale-role-step',target).ok,false);
}
assert.equal(first.room.finalObjective.phase,'GROUP_RITUAL');
for(const player of first.playerList){const circle=first.room.entities.find((e)=>e.id===`finale-circle-${player.archetype.toLowerCase()}`);player.x=circle.x;player.z=circle.z;const result=system.interact(first.room,player,'finale-ritual',circle);if(player!==first.playerList.at(-1))assert.equal(result.complete,undefined);else assert.equal(result.complete,true);}
assert.equal(first.room.finalObjective.phase,'COMPLETE');assert.equal(first.room.finalObjective.complication.active,false);assert.equal(first.room.finalObjective.reflection.lines.at(-1),'So I created this world.');
assert.equal(system.advance(first.room),true);assert.equal(first.room.phase,'waiting-for-four');assert.equal(first.room.finalObjective,null);assert.equal(first.room.resetCount,1);
console.log('Dynamic cooperative finale tests passed.');
