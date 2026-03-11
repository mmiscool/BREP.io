import { Sheet2DManager } from '../sheets/Sheet2DManager.js';
import {
  buildWireHarnessSheetTableData,
  insertWireHarnessConnectionTable,
} from '../wireHarness/wireHarnessSheetTable.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_wire_harness_sheet_table_insert() {
  const manager = new Sheet2DManager(null);
  const sheet = manager.createSheet({
    name: 'Harness Sheet',
    sizeKey: 'A',
    orientation: 'landscape',
    elements: [],
  });

  const connections = [
    { id: 'WIRE1', name: 'Wire 1', from: 'PORT_A', to: 'PORT_B', diameter: 1.25 },
    { id: 'WIRE2', name: 'Wire 2', from: 'PORT_C', to: 'PORT_D', diameter: 0.8 },
  ];
  const routeResults = [
    { connectionId: 'WIRE1', feasible: true, distance: 123.456 },
    { connectionId: 'WIRE2', feasible: false, error: 'No route found.' },
  ];

  const tableData = buildWireHarnessSheetTableData(connections, routeResults);
  assert(tableData.cells[0][0].text === 'Wire', 'Expected first header cell to be Wire.');
  assert(tableData.cells[1][1].text === '123.46', 'Expected routed length to be formatted into the sheet table.');
  assert(tableData.cells[2][5].text === 'Failed', 'Expected failed routes to use a compact sheet status label.');

  const inserted = insertWireHarnessConnectionTable(manager, sheet.id, connections, routeResults);
  assert(!!inserted?.sheet, 'Expected sheet insertion to return an updated sheet.');
  assert(!!inserted?.element, 'Expected sheet insertion to return the inserted element.');
  assert(inserted.element.type === 'table', 'Expected inserted element to be a table.');
  assert(inserted.element.tableData?.cells?.[1]?.[0]?.text === 'Wire 1', 'Expected first wire name to appear in the inserted table.');
  assert(inserted.element.tableData?.cells?.[2]?.[5]?.text === 'Failed', 'Expected compact status text to persist on the inserted table element.');
}
