// T03b: Matrix-spec EncryptedFile attachment encryption via WebCrypto (AES-256-CTR + SHA-256).
// matrix-js-sdk 45.1.0 ships the EncryptedFile *type* but no high-level helper, so Aether M4
// will implement this exact spec format. This test proves the round-trip and format fields.
import { makeChecker, report, b64, b64url } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);
const subtle = globalThis.crypto.subtle;

const payload = new TextEncoder().encode(
  "Aether M0 attachment bytes: image/file/voice placeholder \u0000\u0001\u0002 binary-safe",
);

// 1. Generate a 256-bit AES-CTR key and a 16-byte IV (random first 8 bytes, counter = last 8 bytes = 0)
const key = await subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));
iv.fill(0, 8);

// 2. Encrypt
const ciphertext = await subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, payload);
check("AES-CTR encryption produced ciphertext", ciphertext.byteLength > 0);
check("ciphertext differs from plaintext", Buffer.from(ciphertext).toString("hex") !== Buffer.from(payload).toString("hex"));

// 3. Build the Matrix EncryptedFile structure (v2)
const jwk = await subtle.exportKey("jwk", key);
const hash = await subtle.digest("SHA-256", ciphertext);
const encryptedFile = {
  url: "mxc://aether.test/m0placeholder",
  key: { kty: "oct", key_ops: ["encrypt", "decrypt"], alg: "A256CTR", k: jwk.k, ext: true },
  iv: b64(iv),
  hashes: { sha256: b64url(hash) },
  v: "v2",
};
check("EncryptedFile has required fields", !!encryptedFile.key.k && !!encryptedFile.iv && !!encryptedFile.hashes.sha256 && encryptedFile.v === "v2");
check("EncryptedFile JSON contains no plaintext", !JSON.stringify(encryptedFile).includes("Aether M0 attachment bytes"));

// 4. Recipient side: import key from JWK, verify hash, decrypt
const imported = await subtle.importKey(
  "jwk",
  { kty: "oct", k: encryptedFile.key.k, alg: "A256CTR", ext: true, key_ops: ["encrypt", "decrypt"] },
  { name: "AES-CTR" },
  false,
  ["decrypt"],
);
const hashCheck = await subtle.digest("SHA-256", ciphertext);
check("SHA-256 integrity hash matches", b64url(hashCheck) === encryptedFile.hashes.sha256);
const ivRecv = Uint8Array.from(Buffer.from(encryptedFile.iv, "base64"));
const decrypted = await subtle.decrypt({ name: "AES-CTR", counter: ivRecv, length: 64 }, imported, ciphertext);
check("attachment round-trip decrypts to original bytes", Buffer.from(decrypted).equals(Buffer.from(payload)));

// 5. Tampered ciphertext must fail the hash check
const tampered = Buffer.from(ciphertext);
tampered[0] ^= 0xff;
const tamperedHash = b64url(await subtle.digest("SHA-256", tampered));
check("tampered ciphertext detected by hash", tamperedHash !== encryptedFile.hashes.sha256);

report("t03b-attachment-encryption", checks);