<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { useUiStore } from "../stores/ui";
import { matrixServiceStatus, securityState } from "../services/matrix";
import Avatar from "../components/Avatar.vue";

type Tab = "general" | "notify" | "devices" | "security" | "profile" | "about";

const tabs: { id: Tab; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "notify", label: "通知" },
  { id: "devices", label: "设备" },
  { id: "security", label: "安全" },
  { id: "profile", label: "资料" },
  { id: "about", label: "关于" },
];

const active = ref<Tab>("general");
const chat = useChatStore();
const ui = useUiStore();
const router = useRouter();
const nameDraft = ref<string>(chat.displayName);
const isLive = computed<boolean>(() => matrixServiceStatus.mode === "live");

// ---- M3 安全中心状态 ----
const recoveryInput = ref<string>("");
const recoveryAccepted = ref<boolean>(false);
const securityBusy = computed<boolean>(() => securityState.busy);
const securityError = computed<string>(() => securityState.error);
const securityNotice = computed<string>(() => securityState.notice || chat.liveNotice);

// 切到安全/设备页时刷新一次真实状态；live 模式不读取演示假设备。
watch([active, isLive], () => {
  if (isLive.value && (active.value === "security" || active.value === "devices")) {
    void chat.refreshSecurity().catch(() => {});
  }
}, { immediate: true });

function saveName(): void {
  chat.loginDemo(nameDraft.value);
}

function exitDemo(): void {
  chat.logout();
  void router.push("/login");
}

function backToDemo(): void {
  chat.disconnectLive();
  void router.push("/");
}

async function doSetupBackup(): Promise<void> {
  try {
    await chat.setupKeyBackup();
    recoveryAccepted.value = false;
  } catch { /* 错误信息已在 securityState.error */ }
}

async function doRestore(): Promise<void> {
  try {
    await chat.restoreWithRecoveryKey(recoveryInput.value);
    recoveryInput.value = "";
  } catch { /* 同上 */ }
}

function acknowledgeRecoveryKey(): void {
  recoveryAccepted.value = true;
  chat.clearRecoveryKey();
}

async function act(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch { /* 错误信息已在 securityState.error / chat.liveError */ }
}

function trustLabel(trust: string): string {
  return trust === "verified" ? "已验证" : trust === "blocked" ? "已屏蔽" : "未验证";
}
</script>

