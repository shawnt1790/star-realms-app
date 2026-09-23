import type { GameView } from "@sr/shared";
import { getCardDef } from "@sr/shared";
import { Card, CardBack } from "../Card";
import type { Act, OnHover } from "./types";

type Props = {
  view: GameView;
  myTurn: boolean;
  blocked: boolean;
  act: Act;
  onHover: OnHover;
};

/** Trade deck, trade row, Explorers and the scrap heap. */
export function Market({ view, myTurn, blocked, act, onHover }: Props) {
  const me = view.players[view.me]!;
  return (
    <section className="zone market">
      <CardBack count={view.tradeDeckCount} label="Trade deck" size="sm" />
      <div className="card-row trade-row">
        {view.tradeRow.map((c, i) =>
          c ? (
            <Card
              key={c.uid}
              card={c}
              size="sm"
              onHover={onHover}
              highlight={myTurn && !blocked && me.trade >= getCardDef(c.defId).cost}
              dimmed={myTurn && me.trade < getCardDef(c.defId).cost}
              onClick={
                myTurn && !blocked && me.trade >= getCardDef(c.defId).cost
                  ? () => act({ type: "buy", slot: i })
                  : undefined
              }
              title={`Buy for ${getCardDef(c.defId).cost}`}
            />
          ) : (
            <div key={`empty-${i}`} className="card card-sm slot-empty" />
          ),
        )}
      </div>
      <div className="explorer-pile">
        {view.explorers > 0 ? (
          <Card
            card="explorer"
            size="sm"
            badge={`×${view.explorers}`}
            onHover={onHover}
            highlight={myTurn && !blocked && me.trade >= 2}
            dimmed={myTurn && me.trade < 2}
            onClick={
              myTurn && !blocked && me.trade >= 2
                ? () => act({ type: "buy", slot: "explorer" })
                : undefined
            }
            title="Buy an Explorer for 2"
          />
        ) : (
          <div className="card card-sm slot-empty">No explorers</div>
        )}
      </div>
      <div className="scrap-heap" title="Scrapped cards">
        <div className="card-back-count">{view.scrapHeap.length}</div>
        <div className="card-back-label">Scrap heap</div>
      </div>
    </section>
  );
}
