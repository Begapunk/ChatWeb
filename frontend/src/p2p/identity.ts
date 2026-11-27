import { canonical, ready, verifyPublicIdentity, type PublicIdentity } from "./crypto";

const encoder = new TextEncoder();
const IDENTITY_PREFIX = "aether-id1:";

function b64url(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2000) throw new Error("身份二维码格式无效");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newAuthNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the permanent Ed25519 public key; the legacy deviceId stays unchanged. */
export async function identityFingerprint(identity: PublicIdentity): Promise<string> {
  await ready();
  if (!verifyPublicIdentity(identity)) throw new Error("设备身份公钥无效");
  return sha256Hex(fromB64url(identity.signingPublicKey));
}

export function identityCode(identity: PublicIdentity): string {
  if (!verifyPublicIdentity(identity)) throw new Error("设备身份公钥无效");
  return IDENTITY_PREFIX + b64url(encoder.encode(canonical(identity)));
}

export async function decodeIdentityCode(code: string): Promise<PublicIdentity> {
  await ready();
  if (!code.startsWith(IDENTITY_PREFIX) || code.length > 2200) throw new Error("不是 Aether 身份二维码");
  let identity: PublicIdentity;
  try { identity = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromB64url(code.slice(IDENTITY_PREFIX.length)))) as PublicIdentity; }
  catch { throw new Error("身份二维码损坏"); }
  if (!verifyPublicIdentity(identity)) throw new Error("身份二维码签名验证失败");
  return identity;
}

/** Signed SDP transcript plus both signed channel nonces form a session-bound SAS. */
export async function sessionSas(transcriptId: string, first: { id: string; nonce: string }, second: { id: string; nonce: string }): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(transcriptId) || first.id === second.id || !/^[A-Za-z0-9_-]{40,44}$/.test(first.nonce) || !/^[A-Za-z0-9_-]{40,44}$/.test(second.nonce)) {
    throw new Error("安全验证码会话参数无效");
  }
  const pair = [first, second].sort((a, b) => a.id.localeCompare(b.id));
  const material = encoder.encode(canonical({ protocol: "aether-sas-v1", transcriptId, pair }));
  const key = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("aether-sas-v1"), info: encoder.encode("device-authentication") }, key, 64));
  const value = new DataView(bits.buffer).getUint32(0, false) % 100_000_000;
  return value.toString().padStart(8, "0").replace(/(\d{4})(\d{4})/, "$1 $2");
}
