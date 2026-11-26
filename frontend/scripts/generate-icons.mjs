import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const executablePath = process.env.AETHER_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const source = await readFile(new URL("../public/icons/icon.svg", import.meta.url));
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const data = `data:image/svg+xml;base64,${source.toString("base64")}`;
  for (const size of [180, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0"><img src="${data}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.locator("img").screenshot({ path: fileURLToPath(new URL(`../public/icons/icon-${size}.png`, import.meta.url)) });
  }
} finally { await browser.close(); }
