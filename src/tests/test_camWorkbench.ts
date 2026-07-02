import * as THREE from 'three';
import { PartHistory } from '../PartHistory.js';
import { AccordionWidget } from '../UI/AccordionWidget.js';
import { SelectionFilter } from '../UI/SelectionFilter.js';
import { CamHistoryWidget, gcodeDownloadFileName } from '../UI/cam/CamHistoryWidget.js';
import { workbenchMethods } from '../UI/viewer/workbenchMethods.js';
import { createCamCutterProfile, validateCamCutterProfile } from '../cam/CamCutterProfile.js';
import { CamOperationEntity } from '../cam/CamOperationEntity.js';
import { CAM_GENERATED_DATA_VERSION, CamPlanManager } from '../cam/CamPlanManager.js';
import { CamWorkbenchManager } from '../cam/CamWorkbenchManager.js';
import { filterCamPathPoints, filterCamToolpathPaths } from '../cam/camPathFiltering.js';
import { dropCutterAtPoint, dropCutterBatch } from '../cam/camDropCutter.js';
import { adaptivePathDropCutter, uniformPathDropCutter } from '../cam/camPathDropCutter.js';
import { createCamArcSpan, createCamLineSpan, createCamPathSpan, sampleCamPathSpans } from '../cam/camPathSpans.js';
import { orderCamToolpathPaths } from '../cam/camPathOrdering.js';
import { pushCutterBatch, pushCutterFiber } from '../cam/camPushCutter.js';
import { buildCamTriangleSpatialIndex, buildCamTriangleSpatialIndexWithFallback, queryCamTriangleAabbBruteForce } from '../cam/camTriangleSpatialIndex.js';
import { reconstructWeaveLoops, reconstructWeaveLoopsAsync } from '../cam/camWeaveLoops.js';
import { collectCamTargetMeshPayloads, extractTrianglesFromSolid, generateThreeAxisToolpath, generateThreeAxisToolpathAsync } from '../cam/camToolpath.js';
import { runCamToolpathWorker } from '../cam/camToolpathWorkerClient.js';
import { getWorkbenchDefinition, isSidePanelAllowed, listWorkbenchDefinitions } from '../workbenches/index.js';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

function makeBoxMeshSolid(sizeX = 10, sizeY = 10, sizeZ = 10) {
  const sx = sizeX;
  const sy = sizeY;
  const sz = sizeZ;
  const vertProperties = Float32Array.from([
    0, 0, 0,
    sx, 0, 0,
    sx, sy, 0,
    0, sy, 0,
    0, 0, sz,
    sx, 0, sz,
    sx, sy, sz,
    0, sy, sz,
  ]);
  const triVerts = Uint32Array.from([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return {
    name: 'cam-test-cube',
    type: 'SOLID',
    visible: true,
    userData: {},
    matrixWorld: new THREE.Matrix4(),
    updateMatrixWorld() {},
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeCubeMeshSolid(size = 10) {
  return makeBoxMeshSolid(size, size, size);
}

function makeCamCubeTriangles(size = 10) {
  const p = [
    [0, 0, 0],
    [size, 0, 0],
    [size, size, 0],
    [0, size, 0],
    [0, 0, size],
    [size, 0, size],
    [size, size, size],
    [0, size, size],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  return faces.map((face, id) => ({
    id,
    a: p[face[0]],
    b: p[face[1]],
    c: p[face[2]],
  }));
}

function makeSerializedCamBoxTriangles(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  const p = [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [maxX, maxY, minZ],
    [minX, maxY, minZ],
    [minX, minY, maxZ],
    [maxX, minY, maxZ],
    [maxX, maxY, maxZ],
    [minX, maxY, maxZ],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  return faces.flatMap((face) => face.flatMap((vertex) => p[vertex]));
}

function makeSerializedCamPlateWithCircularHoleTriangles(segmentCount = 64) {
  const out: number[] = [];
  const min = 0;
  const max = 20;
  const bottom = 0;
  const top = 5;
  const centerX = 10;
  const centerY = 10;
  const radius = 4;
  const addTriangle = (a: number[], b: number[], c: number[]) => {
    out.push(...a, ...b, ...c);
  };
  const corners = [
    [min, min],
    [max, min],
    [max, max],
    [min, max],
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const [x0, y0] = corners[index];
    const [x1, y1] = corners[(index + 1) % corners.length];
    addTriangle([x0, y0, bottom], [x1, y1, bottom], [x1, y1, top]);
    addTriangle([x0, y0, bottom], [x1, y1, top], [x0, y0, top]);
  }
  for (let index = 0; index < segmentCount; index += 1) {
    const a = (Math.PI * 2 * index) / segmentCount;
    const b = (Math.PI * 2 * (index + 1)) / segmentCount;
    const p0 = [centerX + radius * Math.cos(a), centerY + radius * Math.sin(a), bottom];
    const p1 = [centerX + radius * Math.cos(b), centerY + radius * Math.sin(b), bottom];
    const p2 = [centerX + radius * Math.cos(b), centerY + radius * Math.sin(b), top];
    const p3 = [centerX + radius * Math.cos(a), centerY + radius * Math.sin(a), top];
    addTriangle(p0, p2, p1);
    addTriangle(p0, p3, p2);
  }
  return out;
}

function makeSlopedTopMeshSolid(sizeX = 10, sizeY = 10, lowTopY = 2, highTopY = 8) {
  const sx = sizeX;
  const sy = sizeY;
  const vertProperties = Float32Array.from([
    0, 0, 0,
    sx, 0, 0,
    sx, 0, sy,
    0, 0, sy,
    0, lowTopY, 0,
    sx, highTopY, 0,
    sx, highTopY, sy,
    0, lowTopY, sy,
  ]);
  const triVerts = Uint32Array.from([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return {
    name: 'cam-test-sloped-top',
    type: 'SOLID',
    visible: true,
    userData: {},
    matrixWorld: new THREE.Matrix4(),
    updateMatrixWorld() {},
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeFaceTaggedSplitTopSurfaceSolid() {
  const vertProperties = Float32Array.from([
    0, 6, 0,
    5, 6, 0,
    5, 6, 10,
    0, 6, 10,
    5, 2, 0,
    10, 2, 0,
    10, 2, 10,
    5, 2, 10,
  ]);
  const triVerts = Uint32Array.from([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  const faceID = Uint32Array.from([101, 101, 102, 102]);
  return {
    name: 'cam-face-target-surface',
    type: 'SOLID',
    visible: true,
    userData: {},
    matrixWorld: new THREE.Matrix4(),
    _faceNameToID: new Map([
      ['LEFT_TOP', 101],
      ['RIGHT_TOP', 102],
    ]),
    updateMatrixWorld() {},
    getMesh() {
      return {
        vertProperties,
        triVerts,
        faceID,
        delete() {},
      };
    },
  };
}

function makeFaceTaggedTriangularTopSurfaceSolid() {
  const vertProperties = Float32Array.from([
    0, 6, 0,
    10, 6, 0,
    0, 6, 10,
    10, 6, 10,
  ]);
  const triVerts = Uint32Array.from([
    0, 1, 2,
    1, 3, 2,
  ]);
  const faceID = Uint32Array.from([101, 102]);
  return {
    name: 'cam-face-target-triangle',
    type: 'SOLID',
    visible: true,
    userData: {},
    matrixWorld: new THREE.Matrix4(),
    _faceNameToID: new Map([
      ['TRIANGLE_TOP', 101],
      ['ADJACENT_TOP', 102],
    ]),
    updateMatrixWorld() {},
    getMesh() {
      return {
        vertProperties,
        triVerts,
        faceID,
        delete() {},
      };
    },
  };
}

function makeOutwardSlopedTopMeshSolid(size = 10, height = 8, bottomInset = 3) {
  const min = 0;
  const max = size;
  const bottomMin = bottomInset;
  const bottomMax = size - bottomInset;
  const vertProperties = Float32Array.from([
    bottomMin, 0, bottomMin,
    bottomMax, 0, bottomMin,
    bottomMax, 0, bottomMax,
    bottomMin, 0, bottomMax,
    min, height, min,
    max, height, min,
    max, height, max,
    min, height, max,
  ]);
  const triVerts = Uint32Array.from([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return {
    name: 'cam-test-outward-sloped-top',
    type: 'SOLID',
    visible: true,
    userData: {},
    matrixWorld: new THREE.Matrix4(),
    updateMatrixWorld() {},
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeViewerWithSolid(solid: any) {
  const scene = {
    traverse(callback: (object: any) => void) {
      callback(solid);
    },
    getObjectByName(name: string) {
      return name === solid.name ? solid : null;
    },
  };
  return {
    scene,
    partHistory: {
      scene,
      getObjectByName: scene.getObjectByName,
    },
  };
}

function pointsNearlyEqual(a: any, b: any, tolerance = 1e-6) {
  return Math.abs(Number(a?.[0]) - Number(b?.[0])) <= tolerance
    && Math.abs(Number(a?.[1]) - Number(b?.[1])) <= tolerance
    && Math.abs(Number(a?.[2]) - Number(b?.[2])) <= tolerance;
}

function rapidRetractLengthFromMotionSegments(segments: any[]) {
  return (Array.isArray(segments) ? segments : []).reduce((sum, segment) => {
    if (segment?.kind !== 'rapid' && segment?.kind !== 'retract') return sum;
    const start = segment.start || [];
    const end = segment.end || [];
    return sum + Math.hypot(
      Number(end[0]) - Number(start[0]),
      Number(end[1]) - Number(start[1]),
      Number(end[2]) - Number(start[2]),
    );
  }, 0);
}

function testPathSegmentKind(path: any, segmentIndex: number) {
  const points = Array.isArray(path?.points) ? path.points : [];
  const kinds = Array.isArray(path?.segmentKinds) ? path.segmentKinds : [];
  if (kinds.length !== Math.max(0, points.length - 1)) return 'cut';
  return kinds[segmentIndex] === 'link' || kinds[segmentIndex] === 'rapid' ? kinds[segmentIndex] : 'cut';
}

function toolpathCutMoveCount(paths: any[]) {
  return (Array.isArray(paths) ? paths : []).reduce((sum, path) => {
    const points = Array.isArray(path?.points) ? path.points : [];
    let count = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (testPathSegmentKind(path, index - 1) === 'cut') count += 1;
    }
    return sum + count;
  }, 0);
}

function toolpathCutLength(paths: any[]) {
  return (Array.isArray(paths) ? paths : []).reduce((sum, path) => {
    const points = Array.isArray(path?.points) ? path.points : [];
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (testPathSegmentKind(path, index - 1) !== 'cut') continue;
      const a = points[index - 1];
      const b = points[index];
      length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return sum + length;
  }, 0);
}

function parseGcodeMotionMoves(gcode: string, safeZ: number) {
  const state = [0, 0, Number(safeZ) || 0];
  const moves: Array<{ mode: string; end: number[] }> = [];
  const coordPattern = /([XYZ])\s*(-?\d+(?:\.\d+)?)/gi;
  for (const rawLine of String(gcode || '').split(/\r?\n/)) {
    const line = rawLine.split(';')[0].trim();
    const modeMatch = line.match(/\bG0?([01])(?=\s|[XYZF]|$)/i);
    if (!modeMatch) continue;
    const next = state.slice();
    let hasCoordinate = false;
    coordPattern.lastIndex = 0;
    let coordMatch: RegExpExecArray | null = null;
    while ((coordMatch = coordPattern.exec(line))) {
      const axis = coordMatch[1].toUpperCase();
      const value = Number(coordMatch[2]);
      if (!Number.isFinite(value)) continue;
      if (axis === 'X') next[0] = value;
      if (axis === 'Y') next[1] = value;
      if (axis === 'Z') next[2] = value;
      hasCoordinate = true;
    }
    if (!hasCoordinate) continue;
    if (!pointsNearlyEqual(state, next, 1e-5)) {
      moves.push({ mode: `G${modeMatch[1]}`, end: next.slice() });
    }
    state[0] = next[0];
    state[1] = next[1];
    state[2] = next[2];
  }
  return moves;
}

function assertGcodeMotionMatchesSimulation(result: any, linkMode: 'rapid-link' | 'feed-link' = 'rapid-link') {
  const segments = Array.isArray(result?.simulation?.motionSegments) ? result.simulation.motionSegments : [];
  const initialZ = Number(segments[0]?.start?.[2]);
  const moves = parseGcodeMotionMoves(
    result?.gcode || '',
    Number.isFinite(initialZ) ? initialZ : Number(result?.safeZ) || 0,
  );
  assert(moves.length === segments.length, `G-code should emit the same number of motion moves as simulation segments (${moves.length} vs ${segments.length})`);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const move = moves[index];
    assert(pointsNearlyEqual(move.end, segment.end, 1e-4), `G-code move ${index + 1} endpoint should match simulation segment endpoint`);
    const expectedMode = segment.kind === 'cut' || segment.kind === 'plunge' || (segment.kind === 'link' && linkMode === 'feed-link')
      ? 'G1'
      : 'G0';
    assert(move.mode === expectedMode, `G-code move ${index + 1} should use ${expectedMode} for ${segment.kind} simulation motion`);
  }
}

function pathCrossesTargetInterior(paths: any[], size: number) {
  const inside = (point: any) => (
    Number(point?.[0]) > 1e-6
    && Number(point?.[0]) < size - 1e-6
    && Number(point?.[1]) > 1e-6
    && Number(point?.[1]) < size - 1e-6
  );
  for (const path of paths || []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const point = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
        if (inside(point)) return true;
      }
    }
  }
  return false;
}

function pathViolatesTargetClearance(paths: any[], size: number, clearance: number) {
  const distanceOutsideRect = (point: any) => {
    const x = Number(point?.[0]) || 0;
    const y = Number(point?.[1]) || 0;
    const dx = x < 0 ? -x : (x > size ? x - size : 0);
    const dy = y < 0 ? -y : (y > size ? y - size : 0);
    if (dx === 0 && dy === 0) return 0;
    return Math.hypot(dx, dy);
  };
  for (const path of paths || []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (let step = 0; step <= 32; step += 1) {
        const t = step / 32;
        const point = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
        if (distanceOutsideRect(point) < clearance - 0.02) return true;
      }
    }
  }
  return false;
}

function distanceOutsideBoundsFootprint(point: any, bounds: any) {
  const x = Number(point?.[0]) || 0;
  const y = Number(point?.[1]) || 0;
  const minX = Number(bounds?.min?.[0]) || 0;
  const minY = Number(bounds?.min?.[1]) || 0;
  const maxX = Number(bounds?.max?.[0]) || 0;
  const maxY = Number(bounds?.max?.[1]) || 0;
  const dx = x < minX ? minX - x : (x > maxX ? x - maxX : 0);
  const dy = y < minY ? minY - y : (y > maxY ? y - maxY : 0);
  return dx === 0 && dy === 0 ? 0 : Math.hypot(dx, dy);
}

function segmentViolatesBoundsClearance(a: any, b: any, bounds: any, clearance: number) {
  for (let step = 0; step <= 64; step += 1) {
    const t = step / 64;
    const point = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    if (distanceOutsideBoundsFootprint(point, bounds) < clearance - 0.02) return true;
  }
  return false;
}

function pathViolatesBoundsClearance(paths: any[], bounds: any, clearance: number) {
  for (const path of paths || []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (let i = 1; i < points.length; i += 1) {
      if (segmentViolatesBoundsClearance(points[i - 1], points[i], bounds, clearance)) return true;
    }
  }
  return false;
}

function sweptSegmentsViolateBoundsClearance(segments: any[], bounds: any, clearance: number) {
  for (const segment of segments || []) {
    if (segmentViolatesBoundsClearance(segment.start, segment.end, bounds, clearance)) return true;
  }
  return false;
}

function testTrianglePoint(triangle: any, index: number) {
  const point = triangle?.[index];
  return {
    x: Number(point?.x ?? point?.[0]) || 0,
    y: Number(point?.y ?? point?.[1]) || 0,
    z: Number(point?.z ?? point?.[2]) || 0,
  };
}

function testTriangleZAtXY(triangle: any, x: number, y: number) {
  const a = testTrianglePoint(triangle, 0);
  const b = testTrianglePoint(triangle, 1);
  const c = testTrianglePoint(triangle, 2);
  const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denom) <= 1e-9) return null;
  const w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
  const w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
  const w2 = 1 - w0 - w1;
  if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) return null;
  return w0 * a.z + w1 * b.z + w2 * c.z;
}

function testSortedUniqueNumbers(values: number[], tolerance = 1e-5) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > tolerance) out.push(value);
  }
  return out;
}

function testPointInsideTargetMeshMaterial(point: any, triangles: any[]) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  const z = Number(point?.[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  const zs = testSortedUniqueNumbers((triangles || [])
    .map((triangle) => testTriangleZAtXY(triangle, x, y))
    .filter((value): value is number => value != null && Number.isFinite(value)));
  for (let index = 0; index + 1 < zs.length; index += 2) {
    if (z > zs[index] + 1e-4 && z < zs[index + 1] - 1e-4) return true;
  }
  return false;
}

function testAxisIntervalIntersectsTargetMeshMaterial(point: any, upperZ: number, triangles: any[]) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  const low = Number(point?.[2]);
  const high = Number(upperZ);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(low) || !Number.isFinite(high)) return false;
  const minZ = Math.min(low, high);
  const maxZ = Math.max(low, high);
  if (maxZ < minZ + 1e-9) return false;
  const zs = testSortedUniqueNumbers((triangles || [])
    .map((triangle) => testTriangleZAtXY(triangle, x, y))
    .filter((value): value is number => value != null && Number.isFinite(value)));
  for (let index = 0; index + 1 < zs.length; index += 2) {
    if (zs[index + 1] > minZ + 1e-4 && zs[index] < maxZ - 1e-4) return true;
  }
  return false;
}

function testDistSqPointToSegment2(point: any, a: any, b: any) {
  const px = Number(point?.x) || 0;
  const py = Number(point?.y) || 0;
  const ax = Number(a?.x) || 0;
  const ay = Number(a?.y) || 0;
  const bx = Number(b?.x) || 0;
  const by = Number(b?.y) || 0;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const sx = ax + dx * t;
  const sy = ay + dy * t;
  return (px - sx) * (px - sx) + (py - sy) * (py - sy);
}

function testPointInsideTriangleProjection(point: any, triangle: any) {
  const a = testTrianglePoint(triangle, 0);
  const b = testTrianglePoint(triangle, 1);
  const c = testTrianglePoint(triangle, 2);
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = (Number(point?.x) || 0) - a.x;
  const v2y = (Number(point?.y) || 0) - a.y;
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) <= 1e-12) return false;
  const u = (v2x * v1y - v1x * v2y) / denom;
  const v = (v0x * v2y - v2x * v0y) / denom;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
}

function testDistSqPointToTriangleProjection(point: any, triangle: any) {
  if (testPointInsideTriangleProjection(point, triangle)) return 0;
  const a = testTrianglePoint(triangle, 0);
  const b = testTrianglePoint(triangle, 1);
  const c = testTrianglePoint(triangle, 2);
  return Math.min(
    testDistSqPointToSegment2(point, a, b),
    testDistSqPointToSegment2(point, b, c),
    testDistSqPointToSegment2(point, c, a),
  );
}

function testMaxCutterRadiusForHeightRange(profile: any, minHeight: number, maxHeight: number) {
  const low = Math.max(0, minHeight);
  const high = Math.max(low, maxHeight);
  const samples = [low, high, (low + high) * 0.5];
  for (const segment of profile?.segments || []) {
    const segmentLow = Math.max(low, Number(segment?.minHeight));
    const segmentHigh = Math.min(high, Number(segment?.maxHeight));
    if (Number.isFinite(segmentLow) && Number.isFinite(segmentHigh) && segmentHigh >= segmentLow - 1e-9) {
      samples.push(segmentLow, segmentHigh, (segmentLow + segmentHigh) * 0.5);
    }
  }
  return Math.max(0, ...samples.map((height) => Number(profile?.maxRadiusAtHeight?.(height)) || 0));
}

function testCutterPointConservativelyIntersectsTargetMesh(point: any, triangles: any[], profileInput: any, fallbackRadius: number, targetMaxZ: number) {
  const profile = createCamCutterProfile(profileInput || {
    kind: 'flat',
    diameter: Math.max(1e-6, fallbackRadius * 2),
    cuttingLength: Math.max(1e-6, Number.isFinite(targetMaxZ) ? targetMaxZ - Number(point?.[2]) : fallbackRadius * 2),
  });
  const tipZ = Number(point?.[2]);
  if (!Number.isFinite(tipZ)) return false;
  const totalHeight = Math.max(0, Number(profile.cuttingLength) + Number(profile.shaftLength));
  const upperZ = Number.isFinite(targetMaxZ) ? Math.min(tipZ + totalHeight, targetMaxZ + 1e-5) : tipZ + totalHeight;
  if (testAxisIntervalIntersectsTargetMeshMaterial(point, upperZ, triangles)) return true;
  const point2 = { x: Number(point?.[0]) || 0, y: Number(point?.[1]) || 0 };
  for (const triangle of triangles || []) {
    const vertices = [testTrianglePoint(triangle, 0), testTrianglePoint(triangle, 1), testTrianglePoint(triangle, 2)];
    const minZ = Math.min(...vertices.map((vertex) => vertex.z));
    const maxZ = Math.max(...vertices.map((vertex) => vertex.z));
    if (maxZ < tipZ - 1e-9 || minZ > upperZ + 1e-9) continue;
    const radius = Math.max(
      fallbackRadius,
      testMaxCutterRadiusForHeightRange(profile, Math.max(0, minZ - tipZ), Math.min(totalHeight, maxZ - tipZ)),
    );
    const unsafeRadius = Math.max(0, radius - 0.03);
    if (unsafeRadius <= 1e-9) continue;
    if (testDistSqPointToTriangleProjection(point2, triangle) < unsafeRadius * unsafeRadius) return true;
  }
  return false;
}

function firstConservativeMotionTargetMeshIntersection(
  segments: any[],
  triangles: any[],
  fallbackRadius: number,
  safeZ: number,
  profileInput: any,
) {
  const targetMaxZ = (triangles || []).reduce((max, triangle) => Math.max(
    max,
    testTrianglePoint(triangle, 0).z,
    testTrianglePoint(triangle, 1).z,
    testTrianglePoint(triangle, 2).z,
  ), -Infinity);
  for (const segment of segments || []) {
    if (Math.min(Number(segment?.start?.[2]), Number(segment?.end?.[2])) >= safeZ - 1e-6) continue;
    const length = Math.hypot(
      Number(segment?.end?.[0]) - Number(segment?.start?.[0]),
      Number(segment?.end?.[1]) - Number(segment?.start?.[1]),
      Number(segment?.end?.[2]) - Number(segment?.start?.[2]),
    );
    const steps = Math.max(1, Math.min(120, Math.ceil(length / Math.max(0.2, fallbackRadius * 0.25 || 0.2))));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = [
        Number(segment?.start?.[0]) + (Number(segment?.end?.[0]) - Number(segment?.start?.[0])) * t,
        Number(segment?.start?.[1]) + (Number(segment?.end?.[1]) - Number(segment?.start?.[1])) * t,
        Number(segment?.start?.[2]) + (Number(segment?.end?.[2]) - Number(segment?.start?.[2])) * t,
      ];
      if (testCutterPointConservativelyIntersectsTargetMesh(point, triangles, profileInput, fallbackRadius, targetMaxZ)) {
        return {
          kind: segment?.kind,
          sourcePathId: segment?.sourcePathId,
          start: segment?.start,
          end: segment?.end,
          point,
        };
      }
    }
  }
  return null;
}

function testCutterCollisionHeights(profile: any, maxHeight: number) {
  const high = Math.max(0, Math.min(
    Number.isFinite(maxHeight) ? maxHeight : 0,
    Math.max(0, Number(profile?.cuttingLength) || 0) + Math.max(0, Number(profile?.shaftLength) || 0),
  ));
  if (high <= 1e-6) return [0];
  const values = [0, high * 0.5, high];
  for (const segment of profile?.segments || []) {
    values.push(Number(segment.minHeight), Number(segment.maxHeight));
  }
  return testSortedUniqueNumbers(values
    .filter((value) => Number.isFinite(value) && value >= -1e-6 && value <= high + 1e-6)
    .map((value) => Math.max(0, Math.min(high, value))));
}

function sweptSegmentsIntersectTargetMeshMaterial(segments: any[], triangles: any[], fallbackRadius: number) {
  const angles = Array.from({ length: 8 }, (_value, index) => (Math.PI * 2 * index) / 8);
  const targetMaxZ = (triangles || []).reduce((max, triangle) => Math.max(
    max,
    testTrianglePoint(triangle, 0).z,
    testTrianglePoint(triangle, 1).z,
    testTrianglePoint(triangle, 2).z,
  ), -Infinity);
  const sourceSegments = Array.isArray(segments) ? segments : [];
  const stride = Math.max(1, Math.ceil(sourceSegments.length / 220));
  const sampledSegments = sourceSegments.filter((_segment, index) => index === 0 || index === sourceSegments.length - 1 || index % stride === 0);
  for (const segment of sampledSegments) {
    const start = segment?.start;
    const end = segment?.end;
    const radius = Math.max(0, Number(segment?.radius) || fallbackRadius || 0);
    const profile = createCamCutterProfile(segment?.cutterProfile || {
      kind: 'flat',
      diameter: Math.max(1e-6, radius * 2),
      cuttingLength: Math.max(1e-6, Number.isFinite(targetMaxZ) ? targetMaxZ - Number(start?.[2]) : radius * 2),
    });
    const length = Math.hypot(
      Number(end?.[0]) - Number(start?.[0]),
      Number(end?.[1]) - Number(start?.[1]),
      Number(end?.[2]) - Number(start?.[2]),
    );
    const steps = Math.max(1, Math.min(4, Math.ceil(length / Math.max(0.5, radius * 2 || 0.5))));
    const radialSamples = [0, radius * 0.7, radius * 0.98].filter((value, index, array) => (
      value <= radius + 1e-6 && array.indexOf(value) === index
    ));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const center = [
        Number(start?.[0]) + (Number(end?.[0]) - Number(start?.[0])) * t,
        Number(start?.[1]) + (Number(end?.[1]) - Number(start?.[1])) * t,
        Number(start?.[2]) + (Number(end?.[2]) - Number(start?.[2])) * t,
      ];
      for (const height of testCutterCollisionHeights(profile, Number.isFinite(targetMaxZ) ? targetMaxZ - center[2] + 1e-5 : profile.cuttingLength)) {
        const z = center[2] + height;
        const heightRadius = Math.max(0, Number(profile.maxRadiusAtHeight(height)) || 0);
        const heightRadials = radialSamples
          .filter((value) => value <= heightRadius + 1e-6)
          .concat(heightRadius > 1e-6 ? [heightRadius * 0.98] : []);
        for (const radial of testSortedUniqueNumbers(heightRadials)) {
          if (radial <= 1e-9) {
            if (testPointInsideTargetMeshMaterial([center[0], center[1], z], triangles)) return true;
            continue;
          }
          for (const angle of angles) {
            if (testPointInsideTargetMeshMaterial([
              center[0] + Math.cos(angle) * radial,
              center[1] + Math.sin(angle) * radial,
              z,
            ], triangles)) return true;
          }
        }
      }
    }
  }
  return false;
}

