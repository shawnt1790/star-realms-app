import { useEffect, useState } from "react";
import { socket } from "./api/socket";

export default function App() {
  const [connected, setConnected] = useState(socket.connected);

  const [socketId, setSocketId] = useState<string | null>(null);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
      setSocketId(socket.id ?? null);
      console.log("client connected:", socket.id);
    }

    function onDisconnect() {
      setConnected(false);
      setSocketId(null);
      console.log("client disconnected:");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Star Realms Online (MVP)</h1>
      <p>
        Status: <b>{connected ? "CONNECTED" : "DISCONNECTED"}</b>
      </p>
      <p>Socket ID: {socketId ?? "(none)"}</p>

      <button
        onClick={() => (connected ? socket.disconnect() : socket.connect())}
        style={{ padding: "8px 12px" }}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