<template>
  <section class="settings">
    <h1>设置</h1>

    <div class="settings__tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="active === tab.id"
        :class="{ 'on': active === tab.id }"
        @click="active = tab.id"
      >{{ tab.label }}</button>
    </div>

    <!-- 通用 -->
    <div v-if="active === 'general'" class="panel">
      <div class="row">
        <div class="row__text"><strong>外观</strong><span>深色为默认，可随时切换</span></div>
        <div class="seg">
          <button type="button" :class="{ on: ui.isDark }" @click="ui.setTheme('dark')">深色</button>
          <button type="button" :class="{ on: !ui.isDark }" @click="ui.setTheme('light')">浅色</button>
        </div>
      </div>
      <div class="row">
        <div class="row__text"><strong>Enter 发送</strong><span>Shift + Enter 换行</span></div>
        <button
          type="button" role="switch" :aria-checked="chat.settings.enterToSend"
          class="switch" :class="{ on: chat.settings.enterToSend }"
          @click="chat.setSetting('enterToSend', !chat.settings.enterToSend)"
        ><span></span></button>
      </div>
      <div class="row">
        <div class="row__text"><strong>自动下载附件</strong><span>演示模式不会真正下载文件</span></div>
        <button
          type="button" role="switch" :aria-checked="chat.settings.autoDownload"
          class="switch" :class="{ on: chat.settings.autoDownload }"
          @click="chat.setSetting('autoDownload', !chat.settings.autoDownload)"
        ><span></span></button>
      </div>
      <p class="panel__note">界面按 iPhone 优先设计：安全区适配、44px 最小点击区、离线外壳与更新提示。</p>
    </div>

    <!-- 通知 -->
    <div v-else-if="active === 'notify'" class="panel">
      <div class="row">
        <div class="row__text"><strong>消息通知</strong><span>开启后收到新消息时提醒</span></div>
        <button
          type="button" role="switch" :aria-checked="chat.settings.notifications"
          class="switch" :class="{ on: chat.settings.notifications }"
          @click="chat.setSetting('notifications', !chat.settings.notifications)"
        ><span></span></button>
      </div>
      <div class="row">
        <div class="row__text"><strong>已读回执</strong><span>控制自己消息的已读状态显示</span></div>
        <button
          type="button" role="switch" :aria-checked="chat.settings.readReceipts"
          class="switch" :class="{ on: chat.settings.readReceipts }"
          @click="chat.setSetting('readReceipts', !chat.settings.readReceipts)"
        ><span></span></button>
      </div>
      <div class="callout">
        <strong>隐私约定</strong>
        <p>通知内容只显示「有新消息」，不显示正文、发送者或预览 —— 避免锁屏与推送通道泄露明文。</p>
      </div>
      <p class="panel__note">Web Push / Sygnal、iOS 主屏幕授权与用户手势流程属于 M5，当前未实现（demo 与 live 均如此）。</p>
    </div>

    <!-- 设备（M3：live 模式为真实 Matrix device keys） -->
    <div v-else-if="active === 'devices'" class="panel">
      <template v-if="isLive">
        <div v-if="chat.securityDevices.length === 0" class="device">
          <div class="device__icon" aria-hidden="true"></div>
          <div class="device__text"><strong>正在读取设备列表…</strong><span class="ae-mono">从 Synapse 拉取真实设备密钥</span></div>
        </div>
        <div v-for="device in chat.securityDevices" :key="device.id" class="device">
          <div class="device__icon" aria-hidden="true"></div>
          <div class="device__text">
            <strong>{{ device.name }}<span v-if="device.current" class="device__cur">当前</span></strong>
            <span class="ae-mono">{{ device.id }} · {{ device.lastSeen }}</span>
            <span v-if="device.fingerprint" class="ae-mono">指纹 {{ device.fingerprint.slice(0, 16) }}…</span>
          </div>
          <span class="device__badge" :class="`device__badge--${device.trust}`">{{ trustLabel(device.trust) }}</span>
          <div v-if="!device.current" class="device__actions">
            <button type="button" class="device__verify" :disabled="securityBusy" @click="act(() => chat.startVerification(device.id))">验证</button>
            <button type="button" class="device__verify device__verify--danger" :disabled="securityBusy" @click="act(() => chat.revokeDevice(device.id))">撤销</button>
          </div>
        </div>
        <p class="panel__note">以上为 Synapse 返回的真实设备列表与设备密钥验证状态，不是演示数据。「验证」发起 SAS 表情比对，两端一致后才标记已验证；「撤销」会通过 UIA 删除设备。</p>
      </template>
      <template v-else>
        <div v-for="device in chat.devices" :key="device.id" class="device">
          <div class="device__icon" aria-hidden="true"></div>
          <div class="device__text">
            <strong>{{ device.name }}<span v-if="device.current" class="device__cur">当前</span></strong>
            <span class="ae-mono">{{ device.id }} · {{ device.lastSeen }}</span>
          </div>
          <button v-if="!device.verified" type="button" class="device__verify" @click="chat.verifyDevice(device.id)">验证</button>
          <span v-else class="device__ok">已验证</span>
        </div>
        <p class="panel__note">演示模式的设备列表为界面模拟数据，不对应任何真实设备或密钥。真实通讯暂未开放。</p>
      </template>

      <!-- SAS 表情比对面板：两端必须人工确认一致，不匹配必须点「不一致」 -->
      <div v-if="isLive && securityState.verification.active" class="callout sas" role="region" aria-label="设备验证">
        <strong>设备验证 · 比对两端表情</strong>
        <p>请与另一台设备核对下列表情是否完全一致。一致才点「一致，确认」；任何不一致都必须点「不一致」，验证会被取消且不会标记为已验证。</p>
        <div v-if="securityState.verification.emoji.length" class="sas__emoji" aria-label="SAS 表情序列">
          <span v-for="(e, i) in securityState.verification.emoji" :key="i" class="sas__item">{{ e }}</span>
        </div>
        <p v-else class="ae-mono">状态：{{ securityState.verification.phase }} · 等待对方接受…</p>
        <p v-if="securityState.verification.decimal" class="ae-mono">数字备选：{{ securityState.verification.decimal.join(" ") }}</p>
        <p v-if="securityState.verification.error" class="sas__error" role="alert">{{ securityState.verification.error }}</p>
        <div class="sas__actions">
          <button v-if="securityState.verification.phase === 'requested' && !securityState.verification.emoji.length" type="button" class="ae-btn ae-btn--primary" @click="act(() => chat.acceptVerification())">接受验证请求</button>
          <button v-if="securityState.verification.emoji.length" type="button" class="ae-btn ae-btn--primary" @click="act(() => chat.confirmSas())">一致，确认</button>
          <button v-if="securityState.verification.emoji.length" type="button" class="ae-btn" @click="chat.mismatchSas()">不一致</button>
          <button type="button" class="ae-btn" @click="chat.cancelVerification()">取消</button>
        </div>
      </div>
    </div>

    <!-- 安全中心（M3：真实 4S / 备份 / 恢复 / 跨签名状态） -->
    <div v-else-if="active === 'security'" class="panel">
      <div class="statuscard" :class="{ 'statuscard--live': isLive }">
        <span class="statuscard__dot"></span>
        <div>
          <strong v-if="isLive">端到端加密：{{ matrixServiceStatus.e2ee ? "已就绪" : "未就绪" }}</strong>
          <strong v-else>端到端加密：未接线</strong>
          <p>{{ matrixServiceStatus.reason }}</p>
          <p v-if="isLive" class="statuscard__meta ae-mono">
            {{ matrixServiceStatus.userId }} · {{ matrixServiceStatus.deviceId }}
          </p>
        </div>
      </div>

      <template v-if="isLive">
        <div class="checklist">
          <div class="checklist__item">
            <span :class="chat.securityStatus?.crossSigningReady ? 'done' : 'todo'">{{ chat.securityStatus?.crossSigningReady ? "已就绪" : "未就绪" }}</span>
            <div><strong>跨签名</strong><p>标识本账号的所有设备，恢复后可自签新设备</p></div>
          </div>
          <div class="checklist__item">
            <span :class="chat.securityStatus?.secretStorageReady ? 'done' : 'todo'">{{ chat.securityStatus?.secretStorageReady ? "已就绪" : "未就绪" }}</span>
            <div><strong>安全存储（4S / SSSS）</strong><p>服务器端加密保存跨签名私钥与密钥备份解密密钥</p></div>
          </div>
          <div class="checklist__item">
            <span :class="chat.securityStatus?.backupActive ? 'done' : 'todo'">{{ chat.securityStatus?.backupActive ? "备份中" : "未备份" }}</span>
            <div><strong>密钥备份</strong><p>版本 {{ chat.securityStatus?.backupVersion ?? "无" }} · 会话密钥 {{ chat.securityStatus?.backupKeyCount ?? "未知" }} 条</p></div>
          </div>
          <div v-if="chat.securityStatus?.restoredThisSession" class="checklist__item">
            <span class="done">已恢复</span>
            <div><strong>本次会话恢复</strong><p>已从备份导入 {{ chat.securityStatus?.restoredKeys }} 条会话密钥</p></div>
          </div>
          <div class="checklist__item"><span class="todo">待实测 / M6</span><div><strong>加密附件与通话</strong><p>EncryptedFile 附件已接线但真实门禁待执行；MatrixRTC 媒体 E2EE 未实现</p></div></div>
        </div>

        <!-- 一次性恢复密钥：仅显示一次，确认后立刻从内存清除 -->
        <div v-if="securityState.recoveryKey && !recoveryAccepted" class="callout recovery" role="alert">
          <strong>请立即离线抄写恢复密钥（只显示这一次）</strong>
          <p>服务器不保存明文恢复密钥，任何人（包括管理员）都无法帮你找回。清除浏览器数据后，它是找回历史消息的唯一方式。</p>
          <p class="recovery__key ae-mono" data-testid="recovery-key">{{ securityState.recoveryKey }}</p>
          <div class="sas__actions">
            <button type="button" class="ae-btn ae-btn--primary" @click="acknowledgeRecoveryKey">我已抄写并妥善保存</button>
          </div>
        </div>

        <!-- 建立备份 / 导入恢复密钥 -->
        <div v-if="!chat.securityStatus?.crossSigningReady" class="callout">
          <strong>建立密钥备份</strong>
          <p>将生成一把随机恢复密钥，并建立跨签名 + 4S + 服务器密钥备份。完成后请立即离线保存恢复密钥。</p>
          <div class="sas__actions">
            <button type="button" class="ae-btn ae-btn--primary" :disabled="securityBusy" @click="doSetupBackup">
              {{ securityBusy ? "处理中…" : "生成恢复密钥并备份" }}
            </button>
          </div>
        </div>
        <div class="callout">
          <strong>从恢复密钥恢复历史消息</strong>
          <p>清除浏览器数据或更换设备后，输入此前抄写的恢复密钥即可从服务器备份找回 Megolm 会话密钥。密钥只在本机内存中使用，不会持久化或上传明文。</p>
          <input v-model="recoveryInput" class="ae-input ae-mono" type="password" autocomplete="off" placeholder="粘贴恢复密钥" aria-label="恢复密钥" />
          <div class="sas__actions">
            <button type="button" class="ae-btn" :disabled="securityBusy || !recoveryInput.trim()" @click="doRestore">恢复历史消息</button>
          </div>
        </div>

        <p v-if="securityError" class="sas__error" role="alert">{{ securityError }}</p>
        <p v-if="securityNotice" class="panel__note" role="status">{{ securityNotice }}</p>

        <div class="callout callout--warn">
          <strong>清除浏览器数据前必读</strong>
          <p>{{ chat.dataWarning || "正在读取安全状态…" }}</p>
        </div>
      </template>

      <template v-else>
        <div class="checklist">
          <div class="checklist__item"><span class="todo">演示模式不启用</span><div><strong>MatrixService / 密钥备份</strong><p>真实链路已实现并通过双浏览器 E2EE 验收；演示模式不联网、不产生密钥</p></div></div>
          <div class="checklist__item"><span class="todo">待实测 / M6</span><div><strong>加密附件与通话</strong><p>live 模式附件已接线但真实门禁待执行；MatrixRTC 媒体 E2EE 未实现</p></div></div>
        </div>
        <div class="callout">
          <strong>演示模式不加密</strong>
          <p>真实链路（live 模式）文本 E2EE 已通过双浏览器门禁；M3 密钥恢复与 M4 附件仍需真实门禁确认。但<strong>当前处于演示模式</strong>：不连接服务器、不产生密钥、消息只存内存。
            请勿用演示模式进行任何真实私密对话；真实通讯在网络连通性验证期间暂停。可前往「网络测试」验证访问情况。</p>
        </div>
      </template>
    </div>

    <!-- 资料 -->
    <div v-else-if="active === 'profile'" class="panel">
      <div class="profile">
        <Avatar :name="chat.displayName" :initials="chat.displayName.slice(0, 1)" :size="64" />
        <div>
          <strong>{{ chat.displayName }}</strong>
          <span class="ae-mono">{{ chat.meId }}</span>
        </div>
      </div>
      <label class="field">
        <span>显示名称</span>
        <input v-model="nameDraft" class="ae-input" placeholder="你的名字" />
      </label>
      <button type="button" class="ae-btn ae-btn--primary" @click="saveName">保存</button>
      <p class="panel__note">仅影响本浏览器内的演示显示，不会写入任何服务器。</p>
    </div>

    <!-- 关于 -->
    <div v-else class="panel">
      <div class="about__brand"><span class="about__mark"></span><strong>Aether</strong><span class="ae-mono">0.5.0</span></div>
      <p class="about__desc">私人通讯 PWA · Cloudflare 连通性验证阶段 · 真实通讯暂未开放</p>
      <div class="about__facts">
        <div><span>前端</span><strong>Vue 3 · TypeScript 5.9.3 · Vite 8 · VitePWA</strong></div>
        <div><span>后端</span><strong>{{ isLive ? "用户指定的 Matrix homeserver" : "未连接（演示数据）" }}</strong></div>
        <div><span>加密</span><strong>{{ isLive ? (matrixServiceStatus.e2ee ? "Megolm / Rust Crypto WASM 已就绪" : "未就绪，见安全页") : "未接线，见「安全」页" }}</strong></div>
        <div><span>状态</span><strong>{{ isLive ? "真实 E2EE 会话" : "可体验交互，不可用于真实通讯" }}</strong></div>
      </div>
      <div class="about__actions">
        <template v-if="isLive">
          <button type="button" class="ae-btn" @click="backToDemo">断开并返回演示模式</button>
          <button type="button" class="ae-btn" @click="exitDemo">切换账号 / 重新登录</button>
        </template>
        <template v-else>
          <button type="button" class="ae-btn" @click="chat.resetDemo()">重置演示数据</button>
          <button type="button" class="ae-btn" @click="exitDemo">返回登录页</button>
        </template>
      </div>
      <p class="panel__note">
        本项目源码、Compose 部署与 M1 服务端验收见仓库 README 与 docs/。
        M1 已通过 172/172 回归；当前链路状态见 docs/M2-LIVE-REPORT.md。
      </p>
    </div>
  </section>
