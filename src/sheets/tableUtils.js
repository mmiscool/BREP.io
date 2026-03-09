function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeText(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function sanitizeColor(value, fallback = null) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/^#[\da-fA-F]{3,8}$/.test(text)) return text;
  if (/^[a-zA-Z]+$/.test(text)) return text;
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(text)) return text;
  return fallback;
}

function clampPositiveInt(value, fallback = 1) {
  return Math.max(1, Math.round(toFiniteNumber(value, fallback)));
}

function clampIndex(value, fallback = 0) {
  return Math.max(0, Math.round(toFiniteNumber(value, fallback)));
}

function normalizeTextAlign(value, fallback = null) {
  if (value == null) return fallback;
  const key = String(value).trim().toLowerCase();
  if (key === "middle" || key === "center") return "center";
  if (key === "end" || key === "right") return "right";
  return key === "left" ? "left" : fallback;
}

function normalizeVerticalAlign(value, fallback = null) {
  if (value == null) return fallback;
  const key = String(value).trim().toLowerCase();
  if (key === "center") return "middle";
  if (key === "bottom") return "bottom";
  return key === "middle" || key === "top" ? key : fallback;
}

function normalizeFontWeight(value, fallback = null) {
  if (value == null) return fallback;
  const text = String(value).trim();
  if (text === "bold") return "700";
  if (text === "normal") return "400";
  return /^\d{3}$/.test(text) ? text : fallback;
}

function normalizeFontStyle(value, fallback = null) {
  if (value == null) return fallback;
  return String(value).trim().toLowerCase() === "italic" ? "italic" : "normal";
}

function normalizeTextDecoration(value, fallback = null) {
  if (value == null) return fallback;
  return String(value).trim().toLowerCase() === "underline" ? "underline" : "none";
}

export const TABLE_CELL_STYLE_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "textAlign",
  "verticalAlign",
  "color",
];

export function normalizeTableCellStyle(rawStyle) {
  if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) return {};
  const style = {};

  const fontFamily = sanitizeText(rawStyle.fontFamily, "").trim();
  if (fontFamily) style.fontFamily = fontFamily;

  const fontSize = toFiniteNumber(rawStyle.fontSize, Number.NaN);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    style.fontSize = clamp(fontSize, 0.08, 3);
  }

  const fontWeight = normalizeFontWeight(rawStyle.fontWeight ?? (rawStyle.bold ? "700" : null));
  if (fontWeight) style.fontWeight = fontWeight;

  const fontStyle = normalizeFontStyle(rawStyle.fontStyle ?? (rawStyle.italic ? "italic" : null));
  if (fontStyle) style.fontStyle = fontStyle;

  const textDecoration = normalizeTextDecoration(rawStyle.textDecoration);
  if (textDecoration) style.textDecoration = textDecoration;

  const textAlign = normalizeTextAlign(rawStyle.textAlign ?? rawStyle.textAnchor);
  if (textAlign) style.textAlign = textAlign;

  const verticalAlign = normalizeVerticalAlign(rawStyle.verticalAlign ?? rawStyle.verticalAnchor);
  if (verticalAlign) style.verticalAlign = verticalAlign;

  const color = sanitizeColor(rawStyle.color ?? rawStyle.textColor, null);
  if (color) style.color = color;

  return style;
}

export function createTableCell(text = "") {
  return {
    text: sanitizeText(text, ""),
    rowSpan: 1,
    colSpan: 1,
    mergedInto: null,
    style: {},
  };
}

export function normalizeTableFractions(values, count) {
  const size = Math.max(1, clampPositiveInt(count, 1));
  const source = Array.isArray(values) ? values.slice(0, size) : [];
  const normalized = [];
  for (let index = 0; index < size; index += 1) {
    normalized.push(Math.max(0.0001, toFiniteNumber(source[index], 1)));
  }
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return Array.from({ length: size }, () => 1 / size);
  }
  return normalized.map((value) => value / total);
}

export function getTableRowCount(tableData, fallback = 0) {
  if (Array.isArray(tableData?.cells) && tableData.cells.length > 0) return tableData.cells.length;
  if (Array.isArray(tableData?.rowFractions) && tableData.rowFractions.length > 0) return tableData.rowFractions.length;
  return Math.max(0, clampPositiveInt(fallback, 0));
}

