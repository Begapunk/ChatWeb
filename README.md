# Aether

私人端到端加密通讯 PWA。基于 Matrix 协议（Synapse + matrix-js-sdk + Rust Crypto WASM），
服务器只存储与转发密文，不持有解密聊天内容的密钥。

> **产品变更 M1-R1（2026-11-14，已生效）**：注册人数**不设上限**。
> 准入完全由管理员手动发放的一次性邀请码控制；`quota_counters` 仅作统计，
> `/admin/v1/quota` 返回 `unlimited=true` / `max_members=null`。
> 详见 [docs/M1-AMENDMENT-UNLIMITED.md](docs/M1-AMENDMENT-UNLIMITED.md)。

## 当前状态

- **M1 服务端与准入：已通过验收**（M1-R1 变更后回归 **172/172**）
- **M2：开工首检完成、工具链已锁定；前端脚手架待开发 —— 不宣称完成**

| 文档 | 说明 |
|---|---|
| [docs/M1-AMENDMENT-UNLIMITED.md](docs/M1-AMENDMENT-UNLIMITED.md) | **现行准入语义与权威变更清单**（回改文件 + 172/172 回归证据） |
| [docs/M2-KICKOFF-CHECK.md](docs/M2-KICKOFF-CHECK.md) | M2 开工首检：TS7/vue-tsc 不兼容实证，TypeScript 锁定 5.9.3 |
| [docs/M1-TEST-REPORT.md](docs/M1-TEST-REPORT.md) | M1 **变更前**原始验收（170/170）；引用须注明版本 |
| [docs/PRD-M1.md](docs/PRD-M1.md) · [docs/DESIGN-M1.md](docs/DESIGN-M1.md) | M1 基线（顶部均有 M1-R1 变更通告，原文保留可追溯） |
| [docs/DESIGN-M1-CHECKS.md](docs/DESIGN-M1-CHECKS.md) | §10 复核结论 |
| [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 部署指南 · 架构与信任边界 |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) · [docs/RISKS.md](docs/RISKS.md) | 版本锁定 · 风险清单 |
| [docs/M0-VERIFICATION-REPORT.md](docs/M0-VERIFICATION-REPORT.md) | M0 技术验证（110/110） |
| [TODO.md](TODO.md) | 里程碑计划 |

M1 已交付：Synapse(PG16) + Caddy + FastAPI 邀请服务的 Compose 部署、邀请码准入闭环
（哈希存储 / 过期 / 尝试次数 / 一次性 / 并发原子性）、注册后自动进入固定加密房间、
部署检查脚本与 A–J 集成测试套件。**产品 UI 尚未开发**（M2 起 Vue PWA）。

## 目录

```
frontend/               Vue 3 PWA 客户端（M2，待建）
backend/invite-service/ FastAPI 邀请管理 API（M1 已实现）
infra/                  synapse / postgres / caddy 配置（livekit / coturn 为 M6 预留）
scripts/                部署、检查、测试编排（render 为 Python 标准库，其余 bash）
docs/                   架构、设计、部署、备份/恢复/升级、测试文档
m0/                     M0 技术验证工程（可复跑）
m1/                     M1 集成测试工程（验收 A–J，Node + matrix-js-sdk）
```

## 部署与测试

```bash
cp .env.example .env         # 填入真实值（全部 __CHANGE_ME__）
scripts/deploy.sh            # 生产：拉镜像 → signing key 引导 → 渲染 → up
scripts/check-deploy.sh      # 部署安全检查（33 项，报告落 m1/reports/）

# 本地测试（Windows 11 + Docker Desktop，Git Bash）：
cp .env.example .env.test    # 值随机化（SYNAPSE_SERVER_NAME=aether.local 等，见 docs/DEPLOY.md）
scripts/run-m1-tests.sh --fresh        # 主套件 A–J（68 项，fresh 重建卷）
scripts/check-deploy.sh --local        # 部署安全检查（33 项）
scripts/run-m1-adversarial.sh          # QA 独立对抗套件（71 项，同栈即可）
```

> 名额上限已移除，套件不再竞争稀缺席位：**三套可在同一栈上连续跑**，
> `--fresh` 仅为结果可复现性推荐。合计 **172/172**（M1-R1 后基线）。

管理操作（生成/作废邀请码）走本机回环 + `X-Admin-Key`：

```bash
curl -X POST http://127.0.0.1:8000/admin/v1/codes -H "X-Admin-Key: …" -d '{"ttl_hours":72}'
```

## 复跑 M0 验证

前置：Node >=22、Docker（引擎运行中）、本机 Chrome。

```bash
cd m0
npm install                      # 锁定版本，见 package.json
node src/t01-wasm-load.mjs       # WASM + 加密存储
node src/t02-sdk-crypto-init.mjs # SDK CryptoApi 审计
node src/t03-e2ee-local.mjs      # 本地双机 Olm/Megolm
node src/t03b-attachment-encryption.mjs
node src/t04-browser-check.mjs   # 真实 Chrome
node src/setup-synapse.mjs       # 启动本地 Synapse（首次需镜像，见报告 F6）
node src/t05-synapse-e2ee.mjs    # Synapse 双设备全链路
node src/t06-browser-synapse.mjs # 双浏览器实例 E2EE
```

结果写入 `m0/results/*.json`。测试凭据随机生成于 `m0/.env.test` 与 `m0/browser-run/`（均已 gitignore）。

## 安全声明

- 聊天 E2EE：Olm/Megolm（Rust Crypto WASM），非自研算法。
- 附件：Matrix 规范 EncryptedFile（AES-256-CTR + SHA-256），密钥随加密房间事件分发。
- 通话（M6）：MatrixRTC + Element Call + LiveKit，媒体 E2EE 以实测为准；TLS/DTLS 不等于 E2EE。
- 清除浏览器数据前必须完成密钥备份，否则可能永久失去历史消息解密能力。
