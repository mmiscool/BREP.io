import * as THREE from 'three';
import { unfoldSheetMetal, exportFlatPatternToSVG } from './sheetMetalUnfold.js';
import { SHEET_METAL_FACE_TYPES } from '../features/sheetMetal/sheetMetalFaceTypes.js';

const EPS = 1e-12;
const BEND_SURFACE_TYPES = new Set(['cylindrical', 'conical']);

const makeEdgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function readVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return new THREE.Vector3(x, y, z);
}

function polylineLength(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1];
    const b = positions[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    length += Math.hypot(dx, dy, dz);
  }
  return length;
}

function deriveAxisFromBoundary(boundary) {
  const positions = boundary?.positions;
  if (!Array.isArray(positions) || positions.length < 2) return null;
  const a = positions[0];
  const b = positions[positions.length - 1];
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (dir.lengthSq() < EPS) return null;
  return dir.normalize();
}

function derivePointFromBoundary(boundary) {
  const positions = boundary?.positions;
  if (!Array.isArray(positions) || positions.length === 0) return null;
  const a = positions[0];
  if (!Array.isArray(a) || a.length < 3) return null;
  return new THREE.Vector3(a[0], a[1], a[2]);
}

function signedAngleAroundAxis(from, to, axis) {
  const cross = new THREE.Vector3().crossVectors(from, to);
  const dot = from.dot(to);
  return Math.atan2(axis.dot(cross), dot);
}

function angleToMatchNormal(from, to, axis) {
  const angleSame = signedAngleAroundAxis(from, to, axis);
  const angleOpp = signedAngleAroundAxis(from, to.clone().multiplyScalar(-1), axis);
  const tmp = from.clone().applyAxisAngle(axis, angleSame);
  const tmpOpp = from.clone().applyAxisAngle(axis, angleOpp);
  return tmp.dot(to) >= tmpOpp.dot(to) ? angleSame : angleOpp;
}

function resolveSheetMetalParams(solid, opts = {}) {
  const fallbackThickness = Number.isFinite(opts.thickness)
    ? Number(opts.thickness)
    : Number(solid?.userData?.sheetMetal?.thickness ?? solid?.userData?.sheetThickness ?? 0);
  const fallbackRadius = Number.isFinite(opts.bendRadius)
    ? Number(opts.bendRadius)
    : Number(solid?.userData?.sheetMetal?.bendRadius ?? solid?.userData?.sheetBendRadius ?? 0);
  const neutral = Number.isFinite(opts.kFactor)
    ? Number(opts.kFactor)
    : (Number.isFinite(opts.neutralFactor)
      ? Number(opts.neutralFactor)
      : Number(solid?.userData?.sheetMetal?.neutralFactor ?? solid?.userData?.sheetMetalNeutralFactor ?? 0.5));
  return {
    thickness: Number.isFinite(fallbackThickness) ? fallbackThickness : 0,
    bendRadius: Number.isFinite(fallbackRadius) ? fallbackRadius : 0,
    kFactor: Number.isFinite(neutral) ? neutral : 0.5,
  };
}

function computeFaceStatsFromMesh(mesh) {
  const positions = mesh?.vertProperties;
  const triVerts = mesh?.triVerts;
  const faceIDs = mesh?.faceID;
  if (!positions || !triVerts || !faceIDs) return new Map();
  const triCount = (triVerts.length / 3) | 0;
  const stats = new Map();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vAB = new THREE.Vector3();
  const vAC = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    let data = stats.get(faceId);
    if (!data) {
      data = { sum: new THREE.Vector3(), centroidSum: new THREE.Vector3(), area: 0, ref: null };
      stats.set(faceId, data);
    }
    const base = t * 3;
    const i0 = triVerts[base + 0];
    const i1 = triVerts[base + 1];
    const i2 = triVerts[base + 2];
    vA.fromArray(positions, i0 * 3);
    vB.fromArray(positions, i1 * 3);
    vC.fromArray(positions, i2 * 3);
    vAB.subVectors(vB, vA);
    vAC.subVectors(vC, vA);
    n.crossVectors(vAB, vAC);
    const len = n.length();
    if (len < EPS) continue;
    const area = len * 0.5;
    n.multiplyScalar(1 / len);
    if (!data.ref) data.ref = n.clone();
    else if (n.dot(data.ref) < 0) n.negate();
    data.sum.addScaledVector(n, area);
    centroid.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3);
    data.centroidSum.addScaledVector(centroid, area);
    data.area += area;
  }

  const out = new Map();
  for (const [faceId, data] of stats.entries()) {
    const normal = data.sum.lengthSq() > EPS
      ? data.sum.normalize()
      : (data.ref ? data.ref.clone().normalize() : new THREE.Vector3(0, 1, 0));
    const centroidFinal = data.area > EPS
      ? data.centroidSum.multiplyScalar(1 / data.area)
      : new THREE.Vector3();
    out.set(faceId, { normal, centroid: centroidFinal, area: data.area });
  }
  return out;
}

