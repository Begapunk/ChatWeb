# M3 实现进展与安全门禁状态报告

> **2026-11-23 现行通告**：项目已改为免安装远程 homeserver 客户端，本文记录的 Docker
> 阻断属于旧自托管方案历史。M3 仍未通过真实恢复门禁，但后续应使用专用远程测试账号，
> 不再要求恢复本机 Docker 栈。

> 日期：2026-11-15 · 执行：主理人自行完成（Codex 子 Agent 仍按用户通知保持禁用，全程未调用）
> 触发：用户授权「无需再询问，只要自己测试通过即可进入下一轮任务，直到完成这个产品」
>
> ## ⛔ 结论先行：M3 **尚未完成，且当前为发布阻断状态**
>
> M3 的**代码实现与静态门禁已完成**，但 M3 唯一有资格宣判完成的安全阻断门禁
> 「**清除浏览器数据 → 用恢复密钥恢复 → 历史 Megolm 密文重新解密**」**尚未真实执行**。
> 原因是本机 Docker Desktop 的 Linux 引擎无法启动（详见 §5），真实 Synapse 栈不可用。
>
> 按工程红线「安全相关失败必须阻断发布」「不得宣称未完成或未测试功能已完成」：
> - ❌ 不宣称 M3 完成、不宣称密钥恢复/跨签名验证可用、不宣称可发布；
> - ❌ 不进入 M4（用户授权的是「自己测试通过才进入下一轮」，本轮未通过）；
> - ✅ 已完成的实现、静态测试、门禁脚本与文档全部如实落地并提交，栈恢复后**从门禁这一步继续**，不重做。

---

## 1. 本轮完成的实现范围

| 层 | 文件 | 内容 |
|---|---|---|
| 纯逻辑 | `frontend/src/services/security.ts`（新增） | 恢复密钥格式校验/解码、安全状态汇总（跨签名 / 4S / 备份版本 / 本次恢复条数）、服务器设备信息与加密层验证状态合并；不引用任何持久化 API |
| 单测 | `frontend/src/services/security.test.ts`（新增） | 13 项，使单测总数 **21 → 34/34**；含「恢复密钥处理链路不调用任何持久化存储 API」的运行时 spy 断言 |
| 服务层 | `frontend/src/services/matrix.ts`（大改） | `createClient({ cryptoCallbacks: { getSecretStorageKey } })`；内存保存凭据/口令/SSSS 私钥；`setupKeyBackup()` 首次引导跨签名 + 4S + key backup；`restoreSecurityFromKey()` 从 4S 恢复私钥并 `restoreKeyBackup()`；`refreshSecurity()`；真实设备列表、撤销、SAS 发起/接受/确认/不一致/取消；`forgetSession()` |
| 状态层 | `frontend/src/stores/chat.ts`（大改） | `LiveConnectOptions` 支持 `recoveryKey`；live 模式设备来自真实安全状态；暴露备份/恢复/刷新/SAS/撤销操作；断开与登出清理内存密钥 |
| 登录页 | `frontend/src/views/LoginView.vue` | 「连接真实服务器 + 登录」时新增「恢复密钥（可选）」输入 |
| 安全中心 | `frontend/src/views/SettingsView.vue` | 真实 SSSS / key backup / cross-signing / 恢复状态；生成一次性恢复密钥（确认后从内存清除）；导入恢复密钥；真实设备列表与验证/撤销；SAS 表情与数字比对 UI；删除「M3 待实现」过时清单 |
| 门禁脚本 | `frontend/e2e/m3-security.mjs`（新增） | 36 项安全断言 `M01–M36`，见 §3；`package.json` 新增 `npm run e2e:m3` |
| 首检报告 | `docs/M3-KICKOFF-CHECK.md` | 安装版 `.d.ts` / 源码实证核对，见 §2 |

**未新增任何第三方依赖**，版本锁定不变（见 `docs/DEPENDENCIES.md §8`）。

## 2. SDK API 实证核对（禁止凭记忆编写）

开工首检 `docs/M3-KICKOFF-CHECK.md` 已逐一核对其余 API；本轮实现与收口时**再次核对安装版
`matrix-js-sdk 45.1.0`**，修正了两处真实问题：

