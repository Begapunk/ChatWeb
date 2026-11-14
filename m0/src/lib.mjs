import { writeFileSync, mkdirSync } from "node:fs";

/** Record a check result and print an ASCII-safe line to stdout. */
export function makeChecker(checks) {
  return (name, ok, detail = "") => {
    checks.push({ name, ok: !!ok, detail: String(detail) });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " -- " + detail : ""}`);
  };
}

/** Write a UTF-8 JSON report under m0/results/ and set exit code on failure. */
export function report(testName, checks) {
  const passed = checks.filter((c) => c.ok).length;
  const summary = {
    test: testName,
    timestamp: new Date().toISOString(),
    node: process.version,
    total: checks.length,
    passed,
    failed: checks.length - passed,
    checks,
  };
  mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../results/${testName}.json`, import.meta.url), JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n[${testName}] ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
  return summary;
}

export const b64 = (buf) => Buffer.from(buf).toString("base64");
export const b64url = (buf) => Buffer.from(buf).toString("base64url");