import { PartHistory } from '../PartHistory.js';
import { CamPlanManager } from '../cam/CamPlanManager.js';
import {
  CAM_TOOLPATH_SIMULATOR_GROUP_NAME,
  CAM_TOOLPATH_TOOL_HEAD_NAME,
  CamToolpathSimulator,
} from '../cam/CamToolpathSimulator.js';
import { CAM_DEBUG_SLICE_SOLID_KIND } from '../cam/CamDebugSliceSolids.js';
import {
  CAM_TOOLPATH_SCHEMA_VERSION,
  buildLinearToolpathPath,
  generateGcodeForCamToolpathProgram,
  makeBallEndMillCutter,
  makeFlatEndMillCutter,
  normalizeCamOrientation,
  summarizeCamToolpathProgram,
  type CamToolpathProgram,
} from '../cam/CamToolpathDefinition.js';
import { CAM_OPERATION_TYPE_SHADOW_CUTTER, ShadowCutterEntity } from '../cam/ShadowCutterEntity.js';
import { CAM_OPERATION_TYPE_ROUGHING, RoughingEntity } from '../cam/RoughingEntity.js';
import { CAM_OPERATION_TYPE_SURFACING, SurfacingEntity } from '../cam/SurfacingEntity.js';
import { normalizeReferenceSelectionList } from '../UI/featureDialogWidgets/utils.js';
import { workbenchMethods } from '../UI/viewer/workbenchMethods.js';
import { getWorkbenchDefinition } from '../workbenches/index.js';
import * as THREE from 'three';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

function makeBoxMeshSolid(
  sizeX = 10,
  sizeY = 10,
  sizeZ = 10,
  options: { name?: string; offsetX?: number; offsetY?: number; offsetZ?: number } = {},
) {
  const name = options.name || 'cam-test-cube';
  const x0 = options.offsetX || 0;
  const y0 = options.offsetY || 0;
  const z0 = options.offsetZ || 0;
  const x1 = x0 + sizeX;
  const y1 = y0 + sizeY;
  const z1 = z0 + sizeZ;
  const vertProperties = [
    x0, y0, z0,
    x1, y0, z0,
    x1, y1, z0,
    x0, y1, z0,
    x0, y0, z1,
    x1, y0, z1,
    x1, y1, z1,
    x0, y1, z1,
  ];
  const triVerts = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  return {
    name,
    type: 'SOLID',
    visible: true,
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeNamedFaceBoxSolid(
  sizeX = 10,
  sizeY = 10,
  sizeZ = 8,
  options: { name?: string; topFaceName?: string } = {},
) {
  const solid = makeBoxMeshSolid(sizeX, sizeY, sizeZ, { name: options.name || 'cam-test-owned-face-block' }) as any;
  const topFaceName = options.topFaceName || 'TOP';
  const vertices = [
    [0, 0, 0],
    [sizeX, 0, 0],
    [sizeX, sizeY, 0],
    [0, sizeY, 0],
    [0, 0, sizeZ],
    [sizeX, 0, sizeZ],
    [sizeX, sizeY, sizeZ],
    [0, sizeY, sizeZ],
  ];
  const triangle = (a: number, b: number, c: number) => ({
    faceName: topFaceName,
    indices: [a, b, c],
    p1: vertices[a],
    p2: vertices[b],
    p3: vertices[c],
  });
  solid.getFace = (faceName: string) => (faceName === topFaceName ? [
    triangle(2, 3, 7),
    triangle(2, 7, 6),
  ] : []);
  solid.getFaceNames = () => [topFaceName];
  return solid;
}

function makeRingMeshSolid({
  outerRadius = 5,
  innerRadius = 2,
  height = 10,
  segments = 32,
  name = 'cam-test-ring',
  centerX = 0,
  centerZ = 0,
  bottomY = 0,
} = {}) {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  const pushVertex = (x: number, y: number, z: number) => {
    const index = vertProperties.length / 3;
    vertProperties.push(x, y, z);
    return index;
  };
  const topOuter: number[] = [];
  const topInner: number[] = [];
  const bottomOuter: number[] = [];
  const bottomInner: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    topOuter.push(pushVertex(centerX + outerRadius * cos, bottomY + height, centerZ + outerRadius * sin));
    topInner.push(pushVertex(centerX + innerRadius * cos, bottomY + height, centerZ + innerRadius * sin));
    bottomOuter.push(pushVertex(centerX + outerRadius * cos, bottomY, centerZ + outerRadius * sin));
    bottomInner.push(pushVertex(centerX + innerRadius * cos, bottomY, centerZ + innerRadius * sin));
  }
  const tri = (...indices: number[]) => triVerts.push(...indices);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    tri(topOuter[index], topOuter[next], topInner[index]);
    tri(topInner[index], topOuter[next], topInner[next]);
    tri(bottomOuter[next], bottomOuter[index], bottomInner[index]);
    tri(bottomOuter[next], bottomInner[index], bottomInner[next]);
    tri(bottomOuter[index], bottomOuter[next], topOuter[index]);
    tri(topOuter[index], bottomOuter[next], topOuter[next]);
    tri(bottomInner[next], bottomInner[index], topInner[index]);
    tri(bottomInner[next], topInner[index], topInner[next]);
  }
  return {
    name,
    type: 'SOLID',
    visible: true,
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeCylinderMeshSolid({
  name = 'cam-test-cylinder',
  radius = 1,
  height = 4,
  centerX = 0,
  centerZ = 0,
  bottomY = 10,
  segments = 32,
} = {}) {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  const pushVertex = (x: number, y: number, z: number) => {
    const index = vertProperties.length / 3;
    vertProperties.push(x, y, z);
    return index;
  };
  const topCenter = pushVertex(centerX, bottomY + height, centerZ);
  const bottomCenter = pushVertex(centerX, bottomY, centerZ);
  const topRing: number[] = [];
  const bottomRing: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const x = centerX + radius * Math.cos(theta);
    const z = centerZ + radius * Math.sin(theta);
    topRing.push(pushVertex(x, bottomY + height, z));
    bottomRing.push(pushVertex(x, bottomY, z));
  }
  const tri = (...indices: number[]) => triVerts.push(...indices);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    tri(topCenter, topRing[index], topRing[next]);
    tri(bottomCenter, bottomRing[next], bottomRing[index]);
    tri(bottomRing[index], bottomRing[next], topRing[index]);
    tri(topRing[index], bottomRing[next], topRing[next]);
  }
  return {
    name,
    type: 'SOLID',
    visible: true,
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeZCylinderMeshSolid({
  name = 'cam-test-z-cylinder',
  radius = 1,
  height = 4,
  centerX = 0,
  centerY = 0,
  bottomZ = 0,
  segments = 32,
} = {}) {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  const pushVertex = (x: number, y: number, z: number) => {
    const index = vertProperties.length / 3;
    vertProperties.push(x, y, z);
    return index;
  };
  const topCenter = pushVertex(centerX, centerY, bottomZ + height);
  const bottomCenter = pushVertex(centerX, centerY, bottomZ);
  const topRing: number[] = [];
  const bottomRing: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const x = centerX + radius * Math.cos(theta);
    const y = centerY + radius * Math.sin(theta);
    topRing.push(pushVertex(x, y, bottomZ + height));
    bottomRing.push(pushVertex(x, y, bottomZ));
  }
  const tri = (...indices: number[]) => triVerts.push(...indices);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    tri(topCenter, topRing[index], topRing[next]);
    tri(bottomCenter, bottomRing[next], bottomRing[index]);
    tri(bottomRing[index], bottomRing[next], topRing[index]);
    tri(topRing[index], bottomRing[next], topRing[next]);
  }
  return {
    name,
    type: 'SOLID',
    visible: true,
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeSlopedBlockMeshSolid({
  name = 'cam-test-sloped-block',
  width = 10,
  depth = 8,
  leftHeight = 10,
  rightHeight = 4,
} = {}) {
  const vertProperties = [
    0, 0, 0,
    width, 0, 0,
    width, 0, depth,
    0, 0, depth,
    0, leftHeight, 0,
    width, rightHeight, 0,
    width, rightHeight, depth,
    0, leftHeight, depth,
  ];
  const triVerts = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  return {
    name,
    type: 'SOLID',
    visible: true,
    getMesh() {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
    },
  };
}

function makeFaceMeshObject(name: string, vertices: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(indices);
  const face = new THREE.Mesh(geometry) as any;
  face.name = name;
  face.type = 'FACE';
  face.visible = true;
  face.updateMatrixWorld?.(true);
  return face;
}

function makeTopRectFace({
  name = 'cam-test-top-face',
  width = 10,
  depth = 8,
  y = 10,
  x = 0,
  z = 0,
} = {}) {
  return makeFaceMeshObject(name, [
    x, y, z,
    x + width, y, z,
    x + width, y, z + depth,
    x, y, z + depth,
  ], [0, 1, 2, 0, 2, 3]);
}

function makeAnnularTopFace({
  name = 'cam-test-annular-top-face',
  outerRadius = 5,
  innerRadius = 2,
  y = 10,
  centerX = 0,
  centerZ = 0,
  segments = 48,
} = {}) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const pushVertex = (x: number, z: number) => {
    const index = vertices.length / 3;
    vertices.push(x, y, z);
    return index;
  };
  const outer: number[] = [];
  const inner: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const theta = (index / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    outer.push(pushVertex(centerX + outerRadius * cos, centerZ + outerRadius * sin));
    inner.push(pushVertex(centerX + innerRadius * cos, centerZ + innerRadius * sin));
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(outer[index], outer[next], inner[index]);
    indices.push(inner[index], outer[next], inner[next]);
  }
  return makeFaceMeshObject(name, vertices, indices);
}

function makeSlopedTopFace({
  name = 'cam-test-sloped-top-face',
  width = 10,
  depth = 8,
  leftHeight = 10,
  rightHeight = 4,
} = {}) {
  return makeFaceMeshObject(name, [
    0, leftHeight, 0,
    width, rightHeight, 0,
    width, rightHeight, depth,
    0, leftHeight, depth,
  ], [0, 1, 2, 0, 2, 3]);
}

function makeCurvedTopFace({
  name = 'cam-test-curved-top-face',
  width = 12,
  depth = 4,
  baseHeight = 5,
  crownHeight = 4,
  segments = 12,
} = {}) {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const x = width * t;
    const y = baseHeight + (Math.sin(Math.PI * t) * crownHeight);
    vertices.push(x, y, 0, x, y, depth);
  }
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, d, a, d, b);
  }
  return makeFaceMeshObject(name, vertices, indices);
}

function makeVerticalSideFace({
  name = 'cam-test-vertical-side-face',
  depth = 8,
  height = 10,
  x = 0,
} = {}) {
  return makeFaceMeshObject(name, [
    x, 0, 0,
    x, height, 0,
    x, height, depth,
    x, 0, depth,
  ], [0, 1, 2, 0, 2, 3]);
}

function makeObject3DSolid(rawSolid: any) {
  const solid = new THREE.Group() as any;
  solid.name = rawSolid.name;
  solid.type = 'SOLID';
  solid.visible = rawSolid.visible !== false;
  solid.getMesh = rawSolid.getMesh;
  return solid;
}

function makeViewerWithSolids(solids: any[]) {
  return {
    scene: {
      children: solids,
      getObjectByName(name: string) {
        return this.children.find((child: any) => child?.name === name) || null;
      },
    },
  };
}

function makeViewerWithSolid(solid = makeBoxMeshSolid()) {
  return makeViewerWithSolids([solid]);
}

function defaultCamParams(patch: Record<string, any> = {}) {
  return {
    id: 'SC1',
    name: 'Shadow Cutter',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    toolLength: 30,
    stockAllowance: 0.25,
    stepDown: 2,
    extraDepth: 0.5,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    stockProfile: { mode: 'auto', margin: 1 },
    ...patch,
  };
}

export async function test_cam_plan_manager_preserves_operations_and_profiles() {
  const manager = new CamPlanManager(null);
  manager.setMachineProfile({
    name: 'Fixture Mill',
    controller: 'linuxcnc',
    units: 'mm',
    maxSpindleRPM: 12000,
    defaultRapidRate: 3000,
    safeParkZ: 25,
    tokenSpacer: false,
    stripComments: true,
    header: 'G54',
    footer: 'G0 X0 Y0',
  });
  manager.setStockProfile({ mode: 'fixed', margin: 2, sizeX: 30, sizeY: 20, sizeZ: 10, offsetX: 1 });
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({ stockAllowance: 0.75 }));

  const serialized = manager.toSerializable();
  assert(serialized.operations.length === 1, 'CAM operation should serialize');
  assert(serialized.machineProfile.name === 'Fixture Mill', 'Machine profile should serialize');
  assert(serialized.stockProfile.mode === 'fixed', 'Stock profile should serialize');
  assert(serialized.operations[0]?.type === CAM_OPERATION_TYPE_SHADOW_CUTTER, 'Shadow Cutter type should serialize');
  assert(serialized.operations[0]?.inputParams?.id === operation?.inputParams?.id, 'Operation id should serialize');
  assert(serialized.operations[0]?.inputParams?.stockAllowance === 0.75, 'Shadow Cutter stock allowance should serialize');
  assert(serialized.operations[0]?.inputParams?.toolDiameter === 2, 'Shadow Cutter tool diameter should serialize');
  assert(serialized.operations[0]?.inputParams?.toolLength === 30, 'Shadow Cutter tool length should serialize');
}

