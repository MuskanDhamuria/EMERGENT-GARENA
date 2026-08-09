# Emergent 

Emergent is a server-authoritative, four-player cooperative adventure. Players begin without roles. A constrained AI Game Master observes their behaviour, assigns the unique Explorer, Collector, Guardian, and Loner roles, selects missions and adaptations, and helps compose one of two finales. 

## Requirements

- Node.js 22 or newer
- npm
- Four browser windows or four devices on the same network
- Google Gemini API key for the live AI Game Master

## Setup

Clone the repository, open PowerShell in its root, and install dependencies:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run api
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). For other devices on the same network, use the `LAN` address printed by the server. Open exactly four clients, enter the same 4–6 character room code, and use different player names.

The fourth player begins a 40-second observation period. For faster local testing:

```powershell
$env:GAME_TEST_OBSERVATION_MS="3000"
npm.cmd run api
```

If port 8787 is already occupied, stop the existing server or select another port:

```powershell
$env:PORT="8788"
npm.cmd run api
```

### Development and previews

```powershell
npm.cmd run dev       # Vite development client
npm.cmd run build     # Production build
npm.cmd run preview   # Preview the production build
npm.cmd run api       # Authoritative game and Socket.IO server
```

`npm.cmd run dev` proxies `/api` and `/socket.io` to the game server on port 8787, so run `npm.cmd run api` in a second terminal for multiplayer play. The production server serves `dist/`, the API, and Socket.IO together.


### Tests

```powershell
npm.cmd run test:full
```

Individual suites are available through `test:emergent`, `test:guidance`, `test:input`, `test:explorer`, `test:realms`, `test:collector`, and `test:lantern`.

## Architecture overview

The game follows a server-authoritative design:

```text
Four browser clients
  ├─ Canvas renderer, input, music, local puzzle presentation
  └─ Socket.IO intents and synchronized state
                    │
                    ▼
Node HTTP + Socket.IO server (authoritative)
  ├─ room lifecycle, movement, combat and telemetry
  ├─ role, mission, realm and finale systems
  ├─ validation and deterministic AI fallbacks
  └─ constrained HTTP control plane
                    ▲
                    │
Gemini agent → local MCP client/server → validated game tools
```

Important files and ownership:

- `client/session.js` manages browser state, input and Socket.IO communication.
- `client/renderer.js` renders the canvas and all realms, HUDs, finales and recap screens.
- `client/music.js` chooses landing, mission, finale and ending music.
- `server.mjs` serves the application, creates Socket.IO, and runs the 100 ms authoritative tick.
- `server/game-world.mjs` owns rooms, players, serialization, telemetry, role evolution and progression.
- `server/socket-gateway.mjs` translates socket messages into validated world actions.
- `server/*-system.mjs` contains isolated Collector, Guardian, Loner realm, encounter and finale rules.
- `shared/game-content.js` is the shared catalog of roles, entities, features, abilities and timings.
- `mcp-game-master.mjs` exposes a narrow set of validated Game Master tools over stdio MCP.
- `gemini-mcp-agent.mjs` reads authoritative telemetry, requests one model decision, validates it locally, and invokes one MCP tool.
- `public/game-art` and `public/audio` contain runtime media; the Vite plugin copies these curated directories into `dist`.


## Game Master prompt and agent configuration

The live agent is optional. Without it, the server assigns roles and uses authored, behaviour-based fallbacks. With it, start the stack in two terminals:

```powershell
# Terminal 1
npm.cmd run api

# Terminal 2
npm.cmd run agent:gemini
```

Create a `.env` file beside `package.json`(You can duplicate `.env.example`).

The complete runtime prompt is assembled by `prompt()` in `gemini-mcp-agent.mjs`. Its central instructions are:

- act as a safe decision engine for a four-player-only cooperative world;
- observe first, make one small and legible change, narrate why, then observe again;
- act only with exactly four connected players and wait until observation ends before assigning roles;
- prioritize pending mechanical decisions over decorative narration;
- treat destinations fairly and base choices on supplied telemetry;
- return strict JSON containing one `action`, its `args`, and a short evidence-based `reason`.

The agent uses a system instruction of “safe, concise game-master decision engine” and JSON-only output. Default generation settings are temperature `0.35`, a maximum of `550` output tokens, and the `gemini-3-flash-preview` model. Every result is checked by `validateDecision()` and then validated again by the MCP and authoritative game server. Permitted actions include role assignment, expedition selection, encounter adaptation, narration, safe feature unlocks, role evolution, Guardian/Loner mission selection, authored director cards, reversible emergent rules, and finale creation.

Run `npm.cmd run mcp` only when connecting a separate MCP host. The Gemini bridge starts its own MCP subprocess and does not require a separately running MCP command.

## Third-party disclosures

### Libraries and tools

- [Socket.IO](https://socket.io/) and `socket.io-client` provide real-time multiplayer transport.
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) provides the constrained local AI tool interface.
- [Zod](https://zod.dev/) validates MCP tool arguments.
- [Three.js](https://threejs.org/) is installed as a runtime dependency; the current primary presentation is Canvas 2D.
- [Vite](https://vite.dev/) builds and serves the client during development.
- [Playwright](https://playwright.dev/) supports browser and smoke testing.

Exact versions are recorded in `package-lock.json`; declared compatible ranges are in `package.json`.

### Models and APIs

- The live Game Master calls the [Google Gemini API](https://ai.google.dev/gemini-api/docs). Its default model is `gemini-3-flash-preview`.


### Art and audio

- `public/game-art/retro-characters` uses the Super Retro World collection. Its bundled licence requires credit to Gif (`@gif_not_jif`), Noiracide (`@Noiracide`), and Romi (`@DessRomaric`), permits commercial use and modification, and prohibits redistribution of the assets themselves. See the bundled `LICENCE.txt` and `CREDITS.txt`.
- `public/game-art/dark-cave` includes a link to the [CraftPix licence](https://craftpix.net/file-licenses/). 
- `public/game-art/moon-shrine` includes an author note identifying the assets as free for commercial use with optional credit and links to Anokolisa’s Patreon.
- Mission music is the supplied `white_records-8-bit-background-music-for-arcade-game-come-on-mario-164702.mp3`, stored in the build as `public/audio/missions.mp3`.
- Playable-finale music is the supplied `paulyudin-game-game-music-573991.mp3`, stored as `public/audio/finale.mp3`.
- Landing and post-finale music are stored as `public/audio/landing.mp3` and `public/audio/ending.mp3` from user-supplied source files.


## Gameplay flow

1. Exactly four players join one room.
2. The server observes movement, proximity, collection, exploration, rescues and risk-taking for 40 seconds.
3. Four unique roles awaken, and two role-relevant mission paths are selected.
4. Players complete the Explorer, Collector, Guardian and Loner content while the world records their decisions.
5. After all required missions, a shared portal appears in the centre of the original map.
6. All four players enter either a cooperative or competitive multiplayer finale.
7. Everyone sees the same post-finale recap built from the authoritative session record, then returns to the landing page.
