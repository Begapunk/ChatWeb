// 验收 G/I（PRD §5）：管理 API 不对浏览器暴露；公开注册与访客关闭
// G：经 Caddy（公网入口，模拟浏览器路径）管理面一律 404；直连回环无密钥 401；
//    docker inspect 断言机密仅存在于服务端容器 env。
// I：不带令牌注册（匿名/访客）被拒。
// 不消耗名额。
import { readFileSync } from "node:fs";
import {
  viaCaddy, directInvite, dockerExec, makeChecker,
} from "./helpers.mjs";

const { check, report } = makeChecker("test-exposure");

// QA 修复（2026-11-14 独立复跑发现）：Synapse 内建 rc_registration 限流会在连续注册
// 探测后返回 429。429 本身既不是"放行"也不能单独证明访客被禁用，故：
//   1) 对 429 做有界退避重试，取得权威的 401/403；
//   2) 追加 homeserver.yaml 的 allow_guest_access:false 配置断言作为权威证据。
// 严禁把 NODE_TLS_REJECT_UNAUTHORIZED=0 / 全局代理开关带入测试（R3.5）。
async function registrationProbe(body) {
  let last;
  let limited = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    last = await viaCaddy("POST", "/_matrix/client/v3/register", { body });
    if (last.status !== 429) return { ...last, limited };
    limited++;
    if (attempt < 4) await new Promise((r) => setTimeout(r, 7000));
  }
  return { ...last, limited };
}

// ---------- G. 管理 API 不对浏览器暴露 ----------
const g1 = await viaCaddy("GET", "/_synapse/admin/v1/server_version");
check("G1 /_synapse/admin/* 经 Caddy 404（不路由）", g1.status === 404, g1.status);
const g2 = await viaCaddy("GET", "/_synapse/rest/admin/v1/server_version");
check("G2 /_synapse/rest/admin/* 经 Caddy 404", g2.status === 404, g2.status);
const g3 = await viaCaddy("POST", "/invite-api/admin/v1/codes", { body: {} });
check("G3 邀请服务管理端点经 Caddy 404", g3.status === 404, g3.status);
const g4 = await viaCaddy("POST", "/invite-api/v1/verify", { body: { code: "0000000000-aaaaaaaaaaaaaaaaaaaaaa" } });
check("G4 公共 verify 经 Caddy 可达（400 invalid，非 404）", g4.status === 400 && g4.json?.error === "invalid", g4.status);

// 直连回环（管理 CLI 通道）：无密钥/错密钥 401
const d1 = await directInvite("GET", "/admin/v1/quota");
check("G5 管理端点直连无密钥 → 401 unauthorized", d1.status === 401 && d1.json?.error === "unauthorized", `${d1.status} ${d1.json?.error}`);
const d2 = await directInvite("GET", "/admin/v1/quota", { headers: { "X-Admin-Key": "wrong-key-0123456789abcdef0123" } });
check("G6 管理端点直连错密钥 → 401", d2.status === 401, d2.status);

// docker inspect：机密注入矩阵
function containerEnv(name) {
  return dockerExec(["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", name]);
}
const caddyEnv = containerEnv("aether-caddy-1");
for (const secret of ["SYNAPSE_REGISTRATION_SHARED_SECRET", "SYNAPSE_ADMIN_PASSWORD", "INVITE_ADMIN_API_KEY", "INVITE_HASH_PEPPER", "POSTGRES_PASSWORD"]) {
  check(`G7 caddy env 不含 ${secret}`, !caddyEnv.includes(`${secret}=`));
}
const inviteEnv = containerEnv("aether-invite-service-1");
check("G8 invite-service env 含 INVITE_ADMIN_API_KEY（预期）", inviteEnv.includes("INVITE_ADMIN_API_KEY="));
const synapseEnv = containerEnv("aether-synapse-1");
check("G9 synapse env 含 SYNAPSE_REGISTRATION_SHARED_SECRET（预期）", synapseEnv.includes("SYNAPSE_REGISTRATION_SHARED_SECRET="));
check("G10 postgres 不暴露任何端口", !dockerExec(["port", "aether-postgres-1"]).trim().length);

// ---------- I. 公开注册与访客关闭 ----------
const i1 = await registrationProbe({ kind: "guest" });
// 实测：registration_requires_token 下 guest 走 UIA 且永远无法完成令牌阶段 → 401；传统禁访客路径 403。均算拒绝。
check("I1 访客注册被拒（401/403，非 200）", i1.status === 401 || i1.status === 403, i1.status);
check("I1a 限流可恢复：重试后取得权威响应（非 429）", i1.status !== 429, `429次数=${i1.limited} 终态=${i1.status}`);
// 权威证据：429 不能单独证明访客被禁用，必须核对运行中 homeserver 配置
const hsCfg = readFileSync(new URL("../../infra/synapse/data/homeserver.yaml", import.meta.url), "utf8");
check("I1b 运行配置 allow_guest_access: false（权威证据）", /^\s*allow_guest_access:\s*false\s*$/m.test(hsCfg));
check("I1c 运行配置 registration_requires_token: true", /^\s*registration_requires_token:\s*true\s*$/m.test(hsCfg));
const i2 = await registrationProbe({ username: "anon_probe", password: "probe-only-12345678" });
check("I2 匿名注册被拒（401 UIA 要求令牌）", i2.status === 401 && Array.isArray(i2.json?.flows), i2.status);
const flowHasToken = (i2.json?.flows || []).some((f) => f.stages.includes("m.login.registration_token"));
check("I3 注册流程必须含 m.login.registration_token 通道", flowHasToken, JSON.stringify(i2.json?.flows || []));

process.exit(report() ? 0 : 1);
