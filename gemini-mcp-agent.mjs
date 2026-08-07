#!/usr/bin/env node
/**
 * Gemini Game Master agent.
 *
 * This is an MCP *client*, not another game server. It starts the constrained
 * MCP server over stdio, reads every room through MCP tools, asks Gemini for
 * one safe next move, then executes that move through the same MCP tools.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ARCHETYPES, FEATURES, MAX_PLAYERS } from './shared/game-content.js';
import { DIRECTOR_CARD_TYPES } from './server/director-rules.mjs';
import { EMERGENT_EFFECT_IDS, EMERGENT_MARKERS, EMERGENT_TRIGGER_IDS } from './server/emergent-rules.mjs';
import { GUARDIAN_TRIALS } from './server/portal-system.mjs';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv();

const key = process.env.GM_API_KEY || process.env.GEMINI_API_KEY;
const model = process.env.GM_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const pollMs = Math.max(4_000, Number(process.env.GM_AGENT_POLL_MS || 8_000));
const requestedRoom = String(process.env.EMERGENT_ROOM_CODE || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const configuredApiUrl = process.env.GM_API_URL || '';
// Gemini offers both native generateContent and an OpenAI-compatible endpoint.
// The latter lives on the same Google host, so path detection matters.
const nativeGemini = !configuredApiUrl || (!/\/openai\//i.test(configuredApiUrl) && /generativelanguage\.googleapis\.com|:generateContent/i.test(configuredApiUrl));

if (!key) {
  console.error('Missing GM_API_KEY (or GEMINI_API_KEY). Add it to .env before starting the Gemini MCP agent.');
  process.exit(1);
}

function modelUrl() {
  const configured = configuredApiUrl;
  if (configured) {
    const withModel = configured.replace('{model}', model);
    if (!nativeGemini) return withModel;
    return withModel.includes('?') ? `${withModel}&key=${encodeURIComponent(key)}` : `${withModel}?key=${encodeURIComponent(key)}`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
}

function textFrom(result) {
  const block = result?.content?.find((item) => item.type === 'text');
  try { return JSON.parse(block?.text || '{}'); } catch { return {}; }
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.[0]?.text || `MCP tool ${name} failed.`);
  return textFrom(result);
}

const actions = {
  wait: { description: 'No action is warranted; return a short atmospheric reason.', args: {} },
  narrate_event: { description: 'Narrate one concise public or private clue that reflects a visible change or observed behaviour.', args: { text: 'string', privateTo: 'optional player id' } },
  assign_archetypes: { description: 'Only if phase is observing and the observation timer is zero. Assign every player exactly once, using all four distinct archetypes when four players exist.', args: { assignments: '[{playerId, archetype, evidence}]' } },
  issue_asymmetric_rule: { description: 'Evolve one player only after archetypes exist. It reveals that player’s next validated evolution; use a player id from state.', args: { playerId: 'string' } },
  unlock_world_feature: { description: 'Reveal one feature from the allowed list only when it follows the observed group identity. Features: hidden-cave, secret-path, invisible-bridge, forgotten-ruins, relic-vault, evolving-artifacts, treasure-cache, healing-shrine, protective-barrier, revival-monument, spirit-realm, illusion-passage, hidden-portal, ancient-temple, final-gate.', args: { feature: 'string', message: 'string', privateTo: 'optional player id' } },
  create_emergent_rule: { description: `Create one novel, reversible law from observed behaviour. The server selects players from evidence and rejects incompatible combinations. Triggers: ${EMERGENT_TRIGGER_IDS.join('|')}. Effects: ${EMERGENT_EFFECT_IDS.join('|')}. Visibility: shared|participants|private. Markers when required: ${Object.keys(EMERGENT_MARKERS).join('|')}. Provide title, message, optional markerId, optional durationSeconds 10-120. Use only after its trigger is visibly evidenced in telemetry/world state.`, args: { triggerId: 'string', effectId: 'string', visibility: 'shared|participants|private', markerId: 'optional string', durationSeconds: 'optional number', title: 'string', message: 'string' } },
  apply_director_card: { description: 'Use exactly one authored intervention card after roles awaken. Cards and payload presets: private_hint {playerId,message}; unlock_shortcut {shortcutId:moss_trail|lantern_path|warden_way|veil_passage}; role_request {requestId:explorer_scout|collector_recover|guardian_watch|loner_omen}; cooperation_request {roles:[2-4 roles],title,message}; world_mood {moodId:dawn|mist|storm|starlight}; temporary_boon {playerId,boonId:guiding_light|swift_step|shared_sight}; temporary_obstacle {obstacleId:mist_bank|echo_current|fallen_leaves}; story_turn {turnId:shrine_or_vault|path_or_veil,optionId:the AI-selected option}; finale_variant {variantId:lantern_rite|echo_accord|wardens_promise}. The AI resolves story turns immediately; players cannot vote. Never invent other values.', args: { card: 'string', payload: 'object with only that card\'s documented presets' } },
  choose_guardian_trials: { description: `After the Guardian evolves but before entering a portal, choose exactly two different trials from: ${GUARDIAN_TRIALS.map((trial) => trial.id).join('|')}. Base this on the Guardian's observed cohesion, movement and rescues.`, args: { playerId: 'Guardian player id', trialIds: '[exactly two valid trial ids]' } },
  create_finale: { description: 'Only after every active player has at least one evolution and no finale exists.', args: {} },
};

const REQUIRED_PLAYERS = MAX_PLAYERS;

function validText(value, min = 1, max = 280) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function validPrivateAudience(state, playerId) {
  return playerId === undefined || state.players.some((player) => player.id === playerId);
}

// Keep model output from becoming a request merely because it is valid JSON.
// The MCP server repeats these checks immediately before its own request, so a
// room changing between this read and the call remains safe.
function validateDecision(decision, state) {
  if (!decision || typeof decision !== 'object' || !Object.hasOwn(actions, decision.action)) return 'The model selected an unavailable action.';
  if (!Array.isArray(state.players) || state.players.length !== REQUIRED_PLAYERS) return 'This room no longer has exactly four connected players.';
  const args = decision.args && typeof decision.args === 'object' && !Array.isArray(decision.args) ? decision.args : {};
  const players = state.players;
  if (decision.action === 'wait') return null;
  if (decision.action === 'narrate_event') return validText(args.text, 3) && validPrivateAudience(state, args.privateTo) ? null : 'Narration needs valid text and an optional current-player audience.';
  if (decision.action === 'assign_archetypes') {
    const entries = args.assignments;
    const ids = entries?.map((entry) => entry.playerId) || [];
    const roles = entries?.map((entry) => entry.archetype) || [];
    const ready = state.phase === 'observing' && Number(state.observationSecondsRemaining) <= 0;
    const allFourRoles = ARCHETYPES.every((role) => roles.includes(role));
    return ready && !players.some((player) => player.archetype) && entries?.length === REQUIRED_PLAYERS
      && new Set(ids).size === REQUIRED_PLAYERS && new Set(roles).size === REQUIRED_PLAYERS
      && ids.every((id) => players.some((player) => player.id === id)) && allFourRoles
      && entries.every((entry) => validText(entry.evidence, 8, 180)) ? null : 'Archetype assignment is not currently valid for this room.';
  }
  if (decision.action === 'issue_asymmetric_rule') {
    const player = players.find((item) => item.id === args.playerId);
    return ['evolving', 'finale'].includes(state.phase) && player?.archetype && (player.evolutions || []).length < 1 ? null : 'That evolution is not currently valid.';
  }
  if (decision.action === 'unlock_world_feature') {
    const publicDuplicate = !args.privateTo && (state.world?.unlocked || []).includes(args.feature);
    return ['evolving', 'finale'].includes(state.phase) && FEATURES.has(args.feature) && validText(args.message, 3)
      && validPrivateAudience(state, args.privateTo) && !publicDuplicate ? null : 'That world unlock is not currently valid.';
  }
  if (decision.action === 'create_emergent_rule') {
    const compatible = {
      tether_energy: ['exclusive_pair'], private_marker: ['explorer_travel', 'loner_isolation'],
      shared_marker: EMERGENT_TRIGGER_IDS, group_altar: ['collector_relics'], recovery_aura: ['guardian_cohesion'],
      movement_boon: ['explorer_travel', 'loner_isolation'],
    };
    const allowedVisibility = {
      tether_energy: ['shared', 'participants'], private_marker: ['private'], shared_marker: ['shared', 'participants'],
      group_altar: ['shared', 'participants'], recovery_aura: ['shared', 'participants'], movement_boon: ['private', 'participants'],
    };
    const markerNeeded = ['private_marker', 'shared_marker'].includes(args.effectId);
    return ['evolving', 'finale'].includes(state.phase) && compatible[args.effectId]?.includes(args.triggerId)
      && allowedVisibility[args.effectId]?.includes(args.visibility || 'shared')
      && validText(args.title, 3, 64) && validText(args.message, 3, 280)
      && (!markerNeeded || Object.hasOwn(EMERGENT_MARKERS, args.markerId))
      && (!args.durationSeconds || (Number.isFinite(args.durationSeconds) && args.durationSeconds >= 10 && args.durationSeconds <= 120))
      ? null : 'That emergent-law combination is not currently valid.';
  }
  if (decision.action === 'apply_director_card') {
    return ['evolving', 'finale'].includes(state.phase) && DIRECTOR_CARD_TYPES.includes(args.card)
      && args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload) ? null : 'That director card is not currently valid.';
  }
  if (decision.action === 'choose_guardian_trials') {
    const guardian = players.find((player) => player.id === args.playerId && player.archetype === 'Guardian');
    return ['evolving', 'finale'].includes(state.phase) && guardian && Array.isArray(args.trialIds) && args.trialIds.length === 2
      && new Set(args.trialIds).size === 2 && args.trialIds.every((id) => GUARDIAN_TRIALS.some((trial) => trial.id === id)) ? null : 'Choose two valid trials for the evolved Guardian.';
  }
  if (decision.action === 'create_finale') {
    return state.phase === 'evolving' && !state.finalObjective
      && players.every((player) => player.archetype && (player.evolutions || []).length > 0) ? null : 'The four-player finale is not ready.';
  }
  return 'The model decision could not be validated.';
}

function prompt(roomCode, telemetry, world) {
  return [
    'You are the living Game Master of Emergent, a four-player-only cooperative adventure that discovers rules from behaviour.',
    'Never invent code, roles, coordinates, raw stat values, or effects outside the safe primitive catalog. You can choose one action from the provided action list, including a compatible behaviour-to-effect combination. The MCP server validates every action again.',
    'The central ethic: observe first; make a small, legible change; narrate why; let players react; observe again. Preserve asymmetric information when it is meaningful.',
    'Act only while exactly four connected players are shown. Do not assign roles before observation ends. Do not evolve a player beyond its available evolution steps. Prefer wait if no change is warranted.',
    `Room: ${roomCode}`,
    `Authoritative telemetry: ${JSON.stringify(telemetry)}`,
    `Authoritative world state: ${JSON.stringify(world)}`,
    `Allowed actions: ${JSON.stringify(actions)}`,
    'Return strict JSON only: {"action":"wait|narrate_event|assign_archetypes|issue_asymmetric_rule|unlock_world_feature|create_emergent_rule|apply_director_card|choose_guardian_trials|create_finale","args":{...},"reason":"short evidence-based explanation"}.',
  ].join('\n');
}

async function askGemini(instruction) {
  const nativeBody = {
    systemInstruction: { parts: [{ text: 'You are a safe, concise game-master decision engine. Output only JSON.' }] },
    contents: [{ role: 'user', parts: [{ text: instruction }] }],
    generationConfig: { temperature: 0.35, responseMimeType: 'application/json', maxOutputTokens: 550 },
  };
  const compatibleBody = {
    model, temperature: 0.35, max_tokens: 550, reasoning_effort: 'low', response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a safe, concise game-master decision engine. Output only JSON.' },
      { role: 'user', content: instruction },
    ],
  };
  const response = await fetch(modelUrl(), {
    method: 'POST',
    headers: nativeGemini ? { 'Content-Type': 'application/json', 'x-goog-api-key': key } : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(nativeGemini ? nativeBody : compatibleBody),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const raw = nativeGemini
    ? data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '{}'
    : data?.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(raw); } catch { throw new Error('Gemini did not return valid decision JSON.'); }
}

async function decideRoom(client, roomCode) {
  const telemetry = await call(client, 'get_player_telemetry', { roomCode });
  const world = await call(client, 'get_world_state', { roomCode });
  const state = world.state || world;
  if (!Array.isArray(state.players) || state.players.length !== REQUIRED_PLAYERS) return 'waiting - room is not ready with four connected players';
  const decision = await askGemini(prompt(roomCode, telemetry, world));
  const rejection = validateDecision(decision, state);
  if (rejection) return `waiting - ${rejection}`;
  if (decision.action === 'wait') return `waiting — ${String(decision.reason || 'the room is still revealing itself').slice(0, 140)}`;
  const result = await call(client, decision.action, { roomCode, ...(decision.args || {}) });
  return `${decision.action} — ${String(decision.reason || 'a new pattern was recognised').slice(0, 140)} (${result.ok === false ? result.error : 'applied'})`;
}

async function activeRooms(client) {
  const result = await call(client, 'list_active_rooms');
  return (result.rooms || [])
    .filter((room) => room.roomCode && room.playerCount === REQUIRED_PLAYERS && (!requestedRoom || room.roomCode === requestedRoom))
    .map((room) => room.roomCode);
}

async function main() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-game-master.mjs')], stderr: 'pipe' });
  const client = new Client({ name: 'emergent-gemini-agent', version: '1.0.0' });
  await client.connect(transport);
  console.log(`Gemini Game Master connected to MCP. Model: ${model}. Polling every ${pollMs / 1000}s.`);
  let cycleInFlight = false;
  const tick = async () => {
    if (cycleInFlight) return;
    cycleInFlight = true;
    try {
      const rooms = await activeRooms(client);
      for (const roomCode of rooms) console.log(`[${new Date().toLocaleTimeString()}] ${roomCode}: ${await decideRoom(client, roomCode)}`);
    } catch (error) { console.error(`Game Master cycle failed: ${error.message}`); }
    finally { cycleInFlight = false; }
  };
  await tick();
  setInterval(tick, pollMs);
}

main().catch((error) => { console.error(`Unable to start Gemini MCP agent: ${error.stack || error.message}`); process.exit(1); });
