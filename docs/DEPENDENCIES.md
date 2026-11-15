# Aether 依赖版本锁定清单（M0 基线 + M2 / M2-R / M3 更新）

> 核实日期：2026-11-14。所有版本来自官方 registry / GitHub releases 当日查询，
> 非记忆推断。生产安装必须使用精确版本（无 `^`/`~`），并提交 lockfile。
> 前端实际锁定值以 `frontend/package.json` + `frontend/package-lock.json` 为准；
> M2-R 真实链路的实现与验收见 `docs/M2-LIVE-REPORT.md`。

## 1. 核心通信与加密

| 组件 | 锁定版本 | 来源 | 备注 |
|---|---|---|---|
| matrix-js-sdk | **45.1.0** | npm `latest` | engines: node >=22；本机 Node 24.18.0 满足 |
| @matrix-org/matrix-sdk-crypto-wasm | **18.9.2** | npm（SDK 精确依赖） | **SDK 45.1.0 精确锁定 18.9.2，不是 19.x**。npm `latest` 为 19.0.1，但不得与 SDK 混用；`v18-latest` tag 亦为 18.9.2 |
| matrix-events-sdk | 0.0.1 | SDK 传递依赖 | 由 SDK lockfile 锁定 |
| matrix-widget-api | ^1.20.0 | SDK 传递依赖 | Element Call widget 集成需要，M6 复核 |

## 2. 服务端

| 组件 | 锁定版本 | 来源 | 备注 |
|---|---|---|---|
| Synapse | **v1.165.0** | GitHub element-hq/synapse releases（2026-11-10） | 镜像 `matrixdotorg/synapse:v1.165.0`；M0 本地实测同版本 |
| PostgreSQL | **16-alpine**（建议） | Docker 官方镜像 | Synapse 支持 PG13+；16 为稳定长线选择，M1 部署时复核官方支持矩阵 |
| Caddy | **v2.11.9** | GitHub caddyserver/caddy releases | 自动 HTTPS |
| FastAPI | **0.162.7** | PyPI（清华镜像同步核实） | 邀请服务 |
| uvicorn | **0.54.0** | PyPI | ASGI 服务器 |
| Python（邀请服务） | 3.12-slim（建议） | Docker 官方镜像 | 本机 py3.14 仅用于工具脚本；服务容器用 3.12 保证依赖轮子齐全 |

## 3. 通话（M6）

| 组件 | 锁定版本 | 来源 | 备注 |
|---|---|---|---|
| Element Call | **v0.28.2** | GitHub element-hq/element-call releases（2026-11-05） | 独立通话页集成 |
| LiveKit Server | **v1.13.11** | GitHub livekit/livekit releases（2026-10-25） | SFU |
| lk-jwt-service | **v0.10.0** | GitHub element-hq/lk-jwt-service releases | LiveKit 接入鉴权，官方集成组件 |
| coturn | **4.19.0** | GitHub coturn/coturn releases | 按网络测试结果启用 |

## 4. 前端与 PWA（M2）

| 组件 | 锁定版本 | 来源 | peer 兼容性（已核实） |
|---|---|---|---|
| vue | 3.5.45 | npm | — |
| vue-router | 5.5.1 | npm | peers: vue ^3.5.34 ✓；vite/pinia/@pinia/colada 均为 optional |
| pinia | 4.1.0 | npm | peers: vue ^3.5.11 ✓, typescript >=5.6 ✓ |
| vite | 8.3.8 | npm | — |
| @vitejs/plugin-vue | 6.0.11 | npm | M2 脚手架实际锁定 |
| vite-plugin-pwa | 2.0.0 | npm | peers: vite ^3.1–^8 ✓；需 workbox-build/window ^7.4.1 |
| vue-tsc | 3.3.14 | npm | 类型检查门禁；与 TS 7 不兼容，见下行 |
| typescript | **5.9.3**（原拟 7.0.2，M2 开工首检已修订） | npm | TS 7.0.2 的 `exports` 不再暴露 `./lib/tsc`，而 `vue-tsc 3.3.14` 的 `resolveTscPath()` 仍 `require.resolve('typescript/lib/tsc')` → `ERR_PACKAGE_PATH_NOT_EXPORTED`，类型检查失败；降级 5.9.3 后 `vue-tsc --noEmit`、`vite build` 与 PWA 产物（`sw.js` / `manifest.webmanifest`）全部通过 |
| **@matrix-org/matrix-sdk-crypto-wasm** | **18.9.2** | npm（SDK 精确依赖） | **M2-R 起为前端直接依赖**（不只是传递依赖）：`postinstall` 从 node_modules 复制 `.wasm` 到 `public/wasm/`，运行时 `initAsync(new URL("/wasm/matrix_sdk_crypto_wasm_bg.wasm", origin))` 固定路径（M0 F4）。版本须与 matrix-js-sdk 45.1.0 精确绑定，不得单独升级；`prepare-wasm.mjs` 会校验版本并阻断漂移 |
| **matrix-js-sdk** | **45.1.0** | npm latest | **M2-R 起为前端运行时依赖**：`MatrixService` 用它完成登录/重建 client/`initRustCrypto`/sync/自动入房/Megolm 收发 |

