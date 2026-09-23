import type { CardInstance, GameView, PlayerIndex } from "@sr/shared";
import { getCardDef } from "@sr/shared";
import { Card } from "../Card";
import type { Act, AttackControl, OnHover } from "./types";

type Props = {
  view: GameView;
  seat: PlayerIndex;
  myTurn: boolean;
  blocked: boolean;
  attack: AttackControl;
  act: Act;
  onHover: OnHover;
};

/** Bases and ships in play for one opponent: the whole top zone in a duel. */
export function OpponentBoard({ view, seat, myTurn, blocked, attack, act, onHover }: Props) {
  const opp = view.players[seat]!;
  const me = view.players[view.me]!;
  const oppHasOutpost = opp.bases.some((b) => getCardDef(b.defId).outpost);

  function baseTargetable(base: CardInstance): boolean {
    if (!view.baseTargets.includes(seat)) return false;
    const def = getCardDef(base.defId);
    if (!def.outpost && oppHasOutpost) return false;
    return me.combat >= (def.defense ?? 0);
  }

  const active = view.current === seat && view.winner === null;

  return (
    <section className={`zone opp ${active ? "active" : ""}`}>
      <div className="player-panel">
        <div className="pname">
          {opp.name}
          {opp.isBot && <span className="chip">bot</span>}
          {opp.eliminated && <span className="chip warn">out</span>}
          {!opp.connected && !opp.isBot && <span className="chip warn">disconnected</span>}
        </div>
        <div className="authority">
          <span className="big">{Math.max(opp.authority, 0)}</span>
          <small>authority</small>
        </div>
        <div className="counts">
          <span title="Deck">🂠 {opp.deckCount}</span>
          <span title="Hand">✋ {opp.handCount}</span>
          <span title="Discard pile">🗑 {opp.discard.length}</span>
        </div>
        {active && (
          <div className="pool">
            <span className="res trade">{opp.trade}</span>
            <span className="res combat">{opp.combat}</span>
          </div>
        )}
        <button
          className="btn attack"
          disabled={!attack.enabled}
          onClick={attack.run}
          title={attack.title}
        >
          ⚔ Attack {attack.ready ? `(${attack.amount})` : ""}
        </button>
      </div>
      <div className="zone-cards">
        <div className="subzone">
          <div className="zone-label">Bases</div>
          <div className="card-row">
            {opp.bases.length === 0 && <div className="empty">none</div>}
            {opp.bases.map((b) => (
              <Card
                key={b.uid}
                card={b}
                size="sm"
                onHover={onHover}
                highlight={myTurn && !blocked && baseTargetable(b)}
                onClick={
                  myTurn && !blocked && baseTargetable(b)
                    ? () => act({ type: "attack_base", uid: b.uid })
                    : undefined
                }
                title={
                  myTurn && baseTargetable(b)
                    ? `Destroy (${getCardDef(b.defId).defense} combat)`
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        <div className="subzone grow">
          <div className="zone-label">In play</div>
          <div className="card-row">
            {opp.inPlay.length === 0 && <div className="empty">—</div>}
            {opp.inPlay.map((c) => (
              <Card key={c.uid} card={c} size="sm" onHover={onHover} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
