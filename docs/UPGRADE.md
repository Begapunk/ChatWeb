# Aether 升级指南（占位骨架，P0-9）

> 状态：M1 占位；M7 填实。

## M1 已确定的升级原则

- 版本精确锁定（docs/DEPENDENCIES.md）；升级 = 显式变更版本号 + 全量回滚预案，禁止 `latest`。
- Synapse 升级前：完整备份（BACKUP.md）+ 阅读 target 版本 CHANGELOG 的 breaking changes。
- 升级路径：`.env`/compose 修改版本 → `docker compose pull` → `docker compose up -d` →
  `scripts/check-deploy.sh` 全绿 → M1 集成测试（`scripts/run-m1-tests.sh --fresh`）。
- 数据库 schema 由 Synapse 自行迁移（启动时）；invite 服务由版本表 runner 自动迁移。
- 跨大版本通常需要逐版本升级（Synapse 官方升级说明为准，禁止跳级）。

## TODO（M7）

- [ ] 回滚步骤（镜像回退 + DB 快照回滚）
- [ ] 停机窗口与通知流程
- [ ] 升级演练记录