function pathViolatesSlopedTopMaterial(paths: any[], sizeX: number, sizeY: number, lowTopZ: number, highTopZ: number) {
  const topZAtX = (x: number) => lowTopZ + ((highTopZ - lowTopZ) * x) / sizeX;
  for (const path of paths || []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (let step = 0; step <= 96; step += 1) {
        const t = step / 96;
        const x = Number(a?.[0]) + (Number(b?.[0]) - Number(a?.[0])) * t;
        const y = Number(a?.[1]) + (Number(b?.[1]) - Number(a?.[1])) * t;
        const z = Number(a?.[2]) + (Number(b?.[2]) - Number(a?.[2])) * t;
        if (
          x > 1e-6
          && x < sizeX - 1e-6
          && y > 1e-6
          && y < sizeY - 1e-6
          && z < topZAtX(x) - 0.02
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function pathEntersFootprintBelowZ(paths: any[], minX: number, minY: number, maxX: number, maxY: number, maxZ: number) {
  for (const path of paths || []) {
    const points = Array.isArray(path?.points) ? path.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      for (let step = 0; step <= 96; step += 1) {
        const t = step / 96;
        const x = Number(a?.[0]) + (Number(b?.[0]) - Number(a?.[0])) * t;
        const y = Number(a?.[1]) + (Number(b?.[1]) - Number(a?.[1])) * t;
        const z = Number(a?.[2]) + (Number(b?.[2]) - Number(a?.[2])) * t;
        if (
          z <= maxZ + 1e-6
          && x > minX + 1e-6
          && x < maxX - 1e-6
          && y > minY + 1e-6
          && y < maxY - 1e-6
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function meshHasSlopedTriangles(mesh: any) {
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!position?.count) return false;
  const index = geometry.index?.array || null;
  const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(position.count / 3);
  const triangleVertexIndex = (triangle: number, offset: number) => (
    index ? Number(index[triangle * 3 + offset]) : triangle * 3 + offset
  );
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertices = [0, 1, 2].map((offset) => triangleVertexIndex(triangle, offset));
    const xs = vertices.map((vertex) => position.getX(vertex));
    const ys = vertices.map((vertex) => position.getY(vertex));
    const zs = vertices.map((vertex) => position.getZ(vertex));
    const xRange = Math.max(...xs) - Math.min(...xs);
    const yRange = Math.max(...ys) - Math.min(...ys);
    const zRange = Math.max(...zs) - Math.min(...zs);
    if (zRange > 1e-6 && xRange > 1e-6 && yRange > 1e-6) return true;
  }
  return false;
}

function boundaryEdgeCountFromMeshArrays(positions: number[], indices: number[]) {
  const edgeUse = new Map<string, number>();
  const vertexKey = (index: number) => [
    Math.round((Number(positions[index * 3]) || 0) * 1e6),
    Math.round((Number(positions[index * 3 + 1]) || 0) * 1e6),
    Math.round((Number(positions[index * 3 + 2]) || 0) * 1e6),
  ].join(',');
  const addEdge = (a: number, b: number) => {
    const ka = vertexKey(a);
    const kb = vertexKey(b);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = Number(indices[i]);
    const b = Number(indices[i + 1]);
    const c = Number(indices[i + 2]);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  let boundaryCount = 0;
  for (const count of edgeUse.values()) {
    if (count === 1) boundaryCount += 1;
  }
  return boundaryCount;
}

function zRangeFromPositions(positions: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    const z = Number(positions[i]);
    if (!Number.isFinite(z)) continue;
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  return { min, max, span: max - min };
}

function uniqueXYCountFromPositions(positions: number[]) {
  const unique = new Set<string>();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    unique.add(`${Math.round((Number(positions[i]) || 0) * 1e5)},${Math.round((Number(positions[i + 1]) || 0) * 1e5)}`);
  }
  return unique.size;
}

function maxRadiusAtMinimumZFromPositions(positions: number[]) {
  const range = zRangeFromPositions(positions);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const z = Number(positions[i + 2]);
    if (Math.abs(z - range.min) > 1e-6) continue;
    points.push({ x: Number(positions[i]) || 0, y: Number(positions[i + 1]) || 0 });
  }
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  const cx = center.x / Math.max(1, points.length);
  const cy = center.y / Math.max(1, points.length);
  return points.reduce((max, point) => Math.max(max, Math.hypot(point.x - cx, point.y - cy)), 0);
}

function optionValues(select: HTMLSelectElement | null) {
  return Array.from(select?.options || []).map((option) => option.value);
}

function optionTexts(select: HTMLSelectElement | null) {
  return Array.from(select?.options || []).map((option) => option.textContent || '');
}

function nearlyEqual(a: number, b: number, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
}

function cutterValue(value: number | null, message: string) {
  assert(value != null && Number.isFinite(value), message);
  return value;
}

function assertThrows(fn: () => void, message: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function assertThrowsWithMessage(fn: () => void, fragment: string, message: string) {
  let thrownMessage = '';
  try {
    fn();
  } catch (error) {
    thrownMessage = String((error as any)?.message || error || '');
  }
  assert(thrownMessage.includes(fragment), `${message}: ${thrownMessage || 'did not throw'}`);
}

async function assertRejectsWithMessage(fn: () => Promise<unknown>, fragment: string, message: string) {
  let thrownMessage = '';
  try {
    await fn();
  } catch (error) {
    thrownMessage = String((error as any)?.message || error || '');
  }
  assert(thrownMessage.includes(fragment), `${message}: ${thrownMessage || 'did not reject'}`);
}

export async function test_cam_cutter_profiles_evaluate_selected_shapes() {
  const flat = createCamCutterProfile({ kind: 'flat', diameter: 10, cuttingLength: 20 });
  assert(flat.validate().length === 0, 'Flat CAM cutter profile should validate with positive dimensions');
  assert(flat.kind === 'flat' && flat.radius === 5, 'Flat CAM cutter profile should expose normalized radius');
  assert(cutterValue(flat.heightAtRadius(5), 'Flat cutter should evaluate at the cutting radius') === 0, 'Flat cutter height should stay on the bottom plane');
  assert(cutterValue(flat.radiusAtHeight(12), 'Flat cutter should evaluate within cutting length') === 5, 'Flat cutter radiusAtHeight should stay constant through cutting length');
  assert(flat.heightAtRadius(5.1) === null, 'Flat cutter should report no contact outside the tool radius');

  const ball = createCamCutterProfile({ kind: 'ball', diameter: 10, cuttingLength: 20, shaftLength: 5 });
  assert(nearlyEqual(cutterValue(ball.heightAtRadius(0), 'Ball cutter should evaluate at the tip'), 0), 'Ball cutter tip height should be zero');
  assert(nearlyEqual(cutterValue(ball.heightAtRadius(5), 'Ball cutter should evaluate at the radius'), 5), 'Ball cutter heightAtRadius(R) should equal R');
  assert(nearlyEqual(cutterValue(ball.radiusAtHeight(5), 'Ball cutter should evaluate at ball center height'), 5), 'Ball cutter radiusAtHeight(R) should equal R');
  assert(cutterValue(ball.maxRadiusAtHeight(22), 'Ball cutter shaft extension should evaluate above cutting length') === 5, 'Ball cutter maxRadiusAtHeight should use shaft radius above cutting length');

  const bull = createCamCutterProfile({ kind: 'bull', diameter: 10, cornerRadius: 1, cuttingLength: 20 });
  assert(bull.validate().length === 0, 'Bull CAM cutter profile should validate a corner smaller than tool radius');
  assert(nearlyEqual(cutterValue(bull.heightAtRadius(4), 'Bull cutter should evaluate at flat radius'), 0), 'Bull cutter should keep the center flat before the corner radius');
  assert(nearlyEqual(cutterValue(bull.heightAtRadius(5), 'Bull cutter should evaluate at outer radius'), 1), 'Bull cutter outer corner height should equal the corner radius');
  assert(nearlyEqual(cutterValue(bull.radiusAtHeight(1), 'Bull cutter should evaluate at corner height'), 5), 'Bull cutter radiusAtHeight at corner height should reach full radius');
  assert(validateCamCutterProfile({ kind: 'bull', diameter: 10, cornerRadius: 5 }).some((error) => error.includes('cornerRadius')), 'Bull cutter validation should reject cornerRadius equal to cutter radius');

  const cone = createCamCutterProfile({ kind: 'cone', maximumDiameter: 10, includedAngle: 90, cuttingLength: 20 });
  assert(cone.validate().length === 0, 'Cone CAM cutter profile should validate positive maximum diameter and included angle');
  assert(nearlyEqual(cutterValue(cone.heightAtRadius(5), 'Cone cutter should evaluate at maximum radius'), 5), 'A 90 degree cone should have heightAtRadius(R) = R');
  assert(nearlyEqual(cutterValue(cone.radiusAtHeight(5), 'Cone cutter should evaluate at maximum height'), 5), 'A 90 degree cone should have radiusAtHeight(R) = R');
  assert(validateCamCutterProfile({ kind: 'cone', maximumDiameter: 10, includedAngle: 180 }).some((error) => error.includes('includedAngle')), 'Cone cutter validation should reject a 180 degree included angle');
  assert(validateCamCutterProfile({ kind: 'cone', maximumDiameter: 10, includedAngle: 'wide' }).some((error) => error.includes('includedAngle') && error.includes('finite')), 'Cone cutter validation should reject a non-numeric included angle');

  const ballCone = createCamCutterProfile({ kind: 'ball-cone', ballDiameter: 4, maximumDiameter: 8, includedAngle: 90, cuttingLength: 20 });
  assert(ballCone.validate().length === 0, 'Ball-cone CAM cutter profile should validate a ball diameter not larger than the maximum diameter');
  const tangentRadius = cutterValue(ballCone.tangentRadius ?? null, 'Ball-cone cutter should expose tangent radius');
  const tangentHeight = cutterValue(ballCone.tangentHeight ?? null, 'Ball-cone cutter should expose tangent height');
  const beforeTangent = cutterValue(ballCone.heightAtRadius(tangentRadius - 1e-5), 'Ball-cone cutter should evaluate below tangent radius');
  const atTangent = cutterValue(ballCone.heightAtRadius(tangentRadius), 'Ball-cone cutter should evaluate at tangent radius');
  const afterTangent = cutterValue(ballCone.heightAtRadius(tangentRadius + 1e-5), 'Ball-cone cutter should evaluate above tangent radius');
  assert(nearlyEqual(atTangent, tangentHeight), 'Ball-cone cutter height should match tangent metadata');
  assert(Math.abs((atTangent - beforeTangent) - (afterTangent - atTangent)) < 1e-4, 'Ball-cone cutter should be slope-continuous around the tangent');
  assert(nearlyEqual(cutterValue(ballCone.radiusAtHeight(tangentHeight), 'Ball-cone cutter should invert tangent height'), tangentRadius), 'Ball-cone cutter radiusAtHeight should return tangent radius at tangent height');
  assert(validateCamCutterProfile({ kind: 'ball-cone', ballDiameter: 8, maximumDiameter: 4, includedAngle: 90 }).some((error) => error.includes('ballDiameter')), 'Ball-cone cutter validation should reject a ball diameter larger than maximum diameter');
  assert(validateCamCutterProfile({ kind: 'ball-cone', ballDiameter: 4, maximumDiameter: 8, includedAngle: Number.NaN }).some((error) => error.includes('includedAngle') && error.includes('finite')), 'Ball-cone cutter validation should reject a non-finite included angle');

  const ballLike = createCamCutterProfile({ kind: 'ball-cone', ballDiameter: 6, maximumDiameter: 6, includedAngle: 90, cuttingLength: 20 });
  const plainBall = createCamCutterProfile({ kind: 'ball', diameter: 6, cuttingLength: 20 });
  assert(nearlyEqual(cutterValue(ballLike.heightAtRadius(3), 'Ball-like compound cutter should evaluate at radius'), cutterValue(plainBall.heightAtRadius(3), 'Plain ball cutter should evaluate at radius')), 'Ball-cone with equal diameters should behave like a ball cutter');

  for (const profile of [flat, ball, bull, cone, ballCone]) {
    const preview = profile.makePreviewMesh({ radialSegments: 12, verticalSegments: 8 });
    assert(preview.positions.length > 0 && preview.indices.length > 0, `${profile.kind} cutter should produce preview mesh geometry`);
    assert(preview.vertexCount === preview.positions.length / 3 && preview.triangleCount === preview.indices.length / 3, `${profile.kind} cutter preview mesh should report vertex and triangle counts`);
    assert(zRangeFromPositions(preview.positions).span >= profile.cuttingLength + profile.shaftLength - 1e-6, `${profile.kind} cutter preview mesh should include cutting and shaft length`);

    const swept = profile.makeSweptSegmentMesh([0, 0, 0], [2, 0, 1], { radialSegments: 12, verticalSegments: 8 });
    assert(swept.positions.length > 0 && swept.indices.length > 0, `${profile.kind} cutter should produce swept segment mesh geometry`);
    assert(swept.vertexCount === swept.positions.length / 3 && swept.triangleCount === swept.indices.length / 3, `${profile.kind} cutter swept mesh should report vertex and triangle counts`);
    assert(zRangeFromPositions(swept.positions).span >= profile.cuttingLength + profile.shaftLength, `${profile.kind} cutter swept mesh should span the cutter length across motion`);
  }
}

export async function test_cam_point_and_batch_drop_cutter_project_mesh_points() {
  const planeTriangles = [
    { id: 1, a: [0, 0, 2], b: [10, 0, 2], c: [0, 10, 2] },
    { id: 2, a: [10, 0, 2], b: [10, 10, 2], c: [0, 10, 2] },
  ] as any[];
  const flat = createCamCutterProfile({ kind: 'flat', diameter: 2, cuttingLength: 12 });
  const flatPoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: -5 },
    cutter: flat,
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(nearlyEqual(flatPoint.point.z, 2), 'Flat point drop-cutter should lift to a horizontal plane');
  assert(flatPoint.point.contact?.type !== 'none', 'Flat point drop-cutter should report contact on a horizontal plane');

  const ballPoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: -5 },
    cutter: createCamCutterProfile({ kind: 'ball', diameter: 2, cuttingLength: 12 }),
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(nearlyEqual(ballPoint.point.z, 2), 'Ball point drop-cutter should use the ball tip on a horizontal plane');

  const bullPoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: -5 },
    cutter: createCamCutterProfile({ kind: 'bull', diameter: 2, cornerRadius: 0.25, cuttingLength: 12 }),
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(nearlyEqual(bullPoint.point.z, 2), 'Bull point drop-cutter should use the flat tip on a horizontal plane');

  const conePoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: -5 },
    cutter: createCamCutterProfile({ kind: 'cone', maximumDiameter: 2, includedAngle: 90, cuttingLength: 12 }),
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(nearlyEqual(conePoint.point.z, 2), 'Cone point drop-cutter should use the cone tip on a horizontal plane');

  const ballConePoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: -5 },
    cutter: createCamCutterProfile({ kind: 'ball-cone', ballDiameter: 1, maximumDiameter: 2, includedAngle: 90, cuttingLength: 12 }),
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(nearlyEqual(ballConePoint.point.z, 2), 'Ball-cone point drop-cutter should use the ball tip on a horizontal plane');
  assert([bullPoint, conePoint, ballConePoint].every((result) => result.point.contact?.type !== 'none'), 'Non-flat cutter point drop-cutter should report contact on a horizontal plane');

  const slopedTriangles = [
    { id: 10, a: [0, 0, 0], b: [10, 0, 0], c: [0, 10, 10] },
  ] as any[];
  const lowSlope = dropCutterAtPoint({
    point: { x: 2, y: 2, z: -1 },
    cutter: flat,
    triangles: slopedTriangles,
    floorZ: -1,
  });
  const highSlope = dropCutterAtPoint({
    point: { x: 2, y: 6, z: -1 },
    cutter: flat,
    triangles: slopedTriangles,
    floorZ: -1,
  });
  assert(highSlope.point.z > lowSlope.point.z, 'Point drop-cutter should produce increasing Z along an uphill sloped triangle');

  const farVertex = dropCutterAtPoint({
    point: { x: 0, y: 0, z: 0 },
    cutter: flat,
    triangles: [{ id: 20, a: [5, 5, 10], b: [6, 5, 10], c: [5, 6, 10] }] as any[],
    floorZ: 0,
  });
  assert(farVertex.point.z === 0 && farVertex.point.contact?.type === 'none', 'Point drop-cutter should ignore triangles outside the cutter radius');

  const invalidPoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: Number.NaN, id: 'bad-z' },
    cutter: flat,
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(invalidPoint.point.contact?.type === 'none' && invalidPoint.point.z === -5, 'Point drop-cutter should reject explicitly non-finite input coordinates without projecting a stale point');
  assert(invalidPoint.warnings.some((warning) => warning.includes('finite x, y, and z')), 'Point drop-cutter should warn when input coordinates are non-finite');

  const emptyMeshPoint = dropCutterAtPoint({
    point: { x: 4, y: 4, z: 10, id: 'empty-mesh' },
    cutter: flat,
    triangles: [],
    floorZ: -5,
  });
  assert(emptyMeshPoint.point.z === -5 && emptyMeshPoint.point.contact?.type === 'none', 'Point drop-cutter should return floorZ with no contact when no mesh triangles are available');
  assert(emptyMeshPoint.warnings.some((warning) => warning.includes('No mesh triangles')), 'Point drop-cutter should warn when no mesh triangles are available');

  const index = buildCamTriangleSpatialIndex(slopedTriangles);
  const indexed = dropCutterAtPoint({
    point: { x: 2, y: 6, z: -1 },
    cutter: flat,
    triangles: slopedTriangles,
    index,
    floorZ: -1,
  });
  assert(nearlyEqual(indexed.point.z, highSlope.point.z), 'Indexed point drop-cutter should match brute-force point drop-cutter output');

  const progress: string[] = [];
  let yieldCount = 0;
  const batch = await dropCutterBatch({
    points: [
      { x: 4, y: 4, z: -5, id: 'middle' },
      { x: 2, y: 2, z: -5, id: 'low' },
      { x: 2, y: 6, z: -5, id: 'high' },
    ],
    cutter: flat,
    triangles: slopedTriangles,
    floorZ: -5,
    chunkSize: 2,
    onProgress: (event) => progress.push(event.phase),
    progressYield: () => { yieldCount += 1; },
  });
  assert(batch.points.map((point) => point.id).join('|') === 'middle|low|high', 'Batch drop-cutter should preserve input point order and ids');
  assert(batch.points[2].z > batch.points[1].z, 'Batch drop-cutter should project each point independently');
  assert(batch.summary.pointCount === 3 && batch.summary.candidateCount >= 3, 'Batch drop-cutter should summarize projected point and candidate counts');
  assert(progress.includes('batch-drop-index') && progress.filter((phase) => phase === 'batch-drop-points').length === 2, 'Batch drop-cutter should emit preparation, index, and chunk progress');
  assert(progress.includes('prepare-drop-index') && progress.filter((phase) => phase === 'drop-points').length === 2 && progress.includes('drop-complete'), 'Batch drop-cutter should also emit spec-named public progress phases');
  assert(yieldCount >= 4, 'Batch drop-cutter should yield at preparation and chunk boundaries');

  const fallbackBatch = await dropCutterBatch({
    points: [{ x: 2, y: 6, z: -5, id: 'fallback' }],
    cutter: flat,
    triangles: slopedTriangles,
    floorZ: -5,
    indexOptions: { bucketSize: 0 },
  });
  assert(nearlyEqual(fallbackBatch.points[0].z, highSlope.point.z), 'Batch drop-cutter brute-force fallback should match indexed projection on small meshes');
  assert(
    fallbackBatch.warnings.some((warning) => warning.includes('Triangle spatial index build failed') && warning.includes('brute-force')),
    'Batch drop-cutter should warn when falling back to brute-force triangle queries',
  );

  const invalidBatch = await dropCutterBatch({
    points: [{ x: 4, y: 4, z: Number.NaN, id: 'bad-z', pathId: 'fixture-path' }],
    cutter: flat,
    triangles: planeTriangles,
    floorZ: -5,
  });
  assert(invalidBatch.summary.warningCount === 1, 'Batch drop-cutter should summarize non-finite point warnings');
  assert(
    invalidBatch.warnings[0].includes('fixture-path') && invalidBatch.warnings[0].includes('bad-z'),
    'Batch drop-cutter warnings should identify the source point path/id when available',
  );

  const emptyMeshBatch = await dropCutterBatch({
    points: [{ x: 4, y: 4, z: -5, id: 'empty-mesh', pathId: 'empty-path' }],
    cutter: flat,
    triangles: [],
    floorZ: -5,
  });
  assert(emptyMeshBatch.points[0].contact?.type === 'none', 'Batch drop-cutter should return no-contact points when no mesh triangles are available');
  assert(
    emptyMeshBatch.warnings[0].includes('No mesh triangles') && emptyMeshBatch.warnings[0].includes('empty-path'),
    'Batch drop-cutter empty-mesh warnings should include source point context',
  );

  const invalidCutterProgress: string[] = [];
  const invalidCutterBatch = await dropCutterBatch({
    points: [{ x: 4, y: 4, z: -5, id: 'invalid-cutter-point' }],
    cutter: { kind: 'flat', diameter: 0, cuttingLength: 12 },
    triangles: planeTriangles,
    floorZ: -5,
    onProgress: (event) => invalidCutterProgress.push(event.phase),
  });
  assert(invalidCutterBatch.summary.candidateCount === 0 && invalidCutterBatch.summary.contactCount === 0, 'Batch drop-cutter should fail invalid cutters before triangle sampling');
  assert(invalidCutterBatch.warnings.length === 1 && invalidCutterBatch.warnings[0].includes('diameter'), 'Batch drop-cutter invalid cutter feedback should not duplicate validation errors per point');
  assert(invalidCutterProgress.length === 0, 'Batch drop-cutter should not emit sampling progress after invalid cutter validation fails');

  const empty = await dropCutterBatch({
    points: [],
    cutter: flat,
    triangles: slopedTriangles,
    floorZ: -5,
  });
  assert(empty.points.length === 0 && empty.summary.pointCount === 0, 'Empty batch drop-cutter input should succeed without points');
}

