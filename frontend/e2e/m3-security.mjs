/**
 * M3 安全验收：清除浏览器数据 → 恢复密钥 → 历史消息解密（安全阻断门禁）。
 *
 * 这不是界面烟测，而是 M3 的安全阻断门禁：
 *  - 两个独立 Chrome 实例经真实 Synapse 完成 E2EE 往返（复用 M2-R 前置）；
 *  - A 建立跨签名 + 4S(SSSS) + 服务器密钥备份，生成一次性恢复密钥；
 *  - A 发送加密消息、B 解密；服务器侧用「事件 ID 差集」证明本次只有 m.room.encrypted；
 *  - 全新浏览器（等价于清除浏览器数据 / 换设备）不带恢复密钥登录 → 历史消息 UTD（对照组）；
 *  - 三条恢复路径：登录页携带恢复密钥、设置页导入恢复密钥、错误密钥 fail-closed；
 *  - 恢复后历史 Megolm 会话密钥必须真正导入，历史密文必须重新解密为明文；
 *  - 恢复密钥、口令、access_token 绝不出现在 localStorage / sessionStorage / console。
 *
 * 任一安全断言失败即 exit 1，禁止宣称 M3 完成。
 * TLS/DTLS 不等于 E2EE；本门禁验证的是「服务器拿不到解密密钥」这一属性在恢复后仍成立。
 *
 * 前置：M1 本地栈运行中；frontend 已 build；preview 在 127.0.0.1:4173 运行。
 * 运行：npm run e2e:m3
 * 环境变量覆盖：AETHER_LIVE_URL / AETHER_CHROME_PATH
 *
 * 测试凭据从项目根 .env.test 读取（已 gitignore），仅本机回环使用；
 * 管理端点、Synapse admin 只由本脚本直连，浏览器永远无法访问。
 */
import { chromium } from "playwright-core";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本机 NODE_USE_ENV_PROXY 会劫持 Node fetch，导致回环请求异常（M1 实测）。
for (const k of [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NODE_USE_ENV_PROXY",
]) delete process.env[k];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT_DIR = path.resolve(ROOT, ".tmp-gen", "m3-security");
const BASE = process.env.AETHER_LIVE_URL ?? "http://127.0.0.1:4173";
const CHROME =
  process.env.AETHER_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const INVITE_DIRECT = "http://127.0.0.1:8000";
const SYNAPSE_DIRECT = "http://127.0.0.1:8008";
const RECOVERY_PLACEHOLDER = "仅在本机内存中用于解密密钥备份，不会持久化或上传";

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

/** 读取页面持久化存储（用于证明恢复密钥/口令/token 从未落盘）。 */
async function storageSnapshot(page) {
  return page.evaluate(() => {
    const dump = (s) => {
      const out = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        out.push(`${k}=${s.getItem(k)}`);
      }
      return out.join("\n");
    };
    return { local: dump(localStorage), session: dump(sessionStorage) };
  });
}

const browsers = [];
const sessions = [];

async function newSession(role) {
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
  const s = { role, browser, context, page, errors, consoleErrors, http4xx, wasm: false };
  sessions.push(s);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  return s;
}

async function connectViaInvite(s, { name, pass, code }) {
  await s.page.getByRole("tab", { name: "连接真实服务器" }).click();
  await s.page.getByRole("tab", { name: "邀请码注册" }).click();
  await s.page.getByPlaceholder("xxxxxxxx-xxxxxxxxxxxxxxxxxxxx").fill(code);
  await s.page.getByPlaceholder("你的用户名").fill(name);
  await s.page.getByPlaceholder("••••••••").fill(pass);
  await s.page.getByRole("button", { name: "连接真实服务器" }).click();
}

async function connectViaLogin(s, { name, pass, recovery }) {
  await s.page.getByRole("tab", { name: "连接真实服务器" }).click();
  await s.page.getByPlaceholder("你的用户名").fill(name);
  await s.page.getByPlaceholder("••••••••").fill(pass);
  if (recovery) await s.page.getByPlaceholder(RECOVERY_PLACEHOLDER).fill(recovery);
  await s.page.getByRole("button", { name: "连接真实服务器" }).click();
}

