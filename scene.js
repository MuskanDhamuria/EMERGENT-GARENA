import { createSession } from './client/session.js';
import { createRenderer } from './client/renderer.js';
import { applyRealmPreview } from './client/realm-preview.js';

// Thin composition root: browser setup, controls, and the join form only.
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 640;
canvas.id = 'game';
canvas.tabIndex = 0;
document.body.appendChild(canvas);

const howButton = document.createElement('button');
howButton.id = 'how-it-works-button';
howButton.type = 'button';
howButton.textContent = '▣  HOW IT WORKS';
document.body.appendChild(howButton);

const howModal = document.createElement('div');
howModal.id = 'how-it-works-modal';
howModal.hidden = true;
howModal.innerHTML = `<section class="how-card" role="dialog" aria-modal="true" aria-labelledby="how-title">
  <button class="how-close" type="button" aria-label="Close">×</button>
  <h2 id="how-title">HOW IT WORKS</h2>
  <p class="how-intro">The game learns how to challenge your group.</p>
  <div class="how-step"><span class="how-icon">01</span><div><h3>ENTER TOGETHER</h3><p>Four players share one world. Nobody begins with an assigned role—move, wander and behave naturally.</p></div></div>
  <div class="how-step"><span class="how-icon">02</span><div><h3>THE GAME MASTER LEARNS</h3><p>The AI observes patterns such as exploration, collecting, cooperation, separation and risk.</p></div></div>
  <div class="how-step"><span class="how-icon">03</span><div><h3>RULES EMERGE</h3><p>Your behaviour changes the world. Players may receive different abilities, connections or information.</p></div></div>
  <div class="how-step"><span class="how-icon">04</span><div><h3>DISCOVER THEM TOGETHER</h3><p>Experiment and communicate. The world only offers a hint after your group encounters something meaningful.</p></div></div>
  <p class="how-note">You do not simply learn how to play the game. The game learns how to play with you.</p>
  <button class="how-got-it" type="button">GOT IT</button>
</section>`;
document.body.appendChild(howModal);

const closeHowItWorks = () => { howModal.hidden = true; howButton.focus(); };
howButton.addEventListener('click', () => { howModal.hidden = false; howModal.querySelector('.how-close').focus(); });
howModal.querySelector('.how-close').addEventListener('click', closeHowItWorks);
howModal.querySelector('.how-got-it').addEventListener('click', closeHowItWorks);
howModal.addEventListener('click', (event) => { if (event.target === howModal) closeHowItWorks(); });

const session = createSession();
const previewRealm = new URLSearchParams(location.search).get('preview');
applyRealmPreview(session.state, previewRealm);
const { state, attack, gameReady, interact, aimAt, joinRoom, update, activeEntities, handleCollectorPointer, handleCollectorKey, lanternSupport } = session;
const { render } = createRenderer(canvas, session);
const keys = {};

function movementInput() {
  let x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  let z = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  if (!x && !z) return { x: 0, z: 0 };
  const magnitude = Math.hypot(x, z);
  return { x: x / magnitude, z: z / magnitude };
}

