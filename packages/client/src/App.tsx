import { useEffect, useMemo, useState } from "react";
import { socket } from "./api/socket";
import type { RoomState } from "@sr/shared";

type Screen = "home" | "lobby";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const connected = socket.connected;

  useEffect(() => {
    function onRoomState(payload: { room: RoomState }) {
      setRoom(payload.room);
      setScreen("lobby");
    }

    function onToast(payload: { message: string }) {
      setToast(payload.message);
      setTimeout(() => setToast(null), 3000);
    }

    socket.on("room:state", onRoomState);
    socket.on("error:toast", onToast);

    socket.connect();

    return () => {
      socket.off("room:state", onRoomState);
      socket.off("error:toast", onToast);
      socket.disconnect();
    };
  }, []);

  const canSubmitName = useMemo(() => name.trim().length > 0, [name]);

  function createRoom() {
    if (!canSubmitName) return;
    socket.emit("room:create", { name: name.trim() }, (res) => {
      if (!res.ok) setToast(res.error);
      // if ok, server will emit room:state and push us to lobby
    });
  }

  function joinRoom() {
    if (!canSubmitName) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) return;

    socket.emit("room:join", { code, name: name.trim() }, (res) => {
      if (!res.ok) setToast(res.error);
    });
  }

  function leaveRoom() {
    socket.emit("room:leave", () => {
      setRoom(null);
      setScreen("home");
    });
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1>Star Realms Online (MVP)</h1>
      <p>
        Status: <b>{connected ? "CONNECTED" : "DISCONNECTED"}</b>
      </p>

      {toast && (
        <div style={{ margin: "12px 0", padding: 12, border: "1px solid #444" }}>{toast}</div>
      )}

      {screen === "home" && (
        <div style={{ display: "grid", gap: 12 }}>
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            />
          </label>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={createRoom} disabled={!canSubmitName} style={{ padding: "8px 12px" }}>
              Create Room
            </button>

            <span style={{ opacity: 0.7 }}>or</span>

            <input
              placeholder="Room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={{ padding: 8, width: 140 }}
            />
            <button
              onClick={joinRoom}
              disabled={!canSubmitName || joinCode.trim().length === 0}
              style={{ padding: "8px 12px" }}
            >
              Join Room
            </button>
          </div>
        </div>
      )}

      {screen === "lobby" && room && (
        <div style={{ display: "grid", gap: 12 }}>
          <h2>Lobby</h2>
          <p>
            Room code: <b>{room.code}</b>
          </p>
          <p>
            Status: <b>{room.status}</b>
          </p>

          <div>
            <h3>Players</h3>
            <ul>
              {room.players.map((p) => (
                <li key={p.id}>
                  {p.name} {p.isHost ? "(host)" : ""} {p.connected ? "" : "(disconnected)"}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={leaveRoom} style={{ padding: "8px 12px" }}>
              Leave Room
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