1. **恢复路径漏传 UIA 回调**：`restoreSecurityFromKey()` 原为 `bootstrapCrossSigning({})`。
   安装版 `crypto-api/index.d.ts:749-758` 明确写「An application callback to collect the
   authentication data for uploading the keys. **If not given, the keys will not be uploaded
   to the server**」。若 SSSS 中不存在跨签名私钥、SDK 走「新建并上传」分支，恢复会静默失败。
   → 首次引导与恢复路径均传入 `passwordAuth()`。
2. **`as never` 掩盖类型错误**：`passwordAuth()` 已正确声明为 `UIAuthCallback<void>`
   （`interactive-auth.d.ts:115`，`AuthDict` 含 `PasswordDict` 联合成员），与
   `BootstrapCrossSigningOpts.authUploadDeviceSigningKeys` 完全匹配。
   → 去掉 `as never`，让 `vue-tsc` 真正校验 UIA 参数结构。

其它已核对事实：`restoreKeyBackupWithPassphrase` 已 deprecated（规范路径是 4S 随机恢复密钥）；
已有 SSSS key 时 `bootstrapSecretStorage` 不会调用 `createSecretStorageKey`；清数据后恢复必须在
**构造期**注入 `cryptoCallbacks`（M0 F2：同实例 `stop/start` 不重启 rust-crypto 循环）；
`getSecretStorageKey({ keys })` 返回 `[keyId, privateKey]`，无密钥时必须返回 `null` 而非猜测；
`CryptoEvent.VerificationRequestReceived` 绑在 `MatrixClient`；`verifier` 是 getter；
`VerificationPhase` 数值 `Ready=3 / Started=4 / Cancelled=5 / Done=6`；设备撤销 UIA 需要
`m.login.password`。

## 3. 已完成的验证（真实执行）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **exit 0** |
| 单元测试 | `npm run test` | **34/34**（3 个测试文件，含 M3 新增 13 项） |
| 生产构建 | `npm run build` | **exit 0**，PWA precache 9 项 |
| demo 回归 | `npm run smoke` | **36/36**（真实 Chrome 390×844；S27 断言清单不谎称 M3 待实现） |
| M3 E2E 脚本语法 | `node --check e2e/m3-security.mjs` | **exit 0**（仅语法，不等于门禁通过） |
| M2-R 真实 E2EE 门禁 | `npm run e2e:live` | **本次未复跑**（依赖同一 Docker 栈，随 M3 门禁一并补跑） |

上述命令均在本轮 4 处代码修正**之后**重新执行，不是历史结论。

## 4. 安全门禁设计（`npm run e2e:m3`，36 项，**尚未执行**）

脚本 `frontend/e2e/m3-security.mjs` 复用 M2-R 的双独立 Chrome 实例脚手架，断言链：

- **阶段 1（M01–M19）**：两枚邀请码注册 → 双方自动入房 → A 生成恢复密钥 →
  断言跨签名 / 4S / 密钥备份状态 → 确认抄写后恢复密钥从内存清除 →
  A 发送唯一明文串、B 解密 → 服务器侧用**事件 ID 差集**证明本次新事件只有
  `m.room.encrypted`、无明文 / 无 `body` / 算法为 Megolm。
- **阶段 2（M20–M22）**：关闭 A 的 browser、新建**全新** Chrome 实例（等价清除浏览器数据），
  断言 `localStorage` / `sessionStorage` / `indexedDB.databases()` 全空；
  不带恢复密钥登录 → 历史消息显示 UTD「无法解密此消息（缺少会话密钥）」且明文不泄露（**对照组**）。
- **阶段 3（M23–M28）**：错误恢复密钥必须 fail-closed（留在登录页、不回退 demo）；
  登录页携带正确恢复密钥 → 安全中心显示「本次会话恢复 N 条」→ 历史密文重新解密为明文；
  断言恢复密钥 / 口令 / `access_token` 均未落盘。
- **阶段 4（M29–M31）**：设置页导入恢复密钥（走 `stop → 新建 client → 复用 cryptoDatabasePrefix`
  路径）→ 断言导入条数 → 历史密文重新解密为明文。
- **阶段 5（M32–M36）**：真实 Matrix 设备列表可见多个设备；服务器全时间线始终无明文 /
  无 `session_key`；全部浏览器无未捕获异常；console 不含恢复密钥 / 口令 / token。

任一断言失败即 `exit 1`。**该脚本从未真实跑过，其断言可靠性同样未经实证**，
因此不得把「脚本存在」当作「M3 已验证」。

## 5. 阻断项：本机 Docker Linux 引擎无法启动

