import * as THREE from 'three';
import { Cube } from '../BREP/primitives.js';
import { Cone, Cylinder, Sphere, Torus } from '../BREP/primitives.js';
import { OffsetShellSolid } from '../BREP/OffsetShellSolid.js';
import { MeshToBrep } from '../BREP/meshToBrep.js';
import {
  analyzePolyhedralSolid,
  buildOffsetPolyhedralSolid,
} from '../BREP/polyhedralOffset.js';
import { PartHistory } from '../PartHistory.js';

function centroid(tri) {
  return [
    (tri.p1[0] + tri.p2[0] + tri.p3[0]) / 3,
    (tri.p1[1] + tri.p2[1] + tri.p3[1]) / 3,
    (tri.p1[2] + tri.p2[2] + tri.p3[2]) / 3,
  ];
}

function sourceFaceToken(faceName) {
  const raw = String(faceName || '').trim();
  const parts = raw.split(':');
  return (parts[parts.length - 1] || '').trim();
}

function faceSignedMove(sourceFaceCentroid, shellFaceCentroid, outward) {
  const move = [
    shellFaceCentroid[0] - sourceFaceCentroid[0],
    shellFaceCentroid[1] - sourceFaceCentroid[1],
    shellFaceCentroid[2] - sourceFaceCentroid[2],
  ];
  return (
    outward.x * move[0]
    + outward.y * move[1]
    + outward.z * move[2]
  );
}

function getSolidByName(partHistory, name) {
  return (partHistory?.scene?.children || []).find(
    (obj) => obj?.type === 'SOLID' && String(obj?.name || '') === String(name),
  ) || null;
}

function faceCentroid(face) {
  const tris = face?.triangles || [];
  if (!Array.isArray(tris) || tris.length === 0) return [0, 0, 0];

  let totalArea = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const tri of tris) {
    const p1 = tri.p1;
    const p2 = tri.p2;
    const p3 = tri.p3;
    const ux = p2[0] - p1[0];
    const uy = p2[1] - p1[1];
    const uz = p2[2] - p1[2];
    const vx = p3[0] - p1[0];
    const vy = p3[1] - p1[1];
    const vz = p3[2] - p1[2];
    const area = 0.5 * Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    );
    if (area <= 0) continue;
    const cx = (p1[0] + p2[0] + p3[0]) / 3;
    const cy = (p1[1] + p2[1] + p3[1]) / 3;
    const cz = (p1[2] + p2[2] + p3[2]) / 3;
    x += cx * area;
    y += cy * area;
    z += cz * area;
    totalArea += area;
  }
  if (totalArea <= 0) return [0, 0, 0];
  return [x / totalArea, y / totalArea, z / totalArea];
}

function solidCentroid(solid) {
  const verts = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    sx += verts[i];
    sy += verts[i + 1];
    sz += verts[i + 2];
    count += 1;
  }
  const denom = Math.max(1, count);
  return new THREE.Vector3(sx / denom, sy / denom, sz / denom);
}

function buildTriangleRayIntersection(point, dir, tri) {
  const EPS = 1e-12;
  const ax = tri[0][0], ay = tri[0][1], az = tri[0][2];
  const bx = tri[1][0], by = tri[1][1], bz = tri[1][2];
  const cx = tri[2][0], cy = tri[2][1], cz = tri[2][2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dir[1] * e2z - dir[2] * e2y;
  const py = dir[2] * e1x - dir[0] * e2z;
  const pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPS) return null;
  const invDet = 1.0 / det;
  const tvecx = point[0] - ax, tvecy = point[1] - ay, tvecz = point[2] - az;
  const u = (tvecx * px + tvecy * py + tvecz * pz) * invDet;
  if (u < 0 || u > 1) return null;
  const qx = tvecy * e1z - tvecz * e1y;
  const qy = tvecz * e1x - tvecx * e1z;
  const qz = tvecx * e1y - tvecy * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > EPS ? t : null;
}

function buildPointInsideTester(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const vp = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return null;

  const triangles = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i0 = (triVerts[t * 3 + 0] >>> 0) * 3;
    const i1 = (triVerts[t * 3 + 1] >>> 0) * 3;
    const i2 = (triVerts[t * 3 + 2] >>> 0) * 3;
    triangles[t] = [
      [vp[i0] || 0, vp[i0 + 1] || 0, vp[i0 + 2] || 0],
      [vp[i1] || 0, vp[i1 + 1] || 0, vp[i1 + 2] || 0],
      [vp[i2] || 0, vp[i2 + 1] || 0, vp[i2 + 2] || 0],
    ];
  }

  const axes = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  const sampleOffset = 1e-5;
  return function pointInside(point) {
    if (!point) return false;
    let insideVotes = 0;
    let outsideVotes = 0;
    for (const axis of axes) {
      let hits = 0;
      const o = [
        point.x + axis[0] * sampleOffset * 1.17,
        point.y + axis[1] * sampleOffset * 1.33,
        point.z + axis[2] * sampleOffset * 1.41,
      ];
      for (let i = 0; i < triCount; i++) {
        const t = buildTriangleRayIntersection(o, axis, triangles[i]);
        if (t !== null) hits++;
      }
      if ((hits & 1) === 1) insideVotes += 1;
      else outsideVotes += 1;
    }
    return insideVotes >= outsideVotes;
  };
}