export function getTableColumnCount(tableData, fallback = 0) {
  const rows = Array.isArray(tableData?.cells) ? tableData.cells : [];
  let maxCols = 0;
  for (const row of rows) {
    if (Array.isArray(row)) maxCols = Math.max(maxCols, row.length);
  }
  if (maxCols > 0) return maxCols;
  if (Array.isArray(tableData?.colFractions) && tableData.colFractions.length > 0) return tableData.colFractions.length;
  return Math.max(0, clampPositiveInt(fallback, 0));
}

export function createTableData(rowCount = 3, colCount = 3) {
  const rows = Math.max(1, clampPositiveInt(rowCount, 3));
  const cols = Math.max(1, clampPositiveInt(colCount, 3));
  return {
    rowFractions: normalizeTableFractions(null, rows),
    colFractions: normalizeTableFractions(null, cols),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => createTableCell())),
  };
}

export function normalizeTableData(rawData, fallbackRows = 3, fallbackCols = 3) {
  const rowCount = Math.max(1, getTableRowCount(rawData, fallbackRows));
  const colCount = Math.max(1, getTableColumnCount(rawData, fallbackCols));
  const result = createTableData(rowCount, colCount);
  result.rowFractions = normalizeTableFractions(rawData?.rowFractions, rowCount);
  result.colFractions = normalizeTableFractions(rawData?.colFractions, colCount);

  const rawRows = Array.isArray(rawData?.cells) ? rawData.cells : [];
  const spans = [];

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      const rawCell = Array.isArray(rawRows[row]) ? rawRows[row][col] : null;
      const target = result.cells[row][col];
      if (rawCell && typeof rawCell === "object" && !Array.isArray(rawCell)) {
        target.text = sanitizeText(rawCell.text, sanitizeText(rawCell.value, ""));
        target.style = normalizeTableCellStyle(rawCell.style && typeof rawCell.style === "object" ? rawCell.style : rawCell);
        spans.push({
          row,
          col,
          rowSpan: clampPositiveInt(rawCell.rowSpan, 1),
          colSpan: clampPositiveInt(rawCell.colSpan, 1),
        });
      } else {
        target.text = sanitizeText(rawCell, "");
        target.style = {};
      }
      target.rowSpan = 1;
      target.colSpan = 1;
      target.mergedInto = null;
    }
  }

  const covered = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => false));
  for (const span of spans) {
    const maxRowSpan = clamp(span.rowSpan, 1, rowCount - span.row);
    const maxColSpan = clamp(span.colSpan, 1, colCount - span.col);
    if (maxRowSpan === 1 && maxColSpan === 1) continue;

    let overlaps = false;
    for (let row = span.row; row < span.row + maxRowSpan && !overlaps; row += 1) {
      for (let col = span.col; col < span.col + maxColSpan; col += 1) {
        if (row === span.row && col === span.col) continue;
        if (covered[row][col]) {
          overlaps = true;
          break;
        }
      }
    }
    if (overlaps) continue;

    const anchor = result.cells[span.row][span.col];
    anchor.rowSpan = maxRowSpan;
    anchor.colSpan = maxColSpan;
    for (let row = span.row; row < span.row + maxRowSpan; row += 1) {
      for (let col = span.col; col < span.col + maxColSpan; col += 1) {
        if (row === span.row && col === span.col) continue;
        covered[row][col] = true;
        result.cells[row][col] = {
          text: "",
          rowSpan: 1,
          colSpan: 1,
          mergedInto: { row: span.row, col: span.col },
          style: {},
        };
      }
    }
  }

  return result;
}

export function getTableCell(tableData, row, col) {
  return Array.isArray(tableData?.cells?.[row]) ? tableData.cells[row][col] || null : null;
}

export function resolveTableCellAnchor(tableData, row, col) {
  const cell = getTableCell(tableData, row, col);
  if (!cell) return null;
  const mergedInto = cell?.mergedInto;
  if (mergedInto && Number.isInteger(mergedInto.row) && Number.isInteger(mergedInto.col)) {
    const anchorCell = getTableCell(tableData, mergedInto.row, mergedInto.col);
    if (anchorCell) {
      return { row: mergedInto.row, col: mergedInto.col, cell: anchorCell };
    }
  }
  return { row, col, cell };
}

export function isTableCellCovered(tableData, row, col) {
  const anchor = resolveTableCellAnchor(tableData, row, col);
  return !!anchor && (anchor.row !== row || anchor.col !== col);
}

export function getTableSelectionRect(selection) {
  if (!selection) return null;
  const rows = [selection.anchorRow, selection.focusRow].map((value) => clampIndex(value, 0));
  const cols = [selection.anchorCol, selection.focusCol].map((value) => clampIndex(value, 0));
  return {
    minRow: Math.min(...rows),
    maxRow: Math.max(...rows),
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
  };
}

