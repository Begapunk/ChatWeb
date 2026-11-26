/**
 * 真实 Matrix 链路（M2-R）。
 *
 * 这是与 Synapse 的真实连接层：调用 matrix-js-sdk 45.1.0 + Rust Crypto WASM 18.9.2，
 * 在设备端完成 Olm/Megolm 加解密。服务器只见 m.room.encrypted 密文。
 *
 * 关键实现依据（均已核对安装版 .d.ts 与 M0/M1 实测，非凭记忆）：
 *  - SDK 45 要求 createClient 时就带 deviceId，故 loginWithPassword 后必须用返回的
 *    device_id 重建 client，再 initRustCrypto（M0 事实 9 / M1 helpers.makeDevice）。
 *  - initRustCrypto({ useIndexedDB, cryptoDatabasePrefix, storageKey })：
 *    storageKey 必须是 32 字节，见 rust-crypto/index.d.ts:45。
 *  - WASM 必须显式 initAsync(固定 URL)，否则打包器重写 import.meta.url 导致 404（M0 F4）。
 *  - 发送前等待对端设备可见，否则首次消息可能永久 UTD（M0 F1）。
 *  - timeline 事件可能早于解密完成，须轮询复核（M0 F3）。
 *
 * 免安装模式由用户填写现有 Matrix homeserver，浏览器直接连接其标准 Client API。
 * 前端不接触任何 homeserver 管理端点，不保存密码，token 只存在内存中（刷新需重新登录）。
 */
import * as sdk from "matrix-js-sdk";
import { initAsync as initCryptoWasm } from "@matrix-org/matrix-sdk-crypto-wasm";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { reactive } from "vue";
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from "matrix-js-sdk/lib/crypto-api/verification.js";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import type { UIAuthCallback } from "matrix-js-sdk/lib/interactive-auth.js";
import type { Attachment, Contact, Conversation, Message, MessageKind } from "../types";
import {
  decryptAttachmentBytes,
  encryptAttachmentBytes,
  type MatrixEncryptedFile,
} from "./attachment-crypto";
import {
  decodeUserRecoveryKey,
  mergeDeviceInfo,
  summarizeSecurity,
  type SecurityDevice,
  type SecurityStatus,
} from "./security";

/** 安全中心可观察状态。恢复密钥只在内存中短暂存在，绝不写入 localStorage / sessionStorage。 */
export const securityState = reactive({
  busy: false,
  error: "",
  notice: "",
  /** 首次引导生成的恢复密钥，展示一次后由 clearRecoveryKey() 清空。 */
  recoveryKey: "",
  overview: null as {
    status: SecurityStatus;
    devices: SecurityDevice[];
  } | null,
  verification: {
    active: false,
    phase: "idle" as "idle" | "requested" | "ready" | "showing" | "done" | "cancelled",
    emoji: [] as string[],
    decimal: null as [number, number, number] | null,
    otherDeviceId: "",
    error: "",
  },
});

export function clearRecoveryKey(): void {
  // 覆盖内存中的字符串引用；JS 无法保证立即擦除，但不持久化、不进日志、不写 DOM 之外的存储。
  securityState.recoveryKey = "";
}

export type LivePhase = "idle" | "wasm" | "auth" | "crypto" | "sync" | "ready" | "error";
export type AppMode = "demo" | "live";

export interface LiveCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
}

export interface LiveIdentity {
  credentials: LiveCredentials;
  displayName: string;
}

/** 全局可观察的链路状态：UI 据此区分「演示」与「真实 E2EE」，不得伪装完成。 */
export const matrixServiceStatus = reactive({
  implemented: true,
  mode: "demo" as AppMode,
  connected: false,
  e2ee: false,
  wasmLoaded: false,
  phase: "idle" as LivePhase,
  userId: "",
  deviceId: "",
  cryptoReady: false,
  reason: "演示模式：未连接 Synapse、未初始化 Rust Crypto WASM，消息为本地模拟数据",
  error: "",
});

const WASM_URL = "/wasm/matrix_sdk_crypto_wasm_bg.wasm";

export function resetLiveStatus(): void {
  matrixServiceStatus.mode = "demo";
  matrixServiceStatus.connected = false;
  matrixServiceStatus.e2ee = false;
  matrixServiceStatus.phase = "idle";
  matrixServiceStatus.userId = "";
  matrixServiceStatus.deviceId = "";
  matrixServiceStatus.cryptoReady = false;
  matrixServiceStatus.reason =
    "演示模式：未连接 Synapse、未初始化 Rust Crypto WASM，消息为本地模拟数据";
  matrixServiceStatus.error = "";
}

/**
 * 仅记录「本次浏览会话曾建立过真实链路」的非敏感标记。
 * 绝不写入 token / 口令 / storageKey / 任何密钥：凭据只存在于内存中。
 * 用途：整页刷新导致内存态丢失时，明确提示会话已结束并回到登录页，
 * 杜绝静默回退到演示假数据、让用户误以为仍在真实加密会话中。
 */
const LIVE_SESSION_FLAG = "aether.live-session";

export function markLiveSession(): void {
  try {
    sessionStorage.setItem(LIVE_SESSION_FLAG, "1");
  } catch {
    // 隐私模式或禁用存储时退化为「不记录」，不影响真实链路本身
  }
}

export function clearLiveSession(): void {
  try {
    sessionStorage.removeItem(LIVE_SESSION_FLAG);
  } catch {
    // 同上
  }
}

