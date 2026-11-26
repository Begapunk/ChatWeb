/** Matrix encrypted attachments (v2).
 *
 * Payload bytes are encrypted locally with AES-256-CTR. Only ciphertext is uploaded;
 * the JWK, IV and SHA-256 digest live inside the Megolm-encrypted room event.
 */
export interface MatrixEncryptedFile {
  url: string;
  key: {
    alg: "A256CTR";
    key_ops: ["encrypt", "decrypt"];
    kty: "oct";
    k: string;
    ext: true;
  };
  iv: string;
  hashes: { sha256: string };
  v: "v2";
}

export interface EncryptedAttachmentPayload {
  ciphertext: Uint8Array<ArrayBuffer>;
  descriptor: Omit<MatrixEncryptedFile, "url">;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// TypeScript 5.9 distinguishes ArrayBuffer-backed views from views that may be
// backed by SharedArrayBuffer. WebCrypto only accepts the former.
function ownedBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(input);
}

export async function encryptAttachmentBytes(
  plaintext: ArrayBuffer | Uint8Array,
): Promise<EncryptedAttachmentPayload> {
  const input = ownedBytes(
    plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext),
  );
  const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  // Matrix v2 uses a random 64-bit nonce followed by a zeroed 64-bit counter.
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv.subarray(0, 8));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    input,
  );
  const ciphertext = new Uint8Array(encrypted);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
  return {
    ciphertext,
    descriptor: {
      key: {
        alg: "A256CTR",
        key_ops: ["encrypt", "decrypt"],
        kty: "oct",
        k: toBase64Url(rawKey),
        ext: true,
      },
      iv: bytesToBase64(iv),
      hashes: { sha256: bytesToBase64(digest) },
      v: "v2",
    },
  };
}

export async function decryptAttachmentBytes(
  ciphertext: ArrayBuffer | Uint8Array,
  descriptor: MatrixEncryptedFile,
): Promise<Uint8Array<ArrayBuffer>> {
  if (descriptor.v !== "v2" || descriptor.key.alg !== "A256CTR") {
    throw new Error("不支持的加密附件格式");
  }
  const bytes = ownedBytes(
    ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext),
  );
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const expected = base64ToBytes(descriptor.hashes.sha256);
  if (!equalBytes(actual, expected)) throw new Error("附件完整性校验失败，密文可能已被篡改");

  const rawKey = ownedBytes(base64ToBytes(descriptor.key.k));
  const iv = ownedBytes(base64ToBytes(descriptor.iv));
  if (rawKey.length !== 32 || iv.length !== 16) throw new Error("加密附件密钥参数无效");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-CTR", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    bytes,
  );
  return new Uint8Array(decrypted);
}
