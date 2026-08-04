# Emergent / Everdawn

Everdawn is the playable pixel-art stage for **Emergent**: a shared adventure with no preset player roles or quest. A server-authoritative Game Master observes group behaviour, assigns distinct identities, evolves the world, and builds a cooperative ending around that group.

## Run the game

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run api
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in up to four browser windows, enter the same room code, and choose different names. The server observes the room for 30 seconds before assigning the unique Explorer, Collector, Guardian, and Loner identities.

For visual iteration only, use `npm.cmd run dev` and open the Vite address it prints. Use the API server for shared rooms and agent behaviour.

## Agentic Game Master

`npm.cmd run mcp` starts a stdio MCP server for an MCP host. To run the live Gemini Game Master bridge, use `npm.cmd run agent:gemini`; it starts an MCP client internally and calls Gemini for each decision cycle. It connects to the local game server by default (`http://127.0.0.1:8787`); set `EMERGENT_GAME_SERVER_URL` to change that address.

The bridge reads `GM_API_KEY` (or `GEMINI_API_KEY`) and `GM_MODEL` (or `GEMINI_MODEL`) from `.env`. `GM_API_URL` is optional: omit it for Gemini's native API, use a Gemini `generateContent` URL for native REST, or retain an OpenAI-compatible Gemini proxy URL if that is your existing setup.

Run the live stack in two terminals:

```powershell
# Terminal 1
npm.cmd run api

# Terminal 2
npm.cmd run agent:gemini
```

The bridge starts its own MCP stdio child process, lists active rooms through MCP, reads authoritative state and telemetry through MCP, asks Gemini for one safe decision, then executes that decision through an MCP tool. Do not run `npm.cmd run mcp` separately when using `agent:gemini`.

The MCP server exposes validated tools for an AI Game Master to:

- read room telemetry and world state;
- assign one unique archetype to every current player;
- narrate publicly or privately;
- reveal safe, whitelisted world features, including private paths;
- evolve an archetype; and
- create the session-specific finale.

The MCP process cannot alter the game client or execute arbitrary code. The game server validates every tool result, remains authoritative for player state, and broadcasts the resulting world changes to the room.

## Demo flow

1. Four players join the same lantern room with no assigned role.
2. They choose naturally: explore apart, gather relics, shadow another player, or take risks.
3. The server scores those behaviours and awakens four unique identities after 30 seconds.
4. Continued play evolves identities and reveals caves, bridges, vaults, shrines, private spirit paths, and portals.
5. Once identities evolve, the Ancient Temple finale requires each player’s emergent role.
