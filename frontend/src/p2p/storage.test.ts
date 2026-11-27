import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createVault, encryptMessage, newHeader } from "./crypto";
import { ackReplica, createRoom, deleteLocalMessage, getEnvelope, getPeer, listOutbox, listRoomEnvelopes, loadVault, savePeer, saveVault, storeIncoming, storeOutgoing, verifyPeer } from "./storage";

it("stores signed ciphertext, prevents duplicate sequences, and tracks replica acknowledgements", async () => {
  const alice = await createVault("Alice", "correct horse battery staple");
  const bob = await createVault("Bob", "another long safe passphrase");
  await saveVault(alice.record);
  expect((await loadVault())?.publicIdentity.deviceId).toBe(alice.record.publicIdentity.deviceId);

  const peer = await savePeer(bob.record.publicIdentity);
  expect(peer.verifiedAt).toBeNull();
  await verifyPeer(peer.deviceId);
  expect((await getPeer(peer.deviceId))?.verifiedAt).toBeTypeOf("number");

  const roomId = crypto.randomUUID();
  alice.session.createRoom(roomId);
  await createRoom({
    roomId, name: "Private room", ownerDeviceId: alice.record.publicIdentity.deviceId,
    members: [alice.record.publicIdentity, bob.record.publicIdentity], currentEpoch: 1,
    createdAt: Date.now(), updatedAt: Date.now(), lastReadLamport: 0,
  }, alice.record.publicIdentity.deviceId);

  const header = newHeader({ roomId, senderDeviceId: alice.record.publicIdentity.deviceId, senderSequence: 1, lamportTimestamp: 1, epoch: 1 });
  const envelope = encryptMessage(alice.session, header, { kind: "text", body: "not in database plaintext" });
  await storeOutgoing(envelope, [bob.record.publicIdentity.deviceId]);
  expect((await getEnvelope(header.messageId))?.envelope.ciphertext).toBe(envelope.ciphertext);
  expect((await listRoomEnvelopes(roomId))[0]?.envelope.ciphertext).not.toContain("not in database plaintext");
  expect((await listOutbox()).find((item) => item.messageId === header.messageId)?.pendingDeviceIds).toEqual([bob.record.publicIdentity.deviceId]);
  expect(await storeIncoming(envelope)).toBe(false);

  const fork = encryptMessage(alice.session, { ...header, messageId: crypto.randomUUID() }, { kind: "text", body: "fork" });
  await expect(storeIncoming(fork)).rejects.toThrow("同一设备序号");
  expect(await ackReplica(header.messageId, bob.record.publicIdentity.deviceId)).toBe(2);
  expect((await listOutbox()).find((item) => item.messageId === header.messageId)).toBeUndefined();
  await deleteLocalMessage(header.messageId);
  expect(await getEnvelope(header.messageId)).toBeUndefined();
  expect(await storeIncoming(envelope)).toBe(false);
  alice.session.lock();
  bob.session.lock();
});
