# M2 真实链路（M2-R）交付与安全验收报告

> 日期：2026-11-14 · 执行：主理人自行完成（用户已通知 Codex 子 Agent 当前不可用，全程未调用）
> 触发：用户要求「继续，完全实现 M2」
> 结论：**M2 真实加密链路已实现并通过安全阻断门禁。`npm run e2e:live` 连续三次 32/32 通过，
> 单元测试 21/21、demo 回归 36/36、`typecheck` / `build` 均通过。**
> 服务器侧实证：本次发送产生的事件只有 `m.room.encrypted`（Megolm 密文），无任何明文。
>
> **本报告不宣称 M3+ 功能完成**：密钥备份/恢复、跨签名设备验证、加密附件/通话、
> Web Push 仍按 `TODO.md` 留在后续里程碑，live 模式下会显式提示「未实现」，不插入假数据。
>
> **2026-11-15 现行状态通告**：以上为 M2-R 交付当时（2026-11-14）的边界快照，原文保留可追溯。
> 此后 **M3 的 4S 恢复密钥、跨签名、真实设备列表/撤销与 SAS 代码已实现**，live 模式不再提示
> 「M3 未实现」；但真实安全门禁 `npm run e2e:m3` 因本机 Docker Linux 引擎阻断**尚未执行**，
> M3 仍不得宣称完成。现行状态一律以 [`docs/M3-REPORT.md`](M3-REPORT.md) 为准。

---

## 1. 从 demo 到真实链路：改了什么

演示版（`docs/M2-DEMO-REPORT.md`）是纯内存假数据；本次把数据源整体切换为真实
Synapse + `matrix-js-sdk 45.1.0` + Rust Crypto WASM 18.9.2，同时**保留演示模式**作为
无需 Docker 的界面试用入口。两种模式在 UI 上有显式区分，不会混淆。

| 能力 | 实现 |
|---|---|
| 邀请码注册 | `/invite-api/v1/verify` 换短时效注册令牌 → Synapse UIA 逐阶段提交（与 M1 `registerWithToken` 同构） |
| 登录 | `loginWithPassword` → 用返回 `device_id` **重建** client 后再 `initRustCrypto`（M0 事实 9） |
| 加密存储 | `initRustCrypto({ useIndexedDB, cryptoDatabasePrefix, storageKey })`；`storageKey` = PBKDF2-SHA256 / 150k 轮 / 256bit，salt 绑定 userId；前缀绑定 userId，同账号同口令重启可复用 |
| WASM | `postinstall` 从 lockfile 锁定的 `node_modules` 复制到 `public/wasm/`，运行时 `initAsync(new URL("/wasm/...", origin))` 固定路径（M0 F4） |
| 自动入房 | 邀请服务轮询发 invite → 客户端每 1.5s 检查并 `joinRoom`（幂等、失败可重试） |
| 会话/消息 | 由 SDK `getRooms()` / `Room.timeline` 驱动；900ms 轮询复核解密完成后的变化（M0 F3） |
| 发送 | **加密就绪门禁** + `sendEvent`（SDK 自动 Megolm 加密），见 §3 |
| 回复 / 撤回 / 已读 / 搜索 / 置顶 / 静音 | 真实 `m.relates_to` / `redactEvent` / `sendReadReceipt`；搜索与本地覆盖基于已解密时间线 |
| 凭据边界 | `access_token` / `device_id` / 口令 / `storageKey` **只在内存**；不写 localStorage；`sessionStorage` 只存一个非敏感布尔标记 |

前端只使用相对路径 `/_matrix/*` 与 `/invite-api/*`：生产由 Caddy 同源路由，本地 dev/preview
用 Vite 代理到本地 Caddy（`secure:false` 仅作用于这两条本地代理，不是全局关闭 TLS 校验）。
Service Worker 明确排除这两组 API 路径，WASM 不进 precache。

---

## 2. SDK API 实证核对（红线：不确定必须查安装版 `.d.ts` / 源码）

| API | 证据 | 结论 |
|---|---|---|
| `initAsync(url?: URL \| string)` | `crypto-wasm/index.d.ts:49` | 传 `URL` 对象合法 |
| `initRustCrypto({ storageKey?: Uint8Array })` | `client.d.ts:1178-1203` | storageKey 须恰好 32 字节，与 PBKDF2 256bit 一致 |
| `getUserDeviceInfo(ids, downloadUncached?)` | `crypto-api/index.d.ts:184` + 文档 | **默认 false：未跟踪用户根本不出现在结果 map**；已改传 `true` |
| `isEncryptionEnabledInRoom(roomId)` | `crypto-api/index.d.ts:88`、`rust-crypto.js:292-295` | 读 `OlmMachine.getRoomSettings`，正是加密层就绪的权威判定 |
| `Cannot encrypt event in unconfigured room` | `rust-crypto.js:170-176` | `roomEncryptors[roomId]` 不存在时抛出，消息**不会到达服务器** |
| `onCryptoEvent` 建立时机 | `sync.js:1202-1212`（源码注释本身点明竞态） | 只在 sync 处理 `m.room.encryption` 状态事件时建立 RoomEncryptor |
| `ClientEvent.Sync === "PREPARED"` | `sync.d.ts:14` | 与 M1 `helpers.makeDevice` 一致 |
| `getStateEvents(type, stateKey)` | `room-state.d.ts:217-224` | 双参数返回单个事件或 null，用于严格判定房间加密 |
| `getWireType` / `getWireContent` / `isDecryptionFailure` | `models/event.d.ts:349,400,504` | 用于区分「服务器原始密文」与「本地解密结果」 |

