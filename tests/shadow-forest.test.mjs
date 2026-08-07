import assert from 'node:assert/strict';
import { createShadowForestSystem } from '../server/shadow-forest-system.mjs';

const events=[];
const world={event(_room,type,message,data){events.push({type,message,data});}};
const system=createShadowForestSystem(world);
const room={world:{unlocked:new Set(['shadow-forest'])}};
const player={id:'loner',archetype:'Loner',realm:'overworld',x:-20,z:5,inputX:0,inputZ:0,interactions:{}};

assert.equal(system.enter(room,{...player,archetype:'Explorer'}).ok,false,'wrong roles cannot enter');
assert.equal(system.enter({world:{unlocked:new Set()}},player).ok,false,'inactive landmark cannot be used');
assert.equal(system.enter(room,player).ok,true,'the Loner enters an awakened forest');
assert.equal(player.realm,'shadow-forest');
assert.equal(player.shadowForest.active,true);

player.inputZ=-1;
player.shadowForest.onGround=true;
system.tick(room,player,.016);
assert.ok(player.shadowForest.vy<0,'up input starts a jump');

player.x=7.6;player.z=10.15;player.inputZ=0;player.shadowForest.vy=0;
system.tick(room,player,.016);
assert.equal(player.shadowForest.trapHits,1,'touching a spike resets the crossing');
assert.equal(player.x,1.5);

player.x=3.5;player.z=11.15;player.shadowForest.vy=0;
system.tick(room,player,.016);
assert.ok(player.shadowForest.vy<0,'the trampoline launches the player');

player.x=2;player.z=16;player.inputZ=0;
system.tick(room,player,.016);
assert.equal(player.shadowForest.falls,1,'falling resets the crossing');
assert.equal(player.x,1.5);

player.x=23.5;player.z=5;player.shadowForest.vy=0;
system.tick(room,player,.016);
assert.equal(player.realm,'shadow-forest','reaching the gate alone does not finish the crossing');
assert.equal(system.exit(room,player).ok,true,'pressing interact beside the gate completes the crossing');
assert.equal(player.realm,'overworld','the far gate returns the Loner');
assert.equal(player.x,-20);
assert.equal(player.z,5);
assert.equal(player.shadowForest.active,false);
assert.equal(player.interactions['shadow-forest-crossing'],1);
assert.ok(events.some((event)=>event.type==='shadow-forest-entered'));
assert.ok(events.some((event)=>event.type==='shadow-forest-complete'));

console.log('Shadow Forest tests passed.');
