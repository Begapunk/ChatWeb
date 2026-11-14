# M2 演示版（Demo）交付与验收报告

> 日期：2026-11-14 · 执行：主理人自行完成（用户已通知 Codex 子 Agent 当前不可用，全程未调用）
> 触发：用户要求「把 M2 完成，做出一个 demo 版本能让我试用一下」
> 结论：**可交互的演示版界面已交付并通过 36/36 浏览器烟测；真实加密链路未实现，本报告不宣称 M2 完成。**
>
> **⚠️ 历史阶段快照（2026-11-14 最终更新）**：本报告记录的是 demo 阶段交付，
> 下表中「MatrixService / E2EE 未接线、双浏览器 E2EE 未执行、M2 未完成」均为**当时的事实**。
> 此后 **M2 真实加密链路（M2-R）已实现并通过安全阻断门禁**：`npm run e2e:live` 32/32 ×3、
> 单测 21/21、本 demo 回归仍 36/36、`typecheck` / `build` 通过；
> 服务器侧实证本次新事件只有 `m.room.encrypted` 密文。
> **现行权威状态见 [`M2-LIVE-REPORT.md`](M2-LIVE-REPORT.md) 与 `README.md`**。
> 演示模式本身仍保留且不联网、不加密，本报告对「演示模式不可用于真实私密通讯」的边界声明持续有效。

---

## 1. 交付范围与边界（先说清楚不是什么）

用户要的是「能试用一下」的 demo。本次交付的是**纯前端界面演示**，用于验证交互、布局、
视觉与信息架构，不是可用的加密通讯工具。

| 项 | 状态 |
|---|---|
| 可交互聊天界面（会话列表 / 私聊 / 群聊 / 输入 / 回复 / 撤回 / 表情 / 附件 / 语音占位 / 搜索 / 设置） | ✅ 已交付，浏览器实测 |
| 登录页 / 邀请码注册页（表单交互与布局） | ✅ 已交付，浏览器实测 |
| 深色默认 + 浅色切换、iPhone 优先布局、PWA 外壳与离线提示 | ✅ 已交付，浏览器实测 |
| 连接 Synapse / 真实登录 / 注册令牌 / 自动入房 | ❌ **未接线** |
| `matrix-js-sdk` 调用、`initRustCrypto()`、Rust Crypto WASM、任何密钥 | ❌ **未接线、未产生** |
| 端到端加密、密钥备份恢复、跨签名设备验证、Web Push、通话 | ❌ **未实现** |
| 双浏览器 E2EE 往返、服务器侧密文证明 | ❌ **未执行**（属 M2 剩余工程门禁） |

数据来源：`frontend/src/data/demo.ts` 的本地模拟数据 + `frontend/src/stores/chat.ts`
内存状态层。**消息只存在浏览器内存中，刷新即清空**；不写 localStorage、不发网络请求、
不持久化任何凭据。

`frontend/src/services/matrix.ts` 显式声明真实链路状态：

```ts
export const matrixServiceStatus = {
  implemented: false,
  connected: false,
  e2ee: false,
  reason: "演示模式：未连接 Synapse、未初始化 Rust Crypto WASM，消息为本地模拟数据",
} as const;
```

界面上「已验证设备」「加密」等字样仅为**未来目标状态的布局占位**；安全中心与演示徽章
均明确写出「端到端加密：未接线」「这不是真实加密通讯」，避免把占位伪装成完成。

## 2. 环境与构建门禁

