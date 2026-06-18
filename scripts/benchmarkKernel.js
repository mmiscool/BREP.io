#!/usr/bin/env node
import { performance } from "node:perf_hooks";

import { BREP } from "../src/BREP/BREP.js";
import { manifoldBuildSource } from "../src/BREP/setupManifold.js";

const { Cube, Cylinder, MeshToBrep, Solid, THREE } = BREP;

function parseArgs(argv) {
  const options = {
    iterations: 3,
    warmup: 1,
    cases: null,
    json: false,
    verify: true,
    list: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const eq = arg.indexOf("=");
      if (eq >= 0) return arg.slice(eq + 1);
      i += 1;
      return argv[i];
    };

    if (arg === "--") continue;
    if (arg === "--json") options.json = true;
    else if (arg === "--no-verify") options.verify = false;
    else if (arg === "--list") options.list = true;
    else if (arg === "--iterations" || arg.startsWith("--iterations=")) {
      options.iterations = Math.max(1, Number.parseInt(readValue(), 10) || 1);
    } else if (arg === "--warmup" || arg.startsWith("--warmup=")) {
      options.warmup = Math.max(0, Number.parseInt(readValue(), 10) || 0);
    } else if (arg === "--case" || arg.startsWith("--case=")) {
      const raw = String(readValue() || "");
      options.cases = raw.split(",").map((name) => name.trim()).filter(Boolean);
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node ./scripts/benchmarkKernel.js [options]

Options:
  --iterations=N   Measured iterations per case. Default: 3
  --warmup=N       Warmup iterations per case. Default: 1
  --case=A,B       Run only matching case names.
  --json           Print JSON instead of the table.
  --no-verify      Skip post-run topology and output checks.
  --list           List benchmark cases.
`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed.");
}

function round(value, digits = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function summarizeTimes(times) {
  const count = times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const mean = times.reduce((sum, value) => sum + value, 0) / count;
  const variance = times.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / count;
  return {
    count,
    minMs: round(min),
    meanMs: round(mean),
    maxMs: round(max),
    stddevMs: round(Math.sqrt(variance)),
  };
}

function formatMs(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "n/a";
}

function analyzeSolidTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = Math.floor(triVerts.length / 3);
  const counts = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const a = triVerts[(triIndex * 3) + 0] >>> 0;
    const b = triVerts[(triIndex * 3) + 1] >>> 0;
    const c = triVerts[(triIndex * 3) + 2] >>> 0;
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const key = edgeKey(u, v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of counts.values()) {
    if (count === 1) boundaryEdgeCount += 1;
    else if (count !== 2) nonManifoldEdgeCount += 1;
  }

  return { triCount, boundaryEdgeCount, nonManifoldEdgeCount };
}

function assertSolidResult(solid, label) {
  assert(solid && typeof solid === "object", `[${label}] Expected a solid result.`);
  assert(solid.type === "SOLID", `[${label}] Expected result type SOLID, got ${solid.type || "unknown"}.`);
  assert(Array.isArray(solid._triVerts) && solid._triVerts.length >= 3, `[${label}] Expected authored triangles.`);
  assert(Array.isArray(solid._vertProperties) && solid._vertProperties.length >= 9, `[${label}] Expected authored vertices.`);
}

function assertClosedManifold(solid, label) {
  assertSolidResult(solid, label);
  const topology = analyzeSolidTopology(solid);
  assert(topology.triCount > 0, `[${label}] Expected at least one triangle.`);
  assert(
    topology.boundaryEdgeCount === 0 && topology.nonManifoldEdgeCount === 0,
    `[${label}] Expected closed manifold topology, got boundary=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
  );
  if (typeof solid._isCoherentlyOrientedManifold === "function") {
    assert(solid._isCoherentlyOrientedManifold() === true, `[${label}] Expected coherent manifold orientation.`);
  }
}

