<script setup lang="ts">
import { RouterView } from "vue-router";
import { useUiStore } from "./stores/ui";
import UpdatePrompt from "./components/UpdatePrompt.vue";

const ui = useUiStore();
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Aether</span>
      </div>
      <div class="topbar__actions">
        <span v-if="!ui.online" class="net" role="status">离线</span>
        <button
          class="theme-toggle"
          type="button"
          :aria-label="ui.isDark ? '切换到浅色主题' : '切换到深色主题'"
          @click="ui.toggleTheme()"
        >
          {{ ui.isDark ? "浅色" : "深色" }}
        </button>
      </div>
    </header>

    <main class="main">
      <RouterView />
    </main>

    <UpdatePrompt />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100%;
  padding:
    calc(var(--ae-safe-top) + 0px)
    calc(var(--ae-safe-right) + 0px)
    var(--ae-safe-bottom)
    calc(var(--ae-safe-left) + 0px);
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 60px;
  padding: 0 max(20px, calc(env(safe-area-inset-left, 0px) + 20px));
  border-bottom: 1px solid var(--ae-border);
  background: color-mix(in srgb, var(--ae-bg) 86%, transparent);
  backdrop-filter: saturate(160%) blur(14px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.brand__mark {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ae-accent);
  border-radius: 6px;
  transform: rotate(45deg);
}

.brand__name {
  font-size: 16px;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.net {
  padding: 3px 10px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 999px;
  color: var(--ae-warn);
  font-size: 12px;
  font-weight: 600;
}

.theme-toggle {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--ae-border);
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 13px;
  font-weight: 600;
}

.theme-toggle:hover {
  background: var(--ae-surface-hover);
  border-color: var(--ae-border-strong);
  color: var(--ae-text);
}

.main {
  flex: 1;
  width: min(680px, 100%);
  margin: 0 auto;
  padding: 40px 20px 24px;
}
</style>