export function cloneTableData(tableData, fallbackRows = 3, fallbackCols = 3) {
  const normalized = normalizeTableData(tableData, fallbackRows, fallbackCols);
  return {
    rowFractions: normalized.rowFractions.slice(),
    colFractions: normalized.colFractions.slice(),
    cells: normalized.cells.map((row) => row.map((cell) => ({
      text: sanitizeText(cell?.text, ""),
      rowSpan: clampPositiveInt(cell?.rowSpan, 1),
      colSpan: clampPositiveInt(cell?.colSpan, 1),
      mergedInto: (cell?.mergedInto
        && Number.isInteger(cell.mergedInto.row)
        && Number.isInteger(cell.mergedInto.col))
        ? { row: cell.mergedInto.row, col: cell.mergedInto.col }
        : null,
      style: normalizeTableCellStyle(cell?.style),
    }))),
  };
}

export function forEachTableAnchor(tableData, callback) {
  if (typeof callback !== "function") return;
  const normalized = normalizeTableData(tableData);
  const rowCount = getTableRowCount(normalized, 0);
  const colCount = getTableColumnCount(normalized, 0);
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      const cell = getTableCell(normalized, row, col);
      if (!cell || cell?.mergedInto) continue;
      callback(cell, row, col, normalized);
    }
  }
}

export function setTableCellText(tableData, row, col, text) {
  const normalized = cloneTableData(tableData);
  const anchor = resolveTableCellAnchor(normalized, clampIndex(row, 0), clampIndex(col, 0));
  if (!anchor?.cell) return normalized;
  anchor.cell.text = sanitizeText(text, "");
  return normalized;
}

export function canMergeTableCells(tableData, selectionRect) {
  const normalized = normalizeTableData(tableData);
  const rect = selectionRect || null;
  if (!rect) return false;
  const rowCount = getTableRowCount(normalized, 0);
  const colCount = getTableColumnCount(normalized, 0);
  const minRow = clamp(rect.minRow, 0, Math.max(0, rowCount - 1));
  const maxRow = clamp(rect.maxRow, minRow, Math.max(0, rowCount - 1));
  const minCol = clamp(rect.minCol, 0, Math.max(0, colCount - 1));
  const maxCol = clamp(rect.maxCol, minCol, Math.max(0, colCount - 1));
  if (minRow === maxRow && minCol === maxCol) return false;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const cell = getTableCell(normalized, row, col);
      if (!cell || cell?.mergedInto) return false;
      if (clampPositiveInt(cell.rowSpan, 1) !== 1 || clampPositiveInt(cell.colSpan, 1) !== 1) return false;
    }
  }
  return true;
}

export function mergeTableCells(tableData, selectionRect) {
  const normalized = cloneTableData(tableData);
  const rect = selectionRect || null;
  if (!rect || !canMergeTableCells(normalized, rect)) return normalized;

  const minRow = clampIndex(rect.minRow, 0);
  const maxRow = Math.max(minRow, clampIndex(rect.maxRow, minRow));
  const minCol = clampIndex(rect.minCol, 0);
  const maxCol = Math.max(minCol, clampIndex(rect.maxCol, minCol));
  const anchor = getTableCell(normalized, minRow, minCol);
  if (!anchor) return normalized;

  anchor.rowSpan = (maxRow - minRow) + 1;
  anchor.colSpan = (maxCol - minCol) + 1;
  anchor.mergedInto = null;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      if (row === minRow && col === minCol) continue;
      normalized.cells[row][col] = {
        text: "",
        rowSpan: 1,
        colSpan: 1,
        mergedInto: { row: minRow, col: minCol },
        style: {},
      };
    }
  }
  return normalized;
}

export function unmergeTableCell(tableData, row, col) {
  const normalized = cloneTableData(tableData);
  const anchor = resolveTableCellAnchor(normalized, clampIndex(row, 0), clampIndex(col, 0));
  if (!anchor?.cell) return normalized;
  const rowSpan = clampPositiveInt(anchor.cell.rowSpan, 1);
  const colSpan = clampPositiveInt(anchor.cell.colSpan, 1);
  if (rowSpan === 1 && colSpan === 1) return normalized;

  anchor.cell.rowSpan = 1;
  anchor.cell.colSpan = 1;
  anchor.cell.mergedInto = null;
  for (let targetRow = anchor.row; targetRow < anchor.row + rowSpan; targetRow += 1) {
    for (let targetCol = anchor.col; targetCol < anchor.col + colSpan; targetCol += 1) {
      if (targetRow === anchor.row && targetCol === anchor.col) continue;
      normalized.cells[targetRow][targetCol] = createTableCell("");
    }
  }
  return normalized;
}

