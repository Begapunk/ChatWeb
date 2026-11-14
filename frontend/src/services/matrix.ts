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
 * 安全边界：baseUrl 恒为当前 origin 的相对路径 /_matrix/*，本地由 Vite proxy、
 * 生产由 Caddy 同源承载。前端永远不接触 /_synapse/admin 或邀请服务管理端点，
 * 不保存密码，token 只存在内存中（刷新需重新登录）。
 */
import * as sdk from "matrix-js-sdk";
import { initAsync as initCryptoWasm } from "@matrix-org/matrix-sdk-crypto-wasm";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { reactive } from "vue";
import type { Attachment, Contact, Conversation, Message, MessageKind } from "../types";

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

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
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

  /** 一次性邀请码校验 → 换取短时效注册令牌。只走公共路径，不接触管理端点。 */
  static async verifyInvite(code: string): Promise<string> {
    const res = await postJson<{ registration_token?: string; error?: string }>(
      "/invite-api/v1/verify",
      { code: code.trim() },
    );
    if (res.status !== 200 || !res.json.registration_token) {
      throw new Error(`邀请码校验失败（${res.status}${res.json.error ? ` ${res.json.error}` : ""}）`);
    }
    return res.json.registration_token;
  }

  /** Synapse UIA 注册：registration_requires_token 下 flow 为多阶段，
   *  须逐阶段提交（m.login.registration_token 带 token，dummy 不带参数）。
   *  与 M1 helpers.registerWithToken 同构，改由浏览器 fetch 实现。 */
  static async register(username: string, password: string, token: string): Promise<LiveCredentials> {
    const base = { username, password, inhibit_login: false };
    const first = await postJson<RegisterResponse>("/_matrix/client/v3/register", base);
    if (first.status === 200) return toCredentials(first.json);

    const session = first.json.session;
    const flow = (first.json.flows ?? []).find((f) =>
      (f.stages ?? []).includes("m.login.registration_token"),
    );
    if (!session || !flow) {
      throw new Error(`注册流程不可用（${first.status} ${first.json.errcode ?? ""}）`);
    }
    let auth: Record<string, string> = { session };
    let last = first;
    for (const stage of flow.stages) {
      auth = {
        ...auth,
        type: stage,
        ...(stage === "m.login.registration_token" ? { token } : {}),
      };
      last = await postJson<RegisterResponse>("/_matrix/client/v3/register", { ...base, auth });
      if (last.status === 200) break;
    }
    if (last.status !== 200) {
      throw new Error(`注册失败（${last.status} ${last.json.errcode ?? last.json.error ?? ""}）`);
    }
    return toCredentials(last.json);
  }

  /** 用账号口令登录，返回凭据；随后由 connect() 重建带 deviceId 的加密客户端。 */
  static async login(username: string, password: string): Promise<LiveCredentials> {
    await MatrixService.loadWasm();
    matrixServiceStatus.phase = "auth";
    const tmp = sdk.createClient({ baseUrl: window.location.origin });
    const resp = await tmp.loginWithPassword(username, password);
    return toCredentials(resp as RegisterResponse);
  }

  /** 建立加密客户端：device_id 重建 → initRustCrypto → sync PREPARED → 自动入房。 */
  async connect(creds: LiveCredentials, password: string, displayName?: string): Promise<LiveIdentity> {
    await MatrixService.loadWasm();
    this.stop();
    matrixServiceStatus.mode = "live";
    matrixServiceStatus.phase = "crypto";
    matrixServiceStatus.error = "";

    const prefix = `aether-live-${creds.userId.replace(/[^a-z0-9]/gi, "_")}`;
    const storageKey = await deriveStorageKey(creds.userId, password);
    const client = sdk.createClient({
      baseUrl: window.location.origin,
      userId: creds.userId,
      deviceId: creds.deviceId,
      accessToken: creds.accessToken,
    });
    await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: prefix, storageKey });
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
    const client = this.requireClient();
    const content: Record<string, unknown> = { msgtype: sdk.MsgType.Text, body };
    if (replyToId) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyToId } };

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
      attachment = {
        name: String(content.filename ?? content.body ?? "附件"),
        size: humanSize(content.info?.size),
        mime: String(content.info?.mimetype ?? ""),
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
