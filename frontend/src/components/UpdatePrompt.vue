<script setup lang="ts">
import { useRegisterSW } from "virtual:pwa-register/vue";

// registerType: "prompt"：由用户确认后再切换版本，避免加密同步中途被强制刷新。
const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW();

function dismiss(): void {
  offlineReady.value = false;
  needRefresh.value = false;
}
</script>

<template>
  <div v-if="offlineReady || needRefresh" class="prompt" role="status" aria-live="polite">
    <span class="prompt__text">{{ needRefresh ? "有新版本可用" : "已可离线使用" }}</span>
    <button
      v-if="needRefresh"
      class="ae-btn ae-btn--primary prompt__btn"
      type="button"
      @click="updateServiceWorker()"
    >
      更新
    </button>
    <button class="ae-btn prompt__btn" type="button" @click="dismiss">关闭</button>
  </div>
</template>

<style scoped>
.prompt {
  position: fixed;
  left: 50%;
  bottom: calc(20px + var(--ae-safe-bottom));
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(420px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid var(--ae-border-strong);
  border-radius: var(--ae-radius-sm);
  background: var(--ae-bg-elev-2);
  box-shadow: var(--ae-shadow);
}

.prompt__text {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.prompt__btn {
  min-height: 36px;
  padding: 0 12px;
  font-size: 13px;
}
</style>
