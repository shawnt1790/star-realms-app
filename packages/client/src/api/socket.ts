import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@sr/shared";

const URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
});
