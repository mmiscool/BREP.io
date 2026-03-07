import { BREP } from "../../BREP/BREP.js";
import {
  addTriangleFacingOutward,
  computeBoundsFromPoints,
  computeCenterFromBounds,
} from "../nurbsFaceSolid/nurbsFaceSolidUtils.js";
import { PolygonSolidEditorSession } from "./PolygonSolidEditorSession.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the polygon solid feature",
  },
  basePrimitive: {
    type: "options",
    default_value: "CUBE",
    options: ["CUBE", "SPHERE", "CYLINDER", "TORUS"],
    hint: "Base primitive used to initialize the editable polygon mesh",
  },
  volumeSize: {
    type: "number",
    default_value: 10,
    hint: "Starting primitive size",
  },
  volumeDensity: {
    type: "number",
    default_value: 2,
    hint: "Surface subdivision density",
  },
  subdivisionLoops: {
    type: "number",
    default_value: 0,
    hint: "Subdivision smoothing loops (0 = low poly, 1+ = smoother)",
  },
  polygonEditor: {
    type: "string",
    label: "Polygon Editor",
    hint: "Edit polygon points, edges, and triangles directly in the viewport",
    renderWidget: renderPolygonEditorWidget,
  },
  boolean: {
    type: "boolean_operation",
    default_value: { targets: [], operation: "NONE" },
    hint: "Optional boolean operation with selected solids",
  },
};

const DEFAULT_VOLUME_SIZE = 10;
const DEFAULT_VOLUME_DENSITY = 2;
const DEFAULT_BASE_PRIMITIVE = "CUBE";
const DEFAULT_EDITOR_OPTIONS = Object.freeze({
  showEdges: true,
  showControlPoints: true,
  allowX: true,
  allowY: true,
  allowZ: true,
  meshColor: "#70d6ff",
});

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeHexColor(value, fallback = DEFAULT_EDITOR_OPTIONS.meshColor) {
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

function normalizeEditorOptions(rawOptions) {
  const raw = (rawOptions && typeof rawOptions === "object") ? rawOptions : null;
  return {
    showEdges: normalizeBoolean(raw?.showEdges, DEFAULT_EDITOR_OPTIONS.showEdges),
    showControlPoints: normalizeBoolean(raw?.showControlPoints, DEFAULT_EDITOR_OPTIONS.showControlPoints),
    allowX: normalizeBoolean(raw?.allowX, DEFAULT_EDITOR_OPTIONS.allowX),
    allowY: normalizeBoolean(raw?.allowY, DEFAULT_EDITOR_OPTIONS.allowY),
    allowZ: normalizeBoolean(raw?.allowZ, DEFAULT_EDITOR_OPTIONS.allowZ),
    meshColor: normalizeHexColor(raw?.meshColor, DEFAULT_EDITOR_OPTIONS.meshColor),
  };
}

function cloneMeshData(meshData) {
  try {
    return JSON.parse(JSON.stringify(meshData || null));
  } catch {
    return null;
  }
}

function normalizeFaceToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "SURFACE";
  return raw.replace(/[^A-Za-z0-9:_-]/g, "_") || "SURFACE";
}

