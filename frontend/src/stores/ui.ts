import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "aether.theme";

function readStoredTheme(): ThemeMode {
  try {
    // 深色为默认；仅显式选择过浅色才切换。
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    // 隐私模式 / 存储被禁用：退化为内存态，不影响使用。
    return "dark";
  }
}

/** 界面级状态：主题与网络可达性。消息、密钥、会话状态不属于此处。 */
export const useUiStore = defineStore("ui", () => {
  const theme = ref<ThemeMode>(readStoredTheme());
  const online = ref<boolean>(navigator.onLine);
  const isDark = computed<boolean>(() => theme.value === "dark");

  function applyTheme(): void {
    document.documentElement.dataset.theme = theme.value;
  }

  function setTheme(mode: ThemeMode): void {
    theme.value = mode;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 存储不可用：保留本次会话的主题选择即可。
    }
    applyTheme();
  }

  function toggleTheme(): void {
    setTheme(isDark.value ? "light" : "dark");
  }

  watch(theme, applyTheme, { immediate: true });
  window.addEventListener("online", () => {
    online.value = true;
  });
  window.addEventListener("offline", () => {
    online.value = false;
  });

  return { theme, isDark, online, setTheme, toggleTheme };
});
