import { DurableObject } from "cloudflare:workers";

interface SessionData {
  userId: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
}

export class SyncRoom extends DurableObject {
  private sessions = new Map<WebSocket, SessionData>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/sync/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const userId = url.searchParams.get("userId") ?? crypto.randomUUID();
      const name = url.searchParams.get("name") ?? "Anonymous";
      const color = url.searchParams.get("color") ?? "#3b82f6";

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);
      this.sessions.set(server, { userId, name, color });

      this.broadcastPresence();

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const payload = await request.text();
      this.broadcastRaw(payload);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    if (message === "ping") {
      ws.send("pong");
      return;
    }

    try {
      const data = JSON.parse(message);
      const session = this.sessions.get(ws);
      if (!session) return;

      if (data.type === "cursor") {
        session.x = data.x;
        session.y = data.y;
        this.broadcastPresence(ws);
      }
    } catch {
      // ignore
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.sessions.delete(ws);
    this.broadcastPresence();
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcastPresence();
    ws.close(1011, "WebSocket error");
  }

  private broadcastPresence(excludeWs?: WebSocket) {
    const presences = Array.from(this.sessions.values()).filter(
      (s) => s.x !== undefined && s.y !== undefined,
    );
    const msg = JSON.stringify({ type: "presence", presences });

    for (const ws of this.ctx.getWebSockets()) {
      if (excludeWs && ws === excludeWs) continue;
      try {
        ws.send(msg);
      } catch {
        ws.close(1011, "Presence send failure");
      }
    }
  }

  private broadcastRaw(message: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        ws.close(1011, "Broadcast send failure");
      }
    }
  }
}
