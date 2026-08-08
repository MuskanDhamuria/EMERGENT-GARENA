import { ARCHETYPES, ROLE_ABILITIES, WORLD_EVOLUTIONS } from '../shared/game-content.js';

export const FINALE_PHASES = Object.freeze(['PREPARING','TRAVEL','EXPLORER_STEP','COLLECTOR_STEP','GUARDIAN_STEP','LONER_STEP','GROUP_RITUAL','LANTERN_ENTRY','LANTERN_DEFEND','LANTERN_REPAIR','LANTERN_SWITCHES','COMPLETE']);
export const FINALE_COMPLICATIONS = Object.freeze([
  { id:'spreading-fog', title:'Spreading Fog', narration:'Mist erases the road behind you; remain close enough to carry one another’s bearings.' },
  { id:'collapsing-bridges', title:'Collapsing Bridges', narration:'The old crossings fail in sequence; each calling must hold the way for the next.' },
  { id:'moving-relic', title:'Moving Relic', narration:'The required relic answers different hands in turn and will not remain where one wanderer leaves it.' },
  { id:'unstable-portal', title:'Unstable Portal', narration:'The passage flickers between worlds; actions on either side must answer within moments.' },
  { id:'separated-clues', title:'Separated Clues', narration:'No one can read the whole instruction. Each calling carries one necessary fragment.' },
  { id:'timed-ritual', title:'Timed Ritual', narration:'The awakened stones hold their pattern only briefly; every response must arrive together.' },
  { id:'shifting-pathways', title:'Shifting Pathways', narration:'Paths rearrange whenever one traveler advances, forcing the others to guide the next step.' },
  { id:'spirit-interference', title:'Spirit Interference', narration:'Echoes imitate the living; only four distinct choices made together can quiet them.' },
]);

const ROLE_PHASE = { Explorer:'EXPLORER_STEP', Collector:'COLLECTOR_STEP', Guardian:'GUARDIAN_STEP', Loner:'LONER_STEP' };
const NEXT_PHASE = { EXPLORER_STEP:'COLLECTOR_STEP', COLLECTOR_STEP:'GUARDIAN_STEP', GUARDIAN_STEP:'LONER_STEP', LONER_STEP:'GROUP_RITUAL' };
const ROLE_NARRATION = {
  Explorer: (title) => `The path you uncovered at ${title} now reveals what the world concealed.`,
  Collector: (title) => `What emerged at ${title} begins to resonate, waiting for the one who gave forgotten things meaning.`,
  Guardian: (title) => `${title} answers the one who remained when the road became dangerous.`,
  Loner: (title) => `The unseen road through ${title} opens only to the one who learned to walk beyond sight.`,
};

function hash(text){ let value=2166136261; for(const char of String(text)){value^=char.charCodeAt(0);value=Math.imul(value,16777619);} return value>>>0; }
function players(room){ return [...room.players.values()]; }
function definition(id){ return WORLD_EVOLUTIONS.find((item)=>item.id===id); }
function evolvedByRole(room,role){ return room.worldEvolutions.filter((item)=>item.archetype===role&&room.world.unlocked.has(item.feature)); }
function completedByRole(room,role){const player=players(room).find((item)=>item.archetype===role),valid=new Set(evolvedByRole(room,role).map((item)=>item.id));return [...(player?.completedEvolutions||[])].filter((id)=>valid.has(id));}

