#!/usr/bin/env bash
# Aether 部署检查（P0-8）：逐项断言安全配置，产出可复核报告（H/I/G 断言在此固化）。
# 用法：scripts/check-deploy.sh [--local]
# 输出：m1/reports/check-deploy-<timestamp>.md + stdout（PASS/FAIL 汇总）。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

if [ "$LOCAL" -eq 1 ]; then
  ENV_FILE=".env.test"
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.test"
  BASE="https://127.0.0.1"
  CURL_OPTS=(-s -k --noproxy '*' --max-time 10)   # -k 仅限本条 curl：本地自签证书的「仅限该请求」接受策略（R3.5 同源语义）；--noproxy 绕开本机代理 env
else
  ENV_FILE=".env"
  COMPOSE="docker compose --env-file .env"
  BASE="https://$(grep -E '^AETHER_DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r"')"
  CURL_OPTS=(-s --max-time 10)
fi

[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found"; exit 1; }
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"'; }
PG_USER="$(env_get POSTGRES_USER)"; PG_USER="${PG_USER:-synapse}"
PG_DB="$(env_get POSTGRES_DB)"; PG_DB="${PG_DB:-synapse}"
ADMIN_KEY="$(env_get INVITE_ADMIN_API_KEY)"
DOMAIN="$(env_get AETHER_DOMAIN)"

REPORT_DIR="m1/reports"
mkdir -p "$REPORT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$REPORT_DIR/check-deploy-$TS.md"
PASS=0; FAIL=0

check() { # check <name> <exit-code-or-bool> [detail]
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "0" ] || [ "$ok" = "true" ]; then
    PASS=$((PASS+1)); RESULT="PASS"
  else
    FAIL=$((FAIL+1)); RESULT="FAIL"
  fi
  echo "| $RESULT | $name | ${detail:--} |" >> "$REPORT"
  printf '%s  %s %s\n' "$RESULT" "$name" "${detail:+[$detail]}"
}

http_code() { # http_code <method> <url> [data] [header]
  local method="$1" url="$2" data="${3:-}" hdr="${4:-}"
  local args=("${CURL_OPTS[@]}" -o /dev/null -w '%{http_code}' -X "$method" "$url")
  [ -n "$hdr" ] && args+=(-H "$hdr")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  local code
  code=$(curl "${args[@]}" 2>/dev/null || true)
  [ -n "$code" ] || code=000
  echo "$code"
}

# QA 修复：Synapse 内建 rc_registration 限流会对连续注册探测返回 429。
# 429 是内建防护而非放行、也不是"访客禁用"的证明；此处做有界退避重试取得权威 401/403，
# 并与下方 homeserver.yaml 的 allow_guest_access:false 配置断言形成双证据。
probe_register() { # probe_register <json-body>
  local body="$1" code=""
  for _ in 1 2 3 4 5; do
    code=$(http_code POST "$BASE/_matrix/client/v3/register" "$body")
    [ "$code" != "429" ] && break
    sleep 7
  done
  echo "$code"
}

echo "# Aether 部署检查报告" > "$REPORT"
echo "" >> "$REPORT"
echo "- 时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)  profile：$([ "$LOCAL" -eq 1 ] && echo local || echo production)  入口：$BASE" >> "$REPORT"
echo "" >> "$REPORT"
echo "| 结果 | 检查项 | 明细 |" >> "$REPORT"
echo "|---|---|---|" >> "$REPORT"

echo "==> 1. 容器健康（P0-8）"
for svc in postgres synapse invite-service; do
  ST=$(docker inspect --format '{{.State.Health.Status}}' "aether-$svc-1" 2>/dev/null || echo missing)
  check "容器 $svc healthy" "$([ "$ST" = "healthy" ] && echo 0 || echo 1)" "$ST"
done
ST=$(docker inspect --format '{{.State.Status}}' "aether-caddy-1" 2>/dev/null || echo missing)
check "容器 caddy running" "$([ "$ST" = "running" ] && echo 0 || echo 1)" "$ST"

