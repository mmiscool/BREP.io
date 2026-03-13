import { BREP } from "../../BREP/BREP.js";
import { deepClone } from "../../utils/deepClone.js";
import {
  addTriangleFacingOutward,
  computeBoundsFromPoints,
  computeCenterFromBounds,
} from "../nurbsFaceSolid/nurbsFaceSolidUtils.js";
import { resolveSelectionObject } from "../selectionUtils.js";

const inputParamsSchema = {
  id: {
    type: "string",
    default_value: null,
    hint: "Unique identifier for the smooth-with-subdivision feature",
  },
  targetSolid: {
    type: "reference_selection",
    selectionFilter: ["SOLID"],
    multiple: false,
    default_value: null,
    hint: "Select the source solid to smooth with subdivision",
  },
  subdivisionLoops: {
    type: "number",
    default_value: 1,
    hint: "Subdivision smoothing loops (0 = faceted copy, 1+ = smoother)",
  },
};

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeFaceToken(value) {
  const raw = String(value ?? "").trim();
  return raw || "SURFACE";
}

function normalizeMeshData(rawMeshData) {
  const raw = (rawMeshData && typeof rawMeshData === "object") ? rawMeshData : null;
  const verticesIn = Array.isArray(raw?.vertices) ? raw.vertices : [];
  const trianglesIn = Array.isArray(raw?.triangles) ? raw.triangles : [];
  const tokensIn = Array.isArray(raw?.triangleFaceTokens) ? raw.triangleFaceTokens : [];

  const vertices = [];
  for (const vertex of verticesIn) {
    if (!Array.isArray(vertex) || vertex.length < 3) continue;
    const x = Number(vertex[0]);
    const y = Number(vertex[1]);
    const z = Number(vertex[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    vertices.push([x, y, z]);
  }

  const triangles = [];
  const triangleFaceTokens = [];
  for (let triIndex = 0; triIndex < trianglesIn.length; triIndex += 1) {
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

function readSubdivisionLoops(feature) {
  const raw = Math.floor(normalizeNumber(feature?.inputParams?.subdivisionLoops, 0));
  return Math.max(0, Math.min(5, raw));
}

function buildMeshDataFromSolid(solid) {
  if (!solid || typeof solid.getMesh !== "function") return normalizeMeshData(null);

  let mesh = null;
  try {
    mesh = solid.getMesh();
    const vp = mesh?.vertProperties;
    const tv = mesh?.triVerts;
    if (!vp || !tv || vp.length < 9 || tv.length < 3) return normalizeMeshData(null);

    const vertices = [];
    for (let i = 0; i < vp.length; i += 3) {
      vertices.push([vp[i + 0], vp[i + 1], vp[i + 2]]);
    }

    const triCount = Math.floor(tv.length / 3);
    const faceIDs = mesh?.faceID && mesh.faceID.length === triCount ? mesh.faceID : null;
    const idToFaceName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
    const triangles = [];
    const triangleFaceTokens = [];

    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
      const i0 = tv[(triIndex * 3) + 0] >>> 0;
      const i1 = tv[(triIndex * 3) + 1] >>> 0;
      const i2 = tv[(triIndex * 3) + 2] >>> 0;
      if (i0 >= vertices.length || i1 >= vertices.length || i2 >= vertices.length) continue;
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;

      triangles.push([i0, i1, i2]);
      if (faceIDs) {
        const faceID = faceIDs[triIndex] >>> 0;
        triangleFaceTokens.push(normalizeFaceToken(idToFaceName?.get(faceID) || `FACE_${faceID}`));
      } else {
        triangleFaceTokens.push("SURFACE");
      }
    }

    return normalizeMeshData({
      vertices,
      triangles,
      triangleFaceTokens,
      sourceSignature: `solid:${solid.name || "SOLID"}:${vertices.length}:${triangles.length}`,
    });
  } catch (error) {
    console.warn("[SmoothWithSubdivision] Failed to read source solid mesh.", error);
    return normalizeMeshData(null);
  } finally {
    try { mesh?.delete?.(); } catch { }
  }
}

function copyRetainedFaceMetadata(sourceSolid, targetSolid, faceNames) {
  if (!sourceSolid || !targetSolid || typeof sourceSolid.getFaceMetadata !== "function" || typeof targetSolid.setFaceMetadata !== "function") {
    return;
  }
  const names = faceNames instanceof Set ? faceNames : new Set(Array.isArray(faceNames) ? faceNames : []);
  for (const faceName of names) {
    const normalizedName = String(faceName ?? "").trim();
    if (!normalizedName) continue;
    const metadata = sourceSolid.getFaceMetadata(normalizedName);
    if (!metadata || typeof metadata !== "object" || !Object.keys(metadata).length) continue;
    try {
      targetSolid.setFaceMetadata(normalizedName, deepClone(metadata));
    } catch {
      /* best effort */
    }
  }
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

  for (let triIndex = 0; triIndex < oldTriangles.length; triIndex += 1) {
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

  const nextVertices = oldVertices.map((vertex, vertexIndex) => {
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
    const neighborCount = neighbors.length;
    if (!neighborCount) return [base[0], base[1], base[2]];
    const beta = (neighborCount === 3) ? (3 / 16) : (3 / (8 * neighborCount));
    const scale = 1 - (neighborCount * beta);
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const neighborIndex of neighbors) {
      const neighbor = oldVertices[neighborIndex];
      if (!Array.isArray(neighbor) || neighbor.length < 3) continue;
      sumX += neighbor[0];
      sumY += neighbor[1];
      sumZ += neighbor[2];
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
  for (let triIndex = 0; triIndex < oldTriangles.length; triIndex += 1) {
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
  for (let i = 0; i < count; i += 1) {
    mesh = loopSubdivideOnce(mesh);
    if (!mesh.vertices.length || !mesh.triangles.length) break;
  }
  return mesh;
}

function resolveTargetSolid(feature, partHistory) {
  const rawTarget = Array.isArray(feature?.inputParams?.targetSolid)
    ? (feature.inputParams.targetSolid[0] || null)
    : (feature?.inputParams?.targetSolid || null);
  const target = resolveSelectionObject(rawTarget, partHistory);
  return String(target?.type || "").toUpperCase() === "SOLID" ? target : null;
}

export class SmoothWithSubdivisionFeature {
  static shortName = "SWS";
  static longName = "Smooth With Subdivision";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const solid = items.find((item) => String(item?.type || "").toUpperCase() === "SOLID");
    if (!solid?.name) return false;
    return { params: { targetSolid: solid.name } };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory) {
    const targetSolid = resolveTargetSolid(this, partHistory);
    if (!targetSolid) {
      console.warn("[SmoothWithSubdivision] Target solid was not resolved.");
      return { added: [], removed: [] };
    }

    const sourceMeshData = buildMeshDataFromSolid(targetSolid);
    if (!sourceMeshData.vertices.length || !sourceMeshData.triangles.length) {
      console.warn("[SmoothWithSubdivision] Source solid mesh is empty.");
      return { added: [], removed: [] };
    }

    const subdivisionLoops = readSubdivisionLoops(this);
    const outputMeshData = subdivisionLoops > 0
      ? applySubdivisionLoops(sourceMeshData, subdivisionLoops)
      : sourceMeshData;
    if (!outputMeshData.vertices.length || !outputMeshData.triangles.length) {
      console.warn("[SmoothWithSubdivision] Output mesh is empty after subdivision.");
      return { added: [], removed: [] };
    }

    const featureID = this.inputParams?.featureID || this.inputParams?.id || null;
    const outputName = String(targetSolid.name || featureID || "SMOOTH_WITH_SUBDIVISION");
    const bounds = computeBoundsFromPoints(outputMeshData.vertices);
    const center = computeCenterFromBounds(bounds);

    const solid = new BREP.Solid();
    solid.name = outputName;
    try { if (featureID) solid.owningFeatureID = featureID; } catch { }

    const retainedFaceNames = new Set();
    for (let triIndex = 0; triIndex < outputMeshData.triangles.length; triIndex += 1) {
      const tri = outputMeshData.triangles[triIndex];
      const surfaceFace = normalizeFaceToken(outputMeshData.triangleFaceTokens[triIndex]);
      retainedFaceNames.add(surfaceFace);
      addTriangleFacingOutward(
        solid,
        surfaceFace,
        outputMeshData.vertices[tri[0]],
        outputMeshData.vertices[tri[1]],
        outputMeshData.vertices[tri[2]],
        center,
      );
    }
    copyRetainedFaceMetadata(targetSolid, solid, retainedFaceNames);

    solid.userData = {
      smoothWithSubdivision: {
        sourceSolidName: targetSolid.name || null,
        sourceVertexCount: sourceMeshData.vertices.length,
        sourceTriangleCount: sourceMeshData.triangles.length,
        subdivisionLoops,
        outputVertexCount: outputMeshData.vertices.length,
        outputTriangleCount: outputMeshData.triangles.length,
        retainedFaceCount: retainedFaceNames.size,
      },
    };

    this.persistentData = {
      ...(this.persistentData || {}),
      ...solid.userData.smoothWithSubdivision,
    };

    solid.visualize();
    try { targetSolid.__removeFlag = true; } catch { }
    return { added: [solid], removed: [targetSolid] };
  }
}
