# scripts

部署与运维脚本（M1 起实现）：

- `deploy.sh` — compose 部署（镜像源参数化、digest 校验、部署前安全配置断言）
- `check-deployment.sh` — 逐项断言：禁联邦/禁访客/注册令牌/管理接口不公网/HTTPS/端口最小化
- `backup.sh` / `restore.sh` — PostgreSQL + 媒体 + 密钥文件分离备份与恢复演练
- `upgrade.sh` — 快照→staging 验证→滚动升级

M0 阶段的本地 Synapse 启停在 `../m0/src/setup-synapse.mjs`。