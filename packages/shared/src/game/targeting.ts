// Who may target whom. This is the only module that knows what a variant means:
//
// - Free-for-all: attack any living opponent and any of their bases.
// - Hunter: attack the authority of the next living player in turn order (your
//   "prey", on your left) only, and the bases of your left and right neighbours.
//
// With two players both variants reduce to the normal duel.

import type { CardInstance, GameState, PlayerIndex } from "./types.js";
import { getCardDef } from "./cards.js";

export function isOutpost(card: CardInstance): boolean {
  return Boolean(getCardDef(card.defId).outpost);
}

export function alivePlayers(state: GameState): PlayerIndex[] {
  return state.players.flatMap((p, i) => (p.eliminated ? [] : [i]));
}

/** Next living player in turn order after `pi` (may be `pi` itself if nobody else is alive). */
export function nextAlive(state: GameState, pi: PlayerIndex): PlayerIndex {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (pi + step) % n;
    if (!state.players[i]!.eliminated) return i;
  }
  return pi;
}

/** Previous living player in turn order before `pi`. */
export function prevAlive(state: GameState, pi: PlayerIndex): PlayerIndex {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (pi - step + n) % n;
    if (!state.players[i]!.eliminated) return i;
  }
  return pi;
}

/** Living opponents of `pi` in turn order, starting with the player on their left. */
function livingOpponents(state: GameState, pi: PlayerIndex): PlayerIndex[] {
  const out: PlayerIndex[] = [];
  const n = state.players.length;
  for (let step = 1; step < n; step++) {
    const i = (pi + step) % n;
    if (!state.players[i]!.eliminated) out.push(i);
  }
  return out;
}

/**
 * Players whose authority `pi` may attack, and who "target opponent" effects may
 * hit. Outposts are not considered here; see `canAttackPlayer`.
 */
export function attackablePlayers(state: GameState, pi: PlayerIndex): PlayerIndex[] {
  if (state.players[pi]?.eliminated) return [];
  const opponents = livingOpponents(state, pi);
  if (state.variant === "hunter") return opponents.slice(0, 1);
  return opponents;
}

/** Players whose bases `pi` may attack or destroy. */
export function attackableBaseOwners(state: GameState, pi: PlayerIndex): PlayerIndex[] {
  if (state.players[pi]?.eliminated) return [];
  const opponents = livingOpponents(state, pi);
  if (state.variant === "hunter" && opponents.length > 0) {
    const left = opponents[0]!;
    const right = opponents[opponents.length - 1]!;
    return left === right ? [left] : [left, right];
  }
  return opponents;
}

/** An owner's bases that may be targeted right now: outposts first. */
function ownerTargets(state: GameState, owner: PlayerIndex): CardInstance[] {
  const bases = state.players[owner]!.bases;
  const outposts = bases.filter(isOutpost);
  return outposts.length > 0 ? outposts : bases;
}

/** Opponent bases the given player may currently target (each owner's outposts first). */
export function targetableBases(state: GameState, attacker: PlayerIndex): CardInstance[] {
  return attackableBaseOwners(state, attacker).flatMap((owner) => ownerTargets(state, owner));
}

/** Whose bases `uid` is, if `attacker` is allowed to target that owner's bases at all. */
export function baseOwner(
  state: GameState,
  attacker: PlayerIndex,
  uid: string,
): PlayerIndex | null {
  for (const owner of attackableBaseOwners(state, attacker)) {
    if (state.players[owner]!.bases.some((c) => c.uid === uid)) return owner;
  }
  return null;
}

export function canAttackPlayer(
  state: GameState,
  attacker: PlayerIndex,
  target: PlayerIndex,
): boolean {
  if (!attackablePlayers(state, attacker).includes(target)) return false;
  return !state.players[target]!.bases.some(isOutpost);
}
