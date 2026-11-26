/**
 * Aether M2 演示版浏览器烟测（真实 Chrome + playwright-core）
 *
 * 目的：证明 demo 界面确实可交互，且只在本机浏览器内运行 —— 不连 Synapse、
 * 不请求 /_matrix/ 或 /invite-api/、不产生任何密钥。
 *
 * 前置：先在另一个终端启动 `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`
 * 运行：npm run smoke
 * 覆盖：AETHER_SMOKE_URL / AETHER_CHROME_PATH 环境变量
 *
 * 这不是 E2EE 验收测试。真实链路的验收分别在 `e2e/live-e2ee.mjs`（M2-R，
 * 双浏览器密文证明）与 `e2e/m3-recovery.mjs`（M3，密钥备份/恢复）中完成。
 * demo 模式始终不联网、不产生密钥；本套件负责守住这条边界。
 *
 * 2026-11-15 更新：M2-R / M3 完成后，demo 安全中心不再列出「MatrixService /
 * 密钥备份 / 跨签名验证 待实现」这类已失效条目，故 S27 断言改为验证
 * 「清单只列真实未完成项，且不谎称 M3 待实现」。
 */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? process.env.AETHER_SMOKE_URL ?? "http://127.0.0.1:4173";
const CHROME =
  process.env.AETHER_CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = path.resolve(HERE, "../../.tmp-gen/m2-demo");

const checks = [];
const pageErrors = [];
const consoleErrors = [];
const requests = [];