</template>

<style scoped>
.settings h1 {
  margin-bottom: 16px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.settings__tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 18px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ae-surface);
  overflow-x: auto;
}

.settings__tabs button {
  flex: 1;
  min-width: 48px;
  min-height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.settings__tabs button.on {
  background: var(--ae-bg-elev-2);
  color: var(--ae-text);
  box-shadow: var(--ae-shadow);
}

.panel {
  border: 1px solid var(--ae-border);
  border-radius: var(--ae-radius);
  background: var(--ae-bg-elev);
  overflow: hidden;
}

.row,
.device,
.checklist__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ae-border);
}

.row__text,
.device__text {
  flex: 1;
  min-width: 0;
}

.row__text strong,
.device__text strong {
  display: block;
  font-size: 14px;
}

.row__text span,
.device__text > span {
  display: block;
  margin-top: 2px;
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}

.panel__note {
  padding: 13px 16px;
  color: var(--ae-text-subtle);
  font-size: 12px;
  line-height: 1.6;
}

.seg {
  display: flex;
  gap: 3px;
  flex: none;
  padding: 3px;
  border: 1px solid var(--ae-border);
  border-radius: 9px;
}

.seg button {
  min-height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 12px;
}

.seg button.on {
  background: var(--ae-accent-soft);
  color: var(--ae-accent);
  font-weight: 700;
}