> **M2 工具链结论（2026-11-14 实测，见 `docs/M2-KICKOFF-CHECK.md`）**：上表除 TypeScript
> 外的版本均在最小工程 `.tmp-gen/m2-probe` 中完成 `vite build` + `vue-tsc --noEmit` 验证。
> M2 前端锁定 **TypeScript 5.9.3**，不使用 7.0.2；`vue-tsc 3.3.14` /
> `@vitejs/plugin-vue 6.0.11` / `vite-plugin-pwa 2.0.0` 在该组合下工作正常。

## 5. 测试与验证工具

| 组件 | 锁定版本 | 用途 |
|---|---|---|
| vitest | 5.1.0 | **M2-R 起实际运行**：`npm run test` 21/21 → **M3 后 34/34**（`src/services/matrix.test.ts` + `src/data/demo.test.ts` + `src/services/security.test.ts`）。peers: vite ^6.4–^8 ✓；独立配置 `frontend/vitest.config.ts`（`environment: "node"`、只含 `src/**/*.test.ts`），**不复用 `vite.config.ts`**，避免 VitePWA 构建插件介入测试。**安装须用在线元数据**（`--prefer-offline` 会因过期 packument 误报 `@vitest/mocker@5.1.0` 不存在） |
| @playwright/test | 1.65.1 | M0 版本核实基线（端到端多浏览器测试）；**M2/M2-R 未使用**，实际用 `playwright-core` 直接驱动本机 Chrome |
| playwright-core | 1.65.1 | M0 已用；**精确锁定为 `frontend` devDependency**：`e2e/demo-smoke.mjs`（demo 36 项真实 Chrome 烟测，见 `docs/M2-DEMO-REPORT.md`）、**`e2e/live-e2ee.mjs`（M2-R 双独立 Chrome 实例 E2EE 安全阻断门禁 32 项，见 `docs/M2-LIVE-REPORT.md`）**、**`e2e/m3-security.mjs`（M3 清浏览器数据 → 恢复 → 历史解密安全门禁 36 项，`npm run e2e:m3`）**。免浏览器下载，直接指向本机 `chrome.exe` |
| fake-indexeddb | 6.2.8 | Node 环境模拟 IndexedDB（M0 已用） |
| esbuild | 0.28.2 | M0 浏览器验证打包 |

### WASM 资产链（M2-R 新增，禁止凭记忆改动）

`frontend/scripts/prepare-wasm.mjs` 绑定 `package.json` 的 `postinstall` / `prepare:wasm`：
从 `frontend/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm`
复制到 `frontend/public/wasm/matrix_sdk_crypto_wasm_bg.wasm`（实测 **7.43 MiB / 7,790,998 bytes**）。
脚本先读取依赖包 `package.json` 并**断言版本恰好为 18.9.2**，不一致即报错退出，防止 SDK 与 WASM 版本漂移。
`public/wasm/` 已 gitignore（二进制不入库），且不进入 PWA precache —— 离线时不误导用户以为能收发消息。
`vite.config.ts` 用 `assetsInclude: ["**/*.wasm"]` 与 `initAsync(new URL("/wasm/...", origin))` 显式固定路径。

## 6. M0 审计确认的关键 API 事实（禁止凭记忆改动）

1. `client.initRustCrypto({ useIndexedDB, cryptoDatabasePrefix, storageKey | storagePassword })`；
   `storageKey` 必须是 32 字节；`storePrefix=null` 时为内存存储（重启丢密钥）。
2. 初始化链：`initAsync() → StoreHandle.open/openWithKey → OlmMachine.initFromStore`。
   错误密钥打开加密存储会抛 "failed to be decrypted while unpickling"（已实测）。
