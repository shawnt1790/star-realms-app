import type { GameView, PlayerIndex, RoomState } from "@sr/shared";
import type { Connection } from "../../hooks/useConnection";

type Props = {
  conn: Connection;
  view: GameView;
  room: RoomState;
  /** Opponents in play order from my left, for the duel's authority line. */
  opponents: PlayerIndex[];
};

/** Places from first to last: the winner, then the reverse of elimination order. */
function standings(view: GameView): PlayerIndex[] {
  const out = view.winner === null ? [] : [view.winner];
  for (const i of [...view.eliminationOrder].reverse()) if (!out.includes(i)) out.push(i);
  view.players.forEach((_, i) => {
    if (!out.includes(i)) out.push(i);
  });
  return out;
}

const PLACE = ["1st", "2nd", "3rd", "4th"];

export function GameOver({ conn, view, room, opponents }: Props) {
  const multi = view.players.length > 2;
  const winnerName = view.winner === null ? null : view.players[view.winner]!.name;
  const iWon = view.winner === view.me;
  const meRoom = room.players.find((p) => p.id === conn.playerId);
  const otherHumans = view.players.filter((p) => p.id !== conn.playerId && !p.isBot);

  return (
    <div className="modal-backdrop">
      <div className="modal gameover">
        <h2>{iWon ? "Victory!" : "Defeat"}</h2>
        <p>
          {winnerName} wins. {view.gameOverReason}
        </p>
        {multi ? (
          <ol className="standings">
            {standings(view).map((i, place) => {
              const p = view.players[i]!;
              return (
                <li key={i} className={i === view.me ? "me" : ""}>
                  <span className="place">{PLACE[place]}</span>
                  <span className="pname">
                    {p.name}
                    {i === view.me && <span className="chip">you</span>}
                  </span>
                  <span className="seat-auth">{Math.max(p.authority, 0)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted">
            Final authority:{" "}
            {[view.me, ...opponents]
              .map((i) => `${view.players[i]!.name} ${Math.max(view.players[i]!.authority, 0)}`)
              .join(" · ")}
          </p>
        )}
        {otherHumans.map((p) => {
          const r = room.players.find((rp) => rp.id === p.id);
          return (
            <p key={p.id} className="muted">
              {!r
                ? `${p.name} has left.`
                : !r.connected
                  ? `${r.name} is disconnected.`
                  : r.ready
                    ? `${r.name} wants a rematch.`
                    : `Waiting for ${r.name}…`}
            </p>
          );
        })}
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
  );
}
