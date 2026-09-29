import { describe, expect, it } from "vitest";
import type { GameView, PublicPlayerView } from "@sr/shared";
import { soundForAction, soundForUpdate } from "./events";

type Seat = Partial<Omit<PublicPlayerView, "bases">> & { bases?: string[] };

/** A minimal view: seat 0 is me, seat 1 is playing, everyone at 50 authority. */
function view(over: Partial<GameView> = {}, seats: Seat[] = [{}, {}]): GameView {
  const players = seats.map(
    ({ bases = [], ...p }, i) =>
      ({
        id: `p${i}`,
        name: `P${i}`,
        isBot: false,
        authority: 50,
        eliminated: false,
        bases: bases.map((uid) => ({ uid, defId: "x" })),
        ...p,
      }) as unknown as PublicPlayerView,
  );
  return {
    id: "g1",
    me: 0,
    current: 1,
    turn: 2,
    players,
    choice: null,
    eliminationOrder: [],
    winner: null,
    ...over,
  } as GameView;
}

describe("soundForUpdate", () => {
  it("stays quiet for the first view, a rematch or a reconnect", () => {
    expect(soundForUpdate(null, view({ current: 0 }))).toBeNull();
    expect(soundForUpdate(view(), view({ id: "g2", current: 0 }))).toBeNull();
  });

  it("chimes when my turn starts, including going first in a new game", () => {
    expect(soundForUpdate(view(), view({ current: 0 }))).toBe("turn");
    expect(soundForUpdate(null, view({ current: 0, turn: 1 }))).toBe("turn");
    expect(soundForUpdate(view(), view({ id: "g2", current: 0, turn: 1 }))).toBe("turn");
    expect(soundForUpdate(null, view({ current: 1, turn: 1 }))).toBeNull();
    expect(soundForUpdate(view({ current: 0 }), view({ current: 0, turn: 3 }))).toBeNull();
  });

  it("thuds when I take damage", () => {
    expect(soundForUpdate(view(), view({}, [{ authority: 45 }, {}]))).toBe("hit");
    expect(soundForUpdate(view(), view({}, [{}, { authority: 45 }]))).toBeNull();
  });

  it("marks my base being destroyed on someone else's turn, not my own scrapping", () => {
    const before = view({}, [{ bases: ["b1"] }, {}]);
    expect(soundForUpdate(before, view())).toBe("baseLost");
    const mine = view({ current: 0 }, [{ bases: ["b1"] }, {}]);
    expect(soundForUpdate(mine, view({ current: 0 }))).toBeNull();
  });

  it("pings when I have to choose on another player's turn", () => {
    const choice = { id: "c1" } as GameView["choice"];
    expect(soundForUpdate(view(), view({ choice }))).toBe("choice");
    expect(soundForUpdate(view({ choice }), view({ choice }))).toBeNull();
  });

  it("announces eliminations, then victory or defeat once", () => {
    const three: Seat[] = [{}, {}, {}];
    const out: Seat[] = [{}, {}, { eliminated: true }];
    expect(soundForUpdate(view({}, three), view({ eliminationOrder: [2] }, out))).toBe(
      "eliminated",
    );
    const meOut: Seat[] = [{ eliminated: true }, {}, {}];
    expect(soundForUpdate(view({}, three), view({ eliminationOrder: [0] }, meOut))).toBe("defeat");
    // Knocked out earlier: no second defeat when the game ends.
    expect(soundForUpdate(view({}, meOut), view({ winner: 1 }, meOut))).toBeNull();
    expect(soundForUpdate(view(), view({ winner: 0 }))).toBe("victory");
    expect(soundForUpdate(view(), view({ winner: 1 }, [{ authority: 0 }, {}]))).toBe("defeat");
  });
});

describe("soundForAction", () => {
  it("covers buying and attacking only", () => {
    expect(soundForAction({ type: "buy", slot: 0 })).toBe("buy");
    expect(soundForAction({ type: "attack_player" })).toBe("attack");
    expect(soundForAction({ type: "attack_base", uid: "b" })).toBe("baseDestroyed");
    expect(soundForAction({ type: "end_turn" })).toBeNull();
  });
});
