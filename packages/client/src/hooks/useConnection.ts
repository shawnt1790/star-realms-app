import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameView, PlayerAction, RoomState } from "@sr/shared";
import { socket } from "../api/socket";
import { getOrCreatePlayerId, loadRoomCode, saveRoomCode } from "../identity";

export type Screen = "home" | "lobby" | "game";

export type ActionResult = { ok: true } | { ok: false; error: string };

export function useConnection() {
  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [queueWaiting, setQueueWaiting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    function onRoomState(payload: { room: RoomState }) {
      setRoom(payload.room);
      saveRoomCode(payload.room.code);
      if (payload.room.status === "lobby") setView(null);
    }
    function onGameState(payload: { view: GameView }) {
      setView(payload.view);
    }
    function onQueue(payload: { waiting: boolean }) {
      setQueueWaiting(payload.waiting);
    }
    function onToast(payload: { message: string }) {
      showToast(payload.message);
    }
    function onConnect() {
      setConnected(true);
      const saved = loadRoomCode();
      if (!saved) return;
      socket.emit("room:reconnect", { code: saved, playerId }, (res) => {
        if (!res.ok) {
          saveRoomCode(null);
          setRoom(null);
          setView(null);
        }
      });
    }
    function onDisconnect() {
      setConnected(false);
      setQueueWaiting(false);
    }

    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("queue:status", onQueue);
    socket.on("error:toast", onToast);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.connect();

    return () => {
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("queue:status", onQueue);
      socket.off("error:toast", onToast);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, [playerId, showToast]);

  const createRoom = useCallback(
    (name: string, mode: "private" | "solo") =>
      new Promise<ActionResult>((resolve) => {
        socket.emit("room:create", { name, playerId, mode }, (res) => {
          if (!res.ok) showToast(res.error);
          resolve(res.ok ? { ok: true } : res);
        });
      }),
    [playerId, showToast],
  );

  const joinRoom = useCallback(
    (code: string, name: string) =>
      new Promise<ActionResult>((resolve) => {
        socket.emit("room:join", { code: code.trim().toUpperCase(), name, playerId }, (res) => {
          if (!res.ok) showToast(res.error);
          resolve(res);
        });
      }),
    [playerId, showToast],
  );

  const quickMatch = useCallback(
    (name: string) => {
      socket.emit("queue:join", { name, playerId }, (res) => {
        if (!res.ok) showToast(res.error);
      });
    },
    [playerId, showToast],
  );

  const cancelQueue = useCallback(() => {
    socket.emit("queue:leave", { playerId }, () => setQueueWaiting(false));
  }, [playerId]);

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave", { playerId }, () => {
      saveRoomCode(null);
      setRoom(null);
      setView(null);
    });
  }, [playerId]);

  const setReady = useCallback(
    (ready: boolean) => {
      socket.emit("room:ready", { playerId, ready }, (res) => {
        if (!res.ok) showToast(res.error);
      });
    },
    [playerId, showToast],
  );

  const startGame = useCallback(() => {
    socket.emit("room:start", (res) => {
      if (!res.ok) showToast(res.error);
    });
  }, [showToast]);

  const sendAction = useCallback(
    (action: PlayerAction) =>
      new Promise<ActionResult>((resolve) => {
        socket.emit("game:action", { action }, (res) => {
          if (!res.ok) showToast(res.error);
          resolve(res);
        });
      }),
    [showToast],
  );

  const screen: Screen = !room
    ? "home"
    : (room.status === "in_game" || room.status === "finished") && view
      ? "game"
      : "lobby";

  return {
    playerId,
    connected,
    room,
    view,
    screen,
    queueWaiting,
    toast,
    showToast,
    createRoom,
    joinRoom,
    quickMatch,
    cancelQueue,
    leaveRoom,
    setReady,
    startGame,
    sendAction,
  };
}

export type Connection = ReturnType<typeof useConnection>;