function faceOutwardNormal(faceName, solid, pointInside, centroid) {
  const faceInfo = solid.getFaceNormal(faceName);
  if (!faceInfo?.validNormal || !Array.isArray(faceInfo.normal) || faceInfo.normal.length !== 3) {
    return null;
  }
  const baseNormal = new THREE.Vector3(
    Number(faceInfo.normal[0]) || 0,
    Number(faceInfo.normal[1]) || 0,
    Number(faceInfo.normal[2]) || 0,
  );
  if (!baseNormal.lengthSq()) return null;
  baseNormal.normalize();

  const face = (solid.getFaces(false) || []).find((item) => item.faceName === faceName);
  const c = faceCentroid(face);
  const probe = new THREE.Vector3(
    Number(c[0]) || 0,
    Number(c[1]) || 0,
    Number(c[2]) || 0,
  );
  probe.addScaledVector(baseNormal, 1e-3);

  const isInside = typeof pointInside === 'function' ? !!pointInside(probe) : false;
  let normal = isInside ? baseNormal.clone().negate() : baseNormal;

  const toCentroid = new THREE.Vector3(
    (Number(c[0]) || 0) - centroid.x,
    (Number(c[1]) || 0) - centroid.y,
    (Number(c[2]) || 0) - centroid.z,
  );
  if (normal.dot(toCentroid) < 0) {
    normal.multiplyScalar(-1);
  }

  return normal;
}

function analyzeMeshTopology(solid) {
  const triVerts = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const triCount = (triVerts.length / 3) | 0;
  if (!triCount) return { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0 };
  const counts = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let triIndex = 0; triIndex < triCount; triIndex++) {
    const a = triVerts[triIndex * 3] >>> 0;
    const b = triVerts[triIndex * 3 + 1] >>> 0;
    const c = triVerts[triIndex * 3 + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const value of counts.values()) {
    if (value === 1) boundaryEdgeCount += 1;
    else if (value !== 2) nonManifoldEdgeCount += 1;
  }
  return { boundaryEdgeCount, nonManifoldEdgeCount };
}

function getTriangleGenerationEscapeDiagnostics(shell, label) {
  const diagnostics = shell?.__offsetDiagnostics?.triangleGenerationEscapeCheck || null;
  if (!diagnostics?.enabled) {
    throw new Error(`[${label}] Expected triangle-generation escape diagnostics to be recorded on the shell result.`);
  }
  return diagnostics;
}

function diagnosticFaceCounts(diagnostics) {
  return Object.entries(diagnostics?.escapedFaceCounts || {})
    .map(([faceName, count]) => [String(faceName || ''), Number(count) || 0])
    .sort((a, b) => b[1] - a[1]);
}

