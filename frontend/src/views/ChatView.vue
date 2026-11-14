<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { ME_ID, formatDayLabel } from "../data/demo";
import Avatar from "../components/Avatar.vue";
import MessageBubble from "../components/MessageBubble.vue";
import Composer from "../components/Composer.vue";
import type { Message } from "../types";

const route = useRoute();
const router = useRouter();
const chat = useChatStore();

const scroller = ref<HTMLElement | null>(null);
const menuOpen = ref<boolean>(false);

const roomId = computed<string>(() => String(route.params.roomId ?? ""));
const conv = computed(() => chat.roomOf(roomId.value));
const title = computed<string>(() => conv.value?.name ?? "会话");

const subtitle = computed<string>(() => {
  const c = conv.value;
  if (!c) return "";
  if (c.kind === "group") return `${c.memberIds.length} 位成员 · 邀请制`;
  const other = c.memberIds.find((id) => id !== ME_ID);
  const contact = other ? chat.contactOf(other) : undefined;
  if (!contact) return "";
  return `${contact.online ? "在线" : "离线"}${contact.verified ? " · 已验证设备" : ""}`;
});

const headerAvatar = computed(() => {
  const c = conv.value;
  if (!c) return { name: "?", initials: "?", color: "#4fd1c5" };
  if (c.kind === "group") return { name: c.name, initials: c.name.slice(0, 1), color: "#4fd1c5" };
  const other = c.memberIds.find((id) => id !== ME_ID) ?? ME_ID;
  const contact = chat.contactOf(other);
  return { name: contact.name, initials: contact.initials, color: contact.color };
});

interface DayGroup {
  day: string;
  items: Message[];
}

const groups = computed<DayGroup[]>(() => {
  const out: DayGroup[] = [];
  for (const msg of chat.activeMessages) {
    const day = formatDayLabel(msg.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(msg);
    else out.push({ day, items: [msg] });
  }
  return out;
});

const composerReplyName = computed<string>(() => {
  const m = chat.replyToMessage;
  return m ? chat.contactOf(m.senderId).name : "";
});

function senderFor(msg: Message) {
  const c = chat.contactOf(msg.senderId);
  return { name: c.name, color: c.color, initials: c.initials };
}

function replyFor(msg: Message): Message | undefined {
  return msg.replyTo ? chat.messageById(msg.replyTo) : undefined;
}

function replyName(msg: Message): string {
  if (!msg.replyTo) return "";
  const target = chat.messageById(msg.replyTo);
  return target ? chat.contactOf(target.senderId).name : "";
}

function showAvatar(msg: Message, index: number, items: Message[]): boolean {
  const prev = items[index - 1];
  return !prev || prev.senderId !== msg.senderId || msg.ts - prev.ts > 5 * 60_000;
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  chat.openRoom(roomId.value);
  void scrollToBottom();
});
watch(roomId, (id) => {
  chat.openRoom(id);
  void scrollToBottom();
});
watch(() => chat.activeMessages.length, () => { void scrollToBottom(); });

function onAttach(kind: "image" | "file"): void {
  const isImage = kind === "image";
  chat.sendAttachment(kind, {
    name: isImage ? "示例图片.jpg" : "示例文档.pdf",
    size: isImage ? "726 KB" : "1.2 MB",
    mime: isImage ? "image/jpeg" : "application/pdf",
  });
}

function onVoice(): void {
  chat.sendAttachment("voice", { name: "语音消息", size: "12s", mime: "audio/ogg" }, 12);
}

function onReact(id: string, emoji: string): void {
  chat.addReaction(id, emoji);
}
</script>

<template>
  <section class="chat">
    <header class="chat__head">
      <button type="button" class="chat__back" aria-label="返回会话列表" @click="router.push('/')">‹</button>
      <Avatar
        :name="headerAvatar.name"
        :initials="headerAvatar.initials"
        :color="headerAvatar.color"
        :size="36"
      />
      <div class="chat__title">
        <strong>{{ title }}</strong>
        <span>{{ subtitle }}</span>
      </div>
      <button type="button" class="chat__more" aria-label="会话选项" @click="menuOpen = !menuOpen">···</button>
      <div v-if="menuOpen" class="chat__menu">
        <button type="button" @click="chat.togglePin(roomId); menuOpen = false">
          {{ conv?.pinned ? "取消置顶" : "置顶会话" }}
        </button>
        <button type="button" @click="chat.toggleMute(roomId); menuOpen = false">
          {{ conv?.muted ? "取消静音" : "静音会话" }}
        </button>
      </div>
    </header>

    <div class="chat__notice">
      <span>演示模式 · 消息为本地模拟，未联网、未加密</span>
      <span class="chat__pill">E2EE 未接线</span>
    </div>

    <div ref="scroller" class="chat__scroll">
      <div v-for="group in groups" :key="group.day">
        <div class="chat__day"><span>{{ group.day }}</span></div>
        <MessageBubble
          v-for="(msg, index) in group.items"
          :key="msg.id"
          :message="msg"
          :mine="msg.senderId === ME_ID"
          :sender-name="senderFor(msg).name"
          :sender-color="senderFor(msg).color"
          :sender-initials="senderFor(msg).initials"
          :show-avatar="showAvatar(msg, index, group.items)"
          :reply-to="replyFor(msg)"
          :reply-to-name="replyName(msg)"
          @reply="chat.setReplyTo"
          @revoke="chat.revoke"
          @react="onReact"
        />
      </div>
    </div>

    <Composer
      :reply-to="chat.replyToMessage"
      :reply-to-name="composerReplyName"
      :enter-to-send="chat.settings.enterToSend"
      @send="chat.sendText"
      @attach="onAttach"
      @voice="onVoice"
      @cancel-reply="chat.setReplyTo(null)"
    />
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--ae-bg);
}

.chat__head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  min-height: 58px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ae-border);
  background: var(--ae-bg-elev);
}

.chat__back {
  flex: none;
  width: 30px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 27px;
  line-height: 1;
}

.chat__back:hover {
  color: var(--ae-accent);
}

.chat__title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.chat__title strong {
  font-size: 15px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat__title span {
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}

.chat__more {
  flex: none;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 18px;
  letter-spacing: 1px;
}

.chat__more:hover {
  background: var(--ae-surface-hover);
}

.chat__menu {
  position: absolute;
  top: 52px;
  right: 12px;
  z-index: 40;
  min-width: 150px;
  padding: 5px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 11px;
  background: var(--ae-bg-elev-2);
  box-shadow: var(--ae-shadow);
}

.chat__menu button {
  display: block;
  width: 100%;
  padding: 9px 11px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ae-text);
  font-size: 13px;
  text-align: left;
}

.chat__menu button:hover {
  background: var(--ae-surface-hover);
}

.chat__notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: none;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--ae-warn) 10%, transparent);
  color: var(--ae-warn);
  font-size: 11.5px;
  text-align: center;
}

.chat__pill {
  flex: none;
  padding: 1px 7px;
  border: 1px solid color-mix(in srgb, var(--ae-warn) 45%, transparent);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.chat__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 14px 8px;
  overscroll-behavior: contain;
}

.chat__day {
  display: flex;
  justify-content: center;
  margin: 8px 0 16px;
}

.chat__day span {
  padding: 3px 12px;
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}
</style>