| 项 | 实测 |
|---|---|
| Node / npm | v22.22.2 / 10.9.7 |
| 浏览器 | 本机 `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 测试视口 | 390×844 @2x，`isMobile`/`hasTouch`，`zh-CN`（iPhone 优先） |
| 类型检查 | `npm run typecheck`（`vue-tsc --noEmit`）**exit 0** |
| 生产构建 | `npm run build` **exit 0**；64 modules；JS 136.76 kB（gzip 51.70）/ CSS 27.68 kB（gzip 5.63） |
| PWA 产物 | `dist/sw.js`、`dist/workbox-2fbc6a65.js`、`dist/manifest.webmanifest`、`dist/icons/icon.svg`；precache 7 项（167.39 KiB） |
| 新增测试依赖 | `playwright-core 1.65.1`（精确锁定，已入 `package-lock.json`） |

Service Worker 仍保持 M2 脚手架的安全边界：`registerType: "prompt"`、
`navigateFallbackDenylist` 排除 `/_matrix/*` 与 `/invite-api/*`、`runtimeCaching: []`，
**API 响应 / 注册令牌 / 密文事件不进入 SW 缓存**（当前 demo 根本不发这些请求）。

## 3. 浏览器烟测（真实 Chrome，36/36）

脚本：`frontend/e2e/demo-smoke.mjs`；命令 `npm run smoke`；
结果 JSON 与三张截图落在 `.tmp-gen/m2-demo/`（已 gitignore）。

| 编号 | 断言 | 结果 |
|---|---|---|
| S01 | 首页 HTTP 200 | ✅ |
| S02 | manifest 可访问且 `name=Aether` / `display=standalone` | ✅ |
| S03 | `sw.js` 产物可访问 | ✅ |
| S04 | 聊天深链 `/chat/:roomId` SPA fallback 200 | ✅ |
| S05 | 会话列表渲染（`h1=消息`，4 个会话） | ✅ |
| S06 | 演示数据含群聊「Aether 小队」与私聊「林澈」 | ✅ |
| S07 | 「演示模式」徽章常驻可见 | ✅ |
| S08 | 徽章说明明确写出「没有端到端加密」 | ✅ |
| S09 | 底部导航 3 个入口 | ✅ |
| S10 | 深色 → 浅色 → 深色切换（`data-theme`） | ✅ `dark→light→dark` |
| S11 | 点击会话进入聊天页 | ✅ `/chat/!team:aether.local` |
| S12 | 聊天页标注「E2EE 未接线 / 未联网、未加密」 | ✅ |
| S13 | 输入区提示「消息不会离开此浏览器」 | ✅ |
| S14 | 发送文本 → 气泡出现 | ✅ |
| S15 | 状态流转 `sending → sent → delivered → read` | ✅ |
| S16 | 模拟自动回复到达 | ✅ `rows 11 → 13` |
| S17 | 文件附件占位消息 | ✅ `示例文档.pdf` |
| S18 | 语音消息波形占位 | ✅ `voice bubbles=2` |
| S19 | 回复 → 引用预览 | ✅ |
| S20 | 取消回复 → 预览消失 | ✅ |
| S21 | 表情反应可添加 | ✅ `✓ 1` |
| S22 | 撤回 → 「此消息已撤回」 | ✅ `revoked 1 → 2` |
| S23 | 返回按钮回到会话列表 | ✅ |
| S24 | 搜索「加密」命中结果 | ✅ `找到 1 条消息` |
| S25 | 点击搜索结果跳回聊天 | ✅ |
| S26 | 安全中心「端到端加密：未接线」 | ✅ |
| S27 | 未实现清单如实列出 4 项 | ✅ |
| S28 | 设备页演示验证动作 | ✅ |
| S29 | 通用页开关可切换 | ✅ `true → false` |
| S30 | 登录页邀请码过短提示 | ✅ |
| S31 | 有效长度邀请码进入演示首页 | ✅ |
| S32 | Service Worker 已注册 | ✅ `registrations=1` |
| **S33** | **全程未请求 `/_matrix/` `/invite-api/` `/_synapse/`** | ✅ `requests=28, forbidden=0` |
| **S34** | **全程未请求任何外部域名** | ✅ `external=0` |
| S35 | 无未捕获页面异常 | ✅ |
| S36 | 无 console error | ✅ |

S33/S34 是本次 demo 最关键的安全断言：**用真实请求日志证明 demo 只在本机浏览器内运行**，
不会偷偷连到 M1 服务端或任何第三方，也不会把演示表单内容发出去。

## 4. 烟测发现的真实缺陷与修复

首轮烟测并非全绿：S14–S22、S24 共 10 项失败，S25–S36 因默认 30s 点击超时累计而中断。

**根因（产品缺陷，非测试脚本问题）**：`UpdatePrompt.vue` 中「已可离线使用」提示是
`position: fixed; bottom: 20px` 的常驻浮层，`z-index: 50`，宽度接近全屏。在 390px 视口下
它正好压住底部输入区与导航栏，Playwright 日志明确记录
`<span class="prompt__text">已可离线使用</span> ... intercepts pointer events`，
真实用户同样点不到「发送」「文件」「语音」和底部 tab。

**修复**（`frontend/src/components/UpdatePrompt.vue`）：

1. 信息性的「已可离线使用」改为**顶部、3.2 秒自动消失**的 toast，且 `pointer-events: none`
   —— 不参与命中测试；
2. 只有 `needRefresh`（有新版本）才显示带「更新 / 关闭」的浮层，容器同样
   `pointer-events: none`，仅按钮 `pointer-events: auto`；
3. 浮层上移到 `bottom: calc(74px + safe-bottom)`，避开底部导航；
4. 定时器在组件卸载时清理，避免泄漏。

同时把烟测的 `page.setDefaultTimeout` 从 Playwright 默认 30s 收紧到 10s，
让遮挡/死链类缺陷快速暴露而不是把整轮测试拖到超时。

重新构建后复跑：**36/36 通过，0 失败**，见 `.tmp-gen/m2-demo/demo-smoke.json`。

## 5. 试用方法

```bash
cd frontend
npm ci                         # 禁用 --prefer-offline（见 frontend/README.md）
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
# 浏览器打开 http://127.0.0.1:4173
```

复跑烟测（需预览服务在运行）：

```bash
cd frontend
npm run smoke
# 可用 AETHER_SMOKE_URL / AETHER_CHROME_PATH 覆盖地址与 Chrome 路径
# 本机 NODE_USE_ENV_PROXY 会劫持 Node fetch，需清除代理 env：
#   env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY npm run smoke
```

入口默认直接进会话列表（演示模式默认已「登录」）；登录/邀请码注册页可从
`/login` 访问，或从「设置 → 关于」退出演示后进入。

## 6. 截图证据

| 文件 | 内容 |
|---|---|
| `.tmp-gen/m2-demo/01-conversations.png` | 会话列表、演示徽章、底部导航（深色） |
| `.tmp-gen/m2-demo/02-chat.png` | 群聊、消息气泡、附件/语音/撤回态、输入区与安全横幅 |
| `.tmp-gen/m2-demo/03-security.png` | 安全中心：E2EE 未接线 + 4 项待实现清单 |

三张图均为 390×844 @2x 真实 Chrome 渲染，已人工核对无明显重叠、裁切或对比度问题。

## 7. 本次改动文件

**新增**
`frontend/src/types.ts`、`frontend/src/data/demo.ts`、`frontend/src/stores/chat.ts`、
`frontend/src/services/matrix.ts`、`frontend/src/router/index.ts`、
`frontend/src/components/{Avatar,DemoBadge,MessageBubble,Composer}.vue`、
`frontend/src/views/{Login,Conversations,Search,Chat,Settings}View.vue`、
`frontend/e2e/demo-smoke.mjs`、`docs/M2-DEMO-REPORT.md`。

**修改**
`frontend/src/App.vue`（演示外壳：演示徽章 + 底部导航 + 聊天页全屏布局）、
`frontend/src/main.ts`（接入 `src/router`）、
`frontend/src/components/UpdatePrompt.vue`（缺陷修复）、
`frontend/package.json`（`0.4.0`、`smoke` 脚本、`playwright-core 1.65.1`）、
`frontend/package-lock.json`、`frontend/README.md`、`README.md`、`CHANGELOG.md`、
`TODO.md`、`docs/M2-KICKOFF-CHECK.md`、`docs/DEPENDENCIES.md`。

**删除**
`frontend/src/views/BootView.vue`（脚手架自检页，路由已不再引用，内容宣称「功能未接线」已过时）。

## 8. M2 剩余工程（未完成，不得宣称完成）

1. **MatrixService**：先核对安装版 `matrix-js-sdk 45.1.0` 的 `.d.ts` 再写实现 ——
   `loginWithPassword` → 用返回的 `device_id` 重建 `createClient` →
   `initRustCrypto({useIndexedDB, cryptoDatabasePrefix, storageKey})` → sync 生命周期；
   发送前等待对端设备可见（M0 F1）、timeline 早于解密的轮询（F3）、UTD 重试、
   前台补同步、WASM 资源路径显式固定（F4）。
2. 把 demo 的 Pinia 状态层替换为真实 SDK 事件源：登录/邀请码注册对接
   `/invite-api/v1/verify` + 注册令牌 UIA 流程、自动入房、会话/消息/已读/撤回/搜索。
3. **双浏览器 E2E**：真实 Synapse 往返、服务器侧仅存 `m.room.encrypted` 密文证明、
   第三方无密钥无法解密、刷新后密钥恢复 —— 通过后才可声称聊天功能可用。
4. 单元测试（Vitest 5.1.0 已安装但尚无用例）、Web Push（M5）、通话（M6）等后续里程碑。

> 遇到 SDK API 不确定时必须停下查安装版 `.d.ts` / 官方文档并明确报告，不得凭记忆编写。
