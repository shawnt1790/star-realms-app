// A simple heuristic AI. `botDecide` returns the next action the bot wants to
// take for the current state; the caller applies it and asks again until the
// bot ends its turn.

import type {
  CardDef,
  CardInstance,
  Choice,
  ChoiceResolution,
  Faction,
  GameState,
  PlayerAction,
  PlayerState,
} from "./types.js";
import { EXPLORER, STARTER_SCOUT, STARTER_VIPER, getCardDef } from "./cards.js";
import { allOwnedCards, effectiveDef, isOutpost, other } from "./engine.js";

const STARTERS = new Set([STARTER_SCOUT, STARTER_VIPER]);

function isStarter(defId: string): boolean {
  return STARTERS.has(defId);
}

/** How much we'd mind losing this card (lower = happier to discard/scrap). */
function keepValue(defId: string): number {
  if (isStarter(defId)) return 0;
  if (defId === EXPLORER) return 1;
  return getCardDef(defId).cost + 1;
}

function myTurnNumber(state: GameState): number {
  return Math.ceil(state.turn / 2);
}

function factionWeights(p: PlayerState): Partial<Record<Faction, number>> {
  const counts: Partial<Record<Faction, number>> = {};
  let total = 0;
  for (const c of allOwnedCards(p)) {
    const f = getCardDef(c.defId).faction;
    if (f === "neutral") continue;
    counts[f] = (counts[f] ?? 0) + 1;
    total += 1;
  }
  const out: Partial<Record<Faction, number>> = {};
  for (const [f, n] of Object.entries(counts)) out[f as Faction] = total ? n / total : 0;
  return out;
}

function scoreBuy(def: CardDef, p: PlayerState, state: GameState): number {
  const turn = myTurnNumber(state);
  const weights = factionWeights(p);
  let score = def.cost;
  if (def.id === EXPLORER) return turn <= 3 ? 1.6 : 0.4;
  score += (weights[def.faction] ?? 0) * 4;
  if (def.type === "base") score += def.outpost ? 0.8 : 0.4;
  if (def.cost === 1 && turn > 5) score -= 1.5;
  return score;
}

function chooseBuy(state: GameState, p: PlayerState): PlayerAction | null {
  let bestAction: PlayerAction | null = null;
  let bestScore = -Infinity;
  state.tradeRow.forEach((card, slot) => {
    if (!card) return;
    const def = getCardDef(card.defId);
    if (def.cost > p.trade) return;
    const score = scoreBuy(def, p, state);
    if (score > bestScore) {
      bestScore = score;
      bestAction = { type: "buy", slot };
    }
  });
  if (state.explorers > 0 && p.trade >= 2) {
    const score = scoreBuy(getCardDef(EXPLORER), p, state);
    if (score > bestScore) {
      bestScore = score;
      bestAction = { type: "buy", slot: "explorer" };
    }
  }
  return bestAction;
}

function pickWorst(cards: CardInstance[], n: number): string[] {
  return [...cards]
    .sort((a, b) => keepValue(a.defId) - keepValue(b.defId))
    .slice(0, n)
    .map((c) => c.uid);
}

function pickBest(cards: CardInstance[], n: number): string[] {
  return [...cards]
    .sort((a, b) => keepValue(b.defId) - keepValue(a.defId))
    .slice(0, n)
    .map((c) => c.uid);
}

