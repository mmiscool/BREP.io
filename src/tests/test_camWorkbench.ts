import * as THREE from 'three';
import { PartHistory } from '../PartHistory.js';
import { CamOperationEntity } from '../cam/CamOperationEntity.js';
import { CAM_GENERATED_DATA_VERSION, CamPlanManager } from '../cam/CamPlanManager.js';
import { CamWorkbenchManager } from '../cam/CamWorkbenchManager.js';
import {
  combineCamToolpathResults,
  generateThreeAxisToolpath,
  generateThreeAxisToolpathAsync,
} from '../cam/camToolpath.js';
import { gcodeDownloadFileName } from '../UI/cam/CamHistoryWidget.js';
import { getWorkbenchDefinition } from '../workbenches/index.js';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

function makeBoxMeshSolid(sizeX = 10, sizeY = 10, sizeZ = 10) {
  const vertProperties = Float32Array.from([
    0, 0, 0,
    sizeX, 0, 0,
    sizeX, sizeY, 0,
    0, sizeY, 0,
    0, 0, sizeZ,
    sizeX, 0, sizeZ,
    sizeX, sizeY, sizeZ,
    0, sizeY, sizeZ,
  ]);
  const triVerts = Uint32Array.from([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  const solid: any = new THREE.Object3D();
  solid.name = 'cam-test-cube';
  solid.type = 'SOLID';
  solid.visible = true;
  solid.getMesh = () => {
      return {
        vertProperties,
        triVerts,
        delete() {},
      };
  };
  return solid;
}

function makeViewerWithSolid(solid = makeBoxMeshSolid()) {
  const scene = new THREE.Scene();
  scene.add(solid as any);
  return {
    scene,
    partHistory: { scene },
    render() {},
  };
}

function defaultCamParams(patch: Record<string, any> = {}) {
  return {
    id: 'CAM1',
    name: 'PNG Raster',
    targetSolids: ['cam-test-cube'],
    toolDiameter: 2,
    toolLength: 20,
    stepover: 2,
    stepDown: 2,
    sampleSpacing: 1,
    safeHeight: 3,
    feedRate: 600,
    plungeRate: 120,
    spindleRPM: 9000,
    stockProfile: { mode: 'auto', margin: 1 },
    ...patch,
  };
}

function countLines(gcode: string, pattern: RegExp) {
  return (gcode.match(pattern) || []).length;
}

export async function test_cam_three_axis_raster_generates_gcode_from_cube_mesh() {
  const result = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams());
  assert(result.paths.length > 0, 'pngcam-backed CAM should generate raster toolpaths for a cube mesh');
  assert(result.summary.triangleCount === 12, 'CAM should extract all cube triangles');
  assert(result.summary.heightmapSampleCount && result.summary.heightmapSampleCount > 0, 'CAM summary should report heightmap sampling');
  assert(result.gcode.includes('G21'), 'G-code should set metric units');
  assert(result.gcode.includes('M3 S9000'), 'G-code should start the spindle with the requested RPM');
  assert(result.gcode.includes('G1 X'), 'G-code should emit cutting moves');
  assert(result.simulation.motionSegments.some((segment) => segment.kind === 'rapid'), 'Simulation should include rapid positioning moves');
  assert(result.simulation.sweptSegments.length > 0, 'Simulation should retain swept cutter segments for preview');
}

export async function test_cam_tool_shape_selection_persists_cutter_profile_metadata() {
  const shapes = [
    { toolShape: 'flat', expected: 'flat' },
    { toolShape: 'ball', expected: 'ball' },
    { toolShape: 'vbit', expected: 'vbit', includedAngleDeg: 60 },
  ];
  for (const shape of shapes) {
    const result = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams(shape));
    assert(result.paths.length > 0, `${shape.expected} cutter should generate toolpaths`);
    assert(result.cutterProfile.kind === shape.expected, `${shape.expected} cutter metadata should be persisted`);
    if (shape.expected === 'vbit') {
      assert(result.cutterProfile.includedAngleDeg === 60, 'V-bit included angle should be persisted');
    }
  }

  const toolShapeOptions = CamOperationEntity.inputParamsSchema.toolShape.options.map((option: any) => option.value);
  assert(toolShapeOptions.join('|') === 'flat|ball|vbit', 'CAM operation UI should expose all pngcam cutter shapes');
  assert(CamOperationEntity.uiFieldsTest({ params: { toolShape: 'flat' } }).exclude.includes('includedAngleDeg'), 'Flat cutters should hide V-bit angle');
  assert(!CamOperationEntity.uiFieldsTest({ params: { toolShape: 'vbit' } }).exclude.includes('includedAngleDeg'), 'V-bit cutters should show included angle');
}

