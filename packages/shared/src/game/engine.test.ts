import { describe, expect, it } from "vitest";
import { applyAction, createGame, allOwnedCards } from "./engine.js";
import { targetableBases } from "./targeting.js";
import { botDecide } from "./bot.js";
import { buildView } from "./view.js";
import { EXPLORER, TRADE_DECK_DEFS, getCardDef } from "./cards.js";
import type { CardInstance, GameState, PlayerAction, PlayerIndex } from "./types.js";

function newGame(seed = 42, first: PlayerIndex = 0): GameState {
  return createGame({
    id: "g1",
    seed,
    first,
    players: [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ],
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
  state.players[pi][zone].push(card);
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

describe("card data", () => {
  it("has an 80 card trade deck", () => {
    const total = TRADE_DECK_DEFS.reduce((n, d) => n + d.count, 0);
    expect(total).toBe(80);
  });

  it("bases all have a defense value", () => {
    for (const d of TRADE_DECK_DEFS) {
      if (d.type === "base") expect(d.defense).toBeGreaterThan(0);
    }
  });
});

describe("createGame", () => {
  it("sets up starting decks, hands and trade row", () => {
    const s = newGame();
    expect(s.tradeRow).toHaveLength(5);
    expect(s.tradeDeck).toHaveLength(75);
    expect(s.explorers).toBe(10);
    expect(s.players[0].hand).toHaveLength(3);
    expect(s.players[1].hand).toHaveLength(5);
    expect(allOwnedCards(s.players[0])).toHaveLength(10);
    expect(s.players[0].authority).toBe(50);
  });

  it("is deterministic for a seed", () => {
    const a = newGame(7);
    const b = newGame(7);
    expect(a.tradeRow.map((c) => c?.defId)).toEqual(b.tradeRow.map((c) => c?.defId));
    expect(a.players[0].hand.map((c) => c.defId)).toEqual(b.players[0].hand.map((c) => c.defId));
  });
});

describe("turn flow", () => {
  it("rejects actions from the non-current player", () => {
    const s = newGame();
    expectFail(s, 1, { type: "end_turn" }, /not your turn/);
  });

  it("play_all adds resources and end_turn draws 5 and passes", () => {
    let s = newGame();
    s = act(s, 0, { type: "play_all" });
    const p = s.players[0];
    expect(p.hand).toHaveLength(0);
    expect(p.inPlay).toHaveLength(3);
    expect(p.trade + p.combat).toBe(3);
    s = act(s, 0, { type: "end_turn" });
    expect(s.current).toBe(1);
    expect(s.turn).toBe(2);
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].inPlay).toHaveLength(0);
    expect(s.players[0].trade).toBe(0);
  });

  it("reshuffles the discard pile when the deck runs out", () => {
    let s = newGame();
    s = act(s, 0, { type: "play_all" });
    s = act(s, 0, { type: "end_turn" }); // draws 5, deck now 2
    s = act(s, 1, { type: "end_turn" });
    s = act(s, 0, { type: "play_all" });
    s = act(s, 0, { type: "end_turn" }); // needs 5, deck has 2 -> reshuffle
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].deck.length + s.players[0].discard.length).toBe(5);
  });
});

describe("buying", () => {
  it("buys from the trade row and refills it", () => {
    let s = newGame();
    s.players[0].trade = 10;
    const target = s.tradeRow[2]!;
    const nextUp = s.tradeDeck[0]!;
    s = act(s, 0, { type: "buy", slot: 2 });
    expect(s.players[0].discard.map((c) => c.uid)).toContain(target.uid);
    expect(s.tradeRow[2]?.uid).toBe(nextUp.uid);
    expect(s.players[0].trade).toBe(10 - getCardDef(target.defId).cost);
  });

  it("buys explorers and rejects unaffordable cards", () => {
    let s = newGame();
    s.players[0].trade = 2;
    s = act(s, 0, { type: "buy", slot: "explorer" });
    expect(s.explorers).toBe(9);
    expect(s.players[0].discard[0]?.defId).toBe(EXPLORER);
    expect(s.players[0].trade).toBe(0);
    expectFail(s, 0, { type: "buy", slot: "explorer" }, /trade/);
  });

  it("puts the next ship on top of the deck after a Freighter ally", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "freighter");
    give(s, 0, "cutter");
    s = act(s, 0, { type: "play_all" });
    expect(s.players[0].nextShipToTop).toBe(1);
    expect(s.players[0].trade).toBe(6);
    expect(s.players[0].combat).toBe(4); // cutter ally
    s = act(s, 0, { type: "buy", slot: "explorer" });
    expect(s.players[0].deck[0]?.defId).toBe(EXPLORER);
    expect(s.players[0].nextShipToTop).toBe(0);
  });
});

