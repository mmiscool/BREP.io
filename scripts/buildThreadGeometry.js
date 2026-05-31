import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSolidAuthoringStateSnapshot } from '../src/BREP/CppSolidCore.js';
import { ThreadGeometry, ThreadStandard } from '../src/BREP/threadGeometry.js';
import { THREAD_DESIGNATION_PRESETS } from '../src/features/hole/threadDesignationCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const defaultOutPath = resolve(repoRoot, 'src/generated/threadGeometryCatalog.js');

const TEMPLATE_NAME = '__MODELED_THREAD_TEMPLATE__';
const TEMPLATE_FACE = '__MODELED_THREAD_TEMPLATE_FACE__';
const DEFAULT_RESOLUTION = 48;
const DEFAULT_SEGMENTS_PER_TURN = 32;
const TEMPLATE_LENGTH_DIAMETER_MULTIPLIER = 50;
const INCH_TO_MM = 25.4;

const enabledStandards = [
  ThreadStandard.ISO_METRIC,
  ThreadStandard.UNIFIED,
  ThreadStandard.TRAPEZOIDAL_METRIC,
  ThreadStandard.ACME,
  ThreadStandard.STUB_ACME,
  ThreadStandard.WHITWORTH,
];

function parseNumberLike(value) {
  const raw = String(value || '').trim();
  const frac = raw.match(/^([0-9]+)\/([0-9]+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function gaugeToInch(n) {
  return 0.06 + 0.013 * n;
}

function parseDiaTpi(designation) {
  const clean = String(designation || '').replace(/\s+/g, '').toUpperCase();
  const m = clean.match(/^#?([0-9./]+)-([0-9.]+)([A-Z]+)?$/);
  if (!m) return null;
  const rawDia = m[1];
  const tpi = Number(m[2]);
  let dia = parseNumberLike(rawDia);
  if (/^[0-9]+$/.test(rawDia) && (!Number.isFinite(dia) || dia > 1.5)) {
    const gauge = Number(rawDia);
    if (Number.isFinite(gauge) && gauge >= 0 && gauge <= 14) dia = gaugeToInch(gauge);
  }
  if (!Number.isFinite(dia) || !Number.isFinite(tpi) || dia <= 0 || tpi <= 0) return null;
  return { dia, tpi };
}

function threadFromPreset(standard, designation) {
  const clean = String(designation || '').replace(/\s+/g, '').toUpperCase();
  switch (standard) {
    case ThreadStandard.ISO_METRIC:
      return ThreadGeometry.fromMetricDesignation(clean.replace(/×/g, 'X'), { isExternal: false });
    case ThreadStandard.TRAPEZOIDAL_METRIC:
      return ThreadGeometry.fromTrapezoidalDesignation(clean.replace(/×/g, 'X').replace(/^TR?/, 'TR'), { isExternal: false });
    case ThreadStandard.UNIFIED: {
      const parsed = parseDiaTpi(clean);
      if (!parsed) return null;
      return ThreadGeometry.fromUnified(parsed.dia * INCH_TO_MM, parsed.tpi / INCH_TO_MM, { isExternal: false });
    }
    case ThreadStandard.ACME: {
      const parsed = parseDiaTpi(clean);
      if (!parsed) return null;
      return ThreadGeometry.fromAcme(parsed.dia * INCH_TO_MM, parsed.tpi / INCH_TO_MM, { isExternal: false });
    }
    case ThreadStandard.STUB_ACME: {
      const parsed = parseDiaTpi(clean);
      if (!parsed) return null;
      return ThreadGeometry.fromStubAcme(parsed.dia * INCH_TO_MM, parsed.tpi / INCH_TO_MM, { isExternal: false });
    }
    case ThreadStandard.WHITWORTH: {
      const parsed = parseDiaTpi(clean);
      if (!parsed) return null;
      return ThreadGeometry.fromWhitworth(parsed.dia * INCH_TO_MM, parsed.tpi / INCH_TO_MM, { isExternal: false });
    }
    default:
      return null;
  }
}

function templateLengthFor(thread) {
  const diameter = Math.max(1e-9, Math.abs(Number(thread?.nominalDiameter) || 0));
  return diameter * TEMPLATE_LENGTH_DIAMETER_MULTIPLIER;
}

function templateKey(thread, length) {
  return JSON.stringify({
    standard: thread.standard,
    nominalDiameter: thread.nominalDiameter,
    pitch: thread.pitch,
    isExternal: thread.isExternal,
    starts: thread.starts,
    taperDirection: thread.taperDirection,
    length,
    radialOffset: 0,
    includeCore: false,
    resolution: DEFAULT_RESOLUTION,
    segmentsPerTurn: DEFAULT_SEGMENTS_PER_TURN,
  });
}

function snapshotFor(thread, length) {
  const solid = thread.toSolid({
    length,
    mode: 'modeled',
    radialOffset: 0,
    symbolicRadius: 'crest',
    includeCore: false,
    resolution: DEFAULT_RESOLUTION,
    segmentsPerTurn: DEFAULT_SEGMENTS_PER_TURN,
    name: TEMPLATE_NAME,
    faceName: TEMPLATE_FACE,
    transform: {},
    axis: [0, 0, 1],
    origin: [0, 0, 0],
    xDirection: [1, 0, 0],
    useModeledThreadTemplateCache: false,
  });
  const rawSnapshot = getSolidAuthoringStateSnapshot(solid);
  const snapshot = {
    ...rawSnapshot,
    faceNameToID: Array.from(rawSnapshot?.faceNameToID?.entries?.() || rawSnapshot?.faceNameToID || []),
    idToFaceName: Array.from(rawSnapshot?.idToFaceName?.entries?.() || rawSnapshot?.idToFaceName || []),
    faceMetadataJson: Array.from(rawSnapshot?.faceMetadataJson?.entries?.() || rawSnapshot?.faceMetadataJson || []),
    edgeMetadataJson: Array.from(rawSnapshot?.edgeMetadataJson?.entries?.() || rawSnapshot?.edgeMetadataJson || []),
  };
  snapshot.name = TEMPLATE_NAME;
  try { solid.free?.(); } catch { /* ignore */ }
  return snapshot;
}

function writeCatalogFile() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Math.max(0, Number(limitArg.slice('--limit='.length)) || 0) : Infinity;
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const outPath = outArg ? resolve(repoRoot, outArg.slice('--out='.length)) : defaultOutPath;
  const outDir = dirname(outPath);
  const chunkDir = resolve(outDir, 'threadGeometryCatalogChunks');
  const tmpOutPath = `${outPath}.tmp`;
  const tmpChunkDir = `${chunkDir}.tmp`;
  const summary = [];
  const chunks = [];
  const seenKeys = new Set();
  let count = 0;

  mkdirSync(outDir, { recursive: true });
  rmSync(tmpChunkDir, { recursive: true, force: true });
  mkdirSync(tmpChunkDir, { recursive: true });

  const originalLog = console.log;
  const originalWarn = console.warn;
  if (process.env.VERBOSE_THREAD_GEOMETRY_BUILD !== '1') {
    console.log = () => {};
    console.warn = () => {};
  }
  try {
    for (const standard of enabledStandards) {
      const presets = THREAD_DESIGNATION_PRESETS[standard] || [];
      for (const preset of presets) {
        if (count >= limit) break;
        const designation = preset?.value || preset?.label || preset;
        const thread = threadFromPreset(standard, designation);
        if (!thread || thread.isTapered || thread.starts !== 1) continue;
        const length = templateLengthFor(thread);
        const key = templateKey(thread, length);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const snapshot = snapshotFor(thread, length);
        const chunkName = `entry${count}.js`;
        writeFileSync(resolve(tmpChunkDir, chunkName), `// Auto-generated by scripts/buildThreadGeometry.js
export const SNAPSHOT = ${JSON.stringify(snapshot)};
`);
        chunks.push({ key, chunkName });
        summary.push({ standard, designation, key, triangles: snapshot.triVerts.length / 3 });
        count += 1;
      }
      if (count >= limit) break;
    }
  } catch (error) {
    try { rmSync(tmpOutPath, { force: true }); } catch { /* ignore */ }
    try { rmSync(tmpChunkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw error;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  const generatedAt = new Date().toISOString();
  const imports = chunks
    .map((chunk, index) => `import { SNAPSHOT as SNAPSHOT_${index} } from './threadGeometryCatalogChunks/${chunk.chunkName}';`)
    .join('\n');
  const entries = chunks
    .map((chunk, index) => `  [${JSON.stringify(chunk.key)}, SNAPSHOT_${index}],`)
    .join('\n');
  const source = `// Auto-generated by scripts/buildThreadGeometry.js
// Generated at ${generatedAt}
// Entries: ${summary.length}
import { Solid } from '../BREP/BetterSolid.js';
import { applySolidAuthoringStateSnapshot } from '../BREP/CppSolidCore.js';
${imports}

export const PRECOMPUTED_MODELED_THREAD_SOLID_SNAPSHOTS = Object.fromEntries([
${entries}
]);

export const PRECOMPUTED_MODELED_THREAD_SOLID_SUMMARY = ${JSON.stringify(summary, null, 2)};

export function createPrecomputedModeledThreadSolid(key) {
  const snapshot = PRECOMPUTED_MODELED_THREAD_SOLID_SNAPSHOTS[key];
  if (!snapshot) return null;
  const solid = new Solid();
  applySolidAuthoringStateSnapshot(solid, snapshot);
  const oldIdToName = new Map(solid._idToFaceName);
  const oldToNew = new Map();
  solid._faceNameToID = new Map();
  solid._idToFaceName = new Map();
  for (const [oldId, faceName] of oldIdToName.entries()) {
    const newId = solid._getOrCreateID(faceName);
    oldToNew.set(Number(oldId), newId);
  }
  solid._triIDs = Array.from(solid._triIDs || [], (oldId) => oldToNew.get(Number(oldId)) ?? solid._getOrCreateID('FACE'));
  solid._dirty = true;
  solid._manifold = null;
  solid._faceIndex = null;
  solid.name = snapshot.name || 'PrecomputedThread';
  return solid;
}
`;
  writeFileSync(tmpOutPath, source);
  rmSync(chunkDir, { recursive: true, force: true });
  renameSync(tmpChunkDir, chunkDir);
  renameSync(tmpOutPath, outPath);
  return { summary, outPath };
}

const { summary, outPath } = writeCatalogFile();
console.log(`[buildThreadGeometry] Wrote ${summary.length} precomputed modeled thread solids to ${outPath}`);
process.exit(0);