| 观察 | 证据 |
|---|---|
| 初始症状 | `docker info` → `npipe:////./pipe/dockerDesktopLinuxEngine` 不存在；4173 预览可用但 Caddy 443 无响应 |
| Docker Desktop 致命错误 | `%LOCALAPPDATA%\Docker\backend.error.json`：`remove .../run/sailor-ingest.sock` → `Access is denied` / "initializing Ingest server"；清掉该路径后前进为 `docker-secrets-engine/engine.sock` → "initializing Secrets Engine" |
| 引擎最终状态 | 第 4 次干净启动后 pipe 建立，但 `docker ps` → `Docker Desktop is unable to start`；`monitor.log` 持续 `still waiting for the engine to respond to _ping ... HTTP 503`；VM `log/vm/init.log` 仍是 11-14 的旧内容，**本次 Linux VM 从未起来** |
| 权限边界 | 残留 AF_UNIX socket 文件 `EPERM`（node `renameSync` / PowerShell `Remove-Item` 均被拒，后者被 safe-delete 策略拦截）；`wsl.exe` 被本机安全策略**命令黑名单**禁止；`Restart-Service WslService` 因非管理员被拒 |

**已执行的自动处置（全部可逆、均有备份）**：

1. 备份 `run/` 下 4 个残留 0 字节文件到 `.tmp-gen/docker-run-backup/`，并以 Node 重命名；
2. 移走 `docker-secrets-engine/engine.sock`；
3. 整体重命名 `C:\Users\86189\AppData\Local\Docker\run` → `run.bak-m3-2`（原目录内容完整保留），
   让 Docker 启动时重建干净目录；
4. 每次尝试前干净终止 Docker Desktop 进程树，共 4 次重启。

**没有绕过任何认证或安全策略**：未使用 `dangerouslyDisableSandbox`，未强行调用被禁的 `wsl.exe`，
未删除用户文件（只重命名并备份）。

## 6. 用户需要做的唯一一步（之后由我继续，不从头重做）

在本机**以管理员身份**任选其一，让 Docker Linux 引擎恢复：

```powershell
# 方案 A（推荐）：管理员 PowerShell
wsl --shutdown
# 然后从开始菜单正常启动 Docker Desktop，等托盘图标显示 running
```

```powershell
# 方案 B：在 Docker Desktop GUI 里点 Restart；或重启 Windows 后再启动 Docker Desktop
```

确认栈可用的判据：

```bash
docker ps --format '{{.Names}}'                       # 能列出容器
curl -k https://127.0.0.1/_matrix/client/versions     # 返回 200
```

栈恢复后我会**直接接着跑**（实现与静态门禁已完成，不重做）：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d   # 若容器未自动起
cd frontend
npm run e2e:live      # M2-R 回归，确认栈与真实 E2EE 链路完好
npm run e2e:m3        # M3 安全阻断门禁；失败即修实现/脚本，直到 36/36
```

门禁通过后才会更新本报告结论、README / TODO / CHANGELOG 状态，并提交 M3 完成版本，
然后按用户授权自动进入 M4。

## 7. 边界与安全声明

- **TLS（浏览器 ↔ Caddy）与 DTLS（未来 SRTP）都不等价于端到端加密**；
  M2-R 已实证服务器侧只有 `m.room.encrypted` 密文，M3 恢复机制不改变这一信任边界：
  恢复密钥只在本机内存解码，服务器保存的是 4S 加密后的 secret，不持有明文密钥。
- M3 完成前的现实约束不变：**清除浏览器数据会丢失本设备解密密钥**；凭据只在内存，
  刷新页面需重新连接服务器（UI 明确提示，不静默回退演示数据）。
- **M4（加密附件）、M5（Web Push）、M6（通话）、M7（发布门禁）均未实现**。
- 当前版本**不可作为正式私密通讯工具发布**。

## 8. 文档索引

| 文档 | 说明 |
|---|---|
| `docs/M3-KICKOFF-CHECK.md` | M3 开工首检：SDK API 实证核对（本轮实现依据） |
| `docs/DEPENDENCIES.md §8` | M3 安装版 `.d.ts` 核对表与新增文件清单 |
| `docs/RISKS.md R4.9–R4.11 / R5.4` | M3 风险与当前发布阻断项 |
| `docs/M2-LIVE-REPORT.md` | M2-R 真实 E2EE 权威报告（32/32，历史结论仍有效） |
| `frontend/README.md` | 前端运行方式、`e2e:m3` 命令与当前门禁状态 |
