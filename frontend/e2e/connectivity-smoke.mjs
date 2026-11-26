import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = (process.argv[2] ?? process.env.AETHER_CONNECTIVITY_URL ?? "http://127.0.0.1:9400").replace(/\/$/, "");
const browserPath = process.env.AETHER_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const screenshotPath = path.resolve("../.tmp-gen/cloudflare-connectivity-page.png");
const browser = await chromium.launch({ executablePath: browserPath, headless: true });

try {
  const page = await browser.newPage();
  const home = await page.goto(`${base}/`, { waitUntil: "load" });
  assert.equal(home?.status(), 200, "homepage");
  const manifest = await page.request.get(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status(), 200, "PWA manifest");
  const serviceWorker = await page.request.get(`${base}/sw.js`);
  assert.equal(serviceWorker.status(), 200, "PWA service worker");

  await page.goto(`${base}/network-test`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "网络连通性测试" }).waitFor();
  await page.getByRole("button", { name: "开始测试" }).click();
  await page.waitForFunction(() => {
    const results = Array.from(document.querySelectorAll(".network-test__result span"));
    return results.length === 2 && results.every((item) => item.textContent?.startsWith("通过"));
  }, undefined, { timeout: 30_000 });
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    return (await navigator.serviceWorker.getRegistrations()).length > 0;
  }, undefined, { timeout: 10_000 });
  const results = await page.locator(".network-test__result span").allTextContents();
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({ base, home: home?.status(), manifest: manifest.status(), serviceWorker: serviceWorker.status(), http: results[0], websocket: results[1], screenshotPath }, null, 2));
} finally {
  await browser.close();
}
