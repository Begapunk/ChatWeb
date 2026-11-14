# infra

M1 起在此落地生产配置。当前为占位说明，M0 的本地验证配置见 `m0/src/setup-synapse.mjs`。

- `synapse/` — homeserver.yaml 生产模板（PostgreSQL、禁联邦、注册令牌、媒体限制、日志红线）
- `postgres/` — 初始化 SQL 与迁移（Synapse 库 + 邀请服务库分离）
- `caddy/` — Caddyfile（唯一公网入口；/_synapse/admin 不对外）
- `livekit/` — LiveKit + lk-jwt-service（M6）
- `coturn/` — TURN（M6，按网络测试结果启用）

部署检查、备份、恢复、升级脚本将置于 `../scripts/`，文档见 `../docs/`。