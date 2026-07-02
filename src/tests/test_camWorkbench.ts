import * as THREE from 'three';
import { PartHistory } from '../PartHistory.js';
import { SelectionFilter } from '../UI/SelectionFilter.js';
import { CamHistoryWidget } from '../UI/cam/CamHistoryWidget.js';
import { workbenchMethods } from '../UI/viewer/workbenchMethods.js';
import { CamPlanManager } from '../cam/CamPlanManager.js';
import { CamWorkbenchManager } from '../cam/CamWorkbenchManager.js';
import { generateThreeAxisToolpath, generateThreeAxisToolpathAsync } from '../cam/camToolpath.js';
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

function optionValues(select: HTMLSelectElement | null) {
  return Array.from(select?.options || []).map((option) => option.value);
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
  assert(result.simulation.sweptHulls.length === result.summary.sweptHullCount, 'CAM should persist swept cutter hull artifacts');
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
  assert(contour.paths.length >= 4, 'Waterline contour CAM should emit multiple offset passes across valid cube cross-section levels');
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
  const retracts = (result: any) => (
    result.simulation.motionSegments.filter((segment: any) => segment.kind === 'retract').length
  );

  assert(conventional.paths.length > lowHop.paths.length, 'Low-hop contour should combine same-depth offset passes into fewer paths');
  assert(retracts(conventional) > retracts(lowHop), 'Low-hop contour should reduce retract/hop moves between offset passes');
  assert(lowHop.paths.length === lowHop.summary.levelCount, 'Low-hop contour should emit one linked contour path per cube depth level');
  assert(lowHop.paths.every((path) => (
    path.points.length > 8
    && path.points.every((point) => Math.abs(point[2] - path.z) < 1e-6)
  )), 'Low-hop contour should go around multiple offsets at one Z before dropping to the next depth');
  assert(!pathCrossesTargetInterior(lowHop.paths, 10), 'Low-hop outside contour should still protect the target solid interior');
  assert(!pathViolatesTargetClearance(lowHop.paths, 10, 0.5), 'Low-hop outside contour should still honor cutter radius clearance');
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
    const operation = manager.getOperations()[0];
    const entryId = operation.inputParams.id;
    widget.historyWidget.revealEntry(entryId, { focus: false, notify: false, scroll: false });
    const form = widget.historyWidget.getFormForEntry(entryId);
    assert(form, 'CAM history should render a schema form for the selected operation');
    const root = form._shadow || form.uiElement?.shadowRoot || form.uiElement;
    const selectFor = (key: string) => root?.querySelector?.(`.field-row[data-key="${key}"] select`) as HTMLSelectElement | null;
    const rowFor = (key: string) => root?.querySelector?.(`.field-row[data-key="${key}"]`) as HTMLElement | null;

    const strategy = selectFor('strategy');
    const rasterAxis = selectFor('rasterAxis');
    const cutRegion = selectFor('cutRegion');
    assert(strategy?.tagName === 'SELECT', 'CAM strategy should render as an option selector');
    assert(rasterAxis?.tagName === 'SELECT', 'CAM raster axis should render as an option selector');
    assert(cutRegion?.tagName === 'SELECT', 'CAM cut region should render as an option selector');
    assert(!rowFor('rapidRate'), 'CAM operation history should not render the removed unused rapid-rate field');
    assert(optionValues(strategy).join('|') === 'waterline-raster|waterline-contour|waterline-contour-low-hop', 'CAM strategy selector should list supported strategies');
    assert(optionValues(rasterAxis).join('|') === 'X|Y', 'CAM raster axis selector should list supported axes');
    assert(optionValues(cutRegion).join('|') === 'outside|inside', 'CAM cut region selector should list supported cut regions');

    strategy!.value = 'waterline-contour';
    strategy!.dispatchEvent(new Event('change', { bubbles: true }));
    cutRegion!.value = 'inside';
    cutRegion!.dispatchEvent(new Event('change', { bubbles: true }));
    assert(operation.inputParams.strategy === 'waterline-contour', 'CAM strategy selector should update operation params');
    assert(operation.inputParams.cutRegion === 'inside', 'CAM cut region selector should update operation params');

    const controller = widget.machineEl.querySelector('select') as HTMLSelectElement | null;
    assert(controller?.tagName === 'SELECT', 'CAM machine controller should render as an option selector');
    assert(optionValues(controller).join('|') === 'grbl|linuxcnc|fanuc', 'CAM controller selector should list known post targets');
    const machineLabels = Array.from(widget.machineEl.querySelectorAll('.cam-machine-field > span')).map((span) => span.textContent || '');
    assert(!machineLabels.includes('Work X') && !machineLabels.includes('Work Y') && !machineLabels.includes('Work Z'), 'CAM machine panel should not show unused workspace size fields');

    const visualLabels = Array.from(widget.visualEl.querySelectorAll('.cam-visual-toggle span')).map((span) => span.textContent || '');
    assert(visualLabels.join('|') === 'Tool path|Tool|Cut volume|Stock', 'CAM visualization toggles should expose preview visibility options');
    const visualInputs = Array.from(widget.visualEl.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    assert(visualInputs.length === 4 && visualInputs.every((input) => input.checked), 'CAM visualization toggles should default to visible');
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
  operation.inputParams.rapidRate = 1234;
  const plan = manager.generateAll(viewer);
  assert(plan.paths.length > 0, 'CAM manager should generate a combined plan');

  const serialized = manager.toSerializable();
  assert(!Object.prototype.hasOwnProperty.call(serialized.operations[0]?.inputParams || {}, 'rapidRate'), 'CAM serialization should strip removed unused rapid-rate fields');
  const restored = new CamPlanManager(null);
  restored.loadSerializable(serialized);
  const restoredOperation = restored.getOperations()[0];
  assert(restoredOperation?.inputParams?.id === 'CAM_TEST', 'CAM operation id should survive serialization');
  assert(!Object.prototype.hasOwnProperty.call(restoredOperation?.inputParams || {}, 'rapidRate'), 'CAM load should not restore removed unused rapid-rate fields');
  assert(restoredOperation?.persistentData?.gcode?.includes('G21'), 'Generated CAM G-code should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.sweptSegments?.length > 0, 'CAM simulation segment hulls should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.motionPolyline?.length > 0, 'CAM actual toolpath polyline should survive serialization');
  assert(restoredOperation?.persistentData?.toolpath?.simulation?.sweptHulls?.length > 0, 'CAM swept hull artifacts should survive serialization');
}

export async function test_cam_workbench_registers_and_persists_part_history_state() {
  const definitions = listWorkbenchDefinitions();
  const camDefinition = getWorkbenchDefinition('CAM');
  const camPanels = camDefinition.sidePanels as Record<string, boolean>;
  assert(definitions.some((definition) => definition.id === 'CAM'), 'CAM workbench should be registered in the global workbench list');
  assert(camPanels.camOperations === true, 'CAM workbench should expose the CAM operations side panel');
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
  history.camPlanManager.createOperation('cam3axis', {
    id: 'CAM_SAVE',
    name: 'Saved Operation',
    strategy: 'waterline-contour',
    cutRegion: 'inside',
    toolDiameter: 2,
  });

  const json = await history.toJSON();
  const raw = JSON.parse(json);
  assert(raw.activeWorkbench === 'CAM', 'Part history JSON should persist the active CAM workbench');
  assert(raw.cam?.machineProfile?.controller === 'linuxcnc', 'Part history JSON should persist the CAM machine profile');
  assert(raw.cam?.operations?.[0]?.inputParams?.strategy === 'waterline-contour', 'Part history JSON should persist CAM operation params');

  const restored = new PartHistory();
  await restored.fromJSON(json, { skipUndoReset: true });
  const restoredOperation = restored.camPlanManager.getOperations()[0];
  assert(restored.activeWorkbench === 'CAM', 'Restored part history should restore the CAM workbench');
  assert(restored.camPlanManager.getMachineProfile().name === 'Saved CNC Mill', 'Restored part history should restore CAM machine settings');
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
  const camPanel = { id: 'camOperations', source: 'builtin', workbenches: ['CAM'] };
  const generalWorkbenches = ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'SIMULATION', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'];
  const records = [
    { id: 'featureHistory', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
    { id: 'expressions', source: 'builtin', workbenches: generalWorkbenches },
    { id: 'sceneManager', source: 'builtin', workbenches: generalWorkbenches },
    { id: 'pmiViews', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
    { id: 'sheets2D', source: 'builtin', workbenches: ['MODELING', 'IMPORT', 'SURFACING', 'SHEET_METAL', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'ALL'] },
  ];

  assert(isSidePanelAllowed(camPanel, 'CAM'), 'CAM operations panel should be visible in the CAM workbench');
  for (const record of records) {
    assert(!isSidePanelAllowed(record, 'CAM'), `${record.id} panel should be hidden in the CAM workbench`);
  }
  assert(!isSidePanelAllowed(camPanel, 'MODELING'), 'CAM operations panel should be hidden outside the CAM workbench');
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
      id: 'camOperations',
      title: 'CAM',
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
    assert(events.includes('hide:CAM'), 'Switching away from CAM should hide the CAM side panel');
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
  assert(polyline?.isLine, 'CAM preview should render the actual toolpath as a polyline');
  const positionCount = polyline.geometry?.attributes?.position?.count || 0;
  assert(positionCount === plan.simulation.motionPolyline.length, 'CAM preview polyline should use persisted motion polyline points');
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
  const gcode = plan.gcode;
  const countLines = (pattern: RegExp) => (gcode.match(pattern) || []).length;
  assert(countLines(/^M2\b/gm) === 1, 'Combined CAM G-code should emit exactly one program end');
  assert(countLines(/^M5\b/gm) === 1, 'Combined CAM G-code should stop the spindle once at the program end');
  assert(gcode.includes('M3 S5000'), 'Combined CAM G-code should start the first operation spindle speed');
  assert(gcode.includes('M3 S8000'), 'Combined CAM G-code should update spindle speed for the second operation');
  assert(gcode.includes('; ---- Operation 1: First Toolpath ----'), 'Combined CAM G-code should label the first operation section');
  assert(gcode.includes('; ---- Operation 2: Second Toolpath ----'), 'Combined CAM G-code should label the second operation section');
  assert(countLines(/^; Generated by BREP CAM$/gm) === 1, 'Combined CAM G-code should emit a single program header');
}
