# 变更通告 M1-R1：彻底移除注册人数上限

> 日期：2026-11-14 · 决策：用户（"不必局限于四个人的注册数量限制" → 选择「彻底移除名额限制」）
> 执行：主理人自行实现（用户已通知 Codex 子 Agent 当前不可用，未调用）
> 状态：**已实现 · 已回归 · 已生效**
> 适用：M1 服务端与准入及其后所有阶段（M2–M7）
> 关联基线：`docs/PRD-M1.md`、`docs/DESIGN-M1.md`、`docs/M1-TEST-REPORT.md`
> —— 三者为**变更前**文档，已加变更通告但保留原文以维持审计可追溯；**本文为准**。

---

## 1. 变更内容

| 项 | 变更前（M1 原始验收版） | 变更后（现行） |
|---|---|---|
| 总注册人数 | 上限 4（含管理员），`AETHER_MAX_MEMBERS` 可配 | **不设上限** |
| 准入控制 | 邀请码 + 名额判定 | **邀请码为唯一准入控制**（管理员手动发码） |
| `quota_counters` | 事务权威，`SELECT … FOR UPDATE` 后判定 `effective >= max_members` | **纯统计**：锁行 → `max(seats_used, synapse_count)` 校准 → `+1`，不参与任何准入判定 |
| 满员响应 | `409 {"error":"quota_exhausted"}`，码保持 UNUSED | **该响应与错误码已删除** |
| `/admin/v1/quota` | `{"max_members":4,"seats_used":k,...}` | `{"unlimited":true,"max_members":null,"seats_used":k,"synapse_count":n,"effective":e}` |
| 测试编排 | 两套测试各消耗完整 4 席，必须各自 `--fresh` 独占全新栈 | 无稀缺席位，**同一栈可连续重复跑**；`--fresh` 仅为可复现性推荐 |
| 遗留 LR-M1-1 | 发令牌即预占且单调不回收，与 PRD Q4 口径分歧，待用户决策 | **直接消解**（无席位概念，预占/回收/口径问题不复存在）—— `docs/RISKS.md R2.5` 已关闭 |

**变更理由**：用户明确取消「四人」产品约束。保留邀请码机制即可维持「无匿名入口、无公开注册」的私密性，
人数由管理员发码纪律控制，而非硬编码容量上限。

---

## 2. 明确不变的安全边界（本次变更未削弱任何一条）

- 邀请码 `{tag}-{token_urlsafe(16)}`，128bit 熵；库中仅存 `salt + sha256(salt ‖ pepper ‖ code)`，无明文列。
- 状态机 `UNUSED/USED/EXPIRED/BLOCKED/REVOKED`；**过期判定先于哈希计数**、失败计数 → BLOCKED、
  一次性 `USED`（条件 `UPDATE … WHERE status='UNUSED'`）、REVOKED 对外统一按 `invalid`（不泄露作废事实）。
- 同码并发仍由 `invite_codes` 行锁 + 条件 UPDATE 保证恰 1 成功（对抗套件 CC1 实测 8 并发 = 1 成功 7 used）。
- Synapse `registration_requires_token` + `uses_allowed=1` 短时效令牌；`allow_guest_access: false`；
  联邦白名单空表；公开房间目录 deny-all；管理面不对公网暴露；`X-Admin-Key` 常量时间比较。
- 注册后自动 invite 进固定 Megolm 加密房间（join 由用户侧完成）。
- 日志红线：明文码 / 注册令牌 / 密码 / 恢复密钥不入日志与审计表。
- E2EE 边界不变：服务器只存密文（主套件 F13–F16 实测）。

---

## 3. 代码改动清单

| 文件 | 改动 |
|---|---|
| `backend/invite-service/app/config.py` | 删除 `max_members` 字段及 `AETHER_MAX_MEMBERS` 读取 |
| `backend/invite-service/app/services/quota.py` | 删除 `QuotaExhausted` / `reserve_seat()`；新增 `record_seat_usage(conn, admin) -> int`（纯统计）；`get_quota()` 返回 `unlimited=True` / `max_members=None` |
| `backend/invite-service/app/services/invite.py` | 成功路径改调 `record_seat_usage()`；删除 `except QuotaExhausted` 的 409 分支；邀请码状态机、失败计数、审计、日志红线完全保留 |
| `backend/invite-service/app/services/room_invite.py` | 自举插入统计行不再依赖 `cfg.max_members`（固定 `VALUES (1,4,0) ON CONFLICT DO NOTHING`，4 仅为兼容旧列占位）；启动日志改为 `unlimited=true` |
| **`backend/invite-service/app/main.py`** | **启动日志原读取 `cfg.max_members`，删除该字段后服务启动即 `AttributeError`；已同步改为 `logger.info("invite-service started (poll=%ss, unlimited=true)", cfg.poll_seconds)`。此为回改中通过独立复跑发现的真实启动缺陷，已修复并验证** |
| `backend/invite-service/app/db/migrations/0001_init.sql` | **未改动**：`quota_counters.max_members` 列保留，仅为兼容已有数据库、避免破坏性迁移；代码不再读取 |

## 4. 测试改动清单

