/** Network reachability probe. No account, chat, or message storage lives here. */
const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json({ ok: true, service: "aether-connectivity", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/ws") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "websocket_upgrade_required" }, 426);
      }
      // WebSocket 不受浏览器 CORS 约束；只允许本站页面发起探针连接。
      if (request.headers.get("Origin") !== url.origin) {
        return json({ error: "origin_not_allowed" }, 403);
      }
      const probeId = url.searchParams.get("probe");
      if (!probeId || !/^[0-9a-f]{32}$/.test(probeId)) {
        return json({ error: "invalid_probe_id" }, 400);
      }
      const id = env.CONNECTIVITY.idFromName(probeId);
      return env.CONNECTIVITY.get(id).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

/** One isolated Durable Object per random browser probe. The SQLite backend is
 * enabled in Wrangler for future use but this test does not write to storage. */
export class ConnectivityRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_upgrade_required" }, 426);
    }
    if (this.state.getWebSockets().length >= 4) {
      return json({ error: "too_many_probe_connections" }, 429);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > 256) {
      socket.close(1003, "Only small text probes are supported");
      return;
    }
    let probe;
    try {
      probe = JSON.parse(message);
    } catch {
      socket.close(1003, "Invalid probe format");
      return;
    }
    if (probe?.type !== "probe" || typeof probe.nonce !== "string" || !/^[0-9a-f]{16,64}$/.test(probe.nonce)) {
      socket.close(1003, "Invalid probe format");
      return;
    }
    const reply = JSON.stringify({ type: "probe", nonce: probe.nonce });
    for (const peer of this.state.getWebSockets()) {
      try {
        peer.send(reply);
      } catch {
        // A peer may disconnect while this message is being broadcast.
      }
    }
  }
}
