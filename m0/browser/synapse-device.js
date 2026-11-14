// T06 browser payload: one device role (sender/receiver) per Chrome instance.
// Config is fetched at runtime so a single bundle serves both roles.
import * as sdk from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger.js";
import * as Crypto from "@matrix-org/matrix-sdk-crypto-wasm";
logger.setLevel("warn");

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail: String(detail) }); render(); };
function render() {
  const el = document.getElementById("results");
  if (el) el.textContent = JSON.stringify({ done: !!window.__m0done, checks }, null, 1);
}
async function waitFor(fn, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("waitFor timeout");
}

(async () => {
  try {
    const config = await (await fetch("./config.json")).json();
    await Crypto.initAsync(new URL("/shared/matrix_sdk_crypto_wasm_bg.wasm", location.href));
    check("WASM initialized", true);

    const tmp = sdk.createClient({ baseUrl: config.baseUrl });
    const login = await tmp.loginWithPassword(config.userId, config.password);
    check("loginWithPassword", !!login.access_token);
    // SDK 45 requires deviceId at createClient time for initRustCrypto.
    const client = sdk.createClient({ baseUrl: config.baseUrl, userId: login.user_id, deviceId: login.device_id, accessToken: login.access_token });
    await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: "aether-m0-t06-" + config.role });
    const prepared = new Promise((res) => client.on(sdk.ClientEvent.Sync, (s) => s === "PREPARED" && res()));
    await client.startClient({ initialSyncLimit: 30 });
    await prepared;
    check("initial sync PREPARED", true);
    await waitFor(() => client.getRoom(config.roomId)?.getMyMembership() === "join", 30_000);
    check("encrypted room visible", true);

    if (config.role === "sender") {
      await waitFor(async () => (await client.getCrypto().getUserDeviceInfo([config.peerId])).get(config.peerId)?.size > 0, 30_000);
      check("peer device keys visible", true);
      const r = await client.sendEvent(config.roomId, "m.room.message", { msgtype: "m.text", body: config.secret });
      check("sender sent encrypted event", !!r.event_id);
    } else {
      const ev = await waitFor(() => {
        const e = client.getRoom(config.roomId)?.timeline?.find((x) => x.getContent()?.body === config.secret && !x.isDecryptionFailure?.());
        return e || null;
      }, 90_000);
      check("receiver decrypted cross-browser message", !!ev);
      check("wire type is m.room.encrypted", ev?.getWireType() === "m.room.encrypted");
      check("wire content hides plaintext", !JSON.stringify(ev?.getWireContent() || {}).includes(config.secret));
    }
    window.__m0done = true; render();
  } catch (e) {
    check("fatal", false, String((e && e.message) || e).slice(0, 300));
    window.__m0done = true; render();
  }
})();