.switch {
  flex: none;
  width: 44px;
  height: 26px;
  padding: 3px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 999px;
  background: var(--ae-bg-elev-2);
  transition: background 0.18s var(--ae-ease);
}

.switch span {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ae-text-subtle);
  transition: transform 0.18s var(--ae-ease), background 0.18s var(--ae-ease);
}

.switch.on {
  background: var(--ae-accent);
  border-color: transparent;
}

.switch.on span {
  transform: translateX(18px);
  background: var(--ae-accent-contrast);
}

.callout,
.statuscard {
  margin: 14px 16px;
  padding: 13px 15px;
  border: 1px solid var(--ae-border-strong);
  border-left: 3px solid var(--ae-accent);
  border-radius: 10px;
  background: var(--ae-accent-soft);
}

.callout strong,
.statuscard strong {
  font-size: 13.5px;
}

.callout p,
.statuscard p {
  margin-top: 5px;
  color: var(--ae-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.statuscard {
  display: flex;
  gap: 11px;
  border-left-color: var(--ae-warn);
  background: color-mix(in srgb, var(--ae-warn) 10%, transparent);
}

.statuscard__dot {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ae-warn);
}

.statuscard--live {
  border-left-color: var(--ae-accent);
  background: color-mix(in srgb, var(--ae-accent) 10%, transparent);
}

.statuscard--live .statuscard__dot {
  background: var(--ae-accent);
}

.statuscard__meta {
  margin-top: 6px;
  color: var(--ae-text-subtle) !important;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.device__icon {
  flex: none;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 9px;
  background: var(--ae-surface);
}

.device__cur {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ae-accent-soft);
  color: var(--ae-accent);
  font-size: 10px;
  font-weight: 600;
}

.device__verify {
  flex: none;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ae-warn);
  border-radius: 8px;
  background: transparent;
  color: var(--ae-warn);
  font-size: 12px;
  font-weight: 600;
}