function splitFractionList(fractions, insertIndex) {
  const source = Array.isArray(fractions) ? fractions.slice() : [1];
  const size = source.length;
  if (size <= 0) return [1];
  const clampedIndex = clamp(insertIndex, 0, size);
  const baseIndex = clamp(clampedIndex === size ? size - 1 : clampedIndex, 0, size - 1);
  const baseValue = Math.max(0.0001, toFiniteNumber(source[baseIndex], 1 / size));
  const nextValue = Math.max(0.0001, baseValue * 0.5);
  source[baseIndex] = Math.max(0.0001, baseValue - nextValue);
  source.splice(clampedIndex, 0, nextValue);
  return normalizeTableFractions(source, source.length);
}

function buildInsertedTable(tableData, {
  rowInsertIndex = null,
  colInsertIndex = null,
} = {}) {
  const source = normalizeTableData(tableData);
  const rowCount = getTableRowCount(source, 1);
  const colCount = getTableColumnCount(source, 1);
  const nextRowCount = rowInsertIndex == null ? rowCount : (rowCount + 1);
  const nextColCount = colInsertIndex == null ? colCount : (colCount + 1);
  const normalizedRowInsert = rowInsertIndex == null ? -1 : clamp(rowInsertIndex, 0, rowCount);
  const normalizedColInsert = colInsertIndex == null ? -1 : clamp(colInsertIndex, 0, colCount);

  const result = createTableData(nextRowCount, nextColCount);
  result.rowFractions = rowInsertIndex == null
    ? normalizeTableFractions(source.rowFractions, rowCount)
    : splitFractionList(source.rowFractions, normalizedRowInsert);
  result.colFractions = colInsertIndex == null
    ? normalizeTableFractions(source.colFractions, colCount)
    : splitFractionList(source.colFractions, normalizedColInsert);

  forEachTableAnchor(source, (cell, row, col) => {
    const targetRow = (normalizedRowInsert >= 0 && row >= normalizedRowInsert) ? row + 1 : row;
    const targetCol = (normalizedColInsert >= 0 && col >= normalizedColInsert) ? col + 1 : col;
    const rowSpan = (normalizedRowInsert >= 0 && row < normalizedRowInsert && row + clampPositiveInt(cell.rowSpan, 1) > normalizedRowInsert)
      ? clampPositiveInt(cell.rowSpan, 1) + 1
      : clampPositiveInt(cell.rowSpan, 1);
    const colSpan = (normalizedColInsert >= 0 && col < normalizedColInsert && col + clampPositiveInt(cell.colSpan, 1) > normalizedColInsert)
      ? clampPositiveInt(cell.colSpan, 1) + 1
      : clampPositiveInt(cell.colSpan, 1);

    result.cells[targetRow][targetCol] = {
      text: sanitizeText(cell.text, ""),
      rowSpan,
      colSpan,
      mergedInto: null,
      style: normalizeTableCellStyle(cell.style),
    };
    for (let coverRow = targetRow; coverRow < targetRow + rowSpan; coverRow += 1) {
      for (let coverCol = targetCol; coverCol < targetCol + colSpan; coverCol += 1) {
        if (coverRow === targetRow && coverCol === targetCol) continue;
        result.cells[coverRow][coverCol] = {
          text: "",
          rowSpan: 1,
          colSpan: 1,
          mergedInto: { row: targetRow, col: targetCol },
          style: {},
        };
      }
    }
  });

  return result;
}

export function insertTableRow(tableData, rowIndex) {
  return buildInsertedTable(tableData, { rowInsertIndex: clampIndex(rowIndex, 0) });
}

export function insertTableColumn(tableData, colIndex) {
  return buildInsertedTable(tableData, { colInsertIndex: clampIndex(colIndex, 0) });
}

export function ensureTableSize(tableData, minRows = 1, minCols = 1) {
  let result = cloneTableData(tableData, minRows, minCols);
  const targetRows = Math.max(1, clampPositiveInt(minRows, 1));
  const targetCols = Math.max(1, clampPositiveInt(minCols, 1));
  while (getTableRowCount(result, 0) < targetRows) {
    result = insertTableRow(result, getTableRowCount(result, 0));
  }
  while (getTableColumnCount(result, 0) < targetCols) {
    result = insertTableColumn(result, getTableColumnCount(result, 0));
  }
  return result;
}
