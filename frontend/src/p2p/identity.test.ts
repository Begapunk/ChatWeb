import { beforeAll, describe, expect, it } from "vitest";
import { createVault, ready } from "./crypto";
import { decodeIdentityCode, identityCode, identityFingerprint, newAuthNonce, sessionSas } from "./identity";

beforeAll(async () => { await ready(); });

describe("device identity and session verification", () => {
  it("keeps a SHA-256 public-key fingerprint and a public-only identity code", async () => {
    const { session } = await createVault("Alice", "correct horse battery staple");
    const code = identityCode(session.publicIdentity);
    const decoded = await decodeIdentityCode(code);
    expect(decoded).toEqual(session.publicIdentity);
    expect(await identityFingerprint(decoded)).toMatch(/^[0-9a-f]{64}$/);
    expect(code).not.toContain("signingSecretKey");
    await expect(decodeIdentityCode("aether-id1:not-valid!")).rejects.toThrow();
    session.lock();
  });

  it("derives matching SAS only from the same signed session transcript and challenges", async () => {
    const transcript = "a".repeat(64);
    const alice = { id: "alice", nonce: newAuthNonce() };
    const bob = { id: "bob", nonce: newAuthNonce() };
    const code = await sessionSas(transcript, alice, bob);
    expect(code).toBe(await sessionSas(transcript, bob, alice));
    expect(code).toMatch(/^\d{4} \d{4}$/);
    expect(code).not.toBe(await sessionSas("b".repeat(64), alice, bob));
    expect(code).not.toBe(await sessionSas(transcript, alice, { ...bob, nonce: newAuthNonce() }));
    expect(code).not.toBe(await sessionSas(transcript, alice, { ...bob, id: "mallory" }));
  });
});
