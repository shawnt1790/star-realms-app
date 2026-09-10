import { useMemo, useState } from "react";
import type { CardInstance, Choice, ChoiceResolution, GameView } from "@sr/shared";
import { EXPLORER, getCardDef } from "@sr/shared";
import { Card } from "./Card";

type Props = {
  view: GameView;
  choice: Choice;
  onResolve: (resolution: ChoiceResolution) => void;
  onHover: (card: CardInstance | null) => void;
};

type Candidate = { card: CardInstance; zone: string };

function collectCandidates(view: GameView, uids: string[]): Candidate[] {
  const me = view.players[view.me];
  const opp = view.players[view.me === 0 ? 1 : 0];
  const zones: [string, CardInstance[]][] = [
    ["Your hand", view.hand],
    ["Your discard pile", me.discard],
    ["In play", me.inPlay],
    ["Trade row", view.tradeRow.filter((c): c is CardInstance => c !== null)],
    [`${opp.name}'s bases`, opp.bases],
  ];
  const out: Candidate[] = [];
  for (const uid of uids) {
    if (uid === EXPLORER) {
      out.push({ card: { uid: EXPLORER, defId: EXPLORER }, zone: "Explorers" });
      continue;
    }
    for (const [zone, cards] of zones) {
      const card = cards.find((c) => c.uid === uid);
      if (card) {
        out.push({ card, zone });
        break;
      }
    }
  }
  return out;
}

export function ChoiceModal({ view, choice, onResolve, onHover }: Props) {
  // Remounted by the parent (key={choice.id}) so selection resets per choice.
  const [picked, setPicked] = useState<string[]>([]);

  const source = choice.sourceDefId ? getCardDef(choice.sourceDefId) : null;

  const candidates = useMemo(
    () => (choice.type === "select_cards" ? collectCandidates(view, choice.candidates) : []),
    [view, choice],
  );

  if (choice.type === "choose_option") {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h3>{source ? source.name : "Choose"}</h3>
          <p>{choice.prompt}</p>
          <div className="option-list">
            {choice.options.map((o, i) => (
              <button key={i} className="btn primary big" onClick={() => onResolve({ option: i })}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const grouped = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = grouped.get(c.zone) ?? [];
    list.push(c);
    grouped.set(c.zone, list);
  }
  const canConfirm = picked.length >= choice.min && picked.length <= choice.max;

  function toggle(uid: string) {
    setPicked((prev) => {
      if (prev.includes(uid)) return prev.filter((u) => u !== uid);
      if (choice.type === "select_cards" && choice.max === 1) return [uid];
      if (choice.type === "select_cards" && prev.length >= choice.max) return prev;
      return [...prev, uid];
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h3>{source ? source.name : "Your turn"}</h3>
        <p>
          {choice.prompt}{" "}
          <span className="muted">
            ({picked.length}/{choice.max} selected{choice.min > 0 ? `, need ${choice.min}` : ""})
          </span>
        </p>
        <div className="choice-zones">
          {[...grouped.entries()].map(([zone, items]) => (
            <div key={zone} className="choice-zone">
              <div className="zone-label">{zone}</div>
              <div className="card-row wrap">
                {items.map(({ card }) => (
                  <Card
                    key={card.uid}
                    card={card}
                    size="sm"
                    selected={picked.includes(card.uid)}
                    onClick={() => toggle(card.uid)}
                    onHover={onHover}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="row end">
          {choice.min === 0 && (
            <button className="btn ghost" onClick={() => onResolve({ cardUids: [] })}>
              Skip
            </button>
          )}
          <button
            className="btn primary"
            disabled={!canConfirm}
            onClick={() => onResolve({ cardUids: picked })}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
