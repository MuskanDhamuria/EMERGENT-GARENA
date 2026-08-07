#!/usr/bin/env node
/**
 * Emergent Game Master MCP server.
 *
 * This process is deliberately a narrow local control-plane bridge. An AI can
 * read room context and ask for a small set of pre-built changes, but it cannot
 * run code, write game files, choose arbitrary socket events, or talk to
 * clients directly. The authoritative game server validates every request
 * again. This is not an authentication boundary: do not expose its HTTP API
 * or this MCP process to an untrusted network.
 *
 * Start the game server first, then run: npm run mcp
 * Configure an MCP client with: node /absolute/path/to/mcp-game-master.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ARCHETYPES, FEATURES, MAX_PLAYERS } from './shared/game-content.js';
import { DIRECTOR_CARD_TYPES } from './server/director-rules.mjs';
import { EMERGENT_EFFECT_IDS, EMERGENT_MARKERS, EMERGENT_TRIGGER_IDS } from './server/emergent-rules.mjs';
import { GUARDIAN_TRIALS } from './server/portal-system.mjs';

const gameServerUrl = (process.env.EMERGENT_GAME_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const REQUIRED_PLAYERS = MAX_PLAYERS;
const roomCodeSchema = z.string().trim().regex(/^[A-Za-z0-9]{4,6}$/, 'Use a 4–6 character room code.').transform((value) => value.toUpperCase());
const playerIdSchema = z.string().trim().min(1).max(128);
const archetypeSchema = z.enum(ARCHETYPES);
const archetypes = ARCHETYPES;
const featureSchema = z.enum([...FEATURES]);

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

async function roomState(roomCode) {
  const result = await gameRequest(`/api/mcp/world-state?roomCode=${encodeURIComponent(roomCode)}`);
  return result.state || result;
}

async function requireReadyRoom(roomCode) {
  const state = await roomState(roomCode);
  if (!Array.isArray(state.players) || state.players.length !== REQUIRED_PLAYERS) {
    throw new Error(`Game Master actions require exactly ${REQUIRED_PLAYERS} connected players; this room has ${state.players?.length || 0}.`);
  }
  return state;
}

function playerIn(state, playerId) {
  return state.players.find((player) => player.id === playerId);
}

const server = new McpServer({
  name: 'emergent-game-master',
  version: '1.0.0',
});

server.registerTool('list_active_rooms', {
  title: 'List active Emergent rooms',
  description: 'List live room codes, phases, and player counts. Only rooms with exactly four connected players are eligible for Game Master actions.',
  inputSchema: {},
}, async () => {
  try { return toolResult(await gameRequest('/api/mcp/rooms')); }
  catch (error) { return toolError(error.message); }
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
  description: 'Make the first identity decision only after the four-player observation period. Every connected player must receive exactly one of the four permanent archetypes. Include telemetry-grounded evidence and never reassign roles.',
  inputSchema: {
    roomCode: roomCodeSchema,
    assignments: z.array(z.object({
      playerId: playerIdSchema,
      archetype: archetypeSchema,
      evidence: z.string().trim().min(8).max(180),
    })).length(REQUIRED_PLAYERS),
  },
}, async ({ roomCode, assignments }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (state.phase !== 'observing' || Number(state.observationSecondsRemaining) > 0) {
      return toolError('Archetypes may only be assigned after the four-player observation period ends.');
    }
    if (state.players.some((player) => player.archetype)) return toolError('Archetypes have already been assigned.');
    if (!unique(assignments.map((item) => item.playerId)) || !unique(assignments.map((item) => item.archetype))) {
      return toolError('Each of the four players and each archetype must appear exactly once.');
    }
    if (!assignments.every((item) => playerIn(state, item.playerId)) || !archetypes.every((archetype) => assignments.some((item) => item.archetype === archetype))) {
      return toolError('Assignments must cover the four currently connected players and all four archetypes.');
    }
    // Evidence stays in the model's audit trail; only the authoritative identity
    // pair reaches the game server.
    const requestAssignments = assignments.map(({ playerId, archetype }) => ({ playerId, archetype }));
    return toolResult(await gameRequest('/api/mcp/assign-archetypes', { method: 'POST', body: { roomCode, assignments: requestAssignments } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('unlock_world_feature', {
  title: 'Reveal a physical world evolution',
  description: 'Reveal one validated map change after all four roles exist. The game server chooses placement. A private unlock must target one current player and is visible only to that player.',
  inputSchema: {
    roomCode: roomCodeSchema,
    feature: featureSchema,
    message: z.string().trim().min(3).max(280),
    privateTo: playerIdSchema.optional(),
  },
}, async ({ roomCode, feature, message, privateTo }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (!['evolving', 'finale'].includes(state.phase)) return toolError('World features unlock only after all four archetypes are assigned.');
    if (privateTo && !playerIn(state, privateTo)) return toolError('Private world changes must target a current player.');
    // The telemetry endpoint intentionally does not disclose another player's
    // private unlocks. Public duplicates can be rejected here; private ones are
    // left to the authoritative server for the intended recipient.
    if (!privateTo && (state.world?.unlocked || []).includes(feature)) return toolError('That public feature is already unlocked.');
    return toolResult(await gameRequest('/api/mcp/unlock', { method: 'POST', body: { roomCode, feature, message, privateTo } }));
  }
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
  try {
    const state = await requireReadyRoom(roomCode);
    const player = playerIn(state, playerId);
    if (!['evolving', 'finale'].includes(state.phase) || !player?.archetype) return toolError('Only a currently assigned player in an evolving four-player room can evolve.');
    if ((player.evolutions || []).length >= 1) return toolError('This player has reached the current evolution limit.');
    return toolResult(await gameRequest('/api/mcp/evolve', { method: 'POST', body: { roomCode, playerId } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('narrate_event', {
  title: 'Narrate a Game Master event',
  description: 'Send concise, atmospheric narration to a ready four-player room. This cannot impersonate a player or contain HTML/script content; private narration must target a current player.',
  inputSchema: {
    roomCode: roomCodeSchema,
    text: z.string().trim().min(3).max(280),
    privateTo: playerIdSchema.optional(),
  },
}, async ({ roomCode, text, privateTo }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (privateTo && !playerIn(state, privateTo)) return toolError('Private narration must target a current player.');
    return toolResult(await gameRequest('/api/mcp/narrate', { method: 'POST', body: { roomCode, message: text, privateTo } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('choose_guardian_trials', {
  title: 'Choose two Guardian portal trials',
  description: 'After observing the Guardian, choose exactly two distinct pre-authored sanctuary trials. The server locks this selection when the first portal is entered; the AI cannot invent a trial or alter completed progress.',
  inputSchema: { roomCode: roomCodeSchema, playerId: playerIdSchema, trialIds: z.array(z.enum(GUARDIAN_TRIALS.map((trial) => trial.id))).length(2) },
}, async ({ roomCode, playerId, trialIds }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (state.players.find((player) => player.id === playerId)?.archetype !== 'Guardian') return toolError('Choose trials only for the current Guardian.');
    return toolResult(await gameRequest('/api/mcp/guardian-trials', { method: 'POST', body: { roomCode, playerId, trialIds } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('apply_director_card', {
  title: 'Apply one safe AI Director rule card',
  description: 'Make one pre-authored, server-validated change to a ready four-player world. The AI cannot submit code, coordinates, arbitrary abilities, or new rules: it can only choose a whitelisted card and its documented preset values. Use world state and telemetry first; prefer one legible intervention, then wait for players to respond.',
  inputSchema: {
    roomCode: roomCodeSchema,
    card: z.enum(DIRECTOR_CARD_TYPES),
    payload: z.record(z.unknown()).default({}),
  },
}, async ({ roomCode, card, payload }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (!['evolving', 'finale'].includes(state.phase)) return toolError('Director cards are available only after all four roles have awakened.');
    return toolResult(await gameRequest('/api/mcp/director-card', { method: 'POST', body: { roomCode, card, payload } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('create_emergent_rule', {
  title: 'Create a behaviour-derived world law',
  description: 'Bind a currently observed group behaviour to one compatible, reversible effect. This is how the AI extends the game beyond its initial examples. Roles, coordinates, raw stat values, and code are never accepted; the game server selects targets from evidence and validates every combination.',
  inputSchema: {
    roomCode: roomCodeSchema,
    triggerId: z.enum(EMERGENT_TRIGGER_IDS),
    effectId: z.enum(EMERGENT_EFFECT_IDS),
    visibility: z.enum(['shared', 'participants', 'private']).default('shared'),
    markerId: z.enum(Object.keys(EMERGENT_MARKERS)).optional(),
    durationSeconds: z.number().finite().min(10).max(120).optional(),
    title: z.string().trim().min(3).max(64),
    message: z.string().trim().min(3).max(280),
  },
}, async ({ roomCode, ...directive }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (!['evolving', 'finale'].includes(state.phase)) return toolError('Emergent laws are available only after all four fixed roles have awakened.');
    return toolResult(await gameRequest('/api/mcp/emergent-rule', { method: 'POST', body: { roomCode, directive } }));
  }
  catch (error) { return toolError(error.message); }
});

server.registerTool('create_finale', {
  title: 'Create the cooperative finale',
  description: 'Only after all four assigned players have evolved, create the feasible cooperative finale from the real roles and abilities developed in this match. The model cannot invent unsupported objectives.',
  inputSchema: {
    roomCode: roomCodeSchema,
  },
}, async ({ roomCode }) => {
  try {
    const state = await requireReadyRoom(roomCode);
    if (state.finalObjective) return toolError('This room already has a finale.');
    if (state.phase !== 'evolving' || !state.players.every((player) => player.archetype && (player.evolutions || []).length > 0)) {
      return toolError('Create the finale only after every assigned player has at least one evolution.');
    }
    return toolResult(await gameRequest('/api/mcp/finale', { method: 'POST', body: { roomCode } }));
  }
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