export function hadLiveSession(): boolean {
  try {
    return sessionStorage.getItem(LIVE_SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

interface RegisterResponse {
  user_id?: string;
  access_token?: string;
  device_id?: string;
  session?: string;
  flows?: { stages: string[] }[];
  errcode?: string;
  error?: string;
}

export const DEFAULT_HOMESERVER = "https://matrix-client.matrix.org";
const MATRIX_ORG_UPLOAD_LIMIT = 10_000_000;
const APP_UPLOAD_LIMIT = 20 * 1024 * 1024;

export function normalizeHomeserver(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("请填写 Matrix 服务器地址");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Matrix 服务器地址格式无效");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Matrix 服务器必须使用 HTTPS（localhost 可使用 HTTP）");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务器地址不能包含账号、密码、查询参数或片段");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

function toCredentials(json: RegisterResponse): LiveCredentials {
  if (!json.user_id || !json.access_token || !json.device_id) {
    throw new Error("服务端未返回完整凭据（user_id / access_token / device_id）");
  }
  return { userId: json.user_id, accessToken: json.access_token, deviceId: json.device_id };
}

/** 从用户口令派生 32 字节 storageKey，用于加密 Rust Crypto 的 IndexedDB。
 *  salt 绑定 userId，保证同一账号+口令重启后能复用同一加密存储（M0 F2）。
 *  口令只在本次调用中使用，不写入任何持久化存储。 */
async function deriveStorageKey(userId: string, password: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(`aether:rust-crypto-store:v1:${userId}`),
      iterations: 150_000,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function shortName(userId: string): string {
  return userId.split(":")[0].replace(/^@/, "") || userId;
}

function colorFor(userId: string): string {
  const palette = ["#4fd1c5", "#8b9cf7", "#e0a96d", "#d98cb3", "#7fc98a", "#6fb3d2"];
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function humanSize(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : 0;
  if (!n) return "未知大小";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export class MatrixService {
  private client: MatrixClient | null = null;
  private changeListeners = new Set<() => void>();
  private pollTimer: number | undefined;
  private joinTimer: number | undefined;
  private joinAttempted = new Set<string>();
  private timelineSignature = "";
  /** 只在内存的会话凭据：供跨签名 UIA、设备撤销 UIA 与恢复密钥重连使用，绝不持久化。 */
  private sessionPassword = "";
  private sessionHomeserver = "";
  private sessionCredentials: LiveCredentials | null = null;
  private sessionDisplayName = "";
  /** 4S 私钥（32 字节）：由恢复密钥解码或首次引导生成，只在内存，供 cryptoCallbacks 读取。 */
  private secretStorageKey: Uint8Array<ArrayBuffer> | null = null;
  private restoredKeys = 0;
  /** 正在进行的 SAS 验证请求与回调，只在内存。 */
  private verificationRequest: VerificationRequest | null = null;
  private sasCallbacks: Pick<ShowSasCallbacks, "confirm" | "mismatch" | "cancel"> | null = null;

  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  private emit(): void {
    for (const cb of this.changeListeners) cb();
  }

  private requireClient(): MatrixClient {
    if (!this.client) throw new Error("Matrix 客户端尚未连接");
    return this.client;
  }

  /** 显式加载 WASM。模块级单例：SDK 内部再次调用 initAsync() 会复用同一实例。 */
  static async loadWasm(): Promise<void> {
    if (matrixServiceStatus.wasmLoaded) return;
    matrixServiceStatus.phase = "wasm";
    await initCryptoWasm(new URL(WASM_URL, window.location.origin));
    matrixServiceStatus.wasmLoaded = true;
  }

  /** 用账号口令登录，返回凭据；随后由 connect() 重建带 deviceId 的加密客户端。 */
  static async login(homeserver: string, username: string, password: string): Promise<LiveCredentials> {
    await MatrixService.loadWasm();
    matrixServiceStatus.phase = "auth";
    const tmp = sdk.createClient({ baseUrl: normalizeHomeserver(homeserver) });
    const resp = await tmp.loginWithPassword(username, password);
    return toCredentials(resp as RegisterResponse);
  }

  /** 建立加密客户端：device_id 重建 → initRustCrypto → sync PREPARED → 自动入房。
   *  M3：可在连接时携带恢复密钥（4S 私钥），SDK 通过 cryptoCallbacks 在需要解密 SSSS 时取用。
   *  cryptoCallbacks 是 createClient 构造期选项，无法连接后追加（见 docs/M3-KICKOFF-CHECK.md §3）。 */
  async connect(
    creds: LiveCredentials,
    homeserver: string,
    password: string,
    displayName?: string,
    recoveryKey?: string,
  ): Promise<LiveIdentity> {
    await MatrixService.loadWasm();
    this.stop();
    matrixServiceStatus.mode = "live";
    matrixServiceStatus.phase = "crypto";
    matrixServiceStatus.error = "";
    this.sessionPassword = password;
    this.sessionHomeserver = normalizeHomeserver(homeserver);
    this.sessionCredentials = creds;
    this.sessionDisplayName = displayName || shortName(creds.userId);
    this.restoredKeys = 0;
    securityState.notice = "";
    securityState.error = "";
    // 恢复密钥只在内存：解码后交给 createClient 的回调闭包，绝不写入 localStorage / sessionStorage。
    this.secretStorageKey = recoveryKey ? decodeUserRecoveryKey(recoveryKey) : null;

    const prefix = `aether-live-${creds.userId.replace(/[^a-z0-9]/gi, "_")}`;
    const storageKey = await deriveStorageKey(creds.userId, password);
    const client = sdk.createClient({
      baseUrl: normalizeHomeserver(homeserver),
      userId: creds.userId,
      deviceId: creds.deviceId,
      accessToken: creds.accessToken,
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }) => {
          const keyId = Object.keys(keys)[0];
          const key = this.secretStorageKey;
          // 没有恢复密钥时返回 null（SDK 会抛「无密钥」），绝不猜测或生成新密钥顶替。
          return keyId && key ? ([keyId, key] as [string, Uint8Array<ArrayBuffer>]) : null;
        },
      },
    });
    await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: prefix, storageKey });
    this.bindVerificationEvents(client);
    matrixServiceStatus.cryptoReady = true;
    matrixServiceStatus.deviceId = creds.deviceId;
    matrixServiceStatus.userId = creds.userId;

    const prepared = new Promise<void>((resolve) => {
      client.on(sdk.ClientEvent.Sync, (state) => {
        if (state === "PREPARED") resolve();
      });
    });
    client.on(sdk.ClientEvent.Sync, () => this.emit());
    client.on(sdk.RoomEvent.Timeline, () => this.emit());

    matrixServiceStatus.phase = "sync";
    await client.startClient({ initialSyncLimit: 30 });
    await prepared;

    this.client = client;

    // M3：连接时携带恢复密钥则立即执行恢复（清浏览器数据后的场景）。
    // 恢复失败必须让整个连接失败并清理内存凭据，绝不静默当作普通登录（fail-closed）。
    if (this.secretStorageKey) {
      try {
        await this.restoreSecurityFromKey();
      } catch (err) {
        this.stop();
        this.clearSessionSecrets();
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`恢复密钥无效或密钥恢复失败：${msg}`);
      }
    }

    matrixServiceStatus.connected = true;
    matrixServiceStatus.e2ee = client.getCrypto() !== undefined;
    matrixServiceStatus.phase = "ready";
    // 仅写非敏感布尔标记；整页刷新后用于显式提示「会话已结束」，不静默回退 demo 假数据。
    markLiveSession();
    matrixServiceStatus.reason = matrixServiceStatus.e2ee
      ? `真实 E2EE：已连接 Synapse，Rust Crypto WASM 就绪（设备 ${creds.deviceId}）`
      : "已连接 Synapse，但加密层未就绪 —— 不得视为端到端加密";

    // F3：timeline 事件可能早于解密完成，用短轮询复核签名变化。
    this.pollTimer = window.setInterval(() => this.checkTimeline(), 900);
    // 邀请服务轮询后才发 invite，持续检查并自动 join。
    this.joinTimer = window.setInterval(() => void this.autoJoinInvites(), 1500);
    void this.autoJoinInvites();
    this.emit();

    return { credentials: creds, displayName: displayName || shortName(creds.userId) };
  }

  private checkTimeline(): void {
    if (!this.client) return;
    const sig = this.client
      .getRooms()
      .map((r) => {
        const t = r.timeline;
        const last = t[t.length - 1];
        return `${r.roomId}:${t.length}:${last?.getId() ?? ""}:${last?.isDecryptionFailure?.() ?? false}`;
      })
      .join("|");
    if (sig !== this.timelineSignature) {
      this.timelineSignature = sig;
      this.emit();
    }
  }

  private async autoJoinInvites(): Promise<void> {
    const client = this.client;
    if (!client) return;
    for (const room of client.getRooms()) {
      if (room.getMyMembership() !== "invite" || this.joinAttempted.has(room.roomId)) continue;
      this.joinAttempted.add(room.roomId);
      try {
        await client.joinRoom(room.roomId);
        this.emit();
      } catch {
        // 允许稍后重试（邀请服务尚未完成 invite / 房间状态未回填）
        this.joinAttempted.delete(room.roomId);
      }
    }
  }

  /**
   * 发送前的加密就绪门禁（M2-R 实测修复，M0 F1 的工程化落地）。
   *
   * SDK 45 源码事实（已核对安装版 lib/sync.js:1202-1212 与 rust-crypto/rust-crypto.js:170-176）：
   *  - `roomEncryptors[roomId]` 只在 sync 循环处理到 `m.room.encryption` 状态事件时，
   *    由 `onCryptoEvent()` 建立；SDK 源码注释本身就点明了「应用看到 state event 就发消息、
   *    但 crypto 尚未启用」的竞态。
   *  - 在此之前 `encryptEvent()` 直接抛 `Cannot encrypt event in unconfigured room`，
   *    消息**根本不会到达服务器**（诊断证据：本次新事件只有 m.room.member）。
   *  - 自动 join 的房间必须等下一次 /sync；同时 joined members 也需同步完成，
   *    否则 Megolm 出站会话不会把 room key 分发给对端，对端永久 UTD。
   *
   * 只使用公开 API：`CryptoApi.isEncryptionEnabledInRoom()`（读 OlmMachine room settings，
   * 与 RoomEncryptor 在同一个同步块内建立）与 `getUserDeviceInfo(peers, true)`。
   * 有界等待；超时抛错**取消发送**，绝不降级为明文（安全红线）。
   */
  async waitForEncryptionReady(roomId: string, timeoutMs = 20000): Promise<void> {
    const client = this.requireClient();
    const cryptoApi = client.getCrypto();
    if (!cryptoApi) throw new Error("加密层未就绪，已取消发送（不会发送明文）");

    const me = client.getUserId();
    const deadline = Date.now() + timeoutMs;
    let lastMembers = "";
    let stableTicks = 0;
    let lastDeviceCount = -1;
    let deviceStableTicks = 0;

    while (Date.now() < deadline) {
      const peers = (client.getRoom(roomId)?.getJoinedMembers() ?? [])
        .map((m) => m.userId)
        .filter((id) => id !== me);
      const signature = [...peers].sort().join(",");
      stableTicks = signature === lastMembers ? stableTicks + 1 : 0;
      lastMembers = signature;

      let encryptionReady = false;
      try {
        encryptionReady = await cryptoApi.isEncryptionEnabledInRoom(roomId);
      } catch {
        // OlmMachine 尚未处理该房间，继续有界等待
      }

      // 成员列表稳定后才做 keys/query，避免反复打 /keys/query。
      let devicesReady = false;
      if (encryptionReady && stableTicks >= 2) {
        if (peers.length === 0) {
          // 单人房间：没有对端设备需要分发，稳定后即可发送。
          devicesReady = stableTicks >= 3;
        } else {
          try {
            const info = await cryptoApi.getUserDeviceInfo(peers, true);
            // M0 F1：不能只要求「至少一个设备可见」——那可能只是管理员的旧设备，
            // 刚注册的对端还没完成首次 keys/upload，会永久 UTD。
            // 但也不能要求「全员有设备」：房间可能残留 M1 测试账号，从未上传密钥。
            // 折中：等待「有设备的成员数」连续若干次不再增长且 > 0（收敛判定）。
            const visible = peers.filter((id) => (info.get(id)?.size ?? 0) > 0).length;
            deviceStableTicks = visible === lastDeviceCount ? deviceStableTicks + 1 : 0;
            lastDeviceCount = visible;
            devicesReady = visible > 0 && deviceStableTicks >= 2;
          } catch {
            // 密钥尚未同步，继续有界等待
          }
        }
      }

      if (encryptionReady && devicesReady) return;
      await new Promise((r) => window.setTimeout(r, 400));
    }
    throw new Error("加密会话尚未就绪（房间加密配置或成员设备密钥未同步），已取消发送；未发送任何明文");
  }

  async sendText(roomId: string, body: string, replyToId?: string): Promise<string> {
    const content: Record<string, unknown> = { msgtype: sdk.MsgType.Text, body };
    if (replyToId) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyToId } };
    return this.sendRoomMessage(roomId, content);
  }

  /** Send a room message only after the Rust crypto layer is ready. Never falls back to plaintext. */
  private async sendRoomMessage(roomId: string, content: Record<string, unknown>): Promise<string> {
    const client = this.requireClient();
    // 首次发送前必须等加密层就绪（自动入房后的 sync 竞态）。
    // 若仍遇到可恢复的加密竞态，只做有界重试；任何失败都不得降级为明文发送。
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForEncryptionReady(roomId, 20000);
      try {
        // SDK 45 的 sendEvent 泛型把事件类型收窄为 EventType 枚举成员，内容类型来自
        // matrix-events-sdk 且不含可选关系字段；此处已按 Matrix 规范构造，故显式断言。
        const res = await client.sendEvent(roomId, sdk.EventType.RoomMessage, content as never);
        this.emit();
        return res.event_id;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        // 仅对「加密层尚未配置好」这类明确的时序竞态重试；其他错误立即抛出。
        if (!/unconfigured room/i.test(message)) throw err;
        await new Promise((r) => window.setTimeout(r, 600));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("发送失败：加密会话未就绪");
  }

  /** Encrypt bytes locally, upload ciphertext without a filename, then send the key metadata
   * inside the Megolm-encrypted room event. */
  async sendAttachment(
    roomId: string,
    file: File,
    kind: Exclude<MessageKind, "text">,
    durationSec?: number,
  ): Promise<string> {
    if (!file.size) throw new Error("不能发送空文件");
    const isMatrixOrg = this.sessionHomeserver === DEFAULT_HOMESERVER;
    if (file.size > (isMatrixOrg ? MATRIX_ORG_UPLOAD_LIMIT : APP_UPLOAD_LIMIT)) {
      throw new Error(isMatrixOrg ? "附件超过 Matrix.org 免费版 10 MB 上限" : "附件超过应用的 20 MiB 上限");
    }
    await this.waitForEncryptionReady(roomId, 20_000);

    const encrypted = await encryptAttachmentBytes(await file.arrayBuffer());
    const upload = await this.requireClient().uploadContent(
      new Blob([encrypted.ciphertext], { type: "application/octet-stream" }),
      { type: "application/octet-stream", includeFilename: false },
    );
    if (!upload.content_uri?.startsWith("mxc://")) throw new Error("服务器未返回有效的媒体地址");
    const descriptor: MatrixEncryptedFile = { ...encrypted.descriptor, url: upload.content_uri };
    const msgtype = kind === "image" ? "m.image" : kind === "voice" ? "m.audio" : "m.file";
    const content: Record<string, unknown> = {
      msgtype,
      body: file.name || (kind === "voice" ? "语音消息" : "附件"),
      filename: file.name || undefined,
      file: descriptor,
      info: {
        mimetype: file.type || "application/octet-stream",
        size: file.size,
        ...(durationSec ? { duration: Math.round(durationSec * 1000) } : {}),
      },
    };
    return this.sendRoomMessage(roomId, content);
  }

  /** Download ciphertext through the authenticated Matrix media endpoint, verify SHA-256,
   * and only then decrypt it locally. */
  async downloadAttachment(message: Message): Promise<Blob> {
    const encryptedFile = message.attachment?.encryptedFile;
    if (!encryptedFile) {
      throw new Error("该附件不是 Matrix EncryptedFile，已阻止不安全下载");
    }
    const client = this.requireClient();
    const url = client.mxcUrlToHttp(encryptedFile.url, undefined, undefined, undefined, false, true, true);
    if (!url) throw new Error("附件媒体地址无效");
    const token = this.sessionCredentials?.accessToken;
    if (!token) throw new Error("会话凭据已失效，请重新登录");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`附件下载失败（${response.status}）`);
    const decrypted = await decryptAttachmentBytes(await response.arrayBuffer(), encryptedFile);
    return new Blob([decrypted], {
      type: message.attachment?.mime || "application/octet-stream",
    });
  }

  async revoke(roomId: string, eventId: string): Promise<void> {
    await this.requireClient().redactEvent(roomId, eventId);
    this.emit();
  }

  async markRead(roomId: string): Promise<void> {
    const client = this.requireClient();
    const timeline = client.getRoom(roomId)?.timeline ?? [];
    const last = [...timeline].reverse().find((ev) => !ev.isDecryptionFailure?.());
    if (!last) return;
    try {
      await client.sendReadReceipt(last);
    } catch {
      // 已读回执失败不影响消息读取
    }
  }

  getConversations(): Conversation[] {
    const client = this.client;
    if (!client) return [];
    const me = client.getUserId() ?? "";
    return client
      .getRooms()
      .filter((r) => r.getMyMembership() === "join" || r.getMyMembership() === "invite")
      .map((room) => {
        const members = room.getJoinedMembers().map((m) => m.userId);
        const others = members.filter((id) => id !== me);
        const rawName = room.name;
        const name =
          rawName && rawName !== room.roomId ? rawName : others.length ? others.map(shortName).join("、") : "未命名会话";
        const encEvent = room.currentState?.getStateEvents?.("m.room.encryption", "");
        return {
          id: room.roomId,
          kind: (others.length > 1 ? "group" : "direct") as "direct" | "group",
          name,
          memberIds: [...new Set([me, ...members])],
          topic: room.getMyMembership() === "invite" ? "待接受邀请" : "端到端加密会话",
          unread: room.getUnreadNotificationCount?.() ?? 0,
          pinned: false,
          muted: false,
          // 严格依据 m.room.encryption 状态事件判定本房间是否启用 Megolm。
          // 不得用「客户端加密层已就绪」兜底：那会把未加密房间误报为 E2EE，
          // 属于把 TLS/能力就绪混淆为端到端加密的红线问题。
          encrypted: Boolean(encEvent),
        };
      });
  }

  getMessages(roomId: string): Message[] {
    const client = this.client;
    if (!client) return [];
    const me = client.getUserId() ?? "";
    const timeline = client.getRoom(roomId)?.timeline ?? [];
    return timeline
      .filter((ev) => {
        const t = ev.getType();
        return t === "m.room.message" || t === "m.room.encrypted" || ev.isRedacted?.();
      })
      .map((ev) => this.toMessage(ev, roomId, me))
      .filter((m): m is Message => m !== null);
  }

  private toMessage(ev: MatrixEvent, roomId: string, me: string): Message | null {
    const id = ev.getId();
    if (!id) return null;
    const content = (ev.getContent() ?? {}) as Record<string, any>;
    const wireType = ev.getWireType?.() ?? "";
    const failed = Boolean(ev.isDecryptionFailure?.());
    const revoked = Boolean(ev.isRedacted?.()) || Object.keys(content).length === 0;
    const msgtype = String(content.msgtype ?? "m.text");
    let kind: MessageKind = "text";
    if (msgtype === "m.image") kind = "image";
    else if (msgtype === "m.file") kind = "file";
    else if (msgtype === "m.audio") kind = "voice";

    let attachment: Attachment | undefined;
    if (kind !== "text") {
      const encryptedFile = content.file as MatrixEncryptedFile | undefined;
      attachment = {
        name: String(content.filename ?? content.body ?? "附件"),
        size: humanSize(content.info?.size),
        mime: String(content.info?.mimetype ?? ""),
        ...(encryptedFile?.v === "v2" && encryptedFile.url ? { encryptedFile } : {}),
      };
    }
    const replyTo = content["m.relates_to"]?.["m.in_reply_to"]?.event_id as string | undefined;
    const body = failed ? "无法解密此消息（缺少会话密钥）" : String(content.body ?? "");
    return {
      id,
      roomId,
      senderId: ev.getSender() ?? "",
      kind,
      body,
      ts: ev.getTs() || Date.now(),
      status: ev.getSender() === me ? "sent" : "read",
      ...(replyTo ? { replyTo } : {}),
      ...(revoked ? { revoked: true } : {}),
      ...(attachment ? { attachment } : {}),
      ...(content.info?.duration ? { durationSec: Math.round(content.info.duration / 1000) } : {}),
      ...(wireType === "m.room.encrypted" ? { encrypted: true } : {}),
    } as Message;
  }

  contactOf(userId: string): Contact {
    const client = this.client;
    let name = shortName(userId);
    if (client) {
      for (const room of client.getRooms()) {
        const member = room.getMember(userId);
        if (member?.name && member.name !== userId) {
          name = member.name;
          break;
        }
      }
    }
    return {
      id: userId,
      name,
      initials: name.slice(0, 1).toUpperCase(),
      color: colorFor(userId),
      online: false,
      verified: false,
    };
  }

  // ---------------------------------------------------------------------------
  // M3 安全中心：SSSS / 密钥备份恢复 / 跨签名 / 真实设备 / SAS 验证
  // 所有 API 签名均已核对安装版 matrix-js-sdk 45.1.0 的 .d.ts 与源码，
  // 证据见 docs/M3-KICKOFF-CHECK.md。恢复密钥与口令只在内存，绝不持久化。
  // ---------------------------------------------------------------------------

  private clearSessionSecrets(): void {
    this.sessionPassword = "";
    this.sessionHomeserver = "";
    this.sessionCredentials = null;
    this.sessionDisplayName = "";
    this.secretStorageKey = null;
    this.restoredKeys = 0;
  }

  /** 断开/登出时显式清除内存中的口令与 4S 私钥。connect() 内部的 stop() 不会清。 */
  forgetSession(): void {
    this.clearSessionSecrets();
    clearRecoveryKey();
    securityState.notice = "";
    securityState.error = "";
    securityState.overview = null;
    securityState.verification.active = false;
    securityState.verification.phase = "idle";
  }

  private requireCrypto() {
    const cryptoApi = this.requireClient().getCrypto();
    if (!cryptoApi) throw new Error("加密层未就绪（Rust Crypto WASM 未初始化）");
    return cryptoApi;
  }

  /** UIA 密码回调：跨签名公钥上传与设备撤销都需要 m.login.password。
   *  类型依据安装版 matrix-js-sdk 45.1.0 的 lib/interactive-auth.d.ts：
   *  UIAuthCallback<T> = (makeRequest: (authData: AuthDict | null) => Promise<T>) => Promise<T>，
   *  AuthDict 含 PasswordDict 联合成员，因此这里直接传对象即可，无需 as never 强转。 */
  private passwordAuth(): UIAuthCallback<void> {
    return async (makeRequest) => {
      await makeRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: this.requireClient().getUserId() },
        password: this.sessionPassword,
      });
    };
  }

  /**
   * 首次引导：建立跨签名 + 4S(SSSS) + 服务器密钥备份，返回**一次性**恢复密钥。
   *
   * 顺序依据 M0 T05 已真实跑通的序列：bootstrapCrossSigning → bootstrapSecretStorage。
   * 恢复密钥由 createRecoveryKeyFromPassphrase() 随机生成（不传口令，符合 Matrix 规范；
   * restoreKeyBackupWithPassphrase 已 deprecated）。生成后立刻写入内存 secretStorageKey，
   * 让 createClient 注入的 getSecretStorageKey 回调能在同一次引导中加密 SSSS 内容。
   */
  async setupKeyBackup(): Promise<string> {
    const cryptoApi = this.requireCrypto();
    securityState.busy = true;
    securityState.error = "";
    try {
      const generated = await cryptoApi.createRecoveryKeyFromPassphrase();
      if (!generated?.encodedPrivateKey) throw new Error("恢复密钥生成失败");
      this.secretStorageKey = generated.privateKey;

      await cryptoApi.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: this.passwordAuth(),
      });
      await cryptoApi.bootstrapSecretStorage({
        setupNewKeyBackup: true,
        createSecretStorageKey: async () => ({
          keyInfo: { name: "Aether 恢复密钥" },
          privateKey: generated.privateKey,
          encodedPrivateKey: generated.encodedPrivateKey,
        }),
      });
      await cryptoApi.checkKeyBackupAndEnable();
      securityState.recoveryKey = generated.encodedPrivateKey;
      securityState.notice = "密钥备份已建立。请立即离线抄写恢复密钥并确认，服务器无法帮你找回。";
      await this.refreshSecurity();
      this.emit();
      return generated.encodedPrivateKey;
    } catch (err) {
      securityState.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      securityState.busy = false;
    }
  }

  /**
   * 用恢复密钥重建连接：清浏览器数据后在设置页导入恢复密钥时调用。
   * cryptoCallbacks 是 createClient 的构造期选项，且 M0 F2 实证同实例 stop/start
   * 不会重启 rust-crypto 循环，因此必须「停止 → 新建客户端实例 → 复用同一
   * cryptoDatabasePrefix」；口令只在内存，正好可从 sessionPassword 复用。
   */
  async reconnectWithRecoveryKey(recoveryKey: string): Promise<{ total: number; imported: number }> {
    const creds = this.sessionCredentials;
    if (!creds || !this.sessionPassword) {
      throw new Error("当前会话凭据已失效，请重新登录后从登录页输入恢复密钥");
    }
    // 先做本地格式校验，避免用明显非法的输入重建连接。
    decodeUserRecoveryKey(recoveryKey);
    securityState.busy = true;
    securityState.error = "";
    const password = this.sessionPassword;
    const homeserver = this.sessionHomeserver;
    const displayName = this.sessionDisplayName;
    try {
      await this.connect(creds, homeserver, password, displayName, recoveryKey);
      return { total: this.restoredKeys, imported: this.restoredKeys };
    } catch (err) {
      securityState.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      securityState.busy = false;
    }
  }

  /** 从 4S 恢复跨签名私钥 + 备份解密密钥 + 历史 Megolm 会话密钥。仅内部调用。 */
  private async restoreSecurityFromKey(): Promise<{ total: number; imported: number }> {
    const cryptoApi = this.requireCrypto();
    // 1) 从 SSSS 导入跨签名私钥并自签本设备（源码：CrossSigningIdentity.js:38-80，正常路径无需 UIA）。
    //    仍传入 UIA 回调：若 SSSS 中不存在跨签名私钥，SDK 会走「新建密钥并上传」分支，
    //    此时必须能用 m.login.password 完成 UIA，否则恢复会静默失败（SDK 文档明确
    //    「不传 authUploadDeviceSigningKeys 则不会上传密钥」）。fail-closed 要求覆盖该边界。
    await cryptoApi.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: this.passwordAuth(),
    });
    // 2) 从 SSSS 读取 m.megolm_backup.v1，与服务器备份版本比对后缓存解密密钥。
    await cryptoApi.loadSessionBackupPrivateKeyFromSecretStorage();
    // 3) 下载并导入历史会话密钥；SDK 的 onRoomKeysUpdated 会自动重试 UTD 事件解密。
    const result = await cryptoApi.restoreKeyBackup();
    this.restoredKeys = result.imported;
    // 4) 恢复后续自动备份，避免恢复之后的新消息没有备份。
    await cryptoApi.checkKeyBackupAndEnable();
    securityState.notice = `已从密钥备份恢复 ${result.imported}/${result.total} 条会话密钥`;
    await this.refreshSecurity();
    this.emit();
    return { total: result.total, imported: result.imported };
  }

  /** 汇总安全状态与真实设备列表（不使用任何演示数据）。 */
  async refreshSecurity(): Promise<void> {
    const client = this.requireClient();
    const cryptoApi = client.getCrypto();
    const me = client.getUserId() ?? "";
    if (!cryptoApi) {
      securityState.overview = {
        status: summarizeSecurity({
          crossSigningReady: false,
          secretStorageReady: false,
          backupVersion: null,
          backupKeyCount: null,
          backupActiveVersion: null,
          restoredKeys: this.restoredKeys,
        }),
        devices: [],
      };
      return;
    }
    const [crossSigningReady, secretStorageReady, backupInfo, activeVersion, deviceInfo, serverDevices] =
      await Promise.all([
        cryptoApi.isCrossSigningReady(),
        cryptoApi.isSecretStorageReady(),
        cryptoApi.getKeyBackupInfo().catch(() => null),
        cryptoApi.getActiveSessionBackupVersion().catch(() => null),
        cryptoApi.getUserDeviceInfo([me], true).catch(() => undefined),
        client.getDevices().catch(() => ({ devices: [] })),
      ]);
    securityState.overview = {
      status: summarizeSecurity({
        crossSigningReady,
        secretStorageReady,
        backupVersion: backupInfo?.version ?? null,
        backupKeyCount: backupInfo?.count ?? null,
        backupActiveVersion: activeVersion,
        restoredKeys: this.restoredKeys,
      }),
      devices: mergeDeviceInfo(serverDevices.devices ?? [], deviceInfo?.get(me), client.getDeviceId() ?? ""),
    };
    this.emit();
  }

  /** 手动标记/取消标记设备为已验证（setDeviceVerified 不依赖跨签名）。 */
  async setDeviceTrust(deviceId: string, verified: boolean): Promise<void> {
    const me = this.requireClient().getUserId();
    if (!me) throw new Error("无法确定当前用户");
    await this.requireCrypto().setDeviceVerified(me, deviceId, verified);
    await this.refreshSecurity();
  }

  /** 用自签名密钥跨签名某个设备（需先完成跨签名引导）。 */
  async crossSignDevice(deviceId: string): Promise<void> {
    const cryptoApi = this.requireCrypto();
    if (!(await cryptoApi.isCrossSigningReady())) {
      throw new Error("跨签名尚未就绪，请先建立密钥备份");
    }
    await cryptoApi.crossSignDevice(deviceId);
    await this.refreshSecurity();
  }

  /** 撤销设备：Synapse 需要 UIA，密码取自内存会话凭据，不弹给前端表单收集。 */
  async revokeDevice(deviceId: string): Promise<void> {
    const client = this.requireClient();
    const me = client.getUserId();
    if (!me) throw new Error("无法确定当前用户");
    if (deviceId === client.getDeviceId()) throw new Error("不能撤销当前正在使用的设备");
    const auth = {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: me },
      password: this.sessionPassword,
    };
    try {
      await client.deleteDevice(deviceId, auth as never);
    } catch (err) {
      // 部分 Synapse 版本首轮返回 401 并带 session，需把 session 并入 auth 重放一次。
      const session = (err as { data?: { session?: string } })?.data?.session;
      if (session) {
        await client.deleteDevice(deviceId, { ...auth, session } as never);
      } else {
        throw err;
      }
    }
    await this.refreshSecurity();
  }

  /** 注册收到的验证请求监听。client.js:1141 证实该事件由 client 通过 reEmitter 转发，
   *  因此监听挂在 MatrixClient 上，不是 CryptoApi（CryptoApi 类型未声明 on）。 */
  private bindVerificationEvents(client: MatrixClient): void {
    client.on(CryptoEvent.VerificationRequestReceived as never, ((request: VerificationRequest) => {
      this.verificationRequest = request;
      securityState.verification.active = true;
      securityState.verification.phase = "requested";
      securityState.verification.otherDeviceId = request.otherDeviceId ?? "";
      securityState.verification.error = "";
      securityState.verification.emoji = [];
      this.emit();
    }) as never);
  }

  /** 发起对自有另一设备的 SAS（emoji）验证。 */
  async requestVerification(deviceId: string): Promise<void> {
    const cryptoApi = this.requireCrypto();
    const me = this.requireClient().getUserId();
    if (!me) throw new Error("无法确定当前用户");
    securityState.verification.active = true;
    securityState.verification.phase = "requested";
    securityState.verification.otherDeviceId = deviceId;
    securityState.verification.error = "";
    securityState.verification.emoji = [];
    const request = await cryptoApi.requestDeviceVerification(me, deviceId);
    this.verificationRequest = request;
    await this.watchVerification(request, true);
  }

  /** 接受收到的验证请求（由 crypto.verificationRequestReceived 事件写入）。 */
  async acceptIncomingVerification(): Promise<void> {
    const request = this.verificationRequest;
    if (!request) throw new Error("没有待处理的验证请求");
    await request.accept();
    await this.watchVerification(request, false);
  }

  /** 等待 phase 到 Ready（发起方）或 Started（接收方），再挂 SAS 回调并启动 verify()。 */
  private async watchVerification(request: VerificationRequest, initiatedByMe: boolean): Promise<void> {
    const verifier: Verifier = await new Promise((resolve, reject) => {
      const deadline = window.setTimeout(() => {
        cleanup();
        reject(new Error("等待对方接受验证超时"));
      }, 60_000);
      const onChange = () => {
        if (request.phase === VerificationPhase.Cancelled) {
          cleanup();
          reject(new Error("对方取消了验证"));
          return;
        }
        if (initiatedByMe && request.phase === VerificationPhase.Ready) {
          cleanup();
          request.startVerification("m.sas.v1").then(resolve, reject);
        } else if (!initiatedByMe && request.phase === VerificationPhase.Started && request.verifier) {
          cleanup();
          resolve(request.verifier);
        }
      };
      const cleanup = () => {
        window.clearTimeout(deadline);
        request.off(VerificationRequestEvent.Change, onChange);
      };
      request.on(VerificationRequestEvent.Change, onChange);
      onChange();
    });

    verifier.on(VerifierEvent.ShowSas, (sas: ShowSasCallbacks) => {
      this.sasCallbacks = sas;
      securityState.verification.phase = "showing";
      securityState.verification.emoji = (sas.sas.emoji ?? []).map((e) => e[0]);
      securityState.verification.decimal = sas.sas.decimal ?? null;
      this.emit();
    });
    verifier.on(VerifierEvent.Cancel, () => {
      this.sasCallbacks = null;
      securityState.verification.phase = "cancelled";
      securityState.verification.error = "对方取消了验证";
      this.emit();
    });
    void verifier.verify().then(
      async () => {
        securityState.verification.phase = "done";
        securityState.verification.active = false;
        this.sasCallbacks = null;
        await this.refreshSecurity();
      },
      (err: unknown) => {
        securityState.verification.phase = "cancelled";
        securityState.verification.error = err instanceof Error ? err.message : String(err);
      },
    );
  }

  /** 用户确认两端 emoji 一致；不一致必须调 mismatchSas()，绝不默认通过。 */
  async confirmSas(): Promise<void> {
    if (!this.sasCallbacks) throw new Error("尚未生成 SAS 表情，不能确认");
    await this.sasCallbacks.confirm();
  }

  mismatchSas(): void {
    this.sasCallbacks?.mismatch();
    this.sasCallbacks = null;
    securityState.verification.phase = "cancelled";
    securityState.verification.error = "双方表情不一致，验证已取消（未标记为已验证）";
  }

  cancelVerification(): void {
    this.sasCallbacks?.cancel();
    void this.verificationRequest?.cancel();
    this.verificationRequest = null;
    this.sasCallbacks = null;
    securityState.verification.active = false;
    securityState.verification.phase = "cancelled";
  }

  /** 供验收脚本使用：读取某条事件的原始 wire 类型与内容（验证服务器只见密文）。 */
  wireOf(roomId: string, eventId: string): { type: string; content: unknown } | null {
    const ev = this.requireClient().getRoom(roomId)?.timeline?.find((e) => e.getId() === eventId);
    if (!ev) return null;
    return { type: ev.getWireType?.() ?? "", content: ev.getWireContent?.() ?? {} };
  }

  roomEncryptionEnabled(roomId: string): boolean {
    const room: Room | null = this.client?.getRoom(roomId) ?? null;
    return Boolean(room?.currentState?.getStateEvents?.("m.room.encryption", ""));
  }

  getClient(): MatrixClient | null {
    return this.client;
  }

  stop(): void {
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    if (this.joinTimer !== undefined) window.clearInterval(this.joinTimer);
    this.pollTimer = undefined;
    this.joinTimer = undefined;
    this.joinAttempted.clear();
    this.timelineSignature = "";
    if (this.client) {
      try {
        this.client.stopClient();
      } catch {
        // 停止失败不阻断状态复位
      }
    }
    this.client = null;
  }
}

export const matrixService = new MatrixService();
