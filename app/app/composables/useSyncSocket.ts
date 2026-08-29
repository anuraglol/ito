import type { Ref } from "vue";
import type { UserPresence } from "~/typings";

export function useSyncSocket(
  isOnline: Ref<boolean>,
  triggerSync: () => Promise<void>,
  currentUser: Ref<{ userId: string; name: string; color: string }>,
  roomId: string = "global",
) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let manualDisconnect = false;

  const presences = useState<UserPresence[]>("collaborative-presences", () => []);

  const connect = () => {
    manualDisconnect = false;
    if (!import.meta.client || !isOnline.value || !currentUser.value.userId) return;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const params = new URLSearchParams({
      roomId,
      userId: currentUser.value.userId,
      name: currentUser.value.name,
      color: currentUser.value.color,
    });

    const protocol = BASE_API_URL.startsWith("https") ? "wss" : "ws";
    const hostUrl = BASE_API_URL.replace(/^https?:\/\//, "");
    const wsUrl = `${protocol}://${hostUrl}/sync/ws?${params.toString()}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      pingInterval = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 30000);
    };

    socket.onmessage = async (event) => {
      if (event.data === "pong") return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "sync_available") {
          await triggerSync();
        } else if (message.type === "presence") {
          presences.value = message.presences.filter(
            (p: UserPresence) => p.userId !== currentUser.value.userId,
          );
        }
      } catch {
        // ignore
      }
    };

    socket.onclose = () => {
      cleanup();
      if (isOnline.value && !manualDisconnect) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  const emitCursor = (x: number, y: number) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cursor", x, y }));
    }
  };

  const cleanup = () => {
    if (pingInterval) clearInterval(pingInterval);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    pingInterval = null;
    reconnectTimer = null;
  };

  const disconnect = () => {
    manualDisconnect = true;
    cleanup();
    if (socket) {
      socket.close();
      socket = null;
    }
  };

  watch(isOnline, (online) => {
    if (online) connect();
    else disconnect();
  });

  return {
    connect,
    disconnect,
    emitCursor,
    presences,
  };
}
