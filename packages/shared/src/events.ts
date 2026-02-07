export type RoomCode = string;

export type PlayerSummary = {
  id: string; // playerID
  name: string;
  isHost: boolean;
  connected: boolean;
};

export type RoomState = {
  code: RoomCode;
  status: "lobby" | "in_game";
  players: PlayerSummary[];
};

export type ClientToServerEvents = {
  "room:create": (
    payload: { name: string; playerId: string },
    cb: (res: { ok: true; code: RoomCode } | { ok: false; error: string }) => void,
  ) => void;

  "room:join": (
    payload: { code: RoomCode; name: string; playerId: string },
    cb: (res: { ok: true } | { ok: false; error: string }) => void,
  ) => void;

  "room:reconnect": (
    payload: { code: RoomCode; playerId: string },
    cb: (res: { ok: true } | { ok: false; error: string }) => void
  ) => void;
  
  "room:leave": (payload: { playerId: string }, cb: () => void) => void;

  "room:start": (cb: (res: { ok: true } | { ok: false; error: string }) => void) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: { room: RoomState }) => void;
  "error:toast": (payload: { message: string }) => void;
};
