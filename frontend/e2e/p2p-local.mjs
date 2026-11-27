import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const executablePath = process.env.AETHER_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const contextA = await browser.newContext();
const contextB = await browser.newContext();
const contextC = await browser.newContext({ acceptDownloads: true });
const contextD = await browser.newContext();
for (const context of [contextA, contextB, contextC, contextD]) {
  await context.addInitScript(() => {
    window.__aetherFrames = [];
    const original = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (typeof data === "string") window.__aetherFrames.push(data);
      return original.call(this, data);
    };
  });
}
const a = await contextA.newPage();
const b = await contextB.newPage();
const c = await contextC.newPage();
const d = await contextD.newPage();
const failures = [];
for (const page of [a, b, c, d]) page.on("pageerror", (error) => failures.push(error.message));

try {
  await Promise.all([a.goto("http://127.0.0.1:5173/"), b.goto("http://127.0.0.1:5173/")]);
  for (const [page, name] of [[a, "Alice"], [b, "Bob"]]) {
    await page.getByPlaceholder("设备名称").fill(name);
    await page.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
    await page.getByRole("button", { name: "创建设备" }).click();
    await page.getByRole("button", { name: "联系人", exact: true }).waitFor();
    await page.getByRole("button", { name: "联系人", exact: true }).click();
    await page.getByRole("button", { name: "展开" }).click();
  }
  await a.getByRole("button", { name: "消息", exact: true }).click();
  await a.getByRole("button", { name: "创建群聊" }).click();
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.getByRole("button", { name: "生成发起码" }).click();
  const offer = await a.getByLabel("本机连接码").inputValue();
  assert.ok(offer.startsWith("aether1:"));
  await b.getByPlaceholder("粘贴收到的发起码或应答码").fill(offer);
  await b.getByRole("button", { name: "接收发起码并生成应答" }).click();
  const answer = await b.getByLabel("本机连接码").inputValue();
  assert.ok(answer.startsWith("aether1:"));
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(answer);
  await a.getByRole("button", { name: "完成应答" }).click();
  await Promise.all([a.locator(".sas").waitFor({ timeout: 20000 }), b.locator(".sas").waitFor({ timeout: 20000 })]);
  for (const page of [a, b]) await page.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "邀请加入当前群聊" }).click();
  for (const page of [a, b, c, d]) { if (await page.getByRole("button", { name: "消息", exact: true }).count()) await page.getByRole("button", { name: "消息", exact: true }).click(); }
  await b.getByText("群聊 · 四人聊天室 · 2/4").waitFor({ timeout: 10000 });
  await a.getByPlaceholder("输入加密文字消息").fill("真实 P2P 加密消息测试");
  await a.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("真实 P2P 加密消息测试", { exact: true }).waitFor({ timeout: 10000 });
  await a.getByText("2 份副本").waitFor({ timeout: 10000 });
  await c.goto("http://127.0.0.1:5173/");
  await c.getByPlaceholder("设备名称").fill("Carol");
  await c.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await c.getByRole("button", { name: "创建设备" }).click();
  await c.getByRole("button", { name: "联系人", exact: true }).click();
  await c.getByRole("button", { name: "展开" }).click();
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.getByRole("button", { name: "生成发起码" }).click();
  await a.getByLabel("本机连接码").waitFor();
  const offerC = await a.getByLabel("本机连接码").inputValue();
  await c.getByPlaceholder("粘贴收到的发起码或应答码").fill(offerC);
  await c.getByRole("button", { name: "接收发起码并生成应答" }).click();
  await c.getByLabel("本机连接码").waitFor();
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(await c.getByLabel("本机连接码").inputValue());
  await a.getByRole("button", { name: "完成应答" }).click();
  await c.getByRole("button", { name: "验证码相同，确认信任" }).waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "邀请加入当前群聊" }).click();
  for (const page of [a, b, c, d]) { if (await page.getByRole("button", { name: "消息", exact: true }).count()) await page.getByRole("button", { name: "消息", exact: true }).click(); }
  await Promise.all([b.getByText("群聊 · 四人聊天室 · 3/4").waitFor(), c.getByText("群聊 · 四人聊天室 · 3/4").waitFor()]);
  assert.equal(await c.locator(".chat-panel").getByText("真实 P2P 加密消息测试", { exact: true }).count(), 0, "new group member must not decrypt messages from an earlier key epoch");
  await b.locator(".message").filter({ hasText: "真实 P2P 加密消息测试" }).getByRole("button", { name: "回复" }).click();
  await b.getByPlaceholder("输入加密文字消息").fill("收到历史消息");
  await b.getByRole("button", { name: "发送", exact: true }).click();
  await c.locator(".chat-panel").getByText("收到历史消息", { exact: true }).waitFor({ timeout: 10000 });
  await c.locator(".message").filter({ hasText: "收到历史消息" }).getByRole("button", { name: /👍/ }).click();
  await a.locator(".message").filter({ hasText: "收到历史消息" }).getByRole("button", { name: /👍 1/ }).waitFor({ timeout: 10000 });
  await a.locator(".message").filter({ hasText: "真实 P2P 加密消息测试" }).getByRole("button", { name: "撤回" }).click();
  await b.locator(".chat-panel").getByText("已撤回", { exact: true }).waitFor({ timeout: 10000 });
  await b.getByPlaceholder("输入加密文字消息").fill("B 到 C 经 A 转发");
  await b.getByRole("button", { name: "发送", exact: true }).click();
  await c.locator(".chat-panel").getByText("B 到 C 经 A 转发", { exact: true }).waitFor({ timeout: 10000 });
  await b.locator(".message").filter({ hasText: "B 到 C 经 A 转发" }).getByText("3 份副本").waitFor({ timeout: 10000 });
  const content = Buffer.from("Aether encrypted attachment test ".repeat(400));
  await a.locator(".chat-panel input[type=file]").setInputFiles({ name: "proof.txt", mimeType: "text/plain", buffer: content });
  const downloadButton = c.getByRole("button", { name: /下载 · proof.txt/ });
  await downloadButton.waitFor({ timeout: 15000 });
  const downloadPromise = c.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  assert.deepEqual(await readFile(await download.path()), content);
  await d.goto("http://127.0.0.1:5173/");
  await d.getByPlaceholder("设备名称").fill("Dave");
  await d.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await d.getByRole("button", { name: "创建设备" }).click();
  await d.getByRole("button", { name: "联系人", exact: true }).click();
  await d.getByRole("button", { name: "展开" }).click();
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.getByRole("button", { name: "生成发起码" }).click();
  await a.getByLabel("本机连接码").waitFor();
  await d.getByPlaceholder("粘贴收到的发起码或应答码").fill(await a.getByLabel("本机连接码").inputValue());
  await d.getByRole("button", { name: "接收发起码并生成应答" }).click();
  await d.getByLabel("本机连接码").waitFor();
  await a.getByPlaceholder("粘贴收到的发起码或应答码").fill(await d.getByLabel("本机连接码").inputValue());
  await a.getByRole("button", { name: "完成应答" }).click();
  await d.getByRole("button", { name: "验证码相同，确认信任" }).waitFor({ timeout: 20000 });
  await d.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "验证码相同，确认信任" }).click();
  await a.getByRole("button", { name: "邀请加入当前群聊" }).click();
  for (const page of [a, b, c, d]) { if (await page.getByRole("button", { name: "消息", exact: true }).count()) await page.getByRole("button", { name: "消息", exact: true }).click(); }
  await Promise.all([b.getByText("群聊 · 四人聊天室 · 4/4").waitFor(), c.getByText("群聊 · 四人聊天室 · 4/4").waitFor(), d.getByText("群聊 · 四人聊天室 · 4/4").waitFor()]);
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.locator(".peer").filter({ hasText: "Bob" }).getByRole("button", { name: "发起私聊" }).click();
  await b.getByRole("button", { name: /私聊 · Alice/ }).click();
  const privateInvite = (await a.evaluate(() => window.__aetherFrames.map((raw) => JSON.parse(raw)))).find((frame) => frame.type === "invite" && frame.room?.kind === "direct");
  assert.ok(privateInvite?.room?.roomId);
  await a.getByPlaceholder("输入加密文字消息").fill("A 到 B 独立私聊");
  await a.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("A 到 B 独立私聊", { exact: true }).waitFor({ timeout: 10000 });
  for (const page of [c, d]) {
    assert.equal(await page.getByText("A 到 B 独立私聊", { exact: true }).count(), 0);
    assert.ok(!(await page.evaluate(() => window.__aetherFrames.join("\n"))).includes(privateInvite.room.roomId));
  }
  await a.getByRole("button", { name: /群聊 · 四人聊天室 · 4\/4/ }).click();
  await b.getByRole("button", { name: /群聊 · 四人聊天室 · 4\/4/ }).click();
  await d.getByPlaceholder("输入加密文字消息").fill("D 到 B 经 A 转发");
  await d.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("D 到 B 经 A 转发", { exact: true }).waitFor({ timeout: 10000 });
  await d.locator(".message").filter({ hasText: "D 到 B 经 A 转发" }).getByText("4 份副本").waitFor({ timeout: 10000 });
  await a.getByRole("button", { name: "联系人", exact: true }).click();
  await a.getByRole("article").filter({ hasText: "Carol" }).getByRole("button", { name: "移除并轮换密钥" }).click();
  await b.getByText("群聊 · 四人聊天室 · 3/4").waitFor({ timeout: 10000 });
  await c.getByText("房主已将本设备移出房间").waitFor({ timeout: 10000 });
  for (const page of [a, b, c, d]) {
    const frames = await page.evaluate(() => window.__aetherFrames.join("\n"));
    assert.ok(!frames.includes("真实 P2P 加密消息测试"));
    assert.ok(!frames.includes("Aether encrypted attachment test"));
  }
  await a.getByRole("button", { name: "消息", exact: true }).click();
  await a.getByPlaceholder("输入加密文字消息").fill("轮换后的消息");
  await a.getByRole("button", { name: "发送", exact: true }).click();
  await b.locator(".chat-panel").getByText("轮换后的消息", { exact: true }).waitFor({ timeout: 10000 });
  await d.locator(".chat-panel").getByText("轮换后的消息", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await c.locator(".chat-panel").getByText("轮换后的消息", { exact: true }).count(), 0);
  await b.reload();
  await b.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await b.getByRole("button", { name: "解锁", exact: true }).click();
  await b.locator(".chat-panel").getByText("轮换后的消息", { exact: true }).waitFor({ timeout: 10000 });
  await c.reload();
  await c.getByPlaceholder("设备口令，至少 12 个字符").fill("local-test-passphrase-12345");
  await c.getByRole("button", { name: "解锁", exact: true }).click();
  await c.getByText("房主已将本设备移出房间").waitFor({ timeout: 10000 });
  const restoredDownload = c.waitForEvent("download");
  await c.getByRole("button", { name: /下载 · proof.txt/ }).click();
  assert.deepEqual(await readFile(await (await restoredDownload).path()), content);
  assert.deepEqual(failures, []);
  console.log("PASS: four isolated browser profiles paired; group relay, private-room isolation, acknowledgements, attachment, key rotation, and reload persistence verified");
} finally {
  await browser.close();
}