export async function test_cam_plan_manager_strips_legacy_generated_data() {
  const manager = new CamPlanManager(null);
  manager.loadSerializable({
    operations: [
      {
        type: CAM_OPERATION_TYPE_SHADOW_CUTTER,
        inputParams: defaultCamParams({ id: 'CAM_LEGACY' }),
        persistentData: {
          toolpath: { paths: [{ id: 'old-path' }] },
          gcode: 'G21\n',
          generatedAt: '2026-07-01T00:00:00.000Z',
          summary: { pathCount: 1 },
          warnings: ['old warning'],
          generatorVersion: 2,
        },
      },
    ],
  });
  const operation = manager.getOperations()[0];
  assert(operation?.type === CAM_OPERATION_TYPE_SHADOW_CUTTER, 'CAM operation should hydrate as Shadow Cutter');
  assert(operation?.persistentData?.invalidatedReason === 'cam-generation-removed', 'Legacy generated CAM data should be marked removed');
  assert(!operation?.persistentData?.toolpath, 'Legacy generated toolpaths should be stripped');
  assert(!operation?.persistentData?.gcode, 'Legacy generated G-code should be stripped');
  assert(manager.getGeneratedResults().length === 0, 'No generated CAM results should be available in the shell');
}

export async function test_cam_plan_manager_async_generation_reports_progress_steps() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-progress-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-progress-surfacing-face', width: 10, depth: 8, y: 10 }),
  ]);
  manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_PROGRESS',
    targetFaces: ['cam-test-progress-surfacing-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 3,
    rasterDirection: 'Both',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const events: any[] = [];
  const result = await manager.generateAllAsync(viewer, { onProgress: (event) => events.push(event) });
  assert(result.paths.length === 2, 'Async CAM generation should return the generated Surfacing paths');
  const phases = new Set(events.map((event) => event.phase));
  for (const phase of ['prepare', 'operation', 'surfacing-index', 'surfacing-raster', 'surfacing-link', 'surfacing-post', 'combine', 'scene', 'done']) {
    assert(phases.has(phase), `Async CAM generation should report ${phase} progress`);
  }
  assert(events[0]?.current === 0, 'Async CAM generation should start progress at zero');
  assert(events[events.length - 1]?.current === 100, 'Async CAM generation should finish progress at 100 percent');
  assert(events.every((event) => event.current >= 0 && event.current <= event.total), 'Async CAM progress events should stay within their progress range');
  assert(events.some((event) => String(event.detail || '').includes('Line')), 'Async Surfacing progress should report raster line sampling detail');
}

export async function test_cam_shadow_cutter_history_item_generates_toolpath() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams());
  const direct = operation.run({
    viewer: makeViewerWithSolid(),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.schemaVersion === CAM_TOOLPATH_SCHEMA_VERSION, 'Shadow Cutter should return the shared CAM toolpath schema');
  assert(direct.paths.length > 0, 'Shadow Cutter history item should return toolpaths from run()');
  assert(direct.paths[0].points.length > 0, 'Shadow Cutter paths should contain standard path points');
  assert(direct.paths[0].segments.length === direct.paths[0].points.length - 1, 'Shadow Cutter paths should contain standard path segments');
  assert(direct.paths[0].cutter.kind === 'flat-endmill', 'Shadow Cutter paths should describe cutter shape');
  assert(direct.paths[0].cutter.diameter === 2, 'Shadow Cutter paths should describe cutter size');
  assert(direct.paths[0].segments[0].orientation.toolAxis.join(',') === '0,0,-1', 'Shadow Cutter segments should describe cutter orientation');
  assert(direct.paths[0].segments[0].cutter?.diameter === 2, 'Shadow Cutter segments should carry cutter metadata');
  const plunge = direct.paths[0].segments.find((segment) => segment.kind === 'plunge');
  const retract = direct.paths[0].segments.find((segment) => segment.kind === 'retract');
  assert(plunge && retract, 'Shadow Cutter paths should include explicit plunge and retract moves for simulation');
  assert(direct.paths[0].points[plunge.startIndex].position[2] === direct.safeZ, 'Plunge should start at safe Z');
  assert(direct.paths[0].points[plunge.endIndex].position[2] !== direct.safeZ, 'Plunge should end at cutting Z');
  assert(direct.summary.triangleCount === 12, 'Shadow Cutter should collect target mesh triangles');
  assert(direct.bounds.min[0] === -1.25 && direct.bounds.max[0] === 11.25, 'Shadow Cutter should offset the projected outline by tool radius plus stock allowance');
  assert(direct.gcode.includes('G21'), 'Shadow Cutter should return posted G-code with the toolpath');

  const combined = manager.generateAll(makeViewerWithSolid());
  assert(combined.paths.length === direct.paths.length, 'CAM manager should delegate generation to the operation history item');
  assert(manager.getGeneratedResults().length === 1, 'CAM manager should retain runtime results returned by operation history items');
  assert(manager.getCombinedGcode().includes('G21'), 'CAM manager should expose G-code posted from operation toolpath results');
}

export async function test_cam_shadow_cutter_single_solid_does_not_require_target_selection() {
  const singleViewer = makeViewerWithSolid();
  const singleFieldResult = ShadowCutterEntity.uiFieldsTest({ viewer: singleViewer });
  assert(singleFieldResult.exclude.includes('targetSolids'), 'Single-solid Shadow Cutter UI should hide target selection');

  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: [],
  }));
  const direct = operation.run({
    viewer: singleViewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length > 0, 'Single-solid Shadow Cutter should generate without an explicit target selection');
  assert(direct.summary?.targetCount === 1, 'Single-solid Shadow Cutter should use the one visible solid as the target');

  const multiFieldResult = ShadowCutterEntity.uiFieldsTest({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(10, 10, 10, { name: 'cam-test-a' }),
      makeBoxMeshSolid(10, 10, 10, { name: 'cam-test-b', offsetX: 20 }),
    ]),
  });
  assert(!multiFieldResult.exclude.includes('targetSolids'), 'Multi-solid Shadow Cutter UI should keep target selection visible');
}

export async function test_cam_shadow_cutter_generates_clear_hole_loop() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-ring'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolid(makeRingMeshSolid()),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const holePaths = direct.paths.filter((path) => path.metadata?.loopRole === 'hole');
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(outerPaths.length === 1, 'Shadow Cutter should generate one outer loop for a single-depth ring fixture');
  assert(holePaths.length === 1, 'Shadow Cutter should generate a second clear-hole loop for a through-hole');
  assert(direct.metadata?.holeLoopCount === 1, 'Shadow Cutter metadata should report detected hole loops');
  assert(holePaths[0].segments.some((segment) => segment.kind === 'cut'), 'Hole loop should contain cut moves');
  assert(holePaths[0].segments.some((segment) => segment.kind === 'plunge'), 'Hole loop should contain a plunge move');
  assert(direct.gcode.includes('SC1-H'), 'Posted G-code should include the hole-loop path');
  for (const point of cutPoints2d(holePaths[0], direct.safeZ)) {
    const radius = Math.hypot(point[0], point[1]);
    assert(radius <= 1.505, 'Hole centerline should stay inside the clear hole by the cutter radius');
    assert(radius >= 1.495, 'Hole centerline should be offset from the hole wall by the cutter radius');
  }
}

export async function test_cam_shadow_cutter_generates_outer_and_hole_for_nonconvex_profile() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-ring', 'cam-test-side-lobe'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeRingMeshSolid(),
      makeCylinderMeshSolid({
        name: 'cam-test-side-lobe',
        radius: 2.5,
        centerX: 5,
        centerZ: 0,
        bottomY: 0,
        height: 10,
      }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  const holePaths = direct.paths.filter((path) => path.metadata?.loopRole === 'hole');
  assert(outerPaths.length === 1, 'Non-convex through-hole fixture should retain the outside Shadow Cutter loop');
  assert(holePaths.length === 1, 'Non-convex through-hole fixture should retain the clear-hole Shadow Cutter loop');
  assert(direct.paths.length === 2, 'Non-convex through-hole fixture should generate exactly one outer path and one hole path');
  assert((outerPaths[0].metadata?.loopPointCount || 0) > (holePaths[0].metadata?.loopPointCount || 0), 'Outside loop should describe the larger projected profile');
}

export async function test_cam_shadow_cutter_finds_holes_in_epsilon_offset_coplanar_bottoms() {
  // Regression: after a boolean union, one solid's bottom face can sit a few
  // 1e-4 units above the part's global bottom plane. Hole detection must not
  // depend on exact bottom-plane membership.
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-ring', 'cam-test-ring-offset'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeRingMeshSolid(),
      makeRingMeshSolid({
        name: 'cam-test-ring-offset',
        centerX: 9,
        bottomY: 0.0002,
      }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const holePaths = direct.paths.filter((path) => path.metadata?.loopRole === 'hole');
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(outerPaths.length === 1, 'Overlapping rings should merge into one outer loop');
  assert(holePaths.length === 2, `Both ring through-holes should generate clear-hole loops, got ${holePaths.length}`);
  const holeCenters = holePaths.map((path) => {
    const cutPoints = cutPoints2d(path, direct.safeZ);
    const xs = cutPoints.map((point) => point[0]);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }).sort((a, b) => a - b);
  assert(Math.abs(holeCenters[0]) < 0.1, 'First clear-hole loop should stay centered on the base ring');
  assert(Math.abs(holeCenters[1] - 9) < 0.1, 'Second clear-hole loop should stay centered on the offset ring');
}

export async function test_cam_shadow_cutter_cuts_each_loop_to_depth_before_next_loop() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-ring'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolid(makeRingMeshSolid()),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 2, 'Shadow Cutter should emit one stepped path per loop');
  assert(direct.paths[0].metadata?.loopRole === 'outer', 'Outer loop should be cut before hole loops');
  assert(direct.paths[1].metadata?.loopRole === 'hole', 'Hole loop should be cut after the outer loop completes');
  assert(direct.summary.levelCount === 3, 'Fixture should require three depth levels');
  for (const path of direct.paths) {
    const zLevels = path.metadata?.zLevels || [];
    assert(Array.isArray(zLevels) && zLevels.length === direct.summary.levelCount, 'Each loop path should carry all depth levels');
    assert(path.segments.filter((segment) => segment.kind === 'plunge').length === direct.summary.levelCount, 'Each loop should plunge once per depth level');
    assert(path.segments.filter((segment) => segment.kind === 'retract').length === 1, 'Each loop should retract only after its final depth pass');
    const retractIndex = path.segments.findIndex((segment) => segment.kind === 'retract');
    assert(retractIndex === path.segments.length - 1, 'Loop retract should be the last segment before moving to the next loop');
    const cutLevels = path.segments
      .filter((segment) => segment.kind === 'cut')
      .map((segment) => segment.metadata?.level)
      .join(',');
    assert(cutLevels.includes('1') && cutLevels.includes('2') && cutLevels.includes('3'), 'Each loop should cut every depth level before the next loop starts');
  }
}

export async function test_cam_shadow_cutter_ignores_raised_cap_loops_as_holes() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-ring', 'cam-test-boss'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeRingMeshSolid(),
      makeCylinderMeshSolid({
        name: 'cam-test-boss',
        radius: 0.75,
        centerX: 0,
        centerZ: 3.6,
        bottomY: 10,
        height: 4,
      }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const holePaths = direct.paths.filter((path) => path.metadata?.loopRole === 'hole');
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(direct.paths.length === 2, 'Raised caps inside the shadow should not generate extra loop paths');
  assert(outerPaths.length === 1, 'Fixture should keep one outer loop');
  assert(holePaths.length === 1, 'Fixture should keep only the clear through-hole loop');
  assert(direct.metadata?.holeLoopCount === 1, 'Raised cap loops should not be classified as holes');
}

export async function test_cam_shadow_cutter_uses_projected_outline_not_convex_hull() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-l-horizontal', 'cam-test-l-vertical'],
    toolDiameter: 0,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(10, 10, 4, { name: 'cam-test-l-horizontal' }),
      makeBoxMeshSolid(4, 10, 10, { name: 'cam-test-l-vertical' }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(outerPaths.length === 1, 'Overlapping L fixture should generate a single outside loop');
  assert((outerPaths[0].metadata?.loopPointCount || 0) >= 6, 'Projected outside loop should preserve the L-shape concave corner');
  const hasInsideCorner = outerPaths[0].points.some((point) => (
    Math.abs(point.position[0] - 4) < 1e-4
    && Math.abs(point.position[1] - 4) < 1e-4
    && point.position[2] !== direct.safeZ
  ));
  assert(hasInsideCorner, 'Projected outside loop should include the concave inside corner instead of cutting a convex hull diagonal');
}

