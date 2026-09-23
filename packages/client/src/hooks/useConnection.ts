import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameView, PlayerAction, RoomState, TableOptions } from "@sr/shared";
import { socket } from "../api/socket";
import { getOrCreatePlayerId, loadRoomCode, saveRoomCode } from "../identity";
import { trackEvent } from "../analytics";

export type Screen = "home" | "lobby" | "game";

export type ActionResult = { ok: true } | { ok: false; error: string };

export function useConnection() {
  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [queueWaiting, setQueueWaiting] = useState(false);
  /** Players still needed before a quick match starts. */
  const [queueNeeded, setQueueNeeded] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const gameTrackedRef = useRef<{ code: string | null; started: boolean; finished: boolean }>({
    code: null,
    started: false,
    finished: false,
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    function onRoomState(payload: { room: RoomState }) {
      const { room } = payload;
      const tracked = gameTrackedRef.current;
      if (tracked.code !== room.code) {
        gameTrackedRef.current = { code: room.code, started: false, finished: false };
      }
      if (room.status === "in_game" && !gameTrackedRef.current.started) {
        gameTrackedRef.current.started = true;
        trackEvent("game_started", tags(room));
      }
      if (room.status === "finished" && !gameTrackedRef.current.finished) {
        gameTrackedRef.current.finished = true;
        trackEvent("game_finished", tags(room));
      }
      setRoom(room);
      saveRoomCode(room.code);
      if (room.status === "lobby") setView(null);
    }
    function onGameState(payload: { view: GameView }) {
      setView(payload.view);
    }
    function onQueue(payload: { waiting: boolean; needed?: number }) {
      setQueueWaiting(payload.waiting);
      setQueueNeeded(payload.needed ?? 1);
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
    (name: string, mode: "private" | "solo", table?: TableOptions) =>
      new Promise<ActionResult>((resolve) => {
        socket.emit("room:create", { name, playerId, mode, ...table }, (res) => {
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
    (name: string, table?: TableOptions) => {
      socket.emit("queue:join", { name, playerId, ...table }, (res) => {
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
    queueNeeded,
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

function tags(room: RoomState) {
  return { mode: room.mode, players: room.maxPlayers, variant: room.variant };
}
