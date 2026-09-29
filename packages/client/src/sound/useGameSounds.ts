import { useEffect, useRef } from "react";
import type { GameView } from "@sr/shared";
import { soundForUpdate } from "./events";
import { playSound } from "./sounds";

const BASE_TITLE = typeof document === "undefined" ? "" : document.title;

/**
 * Plays sounds for what changed between game views, and marks the tab title while
 * the game is waiting on this player in a background tab.
 */
export function useGameSounds(view: GameView, connected: boolean) {
  const prevRef = useRef<GameView | null>(null);
  /** The view on screen when the connection dropped; it's stale until a new one arrives. */
  const staleRef = useRef<GameView | null>(null);

  useEffect(() => {
    if (!connected) {
      staleRef.current = view;
      prevRef.current = null;
      return;
    }
    if (view === staleRef.current) return;
    staleRef.current = null;
    const sound = soundForUpdate(prevRef.current, view);
    prevRef.current = view;
    if (sound) playSound(sound);
  }, [view, connected]);

  const waiting =
    view.winner === null
      ? view.choice
        ? "Your move"
        : view.current === view.me
          ? "Your turn"
          : null
      : null;
  useEffect(() => {
    const update = () => {
      document.title = waiting && document.hidden ? `▶ ${waiting} — ${BASE_TITLE}` : BASE_TITLE;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = BASE_TITLE;
    };
  }, [waiting]);
}
