// T05: Real Synapse two-device E2EE verification.
// Covers: admin shared-secret registration, official registration-token API,
// token reuse rejection, encrypted room creation, Megolm round-trip between two
// SDK devices, server-side ciphertext proof, offline catch-up, cross-signing
// bootstrap with UIA, secret storage + server key backup bootstrap.
// SECURITY: passwords/tokens are random per run and NEVER printed or persisted.
import "fake-indexeddb/auto";
import * as sdk from "matrix-js-sdk";
import { logger as sdkLogger } from "matrix-js-sdk/lib/logger.js";
import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);
sdkLogger.setLevel("warn"); // keep test logs free of crypto debug chatter (session ids, key material metadata)

// Progress log (file, not stdout pipe) + hard watchdog so a hang still produces a partial report.
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
const progressFile = new URL("../results/t05-progress.log", import.meta.url);
const step = (msg) => appendFileSync(progressFile, `${new Date().toISOString()} ${msg}\n`, "utf8");
const watchdog = setTimeout(() => {
  step("WATCHDOG timeout (240s) — writing partial report");
  report("t05-synapse-e2ee", checks);
  process.exit(1);
}, 240_000);

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => l.split("=").map((s) => s.trim())),
);
const BASE = env.AETHER_M0_BASE_URL || "http://127.0.0.1:8008";
const REG_SECRET = env.AETHER_M0_REG_SECRET;
if (!REG_SECRET) { console.error("Missing AETHER_M0_REG_SECRET; run setup-synapse.mjs first"); process.exit(1); }

const rndPass = () => randomBytes(18).toString("base64url");
const suffix = randomBytes(3).toString("hex");
const adminName = "admin" + suffix, aliceName = "alice" + suffix, bobName = "bob" + suffix, carolName = "carol" + suffix;
const adminPass = rndPass();
const alicePass = rndPass();
const bobPass = rndPass();

async function api(method, path, body, token, expectError = false) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !expectError) throw new Error(`${method} ${path} -> ${r.status} ${j.errcode || ""} ${String(j.error || "").slice(0, 120)}`);
  return { status: r.status, json: j };
}

async function waitFor(fn, timeoutMs = 45_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("timeout waiting for " + label);
}

// ---- 1. server reachable & version ----
const versions = await api("GET", "/_matrix/client/versions");
check("Synapse /versions reachable", versions.status === 200);

// ---- 2. admin via shared-secret admin registration ----
const { json: nonceJ } = await api("GET", "/_synapse/admin/v1/register");
const mac = createHmac("sha1", REG_SECRET).update(`${nonceJ.nonce}\0${adminName}\0${adminPass}\0admin`).digest("hex");
const adminReg = await api("POST", "/_synapse/admin/v1/register", { nonce: nonceJ.nonce, username: adminName, password: adminPass, admin: true, mac });
check("admin registered via shared-secret admin API", adminReg.status === 200 && !!adminReg.json.access_token);
const adminToken = adminReg.json.access_token;
const sv = await api("GET", "/_synapse/admin/v1/server_version", null, adminToken);
check("server_version is 1.165.0", sv.json.server_version === "1.165.0", sv.json.server_version);

// ---- 3. official registration token API ----
const tokRes = await api("POST", "/_synapse/admin/v1/registration_tokens/new", { length: 43, uses_allowed: 2, expiry_time: Date.now() + 3_600_000 }, adminToken);
check("registration token created via admin API", tokRes.status === 200 && !!tokRes.json.token);
const regToken = tokRes.json.token;

async function registerWithToken(username, password) {
  const first = await api("POST", "/_matrix/client/v3/register", { username, password, inhibit_login: false }, null, true);
  const session = first.json.session;
  const flow = (first.json.flows || []).find((f) => f.stages.includes("m.login.registration_token"));
  if (!flow) throw new Error("no registration_token flow offered");
  let auth = { session };
  let last = first;
  for (const stage of flow.stages) {
    auth = { ...auth, type: stage, ...(stage === "m.login.registration_token" ? { token: regToken } : {}) };
    last = await api("POST", "/_matrix/client/v3/register", { username, password, inhibit_login: false, auth }, null, true);
    if (last.status === 200) break;
  }
  return last;
}

