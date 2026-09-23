// Builds the redacted per-player view of a game state.

import type { GameState, GameView, PlayerIndex, PublicPlayerView } from "./types.js";
import { attackableBaseOwners, attackablePlayers } from "./targeting.js";

const LOG_LIMIT = 200;

export function buildView(
  state: GameState,
  me: PlayerIndex,
  connected: boolean[] = state.players.map(() => true),
): GameView {
  const players = state.players.map(
    (p, i): PublicPlayerView => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      authority: p.authority,
      deckCount: p.deck.length,
      handCount: p.hand.length,
      discard: p.discard,
      inPlay: p.inPlay,
      bases: p.bases,
      trade: p.trade,
      combat: p.combat,
      pendingDiscard: p.pendingDiscard,
      nextShipToTop: p.nextShipToTop,
      used: p.used,
      connected: connected[i] ?? false,
      eliminated: p.eliminated,
    }),
  );

  const active = state.choices[0] ?? null;
  const mine = active && active.player === me ? active : null;

  return {
    id: state.id,
    me,
    turn: state.turn,
    current: state.current,
    variant: state.variant,
    players,
    hand: state.players[me].hand,
    tradeRow: state.tradeRow,
    tradeDeckCount: state.tradeDeck.length,
    explorers: state.explorers,
    scrapHeap: state.scrapHeap,
    choice: mine,
    choosing: active ? active.player : null,
    attackable: attackablePlayers(state, me),
    baseTargets: attackableBaseOwners(state, me),
    log: state.log.slice(-LOG_LIMIT),
    winner: state.winner,
    gameOverReason: state.gameOverReason,
  };
}
