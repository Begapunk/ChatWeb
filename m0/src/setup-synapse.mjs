// M0 local Synapse setup: generate config, append private-test overrides, start container.
// Secrets are generated randomly and written to m0/.env.test (gitignored), never hardcoded.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const IMAGE = "matrixdotorg/synapse:v1.165.0";
const VOLUME = "aether-m0-synapse";
const CONTAINER = "aether-m0-synapse";
const PORT = "127.0.0.1:8008:8008";

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// 1. image present?
try {
  docker("image", "inspect", IMAGE);
  console.log("image present:", IMAGE);
} catch {
  console.error("Image not present. Pull it first (see docs/M0-VERIFICATION-REPORT.md).");
  process.exit(1);
}

// 2. generate config if missing
let hasConfig = false;
try {
  docker("run", "--rm", "-v", `${VOLUME}:/data`, "--entrypoint", "sh", IMAGE, "-c", "test -f /data/homeserver.yaml");
  hasConfig = true;
} catch { /* not generated yet */ }

const envFile = new URL("../.env.test", import.meta.url);
let sharedSecret;
if (existsSync(envFile)) {
  const m = readFileSync(envFile, "utf8").match(/AETHER_M0_REG_SECRET=(.+)/);
  sharedSecret = m?.[1]?.trim();
}
if (!sharedSecret) sharedSecret = randomBytes(32).toString("hex");

if (!hasConfig) {
  docker("run", "--rm", "-v", `${VOLUME}:/data`, "-e", "SYNAPSE_SERVER_NAME=aether.test", "-e", "SYNAPSE_REPORT_STATS=no", IMAGE, "generate");
  console.log("config generated");
}

// 3. append M0 test overrides (idempotent via marker)
const overrides = `
# --- Aether M0 local verification overrides (NOT production config) ---
enable_registration: true
registration_requires_token: true
allow_guest_access: false
federation_domain_whitelist: []
registration_shared_secret: "${sharedSecret}"
`;
docker("run", "--rm", "-v", `${VOLUME}:/data`, "--entrypoint", "sh", IMAGE, "-c",
  `grep -q "Aether M0 local verification overrides" /data/homeserver.yaml || cat >> /data/homeserver.yaml <<'YAML'\n${overrides}\nYAML`);
writeFileSync(envFile, `AETHER_M0_REG_SECRET=${sharedSecret}\nAETHER_M0_BASE_URL=http://127.0.0.1:8008\n`, "utf8");
console.log("overrides applied; .env.test written");

// 4. (re)start container
try { docker("rm", "-f", CONTAINER); } catch { /* not running */ }
docker("run", "-d", "--name", CONTAINER, "-p", PORT, "-v", `${VOLUME}:/data`, IMAGE);
console.log("container started:", CONTAINER);

// 5. wait for readiness
const base = "http://127.0.0.1:8008";
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${base}/_matrix/client/versions`);
    if (r.ok) {
      const j = await r.json();
      console.log("Synapse ready. versions:", JSON.stringify(j.versions?.slice(-3)));
      process.exit(0);
    }
  } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 1500));
}
console.error("Synapse did not become ready in 90s");
process.exit(1);