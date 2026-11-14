// T06: TWO independent Chrome instances (separate profiles => separate devices/storage)
// against the local Synapse. Proves browser-to-browser E2EE over a real homeserver.
// Test credentials are random per run, local-only, stored under gitignored browser-run/.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "playwright-core";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);
const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("=").map((s) => s.trim())),
);
const BASE = env.AETHER_M0_BASE_URL;
const REG_SECRET = env.AETHER_M0_REG_SECRET;
const rndPass = () => randomBytes(18).toString("base64url");
const suffix = randomBytes(3).toString("hex");

async function api(method, path, body, token, expectError = false) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !expectError) throw new Error(`${method} ${path} -> ${r.status} ${j.errcode || ""}`);
  return { status: r.status, json: j };
}

// ---- server-side setup ----
const adminPass = rndPass();
const { json: nonceJ } = await api("GET", "/_synapse/admin/v1/register");
const mac = createHmac("sha1", REG_SECRET).update(`${nonceJ.nonce}\0t6admin${suffix}\0${adminPass}\0admin`).digest("hex");
const adminReg = await api("POST", "/_synapse/admin/v1/register", { nonce: nonceJ.nonce, username: `t6admin${suffix}`, password: adminPass, admin: true, mac });
const adminToken = adminReg.json.access_token;
const tok = await api("POST", "/_synapse/admin/v1/registration_tokens/new", { length: 43, uses_allowed: 2, expiry_time: Date.now() + 3_600_000 }, adminToken);

async function register(username, password) {
  const first = await api("POST", "/_matrix/client/v3/register", { username, password, inhibit_login: false }, null, true);
  let auth = { session: first.json.session };
  let last = first;
  const flow = (first.json.flows || []).find((f) => f.stages.includes("m.login.registration_token"));
  for (const stage of flow.stages) {
    auth = { ...auth, type: stage, ...(stage === "m.login.registration_token" ? { token: tok.json.token } : {}) };
    last = await api("POST", "/_matrix/client/v3/register", { username, password, inhibit_login: false, auth }, null, true);
    if (last.status === 200) break;
  }
  if (last.status !== 200) throw new Error("register failed " + last.status);
  return last.json;
}
const aliceName = `t6alice${suffix}`, bobName = `t6bob${suffix}`;
const alicePass = rndPass(), bobPass = rndPass();
const aliceReg = await register(aliceName, alicePass);
const bobReg = await register(bobName, bobPass);
const room = await api("POST", "/_matrix/client/v3/createRoom", {
  name: "Aether M0 T06", preset: "trusted_private_chat", invite: [bobReg.user_id], is_direct: true,
  initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
}, aliceReg.access_token);
const roomId = room.json.room_id;
await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {}, bobReg.access_token);
check("server setup: two users + encrypted room", !!roomId);
const SECRET = "Aether T06 cross-browser secret " + suffix;

// ---- build & stage ----
mkdirSync("browser-run/shared", { recursive: true });
mkdirSync("browser-run/alice", { recursive: true });
mkdirSync("browser-run/bob", { recursive: true });
execFileSync(process.execPath, [
  "node_modules/esbuild/bin/esbuild", "browser/synapse-device.js",
  "--bundle", "--format=esm", "--platform=browser",
  "--outfile=browser-run/shared/bundle.js",
  '--define:process.env.NODE_ENV="production"', "--log-level=warning",
], { stdio: "inherit" });
copyFileSync("node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm", "browser-run/shared/matrix_sdk_crypto_wasm_bg.wasm");
const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><title>T06 device</title></head><body><pre id="results">running...</pre><script type="module" src="/shared/bundle.js"></script></body></html>`;
for (const role of ["alice", "bob"]) {
  writeFileSync(`browser-run/${role}/index.html`, indexHtml, "utf8");
}
writeFileSync("browser-run/alice/config.json", JSON.stringify({ role: "sender", baseUrl: BASE, userId: aliceReg.user_id, password: alicePass, roomId, peerId: bobReg.user_id, secret: SECRET }), "utf8");
writeFileSync("browser-run/bob/config.json", JSON.stringify({ role: "receiver", baseUrl: BASE, userId: bobReg.user_id, password: bobPass, roomId, peerId: aliceReg.user_id, secret: SECRET }), "utf8");

// ---- serve ----
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = req.url.split("?")[0];
  const f = "browser-run" + p;
  try {
    const d = readFileSync(f);
    res.writeHead(200, { "Content-Type": mime[f.slice(f.lastIndexOf("."))] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8092, "127.0.0.1", r));

// ---- two independent Chrome instances ----
async function runDevice(role) {
  const browser = await chromium.launch({ channel: "chrome", headless: true }); // fresh profile per launch
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`http://127.0.0.1:8092/${role}/index.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__m0done === true, null, { timeout: 150_000 });
    const parsed = await page.evaluate(() => JSON.parse(document.getElementById("results").textContent));
    return { parsed, errors };
  } finally { await browser.close(); }
}
const [aliceRes, bobRes] = await Promise.all([runDevice("alice"), runDevice("bob")]);
server.close();
writeFileSync("results/t06-devices.json", JSON.stringify({ alice: aliceRes, bob: bobRes }, null, 2), "utf8");

check("sender Chrome: no page errors", aliceRes.errors.length === 0, aliceRes.errors[0] || "");
check("receiver Chrome: no page errors", bobRes.errors.length === 0, bobRes.errors[0] || "");
for (const c of aliceRes.parsed.checks) check(`[alice-browser] ${c.name}`, c.ok, c.detail);
for (const c of bobRes.parsed.checks) check(`[bob-browser] ${c.name}`, c.ok, c.detail);
report("t06-browser-synapse", checks);