# DESIGN-M1 §10 待明确事项复核结论（实现前逐项实测/查证）

> 复核人：工程师 寇豆码（Kou）· 日期：2026-11-14
> 复核方法：① 镜像内源码 grep（`docker run --rm --entrypoint sh matrixdotorg/synapse:v1.165.0`）；
> ② `generate` 首跑实测（本机 Docker Desktop / Git Bash）；③ Synapse 官方文档（element-hq.github.io/synapse/latest）；
> ④ M0 已实测代码（m0/src/t05-synapse-e2ee.mjs）。**禁止凭记忆虚构**——本文件即证据。

| # | 事项 | 结论 | 证据 |
|---|---|---|---|
| 10.1 | Admin API 鉴权 | `Authorization: Bearer <管理员 access_token>`；token 亦可用 query 参数（不用）。无效/缺失 token 返回 401，非管理员返回 403；实现统一按 errcode（M_UNKNOWN_TOKEN/M_FORBIDDEN）处理并触发一次重登录 | 官方 admin_api/index.html（`curl --header "Authorization: Bearer <access_token>"` 原文）；401/403 语义由 M0 T05 管理员访问控制实测佐证 |
| 10.2 | registration_tokens/new 字段 | 请求 `{token?, length(1–64, 默认16), uses_allowed?, expiry_time?(ms epoch)}`；响应 `{token, uses_allowed, pending, completed, expiry_time}` | 官方 Registration Tokens 文档 + M0 T05 实测成功（length:43, uses_allowed:2, expiry_time） |
| 10.3 | 用户列表/计数 | `GET /_synapse/admin/v2/users`，参数 `guests=false`（排除访客）、`deactivated=false`（排除停用，默认即 false）、`limit`（默认 100）、`from`（next_token 分页）、`order_by`、`dir`；响应 `{users:[{name,admin,user_type,deactivated,is_guest,...}], next_token?, total}`。**用 `total` 做名额校准**，用 `users` 列表做轮询新用户发现（≤4 人单页足够） | 官方 user_admin_api.html「List Accounts」原文（含完整响应示例） |
| 10.4 | generate 命令与产物 | `docker run … synapse generate --server-name X --report-stats no` 产出 `/data/homeserver.yaml`、**`/data/<server_name>.signing.key`**、`/data/<server_name>.log.config`，并对 /data 执行 chown 991:991。模板 `signing_key_path` 与此一致 | 本机实测（.tmp-gen 产物文件清单核对） |
| 10.5 | 镜像源前缀 | postgres:16-alpine、caddy:2.11.9 经 `${REGISTRY_MIRROR}` 拉取成功（**注意**：docker.1ms.run 当日对 HEAD 请求返回 429 限流；实测改经 docker.m.daocloud.io 拉取后 retag 即可，compose 变量不变）；python:3.12-slim 构建成功；synapse 走已缓存 digest sha256:673b4223c81a | 部署自测实测 |
| 10.6 | homeserver.yaml 键名 | 见下方「键名核查明细」。**设计偏差：禁访客键名为 `allow_guest_access`（非 §2.2 所写的 `enable_guests`）** | 镜像内 `synapse/config/*.py` 源码 grep |
| 10.7 | 容器内 python3 + /health | 镜像含 Python 3.13.18；`/health` 资源在**每个** listener 上恒被注册（`synapse/app/homeserver.py`: "We always include a health resource"），GET 返回 200 `OK`。健康检查用 `python3 -c "import urllib.request;…"` 探测 `/health` | 镜像内源码 sed 输出 |
| 10.8 | Caddy `tls internal` 对 127.0.0.1 | 签发成功（含 IP SAN），**但**：Caddy 对「ClientHello 不带 SNI」的连接回 TLS alert internal_error（Windows schannel curl、Python 对 IP 字面量均不发 SNI）。已在 Caddyfile.local 增加 `default_sni 127.0.0.1` 兜底，修复后 Windows curl / Python / Node 全部握手成功 | 本地栈部署自测（openssl s_client -servername 对比复现） |
| 10.9 | pip 构建 + FastAPI×pydantic | python:3.12-slim + 清华 pypi 源构建成功；fastapi==0.162.7 与 pydantic==2.14.3 无冲突（pip 正常解析，lock 文件已产出） | invite-service 镜像构建实测 |
| 10.10 | Synapse PG 连接块 | `database.name: psycopg2`（源码仅接受 `sqlite3`/`psycopg2`；镜像内 psycopg2 2.9.11 已装）；args 键：`user/password/database/host/port`（+可选 cp_min/cp_max） | 镜像内 `synapse/config/database.py` 源码 + `python3 -c 'import psycopg2'` 实测 |
| 10.11 | asyncpg 0.32.0 create_pool | `asyncpg.create_pool(dsn, min_size=1, max_size=5)` 基本参数在 PG16 上连接/查询/事务全部正常 | 本地栈 invite-service 迁移+自举+全流程自测 |
| 10.12 | shared-secret 注册 MAC | `GET /_synapse/admin/v1/register` → `{nonce}`；`mac = HMAC-SHA1(shared_secret, f"{nonce}\0{username}\0{password}\0admin").hexdigest()`；`POST /_synapse/admin/v1/register {nonce, username, password, admin: true, mac}` → `{access_token, user_id, …}`。已按 m0 代码移植 | m0/src/t05+T06 两次实测成功；本地栈自举再次实测 |
| 10.13 | Windows compose run + bind mount | Git Bash 下 `docker compose run --rm synapse generate`（-v ./infra/synapse/data:/data）行为正常，路径/权限无问题（Docker Desktop） | 本机实测 |

