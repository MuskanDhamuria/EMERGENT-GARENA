import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;
const roomCode = 'DIR001';
const names = ['Ari', 'Bea', 'Cy', 'Dee'];
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), GAME_TEST_OBSERVATION_MS: '200', GAME_TEST_GM_ASSIGNMENT_GRACE_MS: '0' },
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
  await apply('story_choice', { choiceId: 'shrine_or_vault' });
  await waitFor(async () => (await pages[0].evaluate(() => JSON.parse(window.render_game_to_text()))).director.storyChoice, 'story choice to render for players');
  await Promise.all(pages.slice(0, 3).map(async (page) => { await page.locator('#game').click({ position: { x: 480, y: 320 } }); await page.keyboard.press('1'); }));
  const afterChoice = await waitFor(async () => {
    const payload = await api(`/api/mcp/world-state?roomCode=${roomCode}`);
    return payload.state.world.unlocked.includes('healing-shrine') ? payload.state : null;
  }, 'three player votes to resolve the story choice');
  assert.equal(afterChoice.directorRules.history.some((rule) => rule.card === 'story_choice' && rule.selectedOptionId === 'shrine'), true);
  await apply('role_request', { requestId: 'explorer_scout' });
  await apply('cooperation_request', { roles: ['Explorer', 'Guardian'], title: 'Ward the Trail', message: 'Scout the path, then keep the party safe.' });
  await apply('world_mood', { moodId: 'mist' });
  await apply('temporary_boon', { playerId: second.id, boonId: 'swift_step' });
  await apply('temporary_obstacle', { obstacleId: 'fallen_leaves' });

  for (const player of afterChoice.players) await api('/api/mcp/evolve', { roomCode, playerId: player.id });
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
