import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
const emCacheDir = path.join(rootDir, ".emscripten_cache");
const isWindows = process.platform === "win32";
const cmakeVenvDir = path.join(os.homedir(), ".cache", "brep-tools", "cmake-venv");
const cmakeBinDir = isWindows
  ? path.join(cmakeVenvDir, "Scripts")
  : path.join(cmakeVenvDir, "bin");
const cmakeBinary = isWindows
  ? path.join(cmakeBinDir, "cmake.exe")
  : path.join(cmakeBinDir, "cmake");
const pipBinary = isWindows
  ? path.join(cmakeBinDir, "pip.exe")
  : path.join(cmakeBinDir, "pip");

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

const prependToPath = (dir) => {
  const currentPath = process.env.PATH || "";
  const segments = currentPath.split(path.delimiter).filter(Boolean);
  if (segments.includes(dir)) return;
  process.env.PATH = [dir, ...segments].join(path.delimiter);
};

const commandAvailable = (command) => {
  const result = spawnSync(command, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
};

const emscriptenToolsAvailable = () => commandAvailable("emcmake") && commandAvailable("emcc");

const runWithEmscripten = (commandText) => {
  if (isWindows) {
    throw new Error(
      "Automatic EMSDK activation is only implemented for bash environments. Put emcmake/emcc on PATH and rerun."
    );
  }

  const quoted = commandText.replaceAll('"', '\\"');
  const quotedCache = emCacheDir.replaceAll('"', '\\"');
  run("bash", [
    "-c",
    `cd "${emsdkDir}" && ./emsdk install ${emsdkVersion} >/dev/null && ./emsdk activate ${emsdkVersion} >/dev/null && source "${emsdkEnvScript}" >/dev/null && export EM_CACHE="${quotedCache}" && mkdir -p "${quotedCache}" && cd "${rootDir}" && ${quoted}`,
  ]);
};

const runEmscriptenCommand = (command, args) => {
  if (!existsSync(emsdkEnvScript) && (command === "emcmake" || command === "emcc") && !emscriptenToolsAvailable()) {
    run("node", ["./scripts/installEmscripten.js"]);
  }

  if (existsSync(emsdkEnvScript)) {
    const commandText = [command, ...args].join(" ");
    runWithEmscripten(commandText);
    return;
  }

  run(command, args);
};

const ensureCmakeAvailable = () => {
  const probe = spawnSync("cmake", ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });

  if (probe.status === 0) {
    return;
  }

  const pipProbe = spawnSync("python3", ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  if (pipProbe.status !== 0) {
    throw new Error(
      "A runnable 'cmake' was not found, and python3 is unavailable to bootstrap one."
    );
  }

  run("python3", ["-m", "venv", cmakeVenvDir]);
  run(pipBinary, ["install", "--quiet", "cmake"]);
  prependToPath(cmakeBinDir);

  const venvProbe = spawnSync(cmakeBinary, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  if (venvProbe.status !== 0) {
    throw new Error("Bootstrapped cmake virtualenv, but the cmake executable is still unavailable.");
  }
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

const applyBrowserEmbindDestructorGuard = (jsPath) => {
  const source = readFileSync(jsPath, "utf8");
  const original =
    "runDestructors=destructors=>{while(destructors.length){var ptr=destructors.pop();var del=destructors.pop();del(ptr)}};";
  const replacement =
    "runDestructors=destructors=>{if(!destructors)return;while(destructors.length){var ptr=destructors.pop();var del=destructors.pop();del(ptr)}};";
  if (!source.includes(original)) return;
  writeFileSync(jsPath, source.replace(original, replacement));
};

try {
  if (!existsSync(path.join(rootDir, "vendor", "manifold3d", "CMakeLists.txt"))) {
    throw new Error(
      "Missing manifold3d submodule. Run 'git submodule update --init --recursive' and retry."
    );
  }

  ensureCmakeAvailable();
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(emCacheDir, { recursive: true });

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
  const distJsPath = path.join(distDir, "manifold.js");
  cpSync(builtJsPath, distJsPath, { force: true });
  cpSync(builtWasmPath, path.join(distDir, "manifold.wasm"), { force: true });
  applyBrowserEmbindDestructorGuard(distJsPath);

  console.log(`[build:manifoldPlus] Wrote ${path.relative(rootDir, distDir)}/manifold.js`);
  console.log(`[build:manifoldPlus] Wrote ${path.relative(rootDir, distDir)}/manifold.wasm`);
} catch (error) {
  console.error("[build:manifoldPlus] Failed.");
  console.error(error?.message ?? error);
  process.exit(1);
}
