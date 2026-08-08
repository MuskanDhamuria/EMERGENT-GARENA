import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const lanternPlayers = [
  { id: 'e', name: 'Ari', archetype: 'Explorer', color: '#76d7c4', sprite: 1, realm: 'lantern-rite', x: 14, y: 21, lanternHealth: 9, lanternMaxHealth: 9 },
  { id: 'c', name: 'Bea', archetype: 'Collector', color: '#f3c969', sprite: 2, realm: 'lantern-rite', x: 18, y: 21, lanternHealth: 9, lanternMaxHealth: 9 },
  { id: 'g', name: 'Cy', archetype: 'Guardian', color: '#83b9f5', sprite: 3, realm: 'lantern-rite', x: 14, y: 24, lanternHealth: 9, lanternMaxHealth: 9 },
  { id: 'l', name: 'Dee', archetype: 'Loner', color: '#c999ed', sprite: 5, realm: 'lantern-rite', x: 18, y: 24, lanternHealth: 9, lanternMaxHealth: 9 },
];

const lanternState = {
  code: 'SMOKE', phase: 'finale', world: { unlocked: [] },
  lanternRite: { phase: 'ENTRY', wave: 1, waveCount: 3, task: 'Approach the glowing threshold and press E. The assault begins only when all four enter the arena.', entry: { ready: { e: 1, c: 1 } } },
  finalObjective: { status: 'active', phase: 'LANTERN_ENTRY', variant: { id: 'lantern_rite', title: 'Lantern Rite' } },
  entities: [{ id: 'lantern-entry-gate', type: 'lantern-entry-gate', zone: 'lantern-rite', x: 16, z: 18.5, readyCount: 2 }],
};

const echoPlayers = lanternPlayers.map((player, index) => ({
  ...player, realm: 'echo-accord', x: [8, 40, 8, 40][index], y: [8, 8, 24, 24][index], echoAlive: true, echoCollected: index,
  echoColor: ['#62d8ff', '#ffd35f', '#79e38e', '#c992ff'][index],
  echoTrail: Array.from({ length: 5 + index }, (_, part) => ({ x: [8, 40, 8, 40][index] - part * (index % 2 ? -0.65 : 0.65), z: [8, 8, 24, 24][index] })),
}));
const echoState = {
  code: 'SMOKE', phase: 'finale', world: { unlocked: [] }, lanternRite: null,
  finalObjective: { status: 'active', phase: 'ECHO_ACCORD', variant: { id: 'echo_accord', title: 'Last Snake Standing' }, echoAccord: { mode: 'LAST_SNAKE_STANDING', arena: { minX: 2, maxX: 46, minZ: 2, maxZ: 30 }, echoes: [{ id: 'orb-a', x: 18, z: 12, active: true, hue: 0 }, { id: 'orb-b', x: 28, z: 18, active: true, hue: 2 }] } },
  entities: [],
};

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  const html = '<!doctype html><html><head><style>*{margin:0}canvas{display:block;width:960px;height:640px;image-rendering:pixelated}</style></head><body><script type="module" src="/preview.js"></script></body></html>';
  const preview = `
    import { createRenderer } from './client/renderer.js';
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640; document.body.appendChild(canvas);
    const lanternPlayers = ${JSON.stringify(lanternPlayers)};
    const lanternState = ${JSON.stringify(lanternState)};
    const echoPlayers = ${JSON.stringify(echoPlayers)};
    const echoState = ${JSON.stringify(echoState)};
    const state = { joined: true, network: { playerId: 'e', connected: true, roomCode: 'SMOKE' }, mine: lanternPlayers[0], players: lanternPlayers, world: lanternState, publicEvent: '', noticeTimer: 0, frame: 0 };
    const session = { state, mapPoint: (point) => ({ x: point.x, y: point.y ?? point.z }), relics: () => [], activeEntities: () => state.world.entities || [], abilities: () => [], abilityProgress: () => [], gameReady: () => true };
    const renderer = createRenderer(canvas, session);
    window.showFinale = (mode) => { state.world = mode === 'echo' ? echoState : lanternState; state.players = mode === 'echo' ? echoPlayers : lanternPlayers; state.mine = state.players[0]; renderer.render(); };
    window.showFinale('lantern');
  `;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') { await route.fulfill({ contentType: 'text/html', body: html }); return; }
    if (pathname === '/preview.js') { await route.fulfill({ contentType: 'application/javascript', body: preview }); return; }
    const relative = pathname.startsWith('/client/') || pathname.startsWith('/shared/') ? pathname.slice(1) : pathname.startsWith('/game-art/') || pathname.startsWith('/assets/') ? path.join('public', pathname.slice(1)) : null;
    if (relative) {
      try {
        const body = await readFile(path.resolve(relative)); const extension = path.extname(relative).toLowerCase();
        await route.fulfill({ contentType: extension === '.js' ? 'application/javascript' : extension === '.json' ? 'application/json' : 'image/png', body }); return;
      } catch { /* route the request to a visible browser failure below */ }
    }
    await route.abort();
  });
  await page.goto('http://finale.local/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await mkdir('output/web-game/muskan-finale', { recursive: true });
  await page.evaluate(() => window.showFinale('lantern')); await page.waitForTimeout(120); await page.screenshot({ path: 'output/web-game/muskan-finale/lantern-rite.png' });
  await page.evaluate(() => window.showFinale('echo')); await page.waitForTimeout(120); await page.screenshot({ path: 'output/web-game/muskan-finale/echo-accord.png' });
  assert.deepEqual(errors, [], `Muskan finale browser errors: ${errors.join('\n')}`);
  console.log('Muskan Lantern Rite and Echo Accord browser renders passed.');
} finally {
  await browser.close();
}
