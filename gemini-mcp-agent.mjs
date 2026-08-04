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
  create_finale: { description: 'Only after every active player has at least one evolution and no finale exists.', args: {} },
};

function prompt(roomCode, telemetry, world) {
  return [
    'You are the living Game Master of Emergent, a cooperative adventure that discovers rules from behaviour.',
    'Never invent game mechanics. You can only choose one action from the provided action list. The MCP server validates every action again.',
    'The central ethic: observe first; make a small, legible change; narrate why; let players react; observe again. Preserve asymmetric information when it is meaningful.',
    'Do not assign roles before observation ends. Do not evolve a player twice if the state says their evolution already exists. Prefer wait if no change is warranted.',
    `Room: ${roomCode}`,
    `Authoritative telemetry: ${JSON.stringify(telemetry)}`,
    `Authoritative world state: ${JSON.stringify(world)}`,
    `Allowed actions: ${JSON.stringify(actions)}`,
    'Return strict JSON only: {"action":"wait|narrate_event|assign_archetypes|issue_asymmetric_rule|unlock_world_feature|create_finale","args":{...},"reason":"short evidence-based explanation"}.',
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
  const decision = await askGemini(prompt(roomCode, telemetry, world));
  if (!Object.hasOwn(actions, decision.action)) throw new Error(`Gemini selected an unavailable action: ${decision.action}`);
  if (decision.action === 'wait') return `waiting — ${String(decision.reason || 'the room is still revealing itself').slice(0, 140)}`;
  const result = await call(client, decision.action, { roomCode, ...(decision.args || {}) });
  return `${decision.action} — ${String(decision.reason || 'a new pattern was recognised').slice(0, 140)} (${result.ok === false ? result.error : 'applied'})`;
}

async function activeRooms(client) {
  if (requestedRoom) return [requestedRoom];
  const result = await call(client, 'list_active_rooms');
  return (result.rooms || []).map((room) => room.roomCode).filter(Boolean);
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