function normalizeMeshData(rawMeshData) {
  const raw = (rawMeshData && typeof rawMeshData === "object") ? rawMeshData : null;
  const verticesIn = Array.isArray(raw?.vertices) ? raw.vertices : [];
  const trianglesIn = Array.isArray(raw?.triangles) ? raw.triangles : [];
  const tokensIn = Array.isArray(raw?.triangleFaceTokens) ? raw.triangleFaceTokens : [];

  const vertices = [];
  for (const v of verticesIn) {
    if (!Array.isArray(v) || v.length < 3) continue;
    const x = Number(v[0]);
    const y = Number(v[1]);
    const z = Number(v[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    vertices.push([x, y, z]);
  }

  const triangles = [];
  const triangleFaceTokens = [];
  for (let triIndex = 0; triIndex < trianglesIn.length; triIndex++) {
    const tri = trianglesIn[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = Number(tri[0]) | 0;
    const b = Number(tri[1]) | 0;
    const c = Number(tri[2]) | 0;
    if (a < 0 || b < 0 || c < 0 || a >= vertices.length || b >= vertices.length || c >= vertices.length) continue;
    if (a === b || b === c || c === a) continue;
    triangles.push([a, b, c]);
    triangleFaceTokens.push(normalizeFaceToken(tokensIn[triIndex]));
  }

  return {
    vertices,
    triangles,
    triangleFaceTokens,
    sourceSignature: raw?.sourceSignature ? String(raw.sourceSignature) : null,
  };
}

function pointIndexFromId(id) {
  if (typeof id !== "string") return -1;
  const match = /^pv:(\d+)$/.exec(id.trim());
  if (!match) return -1;
  return Number(match[1]) | 0;
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

function readSubdivisionLoops(feature) {
  const raw = Math.floor(normalizeNumber(feature?.inputParams?.subdivisionLoops, 0));
  return Math.max(0, Math.min(5, raw));
}

function buildCubeSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const half = size * 0.5;
  const steps = Math.max(1, density | 0);
  const vertexMap = new Map();
  const vertices = [];
  const triangles = [];
  const triangleFaceGroups = [];

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
  const emitFace = (faceName, samplePoint) => {
    const start = triangles.length;
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
    const end = triangles.length;
    if (end > start) {
      triangleFaceGroups.push({ start, end, token: faceName || "SURFACE" });
    }
  };

  emitFace("PX", (u, v) => [half, toCoord(u), toCoord(v)]);
  emitFace("NX", (u, v) => [-half, toCoord(u), toCoord(v)]);
  emitFace("PY", (u, v) => [toCoord(u), half, toCoord(v)]);
  emitFace("NY", (u, v) => [toCoord(u), -half, toCoord(v)]);
  emitFace("PZ", (u, v) => [toCoord(u), toCoord(v), half]);
  emitFace("NZ", (u, v) => [toCoord(u), toCoord(v), -half]);

  return {
    shape: "cube",
    size,
    density: steps,
    vertices,
    triangles,
    triangleFaceGroups,
    sourceSignature: `cube:${size}:${steps}:${vertices.length}:${triangles.length}`,
  };
}

function buildSphereSource(feature) {
  const { size, density } = readVolumeParams(feature);
  const radius = Math.max(1e-6, size * 0.5);
  const resolution = Math.max(8, Math.min(128, density | 0));
  const sphere = new BREP.Sphere({
    r: radius,
    resolution,
    name: "__POLY_SOLID_BASE__",
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

    return {
      shape: "sphere",
      size,
      density: resolution,
      vertices,
      triangles,
      defaultTriangleFaceName: "SURFACE",
      sourceSignature: `sphere:${radius}:${resolution}:${vertices.length}:${triangles.length}`,
    };
  } catch {
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
  const triangleFaceGroups = [];

  const addVertex = (x, y, z) => {
    vertices.push([x, y, z]);
    return vertices.length - 1;
  };
  const addTriangle = (a, b, c) => {
    if (a === b || b === c || c === a) return;
    triangles.push([a, b, c]);
  };
  const pointOnRing = (r, angle) => [Math.cos(angle) * r, Math.sin(angle) * r];

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

  const sideStart = triangles.length;
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
  const sideEnd = triangles.length;
  if (sideEnd > sideStart) triangleFaceGroups.push({ start: sideStart, end: sideEnd, token: "SIDE" });

  const stitchCap = (outerRing, y, faceName) => {
    const start = triangles.length;
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
    const end = triangles.length;
    if (end > start) triangleFaceGroups.push({ start, end, token: faceName || "SURFACE" });
  };

  const bottomOuter = sideRings[0];
  const topOuter = sideRings[sideRings.length - 1];
  stitchCap(topOuter, halfHeight, "TOP");
  stitchCap(bottomOuter, -halfHeight, "BOTTOM");

  return {
    shape: "cylinder",
    size,
    density: aroundSteps,
    vertices,
    triangles,
    triangleFaceGroups,
    sourceSignature: `cylinder:${radius}:${height}:${aroundSteps}:${heightSteps}:${radialSteps}:${vertices.length}:${triangles.length}`,
  };
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
    name: "__POLY_SOLID_BASE__",
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

    return {
      shape: "torus",
      size,
      density: resolution,
      vertices,
      triangles,
      defaultTriangleFaceName: "SURFACE",
      sourceSignature: `torus:${majorRadius}:${minorRadius}:${resolution}:${vertices.length}:${triangles.length}`,
    };
  } catch {
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

function expandSourceTriangleTokens(source) {
  const triangles = Array.isArray(source?.triangles) ? source.triangles : [];
  const groups = Array.isArray(source?.triangleFaceGroups) ? source.triangleFaceGroups : null;
  const names = Array.isArray(source?.triangleFaceNames) ? source.triangleFaceNames : null;
  const fallback = normalizeFaceToken(source?.defaultTriangleFaceName || "SURFACE");

  const tokens = new Array(triangles.length);

  if (groups?.length) {
    let groupIndex = 0;
    let active = groups[groupIndex] || null;
    for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
      while (active && triIndex >= active.end) {
        groupIndex += 1;
        active = groups[groupIndex] || null;
      }
      if (active && triIndex >= active.start && triIndex < active.end) {
        tokens[triIndex] = normalizeFaceToken(active.token);
      } else {
        tokens[triIndex] = normalizeFaceToken(names?.[triIndex] || fallback);
      }
    }
    return tokens;
  }

  for (let triIndex = 0; triIndex < triangles.length; triIndex++) {
    tokens[triIndex] = normalizeFaceToken(names?.[triIndex] || fallback);
  }
  return tokens;
}

function buildMeshCandidateForSource(source) {
  const safeSource = source && typeof source === "object" ? source : null;
  const vertices = Array.isArray(safeSource?.vertices) ? safeSource.vertices : [];
  const triangles = Array.isArray(safeSource?.triangles) ? safeSource.triangles : [];
  if (!vertices.length || !triangles.length) return normalizeMeshData(null);

  const triangleFaceTokens = expandSourceTriangleTokens(safeSource);
  return normalizeMeshData({
    vertices,
    triangles,
    triangleFaceTokens,
    sourceSignature: safeSource?.sourceSignature || null,
  });
}

function readMeshForSource(feature, source) {
  const raw = normalizeMeshData(feature?.persistentData?.meshData);
  if (!raw?.vertices?.length || !raw?.triangles?.length) {
    return buildMeshCandidateForSource(source);
  }
  const sourceSignature = String(source?.sourceSignature || "");
  const rawSignature = String(raw?.sourceSignature || "");
  if (sourceSignature && rawSignature && sourceSignature === rawSignature) {
    return raw;
  }
  return buildMeshCandidateForSource(source);
}

function loopSubdivideOnce(meshDataInput) {
  const meshData = normalizeMeshData(meshDataInput);
  const oldVertices = meshData.vertices;
  const oldTriangles = meshData.triangles;
  const oldTokens = meshData.triangleFaceTokens;
  if (!oldVertices.length || !oldTriangles.length) return meshData;

  const edgeMap = new Map();
  const vertexNeighbors = Array.from({ length: oldVertices.length }, () => new Set());
  const boundaryNeighbors = Array.from({ length: oldVertices.length }, () => new Set());

  const addEdge = (va, vb, opposite, triIndex) => {
    const a = Number(va) | 0;
    const b = Number(vb) | 0;
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let edge = edgeMap.get(key);
    if (!edge) {
      edge = {
        key,
        a: Math.min(a, b),
        b: Math.max(a, b),
        faces: [],
        opposites: [],
      };
      edgeMap.set(key, edge);
    }
    edge.faces.push(triIndex);
    if (Number.isInteger(opposite)) edge.opposites.push(opposite);
    vertexNeighbors[a].add(b);
    vertexNeighbors[b].add(a);
  };

  for (let triIndex = 0; triIndex < oldTriangles.length; triIndex++) {
    const tri = oldTriangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = tri[0];
    const b = tri[1];
    const c = tri[2];
    addEdge(a, b, c, triIndex);
    addEdge(b, c, a, triIndex);
    addEdge(c, a, b, triIndex);
  }

  for (const edge of edgeMap.values()) {
    if (edge.faces.length !== 1) continue;
    boundaryNeighbors[edge.a].add(edge.b);
    boundaryNeighbors[edge.b].add(edge.a);
  }

  const nextVertices = oldVertices.map((v, vertexIndex) => {
    const base = oldVertices[vertexIndex];
    if (!Array.isArray(base) || base.length < 3) return [0, 0, 0];
    const boundary = Array.from(boundaryNeighbors[vertexIndex]);
    if (boundary.length >= 2) {
      const v1 = oldVertices[boundary[0]];
      const v2 = oldVertices[boundary[1]];
      if (Array.isArray(v1) && Array.isArray(v2)) {
        return [
          (0.75 * base[0]) + (0.125 * (v1[0] + v2[0])),
          (0.75 * base[1]) + (0.125 * (v1[1] + v2[1])),
          (0.75 * base[2]) + (0.125 * (v1[2] + v2[2])),
        ];
      }
    }

    const neighbors = Array.from(vertexNeighbors[vertexIndex]);
    const n = neighbors.length;
    if (!n) return [base[0], base[1], base[2]];
    const beta = (n === 3) ? (3 / 16) : (3 / (8 * n));
    const scale = 1 - (n * beta);
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const nb of neighbors) {
      const nv = oldVertices[nb];
      if (!Array.isArray(nv) || nv.length < 3) continue;
      sumX += nv[0];
      sumY += nv[1];
      sumZ += nv[2];
    }
    return [
      (scale * base[0]) + (beta * sumX),
      (scale * base[1]) + (beta * sumY),
      (scale * base[2]) + (beta * sumZ),
    ];
  });

  const edgeNewIndex = new Map();
  for (const edge of edgeMap.values()) {
    const va = oldVertices[edge.a];
    const vb = oldVertices[edge.b];
    if (!Array.isArray(va) || !Array.isArray(vb)) continue;

    let nx = 0.5 * (va[0] + vb[0]);
    let ny = 0.5 * (va[1] + vb[1]);
    let nz = 0.5 * (va[2] + vb[2]);

    if (edge.faces.length > 1 && edge.opposites.length >= 2) {
      const vc = oldVertices[edge.opposites[0]];
      const vd = oldVertices[edge.opposites[1]];
      if (Array.isArray(vc) && Array.isArray(vd)) {
        nx = (0.375 * (va[0] + vb[0])) + (0.125 * (vc[0] + vd[0]));
        ny = (0.375 * (va[1] + vb[1])) + (0.125 * (vc[1] + vd[1]));
        nz = (0.375 * (va[2] + vb[2])) + (0.125 * (vc[2] + vd[2]));
      }
    }

    const index = nextVertices.length;
    nextVertices.push([nx, ny, nz]);
    edgeNewIndex.set(edge.key, index);
  }

  const nextTriangles = [];
  const nextTokens = [];
  const edgeIndex = (a, b) => edgeNewIndex.get(a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let triIndex = 0; triIndex < oldTriangles.length; triIndex++) {
    const tri = oldTriangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = tri[0];
    const b = tri[1];
    const c = tri[2];
    const ab = edgeIndex(a, b);
    const bc = edgeIndex(b, c);
    const ca = edgeIndex(c, a);
    if (!Number.isInteger(ab) || !Number.isInteger(bc) || !Number.isInteger(ca)) continue;

    const token = normalizeFaceToken(oldTokens[triIndex] || "SURFACE");
    nextTriangles.push([a, ab, ca]);
    nextTriangles.push([b, bc, ab]);
    nextTriangles.push([c, ca, bc]);
    nextTriangles.push([ab, bc, ca]);
    nextTokens.push(token, token, token, token);
  }

  return normalizeMeshData({
    vertices: nextVertices,
    triangles: nextTriangles,
    triangleFaceTokens: nextTokens,
    sourceSignature: meshData.sourceSignature,
  });
}

function applySubdivisionLoops(meshDataInput, loops) {
  const count = Math.max(0, Math.floor(normalizeNumber(loops, 0)));
  let mesh = normalizeMeshData(meshDataInput);
  for (let i = 0; i < count; i++) {
    mesh = loopSubdivideOnce(mesh);
    if (!mesh.vertices.length || !mesh.triangles.length) break;
  }
  return mesh;
}

function markFeatureDirtyWithMesh(feature, meshData) {
  if (!feature) return;
  feature.lastRunInputParams = {};
  feature.timestamp = 0;
  feature.dirty = true;
  feature.persistentData = feature.persistentData || {};
  feature.persistentData.meshData = cloneMeshData(meshData);
}

function markFeatureDirtyWithEditorOptions(feature, editorOptions) {
  if (!feature) return;
  feature.lastRunInputParams = {};
  feature.timestamp = 0;
  feature.dirty = true;
  feature.persistentData = feature.persistentData || {};
  feature.persistentData.editorOptions = normalizeEditorOptions(editorOptions);
}

function colorIntFromHex(value, fallback = DEFAULT_EDITOR_OPTIONS.meshColor) {
  const normalized = normalizeHexColor(value, fallback);
  return parseInt(normalized.slice(1), 16);
}

function applyEditorVisualsToSolid(solid, editorOptions) {
  if (!solid || !Array.isArray(solid.children)) return;
  const options = normalizeEditorOptions(editorOptions);
  const faceColor = colorIntFromHex(options.meshColor, DEFAULT_EDITOR_OPTIONS.meshColor);
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

function readEditorOptionsFromFeature(feature) {
  return normalizeEditorOptions(feature?.persistentData?.editorOptions);
}

function renderPolygonEditorWidget({ ui, key, controlWrap, row }) {
  const host = document.createElement("div");
  host.dataset.polygonEditorWidget = "true";
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
  editBtn.textContent = "Edit Mesh";
  editBtn.title = "Activate direct polygon editing in the viewport";

  const splitEdgeBtn = document.createElement("button");
  splitEdgeBtn.type = "button";
  splitEdgeBtn.textContent = "Split Selected Edges";
  splitEdgeBtn.title = "Split currently selected edges and adjacent triangles";

  const deletePointsBtn = document.createElement("button");
  deletePointsBtn.type = "button";
  deletePointsBtn.textContent = "Delete Selected Points";
  deletePointsBtn.title = "Delete selected points and connected triangles";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Reset mesh from the current primitive parameters";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply";
  applyBtn.title = "Run the feature now with current polygon positions";

  controls.appendChild(editBtn);
  controls.appendChild(splitEdgeBtn);
  controls.appendChild(deletePointsBtn);
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
  colorLabel.textContent = "Mesh color";
  colorLabel.style.opacity = "0.9";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.style.justifySelf = "end";
  colorInput.value = DEFAULT_EDITOR_OPTIONS.meshColor;
  displayWrap.appendChild(colorLabel);
  displayWrap.appendChild(colorInput);

  const showEdgesInput = addToggleControl("Show Edges");
  const showControlPointsInput = addToggleControl("Show Points");
  const allowXInput = addToggleControl("Allow X Direction");
  const allowYInput = addToggleControl("Allow Y Direction");
  const allowZInput = addToggleControl("Allow Z Direction");

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
  xInput.title = "Selected point X";
  yInput.title = "Selected point Y";
  zInput.title = "Selected point Z";
  selectedWrap.appendChild(xInput);
  selectedWrap.appendChild(yInput);
  selectedWrap.appendChild(zInput);

  host.appendChild(selectedWrap);

  const hint = document.createElement("div");
  hint.textContent = "Click points to toggle selection. Clicking an edge cycles endpoint points -> adjacent triangle points -> token loop points. Clicking a triangle selects its corners and clicking it again expands to all triangles with the same token.";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.65";
  host.appendChild(hint);

  controlWrap.appendChild(host);

  const state = {
    mesh: null,
    editorOptions: normalizeEditorOptions(null),
    signature: null,
    lastCommittedSignature: null,
    session: null,
    selection: null,
    selectionCount: 0,
    edgeSelectionCount: 0,
    triangleSelectionCount: 0,
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
    mesh: state.mesh || null,
    editorOptions: state.editorOptions || null,
  });

  const loadFromSource = () => {
    const feature = getFeatureRef();
    if (!feature) return null;
    const source = buildSource(feature);
    const mesh = readMeshForSource(feature, source);
    return {
      mesh,
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
    colorInput.value = normalizeHexColor(options.meshColor, DEFAULT_EDITOR_OPTIONS.meshColor);
  };

  const applyEditorOptionsToSession = () => {
    if (!state.session) return;
    state.session.setDisplayOptions(normalizeEditorOptions(state.editorOptions));
  };

  const ensureState = () => {
    if (state.mesh) return;
    const loaded = loadFromSource();
    state.mesh = loaded?.mesh ? cloneMeshData(loaded.mesh) : normalizeMeshData(null);
    state.editorOptions = normalizeEditorOptions(loaded?.editorOptions);
    syncOptionInputs();
    state.signature = buildStateSignature();
    state.lastCommittedSignature = state.signature;
    ui.params[key] = state.signature;
  };

  const syncSelectedInputs = () => {
    const selectedIndex = pointIndexFromId(state.selection);
    const isSingleSelection = state.selectionCount === 1;
    const point = (isSingleSelection && selectedIndex >= 0) ? state.mesh?.vertices?.[selectedIndex] : null;
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
    const vertexCount = Array.isArray(state.mesh?.vertices) ? state.mesh.vertices.length : 0;
    const triangleCount = Array.isArray(state.mesh?.triangles) ? state.mesh.triangles.length : 0;
    const selected = state.selectionCount <= 0
      ? "none"
      : (state.selectionCount === 1
        ? (state.selection || "point")
        : `${state.selection || "point"} (+${state.selectionCount - 1})`);

    info.textContent = `Vertices: ${vertexCount} | Triangles: ${triangleCount} | selected: ${selected} | edges: ${state.edgeSelectionCount} | tris: ${state.triangleSelectionCount}`;
    syncSelectedInputs();
  };

  const handleSessionSelectionChange = (id, details = {}) => {
    if (state.destroyed) return;
    state.selection = id || null;
    const nextCount = Number(details?.count);
    state.selectionCount = Number.isFinite(nextCount)
      ? Math.max(0, Math.floor(nextCount))
      : (state.selection ? 1 : 0);
    state.edgeSelectionCount = Array.isArray(details?.selectedEdgeKeys) ? details.selectedEdgeKeys.length : 0;
    state.triangleSelectionCount = Array.isArray(details?.selectedTriangleKeys) ? details.selectedTriangleKeys.length : 0;
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
    if (!viewer || !featureID || !state.mesh) return null;

    const session = new PolygonSolidEditorSession(viewer, featureID, {
      featureRef: getFeatureRef(),
      onMeshChange: handleSessionMeshChange,
      onSelectionChange: handleSessionSelectionChange,
    });
    const activated = session.activate(state.mesh, {
      featureRef: getFeatureRef(),
      initialSelection: state.selection,
    });
    if (!activated) return null;

    state.session = session;
    applyEditorOptionsToSession();
    state.selection = session.getSelectedId() || state.selection;
    state.selectionCount = session.getSelectedIds?.().length || (state.selection ? 1 : 0);
    state.edgeSelectionCount = session.getSelectedEdgeKeys?.().length || 0;
    state.triangleSelectionCount = session.getSelectedTriangleKeys?.().length || 0;
    renderInfo();
    return state.session;
  };

  const commit = (reason = "widget") => {
    if (!state.mesh) return;
    const feature = getFeatureRef();
    markFeatureDirtyWithMesh(feature, state.mesh);
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

  const handleSessionMeshChange = (nextMesh, reason = "transform") => {
    if (state.destroyed) return;
    state.mesh = cloneMeshData(nextMesh);
    const feature = getFeatureRef();
    markFeatureDirtyWithMesh(feature, state.mesh);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;

    if (state.session) {
      state.edgeSelectionCount = state.session.getSelectedEdgeKeys?.().length || state.edgeSelectionCount;
      state.triangleSelectionCount = state.session.getSelectedTriangleKeys?.().length || state.triangleSelectionCount;
    }

    renderInfo();
    if (!state.refreshing) commit(`live-${reason || "transform"}`);
  };

  const setSelectedCoordinate = (axis, value) => {
    if (!state.mesh) return;
    if (state.selectionCount !== 1) return;
    const index = pointIndexFromId(state.selection);
    if (index < 0) return;
    const point = state.mesh.vertices?.[index];
    if (!Array.isArray(point) || point.length < 3) return;

    point[axis] = normalizeNumber(value, point[axis] || 0);
    const feature = getFeatureRef();
    markFeatureDirtyWithMesh(feature, state.mesh);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;

    if (state.session) {
      state.session.setMeshData(state.mesh, { preserveSelection: true, silent: true });
      state.session.selectObject(state.selection, {
        silent: true,
        preserveEdgeSelection: true,
        preserveTriangleSelection: true,
      });
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
      state.edgeSelectionCount = session.getSelectedEdgeKeys?.().length || 0;
      state.triangleSelectionCount = session.getSelectedTriangleKeys?.().length || 0;
      renderInfo();
    }
  });

  splitEdgeBtn.addEventListener("click", () => {
    ensureState();
    const session = ensureSession();
    if (!session) return;
    if (session.splitSelectedEdges()) {
      state.mesh = session.getMeshData();
      state.selection = session.getSelectedId() || null;
      state.selectionCount = session.getSelectedIds?.().length || 0;
      state.edgeSelectionCount = session.getSelectedEdgeKeys?.().length || 0;
      state.triangleSelectionCount = session.getSelectedTriangleKeys?.().length || 0;
      renderInfo();
      if (!state.refreshing) commit("split-selected-edges");
    }
  });

  deletePointsBtn.addEventListener("click", () => {
    ensureState();
    const session = ensureSession();
    if (!session) return;
    if (session.deleteSelectedPoints()) {
      state.mesh = session.getMeshData();
      state.selection = session.getSelectedId() || null;
      state.selectionCount = session.getSelectedIds?.().length || 0;
      state.edgeSelectionCount = session.getSelectedEdgeKeys?.().length || 0;
      state.triangleSelectionCount = session.getSelectedTriangleKeys?.().length || 0;
      renderInfo();
      if (!state.refreshing) commit("delete-selected-points");
    }
  });

  resetBtn.addEventListener("click", () => {
    const feature = getFeatureRef();
    if (!feature) return;
    const source = buildSource(feature);
    state.mesh = buildMeshCandidateForSource(source);
    state.signature = buildStateSignature();
    ui.params[key] = state.signature;
    markFeatureDirtyWithMesh(feature, state.mesh);

    if (state.session) {
      state.session.setMeshData(state.mesh, { preserveSelection: false, silent: true });
      state.selection = state.session.getSelectedId();
      state.selectionCount = state.session.getSelectedIds?.().length || (state.selection ? 1 : 0);
      state.edgeSelectionCount = state.session.getSelectedEdgeKeys?.().length || 0;
      state.triangleSelectionCount = state.session.getSelectedTriangleKeys?.().length || 0;
    } else {
      state.selection = null;
      state.selectionCount = 0;
      state.edgeSelectionCount = 0;
      state.triangleSelectionCount = 0;
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
  colorInput.addEventListener("input", () => updateEditorOptions({
    meshColor: normalizeHexColor(colorInput.value, DEFAULT_EDITOR_OPTIONS.meshColor),
  }, "mesh-color"));
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
          mesh: next.mesh || null,
          editorOptions: normalizeEditorOptions(next.editorOptions),
        });

        if (nextSig !== state.signature) {
          state.mesh = cloneMeshData(next.mesh);
          state.editorOptions = normalizeEditorOptions(next.editorOptions);
          syncOptionInputs();
          state.signature = buildStateSignature();
          state.lastCommittedSignature = state.signature;
          ui.params[key] = state.signature;

          if (state.session) {
            state.session.setFeatureRef(getFeatureRef());
            state.session.setMeshData(state.mesh, {
              preserveSelection: true,
              silent: true,
            });
            applyEditorOptionsToSession();
            state.selection = state.session.getSelectedId() || state.selection;
            state.selectionCount = state.session.getSelectedIds?.().length || (state.selection ? 1 : 0);
            state.edgeSelectionCount = state.session.getSelectedEdgeKeys?.().length || 0;
            state.triangleSelectionCount = state.session.getSelectedTriangleKeys?.().length || 0;
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

export class PolygonSolidFeature {
  static shortName = "POLY";
  static longName = "Polygon Solid";
  static inputParamsSchema = inputParamsSchema;

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const featureName = this.inputParams?.featureID || "POLYGON_SOLID";
    const source = buildSource(this);
    if (!source) {
      console.warn("[PolygonSolid] Failed to build source mesh.");
      return { added: [], removed: [] };
    }

    const meshData = normalizeMeshData(readMeshForSource(this, source));
    if (!meshData.vertices.length || !meshData.triangles.length) {
      console.warn("[PolygonSolid] Mesh is empty after normalization.");
      return { added: [], removed: [] };
    }
    const subdivisionLoops = readSubdivisionLoops(this);
    const outputMeshData = (subdivisionLoops > 0)
      ? applySubdivisionLoops(meshData, subdivisionLoops)
      : meshData;
    if (!outputMeshData.vertices.length || !outputMeshData.triangles.length) {
      console.warn("[PolygonSolid] Output mesh is empty after subdivision.");
      return { added: [], removed: [] };
    }

    const editorOptions = readEditorOptionsFromFeature(this);
    this.persistentData = this.persistentData || {};
    this.persistentData.meshData = cloneMeshData(meshData);
    this.persistentData.editorOptions = normalizeEditorOptions(editorOptions);

    const bounds = computeBoundsFromPoints(outputMeshData.vertices);
    const center = computeCenterFromBounds(bounds);

    const solid = new BREP.Solid();
    solid.name = featureName;
    const smoothFaceName = `${featureName}:SMOOTH`;

    for (let triIndex = 0; triIndex < outputMeshData.triangles.length; triIndex++) {
      const tri = outputMeshData.triangles[triIndex];
      const a = tri[0];
      const b = tri[1];
      const c = tri[2];
      const surfaceFace = subdivisionLoops > 0
        ? smoothFaceName
        : `${featureName}:TRI:${triIndex}`;
      addTriangleFacingOutward(
        solid,
        surfaceFace,
        outputMeshData.vertices[a],
        outputMeshData.vertices[b],
        outputMeshData.vertices[c],
        center,
      );
    }

    solid.userData = solid.userData || {};
    solid.userData.polygonSolid = {
      basePrimitive: readBasePrimitive(this),
      baseShape: source.shape || "cube",
      baseSize: source.size,
      baseDensity: source.density,
      subdivisionLoops,
      controlVertexCount: meshData.vertices.length,
      controlTriangleCount: meshData.triangles.length,
      vertexCount: outputMeshData.vertices.length,
      triangleCount: outputMeshData.triangles.length,
      sourceSignature: meshData.sourceSignature || null,
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
