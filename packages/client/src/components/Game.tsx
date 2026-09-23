import { useEffect, useMemo, useRef, useState } from "react";
import type { CardInstance, ChoiceResolution, GameView, PlayerAction, RoomState } from "@sr/shared";
import { effectiveDef, getCardDef, isSimpleEffects } from "@sr/shared";
import type { Connection } from "../hooks/useConnection";
import { Card, CardBack } from "./Card";
import { ChoiceModal } from "./ChoiceModal";

type Props = { conn: Connection; view: GameView; room: RoomState };

export function Game({ conn, view, room }: Props) {
  const me = view.players[view.me];
  // Still a 2-player table: the single opponent panel shows the next seat.
  const oppIdx = (view.me + 1) % view.players.length;
  const opp = view.players[oppIdx];
  const myTurn = view.current === view.me && view.winner === null;
  const blocked = !myTurn || view.choice !== null;
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
  const [showLog, setShowLog] = useState(true);
  const autoPlayRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.log.length]);

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

  const oppHasOutpost = opp.bases.some((b) => getCardDef(b.defId).outpost);
  const canAttackFace = myTurn && !blocked && me.combat > 0 && !oppHasOutpost;

  function baseTargetable(base: CardInstance): boolean {
    const def = getCardDef(base.defId);
    if (!def.outpost && oppHasOutpost) return false;
    return me.combat >= (def.defense ?? 0);
  }

  const winnerName = view.winner === null ? null : view.players[view.winner].name;
  const iWon = view.winner === view.me;
  const meRoom = room.players.find((p) => p.id === conn.playerId);
  const oppRoom = room.players.find((p) => p.id !== conn.playerId);

  return (
    <div className="game">
      {/* ------------------------------------------------ opponent */}
      <section className={`zone opp ${!myTurn && view.winner === null ? "active" : ""}`}>
        <div className="player-panel">
          <div className="pname">
            {opp.name}
            {opp.isBot && <span className="chip">bot</span>}
            {!opp.connected && <span className="chip warn">disconnected</span>}
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
          {!myTurn && view.winner === null && (
            <div className="pool">
              <span className="res trade">{opp.trade}</span>
              <span className="res combat">{opp.combat}</span>
            </div>
          )}
          <button
            className="btn attack"
            disabled={!canAttackFace}
            onClick={() => act({ type: "attack_player" })}
            title={
              oppHasOutpost ? "Destroy their outposts first" : `Attack for ${me.combat} combat`
            }
          >
            ⚔ Attack {me.combat > 0 && !oppHasOutpost ? `(${me.combat})` : ""}
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
                  onHover={setPreview}
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
                <Card key={c.uid} card={c} size="sm" onHover={setPreview} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ trade row */}
      <section className="zone market">
        <CardBack count={view.tradeDeckCount} label="Trade deck" size="sm" />
        <div className="card-row trade-row">
          {view.tradeRow.map((c, i) =>
            c ? (
              <Card
                key={c.uid}
                card={c}
                size="sm"
                onHover={setPreview}
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
              onHover={setPreview}
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

      {/* ------------------------------------------------ me */}
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
                    onHover={setPreview}
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
                    onHover={setPreview}
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
                onHover={setPreview}
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

      {/* ------------------------------------------------ sidebar */}
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
          <button className="btn" disabled={blocked || view.hand.length === 0} onClick={playAll}>
            Play all
          </button>
          <button
            className="btn attack"
            disabled={!canAttackFace}
            onClick={() => act({ type: "attack_player" })}
          >
            Attack {me.combat > 0 ? `(${me.combat})` : ""}
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
          <button
            className="btn ghost small"
            onClick={() => {
              if (view.winner !== null || window.confirm("Concede this game?")) conn.leaveRoom();
            }}
          >
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

      {/* ------------------------------------------------ overlays */}
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
        <div className="modal-backdrop">
          <div className="modal gameover">
            <h2>{iWon ? "Victory!" : "Defeat"}</h2>
            <p>
              {winnerName} wins. {view.gameOverReason}
            </p>
            <p className="muted">
              Final authority: {me.name} {Math.max(me.authority, 0)} · {opp.name}{" "}
              {Math.max(opp.authority, 0)}
            </p>
            {oppRoom && !oppRoom.isBot && (
              <p className="muted">
                {oppRoom.connected
                  ? oppRoom.ready
                    ? `${oppRoom.name} wants a rematch.`
                    : `Waiting for ${oppRoom.name}…`
                  : `${oppRoom.name} has left.`}
              </p>
            )}
            <div className="row center">
              <button className="btn ghost" onClick={conn.leaveRoom}>
                Back to menu
              </button>
              <button
                className={`btn ${meRoom?.ready ? "" : "primary"}`}
                onClick={() => conn.setReady(!meRoom?.ready)}
              >
                {meRoom?.ready ? "Cancel rematch" : "Rematch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
