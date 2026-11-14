// 验收 D/E 的新语义（2026-11-14 用户决策：彻底移除名额上限）。
// 原「四人上限 / 8 并发抢 1 席 / 满员拒绝」已作废。现在验证：
//   - 总注册人数不受限制（第 5、第 6 个账号仍可注册）；
//   - 8 枚不同有效邀请码并发校验全部成功，无 quota_exhausted、无 5xx、无死锁；
//   - 邀请码本身（一次性 / 过期 / 尝试次数 / 哈希）仍是唯一准入控制；
//   - quota_counters 只作统计，unlimited=true / max_members=null 恒定。
import {
  createCode, getCode, getQuota, verifyCode, registerWithToken,
  rndName, rndPass, makeChecker,
} from "./helpers.mjs";

const { check, report } = makeChecker("test-quota");

// Synapse 内建 rc_registration 限流：串行注册并对 429 做有界退避
// （与 test-exposure.mjs 同样的处理，避免冷启动栈偶发 429 造成假失败）。
async function registerWithRetry(name, pass, token) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await registerWithToken(name, pass, token);
    if (r.status !== 429) return r;
    await new Promise((res) => setTimeout(res, 7000));
  }
  return { status: 429 };
}

const pre = await getQuota();
console.log(`precondition: quota=${JSON.stringify(pre)}`);
check("U0 管理视图 unlimited=true 且 max_members=null",
  pre.unlimited === true && pre.max_members === null,
  `unlimited=${pre.unlimited} max=${pre.max_members}`);

// ---------- U. 无名额上限：8 枚不同码并发全部成功 ----------
const codes = [];
for (let i = 0; i < 8; i++) codes.push(await createCode({ note: `U: 并发#${i}` }));
const results = await Promise.all(codes.map((c) => verifyCode(c.code)));
const okResults = results.filter((r) => r.status === 200 && !!r.json?.registration_token);
check("U1 8 枚不同码并发校验全部成功", okResults.length === 8, `ok=${okResults.length}/8`);
check("U2 无 quota_exhausted 拒绝",
  results.every((r) => !(r.status === 409 && r.json?.error === "quota_exhausted")));
check("U3 无 5xx / 无意外响应", results.every((r) => r.status === 200),
  results.map((r) => r.status).join(","));

const states = await Promise.all(codes.map((c) => getCode(c.code_id).then((g) => g.status)));
check("U4 8 枚码全部转 USED（一次性仍生效）", states.every((s) => s === "USED"), states.join(","));
const reused = await verifyCode(codes[0].code);
check("U5 已用码再次校验返回 used（准入控制未削弱）",
  reused.status === 400 && reused.json?.error === "used", `${reused.status} ${reused.json?.error}`);

// 抽样真实注册 2 个账号 → 证明「第 5、第 6 个账号」不受限
const reg1 = await registerWithRetry(rndName("unlim1"), rndPass(), results[0].json.registration_token);
const reg2 = await registerWithRetry(rndName("unlim2"), rndPass(), results[1].json.registration_token);
check("U6 第 5 个账号注册成功", reg1.status === 200 && !!reg1.json?.user_id, reg1.status);
check("U7 第 6 个账号注册成功", reg2.status === 200 && !!reg2.json?.user_id, reg2.status);

const qAfter = await getQuota();
check("U8 统计值随之增长（seats_used 单调）", qAfter.seats_used > pre.seats_used,
  `before=${pre.seats_used} after=${qAfter.seats_used}`);
check("U9 Synapse 账号数随之增长", qAfter.synapse_count > pre.synapse_count,
  `before=${pre.synapse_count} after=${qAfter.synapse_count}`);
check("U10 unlimited 恒定、max_members 仍为 null",
  qAfter.unlimited === true && qAfter.max_members === null);

// 再发一枚新码仍可成功 → 无隐性上限
const extra = await createCode({ note: "U: 额外" });
const extraRes = await verifyCode(extra.code);
check("U11 额外新码仍校验成功（无隐性人数上限）", extraRes.status === 200, extraRes.status);

// 无效码仍被拒 → 移除人数上限 ≠ 放开准入
const bad = await verifyCode("0000000000-aaaaaaaaaaaaaaaaaaaaaa");
check("U12 无效邀请码仍被拒（邀请码为唯一准入）",
  bad.status === 400 && bad.json?.error === "invalid", `${bad.status} ${bad.json?.error}`);

process.exit(report() ? 0 : 1);