.device__ok {
  flex: none;
  color: var(--ae-success);
  font-size: 12px;
  font-weight: 600;
}

.checklist__item .todo,
.checklist__item .done {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 6px;
  color: var(--ae-text-subtle);
  font-size: 11px;
}

.checklist__item .done {
  border-color: color-mix(in srgb, var(--ae-accent) 45%, transparent);
  background: color-mix(in srgb, var(--ae-accent) 12%, transparent);
  color: var(--ae-accent);
  font-weight: 700;
}

.checklist__item strong {
  font-size: 13.5px;
}

.checklist__item p {
  margin-top: 2px;
  color: var(--ae-text-subtle);
  font-size: 12px;
}

/* ---- M3 安全中心 ---- */
.device__badge {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 6px;
  color: var(--ae-text-subtle);
  font-size: 11px;
  font-weight: 600;
}
.device__badge--verified {
  border-color: color-mix(in srgb, var(--ae-success) 45%, transparent);
  color: var(--ae-success);
}
.device__badge--blocked {
  border-color: color-mix(in srgb, var(--ae-danger, #e06c75) 45%, transparent);
  color: var(--ae-danger, #e06c75);
}
.device__actions {
  display: flex;
  flex: none;
  gap: 6px;
}
.device__verify--danger {
  border-color: var(--ae-danger, #e06c75);
  color: var(--ae-danger, #e06c75);
}
.device__verify:disabled {
  opacity: 0.5;
}
.sas {
  margin: 12px 16px;
}
.sas__emoji {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.sas__item {
  min-width: 44px;
  padding: 8px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 10px;
  background: var(--ae-surface);
  text-align: center;
  font-size: 24px;
}
.sas__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.sas__actions .ae-input {
  width: 100%;
}
.sas__error {
  margin: 10px 16px;
  color: var(--ae-danger, #e06c75);
  font-size: 12.5px;
}
.recovery {
  margin: 12px 16px;
}
.recovery__key {
  margin-top: 10px;
  padding: 12px;
  border: 1px dashed var(--ae-accent);
  border-radius: 10px;
  background: var(--ae-surface);
  font-size: 15px;
  letter-spacing: 0.06em;
  line-height: 1.7;
  overflow-wrap: anywhere;
  user-select: all;
}
.callout--warn {
  border-left-color: var(--ae-warn);
  background: color-mix(in srgb, var(--ae-warn) 10%, transparent);
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--ae-border);
}

.profile strong {
  display: block;
  font-size: 17px;
}

.profile span {
  color: var(--ae-text-subtle);
  font-size: 12px;
}

.field {
  display: block;
  padding: 16px 16px 10px;
}

.field > span {
  display: block;
  margin-bottom: 6px;
  color: var(--ae-text-muted);
  font-size: 12.5px;
}

.panel > .ae-btn {
  margin: 0 16px 16px;
}

.about__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 6px;
}

.about__mark {
  width: 20px;
  height: 20px;
  border: 3px solid var(--ae-accent);
  border-radius: 6px;
  transform: rotate(45deg);
}

.about__brand strong {
  font-size: 20px;
}

.about__brand .ae-mono {
  color: var(--ae-text-subtle);
}

.about__desc {
  padding: 0 16px 16px;
  color: var(--ae-text-muted);
  font-size: 13px;
}

.about__facts div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--ae-border);
  font-size: 12.5px;
}

.about__facts span {
  flex: none;
  color: var(--ae-text-subtle);
}

.about__facts strong {
  text-align: right;
  font-weight: 600;
}

.about__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px;
}

.about__actions .ae-btn {
  flex: 1;
  min-width: 150px;
  font-size: 13px;
}
</style>
