import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.AETHER_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const a = await browser.newPage();
const b = await browser.newPage();
const c = await browser.newPage();
const failures = [];
for (const page of [a, b, c]) page.on("pageerror", (error) => failures.push(error.message));
for (const page of [a, b, c]) await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const output = context.createMediaStreamDestination();
    oscillator.connect(output); oscillator.start();
    return output.stream;
  };
});
const tab = (page, name) => page.getByRole("button", { name, exact: true }).click();
async function makeDevice(page, name) {
  await page.goto("http://127.0.0.1:5173/");
  await page.getByPlaceholder("设备名称").fill(name);
  await page.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await page.getByRole("button", { name: "创建设备" }).click();
  await tab(page, "设置");
  await page.getByText("我的设备身份与备份").click();
  await page.getByText("完整 SHA-256 身份指纹").waitFor();
  assert.match(await page.locator(".fingerprint").last().textContent(), /^[0-9a-f]{64}$/);
  await tab(page, "联系人");
  await page.getByRole("button", { name: "展开" }).click();
  await page.getByLabel("STUN 地址，每行一个").fill("");
}

try {
  await makeDevice(a, "Alice");
  await makeDevice(b, "Bob");
  await a.getByRole("button", { name: "生成发起码" }).click();
  await a.getByLabel("本机连接码").waitFor({ timeout: 25000 }).catch(async (error) => { console.error(await a.locator("body").innerText()); throw error; });
  await b.getByPlaceholder("粘贴收到的发起码或应答码").fill(await a.getByLabel("本机连接码").inputValue());
  await b.getByRole("button", { name: "接收发起码并生成应答" }).click();
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(await b.getByLabel("本机连接码").inputValue());
  await a.getByRole("button", { name: "完成应答" }).click();
  await Promise.all([a.locator(".sas").waitFor({ timeout: 20000 }), b.locator(".sas").waitFor({ timeout: 20000 })]);
  const sasA = await a.locator(".sas").textContent();
  const sasB = await b.locator(".sas").textContent();
  assert.equal(sasA, sasB);
  assert.equal(await a.getByRole("button", { name: "发起私聊" }).count(), 0);
  await a.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await b.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "发起私聊" }).click();
  await b.getByRole("button", { name: "消息", exact: true }).click();
  await b.getByRole("button", { name: /私聊 · Bob|私聊 · Alice/ }).waitFor({ timeout: 10000 });
  await a.getByPlaceholder("输入加密文字消息").fill("仅发给 Bob 的私聊");
  await a.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("仅发给 Bob 的私聊", { exact: true }).waitFor({ timeout: 10000 });
  await a.locator(".message").filter({ hasText: "仅发给 Bob 的私聊" }).getByText("已读", { exact: false }).waitFor({ timeout: 10000 });
  await a.getByRole("button", { name: "语音通话" }).click();
  await b.getByRole("button", { name: "接听" }).waitFor({ timeout: 10000 });
  await b.getByRole("button", { name: "接听" }).click();
  await Promise.all([a.getByText("通话中", { exact: true }).waitFor({ timeout: 20000 }), b.getByText("通话中", { exact: true }).waitFor({ timeout: 20000 })]);
  await a.getByRole("button", { name: "挂断" }).click();
  await b.getByRole("button", { name: "语音通话" }).waitFor({ timeout: 10000 });
  await b.reload();
  await b.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await b.getByRole("button", { name: "解锁", exact: true }).click();
  await tab(a, "联系人");
  await tab(b, "联系人");
  await b.getByRole("button", { name: "展开" }).click();
  await a.getByRole("button", { name: "生成发起码" }).click();
  await b.getByPlaceholder("粘贴收到的发起码或应答码").fill(await a.getByLabel("本机连接码").inputValue());
  await b.getByRole("button", { name: "接收发起码并生成应答" }).click();
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(await b.getByLabel("本机连接码").inputValue());
  await a.getByRole("button", { name: "完成应答" }).click();
  await Promise.all([a.locator(".peer").filter({ hasText: "Bob" }).getByText("已验证并信任", { exact: false }).waitFor({ timeout: 20000 }), b.locator(".peer").filter({ hasText: "Alice" }).getByText("已验证并信任", { exact: false }).waitFor({ timeout: 20000 })]);
  assert.equal(await b.getByRole("button", { name: "验证码相同，确认信任" }).count(), 0);
  await makeDevice(c, "Bob");
  await a.getByRole("button", { name: "生成发起码" }).click();
  await c.getByPlaceholder("粘贴收到的发起码或应答码").fill(await a.getByLabel("本机连接码").inputValue());
  await c.getByRole("button", { name: "接收发起码并生成应答" }).click();
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(await c.getByLabel("本机连接码").inputValue());
  await a.getByRole("button", { name: "完成应答" }).click();
  await a.getByRole("alert").getByText("同名设备身份发生变化", { exact: false }).waitFor({ timeout: 10000 });
  assert.deepEqual(failures, []);
  console.log("PASS: signed session SAS, trusted direct chat, read receipt, audio-call negotiation, automatic re-authentication, and changed-key rejection");
} finally {
  await browser.close();
}
