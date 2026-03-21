import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import os from "os";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "manifold-plus");
const buildDir = path.join(sourceDir, "build");
const distDir = path.join(sourceDir, "dist");
const emsdkDir = process.env.EMSDK || path.join(os.homedir(), "emsdk");
const emsdkEnvScript = path.join(emsdkDir, "emsdk_env.sh");
const emsdkVersion = "3.1.64";
const isWindows = process.platform === "win32";

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error?.code === "ENOENT") {
    if (command === "emcmake" || command === "emcc" || command === "cmake") {
      throw new Error(
        `Missing required command '${command}'. Install/activate Emscripten so emcmake/emcc are available, or install EMSDK at '${emsdkDir}'.`
      );
    }
    throw new Error(`Missing required command '${command}'.`);
  }

  if (result.status !== 0) {
    const commandText = [command, ...args].join(" ");
    throw new Error(`Command failed: ${commandText}`);
  }
};

const runWithEmscripten = (commandText) => {
  if (isWindows) {
    throw new Error(
      "Automatic EMSDK activation is only implemented for bash environments. Put emcmake/emcc on PATH and rerun."
    );
  }

  const quoted = commandText.replaceAll('"', '\\"');
  run("bash", [
    "-lc",
    `cd "${emsdkDir}" && ./emsdk install ${emsdkVersion} >/dev/null && ./emsdk activate ${emsdkVersion} >/dev/null && source "${emsdkEnvScript}" >/dev/null && cd "${rootDir}" && ${quoted}`,
  ]);
};

const runEmscriptenCommand = (command, args) => {
  if (existsSync(emsdkEnvScript)) {
    const commandText = [command, ...args].join(" ");
    runWithEmscripten(commandText);
    return;
  }

  run(command, args);
};

const resolveBuiltArtifact = (buildDir, filename) => {
  const candidates = [
    path.join(buildDir, "vendor", "manifold3d", "bindings", "wasm", filename),
    path.join(buildDir, "bindings", "wasm", filename),
    path.join(buildDir, filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

try {
  if (!existsSync(path.join(rootDir, "vendor", "manifold3d", "CMakeLists.txt"))) {
    throw new Error(
      "Missing manifold3d submodule. Run 'git submodule update --init --recursive' and retry."
    );
  }

  mkdirSync(buildDir, { recursive: true });

  runEmscriptenCommand("emcmake", [
    "cmake",
    "-S",
    sourceDir,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=MinSizeRel",
    "-DMANIFOLD_PAR=OFF",
    "-DMANIFOLD_USE_BUILTIN_TBB=ON",
    "-DMANIFOLD_DEBUG=OFF",
    "-DMANIFOLD_ASSERT=OFF",
  ]);

  runEmscriptenCommand("cmake", ["--build", buildDir, "--target", "manifoldjs"]);

  const builtJsPath = resolveBuiltArtifact(buildDir, "manifold.js");
  const builtWasmPath = resolveBuiltArtifact(buildDir, "manifold.wasm");
  if (!builtJsPath || !builtWasmPath) {
    throw new Error("Expected manifold.js and manifold.wasm were not produced.");
  }

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(builtJsPath, path.join(distDir, "manifold.js"), { force: true });
  cpSync(builtWasmPath, path.join(distDir, "manifold.wasm"), { force: true });

  console.log(`[build:manifoldPlus] Wrote ${path.relative(rootDir, distDir)}/manifold.js`);
  console.log(`[build:manifoldPlus] Wrote ${path.relative(rootDir, distDir)}/manifold.wasm`);
} catch (error) {
  console.error("[build:manifoldPlus] Failed.");
  console.error(error?.message ?? error);
  process.exit(1);
}
