import { buildTestSnippet, loadSerializableHistory } from '../UI/toolbarButtons/historyTestSnippetButton.js';

function assertIncludes(source, text, label) {
  if (!String(source || '').includes(text)) {
    throw new Error(`[history_test_snippet_persistent_data] Missing ${label || text}`);
  }
}

function assertExcludes(source, text, label) {
  if (String(source || '').includes(text)) {
    throw new Error(`[history_test_snippet_persistent_data] Unexpected ${label || text}`);
  }
}

function assertParsesAsJavaScript(source, label) {
  try {
    // Parse only; do not execute the generated snippet.
    new Function('env', String(source || ''));
  } catch (error: any) {
    throw new Error(`[history_test_snippet_persistent_data] ${label || 'Snippet'} should parse as JavaScript: ${error?.message || error}`);
  }
}

export function test_history_test_snippet_persistent_data_allowlist() {
  const snippet = buildTestSnippet({
    functionName: 'test_history_test_snippet_persistent_data_allowlist_generated',
    expressions: '',
    configurator: null,
    features: [
      {
        type: 'S',
        inputParams: { id: 'S1', __open: true },
        persistentData: {
          sketch: {
            points: [{ id: 0, x: 0, y: 0, fixed: true }],
            geometries: [],
            constraints: [],
          },
          lastProfileDiagnostics: { transient: true },
          referenceSnapshots: { transient: true },
        },
      },
      {
        type: 'SP',
        inputParams: {
          id: 'SP1',
          curveResolution: 'resolution',
          splinePoints: '984:2383457056',
        },
        persistentData: {
          spline: {
            points: [
              {
                id: 'p0',
                position: [0, 0, 0],
                rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                forwardDistance: 1,
                backwardDistance: 1,
                flipDirection: false,
              },
              {
                id: 'p1',
                position: [5, 1, 0],
                rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                forwardDistance: 2,
                backwardDistance: 1,
                flipDirection: false,
              },
            ],
          },
        },
      },
      {
        type: 'NURBS',
        inputParams: { id: 'NURBS1' },
        persistentData: {
          cage: { points: [{ id: 'cp:0:0:0', position: [0, 0, 0] }] },
          editorOptions: { showEdges: false },
        },
      },
      {
        type: 'POLY',
        inputParams: { id: 'POLY1' },
        persistentData: {
          meshData: {
            vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            triangles: [[0, 1, 2]],
            triangleFaceTokens: ['SURFACE'],
          },
          editorOptions: { meshColor: '#ffffff' },
        },
      },
      {
        type: 'TEXT',
        inputParams: { id: 'TEXT1', text: 'A', font: 'Removed Font', fontFile: '' },
        persistentData: {
          fontFile: 'data:font/ttf;base64,AAAA',
          fontFileKey: 'font:Removed Font',
        },
      },
      {
        type: 'IMPORT3D',
        inputParams: { id: 'IMPORT3D1', fileToImport: '' },
        persistentData: {
          importCache: {
            version: 1,
            signature: 'cached-input',
            snapshots: [{ name: 'ImportedSolid' }],
          },
        },
      },
      {
        type: 'ACOMP',
        inputParams: { id: 'ACOMP1', componentName: 'Fixture' },
        persistentData: {
          componentData: {
            name: 'Fixture',
            data3mf: 'AAAA',
          },
        },
      },
      {
        type: 'F',
        inputParams: { id: 'F1' },
        persistentData: {
          miterSummary: { derived: true },
        },
      },
    ],
  });

  assertIncludes(snippet, 'feature2.persistentData =', 'Spline persistent data assignment');
  assertIncludes(snippet, '"spline"', 'Spline data key');
  assertIncludes(snippet, '"position": [', 'Spline point positions');
  assertIncludes(snippet, '"p1"', 'Spline authored point id');

  assertIncludes(snippet, '"sketch"', 'Sketch data key');
  assertIncludes(snippet, '"cage"', 'NURBS cage data key');
  assertIncludes(snippet, '"meshData"', 'Polygon mesh data key');
  assertIncludes(snippet, '"fontFile"', 'Text persisted font data key');
  assertIncludes(snippet, '"importCache"', 'Import 3D cache data key');
  assertIncludes(snippet, '"componentData"', 'Assembly component payload key');
  assertIncludes(snippet, 'await partHistory.runHistory();', 'awaited history replay');

  assertExcludes(snippet, '__open', 'UI-only input params');
  assertExcludes(snippet, 'lastProfileDiagnostics', 'Sketch transient diagnostics');
  assertExcludes(snippet, 'referenceSnapshots', 'reference snapshots');
  assertExcludes(snippet, 'miterSummary', 'derived fillet summary');
}

