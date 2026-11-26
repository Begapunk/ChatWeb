import { describe, expect, it } from "vitest";
import { createVault, decryptMessage, encryptMessage, newHeader, unlockVault, verifyEnvelope, verifyPublicIdentity } from "./crypto";

describe("P2P device vault and signed ciphertext", () => {
  it("protects private keys with a passphrase and shares a room key only with its recipient", async () => {
    const alice = await createVault("Alice phone", "correct horse battery staple");
    const bob = await createVault("Bob phone", "different strong passphrase");
    expect(verifyPublicIdentity(alice.record.publicIdentity)).toBe(true);
    expect(verifyPublicIdentity(bob.record.publicIdentity)).toBe(true);
    expect(alice.record.ciphertext).not.toContain("signingSecretKey");
    await expect(unlockVault(alice.record, "wrong passphrase")).rejects.toThrow();

    const roomId = crypto.randomUUID();
    alice.session.createRoom(roomId);
    const sealed = alice.session.sealRoomKey(roomId, bob.record.publicIdentity);
    bob.session.openRoomKey(sealed, alice.record.publicIdentity);
    expect(bob.session.roomKey(roomId)).toEqual(alice.session.roomKey(roomId));

    const envelope = encryptMessage(alice.session, newHeader({
      roomId,
      senderDeviceId: alice.record.publicIdentity.deviceId,
      senderSequence: 1,
      lamportTimestamp: 1,
      epoch: 1,
    }), { kind: "text", body: "private hello" });
    expect(JSON.stringify(envelope)).not.toContain("private hello");
    expect(verifyEnvelope(envelope, alice.record.publicIdentity)).toBe(true);
    expect(decryptMessage(bob.session, envelope, alice.record.publicIdentity)).toEqual({ kind: "text", body: "private hello" });
    expect(verifyEnvelope({ ...envelope, ciphertext: `${envelope.ciphertext}a` }, alice.record.publicIdentity)).toBe(false);

    const saved = alice.session.encryptedRecord();
    alice.session.lock();
    expect(() => alice.session.roomKey(roomId)).toThrow("已锁定");
    const restored = await unlockVault(saved, "correct horse battery staple");
    expect(restored.roomKey(roomId)).toEqual(bob.session.roomKey(roomId));
    restored.lock();
    bob.session.lock();
  });
});
