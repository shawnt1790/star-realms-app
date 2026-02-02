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
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

type Room = {
  code: RoomCode;
  status: "lobby" | "in_game";
  hostSocketId: string;
  players: Map<string, { id: string; name: string; connected: boolean }>; // key: socket.id
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
  const players = Array.from(room.players.entries()).map(([socketId, p]) => ({
    id: p.id,
    name: p.name,
    isHost: socketId === room.hostSocketId,
    connected: p.connected,
  }));

  const state: RoomState = {
    code: room.code,
    status: room.status,
    players,
  };

  io.to(room.code).emit("room:state", { room: state });
}

function findSocketRoomCode(socketRooms: Set<string>): RoomCode | null {
  for (const r of socketRooms) {
    // socket.rooms always includes socket.id; the “other” one is our game room code
    if (r.length >= 4 && r !== Array.from(socketRooms)[0]) return r as RoomCode;
  }
  // safer way:
  for (const r of socketRooms) {
    if (r !== (r as unknown as string)) continue;
  }
  return null;
}

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("room:create", ({ name }, cb) => {
    const clean = name.trim();
    if (!clean) return cb({ ok: false, error: "Name required" });

    const code = createRoomCode();

    const room: Room = {
      code,
      status: "lobby",
      hostSocketId: socket.id,
      players: new Map(),
    };

    room.players.set(socket.id, { id: socket.id, name: clean, connected: true });
    rooms.set(code, room);

    socket.join(code);
    emitRoomState(room);

    cb({ ok: true, code });
  });

  socket.on("room:join", ({ code, name }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: "Room not found" });
    if (room.status !== "lobby") return cb({ ok: false, error: "Room already started" });
    if (room.players.size >= 2) return cb({ ok: false, error: "Room full (2 players MVP)" });

    const clean = name.trim();
    if (!clean) return cb({ ok: false, error: "Name required" });

    room.players.set(socket.id, { id: socket.id, name: clean, connected: true });

    socket.join(code);
    emitRoomState(room);

    cb({ ok: true });
  });

  socket.on("room:leave", (cb) => {
    // Find room code by checking which rooms the socket is in (excluding its own id)
    const code = Array.from(socket.rooms).find((r) => r !== socket.id) as RoomCode | undefined;
    if (!code) {
      cb();
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      cb();
      return;
    }

    room.players.delete(socket.id);
    socket.leave(code);

    if (room.hostSocketId === socket.id) {
      io.to(code).emit("error:toast", { message: "Host left. Room closed." });
      rooms.delete(code);
      cb();
      return;
    }

    if (room.players.size === 0) rooms.delete(code);
    else emitRoomState(room);

    cb();
  });

  socket.on("disconnect", () => {
    const code = Array.from(socket.rooms).find((r) => r !== socket.id) as RoomCode | undefined;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.hostSocketId === socket.id) {
      io.to(code).emit("error:toast", { message: "Host disconnected. Room closed." });
      rooms.delete(code);
      return;
    }

    if (room.players.size === 0) rooms.delete(code);
    else emitRoomState(room);
  });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`server listening on :${port}`));