export async function test_cam_invalid_stepdown_reports_feedback_without_paths() {
  const result = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams({ stepDown: 0 }));
  assert(result.paths.length === 0, 'Invalid step-down should not generate paths');
  assert(result.warnings.some((warning) => warning.includes('Step-down')), 'Invalid step-down should report feedback');
}

export async function test_cam_invalid_machine_profile_reports_feedback_without_paths() {
  const result = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams({
    machineProfile: { maxSpindleRPM: 0 },
  }));
  assert(result.paths.length === 0, 'Invalid machine profile should not generate paths');
  assert(result.warnings.some((warning) => warning.includes('spindle')), 'Invalid machine profile should report feedback');
}

export async function test_cam_serialized_mesh_rejects_non_finite_triangle_coordinates() {
  const result = generateThreeAxisToolpath(null, defaultCamParams({
    targetMeshes: [{ triangles: [0, 0, 0, Number.NaN, 0, 0, 0, 1, 0] }],
  }));
  assert(result.paths.length === 0, 'Non-finite serialized mesh triangles should be rejected');
  assert(result.summary.triangleCount === 0, 'Rejected serialized triangles should not count as CAM input');
}

export async function test_cam_plan_manager_async_progress_events_are_bounded() {
  const manager = new CamPlanManager(null);
  manager.setStockProfile({ mode: 'auto', margin: 1 });
  manager.createOperation('cam3axis', defaultCamParams({ targetSolids: ['cam-test-cube'] }));
  const events: any[] = [];
  const result = await manager.generateAllAsync(makeViewerWithSolid(), {
    useWorker: false,
    onProgress: (event) => events.push(event),
  });
  assert(result.paths.length > 0, 'Async CAM plan generation should produce paths');
  assert(events.length > 0, 'Async CAM plan generation should report progress');
  assert(events.every((event) => event.current >= 0 && event.current <= event.total), 'Progress events should stay bounded');
}

export async function test_cam_async_generation_can_be_aborted() {
  const controller = new AbortController();
  controller.abort('stop');
  let aborted = false;
  try {
    await generateThreeAxisToolpathAsync(makeViewerWithSolid(), {
      ...defaultCamParams(),
      signal: controller.signal,
    });
  } catch (error: any) {
    aborted = error?.name === 'AbortError';
  }
  assert(aborted, 'Async CAM generation should honor AbortSignal cancellation');
}

export function test_cam_gcode_export_filename_uses_machine_file_extension() {
  assert(gcodeDownloadFileName(null) === 'brep-cam.nc', 'Default CAM filename should use .nc');
  assert(gcodeDownloadFileName('fixture bracket.brep') === 'fixture_bracket.nc', 'BREP document names should become NC filenames');
  assert(gcodeDownloadFileName('part program.tap') === 'part_program.tap', 'Existing machine-code extensions should be preserved');
}

export async function test_cam_plan_manager_serializes_generated_operations() {
  const manager = new CamPlanManager(null);
  manager.setStockProfile({ mode: 'auto', margin: 1 });
  const operation = manager.createOperation('cam3axis', defaultCamParams({ targetSolids: ['cam-test-cube'] }));
  const result = manager.generateAll(makeViewerWithSolid());
  assert(result.paths.length > 0, 'CAM manager should generate toolpaths');
  assert(operation?.persistentData?.generatorVersion === CAM_GENERATED_DATA_VERSION, 'Generated CAM data should be versioned');

  const serialized = manager.toSerializable();
  assert(serialized.operations[0]?.persistentData?.toolpath?.paths?.length > 0, 'Default serialization should keep generated toolpaths');

  const compact = manager.toSerializable({ includeGeneratedToolpaths: false });
  assert(!Object.prototype.hasOwnProperty.call(compact.operations[0]?.persistentData || {}, 'toolpath'), 'Compact serialization should omit generated toolpaths');
  assert(compact.operations[0]?.persistentData?.gcode?.includes('G21'), 'Compact serialization should retain generated G-code');

  const lean = manager.toSerializable({ includeGeneratedData: false });
  assert(!Object.prototype.hasOwnProperty.call(lean.operations[0]?.persistentData || {}, 'gcode'), 'Lean serialization should omit generated G-code');
}

export async function test_cam_plan_manager_uses_global_stock_profile_for_generated_bounds() {
  const manager = new CamPlanManager(null);
  manager.setStockProfile({ mode: 'auto', margin: 2 });
  manager.createOperation('cam3axis', defaultCamParams({ targetSolids: ['cam-test-cube'] }));
  const plan = manager.generateAll(makeViewerWithSolid());
  assert(plan.bounds?.min[0] === -2 && plan.bounds?.max[0] === 12, 'Global stock margin should drive generated stock bounds');
}

