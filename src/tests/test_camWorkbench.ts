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
  makeFlatEndMillCutter,
  normalizeCamOrientation,
  summarizeCamToolpathProgram,
  type CamToolpathProgram,
} from '../cam/CamToolpathDefinition.js';
import { CAM_OPERATION_TYPE_SHADOW_CUTTER, ShadowCutterEntity } from '../cam/ShadowCutterEntity.js';
import { CAM_OPERATION_TYPE_ROUGHING, RoughingEntity } from '../cam/RoughingEntity.js';
import { CAM_OPERATION_TYPE_SURFACING, SurfacingEntity } from '../cam/SurfacingEntity.js';
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
  assert(direct.summary.targetCount === 1, 'Surfacing should report selected face count');
  assert(direct.summary.triangleCount === 12, 'Surfacing should use the whole visible solid mesh for gouge checks');
  assert(direct.summary.levelCount === 4, 'Surfacing should include the final boundary pass when stepover does not divide the face depth');
  assert(direct.paths[0].metadata?.runCount === 4, 'Surfacing path metadata should record every raster run');
  assert(direct.paths[0].metadata?.filteredCutPointCount > 0, 'Surfacing should filter redundant flat-face cutter-location samples');
  assert(direct.paths[0].metadata?.rawCutPointCount > direct.paths[0].metadata?.pointCount, 'Surfacing metadata should expose sample reduction');
  const cutPoints = direct.paths[0].points.filter((point: any) => !point.metadata?.safe);
  const ys = cutPoints.map((point: any) => point.position[1]);
  const xs = cutPoints.map((point: any) => point.position[0]);
  const zs = cutPoints.map((point: any) => point.position[2]);
  assert(Math.min(...xs) === 0 && Math.max(...xs) === 10, 'Surfacing raster should run all the way to the selected face edge');
  assert(Math.min(...ys) === 0 && Math.max(...ys) === 8, 'Surfacing raster should cover both selected face boundaries');
  assert(zs.every((z: number) => Math.abs(z - 10) < 1e-4), 'Flat-face surfacing should keep the ball tip on the top plane');
  assert(direct.gcode.includes('Operation: Surfacing'), 'Posted G-code should identify the Surfacing operation');

  const combined = manager.generateAll(viewer);
  assert(combined.paths.length === direct.paths.length, 'CAM manager should include Surfacing output in combined generation');
  assert(manager.getGeneratedResults()[0]?.operationId === 'SF1', 'CAM manager should retain Surfacing runtime results');
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
  assert(clearanceSegments.some((segment: any) => segment.kind === 'rapid'), 'Separate spans should be joined with a non-cutting clearance link');
  const clearanceZs = clearanceSegments
    .map((segment: any) => path.points[segment.endIndex]?.position?.[2])
    .filter((z: number) => Number.isFinite(z));
  assert(clearanceZs.some((z: number) => z > 10 && z < direct.safeZ), 'Clearance links should lift locally instead of returning to full safe Z');
  const interiorSafeRetracts = path.segments.filter((segment: any, index: number) => (
    index < path.segments.length - 1
    && segment.kind === 'retract'
    && Math.abs((path.points[segment.endIndex]?.position?.[2] || 0) - direct.safeZ) < 1e-4
  ));
  assert(interiorSafeRetracts.length === 0, 'Surfacing should avoid full safe-Z retracts between reachable raster spans');
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
  assert(SurfacingEntity.inputParamsSchema.pathTolerance?.type === 'number', 'Surfacing should expose cutter-location simplification tolerance');
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
  const toolHead = scene.getObjectByName(CAM_TOOLPATH_TOOL_HEAD_NAME);
  assert(toolHead, 'Simulator should render a moving tool head');
  assert(Math.abs((toolHead as THREE.Object3D).position.x - 10) < 1e-6, 'Tool head should move to halfway X position');
  assert(Math.abs((toolHead as THREE.Object3D).position.y - 0) < 1e-6, 'Tool head scene Y should map from machine Z');
  assert(Math.abs((toolHead as THREE.Object3D).position.z - 0) < 1e-6, 'Tool head scene Z should map from machine Y');
  assert(renderCount > 0, 'Simulator should request viewer renders when it updates');

  simulator.dispose();
  assert(!scene.getObjectByName(CAM_TOOLPATH_SIMULATOR_GROUP_NAME), 'Simulator dispose should remove its overlay group');
}
