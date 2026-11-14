# Aether 架构设计（M0 基线版）

> 状态：M0 技术验证阶段。本文档描述目标架构与已验证的技术事实，随里程碑演进更新。
> 最后更新：2026-11-14

## 1. 系统定位

Aether 是一个**仅供 4 名固定成员**使用的私人端到端加密通讯 PWA。服务器（Synapse）只负责
转发与存储**密文**，不持有能解密聊天内容的密钥。产品形态为安装到主屏幕的 Web App，
优先适配 iPhone，深色极简科技风。

## 2. 组件与信任边界

```
                        ┌────────────────────────────────────────────┐
                        │                 用户设备                     │
                        │  Vue3 PWA (Aether UI)                       │
                        │  ├─ matrix-js-sdk 45.1.0                    │
                        │  ├─ Rust Crypto WASM 18.9.2 (Olm/Megolm)    │
                        │  │   └─ IndexedDB 加密存储 (storageKey)      │
                        │  ├─ WebCrypto 附件加密 (AES-256-CTR, 规范格式)│
                        │  ├─ Service Worker + Web Push               │
                        │  └─ Element Call 页面 (MatrixRTC/LiveKit)    │
                        └───────────────┬────────────────────────────┘
                                        │ HTTPS (TLS 仅保护传输层)
                                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Caddy (反向代理, 自动 HTTPS, 唯一公网入口 443/80)                        │
│  ├─ /            → Aether 前端静态资源                                 │
│  ├─ /_matrix     → Synapse :8008                                      │
│  ├─ /invite-api  → FastAPI 邀请服务 :8000 (仅暴露注册相关端点)           │
│  ├─ /call        → Element Call 静态资源 (独立通话页)                   │
│  └─ /livekit     → LiveKit SFU (WSS)  [M6]                            │
└───────────────────────────────────────────────────────────────────────┘
        │                    │                         │
        ▼                    ▼                         ▼
┌──────────────┐   ┌──────────────────┐   ┌─────────────────────────┐
│ Synapse      │   │ FastAPI 邀请服务   │   │ LiveKit + lk-jwt-service │
│ v1.165.0     │   │ (Python 3.12+)    │   │ [M6]                     │
│ 仅存密文      │◄──┤ 管理 Token 仅存在  │   │ SFU 转发加密媒体帧        │
│ PostgreSQL 16│   │ 服务端环境变量     │   │ 媒体密钥经 Matrix ToDevice│
│ (不暴露公网)  │   │ 邀请码只存哈希     │   │ 端到端分发, SFU 不可解密   │
└──────────────┘   └──────────────────┘   └─────────────────────────┘
        │
        ▼
┌──────────────┐
│ coturn [M6]  │  TURN 仅作 NAT 穿透补充，按网络测试结果启用
└──────────────┘
```

**信任边界要点**

1. E2EE 边界在**设备**上：Olm（1:1 设备间）+ Megolm（房间群组）由 Rust Crypto WASM 实现，
   密钥只存在于设备 IndexedDB（用 32 字节 `storageKey` 加密）与服务器端 SSSS 密钥备份（密文）。
2. Synapse 管理 Token、LiveKit Secret、注册共享密钥**只存在于服务端环境变量/Docker secrets**，
   浏览器与前端代码永不接触。邀请服务是唯一调用 Synapse 管理 API 的组件。
3. TLS 不是 E2EE；WebRTC DTLS-SRTP 也不是通话 E2EE。通话 E2EE 依赖 MatrixRTC 的
   每成员密钥分发（SDK 中已确认存在 `EncryptionManager`/`RTCEncryptionManager`/
   `ToDeviceKeyTransport`/`LivekitTransport`），M6 必须实测验证。
4. 附件（图片/文件/语音）按 Matrix 规范 `EncryptedFile` 格式用 WebCrypto AES-256-CTR 加密后
   上传，解密密钥随 Megolm 加密的房间事件分发。**matrix-js-sdk 45.1.0 不提供高层附件加密
   辅助函数**（已审计确认），M4 需按规范自行实现该格式（非自创算法）。

## 3. 用户与准入

- 全系统最多 4 个正式账号（含管理员）。
- 注册唯一途径：一次性邀请码 → FastAPI 校验（哈希比对、过期、次数限制）→
  调用 Synapse 官方注册令牌 API（`POST /_synapse/admin/v1/registration_tokens/new`，M0 已实测）
  → 前端用令牌完成 `m.login.registration_token` 注册（M0 已实测）。
- Synapse 配置：`enable_registration: true` + `registration_requires_token: true`、
  禁止访客、`federation_domain_whitelist: []` 关闭联邦、房间全部邀请制私有加密房间。
- 注册成功后由邀请服务/管理员账号邀请进入固定四人群聊与相应私聊房间。

## 4. 前端架构（M2 起实施）

- Vue 3.5 + TypeScript + Vite 8 + Pinia 4 + Vue Router 5（版本见 DEPENDENCIES.md）。
- 状态分层：`session`（登录/设备）、`crypto`（验证/备份状态）、`rooms`（会话列表）、
  `messages`（按房间分页）、`calls`、`settings`。
- matrix-js-sdk 客户端单例封装为 `MatrixService`：登录、`initRustCrypto`、sync 生命周期、
  前台恢复补同步（`startClient` 续传 sync token，M0 已实测离线补同步）。
- PWA：vite-plugin-pwa 2（Workbox 7.4），应用外壳离线缓存；通知仅显示"有新消息"，
  不含正文；iOS 引导添加到主屏幕后再申请通知权限（iOS 16.4+ 主屏幕 PWA 才支持 Web Push）。
- 通话：独立 Element Call 页面以 iframe/新窗口集成，走 Matrix widget 认证，不复制其品牌资产。

## 5. 目录结构

```
aether/
├─ frontend/               Vue PWA 客户端（M2 起）
├─ backend/invite-service/ FastAPI 邀请管理 API（M1 起）
├─ infra/
│  ├─ synapse/             homeserver.yaml 模板与调优
│  ├─ postgres/            初始化与迁移
│  ├─ caddy/               Caddyfile
│  ├─ livekit/             LiveKit + lk-jwt-service 配置（M6）
│  └─ coturn/              TURN 配置（M6，按测试启用）
├─ scripts/                部署/备份/恢复/升级脚本
├─ docs/                   架构、安全、部署、恢复、测试文档
└─ m0/                     M0 技术验证工程（本报告附带，可复跑）
```

## 6. 里程碑与验证对应

| 里程碑 | 范围 | 关键验证 |
|---|---|---|
| M0 | 依赖锁定、API 审计、E2EE 可行性 | T01–T06（见 M0-VERIFICATION-REPORT.md） |
| M1 | Synapse+PG+Caddy+邀请服务、4 人上限 | 邀请码生命周期、超额拒绝、联邦关闭 |
| M2 | Vue PWA 登录/聊天/同步 | 双浏览器私聊群聊、历史与离线同步 |
| M3 | 设备验证/跨签名/备份恢复/撤销 | 清数据后恢复、未验证设备提醒 |
| M4 | 图片/文件/语音（加密附件） | 附件密文上传、跨设备解密、篡改检测 |
| M5 | Web Push/iOS PWA | 权限拒绝路径、iOS 主屏幕通知 |
| M6 | MatrixRTC/Element Call/LiveKit | 1v1 与 4 人通话媒体 E2EE 实测 |
| M7 | 安全审查/备份恢复/性能/文档 | 全量回归、发布门禁 |