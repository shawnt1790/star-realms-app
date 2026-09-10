import { useConnection } from "./hooks/useConnection";
import { Home } from "./components/Home";
import { Lobby } from "./components/Lobby";
import { Game } from "./components/Game";

export default function App() {
  const conn = useConnection();

  return (
    <div className={`app screen-${conn.screen}`}>
      {conn.toast && <div className="toast">{conn.toast}</div>}
      {!conn.connected && conn.screen !== "home" && (
        <div className="banner offline">Connection lost. Reconnecting…</div>
      )}

      {conn.screen === "home" && <Home conn={conn} />}
      {conn.screen === "lobby" && conn.room && <Lobby conn={conn} room={conn.room} />}
      {conn.screen === "game" && conn.room && conn.view && (
        <Game conn={conn} view={conn.view} room={conn.room} />
      )}
    </div>
  );
}
