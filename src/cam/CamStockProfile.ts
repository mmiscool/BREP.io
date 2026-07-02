export type CamStockMode = 'auto' | 'fixed';

export type CamStockProfile = {
  mode: CamStockMode;
  margin: number;
  sizeX: number | null;
  sizeY: number | null;
  sizeZ: number | null;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
};

export const DEFAULT_CAM_STOCK_PROFILE: CamStockProfile = {
  mode: 'auto',
  margin: 6.35,
  sizeX: null,
  sizeY: null,
  sizeZ: null,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
};

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nonNegativeNumber(value: any, fallback: number) {
  return Math.max(0, finiteNumber(value, fallback));
}

function nullablePositiveNumber(value: any) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function normalizeCamStockMode(value: any): CamStockMode {
  return String(value || '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'auto';
}

export function normalizeCamStockProfile(raw: any = null): CamStockProfile {
  const source = (raw && typeof raw === 'object') ? raw : {};
  const fallback = DEFAULT_CAM_STOCK_PROFILE;
  const hasFixedSize = source.sizeX != null || source.sizeY != null || source.sizeZ != null;
  return {
    mode: hasFixedSize && source.mode == null ? 'fixed' : normalizeCamStockMode(source.mode),
    margin: nonNegativeNumber(source.margin ?? source.stockMargin, fallback.margin),
    sizeX: nullablePositiveNumber(source.sizeX),
    sizeY: nullablePositiveNumber(source.sizeY),
    sizeZ: nullablePositiveNumber(source.sizeZ),
    offsetX: finiteNumber(source.offsetX, fallback.offsetX),
    offsetY: finiteNumber(source.offsetY, fallback.offsetY),
    offsetZ: finiteNumber(source.offsetZ, fallback.offsetZ),
  };
}

export function mergeCamStockProfile(profile: any, patch: any = {}) {
  const current = normalizeCamStockProfile(profile);
  const source = (patch && typeof patch === 'object') ? patch : {};
  return normalizeCamStockProfile({
    ...current,
    ...source,
  });
}