describe("combat", () => {
  it("damages authority and ends the game at 0", () => {
    let s = newGame();
    s.players[0].hand = [];
    s.players[0].combat = 10;
    s = act(s, 0, { type: "attack_player" });
    expect(s.players[1].authority).toBe(40);
    expect(s.players[0].combat).toBe(0);
    expectFail(s, 0, { type: "attack_player" }, /no combat/);
    s.players[0].combat = 45;
    s = act(s, 0, { type: "attack_player" });
    expect(s.winner).toBe(0);
    expectFail(s, 0, { type: "end_turn" }, /over/);
  });

  it("enforces outposts before bases and authority", () => {
    let s = newGame();
    s.players[0].hand = [];
    const outpost = give(s, 1, "battle_station", "bases");
    const base = give(s, 1, "barter_world", "bases");
    s.players[0].combat = 6;
    expectFail(s, 0, { type: "attack_player" }, /outpost/);
    expectFail(s, 0, { type: "attack_base", uid: base.uid }, /outpost/);
    expect(targetableBases(s, 0).map((c) => c.uid)).toEqual([outpost.uid]);
    s = act(s, 0, { type: "attack_base", uid: outpost.uid });
    expect(s.players[0].combat).toBe(1);
    expect(s.players[1].bases.map((c) => c.uid)).toEqual([base.uid]);
    expect(s.players[1].discard.map((c) => c.uid)).toContain(outpost.uid);
    expectFail(s, 0, { type: "attack_base", uid: base.uid }, /combat/);
    s = act(s, 0, { type: "attack_player" });
    expect(s.players[1].authority).toBe(49);
  });
});