M0 F7「非成员管理员读事件 404」已复核：本验收用**房间创建者（成员）**的管理员 token
读取 `/rooms/{id}/messages` 原始事件，实测 200；该客户端从未 `initRustCrypto`，
因此拿不到 Megolm 会话密钥，只能读到密文——符合最小权限且能完成密文证明。

---

## 3. 验收过程中发现并修复的 4 个真实缺陷

不是「测试没过就放宽断言」，每一条都先定位根因、查证 SDK 源码/类型定义，再改产品或验收逻辑。

### D1 整页刷新后静默回退演示假数据（安全问题）
`matrixServiceStatus` 是模块级内存态。整页刷新或重新打开页面会丢失真实会话，
原实现会**静默显示 demo 假会话**，用户可能误以为仍在加密会话中。

修复：`sessionStorage` 仅写一个非敏感布尔标记 `aether.live-session=1`（无 token/口令/密钥）；
`main.ts` 加一次性导航守卫，检测到「曾建立 live 会话但当前无连接」时清除标记、
强制回 `/login?reason=session-expired`，登录页显示醒目警告说明凭据只在内存、
演示数据不是真实会话。主动断开/登出时清除标记。
验收 L19/L20/L20b 实证刷新后提示存在、假会话列表 `count=0`。

### D2 房间加密状态误报 E2EE（安全表述问题）
`getConversations()` 原用 `Boolean(encEvent) || client.getCrypto() !== undefined`，
只要加密层就绪就把**任何**房间标成 `encrypted`，包括未启用加密的房间——
等于把「客户端具备加密能力」误报为「本会话已端到端加密」。

修复：严格只依据 `m.room.encryption` 状态事件判定；单元测试专门断言
「crypto 层就绪但无状态事件 → `encrypted === false`」。

### D3 验收脚本「假通过」（安全门禁有效性问题）
旧 L12–L15 只判断「房间存在任意 `m.room.encrypted` 事件」，而该房间已有 M1 留下的
历史密文，即使本次消息根本没发出也会通过。

修复：发送前取服务器事件 ID 基线，发送后只取**差集新事件**做断言：
`L12` 新事件含 `m.room.encrypted`、`L13` 算法为 `m.megolm.v1.aes-sha2` 且有 ciphertext、
`L13b` 无明文 `m.room.message`、`L14/L14b` 不含明文、`L15/L15b` 不含 `session_key` / `body`。
另新增 L07b：等待服务器 `joined_members` 确认两个账号都已加入（真实业务前置条件）。

### D4 自动入房后的加密竞态（真实功能缺陷，L10 超时根因）
首次验收 L01–L09b 全过、L10「B 解密」超时。带现场取证的双浏览器诊断显示：
A 端 console 报 `Cannot encrypt event in unconfigured room`，服务器侧本次新事件
**只有 `m.room.member`、没有任何 `m.room.encrypted`** → 消息根本没发出。
诊断另一次运行却成功，说明是时序竞态而非加密能力缺失。

根因（SDK 源码实证）：`roomEncryptors[roomId]` 由 `sync.js` 在处理 `m.room.encryption`
状态事件时通过 `onCryptoEvent()` 建立；客户端刚 `joinRoom()` 自动入房后，
必须等下一次 `/sync` 把 state 交给 Rust Crypto 层。在此之前 `encryptEvent()` 直接抛错。
`sync.js:1202` 的源码注释本身就描述了这个竞态。

修复（产品级，非脚本 sleep）：新增 `waitForEncryptionReady(roomId)`，只用公开 API
`isEncryptionEnabledInRoom()` + `getUserDeviceInfo(peers, true)`，有界等待
① 房间加密配置就绪 ② 成员列表稳定 ③ 有设备的成员数收敛且非零（避免 M0 F1
「对端首次 keys/upload 尚未完成就被视为无设备」）；超时**取消发送**并抛明确错误，
**绝不降级为明文**。`sendText` 仅对 `unconfigured room` 这类明确时序竞态做最多 3 次有界重试。
单元测试覆盖「加密层缺失不调用 `sendEvent`」「超时不发明文」「非竞态错误不重发」。

### 关于 console error 断言
浏览器会把协议预期内的 HTTP 4xx 记成 console error：
`401 POST /_matrix/client/v3/register`（UIA 逐阶段挑战，注册必需）、
`404 GET /_matrix/client/v3/room_keys/version`（尚未配置密钥备份，M3 范围）。
L17 不是简单放宽：先用 `L16b` 严格断言 4xx 集合**完全等于**白名单（无意外失败请求），
再用 `L17b` 断言噪声条数与 4xx 一一对应，最后才放行这些噪声之外的零 console error。
这样 SDK 抛出的 `Error sending event` 仍会被 L17 抓住——D4 正是这样被发现的。