function computeMeshBounds(positions) {
  if (!positions || !positions.length) return new THREE.Box3();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const count = (positions.length / 3) | 0;
  for (let i = 0; i < count; i++) {
    v.set(positions[i * 3 + 0], positions[i * 3 + 1], positions[i * 3 + 2]);
    box.expandByPoint(v);
  }
  return box;
}

function buildBendVertexRemap({
  mesh,
  boundaries,
  faceInfo,
  planarFaceIds,
  bendFaceIds,
  faceNameToId,
  epsilon,
}) {
  if (!mesh || !mesh.vertProperties) return { positions: null, remap: null };
  const positions = Array.from(mesh.vertProperties);
  const remap = new Map();
  const bendPointMap = new Map();
  const snap = Number.isFinite(epsilon) ? epsilon : 1e-5;

  for (const boundary of boundaries || []) {
    const faceAName = boundary?.faceA;
    const faceBName = boundary?.faceB;
    if (!faceAName || !faceBName) continue;
    const faceAId = faceNameToId.get(faceAName);
    const faceBId = faceNameToId.get(faceBName);
    if (faceAId == null || faceBId == null) continue;
    const isPlanarA = planarFaceIds.has(faceAId);
    const isPlanarB = planarFaceIds.has(faceBId);
    const isBendA = bendFaceIds.has(faceAId);
    const isBendB = bendFaceIds.has(faceBId);
    if (!(isPlanarA && isBendB) && !(isPlanarB && isBendA)) continue;

    const bendId = isBendA ? faceAId : faceBId;
    const bendMeta = faceInfo.get(bendId)?.meta || {};
    let axisDir = readVec3(bendMeta.axis);
    if (!axisDir) axisDir = deriveAxisFromBoundary(boundary);
    if (!axisDir || axisDir.lengthSq() < EPS) continue;
    axisDir.normalize();
    let axisPoint = readVec3(bendMeta.center);
    if (!axisPoint) axisPoint = derivePointFromBoundary(boundary);
    if (!axisPoint) axisPoint = new THREE.Vector3();

    let map = bendPointMap.get(bendId);
    if (!map) { map = new Map(); bendPointMap.set(bendId, map); }

    const indices = Array.isArray(boundary?.indices) ? boundary.indices : [];
    for (const idx of indices) {
      if (!Number.isFinite(idx)) continue;
      if (remap.has(idx)) continue;
      const px = positions[idx * 3 + 0];
      const py = positions[idx * 3 + 1];
      const pz = positions[idx * 3 + 2];
      const p = new THREE.Vector3(px, py, pz);
      const t = axisDir.dot(p.clone().sub(axisPoint));
      const tSnap = Math.round(t / snap) * snap;
      const key = `${bendId}|${tSnap.toFixed(6)}`;
      let newIdx = map.get(key);
      if (newIdx == null) {
        const proj = axisPoint.clone().addScaledVector(axisDir, tSnap);
        newIdx = (positions.length / 3) | 0;
        positions.push(proj.x, proj.y, proj.z);
        map.set(key, newIdx);
      }
      remap.set(idx, newIdx);
    }
  }

  return {
    positions,
    remap,
  };
}