export async function buildReproHistory_20260422215549(partHistory = new PartHistory(), options = {}) {
  const includeOffsetShell = options.includeOffsetShell !== false;
  const includeRemesh = options.includeRemesh === true;
  const replaceOriginalSolid = options.replaceOriginalSolid !== false;
  const offsetDistance = String(options.offsetDistance ?? '.25');
  const offsetFaces = Array.isArray(options.offsetFaces) && options.offsetFaces.length
    ? [...options.offsetFaces]
    : ['E3:S2:PROFILE_START'];
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = {
    fields: [],
    values: {},
  };

  const feature1 = await partHistory.newFeature('D');
  Object.assign(feature1.inputParams, {
    id: 'D1',
    transform: {
      position: [0.2565036028836988, 5.286649371275551, -3.590228990331272],
      rotationEuler: [-32.818971321018715, 30.63210260878807, -2.671532847188412],
      scale: [1, 1, 1],
    },
  });

  const feature2 = await partHistory.newFeature('S');
  Object.assign(feature2.inputParams, {
    id: 'S2',
    sketchPlane: 'D1:XY',
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 'resolution',
  });
  feature2.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 3, x: -2.504334, y: -3.287135, fixed: false, construction: false, externalReference: false },
        { id: 6, x: 6.391665, y: 6.452413, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 8, x: -2.504333, y: 6.452412, fixed: false, construction: false, externalReference: false },
        { id: 15, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 16, x: 1.803917, y: 3.614373, fixed: false, construction: false, externalReference: false },
        { id: 17, x: 1.764345, y: -4.025491, fixed: false, construction: false, externalReference: false },
        { id: 18, x: 6.391665, y: 4.346518, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 3, type: 'line', points: [6, 7], construction: false },
        { id: 4, type: 'line', points: [8, 3], construction: false },
        { id: 9, type: 'line', points: [1, 17], construction: false },
        { id: 10, type: 'line', points: [16, 17], construction: false },
        { id: 11, type: 'line', points: [18, 15], construction: false },
        { id: 12, type: 'line', points: [18, 2], construction: false },
      ],
      constraints: [
        {
          id: 0,
          type: '⏚',
          points: [0],
          status: 'solved',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '0:0,0,1;',
        },
        {
          id: 1,
          type: '≡',
          points: [1, 3],
          status: '',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '1:-2.504334,-3.287135,0;3:-2.504334,-3.287135,0;',
        },
        {
          id: 3,
          type: '≡',
          points: [2, 6],
          status: 'solved',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '2:6.391665,6.452413,0;6:6.391665,6.452413,0;',
        },
        {
          id: 4,
          type: '≡',
          points: [7, 8],
          status: '',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '7:-2.504333,6.452412,0;8:-2.504333,6.452412,0;',
        },
        {
          id: 7,
          type: '⟂',
          points: [6, 7, 8, 3],
          status: '',
          error: null,
          value: 270,
          _previousSolveValue: 270,
          previousPointValues: '6:5.357399948061701,6.756693642653996,0;7:-2.8534559480617006,6.093104357346005,0;8:-2.853456,6.093105,0;3:-2.150647,-2.603049,0;',
        },
        {
          id: 8,
          type: '│',
          points: [8, 3],
          labelX: 0,
          labelY: 0,
          displayStyle: '',
          value: null,
          valueNeedsSetup: true,
          status: '',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '8:-2.504327,6.4524,0;3:-2.504327,-3.27361,0;',
        },
        {
          id: 12,
          type: '≡',
          points: [15, 16],
          status: 'solved',
          error: null,
          _previousSolveValue: null,
          previousPointValues: '15:1.803917,3.614373,0;16:1.803917,3.614373,0;',
        },
      ],
    },
  };

  const feature3 = await partHistory.newFeature('E');
  Object.assign(feature3.inputParams, {
    id: 'E3',
    profile: 'S2:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: {
      targets: [],
      operation: 'NONE',
      overlapConditioningEnabled: true,
    },
  });

  const feature4 = await partHistory.newFeature('F');
  Object.assign(feature4.inputParams, {
    id: 'F4',
    edges: [
      'E3:S2:G10_SW|E3:S2:G9_SW[0]',
      'E3:S2:G12_SW|E3:S2:G3_SW[0]',
      'E3:S2:G3_SW|E3:S2:G4_SW[0]',
      'E3:S2:G10_SW|E3:S2:G11_SW[0]',
      'E3:S2:G4_SW|E3:S2:G9_SW[0]',
      'E3:S2:G11_SW|E3:S2:G12_SW[0]',
    ],
    radius: 1,
    resolution: 'resolution',
    inflate: '0.2',
    nudgeFaceDistance: '.0001',
    direction: 'AUTO',
    debug: 'NONE',
    simplifyResult: true,
    cleanupNativeTinyFaceIslands: true,
    reverseEndCapNudge: false,
    mergeCoplanarEndCaps: true,
    reassignSliverTriangles: true,
    collapseTinyTriangles: true,
    cleanupPostCollapseTinyFaceIslands: true,
  });

  if (includeRemesh) {
    const feature5 = await partHistory.newFeature('RM');
    Object.assign(feature5.inputParams, {
      id: 'RM11',
      targetSolid: 'E3',
      mode: 'Simplify',
      maxEdgeLength: 1,
      maxIterations: 10,
      tolerance: '0.001',
    });
  }

  if (includeOffsetShell) {
    const offsetShellFeature = await partHistory.newFeature('O.S');
    Object.assign(offsetShellFeature.inputParams, {
      id: 'O.S10',
      distance: offsetDistance,
      faces: offsetFaces,
      replaceOriginalSolid,
    });
  }

  return partHistory;
}

