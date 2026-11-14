# Aether 前端（Vue 3 PWA）

> **状态（2026-11-14）：M2 真实加密链路已实现并通过双浏览器 E2EE 安全阻断门禁。**
> `npm run e2e:live` **32/32 ×3 连续通过**、单元测试 **21/21**、演示模式回归 **36/36**、
> `typecheck` / `build` 均通过。服务器侧实证本次新事件只有 `m.room.encrypted`（Megolm 密文）。
> 权威报告：[`docs/M2-LIVE-REPORT.md`](../docs/M2-LIVE-REPORT.md)。
>
> **两种模式，UI 显式区分**：
> - **live（真实链路）**：连真实 Synapse + `matrix-js-sdk 45.1.0` + Rust Crypto WASM 18.9.2，
>   设备端 Megolm 端到端加密，服务器只见密文。
> - **demo（演示模式）**：纯内存假数据，不联网、不产生密钥、刷新即清空；**不是加密通讯工具**。
>
> ⚠️ **M3+ 尚未实现**：密钥备份/恢复、跨签名设备验证、加密附件、Web Push、通话。
> 因此清除浏览器数据会**永久失去本设备解密密钥**；凭据只在内存，刷新需重新连接服务器
> （UI 会明确提示，不静默回退演示数据）。**当前版本不可作为正式私密通讯工具发布。**

## 快速试用

### 只试界面（demo，无需 Docker）

```bash
cd frontend
npm ci                                   # 禁用 --prefer-offline，见下方「安装注意」
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
# 浏览器打开 http://127.0.0.1:4173 → 默认演示模式；或 /login 点「进入演示」
```

首页直接是会话列表。可以试：会话列表 / 私聊群聊、输入文字发送（模拟状态与自动回复）、
回复 / 撤回 / 表情、图片文件语音占位、搜索、设置六分页、主题切换、顶栏「演示模式」安全声明。

### 试真实加密链路（live，需 M1 本地栈 + 管理员发码）

前置：项目根目录的 M1 本地栈运行中

```bash
# 项目根目录
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
# 用 X-Admin-Key 生成一次性邀请码（裸码仅返回一次）
curl -X POST http://127.0.0.1:8000/admin/v1/codes -H "X-Admin-Key: …" -d '{"ttl_hours":72}'
```

```bash
cd frontend
npm ci                                   # postinstall 自动准备 WASM 到 public/wasm/
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
# 浏览器打开 http://127.0.0.1:4173/login → 选「连接真实服务器」→ 邀请码注册或口令登录
```

前端只使用**相对路径** `/_matrix/*` 与 `/invite-api/*`：生产由 Caddy 同源路由，
本地 dev/preview 由 Vite 代理到本地 Caddy（`secure:false` **仅作用于这两条本地代理**，
不是全局关闭 TLS 校验）。浏览器永远接触不到 `/_synapse/admin` 与邀请服务管理端点。

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
| vitest | 5.1.0 | 单元测试 21/21；独立 `vitest.config.ts`，不复用 VitePWA 插件 |
| playwright-core | 1.65.1 | 真实 Chrome：demo 烟测 36 项 + 双浏览器 E2EE 门禁 32 项 |
| matrix-js-sdk | 45.1.0 | 精确绑定 `crypto-wasm 18.9.2`（**不得单独升级**）；M2-R 起为运行时依赖 |
| @matrix-org/matrix-sdk-crypto-wasm | 18.9.2 | Rust Crypto WASM；`postinstall` 校验版本并复制 `.wasm`（7.43 MiB） |

版本总表见 [`docs/DEPENDENCIES.md`](../docs/DEPENDENCIES.md)。

## 命令

```bash
npm run typecheck      # vue-tsc --noEmit
npm run build          # typecheck + vite build（dist/、sw.js、manifest.webmanifest）
npm run dev            # 开发服务器（含 /_matrix 与 /invite-api 本地代理）
npm run preview        # 预览生产构建（同样含代理）
npm test               # vitest run，21 项单元测试
npm run smoke          # demo 真实 Chrome 烟测 36 项（需 preview 在 4173）
npm run prepare:wasm   # 手动重跑 WASM 资产准备（postinstall 已自动执行）
npm run e2e:live       # 双浏览器 E2EE 安全阻断门禁 32 项（失败 exit 1，需 M1 本地栈 + preview）
```

