# TODO（按里程碑）

> **2026-11-23 方案变更**：现行运行路径改为免安装客户端——使用电脑已有 Node.js
> 提供本地 PWA，浏览器直连用户指定的现有 Matrix homeserver。本机 Docker、Caddy、
> PostgreSQL、Synapse 与邀请服务退出默认运行路径；旧 M1 服务端保留为历史可选实现。

> 2026-11-14 更新：M1-R1「彻底移除名额限制」已实现并回归（**172/172**）；
> **M2 真实加密链路已实现并通过安全阻断门禁（双浏览器 E2EE 32/32 ×3 连续复跑、
> 单测 21/21、demo 回归 36/36）**。
> 权威说明见 `docs/M2-LIVE-REPORT.md`；`docs/M2-KICKOFF-CHECK.md` 与
> `docs/M2-DEMO-REPORT.md` 为历史阶段快照（顶部均有现行状态通告）。
> **2026-11-15：M3 代码实现与静态门禁完成；2026-11-23 改为免安装远程 homeserver
> 方案后，需使用专用远程测试账号重新设计并执行「清数据 → 恢复 → 历史解密」门禁。**

## M0 — 已完成 ✅
- [x] 环境检查、版本锁定、API 审计
- [x] T01–T06 验证（110/110）
- [x] 架构/依赖/风险/计划/报告文档
- [x] 用户授权进入 M1

## M1 — 服务端与准入（已完成 ✅ M1-R1 后回归 172/172）
- [x] Docker Compose：Synapse + PostgreSQL 16 + Caddy + FastAPI 邀请服务（镜像源参数化）
- [x] homeserver.yaml 生产模板：禁联邦/禁访客/注册令牌/媒体限制/日志红线
- [x] 邀请服务：安全随机邀请码、仅存哈希、过期/次数限制、一次性并发原子性（事务锁）
- [x] 管理 Token 仅服务端环境变量；Caddy 不暴露 /_synapse/admin
- [x] 注册后自动加入固定加密群聊与私聊房间
- [x] 部署检查脚本（逐项断言安全配置）、.env.example、数据库迁移
- [x] 集成测试：邀请码重复使用、过期、尝试超限、并发竞态、无效码拒绝（吸收 F1）
- [x] QA 正式集成测试（验收 A–J）与 `docs/M1-TEST-REPORT.md`（**变更前** 170/170）
- [x] git 初始化、提交前机密扫描（86,597 行 / 0 处硬编码机密）
- [x] **M1-R1：彻底移除名额限制**（用户决策）——代码/配置/测试/文档全量回改；
      回归 68/68 + 33/33 + 71/71 = **172/172**，见 `docs/M1-AMENDMENT-UNLIMITED.md`
- [x] **LR-M1-1 已消解**（席位概念取消）；`RISKS.md R2.5` 关闭，新增 `R2.6`（人数不受控的运维风险）

## M2 — Vue PWA 基础聊天（✅ 真实 E2EE 链路已完成，安全门禁通过）
- [x] 开工首检：官方版本核实 + 最小工程实证；TS7/vue-tsc 不兼容 → **锁定 TypeScript 5.9.3**
      （`docs/M2-KICKOFF-CHECK.md`、`docs/DEPENDENCIES.md`、`docs/RISKS.md R4.3`）
- [x] **frontend/ 脚手架 + 设计系统基座**（Vue 3.5.45 + TS 5.9.3 + Vite 8.3.8 + Pinia 4.1.0 +
      vue-router 5.5.1 + vite-plugin-pwa 2.0.0）：`typecheck`/`build` 均通过、PWA 产物齐备、
      `package-lock.json` 入库、SW 排除 API 路径；见 `frontend/README.md`
- [x] **深色默认 + 浅色切换的原创极简科技风设计系统**（iPhone 优先：安全区 / 44px 点击区 /
      reduced-motion）、PWA 外壳 manifest / SW / 离线 toast / 更新提示
- [x] **可试用 demo 界面**（用户要求）：登录/邀请码注册表单、会话列表、私聊/群聊、时间、
      发送状态/已读、回复/撤回/表情、图片/文件/语音占位、搜索、设置六分页、主题切换、
      演示徽章与「E2EE 未接线」安全声明 —— 见 `docs/M2-DEMO-REPORT.md`
- [x] **demo 浏览器烟测 36/36**（真实 Chrome 390×844，含「全程不请求 Matrix/邀请 API、
      不请求外部域名」安全断言）；顺带修复离线浮层遮挡输入区的真实 UI 缺陷
- [x] **MatrixService（真实链路）**：登录 → 用返回 device_id 重建 client →
      `initRustCrypto({ useIndexedDB, cryptoDatabasePrefix, storageKey })` → sync PREPARED、
      WASM 路径固定（M0 F4）、解密轮询复核（M0 F3）
- [x] **加密就绪门禁（M2-R 修复 D4）**：查 SDK 源码定位 `unconfigured room` 竞态；
      用公开 API `isEncryptionEnabledInRoom()` + `getUserDeviceInfo(peers, true)` 有界等待
      房间加密配置/成员/设备密钥收敛；超时**取消发送且绝不降级明文**；
      仅对明确时序竞态做最多 3 次有界重试（M0 F1 工程化落地）
- [x] 双数据源状态层；免安装方案下真实模式由用户填写 HTTPS homeserver 并用已有账号登录，
      演示模式不联网；未实现能力显式提示、不插入假数据