export async function test_offsetShell_polyhedral_exact_preserves_sharp_cube_faces() {
  const source = new Cube({ x: 10, y: 8, z: 6, name: 'BOX' });
  const shell = OffsetShellSolid.generate(source, -1, {
    newSolidName: 'BOX_shell',
    featureId: 'TEST',
  });

  if (shell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected convex cube offset to use polyhedral_topology path, received ${shell.__offsetMethod || 'fallback'}.`);
  }

  const faceNames = new Set(shell.getFaceNames());
  const expected = [
    'BOX_shell_BOX_NX',
    'BOX_shell_BOX_PX',
    'BOX_shell_BOX_NY',
    'BOX_shell_BOX_PY',
    'BOX_shell_BOX_NZ',
    'BOX_shell_BOX_PZ',
  ];
  for (const name of expected) {
    if (!faceNames.has(name)) {
      throw new Error(`Expected exact polyhedral offset to keep face "${name}".`);
    }
  }

  const checks = [
    { name: 'BOX_shell_BOX_NX', axis: 0, expected: 1 },
    { name: 'BOX_shell_BOX_PX', axis: 0, expected: 9 },
    { name: 'BOX_shell_BOX_NY', axis: 1, expected: 1 },
    { name: 'BOX_shell_BOX_PY', axis: 1, expected: 7 },
    { name: 'BOX_shell_BOX_NZ', axis: 2, expected: 1 },
    { name: 'BOX_shell_BOX_PZ', axis: 2, expected: 5 },
  ];
  const tolerance = 1e-5;
  const faces = shell.getFaces(false);

  for (const check of checks) {
    const face = faces.find((entry) => entry.faceName === check.name);
    if (!face || !Array.isArray(face.triangles) || face.triangles.length !== 2) {
      throw new Error(`Expected exact offset face "${check.name}" to contain exactly 2 triangles.`);
    }
    for (const tri of face.triangles) {
      const c = centroid(tri);
      const deviation = Math.abs(c[check.axis] - check.expected);
      if (deviation > tolerance) {
        throw new Error(
          `Expected face "${check.name}" to lie on ${check.expected} along axis ${check.axis}, deviation ${deviation}.`
        );
      }
    }
  }
}

function averageRadiusFromCenter(solid, center = new THREE.Vector3()) {
  const verts = Array.isArray(solid?._vertProperties) ? solid._vertProperties : [];
  let total = 0;
  let count = 0;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const dx = verts[i] - center.x;
    const dy = verts[i + 1] - center.y;
    const dz = verts[i + 2] - center.z;
    total += Math.hypot(dx, dy, dz);
    count += 1;
  }
  return count ? total / count : 0;
}

export async function test_offsetShell_vertex_tangent_normals_preserve_generic_sphere_inset_direction() {
  const geometry = new THREE.SphereGeometry(5, 16, 12);
  const source = new MeshToBrep(geometry, 180, 1e-5);
  source.name = 'GENERIC_SPHERE_FALLBACK';

  const analysis = analyzePolyhedralSolid(source);
  if (!analysis?.faceMap) {
    throw new Error('Expected generic sphere analysis to produce a valid face map.');
  }

  for (const face of analysis.faceMap.values()) {
    face.support = { kind: 'vertex_tangent', faceName: face.name };
  }

  const shell = buildOffsetPolyhedralSolid(source, analysis, -0.5, {
    newSolidName: 'GENERIC_SPHERE_tangent_shell',
  });
  if (!shell) {
    throw new Error('Expected tangent-supported generic sphere offset to build successfully.');
  }

  const center = solidCentroid(source);
  const sourceRadius = averageRadiusFromCenter(source, center);
  const shellRadius = averageRadiusFromCenter(shell, center);
  if (!(shellRadius < sourceRadius - 0.1)) {
    throw new Error(
      `Expected tangent-supported generic sphere offset to move inward. `
      + `Source radius=${sourceRadius}, shell radius=${shellRadius}.`,
    );
  }
}

export async function test_offsetShell_polyhedral_exact_supports_non_convex_planar_solids() {
  const a = new Cube({ x: 4, y: 2, z: 2, name: 'L_A' });
  const b = new Cube({ x: 2, y: 4, z: 2, name: 'L_B' });
  const source = a.union(b);
  source.name = 'L';

  const shell = OffsetShellSolid.generate(source, -0.25, {
    newSolidName: 'L_shell',
    featureId: 'TEST',
  });

  if (shell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected non-convex planar solid offset to use polyhedral_topology path, received ${shell.__offsetMethod || 'fallback'}.`);
  }

  const faces = shell.getFaces(false);
  if (!Array.isArray(faces) || faces.length < 6) {
    throw new Error('Expected non-convex exact offset to expose multiple planar faces.');
  }

  for (const face of faces) {
    const faceNormal = shell.getFaceNormal(face.faceName);
    if (!faceNormal?.validNormal || !Array.isArray(faceNormal.normal) || faceNormal.normal.length !== 3) {
      throw new Error(`Expected face "${face.faceName}" to report a valid normal.`);
    }
    const [nx, ny, nz] = faceNormal.normal;
    const tri0 = face.triangles?.[0];
    if (!tri0) {
      throw new Error(`Expected face "${face.faceName}" to contain triangles.`);
    }
    const ref = tri0.p1;
    const planeOffset = nx * ref[0] + ny * ref[1] + nz * ref[2];
    for (const tri of face.triangles) {
      for (const point of [tri.p1, tri.p2, tri.p3]) {
        const dist = Math.abs((nx * point[0]) + (ny * point[1]) + (nz * point[2]) - planeOffset);
        if (dist > 1e-5) {
          throw new Error(`Expected non-convex face "${face.faceName}" to remain planar after exact offset; deviation ${dist}.`);
        }
      }
    }
  }
}

