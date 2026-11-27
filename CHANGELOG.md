# Changelog

> 按里程碑推进顺序排列（M0 → M1 → M2）。每个版本的 `Not done` 是**该版本交付当时**的边界快照，
> 后续版本完成时以最新条目与 `README.md` / `docs/M2-LIVE-REPORT.md` 为准，不回改历史条目。
> 以下为 Matrix 时代的历史里程碑；当前 P2P 开发分支版本为 0.6.0。

## [Unreleased] — M3 进展（2026-11-15，**未完成 / 发布阻断**）

> 权威状态：[docs/M3-REPORT.md](docs/M3-REPORT.md)。**不得据此宣称 M3 完成。**

### Added（代码已实现，静态门禁通过）
- `frontend/src/services/security.ts`：恢复密钥校验/解码、安全状态汇总、设备信息合并（纯逻辑，不触碰持久化 API）。
- `frontend/src/services/security.test.ts`：13 项单测，总数 21 → **34/34**。
- M3 服务层：`cryptoCallbacks.getSecretStorageKey`、跨签名 + 4S(SSSS) + 服务器 key backup 首次引导、
  从恢复密钥恢复跨签名私钥与历史 Megolm 会话密钥、真实设备列表/撤销、SAS 发起/接受/确认/不一致/取消。
- 安全中心与登录页真实 UI：一次性恢复密钥（确认后从内存清除）、导入恢复密钥、真实设备、SAS 表情/数字比对。
- `frontend/e2e/m3-security.mjs` 36 项安全门禁脚本 + `npm run e2e:m3`（**已编写、未执行**）。
- `docs/M3-KICKOFF-CHECK.md`、`docs/M3-REPORT.md`；`docs/DEPENDENCIES.md §8` 安装版 `.d.ts` 核对表。

### Fixed
- 恢复路径 `bootstrapCrossSigning({})` 漏传 UIA 回调：SDK 明确「不传则不上传密钥」，
  SSSS 缺跨签名私钥时会静默失败 → 首次引导与恢复路径均传入 `passwordAuth()`。
- `passwordAuth()` 改用安装版 `UIAuthCallback<void>` 类型并去掉 `as never`，让 `vue-tsc` 真正校验 UIA 参数。
- demo 烟测 S27 不再谎称「M3 待实现」；设置中心删除过时的 M3 待实现清单。

### Verified（真实执行，本轮修正之后重跑）
- `npm run typecheck` exit 0；`npm run test` **34/34**；`npm run build` exit 0（PWA precache 9 项）；
  `npm run smoke` **36/36**；`node --check e2e/m3-security.mjs` exit 0。

### Blocked / Not verified（**发布阻断项**）
- ⛔ `npm run e2e:m3`（清浏览器数据 → 恢复 → 历史解密，36 项）**未执行**：
  本机 Docker Desktop Linux 引擎无法启动（残留 AF_UNIX socket `EPERM` + engine 持续 `HTTP 503`），
  真实 Synapse 栈不可用。已做 4 次干净重启与可逆备份重命名，均未绕过任何认证或安全策略。
- ⛔ `npm run e2e:live` 本次未复跑（依赖同一栈），随栈恢复补跑。
- 恢复步骤见 `docs/M3-REPORT.md §6`；风险登记见 `docs/RISKS.md R5.4`。

### Not done
- M4 加密附件、M5 Web Push、M6 通话、M7 发布门禁；M3 的 QR 验证与 `onlyAllowTrustedDevices` 策略评估。
- 当前版本**不可作为正式私密通讯工具发布**。

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

## [0.5.0-m2-r] - 2026-11-14

### Added（M2 真实加密链路，用户要求「完全实现 M2」）
- `services/matrix.ts` 从 `implemented:false / e2ee:false` 占位改为真实 `MatrixService`：
  `initAsync(new URL("/wasm/...", origin))` 固定 WASM 路径（M0 F4）→ `loginWithPassword` →
  用返回 `device_id` 重建 client（M0 事实 9）→
  `initRustCrypto({useIndexedDB, cryptoDatabasePrefix, storageKey})`；
  `storageKey` = PBKDF2-SHA256 / 150k 轮 / 256bit，salt 与 `cryptoDatabasePrefix` 均绑定 userId。
- WASM 资产链：`scripts/prepare-wasm.mjs`（`postinstall`）校验 crypto-wasm 精确版本 **18.9.2**
  并从 node_modules 复制 `public/wasm/matrix_sdk_crypto_wasm_bg.wasm`（7.43 MiB）；
  二进制不入库（gitignore），不进 PWA precache。
- 邀请码注册闭环：`/invite-api/v1/verify` → 短时效注册令牌 → Synapse UIA 逐阶段提交 →
  轮询自动加入邀请服务发出的两个固定 Megolm 加密房间。
- 双数据源状态层 `stores/chat.ts`：demo（内存假数据、不联网）/ live（真实 SDK 事件源）
  共用视图 API；live 模式未实现的附件/表情/跨签名验证显式提示「属于 M3/M4」，不插假数据。
- 真实 `m.relates_to` 回复 / `redactEvent` 撤回 / 已读回执；会话与消息来自 `getRooms()` 与
  `Room.timeline`，900ms 轮询复核解密完成后的变化（M0 F3）。