export function createFinaleSystem(world, options={}) {
  const minimumMatchMs = Number(options.minimumMatchMs ?? 180_000);
  const preparationMs = Number(options.preparationMs ?? 8_000);
  const ritualWindowMs = Number(options.ritualWindowMs ?? 10_000);
  const resetAfterMs = Number(options.resetAfterMs ?? 30_000);

  function eligibility(room){
    if(room.finalObjective) return {ok:false,error:'A finale is already active.'};
    if(players(room).length!==4||!ARCHETYPES.every((role)=>players(room).some((player)=>player.archetype===role))) return {ok:false,error:'All four callings must be present.'};
    if(!ARCHETYPES.every((role)=>evolvedByRole(room,role).length>=2)) return {ok:false,error:'Each calling must receive both AI-selected evolutions before the finale.'};
    if(!ARCHETYPES.every((role)=>completedByRole(room,role).length>=2)) return {ok:false,error:'All four players must complete both of their assigned evolution tasks before the finale.'};
    const collector=players(room).find((player)=>player.archetype==='Collector'); if(collector?.collectorProgress && !collector.collectorProgress.completed) return {ok:false,error:'The Collector must complete the awakened landmark challenge before the finale.'};
    return {ok:true};
  }

  function choose(history, requestedId, seed, offset){
    if(requestedId){const selected=history.find((item)=>item.id===requestedId);if(!selected) return null;return selected;}
    return history[(seed+offset)%history.length];
  }

  function chooseDefaultVariant(room, seed){
    const evidence=players(room).map((player)=>{const base=player.evolutionBaseline||{};return {near:Math.max(0,player.nearSeconds-(base.near||0)),alone:Math.max(0,player.aloneSeconds-(base.alone||0)),rescues:player.rescues||0,follows:player.follows||0,risk:player.riskEvents||0};});
    const cooperation=evidence.reduce((sum,item)=>sum+item.near+item.rescues*12+item.follows*5,0);
    const rivalry=evidence.reduce((sum,item)=>sum+item.alone+item.risk*9,0);
    const id=cooperation>=rivalry?'lantern_rite':'echo_accord';
    const title=id==='lantern_rite'?'Lantern Rite':'Echo Accord';
    const description=id==='lantern_rite'?'Defend the central energy core together against an adaptive final assault.':'Let relic, shrine, path, and veil answer one another.';
    return {id,title,description,chosenAt:Date.now(),source:'AI behaviour selection',evidence:{cooperation:Math.round(cooperation),rivalry:Math.round(rivalry),seed}};
  }

  function compose(room, source='behaviour-model fallback', proposal={}){
    const ready=eligibility(room); if(!ready.ok) return {ok:false,error:ready.error};
    const behaviourKey=players(room).map((player)=>{const base=player.evolutionBaseline||{};return [player.archetype,Math.round(player.movement-(base.movement||0)),Math.round(player.nearSeconds-(base.near||0)),Math.round(player.aloneSeconds-(base.alone||0)),player.relicIds.size-(base.relics||0)].join(':');}).join('|');
    const seed=hash(`${room.createdAt}:${room.worldEvolutions.map((item)=>item.id).join('|')}:${behaviourKey}`);
    const selected={};
    for(const [index,role] of ARCHETYPES.entries()){
      const choices=evolvedByRole(room,role); const requested=proposal.roleEvolutionIds?.[role];
      selected[role]=choose(choices,requested,seed,index); if(!selected[role]) return {ok:false,error:`The proposed ${role} landmark did not evolve in this match.`};
    }
    const destinationHistory=room.worldEvolutions.filter((item)=>room.world.unlocked.has(item.feature));
    const destination=choose(destinationHistory,proposal.destinationEvolutionId,seed,5);
    if(!destination) return {ok:false,error:'The proposed destination is not an active evolved landmark.'};
    let complication=proposal.complicationId ? FINALE_COMPLICATIONS.find((item)=>item.id===proposal.complicationId) : FINALE_COMPLICATIONS[(seed+(room.finaleCompositionHistory?.length||0))%FINALE_COMPLICATIONS.length];
    if(!complication) return {ok:false,error:'Unknown shared complication.'};
    const destinationDef=definition(destination.id); const anchor=destinationDef.entity;
    const roleSteps=ARCHETYPES.map((role)=>({role,phase:ROLE_PHASE[role],powers:[...(ROLE_ABILITIES[role]||[])],phaseRequirement:'finale-role-step',evolutionId:selected[role].id,feature:selected[role].feature,landmark:selected[role].title,targetId:`evolution-${selected[role].id}`,narration:ROLE_NARRATION[role](selected[role].title),completed:false}));
    const circles=ARCHETYPES.map((role,index)=>({id:`finale-circle-${role.toLowerCase()}`,type:'finale-circle',x:anchor.x+[-2,2,-2,2][index],z:anchor.z+[-2,-2,2,2][index],role,label:`${role} Ritual Circle`,interaction:'finale-ritual',finaleOnly:true}));
    room.entities.push({id:'finale-destination',type:'finale-destination',x:anchor.x,z:anchor.z,role:null,label:destination.title,interaction:'finale-arrive',finaleOnly:true},...circles);
    room.phase='finale'; room.nextEvolutionAt=null;
    let compositionKey=`${destination.id}:${roleSteps.map((step)=>step.evolutionId).join(':')}:${complication.id}`;
    if(!proposal.complicationId&&(room.finaleCompositionHistory||[]).includes(compositionKey)){const index=(FINALE_COMPLICATIONS.findIndex((item)=>item.id===complication.id)+1)%FINALE_COMPLICATIONS.length;complication=FINALE_COMPLICATIONS[index];compositionKey=`${destination.id}:${roleSteps.map((step)=>step.evolutionId).join(':')}:${complication.id}`;}
    room.finalObjective={id:`finale-${room.createdAt}`,status:'active',phase:'PREPARING',createdAt:Date.now(),preparationEndsAt:Date.now()+preparationMs,source,variant:chooseDefaultVariant(room,seed),destination:{evolutionId:destination.id,feature:destination.feature,title:destination.title,targetId:'finale-destination'},roleSteps,complication:{...complication,active:true},groupRitual:{windowMs:ritualWindowMs,startedAt:null,participants:{}},worldEvolutions:room.worldEvolutions.map((item)=>({...item})),compositionKey};
    room.finaleCompositionHistory ||= [];room.finaleCompositionHistory.push(compositionKey);
    const opening=`I have watched long enough. I understand what this group became. I choose ${room.finalObjective.variant.title} as your ending.`;
    room.director={narration:opening,source,at:Date.now(),finalePhase:'PREPARING'}; world.event(room,'finale-preparing',opening,{finale:room.finalObjective});
    return {ok:true,objective:room.finalObjective};
  }

  function setVariant(room,variantId,source='Game Master'){
    const finale=room.finalObjective;if(!finale||finale.status!=='active')return {ok:false,error:'No active finale to shape.'};
    if(finale.phase!=='PREPARING')return {ok:false,error:'The finale variant can only change during preparation.'};
    const known={lantern_rite:{title:'Lantern Rite',description:'Defend the central energy core together against an adaptive final assault.'},echo_accord:{title:'Echo Accord',description:'Let relic, shrine, path, and veil answer one another.'},wardens_promise:{title:'Warden’s Promise',description:'Protect the shared tale before the final gate opens.'}}[variantId];
    if(!known)return {ok:false,error:'Unknown finale variant.'};
    finale.variant={id:variantId,...known,chosenAt:Date.now(),source};
    return {ok:true,variant:finale.variant};
  }

  function narratePhase(room,phase){
    const finale=room.finalObjective; let message;
    if(phase==='TRAVEL') message=`The changes you awakened now converge at ${finale.destination.title}. ${finale.complication.narration}`;
    else if(phase==='GROUP_RITUAL') message='Four circles answer in four voices. Stand apart, then let your choices arrive as one.';
    else message=finale.roleSteps.find((step)=>step.phase===phase)?.narration;
    if(message){room.director={narration:message,source:'Game Master',at:Date.now(),finalePhase:phase};world.event(room,'finale-narration',message,{phase});}
  }
  function setPhase(room,phase){room.finalObjective.phase=phase;room.finalObjective.phaseChangedAt=Date.now();narratePhase(room,phase);}

  function reflection(room){
    const lines=players(room).map((player)=>{const base=player.evolutionBaseline||{};const travelled=Math.max(0,Math.round(player.movement-(base.movement||0)));const alone=Math.max(0,Math.round(player.aloneSeconds-(base.alone||0)));const near=Math.max(0,Math.round(player.nearSeconds-(base.near||0)));const relics=Math.max(0,player.relicIds.size-(base.relics||0));const evidence=player.archetype==='Explorer'?`travelled ${travelled} steps beyond familiar roads`:player.archetype==='Collector'?`gathered ${player.observationItems?.size||0} overlooked curios and completed ${player.collectorProgress?.title||'a relic challenge'}`:player.archetype==='Guardian'?`remained near the group for ${near} seconds`:`walked alone for ${alone} seconds`;return `${player.name}, the ${player.archetype}, ${evidence}.`;});
    return {lines:[...lines,'So I created this world.'],assignedRoles:players(room).map((p)=>({playerId:p.id,name:p.name,archetype:p.archetype})),behaviourEvidence:players(room).map((p)=>world.playerTelemetry(room,p).postAssignment),worldEvolutions:room.worldEvolutions.map((item)=>({...item})),finaleComposition:{destination:room.finalObjective.destination,roleSteps:room.finalObjective.roleSteps,complication:room.finalObjective.complication},transformedMapOverview:{transformedLandmark:room.finalObjective.destination.title,evolvedLandmarks:room.worldEvolutions.map((item)=>item.title),complicationStopped:true}};
  }

  function complete(room){
    const finale=room.finalObjective; finale.phase='COMPLETE';finale.status='complete';finale.completedAt=Date.now();finale.complication.active=false;finale.reflection=reflection(room);finale.resetAt=Date.now()+resetAfterMs;room.phase='complete';
    const landmark=room.entities.find((entity)=>entity.id===finale.destination.targetId);if(landmark)landmark.transformed=true;
    room.director={narration:finale.reflection.lines.join(' '),source:'Game Master',at:Date.now(),finalePhase:'COMPLETE'};world.event(room,'finale-complete',room.director.narration,{reflection:finale.reflection});
    return {ok:true,complete:true,reflection:finale.reflection};
  }

  function interact(room,player,action,entity){
    const finale=room.finalObjective;if(!finale||finale.status!=='active')return {ok:false,error:'No finale is awaiting an answer.'};
    if(finale.phase==='TRAVEL'){
      if(action!=='finale-arrive'||entity.id!==finale.destination.targetId)return {ok:false,error:'The party must reach the chosen destination first.'};
      setPhase(room,'EXPLORER_STEP');return {ok:true,phase:finale.phase};
    }
    const step=finale.roleSteps.find((item)=>item.phase===finale.phase);
    if(step){
      if(action!=='finale-role-step'||player.archetype!==step.role)return {ok:false,error:`Only the ${step.role} can answer this part of the finale.`};
      if(entity.id!==step.targetId||!room.world.unlocked.has(step.feature))return {ok:false,error:'That landmark is not the active memory required by this finale.'};
      if(step.completed)return {ok:false,error:'This part of the rite has already been answered.'};
      step.completed=true;step.completedBy=player.id;step.completedAt=Date.now();setPhase(room,NEXT_PHASE[finale.phase]);return {ok:true,phase:finale.phase};
    }
    if(finale.phase==='GROUP_RITUAL'){
      if(action!=='finale-ritual'||entity.id!==`finale-circle-${player.archetype.toLowerCase()}`)return {ok:false,error:'Each calling must answer from its own circle.'};
      const ritual=finale.groupRitual;const stamp=Date.now();if(ritual.startedAt&&stamp-ritual.startedAt>ritual.windowMs){ritual.startedAt=stamp;ritual.participants={};}if(ritual.participants[player.id])return {ok:false,error:'Your circle is already carrying your answer.'};
      ritual.startedAt ||= stamp;ritual.participants[player.id]=stamp;return Object.keys(ritual.participants).length===4?complete(room):{ok:true,phase:'GROUP_RITUAL',participants:Object.keys(ritual.participants).length};
    }
    return {ok:false,error:'The finale is not ready for that interaction.'};
  }

  function advance(room){
    if(room.finalObjective?.status==='active'&&room.finalObjective.phase==='PREPARING'&&Date.now()>=room.finalObjective.preparationEndsAt){if(room.finalObjective.variant?.id==='lantern_rite'&&typeof world.startLanternRite==='function')world.startLanternRite(room);else setPhase(room,'TRAVEL');}
    if(room.finalObjective?.status==='complete'&&Date.now()>=room.finalObjective.resetAt){world.resetRoomForRoster?.(room,'The finished world grows quiet. Four new lanterns may begin another tale.');return true;}
    return false;
  }
  return Object.freeze({eligibility,compose,interact,advance,complete,setVariant});
}