- [x] **刷新守卫（M2-R 修复 D1）**：凭据只在内存；整页刷新后显式提示「真实会话已结束」
      并回登录页，不静默回退演示假数据
- [x] **严格加密判定（M2-R 修复 D2）**：仅依据 `m.room.encryption` 状态事件，
      不用「客户端 crypto 就绪」兜底误报 E2EE
- [x] **单元测试（Vitest 5.1.0）21/21**：会话标记不持久化凭据、严格加密判定、
      加密就绪门禁不降级明文/不重发、消息密文标记与 UTD、演示数据纯函数
- [x] **双浏览器 E2E（playwright）`npm run e2e:live` 32/32 ×3 连续通过**：
      真实 Synapse 双设备 Megolm 往返、服务器侧**本次新事件**差集密文证明
      （修复 D3 假通过）、管理面 404、无意外 4xx/console error、刷新守卫验收

> M2 安全门禁已通过，但**不等于可正式发布**：M3 真实恢复门禁尚未执行；M4 附件
> 代码与静态门禁已完成但真实门禁仍阻塞；M5/M6 通知与通话尚未实现。
> 详见 `docs/M2-LIVE-REPORT.md §5`。

## M3 — 安全中心（代码已实现 / 远程 homeserver 真实门禁待执行）

> 实现与静态门禁已完成，但真实 E2E 门禁尚未执行。现行方案不再等待 Docker；门禁必须
> 改为连接专用远程测试 homeserver，且不得对真实私人账号执行破坏性清数据测试。

- [x] 开工首检：安装版 `matrix-js-sdk 45.1.0` 的 `.d.ts` / 源码实证核对（`docs/M3-KICKOFF-CHECK.md`）
- [x] `security.ts` 纯逻辑（恢复密钥校验 / 状态汇总 / 设备合并）+ `security.test.ts` 13 项（单测 21 → **34/34**）
- [x] MatrixService：构造期 `cryptoCallbacks.getSecretStorageKey`、跨签名 + 4S + key backup 引导、
      恢复（`stop → 新建 client → 复用 cryptoDatabasePrefix`）、`refreshSecurity`、真实设备列表/撤销、SAS 全流程
- [x] 设置中心真实 UI（状态卡片、一次性恢复密钥、导入恢复、真实设备、SAS 表情/数字）与登录页恢复密钥输入
- [x] 恢复 fail-closed（错误密钥拒绝且停留登录页、不回退 demo）、`forgetSession()` 内存密钥清理
- [x] 修复恢复路径漏传 UIA 回调 + 用正确 `UIAuthCallback<void>` 替代 `as never`（安装版 `.d.ts` 实证）
- [x] `e2e/m3-security.mjs` 36 项安全门禁脚本 + `npm run e2e:m3`（**脚本已写、尚未真实执行**）
- [x] 静态门禁：`typecheck` 0 / `test` 34/34 / `build` 0 / `smoke` 36/36
- [ ] 用两个专用远程 Matrix 测试账号重写并执行恢复门禁（不得使用真实私人账号做破坏性清数据测试）
- [ ] 在选定 homeserver 上补跑文本 E2EE 回归
- [ ] 门禁通过后更新 README / CHANGELOG / M3-REPORT 并提交 M3 完成版本，再进入 M4
- [ ] onlyAllowTrustedDevices 策略评估 / QR 验证 / 新未验证设备显著提醒（M3 可选项，未实现）
- [ ] 撤销设备 → 密钥不再分发的真实 E2E 证明

## M4 — 加密附件（代码与静态门禁完成 / ⛔ 真实门禁待执行）
- [x] 按规范 EncryptedFile v2 实现图片/文件/语音附件加密上传下载（SDK 无高层 API）
- [x] SHA-256 完整性校验、篡改单测拒绝、空文件/20 MiB 上限 fail-closed
- [x] MediaRecorder 录音（最长 60 秒）与点击后本机解密播放
- [x] 双浏览器附件密文门禁已加入 `e2e:live`（媒体仓库密文、事件无文件名/明文、对端逐字节还原）
- [ ] 在选定 homeserver 上用两个测试账号执行附件密文门禁
- [ ] 与 Element 互操作；大文件分片与进度；iOS 真机录音格式验证

## M5 — 通知与 iOS
- [ ] Web Push（Sygnal 或等效推送网关评估）；通知仅"有新消息"无正文
- [ ] iOS 主屏幕安装引导→用户手势后申请权限；拒绝路径降级
- [ ] iOS Safari/主屏幕 PWA 真机测试：IndexedDB 驱逐、后台恢复、录音、通知

## M6 — 实时通话
- [ ] LiveKit v1.13.11 + lk-jwt-service v0.10.0 + Element Call v0.28.2 独立通话页集成
- [ ] MatrixRTC slot API（子路径导入）；1v1 与多人语音
- [ ] 媒体 E2EE 实测：密钥协商/SFU 不可解密验证；TURN 按网络测试配置
- [ ] 网络切换/弱网测试

## M7 — 发布门禁
- [x] Node 24 标准库免安装启动器：本地构建、静态托管、SPA fallback、安全响应头
- [x] 前端生产依赖审计 0 vulnerabilities；移除仓库内含 Olm 会话密钥的历史 stdout 日志
- [ ] 安全审查（日志红线扫描、依赖审计、渗透检查单）
- [ ] 备份/恢复演练（PG+媒体+密钥分离）、升级手册、性能测试
- [ ] **R2.6 收尾**：账号数监控告警、发码审计、房间成员上限策略评估
- [ ] 完整部署手册与运维文档；全量回归
