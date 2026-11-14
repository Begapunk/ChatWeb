<script setup lang="ts">
import { computed, ref } from "vue";
import type { Message } from "../types";
import { matrixServiceStatus } from "../services/matrix";

const props = defineProps<{
  replyTo?: Message;
  replyToName?: string;
  enterToSend: boolean;
}>();

const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "attach", kind: "image" | "file"): void;
  (e: "voice"): void;
  (e: "cancelReply"): void;
}>();

const draft = ref<string>("");
const isLive = computed<boolean>(() => matrixServiceStatus.mode === "live");

function submit(): void {
  const text = draft.value.trim();
  if (!text) return;
  emit("send", text);
  draft.value = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey && props.enterToSend) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <div class="composer">
    <div v-if="replyTo" class="composer__reply">
      <div class="composer__replytext">
        <span class="composer__replyname">回复 {{ replyToName ?? "消息" }}</span>
        <span class="composer__replybody">
          {{ replyTo.revoked ? "消息已撤回" : replyTo.body || replyTo.attachment?.name || "附件" }}
        </span>
      </div>
      <button type="button" class="composer__cancel" aria-label="取消回复" @click="emit('cancelReply')">×</button>
    </div>

    <div class="composer__row">
      <div class="composer__tools">
        <button type="button" @click="emit('attach', 'image')">图片</button>
        <button type="button" @click="emit('attach', 'file')">文件</button>
        <button type="button" @click="emit('voice')">语音</button>
      </div>
      <textarea
        v-model="draft"
        class="composer__input"
        rows="1"
        placeholder="输入消息…"
        aria-label="消息内容"
        @keydown="onKeydown"
      ></textarea>
      <button
        type="button"
        class="composer__send"
        :disabled="!draft.trim()"
        @click="submit"
      >
        发送
      </button>
    </div>

    <p class="composer__note">
      {{ isLive ? "真实链路 · 消息经 Megolm 端到端加密后发送" : "演示模式 · 消息不会离开此浏览器，刷新即清空" }}
    </p>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid var(--ae-border);
  background: var(--ae-bg-elev);
  padding: 10px 14px calc(10px + var(--ae-safe-bottom));
}

.composer__reply {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border-left: 2px solid var(--ae-accent);
  border-radius: 6px;
  background: var(--ae-surface);
}

.composer__replytext {
  flex: 1;
  min-width: 0;
}

.composer__replyname {
  display: block;
  color: var(--ae-accent);
  font-size: 12px;
  font-weight: 600;
}

.composer__replybody {
  display: block;
  color: var(--ae-text-muted);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__cancel {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: var(--ae-surface-hover);
  color: var(--ae-text-muted);
  font-size: 17px;
  line-height: 1;
}

.composer__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.composer__tools {
  display: flex;
  gap: 3px;
  flex: none;
}

.composer__tools button {
  min-height: 34px;
  padding: 0 7px;
  border: 1px solid var(--ae-border);
  border-radius: 9px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 11.5px;
}

.composer__tools button:hover {
  color: var(--ae-text);
  border-color: var(--ae-border-strong);
}

.composer__input {
  flex: 1;
  min-width: 0;
  max-height: 110px;
  padding: 9px 12px;
  border: 1px solid var(--ae-border);
  border-radius: 14px;
  background: var(--ae-bg);
  resize: none;
  font-size: 14.5px;
  line-height: 1.5;
}

.composer__input:focus {
  border-color: var(--ae-accent);
  outline: none;
}

.composer__send {
  flex: none;
  min-height: 38px;
  padding: 0 15px;
  border: none;
  border-radius: 12px;
  background: var(--ae-accent);
  color: var(--ae-accent-contrast);
  font-size: 14px;
  font-weight: 700;
}

.composer__send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer__note {
  margin-top: 6px;
  color: var(--ae-text-subtle);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 420px) {
  .composer__tools button {
    padding: 0 5px;
    font-size: 11px;
  }
}
</style>