export async function test_offsetShell_support_surfaces_handle_cylinder_and_cone() {
  const cylinder = new Cylinder({ radius: 2, height: 5, resolution: 24, name: 'CYL' });
  const cylinderShell = OffsetShellSolid.generate(cylinder, -0.25, {
    newSolidName: 'CYL_shell',
  });
  if (cylinderShell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected cylinder offset to use support-surface path, received ${cylinderShell.__offsetMethod || 'fallback'}.`);
  }
  const cylinderFaces = new Set(cylinderShell.getFaceNames());
  for (const name of ['CYL_shell_CYL_S', 'CYL_shell_CYL_B', 'CYL_shell_CYL_T']) {
    if (!cylinderFaces.has(name)) throw new Error(`Missing cylinder offset face "${name}".`);
  }

  const cone = new Cone({ r1: 1, r2: 3, h: 5, resolution: 24, name: 'CONE' });
  const coneShell = OffsetShellSolid.generate(cone, -0.25, {
    newSolidName: 'CONE_shell',
  });
  if (coneShell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected cone offset to use support-surface path, received ${coneShell.__offsetMethod || 'fallback'}.`);
  }
  const coneFaces = new Set(coneShell.getFaceNames());
  for (const name of ['CONE_shell_CONE_S', 'CONE_shell_CONE_B', 'CONE_shell_CONE_T']) {
    if (!coneFaces.has(name)) throw new Error(`Missing cone offset face "${name}".`);
  }
}

export async function test_offsetShell_support_surfaces_handle_sphere_and_torus() {
  const sphere = new Sphere({ r: 5, resolution: 16, name: 'SP' });
  sphere.setFaceMetadata('SP', { type: 'spherical', radius: 5, center: [0, 0, 0] });
  const sphereShell = OffsetShellSolid.generate(sphere, -0.5, {
    newSolidName: 'SP_shell',
  });
  if (sphereShell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected sphere offset to use support-surface path, received ${sphereShell.__offsetMethod || 'fallback'}.`);
  }
  const sphereFaces = sphereShell.getFaceNames();
  if (!(Array.isArray(sphereFaces) && sphereFaces.includes('SP_shell_SP'))) {
    throw new Error('Expected sphere offset to preserve the single sphere face.');
  }

  const torus = new Torus({ mR: 10, tR: 2, resolution: 24, arcDegrees: 360, name: 'TOR' });
  torus.setFaceMetadata('TOR_Side', {
    type: 'toroidal',
    majorRadius: 10,
    tubeRadius: 2,
    axis: [0, 1, 0],
    center: [0, 0, 0],
  });
  const torusShell = OffsetShellSolid.generate(torus, -0.25, {
    newSolidName: 'TOR_shell',
  });
  if (torusShell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected torus offset to use support-surface path, received ${torusShell.__offsetMethod || 'fallback'}.`);
  }
  const torusFaces = torusShell.getFaceNames();
  if (!(Array.isArray(torusFaces) && torusFaces.includes('TOR_shell_TOR_Side'))) {
    throw new Error('Expected torus offset to preserve the torus side face.');
  }
}

export async function test_offsetShell_generic_mesh_face_uses_tangent_supports() {
  const geometry = new THREE.SphereGeometry(5, 16, 12);
  const source = new MeshToBrep(geometry, 180, 1e-5);
  source.name = 'GENERIC_SPHERE';

  const shell = OffsetShellSolid.generate(source, -0.5, {
    newSolidName: 'GENERIC_SPHERE_shell',
  });

  if (shell.__offsetMethod !== 'polyhedral_topology') {
    throw new Error(`Expected generic mesh offset to use tangent-support path, received ${shell.__offsetMethod || 'fallback'}.`);
  }
  if (!(shell.getTriangleCount() > 0)) {
    throw new Error('Expected generic mesh offset to produce triangles.');
  }
  const faceNames = shell.getFaceNames();
  if (!Array.isArray(faceNames) || faceNames.length < 1) {
    throw new Error('Expected generic mesh offset to preserve at least one face label.');
  }
}

export async function test_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face(partHistory) {
  await buildReproHistory_20260422215549(partHistory);
}

export async function test_offsetShell_repro_20260422215549_can_keep_original_solid(partHistory) {
  await buildReproHistory_20260422215549(partHistory, {
    replaceOriginalSolid: false,
  });
}

export async function test_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward(partHistory) {
  await buildReproHistory_20260422215549(partHistory, {
    includeRemesh: true,
    offsetDistance: '-0.25',
    offsetFaces: ['E3:S2:PROFILE_START', 'E3:S2:PROFILE_END'],
    replaceOriginalSolid: false,
  });
}

export async function test_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source(partHistory) {
  await buildReproHistory_20260422215549(partHistory, {
    offsetDistance: '-0.25',
    offsetFaces: ['E3:S2:PROFILE_START'],
    replaceOriginalSolid: false,
  });
}

