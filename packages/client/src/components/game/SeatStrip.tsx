import type { GameView, PlayerIndex } from "@sr/shared";
import { getCardDef } from "@sr/shared";

type Props = {
  view: GameView;
  /** Opponents in play order, starting with the seat on my left. */
  seats: PlayerIndex[];
  focused: PlayerIndex;
  onFocus: (seat: PlayerIndex) => void;
};

/**
 * One compact card per opponent: authority, pile counts, a glyph per base, and
 * chips for what the variant lets me do to them. Clicking a card focuses that
 * opponent's board (and makes them the attack target on my turn).
 */
export function SeatStrip({ view, seats, focused, onFocus }: Props) {
  const hunter = view.variant === "hunter";
  return (
    <nav className="seat-strip" aria-label="Opponents">
      {seats.map((i) => {
        const p = view.players[i]!;
        const playing = i === view.current && view.winner === null;
        const canHit = view.attackable.includes(i);
        const basesOnly = !canHit && view.baseTargets.includes(i);
        const classes = [
          "seat-card",
          playing ? "playing" : "",
          i === focused ? "focused" : "",
          p.eliminated ? "out" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={i}
            type="button"
            className={classes}
            onClick={() => onFocus(i)}
            aria-pressed={i === focused}
            title={`Show ${p.name}'s board`}
          >
            <div className="seat-head">
              <span className="seat-name">
                {playing && <span className="seat-turn">▸</span>}
                {p.name}
              </span>
              <span className="seat-auth">{p.eliminated ? "out" : Math.max(p.authority, 0)}</span>
            </div>
            <div className="seat-counts">
              <span title="Deck">🂠 {p.deckCount}</span>
              <span title="Hand">✋ {p.handCount}</span>
              <span title="Discard pile">🗑 {p.discard.length}</span>
            </div>
            <div className="seat-bases">
              {p.bases.length === 0 && <span className="muted">no bases</span>}
              {p.bases.map((b) => {
                const def = getCardDef(b.defId);
                return (
                  <span
                    key={b.uid}
                    className={`base-glyph faction-${def.faction} ${def.outpost ? "outpost" : ""}`}
                    title={`${def.name} · ${def.defense} defense${def.outpost ? " · outpost" : ""}`}
                  />
                );
              })}
            </div>
            <div className="seat-chips">
              {hunter && canHit && <span className="chip prey">prey</span>}
              {hunter && view.huntedBy === i && <span className="chip hunter">hunts you</span>}
              {hunter && basesOnly && <span className="chip">bases only</span>}
              {p.isBot && <span className="chip">bot</span>}
              {!p.connected && !p.isBot && <span className="chip warn">disconnected</span>}
              {p.eliminated && <span className="chip warn">eliminated</span>}
            </div>
          </button>
        );
      })}
    </nav>
  );
}
