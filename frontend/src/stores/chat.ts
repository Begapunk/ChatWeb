import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  ME_ID,
  demoContacts,
  demoConversations,
  demoDevices,
  demoReplies,
  buildDemoMessages,
} from "../data/demo";
import {
  MatrixService,
  matrixService,
  matrixServiceStatus,
  securityState,
  clearRecoveryKey,
  resetLiveStatus,
  clearLiveSession,
} from "../services/matrix";
import { dataLossWarning, type SecurityDevice, type SecurityStatus } from "../services/security";
import type { LiveCredentials } from "../services/matrix";
import type {
  Attachment,
  Contact,
  Conversation,
  DemoSettings,
  DeviceItem,
  DeliveryStatus,
  Message,
  MessageKind,
} from "../types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

const meFallback: Contact = {
  id: ME_ID, name: "我", initials: "我", color: "#4fd1c5", online: true, verified: true,
};

export interface LiveConnectOptions {
  homeserver: string;
  username: string;
  password: string;
  recoveryKey?: string;
}

/**
 * 双数据源状态层：
 *  - demo：全部数据在内存，刷新即重置，不联网、不涉及密钥（界面演示）。
 *  - live：由 MatrixService 驱动，消息来自真实 Synapse 的 Megolm 密文解密结果。
 * 视图层 API 保持一致；live 模式下未实现的能力会显式给出提示，不插入假数据。
 */
