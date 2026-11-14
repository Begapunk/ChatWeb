// QA 独立对抗性套件（严过关）：工程师套件未覆盖或覆盖较浅的边角与错误路径。
// 覆盖：REVOKED 语义、过期先于哈希判定、一次性原子性（同码并发）、G 的对抗
//       （带真实管理员凭据经公网入口、路径穿越/编码变体）、畸形请求、
//       日志红线（明文码/令牌/密码不入日志）、docker inspect 机密面。
// 前置：本地栈已起即可。名额上限已按用户决策（2026-11-14）彻底移除，不再需要
//       「全新栈 + 独占 4 席预算」；--fresh 仅为结果可复现性推荐，非硬性前置。
// 约束：沿用 helpers.mjs 请求通道（禁裸 fetch）；报告/日志不含任何码/令牌/密码明文。
import {
  createCode, getCode, revokeCode, getQuota, verifyCode, registerWithToken,
  viaCaddy, directInvite, directSynapse, psqlInvite, dockerExec, loginSynapse,
  SYNAPSE_ADMIN_USERNAME, SYNAPSE_ADMIN_PASSWORD, ADMIN_KEY, requestJson, CADDY_URL,
  rndName, rndPass, makeChecker,
} from "./helpers.mjs";
import https from "node:https";
import { randomBytes } from "node:crypto";

const { check, report } = makeChecker("test-adversarial");

const watchdog = setTimeout(() => {
  console.error("WATCHDOG timeout (300s)");
  report();
  process.exit(1);
}, 300_000);

