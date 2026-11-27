<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { useUiStore } from "./stores/ui";
import { useChatStore } from "./stores/chat";
import UpdatePrompt from "./components/UpdatePrompt.vue";
import DemoBadge from "./components/DemoBadge.vue";

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const chat = useChatStore();

// 登录页与聊天页自带完整画面：不显示全局顶栏与底部导航。
const hideChrome = computed<boolean>(() => route.name === "login" || route.name === "chat");
const isChat = computed<boolean>(() => route.name === "chat");
const isP2P = computed<boolean>(() => route.name === "p2p");
const activeTab = computed<string>(() => {
  if (route.name === "search") return "search";
  if (route.name === "settings") return "settings";
  return "chats";
});

function goTab(name: "conversations" | "search" | "settings"): void {
  void router.push({ name });
}
</script>

<template>
  <div class="shell" :class="{ 'shell--immersive': isChat }">
    <header v-if="!hideChrome" class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Aether</span>
      </div>
      <div class="topbar__actions">
        <span v-if="!isP2P && !ui.online" class="net" role="status">离线</span>
        <DemoBadge v-if="!isP2P" />
        <RouterLink class="network-link" to="/network-test">网络诊断</RouterLink>
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

    <main class="main" :class="{ 'main--full': isChat }">
      <RouterView v-slot="{ Component }">
        <KeepAlive include="P2PView"><component :is="Component" /></KeepAlive>
      </RouterView>
    </main>

    <nav v-if="!hideChrome && !isP2P" class="tabbar" aria-label="主导航">
      <button
        class="tabbar__item"
        :class="{ 'tabbar__item--active': activeTab === 'chats' }"
        type="button"
        :aria-current="activeTab === 'chats' ? 'page' : undefined"
        @click="goTab('conversations')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5h16v11H9l-5 3.5v-3.5H4z" />
        </svg>
        <span>会话</span>
        <em v-if="chat.unreadTotal > 0" class="tabbar__badge">{{ chat.unreadTotal }}</em>
      </button>
      <button
        class="tabbar__item"
        :class="{ 'tabbar__item--active': activeTab === 'search' }"
        type="button"
        :aria-current="activeTab === 'search' ? 'page' : undefined"
        @click="goTab('search')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
        </svg>
        <span>搜索</span>
      </button>
      <button
        class="tabbar__item"
        :class="{ 'tabbar__item--active': activeTab === 'settings' }"
        type="button"
        :aria-current="activeTab === 'settings' ? 'page' : undefined"
        @click="goTab('settings')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
        </svg>
        <span>设置</span>
      </button>
    </nav>

    <UpdatePrompt />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding:
    var(--ae-safe-top)
    var(--ae-safe-right)
    var(--ae-safe-bottom)
    var(--ae-safe-left);
  background: var(--ae-bg);
}

.topbar {
  flex: none;
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  padding: 8px max(16px, calc(env(safe-area-inset-left, 0px) + 16px));
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
  flex: none;
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
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.net {
  padding: 3px 9px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 999px;
  color: var(--ae-warn);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.theme-toggle {
  flex: none;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ae-border);
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.network-link {
  color: var(--ae-accent);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.theme-toggle:hover {
  background: var(--ae-surface-hover);
  border-color: var(--ae-border-strong);
  color: var(--ae-text);
}

.main {
  flex: 1;
  min-height: 0;
  width: min(680px, 100%);
  margin: 0 auto;
  padding: 20px 16px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* 聊天页自己管理滚动：外层不裁剪、不加内边距 */
.main--full {
  width: 100%;
  padding: 0;
  overflow: hidden;
}

.tabbar {
  flex: none;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  min-height: 58px;
  border-top: 1px solid var(--ae-border);
  background: color-mix(in srgb, var(--ae-bg-elev) 92%, transparent);
  backdrop-filter: saturate(160%) blur(14px);
}

.tabbar__item {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--ae-tap);
  border: none;
  background: transparent;
  color: var(--ae-text-subtle);
  font-size: 11px;
  font-weight: 600;
}

.tabbar__item svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tabbar__item--active {
  color: var(--ae-accent);
}

.tabbar__item:hover {
  color: var(--ae-text);
}

.tabbar__badge {
  position: absolute;
  top: 5px;
  left: calc(50% + 8px);
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--ae-warn);
  color: var(--ae-bg);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  line-height: 17px;
  text-align: center;
}

@media (max-width: 420px) {
  .brand__name {
    display: none;
  }

  .topbar {
    gap: 6px;
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
