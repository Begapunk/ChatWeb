# Changelog

## [0.2.0-m1] - 2026-11-14

### Added（M1 服务端与准入）
- Docker Compose 双 profile（生产 + 本地测试）：Synapse v1.165.0（PG16 后端）+ PostgreSQL 16-alpine
  + Caddy 2.11.9（唯一入口，仅 /_matrix 与 /invite-api 路由，其余 404）+ FastAPI 邀请服务。
- 邀请服务（backend/invite-service，Python 3.12 / FastAPI 0.162.7 / asyncpg / httpx）：
  邀请码生成（128bit 熵、salt+pepper 哈希、明文仅一次返回）、校验状态机
  （UNUSED/USED/EXPIRED/BLOCKED/REVOKED，过期先于计数、失败计数、一次性），
  4 人名额事务锁（quota_counters 单行 FOR UPDATE + Synapse 用户数 max() 校准自愈），
  uses_allowed=1 短时效注册令牌发放，注册后轮询自动邀请入两个固定 Megolm 加密房间，
  管理端点（X-Admin-Key 常量时间校验）、审计日志（仅事件码）、版本表迁移 runner。
- homeserver.yaml 模板 + 宿主机 Python 标准库渲染脚本（--local 双形态 baseurl）；
  log config 模板（日志红线：INFO、不记请求体）。
- 部署脚本 deploy.sh（generate 引导→渲染→up）、check-deploy.sh（31 项安全断言，报告落 m1/reports/）、
  run-m1-tests.sh（--fresh 重建卷编排）。
- M1 集成测试工程 m1/（Node + matrix-js-sdk 45.1.0）：验收 A–J 共 65 用例 + 汇总报告。
- 文档：DESIGN-M1-CHECKS（§10 全部 13 项复核结论 + 7 项实测环境事实）、DEPLOY、BACKUP/RESTORE/UPGRADE 占位。
- .env.example 全量补全与修正（INVITE_DB_URL 形态、72h TTL、新增管理密钥/pepper 等）。

### Verified（工程师自测；正式验收归 QA）
- 本地栈四容器 healthy；自举（shared-secret 管理员/2 加密房间/quota 行）幂等成功。
- `scripts/run-m1-tests.sh --fresh`：65/65 通过（含 8 并发名额竞态恰 1 成功、E2EE 全链路
  注册→自动入房→join→Megolm 收发→对端解密→服务器侧密文证明）。
- `scripts/check-deploy.sh --local`：31/31 通过（联邦关闭/禁访客/注册令牌制/管理面公网 404/
  机密注入矩阵/房间加密邀请制/quota 行/渲染配置不入 git）。

### Findings（详见 docs/DESIGN-M1-CHECKS.md）
- Synapse 要求 PG collation=C（compose 已固定 POSTGRES_INITDB_ARGS）；
- Caddy tls internal 对无 SNI 客户端需 default_sni 兜底；
- registration_requires_token 下 UIA flow 为多阶段（token+dummy）须逐阶段提交；
- 本机 NODE_USE_ENV_PROXY 会劫持 Node http/fetch 导致复用连接 404（测试已双重规避）；
- 禁访客键名为 allow_guest_access（设计文档 enable_guests 系笔误）。

## [0.2.1-m1-qa] - 2026-11-14

### Verified（QA 独立验收，非工程师自测）
- 独立 `--fresh` 复跑三套：**主集成套件 68/68 + 部署检查 31/31 + 对抗套件 71/71 = 170/170**。
- 首次独立复跑抓出工程师自测未覆盖的时序问题：全新栈下 `I1 访客注册` 返回 429
  （Synapse `rc_registration` 限流），原断言仅接受 401/403；此前 65/65 属偶发通过。
  已加有界退避重试 + `allow_guest_access:false` / `registration_requires_token:true` 配置证据断言。
- 补齐 QA 对抗性测试并首次执行：带真实管理员 Token 的公网入口探测、8 种路径穿越/编码变体、
  REVOKED 语义、同码 8 并发原子性、畸形请求、20 并发未知码冲击、日志红线与审计表明文扫描。
- git 初始化 + 提交前机密扫描：暂存 diff 86,597 行、0 处硬编码机密；`.gitignore` 覆盖
  `.env.test` / 渲染配置 / signing key / 浏览器 profile / 测试报告。

### Fixed（测试基建，QA 自修）
- `m1/tests/test-exposure.mjs`、`scripts/check-deploy.sh`：429 限流退避 + 配置证据断言。
- `m1/tests/test-adversarial.mjs`：名额预算修正（移除冗余的 2 并发成功 verify）、
  Q5 改为如实断言、新增 Q6 显式观测名额口径分歧。
- 新增 `scripts/run-m1-adversarial.sh`（强制 `--fresh` 独占栈）与 `m1/package.json` 脚本。

### Known issues（非阻断，详见 docs/M1-TEST-REPORT.md §4 D-3 / §7）
- **LR-M1-1**：名额在发令牌时预占且单调不回收，与 `PRD Q4`「名额 = Synapse 正式用户数」
  文字口径不一致；令牌发了未注册会永久占席，4 人系统可能凑不满 4 个真实账号。
  fail-closed、不破坏机密性，非安全阻断项；**M2 开工前需用户决策**接受或增加席位回收。

## [0.0.1-m0] - 2026-11-14

### Added
- 项目骨架：frontend / backend/invite-service / infra(synapse,postgres,caddy,livekit,coturn) / scripts / docs / m0。
- M0 验证工程：T01–T06 共 7 个测试套件，110 项检查全部通过。
- 本地 Synapse v1.165.0 部署脚本（Docker，注册令牌+禁联邦+禁访客）。
- 文档：架构、依赖锁定清单、风险清单、M0 计划与验证报告。

### Verified
- matrix-js-sdk 45.1.0 + crypto-wasm 18.9.2：Node 与 Chrome 157 双环境。
- 两个独立浏览器设备经真实 Synapse 的 Megolm E2EE 往返；服务器仅存密文。
- 邀请令牌限额拒绝、跨签名引导(UIA)、SSSS+服务器密钥备份、重启离线补同步、
  加密 IndexedDB 存储与错误密钥拒绝、规范附件加密往返与篡改检测。

### Findings（详见报告第 4 节）
- F1 设备密钥竞态需"发送前等待对端设备可见"；F2 重启须新建客户端实例；
- F3 timeline 早于解密；F4 WASM 资源路径需显式固定；F5 headless dump-dom 不可靠改用 playwright；
- F6 Docker Hub 需镜像源；F7 非成员管理员读事件被拒（符合预期）。

### Not done（明确推迟）
- 产品 UI、FastAPI 邀请服务、PostgreSQL、Element Call/LiveKit 通话、iOS/Web Push、设备撤销 UI。