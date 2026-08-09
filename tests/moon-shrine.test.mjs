import assert from 'node:assert/strict';
import {createMoonShrineSystem,MOON_PATH,MOON_ALTAR} from '../server/moon-shrine-system.mjs';
const events=[],world={event(_room,type,message,data){events.push({type,message,data});}},system=createMoonShrineSystem(world),room={world:{unlocked:new Set(['moon-shrine'])}},player={id:'loner',archetype:'Loner',realm:'overworld',x:-9,z:12,inputX:0,inputZ:0,interactions:{}};
assert.equal(system.enter(room,{...player,archetype:'Guardian'}).ok,false);assert.equal(system.enter(room,player).ok,true);
for(let index=1;index<MOON_PATH.length;index++){const point=MOON_PATH[index];player.x=point.x;player.z=point.z;system.tick(room,player,.001);}
assert.equal(player.moonShrine.lineFailed,false);assert.equal(player.moonShrine.pathStep,MOON_PATH.length-1);player.x=MOON_ALTAR.x;player.z=MOON_ALTAR.z;assert.equal(system.interact(room,player).kind,'complete');assert.equal(player.realm,'overworld');assert.equal(player.completedEvolutions.has('moon-shrine-visible'),true);
const failed={...player,realm:'overworld',x:-9,z:12,interactions:{}};system.enter(room,failed);failed.x=10;failed.z=4;system.tick(room,failed,.001);assert.equal(failed.moonShrine.pathStep,0);assert.equal(failed.x,MOON_PATH[0].x);assert.equal(failed.z,MOON_PATH[0].z);
console.log('Moon Shrine tests passed.');
