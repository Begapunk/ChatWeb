# Aether 前端（Vue 3 PWA）

> **状态（2026-11-14）：M2 脚手架与设计系统基座已建立，类型检查与生产构建均通过。**
> **MatrixService、登录/邀请注册、会话列表、聊天界面、Web Push、通话均未实现**，
> 不宣称任何聊天或 E2EE 功能可用。详见根目录 `docs/M2-KICKOFF-CHECK.md` 与 `TODO.md`。

## 技术栈（精确锁定，无 `^`/`~`）

| 组件 | 版本 | 说明 |
|---|---|---|
| vue | 3.5.45 | |
| vue-router | 5.5.1 | |
| pinia | 4.1.0 | |
| vite | 8.3.8 | |
| @vitejs/plugin-vue | 6.0.11 | |
| vite-plugin-pwa | 2.0.0 | Manifest / SW / 更新提示 |
| **typescript** | **5.9.3** | **M2 开工首检修订**：原拟 7.0.2 与 `vue-tsc 3.3.14` 不兼容（`ERR_PACKAGE_PATH_NOT_EXPORTED`），见 `docs/M2-KICKOFF-CHECK.md` |
| vue-tsc | 3.3.14 | |
| vitest | 5.1.0 | 单元测试（M2 后续接入） |
| matrix-js-sdk | 45.1.0 | 精确绑定 `crypto-wasm 18.9.2`（由 SDK 依赖锁定，**不得单独升级**；已实测实际安装版本一致） |

## 命令

```bash
cd frontend
npm ci                 # 推荐；需在线元数据，见下方「安装注意」
npm run typecheck      # vue-tsc --noEmit
npm run build          # typecheck + vite build（产出 dist/、sw.js、manifest.webmanifest）
npm run dev            # 开发服务器
npm run preview        # 预览生产构建
```

**安装注意（实测踩坑）**：首轮 `npm install --prefer-offline` 报
`ETARGET No matching version found for @vitest/mocker@5.1.0`。经 `npm view` 核实该版本
在 registry **确实存在**，是离线优先读取了过期 packument 所致；改用
`npm install --prefer-online` 后成功（440 包）。**不要用 `--prefer-offline` 安装本工程**。

## 已验证（真实执行，2026-11-14）

| 门禁 | 结果 |
|---|---|
| `node -e` 核对实际安装版本 | `matrix-js-sdk 45.1.0` / `crypto-wasm 18.9.2` / SDK requires `18.9.2` ✓ |
| `npm run typecheck` | `vue-tsc --noEmit` exit 0 |
| `npm run build` | exit 0，36 modules，JS 100.62 kB / CSS 6.81 kB |
| PWA 产物 | `dist/sw.js`、`dist/workbox-*.js`、`dist/manifest.webmanifest`、`dist/icons/icon.svg`；precache 7 项 |

## 目录

```
frontend/
├── index.html                 # viewport-fit=cover + iOS 主屏幕 meta
├── vite.config.ts             # VitePWA（prompt 更新策略 / SW 缓存红线）
├── tsconfig.json
├── package-lock.json          # 入库，保证可复现
├── public/icons/icon.svg      # 原创标记
└── src/
    ├── main.ts                # app / Pinia / Router 装配
    ├── App.vue                # 应用外壳：主题切换、网络状态、更新提示
    ├── env.d.ts
    ├── styles/
    │   ├── tokens.css         # 设计令牌：深色默认 + [data-theme=light] 覆盖
    │   └── base.css           # reset、控件基类、安全区、reduced-motion
    ├── stores/ui.ts           # 主题（localStorage 持久化）与在线状态
    ├── components/
    │   └── UpdatePrompt.vue   # PWA 新版本 / 离线就绪提示
    └── views/
        └── BootView.vue       # 基座自检页（明确标注未接线功能）
```

## 设计系统

- **深色默认**：`:root` 定义冷调深蓝底 + 单一青色强调；`[data-theme="light"]` 覆盖为浅色。
- 切换由 `useUiStore().toggleTheme()` 驱动，写入 `document.documentElement.dataset.theme`，
  偏好存 `localStorage["aether.theme"]`（存储不可用时退化为内存态，不报错）。
- iPhone 优先：`viewport-fit=cover`、`env(safe-area-inset-*)`、最小 44px 点击区域、
  `overscroll-behavior-y: none`、`prefers-reduced-motion` 降级。
- 无第三方 UI 库、无渐变噪点，原创极简科技风；组件样式均 scoped。

## PWA 与安全边界

- `registerType: "prompt"`：新版本由用户确认后切换，避免加密同步中途被强制刷新
  （M0 F2：重启语义应新建客户端实例并复用加密存储前缀）。
- **Service Worker 只预缓存应用外壳静态资源**；`navigateFallbackDenylist` 排除
  `/_matrix/*` 与 `/invite-api/*`，`runtimeCaching: []`。
  即：**Matrix API 响应、注册令牌、密文事件一律不进入 SW 缓存**。
- 通知内容仅「有新消息」、iOS 需用户手势授权等属于 M5，当前未实现。
- WASM：`assetsInclude: ["**/*.wasm"]`；运行时资源路径须显式固定
  （M0 F4：打包器重写 `import.meta.url` 曾导致 404），在接入 `initRustCrypto` 时落地。

## 准入语义（与后端一致）

M1-R1 起**注册人数不设上限**，一次性邀请码是唯一准入控制。前端不得内置「四人」
相关 UI 文案或人数限制；详见 `docs/M1-AMENDMENT-UNLIMITED.md`。

## 待办（M2 后续，按顺序）

1. `MatrixService`：`loginWithPassword` → 用返回的 `device_id` 重建 client →
   `initRustCrypto({useIndexedDB, cryptoDatabasePrefix, storageKey})` → sync 生命周期；
   发送前等待对端设备可见（M0 F1）、解密轮询（F3）、UTD 重试、前台补同步。
2. 登录 / 邀请码注册 / 会话列表 / 私聊群聊 / 时间 / 发送状态 / 已读 / 回复 / 撤回 / 搜索。
3. 单元测试 + 双浏览器 Playwright E2E（真实 Synapse、多设备 E2EE 往返、服务器侧密文证明）。

> 遇到 SDK API 不确定时**必须停下查安装版 `.d.ts` / 官方文档并明确报告**，不得凭记忆编写。
