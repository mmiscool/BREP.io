import { readManifoldSource, writeManifoldSource } from "./manifoldSourceConfig.js";

const requested = String(process.argv[2] || "").trim();

if (!requested) {
  console.log(readManifoldSource());
  process.exit(0);
}

if (requested !== "npm" && requested !== "local") {
  console.error("Usage: node ./scripts/setManifoldSource.js <npm|local>");
  process.exit(1);
}

const source = writeManifoldSource(requested);
console.log(`[manifold-source] Active source: ${source}`);
