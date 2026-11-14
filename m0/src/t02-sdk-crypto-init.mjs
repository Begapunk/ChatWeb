// T02: matrix-js-sdk client.initRustCrypto() works offline (Node + fake-indexeddb),
// CryptoApi surface required by Aether M2/M3 exists, MatrixRTC session API exists.
import "fake-indexeddb/auto";
import * as sdk from "matrix-js-sdk";
import * as rtc from "matrix-js-sdk/lib/matrixrtc/index.js";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);

const client = sdk.createClient({
  baseUrl: "http://127.0.0.1:9", // unreachable on purpose: this test must not need a server
  userId: "@t02:aether.test",
  deviceId: "T02DEVICE",
  accessToken: "offline-test-token",
});

await client.initRustCrypto({
  useIndexedDB: true,
  cryptoDatabasePrefix: "aether-m0-t02",
  storageKey: globalThis.crypto.getRandomValues(new Uint8Array(32)),
});
check("initRustCrypto() resolves with encrypted IndexedDB store", true);

const c = client.getCrypto();
check("getCrypto() returns CryptoApi", !!c);

const requiredMethods = [
  "getVersion",
  "getOwnDeviceKeys",
  "isEncryptionEnabledInRoom",
  "getUserDeviceInfo",
  "setDeviceVerified",
  "setDeviceBlocked",
  "crossSignDevice",
  "bootstrapCrossSigning",
  "bootstrapSecretStorage",
  "getCrossSigningStatus",
  "createRecoveryKeyFromPassphrase",
  "requestDeviceVerification",
  "requestOwnUserVerification",
  "getKeyBackupInfo",
  "restoreKeyBackupWithPassphrase",
  "resetKeyBackup",
  "deleteKeyBackupVersion",
  "exportRoomKeys",
  "importRoomKeysAsJson",
];
for (const m of requiredMethods) {
  check(`CryptoApi.${m}() exists`, typeof c?.[m] === "function");
}

const ownKeys = await c.getOwnDeviceKeys();
check("getOwnDeviceKeys() returns ed25519+curve25519", !!ownKeys?.ed25519 && !!ownKeys?.curve25519);

check("matrixrtc subpath exports MatrixRTCSession", typeof rtc.MatrixRTCSession === "function");
check("matrixrtc subpath exports MatrixRTCSessionManager", typeof rtc.MatrixRTCSessionManager === "function");
check("client.matrixRTC accessor exists", !!client.matrixRTC);
check("MatrixRTCSession.join is a function", typeof rtc.MatrixRTCSession?.prototype?.join === "function");
check("MatrixRTCSession.leave is a function", typeof rtc.MatrixRTCSession?.prototype?.leave === "function");

report("t02-sdk-crypto-init", checks);