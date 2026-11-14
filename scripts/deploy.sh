#!/usr/bin/env bash
# Aether 一键部署（DESIGN-M1 §2 首次部署引导顺序）：
#   1. docker compose pull（经镜像源；记录 digest）
#   2. signing key 不存在 → 一次性 generate（官方镜像引导能力，§10.4 已实测）
#   3. 渲染 homeserver.yaml / log config（宿主机 Python 标准库脚本）
#   4. docker compose up -d（invite-service 启动时自动迁移 + 自举）
#
# 用法：
#   scripts/deploy.sh            # 生产（.env）
#   scripts/deploy.sh --local    # 本地测试（.env.test + docker-compose.local.yml）
# 幂等：重复执行安全（generate 有签名密钥存在性判断；迁移/自举均幂等）。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    *) echo "unknown argument: $arg (supported: --local)"; exit 2 ;;
  esac
done

if [ "$LOCAL" -eq 1 ]; then
  ENV_FILE=".env.test"
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test"
  RENDER_ARGS=(--env-file .env.test --local)
else
  ENV_FILE=".env"
  COMPOSE="docker compose --env-file .env"
  RENDER_ARGS=(--env-file .env)
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found (copy .env.example and fill in values; for local tests create .env.test)"
  exit 1
fi

# ---- 0. 读取关键 env ----
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"'; }
SERVER_NAME="$(env_get SYNAPSE_SERVER_NAME)"
REPORT_STATS="$(env_get SYNAPSE_REPORT_STATS || echo no)"
[ -n "$SERVER_NAME" ] || { echo "error: SYNAPSE_SERVER_NAME missing in $ENV_FILE"; exit 1; }
REPORT_STATS="${REPORT_STATS:-no}"

echo "==> deploy profile: $([ "$LOCAL" -eq 1 ] && echo local || echo production)  server_name=$SERVER_NAME"

# ---- 1. 拉镜像（digest 记录）----
echo "==> pulling images (via \${REGISTRY_MIRROR}; may take a while on first run)"
if ! $COMPOSE pull --ignore-buildable --quiet 2>&1 | tail -5; then
  echo "warning: compose pull had failures; continuing (images may already be cached)"
fi
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E 'postgres:16-alpine|synapse|caddy:2.11.9|invite-service' || true

# ---- 2. signing key 引导（一次性）----
DATA_DIR="infra/synapse/data"
if ls "$DATA_DIR"/*.signing.key >/dev/null 2>&1; then
  echo "==> signing key present, skipping generate"
else
  echo "==> generating signing key (one-time)"
  mkdir -p "$DATA_DIR"
  $COMPOSE run --rm --no-deps synapse generate --server-name "$SERVER_NAME" --report-stats "$REPORT_STATS"
fi

# ---- 3. 渲染配置 ----
echo "==> rendering homeserver config"
python scripts/render-synapse-config.py "${RENDER_ARGS[@]}"

# ---- 4. 启动 ----
echo "==> docker compose up -d (build if needed)"
$COMPOSE up -d --build

# ---- 5. 等待健康 ----
echo "==> waiting for containers to become healthy"
DEADLINE=$((SECONDS + 180))
SERVICES="postgres synapse invite-service"
while [ $SECONDS -lt $DEADLINE ]; do
  ALL_OK=1
  for svc in $SERVICES; do
    STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "aether-$svc-1" 2>/dev/null || echo missing)
    [ "$STATUS" = "healthy" ] || ALL_OK=0
  done
  [ "$ALL_OK" = "1" ] && break
  sleep 5
done
for svc in $SERVICES; do
  STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "aether-$svc-1" 2>/dev/null || echo missing)
  echo "    $svc: $STATUS"
done
docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || $COMPOSE ps || true

echo "==> deploy complete."
echo "    next: scripts/check-deploy.sh $([ "$LOCAL" -eq 1 ] && echo --local)   # 部署检查"
