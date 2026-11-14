# Aether M1 集成测试工程

覆盖 PRD-M1 §5 验收标准 A–J（H/J 由 `scripts/check-deploy.sh` 部署检查覆盖）。

## 运行

```bash
# 前置：本机 Docker Desktop 运行中；根目录 .env.test 已生成（见下）
# 全量复跑（推荐；重建卷，名额预算从 0 开始）：
scripts/run-m1-tests.sh --fresh

# QA 独立对抗性套件（必须独占全新栈，见下节）：
scripts/run-m1-adversarial.sh --fresh

# 单套件（栈已在运行时）：
cd m1 && npm install && npm run test:lifecycle   # 或 test:e2ee / test:quota / test:exposure / test:adversarial
```

### 两套编排为何不能同栈跑

`run-all.mjs` 用掉完整 4 席预算（管理员 + lifecycle 1 + e2ee 1 + quota 1）。
`test-adversarial.mjs` 也消耗完整 4 席（管理员 + CC 8 并发 1 + ST11 恢复 1 + Q1 末席 1）。
名额单调不回收（M1 不支持注销/替换），因此**两套必须分别在 `--fresh` 重建的栈上运行**。
`run-m1-adversarial.sh` 强制 `--fresh` 正是为了防止误用。

## 名额预算与执行顺序（重要）

四人名额是单调递增的（不支持注销回收）。全套件对名额有确定性预算，
`tests/run-all.mjs` 按**固定顺序**执行：

| 顺序 | 套件 | 验收 | 消耗名额 |
|---|---|---|---|
| 1 | test-lifecycle | A/B/C | +1（A 的成功 verify→注册） |
| 2 | test-e2ee | F | +1（新用户注册） |
| 3 | test-quota | D/E | +1（E 的 8 并发恰 1 成功；D 断言满员拒收） |
| 4 | test-exposure | G/I | 0 |

即：全新栈（自举管理员=1 席）跑完恰好 4/4。**同一栈不可重复跑全量**；
复跑请用 `scripts/run-m1-tests.sh --fresh`（down -v 重建卷）。

## 环境变量

- 根 `.env.test`：compose 本地栈全部变量（从 `.env.example` 生成，每轮随机机密；gitignore）。
- `m1/.env.test`（可选）：测试专用变量（`m1/.env.test.example`）；缺省时自动回退读根 `.env.test`。

## 关键工程约束

- **R3.5**：走本地 Caddy（自签证书）的请求使用 helpers.mjs 内**专用** `https.Agent({rejectUnauthorized:false})`；
  禁止 `NODE_TLS_REJECT_UNAUTHORIZED=0`。SDK 客户端走 Synapse 直连回环 `http://127.0.0.1:8008`。
- **R3.3**：所有请求固定走 127.0.0.1。
- B 用例（过期码）通过 `docker compose exec postgres psql` 推进 `expires_at`（测试专用时间通道）。
- 吸收 M0 发现：F1 设备可见等待、F3 解密轮询断言、事实 9（注册返回 device_id 重建 client）。
- 凭据每轮随机；报告（`m1/reports/`，gitignore）不含任何码/令牌/密码明文。

## 验收对照表

| PRD §5 验收 | 位置 |
|---|---|
| A 邀请码重复使用 | test-lifecycle.mjs A1–A6 |
| B 过期邀请码 | test-lifecycle.mjs B1–B3 |
| C 尝试超限 | test-lifecycle.mjs C1–C6 |
| D 四人上限 | test-quota.mjs D1–D4 |
| E 并发注册竞态 | test-quota.mjs E1–E8 |
| F 注册后自动进入加密房间 | test-e2ee.mjs F1–F16 |
| G 管理 API 不对浏览器暴露 | test-exposure.mjs G1–G10 |
| H 联邦关闭 | scripts/check-deploy.sh（配置+行为断言） |
| I 公开注册与访客关闭 | test-exposure.mjs I1–I3 + check-deploy.sh |
| J 部署检查与运维占位 | scripts/check-deploy.sh + docs/{DEPLOY,BACKUP,RESTORE,UPGRADE}.md |

## QA 独立对抗套件（`test-adversarial.mjs`）

`run-all.mjs` 未覆盖或覆盖较浅的边角与错误路径，由 `scripts/run-m1-adversarial.sh --fresh`
在**独占全新栈**执行（71/71）。覆盖：带真实管理员 Token 经公网入口探测、8 种路径穿越/编码
变体、文档内省端点关闭、docker inspect 机密面、REVOKED 语义、过期先于哈希、BLOCKED 终态、
同码 8 并发原子性、恢复路径、畸形请求与 20 并发未知码冲击、三容器日志红线、审计表与表结构
无明文列，以及 `Q6 [LR-M1-1]` 名额口径分歧的显式观测断言。

## 最终验收结果

| 套件 | 结果 |
|---|---|
| 主集成套件（`run-m1-tests.sh --fresh`） | **68/68** |
| 部署检查（`check-deploy.sh --local`） | **31/31** |
| 独立对抗套件（`run-m1-adversarial.sh --fresh`） | **71/71** |
| 合计 | **170/170** |

详见 [docs/M1-TEST-REPORT.md](../docs/M1-TEST-REPORT.md)。
