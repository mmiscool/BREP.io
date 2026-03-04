import { BREP } from "../../BREP/BREP.js";
import { NurbsCageEditorSession } from "./NurbsCageEditorSession.js";
import {
  DEFAULT_CAGE_DIVISIONS,
  DEFAULT_CAGE_PADDING,
  addTriangleFacingOutward,
  cageIndexFromId,
  cloneCageData,
  computeBoundsFromPoints,
  computeCenterFromBounds,
  deformPointsWithCage,
  normalizeCageData,
  sanitizeCageDivisions,
} from "./nurbsFaceSolidUtils.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the NURBS face solid feature",
  },
  basePrimitive: {
    type: "options",
    default_value: "CUBE",
    options: ["CUBE", "SPHERE", "CYLINDER", "TORUS"],
    hint: "Base primitive used to initialize the deformable volume",
  },
  volumeSize: {
    type: "number",
    default_value: 10,
    hint: "Starting primitive size",
  },
  volumeDensity: {
    type: "number",
    default_value: 20,
    hint: "Surface subdivision density",
  },
  cageDivisionsU: {
    type: "number",
    default_value: DEFAULT_CAGE_DIVISIONS[0],
    hint: "Control cage columns (U)",
  },
  cageDivisionsV: {
    type: "number",
    default_value: DEFAULT_CAGE_DIVISIONS[1],
    hint: "Control cage rows (V)",
  },
  cageDivisionsW: {
    type: "number",
    default_value: DEFAULT_CAGE_DIVISIONS[2],
    hint: "Control cage layers (W)",
  },
  cagePadding: {
    type: "number",
    default_value: DEFAULT_CAGE_PADDING,
    hint: "Default cage padding around the source bounds",
  },
  cageEditor: {
    type: "string",
    label: "Control Cage",
    hint: "Edit control points around the generated volume; drag points in the viewport",
    renderWidget: renderCageEditorWidget,
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: "NONE" },
    hint: "Optional boolean operation with selected solids",
  },
};

const DEFAULT_VOLUME_SIZE = 10;
const DEFAULT_VOLUME_DENSITY = 20;
const DEFAULT_BASE_PRIMITIVE = "CUBE";
const DEFAULT_EDITOR_OPTIONS = Object.freeze({
  showEdges: true,
  showControlPoints: true,
  allowX: true,
  allowY: true,
  allowZ: true,
  symmetryX: false,
  symmetryY: false,
  symmetryZ: false,
  cageColor: "#70d6ff",
});

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeHexColor(value, fallback = DEFAULT_EDITOR_OPTIONS.cageColor) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[\da-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[\da-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function computeSignature(data) {
  let json = "";
  try {
    json = JSON.stringify(data || null);
  } catch {
    json = String(Date.now());
  }
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash * 31) + json.charCodeAt(i)) | 0;
  }
  return `${json.length}:${hash >>> 0}`;
}

function readDivisionsFromFeature(feature) {
  return sanitizeCageDivisions([
    feature?.inputParams?.cageDivisionsU,
    feature?.inputParams?.cageDivisionsV,
    feature?.inputParams?.cageDivisionsW,
  ], DEFAULT_CAGE_DIVISIONS);
}

function readPaddingFromFeature(feature) {
  return normalizeNumber(feature?.inputParams?.cagePadding, DEFAULT_CAGE_PADDING);
}

function normalizeEditorOptions(rawOptions) {
  const raw = (rawOptions && typeof rawOptions === "object") ? rawOptions : null;
  const legacySymmetry = normalizeBoolean(raw?.symmetryMode, false);
  return {
    showEdges: normalizeBoolean(raw?.showEdges, DEFAULT_EDITOR_OPTIONS.showEdges),
    showControlPoints: normalizeBoolean(raw?.showControlPoints, DEFAULT_EDITOR_OPTIONS.showControlPoints),
    allowX: normalizeBoolean(raw?.allowX, DEFAULT_EDITOR_OPTIONS.allowX),
    allowY: normalizeBoolean(raw?.allowY, DEFAULT_EDITOR_OPTIONS.allowY),
    allowZ: normalizeBoolean(raw?.allowZ, DEFAULT_EDITOR_OPTIONS.allowZ),
    symmetryX: normalizeBoolean(
      raw?.symmetryX,
      legacySymmetry ? true : DEFAULT_EDITOR_OPTIONS.symmetryX,
    ),
    symmetryY: normalizeBoolean(
      raw?.symmetryY,
      legacySymmetry ? true : DEFAULT_EDITOR_OPTIONS.symmetryY,
    ),
    symmetryZ: normalizeBoolean(
      raw?.symmetryZ,
      legacySymmetry ? true : DEFAULT_EDITOR_OPTIONS.symmetryZ,
    ),
    cageColor: normalizeHexColor(raw?.cageColor, DEFAULT_EDITOR_OPTIONS.cageColor),
  };
}