async function waitConnected(s) {
  await s.page.waitForFunction(() => window.location.pathname === "/", null, { timeout: 120000 });
  await s.page.locator(".convs__live").waitFor({ timeout: 30000 });
  s.wasm = await s.page.evaluate(() =>
    performance.getEntriesByType("resource").some((r) => r.name.includes("matrix_sdk_crypto_wasm_bg.wasm")),
  );
}

async function goConversations(s) {
  await s.page.locator('nav[aria-label="主导航"]').getByRole("button", { name: "会话" }).click();
  await s.page.waitForFunction(() => window.location.pathname === "/", null, { timeout: 30000 });
  await s.page.locator(".convs__live").waitFor({ timeout: 30000 });
}

async function goSettingsSecurity(s) {
  await s.page.locator('nav[aria-label="主导航"]').getByRole("button", { name: "设置" }).click();
  await s.page.locator(".settings__tabs").waitFor({ timeout: 30000 });
  await s.page.getByRole("tab", { name: "安全" }).click();
  await s.page.locator(".statuscard").waitFor({ timeout: 30000 });
}

async function checklistText(page, label) {
  const item = page.locator(".checklist__item", { hasText: label }).first();
  // 元素不存在时返回空串，让对应 check 记为 FAIL 而不是抛异常中断整轮门禁。
  if ((await item.count()) === 0) return "";
  return (await item.innerText()).replace(/\n/g, " ");
}

