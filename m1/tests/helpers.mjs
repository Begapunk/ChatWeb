// Aether M1 测试公共设施。
// 安全与合规要点：
//  - R3.5：走本地 Caddy（自签证书）的请求使用「仅限该请求」的 node:https Agent
//    （rejectUnauthorized:false 挂在专用 client 上），绝不设置
//    NODE_TLS_REJECT_UNAUTHORIZED=0 之类的全局开关。
//  - 日志红线：凭据/邀请码/令牌不打印、不落报告（报告只含检查项与状态码）。
//  - 每轮随机凭据（crypto.randomBytes），不硬编码。
import "fake-indexeddb/auto";
import http from "node:http";
import https from "node:https";
import { randomBytes, createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 测试目标全部是 127.0.0.1（R3.3）；进程内清掉代理环境变量，避免
// NODE_USE_ENV_PROXY / undici EnvHttpProxyAgent 把请求（含 SDK 内部 fetch）
// 送进本机代理 —— 实测该代理对 keep-alive 复用请求会错误返回 404。
for (const k of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "NODE_USE_ENV_PROXY"]) {
  delete process.env[k];
}

// ---- env：m1/.env.test 优先，回退根 .env.test（compose 同源）----
function parseEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}
const here = fileURLToPath(new URL(".", import.meta.url));
const m1Env = parseEnv(new URL("../.env.test", import.meta.url));
const rootEnv = parseEnv(new URL("../../.env.test", import.meta.url));

export const CADDY_URL = m1Env.M1_CADDY_URL || "https://127.0.0.1";
export const INVITE_DIRECT_URL = m1Env.M1_INVITE_DIRECT_URL || "http://127.0.0.1:8000";
export const SYNAPSE_DIRECT_URL = m1Env.M1_SYNAPSE_DIRECT_URL || rootEnv.SYNAPSE_INTERNAL_URL?.replace("synapse:", "127.0.0.1:") || "http://127.0.0.1:8008";
export const ADMIN_KEY = m1Env.M1_ADMIN_KEY || rootEnv.INVITE_ADMIN_API_KEY;
export const SYNAPSE_ADMIN_USERNAME = m1Env.M1_SYNAPSE_ADMIN_USERNAME || rootEnv.SYNAPSE_ADMIN_USERNAME;
export const SYNAPSE_ADMIN_PASSWORD = m1Env.M1_SYNAPSE_ADMIN_PASSWORD || rootEnv.SYNAPSE_ADMIN_PASSWORD;

if (!ADMIN_KEY || !SYNAPSE_ADMIN_USERNAME || !SYNAPSE_ADMIN_PASSWORD) {
  console.error("missing test env: need M1_ADMIN_KEY / M1_SYNAPSE_ADMIN_USERNAME / M1_SYNAPSE_ADMIN_PASSWORD (m1/.env.test or root .env.test)");
  process.exit(1);
}

// ---- HTTP：自签入口用专用 Agent（R3.5），直连回环用普通 http ----
// 重要：必须显式传 agent —— 本机若设置 NODE_USE_ENV_PROXY=1（WorkBuddy 等环境），
// Node 22+ 会把 http.request 路由到 env 代理，且该代理对 keep-alive 复用请求会
// 错误返回 404（实测）。显式 agent 同时天然绕开该代理（测试目标全部是 127.0.0.1）。
const selfSignedAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const directAgent = new http.Agent({ keepAlive: true });

