import { BREP } from "../../BREP/BREP.js";
import * as THREE from "three";
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
    try { mesh?.delete?.(); } catch { /* ignore */ }
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

function edgeKey(a, b) {
  const ia = Number(a) | 0;
  const ib = Number(b) | 0;
  return ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
}

function directedEdgeKey(a, b) {
  return `${Number(a) | 0}:${Number(b) | 0}`;
}

function averagePoints(points) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const point of list) {
    if (!Array.isArray(point) || point.length < 3) continue;
    sx += Number(point[0]) || 0;
    sy += Number(point[1]) || 0;
    sz += Number(point[2]) || 0;
    count += 1;
  }
  if (!count) return [0, 0, 0];
  return [sx / count, sy / count, sz / count];
}

function midpoint(a, b) {
  return [
    0.5 * ((Number(a?.[0]) || 0) + (Number(b?.[0]) || 0)),
    0.5 * ((Number(a?.[1]) || 0) + (Number(b?.[1]) || 0)),
    0.5 * ((Number(a?.[2]) || 0) + (Number(b?.[2]) || 0)),
  ];
}

function signedArea2D(loopInput) {
  const loop = Array.isArray(loopInput) ? loopInput : [];
  if (loop.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += ((Number(a?.[0]) || 0) * (Number(b?.[1]) || 0)) - ((Number(b?.[0]) || 0) * (Number(a?.[1]) || 0));
  }
  return 0.5 * area;
}

function cleanLoopIndices(loopInput) {
  const loop = Array.isArray(loopInput) ? loopInput.slice() : [];
  if (loop.length >= 2 && loop[0] === loop[loop.length - 1]) loop.pop();
  const out = [];
  for (const value of loop) {
    const index = Number(value) | 0;
    if (out.length && out[out.length - 1] === index) continue;
    out.push(index);
  }
  if (out.length >= 2 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function computeComponentNormal(component, triangles, vertices) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const triIndex of component) {
    const tri = triangles[triIndex];
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const p0 = vertices[tri[0]];
    const p1 = vertices[tri[1]];
    const p2 = vertices[tri[2]];
    if (!Array.isArray(p0) || !Array.isArray(p1) || !Array.isArray(p2)) continue;
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p2[0] - p0[0];
    const by = p2[1] - p0[1];
    const bz = p2[2] - p0[2];
    nx += (ay * bz) - (az * by);
    ny += (az * bx) - (ax * bz);
    nz += (ax * by) - (ay * bx);
  }
  const length = Math.hypot(nx, ny, nz);
  if (!(length > 1e-12)) return null;
  return [nx / length, ny / length, nz / length];
}

function projectVerticesToPlane2D(loopIndices, vertices, normal) {
  const n = Array.isArray(normal) ? normal : [0, 0, 1];
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = (ref[1] * n[2]) - (ref[2] * n[1]);
  const uy = (ref[2] * n[0]) - (ref[0] * n[2]);
  const uz = (ref[0] * n[1]) - (ref[1] * n[0]);
  const uLength = Math.hypot(ux, uy, uz);
  if (!(uLength > 1e-12)) return null;
  const u = [ux / uLength, uy / uLength, uz / uLength];
  const v = [
    (n[1] * u[2]) - (n[2] * u[1]),
    (n[2] * u[0]) - (n[0] * u[2]),
    (n[0] * u[1]) - (n[1] * u[0]),
  ];
  return loopIndices.map((index) => {
    const point = vertices[index];
    return [
      ((point?.[0] || 0) * u[0]) + ((point?.[1] || 0) * u[1]) + ((point?.[2] || 0) * u[2]),
      ((point?.[0] || 0) * v[0]) + ((point?.[1] || 0) * v[1]) + ((point?.[2] || 0) * v[2]),
    ];
  });
}