export async function afterRun_offsetShell_repro_20260422215549_keeps_outward_direction_on_tube_face(partHistory) {
  const shell = getSolidByName(partHistory, 'E3_O.S10');
  if (!shell) {
    throw new Error('[offsetShell_repro_20260422215549] Failed to locate shell solid E3_O.S10 after history run.');
  }
  if (getSolidByName(partHistory, 'E3')) {
    throw new Error('[offsetShell_repro_20260422215549] Expected offset shell feature to replace source solid E3.');
  }

  if (shell.__offsetMethod !== 'polyhedral_topology_shell') {
    throw new Error(`[offsetShell_repro_20260422215549] Expected offset shell to use polyhedral_topology_shell, received ${shell.__offsetMethod || 'fallback'}.`);
  }

  const referenceHistory = new PartHistory();
  await buildReproHistory_20260422215549(referenceHistory, { includeOffsetShell: false });
  await referenceHistory.runHistory();
  const source = getSolidByName(referenceHistory, 'E3');
  if (!source) {
    throw new Error('[offsetShell_repro_20260422215549] Failed to locate reference source solid E3.');
  }

  const sourceFaces = source.getFaces(false) || [];
  const shellFaces = shell.getFaces(false) || [];
  if (shellFaces.some((face) => String(face?.faceName || '') === 'E3_O.S10_E3:S2:PROFILE_START')) {
    throw new Error('[offsetShell_repro_20260422215549] Expected selected PROFILE_START face to be removed from the shell result.');
  }
  const sourceCentroid = solidCentroid(source);
  const pointInside = buildPointInsideTester(source);
  if (!pointInside) {
    throw new Error('[offsetShell_repro_20260422215549] Could not build source point-inside tester.');
  }

  const candidateTubeShell = shellFaces.filter((face) => String(face?.faceName || '').includes('TUBE_Outer'));
  if (!candidateTubeShell.length) {
    throw new Error('[offsetShell_repro_20260422215549] Failed to locate any TUBE_Outer faces on the shell.');
  }

  const sourceFaceMap = new Map(sourceFaces.map((face) => [face?.faceName, face]));
  const dist2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  };

  const tubeSourceFaces = [
    'E3:S2:G10_SW',
    'E3:S2:G11_SW',
  ];
  const sourceToShellCandidates = new Map();
  for (const sourceFaceName of tubeSourceFaces) {
    const sourceFace = sourceFaceMap.get(sourceFaceName);
    if (!sourceFace) {
      throw new Error(`[offsetShell_repro_20260422215549] Missing source face "${sourceFaceName}".`);
    }
    const sourceFaceCentroid = faceCentroid(sourceFace);
    const token = sourceFaceToken(sourceFaceName);
    if (!token) {
      throw new Error(`[offsetShell_repro_20260422215549] Invalid source face token for "${sourceFaceName}".`);
    }
    const candidates = candidateTubeShell
      .map((shellFace) => {
        if (!String(shellFace.faceName || '').includes(token)) return null;
        const shellFaceCentroid = faceCentroid(shellFace);
        const d2 = dist2(sourceFaceCentroid, shellFaceCentroid);
        return { shellFace, shellFaceCentroid, candidateDist2: d2 };
      })
      .filter(Boolean)
      .map((entry) => ({
        shellFace: entry.shellFace,
        shellFaceCentroid: entry.shellFaceCentroid,
        candidateDist2: entry.candidateDist2,
      }));

    if (!candidates.length) {
      throw new Error(`[offsetShell_repro_20260422215549] Could not map source face "${sourceFaceName}" to any token-matched TUBE_Outer face.`);
    }
    sourceToShellCandidates.set(sourceFaceName, candidates);
  }

  const checks = [
    { sourceFace: 'E3:S2:G10_SW', minDot: 1e-5 },
    { sourceFace: 'E3:S2:G11_SW', minDot: 1e-5 },
  ];

  for (const check of checks) {
    const sourceFace = sourceFaceMap.get(check.sourceFace);
    if (!sourceFace) {
      throw new Error(`[offsetShell_repro_20260422215549] Missing mapping for source face "${check.sourceFace}".`);
    }
    const sourceCandidates = sourceToShellCandidates.get(check.sourceFace);
    if (!sourceCandidates || !sourceCandidates.length) {
      throw new Error(`[offsetShell_repro_20260422215549] Missing mapping for source face "${check.sourceFace}".`);
    }
    const outward = faceOutwardNormal(check.sourceFace, source, pointInside, sourceCentroid);
    if (!outward) {
      throw new Error(`[offsetShell_repro_20260422215549] Failed to orient source face normal for "${check.sourceFace}".`);
    }

    const sourceFaceCentroid = faceCentroid(sourceFace);
    const scored = sourceCandidates
      .map((candidate) => {
        const move = faceSignedMove(
          sourceFaceCentroid,
          candidate.shellFaceCentroid,
          outward,
        );
        return {
          shellFaceName: candidate.shellFace.faceName,
          signedMove: move,
          candidateDist2: candidate.candidateDist2,
        };
      })
      .sort((a, b) => {
        if (Math.abs(a.signedMove - b.signedMove) > 1e-9) {
          return b.signedMove - a.signedMove;
        }
        return a.candidateDist2 - b.candidateDist2;
      });

    const best = scored[0];
    const report = scored
      .slice(0, 3)
      .map((item) => `${item.shellFaceName}: ${item.signedMove.toFixed(6)}`)
      .join(', ');
    if (!(best.signedMove > check.minDot)) {
      throw new Error(`[offsetShell_repro_20260422215549] Expected source face "${check.sourceFace}" to move outward (best=${best.signedMove.toFixed(6)}; candidates=[${report}]).`);
    }
  }

  const topology = analyzeMeshTopology(shell);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[offsetShell_repro_20260422215549] Shell mesh must be closed and manifold. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
  }
  if (typeof shell._isCoherentlyOrientedManifold === 'function' && shell._isCoherentlyOrientedManifold() !== true) {
    throw new Error('[offsetShell_repro_20260422215549] Shell mesh failed coherent manifold orientation check.');
  }
}