3. `identityKeys.ed25519/curve25519` 是对象，须 `.toBase64()` 序列化。
4. **MatrixRTC 不从 SDK 根入口导出**，须 `import ... from "matrix-js-sdk/lib/matrixrtc"`；
   `MatrixRTCSession` 提供 `join/leave/stop/membershipStatus/getRtcSlot/ensureRtcSlotOpen` 等
   （2026  slot 化 API，与旧文档的 joinRTC 不同）。`client.matrixRTC: MatrixRTCSessionManager`。
5. CryptoApi 已确认存在：`bootstrapCrossSigning({authUploadDeviceSigningKeys})`、
   `bootstrapSecretStorage({setupNewKeyBackup, createSecretStorageKey})`、
   `createRecoveryKeyFromPassphrase`、`getKeyBackupInfo`、`restoreKeyBackupWithPassphrase`、
   `resetKeyBackup`、`getUserDeviceInfo`、`setDeviceVerified`、`crossSignDevice`、
   `requestOwnUserVerification`、`requestDeviceVerification`、`exportRoomKeys/importRoomKeysAsJson`。
   `GeneratedSecretStorageKey = { keyInfo?, privateKey: Uint8Array, encodedPrivateKey? }`。
6. **SDK 无高层附件加密辅助函数**：只有 `EncryptedFile` 类型（@types/media.d.ts）。
   M4 按 Matrix 规范用 WebCrypto AES-256-CTR + SHA-256 实现（M0 T03b 已验证往返与篡改检测）。
7. `OlmMachine.receiveSyncChanges` 的 to-device 参数是**事件数组 JSON**，不是 `{events:[...]}`。
8. `encodeRecoveryKey/decodeRecoveryKey` 位于 `matrix-js-sdk/lib/crypto-api/recovery-key.js`。
9. `loginWithPassword` 后必须用返回的 `device_id` 重新 `createClient({userId, deviceId, accessToken})`
   才能 `initRustCrypto`，否则报 "unknown deviceId"（T06 实测）。
10. 日志器：`import { logger } from "matrix-js-sdk/lib/logger.js"`；根入口无 `logger`/`setLogLevel`。
11. 同一实例 `stopClient()+startClient()` 不会重启 rust-crypto OutgoingRequestsManager；
    应用重启语义应新建客户端实例并复用同一加密存储前缀（T05 实测）。
12. 浏览器打包时 WASM 资源路径须显式固定：`initAsync(new URL("<asset>", location.href))`，
    避免打包器重写 `import.meta.url` 造成 404（T04 实测）。
13. 首次向某用户发送加密消息前，应等待 `getUserDeviceInfo` 可见对端设备，
    否则可能因密钥查询竞态导致对方永久 UTD（T05 实测，报告 F1）。

## 7. M2-R 安装版 `.d.ts` / 源码实证补充（2026-11-14，禁止凭记忆改动）

以下为 M2-R 接线前逐一核对**已安装版本**文件得到的结果，完整证据表见 `docs/M2-LIVE-REPORT.md §2`。

| API / 行为 | 证据位置 | 结论 |
|---|---|---|
| `initAsync(url?: URL \| string)` | `crypto-wasm/index.d.ts:49` | 可传 `URL` 对象；运行时用 `new URL("/wasm/...", origin)` 固定路径 |
| `initRustCrypto({ storageKey?: Uint8Array })` | `client.d.ts:1178-1203` | `storageKey` 须恰好 32 字节（PBKDF2-SHA256 / 256bit） |
| `getUserDeviceInfo(userIds, downloadUncached?)` | `crypto-api/index.d.ts:184` | **默认 `false`：未跟踪用户根本不出现在结果 map**；M2-R 显式传 `true` |
| `isEncryptionEnabledInRoom(roomId)` | `crypto-api/index.d.ts:88`、`rust-crypto.js:292-295` | 读 `OlmMachine.getRoomSettings()`，是「加密层已感知房间配置」的权威判定 |
| `Cannot encrypt event in unconfigured room` | `rust-crypto.js:170-176` | `roomEncryptors[roomId]` 不存在时抛错，**消息不会到达服务器** |
| `onCryptoEvent` 建立时机 | `sync.js:1202-1212`（源码注释本身点明竞态） | 只在 sync 处理 `m.room.encryption` 状态事件时建立 RoomEncryptor → 需 M2-R 的 `waitForEncryptionReady()` |
| `ClientEvent.Sync === "PREPARED"` | `sync.d.ts:14` | 与 M1 `helpers.makeDevice` 一致 |
| `getStateEvents(type, stateKey)` | `room-state.d.ts:217-224` | 双参数返回单个事件或 null，用于严格判定房间加密（修 D2） |
| `getWireType` / `getWireContent` / `isDecryptionFailure` | `models/event.d.ts:349,400,504` | 区分「服务器原始密文」与「本地解密结果」（修 D3 差集断言） |