export const useChatStore = defineStore("chat", () => {
  const loggedIn = ref<boolean>(true);
  const displayName = ref<string>("你");
  const contacts = ref<Contact[]>([...demoContacts]);
  const conversations = ref<Conversation[]>([...demoConversations]);
  const messages = ref<Record<string, Message[]>>(buildDemoMessages(Date.now()));
  const devices = ref<DeviceItem[]>([...demoDevices]);
  const activeRoomId = ref<string>(demoConversations[0].id);
  const replyToId = ref<string | null>(null);
  const searchQuery = ref<string>("");
  const settings = ref<DemoSettings>({
    notifications: true,
    readReceipts: true,
    autoDownload: false,
    enterToSend: true,
  });

  const liveBusy = ref<boolean>(false);
  const liveError = ref<string>("");
  const liveNotice = ref<string>("");
  const roomOverrides = ref<Record<string, Partial<Conversation>>>({});
  let unsubscribe: (() => void) | null = null;

  const isLive = computed<boolean>(() => matrixServiceStatus.mode === "live");
  const meId = computed<string>(() =>
    isLive.value && matrixServiceStatus.userId ? matrixServiceStatus.userId : ME_ID,
  );

  // M3：live 模式的设备列表来自真实 Matrix device keys，绝不混入演示假设备。
  const securityDevices = computed<SecurityDevice[]>(
    () => (isLive.value ? securityState.overview?.devices ?? [] : []),
  );
  const securityStatus = computed<SecurityStatus | null>(
    () => (isLive.value ? securityState.overview?.status ?? null : null),
  );
  const dataWarning = computed<string>(() => {
    const s = securityStatus.value;
    return s ? dataLossWarning(s) : "";
  });

  function lastMessage(roomId: string): Message | undefined {
    const list = messages.value[roomId] ?? [];
    return list.length > 0 ? list[list.length - 1] : undefined;
  }

  const sortedConversations = computed<Conversation[]>(() =>
    [...conversations.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const tb = lastMessage(b.id)?.ts ?? 0;
      const ta = lastMessage(a.id)?.ts ?? 0;
      return tb - ta;
    }),
  );

  const unreadTotal = computed<number>(() =>
    conversations.value.reduce((sum, c) => sum + c.unread, 0),
  );
  const activeConversation = computed<Conversation | undefined>(() =>
    conversations.value.find((c) => c.id === activeRoomId.value),
  );
  const activeMessages = computed<Message[]>(() => messages.value[activeRoomId.value] ?? []);
  const replyToMessage = computed<Message | undefined>(() =>
    replyToId.value ? activeMessages.value.find((m) => m.id === replyToId.value) : undefined,
  );
  const searchResults = computed<Message[]>(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return [];
    return Object.values(messages.value)
      .flat()
      .filter((m) =>
        !m.revoked &&
        (m.body.toLowerCase().includes(q) || (m.attachment?.name.toLowerCase().includes(q) ?? false)),
      )
      .sort((a, b) => b.ts - a.ts);
  });

  function roomOf(roomId: string): Conversation | undefined {
    return conversations.value.find((c) => c.id === roomId);
  }

  function contactOf(id: string): Contact {
    if (id === meId.value) {
      const name = displayName.value;
      return { ...meFallback, id, name, initials: name.slice(0, 1) };
    }
    if (isLive.value) return matrixService.contactOf(id);
    return contacts.value.find((c) => c.id === id) ?? {
      ...meFallback, id, name: id.split(":")[0].replace("@", ""), initials: "?", color: "#8b9cf7",
    };
  }

  function messageById(id: string): Message | undefined {
    return Object.values(messages.value).flat().find((m) => m.id === id);
  }

  function patchRoom(roomId: string, patch: Partial<Conversation>): void {
    conversations.value = conversations.value.map((c) => (c.id === roomId ? { ...c, ...patch } : c));
  }

  function updateStatus(roomId: string, msgId: string, status: DeliveryStatus): void {
    const list = messages.value[roomId];
    if (!list) return;
    messages.value[roomId] = list.map((m) => (m.id === msgId ? { ...m, status } : m));
  }

  function markRead(roomId: string): void {
    const conv = roomOf(roomId);
    if (conv && conv.unread > 0) patchRoom(roomId, { unread: 0 });
  }

  function openRoom(roomId: string): void {
    activeRoomId.value = roomId;
    replyToId.value = null;
    markRead(roomId);
    if (isLive.value) void matrixService.markRead(roomId);
  }

  /** 从真实 MatrixService 拉取房间与时间线，合并客户端本地覆盖（置顶/静音）。 */
  function syncFromLive(): void {
    if (!isLive.value) return;
    const convs = matrixService.getConversations().map((c) => ({ ...c, ...roomOverrides.value[c.id] }));
    conversations.value = convs;
    const next: Record<string, Message[]> = {};
    for (const c of convs) next[c.id] = matrixService.getMessages(c.id);
    messages.value = next;
    if (!convs.some((c) => c.id === activeRoomId.value)) {
      activeRoomId.value = convs[0]?.id ?? "";
    }
  }

  // ---- 演示模式行为 ----
  function scheduleReply(roomId: string): void {
    const conv = roomOf(roomId);
    if (!conv) return;
    const others = conv.memberIds.filter((id) => id !== ME_ID);
    if (others.length === 0) return;
    const sender = others[Math.floor(Math.random() * others.length)];
    const text = demoReplies[Math.floor(Math.random() * demoReplies.length)];
    window.setTimeout(() => {
      const reply: Message = {
        id: nextId("m"), roomId, senderId: sender, kind: "text", body: text,
        ts: Date.now(), status: "read",
      };
      messages.value[roomId] = [...(messages.value[roomId] ?? []), reply];
      if (activeRoomId.value !== roomId) {
        patchRoom(roomId, { unread: (roomOf(roomId)?.unread ?? 0) + 1 });
      }
    }, 1300);
  }

  // ---- 消息动作（双数据源） ----
  function sendText(raw: string): void {
    const body = raw.trim();
    const roomId = activeRoomId.value;
    if (!body || !roomId) return;

    if (isLive.value) {
      const reply = replyToId.value ?? undefined;
      replyToId.value = null;
      liveError.value = "";
      void matrixService.sendText(roomId, body, reply).catch((err: unknown) => {
        liveError.value = err instanceof Error ? err.message : String(err);
      });
      return;
    }

    const msg: Message = {
      id: nextId("m"), roomId, senderId: ME_ID, kind: "text", body,
      ts: Date.now(), status: "sending",
      ...(replyToId.value ? { replyTo: replyToId.value } : {}),
    };
    messages.value[roomId] = [...(messages.value[roomId] ?? []), msg];
    replyToId.value = null;
    window.setTimeout(() => updateStatus(roomId, msg.id, "sent"), 280);
    window.setTimeout(() => updateStatus(roomId, msg.id, "delivered"), 760);
    if (settings.value.readReceipts) {
      window.setTimeout(() => updateStatus(roomId, msg.id, "read"), 1500);
    }
    scheduleReply(roomId);
  }

  function sendAttachment(kind: MessageKind, input: Attachment | File, durationSec?: number): void {
    if (isLive.value) {
      if (!(input instanceof File) || kind === "text") {
        liveError.value = "请选择要加密发送的真实文件";
        return;
      }
      liveError.value = "";
      liveNotice.value = "正在本机加密并上传附件…";
      void matrixService
        .sendAttachment(activeRoomId.value, input, kind, durationSec)
        .then(() => {
          liveNotice.value = "附件已作为 Matrix EncryptedFile 发送；服务器仅收到密文";
        })
        .catch((err: unknown) => {
          liveNotice.value = "";
          liveError.value = err instanceof Error ? err.message : String(err);
        });
      return;
    }
    if (input instanceof File) {
      input = { name: input.name, size: `${Math.ceil(input.size / 1024)} KB`, mime: input.type };
    }
    const attachment = input;
    const roomId = activeRoomId.value;
    if (!roomId) return;
    const msg: Message = {
      id: nextId("m"), roomId, senderId: ME_ID, kind, body: "", ts: Date.now(),
      status: "sending", attachment, ...(durationSec ? { durationSec } : {}),
    };
    messages.value[roomId] = [...(messages.value[roomId] ?? []), msg];
    window.setTimeout(() => updateStatus(roomId, msg.id, "sent"), 280);
    window.setTimeout(() => updateStatus(roomId, msg.id, "read"), 1200);
  }

  async function openAttachment(msgId: string): Promise<void> {
    const message = messageById(msgId);
    if (!message?.attachment) return;
    if (!isLive.value) {
      liveNotice.value = "演示附件没有真实文件内容";
      return;
    }
    liveError.value = "";
    liveNotice.value = "正在下载、校验并解密附件…";
    try {
      const blob = await matrixService.downloadAttachment(message);
      const url = URL.createObjectURL(blob);
      if (message.kind === "voice") {
        const audio = new Audio(url);
        audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
        liveNotice.value = "语音完整性校验通过，正在本机播放";
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = message.attachment.name || "attachment";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      liveNotice.value = "附件完整性校验通过，已在本机解密";
    } catch (err) {
      liveNotice.value = "";
      liveError.value = err instanceof Error ? err.message : String(err);
    }
  }

  function revoke(msgId: string): void {
    const roomId = activeRoomId.value;
    if (isLive.value) {
      void matrixService.revoke(roomId, msgId).catch((err: unknown) => {
        liveError.value = err instanceof Error ? err.message : String(err);
      });
      return;
    }
    const list = messages.value[roomId];
    if (!list) return;
    messages.value[roomId] = list.map((m) =>
      m.id === msgId && m.senderId === ME_ID ? { ...m, revoked: true, body: "", reactions: [] } : m,
    );
    if (replyToId.value === msgId) replyToId.value = null;
  }

  function setReplyTo(msgId: string | null): void {
    replyToId.value = msgId;
  }

  function addReaction(msgId: string, emoji: string): void {
    if (isLive.value) {
      liveNotice.value = "真实链路的表情回应属于 M4 范围，当前未实现。";
      return;
    }
    const roomId = activeRoomId.value;
    const list = messages.value[roomId];
    if (!list) return;
    messages.value[roomId] = list.map((m) => {
      if (m.id !== msgId || m.revoked) return m;
      const reactions = [...(m.reactions ?? [])];
      const idx = reactions.findIndex((r) => r.emoji === emoji);
      if (idx >= 0) {
        const cur = reactions[idx];
        const next = { ...cur, mine: !cur.mine, count: cur.count + (cur.mine ? -1 : 1) };
        if (next.count <= 0) reactions.splice(idx, 1);
        else reactions[idx] = next;
      } else {
        reactions.push({ emoji, count: 1, mine: true });
      }
      return { ...m, reactions };
    });
  }

  function togglePin(roomId: string): void {
    const conv = roomOf(roomId);
    if (!conv) return;
    const pinned = !conv.pinned;
    if (isLive.value) roomOverrides.value = { ...roomOverrides.value, [roomId]: { ...roomOverrides.value[roomId], pinned } };
    patchRoom(roomId, { pinned });
  }

  function toggleMute(roomId: string): void {
    const conv = roomOf(roomId);
    if (!conv) return;
    const muted = !conv.muted;
    if (isLive.value) roomOverrides.value = { ...roomOverrides.value, [roomId]: { ...roomOverrides.value[roomId], muted } };
    patchRoom(roomId, { muted });
  }

  function verifyDevice(id: string): void {
    if (isLive.value) {
      // M3：改为请求真实 SAS（emoji）验证，由安全中心的验证面板完成比对。
      void matrixService.requestVerification(id).catch((err: unknown) => {
        liveError.value = err instanceof Error ? err.message : String(err);
      });
      return;
    }
    devices.value = devices.value.map((d) => (d.id === id ? { ...d, verified: true } : d));
  }

  function setSetting<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]): void {
    settings.value = { ...settings.value, [key]: value };
  }

  // ---- 模式切换 ----
  function loginDemo(name: string): void {
    displayName.value = name.trim() || "你";
    loggedIn.value = true;
  }

  /** 连接用户指定的 Matrix homeserver：口令登录 → Rust Crypto → sync。 */
  async function connectLive(options: LiveConnectOptions): Promise<void> {
    liveBusy.value = true;
    liveError.value = "";
    liveNotice.value = "";
    try {
      const creds: LiveCredentials = await MatrixService.login(
        options.homeserver,
        options.username,
        options.password,
      );
      const identity = await matrixService.connect(
        creds,
        options.homeserver,
        options.password,
        options.username,
        options.recoveryKey,
      );
      displayName.value = identity.displayName;
      loggedIn.value = true;
      roomOverrides.value = {};
      unsubscribe?.();
      unsubscribe = matrixService.onChange(syncFromLive);
      syncFromLive();
      // 建立连接后立即取一次真实安全状态，避免安全中心短暂显示为空。
      void matrixService.refreshSecurity().catch(() => {});
      activeRoomId.value = conversations.value[0]?.id ?? "";
    } catch (err) {
      matrixService.stop();
      resetLiveStatus();
      liveError.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      liveBusy.value = false;
    }
  }

  // ---- M3 安全中心操作（仅 live 有效；失败信息回写 securityState.error） ----
  async function setupKeyBackup(): Promise<string> {
    if (!isLive.value) throw new Error("演示模式不产生密钥，请连接真实服务器");
    return matrixService.setupKeyBackup();
  }

  async function restoreWithRecoveryKey(key: string): Promise<void> {
    if (!isLive.value) throw new Error("演示模式无需恢复密钥，请连接真实服务器");
    const result = await matrixService.reconnectWithRecoveryKey(key);
    syncFromLive();
    liveNotice.value = `已从密钥备份恢复 ${result.imported} 条会话密钥，历史消息正在重新解密`;
  }

  async function refreshSecurity(): Promise<void> {
    if (!isLive.value) return;
    await matrixService.refreshSecurity();
  }

  async function setDeviceTrust(deviceId: string, verified: boolean): Promise<void> {
    await matrixService.setDeviceTrust(deviceId, verified);
  }

  async function crossSignDevice(deviceId: string): Promise<void> {
    await matrixService.crossSignDevice(deviceId);
  }

  async function revokeDevice(deviceId: string): Promise<void> {
    await matrixService.revokeDevice(deviceId);
  }

  async function startVerification(deviceId: string): Promise<void> {
    await matrixService.requestVerification(deviceId);
  }

  async function acceptVerification(): Promise<void> {
    await matrixService.acceptIncomingVerification();
  }

  async function confirmSas(): Promise<void> {
    await matrixService.confirmSas();
  }

  function mismatchSas(): void {
    matrixService.mismatchSas();
  }

  function cancelVerification(): void {
    matrixService.cancelVerification();
  }

  /** 断开真实链路并回到演示模式（不会删除浏览器内的加密存储，但清除内存口令/4S 私钥）。 */
  function disconnectLive(): void {
    unsubscribe?.();
    unsubscribe = null;
    matrixService.stop();
    matrixService.forgetSession();
    resetLiveStatus();
    clearLiveSession();
    clearRecoveryKey();
    liveError.value = "";
    liveNotice.value = "";
    resetDemo();
  }

  function logout(): void {
    unsubscribe?.();
    unsubscribe = null;
    matrixService.stop();
    matrixService.forgetSession();
    resetLiveStatus();
    clearLiveSession();
    clearRecoveryKey();
    loggedIn.value = false;
  }

  function resetDemo(): void {
    messages.value = buildDemoMessages(Date.now());
    conversations.value = [...demoConversations];
    devices.value = [...demoDevices];
    contacts.value = [...demoContacts];
    activeRoomId.value = demoConversations[0].id;
    replyToId.value = null;
    searchQuery.value = "";
    roomOverrides.value = {};
  }

  return {
    loggedIn, displayName, contacts, conversations, messages, devices,
    activeRoomId, replyToId, searchQuery, settings,
    liveBusy, liveError, liveNotice, isLive, meId,
    securityState, securityDevices, securityStatus, dataWarning,
    sortedConversations, unreadTotal, activeConversation, activeMessages,
    replyToMessage, searchResults,
    lastMessage, roomOf, contactOf, messageById, markRead, openRoom,
    sendText, sendAttachment, openAttachment, revoke, setReplyTo, addReaction,
    togglePin, toggleMute, verifyDevice, setSetting,
    loginDemo, connectLive, disconnectLive, logout, resetDemo, syncFromLive,
    setupKeyBackup, restoreWithRecoveryKey, refreshSecurity, clearRecoveryKey,
    setDeviceTrust, crossSignDevice, revokeDevice,
    startVerification, acceptVerification, confirmSas, mismatchSas, cancelVerification,
  };
});
