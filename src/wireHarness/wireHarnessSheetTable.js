import { normalizeTableData } from '../sheets/tableUtils.js';

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '—';
  return distance.toFixed(2).replace(/\.?0+$/, '');
}

function routeStatusLabel(result) {
  if (result?.feasible) return 'Routed';
  if (normalizeText(result?.error, '')) return 'Failed';
  return 'Not routed';
}

function normalizeRouteResultMap(routeResults) {
  if (routeResults instanceof Map) return routeResults;
  const map = new Map();
  if (Array.isArray(routeResults)) {
    for (const entry of routeResults) {
      const key = normalizeText(entry?.connectionId, '');
      if (!key) continue;
      map.set(key, entry);
    }
    return map;
  }
  if (routeResults && typeof routeResults === 'object') {
    for (const [key, value] of Object.entries(routeResults)) {
      const id = normalizeText(key, '');
      if (!id) continue;
      map.set(id, value);
    }
  }
  return map;
}

function createStyledCell(text, style = {}) {
  return {
    text: String(text == null ? '' : text),
    rowSpan: 1,
    colSpan: 1,
    mergedInto: null,
    style: { ...(style || {}) },
  };
}

const TABLE_COLUMNS = [
  { key: 'wire', label: 'Wire', minChars: 10, align: 'left' },
  { key: 'length', label: 'Length', minChars: 8, align: 'right' },
  { key: 'diameter', label: 'Dia', minChars: 6, align: 'right' },
  { key: 'from', label: 'From', minChars: 10, align: 'left' },
  { key: 'to', label: 'To', minChars: 10, align: 'left' },
  { key: 'status', label: 'Status', minChars: 10, align: 'left' },
];

function buildRowValues(connection, result) {
  return {
    wire: normalizeText(connection?.name, 'Wire'),
    length: result?.feasible ? formatDistance(result?.distance) : '—',
    diameter: String(Math.max(0.01, normalizeNumber(connection?.diameter, 1))),
    from: normalizeText(connection?.from, '—'),
    to: normalizeText(connection?.to, '—'),
    status: routeStatusLabel(result),
  };
}

export function buildWireHarnessSheetTableData(connections = [], routeResults = new Map()) {
  const routeMap = normalizeRouteResultMap(routeResults);
  const columnWidths = TABLE_COLUMNS.map((column) => Math.max(column.minChars, column.label.length + 2));

  const rows = [
    TABLE_COLUMNS.map((column, index) => {
      columnWidths[index] = Math.max(columnWidths[index], column.label.length + 2);
      return createStyledCell(column.label, {
        fontWeight: '700',
        textAlign: column.align,
        verticalAlign: 'middle',
      });
    }),
  ];

  for (const connection of Array.isArray(connections) ? connections : []) {
    const result = routeMap.get(normalizeText(connection?.id, '')) || null;
    const values = buildRowValues(connection, result);
    rows.push(TABLE_COLUMNS.map((column, index) => {
      const value = String(values[column.key] ?? '');
      columnWidths[index] = Math.max(columnWidths[index], value.length + 2);
      return createStyledCell(value, {
        textAlign: column.align,
        verticalAlign: 'middle',
      });
    }));
  }

  const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0) || 1;
  return normalizeTableData({
    rowFractions: Array.from({ length: rows.length }, () => 1 / rows.length),
    colFractions: columnWidths.map((value) => value / totalWidth),
    cells: rows,
  }, rows.length, TABLE_COLUMNS.length);
}

export function estimateWireHarnessSheetTableSizeIn(sheet, tableData) {
  const widthIn = Math.max(1, normalizeNumber(sheet?.widthIn, 11));
  const heightIn = Math.max(1, normalizeNumber(sheet?.heightIn, 8.5));
  const colFractions = Array.isArray(tableData?.colFractions) ? tableData.colFractions : [];
  const rowFractions = Array.isArray(tableData?.rowFractions) ? tableData.rowFractions : [];
  const columnCount = Math.max(1, colFractions.length || 6);
  const rowCount = Math.max(1, rowFractions.length || 2);

  let width = Math.max(4.8, columnCount * 1.15);
  let height = Math.max(1.1, rowCount * 0.34);

  const maxWidth = Math.max(4.8, widthIn * 0.86);
  const maxHeight = Math.max(1.1, heightIn * 0.62);
  if (width > maxWidth) {
    const scale = maxWidth / width;
    width = maxWidth;
    height *= scale;
  }
  if (height > maxHeight) {
    const scale = maxHeight / height;
    height = maxHeight;
    width *= scale;
  }

  return { width, height };
}

export function createWireHarnessSheetTableElement(sheet, connections = [], routeResults = new Map()) {
  const tableData = buildWireHarnessSheetTableData(connections, routeResults);
  const { width, height } = estimateWireHarnessSheetTableSizeIn(sheet, tableData);
  const sheetWidth = Math.max(1, normalizeNumber(sheet?.widthIn, 11));
  const sheetHeight = Math.max(1, normalizeNumber(sheet?.heightIn, 8.5));
  return {
    type: 'table',
    x: Math.max(0, (sheetWidth * 0.5) - (width * 0.5)),
    y: Math.max(0, (sheetHeight * 0.5) - (height * 0.5)),
    w: width,
    h: height,
    rotationDeg: 0,
    opacity: 1,
    fill: '#ffffff',
    stroke: '#0f172a',
    strokeWidth: 0.01,
    lineStyle: 'solid',
    tableData,
    fontSize: 0.18,
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontWeight: '400',
    fontStyle: 'normal',
    textDecoration: 'none',
    textAlign: 'left',
    verticalAlign: 'middle',
    color: '#111111',
  };
}

export function insertWireHarnessConnectionTable(sheetManager, sheetIdOrIndex, connections = [], routeResults = new Map()) {
  if (!sheetManager?.getSheetById || !sheetManager?.updateSheet) return null;
  const sheet = sheetManager.getSheetById(sheetIdOrIndex);
  if (!sheet) return null;
  const element = createWireHarnessSheetTableElement(sheet, connections, routeResults);
  const updatedSheet = sheetManager.updateSheet(sheet.id, (draft) => {
    const next = draft && typeof draft === 'object' ? draft : {};
    next.elements = Array.isArray(next.elements) ? next.elements : [];
    next.elements.push(element);
    return next;
  });
  const elements = Array.isArray(updatedSheet?.elements) ? updatedSheet.elements : [];
  return {
    sheet: updatedSheet || null,
    element: elements[elements.length - 1] || null,
  };
}
