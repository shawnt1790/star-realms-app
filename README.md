# StarRealms.io

A browser implementation of the Star Realms deck-building game: play against the
computer, quick-match a stranger, or open a private room and share the code with a
friend. No accounts, no downloads.

## Features

- Full base-set rules engine (80-card trade deck, Explorers, allies, outposts,
  scrap abilities, Stealth Needle copies, Fleet HQ, Blob World, forced discards…)
- Authoritative server: every action is validated and each client only sees the
  information it is entitled to (opponent hands and deck order are hidden)
- Solo mode against a heuristic AI, quick-match queue, and private rooms
- Reconnect after refresh or a dropped connection; rematch after a game
- Deterministic, seedable engine with a unit-test suite

## Project layout

```
packages/
  shared/   game engine, card data, bot AI, socket contracts (pure TypeScript)
  server/   Express + Socket.IO room/matchmaking server (serves the client build)
  client/   React + Vite UI
```

## Development

```bash
npm install
npm run dev        # shared type watcher + server on :3001 + Vite client on :5173
```

Open http://localhost:5173. The client talks to `VITE_SERVER_URL`
(`packages/client/.env.local`, defaults to http://localhost:3001).

Other scripts:

```bash
npm test            # engine unit tests (vitest)
npm run typecheck
npm run lint
npm run format
npm run build       # builds shared, server and client
npm start           # runs the built server; it also serves packages/client/dist
```

## Deployment

`npm run build && npm start` produces a single Node process that serves both the
API/WebSocket endpoint and the static client on `$PORT` (default 3001). The client
uses the same origin when `VITE_SERVER_URL` is not set, so no extra configuration is
needed. `BOT_STEP_MS` controls how fast the AI plays (default 650 ms per action).

There is a Heroku setup in place: the `Procfile` runs `npm run start`, and
`heroku-postbuild` builds all three packages, so a `git push heroku <branch>:main`
is the whole deploy.

**Run exactly one web dyno.** Rooms, matchmaking and games are held in memory, so a
second dyno would put paired players on different instances and break matchmaking.
Running more than one instance requires moving room state to Redis and adding the
Socket.IO Redis adapter plus session affinity. For the same reason, a restart or a
dyno cycle drops games in progress.

## Rules summary

Each player starts with 50 Authority and a deck of 8 Scouts and 2 Vipers. On your
turn play cards for Trade, Combat and Authority; buy from the trade row; attack your
opponent (Outposts must be destroyed first); then discard everything and draw five.
Reduce your opponent to 0 Authority to win.
