# Aether 风险清单（M0 基线 + M1/M2 更新）

> 评级：高 / 中 / 低。状态：已验证 / 缓解中 / 待验证 / 阻塞 / 已关闭。
> 安全相关失败一律阻止发布（工程原则 9）。
> 2026-11-14 更新：R2.2 / R2.5 / R2.6 反映「彻底移除名额上限」(M1-R1)；R4.3 为 M2 开工首检结论；
> R4.5 为 M2 演示版阶段风险（已按历史阶段改写）；**R1.7 / R4.6 / R4.7 / R4.8 为 M2-R 真实链路新增**，
> 现行链路状态以 `docs/M2-LIVE-REPORT.md` 为准。安全门禁：`npm run e2e:live`（32/32），失败一律阻断发布。

## R1 加密与密钥（高）

| # | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R1.1 | 用户清除浏览器数据且未备份密钥 → 历史消息永久不可解密 | 数据丢失 | 安全中心强提示；首次加密会话前引导完成 SSSS+密钥备份；恢复密钥离线保存 | 机制已验证（T05），UI 待 M3 |
| R1.2 | IndexedDB 明文存储密钥被本机恶意软件读取 | 密钥泄露 | `initRustCrypto` 使用 32 字节 `storageKey` 加密存储（T01 已验证错误密钥拒绝）；storageKey 派生自用户凭据经 SSSS，不落明文日志 | 已验证 |
| R1.3 | iOS Safari ITP 对脚本可写存储有 7 天无交互驱逐策略 | 密钥/会话被清 | 主屏幕 PWA 豁免部分限制但仍需实测；密钥备份兜底；M5 专项测试 | 待验证（M5） |
| R1.4 | 自研附件加密偏离 Matrix 规范导致互操作/安全缺陷 | 附件泄露或不可解 | 已实现 EncryptedFile v2（AES-256-CTR+SHA-256），37 项单测含往返、篡改拒绝、随机密钥/IV；双浏览器媒体密文门禁已写，仍需真实执行与 Element 互操作 | 静态已验证；真实门禁阻塞 |
| R1.5 | 把 TLS/DTLS-SRTP 误当通话 E2EE | 通话被 SFU 侧窃听 | M6 必须实测 MatrixRTC 每成员密钥分发与 LiveKit E2EE 状态，验证 SFU 不可解密 | 待验证（M6） |
| R1.6 | 未验证设备加入房间接收密钥 | 中间人 | 房间设置 `onlyAllowTrustedDevices` 评估 + 新设备显著提醒 + 跨签名验证流程（M3） | API 已确认，策略待 M3 |
| R1.7 | **M2-R 新增**：`storageKey` 由用户口令经 PBKDF2-SHA256 / 150k 轮派生；弱口令降低加密存储的抗离线爆破强度，且口令只存内存 → 刷新页面即丢失凭据与派生密钥 | 密钥保护弱化 / 会话不可用 | ① 口令不落盘、不进日志、不写 localStorage（M2-R 已实现）；② 派生 salt 与 `cryptoDatabasePrefix` 绑定 userId，避免跨账号复用；③ 刷新后强制回登录页并显式提示「真实会话已结束」，不静默回退演示假数据（D1）；④ **M3 需用 SSSS/恢复密钥替代「口令即密钥」模型**，并在 UI 强制口令强度与清数据前备份告警 | 缓解中（M3 前为已知取舍） |
| R1.8 | **M2-R 新增**：清除浏览器数据 / 未做密钥备份 → 本设备解密密钥与历史消息永久不可解 | 数据永久丢失 | live 模式安全中心与 README 已强提示；`docs/M2-LIVE-REPORT.md §5` 列为发布阻断项；**M3 完成 SSSS 密钥备份/恢复前不得作为正式私密通讯工具发布** | 未关闭（阻断正式发布） |

## R2 准入与账号（高）

| # | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R2.1 | 邀请码暴力尝试 | 未授权注册 | 仅存 `salt+pepper` 哈希、过期时间、尝试次数限制、一次性使用；Synapse 层 `uses_allowed=1` 兜底 | 已验证（M1 主套件/对抗套件） |
| R2.2 | 未持有效邀请码者注册进入（原「超过 4 人」，M1-R1 改写） | 隐私边界破坏 | 一次性邀请码 + `registration_requires_token` + `uses_allowed=1` 短时效令牌 + 联邦/访客/公开注册全关 + 管理面不对公网暴露。**人数上限已移除，人数不再是准入手段**，因此发码流程与管理员密钥（`INVITE_ADMIN_API_KEY`）成为唯一边界，M7 需专项复核 | 已验证；M7 复核发码权限 |
| R2.3 | 管理 Token 泄露到前端 | 服务器被完全控制 | 管理 API 仅经本机回环可达；Caddy 不路由 `/_synapse/admin` 与 `/invite-api/admin/*`；代码审查门禁 | 已验证（M1 对抗套件 GA1–GA10） |
| R2.4 | 联邦/公开注册残留 | 陌生人进入 | `federation_domain_whitelist: []`、`registration_requires_token`、禁访客、房间邀请制；部署检查逐项断言 | 已验证（33/33） |
| R2.5 | ~~名额口径分歧（LR-M1-1）：发令牌即预占且不回收，与 PRD Q4 文字不一致~~ | ~~容量/可用性~~ | **已消解（M1-R1，2026-11-14 用户决策）**：彻底移除人数上限，`quota_counters` 仅作统计，`/admin/v1/quota` 返回 `unlimited=true` / `max_members=null`，不再存在席位预占、回收或口径问题。见 `docs/M1-AMENDMENT-UNLIMITED.md` | **已关闭** |
| R2.6 | 移除人数上限后账号数不再受控（**M1-R1 新引入**） | 资源耗尽 / 运维失控：Synapse、PG、媒体与加密房间成员数随发码量线性增长；房间成员越多 Megolm 会话密钥分发面越大 | 准入仍由管理员**手动**发码（无公开注册、无自助申请），实际规模由运维纪律控制；M7 需补：账号数监控告警、发码审计、房间成员上限策略评估。**当前无自动人数上限是有意的产品决策，不是缺陷** | 缓解中（M7） |

## R3 平台与网络（中）

| # | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R3.1 | iOS 后台 WebSocket 不可用 | 消息延迟 | 不假设后台长连接；Web Push 唤醒提示 + 前台恢复补同步（T05 已验证离线补同步） | 部分验证 |
| R3.2 | iOS Web Push 仅主屏幕 PWA 且需用户手势授权 | 通知不可用 | 安装引导 → 用户点击后 requestPermission；被拒时降级应用内提示（M5 测试） | 待验证（M5） |
| R3.3 | 本机网络环境存在代理/虚拟网卡干扰（PLCSIM 172.20.10.x 黑洞路由史） | 部署/测试假阴性 | 测试固定走 127.0.0.1；生产部署文档含网络自检；TURN 按实测配置 | 缓解中 |
| R3.4 | Docker Hub 直连不可达（本环境已复现） | 部署失败 | 部署脚本支持镜像仓库参数；文档记录镜像源与校验（digest） | 已复现并缓解 |
| R3.5 | shell 环境 `NODE_TLS_REJECT_UNAUTHORIZED=0` | 开发期 TLS 校验被关 | 仅影响本开发机工具链；生产容器与 CI 严禁该变量；测试使用「仅限该请求」的专用 `https.Agent` / `curl -k` | 已识别 |

## R4 依赖与 API（中）

| # | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R4.1 | crypto-wasm 版本漂移（npm latest 19.x ≠ SDK 锁定 18.9.2） | 运行时不兼容 | 精确锁定 + lockfile + CI 校验（DEPENDENCIES.md） | 已验证 |
| R4.2 | MatrixRTC API 与旧文档不符（slot 化、子路径导出） | M6 返工 | 以安装版 .d.ts 为准（已审计）；M6 前先做最小通话验证 | 已审计 |
| R4.3 | TS7/Vite8/vue-router5 为新世代版本，工具链兼容性未知 | M2 构建失败 | **M2 开工首检已实测**：TS 7.0.2 的 `exports` 不再暴露 `./lib/tsc`，`vue-tsc 3.3.14` 仍 `require.resolve('typescript/lib/tsc')` → `ERR_PACKAGE_PATH_NOT_EXPORTED`，类型检查失败；降级 **TypeScript 5.9.3** 后 `vue-tsc --noEmit` + `vite build` + PWA 产物全部通过。M2 锁定 5.9.3，见 `docs/M2-KICKOFF-CHECK.md` | **已验证并缓解** |
| R4.4 | SDK 无附件加密高层 API | M4 工作量 | 按规范实现 + 单测 + 与 Element 互操作验证 | 已确认 |
| R4.5 | **（M2 demo 阶段历史风险，已随 M2-R 消解）演示版界面被误当作可用加密通讯工具** | 高：机密性预期落空 | 当时缓解：① 演示徽章 + 聊天页「E2EE 未接线」横幅 + 安全中心 4 项待实现清单；② 当时的 `services/matrix.ts` 以 `implemented:false / e2ee:false` 常量固化（**M2-R 后已改为 `implemented:true`，此描述仅适用于 demo 阶段**）；③ 烟测 S33/S34 实证 demo 不连 Matrix/邀请 API、不连外部域名（M2-R 回归 36/36 仍保持）。**M2-R 现状**：demo 与 live 在 UI 上显式区分，live 刷新后强制回登录页提示，不静默回退 demo（D1）；演示模式仍**不得作为产品发布** | 已缓解（历史阶段 / 现行见 R1.7、R1.8、R4.8） |
| R4.6 | **M2-R 新增**：SDK `unconfigured room` 加密竞态 —— 客户端刚 `joinRoom` 自动入房、下一次 `/sync` 尚未把 `m.room.encryption` 交给 Rust Crypto 层时发送，SDK 抛 `Cannot encrypt event in unconfigured room`，**消息根本不到服务器**（表面看似「已发送」） | 高：消息静默丢失 / 用户误判已送达 | 查证 `rust-crypto.js:170-176` 与 `sync.js:1202-1212` 源码后，用公开 API `isEncryptionEnabledInRoom()` + `getUserDeviceInfo(peers, true)` 实现 `waitForEncryptionReady()` 有界等待房间加密配置/成员/设备密钥收敛；超时**取消发送并抛明确错误，绝不降级明文**；仅对明确时序竞态最多 3 次有界重试（对应 M0 F1）。单测覆盖「加密层缺失不调用 sendEvent / 超时不发明文 / 非竞态错误不重发」 | **已缓解并验证**（M2-R D4，e2e:live 32/32 ×3） |
| R4.7 | **M2-R 新增**：验收脚本「假通过」—— 房间内已存在 M1 历史 `m.room.encrypted` 事件，仅断言「存在密文」即使本次消息未发出也会通过 | 高：安全门禁失效，把不加密的版本误判为通过 | 发送前取服务器事件 ID 基线，发送后**只取差集新事件**做断言（L12–L15b）：本次 `new=1 encrypted=1`、算法 `m.megolm.v1.aes-sha2`、含 ciphertext、无明文 / `session_key` / `body`；另加 L07b 等待服务器 `joined_members` 确认双端入房。B 端必须实际解密出明文（L10/L11） | **已缓解并验证**（M2-R D3） |
| R4.8 | **M2-R 新增**：房间加密状态误报 E2EE —— 用「客户端 crypto 层就绪」兜底判定，会把未启用加密的房间标成 `encrypted` | 高：向用户虚假承诺机密性 | 严格只依据 `m.room.encryption` 状态事件判定 `Conversation.encrypted`；单测专门断言「crypto 层就绪但无状态事件 → `encrypted === false`」 | **已缓解并验证**（M2-R D2） |
| R4.9 | **M3 新增**：恢复路径 `bootstrapCrossSigning({})` 未传 UIA 回调 —— SDK 注释明确「不提供 `authUploadDeviceSigningKeys` 则密钥不会上传」，若 SSSS 中缺少跨签名私钥而走「新建并上传」分支，恢复会静默失败 | 高：用户以为已恢复、实际跨签名与设备信任未建立 | 核对安装版 `crypto-api/index.d.ts:749-758` 后，**首次引导与恢复路径都传入 `passwordAuth()`**（`UIAuthCallback<void>`，密码仅存内存）；同时用正确的 `UIAuthCallback` 类型替代 `as never`，让类型检查真正生效 | **已修复，待真实 E2E 验证** |
| R4.10 | **M3 新增**：恢复密钥/口令/私钥落盘或进日志 | 高：等于把 E2EE 的解密能力交给任何能读浏览器存储的人 | 恢复密钥解码后只存服务层内存；`createClient({ cryptoCallbacks })` 用闭包持有；`forgetSession()` 仅在断开/登出时清理；`security.test.ts` 用运行时 spy 断言恢复密钥处理链路不调用任何持久化 API；`e2e:m3` 门禁含 M10 / M27 / M36 三条存储与日志断言 | **静态单测已验证，浏览器 E2E 待执行** |
| R4.11 | **M3 新增**：恢复失败被静默降级为「普通登录」或演示假数据 | 高：用户丢失历史消息却毫不知情 | `connect()` 携带恢复密钥时，恢复抛错即 `stop()` + `clearSessionSecrets()` 并抛出「恢复密钥无效或密钥恢复失败」，登录页显示错误、停留原页（fail-closed）；`e2e:m3` M23/M24 专门断言该行为 | **已实现，待真实 E2E 验证** |

