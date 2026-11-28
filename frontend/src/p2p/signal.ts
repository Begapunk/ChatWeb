import { ready, signData, verifyData, type PublicIdentity, type VaultSession } from "./crypto";

const CODE_PREFIX = "aether1:";
const PART_PREFIX = "aether-part1";
const QR_PREFIX = "aether-qr1:";
const MAX_CODE_CHARS = 100_000;
const SIGNAL_LIFETIME_MS = 15 * 60 * 1000;

interface UnsignedSignal {
  protocol: "aether-p2p-v1";
  kind: "offer" | "answer";
  pairingId: string;
  createdAt: number;
  expiresAt: number;
  from: PublicIdentity;
  toDeviceId?: string;
  roomId?: string;
  offerDigest?: string;
  sdp: { type: "offer" | "answer"; sdp: string };
}

export interface SignedSignal extends UnsignedSignal {
  signature: string;
}

function encodeBytes(input: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < input.length; offset += 0x8000) {
    binary += String.fromCharCode(...input.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function checksum(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unsigned(signal: SignedSignal): UnsignedSignal {
  const { signature: _signature, ...rest } = signal;
  return rest;
}

function validateShape(signal: SignedSignal): void {
  if (signal.protocol !== "aether-p2p-v1" || (signal.kind !== "offer" && signal.kind !== "answer") || signal.sdp?.type !== signal.kind) {
    throw new Error("连接码协议或类型不匹配");
  }
  if (!/^[0-9a-f-]{36}$/.test(signal.pairingId) || !signal.sdp.sdp || signal.sdp.sdp.length > 60_000) {
    throw new Error("连接码内容无效或过大");
  }
  if (!Number.isSafeInteger(signal.createdAt) || !Number.isSafeInteger(signal.expiresAt) || signal.expiresAt - signal.createdAt > SIGNAL_LIFETIME_MS || signal.expiresAt < Date.now() || signal.createdAt > Date.now() + 60_000) {
    throw new Error("连接码已过期或时间无效，请重新生成");
  }
  if (signal.kind === "answer" && (!signal.toDeviceId || !signal.offerDigest)) throw new Error("应答码缺少发起方校验信息");
}

export function createSignal(session: VaultSession, input: {
  kind: "offer" | "answer";
  pairingId: string;
  description: RTCSessionDescriptionInit;
  roomId?: string;
  toDeviceId?: string;
  offerDigest?: string;
}): SignedSignal {
  if (input.description.type !== input.kind || !input.description.sdp) throw new Error("WebRTC 协商内容不完整");
  const createdAt = Date.now();
  const payload: UnsignedSignal = {
    protocol: "aether-p2p-v1",
    kind: input.kind,
    pairingId: input.pairingId,
    createdAt,
    expiresAt: createdAt + SIGNAL_LIFETIME_MS,
    from: session.publicIdentity,
    sdp: { type: input.kind, sdp: input.description.sdp },
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.toDeviceId ? { toDeviceId: input.toDeviceId } : {}),
    ...(input.offerDigest ? { offerDigest: input.offerDigest } : {}),
  };
  return { ...payload, signature: signData(session, "signal", payload) };
}

export function encodeSignal(signal: SignedSignal): string {
  return `${CODE_PREFIX}${encodeBytes(new TextEncoder().encode(JSON.stringify(signal)))}`;
}

export async function decodeSignal(code: string): Promise<SignedSignal> {
  await ready();
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX) || trimmed.length > MAX_CODE_CHARS) throw new Error("连接码格式无效或过大");
  let signal: SignedSignal;
  try {
    signal = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBytes(trimmed.slice(CODE_PREFIX.length)))) as SignedSignal;
  } catch {
    throw new Error("连接码无法解码");
  }
  validateShape(signal);
  if (!verifyData(signal.from, "signal", unsigned(signal), signal.signature)) throw new Error("连接码签名验证失败");
  return signal;
}

