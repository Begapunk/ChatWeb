# Aether M1 服务端架构设计与任务分解（DESIGN-M1）

> 版本：v1.0 · 作者：架构师 高见远 · 状态：定稿待评审
> 上游输入：PRD-M1.md（§3/§4/§5/§6 为已定基线，直接采纳）、ARCHITECTURE.md、DEPENDENCIES.md、RISKS.md、M0-VERIFICATION-REPORT.md
> 环境事实基线：Windows 11 + Docker 29.7.2 + Compose v5.4.0；镜像经 docker.1ms.run（digest 已缓存）；本机 Python 3.13/3.14 仅工具用，服务容器用 python:3.12-slim；M1 全新部署，不复用 M0 SQLite 数据。
> 本文档只做设计与任务分解，不含实现代码。所有 Synapse API 细节均以官方文档/容器内实测复核为准（见 §10），**严禁凭记忆虚构**。

---

## ⚠️ 变更通告 M1-R1（2026-11-14 · 用户决策 · 已生效）

**四人名额上限已彻底移除**，邀请码成为唯一准入控制。本文以下设计条款已被取代：

| 位置 | 已废止内容 | 现行实现 |
|---|---|---|
| §1.1 表格前两行 | 「四人名额并发不少发不多发」「名额口径与 Synapse 用户数一致」 | 事务锁仍用于邀请码一次性原子性；`quota_counters` 仅作统计，不再做上限判定 |
| **§3.3 全节** | `effective >= max_members` → `quota_exhausted` + ROLLBACK | **判定分支已删除**。`record_seat_usage()`：锁行 → `max(seats_used, synapse_count)` 校准 → `seats_used+1`，纯统计，不抛 `QuotaExhausted` |
| §3.4 步骤 4 | 「进入名额事务（3.3）：锁 quota 行 → 校准 → 放行则调令牌 API」 | 「记录席位统计 + 调令牌 API」，无放行条件 |
| §5 接口表 `POST /invite-api/v1/verify` | 409 `quota_exhausted` | 该错误码已删除；响应码集合不再含 409 |
| §5 接口表 `GET /admin/v1/quota` | `{"max_members": 4, ...}` | `{"unlimited": true, "max_members": null, "seats_used": k, "synapse_count": n, "effective": e}` |
| §5 错误码表 / §7 时序图 | `quota_exhausted`、`alt effective ≥ 4` 分支 | 代码中已删除；本文 §7 内嵌时序图与 `docs/sequence-diagram.mermaid` 均已就地更新为无上限语义 |
| §3.2 数据模型 `quota_counters.max_members` | 参与准入判定 | 列保留仅为兼容已有数据库（避免破坏性迁移），代码不再读取 |
| §4 自举 `INSERT ... max_members=env` | 从 env 读取 | 固定 `VALUES (1, 4, 0) ON CONFLICT DO NOTHING`，4 仅为兼容旧列占位 |

配置面：`AETHER_MAX_MEMBERS` 已从 `.env.example` / `docker-compose.yml` / `config.py` 全部移除；
`main.py` 启动日志改为 `unlimited=true`（原日志读取 `cfg.max_members`，删除字段后已同步修正，
否则服务启动即 `AttributeError`）。

其余设计（双 profile、Caddy 路由、Synapse 加固、邀请码状态机、自动入房、日志红线）**完全不变**。
完整清单与回归证据见 [docs/M1-AMENDMENT-UNLIMITED.md](M1-AMENDMENT-UNLIMITED.md)。
**后续实现以变更文档为准。**

---

---

## 1. 实现方案与部署拓扑

### 1.1 核心技术难点与对策

| 难点 | 对策（设计决策） |
|---|---|
| 四人名额并发不少发不多发（PRD E） | 邀请服务自有 PG 单行 `quota_counters` 作 `SELECT … FOR UPDATE` 锁对象，在锁内完成「邀请码终态校验 → 名额判定 → Synapse 令牌发放 → 状态落库」全序列；Synapse `uses_allowed=1` 令牌作第二道兜底（R2.2） |
| 名额口径与 Synapse 实际用户数一致（PRD Q4） | 事务内以 `effective = max(自维护 seats_used, Synapse 非停用用户数)` 判定并回写漂移（详见 3.3） |
| 邀请码一次性语义防并发复用（同一码两个并发请求都转 USED） | 同一事务内对 `invite_codes` 行加锁 + 条件 UPDATE（`WHERE status='UNUSED'`，rowcount=1 才算成功） |
| 码明文不可入库、校验失败仍需按码计数（PRD C） | 码格式 `{tag}-{secret}`：tag（10 位 hex，uuid 派生）定位行，secret 为 `secrets.token_urlsafe(16)`（128bit 熵）；库中仅存 salt+sha256(salt‖code) 哈希 |
| 注册后自动入房（PRD Q3 方案 b） | 邀请服务轮询 Synapse admin 用户列表 → 对新 MXID 幂等生成 invite 任务 → 管理员账号发起 invite；join 由用户侧完成 |
| 本机无域名/证书跑通集成测试（生产/本地双形态） | compose 双 profile：生产 Caddy 自动 HTTPS（仅 80/443 对外）；本地 `docker-compose.local.yml` 用 Caddy `tls internal`（内建 CA）+ 127.0.0.1 端口绑定，测试用「仅限该请求」的自签接受策略（遵守 R3.5，禁止全局关 TLS 校验） |
| 镜像不可直连 Docker Hub（R3.4） | compose 镜像统一 `${REGISTRY_MIRROR:-docker.1ms.run}/...` 参数化；digest 记录于部署检查报告 |

### 1.2 技术选型与理由

- **FastAPI 0.162.7 + uvicorn 0.54.0**（版本锁定见 DEPENDENCIES.md）：邀请服务唯一 HTTP 框架；异步模型与 asyncpg 配合，事务锁内可穿插对 Synapse 的 HTTP 调用。
- **asyncpg 0.32.0（裸驱动，不用 SQLAlchemy/ORM）**：表仅 5 张、全部 SQL 显式（FOR UPDATE / 条件 UPDATE 本就必须手写）；少一层抽象即少一层版本兼容面。连接池用 `asyncpg.create_pool` 基本参数（0.32.0 的 pool min_size 行为变更不涉及，见 §10.11）。
- **迁移：简单版本表方案（不用 Alembic）**：`schema_migrations(version, name, applied_at)` + 按序号排列的纯 SQL 文件，服务启动时自动执行。理由：仅 1 个初始迁移可预期；SQL 可评审、无 Alembic 环境配置与版本耦合；单人小服务引入 Alembic 的复杂度收益为负。若 M7 出现复杂演进再评估切换。
- **httpx 0.28.1**：Synapse admin/client API 调用（async client，连接复用）。
- **homeserver.yaml 渲染：宿主机 Python 标准库脚本（不依赖 Synapse 镜像内部的 envsubst 行为）**：渲染确定性可评审、模板入 git、产物入 gitignore；不依赖任何未核实的镜像内部机制。
- **架构模式**：邀请服务为「路由层（api）→ 服务层（services）→ 存储层（db）+ 外部客户端（Synapse admin/client 封装）」的单体分层，无 ORM、无消息队列——4 人规模下最简可测结构。

