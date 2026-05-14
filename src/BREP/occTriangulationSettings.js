export const DEFAULT_OCC_TRIANGULATION_DEFLECTION = 0.15;
export const DEFAULT_OCC_TRIANGULATION_ANGLE = 0.5;
export const DEFAULT_OCC_VISUALIZATION_QUALITY = 1;
export const MIN_OCC_VISUALIZATION_QUALITY = 0.25;
export const MAX_OCC_VISUALIZATION_QUALITY = 20;
export const DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES = 128;
export const MAX_OCC_VISUALIZATION_CURVE_SAMPLES = 8193;

let occVisualizationQuality = DEFAULT_OCC_VISUALIZATION_QUALITY;

export function normalizeOccVisualizationQuality(value) {
  const quality = Number(value);
  if (!Number.isFinite(quality)) return DEFAULT_OCC_VISUALIZATION_QUALITY;
  return Math.min(MAX_OCC_VISUALIZATION_QUALITY, Math.max(MIN_OCC_VISUALIZATION_QUALITY, quality));
}

export function getOccVisualizationQuality() {
  return occVisualizationQuality;
}

export function setOccVisualizationQuality(value) {
  occVisualizationQuality = normalizeOccVisualizationQuality(value);
  return occVisualizationQuality;
}

export function getOccVisualizationTriangulationOptions() {
  const quality = normalizeOccVisualizationQuality(occVisualizationQuality);
  return {
    deflection: DEFAULT_OCC_TRIANGULATION_DEFLECTION / quality,
    angle: DEFAULT_OCC_TRIANGULATION_ANGLE / Math.sqrt(quality),
  };
}

export function getOccVisualizationCurveSampleCount(base = DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES) {
  const quality = normalizeOccVisualizationQuality(occVisualizationQuality);
  const count = Math.ceil((Number(base) || DEFAULT_OCC_VISUALIZATION_CURVE_SAMPLES) * quality);
  return Math.max(2, Math.min(MAX_OCC_VISUALIZATION_CURVE_SAMPLES, count));
}