function collectSolidStats(solid) {
  if (!solid || typeof solid !== "object") return {};
  const triangleCount = Array.isArray(solid._triVerts) ? Math.floor(solid._triVerts.length / 3) : 0;
  const vertexCount = Array.isArray(solid._vertProperties) ? Math.floor(solid._vertProperties.length / 3) : 0;
  const faceCount = typeof solid.getFaceNames === "function" ? (solid.getFaceNames() || []).length : 0;
  let volume = null;
  try {
    if (typeof solid.volume === "function") volume = round(solid.volume(), 6);
  } catch {
    volume = null;
  }
  return { triangleCount, vertexCount, faceCount, volume };
}

function cleanupMaterial(material) {
  if (Array.isArray(material)) {
    for (const entry of material) cleanupMaterial(entry);
    return;
  }
  try { material?.dispose?.(); } catch { /* ignore cleanup errors */ }
}

function cleanupSolid(solid, seen = new Set()) {
  if (!solid || seen.has(solid)) return;
  seen.add(solid);
  try { solid.free?.(); } catch { /* ignore cleanup errors */ }
  try {
    solid.traverse?.((child) => {
      try { child?.geometry?.dispose?.(); } catch { /* ignore cleanup errors */ }
      cleanupMaterial(child?.material);
    });
  } catch { /* ignore cleanup errors */ }
}

function cleanupGeometry(geometry) {
  try { geometry?.dispose?.(); } catch { /* ignore cleanup errors */ }
}

function translateSolid(solid, x, y, z) {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  solid.bakeTransform(matrix);
  return solid;
}

function makeTranslatedCube(name, x, y, z, tx, ty, tz) {
  return translateSolid(new Cube({ x, y, z, name }), tx, ty, tz);
}

function findBoundaryBetween(solid, faceA, faceB) {
  const boundaries = typeof solid.getBoundaryEdgePolylines === "function"
    ? (solid.getBoundaryEdgePolylines() || [])
    : [];
  return boundaries.find((candidate) => {
    const a = String(candidate?.faceA || "");
    const b = String(candidate?.faceB || "");
    return (a === faceA && b === faceB) || (a === faceB && b === faceA);
  }) || null;
}

function makeFilletEdgeFromBoundary(solid, boundary, fallbackName) {
  assert(boundary && Array.isArray(boundary.positions) && boundary.positions.length >= 2, "Expected boundary polyline for fillet fixture.");
  return {
    name: String(boundary.name || fallbackName || `${boundary.faceA}|${boundary.faceB}`),
    parentSolid: solid,
    faces: [{ name: boundary.faceA }, { name: boundary.faceB }],
    userData: {
      faceA: boundary.faceA,
      faceB: boundary.faceB,
      polylineLocal: boundary.positions.map((point) => Array.from(point || [])),
      closedLoop: !!boundary.closedLoop,
    },
    closedLoop: !!boundary.closedLoop,
  };
}

function getFaceChild(solid, faceName) {
  return (solid?.children || []).find((child) => child?.type === "FACE" && child.name === faceName) || null;
}

function buildImportGeometry() {
  const geometry = new THREE.TorusKnotGeometry(6, 1.1, 96, 16, 2, 3);
  geometry.computeVertexNormals();
  return geometry;
}

