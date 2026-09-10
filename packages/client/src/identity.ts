const ID_KEY = "sr_playerId";
const NAME_KEY = "sr_name";
const ROOM_KEY = "sr_roomCode";

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
