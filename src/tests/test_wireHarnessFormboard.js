import { Sheet2DManager } from '../sheets/Sheet2DManager.js';
import {
  buildWireHarnessFormboardDefinition,
  buildWireHarnessFormboardModel,
  collectWireHarnessFormboardSegmentBranchNodeIds,
  insertWireHarnessFormboard,
} from '../wireHarness/wireHarnessFormboard.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

function createPort(name, label, kind = 'termination', point = [0, 0, 0], direction = [1, 0, 0]) {
  return {
    name,
    userData: {
      isPortRoot: true,
      portData: {
        objectName: name,
        name: label,
        kind,
        point: point.slice(),
        direction: direction.slice(),
        extension: 1,
        displayLength: 1,
      },
    },
  };
}

function createSplineFeature(featureID, firstPortRef, firstSide, secondPortRef, secondSide) {
  return {
    type: 'SP',
    inputParams: {
      featureID,
      curveResolution: 4,
      bendRadius: 1,
    },
    persistentData: {
      spline: {
        points: [
          {
            id: 'p0',
            position: [0, 0, 0],
            attachment: { type: 'port', portRef: firstPortRef, side: firstSide },
          },
          {
            id: 'p1',
            position: [1, 0, 0],
            attachment: { type: 'port', portRef: secondPortRef, side: secondSide },
          },
        ],
      },
    },
  };
}

function createSimpleHarnessPartHistory() {
  const start = createPort('START', 'Start', 'termination', [-6, 0, 0], [1, 0, 0]);
  const split = createPort('SPLIT', 'Split', 'waypoint', [0, 0, 0], [1, 0, 0]);
  const branchA = createPort('BRANCHA', 'Branch A', 'termination', [5, 4, 0], [1, 0, 0]);
  const branchB = createPort('BRANCHB', 'Branch B', 'termination', [5, -4, 0], [1, 0, 0]);
  const objects = new Map([
    [start.name, start],
    [split.name, split],
    [branchA.name, branchA],
    [branchB.name, branchB],
  ]);

  return {
    scene: {
      traverse(visitor) {
        visitor(start);
        visitor(split);
        visitor(branchA);
        visitor(branchB);
      },
      getObjectByName(name) {
        return objects.get(String(name)) || null;
      },
    },
    getObjectByName(name) {
      return objects.get(String(name)) || null;
    },
    features: [
      createSplineFeature('SP1', 'START', 'A', 'SPLIT', 'A'),
      createSplineFeature('SP2', 'SPLIT', 'B', 'BRANCHA', 'A'),
      createSplineFeature('SP3', 'SPLIT', 'A', 'BRANCHB', 'A'),
    ],
  };
}

export function test_sheet_custom_size_persists() {
  const manager = new Sheet2DManager(null);
  const sheet = manager.createSheet({
    name: 'Large Formboard',
    sizeKey: 'CUSTOM',
    orientation: 'landscape',
    customWidthIn: 72,
    customHeightIn: 36,
    elements: [],
  });

  assert(sheet.sizeKey === 'CUSTOM', 'Expected custom sheet size key to persist.');
  assert(sheet.widthIn === 72, 'Expected custom sheet width to persist.');
  assert(sheet.heightIn === 36, 'Expected custom sheet height to persist.');

  const updated = manager.updateSheet(sheet.id, {
    sizeKey: 'CUSTOM',
    orientation: 'portrait',
    customWidthIn: 36,
    customHeightIn: 72,
  });

  assert(updated.sizeKey === 'CUSTOM', 'Expected custom size key to survive sheet updates.');
  assert(updated.widthIn === 36, 'Expected portrait custom sheet width to persist.');
  assert(updated.heightIn === 72, 'Expected portrait custom sheet height to persist.');
}

export function test_wire_harness_formboard_insert() {
  const partHistory = createSimpleHarnessPartHistory();
  const definition = buildWireHarnessFormboardDefinition(partHistory, {
    includeTitle: true,
  });

  assert(definition.ok === true, 'Expected harness formboard definition to succeed.');
  const lineElements = definition.elements.filter((element) => element?.type === 'line');
  const textElements = definition.elements.filter((element) => element?.type === 'text');
  assert(lineElements.length === 3, 'Expected three flattened line segments for the Y harness.');
  assert(lineElements.every((element) => element?.formboard?.exactGeometry === true), 'Expected generated line segments to be marked as exact formboard geometry.');
  assert(lineElements.every((element) => element?.formboard?.fromNodeId && element?.formboard?.toNodeId), 'Expected generated line segments to carry directed node metadata.');
  assert(textElements.some((element) => String(element?.text || '') === 'Start'), 'Expected endpoint labels to be included.');
  assert(textElements.some((element) => String(element?.text || '').includes('in')), 'Expected segment length labels to be included.');

  const manager = new Sheet2DManager(null);
  const sheet = manager.createSheet({
    name: 'Instruction Sheet',
    sizeKey: 'A',
    orientation: 'landscape',
    elements: [],
  });
  const inserted = insertWireHarnessFormboard(manager, sheet.id, partHistory, {
    includeTitle: true,
    resizeSheetToFit: true,
  });

  assert(inserted.ok === true, 'Expected formboard insertion to succeed.');
  assert(inserted.sheet?.sizeKey === 'CUSTOM', 'Expected insertion to promote the target sheet to custom sizing.');
  assert((inserted.insertedElements || []).filter((element) => element?.type === 'line').length === 3, 'Expected inserted formboard to contain three line elements.');
  assert(
    (inserted.sheet?.elements || []).filter((element) => element?.type === 'line').every((element) => element?.formboard?.exactGeometry === true),
    'Expected exact formboard metadata to persist through sheet normalization.',
  );
  assert(
    (inserted.sheet?.elements || []).every((element) => String(element?.groupId || '').startsWith('wire-harness-formboard:')),
    'Expected inserted sheet elements to belong to the generated formboard group.',
  );

  const model = buildWireHarnessFormboardModel(inserted.sheet?.elements || []);
  const splitSegment = (inserted.sheet?.elements || []).find((element) => (
    element?.type === 'line' && String(element?.formboard?.fromNodeId || '') === 'SPLIT'
  ));
  const branchNodeIds = collectWireHarnessFormboardSegmentBranchNodeIds(model, 'SPLIT', splitSegment?.id);
  assert(branchNodeIds.size === 1, 'Expected pivot branch resolution to isolate one downstream branch.');
  assert(branchNodeIds.has(String(splitSegment?.formboard?.toNodeId || '')), 'Expected branch resolution to include the segment endpoint opposite the pivot.');
}