### 1.3 compose 服务清单与部署拓扑

```text
                          公网（生产）
                             │ :80/:443
                             ▼
                    ┌──────────────────┐
                    │  caddy v2.11.9   │  唯一对外服务
                    │  /_matrix/* → synapse:8008
                    │  /invite-api/* → invite-service:8000
                    │  其余一律 404（M2 再开前端路由）
                    └────────┬─────────┘
                             │ aether-net（内部 bridge）
        ┌────────────────────┼───────────────────────┐
        ▼                    ▼                       ▼
┌────────────────┐  ┌────────────────┐   ┌──────────────────────┐
│ synapse        │  │ invite-service  │   │ postgres 16-alpine   │
│ v1.165.0       │  │ FastAPI/uvicorn │   │ 库 synapse + invite  │
│ /data 绑定挂载  │◄─┤ admin token/   │   │ （两库两用户，Q6）   │
│ 密文+PG         │  │ 管理密钥 仅env │   │ 无对外端口（两 profile）│
└───────┬────────┘  └────────┬───────┘   └──────────┬───────────┘
        └─────────────────────┴──────────────────────┘
             全部四服务同处 aether-net 内网；仅 caddy 发布端口
```

#### 服务清单（`docker-compose.yml` 基线 = 生产 profile）

| 服务 | 镜像（经 `${REGISTRY_MIRROR:-docker.1ms.run}` 前缀） | 端口发布 | 卷 | 健康检查 | 依赖 |
|---|---|---|---|---|---|
| postgres | `library/postgres:16-alpine` | **无**（两 profile 均不发布） | named `aether-pg-data`；挂 `infra/postgres/init:/docker-entrypoint-initdb.d:ro` | `pg_isready`（官方镜像机制） | — |
| synapse | `matrixdotorg/synapse:v1.165.0`（digest sha256:673b…62） | **无**（生产） | bind `./infra/synapse/data:/data`（homeserver.yaml 渲染产物 + signing key + media） | 容器内 python3 探测 `http://localhost:8008/health`（镜像内必含 python；curl/wget 不保证存在，见 §10.7） | postgres healthy |
| invite-service | build `backend/invite-service`，基础镜像 `library/python:3.12-slim`（build ARG 可换 pip 镜像源） | **仅 127.0.0.1:8000**（本机回环，供管理 CLI/测试；公网不可达） | 无（迁移自启动执行） | 同法探测 `/healthz` | postgres healthy + synapse healthy |
| caddy | `library/caddy:2.11.9` | 生产 `80,443`（`0.0.0.0`）；本地 `127.0.0.1:80/443` | named `aether-caddy-data`（证书+内建 CA）、`aether-caddy-config`；挂 `infra/caddy/Caddyfile` | 无健康检查（入口服务，失联即整体可见） | synapse + invite-service started |

- 全部服务 `restart: unless-stopped`；日志驱动 `json-file`，`max-size: 10m, max-file: 3`（日志红线 R5.3 的运维兜底）。
- compose 顶层 `name: aether` → 容器名 `aether-synapse-1` 等，与已停用的 M0 容器 `aether-m0-synapse` 不冲突，M0 卷保留不动。
- 网络：单一内部 bridge `aether-net`。synapse 与 invite 都需互访（invite 调 admin API）且都需访问 PG，拆双网无隔离收益，不拆。

#### 双 profile

| 维度 | 生产（`docker compose -f docker-compose.yml`） | 本地测试（`-f docker-compose.yml -f docker-compose.local.yml` + `--env-file .env.test`） |
|---|---|---|
| 入口 | Caddy `{$AETHER_DOMAIN}` 自动 HTTPS（ACME，邮箱 `CADDY_ACME_EMAIL`），仅 80/443 对外 | Caddyfile.local：站点 `https://127.0.0.1` + **`tls internal`**（Caddy 内建 CA 自签，官方文档功能），端口仅绑 127.0.0.1 |
| TLS 差异 | 真 certificates（持久化于 aether-caddy-data） | 自签证书；测试中**不得**设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`（R3.5），仅为走 Caddy 的请求创建独立的 https Agent（Node: `new Agent({rejectUnauthorized:false})` 挂在特定 client；Python: 独立 verify=False 的 httpx 实例），并在报告中标注「生产差异」 |
| 直连内网端口 | 不发布任何后端端口 | synapse `127.0.0.1:8008:8008`、invite `127.0.0.1:8000:8000`（测试直连内网跑 HTTP 层用例；等价于服务器本机回环语义，与 G 的「公网经 Caddy」断言不矛盾——G 用例全部经 `https://127.0.0.1` Caddy 路径发起） |
| server_name / baseurl | `SYNAPSE_SERVER_NAME=AETHER_DOMAIN`，`public_baseurl: https://$AETHER_DOMAIN/` | `SYNAPSE_SERVER_NAME=aether.local`（非联邦域名无解析要求），`public_baseurl: http://127.0.0.1:8008/`（渲染参数控制） |
| 部署对象 | Linux 服务器（DNS + 80/443 可达，ACME HTTP-01） | 本机 Windows 11 Docker Desktop |

> 本地 profile 的语义：**生产拓扑的忠实子集**——同 compose 服务、同 Caddy 路由规则、同 homeserver 安全配置（仅 server_name/baseurl/TLS 来源不同）。文档（docs/DEPLOY.md）显式列出这 4 项生产差异。

#### secrets / env 注入方式

- 所有机密走项目根 `.env`（gitignore；模板 `.env.example` 无真实值），compose `environment:` 只注入各服务所需子集；不使用 Docker secrets 文件（Windows compose 兼容性与复杂度考量），`docs/DEPLOY.md` 记录「生产可加固为 secrets 文件挂载」的备选项。
- 注入矩阵（最小可见性原则）：
  - postgres：`POSTGRES_USER/PASSWORD/DB`、TZ
  - synapse：`SYNAPSE_SERVER_NAME`、`SYNAPSE_REPORT_STATS`、PG 连接参数、`SYNAPSE_MACARON_SECRET_KEY`、`SYNAPSE_FORM_SECRET`、`SYNAPSE_REGISTRATION_SHARED_SECRET`（渲染进 homeserver.yaml 所需）
  - invite-service：`INVITE_DB_URL`、`SYNAPSE_INTERNAL_URL`、`SYNAPSE_ADMIN_USERNAME/PASSWORD`、`INVITE_ADMIN_API_KEY`、`INVITE_HASH_PEPPER`、限额与轮询参数
  - caddy：`AETHER_DOMAIN`、`CADDY_ACME_EMAIL`
  - **Caddy 容器不含任何 Synapse/邀请服务机密**；浏览器路径（/_matrix、/invite-api）不携带任何服务端机密（PRD 1.1-2）。