function decideChoice(state: GameState, choice: Choice): ChoiceResolution {
  const p = state.players[choice.player];
  const opp = state.players[other(choice.player)];
  const turn = myTurnNumber(state);

  if (choice.type === "choose_option") {
    const labels = choice.options.map((o) => o.label.toLowerCase());
    const combatIdx = labels.findIndex((l) => l.includes("combat"));
    const tradeIdx = labels.findIndex((l) => l.includes("trade"));
    const authIdx = labels.findIndex((l) => l.includes("authority"));
    const drawIdx = labels.findIndex((l) => l.includes("draw"));
    const discardIdx = labels.findIndex((l) => l.includes("discard"));

    // Lethal or near-lethal: always take combat.
    if (combatIdx >= 0 && opp.authority <= p.combat + 6) return { option: combatIdx };

    switch (choice.sourceDefId) {
      case "trading_post":
      case "barter_world":
        return { option: p.authority < 15 && authIdx >= 0 ? authIdx : Math.max(tradeIdx, 0) };
      case "defense_center":
        return { option: p.authority < 20 && authIdx >= 0 ? authIdx : Math.max(combatIdx, 0) };
      case "patrol_mech":
        return { option: turn < 6 && tradeIdx >= 0 ? tradeIdx : Math.max(combatIdx, 0) };
      case "blob_world": {
        const blobs = p.factionsPlayed.blob ?? 0;
        return { option: blobs >= 3 && drawIdx >= 0 ? drawIdx : Math.max(combatIdx, 0) };
      }
      case "recycling_station": {
        const junk = p.hand.filter((c) => isStarter(c.defId)).length;
        return { option: junk > 0 && discardIdx >= 0 ? discardIdx : Math.max(tradeIdx, 0) };
      }
    }
    return { option: 0 };
  }

  const candidates = choice.candidates;
  const inHand = p.hand.filter((c) => candidates.includes(c.uid));
  const inDiscard = p.discard.filter((c) => candidates.includes(c.uid));

  switch (choice.then) {
    case "scrap":
    case "scrap_draw": {
      // Prefer thinning starters, from the discard pile first (hand cards are still useful now).
      const junkDiscard = inDiscard.filter((c) => isStarter(c.defId));
      const junkHand = inHand.filter((c) => isStarter(c.defId));
      let picks = [...junkDiscard, ...junkHand].slice(0, choice.max).map((c) => c.uid);
      if (picks.length < choice.max && turn >= 6) {
        const explorers = [...inDiscard, ...inHand].filter((c) => c.defId === EXPLORER);
        picks = [...picks, ...explorers.map((c) => c.uid)].slice(0, choice.max);
      }
      if (picks.length < choice.min) {
        const pool = [...inHand, ...inDiscard].filter((c) => !picks.includes(c.uid));
        picks = [...picks, ...pickWorst(pool, choice.min - picks.length)];
      }
      return { cardUids: picks };
    }
    case "scrap_trade_row": {
      const row = state.tradeRow.filter(
        (c): c is CardInstance => c !== null && candidates.includes(c.uid),
      );
      const oppWeights = factionWeights(opp);
      let best: CardInstance | null = null;
      let bestScore = 0;
      for (const c of row) {
        const def = getCardDef(c.defId);
        const score = def.cost + (oppWeights[def.faction] ?? 0) * 5 - (def.cost <= p.trade ? 3 : 0);
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      return { cardUids: best && bestScore >= 4 ? [best.uid] : [] };
    }
    case "destroy_base": {
      const bases = opp.bases.filter((c) => candidates.includes(c.uid));
      const best = [...bases].sort((a, b) => {
        const da = getCardDef(a.defId);
        const db = getCardDef(b.defId);
        return db.cost + (db.defense ?? 0) - (da.cost + (da.defense ?? 0));
      })[0];
      return { cardUids: best ? [best.uid] : [] };
    }
    case "discard":
      return { cardUids: pickWorst(inHand, choice.min) };
    case "discard_draw": {
      const junk = inHand.filter((c) => isStarter(c.defId)).slice(0, choice.max);
      return { cardUids: junk.map((c) => c.uid) };
    }
    case "acquire_to_top": {
      const row = state.tradeRow.filter(
        (c): c is CardInstance => c !== null && candidates.includes(c.uid),
      );
      const best = [...row].sort(
        (a, b) => scoreBuy(getCardDef(b.defId), p, state) - scoreBuy(getCardDef(a.defId), p, state),
      )[0];
      if (best) return { cardUids: [best.uid] };
      return { cardUids: candidates.includes(EXPLORER) ? [EXPLORER] : [] };
    }
    case "copy_ship": {
      const ships = p.inPlay.filter((c) => candidates.includes(c.uid));
      return { cardUids: pickBest(ships, 1) };
    }
  }
}

function scrapAmount(def: CardDef, kind: "combat" | "trade"): number {
  return (def.scrap ?? []).reduce((sum, e) => (e.kind === kind ? sum + e.amount : sum), 0);
}

function playOrder(hand: CardInstance[]): CardInstance[] {
  return [...hand].sort((a, b) => {
    const da = getCardDef(a.defId);
    const db = getCardDef(b.defId);
    // Stealth Needle last so it has targets; bases first; then expensive ships.
    const na = da.id === "stealth_needle" ? 1 : 0;
    const nb = db.id === "stealth_needle" ? 1 : 0;
    if (na !== nb) return na - nb;
    if (da.type !== db.type) return da.type === "base" ? -1 : 1;
    return db.cost - da.cost;
  });
}

export function botDecide(state: GameState): PlayerAction {
  const pi = state.current;
  const p = state.players[pi];
  const opp = state.players[other(pi)];
  const turn = myTurnNumber(state);

  const choice = state.choices[0];
  if (choice) {
    return { type: "resolve_choice", choiceId: choice.id, resolution: decideChoice(state, choice) };
  }

  // 1. Activate bases.
  for (const base of p.bases) {
    const def = getCardDef(base.defId);
    if (def.primary.length === 0) continue;
    if (p.used[base.uid]?.primary) continue;
    // Blob World wants to go after ships are played.
    if (def.id === "blob_world" && p.hand.length > 0) continue;
    return { type: "activate_base", uid: base.uid };
  }

  // 2. Play cards one at a time.
  if (p.hand.length > 0) {
    return { type: "play_card", uid: playOrder(p.hand)[0]!.uid };
  }

  // 3. Scrap abilities.
  const inPlayAll = [...p.inPlay, ...p.bases];
  const oppOutposts = opp.bases.filter(isOutpost);
  const canHitFace = oppOutposts.length === 0;
  for (const card of inPlayAll) {
    const def = effectiveDef(card);
    if (!def.scrap || def.scrap.length === 0) continue;
    const combatGain = scrapAmount(def, "combat");
    const tradeGain = scrapAmount(def, "trade");
    if (card.defId === EXPLORER && turn >= 4 && allOwnedCards(p).length >= 14) {
      return { type: "scrap_card", uid: card.uid };
    }
    if (combatGain > 0 && canHitFace && p.combat + combatGain >= opp.authority) {
      return { type: "scrap_card", uid: card.uid };
    }
    if (tradeGain > 0 && def.type === "ship") {
      const affordableNow = state.tradeRow.some((c) => c && getCardDef(c.defId).cost <= p.trade);
      const affordableAfter = state.tradeRow.some(
        (c) =>
          c &&
          getCardDef(c.defId).cost > p.trade &&
          getCardDef(c.defId).cost <= p.trade + tradeGain &&
          getCardDef(c.defId).cost >= 5,
      );
      if (!affordableNow && affordableAfter) return { type: "scrap_card", uid: card.uid };
    }
  }

  // 4. Buy.
  const purchase = chooseBuy(state, p);
  if (purchase) return purchase;

  // 5. Attack.
  if (p.combat > 0) {
    if (oppOutposts.length > 0) {
      const target = [...oppOutposts]
        .filter((b) => getCardDef(b.defId).defense! <= p.combat)
        .sort((a, b) => getCardDef(b.defId).defense! - getCardDef(a.defId).defense!)[0];
      if (target) return { type: "attack_base", uid: target.uid };
    } else {
      if (p.combat >= opp.authority) return { type: "attack_player" };
      const target = [...opp.bases]
        .filter((b) => {
          const def = getCardDef(b.defId);
          return def.defense! <= p.combat && def.cost >= 4;
        })
        .sort((a, b) => getCardDef(b.defId).cost - getCardDef(a.defId).cost)[0];
      if (target) return { type: "attack_base", uid: target.uid };
      return { type: "attack_player" };
    }
  }

  return { type: "end_turn" };
}
