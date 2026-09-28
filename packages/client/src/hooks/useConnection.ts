import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameView, PlayerAction, RoomState, TableOptions } from "@sr/shared";
import { socket } from "../api/socket";
import {
  getOrCreatePlayerId,
  loadRoomCode,
  roomCodeIsRecent,
  saveRoomCode,
  touchRoomCode,
} from "../identity";
import { trackEvent } from "../analytics";

export type Screen = "home" | "lobby" | "game";

export type ActionResult = { ok: true } | { ok: false; error: string };

const OFFLINE = { ok: false, error: "Not connected." } as const;

/** Local timestamps when each disconnected player's seat will be given up. */
export type GraceDeadlines = Record<string, number>;

function graceDeadlines(room: RoomState): GraceDeadlines {
  const now = Date.now();
  const out: GraceDeadlines = {};
  for (const p of room.players) {
    if (p.reconnectMsLeft !== null) out[p.id] = now + p.reconnectMsLeft;
  }
  return out;
}

export function useConnection() {
  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [deadlines, setDeadlines] = useState<GraceDeadlines>({});
  /** Another tab or device took this player's seat; stay offline until they reclaim it. */
  const [replaced, setReplaced] = useState(false);
  const replacedRef = useRef(false);
  /** Quick-match request to resend if the connection drops while waiting. */
  const queuedRef = useRef<{ name: string; table?: TableOptions } | null>(null);
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
      queuedRef.current = null;
      setRoom(room);
      setDeadlines(graceDeadlines(room));
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
      if (saved) {
        socket.emit("room:reconnect", { code: saved, playerId }, (res) => {
          if (res.ok) return;
          const recent = roomCodeIsRecent();
          saveRoomCode(null);
          setRoom(null);
          setView(null);
          if (recent) showToast("That game is no longer available.");
        });
        return;
      }
      // The server drops queued players whose connection closes; get back in line.
      const queued = queuedRef.current;
      if (queued) {
        socket.emit("queue:join", { name: queued.name, playerId, ...queued.table }, (res) => {
          if (res.ok) return;
          queuedRef.current = null;
          showToast(res.error);
        });
      }
    }
    function onDisconnect() {
      touchRoomCode();
      setConnected(false);
      setQueueWaiting(false);
    }
    function onReplaced() {
      replacedRef.current = true;
      setReplaced(true);
      socket.disconnect();
    }
    // Phones suspend background tabs; retry straight away when the player comes back
    // instead of waiting out the reconnect backoff.
    function retry() {
      // Leaving the page (or backgrounding it) is the last time the room was in use.
      if (document.visibilityState === "hidden") return touchRoomCode();
      if (!replacedRef.current && !socket.connected && document.visibilityState === "visible") {
        socket.connect();
      }
    }

    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("queue:status", onQueue);
    socket.on("error:toast", onToast);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("session:replaced", onReplaced);
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("online", retry);
    socket.connect();

    return () => {
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("queue:status", onQueue);
      socket.off("error:toast", onToast);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("session:replaced", onReplaced);
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("online", retry);
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
      queuedRef.current = { name, table };
      socket.emit("queue:join", { name, playerId, ...table }, (res) => {
        if (res.ok) return;
        queuedRef.current = null;
        showToast(res.error);
      });
    },
    [playerId, showToast],
  );

  const cancelQueue = useCallback(() => {
    queuedRef.current = null;
    if (!socket.connected) return setQueueWaiting(false);
    socket.emit("queue:leave", { playerId }, () => setQueueWaiting(false));
  }, [playerId]);

  const leaveRoom = useCallback(() => {
    const clear = () => {
      saveRoomCode(null);
      setRoom(null);
      setView(null);
    };
    // Offline, just go home: the server gives the seat up when the grace period ends.
    if (!socket.connected) return clear();
    socket.emit("room:leave", { playerId }, clear);
  }, [playerId]);

  const setReady = useCallback(
    (ready: boolean) => {
      if (!socket.connected) return showToast(OFFLINE.error);
      socket.emit("room:ready", { playerId, ready }, (res) => {
        if (!res.ok) showToast(res.error);
      });
    },
    [playerId, showToast],
  );

  const startGame = useCallback(() => {
    if (!socket.connected) return showToast(OFFLINE.error);
    socket.emit("room:start", (res) => {
      if (!res.ok) showToast(res.error);
    });
  }, [showToast]);

  const sendAction = useCallback(
    (action: PlayerAction) =>
      new Promise<ActionResult>((resolve) => {
        // Socket.IO would queue this and send it after reconnecting, before we've
        // rejoined the room, so refuse it instead of letting it fail or land late.
        if (!socket.connected) return resolve(OFFLINE);
        socket.emit("game:action", { action }, (res) => {
          if (!res.ok) showToast(res.error);
          resolve(res);
        });
      }),
    [showToast],
  );

  /** Take the seat back from whichever tab or device replaced this one. */
  const reclaimSeat = useCallback(() => {
    replacedRef.current = false;
    setReplaced(false);
    socket.connect();
  }, []);

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
    deadlines,
    replaced,
    reclaimSeat,
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
