// 验收 F（PRD §5）：注册后自动进入加密房间，全链路 Megolm 收发
// 链路：建码 → verify（经 Caddy）→ 注册（经 Caddy）→ SDK sync 轮询收 invite（≤60s）
//   → join 两固定房间 → 新用户发消息 → 管理员设备解密成功 + 服务器侧仍为密文。
// 吸收 M0 发现：F1（发送前等对端设备可见）、F3（解密断言用轮询）、事实 9（device_id 重建 client）。
// SDK 客户端走 Synapse 直连回环（本地 profile 专属通道；公共路径用例均在经 Caddy 的部分完成）。
import {
  createCode, verifyCode, registerWithToken, getRooms, loginSynapse, makeDevice, directSynapse,
  SYNAPSE_DIRECT_URL, SYNAPSE_ADMIN_USERNAME, SYNAPSE_ADMIN_PASSWORD,
  waitFor, rndName, rndPass, makeChecker,
} from "./helpers.mjs";

const { check, report } = makeChecker("test-e2ee");

const watchdog = setTimeout(() => {
  console.error("WATCHDOG timeout (240s)");
  report();
  process.exit(1);
}, 240_000);

try {
  // ---- 1. 建码 → 校验 → 注册（公共路径，经 Caddy）----
  const code = await createCode({ note: "F: E2EE 链路" });
  const v = await verifyCode(code.code);
  check("F1 邀请码校验成功", v.status === 200 && !!v.json?.registration_token, v.status);
  const newUser = rndName("frank"), newPass = rndPass();
  const reg = await registerWithToken(newUser, newPass, v.json.registration_token);
  check("F2 新用户注册成功", reg.status === 200 && !!reg.json?.user_id, reg.status);

  // ---- 2. 新用户 SDK 客户端（事实 9：用返回 device_id 建客户端）----
  const frank = await makeDevice("frank", {
    userId: reg.json.user_id,
    accessToken: reg.json.access_token,
    deviceId: reg.json.device_id,
    baseUrl: SYNAPSE_DIRECT_URL,
  });
  check("F3 新用户设备完成初始同步（Rust crypto）", true);

  // ---- 3. 轮询等待两固定房间的邀请（入房服务 invite，≤60s）----
  const rooms = await getRooms();
  check("F4 自举固定房间存在（group + private）", rooms.length === 2 && rooms.some((r) => r.kind === "group") && rooms.some((r) => r.kind === "private"), JSON.stringify(rooms.map((r) => r.kind)));
  const groupRoom = rooms.find((r) => r.kind === "group");
  const privateRoom = rooms.find((r) => r.kind === "private");

  await waitFor(() => frank.getRoom(groupRoom.room_id)?.getMyMembership() === "invite", 60_000, "群聊房间邀请");
  check("F5 收到群聊房间邀请（自动入房）", true);
  await waitFor(() => frank.getRoom(privateRoom.room_id)?.getMyMembership() === "invite", 60_000, "私聊房间邀请");
  check("F6 收到私聊房间邀请（自动入房）", true);

  await frank.joinRoom(groupRoom.room_id);
  await frank.joinRoom(privateRoom.room_id);
  // join API 成功后客户端房间状态要等 sync 回填（F3 轮询语义）
  await waitFor(() => frank.getRoom(groupRoom.room_id)?.getMyMembership() === "join", 30_000, "群聊 join 状态回填");
  await waitFor(() => frank.getRoom(privateRoom.room_id)?.getMyMembership() === "join", 30_000, "私聊 join 状态回填");
  check("F7 新用户成功 join 两房间", true);
  check("F8 房间报告加密已启用", await frank.getCrypto().isEncryptionEnabledInRoom(groupRoom.room_id));

  // ---- 4. 管理员设备（服务自举管理员账号，作为另一成员）----
  const adminLogin = await loginSynapse(SYNAPSE_ADMIN_USERNAME, SYNAPSE_ADMIN_PASSWORD);
  const admin = await makeDevice("admin", {
    userId: adminLogin.user_id,
    accessToken: adminLogin.access_token,
    deviceId: adminLogin.device_id,
    baseUrl: SYNAPSE_DIRECT_URL,
  });
  check("F9 管理员设备完成初始同步", true);

  // F1（M0 发现）：发送前等待互相可见对端设备
  const adminId = adminLogin.user_id, frankId = reg.json.user_id;
  await waitFor(async () => (await frank.getCrypto().getUserDeviceInfo([adminId])).get(adminId)?.size > 0, 30_000, "frank 可见 admin 设备");
  await waitFor(async () => (await admin.getCrypto().getUserDeviceInfo([frankId])).get(frankId)?.size > 0, 30_000, "admin 可见 frank 设备");
  check("F10 双方设备互见（F1 竞态规避）", true);

  // ---- 5. 新用户发送加密消息；管理员轮询解密（F3）----
  const SECRET = `aether-m1-e2ee-${Date.now()}`;
  const sent = await frank.sendEvent(groupRoom.room_id, "m.room.message", { msgtype: "m.text", body: SECRET });
  check("F11 消息发送成功", !!sent.event_id);

  const decrypted = await waitFor(() => {
    const ev = admin.getRoom(groupRoom.room_id)?.timeline?.find((x) => x.getId() === sent.event_id);
    if (!ev || ev.isDecryptionFailure?.()) return null;
    return ev.getContent()?.body === SECRET ? ev : null;
  }, 45_000, "管理员解密新用户消息");
  check("F12 管理员成功解密新用户消息", !!decrypted);
  if (decrypted) {
    check("F13 线上事件为 m.room.encrypted（Megolm）", decrypted.getWireType() === "m.room.encrypted" && decrypted.getWireContent().algorithm === "m.megolm.v1.aes-sha2");
    check("F14 密文不含明文", !JSON.stringify(decrypted.getWireContent()).includes(SECRET));
  }

  // ---- 6. 服务器侧密文证明（成员读原始事件；directSynapse 避开 env 代理）----
  const rawResp = await directSynapse(
    "GET",
    `/_matrix/client/v3/rooms/${encodeURIComponent(groupRoom.room_id)}/event/${encodeURIComponent(sent.event_id)}`,
    { headers: { Authorization: `Bearer ${reg.json.access_token}` } },
  );
  const rawEvent = rawResp.json || {};
  check("F15 服务器存储事件为密文", rawResp.status === 200 && rawEvent.type === "m.room.encrypted" && !!rawEvent.content?.ciphertext, rawResp.status);
  check("F16 服务器存储不含明文", !JSON.stringify(rawEvent).includes(SECRET));

  frank.stopClient();
  admin.stopClient();
} finally {
  clearTimeout(watchdog);
}

process.exit(report() ? 0 : 1);
