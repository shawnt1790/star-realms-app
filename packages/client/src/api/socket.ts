import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@sr/shared";

// Same-origin by default so a single-process deploy (server serving the client
// build) needs no configuration. Override with VITE_SERVER_URL in dev.
const URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
});
