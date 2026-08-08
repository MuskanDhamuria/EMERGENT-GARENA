# Emergent / Everdawn

Everdawn is the playable pixel-art stage for **Emergent**: a shared adventure with no preset player roles or quest. A server-authoritative Game Master observes group behaviour, assigns distinct identities, evolves the world, and builds a cooperative ending around that group.

For a quick map of which file owns which part of the game, see [TEAM_GUIDE.md](TEAM_GUIDE.md). Role content, special terrain, entities, and action IDs live together in `shared/game-content.js`.

## Run the game

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run api
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in exactly four browser windows, enter the same room code, and choose different names. There is no solo mode: a room remains in its lobby until all four players are connected. The 40-second observation period then begins, before the Game Master assigns the unique Explorer, Collector, Guardian, and Loner identities.

For visual iteration only, use `npm.cmd run dev` and open the Vite address it prints. Use the API server for shared rooms and agent behaviour.

## Agentic Game Master

`npm.cmd run mcp` starts a stdio MCP server for an MCP host. To run the live Gemini Game Master bridge, use `npm.cmd run agent:gemini`; it starts an MCP client internally and calls Gemini for each decision cycle. It connects to the local game server by default (`http://127.0.0.1:8787`); set `EMERGENT_GAME_SERVER_URL` to change that address.

Create a `.env` file in the project root (beside `package.json`) and add `GM_API_KEY=your_key_here`. The bridge also accepts `GEMINI_API_KEY`. The file is ignored by Git and must never be committed. `GM_MODEL` (or `GEMINI_MODEL`) can select a model. `GM_API_URL` is optional: omit it for Gemini's native API, use a Gemini `generateContent` URL for native REST, or retain an OpenAI-compatible Gemini proxy URL if that is your existing setup.

Run the live stack in two terminals:

```powershell
# Terminal 1
npm.cmd run api

# Terminal 2
npm.cmd run agent:gemini
```

The bridge starts its own MCP stdio child process, lists only rooms with exactly four connected players, reads authoritative state and telemetry through MCP, asks Gemini for one safe decision, validates its preconditions, then executes that decision through an MCP tool. Do not run `npm.cmd run mcp` separately when using `agent:gemini`.

The MCP server exposes validated tools for an AI Game Master to:

- read room telemetry and world state;
- assign all four unique archetypes to the four current players after observation;
- choose exactly two of the three expedition maps from the group's behaviour;
- adapt hostile encounters to hunt isolated players, break clustered formations, or pressure the Collector;
- narrate publicly or privately;
- reveal safe, whitelisted world features, including private paths;
- evolve an archetype;
- create the session-specific finale; and
- bind observed behaviour to a compatible, reversible emergent-rule primitive.

The MCP process cannot alter the game client or execute arbitrary code. The game server validates every tool result, remains authoritative for player state, and broadcasts the resulting world changes to the room. It is a local-development control plane, not authentication: keep the game server and MCP process on a trusted network.

## Demo flow

1. Exactly four players join the same lantern room with no assigned role; the session does not begin with fewer players.
2. They choose naturally: explore apart, gather relics, shadow another player, or take risks.
3. The Game Master interprets those signals, awakens four unique identities after 40 seconds, and chooses two expeditions that fit the group.
4. Continued play evolves identities and reveals caves, bridges, vaults, shrines, private spirit paths, and portals.
5. When a hostile expedition begins, its enemies use the AI-selected tactic while retaining the fixed 5% per-hit fairness rule.
6. The Game Master continues observing, creates reversible group-specific laws, and composes the Ancient Temple finale from the roles and abilities that actually emerged.