function readEditorOptionsFromFeature(feature) {
  return normalizeEditorOptions(feature?.persistentData?.editorOptions);
}

function normalizeBasePrimitive(value) {
  const token = String(value ?? "").trim().toUpperCase();
  if (token === "SPHERE") return "SPHERE";
  if (token === "CYLINDER") return "CYLINDER";
  if (token === "TORUS") return "TORUS";
  return DEFAULT_BASE_PRIMITIVE;
}

function readBasePrimitive(feature) {
  return normalizeBasePrimitive(feature?.inputParams?.basePrimitive);
}

function readVolumeParams(feature) {
  const legacyRadius = Math.max(1e-6, Math.abs(normalizeNumber(feature?.inputParams?.radius, DEFAULT_VOLUME_SIZE * 0.5)));
  const fallbackSize = Math.max(1e-6, legacyRadius * 2);
  const size = Math.max(1e-6, Math.abs(normalizeNumber(feature?.inputParams?.volumeSize, fallbackSize)));

  const fallbackDensity = Math.max(2, Math.min(128, Math.floor(normalizeNumber(
    feature?.inputParams?.resolution,
    DEFAULT_VOLUME_DENSITY,
  ))));
  const density = Math.max(2, Math.min(128, Math.floor(normalizeNumber(
    feature?.inputParams?.volumeDensity,
    fallbackDensity,
  ))));
  return { size, density };
}

function buildCubeSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const half = size * 0.5;
  const steps = Math.max(1, density | 0);
  const vertexMap = new Map();
  const vertices = [];
  const triangles = [];

  const toKey = (x, y, z) => `${x.toFixed(10)}:${y.toFixed(10)}:${z.toFixed(10)}`;
  const addVertex = (x, y, z) => {
    const key = toKey(x, y, z);
    const cached = vertexMap.get(key);
    if (cached != null) return cached;
    const index = vertices.length;
    vertices.push([x, y, z]);
    vertexMap.set(key, index);
    return index;
  };
  const addTriangle = (a, b, c) => {
    if (a === b || b === c || c === a) return;
    triangles.push([a, b, c]);
  };
  const toCoord = (t) => -half + (size * t);
  const emitFace = (samplePoint) => {
    for (let iu = 0; iu < steps; iu++) {
      const u0 = iu / steps;
      const u1 = (iu + 1) / steps;
      for (let iv = 0; iv < steps; iv++) {
        const v0 = iv / steps;
        const v1 = (iv + 1) / steps;
        const p00 = samplePoint(u0, v0);
        const p10 = samplePoint(u1, v0);
        const p11 = samplePoint(u1, v1);
        const p01 = samplePoint(u0, v1);
        const i00 = addVertex(p00[0], p00[1], p00[2]);
        const i10 = addVertex(p10[0], p10[1], p10[2]);
        const i11 = addVertex(p11[0], p11[1], p11[2]);
        const i01 = addVertex(p01[0], p01[1], p01[2]);
        addTriangle(i00, i10, i11);
        addTriangle(i00, i11, i01);
      }
    }
  };

  try {
    emitFace((u, v) => [half, toCoord(u), toCoord(v)]);
    emitFace((u, v) => [-half, toCoord(u), toCoord(v)]);
    emitFace((u, v) => [toCoord(u), half, toCoord(v)]);
    emitFace((u, v) => [toCoord(u), -half, toCoord(v)]);
    emitFace((u, v) => [toCoord(u), toCoord(v), half]);
    emitFace((u, v) => [toCoord(u), toCoord(v), -half]);

    const bounds = {
      min: [-half, -half, -half],
      max: [half, half, half],
    };
    const sourceSignature = `cube:${size}:${steps}:${vertices.length}:${triangles.length}`;
    return {
      shape: "cube",
      size,
      density: steps,
      vertices,
      triangles,
      bounds,
      sourceSignature,
    };
  } catch (error) {
    console.warn("[NURBS] Failed to build cube source:", error?.message || error);
    return null;
  }
}

function buildSphereSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const radius = Math.max(1e-6, size * 0.5);
  const resolution = Math.max(8, Math.min(128, density | 0));
  const sphere = new BREP.Sphere({
    r: radius,
    resolution,
    name: "__NURBS_CAGE_BASE__",
  });
  let mesh = null;
  try {
    mesh = sphere.getMesh();
    const vp = mesh?.vertProperties;
    const tv = mesh?.triVerts;
    if (!vp || !tv || vp.length < 9 || tv.length < 3) return null;

    const vertices = [];
    for (let i = 0; i < vp.length; i += 3) {
      vertices.push([vp[i + 0], vp[i + 1], vp[i + 2]]);
    }

    const triangles = [];
    const triCount = (tv.length / 3) | 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = tv[t * 3 + 0] >>> 0;
      const i1 = tv[t * 3 + 1] >>> 0;
      const i2 = tv[t * 3 + 2] >>> 0;
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      triangles.push([i0, i1, i2]);
    }

    const bounds = computeBoundsFromPoints(vertices);
    const sourceSignature = `sphere:${radius}:${resolution}:${vertices.length}:${triangles.length}`;
    return {
      shape: "sphere",
      size,
      density: resolution,
      vertices,
      triangles,
      bounds,
      sourceSignature,
    };
  } catch (error) {
    console.warn("[NURBS] Failed to build sphere source:", error?.message || error);
    return null;
  } finally {
    try { mesh?.delete?.(); } catch { }
    try { sphere?.free?.(); } catch { }
    try { sphere?.delete?.(); } catch { }
  }
}

function buildCylinderSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const height = Math.max(1e-6, size);
  const radius = Math.max(1e-6, size * 0.35);
  const aroundSteps = Math.max(8, Math.min(128, density | 0));
  const heightSteps = Math.max(4, Math.min(128, density | 0));
  const radialSteps = Math.max(3, Math.min(64, Math.floor((density | 0) * 0.5)));
  const halfHeight = height * 0.5;
  const vertices = [];
  const triangles = [];

  const addVertex = (x, y, z) => {
    vertices.push([x, y, z]);
    return vertices.length - 1;
  };
  const addTriangle = (a, b, c) => {
    if (a === b || b === c || c === a) return;
    triangles.push([a, b, c]);
  };
  const pointOnRing = (r, angle) => [Math.cos(angle) * r, Math.sin(angle) * r];

  try {
    // Side wall grid with vertical subdivision to avoid long triangles.
    const sideRings = [];
    for (let h = 0; h <= heightSteps; h++) {
      const v = h / heightSteps;
      const y = -halfHeight + (height * v);
      const ring = [];
      for (let a = 0; a < aroundSteps; a++) {
        const angle = (Math.PI * 2 * a) / aroundSteps;
        const [x, z] = pointOnRing(radius, angle);
        ring.push(addVertex(x, y, z));
      }
      sideRings.push(ring);
    }

    for (let h = 0; h < heightSteps; h++) {
      const lower = sideRings[h];
      const upper = sideRings[h + 1];
      for (let a = 0; a < aroundSteps; a++) {
        const next = (a + 1) % aroundSteps;
        const i00 = lower[a];
        const i01 = lower[next];
        const i10 = upper[a];
        const i11 = upper[next];
        addTriangle(i00, i10, i11);
        addTriangle(i00, i11, i01);
      }
    }

    const stitchCap = (outerRing, y) => {
      let prevRing = outerRing;
      for (let rs = radialSteps - 1; rs >= 1; rs--) {
        const r = radius * (rs / radialSteps);
        const ring = [];
        for (let a = 0; a < aroundSteps; a++) {
          const angle = (Math.PI * 2 * a) / aroundSteps;
          const [x, z] = pointOnRing(r, angle);
          ring.push(addVertex(x, y, z));
        }
        for (let a = 0; a < aroundSteps; a++) {
          const next = (a + 1) % aroundSteps;
          const o0 = prevRing[a];
          const o1 = prevRing[next];
          const i0 = ring[a];
          const i1 = ring[next];
          addTriangle(o0, o1, i1);
          addTriangle(o0, i1, i0);
        }
        prevRing = ring;
      }

      const center = addVertex(0, y, 0);
      for (let a = 0; a < aroundSteps; a++) {
        const next = (a + 1) % aroundSteps;
        addTriangle(prevRing[a], prevRing[next], center);
      }
    };

    const bottomOuter = sideRings[0];
    const topOuter = sideRings[sideRings.length - 1];
    stitchCap(topOuter, halfHeight);
    stitchCap(bottomOuter, -halfHeight);

    if (!vertices.length || !triangles.length) return null;
    const bounds = {
      min: [-radius, -halfHeight, -radius],
      max: [radius, halfHeight, radius],
    };
    const sourceSignature = `cylinder:${radius}:${height}:${aroundSteps}:${heightSteps}:${radialSteps}:${vertices.length}:${triangles.length}`;
    return {
      shape: "cylinder",
      size,
      density: aroundSteps,
      vertices,
      triangles,
      bounds,
      sourceSignature,
    };
  } catch (error) {
    console.warn("[NURBS] Failed to build cylinder source:", error?.message || error);
    return null;
  }
}

function buildTorusSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const majorRadius = Math.max(1e-6, size * 0.32);
  const minorRadius = Math.max(1e-6, size * 0.18);
  const resolution = Math.max(12, Math.min(128, Math.floor(density * 1.5)));
  const torus = new BREP.Torus({
    mR: majorRadius,
    tR: minorRadius,
    resolution,
    arcDegrees: 360,
    name: "__NURBS_CAGE_BASE__",
  });
  let mesh = null;
  try {
    mesh = torus.getMesh();
    const vp = mesh?.vertProperties;
    const tv = mesh?.triVerts;
    if (!vp || !tv || vp.length < 9 || tv.length < 3) return null;

    const vertices = [];
    for (let i = 0; i < vp.length; i += 3) {
      vertices.push([vp[i + 0], vp[i + 1], vp[i + 2]]);
    }

    const triangles = [];
    const triCount = (tv.length / 3) | 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = tv[t * 3 + 0] >>> 0;
      const i1 = tv[t * 3 + 1] >>> 0;
      const i2 = tv[t * 3 + 2] >>> 0;
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      triangles.push([i0, i1, i2]);
    }

    const bounds = computeBoundsFromPoints(vertices);
    const sourceSignature = `torus:${majorRadius}:${minorRadius}:${resolution}:${vertices.length}:${triangles.length}`;
    return {
      shape: "torus",
      size,
      density: resolution,
      vertices,
      triangles,
      bounds,
      sourceSignature,
    };
  } catch (error) {
    console.warn("[NURBS] Failed to build torus source:", error?.message || error);
    return null;
  } finally {
    try { mesh?.delete?.(); } catch { }
    try { torus?.free?.(); } catch { }
    try { torus?.delete?.(); } catch { }
  }
}

function buildSource(feature) {
  const primitive = readBasePrimitive(feature);
  if (primitive === "TORUS") return buildTorusSource(feature);
  if (primitive === "CYLINDER") return buildCylinderSource(feature);
  if (primitive === "SPHERE") return buildSphereSource(feature);
  return buildCubeSource(feature);
}

function readCageForSource(feature, _source) {
  const raw = feature?.persistentData?.cage || null;
  if (!raw) return null;
  // Keep existing control-point positions even when base primitive or source density changes.
  // normalizeCageData will refresh sourceSignature while preserving valid points.
  return raw;
}

function markFeatureDirtyWithCage(feature, cage) {
  if (!feature) return;
  feature.lastRunInputParams = {};
  feature.timestamp = 0;
  feature.dirty = true;
  feature.persistentData = feature.persistentData || {};
  feature.persistentData.cage = cloneCageData(cage);
}

function markFeatureDirtyWithEditorOptions(feature, editorOptions) {
  if (!feature) return;
  feature.lastRunInputParams = {};
  feature.timestamp = 0;
  feature.dirty = true;
  feature.persistentData = feature.persistentData || {};
  feature.persistentData.editorOptions = normalizeEditorOptions(editorOptions);
}

function colorIntFromHex(value, fallback = DEFAULT_EDITOR_OPTIONS.cageColor) {
  const normalized = normalizeHexColor(value, fallback);
  return parseInt(normalized.slice(1), 16);
}

function applyEditorVisualsToSolid(solid, editorOptions) {
  if (!solid || !Array.isArray(solid.children)) return;
  const options = normalizeEditorOptions(editorOptions);
  const faceColor = colorIntFromHex(options.cageColor, DEFAULT_EDITOR_OPTIONS.cageColor);
  const edgeColor = 0xe8f7ff;

  for (const child of solid.children) {
    if (!child) continue;
    if (child.type === "FACE" && child.material) {
      let faceMat = child.material;
      if (typeof faceMat.clone === "function") {
        try { faceMat = faceMat.clone(); } catch { }
      }
      try { faceMat?.color?.setHex?.(faceColor); } catch { }
      try { faceMat.transparent = true; } catch { }
      try { faceMat.opacity = 0.92; } catch { }
      try { faceMat.emissive?.setHex?.(faceColor); } catch { }
      try { faceMat.emissiveIntensity = 0.08; } catch { }
      if (faceMat) child.material = faceMat;
      continue;
    }

    if (child.type === "EDGE") {
      child.visible = !!options.showEdges;
      let edgeMat = child.material;
      if (edgeMat && typeof edgeMat.clone === "function") {
        try { edgeMat = edgeMat.clone(); } catch { }
      }
      try { edgeMat?.color?.setHex?.(edgeColor); } catch { }
      if (edgeMat) child.material = edgeMat;
    }
  }
}