const benchmarks = [
  {
    name: "boolean-subtract",
    description: "Subtracts an offset pocket cube from a larger cube.",
    build() {
      const base = new Cube({ x: 10, y: 8, z: 6, name: "BENCH_BOOL_BASE" });
      const tool = makeTranslatedCube("BENCH_BOOL_TOOL", 4, 5, 4, 3, -1, 1);
      return { base, tool };
    },
    run({ base, tool }) {
      return base.subtract(tool, { overlapConditioningEnabled: false });
    },
    verify(result) {
      assertClosedManifold(result, "boolean-subtract");
      assert(collectSolidStats(result).triangleCount > 12, "[boolean-subtract] Expected subtract result to add topology.");
    },
    cleanup({ base, tool }, result) {
      cleanupSolid(result);
      cleanupSolid(base);
      cleanupSolid(tool);
    },
  },
  {
    name: "union-many",
    description: "Batch-unions a connected chain of overlapping cubes.",
    build() {
      const solids = [];
      for (let i = 0; i < 12; i += 1) {
        solids.push(makeTranslatedCube(
          `BENCH_UNION_${i}`,
          2.2,
          2,
          2,
          i * 1.45,
          (i % 3) * 0.35,
          (i % 2) * 0.25,
        ));
      }
      return { solids };
    },
    run({ solids }) {
      return Solid.unionMany(solids, {
        featureID: "BENCH_UNION_MANY",
        name: "BENCH_UNION_MANY",
        overlapConditioningEnabled: false,
      });
    },
    verify(result) {
      assertClosedManifold(result, "union-many");
      const diagnostics = result?.__unionManyDiagnostics || {};
      assert(
        diagnostics.contributedSolidCount === 12,
        `[union-many] Expected all 12 solids to contribute, got ${diagnostics.contributedSolidCount}.`,
      );
    },
    stats(result) {
      return {
        ...collectSolidStats(result),
        unionStrategy: result?.__unionManyDiagnostics?.unionStrategy || "unknown",
      };
    },
    cleanup({ solids }, result) {
      cleanupSolid(result);
      for (const solid of solids) cleanupSolid(solid);
    },
  },
  {
    name: "mesh-to-brep",
    description: "Converts an indexed TorusKnot BufferGeometry through MeshToBrep.",
    build() {
      const geometry = buildImportGeometry();
      const index = geometry.getIndex();
      const position = geometry.getAttribute("position");
      const sourceTriangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
      return { geometry, sourceTriangleCount };
    },
    run({ geometry }) {
      return new MeshToBrep(geometry, 25, 1e-5, {
        extractPlanarFaces: true,
        planarMinAreaPercent: 2,
      });
    },
    verify(result, { sourceTriangleCount }) {
      assertSolidResult(result, "mesh-to-brep");
      const stats = collectSolidStats(result);
      assert(stats.triangleCount === sourceTriangleCount, `[mesh-to-brep] Expected ${sourceTriangleCount} triangles, got ${stats.triangleCount}.`);
      assert(stats.faceCount > 0, "[mesh-to-brep] Expected at least one face label.");
    },
    cleanup({ geometry }, result) {
      cleanupSolid(result);
      cleanupGeometry(geometry);
    },
  },
  {
    name: "face-thicken",
    description: "Thickens a cylindrical side face into a closed shell.",
    build() {
      const source = new Cylinder({
        radius: 3,
        height: 8,
        resolution: 64,
        name: "BENCH_THICK_SRC",
        centerlines: false,
      });
      source.visualize();
      const face = getFaceChild(source, "BENCH_THICK_SRC_S");
      assert(face?.type === "FACE", "[face-thicken] Expected source side face.");
      return { source, face };
    },
    run({ face }) {
      return face.thicken(0.75, { featureId: "BENCH_THICK" });
    },
    verify(result) {
      assertClosedManifold(result, "face-thicken");
      const diagnostics = result?.__thickenDiagnostics || {};
      assert(diagnostics.buildMethod, "[face-thicken] Expected thicken diagnostics.");
    },
    stats(result) {
      return {
        ...collectSolidStats(result),
        buildMethod: result?.__thickenDiagnostics?.buildMethod || "unknown",
        splitCullPasses: result?.__thickenDiagnostics?.splitCullPasses ?? null,
      };
    },
    cleanup({ source }, result) {
      cleanupSolid(result);
      cleanupSolid(source);
    },
  },
  {
    name: "fillet",
    description: "Applies one native inset fillet to a cube boundary edge.",
    build() {
      const cube = new Cube({ x: 8, y: 8, z: 8, name: "BENCH_FILLET_CUBE" });
      const boundary = findBoundaryBetween(cube, "BENCH_FILLET_CUBE_NX", "BENCH_FILLET_CUBE_NY");
      const edge = makeFilletEdgeFromBoundary(cube, boundary, "BENCH_FILLET_CUBE_NX|BENCH_FILLET_CUBE_NY");
      return { cube, edge };
    },
    async run({ cube, edge }) {
      return cube.fillet({
        radius: 0.75,
        edges: [edge],
        direction: "INSET",
        resolution: 24,
        featureID: "BENCH_FILLET",
      });
    },
    verify(result) {
      assertClosedManifold(result, "fillet");
      const stats = collectSolidStats(result);
      assert(stats.triangleCount > 12, "[fillet] Expected fillet result to add topology.");
      const faceNames = typeof result.getFaceNames === "function" ? (result.getFaceNames() || []) : [];
      assert(
        faceNames.some((name) => String(name || "").includes("_TUBE_Outer")),
        "[fillet] Expected a retained round tube face.",
      );
    },
    cleanup({ cube }, result) {
      cleanupSolid(result);
      cleanupSolid(cube);
    },
  },
];