`e2e:live` 会真实注册两个账号、各自加载 WASM、自动入同一加密房间，A 发送 → B 解密，
再用房间成员管理员 token 读取服务器原始事件做**本次新事件差集**密文证明。
证据写入 `.tmp-gen/m2-live/`（已 gitignore）：逐项 JSON、三张截图、运行日志。

**本机代理踩坑**：`NODE_USE_ENV_PROXY` 会劫持 Node `http`/`fetch`，导致复用连接假 404。
复跑时清除代理 env：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NODE_USE_ENV_PROXY npm run e2e:live
```

测试内已用「仅限该请求」的专用 `https.Agent({rejectUnauthorized:false})` 处理本地自签证书，
**严禁**全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。

**安装注意**：首轮 `npm install --prefer-offline` 报
`ETARGET No matching version found for @vitest/mocker@5.1.0`。`npm view` 核实该版本
在 registry 确实存在，是离线优先读取过期 packument 所致。**本工程禁用 `--prefer-offline`**。
另：`npm --prefix <path> install --package-lock-only` 在本环境会忽略 prefix，须先 `cd frontend`。

## 已验证（真实执行，2026-11-14）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | `vue-tsc --noEmit` exit 0 |
| `npm run build` | exit 0；PWA `sw.js` / `manifest.webmanifest`；WASM 资产经 HTTP 200 可达 |
| `npm test` | **21/21**（Vitest 5.1.0，2 文件） |
| `npm run smoke` | **36/36**（真实 Chrome 390×844 @2x）；S33/S34 证明 demo 不请求 Matrix/邀请 API、不连外部域名 |
| **`npm run e2e:live`** | **32/32 ×3 连续通过，0 失败**；本次新事件 `new=1 encrypted=1`，仅 `m.room.encrypted`、含 ciphertext、无明文 / `session_key` / `body`；4xx 全部属协议预期清单（`unexpected=[]`）；管理端点浏览器侧 404/401 |

4 个验收中真实发现并修复的缺陷（详见 `docs/M2-LIVE-REPORT.md §3`）：
刷新静默回退 demo 假数据（D1）、房间加密状态误报 E2EE（D2）、验收脚本假通过（D3）、
自动入房后 SDK `unconfigured room` 加密竞态（D4）。

## 目录

```
frontend/
├── index.html                  # viewport-fit=cover + iOS 主屏幕 meta
├── vite.config.ts              # VitePWA + /_matrix、/invite-api 本地同源代理
├── vitest.config.ts            # 独立测试配置（不引入 VitePWA 插件）
├── tsconfig.json
├── package-lock.json           # 入库，保证可复现
├── public/
│   ├── icons/icon.svg          # 原创标记
│   └── wasm/                   # postinstall 生成，已 gitignore，不进 precache
│       └── matrix_sdk_crypto_wasm_bg.wasm
├── scripts/prepare-wasm.mjs    # 校验 crypto-wasm 18.9.2 并复制 .wasm
├── e2e/
│   ├── demo-smoke.mjs          # 36 项 demo 真实 Chrome 烟测
│   └── live-e2ee.mjs           # 32 项双浏览器 E2EE 安全阻断门禁
└── src/
    ├── main.ts                 # app/Pinia/Router 装配 + 刷新守卫（D1）
    ├── App.vue                 # 应用外壳：顶栏徽章、底部导航、聊天全屏布局
    ├── router/index.ts         # login / conversations / chat / search / settings
    ├── env.d.ts / types.ts     # 类型；Message.encrypted? 标记密文事件
    ├── data/
    │   ├── demo.ts             # 纯本地演示数据与时间格式化
    │   └── demo.test.ts        # 演示数据单测
    ├── services/
    │   ├── matrix.ts           # MatrixService：WASM/登录/重建client/initRustCrypto/sync/
    │   │                       # 自动入房/加密就绪门禁/密文收发；凭据只在内存
    │   └── matrix.test.ts      # 加密判定、门禁、凭据边界单测
    ├── stores/
    │   ├── ui.ts               # 主题持久化 + 在线状态
    │   └── chat.ts             # 双数据源状态层：demo 内存态 / live 真实 SDK 事件源
    ├── styles/                 # tokens.css（深/浅）+ base.css（reset、安全区、动效降级）
    ├── components/             # Avatar / DemoBadge / MessageBubble / Composer / UpdatePrompt
    └── views/                  # Login / Conversations / Chat / Search / Settings
