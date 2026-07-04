import { PartHistory } from '../PartHistory.js';
import { CamPlanManager } from '../cam/CamPlanManager.js';
import { CAM_TOOLPATH_SIMULATOR_GROUP_NAME, CAM_TOOLPATH_TOOL_HEAD_NAME, CamToolpathSimulator } from '../cam/CamToolpathSimulator.js';
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
    topOuter.push(pushVertex(outerRadius * cos, height, outerRadius * sin));
    topInner.push(pushVertex(innerRadius * cos, height, innerRadius * sin));
    bottomOuter.push(pushVertex(outerRadius * cos, 0, outerRadius * sin));
    bottomInner.push(pushVertex(innerRadius * cos, 0, innerRadius * sin));
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
    name: 'cam-test-ring',
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

export async function test_cam_shadow_cutter_is_the_only_registered_operation() {
  const manager = new CamPlanManager(null);
  const available = Array.from(manager.registry.entityClasses.values());
  assert(available.length === 1, 'Only one CAM operation should be registered');
  assert(available[0] === ShadowCutterEntity, 'Shadow Cutter should be the registered CAM operation');
  assert(ShadowCutterEntity.longName === 'Shadow Cutter', 'Shadow Cutter should be the add-menu label');
  assert(!Object.prototype.hasOwnProperty.call(ShadowCutterEntity.inputParamsSchema, 'toolShape'), 'Old generic cutter shape field should be removed');
  assert(!Object.prototype.hasOwnProperty.call(ShadowCutterEntity.inputParamsSchema, 'stepover'), 'Old raster stepover field should be removed');
}

function cutPoints2d(path: any, safeZ: number) {
  return path.points
    .filter((point: any) => Math.abs(point.position[2] - safeZ) > 1e-4)
    .map((point: any) => [point.position[0], point.position[1]] as [number, number]);
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
  const camPanels = workbench.sidePanels || {};
  assert(Object.keys(camPanels).filter((key) => key.startsWith('cam')).join('|') === 'camHistory|camMachineConfiguration|camGcode', 'CAM workbench should list CAM History before the other CAM panels');

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
