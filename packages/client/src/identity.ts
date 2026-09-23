import type { GameVariant } from "@sr/shared";

const ID_KEY = "sr_playerId";
const NAME_KEY = "sr_name";
const ROOM_KEY = "sr_roomCode";
const TABLE_KEY = "sr_table";

export type TablePrefs = { maxPlayers: number; variant: GameVariant };

export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function loadName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function saveName(name: string) {
  localStorage.setItem(NAME_KEY, name);
}

export function loadRoomCode(): string | null {
  return localStorage.getItem(ROOM_KEY);
}

export function saveRoomCode(code: string | null) {
  if (code) localStorage.setItem(ROOM_KEY, code);
  else localStorage.removeItem(ROOM_KEY);
}

export function loadTable(): TablePrefs {
  try {
    const t = JSON.parse(localStorage.getItem(TABLE_KEY) ?? "null") as Partial<TablePrefs> | null;
    const maxPlayers = [2, 3, 4].includes(Number(t?.maxPlayers)) ? Number(t?.maxPlayers) : 2;
    return { maxPlayers, variant: t?.variant === "hunter" ? "hunter" : "ffa" };
  } catch {
    return { maxPlayers: 2, variant: "ffa" };
  }
}

export function saveTable(table: TablePrefs) {
  try {
    localStorage.setItem(TABLE_KEY, JSON.stringify(table));
  } catch {
    // Preferences are a convenience only.
  }
}
