// Core game types for the Star Realms engine.
// Everything here is plain data so it can be serialized over the wire and
// cloned freely; the engine in ./engine.ts is the only thing that mutates it.

export type Faction = "trade_federation" | "blob" | "machine_cult" | "star_empire" | "neutral";

export type PlayerIndex = 0 | 1;

/**
 * A single card ability effect. Effects are resolved in order by the engine.
 * Effects that need player input queue a Choice instead of resolving immediately.
 */
export type Effect =
  | { kind: "trade"; amount: number }
  | { kind: "combat"; amount: number }
  | { kind: "authority"; amount: number }
  | { kind: "draw"; amount: number }
  /** Opponent must discard N cards at the start of their next turn. */
  | { kind: "opponent_discard"; amount: number }
  /** You may scrap up to N cards from your hand and/or discard pile. */
  | { kind: "scrap_hand_or_discard"; max: number }
  /** You may scrap a card in the trade row. */
  | { kind: "scrap_trade_row" }
  /** You may destroy target base (outposts first). */
  | { kind: "destroy_base" }
  /** Choose one of several effect bundles. */
  | { kind: "choose"; options: { label: string; effects: Effect[] }[] }
  /** The next ship you acquire this turn goes on top of your deck. */
  | { kind: "next_ship_to_top" }
  /** Acquire any ship in the trade row for free and put it on top of your deck. */
  | { kind: "acquire_free_ship_to_top" }
  /** Copy another ship you've played this turn (Stealth Needle). */
  | { kind: "copy_ship" }
  /** Draw N cards if you have at least `bases` bases in play. */
  | { kind: "draw_if_bases"; bases: number; amount: number }
  /** Draw a card for each card of the given faction you've played this turn. */
  | { kind: "draw_per_faction_played"; faction: Faction }
  /** Discard up to N cards, then draw that many. */
  | { kind: "discard_then_draw"; max: number }
  /** Draw a card, then scrap a card from your hand. */
  | { kind: "draw_then_scrap_hand" }
  /** Scrap up to N cards from hand/discard, draw a card for each. */
  | { kind: "scrap_hand_or_discard_draw"; max: number }
  /** All of your ships get +N combat this turn. */
  | { kind: "ships_combat_bonus"; amount: number };

export type CardType = "ship" | "base";

export type CardDef = {
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  cost: number;
  /** Bases only. */
  defense?: number;
  /** Bases only: must be destroyed before other bases / authority can be attacked. */
  outpost?: boolean;
  primary: Effect[];
  ally?: Effect[];
  scrap?: Effect[];
  /** Mech World: counts as an ally for every faction. */
  allyAllFactions?: boolean;
  /** Number of copies in the trade deck (0 for starters / explorers). */
  count: number;
  /** Short flavor line shown on the card. */
  flavor?: string;
};

export type CardInstance = {
  /** Unique per-instance id within one game. */
  uid: string;
  defId: string;
  /** Stealth Needle: id of the ship definition being copied this turn. */
  copyOf?: string;
};

export type CardZone = "hand" | "discard" | "trade_row" | "opponent_bases" | "in_play";

export type ChoiceThen =
  | "scrap"
  | "scrap_draw"
  | "scrap_trade_row"
  | "destroy_base"
  | "discard"
  | "discard_draw"
  | "acquire_to_top"
  | "copy_ship";

export type Choice =
  | {
      id: string;
      type: "select_cards";
      player: PlayerIndex;
      prompt: string;
      sourceDefId: string;
      sourceUid: string;
      /** uids the player is allowed to pick from (may include the special "explorer" id). */
      candidates: string[];
      min: number;
      max: number;
      then: ChoiceThen;
    }
  | {
      id: string;
      type: "choose_option";
      player: PlayerIndex;
      prompt: string;
      sourceDefId: string;
      sourceUid: string;
      options: { label: string; effects: Effect[] }[];
    };

export type ChoiceResolution = { cardUids: string[] } | { option: number };

export type LogEntry = {
  turn: number;
  player: PlayerIndex | null;
  text: string;
};

export type UsedAbilities = { primary?: boolean; ally?: boolean };

export type PlayerState = {
  id: string;
  name: string;
  isBot: boolean;
  authority: number;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  /** Ships played this turn. */
  inPlay: CardInstance[];
  /** Bases currently in play. */
  bases: CardInstance[];
  trade: number;
  combat: number;
  /** Cards this player must discard at the start of their next turn. */
  pendingDiscard: number;
  /** Number of "next ship acquired goes on top of deck" effects active. */
  nextShipToTop: number;
  /** Fleet HQ: bonus combat for each ship played this turn. */
  shipCombatBonus: number;
  /** Per-uid abilities used this turn. */
  used: Record<string, UsedAbilities>;
  /** Cards played this turn by faction. */
  factionsPlayed: Partial<Record<Faction, number>>;
};

export type GameState = {
  id: string;
  /** PRNG state. */
  seed: number;
  turn: number;
  current: PlayerIndex;
  players: [PlayerState, PlayerState];
  tradeDeck: CardInstance[];
  tradeRow: (CardInstance | null)[];
  explorers: number;
  scrapHeap: CardInstance[];
  /** Pending choices; the first entry is the active one. */
  choices: Choice[];
  log: LogEntry[];
  winner: PlayerIndex | null;
  gameOverReason: string | null;
  uidCounter: number;
  /** True during the very first turn (starting player draws 3). */
  startedAt: number;
};

export type PlayerAction =
  | { type: "play_card"; uid: string }
  | { type: "play_all" }
  | { type: "buy"; slot: number | "explorer" }
  | { type: "attack_player" }
  | { type: "attack_base"; uid: string }
  | { type: "activate_base"; uid: string }
  | { type: "scrap_card"; uid: string }
  | { type: "resolve_choice"; choiceId: string; resolution: ChoiceResolution }
  | { type: "end_turn" }
  | { type: "concede" };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Redacted views sent to clients.

export type PublicPlayerView = {
  id: string;
  name: string;
  isBot: boolean;
  authority: number;
  deckCount: number;
  handCount: number;
  discard: CardInstance[];
  inPlay: CardInstance[];
  bases: CardInstance[];
  trade: number;
  combat: number;
  pendingDiscard: number;
  nextShipToTop: number;
  used: Record<string, UsedAbilities>;
  connected: boolean;
};

export type GameView = {
  id: string;
  /** Index of the viewing player. */
  me: PlayerIndex;
  turn: number;
  current: PlayerIndex;
  players: [PublicPlayerView, PublicPlayerView];
  hand: CardInstance[];
  tradeRow: (CardInstance | null)[];
  tradeDeckCount: number;
  explorers: number;
  scrapHeap: CardInstance[];
  /** Active choice if it's the viewer's to resolve. */
  choice: Choice | null;
  /** True while the opponent is resolving a choice. */
  opponentChoosing: boolean;
  log: LogEntry[];
  winner: PlayerIndex | null;
  gameOverReason: string | null;
};
