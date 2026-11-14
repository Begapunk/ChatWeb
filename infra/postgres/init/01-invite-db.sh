#!/bin/bash
# Aether PostgreSQL 首启动初始化：创建邀请服务的独立角色与数据库（Q6：同一实例、独立库）。
# 官方 postgres 镜像 /docker-entrypoint-initdb.d 机制：仅在数据目录为空时执行一次。
# 说明：设计文档写 01-invite-db.sql，但 .sql 形态无法注入密码类 env（官方机制限制），
#       改用官方同样支持的 .sh 形态（差异记录于 docs/DESIGN-M1-CHECKS.md）。
# 安全：INVITE_DB_PASSWORD 建议使用 hex/base64url（无 shell/SQL 特殊字符）。
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE "${INVITE_DB_USER}" WITH LOGIN PASSWORD '${INVITE_DB_PASSWORD}';
    CREATE DATABASE "${INVITE_DB_NAME}" OWNER "${INVITE_DB_USER}";
    REVOKE ALL ON DATABASE "${INVITE_DB_NAME}" FROM PUBLIC;
EOSQL

echo "invite database initialized (user: ${INVITE_DB_USER}, db: ${INVITE_DB_NAME})"
