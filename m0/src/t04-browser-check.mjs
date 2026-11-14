// T04 runner: bundle browser payload with esbuild, serve locally, drive the installed
// Chrome via playwright-core (channel: "chrome", no browser download), wait for the
// in-page verification to finish, collect results + console errors.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, copyFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { makeChecker, report } from "./lib.mjs";

const checks = [];
const check = makeChecker(checks);

// 1. bundle
execFileSync(process.execPath, [
  "node_modules/esbuild/bin/esbuild", "browser/main.js",
  "--bundle", "--format=esm", "--platform=browser",
  "--outfile=browser/bundle.js",
  '--define:process.env.NODE_ENV="production"',
  "--log-level=warning",
], { stdio: "inherit" });
copyFileSync("node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm", "browser/matrix_sdk_crypto_wasm_bg.wasm");
check("esbuild bundle + wasm asset prepared", true);

// 2. serve
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const notFound = [];
const server = createServer((req, res) => {
  const p = req.url.split("?")[0];
  const f = "browser" + (p === "/" ? "/index.html" : p);
  try {
    const d = readFileSync(f);
    res.writeHead(200, { "Content-Type": mime[f.slice(f.lastIndexOf("."))] || "application/octet-stream" });
    res.end(d);
  } catch { notFound.push(p); res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8091, "127.0.0.1", r));

// 3. drive installed Chrome
const consoleErrors = [];
let parsed = null;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
  await page.goto("http://127.0.0.1:8091/index.html", { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => window.__m0done === true, null, { timeout: 90_000 });
  parsed = await page.evaluate(() => JSON.parse(document.getElementById("results").textContent));
  const ua = await page.evaluate(() => navigator.userAgent);
  check("Chrome user agent", /Chrome\/\d+/.test(ua), ua.match(/Chrome\/[\d.]+/)?.[0]);
} finally {
  await browser.close();
  server.close();
}
mkdirSync("results", { recursive: true });
writeFileSync("results/t04-console-errors.json", JSON.stringify({ consoleErrors, notFound }, null, 2), "utf8");
const realErrors = consoleErrors.filter((e) => !e.startsWith("Failed to load resource"));
check("no page/console errors (resource 404s tracked separately)", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));
check("no 404 resources (favicon excluded)", notFound.filter((p) => p !== "/favicon.ico").length === 0, notFound.join(","));
if (parsed) {
  check("browser payload completed", parsed.done === true);
  for (const c of parsed.checks) check(`[browser] ${c.name}`, c.ok, c.detail);
} else {
  check("browser payload completed", false, "no results parsed");
}
report("t04-browser-check", checks);