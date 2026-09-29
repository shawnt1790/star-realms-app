import { useSyncExternalStore } from "react";
import { isMuted, setMuted, subscribeMuted } from "../sound/sounds";

/** Always-visible sound toggle; the choice is remembered per browser. */
export function MuteButton() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted);
  const label = muted ? "Unmute sound effects" : "Mute sound effects";
  return (
    <button
      type="button"
      className={`mute-toggle ${muted ? "muted" : ""}`}
      onClick={() => setMuted(!muted)}
      aria-label={label}
      aria-pressed={muted}
      title={label}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
