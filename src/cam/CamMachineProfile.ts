export type CamControllerFlavor = 'grbl' | 'linuxcnc' | 'fanuc';

export type CamMachineProfile = {
  name: string;
  controller: CamControllerFlavor;
  units: 'mm';
  maxSpindleRPM: number;
  defaultRapidRate: number;
  safeParkZ: number;
  tokenSpacer: boolean;
  stripComments: boolean;
  header: string;
  footer: string;
};

export const DEFAULT_CAM_MACHINE_PROFILE: CamMachineProfile = {
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
};

function finiteNumber(value: any, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function positiveNumber(value: any, fallback: number, min = 0) {
  return Math.max(min, finiteNumber(value, fallback));
}

export function normalizeCamControllerFlavor(value: any): CamControllerFlavor {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'linuxcnc') return 'linuxcnc';
  if (raw === 'fanuc') return 'fanuc';
  return 'grbl';
}

export function normalizeCamMachineProfile(raw: any = null): CamMachineProfile {
  const source = (raw && typeof raw === 'object') ? raw : {};
  const fallback = DEFAULT_CAM_MACHINE_PROFILE;
  return {
    name: String(source.name || fallback.name).trim() || fallback.name,
    controller: normalizeCamControllerFlavor(source.controller),
    units: 'mm',
    maxSpindleRPM: positiveNumber(source.maxSpindleRPM, fallback.maxSpindleRPM, 0),
    defaultRapidRate: positiveNumber(source.defaultRapidRate, fallback.defaultRapidRate, 1),
    safeParkZ: positiveNumber(source.safeParkZ, fallback.safeParkZ, 0),
    tokenSpacer: source.tokenSpacer !== false,
    stripComments: source.stripComments === true,
    header: String(source.header || ''),
    footer: String(source.footer || ''),
  };
}

export function mergeCamMachineProfile(profile: any, patch: any = {}) {
  const current = normalizeCamMachineProfile(profile);
  const source = (patch && typeof patch === 'object') ? patch : {};
  return normalizeCamMachineProfile({
    ...current,
    ...source,
  });
}

export function splitMachineMacroLines(value: any) {
  return String(value || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}