export async function test_history_test_snippet_toolbar_snapshot_compacts_cam_toolpaths() {
  let receivedOptions: any = null;
  const snapshot = await loadSerializableHistory({
    toJSON(options: any = {}) {
      receivedOptions = options;
      return JSON.stringify({
        features: [],
        expressions: '',
        configurator: null,
        cam: {
          machineProfile: {
            name: 'Toolbar CNC Mill',
          },
          stockProfile: {
            mode: 'fixed',
            sizeX: 40,
            sizeY: 30,
            sizeZ: 12,
          },
          operations: [
            {
              type: 'cam3axis',
              __open: true,
              inputParams: {
                id: 'CAM_TOOLBAR',
                name: 'Toolbar CAM',
                targetSolids: ['P.CU1'],
                toolShape: 'flat',
                stepover: 1.5,
                __open: true,
              },
              persistentData: {
                generatorVersion: 2,
                summary: { pathCount: 2 },
                gcode: 'G21\nG0 Z5\n',
                toolpath: {
                  paths: [{ id: 'heavy-path', points: [[0, 0, 0], [1, 0, 0]] }],
                  simulation: {
                    sweptHulls: [
                      {
                        positions: Array.from({ length: 64 }, (_, index) => index),
                        indices: Array.from({ length: 64 }, (_, index) => index),
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      });
    },
  });

  const snippet = buildTestSnippet({
    functionName: 'test_history_test_snippet_toolbar_cam_generated',
    features: snapshot.features,
    expressions: snapshot.expressions,
    configurator: snapshot.configurator,
    cam: snapshot.cam,
  });

  if (receivedOptions?.includeCamGeneratedToolpaths !== false) {
    throw new Error('[history_test_snippet_persistent_data] Toolbar snapshot should request compact CAM serialization.');
  }

  assertIncludes(snippet, '// CAM operation count: 1', 'CAM operation count comment');
  assertIncludes(snippet, '"Toolbar CNC Mill"', 'toolbar CAM machine profile');
  assertIncludes(snippet, '"stockProfile"', 'toolbar CAM stock profile');
  assertIncludes(snippet, '"CAM_TOOLBAR"', 'toolbar CAM operation id');
  assertExcludes(snippet, '"gcode"', 'generated CAM G-code');
  assertExcludes(snippet, '"summary"', 'generated CAM summary');
  assertExcludes(snippet, '"generatorVersion"', 'generated CAM version metadata');
  assertExcludes(snippet, '"generatedAt"', 'generated CAM timestamp');
  assertExcludes(snippet, '"warnings"', 'generated CAM warnings');
  assertExcludes(snippet, '"toolpath"', 'heavy generated CAM toolpath payload');
  assertExcludes(snippet, 'sweptHulls', 'heavy generated CAM swept hull data');
  assertExcludes(snippet, 'heavy-path', 'heavy generated CAM path data');
  assertExcludes(snippet, '__open', 'CAM UI-only open state');
}

export function test_history_test_snippet_includes_cam_operations() {
  const snippet = buildTestSnippet({
    functionName: 'test_history_test_snippet_cam_generated',
    expressions: '',
    configurator: null,
    features: [
      {
        type: 'P.CU',
        inputParams: { id: 'P_CU1', sizeX: 10, sizeY: 10, sizeZ: 10 },
        persistentData: {},
      },
    ],
    cam: {
      machineProfile: {
        name: 'Snippet CNC Mill',
        controller: 'linuxcnc',
        maxSpindleRPM: 9000,
      },
      stockProfile: {
        mode: 'fixed',
        sizeX: 20,
        sizeY: 24,
        sizeZ: 8,
      },
      operations: [
        {
          type: 'cam3axis',
          __open: true,
          inputParams: {
            id: 'CAM_SNIP',
            name: 'Snippet CAM',
            targetSolids: ['P_CU1'],
            toolShape: 'vbit',
            includedAngleDeg: 60,
            toolDiameter: 3.175,
            __open: true,
          },
          persistentData: {
            summary: { pathCount: 4 },
            gcode: 'G21\n',
            toolpath: { paths: [{ id: 'omitted-toolpath' }] },
          },
        },
      ],
    },
  });

  assertIncludes(snippet, '// CAM operation count: 1', 'CAM operation count comment');
  assertIncludes(snippet, 'const camState =', 'CAM state literal');
  assertIncludes(snippet, 'partHistory.camPlanManager.loadSerializable(camState);', 'CAM restore call');
  assertIncludes(snippet, '"Snippet CNC Mill"', 'CAM machine profile');
  assertIncludes(snippet, '"CAM_SNIP"', 'CAM operation id');
  assertIncludes(snippet, '"stockProfile"', 'CAM stock profile');
  assertIncludes(snippet, '"targetSolids": [', 'CAM target solid references');
  assertIncludes(snippet, '"vbit"', 'CAM cutter shape');
  assertIncludes(snippet, '"includedAngleDeg": 60', 'CAM V-bit angle');
  assertExcludes(snippet, '"gcode"', 'generated CAM G-code');
  assertExcludes(snippet, '"summary"', 'generated CAM summary');
  assertExcludes(snippet, '"toolpath"', 'generated CAM toolpath payload');
  assertExcludes(snippet, 'omitted-toolpath', 'generated CAM path data');
  assertExcludes(snippet, '__open', 'CAM UI-only open state');
  assertParsesAsJavaScript(snippet, 'CAM operation snippet');
}

export function test_history_test_snippet_omits_empty_cam_state() {
  const snippet = buildTestSnippet({
    functionName: 'test_history_test_snippet_empty_cam_generated',
    expressions: '',
    configurator: null,
    features: [],
    cam: {
      machineProfile: {
        name: 'Generic 3 Axis Mill',
        controller: 'grbl',
        units: 'mm',
        maxSpindleRPM: 24000,
        defaultRapidRate: 2500,
        safeParkZ: 15,
        tokenSpacer: true,
        stripComments: false,
        header: '',
        footer: '',
      },
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
      operations: [],
    },
  });

  assertExcludes(snippet, 'camState', 'empty CAM state literal');
  assertExcludes(snippet, 'Generic 3 Axis Mill', 'default machine profile without operations');
}

export function test_history_test_snippet_includes_global_cam_state_without_operations() {
  const snippet = buildTestSnippet({
    functionName: 'test_history_test_snippet_global_cam_generated',
    expressions: '',
    configurator: null,
    features: [],
    cam: {
      machineProfile: {
        name: 'Setup CNC Mill',
        controller: 'linuxcnc',
        maxSpindleRPM: 9000,
      },
      stockProfile: {
        mode: 'fixed',
        sizeX: 40,
        sizeY: 30,
        sizeZ: 12,
      },
      operations: [],
    },
  });

  assertIncludes(snippet, 'const camState =', 'global CAM state literal');
  assertIncludes(snippet, 'partHistory.camPlanManager.loadSerializable(camState);', 'global CAM restore call');
  assertIncludes(snippet, '"Setup CNC Mill"', 'global machine profile without operations');
  assertIncludes(snippet, '"stockProfile"', 'global stock profile without operations');
  assertIncludes(snippet, '"sizeX": 40', 'global stock size without operations');
  assertExcludes(snippet, '// CAM operation count:', 'CAM operation count for global-only state');
}
