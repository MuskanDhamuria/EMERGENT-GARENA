import { createSession } from './client/session.js';
import { createRenderer } from './client/renderer.js';

// Thin composition root: browser setup, controls, and the join form only.
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 640;
canvas.id = 'game';
canvas.style.touchAction = 'none';
canvas.style.userSelect = 'none';
document.body.appendChild(canvas);

const session = createSession();
const { state, gameReady, interact, aimAt, joinRoom, enableShadowForestPreview, enableMoonShrinePreview, enableGhostVillagePreview, handleGameKey, handleGameClick, handleGamePointerDown, handleGamePointerMove, handleGamePointerUp, update } = session;
const { render } = createRenderer(canvas, session);
const keys = {};
const preview=new URLSearchParams(location.search).get('preview'); if(preview==='shadow-forest') enableShadowForestPreview(); else if(preview==='moon-shrine') enableMoonShrinePreview(); else if(preview==='ghost-village') enableGhostVillagePreview();

function movementInput() {
  let x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  let z = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  if (!x && !z) return { x: 0, z: 0 };
  const magnitude = Math.hypot(x, z);
  return { x: x / magnitude, z: z / magnitude };
}

function showLanternGate(error = '') {
  if (document.getElementById('lantern-gate')) return;
  const gate = document.createElement('form');
  gate.id = 'lantern-gate';
  gate.innerHTML = `<div class="gate-card"><div class="gate-title">LIGHT A LANTERN</div><p>This world begins only when exactly four players have gathered.</p><label>NAME<input name="name" maxlength="16" required value="Wanderer"></label><label>ROOM CODE<input name="room" maxlength="6" required value="DAWN"></label><button>JOIN THE EXPEDITION</button><small>${error || 'There is no solo mode. Invite three fellow wanderers to the same room code.'}</small></div>`;
  document.body.appendChild(gate);
  gate.querySelector('input[name="name"]').focus();
  gate.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(gate); gate.remove();
    joinRoom(String(data.get('name')), String(data.get('room')).toUpperCase(), showLanternGate);
  });
}

addEventListener('keydown', (event) => {
  const key=event.key.toLowerCase();
  if(state.collectorGame){ event.preventDefault(); handleGameKey(key); return; }
  keys[key] = true;
  if (key === 'e') { event.preventDefault(); interact(); }
  if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen();
});
addEventListener('keyup', (event) => { keys[event.key.toLowerCase()] = false; });
function canvasPoint(event){
  const rect=canvas.getBoundingClientRect();
  // The canvas is displayed with object-fit: contain. When the browser aspect
  // ratio differs from the internal 960x640 canvas, the bitmap is letterboxed
  // inside the CSS box. Pointer coordinates must subtract that letterbox before
  // converting to game-canvas coordinates, otherwise every hitbox appears
  // visually correct but clicks/drags are horizontally or vertically offset.
  const scale=Math.min(rect.width/canvas.width, rect.height/canvas.height);
  const renderedWidth=canvas.width*scale, renderedHeight=canvas.height*scale;
  const offsetX=(rect.width-renderedWidth)/2, offsetY=(rect.height-renderedHeight)/2;
  return {
    x:(event.clientX-rect.left-offsetX)/scale,
    y:(event.clientY-rect.top-offsetY)/scale,
  };
}
canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); const {x,y}=canvasPoint(event); if(state.collectorGame){ if(state.collectorGame.type==='crystal-rebuild') handleGamePointerDown(x,y); else handleGameClick(x,y); canvas.setPointerCapture?.(event.pointerId); return;} if (!state.joined && !document.getElementById('lantern-gate')) showLanternGate(); });
canvas.addEventListener('pointermove', (event) => { const {x,y}=canvasPoint(event); state.aimScreen={x,y}; if(state.collectorGame?.type==='crystal-rebuild'){ event.preventDefault(); handleGamePointerMove(x,y); } });
canvas.addEventListener('pointerup', (event) => { if(!state.collectorGame || state.collectorGame.type!=='crystal-rebuild') return; event.preventDefault(); const {x,y}=canvasPoint(event); handleGamePointerUp(x,y); });
canvas.addEventListener('pointercancel', (event) => { if(!state.collectorGame || state.collectorGame.type!=='crystal-rebuild') return; event.preventDefault(); const {x,y}=canvasPoint(event); handleGamePointerUp(x,y); });
canvas.addEventListener('click', (event) => { const {x,y}=canvasPoint(event); if(state.collectorGame) { event.preventDefault(); return; } if(aimAt(x,y,canvas.width,canvas.height)){ event.preventDefault(); return; } if (!state.joined && !document.getElementById('lantern-gate')) showLanternGate(); });

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  update(dt, movementInput()); render(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.advanceTime = (milliseconds) => {
  const steps = Math.max(1, Math.round(Number(milliseconds || 0) / (1000 / 60)));
  for (let step = 0; step < steps; step += 1) update(1 / 60, movementInput());
  render();
};

window.render_game_to_text = () => JSON.stringify({
  mode: state.joined ? (gameReady() ? 'adventure' : 'lobby') : 'title',
  room: state.network.roomCode, playerCount: state.players.length,
  phase: state.world?.phase || 'unjoined',
  player: state.mine && { x: +state.mine.x.toFixed(1), y: +state.mine.y.toFixed(1), archetype: state.mine.archetype },
  relics: state.world?.relics?.filter((relic) => !relic.collectedBy).map((relic) => relic.id) || [],
  director: {
    mood: state.world?.director?.mood || state.world?.directorRules?.activeRules?.find((rule) => rule.card === 'world_mood')?.moodId || null,
    activeRules: (state.world?.directorRules?.activeRules || []).map((rule) => ({ card: rule.card, label: rule.label || rule.title || rule.message, expiresAt: rule.expiresAt || null })),
  },
});