export async function afterRun_offsetShell_repro_20260422215549_can_keep_original_solid(partHistory) {
  const source = getSolidByName(partHistory, 'E3');
  const shell = getSolidByName(partHistory, 'E3_O.S10');
  if (!source) {
    throw new Error('[offsetShell_repro_20260422215549_keep_original] Expected original solid E3 to remain in the scene.');
  }
  if (!shell) {
    throw new Error('[offsetShell_repro_20260422215549_keep_original] Expected shell solid E3_O.S10 to be added to the scene.');
  }
  if (shell.__offsetMethod !== 'polyhedral_topology_shell') {
    throw new Error(`[offsetShell_repro_20260422215549_keep_original] Expected shell result to use polyhedral_topology_shell, received ${shell.__offsetMethod || 'fallback'}.`);
  }
}

export async function afterRun_offsetShell_repro_20260423005441_keeps_negative_two_open_face_shell_inward(partHistory) {
  const solids = (partHistory?.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  const shell = solids.find((solid) => String(solid?.name || '').endsWith('_O.S10')) || null;
  const source = solids.find((solid) => solid !== shell) || null;
  if (!source) {
    throw new Error('[offsetShell_repro_20260423005441] Expected original remeshed source solid to remain in the scene.');
  }
  if (!shell) {
    throw new Error('[offsetShell_repro_20260423005441] Failed to locate shell solid after history run.');
  }
  if (shell.__offsetMethod !== 'polyhedral_topology_shell') {
    throw new Error(`[offsetShell_repro_20260423005441] Expected shell result to use polyhedral_topology_shell, received ${shell.__offsetMethod || 'fallback'}.`);
  }

  const diagnostics = getTriangleGenerationEscapeDiagnostics(shell, 'offsetShell_repro_20260423005441');
  const escapedTriangles = Number(diagnostics.escapedTriangleCount || 0);
  if (escapedTriangles !== 0) {
    throw new Error(
      `[offsetShell_repro_20260423005441] Expected the negative two-open-face repro to build with no escaping emitted triangles, `
      + `received ${escapedTriangles}.`,
    );
  }
  const escapedVertices = Number(diagnostics.escapedVertexCount || 0);
  if (escapedVertices !== 0) {
    throw new Error(
      `[offsetShell_repro_20260423005441] Expected the negative two-open-face repro to keep emitted triangle vertices inside the source solid, `
      + `received escapedVertexCount=${escapedVertices}.`,
    );
  }

  const shellFaceNames = new Set((shell.getFaces(false) || []).map((face) => String(face?.faceName || '')));
  for (const removedFaceName of ['E3:S2:PROFILE_START', 'E3:S2:PROFILE_END']) {
    if (shellFaceNames.has(`${shell.name}_${removedFaceName}`)) {
      throw new Error(`[offsetShell_repro_20260423005441] Expected removed face "${removedFaceName}" to be absent from shell outer faces.`);
    }
    if (shellFaceNames.has(`${shell.name}_INNER_${removedFaceName}`)) {
      throw new Error(`[offsetShell_repro_20260423005441] Expected removed face "${removedFaceName}" to be absent from shell inner faces.`);
    }
  }

  const sourceFaces = source.getFaces(false) || [];
  const shellFaces = shell.getFaces(false) || [];
  const sourceCentroid = solidCentroid(source);
  const pointInside = buildPointInsideTester(source);
  if (!pointInside) {
    throw new Error('[offsetShell_repro_20260423005441] Could not build source point-inside tester.');
  }

  const dist2 = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  };

  const tubeSourceFaces = sourceFaces
    .map((face) => String(face?.faceName || ''))
    .filter((faceName) => faceName.includes('TUBE_Outer'));
  if (!tubeSourceFaces.length) {
    throw new Error('[offsetShell_repro_20260423005441] Expected remeshed source solid to preserve tube outer faces.');
  }

  const sourceFaceMap = new Map(sourceFaces.map((face) => [face?.faceName, face]));
  for (const sourceFaceName of tubeSourceFaces) {
    const sourceFace = sourceFaceMap.get(sourceFaceName);
    if (!sourceFace) {
      throw new Error(`[offsetShell_repro_20260423005441] Missing source face "${sourceFaceName}".`);
    }
    const sourceFaceCentroid = faceCentroid(sourceFace);
    const token = sourceFaceToken(sourceFaceName);
    if (!token) {
      throw new Error(`[offsetShell_repro_20260423005441] Invalid source face token for "${sourceFaceName}".`);
    }
    const outward = faceOutwardNormal(sourceFaceName, source, pointInside, sourceCentroid);
    if (!outward) {
      throw new Error(`[offsetShell_repro_20260423005441] Failed to orient source face normal for "${sourceFaceName}".`);
    }

    const scored = shellFaces
      .map((shellFace) => {
        if (!String(shellFace?.faceName || '').includes(token)) return null;
        const shellFaceCentroid = faceCentroid(shellFace);
        return {
          shellFaceName: shellFace.faceName,
          signedMove: faceSignedMove(sourceFaceCentroid, shellFaceCentroid, outward),
          candidateDist2: dist2(sourceFaceCentroid, shellFaceCentroid),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (Math.abs(a.signedMove - b.signedMove) > 1e-9) {
          return a.signedMove - b.signedMove;
        }
        return a.candidateDist2 - b.candidateDist2;
      });

    if (!scored.length) {
      throw new Error(`[offsetShell_repro_20260423005441] Could not map source face "${sourceFaceName}" to any shell faces.`);
    }

    const best = scored[0];
    if (!(best.signedMove < -1e-5)) {
      const report = scored
        .slice(0, 3)
        .map((item) => `${item.shellFaceName}: ${item.signedMove.toFixed(6)}`)
        .join(', ');
      throw new Error(
        `[offsetShell_repro_20260423005441] Expected source face "${sourceFaceName}" to move inward `
        + `(best=${best.signedMove.toFixed(6)}; candidates=[${report}]).`,
      );
    }
  }

  const topology = analyzeMeshTopology(shell);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[offsetShell_repro_20260423005441] Shell mesh must be closed and manifold. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
  }
  if (typeof shell._isCoherentlyOrientedManifold === 'function' && shell._isCoherentlyOrientedManifold() !== true) {
    throw new Error('[offsetShell_repro_20260423005441] Shell mesh failed coherent manifold orientation check.');
  }
}

