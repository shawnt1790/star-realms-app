// Room / matchmaking / game orchestration. All state is in memory.

import type { Server } from "socket.io";
import {
  applyAction,
  botDecide,
  buildView,
  createGame,
  randomSeed,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ClientToServerEvents,
  type GameState,
  type GameVariant,
  type PlayerAction,
  type RoomCode,
  type RoomMode,
  type RoomState,
  type RoomStatus,
  type ServerToClientEvents,
  type TableOptions,
} from "@sr/shared";

export type Player = {
  playerId: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  isBot: boolean;
};

export type Room = {
  code: RoomCode;
  mode: RoomMode;
  status: RoomStatus;
  /** Seats at the table; a game starts once they're all filled. */
  maxPlayers: number;
  variant: GameVariant;
  hostPlayerId: string;
  players: Map<string, Player>;
  /** Player ids in seat order once a game starts. */
  seats: string[] | null;
  game: GameState | null;
  winnerId: string | null;
  botTimer: NodeJS.Timeout | null;
  /** Timestamp when the last human disconnected (for cleanup). */
  emptySince: number | null;
  gamesPlayed: number;
};

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const BOT_NAMES = ["HAL", "Unit 7", "Overseer", "Cortex", "Nebula", "Vex"];
const BOT_STEP_MS = Number(process.env.BOT_STEP_MS ?? 650);
const ROOM_TTL_MS = 15 * 60 * 1000;
const MAX_NAME = 20;

export function cleanName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME);
}

export type Table = { maxPlayers: number; variant: GameVariant };

/** Validates client-supplied table options. With 2 players the variant is meaningless. */
export function cleanTable(opts: TableOptions | undefined): Table {
  const n = Number(opts?.maxPlayers);
  const maxPlayers = Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS ? n : MIN_PLAYERS;
  const variant = maxPlayers > 2 && opts?.variant === "hunter" ? "hunter" : "ffa";
  return { maxPlayers, variant };
}

type QueueEntry = { playerId: string; name: string; socketId: string };
type Queue = { table: Table; entries: QueueEntry[] };

function queueKey(t: Table): string {
  return `${t.maxPlayers}:${t.variant}`;
}

