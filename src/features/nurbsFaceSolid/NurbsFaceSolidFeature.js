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
  radius: {
    type: "number",
    default_value: 5,
    hint: "Starting sphere radius",
  },
  resolution: {
    type: "number",
    default_value: 24,
    hint: "Starting sphere segment resolution",
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
    hint: "Default cage padding around the sphere bounds",
  },
  cageEditor: {
    type: "string",
    label: "Control Cage",
    hint: "Edit control points around the generated sphere; drag points in the viewport",
    renderWidget: renderCageEditorWidget,
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: "NONE" },
    hint: "Optional boolean operation with selected solids",
  },
};

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function readSphereParams(feature) {
  const radius = Math.max(1e-6, Math.abs(normalizeNumber(feature?.inputParams?.radius, 5)));
  const resolution = Math.max(8, Math.min(128, Math.floor(normalizeNumber(feature?.inputParams?.resolution, 24))));
  return { radius, resolution };
}

function buildSphereSource(feature) {
  const { radius, resolution } = readSphereParams(feature);
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
      radius,
      resolution,
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
  }
}

function markFeatureDirtyWithCage(feature, cage) {
  if (!feature) return;
  feature.lastRunInputParams = {};
  feature.timestamp = 0;
  feature.dirty = true;
  feature.persistentData = feature.persistentData || {};
  feature.persistentData.cage = cloneCageData(cage);
}

function buildCageCandidateForWidget(feature) {
  const divisions = readDivisionsFromFeature(feature);
  const padding = readPaddingFromFeature(feature);
  const source = buildSphereSource(feature);
  return normalizeCageData(feature?.persistentData?.cage, {
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
  resetBtn.title = "Reset cage points around the current sphere bounds";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.textContent = "Rebuild Mesh";
  applyBtn.title = "Run the feature now with current cage positions";

  controls.appendChild(editBtn);
  controls.appendChild(resetBtn);
  controls.appendChild(applyBtn);
  host.appendChild(controls);

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
  hint.textContent = "Drag cage points in the viewport. Shift/Ctrl/Cmd-click adds to selection; Esc clears selection.";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.65";
  host.appendChild(hint);

  controlWrap.appendChild(host);

  const state = {
    cage: null,
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

  const loadFromSource = () => {
    const feature = getFeatureRef();
    if (!feature) return null;
    return buildCageCandidateForWidget(feature);
  };

  const ensureState = () => {
    if (state.cage) return;
    const loaded = loadFromSource();
    state.cage = loaded ? cloneCageData(loaded) : null;
    state.signature = computeSignature(state.cage);
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
    state.selection = session.getSelectedId() || state.selection;
    state.selectionCount = session.getSelectedIds?.().length || (state.selection ? 1 : 0);
    renderInfo();
    return state.session;
  };

  const commit = (reason = "widget") => {
    if (!state.cage) return;
    const feature = getFeatureRef();
    markFeatureDirtyWithCage(feature, state.cage);
    state.signature = computeSignature(state.cage);
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
    state.signature = computeSignature(state.cage);
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
    state.signature = computeSignature(state.cage);
    ui.params[key] = state.signature;
    if (state.session) {
      state.session.setCageData(state.cage, { preserveSelection: true, silent: true });
      state.session.selectObject(state.selection, { silent: true });
    }
    renderInfo();
    if (!state.refreshing) commit("live-numeric-input");
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
    const source = buildSphereSource(feature);
    state.cage = normalizeCageData(null, {
      divisions: readDivisionsFromFeature(feature),
      padding: readPaddingFromFeature(feature),
      bounds: source?.bounds,
      sourceSignature: source?.sourceSignature || null,
    });
    state.signature = computeSignature(state.cage);
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
        const nextSig = computeSignature(next);
        if (nextSig !== state.signature) {
          state.cage = cloneCageData(next);
          state.signature = nextSig;
          state.lastCommittedSignature = nextSig;
          ui.params[key] = state.signature;
          if (state.session) {
            state.session.setFeatureRef(getFeatureRef());
            state.session.setCageData(state.cage, {
              preserveSelection: true,
              silent: true,
            });
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
    const sphereSource = buildSphereSource(this);
    if (!sphereSource) {
      console.warn("[NURBS] Failed to build source sphere.");
      return { added: [], removed: [] };
    }

    const cage = normalizeCageData(this.persistentData?.cage, {
      divisions,
      padding,
      bounds: sphereSource.bounds,
      sourceSignature: sphereSource.sourceSignature,
    });
    this.persistentData = this.persistentData || {};
    this.persistentData.cage = cloneCageData(cage);

    const deformedVertices = deformPointsWithCage(sphereSource.vertices, cage);
    const bounds = computeBoundsFromPoints(deformedVertices);
    const center = computeCenterFromBounds(bounds);

    const solid = new BREP.Solid();
    solid.name = featureName;

    const surfaceFace = `${featureName}:SURFACE`;
    for (const tri of sphereSource.triangles) {
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
      baseShape: "sphere",
      baseRadius: sphereSource.radius,
      baseResolution: sphereSource.resolution,
      cage: {
        dims: [...cage.dims],
        pointCount: Array.isArray(cage.points) ? cage.points.length : 0,
        sourceSignature: cage.sourceSignature || null,
      },
    };

    solid.visualize();
    return BREP.applyBooleanOperation(
      partHistory || {},
      solid,
      this.inputParams.boolean,
      this.inputParams.featureID,
    );
  }
}