function inputKey(event) {
  return ({ KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright' })[event.code] || event.key.toLowerCase();
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target?.isContentEditable);
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
  if (event.key === 'Escape' && !howModal.hidden) { event.preventDefault(); closeHowItWorks(); return; }
  // The join form belongs to the browser, not the game.  In particular, E in
  // a name must remain a letter rather than opening an interaction.
  if (isTypingTarget(event.target)) return;
  const key = inputKey(event); keys[key] = true;
  if (state.collectorGame && handleCollectorKey(key)) {
    event.preventDefault();
    return;
  }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e', ' ', 'q', 'r'].includes(key)) event.preventDefault();
  if (key === 'e') interact();
  if (key === ' ') attack();
  if (key === 'q') lanternSupport('heal');
  if (key === 'r') lanternSupport('barrier');
  if (key === 'f') document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen();
});
addEventListener('keyup', (event) => { if (!isTypingTarget(event.target)) keys[inputKey(event)] = false; });
addEventListener('blur', () => { for (const key of Object.keys(keys)) keys[key] = false; });
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
canvas.addEventListener('click', (event) => {
  if (!state.joined && !document.getElementById('lantern-gate')) { showLanternGate(); return; }
  if (state.collectorGame) {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
    const hit = (state.collectorGame.hitboxes || []).find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    if (handleCollectorPointer(hit)) return;
  }
  if (state.mine?.realm === 'ghost-village') {
    const bounds = canvas.getBoundingClientRect();
    aimAt((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height, canvas.width, canvas.height);
  }
});

let last = performance.now();
let gameFocusClaimed = false;
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  howButton.hidden = state.joined || Boolean(document.getElementById('lantern-gate')) || !howModal.hidden;
  if (state.joined && !gameFocusClaimed) { canvas.focus({ preventScroll: true }); gameFocusClaimed = true; }
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
  notice: state.noticeTimer > 0 ? state.notice : null,
  guidance: state.guidance?.message || null,
  player: state.mine && { x: +state.mine.x.toFixed(1), y: +state.mine.y.toFixed(1), zone: state.mine.zone || 'overworld', realm: state.mine.realm || 'overworld', archetype: state.mine.archetype, health: state.mine.health, maxHealth: state.mine.maxHealth, hurt: state.mine.hurt, lastDamage: state.mine.lastDamage, caveLocked: state.mine.caveLocked, ruinsLocked: state.mine.ruinsLocked, evolutions: state.mine.evolutions || [] },
  targets: activeEntities().map((entity) => ({ id: entity.targetId || entity.id, action: entity.action, x: +Number(entity.x).toFixed(1), y: +Number(entity.y).toFixed(1) })),
  guardianTrial: state.world?.guardianTrial && { status: state.world.guardianTrial.status, active: state.world.guardianTrial.activeTrial?.id || null, position: state.world.guardianTrial.position || null, wards: state.world.guardianTrial.activatedObjectiveIds?.length || 0, completed: state.world.guardianTrial.completedTrialIds?.length || 0, mechanic: state.world.guardianTrial.mechanic || null },
  temple: state.world?.templeFinale && { status: state.world.templeFinale.status, layout: state.world.templeFinale.status === 'assembling' ? 'shared-map' : 'four-way-split', panes: state.world.templeFinale.panes?.map((pane) => ({ role: pane.archetype, atPillar: pane.atPedestal, awake: pane.pillarActivated })) },
  collectorTrial: state.world?.collectorTrial && { plan: state.world.collectorTrial.plan, complete: state.world.collectorTrial.completedFeatures, active: state.world.collectorTrial.active?.feature || null, started: Boolean(state.world.collectorTrial.active?.started) },
  lanternRite: state.world?.lanternRite && { phase: state.world.lanternRite.phase, wave: state.world.lanternRite.wave, waveCount: state.world.lanternRite.waveCount, task: state.world.lanternRite.task },
  caveCombat: state.world?.caveCombat ? { cleared: state.world.caveCombat.cleared, tacticId: state.world.caveCombat.tacticId, tacticLabel: state.world.caveCombat.tacticLabel, enemies: state.world.caveCombat.enemies.map((enemy) => ({ id: enemy.id, health: enemy.health, maxHealth: enemy.maxHealth, attacking: enemy.attacking, targetId: enemy.targetId })) } : null,
  ruinsCombat: state.world?.ruinsCombat ? { cleared: state.world.ruinsCombat.cleared, tacticId: state.world.ruinsCombat.tacticId, tacticLabel: state.world.ruinsCombat.tacticLabel, enemies: state.world.ruinsCombat.enemies.map((enemy) => ({ id: enemy.id, health: enemy.health, maxHealth: enemy.maxHealth, attacking: enemy.attacking, targetId: enemy.targetId })) } : null,
  selectedExpeditions: state.world?.world?.selectedExpeditions || [],
  visibleFeatures: (state.world?.entities || []).filter((entity) => entity.feature).map((entity) => entity.feature),
  visibleTerrain: (state.world?.terrain || []).filter((area) => area.feature).map((area) => area.feature),
  relics: state.world?.relics?.filter((relic) => !relic.collectedBy).map((relic) => relic.id) || [],
  director: {
    mood: state.world?.director?.mood || state.world?.directorRules?.activeRules?.find((rule) => rule.card === 'world_mood')?.moodId || null,
    activeRules: (state.world?.directorRules?.activeRules || []).map((rule) => ({ card: rule.card, label: rule.label || rule.title || rule.message, expiresAt: rule.expiresAt || null })),
  },
});
