<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { useUiStore } from "../stores/ui";
import { matrixServiceStatus } from "../services/matrix";
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

function saveName(): void {
  chat.loginDemo(nameDraft.value);
}

function exitDemo(): void {
  chat.logout();
  void router.push("/login");
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
      <p class="panel__note">Web Push / Sygnal、iOS 主屏幕授权与用户手势流程属于 M5，当前 demo 未实现。</p>
    </div>

    <!-- 设备 -->
    <div v-else-if="active === 'devices'" class="panel">
      <div v-for="device in chat.devices" :key="device.id" class="device">
        <div class="device__icon" aria-hidden="true"></div>
        <div class="device__text">
          <strong>{{ device.name }}<span v-if="device.current" class="device__cur">当前</span></strong>
          <span class="ae-mono">{{ device.id }} · {{ device.lastSeen }}</span>
        </div>
        <button
          v-if="!device.verified"
          type="button"
          class="device__verify"
          @click="chat.verifyDevice(device.id)"
        >验证</button>
        <span v-else class="device__ok">已验证</span>
      </div>
      <p class="panel__note">设备数据为演示用。真实设备列表需接 Matrix 的 device keys / 跨签名验证（M3）。</p>
    </div>

    <!-- 安全中心 -->
    <div v-else-if="active === 'security'" class="panel">
      <div class="statuscard">
        <span class="statuscard__dot"></span>
        <div>
          <strong>端到端加密：未接线</strong>
          <p>{{ matrixServiceStatus.reason }}</p>
        </div>
      </div>
      <div class="checklist">
        <div class="checklist__item"><span class="todo">待实现</span><div><strong>MatrixService</strong><p>登录 → device_id 重建 client → initRustCrypto → sync 生命周期</p></div></div>
        <div class="checklist__item"><span class="todo">待实现</span><div><strong>密钥备份与恢复</strong><p>SSSS + 恢复密钥 / 口令，清除浏览器数据前强警告</p></div></div>
        <div class="checklist__item"><span class="todo">待实现</span><div><strong>跨签名设备验证</strong><p>emoji / QR 验证、未验证设备提醒、设备撤销</p></div></div>
        <div class="checklist__item"><span class="todo">待实现</span><div><strong>双浏览器 E2EE 回归</strong><p>真实 Synapse 往返、服务器侧仅存 m.room.encrypted 密文证明</p></div></div>
      </div>
      <div class="callout">
        <strong>不会伪装完成</strong>
        <p>界面里出现的「已验证设备」「加密」字样只是布局占位。在真实链路通过测试前，
          本 demo 不构成端到端加密通讯工具，请勿用于任何真实私密 conversation。</p>
      </div>
    </div>

    <!-- 资料 -->
    <div v-else-if="active === 'profile'" class="panel">
      <div class="profile">
        <Avatar :name="chat.displayName" :initials="chat.displayName.slice(0, 1)" :size="64" />
        <div>
          <strong>{{ chat.displayName }}</strong>
          <span class="ae-mono">@me:aether.local</span>
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
      <div class="about__brand"><span class="about__mark"></span><strong>Aether</strong><span class="ae-mono">0.3.0-demo</span></div>
      <p class="about__desc">私人端到端加密通讯 PWA · M2 界面演示版</p>
      <div class="about__facts">
        <div><span>前端</span><strong>Vue 3 · TypeScript 5.9.3 · Vite 8 · VitePWA</strong></div>
        <div><span>后端</span><strong>未连接（演示数据）</strong></div>
        <div><span>加密</span><strong>未接线，见「安全」页</strong></div>
        <div><span>状态</span><strong>可体验交互，不可用于真实通讯</strong></div>
      </div>
      <div class="about__actions">
        <button type="button" class="ae-btn" @click="chat.resetDemo()">重置演示数据</button>
        <button type="button" class="ae-btn" @click="exitDemo">查看登录 / 邀请码页</button>
      </div>
      <p class="panel__note">
        本项目源码、Compose 部署与 M1 服务端验收见仓库 README 与 docs/。
        M1 已通过 172/172 回归；本 demo 不属于该验收范围。
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

.checklist__item .todo {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 6px;
  color: var(--ae-text-subtle);
  font-size: 11px;
}

.checklist__item strong {
  font-size: 13.5px;
}

.checklist__item p {
  margin-top: 2px;
  color: var(--ae-text-subtle);
  font-size: 12px;
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
