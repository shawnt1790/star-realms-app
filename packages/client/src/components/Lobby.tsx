import { useState } from "react";
import type { RoomState } from "@sr/shared";
import type { Connection } from "../hooks/useConnection";

export function Lobby({ conn, room }: { conn: Connection; room: RoomState }) {
  const me = room.players.find((p) => p.id === conn.playerId) ?? null;
  const amHost = Boolean(me?.isHost);
  const missing = Math.max(room.maxPlayers - room.players.length, 0);
  const full = missing === 0;
  const allReady = full && room.players.every((p) => p.ready && p.connected);
  const [copied, setCopied] = useState(false);

  function copyCode() {
    void navigator.clipboard?.writeText(room.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="lobby">
      <div className="panel">
        <h2>{room.mode === "quick" ? "Quick match" : "Private room"}</h2>
        {room.maxPlayers > 2 && (
          <p className="muted">
            {room.maxPlayers} players · {room.variant === "hunter" ? "Hunter" : "Free-for-all"}
          </p>
        )}
        <div className="room-code" onClick={copyCode} title="Click to copy">
          <span>{room.code}</span>
          <small>{copied ? "copied!" : "click to copy"}</small>
        </div>
        <p className="muted">
          Share this code with {room.maxPlayers === 2 ? "a friend" : "friends"} so they can join.
        </p>

        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <span className={`dot ${p.ready ? "ready" : ""}`} />
              <span className="pname">
                {p.name}
                {p.id === conn.playerId ? " (you)" : ""}
              </span>
              {p.isHost && <span className="chip">host</span>}
              {!p.connected && <span className="chip warn">disconnected</span>}
              <span className="status">{p.ready ? "Ready" : "Not ready"}</span>
            </li>
          ))}
          {!full && (
            <li className="waiting">
              <div className="spinner small" />{" "}
              {room.maxPlayers === 2
                ? "Waiting for a second player…"
                : `Waiting for ${missing} more player${missing === 1 ? "" : "s"}…`}
            </li>
          )}
        </ul>

        <div className="row">
          <button className="btn ghost" onClick={conn.leaveRoom}>
            Leave
          </button>
          <button
            className={`btn ${me?.ready ? "" : "primary"}`}
            disabled={!me?.connected}
            onClick={() => conn.setReady(!me?.ready)}
          >
            {me?.ready ? "Not ready" : "Ready up"}
          </button>
          {amHost && (
            <button
              className="btn primary"
              disabled={!allReady}
              onClick={conn.startGame}
              title={
                !full
                  ? `Need ${room.maxPlayers} players`
                  : !allReady
                    ? "Everyone must be ready"
                    : "Start"
              }
            >
              Start game
            </button>
          )}
        </div>
        {!amHost && full && allReady && <p className="muted">Waiting for the host to start…</p>}
      </div>
    </div>
  );
}