export async function test_cam_shadow_cutter_offset_stays_outside_concave_shadow() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-union-rect', 'cam-test-union-lobe'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(10, 10, 6, { name: 'cam-test-union-rect' }),
      makeCylinderMeshSolid({
        name: 'cam-test-union-lobe',
        radius: 3,
        centerX: 0,
        centerZ: 3,
        bottomY: 0,
        height: 10,
      }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(outerPaths.length === 1, 'Rectangle plus circular lobe should produce one outside offset loop');
  const pointInsideOriginalShadow = (x: number, y: number) => {
    const boundaryTol = 0.05;
    const insideRect = x > boundaryTol && x < 10 - boundaryTol && y > boundaryTol && y < 6 - boundaryTol;
    const insideCircle = Math.hypot(x, y - 3) < 3 - boundaryTol;
    return insideRect || insideCircle;
  };
  const distanceToOriginalShadow = (x: number, y: number) => Math.min(
    distanceToRect(x, y, 0, 0, 10, 6),
    Math.max(0, Math.hypot(x, y - 3) - 3),
  );
  for (const path of outerPaths) {
    for (const segment of path.segments) {
      if (segment.kind !== 'cut') continue;
      const start = path.points[segment.startIndex]?.position;
      const end = path.points[segment.endIndex]?.position;
      assert(start && end, 'Offset regression fixture should have segment endpoints');
      for (let sample = 0; sample <= 8; sample += 1) {
        const t = sample / 8;
        const x = start[0] + (end[0] - start[0]) * t;
        const y = start[1] + (end[1] - start[1]) * t;
        assert(!pointInsideOriginalShadow(x, y), 'Outside offset centerline should not cut through the original projected stock');
        assert(distanceToOriginalShadow(x, y) >= 0.95, 'Outside offset centerline should stay at least one cutter radius from the original projected stock');
      }
    }
  }
}

export async function test_cam_shadow_cutter_offset_keeps_l_shape_inside_corner_clear() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    targetSolids: ['cam-test-l-horizontal', 'cam-test-l-vertical'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 20,
    extraDepth: 0,
  }));
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(10, 10, 4, { name: 'cam-test-l-horizontal' }),
      makeBoxMeshSolid(4, 10, 10, { name: 'cam-test-l-vertical' }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const outerPaths = direct.paths.filter((path) => path.metadata?.loopRole === 'outer');
  assert(outerPaths.length === 1, 'L fixture should produce one outside offset loop');
  const cutPoints = cutPoints2d(outerPaths[0], direct.safeZ);
  assert(cutPoints.some((point) => Math.abs(point[0] - 5) < 1e-4 && Math.abs(point[1] - 5) < 1e-4), 'L offset should preserve the inside-corner clearance instead of bridging across it');
  for (const point of cutPoints) {
    assert(!pointInsideLFixture(point[0], point[1]), 'L offset centerline should not enter the original projected stock');
    assert(distanceToLFixture(point[0], point[1]) >= 0.999, 'L offset centerline should stay at least one cutter radius from the L fixture');
  }
}

export async function test_cam_roughing_history_item_generates_sliced_toolpaths() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG1',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolid(),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.schemaVersion === CAM_TOOLPATH_SCHEMA_VERSION, 'Roughing should return the shared CAM toolpath schema');
  assert(direct.operationName === 'Roughing', 'Roughing should name generated programs');
  assert(direct.metadata?.strategy === 'roughing', 'Roughing should mark generated program strategy metadata');
  assert(direct.summary.levelCount === 3, 'A 10-unit part roughed at 4-unit stepdown should produce three slices');
  assert(direct.paths.length === 1, 'Box roughing should chain slices into a single continuous path');
  const roughingPath = direct.paths[0];
  assert(roughingPath.metadata?.strategy === 'roughing', 'The Roughing path should carry roughing metadata');
  assert(roughingPath.metadata?.sliceCount === 3, 'The Roughing path should record all generated slices');
  assert(roughingPath.segments.filter((segment) => segment.kind === 'retract').length === 1, 'Box roughing should retract only after the final slice');
  const plungeZs = roughingPath.segments
    .filter((segment) => segment.kind === 'plunge')
    .map((segment) => roughingPath.points[segment.endIndex]?.position[2])
    .join(',');
  assert(plungeZs === '6,2,0', 'Box roughing should plunge through slices from top to bottom');
  assert(direct.gcode.includes('Operation: Roughing'), 'Posted G-code should identify the Roughing operation');
}

export async function test_cam_roughing_uses_each_slice_shadow() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG2',
    targetSolids: ['cam-test-column', 'cam-test-base'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 5,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(4, 10, 4, { name: 'cam-test-column' }),
      makeBoxMeshSolid(10, 4, 10, { name: 'cam-test-base' }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.summary.levelCount === 2, 'Two 5-unit roughing slices should cover a 10-unit target');
  assert(direct.paths.length === 1, 'Merged roughing shadows should be chained into a single path');
  const firstSliceMaxX = Math.max(...cutPoints2dForSlice(direct.paths[0], 1).map((point) => point[0]));
  const secondSliceMaxX = Math.max(...cutPoints2dForSlice(direct.paths[0], 2).map((point) => point[0]));
  assert(firstSliceMaxX <= 5.01, 'Top roughing slice should follow the narrow column shadow');
  assert(secondSliceMaxX >= 10.99, 'Lower roughing slice should expand to the wider base shadow');
}

export async function test_cam_roughing_keeps_vertical_cutter_clear_of_overhangs() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_OVERHANG_CLEARANCE',
    targetSolids: ['cam-test-left-pillar', 'cam-test-right-pillar', 'cam-test-overhang-cap'],
    toolDiameter: 1,
    toolLength: 20,
    stockAllowance: 0,
    stepDown: 2,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolids([
      makeBoxMeshSolid(2, 5, 4, { name: 'cam-test-left-pillar' }),
      makeBoxMeshSolid(2, 5, 4, { name: 'cam-test-right-pillar', offsetX: 8 }),
      makeBoxMeshSolid(10, 5, 4, { name: 'cam-test-overhang-cap', offsetY: 5 }),
    ]),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Overhang roughing should generate a toolpath');
  assert(direct.metadata?.protectsFullCutterColumn === true, 'Roughing should report full vertical cutter-column protection');

  // Slice four is entirely below the cap. A slice-local contour would enter
  // between the two pillars and put the cutter shank through the cap above it.
  const belowOverhang = cutPoints2dForSlice(path, 4);
  assert(belowOverhang.length > 0, 'Overhang roughing should retain a contour below the cap');
  assert(Math.min(...belowOverhang.map((point) => point[0])) <= -0.49, 'The lower contour should stay outside the cap on its left side');
  assert(Math.max(...belowOverhang.map((point) => point[0])) >= 10.49, 'The lower contour should stay outside the cap on its right side');
  const belowOverhangPassIds = new Set(path.points
    .filter((point: any) => point.metadata?.sliceIndex === 4 && !point.metadata?.safe)
    .map((point: any) => point.metadata?.passId)
    .filter(Boolean));
  assert(belowOverhangPassIds.size === 1, 'The lower level should follow one cumulative cap silhouette instead of entering between pillars');
}

export async function test_cam_roughing_unions_curved_slice_shadow_before_pathing() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG3',
    targetSolids: ['cam-test-cylinder'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 5,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolid(makeCylinderMeshSolid({
      name: 'cam-test-cylinder',
      radius: 5,
      height: 10,
      bottomY: 0,
      segments: 48,
    })),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const roughingPath = direct.paths[0];
  assert(direct.summary.levelCount === 2, 'Cylinder roughing should produce two slices for a 10-unit part at 5-unit stepdown');
  assert(direct.paths.length === 1, 'Cylinder roughing should emit one chained path');
  assert(roughingPath.metadata?.passCount === 2, 'Curved slice shadows should be unioned before pathing instead of producing one pass per triangle');
  assert(roughingPath.segments.filter((segment) => segment.kind === 'retract').length === 1, 'Curved roughing should not retract between identical slice loops');
}

export async function test_cam_roughing_generates_hole_loops_in_every_slice() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_RING',
    targetSolids: ['cam-test-ring'],
    toolDiameter: 1,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolid(makeRingMeshSolid()),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.summary.levelCount === 3, 'Ring roughing should produce three slices for a 10-unit part at 4-unit stepdown');
  const roughingPath = direct.paths[0];
  assert(roughingPath, 'Ring roughing should produce a toolpath');
  assert((roughingPath.metadata?.loopRoles || []).includes('hole'), 'Ring roughing should include clear-hole loops');
  const passIdsBySlice = new Map<number, Set<string>>();
  for (const point of roughingPath.points) {
    const sliceIndex = point.metadata?.sliceIndex;
    const passId = point.metadata?.passId;
    if (!Number.isFinite(sliceIndex) || !passId) continue;
    if (!passIdsBySlice.has(sliceIndex)) passIdsBySlice.set(sliceIndex, new Set());
    passIdsBySlice.get(sliceIndex)!.add(passId);
  }
  for (const sliceIndex of [1, 2, 3]) {
    const passIds = Array.from(passIdsBySlice.get(sliceIndex) || []);
    assert(passIds.some((id) => id.includes('-O')), `Roughing slice ${sliceIndex} should cut the outer loop`);
    assert(passIds.some((id) => id.includes('-H')), `Roughing slice ${sliceIndex} should cut the internal hole loop`);
    assert(passIds.length === 2, `Roughing slice ${sliceIndex} should cut exactly one outer and one hole loop, got ${passIds.join(', ')}`);
  }
  for (const point of roughingPath.points) {
    if (point.metadata?.loopRole !== 'hole' || point.metadata?.safe) continue;
    const radius = Math.hypot(point.position[0], point.position[1]);
    assert(radius <= 1.505, 'Hole roughing centerline should stay inside the clear hole by the cutter radius');
  }
}

export async function test_cam_roughing_vertical_wall_slice_matches_shadow_cutter_loop() {
  const manager = new CamPlanManager(null);
  const solid = makeZCylinderMeshSolid({
    name: 'cam-test-z-cylinder',
    radius: 5,
    height: 10,
    bottomZ: 0,
    segments: 48,
  });
  const context = {
    viewer: makeViewerWithSolid(solid),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  };
  const sharedParams = {
    targetSolids: ['cam-test-z-cylinder'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 5,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  };
  const shadow = manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, {
    id: 'SC_Z',
    name: 'Shadow Cutter',
    ...sharedParams,
  }).run(context);
  const roughing = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_Z',
    name: 'Roughing',
    ...sharedParams,
  }).run(context);
  const shadowOuter = shadow.paths.find((path) => path.metadata?.loopRole === 'outer');
  assert(shadowOuter, 'Shadow Cutter should produce an outer loop for the vertical cylinder');
  assert(roughing.paths.length === 1, 'Roughing should chain vertical cylinder slices into one path');
  const shadowLoop = pointKeySet(points2dForMetadata(shadowOuter, (point: any) => point.metadata?.level === 1 && !point.metadata?.safe));
  const roughingLoop = pointKeySet(points2dForMetadata(roughing.paths[0], (point: any) => point.metadata?.sliceIndex === 1 && !point.metadata?.safe));
  assertSamePointSet(shadowLoop, roughingLoop, 'Roughing vertical-wall slice should reuse the same projected offset loop as Shadow Cutter');
}

export async function test_cam_roughing_debug_slices_emit_layer_solids() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_DEBUG',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    debugSlices: true,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolid(),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const debugSlices = direct.metadata?.debugSlices || [];
  assert(Array.isArray(debugSlices), 'Roughing debug slices should be stored in program metadata');
  assert(debugSlices.length === direct.summary.levelCount, 'Roughing debug slices should include one solid layer per step');
  assert(debugSlices[0]?.topZ === 10 && debugSlices[0]?.bottomZ === 6, 'First roughing debug layer should preserve slice top and bottom Z');
  assert(debugSlices[0]?.loops?.some((loop: any) => loop.role === 'outer' && loop.points?.length >= 3), 'Debug layer should include outer slice loops');
}

export async function test_cam_roughing_debug_slices_survive_combined_cam_plan() {
  const manager = new CamPlanManager(null);
  manager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({
    id: 'SC_DEBUG_COMBINED',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    stepDown: 4,
    extraDepth: 0,
  }));
  manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_DEBUG_COMBINED',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    debugSlices: true,
  });
  const combined = manager.generateAll({
    viewer: makeViewerWithSolid(),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(combined.paths.length > 1, 'Combined CAM fixture should include multiple operations');
  assert(Array.isArray(combined.metadata?.debugSlices), 'Combined CAM plan should preserve operation debug slices');
  assert(combined.metadata?.debugSlices?.length === 3, 'Combined CAM plan should preserve one debug slice per roughing step');
}

export async function test_cam_roughing_debug_slices_create_real_scene_solids() {
  const scene = new THREE.Scene();
  scene.add(makeObject3DSolid(makeBoxMeshSolid()));
  const manager = new CamPlanManager({ scene });
  manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_DEBUG_SCENE',
    targetSolids: [],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    debugSlices: true,
  });
  const combined = manager.generateAll({ scene });
  assert(combined.summary.targetCount === 1, 'Implicit Roughing target selection should start from the original scene solid');
  const findDebugSolids = () => {
    const out: any[] = [];
    scene.traverse((object: any) => {
      if (object?.userData?.camDebugKind === CAM_DEBUG_SLICE_SOLID_KIND) out.push(object);
    });
    return out;
  };
  const debugSolids = findDebugSolids();
  assert(debugSolids.length === combined.metadata?.debugSliceCount, 'Generated Roughing debug layers should be added to the scene');
  assert(debugSolids.every((solid) => solid.type === 'SOLID'), 'Generated Roughing debug layers should be real scene solids');
  assert(scene.getObjectByName('RG_DEBUG_SCENE Debug Slice 1'), 'Debug solids should be named from the Roughing operation');
  const regenerated = manager.generateAll({ scene });
  assert(regenerated.summary.targetCount === 1, 'Regenerating CAM should ignore previous debug slice solids as machining targets');
  assert(findDebugSolids().length === debugSolids.length, 'Regenerating CAM should replace debug solids instead of duplicating them');
  manager.reset();
  assert(findDebugSolids().length === 0, 'Resetting CAM should remove generated debug solids from the scene');
}