export async function test_cam_path_drop_cutter_projects_uniform_and_adaptive_paths() {
  const horizontalPlane = [
    { id: 1, a: [0, 0, 2], b: [10, 0, 2], c: [0, 10, 2] },
    { id: 2, a: [10, 0, 2], b: [10, 10, 2], c: [0, 10, 2] },
  ] as any[];
  const cutter = createCamCutterProfile({ kind: 'flat', diameter: 1, cuttingLength: 10 });
  const uniformProgressPhases: string[] = [];
  let uniformYieldCount = 0;
  const uniformLine = await uniformPathDropCutter({
    paths: [{
      id: 'line',
      spans: [{ kind: 'line', id: 'line-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 2,
    floorZ: -5,
    chunkSize: 2,
    onProgress: (event) => uniformProgressPhases.push(event.phase),
    progressYield: () => { uniformYieldCount += 1; },
  });
  assert(uniformLine.paths.length === 1, 'Uniform path drop-cutter should return the sampled source path');
  assert(uniformLine.paths[0].points.length === 6, 'Uniform path drop-cutter should include line endpoints at fixed spacing');
  assert(uniformLine.paths[0].points.every((point) => nearlyEqual(point.z, 2)), 'Uniform path drop-cutter should project all line samples to the horizontal plane');
  assert(uniformLine.paths[0].sourceSpanIds.join('|') === 'line-a|line-a|line-a|line-a|line-a|line-a', 'Uniform path drop-cutter should retain source span ids');
  assert(uniformProgressPhases.includes('uniform-path-drop-index'), 'Uniform path drop-cutter should report indexed batch projection progress');
  assert(uniformProgressPhases.filter((phase) => phase === 'uniform-path-drop-points').length === 3, 'Uniform path drop-cutter should report chunked projection progress for sampled points');
  assert(uniformYieldCount >= 6, 'Uniform path drop-cutter should yield through sampling and batch projection chunks');

  const uniformFallback = await uniformPathDropCutter({
    paths: [{
      id: 'fallback-line',
      spans: [{ kind: 'line', id: 'fallback-line-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 10,
    floorZ: -5,
    indexOptions: { bucketSize: 0 },
  });
  assert(uniformFallback.paths[0].points.every((point) => nearlyEqual(point.z, 2)), 'Uniform path drop-cutter fallback should still project samples to the target mesh');
  assert(
    uniformFallback.warnings.some((warning) => warning.includes('Triangle spatial index build failed') && warning.includes('brute-force')),
    'Uniform path drop-cutter should forward triangle index fallback warnings from batch projection',
  );

  const uniformArc = await uniformPathDropCutter({
    paths: [{
      id: 'arc',
      spans: [{ kind: 'arc', id: 'arc-a', start: [6, 5, 0], end: [5, 6, 0], center: [5, 5, 0], clockwise: false }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 0.5,
    floorZ: -5,
  });
  const arcPoints = uniformArc.paths[0].points;
  assert(nearlyEqual(arcPoints[0].x, 6) && nearlyEqual(arcPoints[0].y, 5), 'Uniform arc drop-cutter should preserve the arc start XY');
  assert(nearlyEqual(arcPoints[arcPoints.length - 1].x, 5) && nearlyEqual(arcPoints[arcPoints.length - 1].y, 6), 'Uniform arc drop-cutter should preserve the arc end XY');
  assert(
    uniformArc.warnings.some((warning) => warning.includes('discretizes arcs') && warning.includes('G2/G3')),
    'Uniform arc drop-cutter should warn that current output discretizes arcs instead of preserving G2/G3 moves',
  );

  const adaptiveArc = await adaptivePathDropCutter({
    paths: [{
      id: 'adaptive-arc',
      spans: [{ kind: 'arc', id: 'adaptive-arc-a', start: [6, 5, 0], end: [5, 6, 0], center: [5, 5, 0], clockwise: false }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 10,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.999,
    floorZ: -5,
  });
  assert(adaptiveArc.paths.length === 1 && adaptiveArc.paths[0].points.length > 2, 'Adaptive arc drop-cutter should subdivide curved source spans when flatness requires it');
  assert(
    adaptiveArc.warnings.some((warning) => warning.includes('discretizes arcs') && warning.includes('G2/G3')),
    'Adaptive arc drop-cutter should warn that current output discretizes arcs instead of preserving G2/G3 moves',
  );

  const sharedEndpoint = await uniformPathDropCutter({
    paths: [{
      id: 'joined',
      spans: [
        { kind: 'line', id: 'joined-a', start: [0, 1, 0], end: [5, 1, 0] },
        { kind: 'line', id: 'joined-b', start: [5, 1, 0], end: [10, 1, 0] },
      ],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 10,
    floorZ: -5,
  });
  assert(sharedEndpoint.paths[0].points.length === 3, 'Uniform path drop-cutter should not duplicate shared span endpoints by default');

  const degenerateUniformProgress: string[] = [];
  const degenerateUniform = await uniformPathDropCutter({
    paths: [{
      id: 'degenerate-uniform',
      spans: [{ kind: 'line', id: 'zero-line', start: [1, 1, 0], end: [1, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 1,
    floorZ: -5,
    onProgress: (event) => degenerateUniformProgress.push(event.phase),
  });
  assert(degenerateUniform.paths.length === 0, 'Uniform path drop-cutter should skip source paths whose spans are all degenerate');
  assert(degenerateUniform.summary.spanCount === 1, 'Uniform path drop-cutter should summarize attempted source spans even when they are degenerate');
  assert(degenerateUniform.summary.warningCount === degenerateUniform.warnings.length, 'Uniform path drop-cutter degenerate span feedback should be counted in the summary');
  assert(degenerateUniformProgress.includes('uniform-path-sample') && !degenerateUniformProgress.includes('uniform-path-drop'), 'Uniform path drop-cutter should not run batch projection setup when no valid source samples exist');
  assert(
    degenerateUniform.warnings.some((warning) => warning.includes('degenerate-uniform') && warning.includes('zero-line') && warning.includes('Degenerate')),
    'Uniform path drop-cutter degenerate span warning should identify the source path and span id',
  );

  const degenerateAdaptiveProgress: string[] = [];
  const degenerateAdaptive = await adaptivePathDropCutter({
    paths: [{
      id: 'degenerate-adaptive',
      spans: [{ kind: 'line', id: 'zero-adaptive-line', start: [1, 1, 0], end: [1, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 1,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.999,
    floorZ: -5,
    onProgress: (event) => degenerateAdaptiveProgress.push(event.phase),
  });
  assert(degenerateAdaptive.paths.length === 0, 'Adaptive path drop-cutter should skip source paths whose spans are all degenerate');
  assert(degenerateAdaptive.summary.spanCount === 1, 'Adaptive path drop-cutter should summarize attempted source spans even when they are degenerate');
  assert(degenerateAdaptive.summary.warningCount === degenerateAdaptive.warnings.length, 'Adaptive path drop-cutter degenerate span feedback should be counted in the summary');
  assert(!degenerateAdaptiveProgress.includes('adaptive-path-index'), 'Adaptive path drop-cutter should not build the projector/index when no valid source spans exist');
  assert(
    degenerateAdaptive.warnings.some((warning) => warning.includes('degenerate-adaptive') && warning.includes('zero-adaptive-line') && warning.includes('Degenerate')),
    'Adaptive path drop-cutter degenerate span warning should identify the source path and span id',
  );

  const invalidUniformProgress: string[] = [];
  const invalidUniform = await uniformPathDropCutter({
    paths: [{
      id: 'invalid-uniform',
      spans: [{ kind: 'line', id: 'invalid-uniform-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter: { kind: 'flat', diameter: 0, cuttingLength: 10 },
    triangles: horizontalPlane,
    sampleSpacing: 2,
    floorZ: -5,
    onProgress: (event) => invalidUniformProgress.push(event.phase),
  });
  assert(invalidUniform.paths.length === 0, 'Uniform path drop-cutter should not generate paths with an invalid cutter');
  assert(invalidUniform.summary.sampleCount === 0 && invalidUniform.summary.candidateCount === 0, 'Uniform path drop-cutter should fail invalid cutters before source sampling or triangle projection');
  assert(invalidUniform.warnings.length === 1 && invalidUniform.warnings[0].includes('diameter'), 'Uniform path drop-cutter invalid cutter feedback should not be duplicated per sample');
  assert(invalidUniformProgress.length === 0, 'Uniform path drop-cutter should not emit sampling progress after invalid cutter validation fails');

  const invalidUniformSpacingProgress: string[] = [];
  const invalidUniformSpacing = await uniformPathDropCutter({
    paths: [{
      id: 'invalid-uniform-spacing',
      spans: [{ kind: 'line', id: 'invalid-uniform-spacing-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 0,
    floorZ: -5,
    onProgress: (event) => invalidUniformSpacingProgress.push(event.phase),
  });
  assert(invalidUniformSpacing.paths.length === 0, 'Uniform path drop-cutter should not generate paths with invalid sample spacing');
  assert(invalidUniformSpacing.summary.sampleCount === 0 && invalidUniformSpacing.summary.candidateCount === 0, 'Uniform path drop-cutter should fail invalid sample spacing before source sampling or projection');
  assert(invalidUniformSpacing.warnings.length === 1 && invalidUniformSpacing.warnings[0].includes('sampleSpacing'), 'Uniform path drop-cutter should report invalid sample spacing instead of silently clamping it');
  assert(invalidUniformSpacingProgress.length === 0, 'Uniform path drop-cutter should not emit progress after invalid sample spacing validation fails');

  const emptyMeshUniformProgress: string[] = [];
  const emptyMeshUniform = await uniformPathDropCutter({
    paths: [{
      id: 'empty-uniform',
      spans: [{ kind: 'line', id: 'empty-uniform-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: [],
    sampleSpacing: 2,
    floorZ: -5,
    onProgress: (event) => emptyMeshUniformProgress.push(event.phase),
  });
  assert(emptyMeshUniform.paths.length === 0, 'Uniform path drop-cutter should not fabricate floor-Z paths when no target mesh triangles are supplied');
  assert(emptyMeshUniform.summary.sampleCount === 0 && emptyMeshUniform.summary.candidateCount === 0, 'Uniform path drop-cutter should stop before sampling an empty target mesh');
  assert(emptyMeshUniform.warnings.some((warning) => warning.includes('No mesh triangles')), 'Uniform path drop-cutter should report missing target mesh triangles');
  assert(emptyMeshUniformProgress.length === 0, 'Uniform path drop-cutter should not emit projection progress for an empty target mesh');

  const invalidAdaptiveProgress: string[] = [];
  const invalidAdaptive = await adaptivePathDropCutter({
    paths: [{
      id: 'invalid-adaptive',
      spans: [{ kind: 'line', id: 'invalid-adaptive-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter: { kind: 'flat', diameter: 0, cuttingLength: 10 },
    triangles: horizontalPlane,
    sampleSpacing: 2,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.999,
    floorZ: -5,
    onProgress: (event) => invalidAdaptiveProgress.push(event.phase),
  });
  assert(invalidAdaptive.paths.length === 0, 'Adaptive path drop-cutter should not generate paths with an invalid cutter');
  assert(invalidAdaptive.summary.sampleCount === 0 && invalidAdaptive.summary.subdivisionCount === 0, 'Adaptive path drop-cutter should fail invalid cutters before source sampling or subdivision');
  assert(invalidAdaptive.summary.candidateCount === 0 && invalidAdaptive.summary.contactCount === 0, 'Adaptive path drop-cutter invalid cutter validation should stop before triangle projection');
  assert(invalidAdaptive.warnings.length === 1 && invalidAdaptive.warnings[0].includes('diameter'), 'Adaptive path drop-cutter invalid cutter feedback should not be duplicated per sample');
  assert(invalidAdaptiveProgress.length === 0, 'Adaptive path drop-cutter should not emit projection progress after invalid cutter validation fails');

  const invalidAdaptiveSpacingProgress: string[] = [];
  const invalidAdaptiveSpacing = await adaptivePathDropCutter({
    paths: [{
      id: 'invalid-adaptive-spacing',
      spans: [{ kind: 'line', id: 'invalid-adaptive-spacing-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 2,
    minSampleSpacing: Number.NaN,
    flatnessCosLimit: 0.999,
    floorZ: -5,
    onProgress: (event) => invalidAdaptiveSpacingProgress.push(event.phase),
  });
  assert(invalidAdaptiveSpacing.paths.length === 0, 'Adaptive path drop-cutter should not generate paths with invalid adaptive sample spacing');
  assert(invalidAdaptiveSpacing.summary.sampleCount === 0 && invalidAdaptiveSpacing.summary.subdivisionCount === 0, 'Adaptive path drop-cutter should fail invalid adaptive spacing before source sampling or subdivision');
  assert(invalidAdaptiveSpacing.warnings.length === 1 && invalidAdaptiveSpacing.warnings[0].includes('minSampleSpacing'), 'Adaptive path drop-cutter should report invalid minSampleSpacing instead of silently clamping it');
  assert(invalidAdaptiveSpacingProgress.length === 0, 'Adaptive path drop-cutter should not emit projection progress after invalid adaptive spacing validation fails');

  const emptyMeshAdaptiveProgress: string[] = [];
  const emptyMeshAdaptive = await adaptivePathDropCutter({
    paths: [{
      id: 'empty-adaptive',
      spans: [{ kind: 'line', id: 'empty-adaptive-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: [],
    sampleSpacing: 2,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.999,
    floorZ: -5,
    onProgress: (event) => emptyMeshAdaptiveProgress.push(event.phase),
  });
  assert(emptyMeshAdaptive.paths.length === 0, 'Adaptive path drop-cutter should not fabricate floor-Z paths when no target mesh triangles are supplied');
  assert(emptyMeshAdaptive.summary.sampleCount === 0 && emptyMeshAdaptive.summary.subdivisionCount === 0, 'Adaptive path drop-cutter should stop before sampling an empty target mesh');
  assert(emptyMeshAdaptive.warnings.some((warning) => warning.includes('No mesh triangles')), 'Adaptive path drop-cutter should report missing target mesh triangles');
  assert(emptyMeshAdaptiveProgress.length === 0, 'Adaptive path drop-cutter should not emit projection progress for an empty target mesh');

  const adaptivePlanar = await adaptivePathDropCutter({
    paths: [{
      id: 'planar',
      spans: [{ kind: 'line', id: 'planar-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.999,
    floorZ: -5,
  });
  assert(adaptivePlanar.paths[0].points.length === 2, 'Adaptive path drop-cutter should keep only endpoints on a flat path when spacing permits');

  const vSurface = [
    { id: 10, a: [-2, -1, 2], b: [0, -1, 0], c: [-2, 1, 2] },
    { id: 11, a: [0, -1, 0], b: [0, 1, 0], c: [-2, 1, 2] },
    { id: 12, a: [0, -1, 0], b: [2, -1, 2], c: [0, 1, 0] },
    { id: 13, a: [2, -1, 2], b: [2, 1, 2], c: [0, 1, 0] },
  ] as any[];
  const adaptiveStrict = await adaptivePathDropCutter({
    paths: [{
      id: 'v',
      spans: [{ kind: 'line', id: 'v-a', start: [-2, 0, 0], end: [2, 0, 0] }],
    }],
    cutter,
    triangles: vSurface,
    sampleSpacing: 100,
    minSampleSpacing: 0.1,
    flatnessCosLimit: 0.999,
    floorZ: -5,
  });
  const adaptiveRelaxed = await adaptivePathDropCutter({
    paths: [{
      id: 'v',
      spans: [{ kind: 'line', id: 'v-a', start: [-2, 0, 0], end: [2, 0, 0] }],
    }],
    cutter,
    triangles: vSurface,
    sampleSpacing: 100,
    minSampleSpacing: 0.1,
    flatnessCosLimit: -1,
    floorZ: -5,
  });
  assert(adaptiveStrict.paths[0].points.length > adaptiveRelaxed.paths[0].points.length, 'Stricter adaptive flatness should insert more projected samples on a kinked surface');
  assert((adaptiveStrict.summary.subdivisionCount || 0) > 0, 'Adaptive path drop-cutter should report subdivisions on non-flat projected paths');

  const adaptiveProgressPhases: string[] = [];
  let adaptiveYieldCount = 0;
  const adaptiveProgress = await adaptivePathDropCutter({
    paths: [{
      id: 'v-progress',
      spans: [{ kind: 'line', id: 'v-progress-a', start: [-2, 0, 0], end: [2, 0, 0] }],
    }],
    cutter,
    triangles: vSurface,
    sampleSpacing: 100,
    minSampleSpacing: 0.1,
    flatnessCosLimit: 0.999,
    floorZ: -5,
    chunkSize: 1,
    onProgress: (event) => adaptiveProgressPhases.push(event.phase),
    progressYield: () => { adaptiveYieldCount += 1; },
  });
  assert((adaptiveProgress.summary.subdivisionCount || 0) > 0, 'Adaptive path progress fixture should perform subdivisions');
  assert(adaptiveProgressPhases.includes('adaptive-path-index'), 'Adaptive path drop-cutter should report triangle index preparation before projection');
  assert(adaptiveProgressPhases.includes('adaptive-path-start'), 'Adaptive path drop-cutter should emit public projection-start progress');
  assert(adaptiveProgressPhases.includes('adaptive-path-subdivide'), 'Adaptive path drop-cutter should report subdivision progress during long spans');
  assert(adaptiveProgressPhases.includes('adaptive-path-drop'), 'Adaptive path drop-cutter should emit public point-drop progress during subdivision');
  assert(adaptiveProgressPhases.includes('adaptive-path-sample'), 'Adaptive path drop-cutter should emit public accepted-interval progress');
  assert(adaptiveProgressPhases.includes('adaptive-path-complete'), 'Adaptive path drop-cutter should emit public projection-complete progress');
  assert(adaptiveYieldCount > 3, 'Adaptive path drop-cutter should yield during subdivision chunks, not only after whole paths');

  const depthLimited = await adaptivePathDropCutter({
    paths: [{
      id: 'limited',
      spans: [{ kind: 'line', id: 'limited-a', start: [0, 1, 0], end: [10, 1, 0] }],
    }],
    cutter,
    triangles: horizontalPlane,
    sampleSpacing: 0.1,
    minSampleSpacing: 0.01,
    flatnessCosLimit: 0.999,
    maxDepth: 1,
    floorZ: -5,
  });
  assert(depthLimited.warnings.some((warning) => warning.includes('maxDepth')), 'Adaptive path drop-cutter should emit a deterministic maxDepth warning');
}

export async function test_cam_path_ordering_reorders_reverses_and_rotates_paths() {
  const paths = [
    { id: 'far', z: 0, feedRate: 1, plungeRate: 1, points: [[10, 0, 0], [11, 0, 0]] },
    { id: 'near-reverse', z: 0, feedRate: 1, plungeRate: 1, points: [[5, 0, 0], [3, 0, 0], [1, 0, 0]], segmentKinds: ['rapid', 'cut'] },
    { id: 'middle', z: 0, feedRate: 1, plungeRate: 1, points: [[6, 0, 0], [7, 0, 0]] },
  ] as any[];
  const ordered = orderCamToolpathPaths({ paths, startPosition: [0, 0, 5], allowReverse: true });
  assert(ordered.paths.map((path) => path.id).join('|') === 'near-reverse|middle|far', 'CAM path ordering should choose deterministic nearest-neighbor order');
  assert(ordered.paths[0].points[0][0] === 1 && ordered.reversedPathIds.includes('near-reverse'), 'CAM path ordering should reverse open paths when it reduces travel');
  assert(ordered.paths[0].segmentKinds?.join('|') === 'cut|rapid', 'CAM path ordering should reverse per-segment move metadata with reversed paths');
  assert(ordered.summary.travelAfter < ordered.summary.travelBefore, 'CAM path ordering should reduce non-cutting XY travel on a simple fixture');

  const noReverse = orderCamToolpathPaths({ paths, startPosition: [0, 0, 5], allowReverse: false });
  assert(noReverse.paths[0].id === 'near-reverse' && noReverse.paths[0].points[0][0] === 5, 'CAM path ordering should not reverse open paths when reversal is forbidden');
  assert(!noReverse.reversedPathIds.includes('near-reverse') && noReverse.summary.reversedCount === 0, 'CAM path ordering summary should report no reversed paths when reversal is forbidden');

  const tied = orderCamToolpathPaths({
    paths: [
      { id: 'A', z: 0, feedRate: 1, plungeRate: 1, points: [[1, 1, 0], [2, 1, 0]] },
      { id: 'B', z: 0, feedRate: 1, plungeRate: 1, points: [[1, -1, 0], [2, -1, 0]] },
    ] as any[],
    startPosition: [0, 0, 5],
    allowReverse: false,
  });
  assert(tied.paths.map((path) => path.id).join('|') === 'A|B', 'CAM path ordering should break equal-distance ties by original order');

  const closed = orderCamToolpathPaths({
    paths: [{
      id: 'loop',
      z: 0,
      feedRate: 1,
      plungeRate: 1,
      points: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0]],
      segmentKinds: ['cut', 'rapid', 'cut', 'cut'],
      closed: true,
    }] as any[],
    startPosition: [9, 9, 5],
  });
  assert(closed.paths[0].points[0][0] === 10 && closed.paths[0].points[0][1] === 10, 'CAM path ordering should rotate closed loops to the nearest vertex');
  assert(closed.paths[0].points[closed.paths[0].points.length - 1][0] === 10 && closed.paths[0].points[closed.paths[0].points.length - 1][1] === 10, 'Rotated CAM closed loop should remain closed');
  assert(closed.paths[0].segmentKinds?.join('|') === 'cut|cut|cut|rapid', 'CAM path ordering should rotate per-segment move metadata with closed loops');

  const closedCandidate = orderCamToolpathPaths({
    paths: [
      {
        id: 'loop-near-vertex',
        z: 0,
        feedRate: 1,
        plungeRate: 1,
        points: [[100, 0, 0], [1, 0, 0], [1, 1, 0], [100, 0, 0]],
        closed: true,
      },
      { id: 'open-near-start', z: 0, feedRate: 1, plungeRate: 1, points: [[5, 0, 0], [6, 0, 0]] },
    ] as any[],
    startPosition: [0, 0, 5],
  });
  assert(closedCandidate.paths[0].id === 'loop-near-vertex', 'CAM path ordering should score closed loops from their nearest rotatable start vertex');
  assert(closedCandidate.paths[0].points[0][0] === 1, 'CAM path ordering should rotate the selected closed-loop candidate to the scored vertex');

  const retractAware = orderCamToolpathPaths({
    paths: [
      { id: 'near-deep', z: -20, feedRate: 1, plungeRate: 1, points: [[1, 0, -20], [2, 0, -20]] },
      { id: 'far-level', z: 5, feedRate: 1, plungeRate: 1, points: [[10, 0, 5], [11, 0, 5]] },
    ] as any[],
    startPosition: [0, 0, 5],
    safeHeight: 5,
    linkMode: 'retract',
    allowReverse: false,
  });
  assert(retractAware.paths[0].id === 'far-level', 'CAM path ordering should include retract/plunge travel when ordering retract-linked paths');
  assert(retractAware.summary.travelAfter < retractAware.summary.travelBefore, 'CAM path ordering summary should include retract/plunge travel costs');
  const lowHopAware = orderCamToolpathPaths({
    paths: [
      { id: 'near-deep', z: -20, feedRate: 1, plungeRate: 1, points: [[1, 0, -20], [2, 0, -20]] },
      { id: 'far-level', z: 5, feedRate: 1, plungeRate: 1, points: [[10, 0, 5], [11, 0, 5]] },
    ] as any[],
    startPosition: [0, 0, 5],
    safeHeight: 5,
    linkMode: 'low-hop',
    allowReverse: false,
  });
  assert(lowHopAware.paths[0].id === 'near-deep', 'CAM path ordering should score low-hop links by XY travel instead of retract/plunge travel');

  const levelOrdered = orderCamToolpathPaths({
    paths: [
      { id: 'Z0-far', z: 0, feedRate: 1, plungeRate: 1, points: [[10, 0, 0], [11, 0, 0]] },
      { id: 'Z1-near', z: 1, feedRate: 1, plungeRate: 1, points: [[1, 0, 1], [2, 0, 1]] },
      { id: 'Z0-near', z: 0, feedRate: 1, plungeRate: 1, points: [[2, 0, 0], [3, 0, 0]] },
    ] as any[],
    startPosition: [0, 0, 5],
    preserveLevelOrder: true,
  });
  assert(levelOrdered.paths.map((path) => path.id).join('|') === 'Z0-near|Z0-far|Z1-near', 'CAM path ordering should optimize within each level while preserving first-seen Z-level order');

  const priorityOrdered = orderCamToolpathPaths({
    paths: [
      { id: 'finish-near', z: 0, orderingPriority: 1, feedRate: 1, plungeRate: 1, points: [[1, 0, 0], [2, 0, 0]] },
      { id: 'rough-far', z: 0, orderingPriority: 0, feedRate: 1, plungeRate: 1, points: [[10, 0, 0], [11, 0, 0]] },
      { id: 'rough-near', z: 0, orderingPriority: 0, feedRate: 1, plungeRate: 1, points: [[3, 0, 0], [4, 0, 0]] },
    ] as any[],
    startPosition: [0, 0, 5],
    preserveLevelOrder: true,
    allowReverse: false,
  });
  assert(priorityOrdered.paths.map((path) => path.id).join('|') === 'rough-near|rough-far|finish-near', 'CAM path ordering should optimize within a machining priority while preserving prerequisite priority order');

  const twoOptFixture = [
    { id: 'P0', z: 0, feedRate: 1, plungeRate: 1, points: [[8, 5, 0], [8, 5, 0]] },
    { id: 'P1', z: 0, feedRate: 1, plungeRate: 1, points: [[4, 1, 0], [4, 1, 0]] },
    { id: 'P2', z: 0, feedRate: 1, plungeRate: 1, points: [[6, 5, 0], [6, 5, 0]] },
    { id: 'P3', z: 0, feedRate: 1, plungeRate: 1, points: [[8, 3, 0], [8, 3, 0]] },
    { id: 'P4', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 6, 0], [0, 6, 0]] },
  ];
  const greedyOnly = orderCamToolpathPaths({
    paths: twoOptFixture as any[],
    startPosition: [0, 0, 5],
    allowReverse: false,
    enableTwoOpt: false,
  });
  const twoOptOrdered = orderCamToolpathPaths({
    paths: twoOptFixture as any[],
    startPosition: [0, 0, 5],
    allowReverse: false,
  });
  assert(greedyOnly.paths.map((path) => path.id).join('|') === 'P1|P2|P0|P3|P4', 'CAM greedy path ordering fixture should expose a deterministic nearest-neighbor baseline');
  assert(twoOptOrdered.paths.map((path) => path.id).join('|') === 'P1|P3|P0|P2|P4', 'CAM path ordering should run a bounded 2-opt pass to improve moderate same-level path groups');
  assert(twoOptOrdered.summary.twoOptImprovementCount > 0, 'CAM path ordering summary should report 2-opt improvements');
  assert(twoOptOrdered.summary.travelAfter < greedyOnly.summary.travelAfter, 'CAM 2-opt ordering should reduce travel beyond the greedy baseline');

  const invalid = orderCamToolpathPaths({
    paths: [
      { id: 'bad-path', z: 0, feedRate: 1, plungeRate: 1, points: [[Number.NaN, 0, 0], [1, 0, 0]] },
      { id: 'good-path', z: 0, feedRate: 1, plungeRate: 1, points: [[2, 0, 0], [3, 0, 0]] },
    ] as any[],
    startPosition: [0, 0, 5],
  });
  assert(invalid.paths.map((path) => path.id).join('|') === 'good-path', 'CAM path ordering should skip paths with non-finite cutter-location coordinates');
  assert(invalid.warnings.some((warning) => warning.includes('bad-path') && warning.includes('non-finite')), 'CAM path ordering should report skipped non-finite paths');
}

export async function test_cam_push_cutter_fiber_and_batch_intervals_are_deterministic() {
  const triangles = makeCamCubeTriangles(10) as any[];
  const cutter = createCamCutterProfile({ kind: 'flat', diameter: 1, cuttingLength: 12 });
  const xFiber = {
    id: 'XF',
    direction: 'x' as const,
    start: [-2, 5, 5] as any,
    end: [12, 5, 5] as any,
  };
  const xResult = pushCutterFiber({
    fiber: xFiber,
    cutter,
    triangles,
  });
  assert(xResult.fiber.intervals?.length === 1, 'X push-cutter fiber across a cube should produce one blocked interval');
  const xInterval = xResult.fiber.intervals![0];
  assert(nearlyEqual(xInterval.lowerT, 1.5 / 14, 1e-4), 'X push-cutter interval should expand the cube entry by cutter radius');
  assert(nearlyEqual(xInterval.upperT, 12.5 / 14, 1e-4), 'X push-cutter interval should expand the cube exit by cutter radius');

  const outside = pushCutterFiber({
    fiber: { id: 'OUT', direction: 'x', start: [-2, 20, 5] as any, end: [12, 20, 5] as any },
    cutter,
    triangles,
  });
  assert((outside.fiber.intervals || []).length === 0, 'Push-cutter fiber outside the cutter radius should return no blocked intervals');

  const nonFiniteFiber = pushCutterFiber({
    fiber: { id: 'BAD-POINT', direction: 'x', start: [Number.NaN, 5, 5] as any, end: [12, 5, 5] as any },
    cutter,
    triangles,
  });
  assert((nonFiniteFiber.fiber.intervals || []).length === 0, 'Push-cutter should not fabricate intervals from non-finite fiber coordinates');
  assert(nonFiniteFiber.candidateCount === 0 && nonFiniteFiber.intervalCount === 0, 'Push-cutter should reject non-finite fibers before index queries');
  assert(nonFiniteFiber.warnings.some((warning) => warning.includes('BAD-POINT') && warning.includes('finite start and end coordinates')), 'Push-cutter non-finite fiber warning should identify the bad fiber');

  const yResult = pushCutterFiber({
    fiber: { id: 'YF', direction: 'y', start: [5, -2, 5] as any, end: [5, 12, 5] as any },
    cutter,
    triangles,
  });
  assert(yResult.fiber.intervals?.length === 1, 'Y push-cutter fiber across a cube should produce one blocked interval');
  assert(nearlyEqual(yResult.fiber.intervals![0].lowerT, xInterval.lowerT, 1e-4), 'X and Y push-cutter intervals should be symmetric on a cube');

  const indexed = pushCutterFiber({
    fiber: xFiber,
    cutter,
    triangles,
    index: buildCamTriangleSpatialIndex(triangles),
  });
  assert(
    nearlyEqual(indexed.fiber.intervals![0].lowerT, xInterval.lowerT, 1e-6)
      && nearlyEqual(indexed.fiber.intervals![0].upperT, xInterval.upperT, 1e-6),
    'Indexed push-cutter fiber should match brute-force push-cutter output',
  );

  const vertexOnly = pushCutterFiber({
    fiber: { id: 'VERTEX', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: createCamCutterProfile({ kind: 'flat', diameter: 2, cuttingLength: 5 }),
    triangles: [{ id: 99, a: [5, 0, 1], b: [5, 2, 1], c: [5, 0, 2] }] as any[],
  });
  assert((vertexOnly.fiber.intervals || []).length === 1, 'Push-cutter vertex contact should create a finite blocked interval');

  const horizontalEdge = pushCutterFiber({
    fiber: { id: 'HEDGE', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: createCamCutterProfile({ kind: 'flat', diameter: 4, cuttingLength: 5 }),
    triangles: [{ id: 101, a: [5, -1, 1], b: [5, 1, 1], c: [6, 0, 3] }] as any[],
  });
  const edgeInterval = horizontalEdge.fiber.intervals?.[0];
  assert(edgeInterval && edgeInterval.lowerT <= 0.3001 && edgeInterval.upperT >= 0.6999, 'Push-cutter horizontal edge contact should use the effective cutter radius along the whole edge');
  assert(edgeInterval.lowerContact === 'edge' || edgeInterval.upperContact === 'edge', 'Push-cutter horizontal edge interval should retain edge contact metadata');

  const shaftEdge = pushCutterFiber({
    fiber: { id: 'SHAFT-EDGE', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: createCamCutterProfile({ kind: 'flat', diameter: 4, cuttingLength: 1, shaftLength: 4 }),
    triangles: [{ id: 102, a: [5, -1, 3], b: [5, 1, 3], c: [6, 0, 4] }] as any[],
  });
  const shaftInterval = shaftEdge.fiber.intervals?.[0];
  assert(shaftInterval && shaftInterval.lowerT <= 0.3001 && shaftInterval.upperT >= 0.6999, 'Push-cutter query bounds should include shaft-length edge contacts');
  assert(shaftInterval.lowerContact === 'shaft' || shaftInterval.upperContact === 'shaft', 'Push-cutter shaft-height edge contacts should retain shaft metadata');

  const coneCutter = createCamCutterProfile({ kind: 'cone', maximumDiameter: 4, includedAngle: 90, cuttingLength: 5 });
  const coneRadiusAtHeight = cutterValue(coneCutter.radiusAtHeight(1), 'Cone push-cutter test should evaluate profile radius');
  const coneVertex = pushCutterFiber({
    fiber: { id: 'CONE-VERTEX', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: coneCutter,
    triangles: [{ id: 103, a: [5, 0, 1], b: [5, 3, 1], c: [6, 3, 2] }] as any[],
  });
  const coneInterval = coneVertex.fiber.intervals?.[0];
  assert(
    coneInterval
      && nearlyEqual(coneInterval.lowerT, (5 - coneRadiusAtHeight) / 10, 1e-4)
      && nearlyEqual(coneInterval.upperT, (5 + coneRadiusAtHeight) / 10, 1e-4),
    'Push-cutter cone contact should use the selected cone radius at vertex height',
  );

  const ballConeCutter = createCamCutterProfile({ kind: 'ball-cone', ballDiameter: 2, maximumDiameter: 4, includedAngle: 90, cuttingLength: 5 });
  const ballConeRadiusAtHeight = cutterValue(ballConeCutter.radiusAtHeight(0.5), 'Ball-cone push-cutter test should evaluate profile radius');
  const ballConeVertex = pushCutterFiber({
    fiber: { id: 'BALL-CONE-VERTEX', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: ballConeCutter,
    triangles: [{ id: 104, a: [5, 0, 0.5], b: [5, 3, 0.5], c: [6, 3, 1] }] as any[],
  });
  const ballConeInterval = ballConeVertex.fiber.intervals?.[0];
  assert(
    ballConeInterval
      && nearlyEqual(ballConeInterval.lowerT, (5 - ballConeRadiusAtHeight) / 10, 1e-4)
      && nearlyEqual(ballConeInterval.upperT, (5 + ballConeRadiusAtHeight) / 10, 1e-4),
    'Push-cutter ball-cone contact should use the selected compound profile radius at vertex height',
  );

  const coneShaft = pushCutterFiber({
    fiber: { id: 'CONE-SHAFT', direction: 'x', start: [0, 0, 0] as any, end: [10, 0, 0] as any },
    cutter: createCamCutterProfile({ kind: 'cone', maximumDiameter: 4, includedAngle: 90, cuttingLength: 2, shaftLength: 3 }),
    triangles: [{ id: 105, a: [5, -1, 4], b: [5, 1, 4], c: [6, 0, 4.5] }] as any[],
  });
  const coneShaftInterval = coneShaft.fiber.intervals?.[0];
  assert(coneShaftInterval && coneShaftInterval.lowerT <= 0.3001 && coneShaftInterval.upperT >= 0.6999, 'Push-cutter cone query bounds should include shaft-height contacts');
  assert(coneShaftInterval.lowerContact === 'shaft' || coneShaftInterval.upperContact === 'shaft', 'Push-cutter cone shaft-height contacts should retain shaft metadata');

  const horizontalOnly = pushCutterFiber({
    fiber: { id: 'HORIZONTAL', direction: 'x', start: [-2, 2, 0] as any, end: [12, 2, 0] as any },
    cutter,
    triangles: [{ id: 100, a: [0, 0, 0], b: [10, 0, 0], c: [0, 10, 0] }] as any[],
  });
  assert((horizontalOnly.fiber.intervals || []).length === 0, 'Push-cutter should ignore horizontal facets as non-boundary contacts');

  const progress: string[] = [];
  let yieldCount = 0;
  const batch = await pushCutterBatch({
    fibers: [
      xFiber,
      { id: 'XF2', direction: 'x', start: [-2, 2, 5] as any, end: [12, 2, 5] as any },
      { id: 'OUT2', direction: 'x', start: [-2, 20, 5] as any, end: [12, 20, 5] as any },
    ],
    direction: 'x',
    cutter,
    triangles,
    chunkSize: 2,
    onProgress: (event) => progress.push(event.phase),
    progressYield: () => { yieldCount += 1; },
  });
  assert(batch.fibers.map((fiber) => fiber.id).join('|') === 'XF|XF2|OUT2', 'Batch push-cutter should preserve fiber order');
  assert(batch.summary.intervalCount === 2, 'Batch push-cutter should summarize blocked intervals across fibers');
  assert(progress.includes('batch-push-index') && progress.filter((phase) => phase === 'batch-push-fibers').length === 2, 'Batch push-cutter should emit generic index and chunk progress phases');
  assert(progress.includes('batch-push-index-x') && progress.filter((phase) => phase === 'batch-push-fibers-x').length === 2, 'Batch push-cutter should emit index and chunk progress');
  assert(progress.includes('push-index-x') && progress.filter((phase) => phase === 'push-fibers-x').length === 2, 'Batch push-cutter should also emit spec-named direction progress phases');
  assert(progress.includes('push-complete'), 'Batch push-cutter should emit the spec-named completion progress phase');
  assert(yieldCount >= 4, 'Batch push-cutter should yield at preparation and chunk boundaries');

  const fallbackBatch = await pushCutterBatch({
    fibers: [xFiber],
    direction: 'x',
    cutter,
    triangles,
    indexOptions: { bucketSize: 0 },
  });
  assert(
    nearlyEqual(fallbackBatch.fibers[0].intervals![0].lowerT, xInterval.lowerT, 1e-6)
      && nearlyEqual(fallbackBatch.fibers[0].intervals![0].upperT, xInterval.upperT, 1e-6),
    'Batch push-cutter brute-force fallback should match indexed fiber intervals on small meshes',
  );
  assert(
    fallbackBatch.warnings.some((warning) => warning.includes('Triangle spatial index build failed') && warning.includes('brute-force')),
    'Batch push-cutter should warn when falling back to brute-force triangle queries',
  );

  const invalidBatchProgress: string[] = [];
  const invalidBatch = await pushCutterBatch({
    fibers: [xFiber],
    direction: 'x',
    cutter: { kind: 'flat', diameter: 0, cuttingLength: 12 },
    triangles,
    onProgress: (event) => invalidBatchProgress.push(event.phase),
  });
  assert(invalidBatch.fibers.length === 0, 'Batch push-cutter should not return pushed fibers with an invalid cutter');
  assert(invalidBatch.summary.fiberCount === 1, 'Batch push-cutter invalid cutter summary should preserve requested fiber count');
  assert(invalidBatch.summary.intervalCount === 0 && invalidBatch.summary.candidateCount === 0, 'Batch push-cutter should fail invalid cutters before index queries');
  assert(invalidBatch.warnings.length === 1 && invalidBatch.warnings[0].includes('diameter'), 'Batch push-cutter invalid cutter feedback should not be duplicated per fiber');
  assert(invalidBatchProgress.length === 0, 'Batch push-cutter should not emit progress after invalid cutter validation fails');

  let mismatchedBatchError: any = null;
  try {
    await pushCutterBatch({
      fibers: [
        { id: 'BAD-DIRECTION', direction: 'y', start: [5, -2, 5] as any, end: [5, 12, 5] as any },
      ],
      direction: 'x',
      cutter,
      triangles,
    });
  } catch (error) {
    mismatchedBatchError = error;
  }
  assert(mismatchedBatchError instanceof Error, 'Batch push-cutter should reject fibers that do not match the batch direction');
  assert(String(mismatchedBatchError.message || '').includes('BAD-DIRECTION') && String(mismatchedBatchError.message || '').includes('batch direction x'), 'Batch push-cutter direction errors should identify the mismatched fiber and requested direction');

  let missingDirectionError: any = null;
  try {
    await pushCutterBatch({
      fibers: [],
      direction: undefined as any,
      cutter,
      triangles,
    });
  } catch (error) {
    missingDirectionError = error;
  }
  assert(missingDirectionError instanceof Error, 'Batch push-cutter should reject a missing batch direction even when no fibers are queued');
  assert(String(missingDirectionError.message || '').includes('direction must be "x" or "y"'), 'Batch push-cutter missing direction errors should describe the expected direction values');

  const empty = await pushCutterBatch({
    fibers: [],
    direction: 'x',
    cutter,
    triangles,
  });
  assert(empty.fibers.length === 0 && empty.summary.fiberCount === 0, 'Empty batch push-cutter input should succeed');
}

export async function test_cam_weave_reconstructs_square_loop_and_reports_open_graphs() {
  const xFibers = [
    { id: 'x0', direction: 'x' as const, start: [0, 0, 0] as any, end: [10, 0, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
    { id: 'x1', direction: 'x' as const, start: [0, 10, 0] as any, end: [10, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
  ];
  const yFibers = [
    { id: 'y0', direction: 'y' as const, start: [0, 0, 0] as any, end: [0, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
    { id: 'y1', direction: 'y' as const, start: [10, 0, 0] as any, end: [10, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
  ];
  const weave = reconstructWeaveLoops({ xFibers, yFibers, z: 0 });
  assert(weave.loops.length === 1, 'Weave reconstruction should produce one loop from square boundary fibers');
  assert(weave.loops[0].map((point) => `${point[0]},${point[1]}`).join('|') === '0,0|10,0|10,10|0,10|0,0', 'Weave square loop should be closed and ordered deterministically');
  assert(weave.graphStats.clVertexCount === 8 && weave.graphStats.intersectionVertexCount === 4, 'Weave graph stats should count interval endpoints and crossings');

  const shuffled = reconstructWeaveLoops({ xFibers: xFibers.slice().reverse(), yFibers: yFibers.slice().reverse(), z: 0 });
  assert(JSON.stringify(shuffled.loops) === JSON.stringify(weave.loops), 'Weave reconstruction should be deterministic for shuffled fibers');

  const duplicate = reconstructWeaveLoops({
    xFibers: [
      { ...xFibers[0], intervals: [{ lowerT: 0, upperT: 1 }, { lowerT: 0, upperT: 1 }] },
      xFibers[1],
    ],
    yFibers,
    z: 0,
  });
  assert(duplicate.loops.length === 1, 'Weave reconstruction should tolerate duplicate interval endpoints');

  const ringX = [
    { id: 'rx0', direction: 'x' as const, start: [0, 0, 0] as any, end: [10, 0, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
    { id: 'rx5', direction: 'x' as const, start: [0, 5, 0] as any, end: [10, 5, 0] as any, intervals: [{ lowerT: 0, upperT: 0.3 }, { lowerT: 0.7, upperT: 1 }] },
    { id: 'rx10', direction: 'x' as const, start: [0, 10, 0] as any, end: [10, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
  ];
  const ringY = [
    { id: 'ry0', direction: 'y' as const, start: [0, 0, 0] as any, end: [0, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
    { id: 'ry5', direction: 'y' as const, start: [5, 0, 0] as any, end: [5, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 0.3 }, { lowerT: 0.7, upperT: 1 }] },
    { id: 'ry10', direction: 'y' as const, start: [10, 0, 0] as any, end: [10, 10, 0] as any, intervals: [{ lowerT: 0, upperT: 1 }] },
  ];
  const ring = reconstructWeaveLoops({ xFibers: ringX, yFibers: ringY, z: 0 });
  assert(ring.loops.length === 2, 'Weave reconstruction should produce outer and inner loops for a block with a hole');
  assert(ring.loops[0].map((point) => `${point[0]},${point[1]}`).join('|') === '0,0|10,0|10,10|0,10|0,0', 'Weave ring outer loop should match the outer occupied boundary');
  assert(ring.loops[1].map((point) => `${point[0]},${point[1]}`).join('|') === '3,3|3,7|7,7|7,3|3,3', 'Weave ring inner loop should match the hole boundary deterministically');

  const open = reconstructWeaveLoops({ xFibers, yFibers: [], z: 0 });
  assert(open.loops.length === 0 && open.warnings.some((warning) => warning.includes('both X and Y')), 'Weave reconstruction should report open or incomplete interval graphs');
}

export async function test_cam_weave_async_yields_during_dense_reconstruction() {
  const size = 20;
  const xFibers = Array.from({ length: size + 1 }, (_value, index) => ({
    id: `ax${index}`,
    direction: 'x' as const,
    start: [0, index, 0] as any,
    end: [size, index, 0] as any,
    intervals: [{ lowerT: 0, upperT: 1 }],
  }));
  const yFibers = Array.from({ length: size + 1 }, (_value, index) => ({
    id: `ay${index}`,
    direction: 'y' as const,
    start: [index, 0, 0] as any,
    end: [index, size, 0] as any,
    intervals: [{ lowerT: 0, upperT: 1 }],
  }));
  const input = { xFibers, yFibers, z: 0 };
  const sync = reconstructWeaveLoops(input);
  const progressPhases: string[] = [];
  let yieldCount = 0;
  const asyncResult = await reconstructWeaveLoopsAsync(input, {
    chunkSize: 17,
    onProgress: (event) => progressPhases.push(event.phase),
    progressYield: async () => { yieldCount += 1; },
  });

  assert(JSON.stringify(asyncResult.loops) === JSON.stringify(sync.loops), 'Async weave reconstruction should match sync deterministic loop output');
  for (const phase of ['weave-spans', 'weave-intersections', 'weave-cells', 'weave-edges', 'weave-trace']) {
    assert(progressPhases.includes(phase), `Async weave reconstruction should report ${phase}`);
  }
  assert(yieldCount >= 5, 'Async weave reconstruction should yield through intersections, cell classification, edge construction, and tracing');
}

export async function test_cam_path_spans_sample_lines_arcs_and_reject_degenerate_input() {
  const line = createCamLineSpan([0, 0, 0], [4, 0, 2], { id: 'L1' });
  const lineMid = line.pointAt(0.5);
  assert(line.kind === 'line', 'CAM line span should expose line kind');
  assert(nearlyEqual(line.length2d(), 4), 'CAM line span should report XY length');
  assert(lineMid[0] === 2 && lineMid[1] === 0 && lineMid[2] === 1, 'CAM line span midpoint should linearly interpolate XYZ');
  assert(pointsNearlyEqual(line.pointAt(-1), line.start), 'CAM line span pointAt should clamp t below 0 to the full start point');
  assert(pointsNearlyEqual(line.pointAt(2), line.end), 'CAM line span pointAt should clamp t above 1 to the full end point');

  const ccw = createCamArcSpan([1, 0, 0], [0, 1, 2], [0, 0, 0], false, { id: 'A_CCW' });
  const ccwMid = ccw.pointAt(0.5);
  assert(ccw.kind === 'arc' && ccw.clockwise === false, 'CAM arc span should expose arc kind and direction');
  assert(nearlyEqual(ccw.radius, 1), 'CAM arc span should compute radius');
  assert(nearlyEqual(ccw.sweepRadians, Math.PI / 2), 'Counterclockwise CAM arc should use a positive quarter-turn sweep');
  assert(nearlyEqual(ccw.length2d(), Math.PI / 2), 'CAM arc span should report arc length');
  assert(nearlyEqual(Math.hypot(ccwMid[0], ccwMid[1]), 1), 'CAM arc midpoint should stay on the circle');
  assert(nearlyEqual(ccwMid[0], Math.SQRT1_2) && nearlyEqual(ccwMid[1], Math.SQRT1_2) && nearlyEqual(ccwMid[2], 1), 'CAM counterclockwise arc midpoint should follow the expected sweep and Z interpolation');
  assert(pointsNearlyEqual(ccw.pointAt(-0.25), ccw.start), 'CAM arc span pointAt should clamp t below 0 to the start point');
  assert(pointsNearlyEqual(ccw.pointAt(1.25), ccw.end), 'CAM arc span pointAt should clamp t above 1 to the end point');

  const cw = createCamArcSpan([1, 0, 0], [0, -1, 0], [0, 0, 0], true, { id: 'A_CW' });
  const cwMid = cw.pointAt(0.5);
  assert(nearlyEqual(cw.sweepRadians, -Math.PI / 2), 'Clockwise CAM arc should use a negative quarter-turn sweep');
  assert(nearlyEqual(cwMid[0], Math.SQRT1_2) && nearlyEqual(cwMid[1], -Math.SQRT1_2), 'CAM clockwise arc midpoint should follow the expected direction');

  const restored = createCamPathSpan(ccw.toSerializable(), 'RESTORED');
  assert(restored.kind === 'arc' && restored.id === 'A_CCW', 'Serialized CAM arc span should restore as an arc with its id');
  assert(nearlyEqual(restored.length2d(), ccw.length2d()), 'Serialized CAM arc span should preserve arc length');

  const sampled = sampleCamPathSpans([
    createCamLineSpan([0, 0, 0], [2, 0, 0], { id: 'S1' }),
    createCamLineSpan([2, 0, 0], [2, 2, 0], { id: 'S2' }),
  ], 1);
  assert(sampled.points.length === 5, 'CAM span sampling should include endpoints without duplicating shared span endpoints');
  assert(sampled.spanIds.join('|') === 'S1|S1|S1|S2|S2', 'CAM span sampling should keep source span ids aligned with emitted points');
  assert(sampled.points[2][0] === 2 && sampled.points[2][1] === 0, 'CAM span sampling should keep the shared endpoint once');

  assertThrows(() => sampleCamPathSpans([line], Number.NaN), 'CAM span sampling should reject non-finite sample spacing');
  assertThrows(() => sampleCamPathSpans([line], 0), 'CAM span sampling should reject non-positive sample spacing');
  assertThrows(() => sampleCamPathSpans([{
    id: 'BAD_SAMPLE',
    kind: 'line',
    start: [0, 0, 0],
    end: [1, 0, 0],
    length2d: () => 1,
    pointAt: () => [0, Number.NaN, 0],
    toSerializable: () => ({ kind: 'line', id: 'BAD_SAMPLE', start: [0, 0, 0], end: [1, 0, 0] }),
  } as any], 1), 'CAM span sampling should reject non-finite sampled coordinates instead of fabricating points');

  assertThrows(() => createCamLineSpan([0, 0, 0], [0, 0, 0]), 'CAM line span should reject degenerate input');
  assertThrows(() => createCamArcSpan([1, 0, 0], [1, 0, 0], [0, 0, 0]), 'CAM arc span should reject near-zero sweep input');
  assertThrows(() => createCamArcSpan([1, 0, 0], [0, 2, 0], [0, 0, 0]), 'CAM arc span should reject mismatched start/end radii');
}

export async function test_cam_triangle_spatial_index_queries_projection_modes_and_matches_bruteforce() {
  const triangles = [
    { id: 1, a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] },
    { id: 2, a: [0, 5, 5], b: [1, 5, 6], c: [0, 6, 5] },
    { id: 3, a: [5, 0, 5], b: [6, 0, 6], c: [5, 1, 5] },
    { id: 4, a: [0.25, 0.25, 5.25], b: [0.75, 0.25, 5.25], c: [0.25, 0.75, 5.75] },
  ] as any[];
  const index = buildCamTriangleSpatialIndex(triangles, { bucketSize: 1 });
  const stats = index.stats();
  assert(stats.triangleCount === 4, 'CAM triangle index should report indexed triangle count');
  assert(stats.implementation === 'cam-aabb-tree', 'CAM triangle index should report its implementation');
  assert((stats.nodeCount || 0) >= 1 && (stats.leafCount || 0) >= 1, 'CAM triangle index should report tree stats');

  const projectedQuery = { min: [0.5, 0.5, 5.5], max: [0.75, 0.75, 5.75] } as any;
  assert(index.queryAabb(projectedQuery, 'xy').join('|') === '1|4', 'CAM triangle index XY projection should ignore Z but honor X/Y overlap');
  assert(index.queryAabb(projectedQuery, 'xz').join('|') === '2|4', 'CAM triangle index XZ projection should ignore Y but honor X/Z overlap');
  assert(index.queryAabb(projectedQuery, 'yz').join('|') === '3|4', 'CAM triangle index YZ projection should ignore X but honor Y/Z overlap');
  assert(index.queryAabb(projectedQuery, 'xyz').join('|') === '4', 'CAM triangle index XYZ projection should require full 3D overlap');

  const touching = index.queryAabb({ min: [1, 1, 0], max: [1, 1, 0] } as any, 'xyz');
  assert(touching.includes(1), 'CAM triangle index should include triangles touching query boundaries');
  assert(index.queryAabb({ min: [20, 20, 20], max: [21, 21, 21] } as any, 'xyz').length === 0, 'CAM triangle index should exclude obvious non-overlaps');

  const empty = buildCamTriangleSpatialIndex([]);
  assert(empty.stats().triangleCount === 0, 'Empty CAM triangle index should report zero triangles');
  assert(empty.queryAabb(projectedQuery, 'xyz').length === 0, 'Empty CAM triangle index should return no query candidates');

  const randomTriangles: any[] = [];
  for (let id = 0; id < 30; id += 1) {
    const x = (id * 37) % 11;
    const y = (id * 17) % 13;
    const z = (id * 19) % 7;
    randomTriangles.push({
      id,
      a: [x, y, z],
      b: [x + 0.6 + (id % 3) * 0.1, y + 0.1, z + 0.2],
      c: [x + 0.2, y + 0.5 + (id % 4) * 0.1, z + 0.7],
    });
  }
  const randomIndex = buildCamTriangleSpatialIndex(randomTriangles, { bucketSize: 3, maxDepth: 16 });
  const modes = ['xy', 'xz', 'yz', 'xyz'] as const;
  for (let queryIndex = 0; queryIndex < 12; queryIndex += 1) {
    const query = {
      min: [(queryIndex * 3) % 10, (queryIndex * 5) % 12, (queryIndex * 7) % 6],
      max: [((queryIndex * 3) % 10) + 1.2, ((queryIndex * 5) % 12) + 1.4, ((queryIndex * 7) % 6) + 1.1],
    } as any;
    for (const mode of modes) {
      const indexed = randomIndex.queryAabb(query, mode).join('|');
      const brute = queryCamTriangleAabbBruteForce(randomTriangles, query, mode).join('|');
      assert(indexed === brute, `CAM triangle index ${mode} query should match brute force candidates`);
    }
  }

  const shuffled = [...randomTriangles].reverse();
  const shuffledIndex = buildCamTriangleSpatialIndex(shuffled, { bucketSize: 3, maxDepth: 16 });
  const fullQuery = { min: [-1, -1, -1], max: [20, 20, 20] } as any;
  assert(
    shuffledIndex.queryAabb(fullQuery, 'xyz').join('|') === randomIndex.queryAabb(fullQuery, 'xyz').join('|'),
    'CAM triangle index should produce deterministic query ids for shuffled input with stable ids',
  );
  assert(shuffledIndex.stats().nodeCount === randomIndex.stats().nodeCount, 'CAM triangle index tree shape should be deterministic for shuffled stable ids');

  const fallback = buildCamTriangleSpatialIndexWithFallback(triangles, { bucketSize: 0, smallMeshFallbackLimit: 4 });
  assert(fallback.index === null, 'CAM triangle index safe builder should use brute-force fallback for small index build failures');
  assert(fallback.warnings.some((warning) => warning.includes('brute-force triangle queries')), 'CAM triangle index fallback should include a clear warning');
  assertThrowsWithMessage(
    () => buildCamTriangleSpatialIndexWithFallback(triangles, { bucketSize: 0, smallMeshFallbackLimit: 0 }),
    'Triangle spatial index build failed for 4 triangles',
    'CAM triangle index safe builder should fail loudly instead of brute-forcing larger meshes',
  );
}

export async function test_cam_line_filter_reduces_collinear_points_preserves_boundaries() {
  const collinear = filterCamPathPoints([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ], { tolerance: 0.001 });
  assert(collinear.points.length === 2, 'CAM line filter should reduce collinear cutter-location points to endpoints');
  assert(collinear.sourceIndices.join('|') === '0|4', 'CAM line filter should report source endpoint indices after collinear reduction');

  const kinked = filterCamPathPoints([
    [0, 0, 0],
    [1, 0.2, 0],
    [2, 0, 0],
  ], { tolerance: 0.05 });
  assert(kinked.points.length === 3, 'CAM line filter should preserve a point farther than tolerance from the chord');

  const preserved = filterCamPathPoints([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ], { tolerance: 0.001, preserveIndices: [2] });
  assert(preserved.sourceIndices.join('|') === '0|2|3', 'CAM line filter should retain explicitly preserved midpoint indices');

  const moveBoundary = filterCamPathPoints([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
  ], { tolerance: 0.001, segmentKinds: ['cut', 'cut', 'link', 'link'] });
  assert(moveBoundary.sourceIndices.join('|') === '0|2|4', 'CAM line filter should preserve cut/link move boundary points');
  assert(moveBoundary.segmentKinds?.join('|') === 'cut|link', 'CAM line filter should retain non-cutting link move kinds after boundary-preserving simplification');

  const closed = filterCamPathPoints([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
  ], { tolerance: 0.001, closed: true });
  const first = closed.points[0];
  const last = closed.points[closed.points.length - 1];
  assert(first[0] === last[0] && first[1] === last[1] && first[2] === last[2], 'CAM line filter should keep closed loops closed');
  assert(closed.points.length === 5, 'CAM line filter should simplify closed loop edges without opening the loop');

  const pathResult = filterCamToolpathPaths([
    { id: 'A', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    { id: 'B', z: 0, feedRate: 1, plungeRate: 1, points: [[10, 0, 0], [11, 0, 0], [12, 0, 0]] },
  ], { tolerance: 0.001 });
  assert(pathResult.paths.length === 2, 'CAM line filter should preserve path boundaries');
  assert(pathResult.paths.every((path) => path.points.length === 2), 'CAM line filter should filter separate paths independently');
  assert(pathResult.paths.every((path) => path.simulationSamples?.length === 3), 'CAM line filter should preserve pre-filter samples for simulation slider snapping by default');
  assert(pathResult.removedCount === 2, 'CAM line filter should report total removed points across paths');

  const kindedPathResult = filterCamToolpathPaths([
    { id: 'C', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]], segmentKinds: ['cut', 'cut', 'link', 'link'] },
  ], { tolerance: 0.001 });
  assert(kindedPathResult.paths[0].points.length === 3, 'CAM line filter should retain toolpath points needed for move kind boundaries');
  assert(kindedPathResult.paths[0].segmentKinds?.join('|') === 'cut|link', 'CAM line filter should preserve toolpath link move kind metadata when filtering paths');

  const disabledPathResult = filterCamToolpathPaths([
    { id: 'D', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
  ], { tolerance: 0.001, enableLineFilter: false });
  assert(disabledPathResult.paths[0].points.length === 4, 'CAM line filter should honor enableLineFilter=false even when a tolerance is provided');
  assert(disabledPathResult.removedCount === 0, 'Disabled CAM line filter should not report removed cutter-location points');

  const compactSimulationPathResult = filterCamToolpathPaths([
    { id: 'E', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
  ], { tolerance: 0.001, preserveSimulationSamples: false });
  assert(compactSimulationPathResult.paths[0].points.length === 2, 'CAM line filter should still simplify paths when simulation sample preservation is disabled');
  assert(!compactSimulationPathResult.paths[0].simulationSamples, 'CAM line filter should allow explicit compact simulation sample output');

  const invalidPoints = filterCamPathPoints([
    [0, 0, 0],
    [Number.NaN, 1, 0],
    [2, 0, 0],
  ] as any, { tolerance: 0.001, enableLineFilter: false });
  assert(invalidPoints.points.length === 0, 'CAM line filter should reject non-finite cutter-location input even when simplification is disabled');
  assert(invalidPoints.invalidPointCount === 1, 'CAM line filter should count rejected non-finite cutter-location points');
  assert(invalidPoints.warnings.some((warning) => warning.includes('non-finite')), 'CAM line filter should report non-finite cutter-location input');

  const invalidPathResult = filterCamToolpathPaths([
    { id: 'bad-filter-path', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [Infinity, 1, 0], [2, 0, 0]] },
    { id: 'good-filter-path', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 1, 0], [1, 1, 0], [2, 1, 0]] },
  ] as any, { tolerance: 0.001 });
  assert(invalidPathResult.paths.map((path) => path.id).join('|') === 'good-filter-path', 'CAM line filter should drop paths with non-finite cutter locations instead of fabricating coordinates');
  assert(invalidPathResult.warnings.some((warning) => warning.includes('bad-filter-path') && warning.includes('non-finite')), 'CAM line filter should report rejected non-finite paths');
}

export async function test_cam_three_axis_raster_generates_gcode_from_cube_mesh() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM1',
    name: 'Cube Roughing',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    feedRate: 100,
    plungeRate: 50,
    spindleRPM: 1000,
  });

  assert(result.summary.targetCount === 1, 'CAM should target the cube solid');
  assert(result.summary.triangleCount === 12, 'CAM should read cube triangles');
  assert(result.paths.length > 0, 'CAM should generate raster paths');
  assert(result.simulation.sweptSegments.length === result.summary.sweptSegmentCount, 'CAM should summarize swept cutter segments');
  assert(result.simulation.sweptSegments.length > 0, 'CAM should generate swept cutter segment hulls');
  assert(
    result.simulation.sweptSegments.some((segment) => (
      Math.abs(segment.start[0] - segment.end[0]) <= 1e-6
      && Math.abs(segment.start[1] - segment.end[1]) <= 1e-6
      && Math.max(segment.start[2], segment.end[2]) > (result.bounds?.max[2] || 0) - 1e-6
      && Math.min(segment.start[2], segment.end[2]) < (result.bounds?.max[2] || 0) - 1e-6
    )),
    'CAM swept cutter segment hulls should include plunge cutting movement into the stock',
  );
  assert(result.simulation.motionPolyline.length > result.paths.length, 'CAM should persist the actual cutter-center motion polyline');
  assert(result.simulation.motionSegments.some((segment) => segment.kind === 'rapid'), 'CAM motion polyline should include rapid moves');
  assert(result.simulation.motionSegments.some((segment) => segment.kind === 'plunge'), 'CAM motion polyline should include plunge moves');
  assert(result.simulation.motionSegments.some((segment) => segment.kind === 'cut'), 'CAM motion polyline should include cut moves');
  assert(result.simulation.motionSegments.length === result.summary.motionSegmentCount, 'CAM should summarize actual motion segments');
  assert(result.summary.estimatedRapidLength > 0, 'CAM should summarize rapid and retract travel length');
  assert(nearlyEqual(
    result.summary.estimatedRapidLength,
    rapidRetractLengthFromMotionSegments(result.simulation.motionSegments),
    1e-5,
  ), 'CAM rapid length summary should match actual rapid and retract motion segments');
  const pathIds = new Set(result.paths.map((path) => path.id));
  const firstMotion = result.simulation.motionSegments[0] as any;
  const programSafeZ = Math.max(result.safeZ, result.machine.safeParkZ);
  assert(firstMotion.kind === 'rapid', 'CAM simulation should include the initial rapid move to the first toolpath');
  assert(pointsNearlyEqual(firstMotion.start, [0, 0, programSafeZ]), 'CAM initial rapid should start from the safe program origin');
  assert(pointsNearlyEqual(firstMotion.end, [result.paths[0].points[0][0], result.paths[0].points[0][1], programSafeZ]), 'CAM initial rapid should end above the first toolpath point');
  assert(firstMotion.sourcePathId === result.paths[0].id, 'CAM initial rapid should retain the first toolpath id');
  assert(result.simulation.motionSegments.every((segment: any) => Number(segment.feedRate) > 0), 'CAM motion segments should include explicit feed-rate metadata');
  assert(result.simulation.motionSegments.every((segment: any) => pathIds.has(segment.sourcePathId)), 'CAM motion segments should retain their source toolpath id');
  assert(result.simulation.motionSegments.some((segment: any) => segment.kind === 'cut' && segment.feedRate === 100), 'CAM cut motion segments should use the operation cutting feed rate');
  assert(result.simulation.motionSegments.some((segment: any) => segment.kind === 'plunge' && segment.feedRate === 50), 'CAM plunge motion segments should use the operation plunge feed rate');
  assert(result.simulation.motionSegments.some((segment: any) => segment.kind === 'rapid' && segment.feedRate === result.machine.defaultRapidRate), 'CAM rapid motion segments should use the machine rapid feed rate');
  assert(result.simulation.sweptHulls.length === result.summary.sweptHullCount, 'CAM should persist swept cutter hull artifacts');
  assert(result.toolShape === 'flat' && result.cutterProfile?.kind === 'flat', 'CAM should persist normalized default cutter profile metadata');
  const firstHull = result.simulation.sweptHulls[0];
  assert(firstHull?.kind === 'flat-endmill-sweep', 'CAM swept cutter hulls should use flat-endmill sweep volumes');
  assert((firstHull?.positions?.length || 0) > 0 && (firstHull?.indices?.length || 0) > 0, 'CAM swept cutter hull artifacts should persist mesh data');
  assert(uniqueXYCountFromPositions(firstHull.positions!) > 8, 'CAM swept cutter hull should use a rounded cutter footprint, not a box footprint');
  assert(
    boundaryEdgeCountFromMeshArrays(firstHull.positions!, firstHull.indices!) === 0,
    'CAM swept cutter hull mesh should be closed',
  );
  assert(zRangeFromPositions(firstHull.positions!).span >= result.toolLength - 1e-6, 'CAM swept cutter hull should span the cutter length in Z');
  assert(result.gcode.includes('G21'), 'CAM G-code should set metric units');
  assert(result.gcode.includes('M3 S1000'), 'CAM G-code should start the spindle');
  assert(result.gcode.includes('G1 Z'), 'CAM G-code should contain plunge moves');
}

export async function test_cam_tool_shape_selection_persists_cutter_profile_metadata() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BALL_FINISH',
    name: 'Ball Finish',
    strategy: 'parallel-finish-zig',
    rasterAxis: 'X',
    toolShape: 'ball',
    toolDiameter: 2,
    toolLength: 12,
    shaftLength: 5,
    stepover: 4,
    sampleSpacing: 20,
    safeHeight: 2,
  });
  assert(result.paths.length > 0, 'Ball cutter parallel finish should generate projected paths');
  assert(result.toolShape === 'ball', 'CAM result should persist selected ball cutter shape');
  assert(result.cutterProfile.kind === 'ball' && result.cutterProfile.diameter === 2, 'CAM result should persist normalized ball cutter profile dimensions');
  assert(result.cutterProfile.radius === 1 && result.cutterProfile.cuttingLength === 12 && result.cutterProfile.shaftLength === 5, 'CAM cutter profile metadata should include radius, cutting length, and shaft length');
  assert(result.simulation.sweptSegments.every((segment) => segment.cutterProfile?.kind === 'ball'), 'CAM swept segments should retain the selected cutter profile');
  const plungeIndex = result.simulation.sweptSegments.findIndex((segment) => (
    Math.abs(segment.start[0] - segment.end[0]) <= 1e-6
    && Math.abs(segment.start[1] - segment.end[1]) <= 1e-6
    && Math.abs(segment.start[2] - segment.end[2]) > 1e-6
  ));
  assert(plungeIndex >= 0, 'Ball cutter simulation should include a plunge swept segment');
  const plungeHull = result.simulation.sweptHulls[plungeIndex];
  assert(plungeHull?.kind === 'cutter-profile-sweep', 'Ball cutter swept hulls should use profile-aware sweep volumes');
  assert(plungeHull?.toolShape === 'ball' && plungeHull?.cutterProfile?.kind === 'ball', 'Ball cutter swept hull should retain selected cutter profile metadata');
  assert(plungeHull?.toolLength >= result.toolLength + result.cutterProfile.shaftLength - 1e-6, 'Ball cutter swept hull should include the shaft extension in its tool length');
  assert((plungeHull?.positions?.length || 0) > 0, 'Ball cutter swept hull should persist profile-aware mesh positions');
  assert(zRangeFromPositions(plungeHull.positions || []).span >= result.toolLength + result.cutterProfile.shaftLength - 1e-6, 'Ball cutter swept hull geometry should span cutting length plus shaft length');
  assert(maxRadiusAtMinimumZFromPositions(plungeHull.positions || []) < 1e-4, 'Ball cutter swept hull should taper to the rounded tool tip');
}

export async function test_cam_invalid_cutter_profile_reports_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_TOOL',
    name: 'Invalid Bull Cutter',
    toolShape: 'bull',
    toolDiameter: 2,
    cornerRadius: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(result.paths.length === 0, 'Invalid CAM cutter profile should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Invalid CAM cutter profile should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('Invalid cutter profile') && warning.includes('cornerRadius')), 'Invalid CAM cutter profile should report the rejected cutter dimension');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid CAM cutter profile should summarize warning feedback');

  const unsupported = generateThreeAxisToolpath(viewer, {
    id: 'CAM_UNSUPPORTED_TOOL',
    name: 'Unsupported Cutter Shape',
    toolShape: 'spoon',
    toolDiameter: 2,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(unsupported.paths.length === 0, 'Unsupported CAM cutter shape should not silently fall back to a flat cutter');
  assert(
    unsupported.warnings.some((warning) => warning.includes('Invalid cutter profile') && warning.includes('Unsupported cutter shape "spoon"')),
    'Unsupported CAM cutter shape should report a generation-stopping warning before sampling',
  );

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-cutter-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid cutter validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_TOOL_GUARDED',
    name: 'Guarded Invalid Cone Tool',
    targetSolids: ['guarded-invalid-cutter-target'],
    toolShape: 'cone',
    maximumDiameter: 2,
    includedAngle: 'wide',
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid CAM cutter profile should not generate toolpaths');
  assert(guarded.warnings.some((warning) => warning.includes('Invalid cutter profile') && warning.includes('includedAngle') && warning.includes('finite')), 'Async invalid CAM cutter profile should report non-finite includedAngle feedback');
  assert(meshReadCount === 0, 'Invalid CAM cutter validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid CAM cutter validation should stop before target collection progress');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid CAM cutter result should summarize no inspected target geometry');
}

export async function test_cam_invalid_stepdown_reports_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_STEPDOWN',
    name: 'Invalid Stepdown',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 0,
    safeHeight: 2,
  });
  assert(result.paths.length === 0, 'Invalid CAM stepDown should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Invalid CAM stepDown should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('stepDown') && warning.includes('positive finite number')), 'Invalid CAM stepDown should report the rejected parameter');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid CAM stepDown feedback should be included in the warning summary');

  const asyncResult = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_BAD_STEPDOWN_ASYNC',
    name: 'Invalid Async Stepdown',
    strategy: 'adaptive-waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: -1,
    safeHeight: 2,
  });
  assert(asyncResult.paths.length === 0, 'Async invalid CAM stepDown should not generate toolpaths');
  assert(asyncResult.warnings.some((warning) => warning.includes('stepDown') && warning.includes('positive finite number')), 'Async invalid CAM stepDown should report the rejected parameter');
  assert(asyncResult.summary.warningCount === asyncResult.warnings.length, 'Async invalid CAM stepDown feedback should be included in the warning summary');

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-stepdown-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid stepDown validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_STEPDOWN_GUARDED',
    name: 'Guarded Invalid Stepdown',
    targetSolids: ['guarded-invalid-stepdown-target'],
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 0,
    safeHeight: 2,
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid CAM stepDown should not generate toolpaths for guarded targets');
  assert(meshReadCount === 0, 'Invalid CAM stepDown validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid CAM stepDown validation should stop before target collection progress');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid CAM stepDown result should summarize no inspected target geometry');
}

export async function test_cam_invalid_sampling_reports_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_SAMPLING',
    name: 'Invalid Sampling',
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 0,
    safeHeight: 2,
  });
  assert(result.paths.length === 0, 'Invalid CAM sampleSpacing should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Invalid CAM sampleSpacing should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('sampleSpacing') && warning.includes('positive finite number')), 'Invalid CAM sampleSpacing should report the rejected parameter');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid CAM sampling feedback should be included in the warning summary');

  const asyncResult = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_BAD_SAMPLING_ASYNC',
    name: 'Invalid Async Sampling',
    strategy: 'adaptive-waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    sampleSpacing: 2,
    minSampleSpacing: Number.NaN,
    safeHeight: 2,
  });
  assert(asyncResult.paths.length === 0, 'Async invalid CAM minSampleSpacing should not generate toolpaths');
  assert(asyncResult.warnings.some((warning) => warning.includes('minSampleSpacing') && warning.includes('positive finite number')), 'Async invalid CAM minSampleSpacing should report the rejected parameter');
  assert(asyncResult.summary.warningCount === asyncResult.warnings.length, 'Async invalid CAM sampling feedback should be included in the warning summary');

  const maxDepthResult = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_MAX_DEPTH',
    name: 'Invalid Adaptive Max Depth',
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 2,
    maxDepth: 0,
    safeHeight: 2,
  });
  assert(maxDepthResult.paths.length === 0, 'Invalid CAM maxDepth should not generate toolpaths');
  assert(maxDepthResult.warnings.some((warning) => warning.includes('maxDepth') && warning.includes('positive finite integer')), 'Invalid CAM maxDepth should report the rejected adaptive sampling parameter');

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-sampling-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid sampling validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_SAMPLING_GUARDED',
    name: 'Guarded Invalid Sampling',
    targetSolids: ['guarded-invalid-sampling-target'],
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 2,
    maxDepth: Number.NaN,
    safeHeight: 2,
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid CAM sampling should not generate toolpaths for guarded targets');
  assert(meshReadCount === 0, 'Invalid CAM sampling validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid CAM sampling validation should stop before target collection progress');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid CAM sampling result should summarize no inspected target geometry');
}

export async function test_cam_invalid_machining_controls_report_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_MACHINING',
    name: 'Invalid Machining Controls',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 0,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(result.paths.length === 0, 'Invalid CAM stepover should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Invalid CAM stepover should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('stepover') && warning.includes('positive finite number')), 'Invalid CAM stepover should report the rejected parameter');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid CAM machining control feedback should be included in the warning summary');

  const asyncResult = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_BAD_MACHINING_ASYNC',
    name: 'Invalid Async Machining Controls',
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 1,
    feedRate: 800,
    plungeRate: Number.NaN,
    safeHeight: 2,
  });
  assert(asyncResult.paths.length === 0, 'Async invalid CAM plungeRate should not generate toolpaths');
  assert(asyncResult.warnings.some((warning) => warning.includes('plungeRate') && warning.includes('positive finite number')), 'Async invalid CAM plungeRate should report the rejected parameter');
  assert(asyncResult.summary.warningCount === asyncResult.warnings.length, 'Async invalid CAM machining control feedback should be included in the warning summary');

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-machining-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid machining control validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_MACHINING_GUARDED',
    name: 'Guarded Invalid Machining Controls',
    targetSolids: ['guarded-invalid-machining-target'],
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 0,
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid CAM safeHeight should not generate toolpaths for guarded targets');
  assert(guarded.warnings.some((warning) => warning.includes('safeHeight') && warning.includes('positive finite number')), 'Async invalid CAM safeHeight should report the rejected parameter');
  assert(meshReadCount === 0, 'Invalid CAM machining control validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid CAM machining control validation should stop before target collection progress');
  assert(guardedProgress.includes('invalid-machining-controls'), 'Async invalid CAM machining control validation should report a progress phase');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid CAM machining control result should summarize no inspected target geometry');
}

export async function test_cam_invalid_machine_profile_reports_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_MACHINE',
    name: 'Invalid Machine Profile',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    machineProfile: {
      maxSpindleRPM: 0,
      defaultRapidRate: 2500,
      safeParkZ: 15,
    },
  });
  assert(result.paths.length === 0, 'Invalid CAM machine max spindle should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Invalid CAM machine profile should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('machine profile') && warning.includes('maxSpindleRPM')), 'Invalid CAM machine max spindle should report the rejected global setting');
  assert(result.summary.targetCount === 0 && result.summary.triangleCount === 0, 'Invalid CAM machine profile validation should stop before target mesh extraction');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid CAM machine profile feedback should be included in the warning summary');

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-machine-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid machine profile validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_MACHINE_ASYNC',
    name: 'Invalid Async Machine Profile',
    targetSolids: ['guarded-invalid-machine-target'],
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 1,
    safeHeight: 2,
    machineProfile: {
      maxSpindleRPM: 24000,
      defaultRapidRate: -1,
      safeParkZ: Number.NaN,
    },
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid CAM machine profile should not generate toolpaths for guarded targets');
  assert(guarded.warnings.some((warning) => warning.includes('defaultRapidRate') && warning.includes('positive finite number')), 'Async invalid CAM machine rapid rate should report the rejected global setting');
  assert(guarded.warnings.some((warning) => warning.includes('safeParkZ') && warning.includes('non-negative finite number')), 'Async invalid CAM machine park Z should report the rejected global setting');
  assert(meshReadCount === 0, 'Invalid CAM machine profile validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid CAM machine profile validation should stop before target collection progress');
  assert(guardedProgress.includes('invalid-machine-profile'), 'Async invalid CAM machine profile validation should report a progress phase');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid CAM machine profile result should summarize no inspected target geometry');
}

export async function test_cam_invalid_stock_profile_reports_feedback_without_paths() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const rawInvalid = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_STOCK_RAW',
    name: 'Invalid Raw Stock Profile',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockProfile: {
      mode: 'oversized',
      margin: -1,
      sizeX: -5,
      offsetY: Number.NaN,
    },
  });
  assert(rawInvalid.paths.length === 0, 'Invalid raw CAM stock profile values should not generate toolpaths');
  assert(rawInvalid.simulation.sweptSegments.length === 0 && rawInvalid.simulation.sweptHulls.length === 0, 'Invalid raw CAM stock profile values should not generate swept simulation artifacts');
  assert(rawInvalid.warnings.some((warning) => warning.includes('stock profile') && warning.includes('mode')), 'Invalid CAM stock mode should report the rejected global setting');
  assert(rawInvalid.warnings.some((warning) => warning.includes('margin') && warning.includes('non-negative finite number')), 'Invalid CAM stock margin should report the rejected global setting');
  assert(rawInvalid.warnings.some((warning) => warning.includes('sizeX') && warning.includes('positive finite number')), 'Invalid CAM stock size should report the rejected global setting');
  assert(rawInvalid.warnings.some((warning) => warning.includes('offsetY') && warning.includes('finite number')), 'Invalid CAM stock offset should report the rejected global setting');
  assert(rawInvalid.summary.targetCount === 0 && rawInvalid.summary.triangleCount === 0, 'Invalid raw CAM stock profile validation should stop before target mesh extraction');

  let meshReadCount = 0;
  const guardedSolid = {
    ...makeCubeMeshSolid(10),
    name: 'guarded-invalid-stock-target',
    getMesh() {
      meshReadCount += 1;
      throw new Error('Invalid stock profile validation should not read target mesh data.');
    },
  };
  const guardedViewer = makeViewerWithSolid(guardedSolid);
  const guardedProgress: string[] = [];
  const guarded = await generateThreeAxisToolpathAsync(guardedViewer, {
    id: 'CAM_BAD_STOCK_RAW_ASYNC',
    name: 'Invalid Async Raw Stock Profile',
    targetSolids: ['guarded-invalid-stock-target'],
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 1,
    safeHeight: 2,
    stockProfile: {
      mode: 'fixed',
      sizeZ: 0,
    },
    onProgress: (event: any) => guardedProgress.push(String(event?.phase || '')),
  });
  assert(guarded.paths.length === 0, 'Async invalid raw CAM stock profile values should not generate toolpaths for guarded targets');
  assert(guarded.warnings.some((warning) => warning.includes('sizeZ') && warning.includes('positive finite number')), 'Async invalid CAM stock size should report the rejected global setting');
  assert(meshReadCount === 0, 'Invalid raw CAM stock profile validation should stop before extracting target mesh data');
  assert(!guardedProgress.includes('targets') && !guardedProgress.includes('mesh-extraction'), 'Async invalid raw CAM stock profile validation should stop before target collection progress');
  assert(guardedProgress.includes('invalid-stock-profile'), 'Async invalid raw CAM stock profile validation should report a progress phase');
  assert(guarded.summary.targetCount === 0 && guarded.summary.triangleCount === 0, 'Invalid raw CAM stock profile result should summarize no inspected target geometry');

  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BAD_STOCK',
    name: 'Invalid Fixed Stock',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockProfile: {
      mode: 'fixed',
      sizeX: 5,
      sizeY: 20,
      sizeZ: 20,
    },
  });
  assert(result.paths.length === 0, 'Undersized fixed CAM stock should not generate toolpaths');
  assert(result.simulation.sweptSegments.length === 0 && result.simulation.sweptHulls.length === 0, 'Undersized fixed CAM stock should not generate swept simulation artifacts');
  assert(result.warnings.some((warning) => warning.includes('fixed stock') && warning.includes('contain')), 'Undersized fixed CAM stock should report containment feedback');
  assert(result.summary.targetCount === 1 && result.summary.triangleCount > 0, 'Fixed stock containment validation should run after target mesh extraction');
  assert(result.summary.warningCount === result.warnings.length, 'Invalid fixed stock feedback should be included in the warning summary');

  const asyncProgress: string[] = [];
  const asyncResult = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_BAD_STOCK_ASYNC',
    name: 'Invalid Async Fixed Stock',
    strategy: 'parallel-finish-zig',
    toolDiameter: 1,
    toolLength: 10,
    stepover: 2,
    sampleSpacing: 1,
    safeHeight: 2,
    stockProfile: {
      mode: 'fixed',
      sizeX: 10,
      sizeY: 10,
      sizeZ: 10,
      offsetX: 20,
    },
    onProgress: (event: any) => asyncProgress.push(String(event?.phase || '')),
  });
  assert(asyncResult.paths.length === 0, 'Offset fixed CAM stock should not generate async toolpaths when it misses the target');
  assert(asyncResult.warnings.some((warning) => warning.includes('fixed stock') && warning.includes('offset')), 'Offset fixed CAM stock should report offset feedback');
  assert(asyncProgress.includes('targets') && asyncProgress.includes('mesh-extraction'), 'Async fixed stock validation should run after target collection progress');
  assert(asyncProgress.includes('invalid-stock'), 'Async invalid fixed stock should report a dedicated progress phase');
  assert(!asyncProgress.includes('parallel-pass-generate'), 'Async invalid fixed stock should stop before strategy-specific path generation');
}

export async function test_cam_serialized_mesh_rejects_non_finite_triangle_coordinates() {
  const result = generateThreeAxisToolpath(null, {
    id: 'CAM_BAD_SERIALIZED_MESH',
    name: 'Bad Serialized Mesh',
    targetCount: 1,
    targetMeshes: [{
      name: 'bad serialized target',
      triangles: [
        Number.NaN, 0, 0,
        10, 0, 0,
        0, 10, 0,
      ],
    }],
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });

  assert(result.paths.length === 0, 'CAM generation should not fabricate toolpaths from non-finite serialized mesh coordinates');
  assert(result.summary.targetCount === 1, 'Serialized CAM mesh result should preserve the requested target count');
  assert(result.summary.triangleCount === 0, 'Non-finite serialized triangles should be skipped before toolpath generation');
  assert(
    result.warnings.some((warning) => warning.includes('Skipped serialized target mesh triangle 1') && warning.includes('non-finite coordinate')),
    'Non-finite serialized mesh coordinates should produce explicit warning feedback',
  );
  assert(
    result.warnings.some((warning) => warning.includes('No mesh triangles found for bad serialized target')),
    'Serialized targets with only invalid triangles should still report no usable mesh triangles',
  );
}

export async function test_cam_short_cutter_length_reports_cut_depth_warning() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const params = {
    id: 'CAM_SHORT_TOOL',
    name: 'Short Cutter',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    toolLength: 2,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 2,
  };
  const result = generateThreeAxisToolpath(viewer, params);
  assert(result.paths.length > 0, 'Short cutter length warning should not prevent CAM generation');
  assert(
    result.warnings.some((warning) => warning.includes('Cutter length 2') && warning.includes('requested cut depth 10')),
    'CAM generation should warn when cutter length is shorter than requested cut depth',
  );
  assert(result.summary.warningCount === result.warnings.length, 'Short cutter length feedback should be included in the warning summary');

  const asyncResult = await generateThreeAxisToolpathAsync(viewer, {
    ...params,
    id: 'CAM_SHORT_TOOL_ASYNC',
  });
  assert(
    asyncResult.warnings.some((warning) => warning.includes('Cutter length 2') && warning.includes('requested cut depth 10')),
    'Async CAM generation should warn when cutter length is shorter than requested cut depth',
  );
  assert(asyncResult.summary.warningCount === asyncResult.warnings.length, 'Async short cutter length feedback should be included in the warning summary');
}

export async function test_cam_cone_maximum_diameter_sets_effective_tool_diameter() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_CONE_TOOL',
    name: 'Cone Tool Diameter',
    toolShape: 'cone',
    toolDiameter: 1,
    maximumDiameter: 6,
    includedAngle: 90,
    toolLength: 10,
    stepover: 4,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(result.paths.length > 0, 'Cone cutter operation should generate paths with maximumDiameter-driven settings');
  assert(result.toolDiameter === 6, 'Cone cutter maximumDiameter should become the effective CAM tool diameter');
  assert(result.cutterProfile.kind === 'cone' && result.cutterProfile.diameter === 6, 'Cone cutter profile metadata should retain maximum diameter');
  assert(result.simulation.sweptSegments.every((segment) => Math.abs(segment.radius - 3) < 1e-6), 'Cone cutter swept segments should use maximumDiameter radius');
}

export async function test_cam_ball_cone_tool_generates_finite_surface_finish_and_swept_hulls() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_BALL_CONE_TOOL',
    name: 'Ball Cone Tool',
    strategy: 'parallel-finish-zig',
    rasterAxis: 'X',
    toolShape: 'ball-cone',
    ballDiameter: 1,
    maximumDiameter: 3,
    includedAngle: 90,
    toolLength: 12,
    stepover: 4,
    sampleSpacing: 20,
    safeHeight: 2,
  });
  const allPoints = result.paths.flatMap((path) => path.points);
  assert(result.paths.length > 0 && allPoints.length > 0, 'Ball-cone cutter surface finish should generate projected paths');
  assert(allPoints.every((point) => point.every(Number.isFinite)), 'Ball-cone cutter generated path coordinates should remain finite');
  assert(result.toolDiameter === 3, 'Ball-cone maximumDiameter should become the effective CAM tool diameter');
  assert(result.cutterProfile.kind === 'ball-cone', 'Ball-cone result should retain the selected compound cutter profile');
  assert(result.cutterProfile.ballDiameter === 1 && result.cutterProfile.maximumDiameter === 3, 'Ball-cone cutter profile metadata should retain compound dimensions');
  assert(result.simulation.sweptSegments.every((segment) => segment.cutterProfile?.kind === 'ball-cone' && Math.abs(segment.radius - 1.5) < 1e-6), 'Ball-cone swept segments should retain selected profile and maximum radius');
  const plungeIndex = result.simulation.sweptSegments.findIndex((segment) => (
    Math.abs(segment.start[0] - segment.end[0]) <= 1e-6
    && Math.abs(segment.start[1] - segment.end[1]) <= 1e-6
    && Math.abs(segment.start[2] - segment.end[2]) > 1e-6
  ));
  assert(plungeIndex >= 0, 'Ball-cone cutter simulation should include a plunge swept segment');
  const plungeHull = result.simulation.sweptHulls[plungeIndex];
  assert(plungeHull?.kind === 'cutter-profile-sweep' && plungeHull?.toolShape === 'ball-cone', 'Ball-cone swept hulls should use profile-aware sweep volumes');
  assert(maxRadiusAtMinimumZFromPositions(plungeHull.positions || []) < 1e-4, 'Ball-cone swept hull should taper to the rounded compound tool tip');
}

export async function test_cam_async_swept_hulls_report_segment_progress() {
  const solid = makeCubeMeshSolid(6);
  const viewer = makeViewerWithSolid(solid);
  const progressEvents: any[] = [];
  const result = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_PROGRESS',
    name: 'Progress CAM',
    toolDiameter: 1,
    stepover: 4,
    stepDown: 6,
    safeHeight: 1,
    stockMargin: 1,
    onProgress: (event: any) => progressEvents.push({ ...event }),
    progressYield: async () => Promise.resolve(),
  });

  assert(result.simulation.sweptHulls.length > 0, 'CAM progress test should generate swept cutter hulls');
  const segmentEvents = progressEvents.filter((event) => event.phase === 'swept-hull-segment');
  assert(segmentEvents.length >= result.simulation.sweptHulls.length, 'CAM async generation should report progress for every swept cutter segment mesh');
  assert(String(segmentEvents[0]?.detail || '').includes('Segment 1 of'), 'CAM swept hull progress should name the first cutter segment');
  assert(
    segmentEvents.some((event) => String(event.detail || '').includes(`Segment ${result.simulation.sweptHulls.length} of ${result.simulation.sweptHulls.length}`)),
    'CAM swept hull progress should name the final cutter segment',
  );
  const segmentProgress = segmentEvents.map((event) => Number(event.current)).filter(Number.isFinite);
  assert(segmentProgress[segmentProgress.length - 1] > segmentProgress[0], 'CAM swept hull progress should advance while segment meshes are built');
  assert(progressEvents.length > 0, 'CAM async generation should emit progress events');
  assert(progressEvents.every((event) => Number.isFinite(Number(event.total)) && Number(event.total) > 0), 'CAM async progress events should include a positive finite total');
  assert(progressEvents.every((event) => Number.isFinite(Number(event.current)) && Number(event.current) >= 0 && Number(event.current) <= Number(event.total)), 'CAM async progress events should keep current progress within total');
}

export async function test_cam_plan_manager_async_progress_events_are_bounded() {
  const solid = makeCubeMeshSolid(8);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_PROGRESS_MANAGER',
    name: 'Progress Manager',
    targetSolids: [solid.name],
    toolDiameter: 1,
    stepover: 3,
    stepDown: 4,
    safeHeight: 2,
  });
  const progressEvents: any[] = [];
  const plan = await manager.generateAllAsync(viewer, {
    useWorker: false,
    onProgress: (event: any) => progressEvents.push({ ...event }),
    progressYield: async () => Promise.resolve(),
  });

  assert(plan.paths.length > 0, 'CAM manager progress test should generate paths');
  assert(progressEvents.length > 0, 'CAM manager async generation should emit progress events');
  assert(progressEvents.every((event) => Number.isFinite(Number(event.total)) && Number(event.total) > 0), 'CAM manager progress events should include a positive finite total');
  assert(progressEvents.every((event) => Number.isFinite(Number(event.current)) && Number(event.current) >= 0 && Number(event.current) <= Number(event.total)), 'CAM manager progress events should keep current progress within total');
  assert(progressEvents.some((event) => event.phase === 'operation' && event.operationIndex === 1 && event.operationCount === 1), 'CAM manager progress should retain operation index metadata');
}

export async function test_cam_async_waterline_reports_fiber_progress_and_yields() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const progressPhases: string[] = [];
  let yieldCount = 0;
  const result = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_WATERLINE_PROGRESS',
    name: 'Waterline Progress',
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    sampling: 1,
    waterlineChunkSize: 1,
    safeHeight: 2,
    stockMargin: 3,
    onProgress: (event: any) => progressPhases.push(String(event?.phase || '')),
    progressYield: async () => { yieldCount += 1; },
  });

  assert(result.paths.length > 0, 'Async waterline progress test should generate contour paths');
  for (const phase of ['waterline-levels', 'waterline-fibers', 'waterline-push-x', 'waterline-push-y', 'waterline-weave', 'waterline-link', 'waterline-complete']) {
    assert(progressPhases.includes(phase), `Async waterline should report ${phase}`);
  }
  assert(progressPhases.includes('push-index-x') && progressPhases.includes('push-index-y'), 'Async waterline should report public X/Y push-cutter index phases');
  assert(progressPhases.filter((phase) => phase === 'push-fibers-x').length >= 2, 'Async waterline should report public chunked X fiber progress');
  assert(progressPhases.filter((phase) => phase === 'push-fibers-y').length >= 2, 'Async waterline should report public chunked Y fiber progress');
  assert(yieldCount >= 8, 'Async waterline should yield through index, fiber, and weave progress boundaries');
}

export async function test_cam_async_adaptive_waterline_reports_sampling_progress_and_yields() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const progressPhases: string[] = [];
  let yieldCount = 0;
  const result = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_ADAPTIVE_WATERLINE_PROGRESS',
    name: 'Adaptive Waterline Progress',
    strategy: 'adaptive-waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    sampleSpacing: 4,
    minSampleSpacing: 0.5,
    flatnessCosLimit: 0.999,
    adaptiveWaterlineChunkSize: 1,
    safeHeight: 2,
    stockMargin: 3,
    onProgress: (event: any) => progressPhases.push(String(event?.phase || '')),
    progressYield: async () => { yieldCount += 1; },
  });

  assert(result.paths.length > 0, 'Async adaptive waterline progress test should generate contour paths');
  assert(progressPhases.includes('adaptive-waterline-level'), 'Async adaptive waterline should report the current Z level before sampling');
  assert(progressPhases.filter((phase) => phase === 'adaptive-waterline-sample-x').length >= 2, 'Async adaptive waterline should report public chunked X sampling progress');
  assert(progressPhases.filter((phase) => phase === 'adaptive-waterline-sample-y').length >= 2, 'Async adaptive waterline should report public chunked Y sampling progress');
  assert(progressPhases.includes('adaptive-waterline-weave'), 'Async adaptive waterline should report weave reconstruction progress');
  assert(progressPhases.includes('adaptive-waterline-link'), 'Async adaptive waterline should report path construction/linking progress');
  assert((result.summary.waterlineSubdivisionCount || 0) > 0, 'Async adaptive waterline should summarize adaptive subdivisions');
  assert(yieldCount >= 8, 'Async adaptive waterline should yield through sampling and weave progress boundaries');
}

export async function test_cam_async_parallel_finish_reports_pass_progress_and_yields() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const progressPhases: string[] = [];
  let yieldCount = 0;
  const result = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_PARALLEL_PROGRESS',
    name: 'Parallel Finish Progress',
    strategy: 'parallel-finish-zig-zag',
    rasterAxis: 'X',
    toolShape: 'ball',
    toolDiameter: 1,
    stepover: 2,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 2,
    parallelFinishChunkSize: 1,
    onProgress: (event: any) => progressPhases.push(String(event?.phase || '')),
    progressYield: async () => { yieldCount += 1; },
  });

  assert(result.paths.length > 0, 'Async parallel finish progress test should generate projected paths');
  for (const phase of ['parallel-region', 'parallel-pass-generate', 'parallel-link', 'parallel-complete']) {
    assert(progressPhases.includes(phase), `Async parallel finish should report ${phase}`);
  }
  assert(progressPhases.filter((phase) => phase === 'parallel-project').length >= 2, 'Async parallel finish should report chunked projection progress');
  assert(result.summary.levelCount === 1, 'Async parallel finish should summarize a single projected pass set');
  assert(yieldCount >= 8, 'Async parallel finish should yield through pass projection and simulation progress boundaries');
}

export async function test_cam_async_parallel_finish_yields_inside_dense_projection_pass() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const progressEvents: any[] = [];
  let yieldCount = 0;
  const result = await generateThreeAxisToolpathAsync(viewer, {
    id: 'CAM_PARALLEL_INNER_PROGRESS',
    name: 'Parallel Inner Progress',
    strategy: 'parallel-finish-zig',
    rasterAxis: 'X',
    toolShape: 'ball',
    toolDiameter: 1,
    stepover: 10,
    sampleSpacing: 4,
    minSampleSpacing: 0.25,
    safeHeight: 2,
    parallelFinishChunkSize: 1000,
    parallelProjectionYieldInterval: 1,
    onProgress: (event: any) => progressEvents.push({ ...event }),
    progressYield: async () => { yieldCount += 1; },
  });

  const innerProgress = progressEvents.filter((event) => (
    event.phase === 'parallel-project'
    && String(event.detail || '').includes('adaptive projection sample')
  ));
  assert(result.paths.length > 0, 'Async parallel inner-progress test should generate projected paths');
  assert(innerProgress.length > 0, 'Async parallel finish should report progress while projecting a dense pass, before the pass chunk completes');
  assert(innerProgress.every((event) => Number(event.current) >= 32 && Number(event.current) <= 62), 'Async parallel inner projection progress should stay inside the projection progress range');
  assert(yieldCount >= innerProgress.length, 'Async parallel inner projection progress should yield at each inner projection checkpoint');
}

export async function test_cam_async_generation_can_be_aborted() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const controller = new AbortController();
  let yieldCount = 0;
  let progressCount = 0;
  let caught: any = null;

  try {
    await generateThreeAxisToolpathAsync(viewer, {
      id: 'CAM_ABORT',
      name: 'Abort CAM',
      strategy: 'parallel-finish-zig-zag',
      rasterAxis: 'X',
      toolShape: 'ball',
      toolDiameter: 1,
      stepover: 2,
      sampleSpacing: 20,
      safeHeight: 2,
      signal: controller.signal,
      onProgress: () => { progressCount += 1; },
      progressYield: async () => {
        yieldCount += 1;
        if (yieldCount === 3) controller.abort('Stop requested');
      },
    });
  } catch (error) {
    caught = error;
  }

  assert(controller.signal.aborted, 'CAM async abort test should trip the abort signal');
  assert(progressCount >= 3, 'CAM async abort test should report progress before cancellation');
  assert(caught?.name === 'AbortError', 'CAM async generation should reject with AbortError when canceled');
  assert(String(caught?.message || '').includes('Stop requested'), 'CAM async generation should include the abort reason');
}

export async function test_cam_worker_serialization_failure_reports_feedback() {
  const originalWorker = (globalThis as any).Worker;
  let terminated = false;
  class ThrowingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage() {
      throw new Error('DataCloneError: function values cannot be cloned');
    }
    terminate() {
      terminated = true;
    }
  }

  (globalThis as any).Worker = ThrowingWorker;
  try {
    let caught: any = null;
    try {
      await runCamToolpathWorker({
        machineProfile: {} as any,
        operations: [{ params: { id: 'BAD_WORKER_PAYLOAD', nonSerializable: () => null } }],
      });
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof Error, 'CAM worker serialization failure should reject generation');
    assert(String(caught.message || '').includes('CAM worker serialization failed'), 'CAM worker serialization failure should include clear user-facing feedback');
    assert(String(caught.message || '').includes('DataCloneError'), 'CAM worker serialization failure should preserve the original clone failure detail');
    assert(terminated, 'CAM worker serialization failure should terminate the worker');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_plan_manager_falls_back_when_worker_start_fails() {
  const originalWorker = (globalThis as any).Worker;
  let constructed = 0;
  class FailingStartupWorker {
    constructor() {
      constructed += 1;
      throw new Error('Failed to construct Worker: module worker blocked');
    }
  }

  (globalThis as any).Worker = FailingStartupWorker;
  try {
    const solid = makeCubeMeshSolid(8);
    const viewer = makeViewerWithSolid(solid);
    const manager = new CamPlanManager(null);
    const operation = manager.createOperation('cam3axis', {
      id: 'CAM_WORKER_FALLBACK',
      name: 'Worker Fallback',
      toolDiameter: 1,
      stepover: 2,
      stepDown: 4,
      safeHeight: 2,
    });
    const phases: string[] = [];
    const plan = await manager.generateAllAsync(viewer, {
      onProgress: (event: any) => phases.push(String(event?.phase || '')),
    });

    assert(constructed === 1, 'CAM worker fallback test should attempt worker startup once');
    assert(phases.includes('worker-fallback'), 'CAM manager should report worker fallback progress when worker startup fails');
    assert(plan.paths.length > 0, 'CAM manager should fall back to in-process async generation when worker startup fails');
    assert(operation?.persistentData?.toolpath?.paths?.length > 0, 'CAM worker fallback should persist generated operation toolpaths');
    assert(manager.getCombinedPlan().paths.length === plan.paths.length, 'CAM worker fallback should update the combined plan');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_worker_abort_terminates_active_worker() {
  const originalWorker = (globalThis as any).Worker;
  let posted = false;
  let terminated = false;
  class HoldingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage() {
      posted = true;
    }
    terminate() {
      terminated = true;
    }
  }

  (globalThis as any).Worker = HoldingWorker;
  try {
    const controller = new AbortController();
    const promise = runCamToolpathWorker({
      machineProfile: {} as any,
      operations: [{ params: { id: 'WORKER_ABORT' } }],
    }, {
      signal: controller.signal,
    });
    controller.abort('Stop worker');

    let caught: any = null;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }

    assert(posted, 'CAM worker abort test should start the worker job before cancellation');
    assert(terminated, 'Aborting CAM worker generation should terminate the active worker');
    assert(caught?.name === 'AbortError', 'Aborting CAM worker generation should reject with AbortError');
    assert(String(caught?.message || '').includes('Stop worker'), 'Aborting CAM worker generation should preserve the abort reason');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_worker_progress_yield_abort_wins_result_race() {
  const originalWorker = (globalThis as any).Worker;
  let terminated = false;
  class FastResultWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage() {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'progress',
            event: {
              phase: 'worker-operation',
              message: 'Generating CAM operation',
              current: 50,
              total: 100,
            },
          },
        } as MessageEvent);
        this.onmessage?.({
          data: {
            type: 'result',
            result: {
              operations: [],
              combined: {
                paths: [{ id: 'STALE_RESULT', z: 0, feedRate: 1, plungeRate: 1, points: [[0, 0, 0], [1, 0, 0]] }],
                gcode: 'G21',
                warnings: [],
                simulation: { samples: [], motionPolyline: [], motionSegments: [], sweptSegments: [], sweptHulls: [] },
                summary: { pathCount: 1, warningCount: 0 },
              },
            },
          },
        } as MessageEvent);
      });
    }
    terminate() {
      terminated = true;
    }
  }

  (globalThis as any).Worker = FastResultWorker;
  try {
    const controller = new AbortController();
    let progressYieldCount = 0;
    let resolved = false;
    let caught: any = null;
    try {
      await runCamToolpathWorker({
        machineProfile: {} as any,
        operations: [{ params: { id: 'WORKER_PROGRESS_ABORT' } }],
      }, {
        signal: controller.signal,
        progressYield: async () => {
          progressYieldCount += 1;
          await Promise.resolve();
          controller.abort('Stop after worker progress');
        },
      });
      resolved = true;
    } catch (error) {
      caught = error;
    }

    assert(progressYieldCount === 1, 'CAM worker should await the progress-yield hook for the reported progress event');
    assert(controller.signal.aborted, 'CAM worker progress yield should be able to abort generation');
    assert(terminated, 'Aborting from a worker progress yield should terminate the worker');
    assert(!resolved, 'CAM worker should not resolve a result that raced ahead of progress-yield cancellation');
    assert(caught?.name === 'AbortError', 'CAM worker should reject with AbortError when progress-yield aborts before result acceptance');
    assert(String(caught?.message || '').includes('Stop after worker progress'), 'CAM worker abort race should preserve the progress-yield abort reason');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_worker_job_carries_global_stock_and_machine_once() {
  const originalWorker = (globalThis as any).Worker;
  let capturedJob: any = null;
  class CapturingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(message: any) {
      capturedJob = message?.job || null;
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'result',
            result: {
              operations: [],
              combined: {
                paths: [],
                gcode: '',
                warnings: [],
                simulation: { samples: [], motionPolyline: [], motionSegments: [], sweptSegments: [], sweptHulls: [] },
                summary: { pathCount: 0, warningCount: 0 },
              },
            },
          },
        } as MessageEvent);
      });
    }
    terminate() {}
  }

  (globalThis as any).Worker = CapturingWorker;
  try {
    const solid = makeCubeMeshSolid(8);
    solid.name = 'CAM_BOX';
    const viewer = makeViewerWithSolid(solid);
    const manager = new CamPlanManager(null);
    manager.updateMachineProfile({ name: 'Worker CNC Mill', controller: 'linuxcnc' });
    manager.updateStockProfile({ mode: 'fixed', sizeX: 40, sizeY: 30, sizeZ: 12 });
    const operation = manager.createOperation('cam3axis', {
      id: 'CAM_WORKER_GLOBALS',
      name: 'Worker Globals',
      targetSolids: ['CAM_BOX'],
      toolDiameter: 1,
      stepover: 2,
      stepDown: 4,
      safeHeight: 2,
    });
    operation.inputParams.nonSerializableCallback = () => null;
    operation.inputParams.workerPlainNested = { keep: true, drop: () => null };
    operation.inputParams.workerTypedArray = Float32Array.from([1, 2, 3]);
    operation.inputParams.workerCyclic = {};
    operation.inputParams.workerCyclic.self = operation.inputParams.workerCyclic;
    await manager.generateAllAsync(viewer, { useWorker: true });

    assert(capturedJob?.machineProfile?.name === 'Worker CNC Mill', 'CAM worker job should carry the global machine profile once');
    assert(capturedJob?.stockProfile?.mode === 'fixed' && capturedJob.stockProfile.sizeX === 40, 'CAM worker job should carry the global stock profile once');
    const operationParams = capturedJob?.operations?.[0]?.params || {};
    assert(!Object.prototype.hasOwnProperty.call(operationParams, 'machineProfile'), 'CAM worker operation params should not duplicate the global machine profile');
    assert(!Object.prototype.hasOwnProperty.call(operationParams, 'stockProfile'), 'CAM worker operation params should not duplicate the global stock profile');
    assert(Array.isArray(operationParams.targetMeshes) && operationParams.targetMeshes.length === 1, 'CAM worker operation params should still carry serialized target meshes');
    assert(!Object.prototype.hasOwnProperty.call(operationParams, 'nonSerializableCallback'), 'CAM worker operation params should omit non-serializable function values');
    assert(operationParams.workerPlainNested?.keep === true && !Object.prototype.hasOwnProperty.call(operationParams.workerPlainNested, 'drop'), 'CAM worker operation params should preserve plain nested data while omitting nested functions');
    assert(operationParams.workerTypedArray?.join('|') === '1|2|3', 'CAM worker operation params should convert typed arrays to plain arrays');
    assert(!Object.prototype.hasOwnProperty.call(operationParams.workerCyclic || {}, 'self'), 'CAM worker operation params should omit cyclic object references');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_worker_skips_mesh_serialization_for_invalid_operations() {
  const originalWorker = (globalThis as any).Worker;
  let capturedJob: any = null;
  class CapturingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(message: any) {
      capturedJob = message?.job || null;
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            type: 'result',
            result: {
              operations: [],
              combined: {
                paths: [],
                gcode: '',
                warnings: [],
                simulation: { samples: [], motionPolyline: [], motionSegments: [], sweptSegments: [], sweptHulls: [] },
                summary: { pathCount: 0, warningCount: 0 },
              },
            },
          },
        } as MessageEvent);
      });
    }
    terminate() {}
  }

  (globalThis as any).Worker = CapturingWorker;
  try {
    let meshReadCount = 0;
    const solid = {
      ...makeCubeMeshSolid(8),
      name: 'CAM_GUARDED_INVALID_WORKER',
      getMesh() {
        meshReadCount += 1;
        throw new Error('Invalid worker CAM operation should not serialize target mesh data.');
      },
    };
    const viewer = makeViewerWithSolid(solid);
    const manager = new CamPlanManager(null);
    manager.createOperation('cam3axis', {
      id: 'CAM_WORKER_INVALID',
      name: 'Invalid Worker Operation',
      targetSolids: ['CAM_GUARDED_INVALID_WORKER'],
      toolShape: 'bull',
      toolDiameter: 2,
      cornerRadius: 1,
      stepover: 2,
      stepDown: 4,
      safeHeight: 2,
    });
    const progressPhases: string[] = [];
    await manager.generateAllAsync(viewer, {
      useWorker: true,
      onProgress: (event: any) => progressPhases.push(String(event?.phase || '')),
    });

    const operationParams = capturedJob?.operations?.[0]?.params || {};
    assert(meshReadCount === 0, 'CAM worker preparation should not extract target meshes for operations that fail early validation');
    assert(Array.isArray(operationParams.targetMeshes) && operationParams.targetMeshes.length === 0, 'Invalid CAM worker operation should carry an empty serialized target list');
    assert(operationParams.targetCount === 0, 'Invalid CAM worker operation should summarize zero serialized targets');
    assert(progressPhases.includes('worker-validation'), 'Invalid CAM worker operation should report validation progress during worker preparation');
    assert(!progressPhases.includes('worker-mesh'), 'Invalid CAM worker operation should not report mesh preparation progress');
  } finally {
    if (originalWorker === undefined) delete (globalThis as any).Worker;
    else (globalThis as any).Worker = originalWorker;
  }
}

export async function test_cam_uses_scene_y_as_machine_z_cut_axis() {
  const solid = makeBoxMeshSolid(12, 4, 20);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_AXIS',
    name: 'Axis Mapping',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 2,
    safeHeight: 1,
  });

  assert(result.targetBounds?.max[0] === 12, 'CAM machine X should come from scene X');
  assert(result.targetBounds?.max[1] === 20, 'CAM machine Y should come from scene Z');
  assert(result.targetBounds?.max[2] === 4, 'CAM machine Z should come from scene Y');
  assert(result.safeZ > 4 && result.safeZ < 6, 'CAM safe Z should clear the scene Y height, not scene Z depth');
  assert(result.paths.every((path) => path.z <= 4 + 1e-6), 'CAM cutting levels should be based on scene Y height');
}

export async function test_cam_default_roughing_cuts_stock_outside_target_silhouette() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const outside = generateThreeAxisToolpath(viewer, {
    id: 'CAM_OUTSIDE',
    name: 'Outside Roughing',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
  });
  assert(outside.paths.length > 0, 'Default outside CAM should generate stock-clearing paths');
  assert(outside.targetBounds?.min?.[0] === 0 && outside.targetBounds?.max?.[0] === 10, 'CAM should preserve target bounds separately from stock bounds');
  assert(outside.bounds?.min?.[0] < 0 && outside.bounds?.max?.[0] > 10, 'CAM stock bounds should expand around the target for outside roughing');
  assert(!pathCrossesTargetInterior(outside.paths, 10), 'Default outside CAM should not cut through the target solid interior');
  assert(!pathViolatesTargetClearance(outside.paths, 10, 0.5), 'Default outside CAM should offset tool centerlines by at least the cutter radius');

  const inside = generateThreeAxisToolpath(viewer, {
    id: 'CAM_INSIDE',
    name: 'Inside Pocket',
    cutRegion: 'inside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(inside.paths.length > 0, 'Inside CAM mode should generate pocket-style paths');
  assert(pathCrossesTargetInterior(inside.paths, 10), 'Inside CAM mode should intentionally cut target interior intervals');
}

export async function test_cam_waterline_raster_respects_sloped_target_surfaces() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_SLOPED_RASTER',
    name: 'Sloped Surface Outside Raster',
    strategy: 'waterline-raster',
    rasterAxis: 'Y',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 1.5,
    stepDown: 1,
    safeHeight: 2,
    stockMargin: 2,
  });

  assert(result.paths.length > 0, 'Outside raster should generate paths around a sloped target');
  assert(result.targetBounds?.max?.[2] === 8, 'Sloped top target should expose the high side as machine Z');
  assert(
    !pathViolatesSlopedTopMaterial(result.paths, 10, 10, 2, 8),
    'Outside raster centerlines should not pass through material below a sloped target surface',
  );
}

export async function test_cam_parallel_finish_projects_sloped_surface_and_alternates_zigzag() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const oneWay = generateThreeAxisToolpath(viewer, {
    id: 'CAM_PARALLEL_ZIG',
    name: 'Parallel Finish One Way',
    strategy: 'parallel-finish-zig',
    rasterAxis: 'X',
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 2,
  });
  assert(oneWay.paths.length >= 3, 'Parallel one-way finish should generate multiple projected passes');
  assert(oneWay.paths.every((path) => path.points[0][0] <= path.points[path.points.length - 1][0]), 'Parallel one-way finish should keep every pass in the same direction');
  assert(oneWay.paths.some((path) => Math.abs(path.points[0][2] - path.points[path.points.length - 1][2]) > 1e-3), 'Parallel finish should project pass Z onto the sloped target surface');
  assert(oneWay.summary.levelCount === 1, 'Parallel finish should report a single projected surface pass set rather than waterline Z levels');

  const zigZag = generateThreeAxisToolpath(viewer, {
    id: 'CAM_PARALLEL_ZIGZAG',
    name: 'Parallel Finish Zig Zag',
    strategy: 'parallel-finish-zig-zag',
    rasterAxis: 'X',
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 2,
  });
  assert(zigZag.paths.length >= 3, 'Parallel zig-zag finish should generate multiple projected passes');
  assert(zigZag.paths[0].points[0][0] < zigZag.paths[0].points[zigZag.paths[0].points.length - 1][0], 'Parallel zig-zag first pass should follow the forward direction');
  assert(zigZag.paths[1].points[0][0] > zigZag.paths[1].points[zigZag.paths[1].points.length - 1][0], 'Parallel zig-zag second pass should reverse direction');
  assert(zigZag.simulation.motionSegments.some((segment) => segment.kind === 'rapid'), 'Parallel zig-zag simulation should include linking motion between projected passes');
}

