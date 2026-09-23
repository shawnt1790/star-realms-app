import { useState } from "react";
import type { Connection } from "../hooks/useConnection";
import { loadName, loadTable, saveName, saveTable, type TablePrefs } from "../identity";

export function Home({ conn }: { conn: Connection }) {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [table, setTableState] = useState<TablePrefs>(loadTable);
  const clean = name.trim();
  const canGo = clean.length > 0 && conn.connected && !busy;

  function remember() {
    saveName(clean);
  }

  function setTable(next: Partial<TablePrefs>) {
    const t = { ...table, ...next };
    setTableState(t);
    saveTable(t);
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
              if (e.key === "Enter") void run(() => conn.createRoom(clean, "solo", table));
            }}
            autoFocus
          />
        </label>

        <div className="field">
          <span>Players</span>
          <div className="segmented" role="radiogroup" aria-label="Players">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={table.maxPlayers === n}
                className={table.maxPlayers === n ? "on" : ""}
                disabled={conn.queueWaiting}
                onClick={() => setTable({ maxPlayers: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {table.maxPlayers > 2 && (
          <div className="field">
            <span>Mode</span>
            <div className="segmented" role="radiogroup" aria-label="Mode">
              {(
                [
                  ["ffa", "Free-for-all", "Attack anyone."],
                  ["hunter", "Hunter", "Attack the player on your left; hit bases on either side."],
                ] as const
              ).map(([v, label, hint]) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={table.variant === v}
                  className={table.variant === v ? "on" : ""}
                  title={hint}
                  disabled={conn.queueWaiting}
                  onClick={() => setTable({ variant: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {conn.queueWaiting ? (
          <div className="queue-wait">
            <div className="spinner" />
            <div>
              {table.maxPlayers === 2
                ? "Looking for an opponent…"
                : `Looking for ${conn.queueNeeded} more player${conn.queueNeeded === 1 ? "" : "s"}…`}
            </div>
            <button className="btn ghost" onClick={conn.cancelQueue}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="home-actions">
            <button
              className="btn primary big"
              disabled={!canGo}
              onClick={() => run(() => conn.createRoom(clean, "solo", table))}
            >
              Play vs Computer
            </button>
            <button
              className="btn big"
              disabled={!canGo}
              onClick={() => run(() => conn.quickMatch(clean, table))}
            >
              Quick Match
            </button>
            <button
              className="btn big"
              disabled={!canGo}
              onClick={() => run(() => conn.createRoom(clean, "private", table))}
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
          <li>
            With 3 or 4 players, the last one standing wins. In Free-for-all you can attack anyone
            and split your Combat; in Hunter you attack the player on your left and may hit bases on
            either side.
          </li>
        </ul>
      </details>
    </div>
  );
}