function retriangulatePlanarLoops(loops, component, triangles, vertices, token) {
  if (!Array.isArray(loops) || loops.length < 2) return null;
  const normal = computeComponentNormal(component, triangles, vertices);
  if (!normal) return null;

  const projected = loops.map((loop) => {
    const indices = cleanLoopIndices(loop);
    return {
      indices,
      points2D: projectVerticesToPlane2D(indices, vertices, normal),
    };
  }).filter((entry) => Array.isArray(entry.points2D) && entry.points2D.length >= 3);
  if (projected.length < 2) return null;

  let outerIndex = -1;
  let outerArea = -Infinity;
  for (let i = 0; i < projected.length; i += 1) {
    const area = Math.abs(signedArea2D(projected[i].points2D));
    if (area > outerArea) {
      outerArea = area;
      outerIndex = i;
    }
  }
  if (outerIndex < 0) return null;

  const contourEntry = projected[outerIndex];
  let contour2D = contourEntry.points2D.slice();
  let contourIndices = contourEntry.indices.slice();
  if (signedArea2D(contour2D) > 0) {
    contour2D = contour2D.slice().reverse();
    contourIndices = contourIndices.slice().reverse();
  }

  const holes2D = [];
  const holeIndices = [];
  for (let i = 0; i < projected.length; i += 1) {
    if (i === outerIndex) continue;
    let loop2D = projected[i].points2D.slice();
    let loopIndices = projected[i].indices.slice();
    if (signedArea2D(loop2D) < 0) {
      loop2D = loop2D.slice().reverse();
      loopIndices = loopIndices.slice().reverse();
    }
    holes2D.push(loop2D.map((point) => new THREE.Vector2(point[0], point[1])));
    holeIndices.push(loopIndices);
  }

  if (holeIndices.length === 1 && contourIndices.length === holeIndices[0].length && contourIndices.length >= 3) {
    let holeLoop2D = holes2D[0].map((point) => [point.x, point.y]).reverse();
    let holeLoopIndices = holeIndices[0].slice().reverse();
    let bestShift = 0;
    let bestDistance = Infinity;
    for (let shift = 0; shift < holeLoopIndices.length; shift += 1) {
      let score = 0;
      for (let i = 0; i < contourIndices.length; i += 1) {
        const holePoint = holeLoop2D[(i + shift) % holeLoop2D.length];
        const contourPoint = contour2D[i];
        score += Math.hypot(
          (Number(contourPoint?.[0]) || 0) - (Number(holePoint?.[0]) || 0),
          (Number(contourPoint?.[1]) || 0) - (Number(holePoint?.[1]) || 0),
        );
      }
      if (score < bestDistance) {
        bestDistance = score;
        bestShift = shift;
      }
    }

    const rotate = (array, shift) => array.map((_, index) => array[(index + shift) % array.length]);
    holeLoop2D = rotate(holeLoop2D, bestShift);
    holeLoopIndices = rotate(holeLoopIndices, bestShift);

    const stripFaces = [];
    for (let i = 0; i < contourIndices.length; i += 1) {
      const next = (i + 1) % contourIndices.length;
      const quad = [
        contourIndices[i],
        contourIndices[next],
        holeLoopIndices[next],
        holeLoopIndices[i],
      ];
      if (quad.some((index) => !Number.isInteger(index))) continue;
      stripFaces.push({ vertices: quad, token });
    }
    if (stripFaces.length === contourIndices.length) return stripFaces;
  }

  const tris = THREE.ShapeUtils.triangulateShape(
    contour2D.map((point) => new THREE.Vector2(point[0], point[1])),
    holes2D,
  );
  if (!Array.isArray(tris) || !tris.length) return null;

  const allIndices = contourIndices.concat(...holeIndices);
  const faces = [];
  for (const tri of tris) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = allIndices[tri[0]];
    const b = allIndices[tri[1]];
    const c = allIndices[tri[2]];
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) continue;
    if (a === b || b === c || c === a) continue;
    faces.push({ vertices: [a, b, c], token });
  }
  return faces.length ? faces : null;
}

