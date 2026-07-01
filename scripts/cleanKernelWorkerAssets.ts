import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const generatedWorkerPattern = /^ghLoader\.worker-[A-Za-z0-9_-]+\.js$/u;
const assetDirs = [
  resolve("public", "assets"),
  resolve("dist-kernel", "assets"),
];

let removed = 0;

for (const dir of assetDirs) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !generatedWorkerPattern.test(entry.name)) continue;
    rmSync(resolve(dir, entry.name), { force: true });
    removed += 1;
  }
}

if (removed > 0) {
  console.log(`[cleanKernelWorkerAssets] Removed ${removed} stale worker asset(s).`);
}
