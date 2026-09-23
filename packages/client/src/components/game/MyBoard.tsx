import type { GameView } from "@sr/shared";
import { effectiveDef, getCardDef, isSimpleEffects } from "@sr/shared";
import { Card } from "../Card";
import type { Act, OnHover } from "./types";

type Props = {
  view: GameView;
  myTurn: boolean;
  blocked: boolean;
  act: Act;
  onHover: OnHover;
};

/** My bases, ships in play, and hand. */
export function MyBoard({ view, myTurn, blocked, act, onHover }: Props) {
  const me = view.players[view.me]!;
  return (
    <section className={`zone mine ${myTurn ? "active" : ""}`}>
      <div className="zone-cards">
        <div className="subzone">
          <div className="zone-label">Your bases</div>
          <div className="card-row">
            {me.bases.length === 0 && <div className="empty">none</div>}
            {me.bases.map((b) => {
              const def = getCardDef(b.defId);
              const used = me.used[b.uid] ?? {};
              const canActivate = myTurn && !blocked && !used.primary && def.primary.length > 0;
              const actions = [];
              if (def.primary.length > 0) {
                actions.push({
                  label: used.primary ? "Used" : isSimpleEffects(def.primary) ? "Use" : "Choose",
                  disabled: !canActivate,
                  onClick: () => act({ type: "activate_base", uid: b.uid }),
                });
              }
              if (def.scrap && def.scrap.length > 0) {
                actions.push({
                  label: "Scrap",
                  disabled: !myTurn || blocked,
                  onClick: () => act({ type: "scrap_card", uid: b.uid }),
                });
              }
              return (
                <Card
                  key={b.uid}
                  card={b}
                  size="sm"
                  onHover={onHover}
                  highlight={canActivate}
                  onClick={
                    canActivate ? () => act({ type: "activate_base", uid: b.uid }) : undefined
                  }
                  actions={actions}
                  badge={used.ally ? "ally ✓" : undefined}
                />
              );
            })}
          </div>
        </div>
        <div className="subzone grow">
          <div className="zone-label">In play</div>
          <div className="card-row">
            {me.inPlay.length === 0 && <div className="empty">—</div>}
            {me.inPlay.map((c) => {
              const def = effectiveDef(c);
              const used = me.used[c.uid] ?? {};
              const actions =
                def.scrap && def.scrap.length > 0
                  ? [
                      {
                        label: "Scrap",
                        disabled: !myTurn || blocked,
                        onClick: () => act({ type: "scrap_card", uid: c.uid }),
                      },
                    ]
                  : [];
              return (
                <Card
                  key={c.uid}
                  card={c}
                  size="sm"
                  onHover={onHover}
                  actions={actions}
                  badge={used.ally ? "ally ✓" : undefined}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="hand-area">
        <div className="zone-label">
          Your hand
          <span className="muted">
            {" "}
            · deck {me.deckCount} · discard {me.discard.length}
          </span>
        </div>
        <div className="card-row hand">
          {view.hand.length === 0 && <div className="empty">no cards in hand</div>}
          {view.hand.map((c) => (
            <Card
              key={c.uid}
              card={c}
              size="md"
              onHover={onHover}
              highlight={myTurn && !blocked}
              onClick={
                myTurn && !blocked ? () => act({ type: "play_card", uid: c.uid }) : undefined
              }
              title="Play"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
