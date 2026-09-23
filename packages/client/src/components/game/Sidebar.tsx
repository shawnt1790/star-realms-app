import { useEffect, useRef, useState } from "react";
import type { GameView, PlayerIndex } from "@sr/shared";
import type { Act, AttackControl } from "./types";

type Props = {
  view: GameView;
  myTurn: boolean;
  blocked: boolean;
  /** Who the sidebar's attack button hits. */
  target: PlayerIndex;
  attack: AttackControl;
  /** Free-for-all only: choose how much of the combat pool the next attack uses. */
  split: { max: number; set: (amount: number) => void } | null;
  act: Act;
  onPlayAll: () => void;
  onLeave: () => void;
};

export function Sidebar({
  view,
  myTurn,
  blocked,
  target,
  attack,
  split,
  act,
  onPlayAll,
  onLeave,
}: Props) {
  const me = view.players[view.me]!;
  const multi = view.players.length > 2;
  const [showLog, setShowLog] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.log.length]);

  return (
    <aside className="sidebar">
      <div className="player-panel me">
        <div className="pname">
          {me.name} <span className="chip">you</span>
        </div>
        <div className="authority">
          <span className="big">{Math.max(me.authority, 0)}</span>
          <small>authority</small>
        </div>
        <div className="pool big-pool">
          <div className="res trade" title="Trade">
            <b>{me.trade}</b>
            <small>trade</small>
          </div>
          <div className="res combat" title="Combat">
            <b>{me.combat}</b>
            <small>combat</small>
          </div>
        </div>
        {me.nextShipToTop > 0 && (
          <div className="note">Next ship bought goes on top of your deck</div>
        )}
      </div>

      <div className="turn-banner">
        {view.winner !== null
          ? "Game over"
          : me.eliminated
            ? "You're out — spectating"
            : myTurn
              ? view.choice
                ? "Make a choice"
                : "Your turn"
              : view.choosing !== null && view.choosing !== view.me
                ? `${view.players[view.choosing]!.name} is choosing…`
                : `${view.players[view.current]!.name}'s turn`}
        <small>turn {view.turn}</small>
      </div>

      <div className="actions">
        <button className="btn" disabled={blocked || view.hand.length === 0} onClick={onPlayAll}>
          Play all
        </button>
        {split && attack.enabled && split.max > 1 && (
          <div className="split" aria-label="Combat to spend on this attack">
            <button
              className="btn ghost small"
              disabled={attack.amount <= 1}
              onClick={() => split.set(attack.amount - 1)}
              aria-label="Less"
            >
              −
            </button>
            <span>
              <b>{attack.amount}</b> of {split.max}
            </span>
            <button
              className="btn ghost small"
              disabled={attack.amount >= split.max}
              onClick={() => split.set(attack.amount + 1)}
              aria-label="More"
            >
              +
            </button>
          </div>
        )}
        <button
          className="btn attack"
          disabled={!attack.enabled}
          onClick={attack.run}
          title={attack.title}
        >
          Attack{multi ? ` ${view.players[target]!.name}` : ""}{" "}
          {me.combat > 0 ? `(${multi ? attack.amount : me.combat})` : ""}
        </button>
        <button
          className="btn primary"
          disabled={blocked}
          onClick={() => act({ type: "end_turn" })}
          title={
            me.trade > 0 || me.combat > 0 ? "You still have unspent resources" : "End your turn"
          }
        >
          End turn{me.trade > 0 || me.combat > 0 ? " ⚠" : ""}
        </button>
        <button className="btn ghost small" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="log-panel">
        <div className="zone-label clickable" onClick={() => setShowLog((s) => !s)}>
          Log {showLog ? "▾" : "▸"}
        </div>
        {showLog && (
          <div className="log" ref={logRef}>
            {view.log.map((e, i) => (
              <div
                key={i}
                className={`log-line ${e.player === null ? "sys" : e.player === view.me ? "me" : "opp"}`}
              >
                {e.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
