import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("bin", "brep-io-kernel.ts");
const targetPath = resolve("dist-kernel", "bin", "brep-io-kernel.js");

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
chmodSync(targetPath, 0o755);

console.log(`[buildCliBin] Wrote ${targetPath}`);
