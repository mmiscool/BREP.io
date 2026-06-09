import { buildTestSnippet } from '../UI/toolbarButtons/historyTestSnippetButton.js';

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
          __refPreviewSnapshots: { transient: true },
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
  assertExcludes(snippet, '__refPreviewSnapshots', 'reference preview snapshots');
  assertExcludes(snippet, 'miterSummary', 'derived fillet summary');
}
