import express from "express";
import cors from "cors";
import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";

import type { ClientToServerEvents, ServerToClientEvents, RoomCode, RoomState } from "@sr/shared";

const app = express();
app.use(cors());

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

type Player = {
  playerId: string;
  name: string;
  socketId: string | null;
  connected: boolean;
};

type Room = {
  code: RoomCode;
  status: "lobby" | "in_game";
  hostPlayerId: string;
  players: Map<string, Player>; // key: playerId
};

const rooms = new Map<RoomCode, Room>();

function makeCode(len = 4): RoomCode {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function createRoomCode(): RoomCode {
  for (let i = 0; i < 1000; i++) {
    const code = makeCode(4);
    if (!rooms.has(code)) return code;
  }
  return makeCode(6);
}

function emitRoomState(room: Room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.playerId,
    name: p.name,
    isHost: p.playerId === room.hostPlayerId,
    connected: p.connected,
  }));

  const state: RoomState = {
    code: room.code,
    status: room.status,
    players,
  };

  io.to(room.code).emit("room:state", { room: state });
}

function getSocketRoomCode(socketRooms: Set<string>, socketId: string): RoomCode | null {
  const code = Array.from(socketRooms).find((r) => r !== socketId) as RoomCode | undefined;
  return code ?? null;
}

function isHost(room: Room, playerId: string) {
  return room.hostPlayerId === playerId;
}

function ensureHost(room: Room) {
  if (room.players.size === 0) return;

  // if current host still exists, do nothing
  if (room.players.has(room.hostPlayerId)) return;

  // otherwise pick the first remaining player
  const next = room.players.values().next().value as Player | undefined;
  if (next) room.hostPlayerId = next.playerId;
}

function promoteHostIfHostDisconnected(room: Room, disconnectedPlayerId: string) {
  if (room.hostPlayerId !== disconnectedPlayerId) return;

  // Prefer a connected replacement
  const connectedAlt = Array.from(room.players.values()).find(
    (p) => p.playerId !== disconnectedPlayerId && p.connected,
  );
  if (connectedAlt) {
    room.hostPlayerId = connectedAlt.playerId;
    return;
  }

  // Otherwise, any remaining player
  ensureHost(room);
}

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("room:create", ({ name, playerId }, cb) => {
    const clean = name.trim();
    if (!clean) return cb({ ok: false, error: "Name required" });
    if (!playerId) return cb({ ok: false, error: "playerId required" });

    const code = createRoomCode();

    const room: Room = {
      code,
      status: "lobby",
      hostPlayerId: playerId,
      players: new Map(),
    };

    room.players.set(playerId, {
      playerId,
      name: clean,
      socketId: socket.id,
      connected: true,
    });

    rooms.set(code, room);
    socket.join(code);
    emitRoomState(room);

    cb({ ok: true, code });
  });

  socket.on("room:join", ({ code, name, playerId }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found" });
    if (room.status !== "lobby") return cb({ ok: false, error: "Room already started" });

    const clean = name.trim();
    if (!clean) return cb({ ok: false, error: "Name required" });
    if (!playerId) return cb({ ok: false, error: "playerId required" });

    // MVP: 2 players max, but allow re-join if same playerId
    if (!room.players.has(playerId) && room.players.size >= 2) {
      return cb({ ok: false, error: "Room full (2 players MVP)" });
    }

    room.players.set(playerId, {
      playerId,
      name: clean,
      socketId: socket.id,
      connected: true,
    });

    socket.join(code);
    emitRoomState(room);

    cb({ ok: true });
  });

  socket.on("room:reconnect", ({ code, playerId }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found" });

    const p = room.players.get(playerId);
    if (!p) return cb({ ok: false, error: "Player not in room" });

    p.socketId = socket.id;
    p.connected = true;

    socket.join(code);
    emitRoomState(room);

    cb({ ok: true });
  });

  socket.on("room:leave", ({ playerId }, cb) => {
    const code = getSocketRoomCode(socket.rooms, socket.id);
    if (!code) return cb();

    const room = rooms.get(code);
    if (!room) return cb();

    room.players.delete(playerId);
    socket.leave(code);

    ensureHost(room);

    if (room.players.size === 0) rooms.delete(code);
    else emitRoomState(room);

    cb();
  });

  socket.on("room:start", (cb) => {
    const code = getSocketRoomCode(socket.rooms, socket.id);
    if (!code) return cb({ ok: false, error: "Not in a room" });

    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found" });

    // identify player by socketId
    const me = Array.from(room.players.values()).find((p) => p.socketId === socket.id) ?? null;
    if (!me) return cb({ ok: false, error: "Player not in room" });

    if (!isHost(room, me.playerId)) return cb({ ok: false, error: "Only the host can start" });
    if (room.status !== "lobby") return cb({ ok: false, error: "Already started" });
    if (room.players.size !== 2) return cb({ ok: false, error: "Need 2 players to start" });

    room.status = "in_game";
    emitRoomState(room);

    cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = getSocketRoomCode(socket.rooms, socket.id);
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    // find player by socketId
    const player = Array.from(room.players.values()).find((p) => p.socketId === socket.id);
    if (!player) return;

    player.connected = false;
    player.socketId = null;

    promoteHostIfHostDisconnected(room, player.playerId);
    emitRoomState(room);

    // Room is NOT deleted on disconnect; it closes only when everyone leaves (size==0).
    // (Later you can add a cleanup timer to delete rooms that are fully disconnected for too long.)
  });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`server listening on :${port}`));
