import { Solid } from './BetterSolid.js';
import {
  analyzePolyhedralSolid,
  buildOffsetPolyhedralSolid,
} from './polyhedralOffset.js';

function _solidScale(solid) {
  const verts = Array.isArray(solid?._vertProperties)
    ? solid._vertProperties
    : Array.from(solid?._vertProperties || []);
  if (verts.length < 3) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const x = Number(verts[i]) || 0;
    const y = Number(verts[i + 1]) || 0;
    const z = Number(verts[i + 2]) || 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
}

function _pointKey(point) {
  return [
    Number(point?.[0]) || 0,
    Number(point?.[1]) || 0,
    Number(point?.[2]) || 0,
  ].map((value) => value.toFixed(8)).join(',');
}

function _triangleNormal(points) {
  const ax = points[0][0];
  const ay = points[0][1];
  const az = points[0][2];
  const bx = points[1][0];
  const by = points[1][1];
  const bz = points[1][2];
  const cx = points[2][0];
  const cy = points[2][1];
  const cz = points[2][2];
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  return [
    (uy * vz) - (uz * vy),
    (uz * vx) - (ux * vz),
    (ux * vy) - (uy * vx),
  ];
}

function _triangleNormalDot(points, normal) {
  const triNormal = _triangleNormal(points);
  return (
    triNormal[0] * normal[0]
    + triNormal[1] * normal[1]
    + triNormal[2] * normal[2]
  );
}

function _buildPlanarFaceCutter(faceTris, faceNormal, distances = {}) {
  const normal = [
    Number(faceNormal?.x) || 0,
    Number(faceNormal?.y) || 0,
    Number(faceNormal?.z) || 0,
  ];
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
  if (normalLength <= 1e-12 || !Array.isArray(faceTris) || !faceTris.length) return null;
  const unitNormal = normal.map((value) => value / normalLength);
  const outwardDistance = Math.max(1, Number(distances.outward) || 0);
  const inwardDistance = Math.max(1, Number(distances.inward) || 0);
  const cutter = new Solid();
  const boundaryEdgeCounts = new Map();
  const boundaryEdgeInfo = new Map();
  const orientedTris = [];

  for (const tri of faceTris) {
    let points = [tri?.p1, tri?.p2, tri?.p3].map((point) => [
      Number(point?.[0]) || 0,
      Number(point?.[1]) || 0,
      Number(point?.[2]) || 0,
    ]);
    if (_triangleNormalDot(points, unitNormal) < 0) {
      points = [points[0], points[2], points[1]];
    }
    orientedTris.push(points);
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const keyA = _pointKey(points[a]);
      const keyB = _pointKey(points[b]);
      const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      boundaryEdgeCounts.set(edgeKey, (Number(boundaryEdgeCounts.get(edgeKey)) || 0) + 1);
      if (!boundaryEdgeInfo.has(edgeKey)) boundaryEdgeInfo.set(edgeKey, [points[a], points[b]]);
    }
  }

  const shiftPoint = (point, distance) => ([
    point[0] + (unitNormal[0] * distance),
    point[1] + (unitNormal[1] * distance),
    point[2] + (unitNormal[2] * distance),
  ]);

  for (const points of orientedTris) {
    const outward = points.map((point) => shiftPoint(point, outwardDistance));
    const inward = points.map((point) => shiftPoint(point, -inwardDistance));
    cutter.addTriangle('CUTTER_OUT', outward[0], outward[1], outward[2]);
    cutter.addTriangle('CUTTER_IN', inward[0], inward[2], inward[1]);
  }

  for (const [edgeKey, count] of boundaryEdgeCounts.entries()) {
    if (count !== 1) continue;
    const [pointA, pointB] = boundaryEdgeInfo.get(edgeKey) || [];
    if (!pointA || !pointB) continue;
    const aOut = shiftPoint(pointA, outwardDistance);
    const bOut = shiftPoint(pointB, outwardDistance);
    const aIn = shiftPoint(pointA, -inwardDistance);
    const bIn = shiftPoint(pointB, -inwardDistance);
    cutter.addTriangle('CUTTER_SIDE', aOut, bOut, bIn);
    cutter.addTriangle('CUTTER_SIDE', aOut, bIn, aIn);
  }

  return cutter;
}

