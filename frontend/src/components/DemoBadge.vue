<script setup lang="ts">
import { computed, ref } from "vue";
import { matrixServiceStatus } from "../services/matrix";

const open = ref<boolean>(false);
const isLive = computed<boolean>(() => matrixServiceStatus.mode === "live");
</script>

<template>
  <div class="demo">
    <button
      class="demo__chip"
      :class="{ 'demo__chip--live': isLive }"
      type="button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="demo__dot" aria-hidden="true"></span>
      {{ isLive ? "真实 E2EE" : "演示模式" }}
      <span class="demo__hint">{{ open ? "收起" : "说明" }}</span>
    </button>

    <div v-if="open" class="demo__panel" role="note">
      <template v-if="isLive">
        <strong>已连接真实 Synapse</strong>
        <p>{{ matrixServiceStatus.reason }}</p>
        <p>
          消息在设备端由 Megolm 加密，服务器只存 m.room.encrypted 密文。
          当前设备 <span class="ae-mono">{{ matrixServiceStatus.deviceId || "—" }}</span>；
          密钥由用户口令派生后加密保存在浏览器 IndexedDB。
        </p>
      </template>
      <template v-else>
        <strong>这是界面演示，不是真实加密通讯</strong>
        <p>{{ matrixServiceStatus.reason }}。消息只存在浏览器内存中，刷新即重置；
          没有服务器、没有密钥、没有端到端加密。</p>
        <p>如需真实链路，请到「设置 → 关于」退出演示后，用邀请码连接真实服务器。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.demo {
  position: relative;
}

.demo__chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--ae-warn) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ae-warn) 12%, transparent);
  color: var(--ae-warn);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.demo__chip--live {
  border-color: color-mix(in srgb, var(--ae-accent) 45%, transparent);
  background: color-mix(in srgb, var(--ae-accent) 12%, transparent);
  color: var(--ae-accent);
}

.demo__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.demo__hint {
  color: var(--ae-text-subtle);
  font-weight: 500;
}

.demo__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 60;
  width: min(330px, calc(100vw - 40px));
  padding: 14px 16px;
  border: 1px solid var(--ae-border-strong);
  border-radius: var(--ae-radius-sm);
  background: var(--ae-bg-elev-2);
  box-shadow: var(--ae-shadow);
  font-size: 13px;
  line-height: 1.65;
}

.demo__panel strong {
  display: block;
  margin-bottom: 6px;
  color: var(--ae-warn);
}

.demo__chip--live ~ .demo__panel strong {
  color: var(--ae-accent);
}

.demo__panel p {
  margin-top: 6px;
  color: var(--ae-text-muted);
}
</style>
