// End-to-end smoke test against a running server.
//
//   PORT=3002 BOT_STEP_MS=5 node packages/server/dist/index.js &
//   node scripts/e2e.mjs http://localhost:3002
//
// Exercises: private room lobby, ready/start, a full human-vs-human game driven by
// the bot heuristics through the socket API, quick-match pairing, solo vs bot,
// reconnect, and rematch.

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
  socket.on("queue:status", ({ waiting }) => {
    client.queue = waiting;
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

try {
  await testPrivateRoomGame();
  await testQuickMatch();
  await testSolo();
} catch (err) {
  failures += 1;
  console.error("  ✗ exception:", err.message);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
