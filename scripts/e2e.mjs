// End-to-end smoke test against a running server.
//
//   PORT=3002 BOT_STEP_MS=5 node packages/server/dist/index.js &
//   node scripts/e2e.mjs http://localhost:3002
//
// Exercises: private room lobby, ready/start, a full human-vs-human game driven by
// the bot heuristics through the socket API, quick-match pairing, solo vs bot,
// reconnect, and rematch; then 4-player private rooms, solo vs 3 bots and a
// 4-player quick match with a mid-game leave.

import { io } from "socket.io-client";
import { botDecide } from "../packages/shared/dist/index.js";

const url = process.argv[2] ?? "http://localhost:3001";
let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("  ✗", msg);
  } else {
    console.log("  ✓", msg);
  }
}

function connect() {
  const socket = io(url, { transports: ["websocket"] });
  const client = {
    socket,
    room: null,
    view: null,
    queue: null,
    needed: null,
    waiters: [],
    emit(event, ...args) {
      return new Promise((resolve) => socket.emit(event, ...args, resolve));
    },
    waitFor(pred, timeout = 15000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (pred(client)) {
            resolve();
            return true;
          }
          return false;
        };
        if (check()) return;
        const timer = setTimeout(() => reject(new Error("timeout waiting: " + pred)), timeout);
        client.waiters.push(() => {
          if (check()) clearTimeout(timer);
          else return true;
        });
      });
    },
    notify() {
      client.waiters = client.waiters.filter((w) => w() === true);
    },
  };
  socket.on("room:state", ({ room }) => {
    client.room = room;
    client.notify();
  });
  socket.on("game:state", ({ view }) => {
    client.view = view;
    client.notify();
  });
  socket.on("queue:status", ({ waiting, needed }) => {
    client.queue = waiting;
    client.needed = needed ?? null;
    client.notify();
  });
  return new Promise((resolve) => socket.on("connect", () => resolve(client)));
}

/**
 * Plays for `client` whenever it's their turn, using the bot heuristics on a
 * reconstructed full state (the view has everything the bot needs for the
 * current player). Resolves when the game ends.
 */
