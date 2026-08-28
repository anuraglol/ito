import type { Ref } from "vue";
import type { UserPresence } from "~/typings";

export function useSyncSocket(
  isOnline: Ref<boolean>,
  triggerSync: () => Promise<void>,
  userInfo: { userId: string; name: string; color: string },
  roomId: string = "global",
) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const presences = useState<UserPresence[]>("collaborative-presences", () => []);

  const connect = () => {
    if (!import.meta.client || !isOnline.value) return;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const params = new URLSearchParams({
      roomId,
      userId: userInfo.userId,
      name: userInfo.name,
      color: userInfo.color,
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
            (p: UserPresence) => p.userId !== userInfo.userId,
          );
        }
      } catch {
        // malformed frame
      }
    };

    socket.onclose = () => {
      cleanup();
      if (isOnline.value) {
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
