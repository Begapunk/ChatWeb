# Aether 恢复指南（占位骨架，P0-9）

> 状态：M1 占位；M7 填实并演练。

## 恢复顺序（依赖拓扑）

1. 新机器按 `docs/DEPLOY.md` 部署到「服务起来但未自举」状态（同 `SYNAPSE_SERVER_NAME`，**必须一致**）；
2. 停服：`docker compose down`；
3. 恢复 `infra/synapse/data/`（signing key 等）；
4. 恢复 PG 两库（synapse、invite）；
5. `docker compose up -d` → `scripts/check-deploy.sh` 全绿 → 抽查登录/收发消息。

## 原则（M1 已生效）

- signing key 与数据库必须同批恢复（身份与数据不匹配会导致联邦/客户端校验失败——本部署联邦关闭，影响限于历史事件校验）。
- 恢复后立即核对：`/admin/v1/quota` 的名额计数、固定房间列表。

## TODO（M7）

- [ ] 分级恢复（仅丢失 PG / 仅丢失 data 目录 / 全损）
- [ ] 演练记录模板与 RTO 目标
