import { MAX_PLAYERS } from '../shared/game-content.js';

// Socket.IO adapter.  It owns connection lifecycle only; game decisions are
// delegated to the supplied world API.
export function attachSocketGateway(io, world) {
  io.on('connection', (socket) => {
    socket.on('join-room', ({ roomCode, name } = {}, callback = () => {}) => {
      const code = String(roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6), cleanName = world.cleanText(name, '', 16);
      if (code.length < 4 || !cleanName) { callback({ ok: false, error: 'Enter a 4–6 character room code and a name.' }); return; }
      const room = world.rooms.get(code) || world.createRoom(code); if (!world.rooms.has(code)) world.rooms.set(code, room);
      if (room.players.size >= MAX_PLAYERS) { callback({ ok: false, error: `This adventure already has ${MAX_PLAYERS} players.` }); return; }
      if (room.phase !== 'waiting-for-four' && room.players.size) { callback({ ok: false, error: 'This adventure is already in progress.' }); return; }
      socket.join(code); socket.data.roomCode = code; const player = world.createPlayer(socket.id, cleanName, room.players.size); room.players.set(socket.id, player);
      world.event(room, 'player-joined', `${player.name} lit a lantern (${room.players.size}/${MAX_PLAYERS}).`); if (room.players.size === MAX_PLAYERS) world.beginObservation(room);
      callback({ ok: true, code, playerId: socket.id, requiredPlayers: MAX_PLAYERS, observationSeconds: room.observationEndsAt ? world.observationMs / 1000 : null }); world.broadcastState(room);
    });
    socket.on('move', ({ x, z } = {}) => { const room = world.rooms.get(socket.data.roomCode), player = room && world.getPlayer(room, socket.id); if (player && ['observing', 'evolving', 'finale'].includes(room.phase)) { player.inputX = world.clamp(x, -1, 1); player.inputZ = world.clamp(z, -1, 1); } });
    socket.on('player-telemetry', (payload = {}) => { const room = world.rooms.get(socket.data.roomCode), player = room && world.getPlayer(room, socket.id); if (!player) return; world.recordTelemetry(room, player, payload); world.broadcastState(room); });
    socket.on('interact', ({ type, targetId } = {}, callback = () => {}) => { const room = world.rooms.get(socket.data.roomCode), player = room && world.getPlayer(room, socket.id); const result = room && player ? world.interact(room, player, type, targetId) : { ok: false, error: 'Join a room first.' }; callback(result); if (room) world.broadcastState(room); });
    socket.on('request-world-state', () => { const room = world.rooms.get(socket.data.roomCode); if (room) socket.emit('world-state', world.serializeRoom(room, socket.id)); });
    socket.on('disconnect', () => { const room = world.rooms.get(socket.data.roomCode); if (!room) return; const player = room.players.get(socket.id); room.players.delete(socket.id); if (!room.players.size) { world.rooms.delete(room.code); return; } world.resetRoomForRoster(room, 'A lantern went out. Four players are needed to begin a new shared tale.'); world.event(room, 'player-left', `${player?.name || 'A wanderer'} left the world. The adventure is waiting for four lanterns again.`); world.broadcastState(room); });
  });
}