export async function test_cam_roughing_sloped_slab_generates_each_step() {
  const manager = new CamPlanManager(null);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_SLOPED',
    targetSolids: ['cam-test-sloped-block'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 2,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    debugSlices: true,
  });
  const direct = operation.run({
    viewer: makeViewerWithSolid(makeSlopedBlockMeshSolid()),
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.summary.levelCount === 5, 'Sloped fixture should produce five roughing levels');
  assert(direct.metadata?.activeSliceCount === 5, 'Roughing should keep every slab that intersects a sloped part');
  assert(direct.metadata?.debugSlices?.length === 5, 'Roughing debug solids should include every sloped slab');
  const zLevels = direct.paths[0]?.metadata?.zLevels || [];
  assert(zLevels.length === 5, 'Roughing toolpath should include a cut level for every sloped slab');
}

export async function test_cam_surfacing_history_item_generates_ball_endmill_raster() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-top-face', width: 10, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF1',
    targetFaces: ['cam-test-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 3,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.schemaVersion === CAM_TOOLPATH_SCHEMA_VERSION, 'Surfacing should return the shared CAM toolpath schema');
  assert(direct.operationName === 'Surfacing', 'Surfacing should name generated programs');
  assert(direct.metadata?.strategy === 'surfacing', 'Surfacing should mark generated program strategy metadata');
  assert(direct.paths.length === 1, 'Surfacing should emit one serpentine raster path');
  assert(direct.cutter?.kind === 'ball-endmill', 'Surfacing should use a ball end mill cutter');
  assert(direct.paths[0].cutter.kind === 'ball-endmill', 'Surfacing paths should describe the ball end mill cutter');
  assert(direct.paths[0].segments.some((segment) => segment.kind === 'plunge'), 'Surfacing should include an explicit plunge move');
  assert(direct.paths[0].segments.some((segment) => segment.kind === 'retract'), 'Surfacing should include an explicit retract move');
  assert(direct.paths[0].segments[0].orientation.toolAxis.join(',') === '0,0,-1', 'Surfacing segments should describe cutter orientation');
  const flatFacePlunges = direct.paths[0].segments.filter((segment) => segment.kind === 'plunge');
  const flatFaceRetracts = direct.paths[0].segments.filter((segment) => segment.kind === 'retract');
  const flatFaceRapids = direct.paths[0].segments.filter((segment) => segment.kind === 'rapid');
  assert(flatFacePlunges.length === 1, 'Continuous flat Surfacing should avoid extra plunge moves between raster scanlines');
  assert(flatFaceRetracts.length === 1, 'Continuous flat Surfacing should avoid returning to safe Z between raster scanlines');
  assert(flatFaceRapids.length === 0, 'Continuous flat Surfacing should not rapid between reachable raster scanlines');
  const firstSegment = direct.paths[0].segments[0];
  const firstStart = direct.paths[0].points[firstSegment.startIndex]?.position;
  const firstEnd = direct.paths[0].points[firstSegment.endIndex]?.position;
  assert(firstSegment.kind === 'plunge', 'Surfacing should plunge before the first cutting move');
  assert(firstStart?.[2] === direct.safeZ, 'First Surfacing segment should start at safe Z');
  assert(firstEnd?.[2] !== direct.safeZ, 'First Surfacing segment should end at cutting Z');
  assert(firstStart?.[0] === firstEnd?.[0] && firstStart?.[1] === firstEnd?.[1], 'First Surfacing plunge should be vertical at the raster start');
  assert(firstSegment.feedRate === 150, 'First Surfacing plunge should use plunge feed rate');
  assert(direct.summary.targetCount === 1, 'Surfacing should report selected face count');
  assert(direct.summary.triangleCount === 12, 'Surfacing should use the whole visible solid mesh for gouge checks');
  assert(direct.summary.levelCount === 4, 'Surfacing should include the final boundary pass when stepover does not divide the face depth');
  assert(direct.targetBounds?.min?.[2] === 0 && direct.targetBounds?.max?.[2] === 10, 'Surfacing target bounds should describe the protected model extent');
  assert(direct.bounds?.min?.[2] === 10 && direct.bounds?.max?.[2] === direct.safeZ, 'Surfacing program bounds should describe emitted tool motion, not the model bottom');
  assert(direct.paths[0].metadata?.runCount === 4, 'Surfacing path metadata should record every raster run');
  assert(direct.paths[0].metadata?.filteredCutPointCount > 0, 'Surfacing should filter redundant flat-face cutter-location samples');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const safePoints = direct.paths[0].points.filter((point: any) => point.metadata?.safe);
  assert(direct.paths[0].metadata?.pointCount === direct.paths[0].points.length, 'Surfacing metadata should report total path points');
  assert(direct.paths[0].metadata?.contactPointCount === cutPoints.length, 'Surfacing metadata should report emitted cutter-contact points separately from safe moves');
  assert(direct.paths[0].metadata?.safePointCount === safePoints.length, 'Surfacing metadata should report safe travel points separately from cutter-contact points');
  assert(direct.summary.contactPointCount === cutPoints.length, 'Surfacing summary should report emitted cutter-contact points');
  assert(direct.summary.safePointCount === safePoints.length, 'Surfacing summary should report safe travel points');
  assert(direct.paths[0].metadata?.rawCutPointCount > direct.paths[0].metadata?.contactPointCount, 'Surfacing metadata should expose cutter-location sample reduction');
  const ys = cutPoints.map((point: any) => point.position[1]);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Surfacing raster should run all the way to the selected face edge');
  assert(Math.min(...ys) === 0 && Math.max(...ys) === 8, 'Surfacing raster should cover both selected face boundaries');
  assert(zs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Flat-face surfacing should keep the ball tip on the top plane');
  assert(direct.gcode.includes('Operation: Surfacing'), 'Posted G-code should identify the Surfacing operation');
  const gcodeLines = String(direct.gcode || '').split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  assert(gcodeLines.filter((line) => line === 'G1 F150').length === 1, 'Posted flat Surfacing G-code should plunge only once');
  const fullSafeTravelLines = gcodeLines.filter((line) => (
    line.startsWith('G0 ')
    && line.includes('X')
    && line.includes('Y')
    && line.includes(`Z${direct.safeZ}`)
  ));
  assert(fullSafeTravelLines.length === 1, 'Posted flat Surfacing G-code should only return to full safe Z at the end of the path');

  const combined = manager.generateAll(viewer);
  assert(combined.paths.length === direct.paths.length, 'CAM manager should include Surfacing output in combined generation');
  assert(manager.getGeneratedResults()[0]?.operationId === 'SF1', 'CAM manager should retain Surfacing runtime results');
}

export async function test_cam_surfacing_y_raster_reaches_selected_face_edges() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-y-raster-block' }),
    makeTopRectFace({ name: 'cam-test-y-raster-top-face', width: 10, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_Y_RASTER',
    targetFaces: ['cam-test-y-raster-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 3,
    rasterDirection: 'Y',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Y-raster Surfacing should emit one serpentine raster path');
  assert(direct.summary.levelCount === 5, 'Y-raster Surfacing should include the final face-edge pass when stepover does not divide width');
  assert(direct.paths[0].metadata?.runCount === 5, 'Y-raster Surfacing path metadata should record every pass');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const ys = cutPoints.map((point: any) => point.position[1]);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Y-raster Surfacing should cover both selected face X boundaries');
  assert(Math.min(...ys) === 0 && Math.max(...ys) === 8, 'Y-raster Surfacing should run all the way to the selected face Y edges');
  assert(zs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Y-raster flat-face Surfacing should keep the ball tip on the top plane');
}

export async function test_cam_surfacing_both_raster_directions_emit_x_and_y_paths() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-both-raster-block' }),
    makeTopRectFace({ name: 'cam-test-both-raster-top-face', width: 10, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_BOTH_RASTER',
    targetFaces: ['cam-test-both-raster-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 3,
    rasterDirection: 'Both',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 2, 'Both-raster Surfacing should emit separate X and Y raster paths from one operation');
  assert(direct.paths[0].id === 'SF_BOTH_RASTER-SURF-X', 'Both-raster Surfacing should label the X path');
  assert(direct.paths[1].id === 'SF_BOTH_RASTER-SURF-Y', 'Both-raster Surfacing should label the Y path');
  assert(direct.metadata?.rasterDirection === 'Both', 'Both-raster Surfacing should record the combined raster mode');
  assert(direct.metadata?.rasterDirections?.join(',') === 'X,Y', 'Both-raster Surfacing should record both generated directions');
  assert(direct.paths.map((path: any) => path.metadata?.rasterDirection).join(',') === 'X,Y', 'Each Both-raster path should record its own direction');
  assert(direct.summary.levelCount === 9, 'Both-raster Surfacing should aggregate X and Y raster pass counts');
  assert(direct.metadata?.runCount === direct.paths.reduce((sum: number, path: any) => sum + path.metadata.runCount, 0), 'Both-raster Surfacing should aggregate run counts');
  assert(direct.metadata?.scanlineCount === direct.paths.reduce((sum: number, path: any) => sum + path.metadata.scanlineCount, 0), 'Both-raster Surfacing should aggregate scanline counts');
  const firstCutDelta = (path: any) => {
    const segment = path.segments.find((entry: any) => entry.kind === 'cut');
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    return [Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])] as [number, number];
  };
  const xDelta = firstCutDelta(direct.paths[0]);
  const yDelta = firstCutDelta(direct.paths[1]);
  assert(xDelta[0] > xDelta[1], 'Both-raster X path should cut primarily along machine X');
  assert(yDelta[1] > yDelta[0], 'Both-raster Y path should cut primarily along machine Y');
  assert(direct.gcode.includes('SF_BOTH_RASTER-SURF-X') && direct.gcode.includes('SF_BOTH_RASTER-SURF-Y'), 'Both-raster G-code should post both paths');
  const combined = manager.generateAll(viewer);
  assert(combined.paths.length === 2, 'CAM manager should include both generated Surfacing raster paths');
}

export async function test_cam_surfacing_stops_before_higher_adjacent_preserved_face() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(5, 10, 8, { name: 'cam-test-step-low-base' }),
    makeBoxMeshSolid(3, 12, 8, { name: 'cam-test-step-preserved-high-block', offsetX: 5 }),
    makeTopRectFace({ name: 'cam-test-step-low-top-face', width: 5, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_STEP_PRESERVE',
    targetFaces: ['cam-test-step-low-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 4,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Step-adjacent Surfacing should still generate a path on the selected lower face');
  const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...xs) === 0, 'Step-adjacent Surfacing should still begin at the open selected face edge');
  assert(Math.max(...xs) < 5 - 1e-4, 'Step-adjacent Surfacing should stop before the taller preserved block');
  const cutsIntoStepWall = path.segments.some((segment: any) => {
    if (segment.kind !== 'cut') return false;
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    if (!start || !end) return false;
    return Math.max(start[0], end[0]) >= 5 - 1e-4 && Math.min(start[2], end[2]) <= 10 + 1e-4;
  });
  assert(!cutsIntoStepWall, 'Step-adjacent Surfacing should not emit a cutting segment into the preserved step wall');
}

export async function test_cam_surfacing_reaches_edge_beside_coplanar_preserved_face() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(5, 10, 8, { name: 'cam-test-coplanar-selected-base' }),
    makeBoxMeshSolid(3, 10, 8, { name: 'cam-test-coplanar-preserved-block', offsetX: 5 }),
    makeTopRectFace({ name: 'cam-test-coplanar-selected-top-face', width: 5, depth: 8, y: 10 }),
  ]);
  const runWithAllowance = (id: string, stockAllowance: number) => {
    const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
      id,
      targetFaces: ['cam-test-coplanar-selected-top-face'],
      toolDiameter: 2,
      toolLength: 20,
      stockAllowance,
      stepover: 4,
      rasterDirection: 'X',
      safeHeight: 2,
      feedRate: 700,
      plungeRate: 150,
      spindleRPM: 10000,
    });
    return operation.run({
      viewer,
      machineProfile: manager.getMachineProfile(),
      stockProfile: manager.getStockProfile(),
    });
  };
  const assertReachesEdge = (direct: any, expectedTipZ: number, label: string) => {
    const path = direct.paths[0];
    assert(path, `${label} should generate a path on the selected face`);
    const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
    const xs = cutPoints.map((point: any) => point.position[0]);
    const zs = cutPoints.map((point: any) => point.position[2]);
    assert(Math.min(...xs) === 0, `${label} should reach the open selected face edge`);
    assert(Math.max(...xs) === 5, `${label} should go all the way to the selected edge`);
    assert(!cutPoints.some((point: any) => point.position[0] > 5 + 1e-4), `${label} should not cut into the preserved neighboring face`);
    assert(zs.every((z: number) => Math.abs(z - expectedTipZ) < 1e-4), `${label} should keep the ball tip at the expected stock height`);
  };

  assertReachesEdge(runWithAllowance('SF_COPLANAR_PRESERVE', 0), 10, 'Coplanar-adjacent Surfacing');
  const stockDirect = runWithAllowance('SF_COPLANAR_PRESERVE_ALLOWANCE', 0.4);
  assert(Math.abs(stockDirect.metadata?.stockAllowance - 0.4) < 1e-6, 'Coplanar-adjacent Surfacing should record stock allowance');
  assertReachesEdge(stockDirect, 10.4, 'Coplanar-adjacent Surfacing with stock allowance');
}

