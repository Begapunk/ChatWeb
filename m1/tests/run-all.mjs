// M1 测试总编排：固定顺序执行（名额预算确定性，见 m1/README.md），汇总报告落 m1/reports/。
// 顺序：lifecycle（+1 席）→ e2ee（+1 席）→ quota（E 用最后 1 席；D 断言满员）→ exposure（不耗席）。
// 全量复跑必须用 scripts/run-m1-tests.sh --fresh（重建卷，名额从 0 计）。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SUITES = [
  { file: "test-lifecycle.mjs", label: "A/B/C 邀请码生命周期" },
  { file: "test-e2ee.mjs", label: "F 注册自动入房 + E2EE 全链路" },
  { file: "test-quota.mjs", label: "D/E 四人上限 + 并发竞态" },
  { file: "test-exposure.mjs", label: "G/I 管理面隔离 + 注册关闭" },
];

const results = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite.file}（${suite.label}）===`);
  const run = spawnSync(process.execPath, [`${here}${suite.file}`], { encoding: "utf8" });
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  results.push({ ...suite, exitCode: run.status, crashed: run.status === null });
}

// 汇总各套件 JSON 报告
const reportDir = new URL("../reports/", import.meta.url);
mkdirSync(reportDir, { recursive: true });
const summary = [];
const allChecks = [];
for (const r of results) {
  const jsonPath = new URL(`../reports/${r.file.replace(".mjs", ".json")}`, import.meta.url);
  let stats = { pass: 0, fail: 0 };
  if (existsSync(jsonPath)) {
    const data = JSON.parse(readFileSync(jsonPath, "utf8"));
    stats = { pass: data.pass, fail: data.fail };
    allChecks.push(...data.checks.map((c) => ({ suite: r.file, ...c })));
  }
  const crashed = r.crashed ? "（进程异常终止）" : "";
  summary.push(`| ${r.file} | ${r.label} | ${stats.pass} | ${stats.fail} | ${r.exitCode === 0 && !r.crashed ? "✅" : "❌"}${crashed} |`);
}
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const totalFail = allChecks.filter((c) => !c.ok).length;
const md = [
  "# Aether M1 集成测试报告",
  "",
  `- 时间：${new Date().toISOString()}`,
  `- 用例总数：${allChecks.length}，失败：${totalFail}`,
  "",
  "| 套件 | 覆盖验收 | 通过 | 失败 | 结果 |",
  "|---|---|---|---|---|",
  ...summary,
  "",
  "## 验收标准对照（PRD §5）",
  "",
  "| 验收 | 套件 |",
  "|---|---|",
  "| A 邀请码重复使用 | test-lifecycle |",
  "| B 过期邀请码 | test-lifecycle |",
  "| C 尝试超限 | test-lifecycle |",
  "| D 四人上限 | test-quota |",
  "| E 并发注册竞态 | test-quota |",
  "| F 注册后自动进入加密房间 | test-e2ee |",
  "| G 管理 API 不对浏览器暴露 | test-exposure |",
  "| H 联邦关闭 | scripts/check-deploy.sh（部署检查） |",
  "| I 公开注册与访客关闭 | test-exposure + check-deploy.sh |",
  "| J 部署检查与运维占位 | scripts/check-deploy.sh + 文档 |",
  "",
  "## 失败明细",
  "",
  ...(totalFail === 0 ? ["（无）"] : allChecks.filter((c) => !c.ok).map((c) => `- [${c.suite}] ${c.name} ${c.detail ? `[${c.detail}]` : ""}`)),
  "",
].join("\n");
writeFileSync(new URL(`../reports/report-${ts}.md`, import.meta.url), md, "utf8");

console.log("\n==============================");
console.log(md);
process.exit(totalFail === 0 && results.every((r) => r.exitCode === 0 && !r.crashed) ? 0 : 1);
