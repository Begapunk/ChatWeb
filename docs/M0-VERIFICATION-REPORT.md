# Aether M0 技术验证报告

> 日期：2026-11-14 · 执行环境：Windows 11 (10.0.26200) / Node 24.18.0 / Docker 29.7.2 / Chrome 157
> 结论：**M0 通过（110/110 项检查）**。技术路线可行，未发现阻断性安全缺陷。
> 按工程规范，M1 需获得明确授权后启动。

## 1. 验证范围与结果总览

| 套件 | 内容 | 结果 |
|---|---|---|
| T01 | Rust Crypto WASM 加载、OlmMachine 身份密钥、IndexedDB 加密存储持久化、错误密钥拒绝 | **6/6** |
| T02 | matrix-js-sdk `initRustCrypto` 离线初始化、CryptoApi 全量方法审计、MatrixRTC API 存在性 | **27/27** |
| T03 | 本地双 OlmMachine：模拟密钥分发服务器，Olm to-device + Megolm 房间加密往返，第三方不可解密 | **15/15** |
| T03b | Matrix 规范 EncryptedFile 附件加密（WebCrypto AES-256-CTR + SHA-256）往返与篡改检测 | **7/7** |
| T04 | 真实 Chrome 157：IndexedDB/WebCrypto/WASM/initRustCrypto/存储持久化/浏览器内双设备 Olm E2EE | **14/14** |
| T05 | 本地 Synapse v1.165.0：管理员注册、官方注册令牌 API、令牌超额拒绝、加密房间、双 SDK 设备 Megolm 往返、服务器密文证明、管理员访问控制、应用重启离线补同步、跨签名(UIA)、SSSS+服务器密钥备份、恢复密钥 | **25/25** |
| T06 | **两个独立 Chrome 实例（独立 profile=独立设备）**经真实 Synapse 的端到端加密消息往返 | **16/16** |
| 合计 | | **110/110** |

证据文件：`m0/results/t0*.json`（每项检查的明细）、`m0/results/t05-progress.log`、
`m0/results/t06-devices.json`。全部测试可用 `npm run t01…t06` 复跑（见 README）。

## 2. 环境与版本事实

- Node v24.18.0（满足 SDK engines >=22）、npm 11.16.0、Docker 29.7.2 + Compose v5.4.0、
  Chrome 157（`C:\Program Files\Google\Chrome\Application\chrome.exe`）、Python 3.14（工具用）。
- 锁定版本：matrix-js-sdk **45.1.0** + @matrix-org/matrix-sdk-crypto-wasm **18.9.2**
  （SDK 精确依赖，**不得**用 npm latest 19.0.1 替换）；Synapse **v1.165.0**
  （镜像经 docker.1ms.run 镜像源拉取，digest `sha256:673b4223c81a7634fd07d832b939a58f97081cfdaae7cdd2d1664cdcf7611b62`，
  生产部署前应与 Docker Hub 官方 digest 比对）；其余见 DEPENDENCIES.md。
- 本地 Synapse 以 SQLite 运行（M0 简化）；**生产按规范使用 PostgreSQL 16**，M1 验证。
- 测试配置：`registration_requires_token: true`、禁访客、`federation_domain_whitelist: []`。

## 3. 关键 API 审计结论（以安装版 .d.ts 为准）

1. `initRustCrypto({useIndexedDB, cryptoDatabasePrefix, storageKey|storagePassword})`；
   32 字节 storageKey 加密 IndexedDB；错误密钥打开抛 unpickle 解密失败（T01 实测）。
2. CryptoApi 覆盖 M3 全部需求：跨签名引导（含 UIA 回调）、SSSS、密钥备份/恢复、
   设备验证/撤销、恢复密钥生成、房间密钥导入导出（T02/T05 实测）。
3. **MatrixRTC 从子路径 `matrix-js-sdk/lib/matrixrtc` 导出**（根入口不导出）；
   `MatrixRTCSession.join/leave/stop`、`client.matrixRTC`、`EncryptionManager`/
   `ToDeviceKeyTransport`/`LivekitTransport` 均存在 —— 通话 E2EE 的 SDK 侧机制具备，
   **但媒体链路未实测（M6 范围）**。
4. **SDK 无高层附件加密 API**，仅 `EncryptedFile` 类型；M4 按规范实现（T03b 已验证方案）。
5. `loginWithPassword` 后必须用返回的 `device_id` 重新 `createClient` 才能 `initRustCrypto`
   （T06 实测报错确认）。