function buildCageCandidateForWidget(feature) {
  const divisions = readDivisionsFromFeature(feature);
  const padding = readPaddingFromFeature(feature);
  const source = buildSource(feature);
  return normalizeCageData(readCageForSource(feature, source), {
    divisions,
    padding,
    bounds: source?.bounds,
    sourceSignature: source?.sourceSignature || null,
  });
}

function renderCageEditorWidget({ ui, key, controlWrap, row }) {
  const host = document.createElement("div");
  host.dataset.nurbsCageWidget = "true";
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.gap = "8px";
  host.style.padding = "8px";
  host.style.borderRadius = "8px";
  host.style.border = "1px solid rgba(255, 255, 255, 0.15)";
  host.style.background = "rgba(36, 39, 46, 0.95)";
  host.style.color = "rgba(245, 248, 255, 0.95)";

  if (row && typeof row.querySelector === "function") {
    const labelEl = row.querySelector(".label");
    if (labelEl) {
      labelEl.style.alignSelf = "flex-start";
      labelEl.style.paddingTop = "8px";
    }
  }

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "6px";
  controls.style.flexWrap = "wrap";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.textContent = "Edit Cage";
  editBtn.title = "Activate the viewport cage controls";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Reset cage points around the current source bounds";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply";
  applyBtn.title = "Run the feature now with current cage positions";

  controls.appendChild(editBtn);
  controls.appendChild(resetBtn);
  controls.appendChild(applyBtn);
  host.appendChild(controls);

  const displayWrap = document.createElement("div");
  displayWrap.style.display = "grid";
  displayWrap.style.gridTemplateColumns = "1fr auto";
  displayWrap.style.columnGap = "8px";
  displayWrap.style.rowGap = "6px";

  const addToggleControl = (labelText) => {
    const label = document.createElement("span");
    label.textContent = labelText;
    label.style.opacity = "0.9";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.style.justifySelf = "end";
    displayWrap.appendChild(label);
    displayWrap.appendChild(input);
    return input;
  };

  const colorLabel = document.createElement("span");
  colorLabel.textContent = "Volume color";
  colorLabel.style.opacity = "0.9";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.style.justifySelf = "end";
  colorInput.value = DEFAULT_EDITOR_OPTIONS.cageColor;
  displayWrap.appendChild(colorLabel);
  displayWrap.appendChild(colorInput);

  const showEdgesInput = addToggleControl("Show Edges");
  const showControlPointsInput = addToggleControl("Show Control Points");
  const allowXInput = addToggleControl("Allow X Direction");
  const allowYInput = addToggleControl("Allow Y Direction");
  const allowZInput = addToggleControl("Allow Z Direction");
  const symmetryXInput = addToggleControl("Symmetry X");
  const symmetryYInput = addToggleControl("Symmetry Y");
  const symmetryZInput = addToggleControl("Symmetry Z");

  host.appendChild(displayWrap);

  const info = document.createElement("div");
  info.style.fontSize = "12px";
  info.style.opacity = "0.85";
  host.appendChild(info);

  const selectedWrap = document.createElement("div");
  selectedWrap.style.display = "grid";
  selectedWrap.style.gridTemplateColumns = "auto 1fr 1fr 1fr";
  selectedWrap.style.gap = "6px";
  selectedWrap.style.alignItems = "center";

  const selectedLabel = document.createElement("span");
  selectedLabel.textContent = "Selected:";
  selectedLabel.style.opacity = "0.75";
  selectedWrap.appendChild(selectedLabel);

  const xInput = document.createElement("input");
  const yInput = document.createElement("input");
  const zInput = document.createElement("input");
  for (const input of [xInput, yInput, zInput]) {
    input.type = "number";
    input.step = "0.01";
    input.style.minWidth = "0";
    input.style.padding = "4px 6px";
    input.style.borderRadius = "4px";
  }
  xInput.title = "Selected control point X";
  yInput.title = "Selected control point Y";
  zInput.title = "Selected control point Z";
  selectedWrap.appendChild(xInput);
  selectedWrap.appendChild(yInput);
  selectedWrap.appendChild(zInput);

  host.appendChild(selectedWrap);

  const hint = document.createElement("div");
  hint.textContent = "Click points to toggle selection; click a cage line to select both endpoints; click a cage quad to select its 4 corners (hover highlights quads); Esc clears selection.";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.65";
  host.appendChild(hint);

  controlWrap.appendChild(host);

  const state = {
    cage: null,
    editorOptions: normalizeEditorOptions(null),
    signature: null,
    lastCommittedSignature: null,
    session: null,
    selection: null,
    selectionCount: 0,
    destroyed: false,
    refreshing: false,
  };

  const getFeatureID = () => (ui?.params?.featureID != null ? String(ui.params.featureID) : null);
  const getViewer = () => ui?.options?.viewer || null;
  const getPartHistory = () => ui?.options?.partHistory || ui?.options?.viewer?.partHistory || null;
  const normalizeFeatureToken = (value) => String(value ?? "").trim().replace(/^#/, "");
  const getFeatureRef = () => {
    const featureID = normalizeFeatureToken(getFeatureID());
    if (!featureID) return null;
    const direct = ui?.options?.featureRef || null;
    const directToken = normalizeFeatureToken(direct?.inputParams?.featureID ?? direct?.inputParams?.id ?? direct?.id);
    if (direct && directToken === featureID) return direct;
    const ph = getPartHistory();
    if (ph && Array.isArray(ph.features)) {
      return ph.features.find((entry) => (
        normalizeFeatureToken(entry?.inputParams?.featureID ?? entry?.inputParams?.id ?? entry?.id) === featureID
      )) || null;
    }
    return null;
  };

  const formatCoord = (value) => {
    const num = normalizeNumber(value, 0);
    return num.toFixed(3).replace(/\.?0+$/, "") || "0";
  };

  const buildStateSignature = () => computeSignature({
    cage: state.cage || null,
    editorOptions: state.editorOptions || null,
  });

  const loadFromSource = () => {
    const feature = getFeatureRef();
    if (!feature) return null;
    return {
      cage: buildCageCandidateForWidget(feature),
      editorOptions: readEditorOptionsFromFeature(feature),
    };
  };

  const syncOptionInputs = () => {
    const options = normalizeEditorOptions(state.editorOptions);
    showEdgesInput.checked = !!options.showEdges;
    showControlPointsInput.checked = !!options.showControlPoints;
    allowXInput.checked = !!options.allowX;
    allowYInput.checked = !!options.allowY;
    allowZInput.checked = !!options.allowZ;
    symmetryXInput.checked = !!options.symmetryX;
    symmetryYInput.checked = !!options.symmetryY;
    symmetryZInput.checked = !!options.symmetryZ;
    colorInput.value = normalizeHexColor(options.cageColor, DEFAULT_EDITOR_OPTIONS.cageColor);
  };

  const applyEditorOptionsToSession = () => {
    if (!state.session) return;
    state.session.setDisplayOptions(normalizeEditorOptions(state.editorOptions));
  };

  const ensureState = () => {
    if (state.cage) return;
    const loaded = loadFromSource();
    state.cage = loaded?.cage ? cloneCageData(loaded.cage) : null;
    state.editorOptions = normalizeEditorOptions(loaded?.editorOptions);
    syncOptionInputs();
    state.signature = buildStateSignature();
    state.lastCommittedSignature = state.signature;
    ui.params[key] = state.signature;
  };

  const syncSelectedInputs = () => {
    const dims = sanitizeCageDivisions(state.cage?.dims);
    const selectedIndex = cageIndexFromId(state.selection, dims);
    const isSingleSelection = state.selectionCount === 1;
    const point = (isSingleSelection && selectedIndex >= 0) ? state.cage?.points?.[selectedIndex] : null;
    const hasSelection = Array.isArray(point) && point.length >= 3;

    xInput.disabled = !hasSelection;
    yInput.disabled = !hasSelection;
    zInput.disabled = !hasSelection;

    if (!hasSelection) {
      xInput.value = "";
      yInput.value = "";
      zInput.value = "";
      return;
    }
    xInput.value = formatCoord(point[0]);
    yInput.value = formatCoord(point[1]);
    zInput.value = formatCoord(point[2]);
  };

  const renderInfo = () => {
    const dims = sanitizeCageDivisions(state.cage?.dims);
    const count = Array.isArray(state.cage?.points) ? state.cage.points.length : 0;
    const selected = state.selectionCount <= 0
      ? "none"
      : (state.selectionCount === 1
        ? (state.selection || "none")
        : `${state.selection || "point"} (+${state.selectionCount - 1})`);
    info.textContent = `Cage ${dims[0]}x${dims[1]}x${dims[2]} (${count} points) | selected: ${selected}`;
    syncSelectedInputs();
  };

  const handleSessionSelectionChange = (id, details = {}) => {
    if (state.destroyed) return;
    state.selection = id || null;
    const nextCount = Number(details?.count);
    state.selectionCount = Number.isFinite(nextCount)
      ? Math.max(0, Math.floor(nextCount))
      : (state.selection ? 1 : 0);
    renderInfo();
  };

  const disposeSession = () => {
    if (!state.session) return;
    try { state.session.dispose(); } catch { }
    state.session = null;
  };

  const ensureSession = () => {
    if (state.session || state.destroyed) return state.session;
    const viewer = getViewer();
    const featureID = getFeatureID();
    if (!viewer || !featureID || !state.cage) return null;
    const session = new NurbsCageEditorSession(viewer, featureID, {
      featureRef: getFeatureRef(),
      onCageChange: handleSessionCageChange,
      onSelectionChange: handleSessionSelectionChange,
    });
    const activated = session.activate(state.cage, {
      featureRef: getFeatureRef(),
      initialSelection: state.selection,
    });
    if (!activated) return null;
    state.session = session;
    applyEditorOptionsToSession();
    state.selection = session.getSelectedId() || state.selection;
    state.selectionCount = session.getSelectedIds?.().length || (state.selection ? 1 : 0);
    renderInfo();
    return state.session;
  };

  const commit = (reason = "widget") => {
    if (!state.cage) return;
    const feature = getFeatureRef();
    markFeatureDirtyWithCage(feature, state.cage);
    markFeatureDirtyWithEditorOptions(feature, state.editorOptions);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;
    if (state.signature === state.lastCommittedSignature) return;
    state.lastCommittedSignature = state.signature;
    ui._emitParamsChange(key, {
      signature: state.signature,
      reason,
      timestamp: Date.now(),
    });
  };

  const handleSessionCageChange = (nextCage, reason = "transform") => {
    if (state.destroyed) return;
    state.cage = cloneCageData(nextCage);
    const feature = getFeatureRef();
    markFeatureDirtyWithCage(feature, state.cage);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;
    renderInfo();
    if (!state.refreshing) commit(`live-${reason || "transform"}`);
  };

  const setSelectedCoordinate = (axis, value) => {
    if (!state.cage) return;
    if (state.selectionCount !== 1) return;
    const dims = sanitizeCageDivisions(state.cage.dims);
    const index = cageIndexFromId(state.selection, dims);
    if (index < 0) return;
    const point = state.cage.points[index];
    if (!Array.isArray(point) || point.length < 3) return;
    point[axis] = normalizeNumber(value, point[axis] || 0);
    const feature = getFeatureRef();
    markFeatureDirtyWithCage(feature, state.cage);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;
    if (state.session) {
      state.session.setCageData(state.cage, { preserveSelection: true, silent: true });
      state.session.selectObject(state.selection, { silent: true });
    }
    renderInfo();
    if (!state.refreshing) commit("live-numeric-input");
  };

  const updateEditorOptions = (patch, reason = "display-options") => {
    state.editorOptions = normalizeEditorOptions({
      ...state.editorOptions,
      ...(patch || {}),
    });
    syncOptionInputs();
    const feature = getFeatureRef();
    markFeatureDirtyWithEditorOptions(feature, state.editorOptions);
    applyEditorOptionsToSession();
    if (!state.refreshing) commit(reason);
  };

  editBtn.addEventListener("click", () => {
    ensureState();
    const session = ensureSession();
    if (session && !state.selection) {
      state.selection = session.getSelectedId();
      state.selectionCount = session.getSelectedIds?.().length || (state.selection ? 1 : 0);
      renderInfo();
    }
  });

  resetBtn.addEventListener("click", () => {
    const feature = getFeatureRef();
    if (!feature) return;
    const source = buildSource(feature);
    state.cage = normalizeCageData(null, {
      divisions: readDivisionsFromFeature(feature),
      padding: readPaddingFromFeature(feature),
      bounds: source?.bounds,
      sourceSignature: source?.sourceSignature || null,
    });
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;
    markFeatureDirtyWithCage(feature, state.cage);
    if (state.session) {
      state.session.setCageData(state.cage, { preserveSelection: false, silent: true });
      state.selection = state.session.getSelectedId();
      state.selectionCount = state.session.getSelectedIds?.().length || (state.selection ? 1 : 0);
    } else {
      state.selection = null;
      state.selectionCount = 0;
    }
    renderInfo();
    commit("reset");
  });

  applyBtn.addEventListener("click", () => {
    commit("manual-apply");
  });
  showEdgesInput.addEventListener("change", () => updateEditorOptions({
    showEdges: !!showEdgesInput.checked,
  }, "show-edges"));
  showControlPointsInput.addEventListener("change", () => updateEditorOptions({
    showControlPoints: !!showControlPointsInput.checked,
  }, "show-control-points"));
  allowXInput.addEventListener("change", () => updateEditorOptions({
    allowX: !!allowXInput.checked,
  }, "allow-x"));
  allowYInput.addEventListener("change", () => updateEditorOptions({
    allowY: !!allowYInput.checked,
  }, "allow-y"));
  allowZInput.addEventListener("change", () => updateEditorOptions({
    allowZ: !!allowZInput.checked,
  }, "allow-z"));
  symmetryXInput.addEventListener("change", () => updateEditorOptions({
    symmetryX: !!symmetryXInput.checked,
  }, "symmetry-x"));
  symmetryYInput.addEventListener("change", () => updateEditorOptions({
    symmetryY: !!symmetryYInput.checked,
  }, "symmetry-y"));
  symmetryZInput.addEventListener("change", () => updateEditorOptions({
    symmetryZ: !!symmetryZInput.checked,
  }, "symmetry-z"));
  colorInput.addEventListener("input", () => updateEditorOptions({
    cageColor: normalizeHexColor(colorInput.value, DEFAULT_EDITOR_OPTIONS.cageColor),
  }, "cage-color"));
  xInput.addEventListener("change", () => setSelectedCoordinate(0, xInput.value));
  yInput.addEventListener("change", () => setSelectedCoordinate(1, yInput.value));
  zInput.addEventListener("change", () => setSelectedCoordinate(2, zInput.value));

  ensureState();
  ensureSession();
  renderInfo();

  return {
    inputEl: host,
    inputRegistered: false,
    skipDefaultRefresh: true,
    refreshFromParams() {
      if (state.destroyed || state.refreshing) return;
      state.refreshing = true;
      try {
        const next = loadFromSource();
        if (!next) return;
        const nextSig = computeSignature({
          cage: next.cage || null,
          editorOptions: normalizeEditorOptions(next.editorOptions),
        });
        if (nextSig !== state.signature) {
          state.cage = cloneCageData(next.cage);
          state.editorOptions = normalizeEditorOptions(next.editorOptions);
          syncOptionInputs();
          state.signature = buildStateSignature();
          state.lastCommittedSignature = state.signature;
          ui.params[key] = state.signature;
          if (state.session) {
            state.session.setFeatureRef(getFeatureRef());
            state.session.setCageData(state.cage, {
              preserveSelection: true,
              silent: true,
            });
            applyEditorOptionsToSession();
            state.selection = state.session.getSelectedId() || state.selection;
            state.selectionCount = state.session.getSelectedIds?.().length || (state.selection ? 1 : 0);
          }
          renderInfo();
        }
      } finally {
        state.refreshing = false;
      }
    },
    destroy() {
      if (!state.destroyed) commit("dialog-close");
      state.destroyed = true;
      disposeSession();
    },
  };
}

export class NurbsFaceSolidFeature {
  static shortName = "NURBS";
  static longName = "NURBS Face Solid";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const featureName = this.inputParams?.featureID || "NURBS_FACE_SOLID";
    const divisions = readDivisionsFromFeature(this);
    const padding = readPaddingFromFeature(this);
    const source = buildSource(this);
    if (!source) {
      console.warn("[NURBS] Failed to build source mesh.");
      return { added: [], removed: [] };
    }

    const cage = normalizeCageData(readCageForSource(this, source), {
      divisions,
      padding,
      bounds: source.bounds,
      sourceSignature: source.sourceSignature,
    });
    const editorOptions = readEditorOptionsFromFeature(this);
    this.persistentData = this.persistentData || {};
    this.persistentData.cage = cloneCageData(cage);
    this.persistentData.editorOptions = normalizeEditorOptions(editorOptions);

    const deformedVertices = deformPointsWithCage(source.vertices, cage);
    const bounds = computeBoundsFromPoints(deformedVertices);
    const center = computeCenterFromBounds(bounds);

    const solid = new BREP.Solid();
    solid.name = featureName;

    const surfaceFace = `${featureName}:SURFACE`;
    for (const tri of source.triangles) {
      const a = tri[0];
      const b = tri[1];
      const c = tri[2];
      addTriangleFacingOutward(
        solid,
        surfaceFace,
        deformedVertices[a],
        deformedVertices[b],
        deformedVertices[c],
        center,
      );
    }

    solid.userData = solid.userData || {};
    solid.userData.nurbsFaceSolid = {
      basePrimitive: readBasePrimitive(this),
      baseShape: source.shape || "cube",
      baseSize: source.size,
      baseDensity: source.density,
      cage: {
        dims: [...cage.dims],
        pointCount: Array.isArray(cage.points) ? cage.points.length : 0,
        sourceSignature: cage.sourceSignature || null,
      },
      editorOptions: normalizeEditorOptions(editorOptions),
    };

    solid.visualize();
    applyEditorVisualsToSolid(solid, editorOptions);
    return BREP.applyBooleanOperation(
      partHistory || {},
      solid,
      this.inputParams.boolean,
      this.inputParams.featureID,
    );
  }
}
