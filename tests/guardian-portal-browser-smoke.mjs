import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { guardianTrialCatalog } from '../server/portal-system.mjs';

const port = 8793, baseUrl = `http://127.0.0.1:${port}`, roomCode = 'WARD01';
const requestedTrial = process.env.GUARDIAN_TRIAL || null;
const trialsById = Object.fromEntries(guardianTrialCatalog().map((trial) => [trial.id, trial]));
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), GAME_TEST_OBSERVATION_MS: '150', GAME_TEST_GM_ASSIGNMENT_GRACE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; }); server.stderr.on('data', (chunk) => { serverLog += chunk; });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(check, label) { for (let i = 0; i < 80; i += 1) { const value = await check(); if (value) return value; await sleep(100); } throw new Error(`Timed out waiting for ${label}.\n${serverLog}`); }
async function api(path, body) { const response = await fetch(`${baseUrl}${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) }); const payload = await response.json(); assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`); return payload; }
const playerState = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

let browser;
try {
  await waitFor(async () => { try { return (await fetch(baseUrl)).ok; } catch { return false; } }, 'server');
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const pages = await Promise.all(['Ari', 'Bea', 'Cy', 'Dee'].map(async (name) => { const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage(); await page.goto(baseUrl, { waitUntil: 'networkidle' }); await page.locator('#game').click({ position: { x: 480, y: 440 } }); await page.locator('input[name="name"]').fill(name); await page.locator('input[name="room"]').fill(roomCode); await page.locator('#lantern-gate button').click(); return page; }));
  const ready = await waitFor(async () => { const response = await fetch(`${baseUrl}/api/mcp/world-state?roomCode=${roomCode}`); if (!response.ok) return null; const payload = await response.json(); return payload.state.phase === 'evolving' ? payload.state : null; }, 'roles');
  for (const player of ready.players) await api('/api/mcp/evolve', { roomCode, playerId: player.id });
  const guardian = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state.players.find((player) => player.archetype === 'Guardian');
  if (requestedTrial) {
    const companion = ['wardkeepers-circuit', 'lost-lanterns', 'shelter-march', 'shrine-of-return'].find((id) => id !== requestedTrial);
    await api('/api/mcp/guardian-trials', { roomCode, playerId: guardian.id, trialIds: [requestedTrial, companion] });
  }
  const guardianPage = await waitFor(async () => (await Promise.all(pages.map(async (page) => ({ page, state: await page.evaluate(() => JSON.parse(window.render_game_to_text())) })))).find((entry) => entry.state.player?.archetype === 'Guardian')?.page, 'Guardian page');
  await guardianPage.locator('#game').click({ position: { x: 480, y: 440 } });
  async function moveOverworldTo(x, z) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
    const guardian = (await api(`/api/mcp/world-state?roomCode=${roomCode}`)).state.players.find((player) => player.archetype === 'Guardian');
      if (Math.hypot(guardian.x - x, guardian.z - z) <= 1.2) return;
      const directions = []; if (guardian.x < x - .15) directions.push('d'); if (guardian.x > x + .15) directions.push('a'); if (guardian.z < z - .15) directions.push('s'); if (guardian.z > z + .15) directions.push('w');
      await Promise.all(directions.map((key) => guardianPage.keyboard.down(key))); await sleep(100); await Promise.all(directions.map((key) => guardianPage.keyboard.up(key))); await sleep(35);
    }
    throw new Error(`Guardian could not reach overworld point ${x},${z}.`);
  }
  async function enterPortal(index, trialId) {
    await moveOverworldTo(10 + index * 5, -5);
    // The session deliberately smooths the local sprite toward the server
    // position. Let it settle before E chooses the nearest visible portal.
    await sleep(350);
    await guardianPage.keyboard.press('e');
    await sleep(250);
    const state = await waitFor(async () => { const current = await playerState(guardianPage); return current.guardianTrial?.active === trialId ? current : null; }, `${trialId} portal to open`);
    assert.equal(state.guardianTrial.wards, 0);
  }
  async function moveInTrialTo(target, trialId) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const current = await playerState(guardianPage), position = current.guardianTrial?.position;
      assert.equal(current.guardianTrial?.active, trialId, `Expected to remain inside ${trialId}.`);
      if (position && Math.hypot(position.x - target.x, position.z - target.z) <= 1.05) return;
      const keys = []; if (position.x < target.x - .15) keys.push('d'); if (position.x > target.x + .15) keys.push('a'); if (position.z < target.z - .15) keys.push('s'); if (position.z > target.z + .15) keys.push('w');
      await Promise.all(keys.map((key) => guardianPage.keyboard.down(key))); await sleep(100); await Promise.all(keys.map((key) => guardianPage.keyboard.up(key))); await sleep(35);
    }
    throw new Error(`Guardian could not reach ${target.id} in ${trialId}.`);
  }
  async function defeatThreatFor(objective, trialId) {
    await moveInTrialTo(objective, trialId);
    for (let hit = 0; hit < 5; hit += 1) {
      const current = await playerState(guardianPage);
      const blocked = current.guardianTrial?.mechanic?.threats?.some((threat) => !threat.defeated && threat.blocksObjectiveId === objective.id);
      if (!blocked) return;
      await guardianPage.keyboard.press(' '); await sleep(320);
    }
    await waitFor(async () => { const current = await playerState(guardianPage); return !current.guardianTrial?.mechanic?.threats?.some((threat) => !threat.defeated && threat.blocksObjectiveId === objective.id) ? current : null; }, `${objective.label} spirit to be defeated`);
  }
  async function completeTrial(index, trialId) {
    const trial = trialsById[trialId]; assert.ok(trial, `Unknown trial ${trialId}`);
    await enterPortal(index, trialId);
    await guardianPage.screenshot({ path: `output/web-game/guardian-portal/${trialId}.png` });
    if (trial.mechanic === 'carry-lanterns') {
      for (const lantern of trial.objectives.filter((objective) => objective.id !== 'hearth')) {
        await defeatThreatFor(lantern, trialId); await guardianPage.keyboard.press('e');
        await waitFor(async () => (await playerState(guardianPage)).guardianTrial?.mechanic?.carriedLanternId === lantern.id, `${lantern.label} to be carried`);
        for (let hit = 0; hit < 3; hit += 1) { await guardianPage.keyboard.press(' '); await sleep(320); }
        const before = await playerState(guardianPage), hearth = trial.objectives.find((objective) => objective.id === 'hearth');
        await moveInTrialTo(hearth, trialId); await guardianPage.keyboard.press('e');
        await waitFor(async () => { const current = await playerState(guardianPage); return current.guardianTrial.completed > before.guardianTrial.completed || current.guardianTrial.wards > before.guardianTrial.wards ? current : null; }, `${lantern.label} to reach the Hearth Guardian`);
      }
    } else {
      for (const objective of trial.objectives) {
        const before = await playerState(guardianPage);
        await defeatThreatFor(objective, trialId);
        await guardianPage.keyboard.press('e');
        if (trial.mechanic === 'stillness-channel' && objective.id !== trial.objectives.at(-1).id) {
          await waitFor(async () => (await playerState(guardianPage)).guardianTrial?.mechanic?.channelObjectiveId === objective.id, `${objective.label} channel to start`);
          await sleep(1_750);
        }
        await waitFor(async () => { const current = await playerState(guardianPage); return current.guardianTrial.completed > before.guardianTrial.completed || current.guardianTrial.wards > before.guardianTrial.wards ? current : null; }, `${objective.label} to activate`);
      }
    }
    const completed = await waitFor(async () => { const current = await playerState(guardianPage); return current.guardianTrial.completed >= index + 1 && !current.guardianTrial.active ? current : null; }, `${trial.title} completion`);
    assert.equal(completed.guardianTrial.completed, index + 1);
  }
  const selectedTrials = requestedTrial ? [requestedTrial, ['wardkeepers-circuit', 'lost-lanterns', 'shelter-march', 'shrine-of-return'].find((id) => id !== requestedTrial)] : null;
  assert.ok(selectedTrials, 'Set GUARDIAN_TRIAL to run the full Guardian portal journey.');
  await mkdir('output/web-game/guardian-portal', { recursive: true }); await guardianPage.screenshot({ path: `output/web-game/guardian-portal/${requestedTrial || 'sanctum'}.png` });
  await completeTrial(0, selectedTrials[0]);
  await completeTrial(1, selectedTrials[1]);
  console.log(`Guardian portal journey passed: ${selectedTrials.join(', ')}.`);
} finally { await browser?.close(); server.kill(); }
