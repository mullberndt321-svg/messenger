import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket erwartet", { status: 426 });
      }
      const room =
        (url.searchParams.get("room") || "lobby")
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "")
          .slice(0, 32) || "lobby";
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

// Ein Durable Object pro Raum: hält die WebSockets und die letzten Nachrichten.
export class ChatRoom extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const history = (await this.ctx.storage.get("history")) || [];
    server.send(JSON.stringify({ type: "history", messages: history }));
    this.sendCount();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.type !== "msg") return;

    const text = String(data.text || "").trim().slice(0, 2000);
    const name = String(data.name || "").trim().slice(0, 24) || "Anonym";
    if (!text) return;

    const msg = { type: "msg", id: crypto.randomUUID(), name, text, ts: Date.now() };
    const history = (await this.ctx.storage.get("history")) || [];
    history.push(msg);
    await this.ctx.storage.put("history", history.slice(-100));

    const out = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      try { s.send(out); } catch {}
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code); } catch {}
    this.sendCount();
  }

  async webSocketError() {
    this.sendCount();
  }

  sendCount() {
    const live = this.ctx.getWebSockets().filter((s) => s.readyState === 1);
    const out = JSON.stringify({ type: "count", count: live.length });
    for (const s of live) {
      try { s.send(out); } catch {}
    }
  }
}