export async function test_cam_plan_manager_invalidates_stale_generated_payload_versions() {
  const manager = new CamPlanManager(null);
  manager.loadSerializable({
    operations: [{
      type: 'cam3axis',
      inputParams: defaultCamParams(),
      persistentData: {
        generatorVersion: CAM_GENERATED_DATA_VERSION - 1,
        gcode: 'G21\n',
        toolpath: { paths: [{ id: 'stale' }] },
      },
    }],
  });
  const operation = manager.getOperations()[0];
  assert(!operation?.persistentData?.toolpath, 'Loading stale generated CAM data should drop stale toolpaths');
  assert(operation?.persistentData?.invalidatedReason === 'cam-generator-version', 'Stale generated CAM data should record invalidation reason');
}

export async function test_cam_plan_manager_invalidates_generated_operation_after_param_edit() {
  const manager = new CamPlanManager(null);
  manager.setStockProfile({ mode: 'auto', margin: 1 });
  const operation = manager.createOperation('cam3axis', defaultCamParams({ targetSolids: ['cam-test-cube'] }));
  manager.generateAll(makeViewerWithSolid());
  assert(operation?.persistentData?.toolpath, 'Generated CAM data should be cached before edit');
  operation?.mergeParams({ toolDiameter: 3 });
  manager.invalidateOperation(operation, 'operation-edit');
  assert(!operation?.persistentData?.toolpath, 'CAM invalidation should clear stale generated toolpaths');
}

export async function test_cam_machine_profile_controls_posted_gcode_and_serialization() {
  const machineProfile = {
    name: 'Tiny Mill',
    controller: 'grbl',
    maxSpindleRPM: 5000,
    defaultRapidRate: 1800,
    safeParkZ: 20,
    tokenSpacer: false,
    stripComments: true,
    header: 'G54',
    footer: 'G0 X0 Y0',
  };
  const plan = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams({
    machineProfile,
    spindleRPM: 12000,
  }));
  assert(plan.gcode.includes('G54'), 'Machine header should be posted');
  assert(plan.gcode.includes('G0Z20'), 'Machine safe park Z should be posted using compact tokens');
  assert(plan.gcode.includes('M3S5000'), 'Spindle RPM should clamp to machine maximum');
  assert(plan.gcode.includes('G0 X0 Y0'), 'Machine footer should be posted');
  assert(!plan.gcode.includes(';'), 'Comments should be stripped when the machine profile requests it');
}

export async function test_cam_combined_gcode_posts_multiple_operations_as_single_program() {
  const first = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams({ id: 'CAM1', name: 'First', spindleRPM: 5000 }));
  const second = generateThreeAxisToolpath(makeViewerWithSolid(), defaultCamParams({ id: 'CAM2', name: 'Second', spindleRPM: 8000, toolShape: 'ball' }));
  const combined = combineCamToolpathResults([first, second]);
  assert(combined.paths.length === first.paths.length + second.paths.length, 'Combined plan should retain all paths');
  assert(countLines(combined.gcode, /^M2\b/gm) === 1, 'Combined G-code should end the program once');
  assert(countLines(combined.gcode, /^M5\b/gm) === 1, 'Combined G-code should stop the spindle once');
  assert(combined.gcode.includes('Operation 1: First'), 'Combined G-code should label the first operation');
  assert(combined.gcode.includes('Operation 2: Second'), 'Combined G-code should label the second operation');
}

export async function test_cam_preview_renders_actual_toolpath_polyline() {
  const viewer = makeViewerWithSolid();
  const plan = generateThreeAxisToolpath(viewer, defaultCamParams());
  const runtime = new CamWorkbenchManager(viewer);
  runtime.setActive(true);
  const group = runtime.preview(plan);
  assert(group, 'CAM preview should create a scene group');
  assert(Boolean(group?.getObjectByName?.('CAM Toolpath Polyline')), 'CAM preview should render the actual toolpath polyline');
  assert(Boolean(group?.getObjectByName?.('CAM Toolhead')), 'CAM preview should render the selected tool');
}

export async function test_cam_workbench_registers_and_persists_part_history_state() {
  const workbench = getWorkbenchDefinition('cam');
  assert(workbench, 'CAM workbench should be registered');
  const camPanels = workbench?.sidePanels || {};
  assert(Object.keys(camPanels).filter((key) => key.startsWith('cam')).join('|') === 'camHistory|camMachineConfiguration|camGcode', 'CAM workbench should list CAM History before the other CAM panels');

  const history = new PartHistory();
  history.camPlanManager.setStockProfile({ mode: 'auto', margin: 1 });
  history.camPlanManager.createOperation('cam3axis', defaultCamParams());
  const raw = await history.toJSON();
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assert(parsed.cam?.operations?.length === 1, 'Part history JSON should persist CAM operations');
}
