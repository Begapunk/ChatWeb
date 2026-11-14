<script setup lang="ts">
import { useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { formatListTime } from "../data/demo";
import Avatar from "../components/Avatar.vue";
import type { Conversation } from "../types";

const router = useRouter();
const chat = useChatStore();

function preview(roomId: string): string {
  const msg = chat.lastMessage(roomId);
  if (!msg) return "暂无消息";
  if (msg.revoked) return "消息已撤回";
  const who = msg.senderId === chat.meId ? "我" : chat.contactOf(msg.senderId).name;
  const body = msg.kind === "text"
    ? msg.body
    : msg.attachment?.name ?? (msg.kind === "voice" ? "语音消息" : "附件");
  return `${who}：${body}`;
}

function avatarFor(conv: Conversation): { name: string; initials: string; color: string; online: boolean } {
  if (conv.kind === "group") {
    return { name: conv.name, initials: conv.name.slice(0, 1), color: "#4fd1c5", online: false };
  }
  const other = conv.memberIds.find((id) => id !== chat.meId) ?? chat.meId;
  const c = chat.contactOf(other);
  return { name: c.name, initials: c.initials, color: c.color, online: c.online };
}

function open(roomId: string): void {
  chat.openRoom(roomId);
  void router.push({ name: "chat", params: { roomId } });
}
</script>

<template>
  <section class="convs">
    <div class="convs__head">
      <div>
        <h1>消息</h1>
        <p class="convs__sub">
          <span v-if="chat.isLive" class="convs__live">真实 E2EE</span>
          <span v-else class="convs__demo">演示模式</span>
          {{ chat.conversations.length }} 个会话
          <span v-if="chat.unreadTotal > 0"> · {{ chat.unreadTotal }} 条未读</span>
        </p>
      </div>
      <button type="button" class="convs__search" @click="router.push('/search')">搜索</button>
    </div>

    <div v-if="!chat.conversations.length" class="convs__empty">
      <strong v-if="chat.isLive">正在等待房间邀请</strong>
      <strong v-else>暂无会话</strong>
      <p v-if="chat.isLive">
        邀请服务会在注册后自动把你加入固定加密房间，通常几秒内到达；页面会自动刷新并接受邀请。
      </p>
    </div>

    <ul v-else class="convs__list">
      <li v-for="conv in chat.sortedConversations" :key="conv.id">
        <button type="button" class="item" :data-room-id="conv.id" @click="open(conv.id)">
          <Avatar
            :name="avatarFor(conv).name"
            :initials="avatarFor(conv).initials"
            :color="avatarFor(conv).color"
            :online="avatarFor(conv).online"
            :size="48"
          />
          <span class="item__body">
            <span class="item__top">
              <span class="item__name">
                {{ conv.name }}
                <span v-if="conv.kind === 'group'" class="item__tag">群聊</span>
                <span v-if="conv.pinned" class="item__tag item__tag--pin">置顶</span>
                <span v-if="conv.muted" class="item__tag">静音</span>
              </span>
              <span class="item__time">{{ formatListTime(chat.lastMessage(conv.id)?.ts ?? Date.now()) }}</span>
            </span>
            <span class="item__bottom">
              <span class="item__preview">{{ preview(conv.id) }}</span>
              <span v-if="conv.unread > 0" class="item__unread">{{ conv.unread }}</span>
            </span>
          </span>
        </button>
      </li>
    </ul>

    <p class="convs__foot">
      {{
        chat.isLive
          ? "消息经 Matrix Megolm 端到端加密，服务器只存密文。"
          : "点击任意会话进入聊天，试试发送、回复、撤回与表情。"
      }}
    </p>
    <p v-if="chat.liveError" class="convs__error" role="alert">{{ chat.liveError }}</p>
  </section>
</template>

<style scoped>
.convs__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 2px 18px;
}

.convs h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.convs__sub {
  margin-top: 3px;
  color: var(--ae-text-subtle);
  font-size: 12.5px;
}

.convs__live,
.convs__demo {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
}

.convs__live {
  border: 1px solid color-mix(in srgb, var(--ae-accent) 45%, transparent);
  background: color-mix(in srgb, var(--ae-accent) 12%, transparent);
  color: var(--ae-accent);
}

.convs__demo {
  border: 1px solid color-mix(in srgb, var(--ae-warn) 45%, transparent);
  background: color-mix(in srgb, var(--ae-warn) 12%, transparent);
  color: var(--ae-warn);
}

.convs__empty {
  padding: 28px 18px;
  border: 1px dashed var(--ae-border-strong);
  border-radius: var(--ae-radius-sm);
  text-align: center;
}

.convs__empty strong {
  font-size: 15px;
}

.convs__empty p {
  margin-top: 8px;
  color: var(--ae-text-muted);
  font-size: 12.5px;
  line-height: 1.65;
}

.convs__error {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: var(--ae-radius-sm);
  background: color-mix(in srgb, var(--ae-warn) 12%, transparent);
  color: var(--ae-warn);
  font-size: 12.5px;
}

.convs__search {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--ae-border);
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 13px;
}

.convs__search:hover {
  color: var(--ae-text);
  border-color: var(--ae-border-strong);
}

.convs__list {
  border: 1px solid var(--ae-border);
  border-radius: var(--ae-radius);
  background: var(--ae-bg-elev);
  overflow: hidden;
}

.convs__list li + li {
  border-top: 1px solid var(--ae-border);
}

.item {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 76px;
  padding: 12px 15px;
  border: none;
  background: transparent;
  text-align: left;
}

.item:hover {
  background: var(--ae-surface-hover);
}

.item__body {
  flex: 1;
  min-width: 0;
}

.item__top,
.item__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.item__name {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 650;
}

.item__tag {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--ae-border);
  border-radius: 5px;
  color: var(--ae-text-subtle);
  font-size: 10px;
  font-weight: 500;
}

.item__tag--pin {
  color: var(--ae-accent);
  border-color: color-mix(in srgb, var(--ae-accent) 40%, transparent);
}

.item__time {
  flex: none;
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}

.item__bottom {
  margin-top: 4px;
}

.item__preview {
  flex: 1;
  min-width: 0;
  color: var(--ae-text-muted);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item__unread {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ae-accent);
  color: var(--ae-accent-contrast);
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}

.convs__foot {
  margin-top: 16px;
  color: var(--ae-text-subtle);
  font-size: 12px;
  text-align: center;
}
</style>
