# Aether

私人通讯 PWA 项目。当前开发分支 `feat/aether-serverless-p2p` 正在转向四人无服务器 P2P 聊天；默认首页是本地设备与真实 WebRTC 聊天流程。原 Matrix、Cloudflare 代码和线上测试站保留为历史资料。P2P 测试网页已发布在 [GitHub Pages](https://begapunk.github.io/ChatWeb/)，但尚未在中国大陆不同运营商的真实手机上验证，不能宣称完成正式产品。当前实现、测试和限制见 [P2P 开发状态](docs/P2P-DEVELOPMENT.md)。

下方内容是早期 Matrix/Cloudflare 阶段的历史记录，不代表当前 P2P 分支的发布状态。

## 免安装本地预览

双击 `start-aether.cmd`，然后打开终端显示的 `http://127.0.0.1:4173`。
脚本只执行现有依赖的本机构建，不运行 `npm install` / `npm ci`。本地预览保留演示模式，
但没有 Cloudflare Worker，不能用来证明 `/api/health` 或 `/api/ws` 可达。

旧免安装 Matrix 方案与 Synapse/PostgreSQL/Caddy/邀请服务代码保留为历史资料，
见 [docs/NO-INSTALL.md](docs/NO-INSTALL.md)。

> **产品变更 M1-R1（2026-11-14，已生效）**：注册人数**不设上限**。
> 准入完全由管理员手动发放的一次性邀请码控制；`quota_counters` 仅作统计，
> `/admin/v1/quota` 返回 `unlimited=true` / `max_members=null`。
> 详见 [docs/M1-AMENDMENT-UNLIMITED.md](docs/M1-AMENDMENT-UNLIMITED.md)。

## 当前状态

- **M1 服务端与准入：已通过验收**（M1-R1 变更后回归 **172/172**）
- **M2 真实加密链路：已实现并通过安全阻断门禁** ✅
  - 双浏览器 E2EE 验收 `npm run e2e:live` **32/32，连续三次通过**；
    服务器侧实证本次事件只有 `m.room.encrypted`（Megolm 密文），不含明文
  - 当前单元测试 **40/40**、`typecheck` / `build` 通过、免安装启动路径浏览器烟测 **38/38**
  - 完整报告：[docs/M2-LIVE-REPORT.md](docs/M2-LIVE-REPORT.md)
- **M3 密钥备份/恢复：代码已实现，需在用户选定的远程 homeserver 上重新验收**
  - 已实现 4S/SSSS 恢复密钥、服务器 key backup、跨签名、真实设备列表与撤销、SAS 验证、安全中心与登录页恢复入口
  - 静态门禁通过：`typecheck` 0 / 单测 **34/34** / `build` 0 / demo 回归 **36/36**；`e2e:m3` 36 项门禁脚本已编写但**尚未真实执行**
  - 原本机 Docker 门禁已取消；旧结果不能自动代表任意第三方 homeserver
  - 权威说明：[docs/M3-REPORT.md](docs/M3-REPORT.md)；风险项 `docs/RISKS.md R5.4`
- **演示模式仍保留**：无需 Docker 即可试用界面，但它**不联网、不加密**，
  与真实链路在 UI 上显式区分；请勿用于任何真实私密对话

> 真实模式不再创建本机账号：请填写服务商提供的 homeserver 地址和已有账号。

> ⛔ **M3 不得宣称完成**：恢复链路的代码与静态测试已落地，但「清除浏览器数据 → 恢复 →
> 历史密文重新解密」的**真实安全门禁尚未执行**，因此不得宣称密钥恢复/跨签名验证可用。
> 在门禁通过前，**清除浏览器数据仍会丢失本设备解密密钥、历史消息无法解密**；
> 凭据只在内存，刷新页面需重新连接服务器（UI 会明确提示，不会静默回退演示数据）。
> M4 加密附件代码与静态门禁已完成，但需用两个远程 Matrix 测试账号重新执行真实门禁；
> M5 Web Push、M6 通话与 M7 其余发布门禁仍未完成。
> 当前版本**不可作为正式私密通讯工具发布**，见 [docs/M3-REPORT.md](docs/M3-REPORT.md)。

| 文档 | 说明 |
|---|---|
| [docs/M1-AMENDMENT-UNLIMITED.md](docs/M1-AMENDMENT-UNLIMITED.md) | **现行准入语义与权威变更清单**（回改文件 + 172/172 回归证据） |
| [docs/M3-REPORT.md](docs/M3-REPORT.md) | **M3 现行状态权威报告**：实现范围、静态门禁证据、36 项安全门禁设计、Docker 引擎阻断诊断与恢复步骤 |
| [docs/M3-KICKOFF-CHECK.md](docs/M3-KICKOFF-CHECK.md) | M3 开工首检：跨签名 / 4S / 恢复 / SAS 的安装版 SDK API 实证核对 |
| [docs/M2-LIVE-REPORT.md](docs/M2-LIVE-REPORT.md) | **M2 真实链路权威验收报告**：32/32 双浏览器 E2EE 门禁、4 个真实缺陷修复、SDK 实证、边界清单 |
| [docs/M2-DEMO-REPORT.md](docs/M2-DEMO-REPORT.md) | M2 演示版交付报告（历史快照）：36/36 烟测、离线浮层缺陷、试用方法 |
| [docs/M2-KICKOFF-CHECK.md](docs/M2-KICKOFF-CHECK.md) | M2 开工首检 + 脚手架验证：TS7/vue-tsc 不兼容实证，TypeScript 锁定 5.9.3 |
| [frontend/README.md](frontend/README.md) | 前端试用/命令、目录、设计系统、PWA 缓存红线与剩余待办 |
| [docs/M1-TEST-REPORT.md](docs/M1-TEST-REPORT.md) | M1 **变更前**原始验收（170/170）；引用须注明版本 |
| [docs/PRD-M1.md](docs/PRD-M1.md) · [docs/DESIGN-M1.md](docs/DESIGN-M1.md) | M1 基线（顶部均有 M1-R1 变更通告，原文保留可追溯） |
| [docs/DESIGN-M1-CHECKS.md](docs/DESIGN-M1-CHECKS.md) | §10 复核结论 |
| [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 部署指南 · 架构与信任边界 |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) · [docs/RISKS.md](docs/RISKS.md) | 版本锁定 · 风险清单 |
| [docs/M0-VERIFICATION-REPORT.md](docs/M0-VERIFICATION-REPORT.md) | M0 技术验证（110/110） |
| [TODO.md](TODO.md) | 里程碑计划 |

M1 已交付：Synapse(PG16) + Caddy + FastAPI 邀请服务的 Compose 部署、邀请码准入闭环
（哈希存储 / 过期 / 尝试次数 / 一次性 / 并发原子性）、注册后自动进入固定加密房间、
部署检查脚本与 A–J 集成测试套件。M2 已交付 Vue PWA 客户端，并**接通真实
Synapse + Rust Crypto WASM 的 Megolm 端到端加密链路**，双浏览器安全门禁通过；
演示模式作为无需服务器的界面试用入口保留。

## 目录

```
frontend/               Vue 3 PWA 客户端（M2 真实 E2EE 链路已接通；演示模式并存）
backend/invite-service/ FastAPI 邀请管理 API（M1 已实现）
infra/                  synapse / postgres / caddy 配置（livekit / coturn 为 M6 预留）
scripts/                部署、检查、测试编排（render 为 Python 标准库，其余 bash）
docs/                   架构、设计、部署、备份/恢复/升级、测试文档
m0/                     M0 技术验证工程（可复跑）
m1/                     M1 集成测试工程（验收 A–J，Node + matrix-js-sdk）
```

## 旧版自托管部署与测试（历史，可忽略）

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
- **真实链路（live 模式）已达成第 1 条**：双浏览器验收实证服务器只见 `m.room.encrypted`
  Megolm 密文、对端用自身密钥解密出明文，见 `docs/M2-LIVE-REPORT.md`。
- **第 2 条已实现并通过单测，但真实双浏览器门禁尚未执行**；第 3/4 条（通话媒体 E2EE、
  密钥备份恢复）仍未通过真实门禁。
  因此**清除浏览器数据仍会永久失去历史消息解密能力**，当前版本不可作为正式私密通讯工具发布。
- **演示模式不满足任何一条运行时保证**：不产生密钥、不加密、不联网，仅用于验证界面与交互。
  两种模式在 UI 上显式区分；整页刷新导致真实会话失效时会强制回到登录页提示，不静默回退 demo。
