import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const rootDir = process.cwd();
const emsdkDir = process.env.EMSDK || path.join(os.homedir(), "emsdk");
const emsdkVersion = process.env.EMSDK_VERSION || process.env.BREP_EMSDK_VERSION || "3.1.64";
const emsdkRepo = "https://github.com/emscripten-core/emsdk.git";
const isWindows = process.platform === "win32";
const force = process.argv.includes("--force");

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

const commandAvailable = (command) => {
  const result = spawnSync(command, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
};

const quoteForBash = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

try {
  if (isWindows) {
    throw new Error(
      "Automatic EMSDK installation currently requires a bash-compatible environment."
    );
  }

  if (!force && commandAvailable("emcmake") && commandAvailable("emcc")) {
    console.log("[installEmscripten] Emscripten tools are already available on PATH.");
    process.exit(0);
  }

  const quotedEmsdkDir = quoteForBash(emsdkDir);
  const quotedRootDir = quoteForBash(rootDir);
  const quotedVersion = quoteForBash(emsdkVersion);
  const quotedRepo = quoteForBash(emsdkRepo);
  const envScript = path.join(emsdkDir, "emsdk_env.sh");

  const installScript = `
set -eo pipefail
if [ ! -d ${quotedEmsdkDir} ]; then
  git clone ${quotedRepo} ${quotedEmsdkDir}
fi
cd ${quotedEmsdkDir}
git fetch --tags --force
./emsdk install ${quotedVersion}
./emsdk activate ${quotedVersion}
source ${quoteForBash(envScript)} >/dev/null
emcc --version
emcmake --version >/dev/null
cd ${quotedRootDir}
`.trim();

  run("bash", ["-c", installScript]);
  console.log(`[installEmscripten] EMSDK ${emsdkVersion} is installed at ${emsdkDir}.`);
} catch (error) {
  console.error("[installEmscripten] Failed.");
  console.error(error?.message ?? error);
  process.exit(1);
}