function buildControlMeshFromTriangles(meshDataInput) {
  const meshData = normalizeMeshData(meshDataInput);
  const vertices = meshData.vertices.map((vertex) => vertex.slice());
  const triangles = meshData.triangles;
  const tokens = meshData.triangleFaceTokens;
  const faces = [];
  if (!vertices.length || !triangles.length) {
    return { vertices, faces, sourceSignature: meshData.sourceSignature };
  }

  const tokenToTriangles = new Map();
  for (let triIndex = 0; triIndex < triangles.length; triIndex += 1) {
    const token = normalizeFaceToken(tokens[triIndex] || "SURFACE");
    let list = tokenToTriangles.get(token);
    if (!list) {
      list = [];
      tokenToTriangles.set(token, list);
    }
    list.push(triIndex);
  }

  for (const [token, triIndices] of tokenToTriangles.entries()) {
    const triAdjacency = new Map();
    const tokenEdges = new Map();
    for (const triIndex of triIndices) {
      triAdjacency.set(triIndex, []);
      const tri = triangles[triIndex];
      if (!Array.isArray(tri) || tri.length < 3) continue;
      const triEdges = [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ];
      for (const [a, b] of triEdges) {
        const key = edgeKey(a, b);
        let list = tokenEdges.get(key);
        if (!list) {
          list = [];
          tokenEdges.set(key, list);
        }
        list.push(triIndex);
      }
    }

    for (const triList of tokenEdges.values()) {
      if (!Array.isArray(triList) || triList.length !== 2) continue;
      const a = triList[0];
      const b = triList[1];
      triAdjacency.get(a)?.push(b);
      triAdjacency.get(b)?.push(a);
    }

    const seen = new Set();
    for (const seed of triIndices) {
      if (seen.has(seed)) continue;
      const component = [];
      const stack = [seed];
      seen.add(seed);
      while (stack.length) {
        const triIndex = stack.pop();
        component.push(triIndex);
        const neighbors = triAdjacency.get(triIndex) || [];
        for (const neighbor of neighbors) {
          if (seen.has(neighbor)) continue;
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }

      const boundaryEdgeInfo = new Map();
      for (const triIndex of component) {
        const tri = triangles[triIndex];
        if (!Array.isArray(tri) || tri.length < 3) continue;
        const triEdges = [
          [tri[0], tri[1]],
          [tri[1], tri[2]],
          [tri[2], tri[0]],
        ];
        for (const [a, b] of triEdges) {
          const key = edgeKey(a, b);
          let edge = boundaryEdgeInfo.get(key);
          if (!edge) {
            edge = { count: 0, directed: [a, b] };
            boundaryEdgeInfo.set(key, edge);
          }
          edge.count += 1;
        }
      }

      const outgoing = new Map();
      const incoming = new Map();
      const boundaryDirected = [];
      let cleanComponent = true;
      for (const edge of boundaryEdgeInfo.values()) {
        if (edge.count !== 1) continue;
        const [a, b] = edge.directed;
        boundaryDirected.push([a, b]);
        if (!outgoing.has(a)) outgoing.set(a, []);
        outgoing.get(a).push(b);
        incoming.set(b, (incoming.get(b) || 0) + 1);
      }

      if (!boundaryDirected.length) {
        cleanComponent = false;
      } else {
        const boundaryVertices = new Set();
        for (const [a, b] of boundaryDirected) {
          boundaryVertices.add(a);
          boundaryVertices.add(b);
        }
        for (const vertexIndex of boundaryVertices) {
          const outDegree = (outgoing.get(vertexIndex) || []).length;
          const inDegree = incoming.get(vertexIndex) || 0;
          if (outDegree !== 1 || inDegree !== 1) {
            cleanComponent = false;
            break;
          }
        }
      }

      if (!cleanComponent) {
        for (const triIndex of component) {
          const tri = triangles[triIndex];
          faces.push({ vertices: [tri[0], tri[1], tri[2]], token });
        }
        continue;
      }

      const visited = new Set();
      const loops = [];
      for (const [start, next] of boundaryDirected) {
        const startKey = directedEdgeKey(start, next);
        if (visited.has(startKey)) continue;
        const loop = [start];
        let a = start;
        let b = next;
        let guard = 0;
        while (guard < (boundaryDirected.length + 2)) {
          guard += 1;
          visited.add(directedEdgeKey(a, b));
          loop.push(b);
          if (b === start) break;
          const outgoingEdges = outgoing.get(b) || [];
          if (!outgoingEdges.length) break;
          const c = outgoingEdges[0];
          a = b;
          b = c;
        }
        const cleaned = cleanLoopIndices(loop);
        if (cleaned.length >= 3) loops.push(cleaned);
      }

      if (loops.length !== 1) {
        const retriangulated = retriangulatePlanarLoops(loops, component, triangles, vertices, token);
        if (retriangulated?.length) {
          faces.push(...retriangulated);
          continue;
        }
        for (const triIndex of component) {
          const tri = triangles[triIndex];
          faces.push({ vertices: [tri[0], tri[1], tri[2]], token });
        }
        continue;
      }

      faces.push({ vertices: loops[0], token });
    }
  }

  return {
    vertices,
    faces,
    sourceSignature: meshData.sourceSignature,
  };
}

function catmullClarkSubdivideOnce(controlMeshInput) {
  const controlMesh = (controlMeshInput && typeof controlMeshInput === "object") ? controlMeshInput : null;
  const vertices = Array.isArray(controlMesh?.vertices) ? controlMesh.vertices : [];
  const faces = Array.isArray(controlMesh?.faces) ? controlMesh.faces : [];
  if (!vertices.length || !faces.length) return controlMesh;

  const facePoints = [];
  const vertexFaces = Array.from({ length: vertices.length }, () => new Set());
  const vertexEdges = Array.from({ length: vertices.length }, () => new Set());
  const edges = new Map();

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    const loop = cleanLoopIndices(face?.vertices);
    if (loop.length < 3) {
      facePoints.push([0, 0, 0]);
      continue;
    }
    face.vertices = loop;
    facePoints.push(averagePoints(loop.map((index) => vertices[index])));
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (a < 0 || b < 0 || a >= vertices.length || b >= vertices.length || a === b) continue;
      vertexFaces[a].add(faceIndex);
      vertexEdges[a].add(edgeKey(a, b));
      vertexEdges[b].add(edgeKey(a, b));
      let edge = edges.get(edgeKey(a, b));
      if (!edge) {
        edge = { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
        edges.set(edgeKey(a, b), edge);
      }
      edge.faces.push(faceIndex);
    }
  }

  const nextVertices = [];
  const originalVertexIndices = new Array(vertices.length).fill(-1);
  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const point = vertices[vertexIndex];
    const boundaryNeighbors = [];
    for (const key of vertexEdges[vertexIndex]) {
      const edge = edges.get(key);
      if (!edge || edge.faces.length !== 1) continue;
      const neighbor = edge.a === vertexIndex ? edge.b : edge.a;
      if (boundaryNeighbors.includes(neighbor)) continue;
      boundaryNeighbors.push(neighbor);
    }

    let nextPoint = Array.isArray(point) ? point.slice() : [0, 0, 0];
    if (boundaryNeighbors.length >= 2) {
      const v1 = vertices[boundaryNeighbors[0]];
      const v2 = vertices[boundaryNeighbors[1]];
      nextPoint = [
        (0.75 * point[0]) + (0.125 * ((v1?.[0] || 0) + (v2?.[0] || 0))),
        (0.75 * point[1]) + (0.125 * ((v1?.[1] || 0) + (v2?.[1] || 0))),
        (0.75 * point[2]) + (0.125 * ((v1?.[2] || 0) + (v2?.[2] || 0))),
      ];
    } else {
      const faceList = Array.from(vertexFaces[vertexIndex]);
      const edgeList = Array.from(vertexEdges[vertexIndex]);
      const n = Math.max(faceList.length, edgeList.length);
      if (n > 0) {
        const f = averagePoints(faceList.map((faceIndex) => facePoints[faceIndex as number]));
        const r = averagePoints(edgeList.map((key) => {
          const edge = edges.get(key);
          if (!edge) return [0, 0, 0];
          return midpoint(vertices[edge.a], vertices[edge.b]);
        }));
        nextPoint = [
          (f[0] + (2 * r[0]) + ((n - 3) * point[0])) / n,
          (f[1] + (2 * r[1]) + ((n - 3) * point[1])) / n,
          (f[2] + (2 * r[2]) + ((n - 3) * point[2])) / n,
        ];
      }
    }

    originalVertexIndices[vertexIndex] = nextVertices.length;
    nextVertices.push(nextPoint);
  }

  const facePointIndices = new Array(facePoints.length).fill(-1);
  for (let faceIndex = 0; faceIndex < facePoints.length; faceIndex += 1) {
    facePointIndices[faceIndex] = nextVertices.length;
    nextVertices.push(facePoints[faceIndex]);
  }

  const edgePointIndices = new Map();
  for (const [key, edge] of edges.entries()) {
    const va = vertices[edge.a];
    const vb = vertices[edge.b];
    let edgePoint = midpoint(va, vb);
    if (edge.faces.length >= 2) {
      const fa = facePoints[edge.faces[0]];
      const fb = facePoints[edge.faces[1]];
      edgePoint = [
        0.25 * ((va?.[0] || 0) + (vb?.[0] || 0) + (fa?.[0] || 0) + (fb?.[0] || 0)),
        0.25 * ((va?.[1] || 0) + (vb?.[1] || 0) + (fa?.[1] || 0) + (fb?.[1] || 0)),
        0.25 * ((va?.[2] || 0) + (vb?.[2] || 0) + (fa?.[2] || 0) + (fb?.[2] || 0)),
      ];
    }
    edgePointIndices.set(key, nextVertices.length);
    nextVertices.push(edgePoint);
  }

  const nextFaces = [];
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    const loop = cleanLoopIndices(face?.vertices);
    if (loop.length < 3) continue;
    const facePointIndex = facePointIndices[faceIndex];
    for (let i = 0; i < loop.length; i += 1) {
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const current = loop[i];
      const next = loop[(i + 1) % loop.length];
      const quad = [
        originalVertexIndices[current],
        edgePointIndices.get(edgeKey(current, next)),
        facePointIndex,
        edgePointIndices.get(edgeKey(prev, current)),
      ];
      if (quad.some((index) => !Number.isInteger(index))) continue;
      nextFaces.push({ vertices: quad, token: normalizeFaceToken(face?.token || "SURFACE") });
    }
  }

  return {
    vertices: nextVertices,
    faces: nextFaces,
    sourceSignature: controlMesh?.sourceSignature || null,
  };
}

