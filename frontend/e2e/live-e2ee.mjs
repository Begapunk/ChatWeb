/**
 * M2-R 安全验收：两个独立 Chrome 实例，经真实 Synapse 完成 E2EE 往返。
 *
 * 这不是界面烟测，而是安全阻断门禁：
 *  - 浏览器端真实加载 Rust Crypto WASM、注册（邀请码 + UIA）、登录、
 *    initRustCrypto、sync、自动入房、Megolm 加密发送与对端解密；
 *  - 服务器端用房间成员 token 读取原始事件，用「发送前后事件差集」
 *    证明本次产生的事件只有 m.room.encrypted 密文、wire 内容不含明文；
 *  - 验证整页刷新后不会静默回退到演示假数据（显式会话结束提示）；
 *  - 任一安全断言失败即 exit 1，禁止宣称 M2 完成。
 *
 * 前置：M1 本地栈运行中；frontend 已 build；preview 在 127.0.0.1:4173 运行。
 * 运行：npm run e2e:live
 * 环境变量覆盖：AETHER_LIVE_URL / AETHER_CHROME_PATH
 *
 * 测试凭据从项目根 .env.test 读取（已 gitignore），仅本机回环使用；
 * 管理端点、Synapse admin 只由本脚本直连，浏览器永远无法访问。
 */
import { chromium } from "playwright-core";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本机 NODE_USE_ENV_PROXY 会劫持 Node fetch，导致回环请求异常（M1 实测）。
for (const k of [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NODE_USE_ENV_PROXY",
]) delete process.env[k];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT_DIR = path.resolve(ROOT, ".tmp-gen", "m2-live");
const BASE = process.env.AETHER_LIVE_URL ?? "http://127.0.0.1:4173";
const CHROME =
  process.env.AETHER_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const INVITE_DIRECT = "http://127.0.0.1:8000";
const SYNAPSE_DIRECT = "http://127.0.0.1:8008";

const checks = [];
function check(id, label, ok, detail = "") {
  checks.push({ id, label, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? `  [${detail}]` : ""}`);
}

async function loadTestEnv() {
  const raw = await readFile(path.join(ROOT, ".env.test"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

async function jsonRequest(base, method, urlPath, { body, headers = {} } = {}) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** 生产入口 Caddy 的探测：TLS 校验放宽仅作用于这一个请求对象（等同 M1 局部 Agent）。 */
function caddyStatus(urlPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1", port: 443, path: urlPath, method,
        rejectUnauthorized: false, timeout: 10000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("caddy probe timeout")));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? ` (last: ${lastErr.message})` : ""}`);
}

