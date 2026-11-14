# Aether 前端（Vue 3 PWA）

> **状态（2026-11-14）：演示版（Demo）界面已交付，`typecheck` / `build` / 浏览器烟测 36/36 通过。**
> 这是**纯前端界面演示**：不连 Synapse、不调用 `matrix-js-sdk`、不初始化 Rust Crypto WASM、
> 不产生任何密钥，消息只在浏览器内存中、刷新即清空。
> **不是端到端加密通讯工具，也不代表 M2 已完成。** 详见 [`docs/M2-DEMO-REPORT.md`](../docs/M2-DEMO-REPORT.md)。

## 快速试用

```bash
cd frontend
npm ci                                   # 禁用 --prefer-offline，见下方「安装注意」
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
# 浏览器打开 http://127.0.0.1:4173
```

首页直接是会话列表（演示模式默认已「登录」）。可以试：

- 点任意会话进入聊天；输入文字发送，观察 `发送中 → 已发送 → 已送达 → 已读` 与模拟自动回复；
- hover（触屏直接可见）消息，试「回复」「✓ 表情」「撤回」；
- 底部「图片 / 文件 / 语音」插入占位消息；右上角 `···` 置顶 / 静音；
- 底部导航切「搜索」「设置」；设置里有通用 / 通知 / 设备 / **安全** / 资料 / 关于六个分页；
- 顶栏「演示模式」点开看安全声明；「浅色 / 深色」切主题；
- `/login` 可看登录与邀请码注册表单（不校验凭据、不创建账号）。

安全中心明确列出 **MatrixService、密钥备份恢复、跨签名设备验证、双浏览器 E2EE 回归**
四项「待实现」，界面里「已验证设备」「加密」等字样只是布局占位。

## 技术栈（精确锁定，无 `^`/`~`）

| 组件 | 版本 | 说明 |
|---|---|---|
| vue | 3.5.45 | |
| vue-router | 5.5.1 | |
| pinia | 4.1.0 | |
| vite | 8.3.8 | |
| @vitejs/plugin-vue | 6.0.11 | |
| vite-plugin-pwa | 2.0.0 | Manifest / SW / 更新提示 |
| **typescript** | **5.9.3** | M2 开工首检修订：7.0.2 与 `vue-tsc 3.3.14` 不兼容（`ERR_PACKAGE_PATH_NOT_EXPORTED`），见 `docs/M2-KICKOFF-CHECK.md` |
| vue-tsc | 3.3.14 | |
| vitest | 5.1.0 | 已安装，尚无用例（M2 剩余） |
| playwright-core | 1.65.1 | 真实 Chrome 浏览器烟测 |
| matrix-js-sdk | 45.1.0 | 精确绑定 `crypto-wasm 18.9.2`（**不得单独升级**）；当前 demo 未调用 |

## 命令

```bash
npm run typecheck      # vue-tsc --noEmit
npm run build          # typecheck + vite build（dist/、sw.js、manifest.webmanifest）
npm run dev            # 开发服务器（PWA devOptions 关闭）
npm run preview        # 预览生产构建
npm run smoke          # 真实 Chrome 烟测（需 preview 在 4173 运行）
npm test               # vitest run（暂无用例）
```

烟测可覆盖：`AETHER_SMOKE_URL`（默认 `http://127.0.0.1:4173`）、
`AETHER_CHROME_PATH`（默认本机 Chrome）。结果 JSON 与截图写入 `.tmp-gen/m2-demo/`（已 gitignore）。

