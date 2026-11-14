<script setup lang="ts">
import { computed } from "vue";
import type { Message } from "../types";
import Avatar from "./Avatar.vue";
import { formatClock } from "../data/demo";

const props = defineProps<{
  message: Message;
  mine: boolean;
  senderName: string;
  senderColor: string;
  senderInitials: string;
  showAvatar: boolean;
  replyTo?: Message;
  replyToName?: string;
}>();

const emit = defineEmits<{
  (e: "reply", id: string): void;
  (e: "revoke", id: string): void;
  (e: "react", id: string, emoji: string): void;
}>();

const statusLabel = computed<string>(() => {
  switch (props.message.status) {
    case "sending": return "发送中";
    case "sent": return "已发送";
    case "delivered": return "已送达";
    case "read": return "已读";
    case "failed": return "发送失败";
    default: return "";
  }
});

const quoteBody = computed<string>(() => {
  if (!props.replyTo) return "";
  if (props.replyTo.revoked) return "消息已撤回";
  if (props.replyTo.kind === "text") return props.replyTo.body;
  return props.replyTo.attachment?.name ?? "附件消息";
});
</script>

<template>
  <div class="row" :class="{ 'row--mine': mine }">
    <div v-if="!mine" class="row__avatar">
      <Avatar
        v-if="showAvatar"
        :name="senderName"
        :initials="senderInitials"
        :color="senderColor"
        :size="32"
      />
    </div>

    <div class="row__body">
      <div v-if="!mine && showAvatar" class="row__name">{{ senderName }}</div>

      <div class="bubble" :class="{ 'bubble--mine': mine, 'bubble--revoked': message.revoked }">
        <div v-if="message.revoked" class="bubble__revoked">此消息已撤回</div>

        <template v-else>
          <div v-if="replyTo" class="quote">
            <span class="quote__name">{{ replyToName ?? "引用" }}</span>
            <span class="quote__body">{{ quoteBody }}</span>
          </div>

          <div v-if="message.kind === 'text'" class="bubble__text">{{ message.body }}</div>

          <div v-else-if="message.kind === 'image'" class="attach attach--image">
            <div class="attach__preview" aria-hidden="true">
              <span class="attach__sun"></span>
              <span class="attach__horizon"></span>
            </div>
            <div class="attach__foot">
              <span class="attach__name">{{ message.attachment?.name }}</span>
              <span class="attach__size">{{ message.attachment?.size }}</span>
            </div>
          </div>

          <div v-else-if="message.kind === 'file'" class="attach attach--file">
            <span class="attach__badge">文件</span>
            <div class="attach__fileinfo">
              <span class="attach__name">{{ message.attachment?.name }}</span>
              <span class="attach__size">{{ message.attachment?.size }}</span>
            </div>
          </div>

          <div v-else class="attach attach--voice">
            <span class="attach__play" aria-hidden="true"></span>
            <span class="attach__wave" aria-hidden="true">
              <i v-for="n in 18" :key="n" :style="{ height: `${6 + ((n * 7) % 15)}px` }"></i>
            </span>
            <span class="attach__size">{{ message.durationSec }}s</span>
          </div>
        </template>
      </div>

      <div class="meta">
        <span>{{ formatClock(message.ts) }}</span>
        <span v-if="mine && !message.revoked" class="meta__status">{{ statusLabel }}</span>
        <div v-if="!message.revoked" class="actions">
          <button type="button" @click="emit('reply', message.id)">回复</button>
          <button type="button" @click="emit('react', message.id, '✓')">✓</button>
          <button v-if="mine" type="button" @click="emit('revoke', message.id)">撤回</button>
        </div>
      </div>

      <div v-if="message.reactions?.length" class="reactions">
        <button
          v-for="r in message.reactions"
          :key="r.emoji"
          type="button"
          :class="{ 'reactions__on': r.mine }"
          @click="emit('react', message.id, r.emoji)"
        >
          {{ r.emoji }} {{ r.count }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.row--mine {
  flex-direction: row-reverse;
}

.row__avatar {
  width: 32px;
  flex: none;
  padding-top: 2px;
}

.row__body {
  max-width: min(78%, 460px);
  min-width: 0;
}

.row__name {
  margin: 0 0 4px 4px;
  color: var(--ae-text-subtle);
  font-size: 12px;
}

.bubble {
  padding: 10px 13px;
  border: 1px solid var(--ae-border);
  border-radius: 4px 16px 16px 16px;
  background: var(--ae-bg-elev);
  font-size: 14.5px;
  line-height: 1.6;
  overflow: hidden;
}

.bubble--mine {
  border-color: transparent;
  border-radius: 16px 4px 16px 16px;
  background: color-mix(in srgb, var(--ae-accent) 20%, var(--ae-bg-elev-2));
}

.bubble--revoked {
  background: transparent;
  border: 1px dashed var(--ae-border-strong);
}

.bubble__revoked {
  color: var(--ae-text-subtle);
  font-size: 13px;
  font-style: italic;
}

.bubble__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.quote {
  margin-bottom: 8px;
  padding: 6px 9px;
  border-left: 2px solid var(--ae-accent);
  border-radius: 3px;
  background: var(--ae-surface);
  font-size: 12.5px;
}

.quote__name {
  display: block;
  color: var(--ae-accent);
  font-weight: 600;
}

.quote__body {
  display: block;
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach {
  min-width: min(230px, 60vw);
}

.attach__preview {
  position: relative;
  height: 108px;
  border-radius: 9px;
  background: linear-gradient(160deg, #1d3b4a, #2a5c62 60%, #3d7469);
  overflow: hidden;
}

.attach__sun {
  position: absolute;
  right: 26px;
  top: 22px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #f0c98a;
  opacity: 0.85;
}

.attach__horizon {
  position: absolute;
  left: -10%;
  bottom: -30px;
  width: 120%;
  height: 60px;
  border-radius: 50% 50% 0 0;
  background: rgba(8, 22, 28, 0.55);
}

.attach__foot,
.attach--file,
.attach--voice {
  display: flex;
  align-items: center;
  gap: 9px;
}

.attach__foot {
  margin-top: 8px;
}

.attach__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach__size {
  color: var(--ae-text-subtle);
  font-size: 11.5px;
  white-space: nowrap;
}

.attach__badge {
  flex: none;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ae-accent-soft);
  color: var(--ae-accent);
  font-size: 11px;
  font-weight: 700;
}

.attach__fileinfo {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.attach__play {
  flex: none;
  width: 0;
  height: 0;
  border-left: 11px solid var(--ae-accent);
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
}

.attach__wave {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  height: 22px;
}

.attach__wave i {
  display: block;
  width: 3px;
  border-radius: 2px;
  background: var(--ae-accent);
  opacity: 0.7;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  padding: 0 4px;
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}

.row--mine .meta {
  flex-direction: row-reverse;
}

.meta__status {
  color: var(--ae-accent);
}

.actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s var(--ae-ease);
}

.row:hover .actions,
.actions:focus-within {
  opacity: 1;
}

.actions button {
  padding: 2px 6px;
  border: none;
  border-radius: 5px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 11px;
}

.actions button:hover {
  background: var(--ae-surface-hover);
  color: var(--ae-text);
}

.reactions {
  display: flex;
  gap: 5px;
  margin-top: 5px;
}

.reactions button {
  padding: 2px 8px;
  border: 1px solid var(--ae-border);
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 11.5px;
}

.reactions__on {
  border-color: var(--ae-accent) !important;
  color: var(--ae-accent) !important;
  background: var(--ae-accent-soft) !important;
}

@media (hover: none) {
  .actions {
    opacity: 1;
  }
}
</style>