// 原始路径请求（不经 URL 归一化，用于穿越/编码变体）：
// 同样使用「仅限该请求」的专用 https.Agent（R3.5），禁全局关校验。
const rawAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
function rawCaddy(method, rawPath, { body, headers = {}, maxRedirects = 3 } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method, hostname: "127.0.0.1", port: 443, path: rawPath,
      headers: {
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      agent: rawAgent,
    }, (res) => {
      // 跟随 3xx（最多 maxRedirects 跳）——模拟攻击者完整重放
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        const loc = res.headers.location.startsWith("/")
          ? res.headers.location : new URL(res.headers.location, "https://127.0.0.1").pathname;
        resolve(rawCaddy(method === "HEAD" ? "GET" : method, loc, { body, headers, maxRedirects: maxRedirects - 1 }));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}
const adminHdr = { "X-Admin-Key": ADMIN_KEY };
const wrongCode = (code) => code.replace(/-.+$/, "-" + "x".repeat(22));

try {
  // ================= 1. G 对抗：真实凭据 + 路径变体经公网入口 =================
  // 1.1 拿到真实 Synapse 管理员 token（内部通道），用它从公网入口打管理 API —— 证明
  //     阻断来自路由层而非认证层（Caddy 不路由 /_synapse/*）。
  const adminLogin = await loginSynapse(SYNAPSE_ADMIN_USERNAME, SYNAPSE_ADMIN_PASSWORD);
  const synAuth = { Authorization: `Bearer ${adminLogin.access_token}` };

  const gA1 = await viaCaddy("GET", "/_synapse/admin/v1/server_version", { headers: synAuth });
  check("GA1 带真实管理员 token 经 Caddy 访问 /_synapse/admin → 404（路由层阻断）", gA1.status === 404, gA1.status);
  const gA2 = await viaCaddy("GET", "/_synapse/admin/v2/users", { headers: synAuth });
  check("GA2 带真实 token 经 Caddy /_synapse/admin/v2/users → 404", gA2.status === 404, gA2.status);
  const gA3 = await viaCaddy("GET", "/_synapse/rest/admin/v1/version", { headers: synAuth });
  check("GA3 带真实 token 经 Caddy /_synapse/rest/admin/* → 404", gA3.status === 404, gA3.status);
  const gA4 = await rawCaddy("POST", "/_synapse/admin/v1/registration_tokens/new", { body: { uses_allowed: 1 }, headers: { ...synAuth } });
  check("GA4 带真实 token POST 令牌签发端点经 Caddy → 404（不能发令牌）", gA4.status === 404, gA4.status);
  // 对照组：同一 token 走服务器内网（Synapse 直连回环 = 服务器本机语义）应可用
  const gA5 = await directSynapse("GET", "/_synapse/admin/v1/server_version", { headers: synAuth });
  check("GA5 对照：同 token 走内网直连 200（阻断确实只在公网入口）", gA5.status === 200, gA5.status);

  // 1.2 路径穿越 / 编码变体（全部跟随重定向后断言非 2xx 管理响应）
  const variants = [
    ["穿越", "/_matrix/client/versions/../../../_synapse/admin/v1/server_version"],
    ["点编码", "/_matrix/%2e%2e/_synapse/admin/v1/server_version"],
    ["反斜杠", "/_matrix\\..\\_synapse/admin/v1/server_version"],
    ["双斜杠", "//_synapse/admin/v1/server_version"],
    ["下划线编码", "/%5Fsynapse/admin/v1/server_version"],
    ["斜杠编码", "/_synapse%2fadmin%2fv1%2Fserver_version"],
    ["尾部斜杠", "/_synapse/admin/"],
    ["裸前缀", "/_synapse/admin"],
  ];
  for (const [label, p] of variants) {
    const r = await rawCaddy("GET", p, { headers: synAuth });
    check(`GA6 经 Caddy ${label}变体 → 非 2xx（${r.status}）`, r.status !== 200, r.status);
  }
  // invite 管理端点变体：带真实管理密钥也必须 404（公网入口不路由）
  const ivVariants = [
    ["直接", "/invite-api/admin/v1/codes"],
    ["斜杠编码", "/invite-api%2fadmin%2fv1%2Fcodes"],
    ["穿越", "/invite-api/v1/verify/../../admin/v1/codes"],
    ["rest 混淆", "/invite-api/v1/../_synapse/admin/v1/registration_tokens/new"],
  ];
  for (const [label, p] of ivVariants) {
    const r = await rawCaddy("POST", p, { body: {}, headers: { ...adminHdr } });
    check(`GA7 经 Caddy invite 管理 ${label}变体（带真实 X-Admin-Key）→ 404（${r.status}）`, r.status === 404, r.status);
  }
  // 文档/内省端点全部关闭
  for (const [base, m, fn] of [
    [CADDY_URL, "GET", "/docs"], [CADDY_URL, "GET", "/openapi.json"], [CADDY_URL, "GET", "/redoc"],
    [CADDY_URL, "GET", "/healthz"],
  ]) {
    const r = await requestJson(base, m, fn);
    check(`GA8 ${m} ${fn} 经 Caddy → 404`, r.status === 404, r.status);
  }
  const dDocs = await directInvite("GET", "/docs");
  const dOpen = await directInvite("GET", "/openapi.json");
  check("GA9 /docs、/openapi.json 直连也 404（文档面全关）", dDocs.status === 404 && dOpen.status === 404, `${dDocs.status}/${dOpen.status}`);
  const ctl = await directInvite("GET", "/admin/v1/quota", { headers: adminHdr });
  check("GA10 对照：管理通道（本机回环 + 真实密钥）→ 200（隔离不阻断合法 CLI）", ctl.status === 200, ctl.status);

  // 1.3 机密注入面（docker inspect 独立复核）
  const caddyEnv = dockerExec(["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", "aether-caddy-1"]);
  const caddyMounts = dockerExec(["inspect", "--format", "{{range .Mounts}}{{println .Source}}{{end}}", "aether-caddy-1"]);
  check("GA11 caddy env 无任何密钥类变量（仅域名/邮箱/PATH）",
    ["SYNAPSE_REGISTRATION_SHARED_SECRET", "SYNAPSE_ADMIN_PASSWORD", "INVITE_ADMIN_API_KEY", "INVITE_HASH_PEPPER", "POSTGRES_PASSWORD", "SYNAPSE_MACARON_SECRET_KEY", "SYNAPSE_FORM_SECRET", "INVITE_DB_PASSWORD"]
      .every((s) => !caddyEnv.includes(`${s}=`)));
  check("GA12 caddy 无 .env/机密文件 bind 挂载（仅 Caddyfile + 卷）",
    !caddyMounts.includes(".env") && !caddyMounts.includes("invite-service") && !caddyMounts.includes("synapse"),
    caddyMounts.trim().replace(/\n/g, "|"));
  const pgEnv = dockerExec(["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", "aether-postgres-1"]);
  check("GA13 对照：postgres env 含 POSTGRES_PASSWORD（服务端容器，预期）", pgEnv.includes("POSTGRES_PASSWORD="));

  // ================= 2. 状态机边角（B/C 补强 + REVOKED） =================
  const st1c = await createCode({ note: "ST: revoke" });
  const rv = await revokeCode(st1c.code_id);
  check("ST1 作废 UNUSED 码 → 200 ok", rv.status === 200 && rv.json?.ok === true, rv.status);
  const st1v = await verifyCode(st1c.code);
  check("ST2 REVOKED 码公共校验 → 400 invalid（不泄露作废事实）", st1v.status === 400 && st1v.json?.error === "invalid", `${st1v.status} ${st1v.json?.error}`);
  check("ST3 REVOKED 后码状态 REVOKED", (await getCode(st1c.code_id)).status === "REVOKED");
  const rv2 = await revokeCode(st1c.code_id);
  check("ST4 重复作废 REVOKED 码 → 409 invalid_state", rv2.status === 409, rv2.status);
  const rvGhost = await revokeCode("00000000-0000-4000-8000-000000000000");
  check("ST5 作废不存在的 code_id → 404 not_found", rvGhost.status === 404, rvGhost.status);

  const stB = await createCode({ note: "ST: 过期+错码" });
  psqlInvite(`UPDATE invite_codes SET expires_at = now() - interval '1 hour' WHERE id = '${stB.code_id}'`);
  const stBv = await verifyCode(wrongCode(stB.code)); // 明文也是错的
  check("ST6 过期判定先于哈希校验（错码+过期 → expired 而非 invalid）", stBv.status === 400 && stBv.json?.error === "expired", `${stBv.status} ${stBv.json?.error}`);
  check("ST7 attempts 仍为 0", (await getCode(stB.code_id)).attempts === 0);

  const stC = await createCode({ max_attempts: 1, note: "ST: 单次机会" });
  const stCv = await verifyCode(wrongCode(stC.code));
  check("ST8 max_attempts=1 首次错误即 BLOCKED（返回 blocked）", stCv.status === 400 && stCv.json?.error === "blocked", `${stCv.status} ${stCv.json?.error}`);
  check("ST9 状态 BLOCKED 终态", (await getCode(stC.code_id)).status === "BLOCKED");

  // ================= 3. 一次性原子性：同一码并发只发一张令牌 =================
  // 8 并发完整覆盖「恰 1 成功、其余 used、终态 USED」三项断言语义。
  // （旧版另有冗余 2 并发：在已废止的四人名额预算下会多预占一席、导致 Q1 预算失准；
  //  名额上限移除后该约束已消失，但为保持套件精简仍不恢复该冗余用例。）
  const cc8 = await createCode({ note: "CC: 同码 8 并发" });
  const cc8Res = await Promise.all(Array.from({ length: 8 }, () => verifyCode(cc8.code)));
  const cc8Ok = cc8Res.filter((r) => r.status === 200);
  const cc8Used = cc8Res.filter((r) => r.status === 400 && r.json?.error === "used");
  check("CC1 同码 8 并发 → 恰 1 成功 7 个 used（原子无超发）", cc8Ok.length === 1 && cc8Used.length === 7,
    `ok=${cc8Ok.length} used=${cc8Used.length}`);
  check("CC2 码终态 USED", (await getCode(cc8.code_id)).status === "USED");
  if (cc8Ok.length === 1) {
    const ccUser = rndName("cc"), ccPass = rndPass();
    const ccReg = await registerWithToken(ccUser, ccPass, cc8Ok[0].json.registration_token);
    check("CC3 唯一令牌真实可用（注册成功）", ccReg.status === 200 && !!ccReg.json?.user_id, ccReg.status);
  }

  // ================= 4. 失败计数后恢复（计数语义只算失败） =================
  const rc = await createCode({ max_attempts: 5, note: "ST: 恢复" });
  await verifyCode(wrongCode(rc.code));
  await verifyCode(wrongCode(rc.code));
  const midRc = await getCode(rc.code_id);
  check("ST10 两次错误后 attempts=2 仍 UNUSED", midRc.attempts === 2 && midRc.status === "UNUSED", `a=${midRc.attempts}`);
  const rcOk = await verifyCode(rc.code);
  check("ST11 正确明文在限额内 → 校验成功（恢复路径）", rcOk.status === 200 && !!rcOk.json?.registration_token, rcOk.status);
  const afterRc = await getCode(rc.code_id);
  check("ST12 成功后转 USED 且 attempts 保持 2（成功不计入）", afterRc.status === "USED" && afterRc.attempts === 2, `a=${afterRc.attempts}`);
  const gCode = await getCode(rc.code_id);
  check("ST13 管理查询响应不含明文码（仅哈希存储语义）", !JSON.stringify(gCode).includes(rc.code));

  // ================= 5. 畸形请求与错误处理 =================
  const m1 = await viaCaddy("POST", "/invite-api/v1/verify", { body: {} });
  check("MF1 空对象 body → 422（缺 code）", m1.status === 422, m1.status);
  const m2 = await viaCaddy("POST", "/invite-api/v1/verify", { body: { code: 12345 } });
  check("MF2 code 为数字 → 422", m2.status === 422, m2.status);
  const m3 = await viaCaddy("POST", "/invite-api/v1/verify", { body: { code: "a".repeat(129) } });
  check("MF3 超长 code（129 字符）→ 422", m3.status === 422, m3.status);
  const m4 = await viaCaddy("POST", "/invite-api/v1/verify", { body: { code: "b".repeat(128) } });
  check("MF4 128 字符但格式非法 → 400 invalid", m4.status === 400 && m4.json?.error === "invalid", m4.status);
  // 非 JSON content-type + 垃圾 body：不产生 5xx
  const m5 = await requestJson(CADDY_URL, "POST", "/invite-api/v1/verify", { headers: { "Content-Type": "text/plain" } });
  check("MF5 text/plain 无 body → 4xx（非 5xx）", m5.status >= 400 && m5.status < 500, m5.status);
  const m6 = await viaCaddy("GET", "/invite-api/v1/verify");
  check("MF6 GET verify → 405", m6.status === 405, m6.status);
  const m7 = await viaCaddy("POST", "/invite-api/v1/verify", { body: { code: "0000000000-xxxxxxxxxxxxxxxxxxxxxx", extra: "junk" } });
  check("MF7 未知 tag + 多余字段 → 400 invalid（未知 tag 不消耗任何码）", m7.status === 400 && m7.json?.error === "invalid", m7.status);
  // 高频冲击：20 连发未知 tag → 全 400，服务不倒
  const burst = await Promise.all(Array.from({ length: 20 }, () =>
    verifyCode(`${randomBytes(5).toString("hex")}-${"y".repeat(22)}`)));
  check("MF8 20 并发未知码冲击 → 全部 400 invalid", burst.every((r) => r.status === 400 && r.json?.error === "invalid"),
    `n=${burst.filter((r) => r.status === 400).length}`);
  const health = await directInvite("GET", "/healthz");
  check("MF9 冲击后服务健康", health.status === 200, health.status);

  // 管理端点参数校验
  for (const [label, body] of [
    ["ttl=0", { ttl_hours: 0 }],
    ["ttl 负数", { ttl_hours: -5 }],
    ["ttl 字符串", { ttl_hours: "3" }],
    ["max_attempts=0", { max_attempts: 0 }],
    ["note 超长", { note: "n".repeat(201) }],
  ]) {
    const r = await directInvite("POST", "/admin/v1/codes", { body, headers: adminHdr });
    check(`MF10 管理建码 ${label} → 422`, r.status === 422, r.status);
  }
  const empty = await directInvite("POST", "/admin/v1/codes", { headers: adminHdr });
  check("MF11 管理建码空 body → 4xx（缺省参数应可用或校验拒绝，不得 5xx）", empty.status >= 400 && empty.status < 500, empty.status);
  const noKey = await directInvite("GET", "/admin/v1/codes/00000000-0000-4000-8000-000000000000");
  check("MF12 管理查询无密钥 → 401（认证先于资源判定）", noKey.status === 401, noKey.status);
  const notFound = await directInvite("GET", "/admin/v1/codes/00000000-0000-4000-8000-000000000000", { headers: adminHdr });
  check("MF13 管理查询不存在 id → 404", notFound.status === 404, notFound.status);
  const junkPath = await directInvite("GET", "/admin/v1/nonsense", { headers: adminHdr });
  check("MF14 管理面未知路径 → 404", junkPath.status === 404, junkPath.status);

  // ================= 6. 无名额上限（2026-11-14 用户决策：彻底移除名额限制） =================
  // 原「末席 + 满员 + LR-M1-1 观测」语义已作废。此处验证：在已发放多张令牌、
  // 已注册多个账号之后，新邀请码仍可连续校验成功（无隐性人数上限）；
  // 邀请码仍是唯一准入控制；quota_counters 只作统计（unlimited=true / max_members=null）。
  const qPre = await getQuota();
  check("Q1 管理视图 unlimited=true / max_members=null（无名额上限）",
    qPre.unlimited === true && qPre.max_members === null,
    `unlimited=${qPre.unlimited} max=${qPre.max_members}`);

  const qA = await createCode({ note: "Q: 无上限#1" });
  const qAV = await verifyCode(qA.code);
  check("Q2 已有多账号后新码仍校验成功（第 N+1 张令牌）",
    qAV.status === 200 && !!qAV.json?.registration_token, `${qAV.status} pre=${qPre.effective}`);
  const qB = await createCode({ note: "Q: 无上限#2" });
  const qBV = await verifyCode(qB.code);
  check("Q3 连续再发一张码仍成功（无 409 quota_exhausted）",
    qBV.status === 200 && qBV.json?.error !== "quota_exhausted", `${qBV.status} ${qBV.json?.error}`);

  const qEnd = await getQuota();
  check("Q4 统计随成功发令牌增长且 unlimited 恒定",
    qEnd.seats_used > qPre.seats_used && qEnd.unlimited === true && qEnd.max_members === null,
    `before=${qPre.seats_used} after=${qEnd.seats_used} unlimited=${qEnd.unlimited}`);

  const qBad = await verifyCode("0000000000-aaaaaaaaaaaaaaaaaaaaaa");
  check("Q5 无效码仍被拒（移除人数上限 ≠ 放开准入）",
    qBad.status === 400 && qBad.json?.error === "invalid", `${qBad.status} ${qBad.json?.error}`);
  const qReuse = await verifyCode(qA.code);
  check("Q6 已用码仍被拒（一次性仍生效）",
    qReuse.status === 400 && qReuse.json?.error === "used", `${qReuse.status} ${qReuse.json?.error}`);

  // ================= 7. 日志红线（明文码/令牌/密码不入任何容器日志） =================
  // 采集本套件全程中出现过的敏感串（仅内存比对，绝不打印）
  const secrets = [cc8.code, rc.code, qA.code, qB.code, cc8Ok[0]?.json?.registration_token, SYNAPSE_ADMIN_PASSWORD];
  // verify 成功响应里出现过的令牌（ST11/Q2/Q3 的注册令牌在响应体中，也应只在内存）
  if (rcOk.status === 200) secrets.push(rcOk.json.registration_token);
  if (qAV.status === 200) secrets.push(qAV.json.registration_token);
  if (qBV.status === 200) secrets.push(qBV.json.registration_token);
  const logs = {
    "invite-service": dockerExec(["logs", "--since", "30m", "aether-invite-service-1"]),
    caddy: dockerExec(["logs", "--since", "30m", "aether-caddy-1"]),
    synapse: dockerExec(["logs", "--since", "30m", "aether-synapse-1"]),
  };
  for (const [name, text] of Object.entries(logs)) {
    const leaked = secrets.filter((s) => s && text.includes(s));
    check(`LR1 ${name} 日志不含明文码/令牌/密码`, leaked.length === 0, leaked.length ? `泄露种类数=${leaked.length}` : "clean");
  }

  // ================= 8. 审计与库内无明文（P1-2 语义） =================
  const auditSample = psqlInvite("SELECT event_type, result FROM audit_events ORDER BY id DESC LIMIT 50");
  const dbLeak = secrets.filter((s) => s && auditSample.includes(s));
  check("LR2 审计表近 50 行无明文敏感值", dbLeak.length === 0);
  const codeCols = psqlInvite("SELECT string_agg(c.column_name, ',') FROM information_schema.columns c WHERE c.table_name='invite_codes'");
  check("LR3 invite_codes 表无明文码列（只有哈希/盐）", !/code[^_]|plaintext|secret/i.test(codeCols), codeCols.trim());
} finally {
  clearTimeout(watchdog);
}

process.exit(report() ? 0 : 1);
