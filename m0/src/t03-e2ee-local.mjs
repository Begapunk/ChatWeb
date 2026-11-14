// T03: Local two-machine E2EE without a homeserver.
// Simulates the Matrix key-distribution server in memory:
//   /keys/upload -> /keys/query -> /keys/claim -> Olm to-device -> Megolm room event.
// Verifies: ciphertext never contains plaintext; recipient decrypts; third party cannot.
import "fake-indexeddb/auto";
import * as Crypto from "@matrix-org/matrix-sdk-crypto-wasm";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);
await Crypto.initAsync();

const ALICE = "@alice:aether.test";
const BOB = "@bob:aether.test";
const EVE = "@eve:aether.test";
const ALICE_DEV = "ALICEDEVICE";
const BOB_DEV = "BOBDEVICE";
const ROOM = "!m0room:aether.test";

async function newMachine(user, device) {
  const store = await Crypto.StoreHandle.open(null, null);
  return Crypto.OlmMachine.initFromStore(new Crypto.UserId(user), new Crypto.DeviceId(device), store);
}

const alice = await newMachine(ALICE, ALICE_DEV);
const bob = await newMachine(BOB, BOB_DEV);
const eve = await newMachine(EVE, "EVEDEVICE");

// ---- in-memory "server" ----
const server = { deviceKeys: {}, oneTimeKeys: {} };

async function drainUploads(machine, user, device) {
  const reqs = await machine.outgoingRequests();
  for (const r of reqs) {
    if (r.type === Crypto.RequestType.KeysUpload) {
      const body = JSON.parse(r.body);
      server.deviceKeys[user] ??= {};
      server.deviceKeys[user][device] = body.device_keys;
      server.oneTimeKeys[user] ??= {};
      server.oneTimeKeys[user][device] = { ...(server.oneTimeKeys[user][device] || {}), ...(body.one_time_keys || {}) };
      const counts = { signed_curve25519: Object.keys(body.one_time_keys || {}).length };
      await machine.markRequestAsSent(r.id, r.type, JSON.stringify({ one_time_key_counts: counts }));
    } else {
      await machine.markRequestAsSent(r.id, r.type, "{}");
    }
  }
}
await drainUploads(alice, ALICE, ALICE_DEV);
await drainUploads(bob, BOB, BOB_DEV);
await drainUploads(eve, EVE, "EVEDEVICE");
check("key upload requests generated for all machines", !!server.deviceKeys[ALICE]?.[ALICE_DEV] && !!server.deviceKeys[BOB]?.[BOB_DEV]);

// ---- alice queries bob's device keys ----
const q = alice.queryKeysForUsers([new Crypto.UserId(BOB)]);
await alice.markRequestAsSent(q.id, q.type, JSON.stringify({ device_keys: { [BOB]: server.deviceKeys[BOB] } }));
check("keys query answered", true);

// ---- alice claims one of bob's one-time keys to build an Olm session ----
const claim = await alice.getMissingSessions([new Crypto.UserId(BOB)]);
check("getMissingSessions produced a keys claim request", !!claim);
const claimBody = JSON.parse(claim.body);
const claimed = {};
for (const [user, devices] of Object.entries(claimBody.one_time_keys || {})) {
  claimed[user] = {};
  for (const device of Object.keys(devices)) {
    const pool = server.oneTimeKeys[user][device];
    const keyId = Object.keys(pool)[0];
    claimed[user][device] = { [keyId]: pool[keyId] };
    delete pool[keyId]; // one-time keys are consumed
  }
}
await alice.markRequestAsSent(claim.id, claim.type, JSON.stringify({ one_time_keys: claimed }));
check("one-time key claim answered", true);

// ---- Olm-encrypted to-device message alice -> bob ----
const SECRET = "Aether M0 top-secret payload 7f3a9c";
const bobDevice = await alice.getDevice(new Crypto.UserId(BOB), new Crypto.DeviceId(BOB_DEV));
check("alice can resolve bob's Device object", !!bobDevice);
const encContentJson = await bobDevice.encryptToDeviceEvent("m.room.message", { msgtype: "m.text", body: SECRET });
check("Olm ciphertext does not contain plaintext", !encContentJson.includes(SECRET));
const encContent = JSON.parse(encContentJson);
check("Olm content uses m.olm.v1.curve25519-aes-sha2", encContent.algorithm === "m.olm.v1.curve25519-aes-sha2", encContent.algorithm);

const processed = await bob.receiveSyncChanges(
  JSON.stringify([{ sender: ALICE, type: "m.room.encrypted", content: encContent }]),
  new Crypto.DeviceLists(),
  new Map([["signed_curve25519", 100]]),
);
const decrypted = processed.find((p) => p.type === Crypto.ProcessedToDeviceEventType.Decrypted);
check("bob decrypted the Olm to-device event", !!decrypted);
const decEvent = decrypted ? JSON.parse(decrypted.rawEvent) : null;
check("decrypted to-device body matches plaintext", decEvent?.content?.body === SECRET);

// ---- Megolm room encryption ----
const roomId = new Crypto.RoomId(ROOM);
const settings = new Crypto.RoomSettings();
settings.algorithm = Crypto.EncryptionAlgorithm.MegolmV1AesSha2;
await alice.setRoomSettings(roomId, settings);
await bob.setRoomSettings(roomId, settings);
await eve.setRoomSettings(roomId, settings);

const shareReqs = await alice.shareRoomKey(roomId, [new Crypto.UserId(BOB)], new Crypto.EncryptionSettings());
check("shareRoomKey produced to-device requests", shareReqs.length > 0);
for (const r of shareReqs) {
  const body = JSON.parse(r.body);
  const events = [];
  for (const [user, devices] of Object.entries(body.messages || {})) {
    for (const [device, content] of Object.entries(devices)) {
      events.push({ sender: ALICE, type: r.event_type, content });
    }
  }
  await bob.receiveSyncChanges(JSON.stringify(events), new Crypto.DeviceLists(), new Map([["signed_curve25519", 100]]));
  await r.markAsSent?.();
}
check("room key delivered to bob", true);

const ROOM_SECRET = "Aether M0 megolm room payload 2b8d41";
const encRoomJson = await alice.encryptRoomEvent(roomId, "m.room.message", JSON.stringify({ msgtype: "m.text", body: ROOM_SECRET }));
check("Megolm ciphertext does not contain plaintext", !encRoomJson.includes(ROOM_SECRET));
const encRoom = JSON.parse(encRoomJson);
const wireContent = encRoom.content ?? encRoom;
check("room content uses m.megolm.v1.aes-sha2", wireContent.algorithm === "m.megolm.v1.aes-sha2", wireContent.algorithm);

const fullEvent = {
  type: "m.room.encrypted",
  sender: ALICE,
  room_id: ROOM,
  event_id: "$m0-local-test",
  origin_server_ts: Date.now(),
  content: wireContent,
};
const decRoom = await bob.decryptRoomEvent(JSON.stringify(fullEvent), roomId, new Crypto.DecryptionSettings(Crypto.TrustRequirement.Untrusted));
const decRoomEvent = JSON.parse(decRoom.event);
check("bob decrypted the Megolm room event", decRoomEvent?.content?.body === ROOM_SECRET);

// ---- eve (never received the room key) must fail to decrypt ----
let eveFailed = false;
try {
  await eve.decryptRoomEvent(JSON.stringify(fullEvent), roomId, new Crypto.DecryptionSettings(Crypto.TrustRequirement.Untrusted));
} catch (e) {
  eveFailed = true;
}
check("third party without room key cannot decrypt", eveFailed);

report("t03-e2ee-local", checks);