**M0 F7 复核**：非房间成员管理员经客户端 API 读事件会 404，但 M1 的管理员是固定加密房间的
创建者/成员，用其 token 读 `/rooms/{id}/messages` 返回 200；该管理员客户端从未 `initRustCrypto`，
拿不到 Megolm 会话密钥，只能读到密文 —— 符合最小权限且可完成服务器侧密文证明。

## 8. M3 安装版 `.d.ts` / 源码实证补充（2026-11-15，禁止凭记忆改动）

开工首检记录见 `docs/M3-KICKOFF-CHECK.md`；以下为本轮实现前后再次核对**已安装
`matrix-js-sdk 45.1.0`** 得到的结论，路径相对 `frontend/node_modules/matrix-js-sdk/lib/`。

| API / 行为 | 证据位置 | 结论 |
|---|---|---|
| `bootstrapCrossSigning(opts)` | `crypto-api/index.d.ts:333` | 参数是 `BootstrapCrossSigningOpts`，**不能传 `void`** |
| `BootstrapCrossSigningOpts.authUploadDeviceSigningKeys` | `crypto-api/index.d.ts:749-758` | 类型为 `UIAuthCallback<void>`；SDK 注释明确「不提供则密钥不会上传到服务器」。恢复路径也必须传，**防止 SSSS 无跨签名私钥时走新建分支静默失败** |
| `UIAuthCallback<T>` | `interactive-auth.d.ts:115` | `(makeRequest: (authData: AuthDict \| null) => Promise<T>) => Promise<T>`；`AuthDict`（同文件 `:96`）含 `PasswordDict` 联合成员，`passwordAuth()` 直接传对象即可，**无需 `as never` 强转** |
| `bootstrapSecretStorage(opts)` | `crypto-api/index.d.ts:370` | 已有默认 SSSS key 时**不会调用** `createSecretStorageKey`；恢复必须走构造期 `cryptoCallbacks.getSecretStorageKey` |
| `CreateSecretStorageOpts` | `crypto-api/index.d.ts:1054-1068` | 仅 `createSecretStorageKey` / `setupNewKeyBackup` / `setupNewSecretStorage` 三个字段 |
| `createRecoveryKeyFromPassphrase()` | `crypto-api/index.d.ts` | 不传口令时生成**随机 4S 恢复密钥**（规范路径）；`restoreKeyBackupWithPassphrase` 已 deprecated，不得使用 |
| `cryptoCallbacks` | `client.d.ts`（`createClient` opts） | 属于**构造期**选项；M0 F2 实证同实例 `stop/start` 不重启 rust-crypto 循环，因此「设置页导入恢复密钥」必须 stop → 新建 client → 复用同一 `cryptoDatabasePrefix` |
| `getSecretStorageKey({ keys })` | `client.d.ts` / `crypto-api` | `keys` 是加密该 secret 所用 keyId 集合；返回 `[Object.keys(keys)[0], privateKey]`，**无密钥时必须返回 `null`，绝不猜测或生成新密钥顶替** |
| `CryptoEvent.VerificationRequestReceived` | `crypto-api/CryptoEvent.js` | 由 `MatrixClient` reEmitter 转发，监听对象必须是 client 而非 `cryptoApi` |
| `verifier` | `models/VerificationRequest` | 是 **getter**，不是 `getVerifier()` 方法 |
| `VerificationPhase` | `crypto-api/verification` | 数值：`Ready=3 / Started=4 / Cancelled=5 / Done=6` |
| 设备撤销 `deleteDevice` | `client.d.ts` | UIA 需要 `m.login.password`，与跨签名公钥上传共用同一个密码回调 |

**M3 新增/改动文件**：`frontend/src/services/security.ts`（纯逻辑：恢复密钥校验、状态汇总、设备合并）、
`security.test.ts`（13 项）、`matrix.ts`（`cryptoCallbacks` / 引导 / 恢复 / 设备 / SAS）、
`stores/chat.ts`（安全操作接线）、`views/SettingsView.vue`（真实安全中心）、
`views/LoginView.vue`（登录页恢复密钥输入）、`e2e/m3-security.mjs`（安全门禁）、
`package.json` 新增 `e2e:m3`。**未新增任何第三方依赖**，仍锁定上表版本。