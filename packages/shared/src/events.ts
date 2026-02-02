export type RoomCode = string;

export type PlayerSummary = {
  id: string; // we’ll use socket.id for now
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
    payload: { name: string },
    cb: (res: { ok: true; code: RoomCode } | { ok: false; error: string }) => void,
  ) => void;

  "room:join": (
    payload: { code: RoomCode; name: string },
    cb: (res: { ok: true } | { ok: false; error: string }) => void,
  ) => void;

  "room:leave": (cb: () => void) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: { room: RoomState }) => void;
  "error:toast": (payload: { message: string }) => void;
};
