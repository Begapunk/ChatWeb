import assert from "node:assert/strict";
import test from "node:test";
import worker, { ConnectivityRoom } from "./index.mjs";

const origin = "https://example.workers.dev";
const env = {
  ASSETS: { fetch: () => new Response("asset") },
  CONNECTIVITY: {
    idFromName: (name) => name,
    get: (id) => ({ fetch: () => new Response(id) }),
  },
};

test("health responds with JSON and never caches", async () => {
  const response = await worker.fetch(new Request(`${origin}/api/health`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await response.json()).ok, true);
});

test("API paths cannot fall through to the PWA shell", async () => {
  const response = await worker.fetch(new Request(`${origin}/api/unknown`), env);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("WebSocket requires same origin and a random probe ID", async () => {
  const url = `${origin}/api/ws?probe=${"a".repeat(32)}`;
  const headers = { Upgrade: "websocket" };
  assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(url, { headers: { ...headers, Origin: "https://other.example" } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(`${origin}/api/ws?probe=short`, { headers: { ...headers, Origin: origin } }), env)).status, 400);
  const response = await worker.fetch(new Request(url, { headers: { ...headers, Origin: origin } }), env);
  assert.equal(await response.text(), "a".repeat(32));
});

test("Durable Object relays valid markers to peers and rejects other data", () => {
  const sent = [];
  const socketA = { send: (value) => sent.push(["a", value]), close: () => {} };
  const socketB = { send: (value) => sent.push(["b", value]), close: () => {} };
  const room = new ConnectivityRoom({ getWebSockets: () => [socketA, socketB] });
  const marker = JSON.stringify({ type: "probe", nonce: "b".repeat(32) });
  room.webSocketMessage(socketA, marker);
  assert.deepEqual(sent, [["a", marker], ["b", marker]]);
  let closed = false;
  room.webSocketMessage({ close: () => { closed = true; } }, JSON.stringify({ type: "message", text: "private" }));
  assert.equal(closed, true);
});
