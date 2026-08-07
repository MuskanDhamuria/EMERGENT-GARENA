import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createTempleFinale, moveTemplePlayer, activateTemplePillar, serializeTempleFinale, PEDESTALS } from '../server/portal-system.mjs';

const players = [
  { id: 'e', name: 'Ari', archetype: 'Explorer', color: '#76d7c4' },
  { id: 'c', name: 'Bea', archetype: 'Collector', color: '#f3c969' },
  { id: 'g', name: 'Cy', archetype: 'Guardian', color: '#83b9f5' },
  { id: 'l', name: 'Dee', archetype: 'Loner', color: '#c999ed' },
];
const finale = createTempleFinale({ players, completedObjectives: Object.fromEntries(players.map((player) => [player.id, 2])), now: 0 });
const shared = serializeTempleFinale(finale);
for (const player of players) moveTemplePlayer(finale, player.id, PEDESTALS[player.archetype], 10);
const split = serializeTempleFinale(finale);
for (const player of players) activateTemplePillar(finale, player.id, 20);
const won = serializeTempleFinale(finale);
assert.equal(shared.status, 'assembling');
assert.equal(split.status, 'ready-to-activate');
assert.equal(won.status, 'won');

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  const stages = JSON.stringify({ shared, split, won });
  const html = '<!doctype html><html><head><style>*{margin:0}canvas{display:block;width:960px;height:640px;image-rendering:pixelated}</style></head><body><script type="module" src="/preview.js"></script></body></html>';
  const preview = `
    import { createRenderer } from './client/renderer.js';
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640; canvas.id = 'game'; document.body.appendChild(canvas);
    const stages = ${stages};
    const players = ${JSON.stringify(players)};
    const state = { joined: true, network: { playerId: 'e' }, mine: players[0], players, world: { templeFinale: stages.shared }, publicEvent: '', noticeTimer: 0 };
    const session = { state, mapPoint: (point) => point, relics: () => [], activeEntities: () => [], abilities: () => [], gameReady: () => true };
    const renderer = createRenderer(canvas, session);
    window.showTempleStage = (name) => { state.world.templeFinale = stages[name]; renderer.render(); };
    renderer.render();
  `;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()), pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') { await route.fulfill({ contentType: 'text/html', body: html }); return; }
    if (pathname === '/preview.js') { await route.fulfill({ contentType: 'application/javascript', body: preview }); return; }
    const relative = pathname.startsWith('/client/') ? pathname.slice(1) : pathname.startsWith('/game-art/') || pathname.startsWith('/assets/') ? path.join('public', pathname.slice(1)) : null;
    if (relative) {
      try {
        const body = await readFile(path.resolve(relative)), extension = path.extname(relative).toLowerCase();
        await route.fulfill({ contentType: extension === '.js' ? 'application/javascript' : extension === '.json' ? 'application/json' : 'image/png', body }); return;
      } catch { /* fall through to a visible request failure */ }
    }
    await route.abort();
  });
  await page.goto('http://temple.local/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_200);
  await mkdir('output/web-game/ancient-temple', { recursive: true });
  await page.evaluate(() => window.showTempleStage('shared')); await page.waitForTimeout(150); await page.screenshot({ path: 'output/web-game/ancient-temple/shared-gathering.png' });
  await page.evaluate(() => window.showTempleStage('split')); await page.waitForTimeout(150); await page.screenshot({ path: 'output/web-game/ancient-temple/split-ritual.png' });
  await page.evaluate(() => window.showTempleStage('won')); await page.waitForTimeout(150); await page.screenshot({ path: 'output/web-game/ancient-temple/victory.png' });
  assert.deepEqual(errors, [], `Temple browser errors: ${errors.join('\n')}`);
  console.log('Ancient Temple shared, split and victory browser renders passed.');
} finally {
  await browser.close();
}
