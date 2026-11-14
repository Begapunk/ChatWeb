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

## [0.2.2-m1-r1] - 2026-11-14

### Changed（用户决策：彻底移除注册人数上限）
- 邀请码成为**唯一准入控制**；`AETHER_MAX_MEMBERS` 从 `.env.example` / `docker-compose.yml` /
  `config.py` / `.env.test` 全部移除。
- `quota.py`：`QuotaExhausted` / `reserve_seat()` → `record_seat_usage()` 纯统计；
  `/admin/v1/quota` 返回 `unlimited=true` / `max_members=null`；
  `invite.py` 删除 409 `quota_exhausted` 分支（邀请码状态机与日志红线不变）。
- `quota_counters.max_members` 列保留兼容旧库，不新增破坏性迁移；代码不再读取。
- **`main.py`**：启动日志原读取已删除的 `cfg.max_members`，否则服务启动即 `AttributeError`
  —— 回改过程中通过独立复跑发现的真实启动缺陷，已修复并验证 `unlimited=true` 日志正常输出。
- 测试与编排：`test-quota.mjs` 覆写为 U0–U12 无上限语义；`test-adversarial.mjs` Q1–Q6 重写；
  `check-deploy.sh` 增 2 项断言；`run-m1-adversarial.sh` 的 `--fresh` 由强制改为可选；
  `run-all.mjs` / `run-m1-tests.sh` / `m1/README.md` 去掉「4 席预算、必须独占 fresh 栈」。

### Verified（M1-R1 回归，真实执行）
- 主集成套件 **68/68**（`run-m1-tests.sh --fresh`）：8 枚不同码并发全成功、第 5/6 个账号注册成功、
  `seats_used` 3→11、`unlimited=true` 恒定、无 `quota_exhausted`、E2EE 密文断言 F13–F16 仍通过。
- 部署检查 **33/33**（原 31 + 新增 2 项：容器 env 无 `AETHER_MAX_MEMBERS`、quota 端点 `unlimited/max_members`）。
- QA 对抗套件 **71/71**：在刚跑完主套件的**同一栈**上直接执行（无 `--fresh`），
  `pre=14` 时仍能发码 —— 实证无隐性上限且编排不再需要 fresh 独占。
- 合计 **172/172，0 失败**。详见 `docs/M1-AMENDMENT-UNLIMITED.md`。

### Resolved
- **LR-M1-1 已消解**（席位概念取消）；`RISKS.md R2.5` 关闭、`R2.2` 改写、
  新增 `R2.6`（人数不受控的资源/运维风险，M7 补监控与发码审计）。
- 文档联动：`PRD-M1` / `DESIGN-M1` / `M1-TEST-REPORT` 加变更通告（原文保留可追溯）；
  时序图、类图、DEPLOY、脚本注释同步；`M1-TEST-REPORT` 的 170/170 标注为**变更前版本**。

## [0.3.0-m2-kickoff] - 2026-11-14

### Verified（M2 开工首检，仅工具链）
- 官方版本核实 + 最小工程 `.tmp-gen/m2-probe` 实证：TS 7.0.2 的 `exports` 不再暴露 `./lib/tsc`，
  `vue-tsc 3.3.14` 仍依赖该路径 → `ERR_PACKAGE_PATH_NOT_EXPORTED`，类型检查失败。
- 降级 **TypeScript 5.9.3** 后 `vue-tsc --noEmit` / `vite build` / PWA 产物
  （`sw.js` / `manifest.webmanifest`）全部通过。
- `DEPENDENCIES.md` 锁定 5.9.3；`RISKS.md R4.3` 改为「已验证并缓解」；
  报告见 `docs/M2-KICKOFF-CHECK.md`。当前 shell 实测 Node v22.22.2 / npm 10.9.7
  （与 M0 报告的 24.18.0 为不同环境，均满足 SDK `node>=22`）。

### Not done（明确不宣称完成）
- `frontend/` 脚手架、MatrixService、界面、PWA 外壳与 M2 测试**均尚未创建**。

## [0.3.1-m2-scaffold] - 2026-11-14

### Added（前端脚手架与设计系统基座）
- `frontend/`：Vue 3.5.45 + TypeScript 5.9.3 + Vite 8.3.8 + Pinia 4.1.0 + vue-router 5.5.1
  + vite-plugin-pwa 2.0.0 + matrix-js-sdk 45.1.0；精确版本 + `package-lock.json` 入库。
- 设计令牌 `src/styles/tokens.css`（深色默认 / `[data-theme=light]` 浅色切换）、
  `base.css`（reset、控件基类、iPhone 安全区、reduced-motion）、`stores/ui.ts`（主题持久化 + 在线状态）。
- 应用外壳 `App.vue`、`UpdatePrompt.vue`（PWA prompt 更新）、`BootView.vue`（明确标注未接线功能）、
  原创 `icon.svg`；`index.html` 含 viewport-fit=cover 与 iOS 主屏幕 meta。
