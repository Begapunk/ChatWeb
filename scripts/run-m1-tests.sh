#!/usr/bin/env bash
# Aether M1 集成测试编排：local profile 起栈 → m1 全部测试 → 报告产出。
# 用法：scripts/run-m1-tests.sh [--fresh] [--keep]
#   --fresh  测试前 down -v 重建卷（名额预算从 0 开始；全量 A–J 复跑必须用此项）
#   --keep   测试后保留栈运行（默认保留；QA 期间勿删）
# 注意：全量测试对名额有确定性预算（见 m1/README.md），同一栈只能完整跑一轮。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

FRESH=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --keep) true ;;
    *) echo "unknown argument: $arg"; exit 2 ;;
  esac
done

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test"

if [ ! -f .env.test ]; then
  echo "error: .env.test not found — generate it first (see m1/.env.test.example / docs/DEPLOY.md)"
  exit 1
fi

if [ "$FRESH" -eq 1 ]; then
  echo "==> fresh run: recreating volumes"
  $COMPOSE down -v --remove-orphans || true
  rm -rf infra/synapse/data
  ./scripts/deploy.sh --local
else
  # 栈未起则起之；已起则复用（不重建卷）
  RUNNING=$(docker inspect --format '{{.State.Health.Status}}' aether-invite-service-1 2>/dev/null || echo missing)
  if [ "$RUNNING" != "healthy" ]; then
    ./scripts/deploy.sh --local
  fi
fi

echo "==> running m1 test suite (Node)"
cd m1
if [ ! -d node_modules ]; then
  npm ci 2>/dev/null || npm install
fi
node tests/run-all.mjs
