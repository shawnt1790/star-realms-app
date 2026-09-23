// Socket.IO event contracts shared by the client and server.

import type { GameVariant, GameView, PlayerAction } from "./game/types.js";

export type RoomCode = string;

export type RoomMode = "private" | "solo" | "quick";
export type RoomStatus = "lobby" | "in_game" | "finished";

/** Table size and variant; defaults (2 players, free-for-all) match the classic duel. */
export type TableOptions = { maxPlayers?: number; variant?: GameVariant };

export type PlayerSummary = {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
};

export type RoomState = {
  code: RoomCode;
  mode: RoomMode;
  status: RoomStatus;
  maxPlayers: number;
  variant: GameVariant;
  players: PlayerSummary[];
  /** Player id of the winner once the game is finished. */
  winnerId: string | null;
};

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export type ClientToServerEvents = {
  "room:create": (
    payload: { name: string; playerId: string; mode?: "private" | "solo" } & TableOptions,
    cb: Ack<{ code: RoomCode }>,
  ) => void;
  "room:join": (payload: { code: RoomCode; name: string; playerId: string }, cb: Ack) => void;
  "room:reconnect": (payload: { code: RoomCode; playerId: string }, cb: Ack) => void;
  "room:leave": (payload: { playerId: string }, cb: () => void) => void;
  "room:start": (cb: Ack) => void;
  "room:ready": (payload: { playerId: string; ready: boolean }, cb: Ack) => void;

  "queue:join": (payload: { name: string; playerId: string } & TableOptions, cb: Ack) => void;
  "queue:leave": (payload: { playerId: string }, cb: () => void) => void;

  "game:action": (payload: { action: PlayerAction }, cb: Ack) => void;
  "game:view": (cb: Ack<{ view: GameView | null }>) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: { room: RoomState }) => void;
  "game:state": (payload: { view: GameView }) => void;
  /** `needed`: how many more players the queue needs before a game starts. */
  "queue:status": (payload: { waiting: boolean; needed?: number }) => void;
  "error:toast": (payload: { message: string }) => void;
};