export function requestJson(baseUrl, method, path, { body, headers = {} } = {}) {
  const url = new URL(baseUrl + path);
  const isHttps = url.protocol === "https:";
  const payload = body === undefined ? null : JSON.stringify(body);
  const options = {
    method,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      ...headers,
    },
    agent: isHttps ? selfSignedAgent : directAgent,
  };
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("request timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

// 经 Caddy 的公网路径请求（模拟受邀者浏览器路径）
export const viaCaddy = (method, path, opts) => requestJson(CADDY_URL, method, path, opts);
// 邀请服务直连回环（管理 CLI 通道）
export const directInvite = (method, path, opts) => requestJson(INVITE_DIRECT_URL, method, path, opts);
// Synapse 直连回环（E2EE SDK 之外的原生 HTTP 调用）
export const directSynapse = (method, path, opts) => requestJson(SYNAPSE_DIRECT_URL, method, path, opts);

const adminHeaders = { "X-Admin-Key": ADMIN_KEY };

// ---- 管理 CLI（PRD Q1(b)）----
export async function createCode({ ttl_hours, max_attempts, note } = {}) {
  const r = await directInvite("POST", "/admin/v1/codes", { body: { ttl_hours, max_attempts, note }, headers: adminHeaders });
  if (r.status !== 201) throw new Error(`createCode -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json; // { code_id, code, expires_at, max_attempts }
}
export async function getCode(codeId) {
  const r = await directInvite("GET", `/admin/v1/codes/${codeId}`, { headers: adminHeaders });
  if (r.status !== 200) throw new Error(`getCode -> ${r.status}`);
  return r.json;
}
export async function revokeCode(codeId) {
  const r = await directInvite("POST", `/admin/v1/codes/${codeId}/revoke`, { headers: adminHeaders });
  return r;
}
export async function getQuota() {
  const r = await directInvite("GET", "/admin/v1/quota", { headers: adminHeaders });
  if (r.status !== 200) throw new Error(`getQuota -> ${r.status}`);
  return r.json;
}
export async function getRooms() {
  const r = await directInvite("GET", "/admin/v1/rooms", { headers: adminHeaders });
  if (r.status !== 200) throw new Error(`getRooms -> ${r.status}`);
  return r.json.rooms;
}

// ---- 受邀者公共路径 ----
export async function verifyCode(code) {
  return viaCaddy("POST", "/invite-api/v1/verify", { body: { code } });
}

// 注册令牌 → 注册（UIA 流程；经 Caddy 公网路径）
// 实测：registration_requires_token 下 UIA flow 为多阶段（m.login.registration_token + m.login.dummy），
// 须按 M0 已验证的循环逐阶段提交（dummy 阶段不带参数）。
export async function registerWithToken(username, password, token) {
  const first = await viaCaddy("POST", "/_matrix/client/v3/register", { body: { username, password, inhibit_login: false } });
  if (first.status === 200) return first;
  const session = first.json?.session;
  const flow = (first.json?.flows || []).find((f) => f.stages.includes("m.login.registration_token"));
  if (!session || !flow) throw new Error(`register flow unavailable: ${first.status} ${JSON.stringify(first.json)}`);
  let auth = { session };
  let last = first;
  for (const stage of flow.stages) {
    auth = { ...auth, type: stage, ...(stage === "m.login.registration_token" ? { token } : {}) };
    last = await viaCaddy("POST", "/_matrix/client/v3/register", { body: { username, password, inhibit_login: false, auth } });
    if (last.status === 200) break;
  }
  return last;
}

export const rndName = (prefix) => `${prefix}${randomBytes(4).toString("hex")}`;
export const rndPass = () => randomBytes(18).toString("base64url");

export async function waitFor(fn, timeoutMs = 45_000, label = "condition", intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastError = e; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${label}${lastError ? ` (last: ${lastError.message})` : ""}`);
}

// ---- docker 辅助（本机跑测试才有；用于 B 用例的时间推进与 G 用例的 inspect 断言）----
// 注意：compose 命令必须在仓库根执行（测试进程 cwd 在 m1/）。
import path from "node:path";
const repoRoot = path.resolve(here, "..", "..");
export function dockerExec(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: repoRoot });
}
export function psqlInvite(sql) {
  const out = dockerExec([
    "compose", "-f", "docker-compose.yml", "-f", "docker-compose.local.yml",
    "--env-file", ".env.test", "exec", "-T", "postgres",
    "psql", "-U", rootEnv.POSTGRES_USER || "synapse", "-d", rootEnv.INVITE_DB_NAME || "invite",
    "-tAc", sql,
  ]);
  return out.trim();
}

// ---- 检查器与报告 ----
export function makeChecker(suite) {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail: detail === undefined ? null : String(detail) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  [${detail}]` : ""}`);
    return !!ok;
  };
  const report = () => {
    const dir = new URL("../reports/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`../reports/${suite}.json`, import.meta.url), JSON.stringify({
      suite, finishedAt: new Date().toISOString(),
      pass: checks.filter((c) => c.ok).length,
      fail: checks.filter((c) => !c.ok).length,
      checks,
    }, null, 2));
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`--- ${suite}: ${checks.length - failed}/${checks.length} passed ---`);
    return failed === 0;
  };
  return { check, report };
}

// ---- E2EE 设备工厂（吸收 M0 发现：F1 设备可见等待、事实 9 device_id 重建 client）----
export async function makeDevice(name, { userId, accessToken, deviceId, baseUrl }) {
  const sdk = await import("matrix-js-sdk");
  // TEST-ONLY deterministic key（生产由用户凭据派生，M3）
  const storageKey = createHmac("sha256", "aether-m1-test-seed").update(name).digest();
  const ssssKey = createHmac("sha256", "aether-m1-ssss-seed").update(name).digest();
  const client = sdk.createClient({
    baseUrl,
    userId,
    accessToken,
    deviceId,
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        const keyId = Object.keys(keys)[0];
        return keyId ? [keyId, ssssKey] : null;
      },
    },
  });
  await client.initRustCrypto({
    useIndexedDB: true,
    cryptoDatabasePrefix: `aether-m1-${name}`,
    storageKey,
  });
  const prepared = new Promise((resolve) => {
    client.on(sdk.ClientEvent.Sync, (state) => { if (state === "PREPARED") resolve(); });
  });
  await client.startClient({ initialSyncLimit: 30 });
  await prepared;
  return client;
}

export async function loginSynapse(username, password) {
  const r = await directSynapse("POST", "/_matrix/client/v3/login", {
    body: { type: "m.login.password", identifier: { type: "m.id.user", user: username }, password },
  });
  if (r.status !== 200) throw new Error(`login -> ${r.status} ${JSON.stringify(r.json?.errcode || "")}`);
  return r.json; // { user_id, access_token, device_id }
}
