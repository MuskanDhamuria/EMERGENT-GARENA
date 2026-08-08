import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;
const roomCode = 'DIR001';
const names = ['Ari', 'Bea', 'Cy', 'Dee'];
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), GAME_TEST_OBSERVATION_MS: '2500', GAME_TEST_GM_ASSIGNMENT_GRACE_MS: '0', GAME_TEST_EMERGENT_ANALYSIS_MS: '100', GAME_TEST_EMERGENT_GUARDIAN_SECONDS: '0.2' },
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
async function renderedPlayer(page) { return (await page.evaluate(() => JSON.parse(window.render_game_to_text()))).player; }
async function driveTo(page, targetX, targetY, label) {
  for (let step = 0; step < 100; step += 1) {
    const player = await renderedPlayer(page), dx = targetX - player.x, dy = targetY - player.y;
    if (Math.hypot(dx, dy) < 1.1) return;
    const horizontal = Math.abs(dx) > .45 ? (dx > 0 ? 'd' : 'a') : null, vertical = Math.abs(dy) > .45 ? (dy > 0 ? 's' : 'w') : null;
    if (horizontal) await page.keyboard.down(horizontal); if (vertical) await page.keyboard.down(vertical);
    await sleep(100);
    if (horizontal) await page.keyboard.up(horizontal); if (vertical) await page.keyboard.up(vertical);
  }
  const player = await renderedPlayer(page); throw new Error(`Could not navigate to ${label}; stopped at ${player.x}, ${player.y}.`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const contexts = await Promise.all(names.map(() => browser.newContext({ viewport: { width: 960, height: 640 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const consoleErrors = [];
  for (const page of pages) { page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); }); page.on('pageerror', (error) => consoleErrors.push(error.message)); }

  await mkdir('output/web-game/director-smoke', { recursive: true });
  await pages[0].goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await pages[0].title(), 'Emergent — A Game That Invents Itself Around You');
  await pages[0].screenshot({ path: 'output/web-game/director-smoke/emergent-landing.png' });
  await pages[0].locator('#how-it-works-button').click();
  await pages[0].locator('#how-it-works-modal').waitFor({ state: 'visible' });
  assert.equal(await pages[0].locator('#how-title').textContent(), 'HOW IT WORKS');
  await pages[0].screenshot({ path: 'output/web-game/director-smoke/how-it-works.png' });
  await pages[0].locator('.how-got-it').click();
  await pages[0].locator('#how-it-works-modal').waitFor({ state: 'hidden' });

  await Promise.all(pages.map(async (page, index) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#game').click({ position: { x: 480, y: 440 } });
    await page.locator('input[name="name"]').fill(names[index]);
    await page.locator('input[name="room"]').fill(roomCode);
    await page.locator('#lantern-gate button').click();
  }));

  const observingState = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/mcp/world-state?roomCode=${roomCode}`);
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.state.phase === 'observing' && payload.state.players.length === 4 ? payload.state : null;
  }, 'all four players to enter observation');
  const observingPositions = new Map(observingState.players.map((player) => [player.name, { x: player.x, z: player.z }]));
  await Promise.all(pages.map(async (page) => { await page.bringToFront(); await page.keyboard.down('d'); }));
  await sleep(500);
  await Promise.all(pages.map((page) => page.keyboard.up('d'))); await sleep(150);
  const movedDuringObservation = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  for (const name of names) {
    const before = observingPositions.get(name), after = movedDuringObservation.players.find((player) => player.name === name);
    assert.ok(after && Math.hypot(after.x - before.x, after.z - before.z) > 0.5, `${name} must be able to move during observation`);
  }
  await Promise.all(pages.map((page) => waitFor(async () => {
    const rendered = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.phase === 'observing' && !/waiting for exactly four|waiting for all/i.test(rendered.notice || '') ? rendered : null;
  }, 'the stale four-player waiting notice to disappear')));

  const state = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/mcp/world-state?roomCode=${roomCode}`);
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.state.phase === 'evolving' ? payload.state : null;
  }, 'four roles to awaken');
  assert.equal(state.players.length, 4);
  assert.equal(new Set(state.players.map((player) => player.sprite)).size, 4, 'all four players should receive distinct mascot sprites');
  assert.deepEqual(new Set(state.players.map((player) => player.archetype)), new Set(['Explorer', 'Collector', 'Guardian', 'Loner']));
  const draft = await api('/api/mcp/select-expeditions', { roomCode, expeditions: ['dark-cave', 'hidden-ruins'] });
  assert.deepEqual(draft.expeditions, ['dark-cave', 'hidden-ruins'], 'the Game Master should authoritatively choose exactly two of three expeditions');
  const ruinsPlan = await api('/api/mcp/adapt-encounter', { roomCode, expeditionId: 'hidden-ruins', tacticId: 'guard-collector', reason: 'The group collected eagerly, so the wardens should make protecting the Collector matter.' });
  const cavePlan = await api('/api/mcp/adapt-encounter', { roomCode, expeditionId: 'dark-cave', tacticId: 'hunt-straggler', reason: 'The group repeatedly separated, so the demons should notice isolated lanterns.' });
  assert.equal(ruinsPlan.tacticId, 'guard-collector');
  assert.equal(cavePlan.tacticId, 'hunt-straggler');
  const positionsBeforeMovement = new Map(state.players.map((player) => [player.name, { x: player.x, z: player.z }]));
  for (let index = 0; index < pages.length; index += 1) {
    await pages[index].bringToFront();
    const playerName = names[index], before = positionsBeforeMovement.get(playerName);
    for (const key of ['d', 'a', 'w', 's']) {
      await pages[index].keyboard.down(key); await sleep(450); await pages[index].keyboard.up(key); await sleep(120);
      const moved = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state.players.find((player) => player.name === playerName);
      if (moved && Math.hypot(moved.x - before.x, moved.z - before.z) > 0.5) break;
    }
  }
  const stateAfterMovement = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  for (const name of names) {
    const before = positionsBeforeMovement.get(name), after = stateAfterMovement.players.find((player) => player.name === name);
    assert.ok(after && Math.hypot(after.x - before.x, after.z - before.z) > 0.5, `${name} must be able to move from their spawn`);
  }
  const socialRuleState = await waitFor(async () => {
    const payload = await api(`/api/mcp/world-state?roomCode=${roomCode}`);
    return payload.state.emergentRules?.activeRules?.some((rule) => rule.type === 'guardian_protection') ? payload.state : null;
  }, 'a behaviour-derived guardian rule');
  assert.equal(socialRuleState.emergentRules.activeRules.some((rule) => rule.type === 'guardian_protection'), true);

  const [first, second, third, fourth] = state.players;
  const explorer = state.players.find((player) => player.archetype === 'Explorer');
  await api('/api/mcp/emergent-rule', { roomCode, directive: { triggerId: 'guardian_cohesion', effectId: 'shared_marker', visibility: 'shared', markerId: 'warden_ring', durationSeconds: 30, title: 'Warden Constellation', message: 'The group\'s shelter reveals a new shared landmark.' } });
  const customLaw = await waitFor(async () => {
    const payload = await api(`/api/mcp/world-state?roomCode=${roomCode}`);
    return payload.state.emergentRules?.activeRules?.some((rule) => rule.title === 'Warden Constellation') ? payload.state : null;
  }, 'the AI-created emergent law');
  assert.equal(customLaw.emergentRules.markers.some((marker) => marker.label === 'Warden Ring'), true);
  assert.equal(explorer.archetype, 'Explorer');
  const apply = (card, payload) => api('/api/mcp/director-card', { roomCode, card, payload });
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
  await apply('cooperation_request', { roles: ['Explorer', 'Guardian'], title: 'Ward the Temple', message: 'Scout the temple entrance, then keep the party safe.' });
  await apply('world_mood', { moodId: 'mist' });
  await apply('temporary_boon', { playerId: second.id, boonId: 'swift_step' });
  await apply('temporary_obstacle', { obstacleId: 'fallen_leaves' });

  for (const player of afterTurn.players) await api('/api/mcp/evolve', { roomCode, playerId: player.id });
  for (let step = 1; step < 2; step += 1) await api('/api/mcp/evolve', { roomCode, playerId: explorer.id });
  const explorerState = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  const evolvedExplorer = explorerState.players.find((player) => player.id === explorer.id);
  assert.deepEqual(evolvedExplorer.evolutions, ['hidden-cave-appears', 'forgotten-ruins-emerge']);
  assert.deepEqual(explorerState.world.selectedExpeditions, ['dark-cave', 'hidden-ruins']);
  assert.equal(explorerState.entities.some((entity) => entity.feature === 'temple-staircase-uncovered'), false, 'the unselected temple must stay hidden');
  assert.equal(explorerState.entities.filter((entity) => entity.requiredRole === 'Explorer' && entity.feature).length, 2);
  assert.equal(explorerState.terrain.filter((area) => area.requiredRole === 'Explorer' && area.feature).length, 2);
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
  const explorerPageIndex = names.indexOf(explorer.name);
  assert.notEqual(explorerPageIndex, -1, 'the Explorer browser should be identifiable by its player name');
  await waitFor(async () => {
    const rendered = await pages[explorerPageIndex].evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.visibleFeatures?.length === 2 && rendered.visibleTerrain?.length === 2 ? rendered : null;
  }, 'both Explorer landmarks to render');
  await pages[0].screenshot({ path: 'output/web-game/director-smoke/player-one.png' });
  await pages[explorerPageIndex].screenshot({ path: 'output/web-game/director-smoke/explorer-abilities.png' });
  const explorerPage = pages[explorerPageIndex]; await explorerPage.bringToFront();
  await driveTo(explorerPage, 36, 23, 'the visible grass west of the lake');
  const shorelinePosition = await renderedPlayer(explorerPage);
  assert.ok(
    Math.hypot(shorelinePosition.x - 36, shorelinePosition.y - 23) < 1.2,
    'the visible grass beside the lake should be walkable',
  );
  await driveTo(explorerPage, 36, 8, 'the buried Hidden Ruins arch');
  await explorerPage.keyboard.press('e');
  const ruinsRendered = await waitFor(async () => {
    const rendered = await explorerPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.player?.zone === 'hidden-ruins' && rendered.ruinsCombat?.enemies?.length === 2 ? rendered : null;
  }, 'the Explorer to enter a two-mummy Hidden Ruins battle');
  assert.equal(ruinsRendered.ruinsCombat.tacticId, 'guard-collector', 'the AI-selected relic ward tactic should be active in the ruins');
  assert.equal(ruinsRendered.player.health, 100, 'the ruins player should enter with full health');
  assert.ok(ruinsRendered.ruinsCombat.enemies.every((enemy) => enemy.maxHealth === 80), 'each mummy should have 80% of player health');
  const ruinsServerState = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  const firstMummy = ruinsServerState.ruinsCombat.enemies[0];
  await driveTo(explorerPage, firstMummy.x + 30, firstMummy.z + 17, 'the first mummy warden');
  const mummyStrike = await waitFor(async () => {
    const rendered = await explorerPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.player?.hurt && rendered.ruinsCombat?.enemies?.some((enemy) => enemy.attacking && enemy.targetId) ? rendered : null;
  }, 'the mummy attack feedback to render');
  assert.equal(mummyStrike.player.lastDamage, 5, 'the visible mummy strike should deal exactly 5% health');
  await explorerPage.screenshot({ path: 'output/web-game/director-smoke/hidden-ruins-enemy-strike.png' });
  await explorerPage.keyboard.press(' ');
  await waitFor(async () => {
    const latest = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
    return latest.ruinsCombat.enemies.find((enemy) => enemy.id === firstMummy.id)?.health < 80;
  }, 'the Explorer strike to damage the shared mummy');
  await sleep(300);
  await explorerPage.screenshot({ path: 'output/web-game/director-smoke/hidden-ruins-explorer.png' });
  await driveTo(explorerPage, 30, 29, 'the Hidden Ruins return archway');
  await explorerPage.keyboard.press('e');
  await waitFor(async () => (await renderedPlayer(explorerPage)).zone === 'overworld', 'the Explorer to return through the ruins archway');
  await driveTo(explorerPage, 24, 17, 'the center of camp return');
  await driveTo(explorerPage, 24, 14, 'the north edge of camp');
  await driveTo(explorerPage, 16, 14, 'the west side of camp');
  await driveTo(explorerPage, 16, 11, 'the lower forest clearing');
  await driveTo(explorerPage, 12, 9, 'the hidden cave entrance');
  await explorerPage.keyboard.press('e');
  await waitFor(async () => (await renderedPlayer(explorerPage)).zone === 'dark-cave', 'the Explorer to enter the Black Hollow');
  const caveRendered = await waitFor(async () => {
    const rendered = await explorerPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.caveCombat?.enemies?.length === 3 ? rendered : null;
  }, 'three Black Hollow demons to render');
  assert.equal(caveRendered.caveCombat.tacticId, 'hunt-straggler', 'the AI-selected isolation tactic should be active in the cave');
  assert.equal(caveRendered.player.health, 100, 'the cave player should enter with full health');
  assert.ok(caveRendered.caveCombat.enemies.every((enemy) => enemy.maxHealth === 75), 'each demon should have 75% of player health');
  const caveServerState = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  const firstCaveEnemy = caveServerState.caveCombat.enemies.find((enemy) => enemy.id === 'night-blade');
  await driveTo(explorerPage, firstCaveEnemy.x + 30, firstCaveEnemy.z + 17, 'the first Black Hollow demon');
  const demonStrike = await waitFor(async () => {
    const rendered = await explorerPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.player?.hurt && rendered.caveCombat?.enemies?.some((enemy) => enemy.attacking && enemy.targetId) ? rendered : null;
  }, 'the demon attack feedback to render');
  assert.equal(demonStrike.player.lastDamage, 5, 'the visible demon strike should deal exactly 5% health');
  await explorerPage.screenshot({ path: 'output/web-game/director-smoke/dark-cave-enemy-strike.png' });
  await explorerPage.keyboard.press(' ');
  await waitFor(async () => {
    const latest = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
    return latest.caveCombat.enemies.find((enemy) => enemy.id === firstCaveEnemy.id)?.health < 75;
  }, 'the Explorer strike to damage the shared demon');
  await sleep(250);
  await explorerPage.screenshot({ path: 'output/web-game/director-smoke/dark-cave-explorer.png' });
  await driveTo(explorerPage, 30, 29, 'the Black Hollow return passage');
  await explorerPage.keyboard.press('e');
  await waitFor(async () => (await renderedPlayer(explorerPage)).zone === 'overworld', 'the Explorer to return through the forest passage');
  const collectorPageIndex = names.indexOf(state.players.find((player) => player.archetype === 'Collector').name);
  const collectorPage = pages[collectorPageIndex]; await collectorPage.bringToFront();
  await driveTo(collectorPage, 36, 8, 'the opened Hidden Ruins arch');
  await collectorPage.keyboard.press('e');
  const collectorRuins = await waitFor(async () => {
    const rendered = await collectorPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    return rendered.player?.zone === 'hidden-ruins' && rendered.relics?.filter((id) => id.startsWith('sunstone-shard-')).length === 3 ? rendered : null;
  }, 'the Collector to enter and see all three guarded Sunstones');
  assert.equal(collectorRuins.ruinsCombat.enemies.length, 2);
  await sleep(500); await collectorPage.screenshot({ path: 'output/web-game/director-smoke/hidden-ruins-collector.png' });
  await driveTo(collectorPage, 18, 22, 'the guarded western Sunstone'); await collectorPage.keyboard.press('e'); await sleep(250);
  const guardedRuins = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state;
  assert.equal(Boolean(guardedRuins.entities.find((entity) => entity.id === 'sunstone-shard-west')?.collectedBy), false, 'the three Sunstones must remain guarded until both mummies are defeated');
  assert.deepEqual(consoleErrors, []);
  console.log('Four-player AI Director, two-of-three expedition draft, Black Hollow, and Hidden Ruins smoke test passed.');
} finally {
  await browser?.close();
  server.kill();
}