---

## 4. 验收结果（真实执行，非推断）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | exit 0 |
| 生产构建 | `npm run build` | exit 0；PWA `sw.js` / `manifest.webmanifest`，WASM 资产 7.43 MiB 可达 |
| 单元测试 | `npm run test`（Vitest 5.1.0） | **21/21**（2 文件） |
| 演示模式回归 | `npm run smoke` | **36/36**，S33/S34 仍证明 demo 不请求任何 Matrix/邀请 API、不连外部域名 |
| **双浏览器 E2EE 安全门禁** | `npm run e2e:live` | **32/32 ×3 连续通过**（首次 + 两次稳定性复跑，0 失败） |

**收口回归（2026-11-14，文档联动与版本同步之后再次真实执行）**：完成 CHANGELOG / RISKS /
DEPENDENCIES / 历史报告顶部通告 / `frontend/README.md` 版本 0.5.0 同步，以及
`SettingsView.vue` 演示分支文案修正后，全套门禁重跑一次，结果仍为
`typecheck` exit 0、`test` **21/21**、`build` exit 0、`smoke` **36/36**、
`e2e:live` **32/32**（第 4 次通过，0 失败）。同时复核 PWA 安全边界：
`dist/sw.js` 预缓存 9 项、其中 **`wasm` 出现 0 次**（WASM 未进 precache），
而 `/wasm/matrix_sdk_crypto_wasm_bg.wasm` 运行时返回 `200` / 7,790,998 bytes。
提交前机密扫描：暂存 diff 3,594 行，无硬编码凭据、无 env 文件、无 WASM 二进制入库，
凭据一律从已 gitignore 的 `.env.test` 读取。

安全门禁关键证据（L 编号见 `frontend/e2e/live-e2ee.mjs`）：

- L04–L07：两个**独立 Chrome 实例**各自用不同邀请码真实注册并加载 Rust Crypto WASM；
- L07b / L08-A / L08-B：服务器 `joined_members` 确认自动入房完成，两端经 SPA 点击进入同一加密群聊；
- L09：界面显示「真实链路 · Rust Crypto WASM 已就绪 / Megolm E2EE」；
- L10 / L11：B 端解密并看到明文 `Aether-M2R-E2EE-secret-<suffix>`，非 UTD 占位；
- L12–L15b：本次新事件 `new=1 encrypted=1`，算法 Megolm、含 ciphertext，
  原始事件不含明文 / `session_key` / `body`；
- L16–L17b：无未捕获异常，4xx 全部属于协议预期清单（`total4xx=6 unexpected=[]`），
  噪声与白名单一一对应，无其它 console error；
- L18–L18d：浏览器同源路径、无 key 直连、生产 Caddy 对邀请服务管理端点与
  Synapse 管理 API 均返回 404/401，管理面不可由浏览器访问；
- L19–L20b：刷新后显式提示「真实会话已结束…需重新连接」，且不展示演示假会话。

复现命令（项目根目录）：

```bash
# 前置：M1 本地栈运行中（docker compose -f docker-compose.yml -f docker-compose.local.yml up -d）
cd frontend
npm ci                       # postinstall 自动准备 WASM
npm run typecheck
npm run test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort   # 另开终端常驻
npm run e2e:live             # 安全阻断门禁，失败即 exit 1
```

证据目录：`.tmp-gen/m2-live/`（`live-e2ee.json` 逐项结果、`A-sender.png` / `B-receiver.png` /
`B-after-reload.png` 截图、各轮运行日志）。该目录已 gitignore，不入库。

---

## 5. 明确未宣称完成（边界）

- **M3**：密钥备份/恢复（SSSS + 恢复密钥）、跨签名设备验证（emoji/QR）、设备撤销、
  未验证设备提醒。清除浏览器数据会丢失本设备解密密钥，历史消息将无法解密。
- **M4**：`EncryptedFile` 加密图片/文件/语音、语音录制；live 模式点击附件/语音会给出
  「属于 M4 未实现」提示，**不会发送明文附件**，也不插入假消息。
- **M5/M6**：Web Push、通知设置后端联动、实时通话（MatrixRTC/LiveKit）。
- **M7**：发布门禁、账号数监控（R2.6）、完整运维文档。
- 会话恢复：凭据只在内存，**刷新页面必须重新连接服务器**（安全取舍，UI 已明确提示）；
  要实现「刷新免重登」需引入密钥备份/恢复（M3）后再设计，当前不做。
- 单元测试覆盖纯逻辑与安全边界；真实 SDK 行为由双浏览器 E2E 覆盖，未做组件级快照测试。

> TLS（Caddy 到浏览器）与 DTLS（未来的 SRTP）都**不等价于端到端加密**。
> 本报告的 E2EE 结论仅建立在「服务器原始事件为 `m.room.encrypted` 密文 +
> 对端设备用自身密钥解密出明文 + 管理端无法读到明文」这一组实证上。
