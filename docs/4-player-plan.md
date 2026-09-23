# 4-player mode: implementation plan

Tracks [issue #16](https://github.com/shawnt1790/star-realms-app/issues/16).
Drafted 2026-09-22; scope decisions settled the same day (see §6). Status of each
iteration is kept in the checklist at the end.

The goal is a 4-player alternative next to the existing 2-player game, in two
variants that mirror the official multiplayer rules: **Free-for-all** and **Hunter**.
Nothing about the 2-player game changes.

---

## 1. Rules

Source: the official multiplayer variants (Wise Wizard Games rulebook; summarised at
[ultraboardgames](https://www.ultraboardgames.com/star-realms/multiplayer-rules.php)).

### Common to both variants

| Rule                  | Decision                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players               | 2, 3 or 4. The engine is written for N; the lobby picker offers all three.                                                                                            |
| Turn order            | Seat order, clockwise. "Left" = next seat in turn order, "right" = previous seat.                                                                                     |
| Starting hands        | First player draws 3, second draws 4, everyone else draws 5 (official): `[3,5]`, `[3,4,5]`, `[3,4,5,5]`.                                                              |
| Authority / decks     | 50 authority, 8 Scouts + 2 Vipers each, unchanged.                                                                                                                    |
| Trade row / Explorers | Unchanged (5 slots, 10 Explorers). Official rules do not scale them.                                                                                                  |
| Elimination           | At 0 authority a player is **eliminated**: their bases leave play, they take no more turns, they stay in the room as a spectator and keep receiving the game view.    |
| Win                   | Last player standing. `winner` is set when exactly one player remains.                                                                                                |
| Concede / leave       | Concede = self-elimination. Leaving mid-game concedes. The game continues for the others as long as 2+ players remain; in a 2-player game this is identical to today. |
| Hostile card effects  | "Target opponent discards" and "destroy target base" follow the variant's targeting rules below, and never touch eliminated players.                                  |

### Free-for-all

- Attack any opponent's authority, and any opponent's bases.
- Combat may be split across several targets in one turn (official: "any combination
  of Bases and players"). `attack_player` therefore takes an `amount`; the UI defaults
  it to "all remaining combat".
- Outposts gate only their owner: an outpost stops attacks on _that_ player's
  authority and non-outpost bases, nothing else.
- "Target opponent discards" prompts the acting player to pick which opponent.

### Hunter

- Attack the authority of the player on your **left** only (your "prey").
- Attack bases of the players on your left **and right** only. The player across
  the table is untouchable.
- "Target opponent" card effects hit your prey only. "Destroy target base" may hit
  left or right.
- When your prey is eliminated, the next living player to your left becomes your prey.
- With 2 players, Hunter and Free-for-all both reduce to the normal duel, so
  `variant` is stored but has no effect in 2-player games. With 3 players your left
  and right neighbours are the two other players, so Hunter only restricts _whose
  authority_ you may hit; both players' bases are fair game.

---

## 2. Where the code assumes two players today

30 sites across 9 files (excluding tests). Every one is touched in iteration 1.

| File                                             | Assumption                                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/game/types.ts`              | `PlayerIndex = 0 \| 1`, `players: [PlayerState, PlayerState]`, `GameView.players` tuple, `opponentChoosing: boolean`                                                                                     |
| `packages/shared/src/game/engine.ts`             | `other()` used in `targetableBases`, `canAttackPlayer`, `opponent_discard`, `attackBase`, `attackPlayer`, `destroy_base`, `endTurn`, concede; `createGame` builds a 2-tuple; first-turn draws hard-coded |
| `packages/shared/src/game/view.ts`               | `connected: [boolean, boolean]`, tuple cast                                                                                                                                                              |
| `packages/shared/src/game/bot.ts`                | `opp = players[other(pi)]` in `botDecide` and `decideChoice`; `myTurnNumber = turn / 2`                                                                                                                  |
| `packages/server/src/rooms.ts`                   | `seats: [string, string]`, `size >= 2` / `!== 2` checks, seat swap on rematch, `connectedSeats` tuple, `idx !== 0 && idx !== 1`                                                                          |
| `packages/client/src/components/Game.tsx`        | `oppIdx = me === 0 ? 1 : 0`, single opponent panel, attack buttons target "the" opponent, game-over shows two authorities                                                                                |
| `packages/client/src/components/ChoiceModal.tsx` | `opp = players[me === 0 ? 1 : 0]` when labelling candidate bases                                                                                                                                         |
| `packages/client/src/components/Lobby.tsx`       | `full = players.length === 2`, "Waiting for a second player"                                                                                                                                             |
| `packages/client/src/components/Home.tsx`        | No mode picker                                                                                                                                                                                           |

---

## 3. Target architecture

### 3.1 Shared engine (`packages/shared`)

**Types**

```ts
export type PlayerIndex = number;                 // seat index, 0..n-1
export type GameVariant = "ffa" | "hunter";       // 2p: stored, ignored

type GameState = {
  ...
  variant: GameVariant;
  players: PlayerState[];                          // was a 2-tuple
};

type PlayerState = {
  ...
  eliminated: boolean;
  /** Turns this player has started. Replaces `turn / 2` in the bot. */
  turnsTaken: number;
};

type PlayerAction =
  | { type: "attack_player"; target?: PlayerIndex; amount?: number }  // both optional: 2p clients keep working
  | ...;                                                              // attack_base is unchanged (uids are global)

type Choice =
  | { type: "select_cards"; ... }
  | { type: "choose_option"; ... }
  | { type: "select_player"; player; prompt; sourceDefId; sourceUid;
      candidates: PlayerIndex[]; then: "opponent_discard"; amount: number };
```

**Targeting module** — new file `packages/shared/src/game/targeting.ts`, the only
place that knows what a variant means. `other()` is deleted.

```ts
alivePlayers(state): PlayerIndex[]
nextAlive(state, pi): PlayerIndex          // turn order, skips eliminated
prevAlive(state, pi): PlayerIndex
attackablePlayers(state, pi): PlayerIndex[]   // ffa: all living opponents; hunter: [nextAlive]
attackableBaseOwners(state, pi): PlayerIndex[] // ffa: all; hunter: [nextAlive, prevAlive] (deduped)
targetableBases(state, pi): CardInstance[]     // union over owners, each owner's outposts-first rule applied per owner
canAttackPlayer(state, pi, target): boolean
```

**Engine changes**

- `createGame` accepts `players: {...}[]` (2..4) and `variant`; first-turn draws from a
  `firstTurnHandSizes(n)` helper (`[3,5]`, `[3,4,5]`, `[3,4,5,5]`).
- `attackPlayer(state, pi, target, amount)`: resolves the default target when the
  action omits one (only legal when exactly one target exists, which is always true
  in 2p), validates target and amount, subtracts, then calls `eliminate` if needed.
- `attackBase(state, pi, uid)`: finds the base's owner among `attackableBaseOwners`,
  applies that owner's outpost rule.
- `opponent_discard`: one legal target → apply directly (2p behaviour). Several →
  queue a `select_player` choice.
- `eliminate(state, pi, by)`: sets `eliminated`, moves bases to that player's discard,
  clears pending state, logs, then `checkWinner`. Hunter retargeting needs no state
  because `nextAlive` is computed on the fly.
- `endTurn`: `state.current = nextAlive(state, pi)`; increments `turnsTaken` in
  `startTurn`.
- Concede: `eliminate(state, player)` instead of `endGame(other(player))`.

**View**

- `players: PublicPlayerView[]` with `eliminated`.
- `attackable: PlayerIndex[]` and `baseTargets: PlayerIndex[]` precomputed for the
  viewer, so the client never re-implements variant rules.
- `choosing: PlayerIndex | null` replaces `opponentChoosing`.
- `variant` and `connected: boolean[]`.

**Bot**

- `pickPrey(state, pi)`: Hunter is forced; FFA picks the lowest-authority attackable
  player, tie-break on most bases in play. Everything that used `opp` uses the prey.
- Lethal checks use the prey; "can I kill anyone" scans all attackable players.
- `scrap_trade_row` denial uses the max faction weight over all living opponents.
- `myTurnNumber` reads `turnsTaken`.

### 3.2 Server (`packages/server`)

- `Room` gains `maxPlayers: 2 | 3 | 4` and `variant`. `seats: string[]`.
- `room:create` payload: `{ name, playerId, mode, maxPlayers?, variant? }` (defaults
  2 / ffa so old clients are unaffected).
- Join: full when `players.size >= maxPlayers`. Start: needs `size === maxPlayers`
  and all ready. Rematch rotates seats by one instead of swapping.
- Solo with `maxPlayers: 4`: one human + 3 bots (`bot1..bot3`, distinct names). The
  bot scheduler already keys off `players[current].isBot`, so consecutive bot turns
  just chain.
- Leave mid-game: concede; the game continues if 2+ remain. The room only falls back
  to the lobby when the game is over or fewer than 2 seats are still occupied.
- Quick match: one queue per `(maxPlayers, variant)` key. 2-player keeps today's
  single queue; 3/4-player queues start a room once enough sockets are waiting.
  The home screen's player-count/variant picker applies to Quick Match too, and the
  waiting screen says how many more players are needed.
- `emitGameState` loops over `seats`; eliminated players keep receiving views.
- `/health` unchanged. Analytics events get `players: 2 | 4` and `variant` tags.

### 3.3 Client (`packages/client`)

Before touching layout, split `Game.tsx` (448 lines) into components so the UI
iteration edits small files:

```
components/game/
  Game.tsx            grid + state wiring only
  OpponentBoard.tsx   bases + in-play for one opponent (today's top zone)
  SeatStrip.tsx       compact per-opponent cards, play order
  MyBoard.tsx         my bases, in play, hand
  Sidebar.tsx         my panel, turn banner, actions, log
  GameOver.tsx        standings + rematch
  Market.tsx          trade row
```

**Layout proposal (desktop).** Keep the 2-player shape: opponents on top, market in
the middle, me at the bottom, sidebar on the right. The top zone becomes two rows:

```
┌──────────────────────────────────────────────────────┬─────────┐
│ [ Bea  41 ▸prey ]  [ Cal  50 ]  [ Dee  38 hunts you ] │  me     │
│   ♜♜ 🂠12 ✋5         ♜  🂠9 ✋5      —  🂠14 ✋5          │ 50 auth │
├──────────────────────────────────────────────────────┤ trade 3 │
│ Bea's board:   Bases [..][..]   In play [..][..][..]  │ combat 6│
├──────────────────────────────────────────────────────┤ ───────  │
│ Market  [trade deck] [..][..][..][..][..] [explorers] │ Your turn│
├──────────────────────────────────────────────────────┤ actions │
│ Your bases [..]   In play [..][..]                    │ log …   │
│ Your hand  [....][....][....][....][....]             │         │
└──────────────────────────────────────────────────────┴─────────┘
```

- **Seat strip**: one compact card per opponent, ordered by play order starting with
  the seat to my left. Shows name, authority, deck/hand/discard counts, base glyphs
  (small faction-coloured squares, outposts outlined) so every player's bases are
  visible at a glance without rendering full cards. Chips: `prey` / `hunts you`
  (Hunter), `bot`, `disconnected`, `eliminated` (greyed, stays in place so order is
  stable). The current player's seat card is highlighted.
- **Focused opponent board**: the full bases + in-play view for exactly one opponent,
  the same component the 2-player game uses. Which opponent is focused:
  - not my turn → the player whose turn it is (this is the "cycle with the turn"
    behaviour you described);
  - my turn → my attack target: Hunter's prey, or in FFA the last seat I clicked
    (initially the lowest-authority opponent). Clicking any seat card focuses it and,
    if attackable, makes it the target.
- **Attacking**: the Attack button reads `Attack Bea (6)`; clicking a base on the
  focused board attacks that base. In FFA an optional amount stepper next to the
  button allows splitting combat (hidden in 2p and Hunter, where it's pointless).
- **"Target opponent discards"**: the choice modal shows one button per candidate
  player.
- **Game over**: standings in elimination order, then rematch.
- **2-player**: the seat strip has one entry and everything collapses to today's
  look, so the 2p UI is the same component tree with n = 1.

Mobile (issue #17) is out of scope here, but the seat strip is already a horizontal
scroller, so the 4p layout does not make the mobile problem worse than it is.

---

## 4. Iterations

Each iteration is independently shippable and leaves 2-player untouched.

### Iteration 1 — engine generalisation (refactor, no visible change)

Model: **Opus 5.5** (mechanical, test-driven). Review with Fable 5.1.

1. Capture a **golden fingerprint** before changing anything: run the bot-vs-bot
   simulation for seeds 1..12, record `JSON.stringify(finalState.log)` hashes to
   `packages/shared/src/game/__golden__/duel.json`. This is the regression oracle for
   "2p unchanged".
2. Types and `targeting.ts` as in §3.1; delete `other()`; fix all call sites.
3. Elimination, `select_player`, `attack_player.target/amount`, `turnsTaken`,
   first-turn hand sizes.
4. Bot prey selection.
5. Tests: golden test passes; new `engine.4p.test.ts` covering turn order with
   elimination, FFA split attacks, Hunter prey / base-owner rules and retargeting
   after an elimination, `select_player` discard, 4-bot simulations for both variants
   terminating under a step cap, concede in a 4p game.
6. Server and client compile with the new types (seats as arrays, `choosing`), still
   hard-wired to 2 players. Deployable.

### Iteration 2 — rooms, lobby, minimal playable 4p

Model: **Opus 5.5**.

1. `Room.maxPlayers` / `variant`, create payload, join/start/rematch/leave rules,
   solo with 2 or 3 bots, quick-match queues keyed by size and variant.
2. Home: a "Players: 2 / 3 / 4" toggle and, when 3 or 4, a "Free-for-all / Hunter"
   toggle, applied to Play vs Computer, Quick Match and Create Private Room.
3. Lobby: N slots, "Waiting for N more…".
4. Game: the smallest change that makes 4p playable: opponent panel shows the current
   player (or your prey/first attackable on your turn), a plain `<select>` for the
   target when several are legal, choice modal handles `select_player`.
5. `scripts/e2e.mjs`: a 4-player private room game, a solo-vs-3-bots game, and a
   4-player quick match (four clients queue, one room starts).
6. Analytics tags.

### Iteration 3 — the real 4-player UI

Model: **Fable 5.1** for the layout spec and CSS (design judgement), then either
model for wiring. Split `Game.tsx` first (pure refactor, 2p pixel-identical), then
build `SeatStrip`, focus logic, targeting UX, Hunter chips, game-over standings.
Verify in the in-app browser with a solo 4p game against 3 bots (`BOT_STEP_MS`
low) at 1280px and 1000px widths.

### Iteration 4 — polish (optional, pick from)

- Bot: avoid feeding a kill to a third player (don't reduce someone to 1 when another
  player can finish them), prefer hitting the leader in FFA.
- README / in-app "How to play" section for multiplayer.
- Log filter per player; colour per seat in the log.

---

## 5. Model split

- **Fable 5.1**: planning (this doc), the iteration 3 layout/CSS, and a review pass
  after each iteration (`/code-review` on the branch).
- **Opus 5.5**: iterations 1, 2 and the wiring half of 3. Hand it this document and
  the iteration number; the acceptance criteria above are the definition of done.

---

## 6. Decisions still open

Settled 2026-09-22 with the project owner:

1. **Entry points**: private rooms, solo vs bots, and quick match all support 3 and
   4 players (quick match queues keyed by size and variant).
2. **FFA combat splitting** across targets in one turn: supported, per the rulebook.
3. **Layout**: seat strip + one focused opponent board (§3.3).
4. **Player counts**: 2, 3 and 4 offered in the picker.

Still on defaults (change here if needed):

5. Hunter hostile effects: prey-only for discard, left+right for bases (official).
6. Eliminated players spectate until the game ends rather than being bounced to the
   lobby.
7. Quick match uses the variant the queuing player picked; players only match with
   others who picked the same size and variant.

---

## 7. Checklist

- [x] Iteration 1 — engine generalised, golden test green, 4p engine tests green
      (2026-09-22, branch `issue16`; e2e green against a local fast server)
- [x] Iteration 2 — 3/4p rooms, quick-match queues, lobby, minimal UI, e2e green
      (2026-09-23; **not yet deployed**: waiting on the owner's go-ahead)
- [ ] Iteration 3 — seat strip UI, verified in browser
- [ ] Iteration 4 — polish items chosen

### Iteration 1 notes (for whoever picks up iteration 2)

- The golden oracle is `packages/shared/src/game/golden.test.ts` +
  `__golden__/duel.json`, recorded before any engine change. Regenerate only for an
  intended 2p behaviour change: `UPDATE_GOLDEN=1 npm -w @sr/shared test`.
- `isOutpost`, `targetableBases` and `canAttackPlayer(state, attacker, target)` now
  live in `targeting.ts`. `other()` is gone.
- An elimination that ends the game leaves the loser's bases in place and writes
  no "is eliminated" line, so 2p logs stay byte-identical. Otherwise bases go to
  the eliminated player's discard, and if it was their turn play passes on.
- `view.choosing` is the seat resolving the active choice, **including the viewer**.
  Use `choosing !== null && choosing !== me` for "X is choosing…".
- `view.attackable` is variant-legal targets only. Outposts are not applied, so
  the client still checks the target's bases before enabling Attack.
- `ChoiceModal` already renders `select_player` (one button per candidate) and
  labels candidate bases by owner, so step 4's modal work is done.
- Server: `seats` is `string[]` and seat checks are `idx < 0`, but `start`,
  `startGame`, `maybeAutoStart`, the rematch seat swap and `leave` (back to lobby
  on any departure) are still hard-wired to 2 players. That is iteration 2's step 1.
- Bot: `pickPrey` is exported. In FFA it finishes off any reachable player with
  a partial `amount`, then attacks its prey, and spends leftover combat on another
  open player if the prey is behind an outpost it can't break.

### Iteration 2 notes

- `RoomState` carries `maxPlayers` and `variant`; `room:create` / `queue:join` take
  optional `maxPlayers` / `variant` (validated by `cleanTable` in `rooms.ts`, 2p
  forces `ffa`). `queue:status` adds `needed`.
- A leave mid-game concedes and the room stays `in_game`; a finished room with an
  empty seat drops to the lobby when someone readies up (or someone leaves it).
- Minimal game UI: a seat list in the sidebar (click to target), a `<select>` for
  the target when several are legal, the opponent board shows your target on
  your turn and the current player otherwise, "You're out — spectating" banner,
  standings line on game over. Combat splitting has no UI yet (engine supports it).
- Known gap, same as 2p today: a player who _disconnects_ (rather than leaving)
  stalls the table on their turn until they reconnect or the room expires. With 3-4
  players this hurts more; consider an auto-concede after a timeout.
- The Home screen remembers the picked size and mode in `localStorage` (`sr_table`).