export async function afterRun_offsetShell_repro_20260423012942_keeps_negative_single_open_face_shell_inside_source(partHistory) {
  const source = getSolidByName(partHistory, 'E3');
  const shell = getSolidByName(partHistory, 'E3_O.S10');
  if (!source) {
    throw new Error('[offsetShell_repro_20260423012942] Expected original solid E3 to remain in the scene.');
  }
  if (!shell) {
    throw new Error('[offsetShell_repro_20260423012942] Expected shell solid E3_O.S10 to be added to the scene.');
  }
  if (shell.__offsetMethod !== 'polyhedral_topology_shell') {
    throw new Error(`[offsetShell_repro_20260423012942] Expected shell result to use polyhedral_topology_shell, received ${shell.__offsetMethod || 'fallback'}.`);
  }

  const diagnostics = getTriangleGenerationEscapeDiagnostics(shell, 'offsetShell_repro_20260423012942');
  const escapedTriangles = Number(diagnostics.escapedTriangleCount || 0);
  if (escapedTriangles !== 0) {
    throw new Error(
      `[offsetShell_repro_20260423012942] Expected the negative single-open-face repro to build with no escaping emitted triangles, `
      + `received ${escapedTriangles}.`,
    );
  }
  const escapedVertices = Number(diagnostics.escapedVertexCount || 0);
  if (escapedVertices !== 0) {
    throw new Error(
      `[offsetShell_repro_20260423012942] Expected the negative single-open-face repro to keep emitted triangle vertices inside the source solid, `
      + `received escapedVertexCount=${escapedVertices}.`,
    );
  }

  const topology = analyzeMeshTopology(shell);
  if (topology.boundaryEdgeCount || topology.nonManifoldEdgeCount) {
    throw new Error(
      `[offsetShell_repro_20260423012942] Shell mesh must be closed and manifold. `
      + `Boundaries=${topology.boundaryEdgeCount}, nonManifold=${topology.nonManifoldEdgeCount}.`,
    );
  }
}
