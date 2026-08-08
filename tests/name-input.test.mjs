import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 8798;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* server is starting */ }
    await sleep(100);
  }
  throw new Error('Timed out waiting for the name-input test server.');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#game').click({ position: { x: 480, y: 440 } });
  const name = page.locator('input[name="name"]');
  await name.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Eevee');
  assert.equal(await name.inputValue(), 'Eevee', 'typing E in the join form must not trigger game interaction');
  assert.equal(await page.locator('#lantern-gate').count(), 1, 'typing into the name field must keep the join form open');
  console.log('Join-form keyboard isolation test passed.');
} finally {
  await browser?.close();
  server.kill();
}
