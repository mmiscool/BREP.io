import { spawnSync } from "child_process";
import { MANIFOLD_SOURCE_LOCAL, readManifoldSource, writeManifoldSource } from "./manifoldSourceConfig.js";

const rootDir = process.cwd();
const source = readManifoldSource();

writeManifoldSource(source);

if (source !== MANIFOLD_SOURCE_LOCAL) {
  console.log("[prepareManifoldRuntime] Using published npm manifold package.");
  process.exit(0);
}

console.log("[prepareManifoldRuntime] Using locally compiled manifold build.");
const result = spawnSync("node", ["./scripts/buildManifoldPlus.js"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