export async function test_cam_surfacing_stock_allowance_leaves_material_on_selected_face() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-allowance-block' }),
    makeTopRectFace({ name: 'cam-test-allowance-top-face', width: 10, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_ALLOWANCE',
    targetFaces: ['cam-test-allowance-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0.4,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Stock-allowance Surfacing should generate a toolpath');
  assert(Math.abs(direct.metadata?.stockAllowance - 0.4) < 1e-6, 'Surfacing metadata should record stock allowance');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(zs.length > 0, 'Stock-allowance Surfacing should emit cutting points');
  assert(zs.every((z: number) => Math.abs(z - 10.4) < 1e-4), 'Surfacing stock allowance should leave material above the selected face');
}

export async function test_cam_surfacing_does_not_cut_across_selected_face_hole() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeRingMeshSolid({ name: 'cam-test-annular-surfacing-solid', outerRadius: 5, innerRadius: 2, height: 10, segments: 48 }),
    makeAnnularTopFace({ name: 'cam-test-annular-surfacing-face', outerRadius: 5, innerRadius: 2, y: 10, segments: 48 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_ANNULAR_FACE',
    targetFaces: ['cam-test-annular-surfacing-face'],
    toolDiameter: 0.5,
    toolLength: 20,
    stockAllowance: 0,
    linkClearance: 0.5,
    stepover: 1,
    rasterDirection: 'X',
    safeHeight: 3,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Annular Surfacing should generate a toolpath');
  assert(path.metadata?.runCount > path.metadata?.scanlineCount, 'Annular Surfacing should split scanlines around the selected face hole');
  assert(path.segments.some((segment: any) => segment.kind === 'rapid' && segment.metadata?.clearanceLink), 'Annular Surfacing should bridge the face hole with non-cutting links');
  const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
  assert(!cutPoints.some((point: any) => Math.hypot(point.position[0], point.position[1]) < 1.9), 'Annular Surfacing should not emit cutting points inside the selected face hole');
  const cuttingSegmentCrossesHole = path.segments.some((segment: any) => {
    if (segment.kind !== 'cut') return false;
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    if (!start || !end) return false;
    const cutsAtSurface = start[2] <= 10.1 && end[2] <= 10.1;
    return cutsAtSurface && distancePointToSegment2d(0, 0, start[0], start[1], end[0], end[1]) < 1.9;
  });
  assert(!cuttingSegmentCrossesHole, 'Annular Surfacing should not emit cutting moves across the selected face hole');
}

export async function test_cam_surfacing_resolves_solid_owned_face_reference() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-owned-face-block', topFaceName: 'BLOCK_TOP' }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_OWNED_FACE',
    targetFaces: [{ type: 'FACE', faceName: 'BLOCK_TOP', target: 'cam-test-owned-face-block' }],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Surfacing should generate from a face name owned by a solid');
  assert(direct.warnings.length === 0, 'Solid-owned face Surfacing should not warn when the face resolves');
  assert(direct.summary.targetCount === 1, 'Solid-owned face Surfacing should count the selected face');
  assert(direct.summary.triangleCount === 12, 'Solid-owned face Surfacing should still protect the full owning solid mesh');
  assert(direct.metadata?.faceNames?.includes('BLOCK_TOP'), 'Solid-owned face Surfacing should report the selected face name');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const ys = cutPoints.map((point: any) => point.position[1]);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Solid-owned face Surfacing should reach the selected face X edges');
  assert(Math.min(...ys) === 0 && Math.max(...ys) === 8, 'Solid-owned face Surfacing should reach the selected face Y edges');
  assert(zs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Solid-owned face Surfacing should use the owning solid face height');
}

export async function test_cam_surfacing_does_not_duplicate_direct_face_with_owner_metadata() {
  const manager = new CamPlanManager(null);
  const solid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-direct-owned-face-block', topFaceName: 'BLOCK_TOP' }) as any;
  const face = makeTopRectFace({ name: 'cam-test-direct-owned-face', width: 10, depth: 8, y: 10 }) as any;
  face.userData.faceName = 'BLOCK_TOP';
  face.solid = solid;
  face.parent = solid;
  const viewer = makeViewerWithSolids([solid, face]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_DIRECT_OWNED_FACE',
    targetFaces: [face],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Direct-owned face Surfacing should generate a toolpath');
  assert(direct.summary.targetCount === 1, 'Direct-owned face Surfacing should not count both direct and synthetic face records');
  assert(direct.summary.triangleCount === 12, 'Direct-owned face Surfacing should still protect the owning solid mesh');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const ys = cutPoints.map((point: any) => point.position[1]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Direct-owned face Surfacing should keep the direct face X extent');
  assert(Math.min(...ys) === 0 && Math.max(...ys) === 8, 'Direct-owned face Surfacing should keep the direct face Y extent');
}

export async function test_cam_surfacing_uses_explicit_solid_owner_for_shared_face_name() {
  const manager = new CamPlanManager(null);
  const selectedSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-shared-face-selected', topFaceName: 'SHARED_TOP' }) as any;
  const otherSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-shared-face-other', topFaceName: 'SHARED_TOP' }) as any;
  otherSolid.matrixWorld = new THREE.Matrix4().makeTranslation(20, 0, 0);
  const viewer = makeViewerWithSolids([selectedSolid, otherSolid]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_SHARED_FACE_OWNER',
    targetFaces: [{ type: 'FACE', faceName: 'SHARED_TOP', target: 'cam-test-shared-face-selected' }],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Shared-name Surfacing should generate from the explicitly owned face');
  assert(direct.summary.targetCount === 1, 'Shared-name Surfacing should count only the explicitly owned face');
  assert(direct.summary.triangleCount === 24, 'Shared-name Surfacing should still protect both visible solids');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Shared-name Surfacing should not include another solid with the same face name');
}

export async function test_cam_surfacing_uses_userdata_solid_owner_for_shared_face_name() {
  const manager = new CamPlanManager(null);
  const selectedSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-userdata-face-selected', topFaceName: 'SHARED_TOP' }) as any;
  const otherSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-userdata-face-other', topFaceName: 'SHARED_TOP' }) as any;
  otherSolid.matrixWorld = new THREE.Matrix4().makeTranslation(20, 0, 0);
  const viewer = makeViewerWithSolids([selectedSolid, otherSolid]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_USERDATA_FACE_OWNER',
    targetFaces: [{ type: 'FACE', userData: { faceName: 'SHARED_TOP', solidName: 'cam-test-userdata-face-selected' } }],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'UserData-owned Surfacing should generate from the selected solid face');
  assert(direct.summary.targetCount === 1, 'UserData-owned Surfacing should count only the selected owner face');
  assert(direct.summary.triangleCount === 24, 'UserData-owned Surfacing should still protect both visible solids');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'UserData-owned Surfacing should not include another solid with the same face name');
}

export async function test_cam_surfacing_ui_reference_metadata_preserves_shared_face_owner() {
  const manager = new CamPlanManager(null);
  const selectedSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-ui-ref-face-selected', topFaceName: 'SHARED_TOP' }) as any;
  const otherSolid = makeNamedFaceBoxSolid(10, 10, 8, { name: 'cam-test-ui-ref-face-other', topFaceName: 'SHARED_TOP' }) as any;
  otherSolid.matrixWorld = new THREE.Matrix4().makeTranslation(20, 0, 0);
  const decoyGenericFace = makeTopRectFace({ name: 'FACE', width: 4, depth: 4, y: 6, x: 30, z: 0 });
  const viewer = makeViewerWithSolids([selectedSolid, otherSolid, decoyGenericFace]);
  const targetFaces = normalizeReferenceSelectionList([{
    type: 'FACE',
    name: 'SHARED_TOP',
    userData: { faceName: 'SHARED_TOP', solidName: 'cam-test-ui-ref-face-selected' },
    faceIndex: 0,
  }]);
  const plainReferences = normalizeReferenceSelectionList(['SHARED_TOP']);
  const repeatedNameDifferentOwners = normalizeReferenceSelectionList([
    { type: 'FACE', name: 'SHARED_TOP', userData: { solidName: 'cam-test-ui-ref-face-selected' } },
    { type: 'FACE', name: 'SHARED_TOP', userData: { solidName: 'cam-test-ui-ref-face-other' } },
  ]);
  const repeatedNameDifferentTargets = normalizeReferenceSelectionList([
    { type: 'FACE', name: 'SHARED_TOP', faceName: 'SHARED_TOP', target: 'cam-test-ui-ref-face-selected' },
    { type: 'FACE', name: 'SHARED_TOP', faceName: 'SHARED_TOP', target: 'cam-test-ui-ref-face-other' },
  ]);
  const ownerOnlyFaceReferences = normalizeReferenceSelectionList([
    { type: 'FACE', faceName: 'SHARED_TOP', target: 'cam-test-ui-ref-face-selected' },
  ]);
  const repeatedNameSameOwnerDifferentFaces = normalizeReferenceSelectionList([
    { type: 'FACE', name: 'FACE', userData: { faceName: 'TOP_A', solidName: 'cam-test-ui-ref-face-selected' } },
    { type: 'FACE', name: 'FACE', userData: { faceName: 'TOP_B', solidName: 'cam-test-ui-ref-face-selected' } },
  ]);
  assert(plainReferences.length === 1 && plainReferences[0] === 'SHARED_TOP', 'Reference selection normalization should keep string-only references compatible');
  assert(repeatedNameDifferentOwners.length === 2, 'Reference selection normalization should keep same-name references distinct when owners differ');
  assert(repeatedNameDifferentTargets.length === 2, 'Reference selection normalization should keep same-name references distinct when target owners differ');
  assert(ownerOnlyFaceReferences.length === 1 && (ownerOnlyFaceReferences[0] as any).name === 'SHARED_TOP', 'Reference selection normalization should use faceName when owner metadata has no display name');
  assert(repeatedNameSameOwnerDifferentFaces.length === 2, 'Reference selection normalization should keep same-owner references distinct when face names differ');
  assert(typeof targetFaces[0] === 'object', 'Reference selection normalization should preserve serializable face metadata');
  assert((targetFaces[0] as any).userData?.solidName === 'cam-test-ui-ref-face-selected', 'Reference selection metadata should preserve the face owner solid');
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_UI_REF_FACE_OWNER',
    targetFaces,
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'UI-normalized Surfacing should generate from the selected solid face');
  assert(direct.summary.targetCount === 1, 'UI-normalized Surfacing should count only the selected owner face');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'UI-normalized Surfacing should not include another solid with the same face name');

  const targetOwnerOperation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_UI_REF_TARGET_OWNER',
    targetFaces: repeatedNameDifferentTargets,
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const targetOwnerDirect = targetOwnerOperation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(targetOwnerDirect.paths.length === 1, 'Target-owner face metadata should generate from both owner faces');
  assert(targetOwnerDirect.summary.targetCount === 2, 'Target-owner face metadata should keep same-name faces from different target owners');
  const targetOwnerCutPoints = targetOwnerDirect.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const targetOwnerXs = targetOwnerCutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...targetOwnerXs) === 0 && Math.max(...targetOwnerXs) === 30, 'Target-owner face metadata should surface both same-name owner solids');

  const genericDisplayTargetFaces = normalizeReferenceSelectionList([{
    type: 'FACE',
    name: 'FACE',
    userData: { faceName: 'SHARED_TOP', solidName: 'cam-test-ui-ref-face-selected' },
    faceIndex: 0,
  }]);
  const genericDisplayOperation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_UI_REF_GENERIC_FACE_OWNER',
    targetFaces: genericDisplayTargetFaces,
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const genericDisplayDirect = genericDisplayOperation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(genericDisplayDirect.paths.length === 1, 'Generic-display face metadata should generate from the selected owner face');
  const genericCutPoints = genericDisplayDirect.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const genericXs = genericCutPoints.map((point: any) => point.position[0]);
  const genericZs = genericCutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...genericXs) === 0 && Math.max(...genericXs) === 10, 'Generic-display face metadata should prefer owner metadata over a scene face with the same display name');
  assert(genericZs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Generic-display face metadata should not surface an unrelated direct face named FACE');

  const staleOwnerOperation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_UI_REF_STALE_FACE_OWNER',
    targetFaces: normalizeReferenceSelectionList([{
      type: 'FACE',
      name: 'FACE',
      userData: { faceName: 'SHARED_TOP', solidName: 'cam-test-ui-ref-face-missing' },
      faceIndex: 0,
    }]),
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const staleOwnerDirect = staleOwnerOperation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(staleOwnerDirect.paths.length === 0, 'Stale owner face metadata should not fall back to an unrelated direct face with the same display name');
  assert(staleOwnerDirect.warnings.some((warning: string) => warning.includes('Select one or more faces')), 'Stale owner face metadata should fail closed with a missing selection warning');
}