const aliceReg = await registerWithToken(aliceName, alicePass);
const bobReg = await registerWithToken(bobName, bobPass);
check("alice registered with invite token", aliceReg.status === 200 && !!aliceReg.json.access_token);
check("bob registered with invite token", bobReg.status === 200 && !!bobReg.json.access_token);
const aliceId = aliceReg.json.user_id, bobId = bobReg.json.user_id;

// ---- 4. token reuse beyond uses_allowed must fail ----
const carol = await registerWithToken(carolName, rndPass()).catch((e) => ({ status: 0, json: { errcode: String(e.message) } }));
check("exhausted invite token rejects third registration", carol.status !== 200, `status=${carol.status}`);

// ---- 5. encrypted private room ----
const roomRes = await api("POST", "/_matrix/client/v3/createRoom", {
  name: "Aether M0",
  preset: "trusted_private_chat",
  invite: [bobId],
  is_direct: true,
  initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
}, aliceReg.json.access_token);
check("encrypted room created", roomRes.status === 200 && !!roomRes.json.room_id);
const roomId = roomRes.json.room_id;
const joinRes = await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {}, bobReg.json.access_token);
check("bob joined the room", joinRes.status === 200);

// ---- 6. two SDK devices with Rust crypto ----
// TEST-ONLY deterministic SSSS key per device (production: user recovery key/passphrase).
const ssssKeyFor = (name) => createHmac("sha256", "aether-m0-t05-ssss-seed").update(name).digest();

async function makeDevice(name, reg, pass) {
  // TEST-ONLY deterministic store key so a restarted device can reopen its encrypted
  // IndexedDB store. Production derives the store key from user credentials via SSSS (M3).
  const storageKey = createHmac("sha256", "aether-m0-t05-test-seed").update(name).digest();
  const client = sdk.createClient({
    baseUrl: BASE, userId: reg.json.user_id, accessToken: reg.json.access_token, deviceId: reg.json.device_id,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        const keyId = Object.keys(keys)[0];
        return keyId ? [keyId, ssssKeyFor(name)] : null;
      },
    },
  });
  await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: `aether-m0-t05-${name}`, storageKey });
  const prepared = new Promise((resolve) => {
    client.on(sdk.ClientEvent.Sync, (state) => { if (state === "PREPARED") resolve(); });
  });
  await client.startClient({ initialSyncLimit: 30 });
  await prepared;
  return client;
}
const alice = await makeDevice("alice", aliceReg, alicePass);
const bob = await makeDevice("bob", bobReg, bobPass);
check("both devices completed initial sync with Rust crypto", true);
await waitFor(() => bob.getRoom(roomId)?.getMyMembership() === "join", 30_000, "bob room join visible");
check("bob sees the encrypted room", !!bob.getRoom(roomId));
check("room reports encryption enabled", await bob.getCrypto().isEncryptionEnabledInRoom(roomId));

// CRITICAL (race found in first M0 run): the sender must see the recipient's device
// keys BEFORE encrypting, otherwise Megolm keys are never shared (no /sendToDevice).
// getUserDeviceInfo triggers a /keys/query; wait until both sides see each other.
step("waiting for mutual device visibility");
await waitFor(async () => (await alice.getCrypto().getUserDeviceInfo([bobId])).get(bobId)?.size > 0, 30_000, "alice sees bob devices");
await waitFor(async () => (await bob.getCrypto().getUserDeviceInfo([aliceId])).get(aliceId)?.size > 0, 30_000, "bob sees alice devices");
check("mutual device visibility established before sending", true);
step("mutual device visibility OK");

// ---- 7. Megolm round-trip ----
const SECRET = "Aether M0 synapse secret 9d2f7b";
const sendRes = await alice.sendEvent(roomId, "m.room.message", { msgtype: "m.text", body: SECRET });
step("alice sent event " + sendRes.event_id);
// Poll the timeline: Room.timeline fires BEFORE decryption completes, so a listener
// on decrypted content alone can miss the event. Polling is decryption-state safe.
let ev = null;
try {
  ev = await waitFor(() => {
    const e = bob.getRoom(roomId)?.timeline?.find((x) => x.getId() === sendRes.event_id);
    if (!e || e.isDecryptionFailure?.()) return null;
    return e.getContent()?.body === SECRET ? e : null;
  }, 45_000, "bob decrypts message");
} catch (e) {
  const raw = bob.getRoom(roomId)?.timeline?.find((x) => x.getId() === sendRes.event_id);
  step("decrypt wait failed: " + (raw ? `type=${raw.getType()} decryptionFailure=${raw.isDecryptionFailure?.()}` : "event not in timeline"));
}
check("bob received and decrypted alice's message", !!ev && ev.getContent().body === SECRET);
if (ev) {
  check("wire event is m.room.encrypted megolm", ev.getWireType() === "m.room.encrypted" && ev.getWireContent().algorithm === "m.megolm.v1.aes-sha2");
  check("wire content contains no plaintext", !JSON.stringify(ev.getWireContent()).includes(SECRET));
}
step("round-trip done");

