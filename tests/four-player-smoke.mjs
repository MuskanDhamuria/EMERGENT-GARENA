import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;
const roomCode = 'DIR001';
const names = ['Ari', 'Bea', 'Cy', 'Dee'];
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), GAME_TEST_OBSERVATION_MS: '200', GAME_TEST_GM_ASSIGNMENT_GRACE_MS: '0', GAME_TEST_EVOLUTION_MIN_MS: '100', GAME_TEST_EVOLUTION_MAX_MS: '100', GAME_TEST_EVOLUTION_GM_GRACE_MS: '5000', GAME_TEST_FINALE_MIN_MATCH_MS: '100', GAME_TEST_FINALE_GM_GRACE_MS: '5000', GAME_TEST_FINALE_RESET_MS: '5000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`Test server did not start.\n${serverLog}`);
}
async function api(path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`);
  return payload;
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await check(); if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const contexts = await Promise.all(names.map(() => browser.newContext({ viewport: { width: 960, height: 640 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const consoleErrors = [];
  for (const page of pages) { page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); }); page.on('pageerror', (error) => consoleErrors.push(error.message)); }

  await Promise.all(pages.map(async (page, index) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#game').click({ position: { x: 480, y: 440 } });
    await page.locator('input[name="name"]').fill(names[index]);
    await page.locator('input[name="room"]').fill(roomCode);
    await page.locator('#lantern-gate button').click();
  }));

  const state = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/mcp/world-state?roomCode=${roomCode}`);
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.state.phase === 'evolving' ? payload.state : null;
  }, 'four roles to awaken');
  assert.equal(state.players.length, 4);
  assert.deepEqual(new Set(state.players.map((player) => player.archetype)), new Set(['Explorer', 'Collector', 'Guardian', 'Loner']));

  const [first, second, third, fourth] = state.players;
  const apply = (card, payload) => api('/api/mcp/director-card', { roomCode, card, payload });
  await apply('private_hint', { playerId: first.id, message: 'A silver leaf points toward the old path.' });
  await apply('unlock_shortcut', { shortcutId: 'moss_trail' });
  await apply('story_turn', { turnId: 'shrine_or_vault', optionId: 'shrine' });
  const afterTurn = await waitFor(async () => {
    const payload = await api(`/api/mcp/world-state?roomCode=${roomCode}`);
    return payload.state.world.unlocked.includes('healing-shrine') ? payload.state : null;
  }, 'AI Director to resolve its story turn');
  assert.equal(afterTurn.directorRules.history.some((rule) => rule.card === 'story_turn' && rule.selectedOptionId === 'shrine'), true);
  const historyLength = afterTurn.directorRules.history.length;
  await pages[0].keyboard.press('1'); await sleep(150);
  const afterPlayerKey = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  assert.equal(afterPlayerKey.directorRules.history.length, historyLength, 'Player input must not alter an AI-resolved story turn.');
  await apply('role_request', { requestId: 'explorer_scout' });
  await apply('cooperation_request', { roles: ['Explorer', 'Guardian'], title: 'Ward the Trail', message: 'Scout the path, then keep the party safe.' });
  await apply('world_mood', { moodId: 'mist' });
  await apply('temporary_boon', { playerId: second.id, boonId: 'swift_step' });
  await apply('temporary_obstacle', { obstacleId: 'fallen_leaves' });

  const evolutionIds = ['hidden-cave-appears', 'crystal-mine-awakens', 'healing-shrine-awakens', 'spirit-portal-opens'];
  for (const evolutionId of evolutionIds) {
    await waitFor(async () => {
      const current = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
      return Number(current.evolutionSecondsRemaining) <= 0;
    }, `evolution timer for ${evolutionId}`);
    await api('/api/mcp/world-evolution', { roomCode, evolutionId, narration: `The Game Master has observed a new pattern. The sleeping world responds. ${evolutionId.replaceAll('-', ' ')} takes physical form.` });
  }
  const evolved = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  assert.deepEqual(evolved.worldEvolutions.map((item) => item.id), evolutionIds);
  assert.equal(new Set(evolved.worldEvolutions.map((item) => item.id)).size, evolutionIds.length);
  const finale = await api('/api/mcp/finale', { roomCode });
  assert.equal(finale.ok, true);
  await apply('finale_variant', { variantId: 'echo_accord' });
  const completed = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  assert.equal(completed.phase, 'finale');
  assert.equal(completed.finalObjective.variant.id, 'echo_accord');
  assert.equal(completed.directorRules.activeRules.some((rule) => rule.card === 'temporary_boon' && rule.boonId === 'swift_step'), true);

  await waitFor(async () => (await pages[0].evaluate(() => JSON.parse(window.render_game_to_text()))).phase === 'finale', 'finale state to render in the first player client');
  const renderState = await pages[0].evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(renderState.phase, 'finale');
  assert.equal(renderState.director.mood, 'mist');
  assert.equal(renderState.director.activeRules.length > 0, true);
  await mkdir('output/web-game/director-smoke', { recursive: true });
  await pages[0].screenshot({ path: 'output/web-game/director-smoke/player-one.png' });
  assert.deepEqual(consoleErrors, []);
  console.log('Four-player AI Director smoke test passed.');
} finally {
  await browser?.close();
  server.kill();
}