| 文件 | 改动 |
|---|---|
| `m1/tests/test-quota.mjs` | 全量覆写为无上限语义 U0–U12：`unlimited/max_members` 断言、8 枚**不同**有效码并发全部成功、无 `quota_exhausted`/5xx、8 码全转 USED、抽样注册第 5/6 个账号、统计单调增长、额外新码仍成功、无效码仍被拒；注册加 429 有界退避 |
| `m1/tests/test-adversarial.mjs` | Q1–Q6 由「末席 + 满员 + Q6 [LR-M1-1] 观测」改为「无名额上限」：`unlimited` 视图、多账号后连续发码成功、统计增长、无效码/已用码仍被拒；secrets 数组同步改为 Q 段新变量；文件头与 CC 段注释更新 |
| `m1/tests/run-all.mjs` | 套件标签与验收对照表 D 改为「（M1-R1 变更）无名额上限」；注释去掉「名额预算确定性 / 必须 fresh」 |
| `m1/tests/test-lifecycle.mjs` | 前置注释改为「本地栈已起即可」 |
| `scripts/check-deploy.sh` | 新增 2 项断言：invite-service 容器 env 不含 `AETHER_MAX_MEMBERS`；`/admin/v1/quota` 返回 `unlimited=true` / `max_members=null`。quota 行检查措辞改为「纯统计，不参与准入」 |
| `scripts/run-m1-tests.sh` | `--fresh` 说明改为「推荐、非硬性」 |
| `scripts/run-m1-adversarial.sh` | `--fresh` 由**强制**改为**可选**；不带参数时复用已运行栈 |
| `m1/README.md` | 删除「4 席预算 / 两套不能同栈」章节，改为统计语义说明与最新结果 |

## 5. 配置与部署改动

| 文件 | 改动 |
|---|---|
| `.env.example` | 删除 `AETHER_MAX_MEMBERS=4`，加注释说明「总注册人数不受限制，准入完全由一次性邀请码控制」 |
| `docker-compose.yml` | 删除 `AETHER_MAX_MEMBERS` 环境变量注入 |
| `.env.test`（本地，gitignore） | 删除残留 `AETHER_MAX_MEMBERS=4` |
| `infra/` | **未改动**：Caddy 路由、Synapse 加固、PG 初始化均不受影响 |

兼容性：已有数据库卷中的 `quota_counters.max_members` 列与历史 `seats_used` 值无需迁移，
服务重启后照常校准统计；旧 `.env` 中残留的 `AETHER_MAX_MEMBERS` 被忽略，不产生副作用。

---

## 6. 回归验证（真实执行，非静态推断）

执行顺序：fresh 重建栈 → 主套件 → **同一栈直接**跑部署检查 → **同一栈直接**跑对抗套件（均不再 `--fresh`）。

| 套件 | 命令 | 结果 |
|---|---|---|
| 主集成套件 | `bash scripts/run-m1-tests.sh --fresh` | **68/68**（lifecycle 19 + e2ee 16 + quota 13 + exposure 20），exit 0 |
| 部署检查 | `bash scripts/check-deploy.sh --local` | **33/33**（原 31 + 新增 2），exit 0 |
| QA 独立对抗套件 | `bash scripts/run-m1-adversarial.sh`（无 `--fresh`） | **71/71**，exit 0 |
| **合计** | | **172/172，0 失败** |

关键证据（摘自 `m1/reports/rerun-unlimited-*.log`）：

- 主套件 `test-quota` 前置 `quota={"unlimited":true,"max_members":null,"seats_used":3,"synapse_count":3,"effective":3}`；
  `U1 8 枚不同码并发校验全部成功 [ok=8/8]`；`U3 无 5xx / 无意外响应 [200×8]`；
  `U6/U7 第 5、第 6 个账号注册成功 [200]`；`U8 统计随之增长 [before=3 after=11]`、
  `U9 Synapse 账号数增长 [before=3 after=5]`；`U11 额外新码仍校验成功 [200]`；`U12 无效码仍被拒 [400 invalid]`。
- 对抗套件在**刚跑完主套件的同一栈**上执行，`Q2 已有多账号后新码仍校验成功 [200 pre=14]`、
  `Q4 统计增长 [before=14 after=16 unlimited=true]` —— 实证「无隐性人数上限」且「同栈可重复跑」。
- 对抗套件非 Q 段全部保持通过：GA1–GA13（真实管理员 token / 8 种路径变体 / 文档端点 / docker inspect）、
  ST1–ST13、CC1–CC3、MF1–MF14、LR1–LR3（三容器日志红线 + 审计表 + 表结构无明文列）。
- 主套件 F13–F16 仍证明服务器侧事件为 `m.room.encrypted` 且不含明文。
- 部署检查新增 2 项均 PASS；`docker inspect` 确认 invite-service 容器 env 无 `AETHER_MAX_MEMBERS`。

> 原始日志：`m1/reports/rerun-unlimited-main.log` / `rerun-unlimited-deploy.log` /
> `rerun-unlimited-adversarial.log`（目录已 gitignore，不入库）。

---

## 7. 风险与后续

- **R2.5 已关闭**（LR-M1-1 消解）；**R2.2 改写**（人数不再是准入手段，发码权限与管理员密钥成为唯一边界）。
- **R2.6 新登记**：人数不受控带来的资源/运维风险（Synapse、PG、媒体、加密房间成员数与 Megolm 密钥分发面
  随发码量线性增长）。当前靠「管理员手动发码」约束；M7 需补账号数监控告警、发码审计、
  房间成员上限策略评估。详见 `docs/RISKS.md`。
- 历史数字：`docs/M1-TEST-REPORT.md` 的 **170/170** 属 M1-R1 **变更前**版本（主 68 / 部署 31 / 对抗 71），
  引用时须注明版本；现行基线为 **172/172**。

## 8. 复现命令

```bash
cd <project-root>
bash scripts/run-m1-tests.sh --fresh          # 68/68，fresh 重建卷
bash scripts/check-deploy.sh --local          # 33/33，同栈
bash scripts/run-m1-adversarial.sh            # 71/71，同栈即可（也可加 --fresh）
```
