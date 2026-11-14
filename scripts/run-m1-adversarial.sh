#!/usr/bin/env bash
# Aether M1 QA 独立对抗性套件编排（test-adversarial.mjs）。
#
# 名额上限已按用户决策（2026-11-14）彻底移除，不再存在「4 席预算」这一稀缺资源，
# 因此不再要求「独占全新栈」。--fresh 仅为结果可复现性推荐（重建卷、清零统计与账号），
# 已不是硬性前置；不带 --fresh 时可在已运行的本地栈上直接复跑。
#
# 用法：scripts/run-m1-adversarial.sh [--fresh]
set -euo pipefail
cd "$(dirname "$0")/.."

FRESH=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    *) echo "unknown argument: $arg"; exit 2 ;;
  esac
done

if [ ! -f .env.test ]; then
  echo "error: .env.test not found — generate it first (see docs/DEPLOY.md)"
  exit 1
fi

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test"
if [ "$FRESH" -eq 1 ]; then
  echo "==> fresh run: recreating volumes for a reproducible adversarial suite"
  $COMPOSE down -v --remove-orphans || true
  rm -rf infra/synapse/data
  ./scripts/deploy.sh --local
else
  RUNNING=$(docker inspect --format '{{.State.Health.Status}}' aether-invite-service-1 2>/dev/null || echo missing)
  if [ "$RUNNING" != "healthy" ]; then
    ./scripts/deploy.sh --local
  fi
fi

echo "==> running adversarial suite (Node)"
cd m1
if [ ! -d node_modules ]; then
  npm ci 2>/dev/null || npm install
fi
node tests/test-adversarial.mjs
