import { useState } from "react";
import type { Connection } from "../hooks/useConnection";
import { loadName, saveName } from "../identity";

export function Home({ conn }: { conn: Connection }) {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const canGo = clean.length > 0 && conn.connected && !busy;

  function remember() {
    saveName(clean);
  }

  async function run(fn: () => Promise<unknown> | void) {
    if (!canGo) return;
    remember();
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <div className="hero">
        <h1>
          StarRealms<span className="io">.io</span>
        </h1>
        <p className="tagline">
          The deck-building space battle. Play in your browser, no account needed.
        </p>
        <p className={`conn ${conn.connected ? "on" : "off"}`}>
          {conn.connected ? "Connected" : "Connecting to server…"}
        </p>
      </div>

      <div className="panel home-panel">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={20}
            placeholder="Commander"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run(() => conn.createRoom(clean, "solo"));
            }}
            autoFocus
          />
        </label>

        {conn.queueWaiting ? (
          <div className="queue-wait">
            <div className="spinner" />
            <div>Looking for an opponent…</div>
            <button className="btn ghost" onClick={conn.cancelQueue}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="home-actions">
            <button
              className="btn primary big"
              disabled={!canGo}
              onClick={() => run(() => conn.createRoom(clean, "solo"))}
            >
              Play vs Computer
            </button>
            <button
              className="btn big"
              disabled={!canGo}
              onClick={() => run(() => conn.quickMatch(clean))}
            >
              Quick Match
            </button>
            <button
              className="btn big"
              disabled={!canGo}
              onClick={() => run(() => conn.createRoom(clean, "private"))}
            >
              Create Private Room
            </button>
            <div className="join-row">
              <input
                placeholder="Room code"
                value={code}
                maxLength={6}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim()) void run(() => conn.joinRoom(code, clean));
                }}
              />
              <button
                className="btn"
                disabled={!canGo || code.trim().length === 0}
                onClick={() => run(() => conn.joinRoom(code, clean))}
              >
                Join
              </button>
            </div>
          </div>
        )}
      </div>

      <details className="rules panel">
        <summary>How to play</summary>
        <ul>
          <li>Each turn, play cards from your hand to gain Trade, Combat and Authority.</li>
          <li>
            Spend Trade to buy ships and bases from the trade row. Purchases go to your discard
            pile.
          </li>
          <li>
            Spend Combat to attack your opponent&apos;s Authority, or to destroy their bases.
            Outposts must be destroyed first.
          </li>
          <li>
            Cards of the same faction unlock each other&apos;s Ally abilities. Scrap abilities
            remove the card from the game for a bonus.
          </li>
          <li>Reduce your opponent from 50 Authority to 0 to win.</li>
        </ul>
      </details>
    </div>
  );
}
