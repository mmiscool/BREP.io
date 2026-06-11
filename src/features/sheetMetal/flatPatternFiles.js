import {
  buildFlatPatternDxf,
  buildFlatPatternExportData,
  buildFlatPatternSvg,
} from "./flatPatternExport.js";

const MODEL_EXTENSIONS = [
  ".brep.json",
  ".3mf",
  ".json",
];

function sanitizeFlatPatternFileStem(raw, fallback = "flat_pattern") {
  const text = String(raw ?? "").trim();
  const base = text.length ? text : fallback;
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function modelPathToFlatPatternBaseName(raw, fallback = "part") {
  const normalized = String(raw ?? "").replace(/\\/g, "/").trim();
  const last = normalized.split("/").filter(Boolean).pop() || normalized || fallback;
  let stem = String(last || fallback).trim();
  const lower = stem.toLowerCase();
  for (const ext of MODEL_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      stem = stem.slice(0, -ext.length);
      break;
    }
  }
  return sanitizeFlatPatternFileStem(stem, fallback);
}

export function resolveViewerFlatPatternBaseName(viewer, fallback = "part") {
  const candidates = [
    viewer?.fileManagerWidget?.currentName,
    viewer?.fileManagerWidget?.nameInput?.value,
    viewer?.currentName,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return modelPathToFlatPatternBaseName(value, fallback);
  }
  return modelPathToFlatPatternBaseName(fallback, "part");
}

function isSheetMetalSolid(object) {
  return !!(
    object
    && object.type === "SOLID"
    && object.userData?.sheetMetalModel?.tree
  );
}

function collectSheetMetalSolidsFromScene(scene, options = {}) {
  const visibleOnly = options.visibleOnly !== false;
  if (!scene || typeof scene.traverse !== "function") return [];
  const solids = [];
  const seen = new Set();
  scene.traverse((object) => {
    if (!isSheetMetalSolid(object)) return;
    if (visibleOnly && object.visible === false) return;
    if (seen.has(object)) return;
    seen.add(object);
    solids.push(object);
  });
  return solids;
}

export function collectSheetMetalSolidsFromViewer(viewer, options = {}) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  return collectSheetMetalSolidsFromScene(scene, options);
}

function resolveSheetMetalFeatureName(solid, index = 0) {
  const candidates = [
    solid?.userData?.sheetMetalModel?.featureID,
    solid?.userData?.sheetMetal?.featureID,
    solid?.name,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return sanitizeFlatPatternFileStem(value, `sheet_metal_${index + 1}`);
  }
  return `sheet_metal_${index + 1}`;
}

function uniqueStem(baseStem, usedStems) {
  const clean = sanitizeFlatPatternFileStem(baseStem);
  const prior = usedStems.get(clean) || 0;
  usedStems.set(clean, prior + 1);
  if (prior === 0) return clean;
  let suffix = prior + 1;
  let candidate = sanitizeFlatPatternFileStem(`${clean}_${suffix}`);
  while (usedStems.has(candidate)) {
    suffix += 1;
    candidate = sanitizeFlatPatternFileStem(`${clean}_${suffix}`);
  }
  usedStems.set(candidate, 1);
  return candidate;
}

function normalizeDirectory(raw) {
  return String(raw ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => sanitizeFlatPatternFileStem(part, ""))
    .filter(Boolean)
    .join("/");
}

export function buildSheetMetalFlatPatternFiles(solids, options = {}) {
  const targets = (Array.isArray(solids) ? solids : []).filter(isSheetMetalSolid);
  const format = String(options.format || "dxf").toLowerCase() === "svg" ? "svg" : "dxf";
  const extension = format;
  const mime = format === "svg" ? "image/svg+xml;charset=utf-8" : "application/dxf";
  const baseName = modelPathToFlatPatternBaseName(options.baseName, options.fallbackBaseName || "part");
  const includeFeatureName = options.includeFeatureName ?? targets.length > 1;
  const directory = normalizeDirectory(options.directory || "");
  const files = [];
  const skipped = [];
  const usedStems = new Map();

  targets.forEach((solid, index) => {
    const featureName = resolveSheetMetalFeatureName(solid, index);
    try {
      const tree = solid?.userData?.sheetMetalModel?.tree;
      const data = buildFlatPatternExportData(tree);
      if (!Array.isArray(data.cutSegments) || data.cutSegments.length === 0) {
        skipped.push({ solid, featureName, reason: "empty_flat_pattern" });
        return;
      }

      const content = format === "svg"
        ? buildFlatPatternSvg(data)
        : buildFlatPatternDxf(data);
      const rawStem = includeFeatureName ? `${baseName}_${featureName}` : baseName;
      const stem = uniqueStem(rawStem, usedStems);
      const filename = `${stem}.${extension}`;
      const path = directory ? `${directory}/${filename}` : filename;
      files.push({
        path,
        filename,
        stem,
        featureName,
        solid,
        data,
        content,
        mime,
        format,
      });
    } catch (error) {
      skipped.push({ solid, featureName, reason: "export_failed", error });
    }
  });

  return {
    baseName,
    format,
    files,
    skipped,
  };
}

export function buildSheetMetalFlatPatternPackageFiles(solids, options = {}) {
  const result = buildSheetMetalFlatPatternFiles(solids, {
    ...options,
    format: "dxf",
    directory: options.directory || "SheetMetalFlatPatterns",
  });
  const additionalFiles = {};
  for (const file of result.files) {
    additionalFiles[file.path] = file.content;
  }
  return {
    ...result,
    additionalFiles,
    paths: result.files.map((file) => file.path),
  };
}
