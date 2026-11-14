// T01: Rust Crypto WASM loads in Node; OlmMachine identity keys; IndexedDB-backed
// store persistence (passphrase + raw 32-byte key); wrong-key rejection.
// Uses fake-indexeddb to provide the IndexedDB global that the WASM store expects.
import "fake-indexeddb/auto";
import * as Crypto from "@matrix-org/matrix-sdk-crypto-wasm";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);

await Crypto.initAsync();
check("wasm initAsync() resolves", true);

// --- memory store ---
const mem = await Crypto.StoreHandle.open(null, null);
const alice = await Crypto.OlmMachine.initFromStore(
  new Crypto.UserId("@alice:aether.test"),
  new Crypto.DeviceId("T01ALICE"),
  mem,
);
const ik = alice.identityKeys;
check(
  "OlmMachine exposes identity keys",
  !!ik && ik.ed25519.toBase64().length > 20 && ik.curve25519.toBase64().length > 20,
  `ed25519=${ik.ed25519.toBase64().slice(0, 10)}...`,
);

// --- IndexedDB store with passphrase: persistence across reopen ---
const h1 = await Crypto.StoreHandle.open("aether-m0-t01", "m0-test-passphrase");
const m1 = await Crypto.OlmMachine.initFromStore(
  new Crypto.UserId("@persist:aether.test"),
  new Crypto.DeviceId("T01PERSIST"),
  h1,
);
const k1 = m1.identityKeys.ed25519.toBase64();
const h2 = await Crypto.StoreHandle.open("aether-m0-t01", "m0-test-passphrase");
const m2 = await Crypto.OlmMachine.initFromStore(
  new Crypto.UserId("@persist:aether.test"),
  new Crypto.DeviceId("T01PERSIST"),
  h2,
);
const k2 = m2.identityKeys.ed25519.toBase64();
check("IndexedDB store persists identity across reopen (passphrase)", k1 === k2 && k1.length > 20);

// --- IndexedDB store encrypted with a raw 32-byte key ---
const storeKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
const h3 = await Crypto.StoreHandle.openWithKey("aether-m0-t01-key", storeKey);
const m3 = await Crypto.OlmMachine.initFromStore(
  new Crypto.UserId("@keyed:aether.test"),
  new Crypto.DeviceId("T01KEYED"),
  h3,
);
const k3 = m3.identityKeys.ed25519.toBase64();
check("IndexedDB store opens with raw 32-byte key", k3.length > 20);

const h4 = await Crypto.StoreHandle.openWithKey("aether-m0-t01-key", storeKey);
const m4 = await Crypto.OlmMachine.initFromStore(
  new Crypto.UserId("@keyed:aether.test"),
  new Crypto.DeviceId("T01KEYED"),
  h4,
);
check("key-encrypted store persists identity across reopen", m4.identityKeys.ed25519.toBase64() === k3);

// --- wrong key must NOT silently open the same store ---
let wrongKeyOutcome = "no-error";
try {
  const badKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const hBad = await Crypto.StoreHandle.openWithKey("aether-m0-t01-key", badKey);
  const mBad = await Crypto.OlmMachine.initFromStore(
    new Crypto.UserId("@keyed:aether.test"),
    new Crypto.DeviceId("T01KEYED"),
    hBad,
  );
  wrongKeyOutcome = mBad.identityKeys.ed25519.toBase64() === k3 ? "opened-same-identity" : "opened-different-identity";
} catch (e) {
  wrongKeyOutcome = "rejected: " + String(e.message || e).slice(0, 80);
}
check("store opened with wrong key does not yield original identity", wrongKeyOutcome !== "opened-same-identity", wrongKeyOutcome);

report("t01-wasm-load", checks);