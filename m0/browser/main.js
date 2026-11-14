// T04 browser payload: runs inside headless Chrome.
// Verifies real IndexedDB + WASM + initRustCrypto + persistence + two-device Olm E2EE.
import * as sdk from "matrix-js-sdk";
import * as Crypto from "@matrix-org/matrix-sdk-crypto-wasm";
import { logger } from "matrix-js-sdk/lib/logger.js";
logger.setLevel("warn");

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail: String(detail) }); render(); };
function render() {
  const el = document.getElementById("results");
  if (el) el.textContent = JSON.stringify({ done: !!window.__m0done, checks }, null, 1);
}

(async () => {
  try {
    check("IndexedDB available", !!globalThis.indexedDB);
    check("WebCrypto subtle available", !!globalThis.crypto?.subtle);
    check("WebAssembly available", typeof WebAssembly === "object");
    check("serviceWorker container available", "serviceWorker" in navigator);

    // Explicit wasm URL: bundlers may rewrite import.meta.url, so pin the asset path.
    await Crypto.initAsync(new URL("/matrix_sdk_crypto_wasm_bg.wasm", location.href));
    check("WASM initAsync in Chrome", true);

    const mk = (deviceId) => sdk.createClient({ baseUrl: "http://127.0.0.1:9", userId: "@browser:aether.test", deviceId, accessToken: "offline" });
    const c1 = mk("BROWSERDEV1");
    await c1.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: "aether-m0-browser" });
    const k1 = (await c1.getCrypto().getOwnDeviceKeys()).ed25519;
    check("initRustCrypto in Chrome", !!k1);
    const c2 = mk("BROWSERDEV1");
    await c2.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: "aether-m0-browser" });
    const k2 = (await c2.getCrypto().getOwnDeviceKeys()).ed25519;
    check("real IndexedDB persistence across client re-init", k1 === k2 && k1.length > 20);

    // Two independent OlmMachines = two device identities; Olm E2EE round-trip in-browser.
    const mkMachine = async (u, d) => {
      const s = await Crypto.StoreHandle.open(null, null);
      return Crypto.OlmMachine.initFromStore(new Crypto.UserId(u), new Crypto.DeviceId(d), s);
    };
    const A = "@a:aether.test", B = "@b:aether.test";
    const alice = await mkMachine(A, "ADEV"), bob = await mkMachine(B, "BDEV");
    const server = { deviceKeys: {}, oneTimeKeys: {} };
    const drain = async (m, u, d) => {
      for (const r of await m.outgoingRequests()) {
        if (r.type === Crypto.RequestType.KeysUpload) {
          const b = JSON.parse(r.body);
          server.deviceKeys[u] = { [d]: b.device_keys };
          server.oneTimeKeys[u] = { [d]: b.one_time_keys || {} };
          await m.markRequestAsSent(r.id, r.type, JSON.stringify({ one_time_key_counts: { signed_curve25519: Object.keys(b.one_time_keys || {}).length } }));
        } else await m.markRequestAsSent(r.id, r.type, "{}");
      }
    };
    await drain(alice, A, "ADEV"); await drain(bob, B, "BDEV");
    const q = alice.queryKeysForUsers([new Crypto.UserId(B)]);
    await alice.markRequestAsSent(q.id, q.type, JSON.stringify({ device_keys: { [B]: server.deviceKeys[B] } }));
    const claim = await alice.getMissingSessions([new Crypto.UserId(B)]);
    const cb = JSON.parse(claim.body); const claimed = {};
    for (const [u, devs] of Object.entries(cb.one_time_keys || {})) {
      claimed[u] = {};
      for (const d of Object.keys(devs)) {
        const pool = server.oneTimeKeys[u][d]; const kid = Object.keys(pool)[0];
        claimed[u][d] = { [kid]: pool[kid] }; delete pool[kid];
      }
    }
    await alice.markRequestAsSent(claim.id, claim.type, JSON.stringify({ one_time_keys: claimed }));
    const dev = await alice.getDevice(new Crypto.UserId(B), new Crypto.DeviceId("BDEV"));
    const SECRET = "browser-olm-secret-42";
    const enc = await dev.encryptToDeviceEvent("m.room.message", { msgtype: "m.text", body: SECRET });
    check("browser Olm ciphertext hides plaintext", !enc.includes(SECRET));
    const processed = await bob.receiveSyncChanges(
      JSON.stringify([{ sender: A, type: "m.room.encrypted", content: JSON.parse(enc) }]),
      new Crypto.DeviceLists(), new Map([["signed_curve25519", 50]]),
    );
    const dec = processed.find((p) => p.type === Crypto.ProcessedToDeviceEventType.Decrypted);
    check("browser Olm round-trip decrypts", !!dec && JSON.parse(dec.rawEvent).content.body === SECRET);

    window.__m0done = true; render(); document.title = "M0_BROWSER_DONE";
  } catch (e) {
    check("fatal", false, String((e && e.message) || e).slice(0, 300));
    window.__m0done = true; render(); document.title = "M0_BROWSER_DONE";
  }
})();