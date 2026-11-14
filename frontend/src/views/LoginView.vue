<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";

const router = useRouter();
const chat = useChatStore();

const tab = ref<"login" | "invite">("login");
const name = ref<string>("");
const password = ref<string>("");
const inviteCode = ref<string>("");
const notice = ref<string>("");

function enterDemo(): void {
  if (tab.value === "invite" && inviteCode.value.trim().length < 6) {
    notice.value = "演示模式：随便填一个 6 位以上的邀请码即可，或切回「登录」。";
    return;
  }
  notice.value = "";
  chat.loginDemo(name.value);
  void router.push("/");
}
</script>

<template>
  <section class="auth">
    <div class="auth__brand">
      <span class="auth__mark" aria-hidden="true"></span>
      <h1>Aether</h1>
    </div>
    <p class="auth__tagline">私人端到端加密通讯</p>

    <div class="auth__card ae-card">
      <div class="auth__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'login'"
          :class="{ 'on': tab === 'login' }"
          @click="tab = 'login'"
        >登录</button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'invite'"
          :class="{ 'on': tab === 'invite' }"
          @click="tab = 'invite'"
        >邀请码注册</button>
      </div>

      <template v-if="tab === 'login'">
        <label class="auth__field">
          <span>用户名</span>
          <input v-model="name" class="ae-input" placeholder="你的用户名" autocomplete="username" />
        </label>
        <label class="auth__field">
          <span>密码</span>
          <input v-model="password" class="ae-input" type="password" placeholder="••••••••" autocomplete="current-password" />
        </label>
      </template>
      <template v-else>
        <label class="auth__field">
          <span>一次性邀请码</span>
          <input v-model="inviteCode" class="ae-input ae-mono" placeholder="xxxxxxxx-xxxxxxxxxxxxxxxxxxxx" />
        </label>
        <label class="auth__field">
          <span>设置用户名</span>
          <input v-model="name" class="ae-input" placeholder="你的用户名" />
        </label>
        <label class="auth__field">
          <span>设置密码</span>
          <input v-model="password" class="ae-input" type="password" placeholder="••••••••" />
        </label>
      </template>

      <label class="auth__field">
        <span>服务器</span>
        <input class="ae-input" :value="'https://aether.local'" readonly aria-readonly="true" />
      </label>

      <p v-if="notice" class="auth__notice" role="alert">{{ notice }}</p>
      <button type="button" class="ae-btn ae-btn--primary auth__enter" @click="enterDemo">
        进入演示
      </button>
      <p class="auth__hint">
        演示模式：不会连接服务器、不校验凭据、不创建账号。表单仅用于展示交互与布局。
      </p>
    </div>
  </section>
</template>

<style scoped>
.auth {
  padding: 46px 0 32px;
}

.auth__brand {
  display: flex;
  align-items: center;
  gap: 13px;
}

.auth__mark {
  width: 26px;
  height: 26px;
  border: 3px solid var(--ae-accent);
  border-radius: 8px;
  transform: rotate(45deg);
}

.auth h1 {
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.auth__tagline {
  margin-top: 8px;
  color: var(--ae-text-muted);
}

.auth__card {
  margin-top: 32px;
  padding: 20px;
}

.auth__tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ae-surface);
}

.auth__tabs button {
  flex: 1;
  min-height: 38px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 14px;
  font-weight: 600;
}

.auth__tabs button.on {
  background: var(--ae-bg-elev-2);
  color: var(--ae-text);
  box-shadow: var(--ae-shadow);
}

.auth__field {
  display: block;
  margin-bottom: 14px;
}

.auth__field > span {
  display: block;
  margin-bottom: 6px;
  color: var(--ae-text-muted);
  font-size: 12.5px;
}

.auth__notice {
  margin-bottom: 10px;
  color: var(--ae-warn);
  font-size: 12.5px;
}

.auth__enter {
  width: 100%;
  min-height: 46px;
  margin-top: 6px;
}

.auth__hint {
  margin-top: 14px;
  color: var(--ae-text-subtle);
  font-size: 12px;
  line-height: 1.6;
}
</style>