export async function test_cam_parallel_finish_respects_raster_angle() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const angled = generateThreeAxisToolpath(viewer, {
    id: 'CAM_PARALLEL_ANGLE',
    name: 'Parallel Finish Angle',
    strategy: 'parallel-finish-zig',
    rasterAngleDeg: 45,
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 2,
  });
  const diagonalPath = angled.paths.find((path) => {
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    return Math.hypot(last[0] - first[0], last[1] - first[1]) > 1;
  });

  assert(angled.paths.length >= 3, 'Angled parallel finish should generate multiple projected passes');
  assert(diagonalPath, 'Angled parallel finish should include a non-degenerate projected path');
  const first = diagonalPath!.points[0];
  const last = diagonalPath!.points[diagonalPath!.points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  assert(Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5, 'Angled parallel finish should not collapse to an axis-aligned raster');
  assert(Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-3, 'A 45 degree parallel finish should generate diagonal source passes');
  assert(angled.paths.some((path) => Math.abs(path.points[0][2] - path.points[path.points.length - 1][2]) > 1e-3), 'Angled parallel finish should project pass Z onto the sloped target surface');
}

export async function test_cam_parallel_finish_cut_direction_preference_forbids_zigzag_reversal() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const base = {
    strategy: 'parallel-finish-zig-zag',
    rasterAxis: 'X',
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 2,
  };
  const auto = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_AUTO_DIRECTION',
    name: 'Parallel Auto Direction',
    cutDirection: 'auto',
  });
  const climb = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_CLIMB_DIRECTION',
    name: 'Parallel Climb Direction',
    cutDirection: 'climb',
  });
  const conventional = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_CONVENTIONAL_DIRECTION',
    name: 'Parallel Conventional Direction',
    cutDirection: 'conventional',
  });
  const xDelta = (path: any) => path.points[path.points.length - 1][0] - path.points[0][0];

  assert(auto.paths.length >= 3 && climb.paths.length === auto.paths.length && conventional.paths.length === auto.paths.length, 'Direction preference regression should generate comparable parallel pass sets');
  assert(xDelta(auto.paths[0]) > 0 && xDelta(auto.paths[1]) < 0, 'Automatic zig-zag should still reverse alternate parallel finish passes');
  assert(climb.paths.every((path: any) => xDelta(path) > 0), 'Climb preference should keep all zig-zag parallel finish passes in the forward cutting direction');
  assert(conventional.paths.every((path: any) => xDelta(path) < 0), 'Conventional preference should keep all zig-zag parallel finish passes in the reverse cutting direction');
}

