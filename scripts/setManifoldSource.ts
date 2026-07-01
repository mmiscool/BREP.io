import { readManifoldSource, writeManifoldSource } from "./manifoldSourceConfig.js";

const requested = String(process.argv[2] || "").trim();

if (!requested) {
  console.log(readManifoldSource());
  process.exit(0);
}

if (requested !== "local") {
  console.error("Usage: tsx ./scripts/setManifoldSource.ts <local>");
  process.exit(1);
}

const source = writeManifoldSource(requested);
console.log(`[manifold-source] Active source: ${source}`);
