# Aether M1 集成测试与验收报告

> 日期：2026-11-14 · 执行：QA 独立验收（主理人直接接手，未沿用工程师自测结论）
> 被测对象：M1 服务端与准入（Docker Compose / Synapse v1.165.0 / PostgreSQL 16 / Caddy v2.11.9 / FastAPI 邀请服务）
> 上游基线：`docs/PRD-M1.md §5`（验收 A–J）、`docs/DESIGN-M1.md`、`docs/DESIGN-M1-CHECKS.md`
> **判定：通过（含 1 项非阻断设计口径遗留 LR-M1-1，需 M2 前由用户决策）**
>
> ---
> **⚠️ 历史报告说明（2026-11-14 补记，原文不改动以维持审计可追溯）**：
> 本报告记录的是 M1 原始验收（**四人名额上限版本**）的结论与证据。用户随后决策
> 「彻底移除名额限制」（变更 **M1-R1**），因此本报告中的 D/E 验收描述、
> `Q6 [LR-M1-1]` 观测断言、§4 D-2「4 席预算必须独占 fresh 栈」、§4 D-3、
> §7 遗留项 **均已失效**：LR-M1-1 由该变更直接消解（不再有席位上限，
> 「预占/不回收/口径分歧」不复存在），且两套测试不再需要各自 fresh 独占栈。
>
> 现行语义、代码回改清单、三套测试的重新回归结果见
> [docs/M1-AMENDMENT-UNLIMITED.md](M1-AMENDMENT-UNLIMITED.md)。
> **引用本报告的 170/170 等数字时须注明「M1-R1 变更前版本」。**
> ---

---

## 1. 结论摘要

| 套件 | 覆盖 | 结果 |
|---|---|---|
| 主集成套件 `run-all.mjs`（4 组） | A/B/C、D/E、F、G/I | **68/68** |
| 部署检查 `check-deploy.sh --local` | G/H/I/J 配置与行为断言 | **31/31** |
| QA 独立对抗套件 `test-adversarial.mjs` | 路径穿越/真实凭据/状态机边角/并发原子性/畸形请求/日志红线 | **71/71** |
| **合计** | | **170/170，失败 0** |

三套均在**独立的全新栈**（`--fresh` 重建卷）上复跑通过；主套件与部署检查同栈，对抗套件独占另一栈（原因见 §4 D-1）。

**安全结论**：服务器仅存 Megolm 密文、无明文；带真实管理员 Token 经公网入口访问管理 API 一律 404；管理端点无密钥 401、错密钥 401；Caddy 容器 env 与挂载无任何服务端机密；三个容器日志与审计表均无明文邀请码/令牌/密码；git 暂存内容 86,597 行扫描 0 处硬编码机密。

**不宣称完成**：M1 无前端 UI（M2）、无附件加密（M4）、无 Web Push/iOS PWA（M5）、无 MatrixRTC/Element Call/LiveKit 通话（M6）、无设备验证/密钥备份 UI（M3）；M7 全量安全审查与备份恢复演练亦未开始。生产环境真实域名 + ACME 证书路径未在 Linux 服务器实测（本机仅 local profile）。

---

## 2. 测试环境与方法

