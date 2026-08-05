# Everdawn teammate guide

The project is split by responsibility so a change has one clear home.

| You want to change… | Edit this file | Notes |
| --- | --- | --- |
| A role, its ability, a special route, relic placement, evolution reward, or an interaction ID | `shared/game-content.js` | Shared source of truth for browser and server. Use server-world coordinates (`x`, `z`). |
| Server rules, collision enforcement, room phases, or telemetry | `server.mjs` | This is the only authority for game state. Never enforce a rule only in the client. |
| Socket connection lifecycle and socket event wiring | `server/socket-gateway.mjs` | Keep this transport adapter thin; delegate every decision to the supplied world API. |
| Game Master HTTP routes and request parsing | `server/mcp-router.mjs` | This translates HTTP into world calls; it should not contain role rules. |
| Browser startup, keyboard controls, and the join form | `scene.js` | This is intentionally a thin composition root. |
| Browser state, Socket.IO events, server input, and interaction selection | `client/session.js` | It knows no drawing code. |
| Canvas map, HUD, entity, terrain, and player drawing | `client/renderer.js` | It receives render-ready session data and knows no socket code. |
| Available Game Master tools and their input validation | `mcp-game-master.mjs` | Keep tool preconditions aligned with the server. |
| Gemini's decision loop and its output validation | `gemini-mcp-agent.mjs` | It chooses only among MCP tools. |
| How to run the game | `README.md` | Update this whenever player-count or startup behaviour changes. |

## Adding a role-gated object

1. Add an entry to `ENTITY_DEFINITIONS` in `shared/game-content.js`.
2. If it needs special traversal, add a matching `TERRAIN_OVERLAYS` entry and ability in `ROLE_ABILITIES`.
3. Add its interaction ID to `ENTITY_ACTIONS` and the matching validation in `server.mjs`.
4. The client renders it automatically from the server snapshot; only add custom drawing in `scene.js` if it needs a new visual type.

## Rule of thumb

Game content belongs in `shared/`, game truth belongs on the server, and presentation belongs in the client.  Avoid copying role names, coordinates, or action IDs into more than one file.