export async function test_cam_surfacing_applies_parent_transform_to_direct_face_geometry() {
  const manager = new CamPlanManager(null);
  const face = makeTopRectFace({ name: 'cam-test-transformed-direct-face', width: 10, depth: 8, y: 10 });
  const parent = new THREE.Object3D();
  parent.name = 'cam-test-transformed-direct-face-parent';
  parent.matrixWorld.makeTranslation(20, 0, 30);
  (face as any).parent = parent;
  const viewer = makeViewerWithSolids([face]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_TRANSFORMED_FACE',
    targetFaces: [face],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Transformed direct-face Surfacing should generate a toolpath');
  assert(direct.warnings.length === 0, 'Transformed direct-face Surfacing should not warn');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const ys = cutPoints.map((point: any) => point.position[1]);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...xs) === 20 && Math.max(...xs) === 30, 'Direct face Surfacing should apply the parent transform in machine X');
  assert(Math.min(...ys) === 30 && Math.max(...ys) === 38, 'Direct face Surfacing should apply the parent transform in machine Y');
  assert(zs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Direct face Surfacing should keep transformed face height in machine Z');
}

export async function test_cam_surfacing_follows_sloped_face_with_drop_cutter() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeSlopedBlockMeshSolid({ name: 'cam-test-sloped-surfacing-block' }),
    makeSlopedTopFace({ name: 'cam-test-sloped-top-face' }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_SLOPED',
    targetFaces: ['cam-test-sloped-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    rasterDirection: 'Y',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Sloped Surfacing should generate a toolpath');
  assert(direct.warnings.length === 0, 'Sloped Surfacing should not produce generation warnings');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const highSide = cutPoints.filter((point: any) => Math.abs(point.position[0]) < 1e-4).map((point: any) => point.position[2]);
  const lowSide = cutPoints.filter((point: any) => Math.abs(point.position[0] - 10) < 1e-4).map((point: any) => point.position[2]);
  assert(highSide.length > 0 && lowSide.length > 0, 'Sloped Surfacing should sample both high and low face boundaries');
  const highAvg = highSide.reduce((sum: number, value: number) => sum + value, 0) / highSide.length;
  const lowAvg = lowSide.reduce((sum: number, value: number) => sum + value, 0) / lowSide.length;
  assert(highAvg - lowAvg > 5.5, 'Sloped Surfacing should follow the selected surface height instead of cutting at one Z level');
  assert(direct.bounds && direct.bounds.max[2] > direct.bounds.min[2], 'Sloped Surfacing bounds should reflect varying cutter heights');
}

export async function test_cam_surfacing_adaptive_sampling_inserts_points_on_curved_face() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeCurvedTopFace({ name: 'cam-test-curved-top-face' }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_CURVED',
    targetFaces: ['cam-test-curved-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 8,
    sampleSpacing: 12,
    minSampleSpacing: 0.25,
    flatnessCosLimit: 0.9999,
    pathTolerance: 10,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Curved Surfacing should generate a toolpath');
  assert(path.metadata?.adaptiveSubdivisionCount > 0, 'Curved Surfacing should adaptively subdivide a bowed cutter-location pass');
  assert(path.metadata?.adaptiveAcceptedIntervalCount > path.metadata?.runCount, 'Curved Surfacing should accept multiple adaptive intervals per raster run');
  assert(path.metadata?.adaptiveDroppedPointCount > path.metadata?.rawCutPointCount, 'Adaptive Surfacing should track midpoint drops separately from emitted CL points');
  assert(path.metadata?.adaptiveMaxDepthHit === false, 'Curved Surfacing fixture should not hit the adaptive recursion limit');
  const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
  assert(cutPoints.some((point: any) => point.position[0] > 0.25 && point.position[0] < 11.75), 'Adaptive Surfacing should keep interior points on curved passes');
  assert(Math.max(...cutPoints.map((point: any) => point.position[2])) > 8.5, 'Surfacing simplification should not chord through the crowned selected surface');
}

export async function test_cam_surfacing_zero_sample_spacing_uses_automatic_spacing() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-auto-sample-block' }),
    makeTopRectFace({ name: 'cam-test-auto-sample-face', width: 10, depth: 8, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_AUTO_SAMPLE',
    targetFaces: ['cam-test-auto-sample-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 3,
    sampleSpacing: 0,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 1, 'Zero sample-spacing Surfacing should generate a toolpath');
  assert(Math.abs(direct.metadata?.sampleStep - 0.5) < 1e-6, 'Explicit zero sample spacing should use automatic tool-size spacing');
  assert(direct.paths[0].metadata?.pointCount < 80, 'Automatic sample spacing should avoid dense minimum-spacing output moves');
}

export async function test_cam_surfacing_flat_path_tolerance_zero_respects_sample_spacing() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-flat-spacing-block' }),
    makeTopRectFace({ name: 'cam-test-flat-spacing-face', width: 10, depth: 1, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_FLAT_SAMPLE_SPACING',
    targetFaces: ['cam-test-flat-spacing-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 5,
    sampleSpacing: 2,
    minSampleSpacing: 0.05,
    pathTolerance: 0,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Flat zero-tolerance Surfacing should generate a toolpath');
  assert(path.metadata?.rawCutPointCount > path.metadata?.pointCount, 'Flat Surfacing should keep dense internal probe accounting');
  assert(
    path.metadata?.pointCount < 80 && path.metadata?.pointCount * 6 < path.metadata?.rawCutPointCount,
    `Flat zero-tolerance Surfacing should not emit minimum-spacing moves on straight unobstructed runs; emitted ${path.metadata?.pointCount} from ${path.metadata?.rawCutPointCount} probes with sample ${direct.metadata?.sampleStep}`,
  );
  const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
  const xs = cutPoints.map((point: any) => point.position[0]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Coarsened flat Surfacing output should still reach the selected face edges');
}

export async function test_cam_surfacing_combined_gcode_posts_single_runnable_program() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-combined-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-combined-left-face', width: 4, depth: 8, y: 10, x: 0, z: 0 }),
    makeTopRectFace({ name: 'cam-test-combined-right-face', width: 4, depth: 8, y: 10, x: 6, z: 0 }),
  ]);
  manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_COMBINED_LEFT',
    targetFaces: ['cam-test-combined-left-face'],
    toolDiameter: 2,
    toolLength: 20,
    stepover: 8,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 9000,
  });
  manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_COMBINED_RIGHT',
    targetFaces: ['cam-test-combined-right-face'],
    toolDiameter: 2,
    toolLength: 20,
    stepover: 8,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 11000,
  });

  const combined = manager.generateAll(viewer);
  const gcode = String(combined.gcode || '');
  const programEndCount = (gcode.match(/^M2$/gm) || []).length;
  const headerCount = (gcode.match(/Generated by BREP CAM/g) || []).length;
  const leftPathIndex = gcode.indexOf('SF_COMBINED_LEFT-SURF');
  const rightPathIndex = gcode.indexOf('SF_COMBINED_RIGHT-SURF');
  const finalProgramEndIndex = gcode.lastIndexOf('M2');
  assert(combined.paths.length === 2, 'Combined Surfacing plan should include both surfacing paths');
  assert(combined.summary.pointCount === combined.paths.reduce((sum: number, path: any) => sum + path.points.length, 0), 'Combined Surfacing summary should count all path points');
  assert(combined.summary.safePointCount === combined.paths.reduce((sum: number, path: any) => (
    sum + path.points.filter((point: any) => point.metadata?.safe).length
  ), 0), 'Combined Surfacing summary should preserve safe travel point counts');
  assert(combined.summary.contactPointCount === combined.summary.pointCount - combined.summary.safePointCount, 'Combined Surfacing summary should preserve cutter-contact point counts');
  assert(programEndCount === 1, 'Combined Surfacing G-code should contain one final program end');
  assert(headerCount === 1, 'Combined Surfacing G-code should contain one program header');
  assert(leftPathIndex >= 0 && rightPathIndex > leftPathIndex, 'Combined Surfacing G-code should post both paths in order');
  assert(finalProgramEndIndex > rightPathIndex, 'Combined Surfacing G-code should not end before the second surfacing path');
  assert(gcode.includes('M3 S9000') && gcode.includes('M3 S11000'), 'Combined Surfacing G-code should preserve per-operation spindle speeds');
}

export async function test_cam_surfacing_combined_gcode_reissues_feed_after_roughing() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-mixed-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-mixed-surfacing-top-face', width: 10, depth: 8, y: 10 }),
  ]);
  manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_MIXED_BEFORE_SURFACING',
    targetSolids: ['cam-test-mixed-surfacing-block'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 8,
    extraDepth: 0,
    safeHeight: 2,
    feedRate: 500,
    plungeRate: 100,
    spindleRPM: 8000,
  });
  manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_MIXED_AFTER_ROUGHING',
    targetFaces: ['cam-test-mixed-surfacing-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 8,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 11000,
  });

  const combined = manager.generateAll(viewer);
  const gcode = String(combined.gcode || '');
  const roughingIndex = gcode.indexOf('RG_MIXED_BEFORE_SURFACING-ROUGH');
  const surfacingIndex = gcode.indexOf('SF_MIXED_AFTER_ROUGHING-SURF');
  const surfacingSection = surfacingIndex >= 0 ? gcode.slice(surfacingIndex) : '';
  assert(combined.paths.length === 2, 'Mixed CAM plan should include roughing and surfacing paths');
  assert((gcode.match(/^M2$/gm) || []).length === 1, 'Mixed roughing/surfacing G-code should contain one final program end');
  assert(roughingIndex >= 0 && surfacingIndex > roughingIndex, 'Mixed roughing/surfacing G-code should keep operation order');
  assert(gcode.includes('M3 S8000') && gcode.includes('M3 S11000'), 'Mixed roughing/surfacing G-code should preserve operation spindle changes');
  assert(surfacingSection.includes('G1 F150'), 'Surfacing section should reissue its plunge feed after roughing');
  assert(surfacingSection.includes('G1 F700'), 'Surfacing section should reissue its cut feed after roughing');
}

