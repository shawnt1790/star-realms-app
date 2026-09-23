// Pure, deterministic Star Realms rules engine.
//
// `applyAction` never mutates its input: it clones the state, applies the
// action, and returns the new state (or an error). This makes it trivial to
// run on the server, replay games, and unit test.

import type {
  ActionResult,
  CardDef,
  CardInstance,
  Choice,
  ChoiceResolution,
  ChoiceThen,
  Effect,
  Faction,
  GameState,
  GameVariant,
  PlayerAction,
  PlayerIndex,
  PlayerState,
} from "./types.js";
import {
  EXPLORER,
  EXPLORER_COUNT,
  FIRST_TURN_HAND_SIZE,
  HAND_SIZE,
  STARTER_SCOUT,
  STARTER_VIPER,
  STARTING_AUTHORITY,
  STARTING_SCOUTS,
  STARTING_VIPERS,
  TRADE_DECK_DEFS,
  TRADE_ROW_SIZE,
  getCardDef,
} from "./cards.js";
import { shuffleInPlace } from "./rng.js";
import { describeEffect } from "./text.js";
import {
  alivePlayers,
  attackablePlayers,
  baseOwner,
  isOutpost,
  nextAlive,
  targetableBases,
} from "./targeting.js";

export class GameError extends Error {}

function fail(message: string): never {
  throw new GameError(message);
}

// ---------------------------------------------------------------------------
// Card helpers

/** The definition whose abilities a card currently has (handles Stealth Needle copies). */
export function effectiveDef(card: CardInstance): CardDef {
  return getCardDef(card.copyOf ?? card.defId);
}

/** Factions a card counts as for ally purposes. */
export function cardFactions(card: CardInstance): Faction[] {
  const base = getCardDef(card.defId).faction;
  if (card.copyOf) {
    const copied = getCardDef(card.copyOf).faction;
    return copied === base ? [base] : [base, copied];
  }
  return [base];
}

export function baseDefense(card: CardInstance): number {
  return getCardDef(card.defId).defense ?? 0;
}

const SIMPLE_EFFECTS = new Set<Effect["kind"]>([
  "trade",
  "combat",
  "authority",
  "draw",
  "opponent_discard",
  "next_ship_to_top",
  "draw_if_bases",
  "draw_per_faction_played",
  "ships_combat_bonus",
]);

/** True when resolving these effects never requires player input. */
export function isSimpleEffects(effects: Effect[]): boolean {
  return effects.every((e) => SIMPLE_EFFECTS.has(e.kind));
}

export function hasAlly(p: PlayerState, card: CardInstance): boolean {
  const mine: Faction[] = cardFactions(card).filter((f) => f !== "neutral");
  if (mine.length === 0) return false;
  return [...p.inPlay, ...p.bases].some((o) => {
    if (o.uid === card.uid) return false;
    if (getCardDef(o.defId).allyAllFactions) return true;
    return cardFactions(o).some((f) => mine.includes(f));
  });
}

// ---------------------------------------------------------------------------
// State construction

function newUid(state: GameState, prefix = "c"): string {
  state.uidCounter += 1;
  return `${prefix}${state.uidCounter}`;
}

function makeCard(state: GameState, defId: string): CardInstance {
  return { uid: newUid(state), defId };
}

function newPlayer(id: string, name: string, isBot: boolean): PlayerState {
  return {
    id,
    name,
    isBot,
    authority: STARTING_AUTHORITY,
    deck: [],
    hand: [],
    discard: [],
    inPlay: [],
    bases: [],
    trade: 0,
    combat: 0,
    pendingDiscard: 0,
    nextShipToTop: 0,
    shipCombatBonus: 0,
    used: {},
    factionsPlayed: {},
    eliminated: false,
    turnsTaken: 0,
  };
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/**
 * Opening hand sizes in turn order, starting with the first player: 3 then 5 in a
 * duel; with more players the second draws 4 and the rest 5 (official rules).
 */
export function firstTurnHandSizes(n: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? FIRST_TURN_HAND_SIZE : i === 1 && n > 2 ? 4 : HAND_SIZE,
  );
}