async function createInvite(adminKey, note) {
  const r = await jsonRequest(INVITE_DIRECT, "POST", "/admin/v1/codes", {
    body: { ttl_hours: 1, note },
    headers: { "X-Admin-Key": adminKey },
  });
  if (r.status !== 201 || !r.json.code) throw new Error(`createInvite -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.code;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const env = await loadTestEnv();
  const adminKey = env.INVITE_ADMIN_API_KEY;
  if (!adminKey) throw new Error(".env.test 缺少 INVITE_ADMIN_API_KEY");

  // ---- 服务端准备：两枚一次性邀请码 + 固定加密房间 + 读原始事件的成员 token ----
  const codeA = await createInvite(adminKey, "M2-R live E2E A");
  const codeB = await createInvite(adminKey, "M2-R live E2E B");
  check("L01", "生成两枚不同的一次性邀请码", codeA !== codeB);

  const roomsRes = await jsonRequest(INVITE_DIRECT, "GET", "/admin/v1/rooms", {
    headers: { "X-Admin-Key": adminKey },
  });
  const group = (roomsRes.json.rooms ?? []).find((r) => r.kind === "group");
  check("L02", "自举固定加密群聊房间存在", Boolean(group?.room_id), group?.room_id ?? "");
  if (!group) throw new Error("无群聊房间，无法继续");
  const roomId = group.room_id;

  // M0 F7：非房间成员读事件会 404。这里用「房间创建者（成员）」的管理员 token，
  // 且该客户端从未 initRustCrypto，因此它拿不到 Megolm 会话密钥，只能读到密文。
  const adminLogin = await jsonRequest(SYNAPSE_DIRECT, "POST", "/_matrix/client/v3/login", {
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: env.SYNAPSE_ADMIN_USERNAME },
      password: env.SYNAPSE_ADMIN_PASSWORD,
    },
  });
  check("L03", "房间成员管理员登录成功（用于读取服务器侧原始事件）", Boolean(adminLogin.json.access_token));
  if (!adminLogin.json.access_token) throw new Error("管理员登录失败");
  const adminAuth = { Authorization: `Bearer ${adminLogin.json.access_token}` };

  const messagesPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`;
  async function readServerTimeline() {
    const r = await jsonRequest(SYNAPSE_DIRECT, "GET", messagesPath, { headers: adminAuth });
    return r.status === 200 ? (r.json.chunk ?? []) : null;
  }

  const suffix = randomBytes(3).toString("hex");
  const users = [
    { name: `m2r_a_${suffix}`, pass: randomBytes(18).toString("base64url"), code: codeA, role: "A" },
    { name: `m2r_b_${suffix}`, pass: randomBytes(18).toString("base64url"), code: codeB, role: "B" },
  ];
  const SECRET = `Aether-M2R-E2EE-secret-${suffix}`;

  const browsers = [];
  const sessions = [];

  async function openSession(user) {
    const browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    browsers.push(browser);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    const consoleErrors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    const http4xx = [];
    page.on("response", (r) => {
      if (r.status() >= 400) {
        http4xx.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      }
    });
    const session = { role: user.role, browser, context, page, errors, consoleErrors, http4xx, wasm: false };
    sessions.push(session);

    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "连接真实服务器" }).click();
    await page.getByRole("tab", { name: "邀请码注册" }).click();
    await page.getByPlaceholder("xxxxxxxx-xxxxxxxxxxxxxxxxxxxx").fill(user.code);
    await page.getByPlaceholder("你的用户名").fill(user.name);
    await page.getByPlaceholder("••••••••").fill(user.pass);
    await page.getByRole("button", { name: "连接真实服务器" }).click();

    await page.waitForFunction(() => window.location.pathname === "/", null, { timeout: 120000 });
    await page.locator(".convs__live").waitFor({ timeout: 30000 });
    session.wasm = await page.evaluate(() =>
      performance.getEntriesByType("resource").some((r) => r.name.includes("matrix_sdk_crypto_wasm_bg.wasm")),
    );
    return session;
  }

  try {
    // 两个独立浏览器实例 = 两个设备 / 两套 IndexedDB 加密存储
    const [a, b] = await Promise.all(users.map(openSession));
    check("L04", "A 用邀请码注册并连接真实服务器", Boolean(a));
    check("L05", "B 用邀请码注册并连接真实服务器", Boolean(b));
    check("L06", "A 浏览器真实加载 Rust Crypto WASM", a.wasm);
    check("L07", "B 浏览器真实加载 Rust Crypto WASM", b.wasm);

    // 前置条件：邀请服务轮询（5s）发出 invite，客户端 autoJoin 后，
    // 服务器侧两个账号都必须是 joined 成员（而非仅 invite）。
    // 这是真实业务前置条件，不是替产品逻辑兜底：autoJoinInvites 属于产品功能。
    const expectedUserIds = users.map(
      (u) => `@${u.name}:${env.SYNAPSE_SERVER_NAME}`,
    );
    const joinedPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`;
    const joinedMap = await waitFor(async () => {
      const r = await jsonRequest(SYNAPSE_DIRECT, "GET", joinedPath, { headers: adminAuth });
      if (r.status !== 200) return null;
      const ids = Object.keys(r.json.joined ?? {});
      return expectedUserIds.every((id) => ids.includes(id)) ? ids : null;
    }, 120000, "两个账号均自动加入加密群聊房间");
    check("L07b", "邀请服务发 invite 且客户端自动 join 完成（成员快照就绪）",
      joinedMap.length >= 2, `joined=${joinedMap.length}`);

    // 必须等会话列表出现目标房间，再用 SPA 内点击导航进入聊天页：
    // 整页 goto 会重载应用、丢失仅存于内存的凭据，是「不会发生的真实用户动作」，
    // 且会被刷新守卫正确拦截。
    for (const s of [a, b]) {
      const item = s.page.locator(`[data-room-id="${roomId}"]`);
      await item.waitFor({ timeout: 120000 });
      await item.click();
      await s.page.locator(".chat__notice--live").waitFor({ timeout: 30000 });
      const url = new URL(s.page.url());
      check(
        `L08-${s.role}`,
        `${s.role} 经 SPA 点击自动入房并进入同一加密群聊`,
        url.pathname === `/chat/${encodeURIComponent(roomId)}`,
        url.pathname,
      );
    }

    const statusA = await a.page.locator(".chat__notice").first().innerText();
    check("L09", "A 界面显示真实链路与 Megolm E2EE", statusA.includes("Megolm E2EE"), statusA.replace(/\n/g, " "));

    // ---- 发送前基线：记录服务器侧已有事件 ID，用于「本次发送」的差集证明 ----
    const before = await waitFor(async () => {
      const chunk = await readServerTimeline();
      return chunk ? chunk : null;
    }, 30000, "读取发送前服务器事件基线");
    const knownIds = new Set(before.map((e) => e.event_id));
    check("L09b", "取得发送前服务器事件基线", before.length > 0, `count=${before.length}`);

    // 等待双方设备互见后发送（M0 F1）；发送动作由 UI 触发，SDK 自动加密
    await a.page.locator(".composer__input").fill(SECRET);
    await a.page.getByRole("button", { name: "发送", exact: true }).click();

    const received = await waitFor(
      async () => (await b.page.locator(".bubble__text", { hasText: SECRET }).count()) > 0,
      90000,
      "B 解密来自 A 的加密消息",
    );
    check("L10", "B 成功解密跨浏览器加密消息", received);

    const bBody = await b.page.locator(".bubble__text", { hasText: SECRET }).first().innerText();
    check("L11", "B 看到的是明文而非无法解密占位", bBody === SECRET, bBody.slice(0, 60));

    // ---- 服务器侧密文证明：只针对本次发送产生的新事件 ----
    // 旧版只检查「存在任意 m.room.encrypted」，会被 M1 遗留的历史密文假通过。
    const after = await waitFor(async () => {
      const chunk = await readServerTimeline();
      if (!chunk) return null;
      return chunk.some((e) => !knownIds.has(e.event_id)) ? chunk : null;
    }, 60000, "服务器侧出现本次发送产生的新事件");
    const fresh = after.filter((e) => !knownIds.has(e.event_id));
    const freshEncrypted = fresh.filter((e) => e.type === "m.room.encrypted");

    check("L12", "本次发送在服务器侧产生 m.room.encrypted 密文事件",
      freshEncrypted.length >= 1, `new=${fresh.length} encrypted=${freshEncrypted.length}`);
    check("L13", "新密文事件算法为 Megolm 且含 ciphertext",
      freshEncrypted.some((e) => e.content?.algorithm === "m.megolm.v1.aes-sha2" && Boolean(e.content?.ciphertext)));
    check("L13b", "服务器侧本次新事件不存在明文体 m.room.message",
      !fresh.some((e) => e.type === "m.room.message" && JSON.stringify(e.content ?? {}).includes(SECRET)));
    check("L14", "服务器侧本次新事件全部不含明文", !JSON.stringify(fresh).includes(SECRET));
    check("L14b", "服务器侧全部原始事件均不含明文", !JSON.stringify(after).includes(SECRET));
    check("L15", "服务器侧无法从事件内容推断会话密钥", !JSON.stringify(after).includes("session_key"));
    check("L15b", "密文事件的 content 不含 body 明文字段",
      freshEncrypted.every((e) => !("body" in (e.content ?? {}))));

    // ---- 运行期健康（刷新前采集，避免刷新产生的噪声混入）----
    // 协议预期内的 4xx（浏览器会记成 console error，但属于正常握手）：
    //  - 401 POST /_matrix/client/v3/register：UIA 逐阶段挑战，注册流程必需（M1 同构）；
    //  - 404 GET  /_matrix/client/v3/room_keys/version：尚未配置密钥备份（M3 范围）。
    // 白名单不是「放宽」：先严格断言 4xx 集合完全等于预期清单，再断言除这些
    // 资源加载噪声外没有任何其它 console error（如 SDK 抛出的加密失败）。
    const PROTOCOL_4XX = [
      "401 POST /_matrix/client/v3/register",
      "404 GET /_matrix/client/v3/room_keys/version",
    ];
    const allErrors = sessions.flatMap((s) => s.errors);
    const allConsole = sessions.flatMap((s) => s.consoleErrors);
    const all4xx = sessions.flatMap((s) => s.http4xx);
    const unexpected4xx = all4xx.filter((x) => !PROTOCOL_4XX.includes(x));

    check("L16", "两个浏览器无未捕获异常", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    check("L16b", "浏览器 4xx 全部属于协议预期清单（无意外失败请求）",
      unexpected4xx.length === 0, `total4xx=${all4xx.length} unexpected=${JSON.stringify(unexpected4xx.slice(0, 3))}`);
    const noise = /^Failed to load resource: the server responded with a status of (401|404)/;
    const realConsoleErrors = allConsole.filter((t) => !noise.test(t));
    check("L17", "除协议预期 4xx 噪声外无 console error（含加密发送失败）",
      realConsoleErrors.length === 0, realConsoleErrors.slice(0, 2).join(" | ").slice(0, 300));
    check("L17b", "协议 4xx 噪声数量与白名单一一对应",
      allConsole.filter((t) => noise.test(t)).length === all4xx.length,
      `noise=${allConsole.filter((t) => noise.test(t)).length} http4xx=${all4xx.length}`);

    // ---- 管理面不可由浏览器/公网路径访问 ----
    const adminProbe = await fetch(`${BASE}/invite-api/admin/v1/codes`, { method: "POST" });
    check("L18", "浏览器同源路径无法访问邀请服务管理端点", adminProbe.status === 404, String(adminProbe.status));

    const directNoKey = await jsonRequest(INVITE_DIRECT, "POST", "/admin/v1/codes", { body: { ttl_hours: 1 } });
    check("L18b", "管理端点直连无 X-Admin-Key 被拒", directNoKey.status === 401, String(directNoKey.status));

    const caddyAdmin = await caddyStatus("/admin/v1/codes", "POST");
    check("L18c", "生产 Caddy 不路由邀请服务管理端点", caddyAdmin === 404, String(caddyAdmin));
    const caddySynapseAdmin = await caddyStatus("/_synapse/admin/v1/server_version");
    check("L18d", "生产 Caddy 不路由 Synapse 管理 API", caddySynapseAdmin === 404, String(caddySynapseAdmin));

    await a.page.screenshot({ path: path.join(OUT_DIR, "A-sender.png") });
    await b.page.screenshot({ path: path.join(OUT_DIR, "B-receiver.png") });

    // ---- 整页刷新不得静默回退到演示假数据（真实产品缺陷回归）----
    // 凭据只在内存，刷新必然丢失 live 会话；必须显式提示并要求重新连接。
    await b.page.reload({ waitUntil: "load" });
    await b.page.waitForFunction(
      () => window.location.pathname === "/login" && window.location.search.includes("session-expired"),
      null,
      { timeout: 20000 },
    );
    const expiredText = await b.page.locator(".auth__expired").innerText();
    check("L19", "刷新后显式提示真实会话已结束、需重新连接",
      expiredText.includes("真实会话已结束") && expiredText.includes("重新连接"), expiredText.slice(0, 70));
    const demoConvsVisible = await b.page.locator(".convs__list").count();
    check("L20", "刷新后不静默展示演示假会话列表", demoConvsVisible === 0, `count=${demoConvsVisible}`);
    const badgeText = await b.page.locator(".auth__tagline").innerText();
    check("L20b", "刷新后回到登录页而非聊天页", badgeText.includes("私人端到端加密通讯"));
    await b.page.screenshot({ path: path.join(OUT_DIR, "B-after-reload.png") });
  } finally {
    for (const br of browsers) {
      try {
        await br.close();
      } catch {
        // 关闭失败不影响报告
      }
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  await writeFile(
    path.join(OUT_DIR, "live-e2ee.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE,
        roomId,
        total: checks.length,
        passed,
        failed,
        checks,
        sessions: sessions.map((s) => ({ role: s.role, wasm: s.wasm, errors: s.errors, consoleErrors: s.consoleErrors })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n结果：${passed}/${checks.length} 通过，${failed} 失败`);
  console.log(`证据：${OUT_DIR}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("M2-R 验收执行失败：", err);
  process.exitCode = 1;
});
