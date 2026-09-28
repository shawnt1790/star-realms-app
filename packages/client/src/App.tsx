import { useConnection } from "./hooks/useConnection";
import { Home } from "./components/Home";
import { Lobby } from "./components/Lobby";
import { Game } from "./components/game/Game";

export default function App() {
  const conn = useConnection();
  const offline = !conn.connected && !conn.replaced && conn.screen !== "home";

  return (
    <div className={`app screen-${conn.screen} ${offline ? "offline" : ""}`}>
      {conn.toast && <div className="toast">{conn.toast}</div>}
      {offline && <div className="banner offline">Connection lost. Reconnecting…</div>}
      {conn.replaced && (
        <div className="modal-backdrop replaced">
          <div className="modal">
            <h2>Opened in another tab</h2>
            <p className="muted">
              Your game is open in another tab or on another device. Only one can play at a time.
            </p>
            <div className="row center">
              <button className="btn primary" onClick={conn.reclaimSeat}>
                Play here instead
              </button>
            </div>
          </div>
        </div>
      )}

      {conn.screen === "home" && <Home conn={conn} />}
      {conn.screen === "lobby" && conn.room && <Lobby conn={conn} room={conn.room} />}
      {conn.screen === "game" && conn.room && conn.view && (
        <Game conn={conn} view={conn.view} room={conn.room} />
      )}
    </div>
  );
}
