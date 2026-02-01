import express from "express";
import cors from "cors";
import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";

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

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("disconnect", (data) => {
    console.log("socket disconnected:", socket.id, data);
  });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`server listening on :${port}`));