async function playOut(clients) {
  const start = Date.now();
  while (Date.now() - start < 120000) {
    const done = clients.every((c) => c.view && c.view.winner !== null);
    if (done) return;
    let acted = false;
    for (const c of clients) {
      const v = c.view;
      if (!v || v.winner !== null || v.current !== v.me) continue;
      const state = viewToState(v);
      const action = botDecide(state);
      const res = await c.emit("game:action", { action });
      if (!res.ok) {
        // Choice ids may be stale if a state update raced; refetch and retry.
        if (!/no longer active|pending choice|not your turn/i.test(res.error)) {
          throw new Error(`action ${action.type} rejected: ${res.error}`);
        }
      }
      acted = true;
      await new Promise((r) => setTimeout(r, 5));
    }
    if (!acted) await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("game did not finish in time");
}

/** Builds a GameState-shaped object from a player's view (enough for botDecide). */
function viewToState(v) {
  const players = v.players.map((p, i) => ({
    ...p,
    hand: i === v.me ? v.hand : [],
    deck: [],
    factionsPlayed: {},
    shipCombatBonus: 0,
    turnsTaken: Math.ceil(v.turn / v.players.length),
  }));
  return {
    ...v,
    players,
    tradeDeck: [],
    choices: v.choice ? [v.choice] : [],
  };
}

async function testPrivateRoomGame() {
  console.log("private room + full game");
  const a = await connect();
  const b = await connect();
  const created = await a.emit("room:create", {
    name: "Alice",
    playerId: "p-alice",
    mode: "private",
  });
  assert(created.ok, "room created");
  const joined = await b.emit("room:join", { code: created.code, name: "Bob", playerId: "p-bob" });
  assert(joined.ok, "second player joined");
  await b.waitFor((c) => c.room?.players.length === 2);
  const early = await a.emit("room:start");
  assert(!early.ok, "cannot start before ready");
  await a.emit("room:ready", { playerId: "p-alice", ready: true });
  await b.emit("room:ready", { playerId: "p-bob", ready: true });
  await a.waitFor((c) => c.room?.players.every((p) => p.ready));
  const notHost = await b.emit("room:start");
  assert(!notHost.ok, "non-host cannot start");
  const started = await a.emit("room:start");
  assert(started.ok, "host started the game");
  await a.waitFor((c) => c.view !== null);
  await b.waitFor((c) => c.view !== null);
  assert(a.view.me !== b.view.me, "players have different seats");
  assert(a.view.hand.length + b.view.hand.length === 8, "first player draws 3, second draws 5");
  const wrongTurn = await (a.view.current === a.view.me ? b : a).emit("game:action", {
    action: { type: "end_turn" },
  });
  assert(!wrongTurn.ok, "acting out of turn is rejected");

  await playOut([a, b]);
  assert(a.view.winner !== null && a.view.winner === b.view.winner, "game finished with a winner");
  await a.waitFor((c) => c.room?.status === "finished");
  assert(
    a.room.winnerId === (a.view.winner === a.view.me ? "p-alice" : "p-bob"),
    "room records winner",
  );

  // Reconnect keeps the finished view.
  const a2 = await connect();
  const rc = await a2.emit("room:reconnect", { code: created.code, playerId: "p-alice" });
  assert(rc.ok, "reconnect accepted");
  await a2.waitFor((c) => c.view !== null);
  assert(a2.view.winner === a.view.winner, "reconnected client sees the same result");

  // Rematch: both ready -> new game.
  await a2.emit("room:ready", { playerId: "p-alice", ready: true });
  await b.emit("room:ready", { playerId: "p-bob", ready: true });
  await b.waitFor((c) => c.room?.status === "in_game");
  await b.waitFor((c) => c.view && c.view.winner === null && c.view.turn === 1);
  assert(b.view.turn === 1 && b.view.winner === null, "rematch started a fresh game");

  a.socket.close();
  a2.socket.close();
  b.socket.close();
}

async function testQuickMatch() {
  console.log("quick match");
  const a = await connect();
  const b = await connect();
  const qa = await a.emit("queue:join", { name: "Q1", playerId: "p-q1" });
  assert(qa.ok, "first player queued");
  await a.waitFor((c) => c.queue === true);
  const qb = await b.emit("queue:join", { name: "Q2", playerId: "p-q2" });
  assert(qb.ok, "second player queued");
  await a.waitFor((c) => c.view !== null);
  await b.waitFor((c) => c.view !== null);
  assert(a.room?.mode === "quick" && a.room.status === "in_game", "paired into a quick game");
  assert(a.room.code === b.room.code, "both in the same room");
  a.socket.close();
  b.socket.close();
}

async function testSolo() {
  console.log("solo vs bot");
  const a = await connect();
  const created = await a.emit("room:create", { name: "Solo", playerId: "p-solo", mode: "solo" });
  assert(created.ok, "solo room created");
  await a.waitFor((c) => c.view !== null);
  assert(
    a.room.players.some((p) => p.isBot),
    "bot seated",
  );
  await playOut([a]);
  assert(a.view.winner !== null, "solo game finished");
  a.socket.close();
}

async function testFourPlayerRoom() {
  console.log("4-player private room (hunter)");
  const clients = [];
  for (let i = 0; i < 5; i++) clients.push(await connect());
  const [a, b, c, d, e] = clients;
  const created = await a.emit("room:create", {
    name: "A4",
    playerId: "p-a4",
    mode: "private",
    maxPlayers: 4,
    variant: "hunter",
  });
  assert(created.ok, "4-player room created");
  await a.waitFor((x) => x.room !== null);
  assert(a.room.maxPlayers === 4 && a.room.variant === "hunter", "room reports size and variant");
  for (const [x, id] of [
    [b, "b4"],
    [c, "c4"],
    [d, "d4"],
  ]) {
    const res = await x.emit("room:join", { code: created.code, name: id, playerId: `p-${id}` });
    assert(res.ok, `${id} joined`);
  }
  const fifth = await e.emit("room:join", { code: created.code, name: "E4", playerId: "p-e4" });
  assert(!fifth.ok, "fifth player is turned away");
  await a.waitFor((x) => x.room?.players.length === 4);
  const early = await a.emit("room:start");
  assert(!early.ok, "cannot start before everyone is ready");
  const ids = ["p-a4", "p-b4", "p-c4", "p-d4"];
  const four = [a, b, c, d];
  for (let i = 0; i < 4; i++) await four[i].emit("room:ready", { playerId: ids[i], ready: true });
  await a.waitFor((x) => x.room?.players.every((p) => p.ready));
  const started = await a.emit("room:start");
  assert(started.ok, "host started the 4-player game");
  for (const x of four) await x.waitFor((y) => y.view !== null);
  assert(new Set(four.map((x) => x.view.me)).size === 4, "four distinct seats");
  assert(four.reduce((n, x) => n + x.view.hand.length, 0) === 17, "opening hands are 3/4/5/5");
  assert(a.view.variant === "hunter" && a.view.attackable.length === 1, "hunter has one prey");
  await playOut(four);
  const winner = a.view.winner;
  assert(winner !== null && four.every((x) => x.view.winner === winner), "4p game has one winner");
  assert(a.view.players.filter((p) => p.eliminated).length === 3, "everyone else was eliminated");
  for (const x of clients) x.socket.close();
}

async function testSoloFour() {
  console.log("solo vs 3 bots (free-for-all)");
  const a = await connect();
  const created = await a.emit("room:create", {
    name: "Solo4",
    playerId: "p-solo4",
    mode: "solo",
    maxPlayers: 4,
    variant: "ffa",
  });
  assert(created.ok, "solo 4p room created");
  await a.waitFor((c) => c.view !== null);
  assert(a.room.players.filter((p) => p.isBot).length === 3, "three bots seated");
  assert(new Set(a.room.players.map((p) => p.name)).size === 4, "bots have distinct names");
  await playOut([a]);
  assert(a.view.winner !== null, "solo 4p game finished");
  a.socket.close();
}

async function testQuickMatchFour() {
  console.log("4-player quick match");
  const duo = await connect();
  await duo.emit("queue:join", { name: "Duo", playerId: "p-duo" });
  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await connect());
  for (let i = 0; i < 4; i++) {
    const res = await clients[i].emit("queue:join", {
      name: `Q4-${i}`,
      playerId: `p-q4-${i}`,
      maxPlayers: 4,
      variant: "ffa",
    });
    assert(res.ok, `player ${i + 1} queued for 4p`);
    if (i === 0) {
      await clients[0].waitFor((c) => c.needed === 3);
      assert(clients[0].needed === 3, "queue reports 3 more needed");
    }
  }
  for (const c of clients) await c.waitFor((x) => x.view !== null);
  const code = clients[0].room.code;
  assert(
    clients.every((c) => c.room.code === code && c.room.maxPlayers === 4),
    "all four in one 4-player room",
  );
  assert(duo.queue === true && duo.room === null, "2-player queuer was not pulled in");

  // One player leaves mid-game: they concede and the rest play on.
  const [leaver, ...rest] = clients;
  const seat = leaver.view.me;
  await leaver.emit("room:leave", { playerId: "p-q4-0" });
  await rest[0].waitFor((c) => c.view.players[seat].eliminated);
  assert(rest[0].room.status === "in_game", "game continues after a leave");
  await playOut(rest);
  assert(
    rest.every((c) => c.view.winner !== null),
    "remaining three finish the game",
  );
  for (const c of [duo, ...clients]) c.socket.close();
}

try {
  await testPrivateRoomGame();
  await testQuickMatch();
  await testSolo();
  await testFourPlayerRoom();
  await testSoloFour();
  await testQuickMatchFour();
} catch (err) {
  failures += 1;
  console.error("  ✗ exception:", err.message);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