export type CreateGameOptions = {
  id: string;
  seed: number;
  /** Seat order, which is also turn order. 2 to 4 players. */
  players: { id: string; name: string; isBot?: boolean }[];
  /** Ignored with 2 players. Defaults to free-for-all. */
  variant?: GameVariant;
  /** Which player takes the first turn. Random when omitted. */
  first?: PlayerIndex;
};

export function createGame(opts: CreateGameOptions): GameState {
  const n = opts.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  }
  const state: GameState = {
    id: opts.id,
    seed: opts.seed,
    turn: 0,
    current: 0,
    variant: opts.variant ?? "ffa",
    players: opts.players.map((p) => newPlayer(p.id, p.name, Boolean(p.isBot))),
    tradeDeck: [],
    tradeRow: [],
    explorers: EXPLORER_COUNT,
    scrapHeap: [],
    choices: [],
    log: [],
    winner: null,
    gameOverReason: null,
    eliminationOrder: [],
    uidCounter: 0,
    startedAt: Date.now(),
  };

  for (const def of TRADE_DECK_DEFS) {
    for (let i = 0; i < def.count; i++) state.tradeDeck.push(makeCard(state, def.id));
  }
  shuffleInPlace(state, state.tradeDeck);

  for (let i = 0; i < TRADE_ROW_SIZE; i++) state.tradeRow.push(state.tradeDeck.shift() ?? null);

  for (const p of state.players) {
    for (let i = 0; i < STARTING_SCOUTS; i++) p.deck.push(makeCard(state, STARTER_SCOUT));
    for (let i = 0; i < STARTING_VIPERS; i++) p.deck.push(makeCard(state, STARTER_VIPER));
    shuffleInPlace(state, p.deck);
  }

  const seats = state.players.map((_, i) => i);
  const first = opts.first ?? shuffleInPlace(state, seats)[0]!;
  if (!Number.isInteger(first) || first < 0 || first >= n) throw new Error("Invalid first player.");
  state.current = first;
  state.turn = 1;

  log(state, null, `Game started. ${state.players[first].name} goes first.`);
  firstTurnHandSizes(n).forEach((size, offset) => drawCards(state, (first + offset) % n, size));
  state.players[first].turnsTaken = 1;
  log(state, first, `Turn 1: ${state.players[first].name}'s turn.`);

  return state;
}

// ---------------------------------------------------------------------------
// Logging / drawing

function log(state: GameState, player: PlayerIndex | null, text: string) {
  state.log.push({ turn: state.turn, player, text });
}

function drawCards(state: GameState, pi: PlayerIndex, n: number): number {
  const p = state.players[pi];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = shuffleInPlace(state, p.discard);
      p.discard = [];
      log(state, pi, `${p.name} shuffles their discard pile into a new deck.`);
    }
    const card = p.deck.shift();
    if (!card) break;
    p.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

function removeFrom(zone: CardInstance[], uid: string): CardInstance | null {
  const idx = zone.findIndex((c) => c.uid === uid);
  if (idx < 0) return null;
  return zone.splice(idx, 1)[0] ?? null;
}

/** Sends a card to the scrap heap (Explorers return to their pile). */
function scrapCard(state: GameState, card: CardInstance) {
  delete card.copyOf;
  if (card.defId === EXPLORER) state.explorers += 1;
  else state.scrapHeap.push(card);
}

function refillTradeRow(state: GameState, slot: number) {
  state.tradeRow[slot] = state.tradeDeck.shift() ?? null;
}

// ---------------------------------------------------------------------------
// Effects

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function queueChoice(state: GameState, choice: DistributiveOmit<Choice, "id">) {
  const id = newUid(state, "ch");
  state.choices.push({ ...choice, id } as Choice);
}

function forceDiscard(state: GameState, target: PlayerIndex, amount: number): string {
  const t = state.players[target];
  t.pendingDiscard += amount;
  return `${t.name} must discard ${amount}`;
}