**本机代理踩坑**：`NODE_USE_ENV_PROXY` 会劫持 Node `fetch`，导致烟测访问 localhost 异常。
复跑时清除代理 env：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NODE_USE_ENV_PROXY npm run smoke
```

**安装注意**：首轮 `npm install --prefer-offline` 报
`ETARGET No matching version found for @vitest/mocker@5.1.0`。`npm view` 核实该版本
在 registry 确实存在，是离线优先读取过期 packument 所致；改 `--prefer-online` 后成功。
**本工程禁用 `--prefer-offline`**。

## 已验证（真实执行，2026-11-14）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | `vue-tsc --noEmit` exit 0 |
| `npm run build` | exit 0；64 modules；JS 136.76 kB / CSS 27.68 kB；precache 7 项 |
| `npm run smoke` | **36/36 通过，0 失败**（真实 Chrome，390×844 @2x） |
| 安全断言 S33/S34 | 全程 28 个请求，**0 个** 命中 `/_matrix/`、`/invite-api/`、`/_synapse/`，**0 个** 外部域名 |
| 运行期 | 0 个未捕获异常、0 个 console error |

## 目录

```
frontend/
├── index.html                  # viewport-fit=cover + iOS 主屏幕 meta
├── vite.config.ts              # VitePWA（prompt 更新策略 / SW 缓存红线）
├── tsconfig.json
├── package-lock.json           # 入库，保证可复现
├── public/icons/icon.svg       # 原创标记
├── e2e/demo-smoke.mjs          # 36 项真实 Chrome 烟测
└── src/
    ├── main.ts                 # app / Pinia / Router 装配
    ├── App.vue                 # 演示外壳：顶栏、演示徽章、底部导航、聊天全屏布局
    ├── router/index.ts         # login / conversations / chat / search / settings
    ├── types.ts                # Message / Conversation / Contact / DeviceItem …
    ├── data/demo.ts            # 纯本地演示数据与时间格式化
    ├── services/matrix.ts      # 真实链路状态占位（implemented=false）
    ├── stores/
    │   ├── ui.ts               # 主题持久化 + 在线状态
    │   └── chat.ts             # 演示态：内存消息、发送/回复/撤回/表情/模拟回信
    ├── styles/                 # tokens.css（深/浅）+ base.css（reset、安全区、动效降级）
    ├── components/
    │   ├── Avatar.vue
    │   ├── DemoBadge.vue       # 「演示模式」+ 明确否认 E2EE 的说明面板
    │   ├── MessageBubble.vue   # 文本/图片/文件/语音、回复引用、撤回态、状态、表情
    │   ├── Composer.vue        # Enter 发送、回复预览、附件/语音入口
    │   └── UpdatePrompt.vue    # PWA 离线 toast / 新版本提示（点击穿透修复）
    └── views/
        ├── LoginView.vue       # 登录 / 邀请码注册（表单演示）
        ├── ConversationsView.vue
        ├── ChatView.vue
        ├── SearchView.vue
        └── SettingsView.vue
```

## 设计系统

- **深色默认**：`:root` 冷调深蓝底 + 单一青色强调；`[data-theme="light"]` 覆盖为浅色。
- 切换由 `useUiStore().toggleTheme()` 驱动，写 `document.documentElement.dataset.theme`，
  偏好存 `localStorage["aether.theme"]`（存储不可用时退化为内存态）。
- iPhone 优先：`viewport-fit=cover`、`env(safe-area-inset-*)`、44px 最小点击区、
  `overscroll-behavior-y: none`、`prefers-reduced-motion` 降级。
- 无第三方 UI 库，原创极简科技风；组件样式均 scoped。

## PWA 与安全边界

- `registerType: "prompt"`：新版本由用户确认后切换，避免未来加密同步中途被强制刷新。
- **SW 只预缓存应用外壳静态资源**；`navigateFallbackDenylist` 排除 `/_matrix/*` 与
  `/invite-api/*`，`runtimeCaching: []` —— API 响应、注册令牌、密文事件不进 SW 缓存。
- 离线就绪提示为顶部 3.2s 自动消失的不可点击 toast（曾因常驻浮层遮挡输入区被烟测抓到，已修复）。
- 通知只显示「有新消息」、iOS 主屏幕授权等属于 M5，未实现。
- WASM 路径显式固定（M0 F4）将在接入 `initRustCrypto` 时落地。

## 准入语义（与后端一致）

M1-R1 起**注册人数不设上限**，一次性邀请码是唯一准入控制。前端不得内置「四人」
相关 UI 文案或人数限制；详见 `docs/M1-AMENDMENT-UNLIMITED.md`。

## M2 剩余（按顺序）

1. `MatrixService`：先核对安装版 `.d.ts` → `loginWithPassword` → 用返回 `device_id`
   重建 client → `initRustCrypto({useIndexedDB, cryptoDatabasePrefix, storageKey})` →
   sync 生命周期；发送前等待对端设备可见（M0 F1）、解密轮询（F3）、UTD 重试、前台补同步。
2. 把演示状态层换成真实 SDK 事件源：邀请码校验 / 注册令牌 UIA / 自动入房 / 消息与已读。
3. 单元测试 + 双浏览器 Playwright E2E（真实 Synapse、多设备 E2EE 往返、服务器侧密文证明）。

> 遇到 SDK API 不确定时**必须停下查安装版 `.d.ts` / 官方文档并明确报告**，不得凭记忆编写。
