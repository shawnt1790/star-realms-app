import express from "express";
import cors from "cors";
import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { ClientToServerEvents, ServerToClientEvents } from "@sr/shared";
import { RoomManager, cleanName } from "./rooms.js";

const app = express();
app.use(cors());

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = new RoomManager(io);

app.get("/health", (_req, res) => res.json({ ok: true, ...rooms.stats() }));

// Serve the built client when it exists (single-process deploys).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else {
  app.get("/", (_req, res) => res.send("StarRealms.io server is running. Try /health"));
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload, cb) => {
    const name = cleanName(payload?.name);
    const playerId = String(payload?.playerId ?? "");
    if (!name) return cb({ ok: false, error: "Name required." });
    if (!playerId) return cb({ ok: false, error: "playerId required." });
    const mode = payload.mode === "solo" ? "solo" : "private";
    const room = rooms.createRoom({ name, playerId, socketId: socket.id, mode });
    cb({ ok: true, code: room.code });
  });

  socket.on("room:join", (payload, cb) => {
    const name = cleanName(payload?.name);
    const playerId = String(payload?.playerId ?? "");
    const code = String(payload?.code ?? "")
      .trim()
      .toUpperCase();
    if (!name) return cb({ ok: false, error: "Name required." });
    if (!playerId) return cb({ ok: false, error: "playerId required." });
    if (!code) return cb({ ok: false, error: "Room code required." });
    const res = rooms.joinRoom({ code, name, playerId, socketId: socket.id });
    cb(res.ok ? { ok: true } : res);
  });

  socket.on("room:reconnect", (payload, cb) => {
    const playerId = String(payload?.playerId ?? "");
    const code = String(payload?.code ?? "").toUpperCase();
    const res = rooms.reconnect({ code, playerId, socketId: socket.id });
    cb(res.ok ? { ok: true } : res);
  });

  socket.on("room:leave", (payload, cb) => {
    rooms.leave(socket.id, String(payload?.playerId ?? ""));
    cb();
  });

  socket.on("room:start", (cb) => cb(rooms.start(socket.id)));

  socket.on("room:ready", (payload, cb) => {
    cb(rooms.setReady(socket.id, String(payload?.playerId ?? ""), Boolean(payload?.ready)));
  });

  socket.on("queue:join", (payload, cb) => {
    const name = cleanName(payload?.name);
    const playerId = String(payload?.playerId ?? "");
    if (!name) return cb({ ok: false, error: "Name required." });
    if (!playerId) return cb({ ok: false, error: "playerId required." });
    if (rooms.membership(socket.id)) return cb({ ok: false, error: "Leave your room first." });
    rooms.joinQueue({ name, playerId, socketId: socket.id });
    cb({ ok: true });
  });

  socket.on("queue:leave", (payload, cb) => {
    rooms.leaveQueue(String(payload?.playerId ?? ""));
    socket.emit("queue:status", { waiting: false });
    cb();
  });

  socket.on("game:action", (payload, cb) => {
    const action = payload?.action;
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      return cb({ ok: false, error: "Invalid action." });
    }
    cb(rooms.action(socket.id, action));
  });

  socket.on("game:view", (cb) => cb({ ok: true, view: rooms.viewFor(socket.id) }));

  socket.on("disconnect", () => rooms.disconnect(socket.id));
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`StarRealms.io server listening on :${port}`));
