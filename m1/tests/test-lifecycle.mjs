// 验收 A/B/C（PRD §5）：邀请码生命周期
// A 重复使用；B 过期（判定先于计数）；C 尝试超限（BLOCKED 终态）
// 前置：本地栈已起即可。名额上限已移除；A 的成功 verify 只会让 seats_used 统计 +1。
import {
  createCode, getCode, verifyCode, registerWithToken, psqlInvite,
  rndName, rndPass, makeChecker,
} from "./helpers.mjs";

const { check, report } = makeChecker("test-lifecycle");

// ---------- A. 邀请码重复使用 ----------
const a = await createCode({ note: "A: 重复使用" });
check("A1 生成邀请码返回明文码（仅一次）", typeof a.code === "string" && a.code.length >= 26, `len=${a.code?.length}`);

const v1 = await verifyCode(a.code);
check("A2 首次校验成功并发放注册令牌", v1.status === 200 && !!v1.json?.registration_token, v1.status);
check("A3 响应含 ISO 到期时间", typeof v1.json?.token_expires_at === "string" && v1.json.token_expires_at.endsWith("Z"));

const v2 = await verifyCode(a.code);
check("A4 二次校验返回 400 used（不发放新令牌）", v2.status === 400 && v2.json?.error === "used", `${v2.status} ${v2.json?.error}`);

const afterUsed = await getCode(a.code_id);
check("A5 码状态转 USED", afterUsed.status === "USED");
check("A6 成功校验不计入 attempts", afterUsed.attempts === 0, `attempts=${afterUsed.attempts}`);

// 注册成功 + 同一令牌二次注册被拒（uses_allowed=1 兜底，M0 语义）
const regUser = rndName("alice"), regPass = rndPass();
const reg = await registerWithToken(regUser, regPass, v1.json.registration_token);
check("A7 持令牌注册成功（m.login.registration_token）", reg.status === 200 && !!reg.json?.user_id, reg.status);
const regUser2 = rndName("mallory");
const reg2 = await registerWithToken(regUser2, rndPass(), v1.json.registration_token);
check("A8 已用尽令牌的再次注册被拒（401）", reg2.status === 401, reg2.status);

// ---------- B. 过期邀请码（判定先于尝试计数） ----------
const b = await createCode({ note: "B: 过期" });
// 测试推进时间：直接把该码的 expires_at 置为过去（测试专用通道，docker+psql）
psqlInvite(`UPDATE invite_codes SET expires_at = now() - interval '1 hour' WHERE id = '${b.code_id}'`);
const vb = await verifyCode(b.code);
check("B1 过期码校验返回 400 expired", vb.status === 400 && vb.json?.error === "expired", `${vb.status} ${vb.json?.error}`);
const afterExpired = await getCode(b.code_id);
check("B2 过期判定先于尝试计数（attempts=0）", afterExpired.attempts === 0, `attempts=${afterExpired.attempts}`);
check("B3 状态迁移为 EXPIRED 终态", afterExpired.status === "EXPIRED");

// ---------- C. 尝试超限 ----------
const c = await createCode({ max_attempts: 3, note: "C: 超限" });
const wrongCode = (code) => code.replace(/-.+$/, "-" + "x".repeat(22));
const r1 = await verifyCode(wrongCode(c.code));
check("C1 第 1 次错误提交 400 invalid", r1.status === 400 && r1.json?.error === "invalid", `${r1.status} ${r1.json?.error}`);
const r2 = await verifyCode(wrongCode(c.code));
check("C2 第 2 次错误提交 400 invalid", r2.status === 400 && r2.json?.error === "invalid");
const midC = await getCode(c.code_id);
check("C3 失败计数累计（attempts=2）", midC.attempts === 2, `attempts=${midC.attempts}`);
const r3 = await verifyCode(wrongCode(c.code));
check("C4 第 3 次错误提交转 BLOCKED", r3.status === 400 && r3.json?.error === "blocked", `${r3.status} ${r3.json?.error}`);
const r4 = await verifyCode(c.code); // 正确明文
check("C5 第 4 次即使正确明文也 blocked", r4.status === 400 && r4.json?.error === "blocked", `${r4.status} ${r4.json?.error}`);
check("C6 码状态为 BLOCKED 终态", (await getCode(c.code_id)).status === "BLOCKED");

// ---------- 附加：格式非法与不存在 ----------
const bad = await verifyCode("not-a-valid-code");
check("X1 格式非法返回 400 invalid", bad.status === 400 && bad.json?.error === "invalid", `${bad.status} ${bad.json?.error}`);
const ghost = await verifyCode("0000000000-aaaaaaaaaaaaaaaaaaaaaa");
check("X2 tag 不存在返回 400 invalid", ghost.status === 400 && ghost.json?.error === "invalid");

process.exit(report() ? 0 : 1);