async function executeIteration(benchmark, verify) {
  let fixture = null;
  let result = null;
  try {
    fixture = await benchmark.build();
    const start = performance.now();
    result = await benchmark.run(fixture);
    const elapsedMs = performance.now() - start;
    if (verify && typeof benchmark.verify === "function") {
      await benchmark.verify(result, fixture);
    }
    const stats = typeof benchmark.stats === "function"
      ? benchmark.stats(result, fixture)
      : collectSolidStats(result);
    return { elapsedMs, stats };
  } finally {
    try { await benchmark.cleanup?.(fixture || {}, result); } catch { /* ignore cleanup errors */ }
  }
}

async function runBenchmark(benchmark, options) {
  for (let i = 0; i < options.warmup; i += 1) {
    await executeIteration(benchmark, options.verify);
  }

  const times = [];
  let lastStats = {};
  for (let i = 0; i < options.iterations; i += 1) {
    const iteration = await executeIteration(benchmark, options.verify);
    times.push(iteration.elapsedMs);
    lastStats = iteration.stats || {};
  }

  return {
    name: benchmark.name,
    description: benchmark.description,
    timing: summarizeTimes(times),
    stats: lastStats,
  };
}

function printTable(results, options) {
  console.log(`BREP kernel benchmarks`);
  console.log(`manifold source: ${manifoldBuildSource}`);
  console.log(`iterations: ${options.iterations}, warmup: ${options.warmup}, verify: ${options.verify ? "on" : "off"}`);
  console.log("");
  console.log([
    "case".padEnd(18),
    "mean ms".padStart(10),
    "min ms".padStart(10),
    "max ms".padStart(10),
    "triangles".padStart(10),
    "vertices".padStart(10),
    "faces".padStart(7),
  ].join("  "));
  console.log("-".repeat(85));
  for (const result of results) {
    const stats = result.stats || {};
    console.log([
      result.name.padEnd(18),
      formatMs(result.timing.meanMs).padStart(10),
      formatMs(result.timing.minMs).padStart(10),
      formatMs(result.timing.maxMs).padStart(10),
      String(stats.triangleCount ?? "n/a").padStart(10),
      String(stats.vertexCount ?? "n/a").padStart(10),
      String(stats.faceCount ?? "n/a").padStart(7),
    ].join("  "));
  }
  console.log("");
  console.log("Use --json for full stats, including union/thicken diagnostics.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const benchmark of benchmarks) {
      console.log(`${benchmark.name}\t${benchmark.description}`);
    }
    return;
  }

  const selected = options.cases
    ? benchmarks.filter((benchmark) => options.cases.includes(benchmark.name))
    : benchmarks;
  const missing = options.cases
    ? options.cases.filter((name) => !benchmarks.some((benchmark) => benchmark.name === name))
    : [];
  if (missing.length > 0) {
    throw new Error(`Unknown benchmark case(s): ${missing.join(", ")}`);
  }
  if (selected.length === 0) {
    throw new Error("No benchmark cases selected.");
  }

  const results = [];
  for (const benchmark of selected) {
    results.push(await runBenchmark(benchmark, options));
  }

  if (options.json) {
    console.log(JSON.stringify({
      manifoldSource: manifoldBuildSource,
      iterations: options.iterations,
      warmup: options.warmup,
      verify: options.verify,
      results,
    }, null, 2));
  } else {
    printTable(results, options);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
