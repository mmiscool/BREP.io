import { normalizeCamMachineProfile, splitMachineMacroLines, type CamMachineProfile } from './CamMachineProfile.js';

export const CAM_TOOLPATH_SCHEMA_VERSION = 1;

export type CamUnits = 'mm';
export type CamPoint3 = [number, number, number];
export type CamBounds = { min: CamPoint3; max: CamPoint3 };
export type CamSegmentKind = 'rapid' | 'plunge' | 'cut' | 'link' | 'retract';
export type CamCutterKind = 'flat-endmill' | 'ball-endmill' | 'v-bit' | 'custom';

export type CamCutterDefinition = {
  id?: string;
  kind: CamCutterKind;
  diameter: number;
  radius: number;
  cuttingLength?: number;
  overallLength?: number;
  cornerRadius?: number;
  includedAngleDeg?: number;
  metadata?: Record<string, any>;
};

export type CamCutterOrientation = {
  toolAxis: CamPoint3;
  forward?: CamPoint3;
  quaternion?: [number, number, number, number];
};

export type CamToolpathPoint = {
  position: CamPoint3;
  orientation?: CamCutterOrientation;
  metadata?: Record<string, any>;
};

export type CamToolpathSegment = {
  id: string;
  kind: CamSegmentKind;
  startIndex: number;
  endIndex: number;
  orientation: CamCutterOrientation;
  cutter?: CamCutterDefinition;
  feedRate?: number;
  spindleRPM?: number;
  metadata?: Record<string, any>;
};

export type CamToolpathPath = {
  id: string;
  operationId: string;
  operationName: string;
  points: CamToolpathPoint[];
  segments: CamToolpathSegment[];
  cutter: CamCutterDefinition;
  defaultOrientation: CamCutterOrientation;
  feedRate: number;
  plungeRate: number;
  spindleRPM: number;
  metadata?: Record<string, any>;
};

export type CamToolpathSummary = {
  targetCount: number;
  triangleCount: number;
  levelCount: number;
  pathCount: number;
  pointCount: number;
  segmentCount: number;
  moveCount: number;
  motionSegmentCount: number;
  estimatedCutLength: number;
  estimatedRapidLength: number;
  warningCount: number;
  outlinePointCount?: number;
  offsetDistance?: number;
};

export type CamToolpathProgram = {
  schemaVersion: typeof CAM_TOOLPATH_SCHEMA_VERSION;
  operationId: string;
  operationName: string;
  units: CamUnits;
  coordinateSystem: 'machine';
  generatedAt: string | null;
  machine: CamMachineProfile;
  bounds: CamBounds | null;
  targetBounds: CamBounds | null;
  safeZ: number;
  cutter: CamCutterDefinition | null;
  spindleRPM: number;
  gcode: string;
  paths: CamToolpathPath[];
  summary: CamToolpathSummary;
  warnings: string[];
  metadata?: Record<string, any>;
};

export type BuildLinearToolpathPathOptions = {
  id: string;
  operationId: string;
  operationName: string;
  positions: CamPoint3[];
  cutter: CamCutterDefinition;
  orientation?: CamCutterOrientation;
  feedRate: number;
  plungeRate: number;
  spindleRPM: number;
  segmentKind?: CamSegmentKind;
  metadata?: Record<string, any>;
};