function check(id, label, ok, detail = "") {
  checks.push({ id, label, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? `  [${detail}]` : ""}`);
}

async function step(id, label, fn) {
  try {
    const result = await fn();
    if (result === undefined || typeof result === "boolean") {
      check(id, label, result === undefined ? true : result);
      return;
    }
    check(id, label, Boolean(result.ok), String(result.detail ?? ""));
  } catch (err) {
    check(id, label, false, err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // ---- HTTP 层：静态资源、PWA 产物、SPA 深链 ----
  const indexRes = await fetch(`${BASE}/`);
  check("S01", "首页 HTTP 200", indexRes.status === 200, String(indexRes.status));

  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await manifestRes.json();
  check(
    "S02",
    "PWA manifest 可访问且名称正确",
    manifestRes.status === 200 && manifest.name === "Aether" && manifest.display === "standalone",
    `name=${manifest.name} display=${manifest.display}`,
  );

  const swRes = await fetch(`${BASE}/sw.js`);
  check("S03", "Service Worker 产物可访问", swRes.status === 200, String(swRes.status));

  const deepRes = await fetch(`${BASE}/chat/any-room-id`);
  check("S04", "聊天深链 SPA fallback 200", deepRes.status === 200, String(deepRes.status));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  context.on("request", (req) => requests.push(req.url()));
  const page = await context.newPage();
  // 本地静态站点，任何交互都不该等待 30s；短超时能让遮挡/死链缺陷立刻暴露。
  page.setDefaultTimeout(10000);
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.locator(".convs h1").waitFor({ timeout: 15000 });

    // ---- 首页与演示标识 ----
    await step("S05", "首页会话列表渲染", async () => {
      const h1 = await page.locator(".convs h1").innerText();
      const count = await page.locator(".convs__list .item").count();
      return { ok: h1.includes("消息") && count >= 4, detail: `h1=${h1} items=${count}` };
    });

    await step("S06", "演示数据包含群聊与私聊", async () => {
      const body = await page.locator("body").innerText();
      return {
        ok: body.includes("Aether 小队") && body.includes("林澈") && body.includes("群聊"),
        detail: "Aether 小队 / 林澈 / 群聊 标签均出现",
      };
    });

    await step("S07", "演示模式徽章常驻可见", async () =>
      (await page.getByRole("button", { name: /演示模式/ }).count()) > 0,
    );

    await step("S08", "徽章说明明确否认端到端加密", async () => {
      await page.getByRole("button", { name: /演示模式/ }).click();
      const panel = await page.locator(".demo__panel").innerText();
      await page.getByRole("button", { name: /演示模式/ }).click();
      return {
        ok: panel.includes("没有端到端加密") && panel.includes("不是真实加密通讯"),
        detail: "安全声明展开正常",
      };
    });

    await step("S09", "底部导航三个入口存在", async () => {
      const n = await page.locator(".tabbar__item").count();
      return { ok: n === 3, detail: `tabs=${n}` };
    });

    await step("S10", "深色/浅色主题可切换", async () => {
      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.getByRole("button", { name: "切换到浅色主题" }).click();
      const light = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.getByRole("button", { name: "切换到深色主题" }).click();
      const back = await page.evaluate(() => document.documentElement.dataset.theme);
      return { ok: before === "dark" && light === "light" && back === "dark", detail: `${before}→${light}→${back}` };
    });

    // ---- 聊天页 ----
    await step("S11", "点击会话进入聊天页", async () => {
      await page.locator(".convs__list .item").first().click();
      await page.locator(".chat__head").waitFor();
      return { ok: page.url().includes("/chat/"), detail: page.url() };
    });

    await step("S12", "聊天页明确标注 E2EE 未接线", async () => {
      const notice = await page.locator(".chat__notice").innerText();
      return { ok: notice.includes("E2EE 未接线") && notice.includes("未加密"), detail: notice.replace(/\n/g, " ") };
    });

    await step("S13", "输入框提示消息不出浏览器", async () => {
      const note = await page.locator(".composer__note").innerText();
      return { ok: note.includes("不会离开此浏览器"), detail: note };
    });

    const sentText = `烟测消息-${Date.now()}`;
    await step("S14", "发送文本后消息气泡出现", async () => {
      await page.locator(".composer__input").fill(sentText);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.locator(".bubble__text", { hasText: sentText }).waitFor();
      return { ok: true, detail: sentText };
    });

    const myRow = page.locator(".row--mine", { hasText: sentText });
    await step("S15", "发送状态流转到已读", async () => {
      await page.waitForFunction(
        (text) => {
          const rows = [...document.querySelectorAll(".row--mine")];
          const row = rows.find((r) => r.textContent?.includes(text));
          return row?.querySelector(".meta__status")?.textContent?.includes("已读") ?? false;
        },
        sentText,
        { timeout: 6000 },
      );
      return { ok: true, detail: "sending → sent → delivered → read" };
    });

    await step("S16", "收到模拟自动回复", async () => {
      // 第一条消息的自动回复在等待「已读」的 1.5s 内已经到达，
      // 因此这里另发一条来触发新的回复，验证状态层确实会调度模拟回信。
      const before = await page.locator(".chat__scroll .row").count();
      await page.locator(".composer__input").fill(`回复触发-${Date.now()}`);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.waitForFunction(
        (n) => document.querySelectorAll(".chat__scroll .row").length >= n + 2,
        before,
        { timeout: 6000 },
      );
      return { ok: true, detail: `rows ${before} → ${await page.locator(".chat__scroll .row").count()}` };
    });

    await step("S17", "文件附件以占位消息插入", async () => {
      await page.locator(".composer__tools button", { hasText: "文件" }).click();
      await page.getByText("示例文档.pdf").last().waitFor();
      return { ok: true };
    });

    await step("S18", "语音消息以波形占位插入", async () => {
      await page.locator(".composer__tools button", { hasText: "语音" }).click();
      const n = await page.locator(".attach--voice").count();
      return { ok: n >= 1, detail: `voice bubbles=${n}` };
    });

    await step("S19", "回复操作生成引用预览", async () => {
      await myRow.hover();
      await myRow.locator(".actions button", { hasText: "回复" }).click();
      const reply = await page.locator(".composer__reply").innerText();
      return { ok: reply.includes("回复") && reply.includes(sentText), detail: reply.replace(/\n/g, " ") };
    });

    await step("S20", "取消回复后预览消失", async () => {
      await page.getByRole("button", { name: "取消回复" }).click();
      return (await page.locator(".composer__reply").count()) === 0;
    });

    await step("S21", "表情反应可添加", async () => {
      await myRow.hover();
      await myRow.locator(".actions button", { hasText: "✓" }).click();
      const reaction = await myRow.locator(".reactions button").innerText();
      return { ok: reaction.includes("✓"), detail: reaction.trim() };
    });

    await step("S22", "撤回自己的消息显示撤回态", async () => {
      // 撤回后正文被清空，hasText(sentText) 的动态 locator 会失效，
      // 故先记录撤回态数量，点击后用「数量 +1 且文案正确」判定。
      const before = await page.locator(".bubble--revoked").count();
      await myRow.hover();
      await myRow.locator(".actions button", { hasText: "撤回" }).click();
      const revoked = page.locator(".bubble--revoked");
      const after = await revoked.count();
      const text = await revoked.last().innerText();
      return { ok: after === before + 1 && text.includes("此消息已撤回"), detail: `revoked ${before} → ${after}` };
    });

    await step("S23", "返回按钮回到会话列表", async () => {
      await page.getByRole("button", { name: "返回会话列表" }).click();
      await page.locator(".convs h1").waitFor();
      return { ok: !page.url().includes("/chat/"), detail: page.url() };
    });

    // ---- 搜索 ----
    await step("S24", "搜索页关键词命中结果", async () => {
      await page.locator(".tabbar__item", { hasText: "搜索" }).click();
      await page.getByRole("searchbox", { name: "搜索消息" }).fill("加密");
      const countText = await page.locator(".search__count").innerText();
      const results = await page.locator(".search__results li").count();
      return { ok: results > 0, detail: `${countText}, rows=${results}` };
    });

    await step("S25", "点击搜索结果跳回对应聊天", async () => {
      await page.locator(".search__results li button").first().click();
      await page.locator(".chat__head").waitFor();
      return { ok: page.url().includes("/chat/"), detail: page.url() };
    });

    // ---- 设置 ----
    await step("S26", "安全中心明示端到端加密未接线", async () => {
      await page.goto(`${BASE}/settings`, { waitUntil: "load" });
      await page.locator(".settings__tabs").waitFor();
      await page.getByRole("tab", { name: "安全" }).click();
      const text = await page.locator(".statuscard").innerText();
      return { ok: text.includes("端到端加密：未接线") && text.includes("Rust Crypto WASM"), detail: text.replace(/\n/g, " ") };
    });

    await step("S27", "清单只列真实未完成项，不谎称 M3 待实现", async () => {
      const items = page.locator(".checklist__item");
      const n = await items.count();
      const text = (await page.locator(".checklist").innerText()).replace(/\n/g, " ");
      // M2-R / M3 已完成：不得再出现「MatrixService 待实现」「密钥备份 待实现」
      // 「跨签名设备验证 待实现」这类过时表述；M4/M6 未实现则必须如实保留。
      const stale = /MatrixService[^。]*待实现|密钥备份[^。]*待实现|跨签名设备验证[^。]*待实现|双浏览器 E2EE 回归/.test(text);
      const keepsBoundary = text.includes("演示模式不启用") && /M4|M6/.test(text);
      return {
        ok: n >= 2 && !stale && keepsBoundary,
        detail: `items=${n} stale=${stale} boundary=${keepsBoundary}`,
      };
    });

    await step("S28", "设备页可执行演示验证动作", async () => {
      await page.getByRole("tab", { name: "设备" }).click();
      const verify = page.locator(".device__verify").first();
      if ((await verify.count()) === 0) return { ok: true, detail: "无未验证设备，跳过" };
      await verify.click();
      return { ok: (await page.locator(".device__ok").count()) >= 1 };
    });

    await step("S29", "通用页开关可切换", async () => {
      await page.getByRole("tab", { name: "通用" }).click();
      const sw = page.getByRole("switch").first();
      const before = await sw.getAttribute("aria-checked");
      await sw.click();
      const after = await sw.getAttribute("aria-checked");
      return { ok: before !== after, detail: `${before} → ${after}` };
    });

    // ---- 登录 / 邀请码注册演示 ----
    await step("S30", "登录页邀请码校验提示生效", async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "load" });
      await page.getByRole("tab", { name: "邀请码注册" }).click();
      await page.getByPlaceholder("xxxxxxxx-xxxxxxxxxxxxxxxxxxxx").fill("abc");
      await page.getByRole("button", { name: "进入演示" }).click();
      const notice = await page.locator(".auth__notice").innerText();
      return { ok: notice.includes("6 位以上"), detail: notice };
    });

    await step("S31", "有效长度邀请码可进入演示首页", async () => {
      await page.getByPlaceholder("xxxxxxxx-xxxxxxxxxxxxxxxxxxxx").fill("demo-invite-code-2026");
      await page.getByRole("button", { name: "进入演示" }).click();
      await page.locator(".convs h1").waitFor();
      return { ok: new URL(page.url()).pathname === "/", detail: page.url() };
    });

    await step("S31b", "连通性验证期间关闭旧 Matrix 登录入口", async () => {
      await page.goto(`${BASE}/login`, { waitUntil: "load" });
      const liveTab = page.getByRole("tab", { name: "真实通讯暂未开放" });
      return {
        ok: await liveTab.isDisabled() &&
          await page.getByRole("link", { name: "在 Element 网页版注册" }).count() === 0 &&
          await page.getByRole("link", { name: "测试当前网络连通性" }).count() === 1,
      };
    });

    await step("S31c", "同源网络测试页面可从登录页打开", async () => {
      const before = requests.length;
      await page.getByRole("link", { name: "测试当前网络连通性" }).click();
      await page.getByRole("heading", { name: "网络连通性测试" }).waitFor();
      const newRequests = requests.slice(before);
      const external = newRequests.filter((u) => !u.startsWith(new URL(BASE).origin));
      return { ok: new URL(page.url()).pathname === "/network-test" && external.length === 0, detail: page.url() };
    });

    // ---- PWA 注册 ----
    await step("S32", "Service Worker 已注册", async () => {
      await page.waitForFunction(
        async () => {
          if (!("serviceWorker" in navigator)) return false;
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.length >= 1;
        },
        undefined,
        { timeout: 8000 },
      );
      const n = await page.evaluate(async () =>
        ("serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : -1),
      );
      return { ok: n >= 1, detail: `registrations=${n}` };
    });

    // ---- 安全红线：demo 不得联网、不得触碰真实 API ----
    await step("S33", "全程未请求 Matrix / 邀请服务 API", async () => {
      const bad = requests.filter((u) => /\/_matrix\/|\/invite-api\/|\/_synapse\//.test(u));
      return { ok: bad.length === 0, detail: `requests=${requests.length}, forbidden=${bad.length}` };
    });

    await step("S34", "全程未请求任何外部域名", async () => {
      const origin = new URL(BASE).origin;
      const external = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
      return { ok: external.length === 0, detail: `external=${external.length}` };
    });

    await step("S35", "无未捕获页面异常", async () =>
      ({ ok: pageErrors.length === 0, detail: pageErrors.slice(0, 3).join(" | ") }),
    );

    await step("S36", "无 console error", async () =>
      ({ ok: consoleErrors.length === 0, detail: consoleErrors.slice(0, 3).join(" | ") }),
    );

    // ---- 截图证据 ----
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.locator(".convs__list").waitFor();
    await page.screenshot({ path: path.join(OUT_DIR, "01-conversations.png") });
    await page.locator(".convs__list .item").first().click();
    await page.locator(".chat__scroll").waitFor();
    await page.screenshot({ path: path.join(OUT_DIR, "02-chat.png") });
    await page.goto(`${BASE}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "安全" }).click();
    await page.screenshot({ path: path.join(OUT_DIR, "03-security.png") });
  } finally {
    await context.close();
    await browser.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    chrome: CHROME,
    viewport: "390x844 @2x (iPhone-first)",
    total: checks.length,
    passed,
    failed,
    pageErrors,
    consoleErrors,
    requestCount: requests.length,
    checks,
  };
  await writeFile(path.join(OUT_DIR, "demo-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n结果：${passed}/${checks.length} 通过，${failed} 失败`);
  console.log(`证据：${OUT_DIR}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("烟测执行失败：", err);
  process.exitCode = 1;
});