function _attemptNegativeOpenShellBooleanFallback(sourceSolid, analysis, distance, options = {}) {
  const removeFaceNames = Array.isArray(options.removeFaceNames) ? options.removeFaceNames : [];
  if (!(Number(distance) < 0) || !removeFaceNames.length) return null;
  if (!analysis?.faceMap) return null;
  for (const faceName of removeFaceNames) {
    const face = analysis.faceMap.get(faceName);
    if (!face?.support || face.support.kind !== 'plane') return null;
  }

  const newSolidName = String(options.newSolidName || `${sourceSolid?.name || 'Solid'}_shell`).trim() || `${sourceSolid?.name || 'Solid'}_shell`;
  const repairPasses = Number(options.repairPasses) || 4;
  const innerClosed = buildOffsetPolyhedralSolid(sourceSolid, analysis, distance, {
    newSolidName: `${newSolidName}_INNER`,
    repairPasses,
    removeFaceNames: [],
  });
  if (!innerClosed) return null;

  let shell = null;
  try {
    shell = sourceSolid.subtract(innerClosed);
  } catch {
    return null;
  }
  if (!shell) return null;

  const modelScale = _solidScale(sourceSolid);
  const cutterDistances = {
    outward: Math.max(Math.abs(Number(distance) || 0) * 8, modelScale * 0.25),
    inward: Math.max(Math.abs(Number(distance) || 0) * 32, modelScale * 1.5),
  };
  for (const faceName of removeFaceNames) {
    const sourceFace = analysis.faceMap.get(faceName);
    const faceTris = typeof sourceSolid.getFace === 'function' ? (sourceSolid.getFace(faceName) || []) : [];
    const cutter = _buildPlanarFaceCutter(faceTris, sourceFace?.normal, cutterDistances);
    if (!cutter) return null;
    try {
      shell = shell.subtract(cutter);
    } catch {
      return null;
    }
    if (!shell) return null;
  }

  shell.__offsetMethod = 'polyhedral_boolean_shell';
  return shell;
}

export class OffsetShellSolid extends Solid {
  constructor(sourceSolid) {
    super();
    if (!sourceSolid || typeof sourceSolid._manifoldize !== 'function') {
      throw new Error('OffsetShellSolid requires a valid Solid instance.');
    }
    this.sourceSolid = sourceSolid;
  }

  run(distance) {
    return OffsetShellSolid.generate(this.sourceSolid, distance);
  }

  static generate(sourceSolid, distance, options = {}) {
    if (!sourceSolid || typeof sourceSolid._manifoldize !== 'function') {
      throw new Error('OffsetShellSolid.generate requires a valid Solid.');
    }

    const dist = Number(distance);
    if (!Number.isFinite(dist) || dist === 0) return sourceSolid.clone();

    const {
      newSolidName = `${sourceSolid.name || 'Solid'}_${Math.abs(dist)}`,
      repairPasses = 4,
      removeFaceNames = [],
    } = options;

    const polyhedral = analyzePolyhedralSolid(sourceSolid);
    const polyhedralResult = buildOffsetPolyhedralSolid(sourceSolid, polyhedral, dist, {
      newSolidName,
      repairPasses,
      removeFaceNames,
    });
    if (polyhedralResult) {
      const triangleEscapeDiagnostics = polyhedralResult?.__offsetDiagnostics?.triangleGenerationEscapeCheck || null;
      const needsBooleanFallback = (
        dist < 0
        && removeFaceNames.length > 0
        && triangleEscapeDiagnostics?.enabled
        && Number(triangleEscapeDiagnostics.escapedTriangleCount || 0) > 0
      );
      if (!needsBooleanFallback) return polyhedralResult;

      const booleanFallback = _attemptNegativeOpenShellBooleanFallback(sourceSolid, polyhedral, dist, {
        newSolidName,
        repairPasses,
        removeFaceNames,
      });
      if (booleanFallback) return booleanFallback;
      return polyhedralResult;
    }

    const booleanFallback = _attemptNegativeOpenShellBooleanFallback(sourceSolid, polyhedral, dist, {
      newSolidName,
      repairPasses,
      removeFaceNames,
    });
    if (booleanFallback) return booleanFallback;

    throw new Error(
      'OffsetShellSolid failed to build a valid non-SDF offset for this geometry. '
      + 'Analysis requires a repairable closed surface with valid face topology.'
    );
  }
}
