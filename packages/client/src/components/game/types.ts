import type { CardInstance, PlayerAction } from "@sr/shared";

export type Act = (action: PlayerAction) => void;
export type OnHover = (card: CardInstance | null) => void;

/** The attack-authority control, shared by the opponent panel and the sidebar. */
export type AttackControl = {
  /** Combat in the pool and nothing (variant, outposts) protecting the target. */
  ready: boolean;
  /** `ready`, and it's my turn with no choice pending. */
  enabled: boolean;
  /** Damage the next attack deals (all remaining combat unless split). */
  amount: number;
  title: string;
  run: () => void;
};
