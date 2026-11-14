# Aether

四人私人端到端加密通讯 PWA。基于 Matrix 协议（Synapse + matrix-js-sdk + Rust Crypto WASM），
服务器只存储与转发密文，不持有解密聊天内容的密钥。

## 当前状态：M1 服务端与准入已通过 QA 正式验收（170/170 项检查，含 1 项非阻断遗留）

- **M1 验收报告**：[docs/M1-TEST-REPORT.md](docs/M1-TEST-REPORT.md)（主套件 68/68 + 部署检查 31/31 + 独立对抗套件 71/71）
- M1 设计：[docs/DESIGN-M1.md](docs/DESIGN-M1.md) · §10 复核结论：[docs/DESIGN-M1-CHECKS.md](docs/DESIGN-M1-CHECKS.md)
- M1 需求：[docs/PRD-M1.md](docs/PRD-M1.md) · 部署指南：[docs/DEPLOY.md](docs/DEPLOY.md)
- M0 验证报告：[docs/M0-VERIFICATION-REPORT.md](docs/M0-VERIFICATION-REPORT.md)
- 架构设计：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 版本锁定：[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)
- 风险清单：[docs/RISKS.md](docs/RISKS.md)
- 后续计划：[TODO.md](TODO.md)

**产品 UI 尚未开发**（M2 起 Vue PWA）。M1 交付：Synapse(PG16) + Caddy + FastAPI 邀请服务的
Compose 部署、邀请码准入闭环（4 人名额事务锁）、注册后自动进入固定加密房间、
部署检查脚本与 A–J 集成测试套件。

> **M2 开工前需决策**：遗留 [LR-M1-1](docs/M1-TEST-REPORT.md) —— 名额在「发令牌」时预占且
> 单调不回收，与 `PRD Q4`「名额 = Synapse 正式用户数」的文字口径不一致。该行为 fail-closed
> （不会放入第 5 人），但令牌发了未注册会永久占席。QA 未擅自变更需求基线，详见验收报告 §4 D-3。

## 目录

```
frontend/               Vue 3 PWA 客户端（M2）
backend/invite-service/ FastAPI 邀请管理 API（M1 已实现）
infra/                  synapse / postgres / caddy 配置（livekit / coturn 为 M6 预留）
scripts/                部署、检查、测试编排（render 为 Python 标准库，其余 bash）
docs/                   架构、设计、部署、备份/恢复/升级、测试文档
m0/                     M0 技术验证工程（可复跑）
m1/                     M1 集成测试工程（验收 A–J，Node + matrix-js-sdk）
```

## 部署与测试（M1）

```bash
cp .env.example .env         # 填入真实值（全部 __CHANGE_ME__）
scripts/deploy.sh            # 生产：拉镜像 → signing key 引导 → 渲染 → up
scripts/check-deploy.sh      # 部署安全检查（报告落 m1/reports/）

# 本地测试（Windows 11 + Docker Desktop，Git Bash）：
cp .env.example .env.test    # 值随机化（SYNAPSE_SERVER_NAME=aether.local 等，见 docs/DEPLOY.md）
scripts/run-m1-tests.sh --fresh        # 主套件 A–J（68 项）+ 起栈
scripts/check-deploy.sh --local        # 部署安全检查（31 项）
scripts/run-m1-adversarial.sh --fresh  # QA 独立对抗套件（71 项，独占全新栈）
```

> 四人名额单调且只有 4 席：主套件与对抗套件**必须各自在 `--fresh` 重建的栈上运行**，
> 不可同栈复跑。详见 [m1/README.md](m1/README.md) 与验收报告 §4 D-2。

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