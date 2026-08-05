import { createSession } from './client/session.js';
import { createRenderer } from './client/renderer.js';

// Thin composition root: browser setup, controls, and the join form only.
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 640;
canvas.id = 'game';
document.body.appendChild(canvas);

const session = createSession();
const { state, gameReady, interact, joinRoom, update } = session;
const { render } = createRenderer(canvas, session);
const keys = {};

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
  keys[event.key.toLowerCase()] = true;
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); interact(); }
  if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen();
});
addEventListener('keyup', (event) => { keys[event.key.toLowerCase()] = false; });
canvas.addEventListener('click', () => { if (!state.joined && !document.getElementById('lantern-gate')) showLanternGate(); });

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  update(dt, movementInput()); render(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.render_game_to_text = () => JSON.stringify({
  mode: state.joined ? (gameReady() ? 'adventure' : 'lobby') : 'title',
  room: state.network.roomCode, playerCount: state.players.length,
  phase: state.world?.phase || 'unjoined',
  player: state.mine && { x: +state.mine.x.toFixed(1), y: +state.mine.y.toFixed(1), archetype: state.mine.archetype },
  relics: state.world?.relics?.filter((relic) => !relic.collectedBy).map((relic) => relic.id) || [],
});
