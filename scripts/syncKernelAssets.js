import { cpSync, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "dist-kernel", "assets");
const targetDir = path.join(rootDir, "public", "assets");

if (!existsSync(sourceDir)) {
  console.warn(`[syncKernelAssets] Source directory not found: ${sourceDir}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });

const assetEntries = readdirSync(sourceDir, { withFileTypes: true }).filter((entry) =>
  entry.isFile()
);

for (const entry of assetEntries) {
  const sourcePath = path.join(sourceDir, entry.name);
  const targetPath = path.join(targetDir, entry.name);
  cpSync(sourcePath, targetPath, { force: true });
}

console.log(`[syncKernelAssets] Copied ${assetEntries.length} kernel asset(s) to public/assets.`);
