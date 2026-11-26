import { describe, expect, it } from "vitest";
import { decryptAttachmentBytes, encryptAttachmentBytes } from "./attachment-crypto";

describe("Matrix EncryptedFile v2", () => {
  it("AES-256-CTR round-trip preserves arbitrary bytes", async () => {
    const plain = crypto.getRandomValues(new Uint8Array(4097));
    const encrypted = await encryptAttachmentBytes(plain);
    const descriptor = { ...encrypted.descriptor, url: "mxc://aether.local/test" };
    const decrypted = await decryptAttachmentBytes(encrypted.ciphertext, descriptor);
    expect(decrypted).toEqual(plain);
    expect(encrypted.ciphertext).not.toEqual(plain);
    expect(descriptor.key.alg).toBe("A256CTR");
    expect(descriptor.v).toBe("v2");
    expect(descriptor.iv).not.toContain("=");
    expect(descriptor.hashes.sha256).not.toContain("=");
  });

  it("rejects tampered ciphertext before decryption", async () => {
    const encrypted = await encryptAttachmentBytes(new TextEncoder().encode("private attachment"));
    encrypted.ciphertext[0] ^= 0xff;
    await expect(
      decryptAttachmentBytes(encrypted.ciphertext, {
        ...encrypted.descriptor,
        url: "mxc://aether.local/tampered",
      }),
    ).rejects.toThrow(/完整性校验失败/);
  });

  it("uses a fresh key and IV for every encryption", async () => {
    const input = new TextEncoder().encode("same plaintext");
    const a = await encryptAttachmentBytes(input);
    const b = await encryptAttachmentBytes(input);
    expect(a.descriptor.key.k).not.toBe(b.descriptor.key.k);
    expect(a.descriptor.iv).not.toBe(b.descriptor.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });
});
