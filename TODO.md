# TODO（按里程碑）

> 2026-11-14 更新：M1-R1「彻底移除名额限制」已实现并回归（**172/172**）；
> M2 开工首检完成。权威说明见 `docs/M1-AMENDMENT-UNLIMITED.md` 与 `docs/M2-KICKOFF-CHECK.md`。

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

## M2 — Vue PWA 基础聊天（进行中）
- [x] 开工首检：官方版本核实 + 最小工程实证；TS7/vue-tsc 不兼容 → **锁定 TypeScript 5.9.3**
      （`docs/M2-KICKOFF-CHECK.md`、`docs/DEPENDENCIES.md`、`docs/RISKS.md R4.3`）
- [ ] **frontend/ 脚手架**（Vue 3.5.45 + TS 5.9.3 + Vite 8.3.8 + Pinia 4.1.0 +
      vue-router 5.5.1 + vite-plugin-pwa 2.0.0）
- [ ] MatrixService：登录、initRustCrypto(storageKey)、sync 生命周期、前台补同步、
      发送前设备可见等待（F1）、UTD 重试
- [ ] 登录/邀请注册/会话列表/私聊/群聊/时间/发送状态/已读/回复/撤回/搜索
- [ ] 深色默认+浅色切换的原创极简科技风设计系统（iPhone 优先）
- [ ] PWA 外壳：manifest/SW/离线/更新提示（vite-plugin-pwa 2 + workbox 7.4）
- [ ] 双浏览器 E2E（playwright）：多账号多设备基线（人数上限已移除，不再限四账号）

## M3 — 安全中心
- [ ] 设备列表/验证状态/跨签名验证（emoji/QR）/设备撤销
- [ ] 密钥备份引导、恢复密钥/口令恢复、清数据前强警告
- [ ] 新未验证设备显著提醒；onlyAllowTrustedDevices 策略评估
- [ ] 测试：清浏览器数据→恢复→历史解密；撤销设备→密钥不再分发

## M4 — 加密附件
- [ ] 按规范 EncryptedFile 实现图片/文件/语音附件加密上传下载（SDK 无高层 API）
- [ ] 语音录制（MediaRecorder，iOS 差异）与播放
- [ ] 与 Element 互操作验证；篡改/截断检测；大文件分片与进度

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
- [ ] 安全审查（日志红线扫描、依赖审计、渗透检查单）
- [ ] 备份/恢复演练（PG+媒体+密钥分离）、升级手册、性能测试
- [ ] **R2.6 收尾**：账号数监控告警、发码审计、房间成员上限策略评估
- [ ] 完整部署手册与运维文档；全量回归
