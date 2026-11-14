// 验收 D/E（PRD §5）：四人上限 + 并发竞态不多发名额
// 前置（run-all 固定顺序下）：本套件开始时 seats_used 应为 3（管理员 + A 用例用户 + E2EE 用户）。
// E 消耗最后 1 个名额（1/8 并发成功）；D 断言满员后新码被拒且不消耗。
import {
  createCode, getCode, getQuota, verifyCode, registerWithToken,
  rndName, rndPass, makeChecker,
} from "./helpers.mjs";

const { check, report } = makeChecker("test-quota");

const pre = await getQuota();
console.log(`precondition: quota=${JSON.stringify(pre)}`);
check("前置：开始时 effective=3（管理员+2 已注册用户）", pre.effective === 3 && pre.max_members === 4,
  `seats=${pre.seats_used} synapse=${pre.synapse_count}`);

// ---------- E. 并发注册竞态不多发名额（剩余 1 席，8 并发） ----------
const codes = [];
for (let i = 0; i < 8; i++) codes.push(await createCode({ note: `E: 并发#${i}` }));
const results = await Promise.all(codes.map((c) => verifyCode(c.code)));

const okResults = results.filter((r) => r.status === 200);
const quotaRejected = results.filter((r) => r.status === 409 && r.json?.error === "quota_exhausted");
check("E1 8 并发校验恰好 1 个成功", okResults.length === 1, `ok=${okResults.length}`);
check("E2 其余 7 个返回 409 quota_exhausted", quotaRejected.length === 7, `rejected=${quotaRejected.length}`);
check("E3 无其他意外响应", okResults.length + quotaRejected.length === 8);

// 成功者完成注册 → 账号总数 = 4
const winnerIdx = results.findIndex((r) => r.status === 200);
const winner = results[winnerIdx];
const winnerUser = rndName("winner"), winnerPass = rndPass();
const reg = await registerWithToken(winnerUser, winnerPass, winner.json.registration_token);
check("E4 成功者注册完成", reg.status === 200 && !!reg.json?.user_id, reg.status);

const qAfter = await getQuota();
check("E5 名额计数无超卖（seats_used=4）", qAfter.seats_used === 4, `seats=${qAfter.seats_used}`);
check("E6 Synapse 实际账号数=4（与口径一致）", qAfter.synapse_count === 4, `synapse=${qAfter.synapse_count}`);
check("E7 effective=4", qAfter.effective === 4);

// 未成功的 7 枚码必须保持 UNUSED（可复核：无消耗）
const unusedStates = await Promise.all(
  codes.filter((_, i) => i !== winnerIdx).map((c) => getCode(c.code_id).then((g) => g.status)),
);
check("E8 失败并发中的码保持 UNUSED", unusedStates.every((s) => s === "UNUSED"), unusedStates.join(","));

// ---------- D. 四人上限（满员后新码被拒且不消耗） ----------
const d = await createCode({ note: "D: 满员" });
const vd = await verifyCode(d.code);
check("D1 满员后校验返回 409 quota_exhausted", vd.status === 409 && vd.json?.error === "quota_exhausted", `${vd.status} ${vd.json?.error}`);
const dAfter = await getCode(d.code_id);
check("D2 邀请码保持 UNUSED（不消耗）", dAfter.status === "UNUSED");
check("D3 attempts 不增加", dAfter.attempts === 0, `attempts=${dAfter.attempts}`);
const qFinal = await getQuota();
check("D4 名额计数不变（仍 4）", qFinal.seats_used === 4 && qFinal.effective === 4);

process.exit(report() ? 0 : 1);
