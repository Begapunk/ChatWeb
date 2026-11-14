# Aether 部署指南（M1）

> 状态：M1 生效（P0-9）。M7 补充实操细节与故障手册。

## 1. 前置条件

- Linux 服务器（生产）：DNS 已解析到本机、80/443 可达（ACME HTTP-01）、Docker Engine + Compose v2+。
- 本机测试：Windows 11 + Docker Desktop（Git Bash 运行脚本）。
- 镜像不可直连 Docker Hub 时，`.env` 中 `REGISTRY_MIRROR` 指向镜像源（默认 `docker.1ms.run`）。
  各镜像 digest 应与 `docs/DEPENDENCIES.md` 记录比对（部署检查报告含记录）。

## 2. 首次部署

```bash
cp .env.example .env       # 填入真实值（全部 __CHANGE_ME__ 必须替换）
scripts/deploy.sh          # 拉镜像 → signing key 引导 → 渲染配置 → up -d → 等健康
scripts/check-deploy.sh    # 逐项安全断言，报告落 m1/reports/
```

`deploy.sh` 固化的引导顺序（幂等，可重复执行）：
1. `docker compose pull`（经镜像源，记录 digest）；
2. `infra/synapse/data/*.signing.key` 不存在时执行一次性
   `docker compose run --rm synapse generate --server-name $SYNAPSE_SERVER_NAME --report-stats no`；
3. `python scripts/render-synapse-config.py --env-file .env` 渲染 homeserver.yaml 与 log config
   （覆盖 generate 的默认产物，保留 signing key）；
4. `docker compose up -d`（invite-service 启动时自动：迁移 → 自举管理员/固定加密房间/名额行 → 开启轮询）。

## 3. 本地测试 profile（生产拓扑的忠实子集）

```bash
cp .env.example .env.test    # 值全部随机化（SYNAPSE_SERVER_NAME=aether.local 等，见 m1/README.md）
scripts/deploy.sh --local
scripts/check-deploy.sh --local
scripts/run-m1-tests.sh --fresh   # A–J 全量（重建卷）
```

### 与生产的 4 项差异（仅此 4 项，其余完全一致）

| 维度 | 生产 | 本地 |
|---|---|---|
| 入口 TLS | Caddy ACME 自动 HTTPS（`{$AETHER_DOMAIN}`） | Caddy 内建 CA 自签（`tls internal`，IP 证书） |
| 端口 | 80/443 对外 | 全部仅绑 127.0.0.1（另发布 synapse:8008、invite:8000 测试直连回环） |
| server_name / baseurl | `$AETHER_DOMAIN` / `https://$AETHER_DOMAIN/` | `aether.local` / `http://127.0.0.1:8008/` |
| 部署对象 | Linux 服务器 | Windows 11 Docker Desktop |

测试中对自签证书的接受策略：**仅限该请求**的独立 https Agent（`m1/tests/helpers.mjs`），
禁止任何全局关闭 TLS 校验的行为（R3.5）。

## 4. 红线与注意事项

- **`SYNAPSE_SERVER_NAME` 部署后不可变更**（更换 = 数据迁移工程）。
- `.env` / `.env.test` / `infra/synapse/data/`（含渲染配置与 signing key）永不入 git。
- 生产可加固项（备选）：机密从 `.env` 迁移为 Docker secrets 文件挂载；
  服务器防火墙仅放行 80/443；定期跑 `scripts/check-deploy.sh` 并归档报告。
- 管理操作（生成/作废邀请码）走本机回环 + `X-Admin-Key`（PRD Q1(b)）：
  `curl -X POST http://127.0.0.1:8000/admin/v1/codes -H "X-Admin-Key: …" -d '{"ttl_hours":72}'`
  （明文码只在响应中出现一次，请即时交付给受邀者并勿存档）。
- 日志红线：任何服务日志/审计不含码明文、注册令牌、access token、密码（R5.3）；
  `check-deploy.sh` 与 M1 测试均含相应扫描断言。

## 5. 服务清单与故障速查

| 容器 | 作用 | 健康检查 |
|---|---|---|
| aether-postgres-1 | Synapse 库 + invite 库（两库两用户） | pg_isready |
| aether-synapse-1 | Matrix homeserver（PG 后端） | GET /health（容器内 python3） |
| aether-invite-service-1 | 邀请服务（迁移/自举/轮询随启动执行） | GET /healthz |
| aether-caddy-1 | 唯一对外入口（仅 /_matrix 与 /invite-api） | 无（入口失联即整体可见） |

常见问题：
- synapse 起不来 → 看 `docker compose logs synapse`，多为 homeserver.yaml 渲染值缺失（重跑 render 脚本）。
- invite-service 起不来 → `docker compose logs invite-service`：配置缺失会 fail-fast 并指明变量名；
  管理员登录失败且账号已存在 → 修正 `.env` 的 `SYNAPSE_ADMIN_PASSWORD`（须与自举时一致）。
- 名额校准漂移 → `/admin/v1/quota` 查看 `seats_used` 与 `synapse_count`，服务会在下一成功事务自动取 max 自愈。