function buildPlanarGroups({ planarFaceIds, faceInfo, faceStats, boundaries, bounds, opts }) {
  const faceToGroup = new Map();
  const groupNormals = new Map();

  const diag = bounds?.isEmpty?.() ? 0 : bounds.getSize(new THREE.Vector3()).length();
  const normalTol = Number.isFinite(opts.normalTol) ? opts.normalTol : 1e-3;
  const distTol = Number.isFinite(opts.planeTol) ? opts.planeTol : Math.max(1e-6, diag * 1e-5);

  const adjacency = new Map();
  for (const boundary of boundaries || []) {
    const faceAName = boundary?.faceA;
    const faceBName = boundary?.faceB;
    if (!faceAName || !faceBName) continue;
    const faceAId = opts.faceNameToId?.get(faceAName);
    const faceBId = opts.faceNameToId?.get(faceBName);
    if (faceAId == null || faceBId == null) continue;
    if (!planarFaceIds.has(faceAId) || !planarFaceIds.has(faceBId)) continue;
    let list = adjacency.get(faceAId);
    if (!list) { list = new Set(); adjacency.set(faceAId, list); }
    list.add(faceBId);
    list = adjacency.get(faceBId);
    if (!list) { list = new Set(); adjacency.set(faceBId, list); }
    list.add(faceAId);
  }

  let groupId = 0;
  for (const faceId of planarFaceIds) {
    if (faceToGroup.has(faceId)) continue;
    const stack = [faceId];
    faceToGroup.set(faceId, groupId);
    while (stack.length) {
      const current = stack.pop();
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (faceToGroup.has(neighbor)) continue;
        const infoA = faceInfo.get(current);
        const infoB = faceInfo.get(neighbor);
        if (infoA?.sheetType && infoB?.sheetType && infoA.sheetType !== infoB.sheetType) continue;
        const statsA = faceStats.get(current);
        const statsB = faceStats.get(neighbor);
        if (!statsA || !statsB) continue;
        const dot = statsA.normal.dot(statsB.normal);
        if (dot < 1 - normalTol) continue;
        const distA = statsA.normal.dot(statsA.centroid);
        const distB = statsB.normal.dot(statsB.centroid);
        if (Math.abs(distA - distB) > distTol) continue;
        faceToGroup.set(neighbor, groupId);
        stack.push(neighbor);
      }
    }
    groupId += 1;
  }

  for (const [faceId, gid] of faceToGroup.entries()) {
    const stats = faceStats.get(faceId);
    if (!stats) continue;
    const area = stats.area || 0;
    if (!groupNormals.has(gid)) {
      groupNormals.set(gid, stats.normal.clone().multiplyScalar(area));
    } else {
      groupNormals.get(gid).addScaledVector(stats.normal, area);
    }
  }

  for (const [gid, normal] of groupNormals.entries()) {
    if (normal.lengthSq() > EPS) normal.normalize();
    else normal.set(0, 1, 0);
  }

  return { faceToGroup, groupNormals };
}

function buildGeometryFromMesh(mesh, planarFaceIds, faceToGroup, vertexRemap, positionsOverride) {
  if (!mesh || !mesh.vertProperties || !mesh.triVerts || !mesh.faceID) return null;
  const positions = positionsOverride
    ? new Float32Array(positionsOverride)
    : new Float32Array(mesh.vertProperties);
  const triVerts = mesh.triVerts;
  const faceIDs = mesh.faceID;
  const triCount = (triVerts.length / 3) | 0;

  const indices = [];
  const faceIdsAttr = [];
  for (let t = 0; t < triCount; t++) {
    const faceId = faceIDs[t];
    if (!planarFaceIds.has(faceId)) continue;
    const groupId = faceToGroup?.get(faceId);
    if (groupId == null) continue;
    const base = t * 3;
    const i0 = triVerts[base + 0];
    const i1 = triVerts[base + 1];
    const i2 = triVerts[base + 2];
    indices.push(
      vertexRemap?.get(i0) ?? i0,
      vertexRemap?.get(i1) ?? i1,
      vertexRemap?.get(i2) ?? i2,
    );
    faceIdsAttr.push(groupId);
  }

  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indexArray = (positions.length / 3) > 65535
    ? new Uint32Array(indices)
    : new Uint16Array(indices);
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geometry.setAttribute('faceId', new THREE.BufferAttribute(new Uint32Array(faceIdsAttr), 1));
  return geometry;
}