## 键名核查明细（10.6）

| 键 | 存在性 | 源码/文档证据 | 处置 |
|---|---|---|---|
| `room_list_publication_rules` | ✅ 存在 | `synapse/config/room_directory.py`（`config.get("room_list_publication_rules")`） | 显式写 `[]`（未配置/空表均 = 拒绝一切房间发布，`is_publishing_room_allowed` 遍历空规则列表返回 False） |
| `admin_contact` | ✅ 存在 | `synapse/config/server.py:709` | 写 `mailto:{{OPERATOR_EMAIL}}` |
| `allow_guest_access` | ✅ 存在 | `synapse/config/registration.py:93`（默认 False） | **用于禁访客**（设计 §2.2 写作 `enable_guests`，系笔误，已按实际键名实现） |
| `enable_guests` | ❌ 不存在 | registration.py 中 grep 无此键 | — |
| `federation_domain_whitelist` | ✅ 存在 | `synapse/config/federation.py:36` + 官方文档「Specifying an empty list `[]` here is the recommended way of disabling federation」 | 写 `[]` 关联邦 |
| `trusted_key_servers` | ✅ 存在 | `synapse/config/key.py` | 写 `[]`（不向 matrix.org 发任何请求） |
| `allow_public_rooms_over_federation` / `allow_public_rooms_without_auth` | ✅ 均存在（默认 false） | 官方文档 | 显式写 false |
| `max_upload_size` / `max_image_pixels` / `dynamic_thumbnails` | ✅ 均存在 | 官方文档 + `synapse/config/repository.py:281` | 20M / "32M" / false |
| `serve_server_wellknown` | ✅ 存在（默认 false） | `synapse/config/server.py:439` | 显式 false |
| `manhole` | ✅ 存在（默认 null=关） | 官方文档 | 不写（保持默认关闭） |
| `enable_registration` / `registration_requires_token` / `enable_registration_without_verification` | ✅ 均存在 | `synapse/config/registration.py:49/64/57` | true / true / false |
| `x_forwarded`（listener） | ✅ 存在 | generate 产物 homeserver.yaml 原样含此键 | 写 true |

## 与 DESIGN-M1 的实现偏差（均已在最终报告中知会 team-lead）