/**
 * Resolves effects in order. Immediate effects apply right away; effects that
 * need input queue a Choice. Returns short descriptions of what happened.
 */
function resolveEffects(
  state: GameState,
  pi: PlayerIndex,
  effects: Effect[],
  source: CardInstance,
): string[] {
  const out: string[] = [];
  for (const e of effects) {
    const d = resolveEffect(state, pi, e, source);
    if (d) out.push(d);
  }
  return out;
}

function resolveEffect(
  state: GameState,
  pi: PlayerIndex,
  e: Effect,
  source: CardInstance,
): string | null {
  const p = state.players[pi];
  const sourceDef = getCardDef(source.defId);
  const common = { player: pi, sourceDefId: sourceDef.id, sourceUid: source.uid };

  switch (e.kind) {
    case "trade":
      p.trade += e.amount;
      return describeEffect(e);
    case "combat":
      p.combat += e.amount;
      return describeEffect(e);
    case "authority":
      p.authority += e.amount;
      return describeEffect(e);
    case "draw": {
      const n = drawCards(state, pi, e.amount);
      return n > 0 ? `draws ${n}` : null;
    }
    case "opponent_discard": {
      const targets = attackablePlayers(state, pi);
      if (targets.length === 0) return null;
      if (targets.length === 1) return forceDiscard(state, targets[0]!, e.amount);
      queueChoice(state, {
        ...common,
        type: "select_player",
        prompt: `Choose an opponent to discard ${e.amount} at the start of their turn.`,
        candidates: targets,
        then: "opponent_discard",
        amount: e.amount,
      });
      return null;
    }
    case "scrap_hand_or_discard": {
      const candidates = [...p.hand, ...p.discard].map((c) => c.uid);
      if (candidates.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt:
          e.max === 1
            ? "You may scrap a card in your hand or discard pile."
            : `You may scrap up to ${e.max} cards in your hand or discard pile.`,
        candidates,
        min: 0,
        max: e.max,
        then: "scrap",
      });
      return null;
    }
    case "scrap_trade_row": {
      const candidates = state.tradeRow.filter((c): c is CardInstance => c !== null);
      if (candidates.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: "You may scrap a card in the trade row.",
        candidates: candidates.map((c) => c.uid),
        min: 0,
        max: 1,
        then: "scrap_trade_row",
      });
      return null;
    }
    case "destroy_base": {
      const candidates = targetableBases(state, pi);
      if (candidates.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: "You may destroy target base.",
        candidates: candidates.map((c) => c.uid),
        min: 0,
        max: 1,
        then: "destroy_base",
      });
      return null;
    }
    case "choose":
      queueChoice(state, {
        ...common,
        type: "choose_option",
        prompt: `${sourceDef.name}: choose one.`,
        options: e.options,
      });
      return null;
    case "next_ship_to_top":
      p.nextShipToTop += 1;
      return "next ship acquired goes on top of deck";
    case "acquire_free_ship_to_top": {
      const candidates = state.tradeRow
        .filter((c): c is CardInstance => c !== null && getCardDef(c.defId).type === "ship")
        .map((c) => c.uid);
      if (state.explorers > 0) candidates.push(EXPLORER);
      if (candidates.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: "Acquire any ship for free and put it on top of your deck.",
        candidates,
        min: 0,
        max: 1,
        then: "acquire_to_top",
      });
      return null;
    }
    case "copy_ship": {
      const candidates = p.inPlay
        .filter((c) => c.uid !== source.uid && c.defId !== "stealth_needle")
        .map((c) => c.uid);
      if (candidates.length === 0) return "no ship to copy";
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: "Choose a ship you've played this turn to copy.",
        candidates,
        min: 0,
        max: 1,
        then: "copy_ship",
      });
      return null;
    }
    case "draw_if_bases": {
      if (p.bases.length < e.bases) return null;
      const n = drawCards(state, pi, e.amount);
      return n > 0 ? `draws ${n}` : null;
    }
    case "draw_per_faction_played": {
      const count = p.factionsPlayed[e.faction] ?? 0;
      const n = drawCards(state, pi, count);
      return n > 0 ? `draws ${n}` : "draws 0";
    }
    case "discard_then_draw": {
      if (p.hand.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: `Discard up to ${e.max} cards, then draw that many.`,
        candidates: p.hand.map((c) => c.uid),
        min: 0,
        max: e.max,
        then: "discard_draw",
      });
      return null;
    }
    case "draw_then_scrap_hand": {
      const n = drawCards(state, pi, 1);
      if (p.hand.length === 0) return n > 0 ? "draws 1" : null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: "Scrap a card from your hand.",
        candidates: p.hand.map((c) => c.uid),
        min: 1,
        max: 1,
        then: "scrap",
      });
      return n > 0 ? "draws 1" : null;
    }
    case "scrap_hand_or_discard_draw": {
      const candidates = [...p.hand, ...p.discard].map((c) => c.uid);
      if (candidates.length === 0) return null;
      queueChoice(state, {
        ...common,
        type: "select_cards",
        prompt: `Scrap up to ${e.max} cards in your hand or discard pile. Draw a card for each.`,
        candidates,
        min: 0,
        max: e.max,
        then: "scrap_draw",
      });
      return null;
    }
    case "ships_combat_bonus": {
      p.shipCombatBonus += e.amount;
      p.combat += e.amount * p.inPlay.length;
      return `ships get +${e.amount} Combat`;
    }
  }
}

