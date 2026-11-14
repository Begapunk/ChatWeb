# TODO（按里程碑）

## M0 — 已完成 ✅
- [x] 环境检查、版本锁定、API 审计
- [x] T01–T06 验证（110/110）
- [x] 架构/依赖/风险/计划/报告文档
- [ ] **等待用户授权进入 M1**

## M1 — 服务端与准入（已完成 ✅ QA 正式验收 170/170）
- [x] Docker Compose：Synapse + PostgreSQL 16 + Caddy + FastAPI 邀请服务（镜像源参数化）
- [x] homeserver.yaml 生产模板：禁联邦/禁访客/注册令牌/媒体限制/日志红线
- [x] 邀请服务：安全随机邀请码、仅存哈希、过期/次数限制、4 人名额事务锁
- [x] 管理 Token 仅服务端环境变量；Caddy 不暴露 /_synapse/admin
- [x] 注册后自动加入固定加密群聊与私聊房间
- [x] 部署检查脚本（逐项断言安全配置）、.env.example、数据库迁移
- [x] 集成测试：邀请码重复使用、超额、过期、并发注册竞态（吸收 F1）
- [x] QA 正式集成测试（验收 A–J）与验收报告 `docs/M1-TEST-REPORT.md`
      —— 主套件 68/68 + 部署检查 31/31 + 独立对抗套件 71/71 = **170/170**
- [x] git 初始化、提交前机密扫描（86,597 行 / 0 处硬编码机密）
- [ ] **LR-M1-1（M2 开工前需决策）**：名额预占不回收与 PRD Q4 口径分歧，
      见 `docs/M1-TEST-REPORT.md §4 D-3` / `docs/RISKS.md R2.5`

## M2 — Vue PWA 基础聊天
- [ ] 开工首检：TS7/Vite8/vue-router5/pinia4 最小构建兼容性
- [ ] MatrixService：登录、initRustCrypto(storageKey)、sync 生命周期、前台补同步、发送前设备可见等待（F1）、UTD 重试
- [ ] 登录/邀请注册/会话列表/私聊/群聊/时间/发送状态/已读/回复/撤回/搜索
- [ ] 深色默认+浅色切换的原创极简科技风设计系统（iPhone 优先）
- [ ] PWA 外壳：manifest/SW/离线/更新提示（vite-plugin-pwa 2 + workbox 7.4）
- [ ] 双浏览器 E2E（playwright）：四账号四设备基线

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
- [ ] MatrixRTC slot API（子路径导入）；1v1 与 4 人语音
- [ ] 媒体 E2EE 实测：密钥协商/SFU 不可解密验证；TURN 按网络测试配置
- [ ] 网络切换/弱网测试

## M7 — 发布门禁
- [ ] 安全审查（日志红线扫描、依赖审计、渗透检查单）
- [ ] 备份/恢复演练（PG+媒体+密钥分离）、升级手册、性能测试
- [ ] 完整部署手册与运维文档；全量回归