/** A signed offer or answer compressed for a single optical transfer. */
export async function compactSignalCode(code: string): Promise<string> {
  const signal = await decodeSignal(code);
  if (typeof CompressionStream === "undefined") throw new Error("此浏览器不支持单码压缩，请使用高级连接码");
  const input = new TextEncoder().encode(JSON.stringify(signal));
  const compressed = await new Response(new Blob([input.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
  const result = QR_PREFIX + encodeBytes(new Uint8Array(compressed));
  if (result.length > 2800) throw new Error("当前网络连接信息超出单张二维码容量，请使用高级连接码");
  return result;
}

export async function decodeCompactSignalCode(value: string): Promise<string> {
  if (!value.startsWith(QR_PREFIX) || value.length > 4000 || typeof DecompressionStream === "undefined") throw new Error("连接二维码格式无效或浏览器不支持");
  let stream: ReadableStreamDefaultReader<Uint8Array>;
  try { stream = new Blob([decodeBytes(value.slice(QR_PREFIX.length)).buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate")).getReader(); }
  catch { throw new Error("连接二维码损坏"); }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value: chunk } = await stream.read();
      if (done) break;
      length += chunk.length;
      if (length > MAX_CODE_CHARS) throw new Error("连接二维码解压后过大");
      chunks.push(chunk);
    }
  } catch { throw new Error("连接二维码损坏或过大"); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let signal: SignedSignal;
  try { signal = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SignedSignal; }
  catch { throw new Error("连接二维码内容无效"); }
  const code = encodeSignal(signal);
  await decodeSignal(code);
  return code;
}

export async function signalDigest(code: string): Promise<string> {
  return checksum(code);
}

export async function splitSignalCode(code: string, pairingId: string, fragmentSize = 480): Promise<string[]> {
  if (!code.startsWith(CODE_PREFIX) || code.length > MAX_CODE_CHARS || fragmentSize < 100 || fragmentSize > 800) throw new Error("连接码或分片大小无效");
  if (!/^[0-9a-f-]{36}$/.test(pairingId)) throw new Error("配对编号无效");
  const digest = await checksum(code);
  const count = Math.ceil(code.length / fragmentSize);
  if (count > 120) throw new Error("连接码需要过多二维码；请改用文本或文件交换");
  return Array.from({ length: count }, (_, index) =>
    `${PART_PREFIX}.${pairingId}.${index + 1}.${count}.${digest}.${code.slice(index * fragmentSize, (index + 1) * fragmentSize)}`,
  );
}

export async function reassembleSignalParts(parts: string[]): Promise<{ complete: boolean; received: number; total: number; code?: string }> {
  if (parts.length > 120) throw new Error("二维码分片过多");
  const fragments = new Map<number, string>();
  let pairingId = "";
  let total = 0;
  let digest = "";
  for (const part of parts) {
    const match = /^aether-part1\.([0-9a-f-]{36})\.(\d{1,3})\.(\d{1,3})\.([0-9a-f]{24})\.([A-Za-z0-9_:\-]+)$/.exec(part.trim());
    if (!match) throw new Error("二维码分片格式无效");
    const [, id, indexText, totalText, hash, data] = match;
    const index = Number(indexText);
    const count = Number(totalText);
    if (count < 1 || count > 120 || index < 1 || index > count) throw new Error("二维码分片序号无效");
    if (pairingId && (pairingId !== id || total !== count || digest !== hash)) throw new Error("二维码来自不同的配对任务");
    pairingId = id;
    total = count;
    digest = hash;
    const previous = fragments.get(index);
    if (previous && previous !== data) throw new Error("二维码分片内容冲突");
    fragments.set(index, data);
  }
  if (!total || fragments.size !== total) return { complete: false, received: fragments.size, total };
  const code = Array.from({ length: total }, (_, index) => fragments.get(index + 1) ?? "").join("");
  if ((await checksum(code)) !== digest) throw new Error("二维码分片校验失败");
  const signal = await decodeSignal(code);
  if (signal.pairingId !== pairingId) throw new Error("二维码配对编号不匹配");
  return { complete: true, received: total, total, code };
}
