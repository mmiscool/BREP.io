const PX_PER_INCH = 96;

export const SHEET_STANDARD_SIZES = Object.freeze({
  A: Object.freeze({ key: "A", label: "A (8.5 x 11 in)", widthIn: 8.5, heightIn: 11 }),
  B: Object.freeze({ key: "B", label: "B (11 x 17 in)", widthIn: 11, heightIn: 17 }),
  C: Object.freeze({ key: "C", label: "C (17 x 22 in)", widthIn: 17, heightIn: 22 }),
  D: Object.freeze({ key: "D", label: "D (22 x 34 in)", widthIn: 22, heightIn: 34 }),
  E: Object.freeze({ key: "E", label: "E (34 x 44 in)", widthIn: 34, heightIn: 44 }),
  A4: Object.freeze({ key: "A4", label: "A4 (210 x 297 mm)", widthIn: 8.27, heightIn: 11.69 }),
  A3: Object.freeze({ key: "A3", label: "A3 (297 x 420 mm)", widthIn: 11.69, heightIn: 16.54 }),
  A2: Object.freeze({ key: "A2", label: "A2 (420 x 594 mm)", widthIn: 16.54, heightIn: 23.39 }),
  A1: Object.freeze({ key: "A1", label: "A1 (594 x 841 mm)", widthIn: 23.39, heightIn: 33.11 }),
  A0: Object.freeze({ key: "A0", label: "A0 (841 x 1189 mm)", widthIn: 33.11, heightIn: 46.81 }),
});

export const SHEET_STANDARD_ORDER = Object.freeze([
  "A",
  "B",
  "C",
  "D",
  "E",
  "A4",
  "A3",
  "A2",
  "A1",
  "A0",
]);

export function normalizeSheetOrientation(value) {
  const token = String(value ?? "").trim().toLowerCase();
  return token === "portrait" ? "portrait" : "landscape";
}

export function getSheetSizeByKey(key) {
  const token = String(key ?? "").trim().toUpperCase();
  return SHEET_STANDARD_SIZES[token] || SHEET_STANDARD_SIZES.A;
}

export function listSheetSizes() {
  return SHEET_STANDARD_ORDER
    .map((key) => SHEET_STANDARD_SIZES[key])
    .filter(Boolean);
}

export function resolveSheetDimensions(sizeKey, orientationInput = "landscape") {
  const size = getSheetSizeByKey(sizeKey);
  const orientation = normalizeSheetOrientation(orientationInput);
  const landscape = orientation === "landscape";
  const widthIn = landscape
    ? Math.max(size.widthIn, size.heightIn)
    : Math.min(size.widthIn, size.heightIn);
  const heightIn = landscape
    ? Math.min(size.widthIn, size.heightIn)
    : Math.max(size.widthIn, size.heightIn);

  return {
    key: size.key,
    label: size.label,
    orientation,
    units: "in",
    widthIn,
    heightIn,
    widthPx: widthIn * PX_PER_INCH,
    heightPx: heightIn * PX_PER_INCH,
    pxPerInch: PX_PER_INCH,
  };
}
