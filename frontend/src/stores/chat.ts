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

/**
 * 演示模式状态层：所有数据都在内存，刷新即重置。
 * 不发起任何网络请求、不持久化消息、不涉及密钥 —— 这不是加密通讯实现。
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
    if (id === ME_ID) return { ...meFallback, name: displayName.value };
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
  }

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

  function sendText(raw: string): void {
    const body = raw.trim();
    const roomId = activeRoomId.value;
    if (!body || !roomId) return;
    const msg: Message = {
      id: nextId("m"), roomId, senderId: ME_ID, kind: "text", body,
      ts: Date.now(), status: "sending",
      ...(replyToId.value ? { replyTo: replyToId.value } : {}),
    };
    messages.value[roomId] = [...(messages.value[roomId] ?? []), msg];
    replyToId.value = null;
    // 分阶段模拟投递状态，便于试用时观察发送 / 已送达 / 已读。
    window.setTimeout(() => updateStatus(roomId, msg.id, "sent"), 280);
    window.setTimeout(() => updateStatus(roomId, msg.id, "delivered"), 760);
    if (settings.value.readReceipts) {
      window.setTimeout(() => updateStatus(roomId, msg.id, "read"), 1500);
    }
    scheduleReply(roomId);
  }

  function sendAttachment(kind: MessageKind, attachment: Attachment, durationSec?: number): void {
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

  function revoke(msgId: string): void {
    const roomId = activeRoomId.value;
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
    if (conv) patchRoom(roomId, { pinned: !conv.pinned });
  }

  function toggleMute(roomId: string): void {
    const conv = roomOf(roomId);
    if (conv) patchRoom(roomId, { muted: !conv.muted });
  }

  function verifyDevice(id: string): void {
    devices.value = devices.value.map((d) => (d.id === id ? { ...d, verified: true } : d));
  }

  function setSetting<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]): void {
    settings.value = { ...settings.value, [key]: value };
  }

  function loginDemo(name: string): void {
    displayName.value = name.trim() || "你";
    loggedIn.value = true;
  }

  function logout(): void {
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
  }

  return {
    loggedIn, displayName, contacts, conversations, messages, devices,
    activeRoomId, replyToId, searchQuery, settings,
    sortedConversations, unreadTotal, activeConversation, activeMessages,
    replyToMessage, searchResults,
    lastMessage, roomOf, contactOf, messageById, markRead, openRoom,
    sendText, sendAttachment, revoke, setReplyTo, addReaction,
    togglePin, toggleMute, verifyDevice, setSetting,
    loginDemo, logout, resetDemo,
  };
});
