import { describe, expect, it } from "vitest";
import { applyAction, createGame, firstTurnHandSizes } from "./engine.js";
import {
  attackableBaseOwners,
  attackablePlayers,
  nextAlive,
  prevAlive,
  targetableBases,
} from "./targeting.js";
import { botDecide, pickPrey } from "./bot.js";
import { buildView } from "./view.js";
import type { CardInstance, GameState, GameVariant, PlayerAction, PlayerIndex } from "./types.js";

const NAMES = ["Ann", "Bea", "Cal", "Dee"];

function newGame(variant: GameVariant = "ffa", n = 4, first: PlayerIndex = 0): GameState {
  return createGame({
    id: "g4",
    seed: 42,
    first,
    variant,
    players: NAMES.slice(0, n).map((name) => ({ id: name.toLowerCase(), name })),
  });
}

let uidSeq = 1000;
function give(
  state: GameState,
  pi: PlayerIndex,
  defId: string,
  zone: "hand" | "discard" | "bases" | "inPlay" = "hand",
): CardInstance {
  const card: CardInstance = { uid: `t${uidSeq++}`, defId };
  state.players[pi]![zone].push(card);
  return card;
}

function act(state: GameState, pi: PlayerIndex, action: PlayerAction): GameState {
  const res = applyAction(state, pi, action);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

function expectFail(state: GameState, pi: PlayerIndex, action: PlayerAction, msg?: RegExp) {
  const res = applyAction(state, pi, action);
  expect(res.ok).toBe(false);
  if (!res.ok && msg) expect(res.error).toMatch(msg);
}

/** Current player ends turns until it's `pi`'s turn. */
function advanceTo(state: GameState, pi: PlayerIndex): GameState {
  let guard = 0;
  while (state.current !== pi && guard++ < 10)
    state = act(state, state.current, { type: "end_turn" });
  return state;
}

describe("setup", () => {
  it("deals 3/4/5/5 in turn order and rejects bad player counts", () => {
    expect(firstTurnHandSizes(2)).toEqual([3, 5]);
    expect(firstTurnHandSizes(3)).toEqual([3, 4, 5]);
    expect(firstTurnHandSizes(4)).toEqual([3, 4, 5, 5]);

    const s = newGame("ffa", 4, 2);
    expect(s.players.map((p) => p.hand.length)).toEqual([5, 5, 3, 4]);
    expect(s.players.map((p) => p.authority)).toEqual([50, 50, 50, 50]);
    expect(s.tradeRow).toHaveLength(5);
    expect(s.explorers).toBe(10);
    expect(s.variant).toBe("ffa");

    expect(() => newGame("ffa", 1)).toThrow();
    expect(() =>
      createGame({
        id: "x",
        seed: 1,
        players: NAMES.concat("Eve").map((name) => ({ id: name, name })),
      }),
    ).toThrow();
  });
});

describe("turn order", () => {
  it("goes round the table and skips eliminated players", () => {
    let s = newGame("ffa", 4, 1);
    s = act(s, 1, { type: "end_turn" });
    expect(s.current).toBe(2);
    s = act(s, 2, { type: "end_turn" });
    s = act(s, 3, { type: "end_turn" });
    expect(s.current).toBe(0);
    expect(s.turn).toBe(4);

    s.players[0]!.combat = 10;
    s.players[2]!.authority = 4;
    s = act(s, 0, { type: "attack_player", target: 2, amount: 4 });
    expect(s.players[2]!.eliminated).toBe(true);
    expect(s.winner).toBeNull();
    s = act(s, 0, { type: "end_turn" });
    expect(s.current).toBe(1);
    s = act(s, 1, { type: "end_turn" });
    expect(s.current).toBe(3);
    expect(nextAlive(s, 1)).toBe(3);
    expect(prevAlive(s, 3)).toBe(1);
    expect(s.players.map((p) => p.turnsTaken)).toEqual([1, 2, 1, 2]);
  });
});

describe("free-for-all", () => {
  it("splits combat across players and requires a target when several are legal", () => {
    let s = newGame("ffa");
    s.players[0]!.combat = 10;
    expect(attackablePlayers(s, 0)).toEqual([1, 2, 3]);
    expectFail(s, 0, { type: "attack_player" }, /choose a player/i);
    expectFail(s, 0, { type: "attack_player", target: 0 }, /can't attack/);
    expectFail(s, 0, { type: "attack_player", target: 1, amount: 11 }, /between 1 and 10/);
    expectFail(s, 0, { type: "attack_player", target: 1, amount: 0 }, /between/);
    s = act(s, 0, { type: "attack_player", target: 1, amount: 3 });
    s = act(s, 0, { type: "attack_player", target: 3, amount: 5 });
    expect(s.players.map((p) => p.authority)).toEqual([50, 47, 50, 45]);
    expect(s.players[0]!.combat).toBe(2);
    s = act(s, 0, { type: "attack_player", target: 2 });
    expect(s.players[2]!.authority).toBe(48);
    expect(s.players[0]!.combat).toBe(0);
  });

  it("outposts only protect their owner", () => {
    let s = newGame("ffa");
    const outpost = give(s, 1, "battle_station", "bases");
    const behind = give(s, 1, "barter_world", "bases");
    const open = give(s, 2, "barter_world", "bases");
    s.players[0]!.combat = 20;
    expectFail(s, 0, { type: "attack_player", target: 1 }, /outpost/);
    expectFail(s, 0, { type: "attack_base", uid: behind.uid }, /outpost/);
    expect(targetableBases(s, 0).map((c) => c.uid)).toEqual([outpost.uid, open.uid]);
    s = act(s, 0, { type: "attack_player", target: 2, amount: 1 });
    s = act(s, 0, { type: "attack_base", uid: open.uid });
    expect(s.players[2]!.bases).toHaveLength(0);
    expect(s.players[2]!.discard.map((c) => c.uid)).toContain(open.uid);
  });

  it("asks which opponent discards when several are legal", () => {
    let s = newGame("ffa");
    s.players[0]!.hand = [];
    give(s, 0, "imperial_fighter");
    s = act(s, 0, { type: "play_all" });
    const choice = s.choices[0]!;
    expect(choice.type).toBe("select_player");
    if (choice.type !== "select_player") return;
    expect(choice.candidates).toEqual([1, 2, 3]);
    expect(buildView(s, 2).choosing).toBe(0);
    expect(buildView(s, 2).choice).toBeNull();
    expectFail(s, 0, { type: "end_turn" }, /pending choice/);
    expectFail(
      s,
      0,
      { type: "resolve_choice", choiceId: choice.id, resolution: { cardUids: [] } },
      /player/,
    );
    expectFail(
      s,
      0,
      { type: "resolve_choice", choiceId: choice.id, resolution: { player: 0 } },
      /invalid player/i,
    );
    s = act(s, 0, { type: "resolve_choice", choiceId: choice.id, resolution: { player: 2 } });
    expect(s.players.map((p) => p.pendingDiscard)).toEqual([0, 0, 1, 0]);
    s = advanceTo(s, 2);
    expect(s.choices[0]?.player).toBe(2);
    expect(s.choices[0]?.type === "select_cards" && s.choices[0].then).toBe("discard");
  });
});

describe("hunter", () => {
  it("attacks only the prey's authority, and bases on either side", () => {
    let s = newGame("hunter");
    const left = give(s, 1, "barter_world", "bases");
    const across = give(s, 2, "barter_world", "bases");
    const right = give(s, 3, "barter_world", "bases");
    s.players[0]!.combat = 20;
    expect(attackablePlayers(s, 0)).toEqual([1]);
    expect(attackableBaseOwners(s, 0)).toEqual([1, 3]);
    expect(targetableBases(s, 0).map((c) => c.uid)).toEqual([left.uid, right.uid]);
    expectFail(s, 0, { type: "attack_player", target: 2 }, /can't attack/);
    expectFail(s, 0, { type: "attack_player", target: 3 }, /can't attack/);
    expectFail(s, 0, { type: "attack_base", uid: across.uid }, /can't attack that player's bases/);
    s = act(s, 0, { type: "attack_base", uid: right.uid });
    s = act(s, 0, { type: "attack_player" });
    expect(s.players.map((p) => p.authority)).toEqual([50, 34, 50, 50]);
    expect(s.players[3]!.bases).toHaveLength(0);

    const v = buildView(s, 0);
    expect(v.attackable).toEqual([1]);
    expect(v.baseTargets).toEqual([1, 3]);
    expect(v.variant).toBe("hunter");
  });

  it("hits the prey with discard effects without asking", () => {
    let s = newGame("hunter");
    s.players[0]!.hand = [];
    give(s, 0, "imperial_fighter");
    s = act(s, 0, { type: "play_all" });
    expect(s.choices).toHaveLength(0);
    expect(s.players.map((p) => p.pendingDiscard)).toEqual([0, 1, 0, 0]);
  });

  it("lets destroy-base effects reach left and right only", () => {
    let s = newGame("hunter");
    s.players[0]!.hand = [];
    const left = give(s, 1, "barter_world", "bases");
    give(s, 2, "barter_world", "bases");
    const right = give(s, 3, "barter_world", "bases");
    // Missile Mech: 6 combat and destroy target base.
    give(s, 0, "missile_mech");
    s = act(s, 0, { type: "play_all" });
    const choice = s.choices.find((c) => c.type === "select_cards" && c.then === "destroy_base");
    expect(choice?.type === "select_cards" && choice.candidates).toEqual([left.uid, right.uid]);
  });

  it("retargets to the next living player when the prey falls", () => {
    let s = newGame("hunter");
    s.players[0]!.combat = 20;
    s.players[1]!.authority = 5;
    expect(pickPrey(s, 0)).toBe(1);
    s = act(s, 0, { type: "attack_player", amount: 5 });
    expect(s.players[1]!.eliminated).toBe(true);
    expect(attackablePlayers(s, 0)).toEqual([2]);
    expect(attackableBaseOwners(s, 0)).toEqual([2, 3]);
    expect(pickPrey(s, 0)).toBe(2);
    s = act(s, 0, { type: "attack_player" });
    expect(s.players[2]!.authority).toBe(35);
    // Dee's prey is now Ann; her right-hand neighbour is Cal.
    expect(attackablePlayers(s, 3)).toEqual([0]);
    expect(attackableBaseOwners(s, 3)).toEqual([0, 2]);
  });

  it("with 3 players only restricts whose authority you hit", () => {
    const s = newGame("hunter", 3);
    expect(attackablePlayers(s, 0)).toEqual([1]);
    expect(attackableBaseOwners(s, 0)).toEqual([1, 2]);
    expect(attackablePlayers(s, 2)).toEqual([0]);
  });
});

describe("elimination", () => {
  it("removes bases, locks the player out, and crowns the last one standing", () => {
    let s = newGame("ffa");
    const base = give(s, 1, "barter_world", "bases");
    s.players[0]!.combat = 100;
    s.players[1]!.authority = 3;
    s = act(s, 0, { type: "attack_player", target: 1, amount: 3 });
    const bea = s.players[1]!;
    expect(bea.eliminated).toBe(true);
    expect(bea.bases).toHaveLength(0);
    expect(bea.discard.map((c) => c.uid)).toContain(base.uid);
    expect(s.log.some((l) => l.text.startsWith("Bea is eliminated."))).toBe(true);
    expect(attackablePlayers(s, 0)).toEqual([2, 3]);
    expectFail(s, 0, { type: "attack_player", target: 1 }, /can't attack/);
    expectFail(s, 1, { type: "concede" }, /eliminated/);
    expect(attackablePlayers(s, 1)).toEqual([]);

    // Eliminated players keep receiving a view.
    const spectator = buildView(s, 1);
    expect(spectator.players[1]!.eliminated).toBe(true);
    expect(spectator.attackable).toEqual([]);

    s.players[2]!.authority = 1;
    s.players[3]!.authority = 1;
    s = act(s, 0, { type: "attack_player", target: 2, amount: 1 });
    expect(s.winner).toBeNull();
    s = act(s, 0, { type: "attack_player", target: 3, amount: 1 });
    expect(s.winner).toBe(0);
    expect(s.gameOverReason).toBe("Dee was reduced to 0 authority.");
    expectFail(s, 0, { type: "end_turn" }, /over/);
  });

  it("clears a pending discard aimed at an eliminated player's choice list", () => {
    let s = newGame("ffa");
    s.players[0]!.hand = [];
    give(s, 0, "imperial_fighter");
    s = act(s, 0, { type: "play_all" });
    expect(s.choices[0]?.type).toBe("select_player");
    // Bea concedes out of turn while Ann is choosing.
    s = act(s, 1, { type: "concede" });
    const choice = s.choices[0]!;
    expect(choice.type === "select_player" && choice.candidates).toEqual([2, 3]);
  });
});

describe("concede", () => {
  it("on your own turn passes play to the next living player", () => {
    let s = newGame("ffa");
    s = act(s, 0, { type: "concede" });
    expect(s.players[0]!.eliminated).toBe(true);
    expect(s.players[0]!.hand).toHaveLength(0);
    expect(s.winner).toBeNull();
    expect(s.current).toBe(1);
    expect(s.turn).toBe(2);
    s = act(s, 1, { type: "end_turn" });
    s = act(s, 2, { type: "end_turn" });
    s = act(s, 3, { type: "end_turn" });
    expect(s.current).toBe(1);
  });

  it("out of turn leaves the current player's turn alone", () => {
    let s = newGame("hunter");
    s = act(s, 2, { type: "concede" });
    expect(s.current).toBe(0);
    s = act(s, 0, { type: "end_turn" });
    s = act(s, 1, { type: "end_turn" });
    expect(s.current).toBe(3);
    // Bea's prey skips over Cal to Dee.
    expect(attackablePlayers(s, 1)).toEqual([3]);
    s = act(s, 3, { type: "concede" });
    s = act(s, 0, { type: "concede" });
    expect(s.winner).toBe(1);
    expect(s.gameOverReason).toBe("Ann conceded.");
  });
});

describe("bots", () => {
  function simulate(variant: GameVariant, n: number, seed: number): GameState {
    let s = createGame({
      id: `bots${seed}`,
      seed,
      variant,
      players: NAMES.slice(0, n).map((name) => ({ id: name, name, isBot: true })),
    });
    let steps = 0;
    while (s.winner === null && steps < 20000) {
      const action = botDecide(s);
      const res = applyAction(s, s.current, action);
      if (!res.ok) {
        throw new Error(
          `${variant} seed ${seed} step ${steps}: ${JSON.stringify(action)} -> ${res.error}`,
        );
      }
      s = res.state;
      steps += 1;
    }
    return s;
  }

  for (const variant of ["ffa", "hunter"] as const) {
    for (const n of [3, 4]) {
      it(`${n}-bot ${variant} games finish`, () => {
        for (let seed = 1; seed <= 8; seed++) {
          const s = simulate(variant, n, seed);
          expect(s.winner).not.toBeNull();
          expect(s.players.filter((p) => !p.eliminated)).toHaveLength(1);
          expect(s.turn).toBeLessThan(400);
        }
      });
    }
  }
});
