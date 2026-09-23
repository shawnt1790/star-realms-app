import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CardInstance,
  ChoiceResolution,
  GameView,
  PlayerAction,
  PlayerIndex,
  RoomState,
} from "@sr/shared";
import { getCardDef } from "@sr/shared";
import type { Connection } from "../../hooks/useConnection";
import { Card } from "../Card";
import { ChoiceModal } from "../ChoiceModal";
import { GameOver } from "./GameOver";
import { Market } from "./Market";
import { MyBoard } from "./MyBoard";
import { OpponentBoard } from "./OpponentBoard";
import { SeatStrip } from "./SeatStrip";
import { Sidebar } from "./Sidebar";
import type { AttackControl } from "./types";

type Props = { conn: Connection; view: GameView; room: RoomState };

/** Opponents in play order, starting with the seat on my left. */
function opponentsFromLeft(view: GameView): PlayerIndex[] {
  const n = view.players.length;
  return Array.from({ length: n - 1 }, (_, k) => (view.me + 1 + k) % n);
}

/** Who I'd go after by default: the prey in Hunter, the weakest open player in free-for-all. */
function defaultTarget(view: GameView): PlayerIndex | null {
  const byAuthority = [...view.attackable].sort(
    (a, b) => view.players[a]!.authority - view.players[b]!.authority,
  );
  return (
    (view.variant === "hunter" ? view.attackable[0] : byAuthority[0]) ?? view.baseTargets[0] ?? null
  );
}

export function Game({ conn, view, room }: Props) {
  const me = view.players[view.me]!;
  const myTurn = view.current === view.me && view.winner === null;
  const blocked = !myTurn || view.choice !== null;
  const multi = view.players.length > 2;
  const opponents = opponentsFromLeft(view);

  // ---------------------------------------------------------------- focus
  // On my turn the focused opponent is my target: the last seat I clicked, else the
  // default. Otherwise it follows whoever is playing, unless I click a seat to peek
  // at it for the rest of that turn.
  const [picked, setPicked] = useState<PlayerIndex | null>(null);
  const [peek, setPeek] = useState<{ seat: PlayerIndex; turn: number } | null>(null);
  const alive = (i: PlayerIndex) => !view.players[i]!.eliminated;
  const fallback = defaultTarget(view) ?? opponents.find(alive) ?? opponents[0]!;
  const focused: PlayerIndex = myTurn
    ? picked !== null && alive(picked)
      ? picked
      : fallback
    : peek && peek.turn === view.turn
      ? peek.seat
      : view.current !== view.me && view.winner === null
        ? view.current
        : fallback;

  function focusSeat(seat: PlayerIndex) {
    if (myTurn) setPicked(seat);
    else setPeek({ seat, turn: view.turn });
  }

  // ---------------------------------------------------------------- attack
  // A chosen split only lasts for the turn it was chosen in.
  const [split, setSplit] = useState<{ turn: number; amount: number } | null>(null);
  const splitAmount = split?.turn === view.turn ? split.amount : null;
  const target = view.players[focused]!;
  const canHit = view.attackable.includes(focused);
  const walled = target.bases.some((b) => getCardDef(b.defId).outpost);
  const ready = me.combat > 0 && canHit && !walled;
  const amount = Math.min(Math.max(splitAmount ?? me.combat, 1), Math.max(me.combat, 1));
  const splittable = multi && view.variant === "ffa";
  const attack: AttackControl = {
    ready,
    enabled: ready && myTurn && !blocked,
    amount: splittable ? amount : me.combat,
    title: !canHit
      ? `You can't attack ${target.name} directly`
      : walled
        ? "Destroy their outposts first"
        : `Attack for ${splittable ? amount : me.combat} combat`,
    run: () => {
      const action: PlayerAction =
        splittable && amount < me.combat
          ? { type: "attack_player", target: focused, amount }
          : { type: "attack_player", target: focused };
      act(action);
      setSplit(null);
    },
  };

  // ---------------------------------------------------------------- preview
  const [hovered, setPreview] = useState<CardInstance | null>(null);
  // Only show the preview while the hovered card is still on the table; cards that
  // leave the board (bought, scrapped, played) never fire mouseleave.
  const visibleUids = useMemo(() => {
    const ids = new Set<string>();
    for (const p of view.players) {
      for (const c of [...p.inPlay, ...p.bases]) ids.add(c.uid);
      // Discard piles are only rendered inside the choice modal.
      if (view.choice) for (const c of p.discard) ids.add(c.uid);
    }
    for (const c of view.hand) ids.add(c.uid);
    for (const c of view.tradeRow) if (c) ids.add(c.uid);
    if (view.explorers > 0) ids.add("explorer");
    return ids;
  }, [view]);
  const preview = hovered && visibleUids.has(hovered.uid) ? hovered : null;

  // ---------------------------------------------------------------- actions
  const autoPlayRef = useRef(false);

  // "Play all" keeps going after a choice is resolved until the hand is empty.
  useEffect(() => {
    if (!autoPlayRef.current) return;
    if (!myTurn || view.hand.length === 0) {
      autoPlayRef.current = false;
      return;
    }
    if (view.choice) return;
    void conn.sendAction({ type: "play_all" });
  }, [myTurn, view.choice, view.hand.length, conn]);

  function playAll() {
    autoPlayRef.current = true;
    void conn.sendAction({ type: "play_all" });
  }

  function act(action: PlayerAction) {
    void conn.sendAction(action);
  }

  function resolve(resolution: ChoiceResolution) {
    if (!view.choice) return;
    act({ type: "resolve_choice", choiceId: view.choice.id, resolution });
  }

  function leave() {
    if (view.winner !== null || me.eliminated || window.confirm("Concede this game?")) {
      conn.leaveRoom();
    }
  }

  return (
    <div className={`game ${multi ? "multi" : ""}`}>
      {multi && <SeatStrip view={view} seats={opponents} focused={focused} onFocus={focusSeat} />}
      <OpponentBoard
        view={view}
        seat={focused}
        myTurn={myTurn}
        blocked={blocked}
        attack={attack}
        act={act}
        onHover={setPreview}
      />
      <Market view={view} myTurn={myTurn} blocked={blocked} act={act} onHover={setPreview} />
      <MyBoard view={view} myTurn={myTurn} blocked={blocked} act={act} onHover={setPreview} />
      <Sidebar
        view={view}
        myTurn={myTurn}
        blocked={blocked}
        target={focused}
        attack={attack}
        split={
          splittable
            ? { max: me.combat, set: (amount) => setSplit({ turn: view.turn, amount }) }
            : null
        }
        act={act}
        onPlayAll={playAll}
        onLeave={leave}
      />

      {preview && (
        <div className="preview">
          <Card card={preview} size="lg" />
        </div>
      )}

      {view.choice && (
        <ChoiceModal
          key={view.choice.id}
          view={view}
          choice={view.choice}
          onResolve={resolve}
          onHover={setPreview}
        />
      )}

      {view.winner !== null && (
        <GameOver conn={conn} view={view} room={room} opponents={opponents} />
      )}
    </div>
  );
}
