import type { CardDef, CardInstance } from "@sr/shared";
import { describeEffects, getCardDef } from "@sr/shared";

export type CardAction = { label: string; onClick: () => void; disabled?: boolean; title?: string };

type Props = {
  card: CardInstance | string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  selected?: boolean;
  dimmed?: boolean;
  highlight?: boolean;
  badge?: string;
  actions?: CardAction[];
  onHover?: (card: CardInstance | null) => void;
  title?: string;
};

const FACTION_GLYPH: Record<CardDef["faction"], string> = {
  trade_federation: "◆",
  blob: "●",
  machine_cult: "⚙",
  star_empire: "★",
  neutral: "○",
};

function toInstance(card: CardInstance | string): CardInstance {
  return typeof card === "string" ? { uid: card, defId: card } : card;
}

export function Card({
  card,
  size = "md",
  onClick,
  selected,
  dimmed,
  highlight,
  badge,
  actions,
  onHover,
  title,
}: Props) {
  const inst = toInstance(card);
  const def = getCardDef(inst.defId);
  const copied = inst.copyOf ? getCardDef(inst.copyOf) : null;
  const abilities = copied ?? def;
  const classes = [
    "card",
    `card-${size}`,
    `faction-${def.faction}`,
    onClick ? "clickable" : "",
    selected ? "selected" : "",
    dimmed ? "dimmed" : "",
    highlight ? "highlight" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(inst) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      title={title}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="card-head">
        <span className="card-name">{def.name}</span>
        {def.cost > 0 && <span className="card-cost">{def.cost}</span>}
      </div>
      <div className="card-art">
        <span className="card-glyph">{FACTION_GLYPH[def.faction]}</span>
        {def.type === "base" && (
          <span className={`card-defense ${def.outpost ? "outpost" : ""}`}>
            {def.defense}
            <small>{def.outpost ? "outpost" : "base"}</small>
          </span>
        )}
      </div>
      <div className="card-body">
        {copied && <div className="ab copy">Copying {copied.name}</div>}
        {abilities.primary.length > 0 && (
          <div className="ab primary">{describeEffects(abilities.primary)}</div>
        )}
        {def.allyAllFactions && (
          <div className="ab primary">Counts as an ally for all factions</div>
        )}
        {abilities.ally && abilities.ally.length > 0 && (
          <div className="ab ally">
            <span className="tag">Ally</span> {describeEffects(abilities.ally)}
          </div>
        )}
        {abilities.scrap && abilities.scrap.length > 0 && (
          <div className="ab scrap">
            <span className="tag">Scrap</span> {describeEffects(abilities.scrap)}
          </div>
        )}
      </div>
      {badge && <div className="card-badge">{badge}</div>}
      {actions && actions.length > 0 && (
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button
              key={a.label}
              className="btn tiny"
              disabled={a.disabled}
              title={a.title}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardBack({
  count,
  label,
  size = "md",
}: {
  count: number;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={`card card-${size} card-back`}>
      <div className="card-back-count">{count}</div>
      <div className="card-back-label">{label}</div>
    </div>
  );
}