describe("abilities", () => {
  it("triggers ally abilities once when a same-faction card is in play", () => {
    let s = newGame();
    s.players[0].hand = [];
    const f1 = give(s, 0, "blob_fighter");
    const pod = give(s, 0, "trade_pod");
    s = act(s, 0, { type: "play_card", uid: f1.uid });
    expect(s.players[0].combat).toBe(3);
    expect(s.players[0].hand).toHaveLength(1);
    s = act(s, 0, { type: "play_card", uid: pod.uid });
    // Trade Pod primary 3 trade, ally +2 combat; Blob Fighter ally draws a card.
    expect(s.players[0].trade).toBe(3);
    expect(s.players[0].combat).toBe(5);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].used[f1.uid]?.ally).toBe(true);
  });

  it("Mech World counts as an ally for every faction", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "mech_world", "bases");
    give(s, 0, "cutter");
    s = act(s, 0, { type: "play_all" });
    expect(s.players[0].combat).toBe(4);
  });

  it("queues optional scrap choices and resolves them", () => {
    let s = newGame();
    s.players[0].hand = [];
    const junk = give(s, 0, "scout", "discard");
    give(s, 0, "trade_bot");
    s = act(s, 0, { type: "play_all" });
    expect(s.choices).toHaveLength(1);
    const choice = s.choices[0]!;
    expect(choice.type).toBe("select_cards");
    expectFail(s, 0, { type: "end_turn" }, /pending choice/);
    s = act(s, 0, {
      type: "resolve_choice",
      choiceId: choice.id,
      resolution: { cardUids: [junk.uid] },
    });
    expect(s.choices).toHaveLength(0);
    expect(s.scrapHeap.map((c) => c.uid)).toContain(junk.uid);
    expect(s.players[0].discard).toHaveLength(0);
  });

  it("handles choose-one base abilities and once-per-turn activation", () => {
    let s = newGame();
    s.players[0].hand = [];
    const post = give(s, 0, "trading_post", "bases");
    s = act(s, 0, { type: "activate_base", uid: post.uid });
    const choice = s.choices[0]!;
    expect(choice.type).toBe("choose_option");
    s = act(s, 0, { type: "resolve_choice", choiceId: choice.id, resolution: { option: 1 } });
    expect(s.players[0].trade).toBe(1);
    expectFail(s, 0, { type: "activate_base", uid: post.uid }, /already/);
    s = act(s, 0, { type: "end_turn" });
    s = act(s, 1, { type: "end_turn" });
    s = act(s, 0, { type: "activate_base", uid: post.uid });
    expect(s.choices).toHaveLength(1);
  });

  it("scrap abilities remove the card and grant the effect", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "explorer");
    s = act(s, 0, { type: "play_all" });
    const explorer = s.players[0].inPlay[0]!;
    s = act(s, 0, { type: "scrap_card", uid: explorer.uid });
    expect(s.players[0].combat).toBe(2);
    expect(s.players[0].inPlay).toHaveLength(0);
    expect(s.explorers).toBe(11);
  });

  it("forces the opponent to discard at the start of their turn", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "imperial_fighter");
    s = act(s, 0, { type: "play_all" });
    expect(s.players[1].pendingDiscard).toBe(1);
    s = act(s, 0, { type: "end_turn" });
    expect(s.current).toBe(1);
    const choice = s.choices[0]!;
    expect(choice.player).toBe(1);
    expect(choice.type === "select_cards" && choice.min).toBe(1);
    expectFail(s, 1, { type: "play_all" }, /pending/);
    const pick = s.players[1].hand[0]!;
    s = act(s, 1, {
      type: "resolve_choice",
      choiceId: choice.id,
      resolution: { cardUids: [pick.uid] },
    });
    expect(s.players[1].hand).toHaveLength(4);
    expect(s.players[1].pendingDiscard).toBe(0);
  });

  it("Stealth Needle copies another ship including its faction", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "battle_blob");
    give(s, 0, "stealth_needle");
    s = act(s, 0, { type: "play_all" });
    const choice = s.choices[0]!;
    expect(choice.type === "select_cards" && choice.then).toBe("copy_ship");
    const blob = s.players[0].inPlay.find((c) => c.defId === "battle_blob")!;
    s = act(s, 0, {
      type: "resolve_choice",
      choiceId: choice.id,
      resolution: { cardUids: [blob.uid] },
    });
    // 8 + 8 combat, and both Blob allies (draw a card) trigger.
    expect(s.players[0].combat).toBe(16);
    expect(s.players[0].hand).toHaveLength(2);
    s = act(s, 0, { type: "end_turn" });
    expect(s.players[0].discard.every((c) => !c.copyOf)).toBe(true);
  });

  it("Fleet HQ gives ships +1 combat", () => {
    let s = newGame();
    s.players[0].hand = [];
    give(s, 0, "fleet_hq", "bases");
    give(s, 0, "viper");
    give(s, 0, "scout");
    s = act(s, 0, { type: "play_all" });
    expect(s.players[0].combat).toBe(3);
  });
});

describe("views", () => {
  it("hides the opponent's hand and deck order", () => {
    const s = newGame();
    const v = buildView(s, 1);
    expect(v.hand).toHaveLength(5);
    expect(v.players[0].handCount).toBe(3);
    expect((v.players[0] as unknown as { hand?: unknown }).hand).toBeUndefined();
    expect((v.players[0] as unknown as { deck?: unknown }).deck).toBeUndefined();
  });
});

describe("bot", () => {
  it("plays complete games without errors", () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = createGame({
        id: `bot${seed}`,
        seed,
        players: [
          { id: "x", name: "X", isBot: true },
          { id: "y", name: "Y", isBot: true },
        ],
      });
      let steps = 0;
      while (s.winner === null && steps < 5000) {
        const action = botDecide(s);
        const res = applyAction(s, s.current, action);
        if (!res.ok) throw new Error(`seed ${seed} step ${steps}: ${action.type} -> ${res.error}`);
        s = res.state;
        steps += 1;
      }
      expect(s.winner).not.toBeNull();
      expect(s.turn).toBeLessThan(120);
    }
  });
});
