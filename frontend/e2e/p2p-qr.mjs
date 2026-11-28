import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.AETHER_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const a = await browser.newPage();
const b = await browser.newPage();
const errors = [];
for (const page of [a, b]) page.on("pageerror", (error) => errors.push(error.message));

async function createDevice(page, name) {
  await page.goto("http://127.0.0.1:5173/");
  await page.getByPlaceholder("设备名称").fill(name);
  await page.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await page.getByRole("button", { name: "创建设备" }).click();
  await page.getByRole("button", { name: "联系人", exact: true }).click();
  await page.getByRole("button", { name: "展开" }).click();
  await page.getByLabel("STUN 地址，每行一个").fill("");
}

async function feedQrToCamera(page, imageDataUrl) {
  await page.evaluate(async (src) => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    const paint = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    paint(); window.setInterval(paint, 100);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
  }, imageDataUrl);
}

try {
  await createDevice(a, "Alice");
  await createDevice(b, "Bob");
  await a.getByRole("button", { name: "设置", exact: true }).click();
  const offerImage = a.getByAltText("本机添加设备二维码");
  await offerImage.waitFor({ timeout: 25000 });
  const offer = await offerImage.getAttribute("data-code");
  assert.ok(offer?.startsWith("aether-qr1:"));
  await feedQrToCamera(b, await offerImage.getAttribute("src"));
  await b.getByRole("button", { name: "扫一扫" }).click();
  const answerImage = b.getByAltText("本机应答二维码");
  await answerImage.waitFor({ timeout: 25000 });
  const answer = await answerImage.getAttribute("data-code");
  assert.ok(answer?.startsWith("aether-qr1:"));
  await feedQrToCamera(a, await answerImage.getAttribute("src"));
  await a.getByRole("button", { name: "扫描对方应答" }).click();
  await Promise.all([
    a.getByRole("heading", { name: "私聊 · Bob" }).waitFor({ timeout: 20000 }),
    b.getByRole("heading", { name: "私聊 · Alice" }).waitFor({ timeout: 20000 }),
  ]).catch(async (error) => { console.error("A:", await a.locator("body").innerText(), "B:", await b.locator("body").innerText()); throw error; });
  await a.getByPlaceholder("输入加密文字消息").fill("二维码自动配对成功");
  await a.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("二维码自动配对成功", { exact: true }).waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  console.log("PASS: two QR scans with synthetic camera establish authenticated direct chat without manual connection codes");
} finally { await browser.close(); }
