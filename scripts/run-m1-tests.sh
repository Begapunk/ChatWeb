#!/usr/bin/env bash
# Aether M1 集成测试编排：local profile 起栈 → m1 全部测试 → 报告产出。
# 用法：scripts/run-m1-tests.sh [--fresh] [--keep]
#   --fresh  测试前 down -v 重建卷（推荐：统计与账号从 0 开始，结果可复现）
#   --keep   测试后保留栈运行（默认保留；QA 期间勿删）
# 注意：名额上限已彻底移除（2026-11-14 用户决策），套件不再竞争稀缺席位，
#       同一栈可重复跑；--fresh 仅为可复现性推荐，非硬性要求。
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
