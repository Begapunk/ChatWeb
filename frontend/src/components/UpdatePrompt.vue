<script setup lang="ts">
import { onUnmounted, watch } from "vue";
import { useRegisterSW } from "virtual:pwa-register/vue";

// registerType: "prompt"：由用户确认后再切换版本，避免加密同步中途被强制刷新。
const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW();

// 「已可离线使用」只是信息性提示。做成短暂、不可点击穿透的 toast，
// 绝不能常驻浮在输入区 / 底部导航之上拦截用户操作（M2 demo 烟测发现的缺陷）。
let hideTimer: number | undefined;
watch(
  offlineReady,
  (ready) => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    if (ready && !needRefresh.value) {
      hideTimer = window.setTimeout(() => {
        offlineReady.value = false;
      }, 3200);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
});

function dismiss(): void {
  offlineReady.value = false;
  needRefresh.value = false;
}
</script>

<template>
  <div v-if="offlineReady && !needRefresh" class="toast" role="status">已可离线使用</div>

  <div v-else-if="needRefresh" class="prompt" role="status" aria-live="polite">
    <span class="prompt__text">有新版本可用</span>
    <button
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
.toast {
  position: fixed;
  top: calc(12px + var(--ae-safe-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 7px 16px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 999px;
  background: var(--ae-bg-elev-2);
  box-shadow: var(--ae-shadow);
  color: var(--ae-text-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  /* 关键：toast 不参与命中测试，避免遮挡任何交互控件 */
  pointer-events: none;
}

.prompt {
  position: fixed;
  left: 50%;
  bottom: calc(74px + var(--ae-safe-bottom));
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
  /* 容器可穿透，只有按钮接收点击 */
  pointer-events: none;
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
  pointer-events: auto;
}
</style>