## R5 运维（中）

> 2026-11-23：R5.4 的 Docker 诊断只适用于已取消的旧自托管运行方案，不再是现行阻断。
> 现行风险是尚未使用专用远程 Matrix 测试账号重跑 M3/M4 真实门禁。

| # | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R5.1 | 数据库/媒体/密钥未分离备份 | 灾难恢复失败 | 分离卷 + 备份脚本 + 恢复演练（M7） | 待实现 |
| R5.2 | Synapse 升级破坏 E2EE 兼容 | 服务中断 | 升级前快照、staging 验证、版本锁定 | 待实现（M7） |
| R5.3 | 日志/错误报告泄露明文或令牌 | 隐私泄露 | 日志红线：禁止记录消息正文、恢复密钥、access token；SDK 日志级别生产调高；审查门禁 | 已验证（对抗套件 LR1–LR3） |
| R5.4 | **M3 验收阻断（2026-11-15）**：本机 Docker Desktop 的 Linux 引擎无法启动 —— 残留 `run/sailor-ingest.sock` 等 AF_UNIX 文件 `EPERM` 无法删除/重命名，`backend` 反复报 `Access is denied`，engine 持续 `HTTP 503`；`wsl.exe` 被本机安全策略黑名单禁止，`Restart-Service WslService` 需管理员权限 | **高：M3 的「清浏览器数据 → 恢复 → 历史解密」真实 E2E 安全门禁无法执行，故 M3 不得宣称完成、不得发布** | 已做的自动处置：备份并重命名残留文件、整体重命名 `Docker/run` 目录（可回滚）、4 次干净重启；均未能让 Linux VM 起来。**需用户人工操作**：以管理员执行 `wsl --shutdown` 后重启 Docker Desktop，或在 Docker Desktop GUI 执行 Restart / 重启系统。栈恢复后直接执行 `npm run e2e:m3`，**不重做已完成的实现与静态门禁** | **未缓解 · 当前发布阻断项** |