function controlMeshToTriangleMesh(controlMeshInput) {
  const controlMesh = (controlMeshInput && typeof controlMeshInput === "object") ? controlMeshInput : null;
  const vertices = Array.isArray(controlMesh?.vertices) ? controlMesh.vertices : [];
  const faces = Array.isArray(controlMesh?.faces) ? controlMesh.faces : [];
  const triangles = [];
  const triangleFaceTokens = [];

  for (const face of faces) {
    const loop = cleanLoopIndices(face?.vertices);
    if (loop.length < 3) continue;
    const token = normalizeFaceToken(face?.token || "SURFACE");
    if (loop.length === 3) {
      triangles.push([loop[0], loop[1], loop[2]]);
      triangleFaceTokens.push(token);
      continue;
    }
    if (loop.length === 4) {
      triangles.push([loop[0], loop[1], loop[2]]);
      triangles.push([loop[0], loop[2], loop[3]]);
      triangleFaceTokens.push(token, token);
      continue;
    }
    for (let i = 1; i < loop.length - 1; i += 1) {
      triangles.push([loop[0], loop[i], loop[i + 1]]);
      triangleFaceTokens.push(token);
    }
  }

  return normalizeMeshData({
    vertices,
    triangles,
    triangleFaceTokens,
    sourceSignature: controlMesh?.sourceSignature || null,
  });
}