function makeCode(len: number): RoomCode {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export class RoomManager {
  private rooms = new Map<RoomCode, Room>();
  /** socket id -> membership */
  private socketIndex = new Map<string, { code: RoomCode; playerId: string }>();
  /** Quick-match queues keyed by table size and variant. */
  private queues = new Map<string, Queue>();

  constructor(private io: IO) {
    setInterval(() => this.sweep(), 60 * 1000).unref();
  }

  // ---------------------------------------------------------------- lookups

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  membership(socketId: string) {
    return this.socketIndex.get(socketId) ?? null;
  }

  roomForSocket(socketId: string): { room: Room; player: Player } | null {
    const m = this.socketIndex.get(socketId);
    if (!m) return null;
    const room = this.rooms.get(m.code);
    const player = room?.players.get(m.playerId);
    if (!room || !player) return null;
    return { room, player };
  }

  stats() {
    let inGame = 0;
    for (const r of this.rooms.values()) if (r.status === "in_game") inGame++;
    let queued = 0;
    for (const q of this.queues.values()) queued += q.entries.length;
    return { rooms: this.rooms.size, inGame, queued };
  }

  // ---------------------------------------------------------------- rooms

  private createRoomCode(): RoomCode {
    for (let i = 0; i < 1000; i++) {
      const code = makeCode(4);
      if (!this.rooms.has(code)) return code;
    }
    return makeCode(6);
  }

  private newRoom(mode: RoomMode, hostPlayerId: string, table: Table): Room {
    const room: Room = {
      code: this.createRoomCode(),
      mode,
      status: "lobby",
      maxPlayers: table.maxPlayers,
      variant: table.variant,
      hostPlayerId,
      players: new Map(),
      seats: null,
      game: null,
      winnerId: null,
      botTimer: null,
      emptySince: null,
      gamesPlayed: 0,
    };
    this.rooms.set(room.code, room);
    return room;
  }

  private addPlayer(room: Room, playerId: string, name: string, socketId: string | null) {
    const existing = room.players.get(playerId);
    if (existing) {
      existing.name = name || existing.name;
      existing.socketId = socketId;
      existing.connected = socketId !== null;
      return existing;
    }
    const player: Player = {
      playerId,
      name,
      socketId,
      connected: socketId !== null,
      ready: false,
      isBot: false,
    };
    room.players.set(playerId, player);
    return player;
  }

  private bindSocket(socketId: string, room: Room, playerId: string) {
    this.socketIndex.set(socketId, { code: room.code, playerId });
    this.io.sockets.sockets.get(socketId)?.join(room.code);
    room.emptySince = null;
  }

  private unbindSocket(socketId: string, code: RoomCode) {
    this.socketIndex.delete(socketId);
    this.io.sockets.sockets.get(socketId)?.leave(code);
  }

  createRoom(opts: {
    name: string;
    playerId: string;
    socketId: string;
    mode: "private" | "solo";
    table: Table;
  }) {
    const room = this.newRoom(opts.mode, opts.playerId, opts.table);
    this.addPlayer(room, opts.playerId, opts.name, opts.socketId);
    this.bindSocket(opts.socketId, room, opts.playerId);

    if (opts.mode === "solo") {
      const names = shuffled(BOT_NAMES);
      for (let i = 1; i < room.maxPlayers; i++) {
        const playerId = room.maxPlayers === 2 ? "bot" : `bot${i}`;
        room.players.set(playerId, {
          playerId,
          name: names[i - 1]!,
          socketId: null,
          connected: true,
          ready: true,
          isBot: true,
        });
      }
      this.startGame(room);
    } else {
      this.emitRoomState(room);
    }
    return room;
  }

  joinRoom(opts: {
    code: RoomCode;
    name: string;
    playerId: string;
    socketId: string;
  }): { ok: true; room: Room } | { ok: false; error: string } {
    const room = this.getRoom(opts.code);
    if (!room) return { ok: false, error: "Room not found." };
    const existing = room.players.get(opts.playerId);
    if (!existing) {
      if (room.status !== "lobby") return { ok: false, error: "That game already started." };
      if (room.players.size >= room.maxPlayers) return { ok: false, error: "That room is full." };
    }
    this.addPlayer(room, opts.playerId, opts.name, opts.socketId);
    this.bindSocket(opts.socketId, room, opts.playerId);
    this.emitRoomState(room);
    this.emitGameState(room);
    return { ok: true, room };
  }

  reconnect(opts: {
    code: RoomCode;
    playerId: string;
    socketId: string;
  }): { ok: true; room: Room } | { ok: false; error: string } {
    const room = this.getRoom(opts.code);
    if (!room) return { ok: false, error: "Room not found." };
    const player = room.players.get(opts.playerId);
    if (!player) return { ok: false, error: "You are not in that room." };
    // Drop any stale socket binding for this player.
    if (player.socketId && player.socketId !== opts.socketId) {
      this.unbindSocket(player.socketId, room.code);
    }
    player.socketId = opts.socketId;
    player.connected = true;
    this.bindSocket(opts.socketId, room, opts.playerId);
    this.emitRoomState(room);
    this.emitGameState(room);
    return { ok: true, room };
  }

  leave(socketId: string, playerId: string) {
    const m = this.socketIndex.get(socketId);
    this.leaveQueue(playerId);
    if (!m) return;
    const room = this.rooms.get(m.code);
    this.unbindSocket(socketId, m.code);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    // Leaving mid-game counts as a concession; the others play on if 2+ remain.
    if (room.status === "in_game" && room.game && room.seats) {
      const idx = room.seats.indexOf(playerId);
      if (idx >= 0) {
        const res = applyAction(room.game, idx, { type: "concede" });
        if (res.ok) this.commitGame(room, res.state);
      }
    }

    room.players.delete(playerId);
    const humans = [...room.players.values()].filter((p) => !p.isBot);
    if (humans.length === 0) {
      this.destroyRoom(room);
      return;
    }
    if (room.hostPlayerId === playerId) room.hostPlayerId = humans[0]!.playerId;
    // A finished game can't be rematched with a missing seat; back to the lobby.
    if (room.mode !== "solo" && room.status === "finished") this.backToLobby(room);
    this.emitRoomState(room);
    this.emitGameState(room);
    this.scheduleBot(room);
  }

  private backToLobby(room: Room) {
    room.status = "lobby";
    room.game = null;
    room.seats = null;
    for (const p of room.players.values()) p.ready = p.isBot;
  }

  disconnect(socketId: string) {
    const m = this.socketIndex.get(socketId);
    this.removeFromQueues((q) => q.socketId === socketId);
    if (!m) return;
    this.socketIndex.delete(socketId);
    const room = this.rooms.get(m.code);
    if (!room) return;
    const player = room.players.get(m.playerId);
    if (!player || player.socketId !== socketId) return;
    player.connected = false;
    player.socketId = null;
    if (room.status === "lobby") player.ready = false;

    const anyConnected = [...room.players.values()].some((p) => !p.isBot && p.connected);
    if (!anyConnected) room.emptySince = Date.now();

    if (room.hostPlayerId === player.playerId) {
      const alt = [...room.players.values()].find((p) => !p.isBot && p.connected);
      if (alt) room.hostPlayerId = alt.playerId;
    }
    this.emitRoomState(room);
    this.emitGameState(room);
  }

  setReady(
    socketId: string,
    playerId: string,
    ready: boolean,
  ): { ok: true } | { ok: false; error: string } {
    const found = this.roomForSocket(socketId);
    if (!found) return { ok: false, error: "Not in a room." };
    const { room, player } = found;
    if (player.playerId !== playerId) return { ok: false, error: "Invalid player." };
    if (room.status === "in_game") return { ok: false, error: "Game in progress." };
    // Someone left after the game: the rematch waits in the lobby for a new player.
    if (room.status === "finished" && room.players.size < room.maxPlayers) this.backToLobby(room);
    player.ready = ready;
    this.emitRoomState(room);
    this.maybeAutoStart(room);
    return { ok: true };
  }

  start(socketId: string): { ok: true } | { ok: false; error: string } {
    const found = this.roomForSocket(socketId);
    if (!found) return { ok: false, error: "Not in a room." };
    const { room, player } = found;
    if (room.hostPlayerId !== player.playerId)
      return { ok: false, error: "Only the host can start." };
    if (room.status === "in_game") return { ok: false, error: "Already started." };
    if (room.players.size !== room.maxPlayers) {
      return { ok: false, error: `Need ${room.maxPlayers} players to start.` };
    }
    const allReady = [...room.players.values()].every((p) => p.ready && p.connected);
    if (!allReady) {
      return {
        ok: false,
        error: room.maxPlayers === 2 ? "Both players must be ready." : "Everyone must be ready.",
      };
    }
    this.startGame(room);
    return { ok: true };
  }

  private maybeAutoStart(room: Room) {
    if (room.status !== "finished") return;
    if (room.players.size !== room.maxPlayers) return;
    const allReady = [...room.players.values()].every((p) => p.ready && p.connected);
    if (allReady) this.startGame(room);
  }

  private startGame(room: Room) {
    const players = [...room.players.values()];
    if (players.length !== room.maxPlayers) return;
    // Rotate seats across rematches; createGame randomizes who goes first.
    const shift = room.gamesPlayed % players.length;
    const ordered = [...players.slice(shift), ...players.slice(0, shift)];
    room.seats = ordered.map((p) => p.playerId);
    room.game = createGame({
      id: `${room.code}-${room.gamesPlayed + 1}`,
      seed: randomSeed(),
      variant: room.variant,
      players: ordered.map((p) => ({ id: p.playerId, name: p.name, isBot: p.isBot })),
    });
    room.gamesPlayed += 1;
    room.status = "in_game";
    room.winnerId = null;
    for (const p of room.players.values()) p.ready = p.isBot;
    this.emitRoomState(room);
    this.emitGameState(room);
    this.scheduleBot(room);
  }

  // ---------------------------------------------------------------- queue

  joinQueue(opts: { name: string; playerId: string; socketId: string; table: Table }) {
    this.removeFromQueues((q) => q.playerId === opts.playerId || q.socketId === opts.socketId);
    const key = queueKey(opts.table);
    const queue = this.queues.get(key) ?? { table: opts.table, entries: [] };
    this.queues.set(key, queue);
    queue.entries = queue.entries.filter((q) => this.io.sockets.sockets.has(q.socketId));
    queue.entries.push({ playerId: opts.playerId, name: opts.name, socketId: opts.socketId });

    if (queue.entries.length < queue.table.maxPlayers) {
      this.emitQueueStatus(queue);
      return;
    }
    const group = queue.entries.splice(0, queue.table.maxPlayers);
    if (queue.entries.length === 0) this.queues.delete(key);
    const room = this.newRoom("quick", group[0]!.playerId, queue.table);
    for (const q of group) {
      this.addPlayer(room, q.playerId, q.name, q.socketId);
      this.bindSocket(q.socketId, room, q.playerId);
      this.io.to(q.socketId).emit("queue:status", { waiting: false });
    }
    this.startGame(room);
  }

  leaveQueue(playerId: string) {
    return this.removeFromQueues((q) => q.playerId === playerId);
  }

  private removeFromQueues(match: (q: QueueEntry) => boolean): boolean {
    let removed = false;
    for (const [key, queue] of this.queues) {
      const before = queue.entries.length;
      queue.entries = queue.entries.filter((q) => !match(q));
      if (queue.entries.length === before) continue;
      removed = true;
      if (queue.entries.length === 0) this.queues.delete(key);
      else this.emitQueueStatus(queue);
    }
    return removed;
  }

  private emitQueueStatus(queue: Queue) {
    const needed = queue.table.maxPlayers - queue.entries.length;
    for (const q of queue.entries) {
      this.io.to(q.socketId).emit("queue:status", { waiting: true, needed });
    }
  }

  // ---------------------------------------------------------------- game

  action(socketId: string, action: PlayerAction): { ok: true } | { ok: false; error: string } {
    const found = this.roomForSocket(socketId);
    if (!found) return { ok: false, error: "Not in a room." };
    const { room, player } = found;
    if (room.status !== "in_game" || !room.game || !room.seats) {
      return { ok: false, error: "No game in progress." };
    }
    const idx = room.seats.indexOf(player.playerId);
    if (idx < 0) return { ok: false, error: "You are spectating." };
    const res = applyAction(room.game, idx, action);
    if (!res.ok) return res;
    this.commitGame(room, res.state);
    this.scheduleBot(room);
    return { ok: true };
  }

  viewFor(socketId: string) {
    const found = this.roomForSocket(socketId);
    if (!found || !found.room.game || !found.room.seats) return null;
    const idx = found.room.seats.indexOf(found.player.playerId);
    if (idx < 0) return null;
    return buildView(found.room.game, idx, this.connectedSeats(found.room));
  }

  private commitGame(room: Room, state: GameState) {
    room.game = state;
    if (state.winner !== null && room.status === "in_game") {
      room.status = "finished";
      room.winnerId = state.players[state.winner].id;
      if (room.botTimer) {
        clearTimeout(room.botTimer);
        room.botTimer = null;
      }
      for (const p of room.players.values()) p.ready = p.isBot;
      this.emitRoomState(room);
    }
    this.emitGameState(room);
  }

  private scheduleBot(room: Room) {
    if (room.botTimer) return;
    const game = room.game;
    if (!game || game.winner !== null || room.status !== "in_game") return;
    const current = game.players[game.current];
    if (!current.isBot) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      this.botStep(room, 0);
    }, BOT_STEP_MS);
  }

  private botStep(room: Room, steps: number) {
    const game = room.game;
    if (!game || game.winner !== null || room.status !== "in_game") return;
    const current = game.players[game.current];
    if (!current.isBot) return;
    if (steps > 300) {
      // Safety valve: something is looping; end the bot's turn.
      const res = applyAction(game, game.current, { type: "end_turn" });
      if (res.ok) this.commitGame(room, res.state);
      return;
    }
    const action = botDecide(game);
    const res = applyAction(game, game.current, action);
    if (!res.ok) {
      console.error(`bot action failed in ${room.code}: ${action.type}: ${res.error}`);
      const end = applyAction(game, game.current, { type: "end_turn" });
      if (end.ok) this.commitGame(room, end.state);
      return;
    }
    this.commitGame(room, res.state);
    const next = res.state;
    if (next.winner !== null || !next.players[next.current].isBot) return;
    const delay = action.type === "resolve_choice" ? BOT_STEP_MS / 2 : BOT_STEP_MS;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      this.botStep(room, steps + 1);
    }, delay);
  }

  // ---------------------------------------------------------------- emit

  private connectedSeats(room: Room): boolean[] {
    return (room.seats ?? []).map((id) => room.players.get(id)?.connected ?? false);
  }

  roomState(room: Room): RoomState {
    return {
      code: room.code,
      mode: room.mode,
      status: room.status,
      maxPlayers: room.maxPlayers,
      variant: room.variant,
      winnerId: room.winnerId,
      players: [...room.players.values()].map((p) => ({
        id: p.playerId,
        name: p.name,
        isHost: p.playerId === room.hostPlayerId,
        isBot: p.isBot,
        connected: p.connected,
        ready: p.ready,
      })),
    };
  }

  emitRoomState(room: Room) {
    this.io.to(room.code).emit("room:state", { room: this.roomState(room) });
  }

  emitGameState(room: Room) {
    if (!room.game || !room.seats) return;
    const connected = this.connectedSeats(room);
    room.seats.forEach((playerId, idx) => {
      const p = room.players.get(playerId);
      if (!p?.socketId) return;
      this.io.to(p.socketId).emit("game:state", { view: buildView(room.game!, idx, connected) });
    });
  }

  private destroyRoom(room: Room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    for (const p of room.players.values()) {
      if (p.socketId) this.unbindSocket(p.socketId, room.code);
    }
    this.rooms.delete(room.code);
  }

  private sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince !== null && now - room.emptySince > ROOM_TTL_MS) {
        this.destroyRoom(room);
      }
    }
  }
}
