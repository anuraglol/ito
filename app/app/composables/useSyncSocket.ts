import type { Ref } from "vue";

export function useSyncSocket(
  isOnline: Ref<boolean>,
  triggerSync: () => Promise<void>,
  roomId: string = "global",
) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    if (!import.meta.client || !isOnline.value) return;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const wsUrl =
      BASE_API_URL.replace(/^http/, "ws") + `/sync/ws?roomId=${encodeURIComponent(roomId)}`;
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
    if (online) {
      connect();
    } else {
      disconnect();
    }
  });

  return {
    connect,
    disconnect,
  };
}