export async function test_cam_parallel_finish_low_hop_links_projected_passes_below_safe_height() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const base = {
    strategy: 'parallel-finish-zig-zag',
    rasterAxis: 'X',
    toolShape: 'ball',
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 8,
  };
  const retract = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_RETRACT_LINKS',
    name: 'Parallel Retract Links',
    linkMode: 'retract',
  });
  const lowHop = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_LOW_HOP_LINKS',
    name: 'Parallel Low Hop Links',
    linkMode: 'low-hop',
  });
  const retractCount = (result: any) => result.simulation.motionSegments.filter((segment: any) => segment.kind === 'retract').length;
  const lowHopLinks = lowHop.simulation.motionSegments.filter((segment: any) => (
    segment.kind === 'link'
    && Math.max(Number(segment.start?.[2]), Number(segment.end?.[2])) < lowHop.safeZ - 1e-6
  ));

  assert(retract.paths.length > lowHop.paths.length, 'Parallel low-hop link mode should combine adjacent projected passes when local clearance is available');
  assert(retractCount(lowHop) < retractCount(retract), 'Parallel low-hop link mode should reduce full safe-height retracts');
  assert(lowHopLinks.length > 0, 'Parallel low-hop link mode should emit below-safe link motion between projected passes');
  assert(!lowHopLinks.some((link: any) => (
    lowHop.simulation.sweptSegments.some((segment: any) => (
      pointsNearlyEqual(segment.start, link.start)
      && pointsNearlyEqual(segment.end, link.end)
    ))
  )), 'Parallel low-hop links should not be included in swept material-removal segments');
}

export async function test_cam_parallel_finish_feed_link_falls_back_when_direct_link_is_unsafe() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const base = {
    strategy: 'parallel-finish-zig-zag',
    rasterAxis: 'X',
    toolShape: 'ball',
    toolDiameter: 1,
    stepover: 3,
    sampleSpacing: 20,
    minSampleSpacing: 0.25,
    safeHeight: 8,
  };
  const retract = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_RETRACT_FOR_FEED_LINK',
    name: 'Parallel Retract For Feed Link',
    linkMode: 'retract',
  });
  const feedLink = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_PARALLEL_FEED_LINK_UNSAFE',
    name: 'Parallel Unsafe Feed Link',
    linkMode: 'feed-link',
  });
  const linkSegments = feedLink.simulation.motionSegments.filter((segment: any) => segment.kind === 'link');

  assert(feedLink.paths.length === retract.paths.length, 'Parallel feed-link should leave passes separate when a direct link is not proven clear of protected material');
  assert(linkSegments.length === 0, 'Parallel feed-link should fall back to retract motion instead of using low-hop link moves when direct feed linking is unsafe');
  assert(feedLink.simulation.motionSegments.some((segment: any) => segment.kind === 'retract'), 'Unsafe parallel feed-link fallback should still include full retract motion');
}

export async function test_cam_parallel_finish_selected_face_drives_region_and_preserves_protected_mesh() {
  const solid = makeFaceTaggedSplitTopSurfaceSolid();
  const viewer = makeViewerWithSolid(solid);
  const selected = generateThreeAxisToolpath(viewer, {
    id: 'CAM_FACE_FINISH',
    name: 'Selected Face Finish',
    targetSolids: [solid.name],
    targetFaces: ['LEFT_TOP'],
    strategy: 'parallel-finish-zig',
    rasterAxis: 'Y',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2.5,
    sampleSpacing: 20,
    safeHeight: 2,
    floorZ: 0,
  });
  assert(selected.paths.length > 0, 'Selected-face parallel finish should generate paths on the drive face');
  const selectedXs = selected.paths.flatMap((path) => path.points.map((point) => point[0]));
  assert(Math.min(...selectedXs) >= 0.5 - 1e-6, 'Selected-face finishing should keep cutter centers at least one radius inside the selected face boundary');
  assert(Math.max(...selectedXs) <= 4.5 + 1e-6, 'Selected-face finishing should not let the cutter radius cross onto adjacent unselected faces');
  assert(selected.targetBounds?.max?.[0] === 10, 'Selected-face finishing should keep the full owning mesh as protected target bounds');
  assert(selected.summary.triangleCount === 4, 'Selected-face finishing should retain all protected mesh triangles');
  assert(!selected.warnings.some((warning) => String(warning).includes('No toolpath intervals')), 'Selected-face finishing should not report empty generation when the face has drive triangles');

  const payload = collectCamTargetMeshPayloads(viewer, [solid.name], ['LEFT_TOP']);
  assert(payload.targets[0]?.triangles?.length === 36, 'Worker CAM payload should serialize the full protected mesh');
  assert(payload.targets[0]?.driveTriangles?.length === 18, 'Worker CAM payload should serialize selected drive-face triangles separately');
  assert(payload.targets[0]?.faceNames?.join('|') === 'LEFT_TOP', 'Worker CAM payload should retain selected face names');

  const full = generateThreeAxisToolpath(viewer, {
    id: 'CAM_FULL_FINISH',
    name: 'Full Finish',
    targetSolids: [solid.name],
    strategy: 'parallel-finish-zig',
    rasterAxis: 'Y',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2.5,
    sampleSpacing: 20,
    safeHeight: 2,
    floorZ: 0,
  });
  const fullXs = full.paths.flatMap((path) => path.points.map((point) => point[0]));
  assert(Math.max(...fullXs) >= 9.5 - 1e-6, 'Unscoped parallel finish should cover the full target footprint up to cutter-radius boundary clearance');

  const allowance = generateThreeAxisToolpath(viewer, {
    id: 'CAM_FACE_ALLOWANCE_FINISH',
    name: 'Selected Face Finish With Stock Allowance',
    targetSolids: [solid.name],
    targetFaces: ['LEFT_TOP'],
    strategy: 'parallel-finish-zig',
    rasterAxis: 'Y',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2.5,
    sampleSpacing: 20,
    safeHeight: 2,
    floorZ: 0,
    stockAllowance: 0.5,
  });
  const allowanceXs = allowance.paths.flatMap((path) => path.points.map((point) => point[0]));
  assert(Math.min(...allowanceXs) >= 1 - 1e-6, 'Parallel finish stock allowance should add to cutter-radius selected-face boundary clearance');
  assert(Math.max(...allowanceXs) <= 4 + 1e-6, 'Parallel finish stock allowance should preserve extra material near adjacent protected faces');

  let blockedMessage = '';
  try {
    generateThreeAxisToolpath(viewer, {
      id: 'CAM_FACE_BLOCKED_FINISH',
      name: 'Blocked Selected Face Finish',
      targetSolids: [solid.name],
      targetFaces: ['LEFT_TOP'],
      strategy: 'parallel-finish-zig',
      rasterAxis: 'Y',
      toolShape: 'flat',
      toolDiameter: 20,
      stepover: 2.5,
      sampleSpacing: 20,
      safeHeight: 2,
      floorZ: 0,
    });
  } catch (error) {
    blockedMessage = String((error as any)?.message || error || '');
  }
  assert(blockedMessage.includes('Blocked Selected Face Finish'), 'Selected-face failure feedback should name the affected CAM operation');
  assert(blockedMessage.includes('selected faces'), 'Selected-face failure feedback should explain that no safe cutter locations were produced for the selected faces');

  const missingParams = {
    id: 'CAM_MISSING_FACE_FINISH',
    name: 'Missing Face Finish',
    targetSolids: [solid.name],
    targetFaces: ['MISSING_FACE'],
    strategy: 'parallel-finish-zig',
    rasterAxis: 'Y',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2.5,
    sampleSpacing: 20,
    safeHeight: 2,
    floorZ: 0,
  };
  assertThrowsWithMessage(
    () => generateThreeAxisToolpath(viewer, missingParams),
    'Selected CAM faces produced no valid finishing region',
    'Missing selected CAM faces should stop generation instead of falling back to machining the whole solid',
  );
  const missingPayload = collectCamTargetMeshPayloads(viewer, [solid.name], ['MISSING_FACE']);
  assert(!missingPayload.targets[0]?.driveTriangles?.length && missingPayload.targets[0]?.faceNames?.join('|') === 'MISSING_FACE', 'Worker CAM payload should preserve an empty selected-face region instead of erasing the face selection');
  await assertRejectsWithMessage(
    () => generateThreeAxisToolpathAsync(null, {
      ...missingParams,
      targetSolids: [],
      targetFaces: [],
      targetMeshes: missingPayload.targets,
      targetCount: missingPayload.targetCount,
    }),
    'Selected CAM faces produced no valid finishing region',
    'Serialized selected-face CAM jobs should stop generation when face names resolve to no drive triangles',
  );

  const triangularSolid = makeFaceTaggedTriangularTopSurfaceSolid();
  const triangularViewer = makeViewerWithSolid(triangularSolid);
  const triangular = generateThreeAxisToolpath(triangularViewer, {
    id: 'CAM_TRIANGLE_FACE_FINISH',
    name: 'Triangle Face Finish',
    targetSolids: [triangularSolid.name],
    targetFaces: ['TRIANGLE_TOP'],
    strategy: 'parallel-finish-zig',
    rasterAxis: 'X',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2.5,
    sampleSpacing: 20,
    safeHeight: 2,
    floorZ: 0,
  });
  assert(triangular.paths.length > 0, 'Triangular selected-face parallel finish should generate paths on the selected drive face');
  assert(
    triangular.paths.every((path) => path.points.every((point) => point[0] + point[1] <= 9.5 + 1e-6)),
    'Selected-face parallel finish should keep cutter centers inside a non-rectangular selected face by the cutter radius',
  );
  assert(triangular.summary.triangleCount === 2, 'Triangular selected-face finishing should keep adjacent unselected faces in the protected mesh');
  const triangularPayload = collectCamTargetMeshPayloads(triangularViewer, [triangularSolid.name], ['TRIANGLE_TOP']);
  assert(triangularPayload.targets[0]?.triangles?.length === 18 && triangularPayload.targets[0]?.driveTriangles?.length === 9, 'Worker CAM payload should serialize full protected geometry and triangular drive geometry separately');
}

export async function test_cam_waterline_contour_missing_selected_faces_does_not_fallback_to_whole_solid() {
  const solid = makeFaceTaggedSplitTopSurfaceSolid();
  const viewer = makeViewerWithSolid(solid);
  for (const strategy of ['waterline-contour', 'adaptive-waterline-contour', 'waterline-contour-low-hop']) {
    assertThrowsWithMessage(
      () => generateThreeAxisToolpath(viewer, {
        id: `CAM_MISSING_FACE_${strategy}`,
        name: `Missing Face ${strategy}`,
        targetSolids: [solid.name],
        targetFaces: ['MISSING_FACE'],
        strategy,
        cutRegion: 'outside',
        toolShape: 'flat',
        toolDiameter: 1,
        stepover: 2,
        stepDown: 2,
        safeHeight: 2,
        stockMargin: 2,
      }),
      'Selected CAM faces produced no valid finishing region',
      `${strategy} should stop generation instead of falling back to whole-solid machining when selected faces are missing`,
    );
  }
}

export async function test_cam_waterline_raster_protects_higher_cross_sections() {
  const solid = makeOutwardSlopedTopMeshSolid(10, 8, 3);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_HIGHER_SECTION_GUARD',
    name: 'Higher Section Guard',
    strategy: 'waterline-raster',
    rasterAxis: 'Y',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 1,
    stepDown: 2,
    safeHeight: 2,
    stockMargin: 2,
  });

  assert(result.paths.length > 0, 'Outside raster should generate paths around an outward-sloped target');
  assert(
    !pathEntersFootprintBelowZ(result.paths, 0, 0, 10, 10, 2),
    'Outside raster should keep low-level cuts outside higher protected cross-sections',
  );
}

export async function test_cam_waterline_contour_offsets_cross_section_loops() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const contour = generateThreeAxisToolpath(viewer, {
    id: 'CAM_CONTOUR',
    name: 'Outside Contour',
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
  });
  assert(contour.paths.length > 0, 'Waterline contour CAM should generate cross-section contour paths');
  assert(contour.paths.length >= 3, 'Waterline contour CAM should emit multiple weave-seeded offset passes within the stock bounds');
  assert(contour.paths.every((path) => path.points.length >= 4), 'Waterline contour paths should contain closed loop polylines');
  assert(contour.paths.every((path) => {
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    return Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6 && Math.abs(first[2] - last[2]) < 1e-6;
  }), 'Waterline contour paths should close back to their start point');
  assert(!pathCrossesTargetInterior(contour.paths, 10), 'Outside waterline contour should not cut through the target solid interior');
  assert(!pathViolatesTargetClearance(contour.paths, 10, 0.5), 'Outside waterline contour should offset centerlines by the cutter radius');
  assert(contour.gcode.includes('G1 X'), 'Waterline contour G-code should emit XY cutting moves');

  const inside = generateThreeAxisToolpath(viewer, {
    id: 'CAM_INSIDE_CONTOUR',
    name: 'Inside Contour',
    strategy: 'waterline-contour',
    cutRegion: 'inside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(inside.paths.length > 0, 'Inside waterline contour should generate inset cross-section loops');
  assert(inside.paths.length >= 4, 'Inside waterline contour should emit multiple inset passes before the section collapses');
  assert(pathCrossesTargetInterior(inside.paths, 10), 'Inside waterline contour should remain within the target section');
}

export async function test_cam_waterline_null_cut_depths_use_target_bounds() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const result = generateThreeAxisToolpath(viewer, {
    id: 'CAM_NULL_DEPTHS',
    name: 'Null Depth Contour',
    targetSolids: [solid.name],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 2,
    safeHeight: 2,
    stockMargin: 3,
    topZ: null,
    bottomZ: null,
    enablePathOrdering: false,
  });
  const zLevels = [...new Set(result.paths.map((path) => path.z))];
  assert(result.summary.levelCount > 1, 'Null top/bottom cut depths should fall back to the target Z bounds');
  assert(zLevels.length > 1 && Math.max(...zLevels) > 0, 'Null cut depths should generate waterline paths above the target bottom');
  assert(nearlyEqual(Math.min(...zLevels), 0), 'Null-depth waterline contour should include the target bottom Z as the final level');
  assert(!pathCrossesTargetInterior(result.paths, 10), 'Null-depth outside contour should still protect the target solid interior');

  const clamped = generateThreeAxisToolpath(viewer, {
    id: 'CAM_CLAMPED_DEPTHS',
    name: 'Clamped Depth Contour',
    targetSolids: [solid.name],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 2,
    safeHeight: 2,
    stockMargin: 3,
    topZ: 100,
    bottomZ: -100,
    enablePathOrdering: false,
  });
  const clampedZLevels = [...new Set(clamped.paths.map((path) => path.z))];
  assert(clamped.summary.levelCount === result.summary.levelCount, 'Out-of-range waterline cut depths should clamp to the same target-bound Z levels');
  assert(Math.max(...clampedZLevels) <= Math.max(...zLevels) + 1e-6 && Math.min(...clampedZLevels) >= Math.min(...zLevels) - 1e-6, 'Clamped waterline levels should stay within target-bound null-depth levels');
  assert(!clamped.warnings.some((warning) => warning.includes('requested cut depth 200')), 'Clamped cut depths should not report cutter-length warnings from raw out-of-range depth input');

  const fractionalBottom = generateThreeAxisToolpath(viewer, {
    id: 'CAM_FRACTIONAL_BOTTOM_DEPTH',
    name: 'Fractional Bottom Contour',
    targetSolids: [solid.name],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolShape: 'flat',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 2,
    safeHeight: 2,
    stockMargin: 3,
    topZ: 9,
    bottomZ: 1.25,
    enablePathOrdering: false,
  });
  const fractionalZLevels = [...new Set(fractionalBottom.paths.map((path) => path.z))];
  assert(nearlyEqual(Math.min(...fractionalZLevels), 1.25), 'Waterline contour should include requested bottom Z exactly when stepDown does not divide the cut depth');
}

async function makeGeneratedCamContourFailurePartHistory() {
  const partHistory = new PartHistory();
  partHistory.expressions = "//Examples:\nx = 10 + 6; \ny = x * 2;\n\nresolution = 32;\n";
  partHistory.configurator = { fields: [], values: {} };

  const cube = await partHistory.newFeature('P.CU');
  Object.assign(cube.inputParams, {
    id: 'P.CU1',
    sizeX: 10,
    sizeY: 10,
    sizeZ: 10,
    transform: { position: [0, 0, 0], rotationEuler: [0, 0, 0], scale: [1, 1, 1] },
    boolean: { targets: [], operation: 'NONE', overlapConditioningEnabled: true },
  });

  const holeSketch = await partHistory.newFeature('S');
  Object.assign(holeSketch.inputParams, {
    id: 'S2',
    sketchPlane: 'P.CU1_PY',
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 'resolution',
  });
  holeSketch.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: 1.116238, y: -2.608167, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [{ id: 1, type: 'circle', points: [0, 1], construction: false }],
      constraints: [{ id: 0, type: '\u23da', points: [0], status: 'solved', error: null }],
    },
  };

  const holeCut = await partHistory.newFeature('E');
  Object.assign(holeCut.inputParams, {
    id: 'E3',
    profile: 'S2:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: ['P.CU1'], operation: 'SUBTRACT', overlapConditioningEnabled: true },
  });

  const chamfer = await partHistory.newFeature('CH');
  Object.assign(chamfer.inputParams, {
    id: 'CH4',
    edges: ['E3:S2:G1_SW|P.CU1_PY[0]'],
    distance: 1,
    inflate: 0.1,
    direction: 'AUTO',
    debug: 'NONE',
  });

  const sideSketch = await partHistory.newFeature('S');
  Object.assign(sideSketch.inputParams, {
    id: 'S5',
    sketchPlane: 'P.CU1_PX',
    editSketch: null,
    dumpSketchDiagnostics: null,
    curveResolution: 'resolution',
  });
  sideSketch.persistentData = {
    sketch: {
      points: [
        { id: 0, x: 0, y: 0, fixed: true, construction: true, externalReference: false },
        { id: 1, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 2, x: 1.345003, y: 6.007376, fixed: false, construction: false, externalReference: false },
        { id: 4, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 5, x: -5.948429, y: -1.76656, fixed: false, construction: false, externalReference: false },
        { id: 6, x: -7.869525, y: 8.202379, fixed: false, construction: false, externalReference: false },
        { id: 7, x: -7.869525, y: 8.202379, fixed: false, construction: false, externalReference: false },
        { id: 8, x: 1.345003, y: 6.007376, fixed: false, construction: false, externalReference: false },
      ],
      geometries: [
        { id: 1, type: 'line', points: [1, 2], construction: false },
        { id: 3, type: 'line', points: [5, 6], construction: false },
        { id: 4, type: 'line', points: [7, 8], construction: false },
      ],
      constraints: [
        { id: 0, type: '\u23da', points: [0], status: 'solved', error: null },
        { id: 2, type: '\u2261', points: [1, 4], status: 'solved', error: null },
        { id: 3, type: '\u2261', points: [4, 5], status: 'solved', error: null },
        { id: 4, type: '\u2261', points: [6, 7], status: 'solved', error: null },
        { id: 5, type: '\u2261', points: [2, 8], status: 'solved', error: null },
      ],
    },
  };

  const sideCut = await partHistory.newFeature('E');
  Object.assign(sideCut.inputParams, {
    id: 'E6',
    profile: 'S5:PROFILE',
    consumeProfileSketch: true,
    distance: 10,
    distanceBack: 10,
    boolean: { targets: ['P.CU1'], operation: 'SUBTRACT', overlapConditioningEnabled: true },
  });

  const cylinder = await partHistory.newFeature('P.CY');
  Object.assign(cylinder.inputParams, {
    id: 'P.CY8',
    radius: 5,
    height: 10,
    resolution: 'resolution',
    transform: {
      position: [3.900050910184973, 0, 13.054629944047662],
      rotationEuler: [0, 0, 0],
      scale: [1, 1, 1],
    },
    boolean: { targets: ['P.CU1'], operation: 'UNION', overlapConditioningEnabled: true },
  });

  await partHistory.runHistory();
  return partHistory;
}

