#!/usr/bin/env node
/**
 * Emergent Game Master MCP server.
 *
 * This process is deliberately a thin, capability-safe bridge. An AI can read
 * room context and ask for a small set of pre-built changes, but it cannot run
 * code, write game files, choose arbitrary socket events, or talk to clients
 * directly. The authoritative game server validates every request again.
 *
 * Start the game server first, then run: npm run mcp
 * Configure an MCP client with: node /absolute/path/to/mcp-game-master.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const gameServerUrl = (process.env.EMERGENT_GAME_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const roomCodeSchema = z.string().trim().regex(/^[A-Za-z0-9]{4,6}$/, 'Use a 4–6 character room code.').transform((value) => value.toUpperCase());
const playerIdSchema = z.string().trim().min(1).max(128);
const archetypeSchema = z.enum(['Explorer', 'Collector', 'Guardian', 'Loner']);
const featureSchema = z.enum([
  'hidden-cave', 'secret-path', 'invisible-bridge', 'forgotten-ruins',
  'relic-vault', 'evolving-artifacts', 'treasure-cache', 'healing-shrine',
  'protective-barrier', 'revival-monument', 'spirit-realm', 'illusion-passage',
  'hidden-portal', 'ancient-temple', 'final-gate',
]);

function toolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function gameRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${gameServerUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(`Could not reach the Emergent game server at ${gameServerUrl}: ${error.message}`);
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(payload?.error || `Game server returned HTTP ${response.status}.`);
  return payload;
}

function unique(values) { return new Set(values).size === values.length; }

const server = new McpServer({
  name: 'emergent-game-master',
  version: '1.0.0',
});

server.registerTool('get_world_state', {
  title: 'Get authoritative world state',
  description: 'Read the current players, discovered places, accessible features, active rules, evolutions and finale for one Emergent room. Call before making a world-changing decision.',
  inputSchema: { roomCode: roomCodeSchema },
}, async ({ roomCode }) => {
  try { return toolResult(await gameRequest(`/api/mcp/world-state?roomCode=${encodeURIComponent(roomCode)}`)); }
  catch (error) { return toolError(error.message); }
});

server.registerTool('get_player_telemetry', {
  title: 'Get player behaviour telemetry',
  description: 'Read privacy-safe aggregate and per-player behavioural signals: exploration, proximity, leadership, collecting, risk and co-operation. Use this evidence to infer identities; do not guess.',
  inputSchema: { roomCode: roomCodeSchema },
}, async ({ roomCode }) => {
  try { return toolResult(await gameRequest(`/api/mcp/telemetry?roomCode=${encodeURIComponent(roomCode)}`)); }
  catch (error) { return toolError(error.message); }
});

server.registerTool('assign_archetypes', {
  title: 'Assign permanent archetypes',
  description: 'Make the first identity decision after the observation period. Each archetype is unique and permanent. Assign only players currently in this room, include evidence grounded in telemetry, and do not use this tool again once assignments exist.',
  inputSchema: {
    roomCode: roomCodeSchema,
    assignments: z.array(z.object({
      playerId: playerIdSchema,
      archetype: archetypeSchema,
      evidence: z.string().trim().min(8).max(180),
    })).min(1).max(4),
  },
}, async ({ roomCode, assignments }) => {
  if (!unique(assignments.map((item) => item.playerId))) return toolError('Each player can receive only one archetype.');
  if (!unique(assignments.map((item) => item.archetype))) return toolError('Archetypes are unique: assign each at most once.');
  try {
    // Evidence stays in the model's audit trail; only the authoritative identity
    // pair reaches the game server.
    const requestAssignments = assignments.map(({ playerId, archetype }) => ({ playerId, archetype }));
    return toolResult(await gameRequest('/api/mcp/assign-archetypes', { method: 'POST', body: { roomCode, assignments: requestAssignments } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('unlock_world_feature', {
  title: 'Reveal a physical world evolution',
  description: 'Reveal one validated, visible map change. The game server chooses its safe placement and refuses duplicate or unavailable features. A private unlock is visible only to one player, enabling asymmetric information.',
  inputSchema: {
    roomCode: roomCodeSchema,
    feature: featureSchema,
    message: z.string().trim().min(3).max(280),
    privateTo: playerIdSchema.optional(),
  },
}, async ({ roomCode, feature, message, privateTo }) => {
  try { return toolResult(await gameRequest('/api/mcp/unlock', { method: 'POST', body: { roomCode, feature, message, privateTo } })); }
  catch (error) { return toolError(error.message); }
});

server.registerTool('issue_asymmetric_rule', {
  title: 'Evolve an identity into an asymmetric ability',
  description: 'Advance one player’s permanent archetype by exactly one pre-implemented evolution. The authoritative game server selects the next ability and makes it physical in the world; Loner evolutions deliberately contain private information.',
  inputSchema: {
    roomCode: roomCodeSchema,
    playerId: playerIdSchema,
  },
}, async ({ roomCode, playerId }) => {
  try { return toolResult(await gameRequest('/api/mcp/evolve', { method: 'POST', body: { roomCode, playerId } })); }
  catch (error) { return toolError(error.message); }
});

server.registerTool('narrate_event', {
  title: 'Narrate a Game Master event',
  description: 'Send concise, atmospheric narration that explains a visible change or gives a clue. This cannot impersonate a player or contain HTML/script content.',
  inputSchema: {
    roomCode: roomCodeSchema,
    text: z.string().trim().min(3).max(280),
    privateTo: playerIdSchema.optional(),
  },
}, async ({ roomCode, text, privateTo }) => {
  try { return toolResult(await gameRequest('/api/mcp/narrate', { method: 'POST', body: { roomCode, message: text, privateTo } })); }
  catch (error) { return toolError(error.message); }
});

server.registerTool('create_finale', {
  title: 'Create the cooperative finale',
  description: 'After every active archetype has evolved, ask the authoritative server to create the feasible, session-specific cooperative finale from the real archetypes and abilities developed this match. The model cannot invent objectives the game does not support.',
  inputSchema: {
    roomCode: roomCodeSchema,
  },
}, async ({ roomCode }) => {
  try { return toolResult(await gameRequest('/api/mcp/finale', { method: 'POST', body: { roomCode } })); }
  catch (error) { return toolError(error.message); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Emergent Game Master MCP server connected over stdio (game API: ${gameServerUrl}).`);
}

main().catch((error) => {
  console.error(`Unable to start Emergent MCP server: ${error.stack || error.message}`);
  process.exit(1);
});