- G 验收的 `docker inspect` 断言：admin 凭据/管理密钥仅出现在 invite-service 与 synapse 容器 env，不出现在 caddy，不出现在任何挂载文件、镜像层与 git 历史。

---

## 2. homeserver.yaml 生产模板设计（`infra/synapse/homeserver.yaml.template`）

模板由 `scripts/render-synapse-config.py`（宿主机 Python ≥3.10，**仅标准库**，读 `.env`）以 `{{VAR}}` 占位符渲染为 `infra/synapse/data/homeserver.yaml`（gitignore）。渲染参数：`--env-file`、`--local`（本地 profile 时改写 baseurl 形态）。

### 2.1 env 渲染项

| 键 | 取值来源 | 说明 |
|---|---|---|
| `server_name` | `SYNAPSE_SERVER_NAME` | 不可变更（部署后换 server_name = 数据迁移），DEPLOY.md 红字提示 |
| `public_baseurl` | 生产 `https://{{AETHER_DOMAIN}}/`；本地 `http://127.0.0.1:8008/` | 客户端/校验用 |
| `report_stats` | `SYNAPSE_REPORT_STATS`（默认 no） | |
| `database.args.{user,password,database,host,port}` | `POSTGRES_*` | host=postgres（容器名），driver 见 §10.10 |
| `registration_shared_secret` | `SYNAPSE_REGISTRATION_SHARED_SECRET` | 仅邀请服务自举创建管理员时使用 |
| `macaronoon/form secret` | `SYNAPSE_MACARON_SECRET_KEY` / `SYNAPSE_FORM_SECRET` | |
| `signing_key_path` | `/data/{{SYNAPSE_SERVER_NAME}}.signing.key` | 由一次性 `generate` 引导生成（§10.4 复核文件名） |
| `log_config` | 固定 `/data/aether-synapse.log.config` | 渲染自 log.config.template |

### 2.2 固定项（安全基线，P0-2）

| 键 | 取值 | 目的 |
|---|---|---|
| `listeners` | 仅一个 `port: 8008, tls: false, type: http, x_forwarded: true, resources: [{names: [client]}]`，bind 容器内网 | 无 federation listener、无 TLS 终止（Caddy 负责）；`x_forwarded` 以真实 IP 记入日志 |
| `enable_registration` / `registration_requires_token` | `true` / `true` | 注册必经令牌（M0 实测） |
| `enable_guests` | `false` | 禁访客（PRD I） |
| `enable_registration_without_verification` | `false` | 防意外开放 |
| `federation_domain_whitelist` | `[]` | 关联邦（PRD H；空表 = 全禁，语义复核 §10.6） |
| `trusted_key_servers` | `[]` | 不向 matrix.org 发任何密钥/目录请求（隐私 + 断网安全） |
| `allow_public_rooms_over_federation` / `allow_public_rooms_without_auth` | `false` | 禁公开房间发现 |
| `room_list_publication_rules` | deny-all（具体写法 §10.6 复核；复核前仅依赖「房间全部 private + 邀请制」达成同等效果） | 房间目录不可公开列举 |
| `manhole` | `false`（默认，显式写出） | 关调试后门 |
| `max_upload_size` / `max_image_pixels` / `dynamic_thumbnails` | `20M` / `"32M"` / `false` | 媒体限制（M4 复核再调） |
| `serve_server_wellknown` | `false` | 无 .well-known 暴露 |
| `sso/saml/oidc/jwt/config` | 全部不出现 | 仅本地密码认证 |
| `admin_contact` | `mailto:{{OPERATOR_EMAIL}}` | 键存在性 §10.6 复核；不存在则记入 DEPLOY.md |
| `rc_registration` / `rc_registration_token_validity` | 保持默认（不显式覆盖） | Synapse 内建限流兜底防脚本冲击 |

日志红线（log.config.template）：root INFO；`synapse.http` 等仅记 method/path/status/耗时，**不记请求体**；不降低到 DEBUG（DEBUG 可能泄事件内容，R5.3）。

> 首次部署引导顺序（`scripts/deploy.sh` 固化）：
> 1. `docker compose pull`（经镜像源；比对/记录 digest）；
> 2. 若 `infra/synapse/data/*.signing.key` 不存在 → `docker compose run --rm synapse generate --server-name $SYNAPSE_SERVER_NAME --report-stats no`（官方镜像的一次性引导能力，§10.4 复核参数与产物文件名）；
> 3. `python scripts/render-synapse-config.py --env-file .env [--local]`（覆盖 generate 产生的默认 homeserver.yaml，保留 signing key）；
> 4. `docker compose up -d`（invite-service 启动时自动迁移 + 自举，见 3.5）。

---

## 3. 邀请服务设计（`backend/invite-service/`）

### 3.1 模块划分

```text
backend/invite-service/
├─ Dockerfile                  # python:3.12-slim + pip 镜像源 ARG
├─ requirements.txt            # 精确版本（§8）；构建后 pip freeze 产出 requirements.lock.txt
└─ app/
   ├─ main.py                  # FastAPI 工厂、lifespan（建池→迁移→自举→启动轮询任务）、/healthz
   ├─ config.py                # 全部环境变量集中读取与启动期校验（缺失即 fail-fast）
   ├─ api/
   │  ├─ public.py             # POST /invite-api/v1/verify（+ P2 文本状态端点）
   │  └─ admin.py               # /admin/v1/*（X-Admin-Key 常量时间校验）
   ├─ services/
   │  ├─ security.py            # 码生成/哈希/常量时间比较（secrets、hashlib、hmac）
   │  ├─ invite.py             # 校验编排：状态机 + 名额事务（§3.3/§3.4）
   │  ├─ quota.py              # 名额锁 + Synapse 计数校准
   │  ├─ synapse_admin.py      # Synapse Admin API 封装（httpx）
   │  └─ room_invite.py        # 自举（管理员/房间/名额行）+ 新用户轮询 + invite 重试
   └─ db/
      ├─ pool.py               # asyncpg 池（参数化查询封装）
      ├─ migrations.py         # 版本表 runner（启动时按序执行 db/migrations/*.sql）
      └─ migrations/0001_init.sql
```

### 3.2 数据模型（0001_init.sql，PG16 / invite 库）

