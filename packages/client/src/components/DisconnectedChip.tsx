import { useEffect, useState } from "react";

/**
 * "disconnected" chip for a dropped player, with a countdown while the server is
 * holding their seat. `deadline` is a local timestamp (see useConnection's deadlines).
 */
export function DisconnectedChip({ deadline }: { deadline?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === undefined) return;
    // `now` may be stale if the chip was showing without a countdown; refresh it at once.
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [deadline]);

  if (deadline === undefined) return <span className="chip warn">disconnected</span>;
  const secs = Math.max(Math.ceil((deadline - now) / 1000), 0);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <span className="chip warn" title="Their seat is held until the timer runs out">
      reconnecting {clock}
    </span>
  );
}
