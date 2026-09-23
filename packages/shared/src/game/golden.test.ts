// Regression oracle for the 2-player game: bot-vs-bot games for fixed seeds
// must produce exactly the same log as when the fingerprints were recorded.
// Regenerate (only when a 2p behaviour change is intended) with
// `UPDATE_GOLDEN=1 npm -w @sr/shared test`.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "./engine.js";
import { botDecide } from "./bot.js";

const GOLDEN = new URL("./__golden__/duel.json", import.meta.url);

type Fingerprint = { hash: string; winner: number | null; turns: number };

function playDuel(seed: number): Fingerprint {
  let s = createGame({
    id: `bot${seed}`,
    seed,
    players: [
      { id: "x", name: "X", isBot: true },
      { id: "y", name: "Y", isBot: true },
    ],
  });
  let steps = 0;
  while (s.winner === null && steps < 5000) {
    const res = applyAction(s, s.current, botDecide(s));
    if (!res.ok) throw new Error(`seed ${seed} step ${steps}: ${res.error}`);
    s = res.state;
    steps += 1;
  }
  const hash = createHash("sha256").update(JSON.stringify(s.log)).digest("hex");
  return { hash, winner: s.winner, turns: s.turn };
}

describe("2-player golden games", () => {
  it("bot-vs-bot logs match the recorded fingerprints", () => {
    const actual: Record<string, Fingerprint> = {};
    for (let seed = 1; seed <= 12; seed++) actual[seed] = playDuel(seed);
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Fingerprint>;
    expect(actual).toEqual(expected);
  });
});
