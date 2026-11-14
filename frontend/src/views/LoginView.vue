<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { matrixServiceStatus } from "../services/matrix";

const route = useRoute();
const router = useRouter();
const chat = useChatStore();

// 整页刷新导致内存态凭据丢失时，由 main.ts 的一次性守卫带 reason 重定向至此。
// 明确告知「真实会话已结束」，避免用户把演示数据当成自己的加密会话。
const sessionExpired = computed<boolean>(() => route.query.reason === "session-expired");

const mode = ref<"demo" | "live">("demo");
const tab = ref<"login" | "invite">("login");
const name = ref<string>("");
const password = ref<string>("");
const inviteCode = ref<string>("");
const notice = ref<string>("");

const phaseLabel = computed<string>(() => {
  switch (matrixServiceStatus.phase) {
    case "wasm": return "正在加载 Rust Crypto WASM…";
    case "auth": return "正在向 Synapse 登录…";
    case "crypto": return "正在初始化加密存储与设备密钥…";
    case "sync": return "正在完成首次同步…";
    case "ready": return "已连接";
    default: return "";
  }
});

function enterDemo(): void {
  if (tab.value === "invite" && inviteCode.value.trim().length < 6) {
    notice.value = "演示模式：随便填一个 6 位以上的邀请码即可，或切回「登录」。";
    return;
  }
  notice.value = "";
  chat.loginDemo(name.value);
  void router.push("/");
}

/** 真实链路：邀请码注册（UIA 多阶段）或口令登录 → Rust Crypto → sync → 自动入房。 */
async function connectLive(): Promise<void> {
  notice.value = "";
  if (!name.value.trim()) {
    notice.value = "请填写用户名。";
    return;
  }
  if (!password.value) {
    notice.value = "请填写密码。";
    return;
  }
  if (tab.value === "invite" && inviteCode.value.trim().length < 6) {
    notice.value = "请填写有效的一次性邀请码。";
    return;
  }
  try {
    if (tab.value === "invite") {
      await chat.connectLive({
        kind: "register",
        inviteCode: inviteCode.value,
        username: name.value.trim(),
        password: password.value,
      });
    } else {
      await chat.connectLive({
        kind: "login",
        username: name.value.trim(),
        password: password.value,
      });
    }
    await router.push("/");
  } catch (err) {
    notice.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <section class="auth">
    <div class="auth__brand">
      <span class="auth__mark" aria-hidden="true"></span>
      <h1>Aether</h1>
    </div>
    <p class="auth__tagline">私人端到端加密通讯</p>

    <p v-if="sessionExpired" class="auth__expired" role="alert">
      真实会话已结束：登录凭据与加密存储密钥只保存在内存中，刷新或重新打开页面后需重新连接服务器。
      下方「演示模式」是模拟数据，不是你的真实会话；请重新登录以恢复端到端加密会话。
    </p>

    <div class="auth__card ae-card">
      <div class="auth__mode" role="tablist" aria-label="连接模式">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'demo'"
          :class="{ on: mode === 'demo' }"
          @click="mode = 'demo'; notice = ''"
        >演示模式</button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'live'"
          :class="{ on: mode === 'live' }"
          @click="mode = 'live'; notice = ''"
        >连接真实服务器</button>
      </div>

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

      <template v-if="tab === 'invite'">
        <label class="auth__field">
          <span>一次性邀请码</span>
          <input v-model="inviteCode" class="ae-input ae-mono" placeholder="xxxxxxxx-xxxxxxxxxxxxxxxxxxxx" />
        </label>
      </template>

      <label class="auth__field">
        <span>{{ tab === 'invite' ? '设置用户名' : '用户名' }}</span>
        <input v-model="name" class="ae-input" placeholder="你的用户名" autocomplete="username" />
      </label>
      <label class="auth__field">
        <span>{{ tab === 'invite' ? '设置密码' : '密码' }}</span>
        <input v-model="password" class="ae-input" type="password" placeholder="••••••••" autocomplete="current-password" />
      </label>

      <label class="auth__field">
        <span>服务器</span>
        <input
          class="ae-input"
          :value="mode === 'live' ? '同源 /_matrix · /invite-api（Caddy）' : 'https://aether.local'"
          readonly
          aria-readonly="true"
        />
      </label>

      <p v-if="notice" class="auth__notice" role="alert">{{ notice }}</p>
      <p v-if="mode === 'live' && chat.liveBusy" class="auth__progress" role="status">
        {{ phaseLabel || '正在连接…' }}
      </p>

      <button
        v-if="mode === 'demo'"
        type="button"
        class="ae-btn ae-btn--primary auth__enter"
        @click="enterDemo"
      >进入演示</button>
      <button
        v-else
        type="button"
        class="ae-btn ae-btn--primary auth__enter"
        :disabled="chat.liveBusy"
        @click="connectLive"
      >{{ chat.liveBusy ? '连接中…' : '连接真实服务器' }}</button>

      <p v-if="mode === 'demo'" class="auth__hint">
        演示模式：不会连接服务器、不校验凭据、不创建账号。表单仅用于展示交互与布局。
      </p>
      <p v-else class="auth__hint">
        真实模式：经同源 Caddy 访问邀请服务与 Synapse，注册使用一次性邀请码换取的短时效令牌；
        登录后在设备端初始化 Rust Crypto WASM，消息由 Megolm 端到端加密。
        密码仅用于本次登录与派生加密存储密钥，不会持久化或上传。
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

.auth__mode,
.auth__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ae-surface);
}

.auth__mode {
  margin-bottom: 12px;
  border: 1px solid var(--ae-border);
}

.auth__tabs {
  margin-bottom: 20px;
}

.auth__mode button,
.auth__tabs button {
  flex: 1;
  min-height: 38px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 13px;
  font-weight: 600;
}

.auth__mode button.on,
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

.auth__expired {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--ae-warn) 45%, transparent);
  border-left: 3px solid var(--ae-warn);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ae-warn) 10%, transparent);
  color: var(--ae-warn);
  font-size: 12.5px;
  line-height: 1.65;
}

.auth__progress {
  margin-bottom: 10px;
  color: var(--ae-accent);
  font-size: 12.5px;
}

.auth__enter {
  width: 100%;
  min-height: 46px;
  margin-top: 6px;
}

.auth__enter:disabled {
  opacity: 0.55;
  cursor: wait;
}

.auth__hint {
  margin-top: 14px;
  color: var(--ae-text-subtle);
  font-size: 12px;
  line-height: 1.6;
}
</style>