- **PWA 安全边界**：`registerType: "prompt"`；`navigateFallbackDenylist` 排除 `/_matrix/*`、
  `/invite-api/*`，`runtimeCaching: []` —— API 响应/注册令牌/密文事件不进 SW 缓存。

### Verified（真实执行）
- 实际安装：`matrix-js-sdk 45.1.0` → `crypto-wasm 18.9.2`（SDK requires `18.9.2`）与 M0 锁定一致。
- `npm run typecheck`（`vue-tsc --noEmit`）exit 0；`npm run build` exit 0（36 modules，
  JS 100.62 kB / CSS 6.81 kB）；PWA 产出 `sw.js` / `workbox-*.js` / `manifest.webmanifest`，precache 7 项。
- `frontend/node_modules/`、`frontend/dist/` 被 gitignore；`package-lock.json` 入库。

### Findings
- `npm install --prefer-offline` 报 `ETARGET @vitest/mocker@5.1.0`；`npm view` 证明版本存在，
  属离线优先读取过期 packument。改 `--prefer-online` 后成功（440 包）；本工程禁用 `--prefer-offline`。

### Not done（明确不宣称完成）
- MatrixService、登录/邀请注册、会话列表、聊天界面、单元测试、双浏览器 E2E 均未创建。

## [0.4.0-m2-demo] - 2026-11-14

### Added（可试用的演示版界面，应用户要求）
- `frontend/src/`：本地演示数据 `data/demo.ts`、类型 `types.ts`、内存状态层 `stores/chat.ts`、
  路由 `router/index.ts`、真实链路状态占位 `services/matrix.ts`（`implemented:false`、
  `e2ee:false`）、`DemoBadge` / `Avatar` / `MessageBubble` / `Composer` 组件，
  `Login` / `Conversations` / `Chat` / `Search` / `Settings` 五个视图。
- `App.vue` 改为演示外壳：顶栏演示徽章、底部三 tab 导航、聊天页全屏布局；`main.ts` 接入 `router`。
- 功能（演示级）：会话列表、私聊/群聊、消息时间、发送/已送达/已读、回复、撤回、表情、
  图片/文件/语音占位、附件、搜索、置顶/静音、主题切换、设备/安全/通知/资料/关于设置、
  登录与邀请码注册表单交互、演示数据重置。
- `frontend/e2e/demo-smoke.mjs`：36 项真实 Chrome 烟测（`npm run smoke`），
  新增 `playwright-core 1.65.1` 精确锁定（已入 lockfile）。
- `docs/M2-DEMO-REPORT.md`：交付与验收报告（范围边界、构建门禁、36 项逐项结果、
  缺陷修复、截图证据、M2 剩余工程）。

### Fixed（烟测抓到的真实 UI 缺陷）
- `UpdatePrompt.vue` 的「已可离线使用」常驻底部浮层在 390px 视口下压住输入区与底部导航，
  `intercepts pointer events`，真实用户点不到「发送 / 文件 / 语音 / tab」。
  首轮烟测 S14–S22、S24 共 10 项失败，S25–S36 因累计 30s 点击超时中断。
  修复：信息提示改为顶部 3.2s 自动消失且 `pointer-events:none` 的 toast；
  仅 `needRefresh` 显示带按钮浮层（容器穿透、仅按钮可点）并上移避开导航；卸载清理定时器。
  烟测默认超时收紧到 10s。修复后 **36/36 通过**。
- 删除已无引用且内容过时的 `BootView.vue`（脚手架自检页）。

### Verified（真实执行）
- `npm run typecheck` exit 0；`npm run build` exit 0（64 modules，JS 136.76 kB / CSS 27.68 kB，
  PWA precache 7 项 / 167.39 KiB）。
- `npm run smoke`：**36/36 通过，0 失败**；390×844 @2x 真实 Chrome；
  S33 `requests=28, forbidden=0`（无 `/_matrix/`、`/invite-api/`、`/_synapse/` 请求）、
  S34 `external=0`、S35/S36 无页面异常与 console error。
- 三张截图已人工核对：会话列表 / 聊天页 / 安全中心，无明显重叠、裁切或对比度问题。

### Not done（明确不宣称完成）
- **真实 MatrixService、`initRustCrypto`、Rust Crypto WASM、任何密钥均不存在**；
  未连 Synapse、未接邀请码 API、未自动入房；消息只在浏览器内存，刷新即清空。
- 端到端加密、密钥备份恢复、跨签名设备验证、双浏览器 E2EE 密文证明、单元测试、
  Web Push、通话均未实现。界面「已验证设备 / 加密」字样仅为布局占位。
- 因此 **M2 里程碑仍未完成**；本次交付的是可试用的 UI demo，不是加密通讯工具。

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