function buildInputsFromSolid(solid, opts = {}) {
  if (!solid || typeof solid.getMesh !== 'function') return null;

  const explicitGeometry = (opts.geometry instanceof THREE.BufferGeometry)
    ? opts.geometry
    : (solid.userData?.flatPatternGeometry || solid.userData?.sheetMetalFlatGeometry);
  const explicitBends = Array.isArray(opts.bends)
    ? opts.bends
    : (solid.userData?.flatPatternBends || solid.userData?.sheetMetalBends);
  if (explicitGeometry instanceof THREE.BufferGeometry && Array.isArray(explicitBends)) {
    return {
      geometry: explicitGeometry,
      bends: explicitBends,
      edgeExclusions: null,
      warnings: [],
    };
  }

  const mesh = solid.getMesh();
  try {
    if (!mesh || !mesh.vertProperties || !mesh.triVerts) return null;
    const faceIDs = mesh.faceID;
    if (!faceIDs || !faceIDs.length) return null;

    const idToName = solid._idToFaceName instanceof Map ? solid._idToFaceName : new Map();
    const faceNameToId = solid._faceNameToID instanceof Map ? solid._faceNameToID : new Map();
    const planarFaceIds = new Set();
    const bendFaceIds = new Set();
    const planarBySide = {
      [SHEET_METAL_FACE_TYPES.A]: new Set(),
      [SHEET_METAL_FACE_TYPES.B]: new Set(),
    };
    const planarFallback = new Set();
    const faceInfo = new Map();
    const faceStats = computeFaceStatsFromMesh(mesh);
    let areaA = 0;
    let areaB = 0;

    for (let t = 0; t < faceIDs.length; t++) {
      const faceId = faceIDs[t];
      if (faceInfo.has(faceId)) continue;
      const faceName = idToName.get(faceId) || `FACE_${faceId}`;
      let meta = {};
      if (typeof solid.getFaceMetadata === 'function') {
        try { meta = solid.getFaceMetadata(faceName) || {}; } catch { meta = {}; }
      }
      const sheetType = meta.sheetMetalFaceType || null;
      const surfaceType = meta.type || null;
      const stats = faceStats.get(faceId);
      if (sheetType === SHEET_METAL_FACE_TYPES.A || sheetType === SHEET_METAL_FACE_TYPES.B) {
        planarBySide[sheetType].add(faceId);
        const area = stats?.area || 0;
        if (sheetType === SHEET_METAL_FACE_TYPES.A) areaA += area;
        if (sheetType === SHEET_METAL_FACE_TYPES.B) areaB += area;
      }
      if (surfaceType && BEND_SURFACE_TYPES.has(surfaceType)) {
        bendFaceIds.add(faceId);
      }
      if (!sheetType && !surfaceType && stats) {
        planarFallback.add(faceId);
      }
      faceInfo.set(faceId, { faceId, faceName, meta, sheetType, surfaceType });
    }

    const hasA = planarBySide[SHEET_METAL_FACE_TYPES.A].size > 0;
    const hasB = planarBySide[SHEET_METAL_FACE_TYPES.B].size > 0;
    const forcedSide = opts.forceSide === SHEET_METAL_FACE_TYPES.A || opts.forceSide === SHEET_METAL_FACE_TYPES.B
      ? opts.forceSide
      : null;
    let chosenSide = null;
    if (forcedSide) {
      chosenSide = forcedSide;
    } else if (hasA || hasB) {
      const prefer = (areaA >= areaB) ? SHEET_METAL_FACE_TYPES.A : SHEET_METAL_FACE_TYPES.B;
      chosenSide = planarBySide[prefer].size ? prefer : (hasA ? SHEET_METAL_FACE_TYPES.A : SHEET_METAL_FACE_TYPES.B);
    }
    if (chosenSide) {
      for (const id of planarBySide[chosenSide]) planarFaceIds.add(id);
    } else {
      for (const id of planarFallback) planarFaceIds.add(id);
    }

    const boundaries = (typeof solid.getBoundaryEdgePolylines === 'function')
      ? (solid.getBoundaryEdgePolylines() || [])
      : [];
    const bounds = computeMeshBounds(mesh.vertProperties);
    const useExplicitBends = Array.isArray(opts.bends) && opts.bends.length;
    let faceToGroup;
    let groupNormals;
    if (useExplicitBends) {
      faceToGroup = new Map();
      groupNormals = new Map();
      for (const faceId of planarFaceIds) {
        faceToGroup.set(faceId, faceId);
        const stats = faceStats.get(faceId);
        if (stats?.normal) groupNormals.set(faceId, stats.normal.clone());
      }
    } else {
      const grouped = buildPlanarGroups({
        planarFaceIds,
        faceInfo,
        faceStats,
        boundaries,
        bounds,
        opts: { normalTol: opts.normalTol, planeTol: opts.planeTol, faceNameToId },
      });
      faceToGroup = grouped.faceToGroup;
      groupNormals = grouped.groupNormals;
    }

    let remap = null;
    let positionsOverride = null;
    if (!useExplicitBends) {
      const remapData = buildBendVertexRemap({
        mesh,
        boundaries,
        faceInfo,
        planarFaceIds,
        bendFaceIds,
        faceNameToId,
        epsilon: opts.epsilon,
      });
      remap = remapData.remap;
      positionsOverride = remapData.positions;
    }

    const geometry = buildGeometryFromMesh(mesh, planarFaceIds, faceToGroup, remap, positionsOverride);
    if (!geometry) return null;

    const params = resolveSheetMetalParams(solid, opts);
    const edgeExclusions = new Set();
    const bendAdj = new Map();

    if (boundaries && boundaries.length) {
      for (const boundary of boundaries) {
        const faceAName = boundary?.faceA;
        const faceBName = boundary?.faceB;
        if (!faceAName || !faceBName) continue;
        const faceAId = faceNameToId.get(faceAName);
        const faceBId = faceNameToId.get(faceBName);
        if (faceAId == null || faceBId == null) continue;

        const isPlanarA = planarFaceIds.has(faceAId);
        const isPlanarB = planarFaceIds.has(faceBId);
        const isBendA = bendFaceIds.has(faceAId);
        const isBendB = bendFaceIds.has(faceBId);

        if ((isBendA && isPlanarB) || (isBendB && isPlanarA)) {
          const bendId = isBendA ? faceAId : faceBId;
          const planarId = isPlanarA ? faceAId : faceBId;
          const groupId = faceToGroup.get(planarId);
          if (groupId == null) continue;
          const length = polylineLength(boundary?.positions);
          let byPlanar = bendAdj.get(bendId);
          if (!byPlanar) { byPlanar = new Map(); bendAdj.set(bendId, byPlanar); }
          const prev = byPlanar.get(groupId);
          if (!prev || length > prev.length) {
            byPlanar.set(groupId, { length, boundary });
          }

          const indices = Array.isArray(boundary?.indices) ? boundary.indices : [];
          for (let i = 1; i < indices.length; i++) {
            const aRaw = indices[i - 1];
            const bRaw = indices[i];
            const a = remap?.get(aRaw) ?? aRaw;
            const b = remap?.get(bRaw) ?? bRaw;
            if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
              edgeExclusions.add(makeEdgeKey(a, b));
            }
          }
        }

        // Note: edges between planar faces are handled by bend metadata exclusion in unfold.
      }
    }

    const bends = Array.isArray(explicitBends)
      ? explicitBends
      : [];

    if (!bends.length) {
      for (const [bendFaceId, neighbors] of bendAdj.entries()) {
        const list = Array.from(neighbors.entries()).map(([planarId, data]) => ({
          planarId,
          length: data.length,
          boundary: data.boundary,
        })).sort((a, b) => b.length - a.length);
        if (list.length < 2) continue;
        const aFaceId = list[0].planarId;
        const bFaceId = list[1].planarId;
        if (aFaceId === bFaceId) continue;
        const bendInfo = faceInfo.get(bendFaceId);
        const meta = bendInfo?.meta || {};
        let axisDir = readVec3(meta.axis);
        if (!axisDir) axisDir = deriveAxisFromBoundary(list[0].boundary);
        if (!axisDir || axisDir.lengthSq() < EPS) continue;
        axisDir.normalize();
        let axisPoint = readVec3(meta.center);
        if (!axisPoint) axisPoint = derivePointFromBoundary(list[0].boundary);
        if (!axisPoint) axisPoint = new THREE.Vector3();

        const nA = groupNormals.get(aFaceId);
        const nB = groupNormals.get(bFaceId);
        let angleRad = 0;
        if (nA && nB) {
          angleRad = angleToMatchNormal(nA, nB, axisDir);
        }

        const radius = Number.isFinite(meta.radius) ? Number(meta.radius) : params.bendRadius;
        const bend = {
          bendId: bendInfo?.faceName || bendFaceId,
          aFaceId,
          bFaceId,
          axisPoint,
          axisDir,
          angleRad,
          radius: Number.isFinite(radius) ? radius : 0,
          thickness: params.thickness,
          kFactor: params.kFactor,
          upDown: angleRad >= 0 ? 'up' : 'down',
        };
        bends.push(bend);
      }
    }

    return {
      geometry,
      bends,
      edgeExclusions,
      warnings: [],
      meta: {
        chosenSide: chosenSide || null,
        hasA,
        hasB,
      },
    };
  } finally {
    try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch { }
  }
}

