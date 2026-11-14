# Aether 备份指南（占位骨架，P0-9）

> 状态：M1 占位；M7 填实并演练。以下为 M1 已确定的备份面与原则。

## 备份对象

| 对象 | 位置 | 方式（M7 细化） |
|---|---|---|
| Synapse 数据库 | PG 卷 `aether-pg-data`（库 synapse） | `pg_dump`（逻辑备份，含聊天密文事件） |
| 邀请服务数据库 | 同实例（库 invite） | `pg_dump`（邀请码哈希/名额/审计） |
| Synapse signing key / 媒体 | bind `infra/synapse/data/` | 目录归档（**signing key 丢失 = 服务器身份不可恢复**） |
| Caddy 证书 | 卷 `aether-caddy-data` | 可不备（ACME 自动重签） |
| 配置真值 | `.env`（gitignore） | 离线保管，绝不入 git/备份明文库 |

## 原则（M1 已生效）

- 备份产物加密存放；`.env` 与 signing key 视同最高机密。
- 恢复演练是备份的唯一有效证明（见 RESTORE.md）。

## TODO（M7）

- [ ] 自动化脚本 + 定时任务
- [ ] 恢复演练记录模板
- [ ] 异地/离线副本策略
