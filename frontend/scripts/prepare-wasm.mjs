/**
 * 把 Rust Crypto WASM 二进制从 node_modules 复制到 public/wasm/。
 *
 * 为什么不直接入库 7.8MB 二进制：版本由 package-lock.json 精确锁定
 * （matrix-js-sdk 45.1.0 → @matrix-org/matrix-sdk-crypto-wasm 18.9.2），
 * 由 postinstall 按需复制，避免二进制漂移，也不污染 git。
 *
 * 为什么必须显式路径：M0 F4 实证，打包器会重写 `import.meta.url`，
 * 导致 WASM 默认 URL 404。运行时用 `/wasm/matrix_sdk_crypto_wasm_bg.wasm`
 * 固定地址调用 `initAsync(url)`，见 src/services/matrix.ts。
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = path.join(
  FRONTEND,
  "node_modules",
  "@matrix-org",
  "matrix-sdk-crypto-wasm",
);
const SRC = path.join(PKG_DIR, "pkg", "matrix_sdk_crypto_wasm_bg.wasm");
const DEST_DIR = path.join(FRONTEND, "public", "wasm");
const DEST = path.join(DEST_DIR, "matrix_sdk_crypto_wasm_bg.wasm");
const EXPECTED_VERSION = "18.9.2";

function fail(msg) {
  console.error(`[prepare-wasm] 失败：${msg}`);
  process.exitCode = 1;
}

try {
  const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  if (pkg.version !== EXPECTED_VERSION) {
    fail(`crypto-wasm 版本漂移：期望 ${EXPECTED_VERSION}，实际 ${pkg.version}。请先核对 matrix-js-sdk 的精确依赖，不要单独升级。`);
  } else {
    mkdirSync(DEST_DIR, { recursive: true });
    copyFileSync(SRC, DEST);
    const sha = createHash("sha256").update(readFileSync(SRC)).digest("hex").slice(0, 16);
    console.log(
      `[prepare-wasm] OK  crypto-wasm ${pkg.version} → public/wasm/ ` +
        `(${(statSync(DEST).size / 1024 / 1024).toFixed(2)} MiB, sha256:${sha}…)`,
    );
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