export async function test_cam_waterline_contour_generated_history_20260702094950_uses_full_depths() {
  const partHistory = await makeGeneratedCamContourFailurePartHistory();
  const result = generateThreeAxisToolpath({ scene: partHistory.scene, partHistory }, {
    id: 'CAM31',
    name: '3 Axis Raster',
    targetSolids: ['P.CU1'],
    targetFaces: [],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolShape: 'flat',
    toolDiameter: 3.175,
    toolLength: 25,
    stepover: 1.5,
    stepDown: 1,
    stockAllowance: 0,
    safeHeight: 5,
    topZ: null,
    bottomZ: null,
    feedRate: 800,
    plungeRate: 200,
    spindleRPM: 12000,
    stockProfile: {
      mode: 'auto',
      margin: 6.35,
      sizeX: null,
      sizeY: null,
      sizeZ: null,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    },
    enablePathOrdering: false,
  });
  const zLevels = [...new Set(result.paths.map((path) => path.z))];
  assert(result.summary.levelCount > 1, 'Generated-history contour should use full target depth when top/bottom Z are null');
  assert(zLevels.length > 1 && Math.max(...zLevels) > 0, 'Generated-history contour should produce paths above the bottom level');
  assert(result.paths.length > 0, 'Generated-history outside contour should produce clipped safe toolpath segments');
  assert(!result.warnings.some((warning) => String(warning).includes('No toolpath intervals')), 'Generated-history contour should not reject every outside contour loop');
  const targetSolid = partHistory.scene?.getObjectByName?.('P.CU1') || partHistory.getObjectByName?.('P.CU1');
  const targetTriangles = extractTrianglesFromSolid(targetSolid);
  assert(targetTriangles.length > 0, 'Generated-history contour safety check should extract target mesh triangles');
  assert(
    !sweptSegmentsIntersectTargetMeshMaterial(result.simulation.sweptSegments, targetTriangles, result.toolDiameter * 0.5),
    'Generated-history outside contour swept cutter volume should not intersect protected target material',
  );
  const unsafeMotion = firstConservativeMotionTargetMeshIntersection(
    result.simulation.motionSegments,
    targetTriangles,
    result.toolDiameter * 0.5,
    result.safeZ,
    result.cutterProfile,
  );
  assert(
    !unsafeMotion,
    `Generated-history outside contour motion should not drive the cutter through protected target material: ${JSON.stringify(unsafeMotion)}`,
  );
}

export async function test_cam_waterline_contour_line_filter_keeps_generated_history_clear_of_solid() {
  const partHistory = await makeGeneratedCamContourFailurePartHistory();
  const result = generateThreeAxisToolpath({ scene: partHistory.scene, partHistory }, {
    id: 'CAM31_FILTERED',
    name: '3 Axis Raster',
    targetSolids: ['P.CU1'],
    targetFaces: [],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolShape: 'flat',
    toolDiameter: 3.175,
    toolLength: 25,
    stepover: 1.5,
    stepDown: 1,
    stockAllowance: 0,
    safeHeight: 5,
    topZ: null,
    bottomZ: null,
    feedRate: 800,
    plungeRate: 200,
    spindleRPM: 12000,
    filterTolerance: 4,
    stockProfile: {
      mode: 'auto',
      margin: 6.35,
      sizeX: null,
      sizeY: null,
      sizeZ: null,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    },
  });
  assert(result.paths.length > 0, 'Filtered generated-history contour should still produce safe paths');
  const targetSolid = partHistory.scene?.getObjectByName?.('P.CU1') || partHistory.getObjectByName?.('P.CU1');
  const targetTriangles = extractTrianglesFromSolid(targetSolid);
  assert(
    !sweptSegmentsIntersectTargetMeshMaterial(result.simulation.sweptSegments, targetTriangles, result.toolDiameter * 0.5),
    'Filtered outside contour swept cutter volume should not intersect protected target material',
  );
  const unsafeMotion = firstConservativeMotionTargetMeshIntersection(
    result.simulation.motionSegments,
    targetTriangles,
    result.toolDiameter * 0.5,
    result.safeZ,
    result.cutterProfile,
  );
  assert(
    !unsafeMotion,
    `Filtered outside contour motion should not shortcut through protected target material: ${JSON.stringify(unsafeMotion)}`,
  );
}

export async function test_cam_waterline_contour_uses_push_weave_seed_loop() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const contour = generateThreeAxisToolpath(viewer, {
    id: 'CAM_WEAVE_CONTOUR',
    name: 'Weave Contour',
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
  });
  const weavePath = contour.paths.find((path) => String(path.id || '').startsWith('W'));
  assert(weavePath, 'Outside waterline contour should use push-cutter weave seed loops when available');
  const xs = weavePath!.points.map((point) => point[0]);
  const ys = weavePath!.points.map((point) => point[1]);
  assert(Math.min(...xs) <= -0.5 + 1e-6 && Math.max(...xs) >= 10.5 - 1e-6, 'Weave-seeded contour should include cutter-radius-expanded X bounds');
  assert(Math.min(...ys) <= -0.5 + 1e-6 && Math.max(...ys) >= 10.5 - 1e-6, 'Weave-seeded contour should include cutter-radius-expanded Y bounds');
  assert(!pathViolatesTargetClearance([weavePath], 10, 0.5), 'Weave-seeded contour should preserve cutter-radius clearance around the target');

  const bruteForceContour = generateThreeAxisToolpath(viewer, {
    id: 'CAM_WEAVE_CONTOUR_BRUTE',
    name: 'Weave Contour Brute',
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
    disableWaterlinePushIndex: true,
  });
  const pathSignature = (result: any) => (result.paths || []).map((path: any) => (
    `${path.id}:${path.points.map((point: any) => point.join(',')).join('|')}`
  )).join('\n');
  assert(pathSignature(contour) === pathSignature(bruteForceContour), 'Indexed waterline push-cutter seed loops should match brute-force push-cutter output');
}

export async function test_cam_adaptive_waterline_contour_generates_weave_loops_and_summary() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const adaptive = generateThreeAxisToolpath(viewer, {
    id: 'CAM_ADAPTIVE_WATERLINE',
    name: 'Adaptive Waterline',
    strategy: 'adaptive-waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    sampleSpacing: 4,
    minSampleSpacing: 0.5,
    flatnessCosLimit: 0.999,
    safeHeight: 2,
    stockMargin: 3,
  });

  assert(adaptive.paths.length > 0, 'Adaptive waterline contour should generate toolpath loops');
  assert(adaptive.paths.some((path) => String(path.id || '').startsWith('W')), 'Adaptive waterline should use push/weave seed loops');
  assert((adaptive.summary.waterlineXFiberCount || 0) >= 2, 'Adaptive waterline summary should report accepted X fibers');
  assert((adaptive.summary.waterlineYFiberCount || 0) >= 2, 'Adaptive waterline summary should report accepted Y fibers');
  assert((adaptive.summary.waterlineSubdivisionCount || 0) > 0, 'Adaptive waterline should subdivide coarse start/stop fibers when spacing exceeds the maximum');
  assert(adaptive.summary.waterlineMaxDepthReached === false, 'Adaptive waterline should avoid max-depth warnings on a simple cube');
  assert(!pathViolatesTargetClearance(adaptive.paths, 10, 0.5), 'Adaptive waterline outside contours should preserve cutter-radius clearance');
  assert(adaptive.gcode.includes('G1 X'), 'Adaptive waterline G-code should emit XY cutting moves');

  const fineUniform = generateThreeAxisToolpath(viewer, {
    id: 'CAM_FINE_UNIFORM_WATERLINE',
    name: 'Fine Uniform Waterline',
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    sampleSpacing: 0.5,
    safeHeight: 2,
    stockMargin: 3,
  });
  const adaptiveFiberCount = (adaptive.summary.waterlineXFiberCount || 0) + (adaptive.summary.waterlineYFiberCount || 0);
  const uniformFiberCount = (fineUniform.summary.waterlineXFiberCount || 0) + (fineUniform.summary.waterlineYFiberCount || 0);
  assert(uniformFiberCount > adaptiveFiberCount, 'Adaptive waterline should use fewer accepted fibers than a fine uniform waterline on a simple cube');
  assert(uniformFiberCount > 20, 'Uniform waterline contour should honor the public sampleSpacing parameter for fiber density');
}

export async function test_cam_adaptive_waterline_contour_clears_circular_through_hole() {
  const result = generateThreeAxisToolpath(null, {
    id: 'CAM_ADAPTIVE_HOLE_CONTOUR',
    name: 'Adaptive Hole Contour',
    targetMeshes: [{
      name: 'plate-with-circular-hole',
      triangles: makeSerializedCamPlateWithCircularHoleTriangles(64),
    }],
    targetCount: 1,
    strategy: 'adaptive-waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 2,
    stepover: 2,
    stepDown: 5,
    sampleSpacing: 4,
    minSampleSpacing: 0.5,
    flatnessCosLimit: 0.999,
    safeHeight: 2,
    stockMargin: 2,
    enablePathOrdering: false,
  });
  const holePasses = result.paths.filter((path) => {
    if (!pointsNearlyEqual(path.points[0], path.points[path.points.length - 1], 1e-5)) return false;
    const xs = path.points.map((point) => point[0]);
    const ys = path.points.map((point) => point[1]);
    return Math.min(...xs) > 5 && Math.max(...xs) < 15 && Math.min(...ys) > 5 && Math.max(...ys) < 15;
  });
  const widths = holePasses.map((path) => {
    const xs = path.points.map((point) => point[0]);
    return Math.max(...xs) - Math.min(...xs);
  }).sort((a, b) => b - a);
  assert(holePasses.length >= 2, 'Adaptive outside waterline should emit multiple inward passes for a through-hole instead of only tracing the perimeter');
  assert(widths[1] < widths[0] - 1, 'Adaptive through-hole waterline should continue inward after the zero-offset seed pass');
}

export async function test_cam_waterline_contour_strategies_clear_circular_through_hole() {
  const strategies = ['waterline-contour', 'adaptive-waterline-contour', 'waterline-contour-low-hop'];
  for (const strategy of strategies) {
    const result = generateThreeAxisToolpath(null, {
      id: `CAM_HOLE_${strategy}`,
      name: `Hole ${strategy}`,
      targetMeshes: [{
        name: 'plate-with-circular-hole',
        triangles: makeSerializedCamPlateWithCircularHoleTriangles(64),
      }],
      targetCount: 1,
      strategy,
      cutRegion: 'outside',
      toolShape: 'ball',
      toolDiameter: 1,
      toolLength: 25,
      stepover: 1.5,
      stepDown: 5,
      safeHeight: 2,
      stockMargin: 2,
      enablePathOrdering: false,
    });
    const holePoints = result.paths
      .flatMap((path) => path.points || [])
      .filter((point) => point[0] > 4 && point[0] < 16 && point[1] > 4 && point[1] < 16);
    const radii = holePoints.map((point) => Math.hypot(point[0] - 10, point[1] - 10));
    assert(holePoints.length > 0, `${strategy} should generate cutter-center points inside the circular through-hole`);
    assert(Math.max(...radii) >= 3.25, `${strategy} should trace the through-hole boundary`);
    assert(Math.min(...radii) <= 0.65, `${strategy} should continue inward far enough to clear the through-hole center`);
  }
}

export function test_cam_operation_ui_exposes_face_targets_for_contour_finishing() {
  const schema = (CamOperationEntity.inputParamsSchema || {}) as any;
  const schemaOptionValues = (key: string) => (schema[key]?.options || []).map((option: any) => String(option?.value ?? option));
  const schemaOptionLabels = (key: string) => (schema[key]?.options || []).map((option: any) => String(option?.label ?? option));
  const excludedFor = (strategy: string) => new Set(CamOperationEntity.uiFieldsTest({ params: { strategy } }).exclude || []);
  assert(schema.name?.default_value === '3 Axis CAM Operation', 'CAM operation default name should not imply a raster-only strategy');
  assert(schema.strategy?.default_value === 'waterline-contour', 'CAM operation default strategy should use the selected user-facing contour strategy');
  assert(schemaOptionValues('strategy').join('|') === 'waterline-contour|adaptive-waterline-contour|waterline-contour-low-hop|parallel-finish-zig|parallel-finish-zig-zag', 'CAM strategy schema should list selected user-facing strategy values');
  assert(schemaOptionLabels('strategy').join('|') === 'Waterline Contour|Adaptive Waterline Contour|Waterline Contour Low-Hop|Surface Finish Zig|Surface Finish Zig-Zag', 'CAM strategy schema should provide user-facing option labels');
  assert(schemaOptionValues('toolShape').join('|') === 'flat|ball|bull|cone|ball-cone', 'CAM tool shape schema should preserve serialized option values');
  assert(schemaOptionLabels('toolShape').join('|') === 'Flat End Mill|Ball End Mill|Bull Nose|Cone|Ball-Cone', 'CAM tool shape schema should provide user-facing cutter labels');
  assert(schema.toolLength?.label === 'Cutting Length', 'CAM cutter length field should use cutter-shape terminology instead of visual-only wording');
  assert(String(schema.toolLength?.hint || '').includes('cutting length'), 'CAM cutter length hint should describe the usable cutting length');
  assert(schema.shaftLength?.default_value === 0, 'CAM shaft length should be an explicit advanced cutter parameter');
  assert(schema.shaftLength?.uiGroup?.key === 'advanced', 'CAM shaft length should stay in the collapsed advanced group');
  assert(schema.stockAllowance?.uiGroup?.key === 'advanced', 'CAM stock allowance should stay in advanced tuning instead of primary setup');
  assert(schema.rasterAngleDeg?.uiGroup?.key === 'advanced', 'CAM optional raster angle should stay in advanced tuning instead of primary setup');
  assert(schema.cutDirection?.uiGroup?.key === 'advanced', 'CAM climb/conventional preference should stay in advanced tuning instead of primary setup');
  assert(!excludedFor('waterline-contour').has('targetFaces'), 'Waterline contour should expose optional face-target drive controls');
  assert(excludedFor('waterline-contour').has('rasterAngleDeg'), 'Waterline contour should hide parallel finish angle controls');
  assert(excludedFor('waterline-contour').has('cutDirection'), 'Waterline contour should hide parallel finish cut-direction controls');
  assert(!excludedFor('waterline-contour').has('sampleSpacing'), 'Waterline contour should expose uniform fiber sampling spacing');
  assert(excludedFor('waterline-contour').has('minSampleSpacing') && excludedFor('waterline-contour').has('flatnessCosLimit'), 'Uniform waterline contour should hide adaptive-only sampling controls');
  assert(!excludedFor('waterline-contour').has('filterTolerance'), 'Waterline contour should expose optional line-filter simplification controls');
  assert(excludedFor('waterline-contour').has('floorZ'), 'Waterline contour should hide surface-finish floor-Z controls');
  assert(!excludedFor('adaptive-waterline-contour').has('targetFaces'), 'Adaptive waterline contour should expose optional face-target drive controls');
  assert(!excludedFor('adaptive-waterline-contour').has('filterTolerance'), 'Adaptive waterline contour should expose optional line-filter simplification controls');
  assert(!excludedFor('waterline-contour-low-hop').has('targetFaces'), 'Low-hop waterline contour should expose optional face-target drive controls');
  assert(!excludedFor('waterline-contour-low-hop').has('sampleSpacing'), 'Low-hop waterline contour should expose uniform fiber sampling spacing');
  assert(excludedFor('waterline-contour-low-hop').has('minSampleSpacing') && excludedFor('waterline-contour-low-hop').has('flatnessCosLimit'), 'Low-hop waterline contour should hide adaptive-only sampling controls');
  assert(!excludedFor('waterline-contour-low-hop').has('filterTolerance'), 'Low-hop waterline contour should expose optional line-filter simplification controls');
  assert(excludedFor('waterline-contour-low-hop').has('linkMode'), 'Low-hop waterline contour should hide redundant link-mode controls');
  assert(!excludedFor('parallel-finish-zig').has('targetFaces'), 'Parallel finish should expose optional face-target drive controls');
  assert(!excludedFor('parallel-finish-zig').has('rasterAngleDeg'), 'Parallel finish should expose optional cutting angle controls');
  assert(!excludedFor('parallel-finish-zig').has('cutDirection'), 'Parallel finish should expose cut-direction preference controls');
  assert(!excludedFor('parallel-finish-zig').has('filterTolerance'), 'Parallel finish should expose optional line-filter simplification controls');
  assert(!excludedFor('parallel-finish-zig').has('floorZ'), 'Parallel finish should expose explicit drop-cutter floor-Z controls');
  assert(!excludedFor('parallel-finish-zig').has('shaftLength'), 'Parallel finish should expose advanced shaft length for cutter collision checks');
  assert(excludedFor('parallel-finish-zig').has('topZ') && excludedFor('parallel-finish-zig').has('bottomZ'), 'Parallel finish should hide waterline top/bottom Z controls');
  assert(!excludedFor('parallel-finish-zig-zag').has('targetFaces'), 'Zig-zag parallel finish should expose optional face-target drive controls');
  assert(!excludedFor('parallel-finish-zig-zag').has('rasterAngleDeg'), 'Zig-zag parallel finish should expose optional cutting angle controls');
  assert(!excludedFor('parallel-finish-zig-zag').has('cutDirection'), 'Zig-zag parallel finish should expose cut-direction preference controls');
  assert(!excludedFor('parallel-finish-zig-zag').has('filterTolerance'), 'Zig-zag parallel finish should expose optional line-filter simplification controls');
  assert(!excludedFor('parallel-finish-zig-zag').has('floorZ'), 'Zig-zag parallel finish should expose explicit drop-cutter floor-Z controls');
  assert(excludedFor('parallel-finish-zig-zag').has('topZ') && excludedFor('parallel-finish-zig-zag').has('bottomZ'), 'Zig-zag parallel finish should hide waterline top/bottom Z controls');
}

export function test_cam_plan_manager_sanitizes_labeled_operation_options() {
  const manager = new CamPlanManager(null);
  const valid = manager.createOperation('cam3axis', {
    id: 'CAM_VALID_OPTIONS',
    strategy: 'parallel-finish-zig-zag',
    cutRegion: 'inside',
    linkMode: 'low-hop',
    cutDirection: 'climb',
    toolShape: 'ball-cone',
  });
  assert(valid?.inputParams.strategy === 'parallel-finish-zig-zag', 'CAM manager should preserve a valid labeled strategy value');
  assert(valid?.inputParams.cutRegion === 'inside', 'CAM manager should preserve a valid labeled cut-region value');
  assert(valid?.inputParams.linkMode === 'low-hop', 'CAM manager should preserve a valid labeled link-mode value');
  assert(valid?.inputParams.cutDirection === 'climb', 'CAM manager should preserve a valid labeled cut-direction value');
  assert(valid?.inputParams.toolShape === 'ball-cone', 'CAM manager should preserve a valid labeled cutter value');

  const invalid = manager.createOperation('cam3axis', {
    id: 'CAM_INVALID_OPTIONS',
    strategy: 'not-a-strategy',
    cutRegion: 'elsewhere',
    linkMode: 'teleport',
    cutDirection: 'sideways',
    toolShape: 'spoon',
  });
  assert(invalid?.inputParams.strategy === 'waterline-contour', 'CAM manager should fall back to the default strategy for invalid labeled option values');
  assert(invalid?.inputParams.cutRegion === 'outside', 'CAM manager should fall back to the default cut region for invalid labeled option values');
  assert(invalid?.inputParams.linkMode === 'retract', 'CAM manager should fall back to the default link mode for invalid labeled option values');
  assert(invalid?.inputParams.cutDirection === 'auto', 'CAM manager should fall back to the default cut direction for invalid labeled option values');
  assert(invalid?.inputParams.toolShape === 'flat', 'CAM manager should fall back to the default cutter for invalid labeled option values');

  const restored = new CamPlanManager(null);
  restored.loadSerializable({
    operations: [{
      type: 'cam3axis',
      inputParams: {
        id: 'CAM_RESTORED_INVALID_OPTIONS',
        strategy: 'missing',
        cutRegion: 'bad',
        linkMode: 'bad',
        cutDirection: 'bad',
        toolShape: 'bad',
      },
    }],
  });
  const restoredOperation = restored.getOperations()[0];
  assert(restoredOperation.inputParams.strategy === 'waterline-contour', 'Loaded CAM operations should sanitize invalid strategy values through schema option values');
  assert(restoredOperation.inputParams.toolShape === 'flat', 'Loaded CAM operations should sanitize invalid cutter values through schema option values');
  const serialized = restored.toSerializable();
  assert(serialized.operations[0].inputParams.strategy === 'waterline-contour', 'Serialized CAM operations should write sanitized strategy values, not option labels or invalid seeds');
  assert(serialized.operations[0].inputParams.toolShape === 'flat', 'Serialized CAM operations should write sanitized cutter values, not option labels or invalid seeds');

  const compact = new CamPlanManager(null);
  const compactOperation = compact.createOperation('cam3axis', { id: 'CAM_COMPACT_DEFAULTS' });
  const compactInput = compact.toSerializable().operations[0].inputParams || {};
  assert(!Object.prototype.hasOwnProperty.call(compactInput, 'rasterAxis'), 'Serialized default contour CAM operations should omit hidden raster-axis controls');
  assert(!Object.prototype.hasOwnProperty.call(compactInput, 'cutDirection'), 'Serialized default contour CAM operations should omit hidden default cut-direction controls');
  assert(!Object.prototype.hasOwnProperty.call(compactInput, 'cornerRadius'), 'Serialized default flat-tool CAM operations should omit hidden bull-nose controls');
  assert(!Object.prototype.hasOwnProperty.call(compactInput, 'includedAngle'), 'Serialized default flat-tool CAM operations should omit hidden cone controls');
  assert(!Object.prototype.hasOwnProperty.call(compactInput, 'ballDiameter'), 'Serialized default flat-tool CAM operations should omit hidden ball-cone controls');
  compactOperation.inputParams.linkMode = 'feed-link';
  const editedHiddenInput = compact.toSerializable().operations[0].inputParams || {};
  assert(editedHiddenInput.linkMode === 'feed-link', 'Serialized CAM operations should preserve non-default settings that were explicitly edited or loaded');
}

export async function test_cam_waterline_contour_orders_loops_to_reduce_travel() {
  const targets = [
    { name: 'far-pocket', triangles: makeSerializedCamBoxTriangles(40, 0, 0, 50, 10, 10) },
    { name: 'near-pocket', triangles: makeSerializedCamBoxTriangles(0, 0, 0, 10, 10, 10) },
  ];
  const base = {
    targetMeshes: targets,
    targetCount: 2,
    strategy: 'waterline-contour',
    cutRegion: 'inside',
    toolDiameter: 1,
    stepover: 3,
    stepDown: 10,
    safeHeight: 2,
  };
  const travel = (paths: any[]) => {
    let current = [0, 0, 0];
    let total = 0;
    for (const path of paths || []) {
      const points = Array.isArray(path.points) ? path.points : [];
      if (points.length < 2) continue;
      const start = points[0];
      total += Math.hypot(start[0] - current[0], start[1] - current[1]);
      current = points[points.length - 1];
    }
    return total;
  };

  const unordered = generateThreeAxisToolpath(null, { ...base, enablePathOrdering: false });
  const ordered = generateThreeAxisToolpath(null, base);
  assert(unordered.paths.length === ordered.paths.length && ordered.paths.length > 4, 'Contour path ordering should preserve generated path count');
  assert(unordered.paths[0].points[0][0] > 35, 'Unordered fixture should start on the far contour loop');
  assert(ordered.paths[0].points[0][0] < 12, 'Ordered waterline contour should start on the nearer contour loop');
  assert(travel(ordered.paths) < travel(unordered.paths), 'Ordered waterline contour should reduce non-cutting travel between contour loops');
  const orderedPriorities = ordered.paths.map((path: any) => Number(path.orderingPriority));
  assert(orderedPriorities.every((priority) => Number.isFinite(priority)), 'Generated waterline contour paths should carry machining-priority metadata');
  assert(orderedPriorities.every((priority, index, list) => index === 0 || priority >= list[index - 1]), 'Ordered waterline contour should not jump to later offset passes before earlier material-removal passes');
  assert(ordered.summary.pathCount === unordered.summary.pathCount, 'Ordered waterline contour summary should keep path count stable');
}

export async function test_cam_low_hop_contour_orders_split_level_paths_to_reduce_travel() {
  const targets = [
    { name: 'far-stock-island', triangles: makeSerializedCamBoxTriangles(40, 0, 0, 50, 10, 10) },
    { name: 'near-stock-island', triangles: makeSerializedCamBoxTriangles(0, 0, 0, 10, 10, 10) },
  ];
  const base = {
    targetMeshes: targets,
    targetCount: 2,
    strategy: 'waterline-contour-low-hop',
    cutRegion: 'inside',
    toolDiameter: 1,
    stepover: 3,
    stepDown: 10,
    safeHeight: 2,
  };
  const travel = (paths: any[]) => {
    let current = [0, 0, 0];
    let total = 0;
    for (const path of paths || []) {
      const points = Array.isArray(path.points) ? path.points : [];
      if (points.length < 2) continue;
      const start = points[0];
      total += Math.hypot(start[0] - current[0], start[1] - current[1]);
      current = points[points.length - 1];
    }
    return total;
  };

  const unordered = generateThreeAxisToolpath(null, { ...base, enablePathOrdering: false });
  const ordered = generateThreeAxisToolpath(null, base);
  assert(unordered.paths.length === ordered.paths.length && ordered.paths.length > 1, 'Low-hop path ordering should preserve split level path count');
  assert(unordered.paths[0].points[0][0] > 35, 'Unordered low-hop fixture should start on the far contour path');
  assert(ordered.paths[0].points[0][0] < 12, 'Ordered low-hop contour should start on the nearer contour path');
  assert(travel(ordered.paths) < travel(unordered.paths), 'Ordered low-hop contour should reduce non-cutting travel between split level paths');
}

export async function test_cam_primitive_cube_outside_contour_protects_target_material() {
  const partHistory = new PartHistory();
  const cube = await partHistory.newFeature('P.CU');
  cube.inputParams.id = 'CAM_PRIM_CUBE';
  cube.inputParams.sizeX = 50;
  cube.inputParams.sizeY = 50;
  cube.inputParams.sizeZ = 50;
  await partHistory.runHistory();
  const solidName = cube.inputParams.featureID || cube.inputParams.id;
  const solid = partHistory.scene?.getObjectByName?.(solidName);
  assert(solid, 'CAM primitive cube regression should create a target solid');

  const contour = generateThreeAxisToolpath({ scene: partHistory.scene, partHistory }, {
    id: 'CAM_PRIM_CONTOUR',
    name: 'Primitive Cube Outside Contour',
    targetSolids: [solidName],
    strategy: 'waterline-contour',
    cutRegion: 'outside',
    toolDiameter: 3.175,
    stepover: 1.5,
    stepDown: 10,
    safeHeight: 15,
    stockAllowance: 0,
    stockMargin: 6.35,
  });
  const clearance = contour.toolDiameter * 0.5;
  assert(contour.paths.length > 0, 'Primitive cube outside contour should generate toolpaths');
  assert(contour.targetBounds, 'Primitive cube outside contour should preserve target bounds');
  assert(!pathViolatesBoundsClearance(contour.paths, contour.targetBounds, clearance), 'Primitive cube outside contour centerlines should stay at least one cutter radius outside target material');
  assert(!sweptSegmentsViolateBoundsClearance(contour.simulation.sweptSegments, contour.targetBounds, clearance), 'Primitive cube outside contour swept cut segments should not remove target material');
}

export async function test_cam_low_hop_contour_links_passes_before_next_depth() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const base = {
    cutRegion: 'outside',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
  };
  const conventional = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_CONTOUR_STANDARD',
    name: 'Standard Contour',
    strategy: 'waterline-contour',
  });
  const lowHop = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_CONTOUR_LOW_HOP',
    name: 'Low Hop Contour',
    strategy: 'waterline-contour-low-hop',
  });
  const linkModeLowHop = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_CONTOUR_LINK_MODE_LOW_HOP',
    name: 'Low Hop Link Mode Contour',
    strategy: 'waterline-contour',
    linkMode: 'low-hop',
  });
  const feedLink = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_CONTOUR_FEED_LINK',
    name: 'Feed Link Contour',
    strategy: 'waterline-contour',
    linkMode: 'feed-link',
    feedRate: 321,
  });
  const staleFeedLinkLowHop = generateThreeAxisToolpath(viewer, {
    ...base,
    id: 'CAM_CONTOUR_LOW_HOP_STALE_FEED_LINK',
    name: 'Low Hop Stale Feed Link Contour',
    strategy: 'waterline-contour-low-hop',
    linkMode: 'feed-link',
    feedRate: 321,
  });
  const retracts = (result: any) => (
    result.simulation.motionSegments.filter((segment: any) => segment.kind === 'retract').length
  );

  assert(conventional.paths.length > lowHop.paths.length, 'Low-hop contour should combine same-depth offset passes into fewer paths');
  assert(retracts(conventional) > retracts(lowHop), 'Low-hop contour should reduce retract/hop moves between offset passes');
  assert(linkModeLowHop.paths.length === lowHop.paths.length, 'Low-hop link mode should use the same linked contour behavior as the low-hop strategy');
  assert(feedLink.paths.length === lowHop.paths.length, 'Feed-link mode should use the same safe linked contour grouping as the low-hop strategy');
  const lowHopGeneratedLevelCount = new Set(lowHop.paths.map((path) => path.z)).size;
  assert(lowHop.paths.length === lowHopGeneratedLevelCount, 'Low-hop contour should emit one linked contour path per generated cube depth level');
  assert(lowHop.paths.every((path) => (
    path.points.length > 8
    && path.points.every((point) => Math.abs(point[2] - path.z) < 1e-6)
  )), 'Low-hop contour should go around multiple offsets at one Z before dropping to the next depth');
  const sameLevelLinks = lowHop.simulation.motionSegments.filter((segment: any) => (
    segment.kind === 'link'
    && Math.abs(segment.start[2] - segment.end[2]) < 1e-6
    && segment.start[2] < lowHop.safeZ - 1e-6
  ));
  const linkModeSameLevelLinks = linkModeLowHop.simulation.motionSegments.filter((segment: any) => segment.kind === 'link');
  const feedLinkSameLevelLinks = feedLink.simulation.motionSegments.filter((segment: any) => segment.kind === 'link');
  const staleFeedLinkLowHopLinks = staleFeedLinkLowHop.simulation.motionSegments.filter((segment: any) => segment.kind === 'link');
  assert(sameLevelLinks.length > 0, 'Low-hop contour should tag safe same-level connectors as link motion instead of cut motion');
  const lowHopTotalPathSegments = lowHop.paths.reduce((sum: number, path: any) => (
    sum + Math.max(0, (Array.isArray(path.points) ? path.points.length : 0) - 1)
  ), 0);
  assert(lowHop.summary.moveCount === toolpathCutMoveCount(lowHop.paths), 'Low-hop contour cut-move summary should exclude non-cut link segments');
  assert(lowHop.summary.moveCount < lowHopTotalPathSegments, 'Low-hop contour cut-move summary should not count every linked path segment as a cut');
  assert(nearlyEqual(
    lowHop.summary.estimatedCutLength,
    toolpathCutLength(lowHop.paths),
    1e-5,
  ), 'Low-hop contour cut-length summary should exclude non-cut link segments');
  assert(linkModeSameLevelLinks.length === sameLevelLinks.length, 'Low-hop link mode should emit safe same-level link motion');
  assert(feedLinkSameLevelLinks.length === sameLevelLinks.length, 'Feed-link mode should emit the same safe same-level link motion');
  assert(staleFeedLinkLowHopLinks.length === sameLevelLinks.length, 'Low-hop strategy should ignore stale feed-link mode when linking same-level moves');
  const lowHopPathIds = new Set(lowHop.paths.map((path) => path.id));
  assert(
    sameLevelLinks.every((segment: any) => segment.feedRate === lowHop.machine.defaultRapidRate && lowHopPathIds.has(segment.sourcePathId)),
    'Low-hop link moves should carry rapid feed-rate metadata and source path ids',
  );
  assert(
    staleFeedLinkLowHopLinks.every((segment: any) => segment.feedRate === staleFeedLinkLowHop.machine.defaultRapidRate),
    'Low-hop strategy should keep rapid-rate link metadata even if stale operation state contains feed-link mode',
  );
  assert(
    feedLinkSameLevelLinks.every((segment: any) => segment.feedRate === 321),
    'Feed-link mode should carry cutting feed-rate metadata on safe link motion',
  );
  assert(feedLink.gcode.includes('G1 F321'), 'Feed-link G-code should emit feed-rate linking moves instead of rapid-only links');
  assert(!sameLevelLinks.some((link: any) => (
    lowHop.simulation.sweptSegments.some((segment: any) => (
      pointsNearlyEqual(segment.start, link.start)
      && pointsNearlyEqual(segment.end, link.end)
    ))
  )), 'Low-hop link moves should not be included in swept material-removal segments');
  assert(!feedLinkSameLevelLinks.some((link: any) => (
    feedLink.simulation.sweptSegments.some((segment: any) => (
      pointsNearlyEqual(segment.start, link.start)
      && pointsNearlyEqual(segment.end, link.end)
    ))
  )), 'Feed-link moves should remain non-cutting swept-volume links');
  assert(!pathCrossesTargetInterior(lowHop.paths, 10), 'Low-hop outside contour should still protect the target solid interior');
  assert(!pathViolatesTargetClearance(lowHop.paths, 10, 0.5), 'Low-hop outside contour should still honor cutter radius clearance');
  assertGcodeMotionMatchesSimulation(lowHop, 'rapid-link');
  assertGcodeMotionMatchesSimulation(feedLink, 'feed-link');
}