- Windows 11 / Docker Desktop 29.7.2 + Compose v5.4.0 / Node 24.18.0 / Chrome 157（M0 沿用）
- 本地 profile：`docker-compose.yml` + `docker-compose.local.yml` + `.env.test`（每轮随机机密，gitignore）
- Caddy `tls internal` 自签 + `default_sni 127.0.0.1`；测试使用「仅限该请求」的专用 `https.Agent`，**未**设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`（R3.5）
- 进程内清除代理 env 并使用显式 Agent，规避本机 `NODE_USE_ENV_PROXY` 劫持（M0/工程师实测坑）
- 凭据每轮随机生成，只存 gitignore 的 `.env.test`；报告与日志不含任何码/令牌/密码明文
- 证据：`m1/reports/`（gitignore），含各套件 JSON、部署检查 Markdown、两轮复跑日志；QA 中断前的首轮证据已归档于 `m1/reports/qa-partial-2003/`

### 复跑命令（确定性）

```bash
scripts/run-m1-tests.sh --fresh          # 主套件 68 项 + 起栈
scripts/check-deploy.sh --local          # 部署检查 31 项
scripts/run-m1-adversarial.sh --fresh    # 对抗套件 71 项（独占全新栈，强制 --fresh）
```

---

## 3. PRD §5 验收 A–J 覆盖映射

| 验收 | 要求 | 覆盖位置 | 结果 |
|---|---|---|---|
| A | 邀请码重复使用拒绝 `used`，不重发令牌 | `test-lifecycle` A1–A6；`test-adversarial` CC1/CC2 | ✅ |
| B | 过期拒绝 `expired`，attempts 不增；过期判定先于哈希 | `test-lifecycle` B1–B3；`test-adversarial` ST6/ST7 | ✅ |
| C | 尝试超限转 BLOCKED，正确明文也不放行；成功不计入 attempts | `test-lifecycle` C1–C6；`test-adversarial` ST8/ST9/ST10/ST12 | ✅ |
| D | 四人满员 `quota_exhausted`，码不消耗、不调令牌 API | `test-quota` D1–D4；`test-adversarial` Q3/Q4 | ✅ |
| E | 8 并发抢 1 席恰 1 成功，无超卖、无死锁；同码并发原子性 | `test-quota` E1–E8；`test-adversarial` CC1（8 并发同码） | ✅ |
| F | 注册 → 收到固定加密房邀请 → join → Megolm 密文收发 → 服务器密文证明 | `test-e2ee` F1–F16 | ✅ |
| G | 管理 API 不对浏览器暴露；机密仅在服务端容器 | `test-exposure` G1–G10；`test-adversarial` GA1–GA13；`check-deploy` | ✅ |
| H | 联邦白名单空、无 federation listener、联邦端点不可达 | `check-deploy`（配置+行为双断言） | ✅ |
| I | 访客/匿名/无令牌注册全拒；注册 UIA 必须含 token 阶段 | `test-exposure` I1/I1a/I1b/I1c/I2/I3；`check-deploy` | ✅ |
| J | 部署检查 100%、运维文档占位、`.env.example` 无真实值、git 历史无机密 | `check-deploy` 31 项；§6 机密扫描；四份运维文档占位 | ✅ |

补充覆盖（PRD 之外、QA 主动加测）：REVOKED 语义与重复作废、路径穿越/编码变体（8+4 种）、带真实管理员凭据的公网入口探测、文档内省端点关闭、畸形请求体与 20 并发未知码冲击、日志红线与审计表明文扫描、`invite_codes` 无明文列。

---

## 4. 独立复跑发现的问题与智能路由判定

### D-1　主套件 `I1` 在全新栈返回 429（测试代码缺陷 → QA 自修）

- 现象：首次独立 `--fresh` 复跑得 **64/65**，`I1 访客注册被拒` 返回 429（Synapse 内建 `rc_registration` 限流），而断言仅接受 401/403。此前工程师自测与 QA 中断前那轮报 65/65，属时序相关的偶发通过。
- 判定：**测试代码缺陷**，不是源码缺陷。429 是刻意保留的限流防护（DESIGN-M1 §2.2），既非「放行」也不能单独证明访客被禁用。
- 修复：`m1/tests/test-exposure.mjs` 与 `scripts/check-deploy.sh` 增加**有界退避重试**（5 次 × 7s）取得权威 401/403；新增 `I1a 限流可恢复`、`I1b allow_guest_access:false`、`I1c registration_requires_token:true` 三条配置/证据断言。绝不接受「429 即通过」这种弱化。
- 回归：全新栈 `--fresh` 复跑 `test-exposure` **20/20**、主套件 **68/68**、部署检查 **31/31**。

### D-2　对抗套件名额预算错误（测试代码缺陷 → QA 自修）

- 现象：对抗套件首跑 **69/71**，`Q1 末席校验成功` 返回 409（pre=4）。套件注释声称消耗 3 席，实际在 Q 段之前有 3 次成功 verify（2 并发 1 次 + 8 并发 1 次 + ST11 恢复 1 次），加管理员共 4 席已满。
- 判定：**测试代码缺陷**。四人名额单调、一次性，两套编排不可同栈；且每次成功发令牌即预占一席（DESIGN-M1 §3.3），必须精确预算。
- 修复：移除与 8 并发语义重复的 2 并发成功 verify（8 并发已完整包含「恰 1 成功 / 其余 used / 终态 USED」），把注册绑定到唯一成功令牌；新增 `scripts/run-m1-adversarial.sh`（强制 `--fresh`，独占栈）、`m1/package.json` 脚本、`m1/README.md` 预算说明。
- 回归：独占全新栈 **71/71**。

### D-3 / LR-M1-1　名额口径与 PRD Q4 文字不一致（设计偏差 → 上报，不擅自改实现）

- 现象：首跑 `Q5` 观测到 `seats_used=4` 而 `synapse_count=2`；修复预算后为 `seats_used=4 / synapse_count=3`。
- 事实：`DESIGN-M1 §3.3` 与实现采用 `effective = max(自维护 seats_used, Synapse 非停用用户数)`，**发令牌即预占席位且单调不回收**；而 `PRD Q4` 文字口径为「名额计数 = Synapse 正式用户数」。`PRD Q2`（USED 不复活）与 `Q4`（M1 不支持注销/替换）使「令牌发出但未在 60min TTL 内注册」的席位无法回收。
- 影响：**「四人上限」实际约束的是「已发放的注册凭证数」而非「真实账号数」**。极端情况下若干邀请码被换走令牌却未完成注册，4 人系统可能永久凑不满 4 个真实账号，且 M1 无回收/替换机制。
- 安全性质：**fail-closed**——不会放入第 5 人、不破坏密文机密性、不越权、不泄露令牌；属容量/可用性语义偏差，**非安全阻断项**。
- 处置：QA **不擅自改实现**（改实现 = 变更 PRD 基线，需用户拍板）。已把该行为钉成显式且不隐瞒的观测断言 `Q6 [LR-M1-1]`，并登记到本报告的遗留问题、`docs/RISKS.md` 与 `TODO.md` M2 决策项。
- 建议（M2 前二选一）：(a) **接受**：4 人小圈子，管理员发现有人未注册即手动换码，M1 范围内属可接受的保守取舍；(b) **增加令牌过期席位回收**：新增 `token_expires_at` 字段与定时任务，令牌过期且 Synapse 未出现对应用户时释放预占席位，并补充「过期释放后第 4 人可注册」的并发回归用例。若选 (b) 需同步修订 PRD Q2/Q4 与 DESIGN §3.3。

### 路由判定汇总

| 问题 | 定性 | 路由 | 结果 |
|---|---|---|---|
| I1 429 | 测试代码缺陷 | QA 自修 + 加配置证据断言 | 已修，冷启动复跑通过 |
| Q1 名额预算 | 测试代码缺陷 | QA 自修 + 新增独占编排脚本 | 已修，独占栈通过 |
| 名额口径分歧 | 设计/需求基线偏差 | **上报用户，不擅自改实现** | 已钉断言 + 登记遗留 |
| 未发现 | 源码功能性 Bug | — | 无 |

---

## 5. 变更文件清单（本轮 QA 收尾）

| 文件 | 变更 |
|---|---|
| `m1/tests/test-exposure.mjs` | 429 有界退避重试 + 3 条配置/证据断言（I1a/I1b/I1c） |
| `scripts/check-deploy.sh` | `probe_register` 退避重试，访客/匿名注册断言抗限流 |
| `m1/tests/test-adversarial.mjs` | 名额预算修正、移除冗余 2 并发、Q5 改为如实断言、新增 Q6 [LR-M1-1] 观测断言、secrets 引用修正 |
| `scripts/run-m1-adversarial.sh` | **新增**：对抗套件独占 `--fresh` 编排 |
| `m1/package.json` | 新增 `test:adversarial` 脚本 |
| `m1/README.md` | 双编排不可同栈的说明 + 复跑命令 |
| `docs/M1-TEST-REPORT.md` | **新增**：本报告 |
| `docs/RISKS.md` / `TODO.md` / `CHANGELOG.md` / `README.md` | 登记 LR-M1-1、勾选 M1、追加测试结论 |

---

## 6. J 验收：git 机密扫描

- 仓库已 `git init`；`.gitignore` 覆盖 `.env` / `.env.test` / `m1/.env.test` / `m0/.env.test` / `infra/synapse/data/` / `m0/browser-run/` / `m0/m0-chrome-profile-*/` / `m1/reports/` / `node_modules/` / `__pycache__/`。
- 暂存清单核验：无 `.env.test`、无渲染后的 homeserver.yaml、无 signing key、无浏览器 profile、无测试报告；`m1/.env.test.example` 与 `.env.example` 仅含 `__CHANGE_ME__` / `__SAME_AS_...__` 占位符。
- 暂存 diff 共 86,597 行，密钥赋值模式（password/secret/token/pepper/api_key/registration_shared_secret/macaroon_secret_key + ≥24 字符值，排除占位符与变量引用）扫描：**0 处**。
- 预扫描唯一命中 `m0/browser/main.js:68 const SECRET = ...` 经脱敏核查为 M0「Olm 密文不含明文」断言用的测试消息字面量，非凭据。
- 提交后 `git log -p --all` 全历史复扫：**86,810 行、0 处硬编码机密**；`git ls-files` 共 95 个跟踪文件，工作树干净。
- `git check-ignore -v` 实证（仓库初始化后真实验证，非规则文本推断）：`.env.test`、渲染后的 `homeserver.yaml`、signing key、`m1/reports/*`、`m0/browser-run/*`、`m0/m0-chrome-profile-*/` **6 类敏感路径全部命中 .gitignore 规则**。

---

## 7. 遗留问题与未验证项（不宣称完成）

| # | 项 | 级别 | 归属 |
|---|---|---|---|
| LR-M1-1 | 名额口径分歧：发令牌即预占且不回收，与 PRD Q4 文字不一致 | 中（非阻断，fail-closed） | **M2 前用户决策** |
| LR-M1-2 | 发码成功后本地事务崩溃的窄窗口（`max()` 校准 + 60min 令牌兜底） | 低 | 设计已知残余，M7 复核 |
| LR-M1-3 | 全量 A–J 与对抗套件必须分别 `--fresh` 重建卷（名额单调） | 低（测试基建） | 已在脚本与 README 固化 |
| LR-M1-4 | 生产 profile（真实域名 + ACME + Linux 服务器）未实测 | 中 | M7 部署演练 |
| — | 前端 UI / 附件 / 推送 / 设备验证 UI / 通话 / 全量安全审查 | — | M2–M7，均未在 M1 宣称 |

---

## 8. 最终判定

**M1 通过**：PRD §5 验收 A–J 全部有可自动化复跑的证据，170/170 项检查通过，安全相关断言（服务器密文、管理面隔离、准入上限、日志红线、机密入库）无一失败。

附 **1 项非阻断遗留 LR-M1-1**：名额口径与 PRD 文字基线存在偏差，属 fail-closed 的容量语义问题，已显式钉入测试并登记，**需用户在 M2 开工前决策接受或改造**。QA 未擅自变更需求基线、未弱化任何安全断言、未宣称未完成里程碑的功能已完成。

> 提交记录：`47c93c2`（M0 验证工程 + M1 全部源码/配置/文档基线，95 文件 / 86,212 行）
> 及其后的文档回填提交。该提交经提交前 diff 扫描与提交后全历史复扫双重确认无硬编码机密。
> 本地测试栈保持运行（4 容器 healthy）供 M2 复用；如需释放资源执行
> `docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test down`
> （**不加 `-v`**，保留数据卷）。
