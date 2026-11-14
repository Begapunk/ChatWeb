#!/usr/bin/env bash
# Aether M1 QA 独立对抗性套件编排（test-adversarial.mjs）。
#
# 为什么必须独占全新栈：四人名额是单调、一次性、只有 4 席的稀缺资源。
# run-all.mjs（A–I 主套件）本身用掉完整 4 席预算；对抗性套件也会消耗完整 4 席
# （CC 8 并发 1 席 + ST11 恢复 1 席 + Q1 末席 1 席 + 管理员 1 席）。两者不可同栈跑，
# 否则 Q1「末席」必然撞 quota_exhausted（见 docs/M1-TEST-REPORT.md 发现 D-1）。
#
# 用法：scripts/run-m1-adversarial.sh --fresh
#   --fresh 必需：down -v 重建卷，名额预算从 0 开始。
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
if [ "$FRESH" -ne 1 ]; then
  echo "error: --fresh is required (this suite consumes the full 4-seat budget)"
  exit 2
fi

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test"
echo "==> fresh run: recreating volumes for exclusive adversarial suite"
$COMPOSE down -v --remove-orphans || true
rm -rf infra/synapse/data
./scripts/deploy.sh --local

echo "==> running adversarial suite (Node)"
cd m1
if [ ! -d node_modules ]; then
  npm ci 2>/dev/null || npm install
fi
node tests/test-adversarial.mjs