echo "==> 2. 经 Caddy 的公开路径可达（生产入口语义）"
CODE=$(http_code GET "$BASE/_matrix/client/versions")
check "/_matrix/client/versions 经 Caddy 200" "$([ "$CODE" = "200" ] && echo 0 || echo 1)" "$CODE"
CODE=$(http_code GET "$BASE/invite-api/v1/status")
check "/invite-api/v1/status 经 Caddy 200" "$([ "$CODE" = "200" ] && echo 0 || echo 1)" "$CODE"

echo "==> 3. 管理面不对公网暴露（G）"
CODE=$(http_code GET "$BASE/_synapse/admin/v1/server_version")
check "/_synapse/admin 经 Caddy 404（不路由）" "$([ "$CODE" = "404" ] && echo 0 || echo 1)" "$CODE"
CODE=$(http_code GET "$BASE/_synapse/rest/admin/v1/server_version")
check "/_synapse/rest/admin 经 Caddy 404" "$([ "$CODE" = "404" ] && echo 0 || echo 1)" "$CODE"
CODE=$(http_code POST "$BASE/invite-api/admin/v1/codes" '{}')
check "邀请服务管理端点经 Caddy 404" "$([ "$CODE" = "404" ] && echo 0 || echo 1)" "$CODE"
# 直连回环：无密钥 401（G 双向断言）
CODE=$(http_code GET "http://127.0.0.1:8000/admin/v1/quota")
check "管理端点直连回环无密钥 → 401" "$([ "$CODE" = "401" ] && echo 0 || echo 1)" "$CODE"
CODE=$(http_code GET "http://127.0.0.1:8000/admin/v1/quota" '' "X-Admin-Key: $ADMIN_KEY")
check "管理端点直连回环带密钥 → 200" "$([ "$CODE" = "200" ] && echo 0 || echo 1)" "$CODE"

echo "==> 4. 联邦/访客/注册令牌（H/I，配置+行为双断言）"
CFG="infra/synapse/data/homeserver.yaml"
grep -q 'federation_domain_whitelist: \[\]' "$CFG" && RC=0 || RC=1
check "配置：federation_domain_whitelist 空表（关联邦）" "$RC"
grep -q 'allow_guest_access: false' "$CFG" && RC=0 || RC=1
check "配置：allow_guest_access false（禁访客）" "$RC"
grep -q 'registration_requires_token: true' "$CFG" && RC=0 || RC=1
check "配置：registration_requires_token true" "$RC"
grep -q 'trusted_key_servers: \[\]' "$CFG" && RC=0 || RC=1
check "配置：trusted_key_servers 空表（不外联 matrix.org）" "$RC"
grep -qE 'room_list_publication_rules: \[\]' "$CFG" && RC=0 || RC=1
check "配置：房间目录发布 deny-all" "$RC"
if grep -q 'names: \[federation\]' "$CFG"; then RC=1; else RC=0; fi
check "配置：无 federation listener" "$RC"
CODE=$(http_code GET "$BASE/_matrix/federation/v1/version")
check "联邦端点经 Caddy 不可达（404）" "$([ "$CODE" = "404" ] && echo 0 || echo 1)" "$CODE"

CODE=$(probe_register '{"kind":"guest"}')
# 实测：registration_requires_token 下 guest 也走 UIA 且永远无法完成令牌阶段 → 401；传统禁访客路径为 403。两者均为拒绝。
check "访客注册被拒（401/403，429 限流退避后判定）" "$([ "$CODE" = "403" ] || [ "$CODE" = "401" ] && echo 0 || echo 1)" "$CODE"
CODE=$(probe_register '{"username":"probe_should_fail","password":"x-probe-only"}')
check "无令牌注册被拒（401 UIA）" "$([ "$CODE" = "401" ] && echo 0 || echo 1)" "$CODE"

