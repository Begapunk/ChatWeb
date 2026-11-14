# Aether 依赖版本锁定清单（M0）

> 核实日期：2026-11-14。所有版本来自官方 registry / GitHub releases 当日查询，
> 非记忆推断。生产安装必须使用精确版本（无 `^`/`~`），并提交 lockfile。

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
| vite-plugin-pwa | 2.0.0 | npm | peers: vite ^3.1–^8 ✓；需 workbox-build/window ^7.4.1 |
| typescript | **5.9.3**（原拟 7.0.2，M2 开工首检已修订） | npm | TS 7.0.2 的 `exports` 不再暴露 `./lib/tsc`，而 `vue-tsc 3.3.14` 的 `resolveTscPath()` 仍 `require.resolve('typescript/lib/tsc')` → `ERR_PACKAGE_PATH_NOT_EXPORTED`，类型检查失败；降级 5.9.3 后 `vue-tsc --noEmit`、`vite build` 与 PWA 产物（`sw.js` / `manifest.webmanifest`）全部通过 |

> **M2 工具链结论（2026-11-14 实测，见 `docs/M2-KICKOFF-CHECK.md`）**：上表除 TypeScript
> 外的版本均在最小工程 `.tmp-gen/m2-probe` 中完成 `vite build` + `vue-tsc --noEmit` 验证。
> M2 前端锁定 **TypeScript 5.9.3**，不使用 7.0.2；`vue-tsc 3.3.14` /
> `@vitejs/plugin-vue 6.0.11` / `vite-plugin-pwa 2.0.0` 在该组合下工作正常。

## 5. 测试与验证工具

| 组件 | 锁定版本 | 用途 |
|---|---|---|
| vitest | 5.1.0 | 单元测试（peers: vite ^6.4–^8 ✓） |
| @playwright/test | 1.65.1 | 端到端多浏览器测试（M2 起，可用本机 Chrome channel） |
| playwright-core | 1.65.1 | M0 已用：channel:"chrome" 驱动本机 Chrome 157，免浏览器下载 |
| fake-indexeddb | 6.2.8 | Node 环境模拟 IndexedDB（M0 已用） |
| esbuild | 0.28.2 | M0 浏览器验证打包 |

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