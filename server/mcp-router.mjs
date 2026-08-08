// HTTP adapter for the Game Master control plane.  Rules stay in the world
// module supplied by the server; this file only translates HTTP to game calls.
function sendJson(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }

async function readBody(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 50_000) throw new Error('Request body too large.'); }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Invalid JSON body.'); }
}

export function createMcpRouter(world) {
  return async function handleMcpApi(request, response, pathname) {
    let payload;
    try { payload = request.method === 'GET' ? Object.fromEntries(new URL(request.url, 'http://localhost').searchParams) : await readBody(request); }
    catch (error) { sendJson(response, 400, { ok: false, error: error.message }); return; }
    if (pathname === '/api/mcp/rooms') { sendJson(response, 200, { ok: true, rooms: [...world.rooms.values()].map((room) => ({ roomCode: room.code, phase: room.phase, playerCount: room.players.size })) }); return; }
    const room = world.rooms.get(String(payload.roomCode || '').toUpperCase());
    if (!room) { sendJson(response, 404, { ok: false, error: 'Unknown room.' }); return; }
    if (pathname === '/api/mcp/world-state') { sendJson(response, 200, { ok: true, state: world.serializeRoom(room) }); return; }
    if (pathname === '/api/mcp/telemetry') { sendJson(response, 200, { ok: true, telemetry: world.roomTelemetry(room) }); return; }
    if (room.players.size !== 4) { sendJson(response, 400, { ok: false, error: 'Game Master actions require exactly four connected players.' }); return; }
    let result;
    if (pathname === '/api/mcp/narrate') { const message = world.cleanText(payload.message, '', 280); result = !message ? { ok: false, error: 'A narration message is required.' } : payload.privateTo && !world.getPlayer(room, payload.privateTo) ? { ok: false, error: 'Unknown private audience.' } : (world.markGmActive(room), { ok: true, event: world.event(room, 'gm-narration', message, payload.privateTo ? { privateTo: payload.privateTo } : {}) }); }
    else if (pathname === '/api/mcp/assign-archetypes') { world.markGmActive(room); result = world.assignArchetypes(room, payload.assignments, 'MCP Game Master', payload.expeditions); }
    else if (pathname === '/api/mcp/select-expeditions') { world.markGmActive(room); result = world.selectExpeditions(room, payload.expeditions, 'MCP Game Master'); }
    else if (pathname === '/api/mcp/adapt-encounter') { world.markGmActive(room); result = world.adaptEncounter(room, payload.expeditionId, payload.tacticId, payload.reason, 'MCP Game Master'); }
    else if (pathname === '/api/mcp/unlock') result = !['evolving', 'finale'].includes(room.phase) ? { ok: false, error: 'World features unlock only after roles are assigned.' } : !payload.privateTo && room.world.unlocked.has(payload.feature) ? { ok: false, error: 'That public feature is already unlocked.' } : (world.markGmActive(room), world.unlock(room, payload.feature, world.cleanText(payload.message), payload.privateTo ? { privateTo: payload.privateTo } : {}));
    else if (pathname === '/api/mcp/evolve') { world.markGmActive(room); result = world.evolve(room, payload.playerId, 'MCP Game Master'); }
    else if (pathname === '/api/mcp/guardian-trials') { world.markGmActive(room); result = world.chooseGuardianTrials(room, payload.playerId, payload.trialIds, 'MCP Game Master'); }
    else if (pathname === '/api/mcp/finale') { world.markGmActive(room); const objective = world.createFinalObjective(room, 'MCP Game Master'); result = objective ? { ok: true, objective } : { ok: false, error: 'The finale needs exactly four assigned and evolved roles.' }; }
    else if (pathname === '/api/mcp/emergent-rule') result = world.emergentRules.apply(room, payload.directive, undefined);
    else if (pathname === '/api/mcp/director-card') result = world.directorRules.apply(room, { card: payload.card, payload: payload.payload }, { source: 'AI Game Master' });
    else { sendJson(response, 404, { ok: false, error: 'Unknown MCP endpoint.' }); return; }
    world.broadcastState(room); sendJson(response, result.ok ? 200 : 400, result);
  };
}
