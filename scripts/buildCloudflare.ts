import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const rootDir = process.cwd();
const emsdkDir = process.env.EMSDK || path.join(os.homedir(), "emsdk");
const emsdkVersion = "4.0.17";
const isWindows = process.platform === "win32";

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error?.code === "ENOENT") {
    throw new Error(`Missing required command '${command}'.`);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(" ")}`);
  }
};

try {
  if (isWindows) {
    throw new Error(
      "build:cloudflare currently requires a bash-compatible environment."
    );
  }

const setupScript = `
set -euo pipefail
if [ ! -d "${emsdkDir}" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "${emsdkDir}"
fi
cd "${emsdkDir}"
git fetch --tags --force
./emsdk install ${emsdkVersion}
./emsdk activate ${emsdkVersion}
source "${path.join(emsdkDir, "emsdk_env.sh")}" >/dev/null
cd "${rootDir}"
pnpm build
`.trim();

  run("bash", ["-lc", setupScript]);
} catch (error) {
  console.error("[build:cloudflare] Failed.");
  console.error(error?.message ?? error);
  process.exit(1);
}