1. **禁访客键名**：`allow_guest_access: false`（设计 §2.2 误写 `enable_guests`；M0 实际用的也是 `allow_guest_access`）。
2. **`manhole`**：不显式写出（默认即关闭；显式写 `manhole: null` 等效，为避免 YAML null 歧义从模板省略，检查脚本改为断言「未开启」）。
3. **码哈希含 pepper**：`code_hash = sha256(salt ‖ pepper ‖ code)`。设计 §3.2 公式为 `sha256(salt ‖ code)`，但 §8 又要求 `INVITE_HASH_PEPPER`（≥32B）环境变量——两者取并集：pepper 参与哈希使「仅泄露 DB 行」也无法离线爆破/校验码，安全只增不减；PRD P0-3 的「加盐哈希、不存明文」语义完全满足。
4. **PG 初始化脚本**：`infra/postgres/init/01-invite-db.sh`（非设计所写 `.sql`）——官方镜像机制下 `.sql` 无法注入密码类 env，`.sh` 是官方支持且唯一能参数化创建角色密码的形态。
5. **REVOKED 码的公共校验错误码**：映射为 `invalid`（错误码枚举无 `revoked`；对外不泄露「该码曾存在且被作废」的信息亦更安全）。
6. **`check-deploy` 为 bash 脚本**（`check-deploy.sh`），与 DESIGN §6 一致（主理人指令中写作 .py，以设计文档为准）。
7. **`INVITE_DB_URL` 由 compose 从 `INVITE_DB_USER/PASSWORD/NAME` 组装**（单一事实源），`.env.example` 中以注释说明；避免 URL 与散装密码两处维护漂移。

## 部署自测中新发现的环境事实（实现已吸收，QA/运维必读）

1. **PostgreSQL collation**：Synapse 启动即校验数据库 collation 必须为 `C`（实测 en_US.utf8 报 IncorrectDatabaseSetup 拒绝启动）。compose 已固定 `POSTGRES_INITDB_ARGS: "--locale=C --encoding=UTF8"`；**已有旧卷不可用**，改此参数必须重建卷。
2. **Caddy default_sni**：见 10.8。生产 Caddyfile（域名站点 + ACME）不受影响，无需该参数。
3. **注册 UIA 为多阶段**：`registration_requires_token: true` 下 Synapse 的 UIA flow 为 `[m.login.registration_token, m.login.dummy]`，**须逐阶段提交**（token 之后还要交一次 dummy，M0 代码即如此）；只交 token 会停在 401。
4. **访客注册拒绝形态**：`allow_guest_access: false` + 令牌制下，`kind=guest` 注册返回 401（UIA 且永远无法完成令牌阶段），而非传统 403；两者均为有效拒绝（check 脚本与测试按 401/403 双接受）。
5. **本机代理陷阱（测试环境）**：本机设置 `NODE_USE_ENV_PROXY=1` + `http(s)_proxy` 时，Node 22+ 的 http.request/fetch（含 matrix-js-sdk 内部请求）会经本机代理，且该代理对 keep-alive 复用请求错误返回 404。m1 测试已在进程内清除代理 env + 显式专用 Agent 双重规避（R3.5/R3.3 合规：目标全部 127.0.0.1）。**QA 跑测试须通过 m1/tests/helpers.mjs 的请求通道，勿用裸 fetch。**
6. **Windows curl（schannel）对无 SNI 连接**：即使加 `-k` 也握手失败（见 10.8 的 default_sni 修复）；check-deploy.sh 的 curl 请求在修复后正常。
7. **docker.1ms.run 限流**：镜像拉取 429 时可用 docker.m.daocloud.io 等替代源拉取后 retag（compose 的 REGISTRY_MIRROR 变量无需改动，镜像已在本机缓存）。

## 自测结果汇总（工程师自验证，非 QA 正式验收）

- 本地栈（docker-compose.local.yml + .env.test）：四容器 healthy；渲染/generate/迁移/自举全部成功。
- `scripts/check-deploy.sh --local`：**31/31 PASS**（H/I/G/J 的部署侧断言固化于此）。
- `scripts/run-m1-tests.sh --fresh`（A–J 全量，65 用例）：**65/65 PASS**，含 8 并发名额竞态恰 1 成功、E2EE 全链路（注册→自动入房→join→Megolm 收发→对端解密→服务器侧密文证明）。
- 栈自测后保留运行（QA 接手；正式复跑用 `--fresh` 重建卷以重置名额预算）。
