# Aether M1 集成测试工程

覆盖 PRD-M1 §5 验收标准 A–J（H/J 由 `scripts/check-deploy.sh` 部署检查覆盖）。

> **M1-R1（2026-11-14 用户决策，已生效）**：注册人数上限已彻底移除。
> D/E 验收按无上限语义执行；套件不再竞争稀缺席位，**三套可在同一栈上连续跑**。
> 权威说明见 [docs/M1-AMENDMENT-UNLIMITED.md](../docs/M1-AMENDMENT-UNLIMITED.md)。

## 运行

```bash
# 前置：本机 Docker Desktop 运行中；根目录 .env.test 已生成（见下）
# 全量复跑（推荐：重建卷，统计与账号从 0 开始，结果可复现）：
scripts/run-m1-tests.sh --fresh

# QA 独立对抗性套件（同栈即可，无需重建；也可加 --fresh）：
scripts/run-m1-adversarial.sh

# 部署安全检查：
scripts/check-deploy.sh --local

# 单套件（栈已在运行时）：
cd m1 && npm install && npm run test:lifecycle   # 或 test:e2ee / test:quota / test:exposure / test:adversarial
```

### 执行顺序与可复现性

`tests/run-all.mjs` 按固定顺序执行以保持套件间状态可预期：
`lifecycle → e2ee → quota → exposure`。

**名额上限已移除**：`quota_counters.seats_used` 只是统计值，`/admin/v1/quota` 恒为
`unlimited=true` / `max_members=null`，不再有「4 席预算」。因此：

- 主套件与对抗套件**不再需要各自 `--fresh` 独占全新栈**，同一栈可连续、重复执行；
- `--fresh`（`down -v` 重建卷）仅用于结果可复现，**非硬性要求**；
- `run-m1-adversarial.sh` 的 `--fresh` 已由强制改为可选。

| 顺序 | 套件 | 验收 | 对统计的影响 |
|---|---|---|---|
| 1 | test-lifecycle | A/B/C | A 的成功 verify → `seats_used` +1 |
| 2 | test-e2ee | F | 新用户注册 → `synapse_count` +1 |
| 3 | test-quota | D/E（无上限） | 8 枚不同码并发全成功 → `seats_used` +8，抽样注册 2 个账号 |
| 4 | test-exposure | G/I | 0（不发码） |

以上仅为观测说明，**不构成任何容量约束**；任何时候继续发新码都应成功。

## 环境变量

- 根 `.env.test`：compose 本地栈全部变量（从 `.env.example` 生成，每轮随机机密；gitignore）。
  M1-R1 起**不再有 `AETHER_MAX_MEMBERS`**。
- `m1/.env.test`（可选）：测试专用变量（`m1/.env.test.example`）；缺省时自动回退读根 `.env.test`。

## 关键工程约束

- **R3.5**：走本地 Caddy（自签证书）的请求使用 helpers.mjs 内**专用** `https.Agent({rejectUnauthorized:false})`；
  禁止 `NODE_TLS_REJECT_UNAUTHORIZED=0`。SDK 客户端走 Synapse 直连回环 `http://127.0.0.1:8008`。
- **R3.3**：所有请求固定走 127.0.0.1；清除 `NODE_USE_ENV_PROXY` 影响并使用显式专用 Agent。
- Synapse `rc_registration` 限流：注册探测与抽样注册均做有界退避重试（避免 429 假失败）。
- B 用例（过期码）通过 `docker compose exec postgres psql` 推进 `expires_at`（测试专用时间通道）。
- 吸收 M0 发现：F1 设备可见等待、F3 解密轮询断言、事实 9（注册返回 device_id 重建 client）。
- 凭据每轮随机；报告（`m1/reports/`，gitignore）不含任何码/令牌/密码明文。

## 验收对照表（D 已按 M1-R1 变更）

| PRD §5 验收 | 位置 |
|---|---|
| A 邀请码重复使用 | test-lifecycle.mjs A1–A6 |
| B 过期邀请码 | test-lifecycle.mjs B1–B3 |
| C 尝试超限 | test-lifecycle.mjs C1–C6 |
| D **无名额上限**（原「四人上限」已废止） | test-quota.mjs U0–U12 |
| E 并发注册竞态（8 枚不同码全成功，不再是恰 1 成功） | test-quota.mjs U1–U4 |
| F 注册后自动进入加密房间 | test-e2ee.mjs F1–F16 |
| G 管理 API 不对浏览器暴露 | test-exposure.mjs G1–G10 |
| H 联邦关闭 | scripts/check-deploy.sh（配置+行为断言） |
| I 公开注册与访客关闭 | test-exposure.mjs I1–I3 + check-deploy.sh |
| J 部署检查与运维占位 | scripts/check-deploy.sh + docs/{DEPLOY,BACKUP,RESTORE,UPGRADE}.md |

## QA 独立对抗套件（`test-adversarial.mjs`）

覆盖 `run-all.mjs` 未覆盖或较浅的边角与错误路径：带真实管理员 Token 经公网入口探测、
8 种路径穿越/编码变体、文档内省端点关闭、docker inspect 机密面、REVOKED 语义、
过期先于哈希、BLOCKED 终态、同码 8 并发原子性（CC1：恰 1 成功 7 used）、恢复路径、
畸形请求与 20 并发未知码冲击、三容器日志红线、审计表与表结构无明文列。
Q1–Q6 由原「末席/满员/LR-M1-1 观测」改为**无名额上限**语义。

## 最终验收结果（M1-R1 后，2026-11-14 重新回归）

| 套件 | 命令 | 结果 |
|---|---|---|
| 主集成套件 | `run-m1-tests.sh --fresh` | **68/68**（19+16+13+20） |
| 部署检查 | `check-deploy.sh --local` | **33/33**（原 31 + 新增 2） |
| 独立对抗套件 | `run-m1-adversarial.sh`（同栈，无 `--fresh`） | **71/71** |
| 合计 | | **172/172，0 失败** |

关键证据：8 枚不同码并发 `[200×8]`、第 5/6 个账号注册成功、`seats_used` 3→11、
对抗套件在 `pre=14` 的同一栈上仍能发码。原始日志 `m1/reports/rerun-unlimited-*.log`。

> `docs/M1-TEST-REPORT.md` 的 **170/170** 是 M1-R1 **变更前**版本，引用须注明版本。