async function enterChat(s, roomId) {
  const item = s.page.locator(`[data-room-id="${roomId}"]`);
  await item.waitFor({ timeout: 120000 });
  await item.click();
  await s.page.locator(".chat__notice--live").waitFor({ timeout: 30000 });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const env = await loadTestEnv();
  const adminKey = env.INVITE_ADMIN_API_KEY;
  if (!adminKey) throw new Error(".env.test 缺少 INVITE_ADMIN_API_KEY");

  // ---- 服务端准备：两枚一次性邀请码 + 固定加密房间 + 读原始事件的成员 token ----
  const codeA = await createInvite(adminKey, "M3 security E2E A");
  const codeB = await createInvite(adminKey, "M3 security E2E B");
  check("M01", "生成两枚不同的一次性邀请码", codeA !== codeB);

  const roomsRes = await jsonRequest(INVITE_DIRECT, "GET", "/admin/v1/rooms", {
    headers: { "X-Admin-Key": adminKey },
  });
  const group = (roomsRes.json.rooms ?? []).find((r) => r.kind === "group");
  check("M02", "自举固定加密群聊房间存在", Boolean(group?.room_id), group?.room_id ?? "");
  if (!group) throw new Error("无群聊房间，无法继续");
  const roomId = group.room_id;

  // M0 F7：非房间成员读事件会 404。管理员是房间创建者（成员），但其客户端
  // 从未 initRustCrypto，因此拿不到 Megolm 会话密钥，只能读到密文。
  const adminLogin = await jsonRequest(SYNAPSE_DIRECT, "POST", "/_matrix/client/v3/login", {
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: env.SYNAPSE_ADMIN_USERNAME },
      password: env.SYNAPSE_ADMIN_PASSWORD,
    },
  });
  check("M03", "房间成员管理员登录成功（用于读取服务器侧原始事件）", Boolean(adminLogin.json.access_token));
  if (!adminLogin.json.access_token) throw new Error("管理员登录失败");
  const adminAuth = { Authorization: `Bearer ${adminLogin.json.access_token}` };

  const messagesPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`;
  async function readServerTimeline() {
    const r = await jsonRequest(SYNAPSE_DIRECT, "GET", messagesPath, { headers: adminAuth });
    return r.status === 200 ? (r.json.chunk ?? []) : null;
  }

  const suffix = randomBytes(3).toString("hex");
  const nameA = `m3_a_${suffix}`;
  const nameB = `m3_b_${suffix}`;
  const passA = randomBytes(18).toString("base64url");
  const passB = randomBytes(18).toString("base64url");
  const SECRET = `Aether-M3-recovery-secret-${suffix}`;
  let RECOVERY = "";

  try {
    // ================= 阶段 1：建立备份 + 发送加密消息 =================
    const [a, b] = await Promise.all([
      newSession("A-原始设备"),
      newSession("B-接收方"),
    ]);
    await Promise.all([
      connectViaInvite(a, { name: nameA, pass: passA, code: codeA }),
      connectViaInvite(b, { name: nameB, pass: passB, code: codeB }),
    ]);
    await Promise.all([waitConnected(a), waitConnected(b)]);
    check("M04", "A 用邀请码注册并连接真实服务器", true);
    check("M05", "B 用邀请码注册并连接真实服务器", true);
    check("M06", "A 浏览器真实加载 Rust Crypto WASM", a.wasm);
    check("M07", "B 浏览器真实加载 Rust Crypto WASM", b.wasm);

    const expectedUserIds = [`@${nameA}:${env.SYNAPSE_SERVER_NAME}`, `@${nameB}:${env.SYNAPSE_SERVER_NAME}`];
    const joinedPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`;
    const joinedMap = await waitFor(async () => {
      const r = await jsonRequest(SYNAPSE_DIRECT, "GET", joinedPath, { headers: adminAuth });
      if (r.status !== 200) return null;
      const ids = Object.keys(r.json.joined ?? {});
      return expectedUserIds.every((id) => ids.includes(id)) ? ids : null;
    }, 120000, "两个账号均自动加入加密群聊房间");
    check("M08", "邀请服务发 invite 且客户端自动 join 完成", joinedMap.length >= 2, `joined=${joinedMap.length}`);

    // A 在设置中心建立跨签名 + 4S + 服务器密钥备份
    await goSettingsSecurity(a);
    await a.page.getByRole("button", { name: "生成恢复密钥并备份" }).click();
    const keyEl = a.page.locator('[data-testid="recovery-key"]');
    await keyEl.waitFor({ timeout: 120000 });
    RECOVERY = (await keyEl.innerText()).trim();
    check("M09", "生成一次性恢复密钥（Matrix 4S base32 格式）",
      /^[A-Za-z2-7]{40,}$/.test(RECOVERY.replace(/\s/g, "")), `len=${RECOVERY.length}`);

    const storeA = await storageSnapshot(a.page);
    check("M10", "恢复密钥未写入 localStorage / sessionStorage",
      !storeA.local.includes(RECOVERY) && !storeA.session.includes(RECOVERY));

    const csCross = await checklistText(a.page, "跨签名");
    const cs4s = await checklistText(a.page, "安全存储");
    const csBackup = await checklistText(a.page, "密钥备份");
    check("M11", "安全中心显示跨签名已就绪", csCross.includes("已就绪"), csCross.slice(0, 80));
    check("M12", "安全中心显示 4S / SSSS 已就绪", cs4s.includes("已就绪"), cs4s.slice(0, 80));
    check("M13", "安全中心显示密钥备份中且版本存在",
      csBackup.includes("备份中") && !csBackup.includes("版本 无"), csBackup.slice(0, 100));

    await a.page.getByRole("button", { name: "我已抄写并妥善保存" }).click();
    check("M14", "确认抄写后恢复密钥从界面内存清除",
      (await a.page.locator('[data-testid="recovery-key"]').count()) === 0);

    await goConversations(a);
    await Promise.all([enterChat(a, roomId), enterChat(b, roomId)]);

    const before = await waitFor(readServerTimeline, 30000, "读取发送前服务器事件基线");
    const knownIds = new Set(before.map((e) => e.event_id));
    check("M15", "取得发送前服务器事件基线", before.length > 0, `count=${before.length}`);

    await a.page.locator(".composer__input").fill(SECRET);
    await a.page.getByRole("button", { name: "发送", exact: true }).click();
    await waitFor(
      async () => (await b.page.locator(".bubble__text", { hasText: SECRET }).count()) > 0,
      90000, "B 解密来自 A 的加密消息",
    );
    check("M16", "B 成功解密跨浏览器加密消息", true);

    const after = await waitFor(async () => {
      const chunk = await readServerTimeline();
      if (!chunk) return null;
      return chunk.some((e) => !knownIds.has(e.event_id)) ? chunk : null;
    }, 60000, "服务器侧出现本次发送产生的新事件");
    const fresh = after.filter((e) => !knownIds.has(e.event_id));
    check("M17", "本次发送在服务器侧只产生 m.room.encrypted 密文事件",
      fresh.some((e) => e.type === "m.room.encrypted") &&
      !fresh.some((e) => e.type === "m.room.message"),
      `new=${fresh.length} encrypted=${fresh.filter((e) => e.type === "m.room.encrypted").length}`);
    check("M18", "服务器侧本次新事件全部不含明文", !JSON.stringify(fresh).includes(SECRET));
    check("M19", "密文事件 content 不含 body 明文字段且算法为 Megolm",
      fresh.filter((e) => e.type === "m.room.encrypted").every(
        (e) => !("body" in (e.content ?? {})) && e.content?.algorithm === "m.megolm.v1.aes-sha2",
      ));

    // ================= 阶段 2：清除浏览器数据 → 无密钥登录 UTD 对照 =================
    // 关闭原有 browser 并新建全新实例：等价于用户清除浏览器数据（IndexedDB / localStorage 全空）。
    await a.browser.close();
    const a2 = await newSession("A2-清数据无密钥");
    const cleared = await a2.page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      idb: (await indexedDB.databases()).map((d) => d.name ?? ""),
    }));
    check("M20", "全新浏览器确实无历史加密存储（等价清数据）",
      cleared.local === 0 && cleared.session === 0 && cleared.idb.length === 0,
      `local=${cleared.local} session=${cleared.session} idb=${cleared.idb.length}`);

    await connectViaLogin(a2, { name: nameA, pass: passA });
    await waitConnected(a2);
    check("M21", "同一账号在新设备可正常登录（无恢复密钥）", a2.wasm);
    await enterChat(a2, roomId);
    await a2.page.locator(".bubble__text").first().waitFor({ timeout: 60000 });
    const textsNoKey = await a2.page.locator(".bubble__text").allInnerTexts();
    check("M22", "对照组：无恢复密钥时历史密文无法解密（UTD）且明文不泄露",
      textsNoKey.some((t) => t.includes("无法解密此消息")) && !textsNoKey.some((t) => t.includes(SECRET)),
      `bubbles=${textsNoKey.length} utd=${textsNoKey.filter((t) => t.includes("无法解密")).length}`);

    // ================= 阶段 3：错误恢复密钥 fail-closed + 登录页恢复 =================
    const a3 = await newSession("A3-登录页恢复");
    await connectViaLogin(a3, { name: nameA, pass: passA, recovery: "NotARecoveryKey000000000000000000000000000000" });
    await waitFor(
      async () => (await a3.page.locator(".auth__notice").count()) > 0,
      60000, "错误恢复密钥被明确拒绝",
    );
    const failText = await a3.page.locator(".auth__notice").first().innerText();
    check("M23", "错误恢复密钥被拒绝且给出明确原因（fail-closed）",
      failText.includes("恢复密钥") || failText.includes("无效") || failText.includes("失败"),
      failText.slice(0, 100));
    check("M24", "恢复失败时停留在登录页、不静默回退演示假数据",
      new URL(a3.page.url()).pathname === "/login" && (await a3.page.locator(".convs__list").count()) === 0);

    await a3.page.getByPlaceholder(RECOVERY_PLACEHOLDER).fill(RECOVERY);
    await a3.page.getByRole("button", { name: "连接真实服务器" }).click();
    await waitConnected(a3);
    check("M25", "登录页携带正确恢复密钥可完成恢复并进入会话列表", a3.wasm);

    await goSettingsSecurity(a3);
    const restoredText = await checklistText(a3.page, "本次会话恢复");
    check("M26", "安全中心显示本次会话已从备份导入会话密钥",
      restoredText.includes("已恢复") && /导入\s*[1-9]\d*\s*条/.test(restoredText), restoredText.slice(0, 100));

    const storeA3 = await storageSnapshot(a3.page);
    const secretDump = `${storeA3.local}\n${storeA3.session}`;
    check("M27", "恢复密钥 / 口令 / access_token 均未落盘",
      !secretDump.includes(RECOVERY) && !secretDump.includes(passA) && !/access_token/i.test(secretDump));

    await goConversations(a3);
    await enterChat(a3, roomId);
    const textsLoginRestore = await waitFor(
      async () => {
        const t = await a3.page.locator(".bubble__text").allInnerTexts();
        return t.some((x) => x.includes(SECRET)) ? t : null;
      },
      90000, "登录页恢复后历史密文被解密为明文",
    );
    check("M28", "登录页恢复：历史加密消息重新解密为明文",
      textsLoginRestore.some((t) => t.includes(SECRET)), `bubbles=${textsLoginRestore.length}`);

    // ================= 阶段 4：设置页导入恢复密钥 =================
    const a4 = await newSession("A4-设置页恢复");
    await connectViaLogin(a4, { name: nameA, pass: passA });
    await waitConnected(a4);
    await goSettingsSecurity(a4);
    await a4.page.locator('input[aria-label="恢复密钥"]').fill(RECOVERY);
    await a4.page.getByRole("button", { name: "恢复历史消息" }).click();
    const notice = await waitFor(
      async () => {
        const n = await a4.page.locator('.panel__note[role="status"]').allInnerTexts();
        return n.find((x) => x.includes("已从密钥备份恢复"));
      },
      120000, "设置页恢复完成提示",
    );
    check("M29", "设置页导入恢复密钥后明确报告已导入会话密钥",
      /已从密钥备份恢复\s*[1-9]\d*\s*条/.test(notice) || /恢复\s*[1-9]\d*\s*条/.test(notice),
      notice.slice(0, 100));

    const restoredText4 = await checklistText(a4.page, "本次会话恢复");
    check("M30", "设置页恢复后安全中心显示「已恢复」", restoredText4.includes("已恢复"), restoredText4.slice(0, 100));

    await goConversations(a4);
    await enterChat(a4, roomId);
    const textsSettingsRestore = await waitFor(
      async () => {
        const t = await a4.page.locator(".bubble__text").allInnerTexts();
        return t.some((x) => x.includes(SECRET)) ? t : null;
      },
      90000, "设置页恢复后历史密文被解密为明文",
    );
    check("M31", "设置页恢复：历史加密消息重新解密为明文",
      textsSettingsRestore.some((t) => t.includes(SECRET)), `bubbles=${textsSettingsRestore.length}`);

    // ================= 阶段 5：真实设备列表 + 服务器侧最终证明 + 运行期健康 =================
    // 用聊天页自带的返回按钮做 SPA 内导航：整页 goBack/reload 会丢失仅存于内存的
    // live 凭据并被刷新守卫拦截（M2-R D1），不是真实用户动作。
    await a4.page.getByRole("button", { name: "返回会话列表" }).click();
    await a4.page.locator(".convs__live").waitFor({ timeout: 30000 });
    await a4.page.locator('nav[aria-label="主导航"]').getByRole("button", { name: "设置" }).click();
    await a4.page.locator(".settings__tabs").waitFor({ timeout: 30000 });
    await a4.page.getByRole("tab", { name: "设备" }).click();
    const deviceCount = await waitFor(
      async () => {
        const n = await a4.page.locator(".device__text").count();
        return n >= 2 ? n : null;
      },
      60000, "真实设备列表出现多个设备",
    );
    check("M32", "设备页列出真实 Matrix 设备（清数据产生的新设备可见）",
      deviceCount >= 2, `devices=${deviceCount}`);

    const finalTimeline = await waitFor(readServerTimeline, 30000, "读取最终服务器时间线");
    check("M33", "服务器侧全时间线始终不含明文", !JSON.stringify(finalTimeline).includes(SECRET));
    check("M34", "服务器侧无任何会话密钥泄露", !JSON.stringify(finalTimeline).includes("session_key"));

    const allErrors = sessions.flatMap((s) => s.errors);
    check("M35", "所有浏览器实例无未捕获异常", allErrors.length === 0, allErrors.slice(0, 2).join(" | "));
    const allConsole = sessions.flatMap((s) => s.consoleErrors).join("\n");
    check("M36", "console 不含恢复密钥 / 口令 / access_token",
      !allConsole.includes(RECOVERY) && !allConsole.includes(passA) && !/access_token/i.test(allConsole));

    await a3.page.screenshot({ path: path.join(OUT_DIR, "A3-restored-chat.png") });
    await b.page.screenshot({ path: path.join(OUT_DIR, "B-receiver.png") });
  } finally {
    for (const br of browsers) {
      try { await br.close(); } catch { /* 已关闭的实例忽略 */ }
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  await writeFile(
    path.join(OUT_DIR, "m3-security.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE,
        roomId,
        total: checks.length,
        passed,
        failed,
        checks,
        sessions: sessions.map((s) => ({
          role: s.role,
          wasm: s.wasm,
          errors: s.errors,
          consoleErrors: s.consoleErrors,
          http4xx: s.http4xx,
        })),
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
  console.error("M3 安全验收执行失败：", err);
  process.exitCode = 1;
});