function reflectPointAcrossAxis(point, axis, coord) {
  const out = Array.isArray(point) ? point.slice(0, 3) : [0, 0, 0];
  const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  out[axisIndex] = (2 * coord) - (Number(out[axisIndex]) || 0);
  return out;
}

function buildSpatialHash(points, cellSize) {
  const size = Math.max(1e-9, Number(cellSize) || 1);
  const cells = new Map();
  const toCell = (point) => [
    Math.round((Number(point?.[0]) || 0) / size),
    Math.round((Number(point?.[1]) || 0) / size),
    Math.round((Number(point?.[2]) || 0) / size),
  ];
  for (let index = 0; index < points.length; index += 1) {
    const cell = toCell(points[index]);
    const key = `${cell[0]}:${cell[1]}:${cell[2]}`;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(index);
  }
  return { size, cells, toCell };
}

function findClosestPointIndex(points, spatialHash, targetPoint, searchRange = 1) {
  if (!Array.isArray(points) || !points.length || !spatialHash) return { index: -1, distance: Infinity };
  const baseCell = spatialHash.toCell(targetPoint);
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let dx = -searchRange; dx <= searchRange; dx += 1) {
    for (let dy = -searchRange; dy <= searchRange; dy += 1) {
      for (let dz = -searchRange; dz <= searchRange; dz += 1) {
        const key = `${baseCell[0] + dx}:${baseCell[1] + dy}:${baseCell[2] + dz}`;
        const bucket = spatialHash.cells.get(key);
        if (!bucket?.length) continue;
        for (const index of bucket) {
          const point = points[index];
          const distance = Math.hypot(
            (Number(point?.[0]) || 0) - (Number(targetPoint?.[0]) || 0),
            (Number(point?.[1]) || 0) - (Number(targetPoint?.[1]) || 0),
            (Number(point?.[2]) || 0) - (Number(targetPoint?.[2]) || 0),
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        }
      }
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

function detectSymmetryPlanes(meshDataInput) {
  const meshData = normalizeMeshData(meshDataInput);
  const vertices = meshData.vertices;
  if (!vertices.length) return [];

  const bounds = computeBoundsFromPoints(vertices);
  const center = computeCenterFromBounds(bounds);
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const diag = Math.max(1e-6, Math.hypot(dx, dy, dz));
  const tolerance = Math.max(1e-5, diag * 1e-5);

  const candidates = [
    { axis: "x", coord: center[0] },
    { axis: "y", coord: center[1] },
    { axis: "z", coord: center[2] },
  ];
  const accepted = [];

  for (const candidate of candidates) {
    const spatialHash = buildSpatialHash(vertices, tolerance * 2);
    let maxDistance = 0;
    let sumDistance = 0;
    let onPlaneCount = 0;
    let ok = true;

    for (const vertex of vertices) {
      const reflected = reflectPointAcrossAxis(vertex, candidate.axis, candidate.coord);
      const match = findClosestPointIndex(vertices, spatialHash, reflected, 1);
      if (match.index < 0 || match.distance > (tolerance * 2)) {
        ok = false;
        break;
      }
      const axisIndex = candidate.axis === "x" ? 0 : candidate.axis === "y" ? 1 : 2;
      if (Math.abs((Number(vertex?.[axisIndex]) || 0) - candidate.coord) <= tolerance) onPlaneCount += 1;
      if (match.distance > maxDistance) maxDistance = match.distance;
      sumDistance += match.distance;
    }

    if (!ok) continue;
    accepted.push({
      axis: candidate.axis,
      coord: candidate.coord,
      tolerance,
      maxDistance,
      meanDistance: vertices.length ? (sumDistance / vertices.length) : 0,
      onPlaneCount,
      diag,
    });
  }

  return accepted;
}

function enforceSymmetryOnVertices(verticesInput, planesInput) {
  const vertices = Array.isArray(verticesInput) ? verticesInput.map((point) => point.slice()) : [];
  const planes = Array.isArray(planesInput) ? planesInput : [];
  if (!vertices.length || !planes.length) return vertices;

  for (const plane of planes) {
    const axis = plane?.axis;
    const coord = Number(plane?.coord);
    const diag = Math.max(1e-6, Number(plane?.diag) || 1);
    if (!Number.isFinite(coord) || (axis !== "x" && axis !== "y" && axis !== "z")) continue;
    const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const projectTolerance = Math.max(Number(plane?.tolerance) || 1e-5, diag * 1e-5);
    const searchCellSize = Math.max(projectTolerance * 8, diag * 0.02);
    const searchTolerance = Math.max(projectTolerance * 32, diag * 0.12);
    const spatialHash = buildSpatialHash(vertices, searchCellSize);
    const nearest = new Array(vertices.length).fill(-1);
    const distances = new Array(vertices.length).fill(Infinity);

    for (let index = 0; index < vertices.length; index += 1) {
      const reflected = reflectPointAcrossAxis(vertices[index], axis, coord);
      const match = findClosestPointIndex(vertices, spatialHash, reflected, 3);
      nearest[index] = match.index;
      distances[index] = match.distance;
    }

    const processed = new Set();
    for (let index = 0; index < vertices.length; index += 1) {
      if (processed.has(index)) continue;
      const point = vertices[index];
      const axisOffset = (Number(point?.[axisIndex]) || 0) - coord;
      if (Math.abs(axisOffset) <= projectTolerance) {
        vertices[index][axisIndex] = coord;
        processed.add(index);
        continue;
      }

      const partner = nearest[index];
      if (!Number.isInteger(partner) || partner < 0 || partner >= vertices.length) continue;
      if (processed.has(partner)) continue;
      if (distances[index] > searchTolerance) continue;
      if (nearest[partner] !== index && distances[partner] > searchTolerance) continue;

      if (partner === index) {
        vertices[index][axisIndex] = coord;
        processed.add(index);
        continue;
      }

      const reflectedPartner = reflectPointAcrossAxis(vertices[partner], axis, coord);
      const average = [
        0.5 * ((Number(vertices[index]?.[0]) || 0) + (Number(reflectedPartner[0]) || 0)),
        0.5 * ((Number(vertices[index]?.[1]) || 0) + (Number(reflectedPartner[1]) || 0)),
        0.5 * ((Number(vertices[index]?.[2]) || 0) + (Number(reflectedPartner[2]) || 0)),
      ];
      const mirroredAverage = reflectPointAcrossAxis(average, axis, coord);
      vertices[index] = average;
      vertices[partner] = mirroredAverage;
      processed.add(index);
      processed.add(partner);
    }
  }

  return vertices;
}

function stabilizeControlMeshSymmetry(controlMeshInput, planesInput) {
  const controlMesh = (controlMeshInput && typeof controlMeshInput === "object") ? controlMeshInput : null;
  if (!controlMesh?.vertices?.length) return controlMeshInput;
  return {
    ...controlMesh,
    vertices: enforceSymmetryOnVertices(controlMesh.vertices, planesInput),
  };
}

function applySubdivisionLoops(meshDataInput, loops) {
  const count = Math.max(0, Math.floor(normalizeNumber(loops, 0)));
  if (count <= 0) return normalizeMeshData(meshDataInput);

  const symmetryPlanes = detectSymmetryPlanes(meshDataInput);
  let controlMesh = buildControlMeshFromTriangles(meshDataInput);
  if (!controlMesh.vertices.length || !controlMesh.faces.length) {
    return normalizeMeshData(meshDataInput);
  }
  if (symmetryPlanes.length) controlMesh = stabilizeControlMeshSymmetry(controlMesh, symmetryPlanes);

  for (let i = 0; i < count; i += 1) {
    controlMesh = catmullClarkSubdivideOnce(controlMesh);
    if (!controlMesh?.vertices?.length || !controlMesh?.faces?.length) break;
    if (symmetryPlanes.length) controlMesh = stabilizeControlMeshSymmetry(controlMesh, symmetryPlanes);
  }

  const outputMesh = controlMeshToTriangleMesh(controlMesh);
  if (!symmetryPlanes.length) return outputMesh;
  return normalizeMeshData({
    ...outputMesh,
    vertices: enforceSymmetryOnVertices(outputMesh.vertices, symmetryPlanes),
  });
}

function resolveTargetSolid(feature, partHistory) {
  const rawTarget = Array.isArray(feature?.inputParams?.targetSolid)
    ? (feature.inputParams.targetSolid[0] || null)
    : (feature?.inputParams?.targetSolid || null);
  const target = resolveSelectionObject(rawTarget, partHistory);
  return String(target?.type || "").toUpperCase() === "SOLID" ? target : null;
}

export class SmoothWithSubdivisionFeature {
  [key: string]: any;

  static shortName = "SWS";
  static longName = "Smooth With Subdivision";
  static inputParamsSchema = inputParamsSchema;
  static showContexButton(selectedItems: any) {
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const solid = items.find((item) => String(item?.type || "").toUpperCase() === "SOLID");
    if (!solid?.name) return false;
    return { params: { targetSolid: solid.name } };
  }

  constructor() {
    this.inputParams = {};
    this.persistentData = {};
  }

  async run(partHistory: any) {
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
    try { if (featureID) solid.owningFeatureID = featureID; } catch { /* ignore */ }

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
    try { targetSolid.__removeFlag = true; } catch { /* ignore */ }
    return { added: [solid], removed: [targetSolid] };
  }
}
