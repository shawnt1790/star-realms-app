// packages/shared/src/index.ts
export type RoomCode = string;

export type PlayerSummary = {
  id: string;
  name: string;
  isHost: boolean;
};

export type RoomState = {
  code: RoomCode;
  players: PlayerSummary[];
  status: "lobby" | "in_game";
};