function scoreFlatPattern(flatPattern) {
  if (!flatPattern) return -1;
  const outlines = Array.isArray(flatPattern.outlines) ? flatPattern.outlines.length : 0;
  const holes = Array.isArray(flatPattern.holes) ? flatPattern.holes.length : 0;
  const bends = Array.isArray(flatPattern.bendLines) ? flatPattern.bendLines.length : 0;
  return outlines * 1000 + bends * 10 - holes;
}

function buildFlatPatternEntry(solid, opts = {}, index = 0) {
  const name = solid?.name || `SHEET_${index + 1}`;
  const tryBuild = (localOpts) => {
    const inputs = buildInputsFromSolid(solid, localOpts);
    if (!inputs || !inputs.geometry) return null;
    const options = {
      rootFaceId: localOpts.rootFaceId,
      epsilon: localOpts.epsilon,
      clipExtent: localOpts.clipExtent,
      edgeExclusions: inputs.edgeExclusions,
    };
    const flatPattern = unfoldSheetMetal(inputs.geometry, inputs.bends || [], options);
    const svg = exportFlatPatternToSVG(flatPattern, {
      includeBends: localOpts.includeBends !== false,
      scale: localOpts.scale,
      padding: localOpts.padding,
      flipY: localOpts.flipY,
    });
    return {
      name,
      flatPattern,
      svg,
      warnings: inputs.warnings || [],
      meta: inputs.meta || null,
    };
  };

  const primary = tryBuild(opts);
  if (!primary) {
    return {
      name,
      flatPattern: null,
      svg: null,
      warnings: ['No flat pattern inputs available for this solid.'],
    };
  }

  const hasA = primary.meta?.hasA;
  const hasB = primary.meta?.hasB;
  if (opts.forceSide || !hasA || !hasB) return primary;

  const altSide = primary.meta?.chosenSide === SHEET_METAL_FACE_TYPES.A
    ? SHEET_METAL_FACE_TYPES.B
    : SHEET_METAL_FACE_TYPES.A;
  const alternate = tryBuild({ ...opts, forceSide: altSide });
  if (!alternate) return primary;

  const scorePrimary = scoreFlatPattern(primary.flatPattern);
  const scoreAlternate = scoreFlatPattern(alternate.flatPattern);
  return scoreAlternate > scorePrimary ? alternate : primary;
}

export function buildSheetMetalFlatPatternSolids(solids, opts = {}) {
  const list = Array.isArray(solids) ? solids : [];
  const entries = [];
  for (let i = 0; i < list.length; i++) {
    const solid = list[i];
    if (!solid || typeof solid.getMesh !== 'function') continue;
    const entry = buildFlatPatternEntry(solid, opts, i);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function buildSheetMetalFlatPatternSvgs(solids, opts = {}) {
  const entries = buildSheetMetalFlatPatternSolids(solids, opts);
  return entries.filter((entry) => !!entry?.svg).map((entry) => ({
    name: entry.name,
    svg: entry.svg,
    flatPattern: entry.flatPattern,
    warnings: entry.warnings,
  }));
}
