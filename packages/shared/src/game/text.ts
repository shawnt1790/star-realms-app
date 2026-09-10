// Human-readable descriptions of card effects, shared by the engine log and the UI.

import type { CardDef, Effect, Faction } from "./types.js";
import { FACTION_LABEL } from "./cards.js";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case "trade":
      return `+${e.amount} Trade`;
    case "combat":
      return `+${e.amount} Combat`;
    case "authority":
      return `+${e.amount} Authority`;
    case "draw":
      return `Draw ${plural(e.amount, "card")}`;
    case "opponent_discard":
      return `Target opponent discards ${plural(e.amount, "card")}`;
    case "scrap_hand_or_discard":
      return e.max === 1
        ? "Scrap a card in your hand or discard pile"
        : `Scrap up to ${e.max} cards in your hand or discard pile`;
    case "scrap_trade_row":
      return "Scrap a card in the trade row";
    case "destroy_base":
      return "Destroy target base";
    case "choose":
      return e.options.map((o) => o.label).join(" OR ");
    case "next_ship_to_top":
      return "Put the next ship you acquire this turn on top of your deck";
    case "acquire_free_ship_to_top":
      return "Acquire any ship without paying its cost and put it on top of your deck";
    case "copy_ship":
      return "Copy another ship you've played this turn";
    case "draw_if_bases":
      return `If you have ${e.bases} or more bases in play, draw ${plural(e.amount, "card")}`;
    case "draw_per_faction_played":
      return `Draw a card for each ${FACTION_LABEL[e.faction]} card you've played this turn`;
    case "discard_then_draw":
      return `Discard up to ${e.max} cards, then draw that many cards`;
    case "draw_then_scrap_hand":
      return "Draw a card, then scrap a card from your hand";
    case "scrap_hand_or_discard_draw":
      return `Scrap up to ${e.max} cards in your hand or discard pile, then draw a card for each card scrapped`;
    case "ships_combat_bonus":
      return `All of your ships get +${e.amount} Combat this turn`;
  }
}

export function describeEffects(effects: Effect[]): string {
  return effects.map(describeEffect).join(". ");
}

export function factionLabel(f: Faction): string {
  return FACTION_LABEL[f];
}

export function cardTypeLabel(def: CardDef): string {
  if (def.type === "ship") return "Ship";
  return def.outpost ? "Outpost" : "Base";
}