export function roundCamCoord(value: number) {
  const rounded = Math.round((Number(value) || 0) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundCamPoint(point: CamPoint3): CamPoint3 {
  return [roundCamCoord(point[0]), roundCamCoord(point[1]), roundCamCoord(point[2])];
}

export function normalizeCamOrientation(orientation: Partial<CamCutterOrientation> | null | undefined): CamCutterOrientation {
  const rawAxis = Array.isArray(orientation?.toolAxis) ? orientation?.toolAxis : [0, 0, -1];
  const axis = normalizeVector3(rawAxis as CamPoint3, [0, 0, -1]);
  const out: CamCutterOrientation = { toolAxis: axis };
  if (Array.isArray(orientation?.forward)) {
    out.forward = normalizeVector3(orientation.forward as CamPoint3, [1, 0, 0]);
  }
  if (Array.isArray(orientation?.quaternion) && orientation.quaternion.length >= 4) {
    out.quaternion = [
      roundCamCoord(Number(orientation.quaternion[0]) || 0),
      roundCamCoord(Number(orientation.quaternion[1]) || 0),
      roundCamCoord(Number(orientation.quaternion[2]) || 0),
      roundCamCoord(Number(orientation.quaternion[3]) || 1),
    ];
  }
  return out;
}

export function makeFlatEndMillCutter({
  diameter,
  cuttingLength,
  overallLength,
  id,
}: {
  diameter: number;
  cuttingLength?: number;
  overallLength?: number;
  id?: string;
}): CamCutterDefinition {
  const safeDiameter = Math.max(1e-7, Math.abs(Number(diameter) || 0));
  const out: CamCutterDefinition = {
    id,
    kind: 'flat-endmill',
    diameter: roundCamCoord(safeDiameter),
    radius: roundCamCoord(safeDiameter * 0.5),
  };
  if (Number.isFinite(Number(cuttingLength))) out.cuttingLength = roundCamCoord(Number(cuttingLength));
  if (Number.isFinite(Number(overallLength))) out.overallLength = roundCamCoord(Number(overallLength));
  return out;
}

export function buildLinearToolpathPath(options: BuildLinearToolpathPathOptions): CamToolpathPath {
  const orientation = normalizeCamOrientation(options.orientation);
  const points = (options.positions || []).map((position) => ({
    position: roundCamPoint(position),
    orientation,
  }));
  const segmentKind = options.segmentKind || 'cut';
  const segments: CamToolpathSegment[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    segments.push({
      id: `${options.id}-S${index + 1}`,
      kind: segmentKind,
      startIndex: index,
      endIndex: index + 1,
      orientation,
      cutter: options.cutter,
      feedRate: options.feedRate,
      spindleRPM: options.spindleRPM,
    });
  }
  return {
    id: options.id,
    operationId: options.operationId,
    operationName: options.operationName,
    points,
    segments,
    cutter: options.cutter,
    defaultOrientation: orientation,
    feedRate: options.feedRate,
    plungeRate: options.plungeRate,
    spindleRPM: options.spindleRPM,
    metadata: options.metadata,
  };
}

export function makeEmptyCamToolpathProgram({
  operationId = 'CAM-PROGRAM',
  operationName = 'CAM Program',
  machine = normalizeCamMachineProfile(null),
  targetBounds = null,
  safeZ = null,
  cutter = null,
  spindleRPM = 0,
  warnings = [],
}: {
  operationId?: string;
  operationName?: string;
  machine?: CamMachineProfile;
  targetBounds?: CamBounds | null;
  safeZ?: number | null;
  cutter?: CamCutterDefinition | null;
  spindleRPM?: number;
  warnings?: string[];
} = {}): CamToolpathProgram {
  const normalizedMachine = normalizeCamMachineProfile(machine);
  return {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId,
    operationName,
    units: 'mm',
    coordinateSystem: 'machine',
    generatedAt: new Date().toISOString(),
    machine: normalizedMachine,
    bounds: null,
    targetBounds,
    safeZ: roundCamCoord(Number.isFinite(Number(safeZ)) ? Number(safeZ) : normalizedMachine.safeParkZ),
    cutter,
    spindleRPM: roundCamCoord(spindleRPM),
    gcode: '',
    paths: [],
    summary: {
      targetCount: 0,
      triangleCount: 0,
      levelCount: 0,
      pathCount: 0,
      pointCount: 0,
      segmentCount: 0,
      moveCount: 0,
      motionSegmentCount: 0,
      estimatedCutLength: 0,
      estimatedRapidLength: 0,
      warningCount: warnings.length,
    },
    warnings,
  };
}

export function summarizeCamToolpathProgram({
  paths,
  targetCount = 0,
  triangleCount = 0,
  levelCount = paths.length,
  warningCount = 0,
  outlinePointCount,
  offsetDistance,
}: {
  paths: CamToolpathPath[];
  targetCount?: number;
  triangleCount?: number;
  levelCount?: number;
  warningCount?: number;
  outlinePointCount?: number;
  offsetDistance?: number;
}): CamToolpathSummary {
  const cutLength = paths.reduce((sum, path) => {
    return sum + path.segments.reduce((segmentSum, segment) => {
      if (segment.kind !== 'cut') return segmentSum;
      const start = path.points[segment.startIndex]?.position;
      const end = path.points[segment.endIndex]?.position;
      return segmentSum + (start && end ? pointDistance(start, end) : 0);
    }, 0);
  }, 0);
  const rapidLength = paths.reduce((sum, path) => {
    return sum + path.segments.reduce((segmentSum, segment) => {
      if (segment.kind === 'cut') return segmentSum;
      const start = path.points[segment.startIndex]?.position;
      const end = path.points[segment.endIndex]?.position;
      return segmentSum + (start && end ? pointDistance(start, end) : 0);
    }, 0);
  }, 0);
  const pointCount = paths.reduce((sum, path) => sum + path.points.length, 0);
  const segmentCount = paths.reduce((sum, path) => sum + path.segments.length, 0);
  const summary: CamToolpathSummary = {
    targetCount,
    triangleCount,
    levelCount,
    pathCount: paths.length,
    pointCount,
    segmentCount,
    moveCount: segmentCount,
    motionSegmentCount: segmentCount,
    estimatedCutLength: roundCamCoord(cutLength),
    estimatedRapidLength: roundCamCoord(rapidLength),
    warningCount,
  };
  if (outlinePointCount != null) summary.outlinePointCount = outlinePointCount;
  if (offsetDistance != null) summary.offsetDistance = roundCamCoord(offsetDistance);
  return summary;
}

export function generateGcodeForCamToolpathProgram(program: Omit<CamToolpathProgram, 'gcode'> | CamToolpathProgram) {
  const machine = normalizeCamMachineProfile(program.machine);
  const lines: string[] = [];
  pushComment(lines, machine, 'Generated by BREP CAM');
  pushComment(lines, machine, `Operation: ${program.operationName}`);
  pushComment(lines, machine, `Paths: ${program.paths.length}`);
  for (const macro of splitMachineMacroLines(machine.header)) lines.push(macro);
  lines.push(gcodeJoin(machine, ['G21', machine.stripComments ? '' : '; units: millimeters'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G90', machine.stripComments ? '' : '; absolute coordinates'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G17', machine.stripComments ? '' : '; XY plane'].filter(Boolean)));
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
  if (program.spindleRPM > 0) lines.push(gcodeJoin(machine, ['M3', formatWord('S', program.spindleRPM, 0)]));
  for (const path of program.paths) {
    if (!path.points.length) continue;
    const first = path.points[0].position;
    pushComment(lines, machine, path.id);
    lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
    lines.push(gcodeJoin(machine, ['G0', formatWord('X', first[0]), formatWord('Y', first[1])]));
    if (Math.abs(first[2] - program.safeZ) > 1e-7) {
      lines.push(gcodeJoin(machine, ['G1', formatWord('Z', first[2]), formatWord('F', path.plungeRate, 0)]));
    }
    let activeFeed = path.feedRate;
    for (const segment of path.segments) {
      const point = path.points[segment.endIndex]?.position;
      if (!point) continue;
      if (segment.kind === 'rapid' || segment.kind === 'retract') {
        lines.push(gcodeJoin(machine, ['G0', formatWord('X', point[0]), formatWord('Y', point[1]), formatWord('Z', point[2])]));
        continue;
      }
      const defaultFeed = segment.kind === 'plunge' ? path.plungeRate : path.feedRate;
      const feed = Number(segment.feedRate);
      const nextFeed = Number.isFinite(feed) && feed > 0 ? feed : defaultFeed;
      if (Number.isFinite(nextFeed) && nextFeed > 0 && Math.abs(nextFeed - activeFeed) > 1e-7) {
        activeFeed = nextFeed;
        lines.push(gcodeJoin(machine, ['G1', formatWord('F', activeFeed, 0)]));
      }
      lines.push(gcodeJoin(machine, ['G1', formatWord('X', point[0]), formatWord('Y', point[1]), formatWord('Z', point[2])]));
    }
  }
  lines.push(gcodeJoin(machine, ['G0', formatWord('Z', program.safeZ)]));
  if (program.spindleRPM > 0) lines.push('M5');
  for (const macro of splitMachineMacroLines(machine.footer)) lines.push(macro);
  lines.push('M2');
  return `${lines.join('\n')}\n`;
}

export function combineCamToolpathPrograms({
  programs,
  machine = normalizeCamMachineProfile(null),
}: {
  programs: CamToolpathProgram[];
  machine?: CamMachineProfile;
}): CamToolpathProgram {
  const valid = programs.filter(Boolean);
  if (!valid.length) return makeEmptyCamToolpathProgram({ machine });
  if (valid.length === 1) return valid[0];
  const normalizedMachine = normalizeCamMachineProfile(machine);
  const warnings = valid.flatMap((program) => Array.isArray(program.warnings) ? program.warnings : []);
  const paths = valid.flatMap((program) => Array.isArray(program.paths) ? program.paths : []);
  const combined: Omit<CamToolpathProgram, 'gcode'> = {
    schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
    operationId: 'CAM-PROGRAM',
    operationName: 'CAM Program',
    units: 'mm',
    coordinateSystem: 'machine',
    generatedAt: new Date().toISOString(),
    machine: normalizedMachine,
    bounds: unionCamBounds(valid.map((program) => program.bounds).filter(Boolean) as CamBounds[]),
    targetBounds: unionCamBounds(valid.map((program) => program.targetBounds).filter(Boolean) as CamBounds[]),
    safeZ: Math.max(normalizedMachine.safeParkZ, ...valid.map((program) => Number(program.safeZ) || 0)),
    cutter: null,
    spindleRPM: 0,
    paths,
    summary: {
      targetCount: valid.reduce((sum, program) => sum + (program.summary?.targetCount || 0), 0),
      triangleCount: valid.reduce((sum, program) => sum + (program.summary?.triangleCount || 0), 0),
      levelCount: valid.reduce((sum, program) => sum + (program.summary?.levelCount || 0), 0),
      pathCount: paths.length,
      pointCount: paths.reduce((sum, path) => sum + path.points.length, 0),
      segmentCount: paths.reduce((sum, path) => sum + path.segments.length, 0),
      moveCount: valid.reduce((sum, program) => sum + (program.summary?.moveCount || 0), 0),
      motionSegmentCount: valid.reduce((sum, program) => sum + (program.summary?.motionSegmentCount || 0), 0),
      estimatedCutLength: roundCamCoord(valid.reduce((sum, program) => sum + (program.summary?.estimatedCutLength || 0), 0)),
      estimatedRapidLength: roundCamCoord(valid.reduce((sum, program) => sum + (program.summary?.estimatedRapidLength || 0), 0)),
      warningCount: warnings.length,
    },
    warnings,
  };
  return { ...combined, gcode: valid.map((program) => String(program.gcode || '').trim()).filter(Boolean).join('\n') };
}

export function unionCamBounds(boundsList: CamBounds[]) {
  if (!boundsList.length) return null;
  const min: CamPoint3 = [Infinity, Infinity, Infinity];
  const max: CamPoint3 = [-Infinity, -Infinity, -Infinity];
  for (const bounds of boundsList) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return {
    min: roundCamPoint(min),
    max: roundCamPoint(max),
  };
}

function normalizeVector3(value: CamPoint3, fallback: CamPoint3): CamPoint3 {
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-12)) return roundCamPoint(fallback);
  return [roundCamCoord(x / length), roundCamCoord(y / length), roundCamCoord(z / length)];
}

function pointDistance(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function formatWord(prefix: string, value: number, decimals = 4) {
  const rounded = roundCamCoord(value);
  const text = decimals === 0 ? String(Math.round(rounded)) : String(rounded);
  return `${prefix}${text}`;
}

function gcodeJoin(machine: CamMachineProfile, words: string[]) {
  return words.join(machine.tokenSpacer === false ? '' : ' ');
}

function pushComment(lines: string[], machine: CamMachineProfile, comment: string) {
  if (!machine.stripComments) lines.push(`; ${comment}`);
}
