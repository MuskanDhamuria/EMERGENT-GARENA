// Process composition root: files, HTTP and Socket.IO live here. Game rules
// live in server/game-world.mjs and never depend on this transport layer.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { createGameWorld } from './server/game-world.mjs';
import { createMcpRouter } from './server/mcp-router.mjs';
import { attachSocketGateway } from './server/socket-gateway.mjs';

const PORT = Number(process.env.PORT || 8787);
const configuredDuration = (name, fallback, minimum) => Number.isFinite(Number(process.env[name])) ? Math.max(minimum, Number(process.env[name])) : fallback;
const observationMs = configuredDuration('GAME_TEST_OBSERVATION_MS', 30_000, 100);
const gmAssignmentGraceMs = configuredDuration('GAME_TEST_GM_ASSIGNMENT_GRACE_MS', 12_000, 0);
const emergentOptions = Object.fromEntries([
  ['GAME_TEST_EMERGENT_ANALYSIS_MS', 'analysisIntervalMs'],
  ['GAME_TEST_EMERGENT_BOND_SECONDS', 'bondSeconds'],
  ['GAME_TEST_EMERGENT_GUARDIAN_SECONDS', 'guardianSeconds'],
].map(([environmentKey, optionKey]) => [optionKey, Number(process.env[environmentKey])]).filter(([, value]) => Number.isFinite(value)));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

function loadCollisionTiles() {
  try {
    const forest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'game-art', 'forest.json'), 'utf8'));
    return forest.layers?.find((layer) => layer.name === 'LAYER WITH COLLISION')?.data || [];
  } catch { console.warn('CSD collision map unavailable; using only map boundaries.'); return []; }
}
function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }

let handleMcpApi;
const server = createServer(async (request, response) => {
  const pathname = (request.url || '/').split('?')[0];
  if (pathname.startsWith('/api/mcp/')) { await handleMcpApi(request, response, pathname); return; }
  if (request.method === 'GET' && pathname === '/api/game-master') { sendJson(response, 200, { ok: true, message: 'Use the narrow /api/mcp endpoints to observe or alter a room.' }); return; }
  const urlPath = pathname === '/' ? '/index.html' : pathname, filePath = normalize(join('dist', urlPath));
  if (!filePath.startsWith(normalize('dist')) || !existsSync(filePath)) { response.writeHead(404); response.end('Build the app first with npm run build.'); return; }
  try { response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' }); response.end(await readFile(filePath)); }
  catch { response.writeHead(500); response.end('Unable to read application file.'); }
});
const io = new Server(server, { cors: { origin: true } });
const world = createGameWorld({
  collisionTiles: loadCollisionTiles(), observationMs, gmAssignmentGraceMs, emergentOptions,
  emitEvent: (room, item) => item.privateTo ? io.to(item.privateTo).emit('gm-private', item) : io.to(room.code).emit('gm-event', item),
  emitState: (playerId, state) => io.to(playerId).emit('world-state', state),
});
handleMcpApi = createMcpRouter(world);
attachSocketGateway(io, world);

let lastTick = Date.now();
setInterval(() => {
  const stamp = Date.now(), delta = Math.min(0.2, (stamp - lastTick) / 1000); lastTick = stamp;
  for (const room of world.rooms.values()) { world.tickRoom(room, delta); world.broadcastState(room); }
}, 100);

const lan = Object.values(networkInterfaces()).flat().find((item) => item?.family === 'IPv4' && !item.internal)?.address;
server.listen(PORT, '0.0.0.0', () => { console.log(`Emergent server running at http://127.0.0.1:${PORT}`); if (lan) console.log(`LAN: http://${lan}:${PORT}`); });
