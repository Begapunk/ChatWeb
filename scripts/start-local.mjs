/** Zero-install Aether launcher. Uses only Node.js built-in modules. */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");
const DIST = path.join(FRONTEND, "dist");
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.AETHER_PORT ?? "4173", 10);

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error("AETHER_PORT 必须是 1024-65535 的整数");
  process.exit(1);
}

console.log("正在使用本机已有 Node.js 构建 Aether（不会下载或安装软件）…");
function runNpm(script) {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm.cmd run ${script}`]
    : ["run", script];
  const result = spawnSync(command, args, { cwd: FRONTEND, stdio: "inherit", shell: false });
  if (result.error) console.error(`无法执行 npm：${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNpm("prepare:wasm");
runNpm("build");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
]);

function resolveAsset(requestPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestPath, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
  const candidate = path.resolve(DIST, `.${pathname}`);
  if (candidate !== DIST && !candidate.startsWith(`${DIST}${path.sep}`)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (!path.extname(pathname)) return path.join(DIST, "index.html");
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const file = resolveAsset(req.url ?? "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "Content-Type": contentTypes.get(ext) ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
});
server.on("error", (error) => {
  console.error(`Aether 启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => {
  console.log(`\nAether 已启动：http://${HOST}:${PORT}`);
  console.log("按 Ctrl+C 停止。真实模式需填写已有 Matrix homeserver 和账号。\n");
});