// ---- 8. server-side ciphertext proof ----
// Admin is NOT a room member: client API must refuse (access control check).
const adminRead = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(sendRes.event_id)}`, null, adminToken, true);
check("non-member admin cannot read room event via client API", adminRead.status === 403 || adminRead.status === 404, `status=${adminRead.status}`);
// A member reading the raw event gets server-stored CIPHERTEXT (no server-side decryption).
const rawEv = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(sendRes.event_id)}`, null, aliceReg.json.access_token);
check("server-stored event is ciphertext", rawEv.json.type === "m.room.encrypted" && !!rawEv.json.content?.ciphertext);
check("server-stored event contains no plaintext", !JSON.stringify(rawEv.json).includes(SECRET));

// ---- 9. offline catch-up via full app restart ----
// SDK finding: stopClient()+startClient() on the SAME instance leaves the rust-crypto
// OutgoingRequestsManager stopped. A real PWA restart creates a fresh client, so we
// simulate that: new MatrixClient, SAME deviceId + SAME encrypted IndexedDB prefix.
// This also proves Megolm sessions survive in the encrypted store across restarts.
bob.stopClient();
step("bob stopped; sending 3 offline messages");
const offlineIds = [];
for (let i = 0; i < 3; i++) {
  const r = await alice.sendEvent(roomId, "m.room.message", { msgtype: "m.text", body: `offline-msg-${i}` });
  offlineIds.push(r.event_id);
}
await new Promise((r) => setTimeout(r, 1500));
const bob2 = await makeDevice("bob", bobReg, bobPass); // same cryptoDatabasePrefix -> persisted keys
step("bob restarted as fresh client; waiting for catch-up");
await waitFor(() => {
  const tl = bob2.getRoom(roomId)?.timeline || [];
  return offlineIds.every((id) => {
    const e = tl.find((x) => x.getId() === id);
    return e && !e.isDecryptionFailure?.() && e.getContent()?.body?.startsWith("offline-msg-");
  });
}, 45_000, "offline messages caught up");
check("offline messages synced and decrypted after app restart (persisted crypto store)", true);
step("offline catch-up OK");

// ---- 10. cross-signing bootstrap with UIA ----
const aliceCrypto = alice.getCrypto();
await aliceCrypto.bootstrapCrossSigning({
  authUploadDeviceSigningKeys: async (makeRequest) => {
    await makeRequest({ type: "m.login.password", identifier: { type: "m.id.user", user: aliceName }, password: alicePass });
  },
});
check("cross-signing bootstrap succeeded (UIA password)", await aliceCrypto.isCrossSigningReady());
const kq = await api("POST", "/_matrix/client/v3/keys/query", { device_keys: { [aliceId]: [] } }, aliceReg.json.access_token);
check("server holds alice cross-signing master key", !!kq.json.master_keys?.[aliceId]);

// ---- 11. secret storage + server key backup ----
const ssssKey = ssssKeyFor("alice");
await aliceCrypto.bootstrapSecretStorage({
  setupNewKeyBackup: true,
  createSecretStorageKey: async () => ({ keyInfo: { name: "Aether M0 recovery" }, privateKey: ssssKey, encodedPrivateKey: encodeRecoveryKey(ssssKey) }),
});
check("secret storage ready", await aliceCrypto.isSecretStorageReady());
const backupInfo = await aliceCrypto.getKeyBackupInfo();
check("server key backup version exists", !!backupInfo?.version);
const rec = await aliceCrypto.createRecoveryKeyFromPassphrase("m0 test passphrase");
check("createRecoveryKeyFromPassphrase returns encoded key", typeof rec?.encodedPrivateKey === "string" && rec.encodedPrivateKey.length > 20);

alice.stopClient();
bob2.stopClient();
clearTimeout(watchdog);
step("all phases complete");
report("t05-synapse-e2ee", checks);
process.exit(process.exitCode || 0);