- 新增测试：`vitest.config.ts`（独立配置，不复用 VitePWA 插件）、
  `src/services/matrix.test.ts` + `src/data/demo.test.ts`（21 项）、
  `e2e/live-e2ee.mjs`（双浏览器 E2EE 安全门禁 32 项）；npm 脚本
  `test` / `e2e:live` / `prepare:wasm` / `postinstall`。
- `docs/M2-LIVE-REPORT.md`：SDK API 实证核对表、4 个真实缺陷根因与修复、验收结果、边界清单。

### Fixed（安全门禁过程中发现并修复的 4 个真实缺陷，详见报告 §3）
- **D1 整页刷新静默回退演示假数据**：凭据只在内存；新增非敏感 `sessionStorage` 标记 +
  `main.ts` 一次性导航守卫，刷新后强制回 `/login?reason=session-expired` 并显式提示，
  不展示假会话（L19/L20/L20b 实证）。
- **D2 房间加密状态误报 E2EE**：`getConversations()` 原以「crypto 层就绪」兜底把未加密房间
  标成 `encrypted`；改为严格只依据 `m.room.encryption` 状态事件，单测覆盖否定用例。
- **D3 验收脚本假通过**：旧断言只看房间内「存在任意 `m.room.encrypted`」（M1 留有历史密文）。
  改为发送前后服务器事件 ID **差集**：仅本次新事件参与 `m.room.encrypted` / 算法 /
  ciphertext / 无明文 / 无 session_key 断言；新增 L07b 等待服务器 `joined_members` 确认入房。
- **D4 自动入房后 `Cannot encrypt event in unconfigured room` 竞态**：SDK `rust-crypto.js:170-176`
  显示 `roomEncryptors[roomId]` 未建立时抛错且消息根本不发；`sync.js:1202-1212` 注释点明建立时机。
  新增 `waitForEncryptionReady(roomId)`，用公开 API `isEncryptionEnabledInRoom()` +
  `getUserDeviceInfo(peers, true)` 有界等待房间加密配置/成员/设备密钥收敛；
  超时**取消发送、绝不降级明文**，仅对明确时序竞态最多 3 次有界重试（M0 F1 工程化落地）。

### Changed（配置与 UI）
- `vite.config.ts`：dev/preview 同源代理 `/_matrix` 与 `/invite-api` 到本地 Caddy
  （`secure:false` 仅作用于这两条本地代理，非全局关闭 TLS 校验）；`assetsInclude` 加 `.wasm`。
- `LoginView` 双模式（演示 / 连接真实服务器）+ 阶段进度；`ConversationsView` / `ChatView` /
  `SettingsView` / `DemoBadge` / `Composer` 按 live/demo 显示真实状态与边界提示。
- `types.ts`：`Message.encrypted?` 标记原始密文事件；`Conversation.encrypted` 严格来自状态事件。
- `.gitignore` 忽略 `frontend/public/wasm/`（由 postinstall 生成）。

### Verified（真实执行，非推断）
- `npm run typecheck` exit 0；`npm run build` exit 0（PWA `sw.js` / `manifest.webmanifest`，
  WASM 资产 7.43 MiB 经 HTTP 200 验证可达）。
- `npm run test`（Vitest 5.1.0）**21/21**（2 文件）；`npm run smoke` **36/36**（demo 回归，
  S33/S34 仍证明 demo 不请求 Matrix/邀请 API、不连外部域名）。
- **`npm run e2e:live` 32/32，连续三次通过（0 失败）**：两个独立 Chrome 实例各自真实注册、
  加载 Rust Crypto WASM、自动入同一加密房间；A 发送 → B 用自身密钥解出明文；
  服务器侧本次新事件 `new=1 encrypted=1`，仅 `m.room.encrypted`（Megolm，含 ciphertext），
  无明文 / `session_key` / `body`；管理端点浏览器侧 404/401；4xx 全部属协议预期白名单
  （`total4xx=6 unexpected=[]`）；刷新守卫生效。见 `docs/M2-LIVE-REPORT.md`。

### Not done（明确不宣称完成，见报告 §5）
- M3 密钥备份/恢复（SSSS）、跨签名设备验证、设备撤销；M4 EncryptedFile 加密附件；
  M5/M6 Web Push、MatrixRTC/LiveKit 通话；M7 发布门禁与监控。
- 凭据只在内存 → 刷新必须重新连接服务器；清除浏览器数据仍会永久失去历史消息解密能力。
- 单元/双浏览器 E2E 覆盖纯逻辑与真实 SDK 行为，未做组件级快照测试。
- **因此当前版本不可作为正式私密通讯工具发布**；TLS/DTLS 均不等价于 E2EE。
## [0.6.0] — P2P 开发分支（2026-11-27）

- 会话绑定的设备持钥验证、公开身份二维码、SHA-256 指纹、安全验证码与长期信任。
- 独立双人私聊、群聊成员加入时的密钥轮换、联系人与三栏导航。
- 签名已读回执、待发队列重试与取消、本地记录删除、未读统计与一对一 WebRTC 语音协商。
- 本机双浏览器身份与通话测试、四浏览器群聊与私聊隔离回归、GitHub Pages 生产构建。
- 本版本未通过真实手机和跨运营商网络验收，限制见 docs/P2P-UPGRADE-2026-11-27.md。
