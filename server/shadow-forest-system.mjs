export const SHADOW_PLATFORMS = Object.freeze([
  {x:0,y:12,w:5,h:1},{x:6,y:11,w:4,h:1},{x:11,y:12,w:3,h:1},{x:15,y:10,w:3,h:1},{x:19,y:12,w:6,h:1},
  {x:3,y:8,w:4,h:1},{x:8,y:7,w:3,h:1},{x:12,y:5,w:4,h:1},{x:17,y:7,w:3,h:1},{x:21,y:5,w:3,h:1},
]);
export const SHADOW_TRAPS = Object.freeze([{x:7.35,y:11,w:1.1},{x:19.65,y:12,w:1.1}]);
export const SHADOW_FIRE = Object.freeze([{x:16.1,y:10,w:1},{x:21.1,y:12,w:.9}]);
export const SHADOW_TRAMPOLINE = Object.freeze({x:3.15,y:12,w:1});
export const SHADOW_FAN = Object.freeze({x:12.6,y:12,w:1.1,top:5.2});
const START={x:1.5,z:11};

export function createShadowForestSystem(world){
  function enter(room,player){
    if(player.archetype!=='Loner')return {ok:false,error:'Only the Loner can follow a path made from shadow.'};
    if(!room.world.unlocked.has('shadow-forest'))return {ok:false,error:'The Shadow Forest has not awakened.'};
    if(player.realm!=='overworld')return {ok:false,error:'Return from the current hidden realm first.'};
    player.shadowForest={active:true,returnPosition:{x:player.x,z:player.z},vx:0,vy:0,onGround:false,jumpHeld:false,falls:0,trapHits:0,sawTime:0,enteredAt:Date.now()};
    player.realm='shadow-forest';player.x=START.x;player.z=START.z;player.inputX=0;player.inputZ=0;
    world.event(room,'shadow-forest-entered','The forest turns sideways beneath the Loner’s feet. A forgotten trophy waits beyond the broken canopy.',{privateTo:player.id});return {ok:true,shadowForest:player.shadowForest};
  }
  function land(previousY,nextY,x,vy){
    if(vy<0)return null;const previousBottom=previousY+.85,nextBottom=nextY+.85;
    return SHADOW_PLATFORMS.filter((platform)=>x+.28>platform.x&&x-.28<platform.x+platform.w&&previousBottom<=platform.y+.08&&nextBottom>=platform.y).sort((a,b)=>a.y-b.y)[0]||null;
  }
  function complete(room,player){const returned=player.shadowForest.returnPosition;player.realm='overworld';player.x=returned.x;player.z=returned.z;player.inputX=0;player.inputZ=0;player.shadowForest={...player.shadowForest,active:false,completedAt:Date.now()};player.interactions['shadow-forest-crossing']=(player.interactions['shadow-forest-crossing']||0)+1;player.completedEvolutions?.add('shadow-forest-awakens');world.event(room,'shadow-forest-complete','The Loner claims the forgotten trophy. The forest settles back into an ordinary horizon.',{playerId:player.id});}
  function exit(room,player){if(player.realm!=='shadow-forest'||!player.shadowForest?.active)return {ok:false,error:'You are not inside the Shadow Forest.'};if(player.x<22.4||player.z>=6.3)return {ok:false,error:'Stand beside the trophy before pressing E.'};complete(room,player);return {ok:true};}
  function tick(room,player,delta){
    const state=player.shadowForest;if(!state?.active)return;
    state.sawTime+=delta;
    state.vx=player.inputX*5.2;const wantsJump=player.inputZ<-.25;if(wantsJump&&!state.jumpHeld&&state.onGround){state.vy=-15.5;state.onGround=false;}state.jumpHeld=wantsJump;
    state.vy=Math.min(15,state.vy+28*delta);const previousY=player.z;let nextX=Math.max(.35,Math.min(24.4,player.x+state.vx*delta)),nextY=player.z+state.vy*delta;
    const platform=land(previousY,nextY,nextX,state.vy);if(platform){nextY=platform.y-.85;state.vy=0;state.onGround=true;}else state.onGround=false;
    player.x=nextX;player.z=nextY;
    const bottom=player.z+.85,inZone=(item)=>player.x+.25>item.x&&player.x-.25<item.x+item.w&&bottom>item.y-.55&&bottom<item.y+.2;
    if(inZone(SHADOW_TRAMPOLINE)){state.vy=-13;state.onGround=false;}
    if(player.x+.25>SHADOW_FAN.x&&player.x-.25<SHADOW_FAN.x+SHADOW_FAN.w&&player.z>SHADOW_FAN.top&&player.z<SHADOW_FAN.y){state.vy=Math.max(-8,state.vy-35*delta);}
    const sawX=8.15+(Math.sin(state.sawTime*2.4)+1)*1.05,sawHit=Math.hypot(player.x-sawX,player.z-5.8)<.72;
    const trap=SHADOW_TRAPS.find(inZone),fire=SHADOW_FIRE.find(inZone);if(trap||fire||sawHit){player.x=START.x;player.z=START.z;state.vx=0;state.vy=0;state.trapHits+=1;world.event(room,'shadow-forest-trap',fire?'The shadow-fire casts the Loner back to the first branch.':sawHit?'The wandering saw catches the Loner and the forest rewinds.':'The thorns cast the Loner back to the first branch.',{privateTo:player.id,trapHits:state.trapHits});return;}
    if(player.z>15){player.x=START.x;player.z=START.z;state.vx=0;state.vy=0;state.falls+=1;world.event(room,'shadow-forest-fall','The shadows catch the Loner and return them to the first branch.',{privateTo:player.id,falls:state.falls});}
  }
  return Object.freeze({enter,exit,tick});
}
