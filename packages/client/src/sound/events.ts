import type { GameView, PlayerAction } from "@sr/shared";
import type { SoundName } from "./sounds";

/**
 * The one sound (if any) for a new game view, comparing it with the previous one.
 * With several events in one update, the most important wins. `prev` is null for
 * the first view after loading, reconnecting or a rematch, so catching up on
 * missed state never sets off a burst of sounds. The one exception is a game that
 * has just started with this player going first.
 */
export function soundForUpdate(prev: GameView | null, next: GameView): SoundName | null {
  if (!prev || prev.id !== next.id || prev.me !== next.me) {
    return next.turn === 1 && next.current === next.me && next.winner === null ? "turn" : null;
  }
  const me = next.me;
  const was = prev.players[me]!;
  const now = next.players[me]!;

  if (prev.winner === null && next.winner !== null) {
    // Already knocked out: the defeat sound played then.
    if (was.eliminated) return null;
    return next.winner === me ? "victory" : "defeat";
  }
  if (!was.eliminated && now.eliminated) return "defeat";
  if (next.eliminationOrder.length > prev.eliminationOrder.length) return "eliminated";

  const kept = new Set(now.bases.map((b) => b.uid));
  if (was.bases.some((b) => !kept.has(b.uid)) && next.current !== me) return "baseLost";
  if (now.authority < was.authority) return "hit";

  if (next.choice && next.choice.id !== prev.choice?.id && next.current !== me) return "choice";
  if (prev.current !== me && next.current === me) return "turn";
  return null;
}

/** Feedback for the player's own successful actions. */
export function soundForAction(action: PlayerAction): SoundName | null {
  switch (action.type) {
    case "buy":
      return "buy";
    case "attack_player":
      return "attack";
    case "attack_base":
      // Attacking a base always destroys it: you need combat equal to its defense.
      return "baseDestroyed";
    default:
      return null;
  }
}