```

## 设计系统

- **深色默认**：`:root` 冷调深蓝底 + 单一青色强调；`[data-theme="light"]` 覆盖为浅色。
- 切换由 `useUiStore().toggleTheme()` 驱动，写 `document.documentElement.dataset.theme`，
  偏好存 `localStorage["aether.theme"]`（存储不可用时退化为内存态）。
- iPhone 优先：`viewport-fit=cover`、`env(safe-area-inset-*)`、44px 最小点击区、
  `overscroll-behavior-y: none`、`prefers-reduced-motion` 降级。
- 无第三方 UI 库，原创极简科技风；组件样式均 scoped。

## PWA 与安全边界

- `registerType: "prompt"`：新版本由用户确认后切换，避免加密同步中途被强制刷新。
- **SW 只预缓存应用外壳静态资源**；`navigateFallbackDenylist` 排除 `/_matrix/*` 与
  `/invite-api/*`，`runtimeCaching: []` —— API 响应、注册令牌、密文事件不进 SW 缓存。
- **WASM 资产刻意不进 precache**：离线时不误导用户以为能收发加密消息；
  路径由 `initAsync(new URL("/wasm/...", origin))` 显式固定（M0 F4）。
- 离线就绪提示为顶部 3.2s 自动消失的不可点击 toast（曾因常驻浮层遮挡输入区被烟测抓到，已修复）。
- **凭据边界**：`access_token` / `device_id` / 口令 / `storageKey` 只在内存，不写 localStorage；
  `sessionStorage` 仅写一个非敏感布尔标记用于刷新守卫。整页刷新会强制回登录页并说明原因。
- `storageKey` = PBKDF2-SHA256 / 150k 轮 / 256bit，salt 与 `cryptoDatabasePrefix` 绑定 userId。
- 通知只显示「有新消息」、iOS 主屏幕授权等属于 M5，未实现。

## 准入语义（与后端一致）

M1-R1 起**注册人数不设上限**，一次性邀请码是唯一准入控制。前端不得内置「四人」
相关 UI 文案或人数限制；详见 `docs/M1-AMENDMENT-UNLIMITED.md`。

## 边界 / 后续里程碑（不宣称完成）

| 里程碑 | 内容 |
|---|---|
| M3 | 密钥备份/恢复（SSSS + 恢复密钥）、跨签名设备验证、设备撤销、清数据前强警告 |
| M4 | `EncryptedFile` 加密图片/文件/语音、语音录制、与 Element 互操作 |
| M5/M6 | Web Push、iOS 真机 PWA 验证、MatrixRTC/LiveKit 通话媒体 E2EE |
| M7 | 发布门禁、账号数监控（R2.6）、完整运维文档 |

live 模式下点击附件 / 语音 / 设备验证会明确提示「属于 M3/M4 未实现」，**不会发送明文附件，
也不插入假消息**。凭据只在内存 → 刷新必须重新连接服务器；
要实现「刷新免重登」需先完成 M3 密钥备份/恢复再设计，当前不做。

> 遇到 SDK API 不确定时**必须停下查安装版 `.d.ts` / 源码并明确报告**，不得凭记忆编写
> （M2-R 的实证核对表见 `docs/M2-LIVE-REPORT.md §2` 与 `docs/DEPENDENCIES.md §7`）。
> TLS（Caddy 到浏览器）与 DTLS（未来的 SRTP）都**不等价于端到端加密**。