function checkAllies(state: GameState, pi: PlayerIndex) {
  const p = state.players[pi];
  for (const card of [...p.inPlay, ...p.bases]) {
    const def = effectiveDef(card);
    if (!def.ally || def.ally.length === 0) continue;
    const used = (p.used[card.uid] ??= {});
    if (used.ally) continue;
    if (!hasAlly(p, card)) continue;
    used.ally = true;
    const desc = resolveEffects(state, pi, def.ally, card);
    log(
      state,
      pi,
      `${getCardDef(card.defId).name} ally ability${desc.length ? `: ${desc.join(", ")}` : "."}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Actions

function playCard(state: GameState, pi: PlayerIndex, uid: string) {
  const p = state.players[pi];
  const card = removeFrom(p.hand, uid) ?? fail("That card is not in your hand.");
  const def = getCardDef(card.defId);

  if (def.type === "ship") {
    p.inPlay.push(card);
    if (p.shipCombatBonus > 0) p.combat += p.shipCombatBonus;
  } else {
    p.bases.push(card);
  }
  p.factionsPlayed[def.faction] = (p.factionsPlayed[def.faction] ?? 0) + 1;
  p.used[card.uid] = { primary: true };

  const desc = resolveEffects(state, pi, def.primary, card);
  log(state, pi, `${p.name} plays ${def.name}${desc.length ? ` (${desc.join(", ")})` : "."}`);
  checkAllies(state, pi);
}

function playAll(state: GameState, pi: PlayerIndex) {
  const p = state.players[pi];
  for (const base of [...p.bases]) {
    const def = getCardDef(base.defId);
    const used = p.used[base.uid] ?? {};
    if (used.primary || def.primary.length === 0 || !isSimpleEffects(def.primary)) continue;
    activateBase(state, pi, base.uid);
  }
  let guard = 0;
  while (p.hand.length > 0 && state.choices.length === 0 && guard++ < 100) {
    playCard(state, pi, p.hand[0]!.uid);
  }
}

function acquire(state: GameState, pi: PlayerIndex, card: CardInstance, free = false) {
  const p = state.players[pi];
  const def = getCardDef(card.defId);
  if (!free) {
    if (p.trade < def.cost) fail(`Not enough trade (need ${def.cost}).`);
    p.trade -= def.cost;
  }
  if (def.type === "ship" && p.nextShipToTop > 0) {
    p.nextShipToTop -= 1;
    p.deck.unshift(card);
    log(state, pi, `${p.name} acquires ${def.name} and puts it on top of their deck.`);
  } else {
    p.discard.push(card);
    log(state, pi, `${p.name} acquires ${def.name}${free ? " for free" : ""}.`);
  }
}

function buy(state: GameState, pi: PlayerIndex, slot: number | "explorer") {
  if (slot === "explorer") {
    if (state.explorers <= 0) fail("No Explorers left.");
    const p = state.players[pi];
    if (p.trade < 2) fail("Not enough trade (need 2).");
    state.explorers -= 1;
    acquire(state, pi, makeCard(state, EXPLORER));
    return;
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.tradeRow.length) fail("Invalid slot.");
  const card = state.tradeRow[slot] ?? fail("That trade row slot is empty.");
  acquire(state, pi, card);
  refillTradeRow(state, slot);
}

function attackBase(state: GameState, pi: PlayerIndex, uid: string) {
  const p = state.players[pi];
  const owner = baseOwner(state, pi, uid);
  if (owner === null) {
    const inPlay = state.players.some((o, i) => i !== pi && o.bases.some((c) => c.uid === uid));
    fail(inPlay ? "You can't attack that player's bases." : "That base is not in play.");
  }
  const opp = state.players[owner];
  const base = opp.bases.find((c) => c.uid === uid)!;
  const def = getCardDef(base.defId);
  const defense = def.defense ?? 0;
  if (!def.outpost && opp.bases.some(isOutpost)) fail("You must destroy outposts first.");
  if (p.combat < defense) fail(`Not enough combat (need ${defense}).`);
  p.combat -= defense;
  removeFrom(opp.bases, uid);
  delete base.copyOf;
  opp.discard.push(base);
  log(state, pi, `${p.name} destroys ${opp.name}'s ${def.name}.`);
}

function attackPlayer(state: GameState, pi: PlayerIndex, target?: PlayerIndex, amount?: number) {
  const p = state.players[pi];
  const targets = attackablePlayers(state, pi);
  if (target === undefined) {
    if (targets.length !== 1) fail("Choose a player to attack.");
    target = targets[0]!;
  } else if (!targets.includes(target)) {
    fail("You can't attack that player.");
  }
  const opp = state.players[target];
  if (opp.bases.some(isOutpost)) fail("You must destroy outposts first.");
  if (p.combat <= 0) fail("You have no combat to attack with.");
  const dmg = amount ?? p.combat;
  if (!Number.isInteger(dmg) || dmg < 1 || dmg > p.combat) {
    fail(`Attack for between 1 and ${p.combat}.`);
  }
  opp.authority -= dmg;
  p.combat -= dmg;
  log(state, pi, `${p.name} attacks ${opp.name} for ${dmg} (${Math.max(opp.authority, 0)} left).`);
  if (opp.authority <= 0) eliminate(state, target, `${opp.name} was reduced to 0 authority.`);
}

function activateBase(state: GameState, pi: PlayerIndex, uid: string) {
  const p = state.players[pi];
  const base = p.bases.find((c) => c.uid === uid) ?? fail("That base is not in play.");
  const def = getCardDef(base.defId);
  const used = (p.used[uid] ??= {});
  if (used.primary) fail(`${def.name} has already been used this turn.`);
  if (def.primary.length === 0) fail(`${def.name} has no ability to activate.`);
  used.primary = true;
  const desc = resolveEffects(state, pi, def.primary, base);
  log(state, pi, `${p.name} uses ${def.name}${desc.length ? ` (${desc.join(", ")})` : "."}`);
  checkAllies(state, pi);
}

function scrapForAbility(state: GameState, pi: PlayerIndex, uid: string) {
  const p = state.players[pi];
  const card =
    removeFrom(p.inPlay, uid) ?? removeFrom(p.bases, uid) ?? fail("That card is not in play.");
  const def = effectiveDef(card);
  const name = getCardDef(card.defId).name;
  if (!def.scrap || def.scrap.length === 0) {
    // Put it back where it came from.
    (getCardDef(card.defId).type === "ship" ? p.inPlay : p.bases).push(card);
    fail(`${name} has no scrap ability.`);
  }
  delete p.used[uid];
  scrapCard(state, card);
  const desc = resolveEffects(state, pi, def.scrap, card);
  log(state, pi, `${p.name} scraps ${name}${desc.length ? ` (${desc.join(", ")})` : "."}`);
}

function endGame(state: GameState, winner: PlayerIndex, reason: string) {
  state.winner = winner;
  state.gameOverReason = reason;
  state.choices = [];
  log(state, null, `${state.players[winner].name} wins! ${reason}`);
}

/**
 * Knocks a player out: they take no more turns and can't be targeted. The game
 * ends when one player is left; otherwise their bases leave play and play moves
 * on if it was their turn.
 */
function eliminate(state: GameState, pi: PlayerIndex, reason: string) {
  const p = state.players[pi];
  p.eliminated = true;
  p.pendingDiscard = 0;
  state.eliminationOrder.push(pi);
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    endGame(state, alive[0]!, reason);
    return;
  }
  for (const base of p.bases) delete base.copyOf;
  p.discard.push(...p.bases);
  p.bases = [];
  log(state, pi, `${p.name} is eliminated. ${reason}`);

  if (state.current === pi) {
    state.choices = [];
    clearTurn(p);
    passTurn(state, pi);
    return;
  }
  // The current player's pending choices may point at what was just removed.
  const baseUids = new Set(state.players.flatMap((o) => o.bases.map((c) => c.uid)));
  state.choices = state.choices.flatMap((c): Choice[] => {
    if (c.type === "select_player") {
      const candidates = c.candidates.filter((i) => i !== pi);
      return candidates.length > 0 ? [{ ...c, candidates }] : [];
    }
    if (c.type === "select_cards" && c.then === "destroy_base") {
      return [{ ...c, candidates: c.candidates.filter((uid) => baseUids.has(uid)) }];
    }
    return [c];
  });
}

function startTurn(state: GameState, pi: PlayerIndex) {
  const p = state.players[pi];
  p.used = {};
  p.factionsPlayed = {};
  p.turnsTaken += 1;
  log(state, pi, `Turn ${state.turn}: ${p.name}'s turn.`);

  if (p.pendingDiscard > 0) {
    const n = Math.min(p.pendingDiscard, p.hand.length);
    if (n > 0) {
      queueChoice(state, {
        type: "select_cards",
        player: pi,
        prompt: `Discard ${n} card${n === 1 ? "" : "s"}.`,
        sourceDefId: "",
        sourceUid: "",
        candidates: p.hand.map((c) => c.uid),
        min: n,
        max: n,
        then: "discard",
      });
      return;
    }
    p.pendingDiscard = 0;
  }
  checkAllies(state, pi);
}

/** Discards everything in play and in hand and resets per-turn counters. */
function clearTurn(p: PlayerState) {
  for (const c of p.inPlay) delete c.copyOf;
  p.discard.push(...p.inPlay, ...p.hand);
  p.inPlay = [];
  p.hand = [];
  p.trade = 0;
  p.combat = 0;
  p.nextShipToTop = 0;
  p.shipCombatBonus = 0;
  p.used = {};
  p.factionsPlayed = {};
}

function passTurn(state: GameState, from: PlayerIndex) {
  state.current = nextAlive(state, from);
  state.turn += 1;
  startTurn(state, state.current);
}

function endTurn(state: GameState, pi: PlayerIndex) {
  const p = state.players[pi];
  clearTurn(p);
  drawCards(state, pi, HAND_SIZE);
  log(state, pi, `${p.name} ends their turn.`);
  passTurn(state, pi);
}

function resolveChoice(
  state: GameState,
  pi: PlayerIndex,
  choiceId: string,
  resolution: ChoiceResolution,
) {
  const choice = state.choices[0] ?? fail("There is no pending choice.");
  if (choice.id !== choiceId) fail("That choice is no longer active.");
  if (choice.player !== pi) fail("That choice is not yours to make.");
  const p = state.players[pi];

  if (choice.type === "select_player") {
    if (!("player" in resolution)) fail("Expected a player.");
    if (!choice.candidates.includes(resolution.player)) fail("Invalid player.");
    state.choices.shift();
    const desc = forceDiscard(state, resolution.player, choice.amount);
    const srcName = choice.sourceDefId ? getCardDef(choice.sourceDefId).name : "";
    log(
      state,
      pi,
      `${p.name} targets ${state.players[resolution.player].name}${srcName ? ` with ${srcName}` : ""}: ${desc}.`,
    );
    return;
  }

  if (choice.type === "choose_option") {
    if (!("option" in resolution)) fail("Expected an option.");
    const opt = choice.options[resolution.option] ?? fail("Invalid option.");
    state.choices.shift();
    const source: CardInstance = { uid: choice.sourceUid, defId: choice.sourceDefId };
    const desc = resolveEffects(state, pi, opt.effects, source);
    const srcName = choice.sourceDefId ? getCardDef(choice.sourceDefId).name : "";
    log(
      state,
      pi,
      `${p.name} chooses "${opt.label}"${srcName ? ` for ${srcName}` : ""}${desc.length ? ` (${desc.join(", ")})` : "."}`,
    );
    checkAllies(state, pi);
    return;
  }

  if (!("cardUids" in resolution)) fail("Expected a card selection.");
  const uids = Array.from(new Set(resolution.cardUids));
  if (uids.length < choice.min || uids.length > choice.max) {
    fail(
      choice.min === choice.max
        ? `Select exactly ${choice.min}.`
        : `Select between ${choice.min} and ${choice.max}.`,
    );
  }
  for (const uid of uids) if (!choice.candidates.includes(uid)) fail("Invalid selection.");
  state.choices.shift();

  const then: ChoiceThen = choice.then;
  const names = (cards: CardInstance[]) => cards.map((c) => getCardDef(c.defId).name).join(", ");

  switch (then) {
    case "scrap":
    case "scrap_draw": {
      const scrapped: CardInstance[] = [];
      for (const uid of uids) {
        const card = removeFrom(p.hand, uid) ?? removeFrom(p.discard, uid);
        if (!card) fail("Card not found.");
        scrapCard(state, card);
        scrapped.push(card);
      }
      if (scrapped.length === 0) {
        log(state, pi, `${p.name} scraps nothing.`);
      } else {
        log(state, pi, `${p.name} scraps ${names(scrapped)}.`);
        if (then === "scrap_draw") {
          const n = drawCards(state, pi, scrapped.length);
          if (n > 0) log(state, pi, `${p.name} draws ${n}.`);
        }
      }
      break;
    }
    case "scrap_trade_row": {
      const uid = uids[0];
      if (!uid) {
        log(state, pi, `${p.name} leaves the trade row alone.`);
        break;
      }
      const slot = state.tradeRow.findIndex((c) => c?.uid === uid);
      if (slot < 0) fail("Card not in trade row.");
      const card = state.tradeRow[slot]!;
      scrapCard(state, card);
      refillTradeRow(state, slot);
      log(state, pi, `${p.name} scraps ${getCardDef(card.defId).name} from the trade row.`);
      break;
    }
    case "destroy_base": {
      const uid = uids[0];
      if (!uid) {
        log(state, pi, `${p.name} destroys nothing.`);
        break;
      }
      const owner = baseOwner(state, pi, uid) ?? fail("Base not found.");
      const opp = state.players[owner];
      const base = removeFrom(opp.bases, uid)!;
      delete base.copyOf;
      opp.discard.push(base);
      log(state, pi, `${p.name} destroys ${opp.name}'s ${getCardDef(base.defId).name}.`);
      break;
    }
    case "discard": {
      const discarded: CardInstance[] = [];
      for (const uid of uids) {
        const card = removeFrom(p.hand, uid) ?? fail("Card not in hand.");
        p.discard.push(card);
        discarded.push(card);
      }
      p.pendingDiscard = 0;
      log(state, pi, `${p.name} discards ${names(discarded) || "nothing"}.`);
      checkAllies(state, pi);
      break;
    }
    case "discard_draw": {
      const discarded: CardInstance[] = [];
      for (const uid of uids) {
        const card = removeFrom(p.hand, uid) ?? fail("Card not in hand.");
        p.discard.push(card);
        discarded.push(card);
      }
      if (discarded.length > 0) {
        const n = drawCards(state, pi, discarded.length);
        log(state, pi, `${p.name} discards ${names(discarded)} and draws ${n}.`);
      } else {
        log(state, pi, `${p.name} discards nothing.`);
      }
      break;
    }
    case "acquire_to_top": {
      const uid = uids[0];
      if (!uid) {
        log(state, pi, `${p.name} acquires nothing.`);
        break;
      }
      let card: CardInstance;
      if (uid === EXPLORER) {
        if (state.explorers <= 0) fail("No Explorers left.");
        state.explorers -= 1;
        card = makeCard(state, EXPLORER);
      } else {
        const slot = state.tradeRow.findIndex((c) => c?.uid === uid);
        if (slot < 0) fail("Card not in trade row.");
        card = state.tradeRow[slot]!;
        refillTradeRow(state, slot);
      }
      p.deck.unshift(card);
      log(
        state,
        pi,
        `${p.name} acquires ${getCardDef(card.defId).name} for free and puts it on top of their deck.`,
      );
      break;
    }
    case "copy_ship": {
      const uid = uids[0];
      if (!uid) {
        log(state, pi, `${p.name}'s Stealth Needle copies nothing.`);
        break;
      }
      const needle =
        p.inPlay.find((c) => c.uid === choice.sourceUid) ?? fail("Needle not in play.");
      const target = p.inPlay.find((c) => c.uid === uid) ?? fail("Target ship not in play.");
      needle.copyOf = target.copyOf ?? target.defId;
      const copied = getCardDef(needle.copyOf);
      const desc = resolveEffects(state, pi, copied.primary, needle);
      log(
        state,
        pi,
        `${p.name}'s Stealth Needle copies ${copied.name}${desc.length ? ` (${desc.join(", ")})` : "."}`,
      );
      checkAllies(state, pi);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point

export function applyAction(
  input: GameState,
  player: PlayerIndex,
  action: PlayerAction,
): ActionResult {
  if (input.winner !== null) return { ok: false, error: "The game is over." };
  const state = structuredClone(input);
  try {
    const me = state.players[player] ?? fail("Invalid player.");
    if (me.eliminated) fail("You have been eliminated.");
    if (action.type === "concede") {
      eliminate(state, player, `${me.name} conceded.`);
      return { ok: true, state };
    }
    if (player !== state.current) fail("It's not your turn.");
    const pending = state.choices[0];
    if (pending && action.type !== "resolve_choice") fail("Resolve the pending choice first.");

    switch (action.type) {
      case "play_card":
        playCard(state, player, action.uid);
        break;
      case "play_all":
        playAll(state, player);
        break;
      case "buy":
        buy(state, player, action.slot);
        break;
      case "attack_player":
        attackPlayer(state, player, action.target, action.amount);
        break;
      case "attack_base":
        attackBase(state, player, action.uid);
        break;
      case "activate_base":
        activateBase(state, player, action.uid);
        break;
      case "scrap_card":
        scrapForAbility(state, player, action.uid);
        break;
      case "resolve_choice":
        resolveChoice(state, player, action.choiceId, action.resolution);
        break;
      case "end_turn":
        endTurn(state, player);
        break;
    }
    return { ok: true, state };
  } catch (err) {
    if (err instanceof GameError) return { ok: false, error: err.message };
    throw err;
  }
}

/** All cards a player owns (for AI / stats). */
export function allOwnedCards(p: PlayerState): CardInstance[] {
  return [...p.deck, ...p.hand, ...p.discard, ...p.inPlay, ...p.bases];
}