```sql
CREATE TABLE schema_migrations (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invite_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         text NOT NULL UNIQUE,          -- 码前段（uuid 前 10 hex），定位用
  salt        text NOT NULL,                 -- base64(16B)，逐码独立
  code_hash   text NOT NULL,                 -- hex sha256(salt_bytes || code_bytes)
  status      text NOT NULL DEFAULT 'UNUSED'
              CHECK (status IN ('UNUSED','USED','EXPIRED','BLOCKED','REVOKED')),
  expires_at  timestamptz NOT NULL,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb   -- note/created_by 等，禁存明文码/令牌
);

CREATE TABLE quota_counters (
  id          integer PRIMARY KEY CHECK (id = 1),  -- 单行锁对象
  max_members integer NOT NULL DEFAULT 4,
  seats_used  integer NOT NULL DEFAULT 0            -- 口径见 3.3
);

CREATE TABLE rooms (
  room_id    text PRIMARY KEY,               -- Synapse room_id（!xxx:server_name）
  kind       text NOT NULL CHECK (kind IN ('group','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_invite_jobs (
  id               bigserial PRIMARY KEY,
  user_id          text NOT NULL,            -- 新用户 MXID
  room_id          text NOT NULL REFERENCES rooms(room_id),
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','DONE','FAILED')),
  attempts         integer NOT NULL DEFAULT 0,
  last_error_code  text,                    -- 仅错误码，禁含响应体
  last_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)                 -- 幂等：同人对同房至多一个任务
);

CREATE TABLE audit_events (                   -- P1-2：仅事件码
  id          bigserial PRIMARY KEY,
  event_type  text NOT NULL,                 -- code.created/code.revoked/verify.ok/verify.fail/token.issued/invite.done/invite.retry/invite.failed/bootstrap.*
  code_id     uuid REFERENCES invite_codes(id),
  result      text NOT NULL,                 -- 'ok' 或错误码枚举
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**码格式与哈希设计**（满足 PRD P0-3 + 状态机次数语义）：

- 明文码 = `{tag}-{secret}`，`tag` = uuid hex 前 10 位（生成时碰撞则重抽，UNIQUE 索引兜底），`secret` = `secrets.token_urlsafe(16)`（22 字符 base64url，128bit 熵 ≥ PRD 要求）。总长约 33 字符。
- 存储仅 `salt`（逐码 16B 随机）+ `code_hash = sha256(salt ‖ code)`（PRD 字面方案）；`tag` 之所以入库，是唯一可实现「**校验失败按码计数**」（PRD §4/C）的手段——错误提交可通过 tag 归属到行；tag 本身不含熵、泄露无害。
- 校验：`hashlib.sha256(salt_bytes + code_bytes).hexdigest() == code_hash`，常量时间 `hmac.compare_digest`。
- 明文码只在「生成响应」中出现一次（管理员侧）；任何日志/审计/DB 不再现（PRD Q5：裸码 + 文档给出 URL 模板示例）。

### 3.3 名额事务锁与口径统一（P0-5，PRD Q4）

**口径决策：自维护 `seats_used` 为事务权威 + Synapse 用户数实时校准（取 max）。**

- `seats_used` 初始 = 1（自举创建的管理员账号占第 1 席）；每次成功发放注册令牌（事务提交）+1；不因任何原因递减（Q4：M1 不支持注销回收）。
- 每次成功路径在锁内调用 Synapse admin 用户列表接口取 `n`（非停用、非 appservice 用户数）；`effective = max(seats_used, n)`：
  - `n > seats_used`（仅可能发生于异常路径：令牌已发但本地事务崩溃后令牌被使用，或持有 shared secret 者绕过发码直接建号）→ 将 `seats_used` 回写为 `n`（漂移自愈），随后照常判定；
  - `effective >= max_members` → 返回 `quota_exhausted` 并 ROLLBACK（邀请码保持 UNUSED，PRD §4）。
- 一致性论证：锁（单行 `quota_counters` FOR UPDATE）串行化全部「校验+发码」事务 → 并发不多发（E 的 8 并发恰 1 成功）；`uses_allowed=1` 令牌保证「一个码至多兑换一个账号」；`max()` 校准兜住两类漂移（发码后崩溃、绕过发码注册）→ 不少发不超卖。锁对象恒一行、加锁顺序恒定（先 `invite_codes` 行后 `quota_counters` 行），无死锁环。
- 性能：锁内含 2 次内网 HTTP（用户数查询、建令牌）+ 数条 SQL，毫秒级；4 人系统无吞吐压力，正确性优先。

### 3.4 校验的原子状态迁移（防并发复用，PRD §4 状态机）

`POST /invite-api/v1/verify` 编排（`services/invite.py`）：

1. 解析 `code` → 提取 tag → `SELECT … FOR UPDATE` 该行（无 tag 行 → `invalid`，不归属任何码，仅记全局审计）。
2. **过期判定先于尝试计数**（PRD B）：`expires_at <= now()` → 置 `EXPIRED`（终态）→ `expired`；已 `EXPIRED/USED/BLOCKED/REVOKED` → 对应终态错误码。
3. 哈希不匹配（status=UNUSED）→ 条件 UPDATE `attempts+1`；若 `attempts >= max_attempts` 则同语句置 `BLOCKED` → 返回 `blocked`（C：第 4 次即使正确明文也 `blocked`）。
4. 哈希匹配且 UNUSED → 进入名额事务（3.3）：锁 quota 行 → 校准 → 放行则调 `POST /_synapse/admin/v1/registration_tokens/new`（`uses_allowed: 1`，`expiry_time` = now + `INVITE_TOKEN_TTL_MINUTES`（默认 60）毫秒 epoch；**字段已核**官方文档）→ 条件 UPDATE `invite_codes SET status='USED', used_at=now() WHERE id=? AND status='UNUSED'`（rowcount 必须为 1，否则视为并发已消费 → 回滚全部并返回 `used`）→ `seats_used+1` → 审计 `verify.ok`+`token.issued` → COMMIT → 返回令牌。
5. Synapse 调用失败（5xx/网络）→ ROLLBACK，码保持 UNUSED，返回 `internal_error`（码不消耗、可重试——失败在发码前，符合「校验成功不计入 attempts」精神）。
6. 「发码成功但本地提交失败」的残余风险：令牌在 Synapse 已存在但码未 USED——由 3.3 的 `max()` 校准在下一事务自愈；60 分钟令牌短时效自然过期兜底；审计 `token.issued` 与 DB 状态差异在部署检查中可对账。此窗口为已知可接受残余（记录于 RISKS 更新项）。

### 3.5 自动入房流程（P0-6，PRD Q3 方案 b）

**管理员凭据**：`SYNAPSE_ADMIN_USERNAME/PASSWORD`（env，仅邀请服务容器可见）；`MatrixAdminClient` 启动时以 `POST /_matrix/client/v3/login`（m.login.password）换取 access_token，**仅存内存**，401/M_UNKNOWN_TOKEN 时重登录；绝不落日志/磁盘（R5.3）。

**invite 时机：轮询（决策）**。理由：注册令牌发放时未知受邀者最终 MXID（用户名在注册时自选），Synapse 无原生注册回调，appservice 太重；轮询在 4 人规模零成本且天然幂等。备选「注册时携带预分配用户名」被否（P2-1 弱绑定亦未定）。

- 轮询循环（asyncio task，间隔 `INVITE_POLL_SECONDS` 默认 5s）：
  1. `GET /_synapse/admin/v2/users`（端点与计数字段 §10.3 复核）拉全量用户（≤4 条）；
  2. 对每个「非管理员、不在 `room_invite_jobs` 出现过」的 MXID：为 `rooms` 表每个房间 INSERT 任务（UNIQUE 幂等）；
  3. 处理 PENDING 任务：管理员账号 `POST /_matrix/client/v3/rooms/{roomId}/invite` `{user_id}`；成功（或错误语义为「已是成员/已邀请」）→ DONE；失败 → attempts+1、`last_error_code` 记错误码，指数退避（5s×2^n）最多 5 次后置 FAILED 并审计 `invite.failed`（管理员可从日志/审计察觉，人工介入）。
- 幂等性：任务表 UNIQUE(user_id, room_id) + Matrix invite 重发无副作用 + 轮询对已 DONE 用户不再建任务。
- 失败重试策略：如上；测试对 invite 的等待采用轮询断言（最长 ~60s），吸收 M0 F3 教训（不依赖单次回调）。
- join 不做：服务侧只 invite；M1 注册脚本以新用户身份 sync → 收 invite → `POST /rooms/{id}/join`（验收 F）。

**服务自举（startup，幂等，`room_invite.py::ensure_bootstrap`）**——替代独立 bootstrap 脚本，实现「一条命令部署」：

1. 迁移执行（db/migrations.py）；
2. `quota_counters` 行不存在 → INSERT（max_members=env，seats_used=0）；
3. 管理员登录失败且用户不存在 → 用 `SYNAPSE_REGISTRATION_SHARED_SECRET` 走 shared-secret 管理注册 API（M0 已实测可用；MAC 构造复用 m0 工程代码，§10.12）创建管理员，成功后 `seats_used=1`；登录成功（用户已存在）→ 继续；
4. `rooms` 表为空 → 管理员创建固定房间：1 个 `group` + 1 个 `private`（`POST /_matrix/client/v3/createRoom`：`visibility: private`、`preset: private_chat`（join_rules=invite）、`initial_state` 注入 `m.room.encryption {algorithm: m.megolm.v1.aes-sha2}`、不 invite 任何人），room_id 入库；非空 → 跳过（幂等）。
   - 「四人私聊房间」网络由后续成员注册后自然形成（两两私聊房间），M1 固定房间 = 群聊 ×1 + 指定私聊 ×1，与 PRD F 口径一致。

**管理端点鉴权（P0-7）**：请求头 `X-Admin-Key`；对提供值先 `sha256` 归一长度再 `hmac.compare_digest` 比较与 env `INVITE_ADMIN_API_KEY`（≥32 字符随机）的摘要（常量时间 + 不泄露长度）；失败统一 401 `{"error":"unauthorized"}`，审计仅记次数。

**Caddy 层不可达保证**：Caddyfile 只 `handle /_matrix/*` 与 `/invite-api/*`，其余（含 `/_synapse/*`、`/admin/*`、`/invite-api/admin/*` 一切未知路径）落 `respond 404`——管理端点路由 `POST /admin/v1/...` 在 Caddy 根本无对应转发；叠加 compose 层面 invite-service 仅绑定 `127.0.0.1:8000`（服务器本机回环，供 Q1(b) 的管理 CLI：`curl http://127.0.0.1:8000/admin/v1/...` + 管理密钥；与生产路径一致，M2 可复用为后端 API）。G 验收对此双向断言（经 Caddy 404；不经密钥直连回环则 401）。

---

## 4. 接口定义（邀请服务全部 HTTP 端点）

通用约定：JSON；错误体 `{"error": "<code>", "message": "<可读文案，不含任何机密>"}`；成功体直接返回数据对象。时间一律 ISO 8601 UTC（Synapse `expiry_time` 例外为毫秒 epoch，按其官方 API 形态出入）。

### 4.1 公共端点（经 Caddy `/invite-api/*` 暴露）

| 方法/路径 | 请求 | 成功响应 | 失败 |
|---|---|---|---|
| GET `/healthz` | — | 200 `ok`（纯文本；compose 健康检查用，不鉴权、不泄内部信息） | 503 |
| POST `/invite-api/v1/verify` | `{"code": "abc123-xxxx…xxxx"}` | 200 `{"registration_token": "…", "token_expires_at": "2026-…Z"}` | 400 `invalid`；400 `expired`；400 `blocked`；400 `used`；409 `quota_exhausted`；429（可选限流，默认关闭）；500 `internal_error` |
| GET `/invite-api/v1/status`（P2） | — | 200 纯文本一行服务状态 | — |

`verify` 行为要点：过期先于计数（B）；失败计数只对 UNUSED 且 tag 可归属的码（C）；成功转 USED 一次性（A）；quota 拒绝不消耗码（D/E）；码不区分大小写地做 trim，其余严格。

### 4.2 管理端点（`X-Admin-Key`；不经 Caddy，仅容器内网/宿主回环可达）

| 方法/路径 | 请求 | 成功 | 失败 |
|---|---|---|---|
| POST `/admin/v1/codes` | `{"ttl_hours": 72?, "max_attempts": 5?, "note": "给老王的"}`（缺省用 env 默认） | 201 `{"code_id": uuid, "code": "明文码（仅此一次返回）", "expires_at": ISO, "max_attempts": n}` | 401 `unauthorized`；422 `invalid_param` |
| GET `/admin/v1/codes/{code_id}` | — | 200 `{code_id, tag, status, attempts, max_attempts, expires_at, created_at, used_at, metadata}`（**无明文**） | 401；404 `not_found` |
| POST `/admin/v1/codes/{code_id}/revoke`（P1-1） | — | 200 `{"ok": true}`（仅 UNUSED 可作废 → REVOKED） | 401；404；409 `invalid_state`（终态码不可作废） |
| GET `/admin/v1/quota` | — | 200 `{"max_members": 4, "seats_used": k, "synapse_count": n, "effective": e}` | 401 |
| GET `/admin/v1/rooms` | — | 200 `{"rooms": [{"room_id", "kind"}]}` | 401 |

### 4.3 错误码枚举（全服务统一，测试与文档共用）

`invalid` / `expired` / `blocked` / `used` / `quota_exhausted` / `unauthorized` / `not_found` / `invalid_state` / `invalid_param` / `internal_error`

### 4.4 邀请服务消费的 Synapse API（供工程师对照，均 §10 复核后实现）

| API | 用途 | 已核事实 |
|---|---|---|
| `POST /_synapse/admin/v1/registration_tokens/new` | 发放 `uses_allowed=1` + `expiry_time`（ms epoch）短时效令牌 | **字段已核**（2026-11-14 官方 Registration Tokens 文档：token/length(1-64,默认16)/uses_allowed/expiry_time；响应含 pending/completed） |
| `GET /_synapse/admin/v2/users`（或 v1，§10.3 定） | 名额校准 + 轮询新用户 | 端点存在、分页；total/排序字段待容器内复核 |
| `POST /_matrix/client/v3/login`（m.login.password） | 管理员 token | 标准 client API |
| `POST /_matrix/client/v3/createRoom` + `m.room.encryption` 初始状态 | 自举固定房间 | 标准 client API；M0 T05 已验证加密房间 |
| `POST /_matrix/client/v3/rooms/{roomId}/invite` | 入房邀请 | 标准 client API |
| shared-secret 注册管理 API（`/_synapse/admin/v1/register`） | 自举管理员（一次性） | **M0 已实测**（nonce+HMAC 流程），复用 m0 代码 |
| Admin API 鉴权 | `Authorization: Bearer <管理员 access token>` | 以 v1.165.0 官方文档为准（§10.1） |

---

## 5. 数据流时序图（Mermaid）

```mermaid
sequenceDiagram
    actor U as 受邀者(测试脚本)
    participant CA as Caddy
    participant INV as 邀请服务 FastAPI
    participant PG as PG(invite库)
    participant SY as Synapse
    participant ADM as 管理员账号(服务内)

    Note over U,ADM: 前置: 自举完成(管理员=1席, 固定加密房间已建)

    U->>CA: POST /invite-api/v1/verify {code}
    CA->>INV: 转发(唯一暴露的邀请服务路径)
    INV->>PG: SELECT * FROM invite_codes WHERE tag=? FOR UPDATE
    alt 过期/终态/哈希不匹配
        INV->>PG: EXPIRED/BLOCKED 迁移或 attempts+1; COMMIT
        INV-->>CA: 400 {error: expired|blocked|used|invalid}
        CA-->>U: 同上
    else 哈希匹配且 UNUSED
        INV->>PG: SELECT seats_used FROM quota_counters WHERE id=1 FOR UPDATE
        INV->>SY: GET /_synapse/admin/v2/users → 正式用户数 n
        INV->>INV: seats_used=max(seats_used,n) 仅统计校准<br/>（M1-R1: 不做上限判定）
        INV->>SY: POST /_synapse/admin/v1/registration_tokens/new<br/>{uses_allowed:1, expiry_time:+60min}
        SY-->>INV: {token, pending:0, completed:0}
        INV->>PG: UPDATE invite_codes→USED WHERE status='UNUSED'(rowcount=1)<br/>quota.seats_used+1(统计); INSERT audit; COMMIT
        INV-->>CA: 200 {registration_token, token_expires_at}
        CA-->>U: 同上
    end

    U->>CA: POST /_matrix/client/v3/register<br/>{type: m.login.registration_token, token, username, password}
    CA->>SY: 转发
    SY-->>U: 200 {user_id, access_token, device_id}(uses_allowed 用尽后他人 401)

    Note over INV,ADM: 轮询(每5s)
    INV->>SY: GET /_synapse/admin/v2/users → 发现新 MXID
    INV->>PG: INSERT room_invite_jobs (UNIQUE 幂等)
    ADM->>SY: POST /rooms/{roomId}/invite {user_id} (逐房间)
    INV->>PG: jobs→DONE; 审计 invite.done

    U->>SY: 新用户 sync → 收到群聊+私聊房间 invite
    U->>SY: POST /rooms/{roomId}/join
    U->>SY: 发送 m.room.encrypted(Megolm 密文)
    SY-->>ADM: 另一成员(管理员设备) sync 收到密文并解密成功(验收F)
```

---

## 6. 文件列表（全部创建/修改，相对仓库根）

```text
# ── 根 ──
docker-compose.yml                         [新建] 生产 profile 基线（含 healthcheck/依赖顺序/网络/卷）
docker-compose.local.yml                   [新建] 本地测试 profile（Caddyfile.local、回环端口、测试 env）
.env.example                               [修改] 补全 M1 全量变量并修正 INVITE_DB_URL 形态（见 §8 注）
.gitignore                                 [修改] 增加 .env、.env.test、infra/synapse/data/、m1/reports/、requirements.lock 等

# ── infra ──
infra/postgres/init/01-invite-db.sql       [新建] 创建 invite 角色+库（官方镜像 /docker-entrypoint-initdb.d 机制）
infra/synapse/homeserver.yaml.template     [新建] §2 模板
infra/synapse/aether-synapse.log.config.template [新建] 日志红线配置
infra/caddy/Caddyfile                      [新建] 生产：自动 HTTPS、仅 /_matrix 与 /invite-api 路由
infra/caddy/Caddyfile.local                [新建] 本地：https://127.0.0.1 + tls internal，同路由规则

# ── backend/invite-service ──
backend/invite-service/Dockerfile         [新建] python:3.12-slim、非 root、pip 镜像源 ARG、锁文件安装
backend/invite-service/requirements.txt    [新建] 精确版本（§8）
backend/invite-service/requirements.lock.txt [生成] 容器内 pip freeze 产出并提交
backend/invite-service/app/__init__.py
backend/invite-service/app/main.py         [新建] 工厂/lifespan(/healthz/迁移/自举/轮询)
backend/invite-service/app/config.py      [新建] env 集中校验
backend/invite-service/app/api/__init__.py
backend/invite-service/app/api/public.py   [新建] verify + 状态端点
backend/invite-service/app/api/admin.py    [新建] codes/revoke/quota/rooms
backend/invite-service/app/services/__init__.py
backend/invite-service/app/services/security.py    [新建] 码生成/哈希/常量时间比较
backend/invite-service/app/services/invite.py      [新建] 校验编排+状态机事务
backend/invite-service/app/services/quota.py       [新建] 名额锁+校准
backend/invite-service/app/services/synapse_admin.py [新建] admin API 封装
backend/invite-service/app/services/room_invite.py  [新建] 自举+轮询+invite 重试
backend/invite-service/app/db/__init__.py
backend/invite-service/app/db/pool.py     [新建] asyncpg 池
backend/invite-service/app/db/migrations.py [新建] 版本表 runner
backend/invite-service/app/db/migrations/0001_init.sql [新建] §3.2

# ── scripts（宿主机；deploy/check 为 bash，render 为 Python 标准库）──
scripts/render-synapse-config.py          [新建] homeserver+log 配置渲染（--local 参数）
scripts/deploy.sh                          [新建] 拉镜像(digest 记录)→generate(一次性)→渲染→up
scripts/check-deploy.sh                    [新建] P0-8 逐项断言+报告产出（H/I/G 断言在此固化）
scripts/run-m1-tests.sh                    [新建] 编排：local profile 起栈→跑 m1 全部测试→teardown 可选

# ── docs ──
docs/DESIGN-M1.md                          [新建] 本文
docs/class-diagram.mermaid                 [新建] §7 类图
docs/sequence-diagram.mermaid              [新建] §5 时序图
docs/DEPLOY.md / docs/BACKUP.md / docs/RESTORE.md / docs/UPGRADE.md [新建×4] 占位骨架（P0-9；M7 填实）

# ── m1 测试工程（Node 24 + matrix-js-sdk 45.1.0）──
m1/package.json                            [新建] 依赖精确锁定（复用 m0 锁定结论）
m1/.env.test.example                       [新建] 测试环境变量模板（真实值 gitignore）
m1/README.md                               [新建] 运行说明+验收对照表
m1/tests/helpers.mjs                       [新建] API 客户端/admin CLI/注册/轮询断言/专用 https Agent(R3.5)
m1/tests/test-lifecycle.mjs               [新建] 验收 A/B/C
m1/tests/test-quota.mjs                    [新建] 验收 D/E（E: 8 并发）
m1/tests/test-exposure.mjs                 [新建] 验收 G/I（经 Caddy；docker inspect 断言）
m1/tests/test-e2ee.mjs                     [新建] 验收 F（注册→invite→join→Megolm 收发→对端解密；吸收 F1/F3）
m1/tests/run-all.mjs                       [新建] 顺序编排+汇总报告 m1/reports/
```

合计约 40 个手写/生成文件（生成物 3 个），落在「25–40」目标带内。

---

## 7. 任务列表（供工程师按序执行；每项含验证方式）

### T01 项目基础设施与配置渲染（P0，无依赖）
**涉及文件**：`docker-compose.yml`、`docker-compose.local.yml`、`.env.example`、`.gitignore`、`infra/postgres/init/01-invite-db.sql`、`infra/synapse/homeserver.yaml.template`、`infra/synapse/aether-synapse.log.config.template`、`infra/caddy/Caddyfile`、`infra/caddy/Caddyfile.local`、`scripts/render-synapse-config.py`、`scripts/deploy.sh`、`docs/{DEPLOY,BACKUP,RESTORE,UPGRADE}.md`
**验证**：`docker compose config` 两形态均合法；render 脚本 `--local` 产物与模板 diff 仅 env 差异；local profile 拉起 postgres+synapse（generate→渲染→up）后 `/_health` 200、PG 内 synapse/invite 两库存在；`deploy.sh` 幂等重跑安全。**实现前置**：先完成 §10.4/10.5/10.6 复核（镜像源前缀、generate 参数、YAML 键名）。

### T02 邀请服务核心（P0，依赖 T01）
**涉及文件**：`backend/invite-service/Dockerfile`、`requirements.txt`、`app/config.py`、`app/main.py`、`app/api/{public,admin}.py`、`app/services/{security,invite,quota,synapse_admin}.py`、`app/db/{pool,migrations.py,migrations/0001_init.sql}`、`app/services/room_invite.py`（先空骨架）
**验证**：local profile 全栈起（invite healthy）；回环 CLI 生成码→`verify` 全生命周期手工走查（过期/超限/一次性/名额拒绝）；8 并发 `verify`（剩 1 名额）恰 1 成功；`docker inspect` 断言机密仅在容器 env。**实现前置**：§10.1/10.3 复核。

### T03 自举、入房轮询与部署检查（P0，依赖 T01+T02）
**涉及文件**：`app/services/room_invite.py`（补全）、`app/main.py`（lifespan 接线）、`scripts/check-deploy.sh`、`scripts/run-m1-tests.sh`、`m1/package.json`、`m1/.env.test.example`
**验证**：全新 volume 起栈→自举自动产出管理员+2 加密房间+quota 行=1 席；人工建码→注册 1 用户→≤60s 内收到两房间 invite（脚本以新用户 join 验证）；`check-deploy.sh` 全绿并产出报告（联邦/访客/无令牌注册/admin 不可达/房间加密邀请制/容器健康逐项断言）。**实现前置**：§10.12（shared-secret MAC 复用 m0 代码）。

### T04 HTTP 层集成测试 A–E + G/I（P0，依赖 T03）
**涉及文件**：`m1/tests/helpers.mjs`、`test-lifecycle.mjs`、`test-quota.mjs`、`test-exposure.mjs`、`m1/README.md`
**验证**：`run-m1-tests.sh` 对应子集全绿；每用例与 PRD §5 条目一一对应（README 对照表）；测试不依赖执行顺序、可重复跑（每轮随机凭据，仅入 `.env.test`）。

### T05 E2EE 入房全链路 + 收尾交付（P0，依赖 T03；可与 T04 并行）
**涉及文件**：`m1/tests/test-e2ee.mjs`、`m1/tests/run-all.mjs`、`README.md`（根，更新运行入口）、`TODO.md`（勾选 M1 项）、`m1/reports/`（报告产物）
**验证**：F 全链路：注册→sync 收 invite→join→新用户发 `m.room.encrypted`→管理员设备解密成功+服务器侧仍为密文；发送前执行设备可见等待（F1）；解密断言用轮询（F3）；J 项检查：`.env.example` 无真值、`git log -p` 无 token、四份占位文档存在。最终 `run-all.mjs` 汇总 A–J 全绿报告。

```mermaid
graph LR
    T01[T01 基础设施+配置] --> T02[T02 邀请服务核心]
    T02 --> T03[T03 自举+入房+部署检查]
    T03 --> T04[T04 HTTP 层测试 A-E,G,I]
    T03 --> T05[T05 E2EE 全链路 F+收尾]
```

（类图见 `docs/class-diagram.mermaid`，与本文 §3 一致，工程师据此实现。）

---

## 8. 依赖包清单（精确版本；registry 已核，见 DEPENDENCIES.md 体系）

### 邀请服务容器（python:3.12-slim）

```
- fastapi==0.162.7        # PRD 锁定
- uvicorn==0.54.0         # PRD 锁定（不含[standard]extras，减少依赖面）
- asyncpg==0.32.0         # 2026-11-14 PyPI 核实（0.32.0，2026-10-06 发布；支持 PG9.5–19 / Python3.9+）
- httpx==0.28.1           # HTTP 客户端（经典 httpx 最新稳定线；httpx2 为新项目，不引入）
- pydantic==2.14.3        # 2026-11-14 PyPI 核实最新；FastAPI 约束解析若冲突 pip 会显式报错→按报错调整并记录（§10.9）
```

构建流程：容器内 `pip install -r requirements.txt && pip freeze > requirements.lock.txt`，lock 文件提交；后续构建改用 lock 安装。pip 源 ARG 默认清华镜像（构建机网络约束，R3.4 同类）。

### m1 测试工程（Node 24 本机）

```
- matrix-js-sdk@45.1.0             # 锁定（m0 结论）
- @matrix-org/matrix-sdk-crypto-wasm@18.9.2   # SDK 精确依赖，不得用 19.x（R4.1）
```

### 宿主机脚本

`render-synapse-config.py`：Python ≥3.10 **仅标准库**（os/json/datetime/pathlib，手写 5 行 dotenv 解析）。`deploy.sh`/`check-deploy.sh`/`run-m1-tests.sh`：bash + docker/curl（Git Bash 环境）。

### .env.example 需同步的修正（T01 执行）

- `INVITE_DB_URL=postgresql://invite:__CHANGE_ME__@postgres:5432/invite`（原 `postgresql+asyncpg://` 为 SQLAlchemy 方言格式，与裸 asyncpg 设计不符；host 由 `postgres-invite` 修正为同实例 `postgres`，Q6）
- 新增：`INVITE_ADMIN_API_KEY`、`INVITE_HASH_PEPPER`（≥32B base64）、`SYNAPSE_ADMIN_USERNAME/PASSWORD`、`INVITE_TOKEN_TTL_MINUTES=60`、`INVITE_POLL_SECONDS=5`、`OPERATOR_EMAIL`、`SYNAPSE_PUBLIC_BASEURL_MODE`（render 用）
- 修正：`INVITE_CODE_TTL_SECONDS=259200`（PRD 默认 72h，原 86400 与 PRD 不符）

---

## 9. 共享知识与约定（工程师/测试员必读）

- **命名**：compose 项目 `aether`；容器 `aether-{postgres,synapse,invite-service,caddy}-1`；DB 内表 snake_case；状态机枚举值大写（`UNUSED/USED/EXPIRED/BLOCKED/REVOKED`）。
- **错误响应**：`{"error": enum, "message"?: 人话}`；HTTP 映射见 §4；任何 500 响应体不含堆栈/SQL。
- **日志红线（铁律，M1 检查脚本含扫描项）**：禁止记录——邀请码明文、注册令牌、access_token、管理密钥、任何密码、恢复密钥、消息正文。审计只存 `event_type/result/code_id`。异常 traceback 须过滤（确认不含请求体）。
- **时间**：DB `timestamptz`（UTC）；API ISO 8601 UTC；Synapse `expiry_time` 毫秒 epoch（官方形态）。
- **SQL**：一律参数化（asyncpg `$1`），禁止字符串拼接；迁移只经版本表 runner，禁手工改表。
- **常量时间比较**：所有密钥比较（admin key、码哈希）走 `hmac.compare_digest`。
- **测试环境**：`m1/.env.test`（gitignore，从 example 生成，每轮随机机密）；compose `--env-file .env.test`；**禁止** `NODE_TLS_REJECT_UNAUTHORIZED=0`（R3.5）——走本地 Caddy 的自签请求用每客户端独立 Agent；测试固定走 127.0.0.1（R3.3）。
- **E2EE 测试吸收 M0 发现**：发送前等待 `getUserDeviceInfo` 对端可见（F1）；解密断言轮询（F3）；注册后用返回 `device_id` 重建 client 才能 `initRustCrypto`（M0 事实 9）。
- **镜像**：所有拉取经 `${REGISTRY_MIRROR}`；digest 与 M0 记录比对；`NODE_TLS…`/代理类环境变量不进容器。
- **验收对照**：PRD §5 A–J ↔ m1 测试文件一一对应（README 表格），任何需求变更走 PRD 回改，不允许只改测试。

---

## 10. 待明确事项（实现前必须复核；严禁虚构）

| # | 事项 | 复核方法 |
|---|---|---|
| 10.1 | Synapse Admin API 鉴权头与错误体（Bearer admin token 具体形态、401/403 语义） | 官方文档 `https://matrix-org.github.io/synapse/v1.165.0/usage/administration/admin_api/index.html` + 容器内 curl 实测 |
| 10.2 | ~~registration_tokens/new 字段~~ | **已核**（2026-11-14 官方文档）：`token/length(1–64,默认16)/uses_allowed/expiry_time(ms epoch)`；响应 `{token, uses_allowed, pending, completed, expiry_time}`。实现时仍以 v1.165.0 页面再扫一眼 |
| 10.3 | 用户数与列表：`/_synapse/admin/v1/users` vs `v2/users` 的分页/total 字段、deactivated/appservice 过滤、排序参数 | 容器内建 2 测试用户后实测响应；优先 v2 |
| 10.4 | 镜像一次性 `generate` 命令参数与 signing key 产物文件名 | `docker compose run --rm synapse generate --server-name … --report-stats no` 首跑实测；核对生成文件名与模板 `signing_key_path` 一致 |
| 10.5 | 镜像源对官方镜像（`library/` 前缀）路径形态与各镜像 digest | `docker.1ms.run` 实测 pull 三镜像；digest 与 DEPENDENCIES 记录比对 |
| 10.6 | homeserver.yaml 键名：`room_list_publication_rules`、`admin_contact`、`x_forwarded`、`federation_domain_whitelist: []` 全禁语义 | 容器内 dump 官方 sample config（synapse 文档 `usage/configuring_synapse.html` → sample_config）；未知键会触发启动 warning，部署检查 grep 日志 |
| 10.7 | 容器内 `python3` 与 `/health` 端点可用性（healthcheck 手段） | `docker compose exec synapse python3 -c …` 实测 |
| 10.8 | Caddy `tls internal` 对 IP（127.0.0.1）签发支持（v2.11.9） | 本地 profile 首跑实测；失败则改用 `tls internal` + 主机名 |
| 10.9 | pip 构建可达性与 FastAPI 0.162.7 × pydantic 2.14.3 约束解析 | 构建即测；冲突则按 pip 报错降 pydantic 并记录 DEPENDENCIES |
| 10.10 | Synapse PG 连接块（driver 名与 args 键） | 官方文档 database 配置节 + 首跑容器日志无连接错误 |
| 10.11 | asyncpg 0.32.0 `create_pool` 基本参数兼容 | 单测冒烟（连接+查询+事务） |
| 10.12 | shared-secret 管理注册 MAC 构造（nonce 顺序/algorithm） | **复用 m0 已实测代码**（m0 工程同流程成功过），实现时直接移植并在 local 栈复测 |
| 10.13 | Windows 下 `docker compose run` 与 bind mount `./infra/synapse/data` 行为 | 本地首跑实测（路径大小写/权限） |

**假设（未被推翻即按此执行）**：生产部署于 Linux 单机、DNS+80/443 可达；docker.1ms.run 持续可用（否则切换镜像源仅需改 env）；4 人规模无性能目标；PRD §6 Q1–Q6 默认决策全部生效。

**设计层面已知残余风险（同步入 RISKS）**：①发码成功后本地事务崩溃的窄窗口由 max() 校准+短时效令牌兜底（§3.4-6）；②shared secret 在配置中常驻带来的理论旁路建号面（同为 §3.3 校准覆盖，secret 仅服务端）；③轮询延迟最长约 poll 间隔+一次重试，测试已按 60s 上限等待。
