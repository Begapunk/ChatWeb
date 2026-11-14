<script setup lang="ts">
// M2 基座自检页。刻意不接入任何 Matrix 客户端：在 MatrixService 完成并通过真实
// E2EE 回归前，不展示「可登录/可聊天」的假象（工程规范：不宣称未测试功能已完成）。
const facts = [
  { label: "工具链", value: "Vue 3 · TypeScript 5.9.3 · Vite 8" },
  { label: "PWA", value: "Manifest · Service Worker · 离线外壳 · 更新提示" },
  { label: "设计系统", value: "深色默认 · 浅色切换 · iPhone 优先" },
  { label: "准入", value: "一次性邀请码 · 注册人数不设上限" },
];
</script>

<template>
  <section class="boot">
    <p class="boot__eyebrow ae-mono">M2 · CLIENT BASE</p>
    <h1 class="boot__title">Aether</h1>
    <p class="boot__lede">
      私人端到端加密通讯。服务器只转发密文，解密密钥只存在于你的设备。
    </p>

    <ul class="boot__list">
      <li v-for="fact in facts" :key="fact.label" class="boot__row">
        <span class="boot__label">{{ fact.label }}</span>
        <strong class="boot__value">{{ fact.value }}</strong>
      </li>
    </ul>

    <div class="boot__notice" role="note">
      <strong>当前状态：前端脚手架就绪</strong>
      <p>
        MatrixService、登录/邀请注册、会话列表与聊天界面<strong>尚未接线</strong>，
        将在 M2 后续任务中实现并做双浏览器 E2E 验证。本页不宣称任何聊天功能可用。
      </p>
    </div>
  </section>
</template>

<style scoped>
.boot {
  width: min(560px, 100%);
  padding: 8px 0 calc(32px + var(--ae-safe-bottom));
}

.boot__eyebrow {
  margin-bottom: 14px;
  color: var(--ae-accent);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.boot__title {
  font-size: clamp(44px, 12vw, 68px);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.boot__lede {
  margin-top: 16px;
  max-width: 42ch;
  color: var(--ae-text-muted);
  font-size: 16px;
}

.boot__list {
  margin-top: 34px;
  border: 1px solid var(--ae-border);
  border-radius: var(--ae-radius);
  background: var(--ae-bg-elev);
  overflow: hidden;
}

.boot__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ae-border);
}

.boot__row:last-child {
  border-bottom: none;
}

.boot__label {
  color: var(--ae-text-subtle);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.boot__value {
  font-size: 14px;
  font-weight: 600;
}

.boot__notice {
  margin-top: 22px;
  padding: 16px 18px;
  border: 1px solid var(--ae-border-strong);
  border-left: 3px solid var(--ae-accent);
  border-radius: var(--ae-radius-sm);
  background: var(--ae-accent-soft);
  font-size: 14px;
}

.boot__notice p {
  margin-top: 6px;
  color: var(--ae-text-muted);
  font-weight: 400;
}
</style>