export async function test_cam_surfacing_splits_runs_around_preserved_island() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(12, 10, 8, { name: 'cam-test-island-base' }),
    makeBoxMeshSolid(2, 2, 2, { name: 'cam-test-preserved-island', offsetX: 5, offsetY: 10, offsetZ: 3 }),
    makeTopRectFace({ name: 'cam-test-island-base-top-face', width: 12, depth: 8, y: 10, x: 0, z: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_PRESERVED_ISLAND',
    targetFaces: ['cam-test-island-base-top-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    linkClearance: 0.5,
    stepover: 2,
    rasterDirection: 'X',
    safeHeight: 5,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Preserved-island Surfacing should generate a toolpath');
  assert(path.metadata?.runCount > path.metadata?.scanlineCount, 'Surfacing should split cutting runs around preserved geometry inside the face footprint');
  assert(direct.metadata?.runCount === path.metadata?.runCount, 'Surfacing operation metadata should record split cutting run count');
  assert(direct.metadata?.scanlineCount === path.metadata?.scanlineCount, 'Surfacing operation metadata should record raster scanline count');
  assert(direct.summary.levelCount === path.metadata?.scanlineCount, 'Surfacing summary level count should report raster passes, not split cutting spans');
  assert(path.segments.some((segment: any) => segment.metadata?.clearanceLink), 'Surfacing should bridge preserved-island splits with a non-cutting clearance link');
  const cutPoints = path.points.filter((point: any) => !point.metadata?.safe);
  assert(cutPoints.every((point: any) => point.position[2] <= 10 + 1e-4), 'Surfacing should not emit cutting moves on top of the preserved island');
  assert(!cutPoints.some((point: any) => (
    point.position[0] >= 5 - 1e-4
    && point.position[0] <= 7 + 1e-4
    && point.position[1] >= 3 - 1e-4
    && point.position[1] <= 5 + 1e-4
  )), 'Surfacing should not emit cutting points through the preserved island footprint');
  const sameScanlineClearanceRapids = path.segments.filter((segment: any) => {
    if (segment.kind !== 'rapid' || !segment.metadata?.clearanceLink) return false;
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    return start && end && Math.abs(start[1] - end[1]) < 1e-4;
  });
  assert(sameScanlineClearanceRapids.length > 0, 'Surfacing should bridge island-split runs on the same scanline');
  assert(sameScanlineClearanceRapids.every((segment: any) => {
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    return start && end && Math.abs(end[0] - start[0]) <= 4.1;
  }), 'Surfacing should bridge only the local preserved-island gap instead of clearance-hopping across the next span');
}

export async function test_cam_surfacing_detects_narrow_preserved_island_between_coarse_samples() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(12, 10, 8, { name: 'cam-test-narrow-island-base' }),
    makeBoxMeshSolid(0.2, 2, 0.5, { name: 'cam-test-narrow-preserved-island', offsetX: 4.1, offsetY: 10, offsetZ: 3.75 }),
    makeTopRectFace({ name: 'cam-test-narrow-island-base-top-face', width: 12, depth: 8, y: 10, x: 0, z: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_NARROW_PRESERVED_ISLAND',
    targetFaces: ['cam-test-narrow-island-base-top-face'],
    toolDiameter: 0.2,
    toolLength: 20,
    stockAllowance: 0,
    linkClearance: 0.2,
    stepover: 2,
    sampleSpacing: 5,
    minSampleSpacing: 2,
    rasterDirection: 'X',
    safeHeight: 5,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Narrow preserved-island Surfacing should generate a toolpath');
  assert(direct.metadata?.minSampleSpacing <= 0.05 + 1e-6, 'Surfacing should cap safety sampling even when min sample spacing is configured coarsely');
  assert(path.metadata?.runCount > path.metadata?.scanlineCount, 'Surfacing should split runs around narrow preserved geometry between coarse samples');
  assert(path.segments.some((segment: any) => segment.metadata?.clearanceLink), 'Surfacing should use a non-cutting link across the narrow preserved island');
  const crossesIsland = path.segments.some((segment: any) => {
    if (segment.kind !== 'cut') return false;
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    if (!start || !end) return false;
    const crossesX = Math.min(start[0], end[0]) < 4.3 && Math.max(start[0], end[0]) > 4.1;
    const crossesY = Math.min(start[1], end[1]) <= 4.25 && Math.max(start[1], end[1]) >= 3.75;
    const cutsBaseHeight = start[2] <= 10.1 && end[2] <= 10.1;
    return crossesX && crossesY && cutsBaseHeight;
  });
  assert(!crossesIsland, 'Surfacing should not emit a cutting segment that crosses a narrow preserved island');
}

export async function test_cam_surfacing_uses_low_clearance_links_between_separate_face_spans() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(12, 10, 8, { name: 'cam-test-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-left-top-face', width: 4, depth: 8, y: 10, x: 0, z: 0 }),
    makeTopRectFace({ name: 'cam-test-right-top-face', width: 4, depth: 8, y: 10, x: 8, z: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_LINK',
    targetFaces: ['cam-test-left-top-face', 'cam-test-right-top-face'],
    toolDiameter: 2,
    stockAllowance: 0,
    linkClearance: 0.5,
    stepover: 8,
    rasterDirection: 'X',
    safeHeight: 5,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Separate-span Surfacing should generate a toolpath');
  const clearanceSegments = path.segments.filter((segment: any) => segment.metadata?.clearanceLink);
  const clearanceRapids = clearanceSegments.filter((segment: any) => segment.kind === 'rapid');
  assert(clearanceRapids.length > 0, 'Separate spans should be joined with a non-cutting clearance link');
  assert(path.metadata?.clearanceLinkCount === clearanceRapids.length, 'Surfacing metadata should count clearance links, not every clearance-link segment');
  const clearanceZs = clearanceSegments
    .map((segment: any) => path.points[segment.endIndex]?.position?.[2])
    .filter((z: number) => Number.isFinite(z));
  const localLinkZ = clearanceZs.find((z: number) => z > 10 && z < direct.safeZ);
  assert(Number.isFinite(localLinkZ), 'Clearance links should lift locally instead of returning to full safe Z');
  const interiorSafeRetracts = path.segments.filter((segment: any, index: number) => (
    index < path.segments.length - 1
    && segment.kind === 'retract'
    && Math.abs((path.points[segment.endIndex]?.position?.[2] || 0) - direct.safeZ) < 1e-4
  ));
  assert(interiorSafeRetracts.length === 0, 'Surfacing should avoid full safe-Z retracts between reachable raster spans');
  const gcodeLines = String(direct.gcode || '').split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  assert(gcodeLines.some((line) => line.startsWith('G0 ') && line.includes(`Z${localLinkZ}`)), 'Posted Surfacing G-code should preserve local clearance-link Z moves');
  const fullSafeTravelLines = gcodeLines.filter((line) => (
    line.startsWith('G0 ')
    && line.includes('X')
    && line.includes('Y')
    && line.includes(`Z${direct.safeZ}`)
  ));
  assert(fullSafeTravelLines.length <= 1, 'Posted Surfacing G-code should avoid full safe-Z travel between reachable raster spans');
}

export async function test_cam_surfacing_falls_back_to_full_retract_when_low_hop_reaches_safe_height() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(12, 10, 8, { name: 'cam-test-surfacing-base' }),
    makeBoxMeshSolid(4, 3, 8, { name: 'cam-test-preserved-ridge', offsetX: 4, offsetY: 10, offsetZ: 0 }),
    makeTopRectFace({ name: 'cam-test-low-left-face', width: 3, depth: 8, y: 10, x: 0, z: 0 }),
    makeTopRectFace({ name: 'cam-test-low-right-face', width: 3, depth: 8, y: 10, x: 9, z: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_LINK_BLOCKED',
    targetFaces: ['cam-test-low-left-face', 'cam-test-low-right-face'],
    toolDiameter: 2,
    stockAllowance: 0,
    linkClearance: 0.5,
    stepover: 8,
    rasterDirection: 'X',
    safeHeight: 0.5,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const machineProfile = { ...manager.getMachineProfile(), safeParkZ: 0 };
  const direct = operation.run({
    viewer,
    machineProfile,
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Blocked low-hop Surfacing should still generate a toolpath');
  assert(Math.abs(direct.safeZ - 13.5) < 1e-4, 'Surfacing safeZ should include the preserved ridge plus requested link clearance');
  const clearanceSegments = path.segments.filter((segment: any) => segment.metadata?.clearanceLink);
  assert(clearanceSegments.length === 0, 'Unsafe low-hop links that reach safe height should fall back to normal safe moves');
  const interiorSafeRetracts = path.segments.filter((segment: any, index: number) => (
    index < path.segments.length - 1
    && segment.kind === 'retract'
    && Math.abs((path.points[segment.endIndex]?.position?.[2] || 0) - direct.safeZ) < 1e-4
  ));
  assert(interiorSafeRetracts.length > 0, 'Blocked low-hop Surfacing should use full safe-Z retracts between spans');
}

export async function test_cam_surfacing_clearance_link_samples_narrow_preserved_geometry() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(12, 10, 8, { name: 'cam-test-narrow-link-base' }),
    makeBoxMeshSolid(0.2, 3, 1, { name: 'cam-test-narrow-preserved-ridge', offsetX: 5.9, offsetY: 10, offsetZ: -0.5 }),
    makeTopRectFace({ name: 'cam-test-narrow-left-face', width: 3, depth: 8, y: 10, x: 0, z: 0 }),
    makeTopRectFace({ name: 'cam-test-narrow-right-face', width: 3, depth: 8, y: 10, x: 9, z: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_LINK_NARROW_OBSTACLE',
    targetFaces: ['cam-test-narrow-left-face', 'cam-test-narrow-right-face'],
    toolDiameter: 2,
    stockAllowance: 0,
    linkClearance: 0.5,
    stepover: 8,
    sampleSpacing: 5,
    minSampleSpacing: 2,
    rasterDirection: 'X',
    safeHeight: 5,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const machineProfile = { ...manager.getMachineProfile(), safeParkZ: 0 };
  const direct = operation.run({
    viewer,
    machineProfile,
    stockProfile: manager.getStockProfile(),
  });
  const path = direct.paths[0];
  assert(path, 'Narrow-obstacle Surfacing should generate a toolpath');
  assert(Math.abs(direct.safeZ - 18) < 1e-4, 'Narrow-obstacle Surfacing fixture should keep full safe Z above the preserved ridge');
  assert(path.metadata?.linkSampleStep <= 0.05 + 1e-6, 'Clearance links should keep conservative obstacle checks even when minimum spacing is configured coarsely');
  const clearanceZs = path.segments
    .filter((segment: any) => segment.metadata?.clearanceLink)
    .map((segment: any) => path.points[segment.endIndex]?.position?.[2])
    .filter((z: number) => Number.isFinite(z));
  assert(clearanceZs.some((z: number) => z >= 13.5 - 1e-4 && z < direct.safeZ), 'Clearance links should lift over narrow preserved geometry instead of sampling past it');
}

export async function test_cam_surfacing_rejects_vertical_face_without_projected_area() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(10, 10, 8, { name: 'cam-test-surfacing-block' }),
    makeVerticalSideFace({ name: 'cam-test-vertical-side-face', depth: 8, height: 10, x: 0 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_VERTICAL',
    targetFaces: ['cam-test-vertical-side-face'],
    toolDiameter: 2,
    stockAllowance: 0,
    stepover: 1,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 0, 'Vertical Surfacing should not emit a top-down raster path');
  assert(direct.warnings.some((warning: string) => warning.includes('Vertical faces cannot be surfaced top-down')), 'Vertical Surfacing should explain the missing projected area');
  assert(direct.cutter?.kind === 'ball-endmill', 'Empty Surfacing results should still describe the selected ball end mill');
}

export async function test_cam_surfacing_reports_warning_when_raster_too_dense() {
  const manager = new CamPlanManager(null);
  const viewer = makeViewerWithSolids([
    makeBoxMeshSolid(500, 10, 500, { name: 'cam-test-dense-surfacing-block' }),
    makeTopRectFace({ name: 'cam-test-dense-surfacing-face', width: 500, depth: 500, y: 10 }),
  ]);
  const operation = manager.createOperation(CAM_OPERATION_TYPE_SURFACING, {
    id: 'SF_DENSE_RASTER',
    targetFaces: ['cam-test-dense-surfacing-face'],
    toolDiameter: 2,
    toolLength: 20,
    stockAllowance: 0,
    stepover: 0.001,
    sampleSpacing: 0,
    minSampleSpacing: 0.05,
    rasterDirection: 'X',
    safeHeight: 2,
    feedRate: 700,
    plungeRate: 150,
    spindleRPM: 10000,
  });
  const direct = operation.run({
    viewer,
    machineProfile: manager.getMachineProfile(),
    stockProfile: manager.getStockProfile(),
  });
  assert(direct.paths.length === 0, 'Overly dense Surfacing should return an empty program instead of throwing');
  assert(direct.warnings.some((warning: string) => warning.includes('Surfacing raster is too dense')), 'Overly dense Surfacing should report an actionable density warning');
  assert(direct.operationId === 'SF_DENSE_RASTER', 'Overly dense Surfacing should keep the operation id in the empty result');
  assert(direct.cutter?.kind === 'ball-endmill', 'Overly dense Surfacing result should still describe the selected ball end mill');
  assert(direct.targetBounds?.max?.[2] === 10, 'Overly dense Surfacing should preserve target bounds for diagnostics');
}

export async function test_cam_workbench_registers_shadow_cutter_and_roughing_operations() {
  const manager = new CamPlanManager(null);
  const available = Array.from(manager.registry.entityClasses.values());
  assert(available.includes(ShadowCutterEntity), 'Shadow Cutter should be a registered CAM operation');
  assert(available.includes(RoughingEntity), 'Roughing should be a registered CAM operation');
  assert(available.includes(SurfacingEntity), 'Surfacing should be a registered CAM operation');
  assert(ShadowCutterEntity.longName === 'Shadow Cutter', 'Shadow Cutter should be the add-menu label');
  assert(RoughingEntity.longName === 'Roughing', 'Roughing should be the add-menu label');
  assert(SurfacingEntity.longName === 'Surfacing', 'Surfacing should be the add-menu label');
  assert(RoughingEntity.inputParamsSchema.debugSlices?.type === 'boolean', 'Roughing should expose a debug slice checkbox');
  assert(SurfacingEntity.inputParamsSchema.targetFaces?.selectionFilter?.includes('FACE'), 'Surfacing should select target faces');
  assert(SurfacingEntity.inputParamsSchema.rasterDirection?.options?.includes('Y'), 'Surfacing should expose raster direction choices');
  assert(SurfacingEntity.inputParamsSchema.rasterDirection?.options?.includes('Both'), 'Surfacing should expose a combined X/Y raster direction choice');
  assert(SurfacingEntity.inputParamsSchema.pathTolerance?.type === 'number', 'Surfacing should expose cutter-location simplification tolerance');
  assert(SurfacingEntity.inputParamsSchema.sampleSpacing?.type === 'number', 'Surfacing should expose adaptive sample spacing');
  assert(SurfacingEntity.inputParamsSchema.minSampleSpacing?.type === 'number', 'Surfacing should expose adaptive minimum sample spacing');
  assert(SurfacingEntity.inputParamsSchema.flatnessCosLimit?.type === 'number', 'Surfacing should expose adaptive flatness tolerance');
  assert(!Object.prototype.hasOwnProperty.call(ShadowCutterEntity.inputParamsSchema, 'toolShape'), 'Old generic cutter shape field should be removed');
  assert(!Object.prototype.hasOwnProperty.call(ShadowCutterEntity.inputParamsSchema, 'stepover'), 'Old raster stepover field should be removed');
}

function cutPoints2d(path: any, safeZ: number) {
  return path.points
    .filter((point: any) => Math.abs(point.position[2] - safeZ) > 1e-4)
    .map((point: any) => [point.position[0], point.position[1]] as [number, number]);
}

function cutPoints2dForSlice(path: any, sliceIndex: number) {
  return path.points
    .filter((point: any) => point.metadata?.sliceIndex === sliceIndex && !point.metadata?.safe)
    .map((point: any) => [point.position[0], point.position[1]] as [number, number]);
}

function points2dForMetadata(path: any, predicate: (point: any) => boolean) {
  return path.points
    .filter(predicate)
    .map((point: any) => [point.position[0], point.position[1]] as [number, number]);
}

function pointKeySet(points: Array<[number, number]>) {
  return new Set(points.map((point) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`));
}

function assertSamePointSet(left: Set<string>, right: Set<string>, message: string) {
  const missing = Array.from(left).filter((key) => !right.has(key));
  const extra = Array.from(right).filter((key) => !left.has(key));
  assert(!missing.length && !extra.length, `${message}: missing ${missing.slice(0, 4).join(' ')} extra ${extra.slice(0, 4).join(' ')}`);
}

function distancePointToSegment2d(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = (abx * abx) + (aby * aby);
  if (lenSq <= 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (((px - ax) * abx) + ((py - ay) * aby)) / lenSq));
  return Math.hypot(px - (ax + (abx * t)), py - (ay + (aby * t)));
}

function distanceToRect(x: number, y: number, minX: number, minY: number, maxX: number, maxY: number) {
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  return Math.hypot(dx, dy);
}

function pointInsideLFixture(x: number, y: number) {
  const tol = 1e-4;
  return (
    (x > tol && x < 10 - tol && y > tol && y < 4 - tol)
    || (x > tol && x < 4 - tol && y > tol && y < 10 - tol)
  );
}

function distanceToLFixture(x: number, y: number) {
  return Math.min(
    distanceToRect(x, y, 0, 0, 10, 4),
    distanceToRect(x, y, 0, 0, 4, 10),
  );
}

export async function test_cam_workbench_registers_and_persists_part_history_state() {
  const workbench = getWorkbenchDefinition('CAM');
  assert(workbench, 'CAM workbench should be registered');
  const camPanels: Record<string, any> = workbench.sidePanels || {};
  assert(Object.keys(camPanels).filter((key) => key.startsWith('cam')).join('|') === 'camHistory|camMachineConfiguration|camGcode', 'CAM workbench should list CAM History before the other CAM panels');
  assert(camPanels.sceneManager === true, 'CAM workbench should keep the Scene Manager panel visible');

  const partHistory = new PartHistory();
  partHistory.camPlanManager.createOperation(CAM_OPERATION_TYPE_SHADOW_CUTTER, defaultCamParams({ id: 'SC_SAVE' }));
  const serializable = partHistory.toSerializable();
  const parsed = typeof serializable === 'string' ? JSON.parse(serializable) : serializable;
  assert(parsed.cam?.operations?.length === 1, 'Part history JSON should persist CAM operations');
  assert(parsed.cam.operations[0]?.type === CAM_OPERATION_TYPE_SHADOW_CUTTER, 'Part history JSON should persist Shadow Cutter type');
  assert(parsed.cam.operations[0]?.inputParams?.id === 'SC_SAVE', 'Part history JSON should persist CAM operation inputs');
}

export async function test_cam_workbench_exit_clears_scene_artifacts() {
  const scene = new THREE.Scene();
  scene.add(makeObject3DSolid(makeBoxMeshSolid()));
  const partHistory = new PartHistory() as any;
  partHistory.scene = scene;
  let renderCount = 0;
  const viewer: any = {
    partHistory,
    scene,
    _viewerOnlyMode: true,
    render() {
      renderCount += 1;
    },
  };
  Object.assign(viewer, workbenchMethods);
  partHistory.viewer = viewer;

  const manager = partHistory.camPlanManager;
  manager.createOperation(CAM_OPERATION_TYPE_ROUGHING, {
    id: 'RG_EXIT_CLEANUP',
    targetSolids: [],
    toolDiameter: 2,
    stockAllowance: 0,
    stepDown: 4,
    extraDepth: 0,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    debugSlices: true,
  });

  const countDebugSolids = () => {
    let count = 0;
    scene.traverse((object: any) => {
      if (object?.userData?.camDebugKind === CAM_DEBUG_SLICE_SOLID_KIND) count += 1;
    });
    return count;
  };
  const seedCamSceneArtifacts = () => {
    viewer.setActiveWorkbench('CAM', { queueHistorySnapshot: false });
    const combined = manager.generateAll(viewer);
    assert(countDebugSolids() > 0, 'Generating CAM roughing debug output should add CAM scene solids');
    const simulator = new CamToolpathSimulator({ scene, viewer });
    simulator.setProgram(combined);
    assert(scene.getObjectByName(CAM_TOOLPATH_SIMULATOR_GROUP_NAME), 'CAM simulator overlay should be present before leaving CAM');
    return simulator;
  };

  const targetWorkbenches = ['MODELING', 'SURFACING', 'SIMULATION', 'ASSEMBLIES', 'WIRE_HARNESS', 'PMI', 'SHEET_METAL', 'IMPORT', 'ALL'];
  for (const target of targetWorkbenches) {
    const simulator = seedCamSceneArtifacts();
    const renderCountBefore = renderCount;
    viewer.setActiveWorkbench(target, { queueHistorySnapshot: false });
    assert(!scene.getObjectByName(CAM_TOOLPATH_SIMULATOR_GROUP_NAME), `Leaving CAM for ${target} should remove the simulator overlay`);
    assert(countDebugSolids() === 0, `Leaving CAM for ${target} should remove CAM debug slice solids from the scene`);
    assert((manager.getCombinedPlan()?.paths?.length || 0) > 0, `Leaving CAM for ${target} should not discard the generated CAM plan`);
    assert(renderCount > renderCountBefore, `Leaving CAM for ${target} after artifact cleanup should request a render`);
    simulator.dispose();
  }
}

export async function test_cam_toolpath_simulator_visualizes_program_and_moves_head() {
  const cutter = makeFlatEndMillCutter({ diameter: 2, cuttingLength: 10, overallLength: 12 });
  const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [1, 0, 0] });
  const path = buildLinearToolpathPath({
    id: 'SIM-P1',
    operationId: 'SIM',
    operationName: 'Simulator Fixture',
    positions: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    cutter,
    orientation,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const base: Omit<CamToolpathProgram, 'gcode'> = {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId: 'SIM',
    operationName: 'Simulator Fixture',
    units: 'mm' as const,
    coordinateSystem: 'machine' as const,
    generatedAt: '2026-07-03T00:00:00.000Z',
    machine: new CamPlanManager(null).getMachineProfile(),
    bounds: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 0] as [number, number, number] },
    targetBounds: null,
    safeZ: 15,
    cutter,
    spindleRPM: 9000,
    paths: [path],
    summary: summarizeCamToolpathProgram({ paths: [path], targetCount: 1, triangleCount: 0, levelCount: 1 }),
    warnings: [],
  };
  const program: CamToolpathProgram = { ...base, gcode: generateGcodeForCamToolpathProgram(base) };
  const scene = new THREE.Scene();
  let renderCount = 0;
  const simulator = new CamToolpathSimulator({
    scene,
    viewer: {
      scene,
      render() {
        renderCount += 1;
      },
    },
  });

  simulator.setProgram(program);
  const group = scene.getObjectByName(CAM_TOOLPATH_SIMULATOR_GROUP_NAME);
  assert(group, 'Simulator should add a CAM toolpath overlay group');
  assert(group?.userData?.sceneOverlay === true, 'Simulator overlay should be marked as scene overlay');
  assert(group?.userData?.preventRemove === true, 'Simulator overlay should be protected from history scene cleanup');
  assert(simulator.getState().totalSteps === 2, 'Simulator should flatten path segments into simulation steps');

  simulator.setProgress(0.5);
  const midState = simulator.getState();
  const toolHead = scene.getObjectByName(CAM_TOOLPATH_TOOL_HEAD_NAME);
  assert(toolHead, 'Simulator should render a moving tool head');
  assert(midState.currentSegment?.segmentId === 'SIM-P1-S1', 'Simulator state should expose the active segment for G-code synchronization');
  assert(Math.abs((toolHead as THREE.Object3D).position.x - 10) < 1e-6, 'Tool head should move to halfway X position');
  assert(Math.abs((toolHead as THREE.Object3D).position.y - 0) < 1e-6, 'Tool head scene Y should map from machine Z');
  assert(Math.abs((toolHead as THREE.Object3D).position.z - 0) < 1e-6, 'Tool head scene Z should map from machine Y');
  assert(renderCount > 0, 'Simulator should request viewer renders when it updates');

  simulator.dispose();
  assert(!scene.getObjectByName(CAM_TOOLPATH_SIMULATOR_GROUP_NAME), 'Simulator dispose should remove its overlay group');
}

export async function test_cam_toolpath_simulator_displays_ball_endmill_round_tip() {
  const cutter = makeBallEndMillCutter({ diameter: 4, cuttingLength: 12, overallLength: 14 });
  const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [1, 0, 0] });
  const path = buildLinearToolpathPath({
    id: 'SIM-BALL-P1',
    operationId: 'SIM-BALL',
    operationName: 'Ball Simulator Fixture',
    positions: [
      [0, 0, 0],
      [4, 0, 0],
    ],
    cutter,
    orientation,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
  });
  const base: Omit<CamToolpathProgram, 'gcode'> = {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId: 'SIM-BALL',
    operationName: 'Ball Simulator Fixture',
    units: 'mm' as const,
    coordinateSystem: 'machine' as const,
    generatedAt: '2026-07-03T00:00:00.000Z',
    machine: new CamPlanManager(null).getMachineProfile(),
    bounds: { min: [0, 0, 0] as [number, number, number], max: [4, 0, 0] as [number, number, number] },
    targetBounds: null,
    safeZ: 15,
    cutter,
    spindleRPM: 9000,
    paths: [path],
    summary: summarizeCamToolpathProgram({ paths: [path], targetCount: 1, triangleCount: 0, levelCount: 1 }),
    warnings: [],
  };
  const program: CamToolpathProgram = { ...base, gcode: generateGcodeForCamToolpathProgram(base) };
  const scene = new THREE.Scene();
  const simulator = new CamToolpathSimulator({ scene });

  simulator.setProgram(program);
  const toolHead = scene.getObjectByName(CAM_TOOLPATH_TOOL_HEAD_NAME) as THREE.Group | null;
  assert(toolHead, 'Ball endmill simulator should render a tool head');
  const tip = toolHead.getObjectByName('__CAM_TOOLPATH_TOOL_TIP__') as THREE.Mesh | null;
  const body = toolHead.getObjectByName('__CAM_TOOLPATH_TOOL_BODY__') as THREE.Mesh | null;
  const tipOutline = toolHead.getObjectByName('__CAM_TOOLPATH_TOOL_TIP_OUTLINE__') as THREE.LineSegments | null;
  const tipProfile = toolHead.getObjectByName('__CAM_TOOLPATH_TOOL_TIP_PROFILE__') as THREE.LineSegments | null;
  assert(tip?.geometry, 'Ball endmill simulator should render a ball-nose tip mesh');
  assert(body?.geometry, 'Ball endmill simulator should render a cylindrical shank mesh');
  assert(tipOutline?.geometry, 'Ball endmill simulator should outline the rounded ball nose');
  assert(tipProfile?.geometry, 'Ball endmill simulator should draw a visible round-end profile');
  const tipMesh = tip as THREE.Mesh;
  const bodyMesh = body as THREE.Mesh;
  tipMesh.geometry.computeBoundingBox();
  bodyMesh.geometry.computeBoundingBox();
  const tipBox = tipMesh.geometry.boundingBox;
  const bodyBox = bodyMesh.geometry.boundingBox;
  assert(Math.abs((tipBox?.min.y ?? NaN) - 0) < 1e-6, 'Ball endmill rounded tip should start at the tool reference point');
  assert(Math.abs((tipBox?.max.y ?? NaN) - cutter.radius) < 1e-6, 'Ball endmill rounded tip should rise to the ball equator');
  assert(Math.abs((bodyBox?.min.y ?? NaN) - cutter.radius) < 1e-6, 'Ball endmill body should start above the round tip');
  const bodyPositions = bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let hasFlatNoseCapCenter = false;
  for (let index = 0; index < bodyPositions.count; index += 1) {
    const x = bodyPositions.getX(index);
    const y = bodyPositions.getY(index);
    const z = bodyPositions.getZ(index);
    if (Math.abs(y - cutter.radius) < 1e-6 && Math.hypot(x, z) < 1e-6) {
      hasFlatNoseCapCenter = true;
      break;
    }
  }
  assert(!hasFlatNoseCapCenter, 'Ball endmill body should not draw a flat cap through the round nose');
  tipProfile.geometry.computeBoundingBox();
  const profileBox = tipProfile.geometry.boundingBox;
  assert(Math.abs((profileBox?.min.y ?? NaN) - 0) < 1e-6, 'Ball endmill profile should include the round tip point');
  assert(Math.abs((profileBox?.max.y ?? NaN) - cutter.radius) < 1e-6, 'Ball endmill profile should meet the shank at the ball equator');

  simulator.dispose();
}