6. `receiveSyncChanges` 接收事件**数组** JSON；`identityKeys.*` 须 `.toBase64()`。
7. 日志器从 `matrix-js-sdk/lib/logger.js` 导入（根入口无 `logger`/`setLogLevel`）。

## 4. 验证中发现并解决的问题（生产代码必须吸收）

| # | 发现 | 影响 | 处置 |
|---|---|---|---|
| F1 | **设备密钥竞态**：发送方 keys/query 早于接收方首次 keys/upload 时，发送方视接收方"无设备"，不产生 /sendToDevice，接收方永久 UTD | 高（真实并发注册场景可复现） | 首次发送前等待 `getUserDeviceInfo` 可见对端设备（T05/T06 已实现）；M2 的 MatrixService 必须内置该等待与 UTD 重试策略 |
| F2 | 同一客户端实例 `stopClient()+startClient()` 后 rust-crypto OutgoingRequestsManager 不重启 | 中 | "重启"语义用**新建客户端实例+复用加密存储前缀**实现（T05 已验证密钥持久化与补同步）；PWA 前台恢复走 sync 续传而非重建 |
| F3 | `Room.timeline` 事件在解密完成前触发 | 中（测试假阴性） | 断言用轮询/`Room.decrypted`，不依赖单次 timeline 回调 |
| F4 | 打包器重写 `import.meta.url` 导致 WASM 资源 404 | 中 | 显式 `initAsync(new URL(...))` 固定资源路径；M2 Vite 构建用 `?url` 资产导入并加构建后冒烟测试 |
| F5 | Chrome headless `--dump-dom --timeout` 输出空 DOM | 低（测试基建） | 改用 playwright-core 1.65.1 驱动本机 Chrome（channel:"chrome"，免下载） |
| F6 | Docker Hub 直连不可达；DaoCloud 白名单拒绝 | 中（部署） | 部署脚本参数化镜像源；本次用 docker.1ms.run 成功；记录 digest 供校验 |
| F7 | 非房间成员的管理员无法经客户端 API 读事件（404） | 正面发现 | 符合最小权限；服务器密文证明改用成员 token 读取原始事件（仍为密文） |

## 5. 安全结论

- **服务器不可解密聊天内容**：T05 证明服务器存储的事件为 `m.room.encrypted`（Megolm 密文），
  不含明文；密钥仅存在于设备加密存储与 SSSS 密文备份。
- **第三方不可解密**：T03 中未获得房间密钥的第三台机器解密失败。
- **邀请码限额有效**：Synapse 官方注册令牌 `uses_allowed=2` 用尽后第三次注册被拒（401）。
- **本地密钥存储加密**：错误密钥无法打开存储（T01）。
- **附件加密方案**：规范格式、完整性哈希、篡改检测均通过（T03b）。
- 测试过程未将密码/令牌写入日志或报告；测试凭据每次运行随机生成，仅存于 gitignore 的
  `.env.test` 与 `browser-run/`（本地回环）。

## 6. 未验证项（明确推迟，不宣称完成）

| 项 | 推迟到 | 原因 |
|---|---|---|
| Element Call + LiveKit + lk-jwt-service 实际通话与媒体 E2EE | M6 | 需独立部署 SFU 与 TURN 网络测试；SDK 侧 API 已确认存在 |
| iOS Safari / iOS 主屏幕 PWA / Web Push 全链路 | M5 | 本环境无 iOS 真机；需真机+推送证书 |
| PostgreSQL 部署与迁移 | M1 | M0 用 SQLite 简化 |
| 四人上限的事务性名额控制（FastAPI 层） | M1 | M0 仅验证 Synapse 令牌层兜底 |
| 设备撤销、未验证设备提醒、清数据后恢复的 UI 流程 | M3 | API 已验证，流程未实现 |
| TS7/Vite8/vue-router5 工具链构建兼容性 | M2 开工首检 | 版本已锁定，未做构建验证 |

## 7. M0 验收判定

- [x] 官方文档/类型定义先行审计，未虚构 API
- [x] matrix-js-sdk + Rust Crypto WASM + IndexedDB 在 Node 与真实 Chrome 验证
- [x] Synapse 部署并验证两个浏览器设备之间的 E2EE（T06）
- [x] 服务器密文存储证明、邀请令牌限额、跨签名/密钥备份引导
- [x] 技术验证报告产出，未提前开发完整 UI
- **判定：通过。等待授权进入 M1。**