export async function test_cam_history_uses_option_selectors_for_operation_modes() {
  assert(typeof document !== 'undefined', 'CAM history selector test requires a browser DOM');
  const solid = makeCubeMeshSolid(10);
  const viewer: any = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_UI',
    name: 'UI Selector Modes',
  });
  viewer.partHistory.camPlanManager = manager;
  viewer.partHistory.queueHistorySnapshot = () => {};
  viewer.render = () => {};

  const widget = new CamHistoryWidget(viewer);
  document.body.appendChild(widget.uiElement);
  try {
    assert(widget.uiElement.querySelectorAll('.cam-accordion-summary').length === 0, 'CAM widget should not nest accordion sections inside one giant panel');
    assert(widget.machineConfigEl.contains(widget.machineEl), 'CAM machine controls should live in the machine configuration panel root');
    assert(widget.machineConfigEl.contains(widget.stockEl), 'CAM stock setup should live in the machine configuration panel root');
    assert(widget.historyEl.contains(widget.controlsEl) && widget.historyEl.contains(widget.visualEl) && widget.historyEl.contains(widget.statusEl), 'CAM generation controls, visualization toggles, and status should live at the top of the CAM history panel root');
    assert(widget.historyEl.compareDocumentPosition(widget.historyWidget.uiElement) & Node.DOCUMENT_POSITION_FOLLOWING, 'CAM controls should render before the operation list in the CAM history panel');
    assert(widget.gcodeEl.contains(widget.programEl), 'CAM G-code output should live in the G-code panel root');
    assert(widget.historyEl.contains(widget.historyWidget.uiElement), 'CAM operation list should live in the CAM history panel root');
    const widgetRootOrder = Array.from(widget.uiElement.children).slice(0, 3);
    assert(
      widgetRootOrder[0] === widget.historyEl
        && widgetRootOrder[1] === widget.machineConfigEl
        && widgetRootOrder[2] === widget.gcodeEl,
      'Standalone CAM widget roots should match the sidebar order: CAM History, Machine Configuration, then G-code',
    );

    const operation = manager.getOperations()[0];
    const entryId = operation.inputParams.id;
    widget.historyWidget.revealEntry(entryId, { focus: false, notify: false, scroll: false });
    const form = widget.historyWidget.getFormForEntry(entryId);
    assert(form, 'CAM history should render a schema form for the selected operation');
    const historyRoot = widget.historyWidget?._shadow || widget.historyWidget?.uiElement?.shadowRoot || widget.historyWidget?.uiElement;
    const enabledToggle = historyRoot?.querySelector?.(`.hc-item[data-entry-id="${entryId}"] .cam-operation-enabled-toggle input`) as HTMLInputElement | null;
    assert(enabledToggle?.type === 'checkbox' && enabledToggle.checked === true, 'CAM operation enabled state should be controlled from the history entry header');
    enabledToggle!.checked = false;
    enabledToggle!.dispatchEvent(new Event('change', { bubbles: true }));
    assert(operation.inputParams.enabled === false, 'CAM operation header enabled toggle should update operation params');
    const reenableToggle = historyRoot?.querySelector?.(`.hc-item[data-entry-id="${entryId}"] .cam-operation-enabled-toggle input`) as HTMLInputElement | null;
    assert(reenableToggle?.checked === false, 'CAM operation header enabled toggle should refresh after disabling the operation');
    reenableToggle!.checked = true;
    reenableToggle!.dispatchEvent(new Event('change', { bubbles: true }));
    assert(operation.inputParams.enabled === true, 'CAM operation header enabled toggle should re-enable the operation');
    const rootFor = () => {
      const currentForm = widget.historyWidget.getFormForEntry(entryId);
      return currentForm?._shadow || currentForm?.uiElement?.shadowRoot || currentForm?.uiElement;
    };
    const selectFor = (key: string) => rootFor()?.querySelector?.(`.field-row[data-key="${key}"] select`) as HTMLSelectElement | null;
    const inputFor = (key: string) => rootFor()?.querySelector?.(`.field-row[data-key="${key}"] input`) as HTMLInputElement | null;
    const rowFor = (key: string) => rootFor()?.querySelector?.(`.field-row[data-key="${key}"]`) as HTMLElement | null;
    const groupFor = (key: string) => rootFor()?.querySelector?.(`.field-group[data-group-key="${key}"]`) as HTMLDetailsElement | null;
    const rowInGroup = (fieldKey: string, groupKey: string) => {
      const group = groupFor(groupKey);
      const row = rowFor(fieldKey);
      return !!(group && row && group.contains(row));
    };
    const setStrategy = (value: string) => {
      const select = selectFor('strategy');
      assert(select, `CAM strategy selector should exist before selecting ${value}`);
      select!.value = value;
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setToolShape = (value: string) => {
      const select = selectFor('toolShape');
      assert(select, `CAM tool shape selector should exist before selecting ${value}`);
      select!.value = value;
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const strategy = selectFor('strategy');
    const rasterAxis = selectFor('rasterAxis');
    const cutRegion = selectFor('cutRegion');
    const linkMode = selectFor('linkMode');
    const cutDirection = selectFor('cutDirection');
    const toolShape = selectFor('toolShape');
    assert(strategy?.tagName === 'SELECT', 'CAM strategy should render as an option selector');
    assert(cutRegion?.tagName === 'SELECT', 'CAM cut region should render as an option selector');
    assert(!rasterAxis, 'Default waterline contour UI should hide raster-axis controls');
    assert(linkMode?.tagName === 'SELECT', 'Default waterline contour UI should render contour link-mode controls');
    assert(!cutDirection, 'Default waterline contour UI should hide parallel finish cut-direction controls');
    assert(toolShape?.tagName === 'SELECT', 'CAM tool shape should render as an option selector');
    assert(!rowFor('enabled'), 'CAM operation form should not duplicate the header enabled toggle as a body field');
    assert(!rowFor('rapidRate'), 'CAM operation history should not render the removed unused rapid-rate field');
    assert(!rowFor('stockMargin'), 'CAM operation history should not render global stock setup as an operation field');
    const advancedGroup = groupFor('advanced');
    assert(advancedGroup?.tagName === 'DETAILS' && advancedGroup.open === false, 'CAM operation tuning controls should live in a collapsed advanced group');
    assert(advancedGroup?.querySelector('summary')?.textContent === 'Advanced', 'CAM operation advanced group should use a concise label');
    assert(rowInGroup('topZ', 'advanced') && rowInGroup('bottomZ', 'advanced') && rowInGroup('shaftLength', 'advanced') && rowInGroup('stockAllowance', 'advanced'), 'Manual CAM cut-depth overrides, optional shaft length, and material allowance should be available only inside the advanced group');
    assert(optionValues(strategy).join('|') === 'waterline-contour|adaptive-waterline-contour|waterline-contour-low-hop|parallel-finish-zig|parallel-finish-zig-zag', 'CAM strategy selector should list supported user-facing strategies');
    assert(optionValues(cutRegion).join('|') === 'outside|inside', 'CAM cut region selector should list supported cut regions');
    assert(optionValues(toolShape).join('|') === 'flat|ball|bull|cone|ball-cone', 'CAM tool shape selector should list supported cutter profiles');
    assert(optionTexts(strategy).join('|') === 'Waterline Contour|Adaptive Waterline Contour|Waterline Contour Low-Hop|Surface Finish Zig|Surface Finish Zig-Zag', 'CAM strategy selector should show user-facing labels while preserving serialized values');
    assert(optionTexts(cutRegion).join('|') === 'Outside|Inside', 'CAM cut region selector should show user-facing labels');
    assert(optionTexts(toolShape).join('|') === 'Flat End Mill|Ball End Mill|Bull Nose|Cone|Ball-Cone', 'CAM tool shape selector should show user-facing cutter labels');
    assert(rowFor('toolDiameter') && !rowFor('cornerRadius') && !rowFor('includedAngle') && !rowFor('ballDiameter') && !rowFor('maximumDiameter'), 'Flat cutter UI should show only common cutter dimensions');
    assert(rowFor('targetFaces'), 'Default waterline contour UI should expose optional face-target drive controls');
    assert(!rowFor('rasterAngleDeg'), 'Default waterline contour UI should hide parallel finish angle controls');
    assert(rowInGroup('sampleSpacing', 'advanced') && rowInGroup('filterTolerance', 'advanced'), 'Default waterline contour UI should keep sampling and simplification tuning in the advanced group');
    assert(!rowFor('minSampleSpacing') && !rowFor('flatnessCosLimit'), 'Default waterline contour UI should hide adaptive-only sampling controls');

    setStrategy('waterline-contour');
    const contourCutRegion = selectFor('cutRegion');
    const contourLinkMode = selectFor('linkMode');
    assert(!rowFor('rasterAxis') && !rowFor('rasterAngleDeg') && rowFor('targetFaces'), 'Waterline contour UI should hide raster-only direction controls and expose optional face-target drive controls');
    assert(rowFor('cutRegion') && rowFor('linkMode') && rowFor('stepDown') && rowFor('stockAllowance'), 'Waterline contour UI should keep contour region, link, depth, and allowance fields available');
    assert(rowInGroup('sampleSpacing', 'advanced') && rowInGroup('filterTolerance', 'advanced') && rowInGroup('stockAllowance', 'advanced'), 'Waterline contour sampling, simplification, and allowance tuning should stay available in the advanced group');
    assert(optionValues(contourLinkMode).join('|') === 'retract|low-hop|feed-link', 'CAM link mode selector should list supported safe link behaviors');
    assert(optionTexts(contourLinkMode).join('|') === 'Retract|Low-Hop|Feed Link', 'CAM link mode selector should show user-facing labels');
    assert(!rowFor('minSampleSpacing') && !rowFor('flatnessCosLimit'), 'Uniform waterline contour UI should hide adaptive-only sampling controls');
    contourCutRegion!.value = 'inside';
    contourCutRegion!.dispatchEvent(new Event('change', { bubbles: true }));
    contourLinkMode!.value = 'feed-link';
    contourLinkMode!.dispatchEvent(new Event('change', { bubbles: true }));
    setToolShape('ball');
    assert(operation.inputParams.strategy === 'waterline-contour', 'CAM strategy selector should update operation params');
    assert(operation.inputParams.cutRegion === 'inside', 'CAM cut region selector should update operation params');
    assert(operation.inputParams.linkMode === 'feed-link', 'CAM link mode selector should update operation params');
    assert(operation.inputParams.toolShape === 'ball', 'CAM tool shape selector should update operation params');
    assert(rowFor('toolDiameter') && !rowFor('cornerRadius') && !rowFor('includedAngle') && !rowFor('ballDiameter') && !rowFor('maximumDiameter'), 'Ball cutter UI should keep compound-only cutter fields hidden');

    setToolShape('bull');
    assert(rowFor('toolDiameter') && rowFor('cornerRadius') && !rowFor('includedAngle') && !rowFor('ballDiameter') && !rowFor('maximumDiameter'), 'Bull cutter UI should expose only corner radius among cutter-specific fields');

    setToolShape('cone');
    assert(!rowFor('toolDiameter') && !rowFor('cornerRadius') && rowFor('includedAngle') && !rowFor('ballDiameter') && rowFor('maximumDiameter'), 'Cone cutter UI should expose angle and maximum diameter instead of common diameter');

    setToolShape('ball-cone');
    assert(!rowFor('toolDiameter') && !rowFor('cornerRadius') && rowFor('includedAngle') && rowFor('ballDiameter') && rowFor('maximumDiameter'), 'Ball-cone cutter UI should expose ball diameter, cone angle, and maximum diameter');

    setStrategy('adaptive-waterline-contour');
    assert(!rowFor('rasterAxis') && !rowFor('rasterAngleDeg') && rowFor('targetFaces'), 'Adaptive waterline UI should hide raster-only direction controls and expose optional face-target drive controls');
    assert(rowFor('cutRegion') && rowFor('linkMode') && rowFor('stepDown') && rowFor('stockAllowance'), 'Adaptive waterline UI should keep contour region, link, depth, and allowance fields available');
    assert(rowInGroup('sampleSpacing', 'advanced') && rowInGroup('minSampleSpacing', 'advanced') && rowInGroup('flatnessCosLimit', 'advanced') && rowInGroup('filterTolerance', 'advanced') && rowInGroup('stockAllowance', 'advanced'), 'Adaptive waterline sampling, simplification, and allowance tuning should stay available in the advanced group');

  setStrategy('waterline-contour-low-hop');
  assert(!rowFor('rasterAxis') && !rowFor('rasterAngleDeg') && rowFor('targetFaces'), 'Low-hop waterline UI should expose optional face-target drive controls');
  assert(rowFor('cutRegion') && !rowFor('linkMode') && rowFor('stepDown') && rowFor('stockAllowance'), 'Low-hop waterline UI should keep contour controls available while hiding the redundant link-mode field');
  assert(rowInGroup('sampleSpacing', 'advanced') && rowInGroup('filterTolerance', 'advanced') && rowInGroup('stockAllowance', 'advanced'), 'Low-hop waterline sampling, simplification, and allowance tuning should stay available in the advanced group');

    setStrategy('parallel-finish-zig');
    const parallelRasterAxis = selectFor('rasterAxis');
    const rasterAngle = inputFor('rasterAngleDeg');
    const filterTolerance = inputFor('filterTolerance');
    const parallelCutDirection = selectFor('cutDirection');
    assert(rowFor('targetFaces') && parallelRasterAxis && rasterAngle && filterTolerance, 'Parallel finish UI should expose drive face selection, cutting axis, optional angle, and simplification controls');
    assert(optionValues(parallelRasterAxis).join('|') === 'X|Y', 'CAM raster axis selector should list supported axes for parallel finish');
    assert(rowInGroup('rasterAngleDeg', 'advanced') && rowInGroup('filterTolerance', 'advanced'), 'Parallel finish optional angle and simplification tuning should stay available in the advanced group');
    assert(rowInGroup('stockAllowance', 'advanced'), 'Parallel finish stock allowance should stay available as advanced protected-boundary clearance tuning');
    assert(!rowFor('cutRegion') && !rowFor('stepDown') && !rowFor('topZ') && !rowFor('bottomZ'), 'Parallel finish UI should hide waterline-only region, depth, and top/bottom-Z fields');
    assert(rowFor('linkMode'), 'Parallel finish UI should expose safe link mode controls');
    assert(rowInGroup('cutDirection', 'advanced'), 'Parallel finish climb/conventional preference should stay available in the advanced group');
    assert(optionValues(parallelCutDirection).join('|') === 'auto|climb|conventional', 'Parallel finish UI should expose automatic, climb, and conventional cutting direction preferences');
    assert(rowInGroup('sampleSpacing', 'advanced') && rowInGroup('minSampleSpacing', 'advanced') && rowInGroup('flatnessCosLimit', 'advanced'), 'Parallel finish adaptive projection tuning should stay available in the advanced group');
    assert(rowInGroup('floorZ', 'advanced') && rowInGroup('shaftLength', 'advanced'), 'Parallel finish explicit drop-cutter floor Z and shaft length should stay available in the advanced group');
    parallelCutDirection!.value = 'conventional';
    parallelCutDirection!.dispatchEvent(new Event('change', { bubbles: true }));
    rasterAngle!.value = '45';
    rasterAngle!.dispatchEvent(new Event('change', { bubbles: true }));
    filterTolerance!.value = '0.05';
    filterTolerance!.dispatchEvent(new Event('change', { bubbles: true }));
    assert(operation.inputParams.cutDirection === 'conventional', 'Parallel finish cut-direction selector should update operation params');
    assert(Number(operation.inputParams.rasterAngleDeg) === 45, 'Parallel finish angle field should update operation params');
    assert(Number(operation.inputParams.filterTolerance) === 0.05, 'Line-filter simplification tolerance field should update operation params');

    const controller = widget.machineEl.querySelector('select') as HTMLSelectElement | null;
    assert(controller?.tagName === 'SELECT', 'CAM machine controller should render as an option selector');
    assert(optionValues(controller).join('|') === 'grbl|linuxcnc|fanuc', 'CAM controller selector should list known post targets');
    const machineLabels = Array.from(widget.machineEl.querySelectorAll('.cam-machine-field > span')).map((span) => span.textContent || '');
    assert(!machineLabels.includes('Work X') && !machineLabels.includes('Work Y') && !machineLabels.includes('Work Z'), 'CAM machine panel should not show unused workspace size fields');
    assert(machineLabels.join('|') === 'Name|Controller|Max RPM|Rapid|Park Z', 'CAM machine panel should keep only common machine setup fields visible by default');
    const postprocessor = widget.machineEl.querySelector('.cam-machine-advanced') as HTMLDetailsElement | null;
    assert(postprocessor?.tagName === 'DETAILS' && postprocessor.open === false, 'CAM postprocessor fields should live in a collapsed advanced group');
    assert(postprocessor?.querySelectorAll('.cam-machine-toggle').length === 2, 'CAM advanced postprocessor group should retain token and comment policy controls');
    assert(postprocessor?.querySelectorAll('.cam-machine-macro').length === 2, 'CAM advanced postprocessor group should retain header and footer macro controls');

    const stockMode = widget.stockEl.querySelector('select') as HTMLSelectElement | null;
    assert(stockMode?.tagName === 'SELECT', 'CAM stock mode should render as an option selector');
    assert(optionValues(stockMode).join('|') === 'auto|fixed', 'CAM stock mode selector should list auto and fixed stock setup');
    const stockLabelTexts = () => Array.from(widget.stockEl.querySelectorAll('.cam-stock-field > span')).map((span) => span.textContent || '');
    const stockField = (labelText: string) => Array.from(widget.stockEl.querySelectorAll('.cam-stock-field')).find((field) => field.textContent?.includes(labelText));
    const stockLabels = stockLabelTexts();
    assert(stockLabels.join('|') === 'Mode|Margin', 'CAM auto stock panel should show only the mode and margin needed for auto-fit setup');
    assert(!stockField('Size X') && !stockField('Offset X'), 'CAM auto stock panel should hide fixed-size stock controls until fixed mode is selected');
    stockMode!.value = 'fixed';
    stockMode!.dispatchEvent(new Event('change', { bubbles: true }));
    const fixedStockLabels = stockLabelTexts();
    assert(fixedStockLabels.join('|') === 'Mode|Margin|Size X|Size Y|Size Z|Offset X|Offset Y|Offset Z', 'CAM fixed stock mode should reveal global stock size and offset controls');
    const fixedStockSizeX = stockField('Size X')?.querySelector('input') as HTMLInputElement | null;
    assert(manager.getStockProfile().mode === 'fixed', 'CAM stock mode selector should update the global stock profile');
    assert(fixedStockSizeX?.disabled === false, 'CAM fixed stock size fields should be editable after switching global stock mode to fixed');
    assert(fixedStockSizeX?.value === '' && fixedStockSizeX?.placeholder === 'Auto', 'CAM fixed stock size fields should preserve blank auto fallback values until explicitly set');
    fixedStockSizeX!.value = '42';
    fixedStockSizeX!.dispatchEvent(new Event('change', { bubbles: true }));
    assert(manager.getStockProfile().sizeX === 42, 'CAM fixed stock size field should update the global stock profile');

    const visualLabels = Array.from(widget.visualEl.querySelectorAll('.cam-visual-toggle span')).map((span) => span.textContent || '');
    assert(visualLabels.join('|') === 'Tool path|Tool|Cut volume|Stock', 'CAM visualization toggles should expose preview visibility options');
    const visualInputs = Array.from(widget.visualEl.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    assert(visualInputs.length === 4 && visualInputs.every((input) => input.checked), 'CAM visualization toggles should default to visible');
  } finally {
    widget.dispose();
    widget.uiElement.remove();
  }
}

export async function test_cam_history_clears_preview_after_global_setup_changes() {
  assert(typeof document !== 'undefined', 'CAM global setup preview invalidation test requires a browser DOM');
  const viewer: any = makeViewerWithSolid(makeCubeMeshSolid(8));
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_GLOBAL_SETUP_PREVIEW',
    name: 'Global Setup Preview',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  viewer.partHistory.camPlanManager = manager;
  viewer.partHistory.queueHistorySnapshot = () => {};
  viewer.render = () => {};

  let clearPreviewCount = 0;
  const widget = new CamHistoryWidget(viewer);
  document.body.appendChild(widget.uiElement);
  try {
    (widget as any)._runtime = {
      clearPreview() { clearPreviewCount += 1; },
      getSimulationState() { return { index: 0, count: 0, distance: 0, totalDistance: 0, playing: false }; },
      isPlaying() { return false; },
    };

    manager.updateStockProfile({ mode: 'auto', margin: 6.35 });
    assert(clearPreviewCount === 0, 'No-op global stock edits should not clear an existing CAM preview');

    manager.updateStockProfile({ mode: 'fixed', sizeX: 20, sizeY: 20, sizeZ: 10 });
    assert(clearPreviewCount === 1, 'Changing global stock setup should clear a stale generated CAM preview');

    manager.updateMachineProfile({ safeParkZ: 30 });
    assert(clearPreviewCount === 2, 'Changing global machine setup should clear a stale generated CAM preview');
  } finally {
    widget.dispose();
    widget.uiElement.remove();
  }
}

export async function test_cam_history_reports_empty_generation_feedback() {
  assert(typeof document !== 'undefined', 'CAM empty generation feedback test requires a browser DOM');
  const scene = {
    traverse() {},
    getObjectByName() { return null; },
  };
  const viewer: any = {
    scene,
    partHistory: {
      scene,
      getObjectByName: scene.getObjectByName,
      queueHistorySnapshot() {},
    },
    render() {},
  };
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_EMPTY',
    name: 'Empty CAM',
    targetSolids: ['missing-solid'],
  });
  viewer.partHistory.camPlanManager = manager;
  const originalGenerateAllAsync = manager.generateAllAsync.bind(manager);
  manager.generateAllAsync = async (targetViewer: any, options: any = {}) => (
    originalGenerateAllAsync(targetViewer, { ...options, useWorker: false })
  );

  let previewCount = 0;
  viewer._ensureCamWorkbenchManager = () => Promise.resolve({
    setActive() {},
    setVisualizationOptions() {},
    addSimulationListener() { return () => {}; },
    preview() { previewCount += 1; return {}; },
    clearPreview() {},
    getSimulationState() { return {}; },
    isPlaying() { return false; },
  });

  const widget = new CamHistoryWidget(viewer);
  document.body.appendChild(widget.uiElement);
  try {
    await widget._generate();
    const status = widget.statusEl.textContent || '';
    const progress = document.querySelector('.cam-generation-progress')?.textContent || '';
    const program = widget.programEl.textContent || '';
    assert(previewCount === 0, 'CAM should not preview an empty generated plan');
    assert(status.includes('No toolpaths generated'), 'CAM empty generation should leave visible status feedback');
    assert(status.includes('No machinable solids'), 'CAM empty generation status should include generator warnings');
    assert(progress.includes('No toolpaths generated'), 'CAM empty generation progress should report the failure reason');
    assert(program.includes('No toolpaths generated'), 'CAM program panel should show empty-generation feedback');
  } finally {
    widget.dispose();
    widget.uiElement.remove();
  }
}

export function test_cam_gcode_export_filename_uses_machine_file_extension() {
  assert(gcodeDownloadFileName(null) === 'brep-cam.nc', 'CAM G-code export should use a default NC filename when no document name exists');
  assert(gcodeDownloadFileName('fixture bracket.brep') === 'fixture_bracket.nc', 'CAM G-code export should replace document extensions with NC');
  assert(gcodeDownloadFileName('part program.tap') === 'part_program.tap', 'CAM G-code export should preserve explicit machine-code filename extensions');
}

export async function test_cam_history_generates_only_on_request_and_slider_snaps_to_toolpath_points() {
  assert(typeof document !== 'undefined', 'CAM generation control test requires a browser DOM');
  const solid = makeCubeMeshSolid(8);
  const viewer: any = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_MANUAL',
    name: 'Manual CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  viewer.partHistory.camPlanManager = manager;
  viewer.partHistory.queueHistorySnapshot = () => {};
  viewer.render = () => {};

  let generateCount = 0;
  const originalGenerateAll = manager.generateAll.bind(manager);
  const originalGenerateAllAsync = manager.generateAllAsync.bind(manager);
  manager.generateAll = (...args: any[]) => {
    generateCount += 1;
    return originalGenerateAll(...args);
  };
  manager.generateAllAsync = async (...args: any[]) => {
    generateCount += 1;
    return originalGenerateAllAsync(...args);
  };

  let previewedPlan: any = null;
  let selectedFrame = -1;
  const runtime: any = {
    group: null,
    state: { index: 0, count: 0, distance: 0, totalDistance: 0, playing: false },
    setActive() {},
    setVisualizationOptions() {},
    addSimulationListener() { return () => {}; },
    getSimulationState() { return this.state; },
    isPlaying() { return false; },
    clearPreview() { this.group = null; this.state = { index: 0, count: 0, distance: 0, totalDistance: 0, playing: false }; },
    preview(plan: any) {
      previewedPlan = plan;
      this.group = {};
      this.state = {
        index: 0,
        count: plan?.simulation?.motionPolyline?.length || 0,
        distance: 0,
        totalDistance: 1,
        playing: false,
      };
      return this.group;
    },
    setSimulationFrameIndex(index: number) {
      selectedFrame = Math.round(Number(index) || 0);
      this.state = { ...this.state, index: selectedFrame };
    },
    togglePlaying() {},
    reset() { this.setSimulationFrameIndex(0); },
  };
  viewer._ensureCamWorkbenchManager = () => Promise.resolve(runtime);

  const widget = new CamHistoryWidget(viewer);
  document.body.appendChild(widget.uiElement);
  try {
    assert(widget.simulationEl.hidden === true, 'CAM simulation slider should stay hidden before toolpaths are generated');
    await widget._preview();
    widget._exportGcode();
    assert(generateCount === 0, 'CAM preview/export should not generate toolpaths implicitly');
    assert(!manager.getOperations()[0]?.persistentData?.toolpath, 'CAM operation should remain ungenerated until Generate is requested');

    await widget._generate();
    assert(generateCount === 1, 'CAM Generate should be the only control that runs toolpath generation');
    assert(previewedPlan?.paths?.length > 0, 'CAM Generate should preview the generated plan');
    const progressPanel = document.querySelector('.cam-generation-progress');
    assert(progressPanel, 'CAM Generate should display a floating progress panel while toolpaths are generated');
    assert((progressPanel?.textContent || '').includes('CAM toolpaths ready'), 'CAM progress panel should report the final generation step');
    assert(widget.simulationEl.hidden === false, 'CAM simulation slider should appear after toolpaths are generated');
    const gcodePanelButtons = Array.from(widget.gcodeEl.querySelectorAll('.cam-program-action')) as HTMLButtonElement[];
    const gcodePanelButtonLabels = gcodePanelButtons.map((button) => button.textContent || '');
    assert(gcodePanelButtonLabels.join('|') === 'Copy|Export', 'CAM G-code panel should expose copy and export actions');
    const gcodeExportButton = gcodePanelButtons.find((button) => button.textContent === 'Export');
    assert(gcodeExportButton && !gcodeExportButton.disabled, 'CAM G-code export button should be enabled when generated G-code exists');
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    const originalSetTimeout = globalThis.setTimeout;
    let exportedBlob: Blob | null = null;
    let exportedName = '';
    let exportedClick = false;
    let revokedUrl = '';
    try {
      URL.createObjectURL = ((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:cam-export-test';
      }) as any;
      URL.revokeObjectURL = ((url: string) => { revokedUrl = url; }) as any;
      HTMLAnchorElement.prototype.click = function click() {
        exportedClick = true;
        exportedName = this.download;
      };
      globalThis.setTimeout = ((callback: TimerHandler) => {
        if (typeof callback === 'function') callback();
        return 0 as any;
      }) as any;
      gcodeExportButton.click();
      assert(exportedClick && exportedName === 'brep-cam.nc', 'CAM G-code export should trigger a browser download with a default NC filename');
      exportedClick = false;
      exportedName = '';
      viewer.fileManagerWidget = { currentName: 'fixture bracket.brep' };
      gcodeExportButton.click();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
      globalThis.setTimeout = originalSetTimeout;
    }
    assert(exportedClick && exportedName === 'fixture_bracket.nc', 'CAM G-code export should replace document extensions with an NC filename');
    assert(exportedBlob?.type === 'text/x-gcode;charset=utf-8', 'CAM G-code export should use a text/x-gcode download blob');
    assert(revokedUrl === 'blob:cam-export-test', 'CAM G-code export should revoke the generated object URL after download');
    assert((await exportedBlob!.text()).includes('G21'), 'CAM G-code export should download the generated program text');
    const slider = widget.simulationEl.querySelector('input[type="range"]') as HTMLInputElement | null;
    assert(slider, 'CAM simulation should render a range slider');
    assert(slider?.step === '1', 'CAM simulation slider should snap to toolpath point indices');
    assert(Number(slider?.max) === previewedPlan.simulation.motionPolyline.length - 1, 'CAM simulation slider should expose every motion polyline point');

    slider!.value = '2';
    slider!.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    assert(selectedFrame === 2, 'CAM simulation slider should move the runtime to the selected toolpath point index');
    assert(generateCount === 1, 'CAM slider stepping should not regenerate toolpaths');

    const serialized = manager.toSerializable();
    const restored = new CamPlanManager(null);
    restored.loadSerializable(serialized);
    let restoredGenerateCount = 0;
    const restoredGenerateAll = restored.generateAll.bind(restored);
    const restoredGenerateAllAsync = restored.generateAllAsync.bind(restored);
    restored.generateAll = (...args: any[]) => {
      restoredGenerateCount += 1;
      return restoredGenerateAll(...args);
    };
    restored.generateAllAsync = async (...args: any[]) => {
      restoredGenerateCount += 1;
      return restoredGenerateAllAsync(...args);
    };
    const restoredViewer: any = makeViewerWithSolid(solid);
    restoredViewer.partHistory.camPlanManager = restored;
    restoredViewer.partHistory.queueHistorySnapshot = () => {};
    restoredViewer.render = () => {};
    restoredViewer._ensureCamWorkbenchManager = () => Promise.resolve(runtime);
    const restoredWidget = new CamHistoryWidget(restoredViewer);
    document.body.appendChild(restoredWidget.uiElement);
    try {
      assert(restoredGenerateCount === 0, 'Loading CAM state and rendering the CAM panel should not generate toolpaths automatically');
    } finally {
      restoredWidget.dispose();
      restoredWidget.uiElement.remove();
    }
  } finally {
    widget.dispose();
    widget.uiElement.remove();
  }
}

export async function test_cam_history_progress_window_can_stop_generation() {
  assert(typeof document !== 'undefined', 'CAM progress stop test requires a browser DOM');
  const viewer: any = makeViewerWithSolid(makeCubeMeshSolid(8));
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_STOP',
    name: 'Stop CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  viewer.partHistory.camPlanManager = manager;
  viewer.partHistory.queueHistorySnapshot = () => {};
  viewer.render = () => {};

  let receivedSignal: AbortSignal | null = null;
  manager.generateAllAsync = async (_targetViewer: any, options: any = {}) => {
    receivedSignal = options.signal || null;
    options.onProgress?.({
      phase: 'parallel-project',
      message: 'Projecting parallel finish passes',
      detail: 'Waiting on a slow CAM operation.',
      current: 40,
      total: 100,
    });
    await options.progressYield?.();
    return await new Promise((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('CAM generation canceled');
        error.name = 'AbortError';
        reject(error);
      };
      if (receivedSignal?.aborted) {
        rejectAbort();
        return;
      }
      receivedSignal?.addEventListener('abort', rejectAbort, { once: true });
    });
  };

  let previewCount = 0;
  viewer._ensureCamWorkbenchManager = () => Promise.resolve({
    setActive() {},
    setVisualizationOptions() {},
    addSimulationListener() { return () => {}; },
    preview() { previewCount += 1; return {}; },
    clearPreview() {},
    getSimulationState() { return {}; },
    isPlaying() { return false; },
  });

  const widget = new CamHistoryWidget(viewer);
  document.body.appendChild(widget.uiElement);
  try {
    const generatePromise = widget._generate();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stopButton = document.querySelector('.cam-generation-progress-stop') as HTMLButtonElement | null;
    const elapsed = document.querySelector('.cam-generation-progress-runtime')?.textContent || '';
    assert(stopButton && stopButton.disabled === false, 'CAM progress window should expose an enabled Stop button while generating');
    assert(/^Elapsed \d/.test(elapsed), 'CAM progress window should display elapsed generation time while running');
    stopButton.click();
    await generatePromise;
    const progress = document.querySelector('.cam-generation-progress')?.textContent || '';
    assert(receivedSignal?.aborted === true, 'CAM progress Stop should abort the active generation signal');
    assert(progress.includes('CAM generation stopped'), 'CAM progress window should report stopped generation after Stop is clicked');
    assert((widget.statusEl.textContent || '').includes('CAM generation stopped'), 'CAM status should report stopped generation');
    assert(previewCount === 0, 'Canceled CAM generation should not preview a stale or partial plan');
    assert(!manager.getOperations()[0]?.persistentData?.toolpath, 'Canceled CAM generation should not persist a generated toolpath');
  } finally {
    widget.dispose();
    widget.uiElement.remove();
  }
}