echo "==> 5. 机密注入矩阵（G，docker inspect 断言）"
CADDY_ENV=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' aether-caddy-1 2>/dev/null)
for SECRET_NAME in SYNAPSE_REGISTRATION_SHARED_SECRET SYNAPSE_ADMIN_PASSWORD INVITE_ADMIN_API_KEY INVITE_HASH_PEPPER POSTGRES_PASSWORD; do
  if echo "$CADDY_ENV" | grep -q "^$SECRET_NAME="; then RC=1; else RC=0; fi
  check "caddy 容器 env 不含 $SECRET_NAME" "$RC"
done
INVITE_ENV=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' aether-invite-service-1 2>/dev/null)
if echo "$INVITE_ENV" | grep -q '^INVITE_ADMIN_API_KEY='; then RC=0; else RC=1; fi
check "invite-service 容器 env 含 INVITE_ADMIN_API_KEY（预期存在）" "$RC"
SYN_ENV=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' aether-synapse-1 2>/dev/null)
if echo "$SYN_ENV" | grep -q '^SYNAPSE_REGISTRATION_SHARED_SECRET='; then RC=0; else RC=1; fi
check "synapse 容器 env 含 SYNAPSE_REGISTRATION_SHARED_SECRET（预期存在）" "$RC"

echo "==> 6. 固定房间：加密 + 邀请制（PG 事实断言）"
ROOMS_TOTAL=$($COMPOSE exec -T postgres psql -U "$PG_USER" -d invite -tAc "SELECT count(*) FROM rooms" 2>/dev/null | tr -d '[:space:]')
ROOMS_ENC=$($COMPOSE exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "SELECT count(DISTINCT room_id) FROM event_json WHERE json::jsonb->>'type'='m.room.encryption' AND json::jsonb->'content'->>'algorithm'='m.megolm.v1.aes-sha2'" 2>/dev/null | tr -d '[:space:]')
check "固定房间全部启用 Megolm 加密" "$([ -n "$ROOMS_TOTAL" ] && [ "$ROOMS_TOTAL" != "0" ] && [ "$ROOMS_TOTAL" = "$ROOMS_ENC" ] && echo 0 || echo 1)" "invite_rooms=$ROOMS_TOTAL encrypted=$ROOMS_ENC"
ROOMS_INVITE=$($COMPOSE exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "SELECT count(DISTINCT room_id) FROM event_json WHERE json::jsonb->>'type'='m.room.join_rules' AND json::jsonb->'content'->>'join_rule'='invite'" 2>/dev/null | tr -d '[:space:]')
check "固定房间全部 join_rules=invite（邀请制）" "$([ -n "$ROOMS_TOTAL" ] && [ "$ROOMS_TOTAL" = "$ROOMS_INVITE" ] && echo 0 || echo 1)" "invite_rules=$ROOMS_INVITE"

echo "==> 7. 名额行与自举（I 之服务侧事实）"
SEATS=$($COMPOSE exec -T postgres psql -U "$PG_USER" -d invite -tAc "SELECT seats_used FROM quota_counters WHERE id=1" 2>/dev/null | tr -d '[:space:]')
check "quota_counters 单行存在且 seats_used>=1（管理员占席）" "$([ -n "$SEATS" ] && [ "$SEATS" -ge 1 ] && echo 0 || echo 1)" "seats_used=$SEATS"

echo "==> 8. 渲染配置不入 git（J 之本地断言）"
if [ -d .git ]; then
  if git check-ignore -q infra/synapse/data/homeserver.yaml 2>/dev/null; then RC=0; else RC=1; fi
  check "infra/synapse/data 被 gitignore" "$RC"
else
  check "infra/synapse/data 被 gitignore（.gitignore 规则存在，仓库未初始化跳过 check-ignore）" "$(grep -q 'infra/synapse/data/' .gitignore && echo 0 || echo 1)"
fi

echo "" >> "$REPORT"
echo "" >> "$REPORT"
echo "**汇总：PASS=$PASS FAIL=$FAIL**（$(date -u +%Y-%m-%dT%H:%M:%SZ)）" >> "$REPORT"
echo ""
echo "=============================="
echo "检查汇总: PASS=$PASS FAIL=$FAIL"
echo "报告: $REPORT"
[ "$FAIL" -eq 0 ]
