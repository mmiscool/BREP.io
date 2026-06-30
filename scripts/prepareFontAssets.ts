import fs from "fs";
import path from "path";

const root = process.cwd();
const source = path.join(root, "src", "assets", "fonts");
const target = path.join(root, "public", "fonts");

const log = (...args) => console.log("[prepareFonts]", ...args);

if (!fs.existsSync(source)) {
  log("No font assets found at", source, "- skipping.");
  process.exit(0);
}

if (!fs.existsSync(path.dirname(target))) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
if (stat) {
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(target);
    const resolved = path.resolve(path.dirname(target), link);
    if (resolved === source) {
      log("public/fonts symlink is already correct.");
      process.exit(0);
    }
    log("public/fonts symlink points elsewhere; leaving as-is.");
    process.exit(0);
  }
  if (stat.isDirectory()) {
    log("public/fonts directory already exists; leaving as-is.");
    process.exit(0);
  }
  log("public/fonts exists and is not a directory or symlink; skipping.");
  process.exit(0);
}

try {
  fs.symlinkSync(source, target, "dir");
  log("Created symlink public/fonts -> src/assets/fonts");
} catch (err) {
  log("Symlink failed; copying instead:", err && err.message ? err.message : err);
  fs.cpSync(source, target, { recursive: true });
  log("Copied fonts into public/fonts");
}
