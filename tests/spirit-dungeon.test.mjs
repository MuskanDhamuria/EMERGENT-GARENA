import assert from 'node:assert/strict';
import { createDungeonSystem, dungeonWalkable } from '../server/dungeon-system.mjs';

const events=[];const world={event(room,type,message,options={}){events.push({type,message,...options});}};const dungeon=createDungeonSystem(world);const room={};
const loner={id:'loner',name:'Nar',archetype:'Loner',x:-3,z:10,realm:'overworld',inputX:0,inputZ:0,interactions:{},dungeon:null};
assert.equal(dungeon.enter(room,{...loner,archetype:'Explorer'}).ok,false);
assert.equal(dungeon.enter(room,loner).ok,true);assert.equal(loner.realm,'dungeon');assert.equal(loner.dungeon.phase,'DEFEAT_WARDENS');
const attacker=loner.dungeon.enemies[0];attacker.x=loner.x;attacker.z=loner.z;attacker.lastAttackAt=0;loner.dungeon.invulnerableUntil=0;dungeon.tick(room,loner,0.1);assert.equal(loner.dungeon.health,4);
let renderedAttacker=dungeon.entities(loner).find((item)=>item.id===attacker.id);assert.equal(renderedAttacker.tileX,attacker.x);assert.equal(renderedAttacker.tileY,attacker.z);
for(let hit=0;hit<4;hit++){loner.dungeon.invulnerableUntil=0;attacker.lastAttackAt=0;dungeon.tick(room,loner,0.1);}assert.equal(loner.dungeon.health,5);assert.equal(loner.dungeon.respawns,1);assert.deepEqual({x:loner.x,z:loner.z},{x:2,z:12});
assert.equal(dungeonWalkable(0,5),false);assert.equal(dungeonWalkable(9,3),false);assert.equal(dungeonWalkable(9,4),true);
let altar=dungeon.entities(loner).find((item)=>item.id==='dungeon-altar');loner.x=altar.x;loner.z=altar.z;assert.equal(dungeon.interact(room,loner,'dungeon-altar',altar.id).ok,false);
for(const id of ['dungeon-warden-1','dungeon-warden-2','dungeon-warden-3']){for(let hit=0;hit<3;hit++){const enemy=dungeon.entities(loner).find((item)=>item.id===id);loner.x=enemy.x;loner.z=enemy.z;loner.dungeon.lastAttackAt=0;assert.equal(dungeon.interact(room,loner,'dungeon-attack',id).ok,true);}}
assert.equal(loner.dungeon.defeatedCount,3);assert.equal(loner.dungeon.phase,'FIND_SIGILS');assert.equal(dungeon.entities(loner).some((item)=>item.type==='dungeon-enemy'),false);
for(const id of ['dungeon-sigil-1','dungeon-sigil-2','dungeon-sigil-3']){const seal=dungeon.entities(loner).find((item)=>item.id===id);loner.x=seal.x;loner.z=seal.z;assert.equal(dungeon.interact(room,loner,'dungeon-collect',id).ok,true);}
assert.equal(loner.dungeon.phase,'AWAKEN_ALTAR');assert.equal(dungeon.interact(room,loner,'dungeon-collect','dungeon-sigil-1').ok,false);
altar=dungeon.entities(loner).find((item)=>item.id==='dungeon-altar');loner.x=altar.x;loner.z=altar.z;assert.equal(dungeon.interact(room,loner,'dungeon-altar',altar.id).ok,true);assert.equal(loner.dungeon.phase,'ESCAPE');
const exit=dungeon.entities(loner).find((item)=>item.id==='dungeon-exit');loner.x=exit.x;loner.z=exit.z;assert.equal(dungeon.interact(room,loner,'dungeon-exit',exit.id).ok,true);assert.equal(loner.realm,'overworld');assert.deepEqual({x:loner.x,z:loner.z},{x:-3,z:10});assert.equal(loner.dungeon.phase,'COMPLETE');assert.equal(loner.dungeonCompletions,1);
assert.equal(events.some((item)=>item.type==='dungeon-complete'),true);
console.log('Spirit dungeon mission tests passed.');