export async function test_cam_plan_manager_serializes_generated_operations() {
  const solid = makeCubeMeshSolid(8);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation('cam3axis', {
    id: 'CAM_TEST',
    name: 'Serializable CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  assert(operation, 'CAM manager should create a 3-axis operation');
  operation.inputParams.enablePathOrdering = false;
  operation.inputParams.floorZ = -2;
  operation.inputParams.filterTolerance = 0.001;
  operation.inputParams.linkMode = 'low-hop';
  operation.inputParams.cutDirection = 'conventional';
  operation.inputParams.maxDepth = 8;
  operation.inputParams.minSampling = 0.25;
  operation.inputParams.preserveSimulationSamples = false;
  operation.inputParams.rapidRate = 1234;
  operation.inputParams.sampling = 0.75;
  operation.inputParams.shaftLength = 3;
  const plan = manager.generateAll(viewer);
  assert(plan.paths.length > 0, 'CAM manager should generate a combined plan');

  const serialized = manager.toSerializable();
  assert(serialized.operations[0]?.persistentData?.generatorVersion === CAM_GENERATED_DATA_VERSION, 'Generated CAM serialization should tag cached toolpaths with the current generator version');
  assert(serialized.operations[0]?.persistentData?.toolpath?.generatorVersion === CAM_GENERATED_DATA_VERSION, 'Generated CAM toolpath payload should carry the generator version');
  assert(serialized.operations[0]?.inputParams?.enablePathOrdering === false, 'CAM serialization should preserve internal path-ordering settings');
  assert(serialized.operations[0]?.inputParams?.floorZ === -2, 'CAM serialization should preserve surface-finish floor-Z settings');
  assert(serialized.operations[0]?.inputParams?.filterTolerance === 0.001, 'CAM serialization should preserve line-filter tolerance settings');
  assert(serialized.operations[0]?.inputParams?.linkMode === 'low-hop', 'CAM serialization should preserve link-mode settings');
  assert(serialized.operations[0]?.inputParams?.cutDirection === 'conventional', 'CAM serialization should preserve parallel cut-direction settings');
  assert(serialized.operations[0]?.inputParams?.maxDepth === 8, 'CAM serialization should preserve internal adaptive max-depth settings');
  assert(serialized.operations[0]?.inputParams?.minSampling === 0.25, 'CAM serialization should preserve internal adaptive minimum sampling settings');
  assert(serialized.operations[0]?.inputParams?.preserveSimulationSamples === false, 'CAM serialization should preserve internal simulation sample preservation settings');
  assert(serialized.operations[0]?.inputParams?.sampling === 0.75, 'CAM serialization should preserve internal waterline sampling settings');
  assert(serialized.operations[0]?.inputParams?.shaftLength === 3, 'CAM serialization should preserve advanced cutter shaft length settings');
  assert(!Object.prototype.hasOwnProperty.call(serialized.operations[0]?.inputParams || {}, 'rapidRate'), 'CAM serialization should strip removed unused rapid-rate fields');
  const compactSerialized = manager.toSerializable({ includeGeneratedToolpaths: false });
  assert(!Object.prototype.hasOwnProperty.call(compactSerialized.operations[0]?.persistentData || {}, 'toolpath'), 'Compact CAM serialization should omit generated toolpath payloads');
  assert(compactSerialized.operations[0]?.persistentData?.gcode?.includes('G21'), 'Compact CAM serialization should keep generated G-code');
  assert(compactSerialized.operations[0]?.persistentData?.summary?.pathCount > 0, 'Compact CAM serialization should keep generated summary data');
  const restored = new CamPlanManager(null);
  restored.loadSerializable(serialized);
  const restoredOperation = restored.getOperations()[0];
  assert(restoredOperation?.inputParams?.id === 'CAM_TEST', 'CAM operation id should survive serialization');
  assert(restoredOperation?.inputParams?.enablePathOrdering === false, 'CAM load should restore internal path-ordering settings');
  assert(restoredOperation?.inputParams?.floorZ === -2, 'CAM load should restore surface-finish floor-Z settings');
  assert(restoredOperation?.inputParams?.filterTolerance === 0.001, 'CAM load should restore line-filter tolerance settings');
  assert(restoredOperation?.inputParams?.linkMode === 'low-hop', 'CAM load should restore link-mode settings');
  assert(restoredOperation?.inputParams?.cutDirection === 'conventional', 'CAM load should restore parallel cut-direction settings');
  assert(restoredOperation?.inputParams?.maxDepth === 8, 'CAM load should restore internal adaptive max-depth settings');
  assert(restoredOperation?.inputParams?.minSampling === 0.25, 'CAM load should restore internal adaptive minimum sampling settings');
  assert(restoredOperation?.inputParams?.preserveSimulationSamples === false, 'CAM load should restore internal simulation sample preservation settings');
  assert(restoredOperation?.inputParams?.sampling === 0.75, 'CAM load should restore internal waterline sampling settings');
  assert(restoredOperation?.inputParams?.shaftLength === 3, 'CAM load should restore advanced cutter shaft length settings');
  assert(!Object.prototype.hasOwnProperty.call(restoredOperation?.inputParams || {}, 'rapidRate'), 'CAM load should not restore removed unused rapid-rate fields');
  assert(restoredOperation?.persistentData?.generatorVersion === CAM_GENERATED_DATA_VERSION, 'Restored generated CAM data should retain the current generator version');
  assert(restoredOperation?.persistentData?.gcode?.includes('G21'), 'Generated CAM G-code should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.sweptSegments?.length > 0, 'CAM simulation segment hulls should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.motionPolyline?.length > 0, 'CAM actual toolpath polyline should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.sweptHulls?.length > 0, 'CAM swept hull artifacts should survive serialization');
}

export async function test_cam_plan_manager_invalidates_stale_generated_payload_versions() {
  const stale = new CamPlanManager(null);
  stale.loadSerializable({
    operations: [{
      type: 'cam3axis',
      inputParams: { id: 'CAM_STALE', name: 'Stale Generated CAM' },
      persistentData: {
        gcode: 'G21\nG1 X1\n',
        generatedAt: '2026-07-02T09:49:50.803Z',
        summary: { pathCount: 1 },
        warnings: [],
        toolpath: {
          paths: [{ id: 'old-unsafe-path', points: [[0, 0, 0], [1, 0, 0]] }],
        },
      },
    }],
  });
  const staleOperation = stale.getOperations()[0];
  assert(!staleOperation?.persistentData?.toolpath, 'Loading old unversioned CAM generated data should drop stale toolpaths');
  assert(!staleOperation?.persistentData?.gcode, 'Loading old unversioned CAM generated data should drop stale G-code');
  assert(staleOperation?.persistentData?.invalidatedReason === 'cam-generator-version', 'Stale CAM generated data should record generator-version invalidation');
  assert(stale.getCombinedPlan().paths.length === 0, 'Combined CAM plan should not expose stale unversioned generated paths');

  const current = new CamPlanManager(null);
  current.loadSerializable({
    operations: [{
      type: 'cam3axis',
      inputParams: { id: 'CAM_CURRENT', name: 'Current Generated CAM' },
      persistentData: {
        generatorVersion: CAM_GENERATED_DATA_VERSION,
        gcode: 'G21\nG1 X1\n',
        generatedAt: '2026-07-02T09:49:50.803Z',
        summary: { pathCount: 1 },
        warnings: [],
        toolpath: {
          generatorVersion: CAM_GENERATED_DATA_VERSION,
          paths: [{ id: 'current-safe-path', points: [[0, 0, 0], [1, 0, 0]] }],
        },
      },
    }],
  });
  const currentOperation = current.getOperations()[0];
  assert(currentOperation?.persistentData?.toolpath?.paths?.[0]?.id === 'current-safe-path', 'Current-version CAM generated data should survive loading');
  assert(current.getCombinedPlan().paths.length === 1, 'Combined CAM plan should expose current-version generated paths');
}

export async function test_cam_plan_manager_uses_global_stock_profile_for_generated_bounds() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.updateStockProfile({
    mode: 'fixed',
    sizeX: 20,
    sizeY: 24,
    sizeZ: 12,
    offsetX: 1,
    offsetY: -2,
  });
  const operation = manager.createOperation('cam3axis', {
    id: 'CAM_STOCK',
    name: 'Global Stock',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
  });
  assert(operation, 'CAM manager should create an operation for global stock testing');
  assert(!Object.prototype.hasOwnProperty.call(operation.inputParams || {}, 'stockMargin'), 'CAM operation params should not store stock margin setup');

  const plan = manager.generateAll(viewer);
  assert(plan.paths.length > 0, 'Global stock test should generate toolpaths');
  assert(plan.bounds?.min?.[0] === -4 && plan.bounds?.max?.[0] === 16, 'Global fixed stock should control generated X stock bounds');
  assert(plan.bounds?.min?.[1] === -9 && plan.bounds?.max?.[1] === 15, 'Global fixed stock should control generated Y stock bounds');
  assert(plan.bounds?.min?.[2] === 0 && plan.bounds?.max?.[2] === 12, 'Global fixed stock should control generated Z stock bounds');
  assert(plan.safeZ === 14, 'CAM safe Z should clear the global stock top');

  manager.updateStockProfile({ mode: 'fixed', sizeX: 20 });
  assert(operation.persistentData?.toolpath, 'No-op global stock edits should not discard generated CAM toolpaths');
  assert(!operation.persistentData?.invalidatedReason, 'No-op global stock edits should not mark generated CAM data stale');

  const serialized = manager.toSerializable();
  assert(serialized.stockProfile.mode === 'fixed', 'CAM stock mode should serialize with the plan');
  assert(serialized.stockProfile.sizeX === 20 && serialized.stockProfile.sizeY === 24 && serialized.stockProfile.sizeZ === 12, 'CAM stock material size should serialize globally');
  assert(!Object.prototype.hasOwnProperty.call(serialized.operations[0]?.inputParams || {}, 'stockProfile'), 'CAM operation serialization should not duplicate global stock profile data');
  assert(!Object.prototype.hasOwnProperty.call(serialized.operations[0]?.inputParams || {}, 'stockMargin'), 'CAM operation serialization should not duplicate stock margin data');

  const restored = new CamPlanManager(null);
  restored.loadSerializable(serialized);
  const restoredStock = restored.getStockProfile();
  assert(restoredStock.mode === 'fixed', 'Restored CAM stock mode should survive serialization');
  assert(restoredStock.sizeX === 20 && restoredStock.offsetY === -2, 'Restored CAM stock size and offset should survive serialization');

  manager.updateStockProfile({ sizeX: 30 });
  assert(!operation.persistentData?.toolpath, 'Editing global stock should invalidate stale generated toolpaths');
  assert(operation.persistentData?.invalidatedReason === 'stock-profile', 'Global stock invalidation should record the stock profile reason');
}

export async function test_cam_workbench_registers_and_persists_part_history_state() {
  const definitions = listWorkbenchDefinitions();
  const camDefinition = getWorkbenchDefinition('CAM');
  const camPanels = camDefinition.sidePanels as Record<string, boolean>;
  assert(definitions.some((definition) => definition.id === 'CAM'), 'CAM workbench should be registered in the global workbench list');
  assert(Object.keys(camPanels).filter((key) => key.startsWith('cam')).join('|') === 'camHistory|camMachineConfiguration|camGcode', 'CAM workbench should list CAM History before the other CAM side panels');
  assert(camPanels.camMachineConfiguration === true, 'CAM workbench should expose the machine configuration side panel');
  assert(camPanels.camGcode === true, 'CAM workbench should expose the G-code side panel');
  assert(camPanels.camHistory === true, 'CAM workbench should expose the CAM history side panel');
  assert(camPanels.camOperations !== true, 'CAM workbench should not expose the old single CAM side panel');
  assert(camPanels.featureHistory !== true, 'CAM workbench should hide feature history while CAM planning is active');
  assert(camPanels.pmiViews !== true, 'CAM workbench should hide PMI views while CAM planning is active');
  assert(camPanels.sheets2D !== true, 'CAM workbench should hide 2D sheets while CAM planning is active');
  assert(camDefinition.contextFamilies?.features === false, 'CAM workbench should suppress modeling feature context actions');
  assert(Array.isArray(camDefinition.featureTypes) && camDefinition.featureTypes.length === 0, 'CAM workbench should not expose modeling feature creation');

  const history = new PartHistory();
  history.activeWorkbench = 'CAM';
  history.camPlanManager.updateMachineProfile({
    name: 'Saved CNC Mill',
    controller: 'linuxcnc',
    maxSpindleRPM: 9000,
  });
  history.camPlanManager.updateStockProfile({
    mode: 'fixed',
    sizeX: 120,
    sizeY: 80,
    sizeZ: 25,
    offsetX: 5,
  });
  const savedOperation = history.camPlanManager.createOperation('cam3axis', {
    id: 'CAM_SAVE',
    name: 'Saved Operation',
    strategy: 'waterline-contour',
    cutRegion: 'inside',
    toolDiameter: 2,
  });
  savedOperation?.setPersistentData?.({
    gcode: 'G21\nG0 Z5\n',
    summary: { pathCount: 1 },
    warnings: ['generated CAM warning'],
    toolpath: {
      paths: [{ id: 'heavy-generated-path', points: [[0, 0, 0], [1, 0, 0]] }],
      simulation: {
        sweptHulls: [{
          positions: Array.from({ length: 128 }, (_, index) => index),
          indices: Array.from({ length: 128 }, (_, index) => index),
        }],
      },
    },
  });

  const json = await history.toJSON();
  const raw = JSON.parse(json);
  assert(raw.activeWorkbench === 'CAM', 'Part history JSON should persist the active CAM workbench');
  assert(raw.cam?.machineProfile?.controller === 'linuxcnc', 'Part history JSON should persist the CAM machine profile');
  assert(raw.cam?.stockProfile?.mode === 'fixed', 'Part history JSON should persist the global CAM stock profile');
  assert(raw.cam?.stockProfile?.sizeX === 120, 'Part history JSON should persist the global CAM stock material size');
  assert(raw.cam?.operations?.[0]?.inputParams?.strategy === 'waterline-contour', 'Part history JSON should persist CAM operation params');
  assert(raw.cam?.operations?.[0]?.persistentData?.toolpath?.paths?.[0]?.id === 'heavy-generated-path', 'Default part history JSON should preserve generated CAM toolpaths for normal save/load');

  const compactJson = await history.toJSON({ includeCamGeneratedToolpaths: false });
  const compactRaw = JSON.parse(compactJson);
  assert(!Object.prototype.hasOwnProperty.call(compactRaw.cam?.operations?.[0]?.persistentData || {}, 'toolpath'), 'Compact part history JSON should omit heavy generated CAM toolpaths for bug-test snippets');
  assert(compactRaw.cam?.operations?.[0]?.persistentData?.gcode?.includes('G21'), 'Compact part history JSON should keep generated CAM G-code text');
  assert(compactRaw.cam?.operations?.[0]?.persistentData?.summary?.pathCount === 1, 'Compact part history JSON should keep generated CAM summary data');

  const leanJson = await history.toJSON({ includeCamGeneratedData: false });
  const leanPersistent = JSON.parse(leanJson).cam?.operations?.[0]?.persistentData || {};
  assert(!Object.prototype.hasOwnProperty.call(leanPersistent, 'toolpath'), 'Lean CAM serialization should omit generated toolpath payloads');
  assert(!Object.prototype.hasOwnProperty.call(leanPersistent, 'gcode'), 'Lean CAM serialization should omit generated G-code text');
  assert(!Object.prototype.hasOwnProperty.call(leanPersistent, 'summary'), 'Lean CAM serialization should omit generated summaries');
  assert(!Object.prototype.hasOwnProperty.call(leanPersistent, 'generatorVersion'), 'Lean CAM serialization should omit generated version metadata');

  const snapshotHistory = new PartHistory();
  const snapshotOperation = snapshotHistory.camPlanManager.createOperation('cam3axis', {
    id: 'CAM_UNDO_SNAPSHOT',
    strategy: 'waterline-contour',
  });
  snapshotOperation?.setPersistentData?.(savedOperation?.persistentData || {});
  await snapshotHistory.flushHistorySnapshot({ force: true });
  const snapshotJson = snapshotHistory._historyUndo?.undoStack?.[0]?.json || '{}';
  const snapshotPersistent = JSON.parse(snapshotJson).cam?.operations?.[0]?.persistentData || {};
  assert(!Object.prototype.hasOwnProperty.call(snapshotPersistent, 'toolpath'), 'Undo snapshots should omit heavy generated CAM toolpath payloads');
  assert(!Object.prototype.hasOwnProperty.call(snapshotPersistent, 'gcode'), 'Undo snapshots should omit generated CAM G-code text');
  assert(!Object.prototype.hasOwnProperty.call(snapshotPersistent, 'summary'), 'Undo snapshots should omit generated CAM summary data');

  const restored = new PartHistory();
  await restored.fromJSON(json, { skipUndoReset: true });
  const restoredOperation = restored.camPlanManager.getOperations()[0];
  assert(restored.activeWorkbench === 'CAM', 'Restored part history should restore the CAM workbench');
  assert(restored.camPlanManager.getMachineProfile().name === 'Saved CNC Mill', 'Restored part history should restore CAM machine settings');
  assert(restored.camPlanManager.getStockProfile().sizeY === 80, 'Restored part history should restore CAM stock material size');
  assert(restoredOperation?.inputParams?.id === 'CAM_SAVE', 'Restored part history should restore CAM operation identity');
  assert(restoredOperation?.inputParams?.strategy === 'waterline-contour', 'Restored part history should restore CAM strategy params');
  assert(restoredOperation?.inputParams?.cutRegion === 'inside', 'Restored part history should restore CAM cut region params');
}

export async function test_cam_workbench_disables_modeling_context_toolbar_until_finished() {
  const history = new PartHistory();
  history.activeWorkbench = 'CAM';
  const face = { type: 'FACE', name: 'CAM_FACE', userData: { faceName: 'CAM_FACE' } };
  const viewer = {
    partHistory: history,
    _getActiveWorkbenchId: () => history.activeWorkbench,
  };

  const camSpecs = (SelectionFilter as any)._getHistoryContextActionSpecs([face], viewer);
  assert(
    !camSpecs.some((spec: any) => String(spec?.id || '') === 'ctx-feature-e'),
    'CAM workbench should not emit modeling feature context toolbar actions while CAM is active',
  );

  history.activeWorkbench = 'MODELING';
  const modelingSpecs = (SelectionFilter as any)._getHistoryContextActionSpecs([face], viewer);
  assert(
    modelingSpecs.some((spec: any) => String(spec?.id || '') === 'ctx-feature-e'),
    'Modeling workbench should restore feature context toolbar actions after leaving CAM',
  );
}

export async function test_cam_workbench_side_panel_visibility_is_cam_only() {
  const camPanels = [
    { id: 'camHistory', source: 'builtin', workbenches: ['CAM'] },
    { id: 'camMachineConfiguration', source: 'builtin', workbenches: ['CAM'] },
    { id: 'camGcode', source: 'builtin', workbenches: ['CAM'] },
  ];
  const generalWorkbenches = ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'SIMULATION', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'];
  const records = [
    { id: 'featureHistory', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
    { id: 'expressions', source: 'builtin', workbenches: generalWorkbenches },
    { id: 'sceneManager', source: 'builtin', workbenches: generalWorkbenches },
    { id: 'pmiViews', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
    { id: 'sheets2D', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
  ];

  for (const panel of camPanels) {
    assert(isSidePanelAllowed(panel, 'CAM'), `${panel.id} panel should be visible in the CAM workbench`);
    assert(!isSidePanelAllowed(panel, 'MODELING'), `${panel.id} panel should be hidden outside the CAM workbench`);
  }
  for (const record of records) {
    assert(!isSidePanelAllowed(record, 'CAM'), `${record.id} panel should be hidden in the CAM workbench`);
  }
}

export function test_cam_workbench_accordion_allows_side_panel_scrolling() {
  const ensureStylesSource = String((AccordionWidget.prototype as any)._ensureStyles || '');
  assert(ensureStylesSource.includes('overflow: auto;'), 'Accordion side-panel root should use a valid scroll overflow style');
  assert(!ensureStylesSource.includes('overflow: scfroll'), 'Accordion side-panel root should not contain the invalid overflow typo');
}

export async function test_cam_workbench_side_panel_defaults_order_and_collapsed_state() {
  const history = new PartHistory();
  history.activeWorkbench = 'CAM';
  const events: string[] = [];
  const viewer: any = {
    _viewerOnlyMode: false,
    partHistory: history,
    accordion: {
      showSection(title: string) {
        events.push(`show:${title}`);
        return true;
      },
      hideSection(title: string) {
        events.push(`hide:${title}`);
        return true;
      },
      expandSection(title: string) {
        events.push(`expand:${title}`);
        return Promise.resolve(true);
      },
      collapseSection(title: string) {
        events.push(`collapse:${title}`);
        return Promise.resolve(true);
      },
    },
    _workbenchPanelRecords: new Map(),
    _getActiveWorkbenchId: workbenchMethods._getActiveWorkbenchId,
    _registerWorkbenchPanel: workbenchMethods._registerWorkbenchPanel,
    _refreshWorkbenchPanelVisibility: workbenchMethods._refreshWorkbenchPanelVisibility,
  };

  viewer._registerWorkbenchPanel({
    id: 'camHistory',
    title: 'CAM History',
    source: 'builtin',
    workbenches: ['CAM'],
    defaultExpanded: true,
  });
  viewer._registerWorkbenchPanel({
    id: 'camMachineConfiguration',
    title: 'Machine Configuration',
    source: 'builtin',
    workbenches: ['CAM'],
    defaultExpanded: false,
  });
  viewer._registerWorkbenchPanel({
    id: 'camGcode',
    title: 'G-code',
    source: 'builtin',
    workbenches: ['CAM'],
    defaultExpanded: false,
  });

  viewer._refreshWorkbenchPanelVisibility();
  assert(
    events.join('|') === 'show:CAM History|expand:CAM History|show:Machine Configuration|collapse:Machine Configuration|show:G-code|collapse:G-code',
    'Entering CAM should show CAM History first and collapse the other CAM side panels by default',
  );

  events.length = 0;
  viewer._refreshWorkbenchPanelVisibility();
  assert(events.length === 0, 'Refreshing the same workbench should preserve current CAM side panel collapse state');

  history.activeWorkbench = 'MODELING';
  viewer._refreshWorkbenchPanelVisibility();
  assert(events.join('|') === 'hide:CAM History|hide:Machine Configuration|hide:G-code', 'Leaving CAM should hide all CAM side panels in visual order');
}

export async function test_cam_workbench_finish_returns_to_previous_workbench() {
  const history = new PartHistory();
  history.activeWorkbench = 'SHEET_METAL';
  const viewer: any = {
    partHistory: history,
    refreshWorkbenchUi() {},
    _getActiveWorkbenchId: workbenchMethods._getActiveWorkbenchId,
    setActiveWorkbench: workbenchMethods.setActiveWorkbench,
    finishCamWorkbench: workbenchMethods.finishCamWorkbench,
  };

  viewer.setActiveWorkbench('CAM', { queueHistorySnapshot: false });
  assert(history.activeWorkbench === 'CAM', 'Entering CAM should activate the CAM workbench');
  assert(viewer._camWorkbenchReturnTarget === 'SHEET_METAL', 'CAM workbench should remember the previous workbench');

  viewer.finishCamWorkbench();
  assert(history.activeWorkbench === 'SHEET_METAL', 'Finishing CAM should return to the previous workbench');
  assert(viewer._camWorkbenchReturnTarget == null, 'Finishing CAM should clear its return target');
}

export async function test_cam_workbench_hiding_panel_releases_context_toolbar_suppression() {
  const previousReasons = (SelectionFilter as any)._contextSuppressReasons;
  (SelectionFilter as any)._contextSuppressReasons = new Set();
  try {
    const history = new PartHistory();
    history.activeWorkbench = 'CAM';
    const events: string[] = [];
    const viewer: any = {
      _viewerOnlyMode: false,
      partHistory: history,
      accordion: {
        showSection(title: string) {
          events.push(`show:${title}`);
          return true;
        },
        hideSection(title: string) {
          events.push(`hide:${title}`);
          return true;
        },
      },
      _workbenchPanelRecords: new Map(),
      _getActiveWorkbenchId: workbenchMethods._getActiveWorkbenchId,
      _registerWorkbenchPanel: workbenchMethods._registerWorkbenchPanel,
      _refreshWorkbenchPanelVisibility: workbenchMethods._refreshWorkbenchPanelVisibility,
    };

    viewer._registerWorkbenchPanel({
      id: 'camHistory',
      title: 'CAM History',
      source: 'builtin',
      workbenches: ['CAM'],
      onVisibilityChange: (visible: boolean) => SelectionFilter.setContextBarSuppressed('test-cam-history', visible),
    });

    viewer._refreshWorkbenchPanelVisibility();
    assert(
      (SelectionFilter as any)._contextSuppressReasons.has('test-cam-history'),
      'Visible CAM history panel should be able to own context toolbar suppression while an operation is open',
    );

    history.activeWorkbench = 'MODELING';
    viewer._refreshWorkbenchPanelVisibility();
    assert(events.includes('hide:CAM History'), 'Switching away from CAM should hide the CAM history side panel');
    assert(
      !(SelectionFilter as any)._contextSuppressReasons.has('test-cam-history'),
      'Hiding the CAM history panel should release context toolbar suppression',
    );
  } finally {
    try { SelectionFilter.setContextBarSuppressed('test-cam-history', false); } catch { /* ignore cleanup */ }
    (SelectionFilter as any)._contextSuppressReasons = previousReasons;
  }
}

export async function test_cam_plan_manager_invalidates_generated_operation_after_param_edit() {
  const solid = makeCubeMeshSolid(8);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation('cam3axis', {
    id: 'CAM_DIRTY',
    name: 'Dirty CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  assert(operation, 'CAM manager should create an operation for invalidation testing');
  const first = manager.generateAll(viewer);
  assert(first.paths.length > 0, 'CAM invalidation test should start with generated paths');
  assert(operation.persistentData?.toolpath?.toolDiameter === 1, 'Initial generated CAM data should use the original tool diameter');
  assert(operation.persistentData?.gcode?.includes('G21'), 'Initial generated CAM data should include G-code');

  operation.inputParams.toolDiameter = 2;
  assert(manager.invalidateOperation(operation, 'field:toolDiameter'), 'CAM manager should invalidate edited operations');
  assert(!operation.persistentData?.toolpath, 'CAM invalidation should clear stale generated toolpaths');
  assert(!operation.persistentData?.gcode, 'CAM invalidation should clear stale generated G-code');
  assert(operation.persistentData?.invalidatedReason === 'field:toolDiameter', 'CAM invalidation should record the edited field');
  assert(manager.getCombinedPlan().paths.length === 0, 'CAM combined plan should not expose stale generated paths after invalidation');

  const regenerated = manager.generateAll(viewer);
  assert(regenerated.paths.length > 0, 'CAM manager should regenerate after invalidation');
  assert(operation.persistentData?.toolpath?.toolDiameter === 2, 'Regenerated CAM data should use the edited tool diameter');
  assert(!operation.persistentData?.invalidatedAt, 'Regenerated CAM data should clear the invalidation marker');
}

export async function test_cam_part_history_model_change_invalidates_generated_operations() {
  const history = new PartHistory();
  const cube = await history.newFeature('P.CU');
  cube.inputParams.id = 'CAM_MODEL_SOURCE';
  cube.inputParams.sizeX = 8;
  cube.inputParams.sizeY = 8;
  cube.inputParams.sizeZ = 8;
  await history.runHistory();

  const operation = history.camPlanManager.createOperation('cam3axis', {
    id: 'CAM_MODEL_DIRTY',
    name: 'Model Dirty CAM',
    targetSolids: ['CAM_MODEL_SOURCE'],
    toolDiameter: 1,
    stepover: 2,
    stepDown: 4,
    safeHeight: 2,
  });
  assert(operation, 'Part history CAM invalidation test should create an operation');
  const generated = history.camPlanManager.generateAll({ scene: history.scene, partHistory: history });
  assert(generated.paths.length > 0, 'Part history CAM invalidation test should generate toolpaths');
  assert(operation.persistentData?.toolpath && operation.persistentData?.gcode, 'Generated CAM data should be cached before the model edit');

  cube.inputParams.sizeX = 10;
  await history.runHistory();

  assert(!operation.persistentData?.toolpath, 'Model changes should clear stale generated CAM toolpaths');
  assert(!operation.persistentData?.gcode, 'Model changes should clear stale generated CAM G-code');
  assert(operation.persistentData?.invalidatedReason === 'model-history', 'Model-change CAM invalidation should record the model-history reason');
  assert(history.camPlanManager.getCombinedPlan().paths.length === 0, 'Combined CAM plan should not expose stale paths after model invalidation');
}

export async function test_cam_preview_renders_actual_toolpath_polyline() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const plan = generateThreeAxisToolpath(viewer, {
    id: 'CAM_PREVIEW',
    name: 'Preview CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    stockMargin: 3,
  });
  const scene = new THREE.Scene();
  const runtime = new CamWorkbenchManager({
    scene,
    partHistory: { scene },
    render() {},
  });
  runtime.setActive(true);
  const group = runtime.preview(plan);
  assert(group, 'CAM preview should create a preview group');
  const mapped = new THREE.Vector3(1, 2, 3).applyMatrix4(group!.matrix);
  assert(mapped.x === 1 && mapped.y === 3 && mapped.z === 2, 'CAM preview should map machine Z onto the scene Y up axis');
  const polyline = group.getObjectByName('CAM Toolpath Polyline') as any;
  assert(polyline?.isGroup, 'CAM preview should render the actual toolpath as a grouped motion trace');
  assert(
    !group!.children.some((child: any) => String(child?.name || '').startsWith('CAM Cut Path')),
    'CAM preview should not render duplicate raw cut-path overlays when typed motion segments are available',
  );
  const motionLinePointCount = polyline.children.reduce((sum: number, child: any) => (
    sum + (child.geometry?.attributes?.position?.count || 0)
  ), 0);
  assert(motionLinePointCount === plan.simulation.motionSegments.length * 2, 'CAM preview motion trace should render persisted motion segments without connecting unrelated moves');
  assert(polyline.getObjectByName('CAM Cut Motion'), 'CAM preview motion trace should distinguish cutting moves');
  assert(polyline.getObjectByName('CAM Rapid Motion'), 'CAM preview motion trace should distinguish rapid and retract moves');
  assert(
    polyline.children.every((child: any) => child.material?.depthTest !== false),
    'CAM preview motion trace should depth-test travel moves so they do not draw through the model as apparent cuts',
  );
  assert(runtime._samples.length === plan.simulation.motionPolyline.length, 'CAM toolhead animation should sample every actual motion polyline point');
  assert(runtime._totalDistance > plan.summary.estimatedCutLength, 'CAM toolhead animation should include rapid, plunge, and retract motion beyond cut length');
  const firstMotionPoint = plan.simulation.motionPolyline[0];
  assert(Math.abs(runtime.tool?.position?.z - firstMotionPoint[2]) < 1e-6, 'CAM toolhead should start at the first actual motion polyline point');
  group!.updateMatrixWorld(true);
  const toolWorldBox = new THREE.Box3().setFromObject(runtime.tool!);
  const toolWorldSize = new THREE.Vector3();
  toolWorldBox.getSize(toolWorldSize);
  assert(toolWorldSize.y >= plan.toolLength - 1e-6, 'CAM toolhead should be vertical along scene Y, not entering from the side');
  assert(toolWorldSize.y > toolWorldSize.z * 4, 'CAM toolhead scene Y span should dominate its scene Z span');
  const hullGroup = group.getObjectByName('CAM Swept Cutter Hulls') as any;
  assert(hullGroup, 'CAM preview should render swept cutter hulls');
  const firstHullMesh = hullGroup.children?.find?.((child: any) => child?.isMesh);
  assert(firstHullMesh, 'CAM preview should render swept cutter hull meshes');
  firstHullMesh.geometry?.computeBoundingBox?.();
  const hullBox = firstHullMesh.geometry?.boundingBox;
  assert(
    hullBox && (hullBox.max.z - hullBox.min.z) >= plan.toolLength - 1e-6,
    'CAM preview swept cutter hull should show the vertical cutter volume, not a centerline tube',
  );
  runtime.setSimulationDistance(0);
  runtime.setSimulationDistance(runtime._totalDistance);
  const stock = group.getObjectByName('CAM Stock') as any;
  runtime.setVisualizationOptions({
    toolpath: false,
    tool: false,
    sweptVolume: false,
    stock: false,
  });
  assert(polyline.visible === false, 'CAM visualization options should hide the toolpath polyline');
  assert(runtime.tool?.visible === false, 'CAM visualization options should hide the toolhead');
  assert(hullGroup.visible === false, 'CAM visualization options should hide swept cutter volume');
  assert(stock?.visible === false, 'CAM visualization options should hide stock');
  runtime.setVisualizationOptions({ toolpath: true, tool: true });
  assert(polyline.visible === true && runtime.tool?.visible === true, 'CAM visualization options should restore enabled preview categories');
  runtime.clearPreview();
  assert(!scene.getObjectByName('__BREP_CAM_PREVIEW__'), 'CAM preview clear should remove the preview group');
}

export async function test_cam_preview_uses_preserved_filter_samples_for_slider_snap_points() {
  const scene = new THREE.Scene();
  const runtime = new CamWorkbenchManager({
    scene,
    partHistory: { scene },
    render() {},
  });
  runtime.setActive(true);
  const plan: any = {
    paths: [{
      id: 'FILTERED',
      z: 0,
      feedRate: 100,
      plungeRate: 50,
      points: [[0, 0, 0], [4, 0, 0]],
      simulationSamples: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [4, 0, 0]],
    }],
    bounds: { min: [-1, -1, -1], max: [5, 1, 1] },
    safeZ: 2,
    machine: { defaultRapidRate: 2500 },
    toolShape: 'flat',
    toolDiameter: 1,
    toolLength: 5,
    cutterProfile: { kind: 'flat', diameter: 1, radius: 0.5, cuttingLength: 5, shaftLength: 0 },
    simulation: {
      samples: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [4, 0, 0]],
      motionPolyline: [[0, 0, 2], [0, 0, 0], [4, 0, 0]],
      motionSegments: [
        { start: [0, 0, 2], end: [0, 0, 0], kind: 'plunge', feedRate: 50, sourcePathId: 'FILTERED' },
        { start: [0, 0, 0], end: [4, 0, 0], kind: 'cut', feedRate: 100, sourcePathId: 'FILTERED', sourceSegmentIndex: 0 },
      ],
      sweptSegments: [],
      sweptHulls: [],
    },
    summary: { estimatedCutLength: 4 },
  };

  const group = runtime.preview(plan);
  assert(group, 'CAM filtered-sample preview should create a preview group');
  assert(runtime._samples.length > plan.simulation.motionPolyline.length, 'CAM preview runtime should add preserved line-filter samples as slider snap points');
  runtime.setSimulationFrameIndex(3);
  assert(pointsNearlyEqual([runtime.tool?.position?.x, runtime.tool?.position?.y, runtime.tool?.position?.z], [2, 0, 0]), 'CAM preview slider should be able to snap to a preserved pre-filter cutter-location point');
  runtime.clearPreview();
}

export async function test_cam_preview_renders_selected_cutter_profile_shape() {
  const solid = makeSlopedTopMeshSolid(10, 10, 2, 8);
  const viewer = makeViewerWithSolid(solid);
  const plan = generateThreeAxisToolpath(viewer, {
    id: 'CAM_PREVIEW_BALL',
    name: 'Preview Ball Cutter',
    strategy: 'parallel-finish-zig',
    toolShape: 'ball',
    toolDiameter: 2,
    toolLength: 12,
    shaftLength: 4,
    stepover: 5,
    sampleSpacing: 20,
    safeHeight: 2,
  });
  const scene = new THREE.Scene();
  const runtime = new CamWorkbenchManager({
    scene,
    partHistory: { scene },
    render() {},
  });
  runtime.setActive(true);
  const group = runtime.preview(plan);
  assert(group, 'CAM ball cutter preview should create a preview group');
  const cutterMesh = runtime.tool?.children?.find((child: any) => child?.isMesh && String(child.name || '').includes('ball')) as any;
  assert(cutterMesh, 'CAM preview should name the visible cutter mesh with the selected cutter shape');
  assert(cutterMesh.userData?.camCutterProfile?.kind === 'ball', 'CAM preview cutter mesh should retain selected cutter profile metadata');
  const positions = cutterMesh.geometry?.attributes?.position;
  assert(positions?.count > 0, 'CAM ball cutter preview should have mesh vertices');
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.count; index += 1) {
    minZ = Math.min(minZ, positions.getZ(index));
    maxZ = Math.max(maxZ, positions.getZ(index));
  }
  assert(maxZ - minZ >= 16 - 1e-6, 'CAM ball cutter preview mesh should include the shaft extension above the cutting length');
  let maxTipRadius = 0;
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getZ(index) - minZ) > 1e-6) continue;
    maxTipRadius = Math.max(maxTipRadius, Math.hypot(positions.getX(index), positions.getY(index)));
  }
  assert(maxTipRadius < 1e-4, 'CAM ball cutter preview should taper to a rounded tip instead of a flat endmill bottom');
  runtime.clearPreview();
}

export async function test_cam_machine_profile_controls_posted_gcode_and_serialization() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.updateMachineProfile({
    name: 'Bench GRBL',
    maxSpindleRPM: 5000,
    safeParkZ: 20,
    tokenSpacer: false,
    stripComments: true,
    header: 'G54',
    footer: 'G0 X0 Y0',
  });
  const operation = manager.createOperation('cam3axis', {
    id: 'CAM_POST',
    name: 'Posted CAM',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    spindleRPM: 12000,
  });
  assert(operation, 'CAM manager should create an operation for machine post testing');

  const plan = manager.generateAll(viewer);
  assert(plan.paths.length > 0, 'CAM post test should generate paths');
  assert(plan.machine.name === 'Bench GRBL', 'Combined CAM plan should carry the active machine profile');
  assert(plan.gcode.includes('G54'), 'CAM G-code should include machine header macros');
  assert(plan.gcode.includes('G0Z20'), 'CAM G-code should use machine safe park Z and compact tokens');
  assert(plan.gcode.includes('M3S5000'), 'CAM G-code should clamp spindle speed to machine maximum');
  assert(plan.gcode.includes('G0 X0 Y0'), 'CAM G-code should include machine footer macros');
  assert(!plan.gcode.includes(';'), 'CAM G-code should strip generated comments when the machine profile requests it');

  manager.updateMachineProfile({ maxSpindleRPM: 5000, tokenSpacer: false });
  assert(operation.persistentData?.toolpath, 'No-op global machine edits should not discard generated CAM toolpaths');
  assert(!operation.persistentData?.invalidatedReason, 'No-op global machine edits should not mark generated CAM data stale');

  const serialized = manager.toSerializable();
  assert(serialized.machineProfile.maxSpindleRPM === 5000, 'CAM machine max spindle should serialize');
  assert(serialized.machineProfile.stripComments === true, 'CAM machine comment policy should serialize');

  const restored = new CamPlanManager(null);
  restored.loadSerializable(serialized);
  const restoredProfile = restored.getMachineProfile();
  assert(restoredProfile.name === 'Bench GRBL', 'CAM machine name should survive serialization');
  assert(restoredProfile.maxSpindleRPM === 5000, 'CAM machine max spindle should survive serialization');
  assert(restoredProfile.safeParkZ === 20, 'CAM machine safe park Z should survive serialization');
  assert(restoredProfile.tokenSpacer === false, 'CAM machine token spacing should survive serialization');
}

export async function test_cam_combined_gcode_posts_multiple_operations_as_single_program() {
  const solid = makeCubeMeshSolid(10);
  const viewer = makeViewerWithSolid(solid);
  const manager = new CamPlanManager(null);
  manager.createOperation('cam3axis', {
    id: 'CAM_OP_A',
    name: 'First Toolpath',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    spindleRPM: 5000,
  });
  manager.createOperation('cam3axis', {
    id: 'CAM_OP_B',
    name: 'Second Toolpath',
    strategy: 'waterline-contour',
    toolDiameter: 1,
    stepover: 2,
    stepDown: 5,
    safeHeight: 2,
    spindleRPM: 8000,
  });

  const plan = manager.generateAll(viewer);
  assert(plan.paths.length > 0, 'Combined CAM program should include paths from generated operations');
  const combinedPathIds = new Set(plan.paths.map((path) => path.id));
  const secondOperationPaths = plan.paths.filter((path: any) => path.operationId === 'CAM_OP_B');
  assert(combinedPathIds.size === plan.paths.length, 'Combined CAM path ids should be unique across operation results');
  assert(plan.paths.some((path: any) => String(path.id).startsWith('CAM_OP_A:') && path.operationId === 'CAM_OP_A' && path.sourcePathId), 'Combined CAM paths should retain first-operation identity without mutating the saved operation path id');
  assert(plan.paths.some((path: any) => String(path.id).startsWith('CAM_OP_B:') && path.operationId === 'CAM_OP_B' && path.sourcePathId), 'Combined CAM paths should retain second-operation identity without colliding path ids');
  assert(secondOperationPaths.length > 0 && secondOperationPaths.every((path: any) => Number.isFinite(Number(path.orderingPriority))), 'Combined waterline paths should retain ordering-priority metadata for stable linking');
  assert(plan.simulation.motionSegments.length === plan.summary.motionSegmentCount, 'Combined CAM program should summarize recomputed motion segments');
  assert(plan.summary.estimatedRapidLength > 0, 'Combined CAM program should summarize rapid and retract travel length');
  assert(nearlyEqual(
    plan.summary.estimatedRapidLength,
    rapidRetractLengthFromMotionSegments(plan.simulation.motionSegments),
    1e-5,
  ), 'Combined CAM rapid length summary should match recomputed rapid and retract motion segments');
  assert(plan.summary.moveCount === toolpathCutMoveCount(plan.paths), 'Combined CAM move summary should count only cutting path segments');
  assert(nearlyEqual(
    plan.summary.estimatedCutLength,
    toolpathCutLength(plan.paths),
    1e-5,
  ), 'Combined CAM cut-length summary should count only cutting path segments');
  assert(plan.simulation.motionSegments.every((segment: any) => Number(segment.feedRate) > 0), 'Combined CAM motion segments should include feed-rate metadata');
  assert(plan.simulation.motionSegments.every((segment: any) => combinedPathIds.has(segment.sourcePathId)), 'Combined CAM motion segments should retain source path ids');
  assertGcodeMotionMatchesSimulation(plan);
  const gcode = plan.gcode;
  const countLines = (pattern: RegExp) => (gcode.match(pattern) || []).length;
  assert(countLines(/^M2\b/gm) === 1, 'Combined CAM G-code should emit exactly one program end');
  assert(countLines(/^M5\b/gm) === 1, 'Combined CAM G-code should stop the spindle once at the program end');
  assert(gcode.includes('M3 S5000'), 'Combined CAM G-code should start the first operation spindle speed');
  assert(gcode.includes('M3 S8000'), 'Combined CAM G-code should update spindle speed for the second operation');
  assert(gcode.includes('; ---- Operation 1: First Toolpath ----'), 'Combined CAM G-code should label the first operation section');
  assert(gcode.includes('; ---- Operation 2: Second Toolpath ----'), 'Combined CAM G-code should label the second operation section');
  assert(countLines(/^; Generated by BREP CAM$/gm) === 1, 'Combined CAM G-code should emit a single program header');

  const restored = new CamPlanManager(null);
  restored.loadSerializable(manager.toSerializable());
  const restoredPlan = restored.getCombinedPlan();
  const restoredGcode = restoredPlan.gcode || '';
  const restoredPathIds = new Set(restoredPlan.paths.map((path) => path.id));
  const restoredSecondOperationPaths = restoredPlan.paths.filter((path: any) => path.operationId === 'CAM_OP_B');
  assert(restoredPlan.paths.length === plan.paths.length, 'Restored multi-operation CAM plan should recombine persisted generated paths');
  assert(restoredPathIds.size === restoredPlan.paths.length, 'Restored multi-operation CAM plan should preserve unique combined path ids');
  assert(restoredPlan.paths.some((path: any) => String(path.id).startsWith('CAM_OP_A:') && path.operationId === 'CAM_OP_A'), 'Restored combined CAM paths should retain first operation identity');
  assert(restoredPlan.paths.some((path: any) => String(path.id).startsWith('CAM_OP_B:') && path.operationId === 'CAM_OP_B'), 'Restored combined CAM paths should retain second operation identity');
  assert(restoredSecondOperationPaths.length === secondOperationPaths.length && restoredSecondOperationPaths.every((path: any) => Number.isFinite(Number(path.orderingPriority))), 'Restored combined waterline paths should preserve ordering-priority metadata');
  assert(restoredPlan.simulation.motionSegments.every((segment: any) => restoredPathIds.has(segment.sourcePathId)), 'Restored combined CAM motion segments should reference combined path ids');
  assert(restoredPlan.summary.pathCount === plan.summary.pathCount, 'Restored multi-operation CAM plan should recompute the combined summary from persisted operations');
  assert(restoredPlan.summary.estimatedRapidLength === plan.summary.estimatedRapidLength, 'Restored multi-operation CAM plan should recompute rapid travel summary from persisted operations');
  assertGcodeMotionMatchesSimulation(restoredPlan);
  assert(restoredGcode.includes('; ---- Operation 1: First Toolpath ----'), 'Restored multi-operation CAM G-code should include the first operation section');
  assert(restoredGcode.includes('; ---- Operation 2: Second Toolpath ----'), 'Restored multi-operation CAM G-code should include the second operation section');
  assert((restoredGcode.match(/^M2\b/gm) || []).length === 1, 'Restored multi-operation CAM G-code should still have one program end');
}
