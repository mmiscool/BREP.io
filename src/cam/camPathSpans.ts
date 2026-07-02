export type CamPoint3 = [number, number, number];
export type CamSpanKind = 'line' | 'arc';

export type SerializedCamPathSpan =
  | { kind: 'line'; id?: string; start: CamPoint3; end: CamPoint3 }
  | { kind: 'arc'; id?: string; start: CamPoint3; end: CamPoint3; center: CamPoint3; clockwise?: boolean };

export type CamPathSpan = {
  id: string;
  kind: CamSpanKind;
  start: CamPoint3;
  end: CamPoint3;
  length2d(): number;
  pointAt(t: number): CamPoint3;
  toSerializable(): SerializedCamPathSpan;
};

export type CamArcPathSpan = CamPathSpan & {
  kind: 'arc';
  center: CamPoint3;
  clockwise: boolean;
  radius: number;
  sweepRadians: number;
};

export type CamSpanOptions = {
  id?: string;
  tolerance?: number;
};

const EPS = 1e-7;
const TWO_PI = Math.PI * 2;

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp01(value: any) {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)));
}

function pointIsFinite(point: any) {
  return Array.isArray(point)
    && point.length >= 3
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
    && Number.isFinite(Number(point[2]));
}

function clonePoint(point: CamPoint3): CamPoint3 {
  return [
    finiteNumber(point[0], 0),
    finiteNumber(point[1], 0),
    finiteNumber(point[2], 0),
  ];
}

function validatePoint(point: any, label: string): CamPoint3 {
  if (!pointIsFinite(point)) throw new Error(`Invalid CAM ${label} point.`);
  return clonePoint(point as CamPoint3);
}

function positiveFiniteNumber(value: any, label: string) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`Invalid CAM ${label}: must be a positive finite number.`);
  return num;
}

function distance2d(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function distance3d(a: CamPoint3, b: CamPoint3) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function pointsEqual(a: CamPoint3 | null | undefined, b: CamPoint3 | null | undefined, tolerance = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= tolerance
    && Math.abs(a[1] - b[1]) <= tolerance
    && Math.abs(a[2] - b[2]) <= tolerance;
}

function normalizeId(options: CamSpanOptions | string | null | undefined, fallback: string) {
  if (typeof options === 'string') return options || fallback;
  return String(options?.id || fallback);
}

function toleranceFromOptions(options: CamSpanOptions | string | null | undefined) {
  return Math.max(EPS, finiteNumber(typeof options === 'string' ? null : options?.tolerance, EPS));
}

function lerpPoint(a: CamPoint3, b: CamPoint3, t: number): CamPoint3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function normalizeCounterClockwiseSweep(startAngle: number, endAngle: number, tolerance: number) {
  let sweep = endAngle - startAngle;
  while (sweep <= tolerance) sweep += TWO_PI;
  while (sweep > TWO_PI + tolerance) sweep -= TWO_PI;
  if (Math.abs(sweep) <= tolerance || Math.abs(sweep - TWO_PI) <= tolerance) {
    throw new Error('Degenerate CAM arc span has near-zero sweep.');
  }
  return sweep;
}

function normalizeClockwiseSweep(startAngle: number, endAngle: number, tolerance: number) {
  let sweep = endAngle - startAngle;
  while (sweep >= -tolerance) sweep -= TWO_PI;
  while (sweep < -TWO_PI - tolerance) sweep += TWO_PI;
  if (Math.abs(sweep) <= tolerance || Math.abs(Math.abs(sweep) - TWO_PI) <= tolerance) {
    throw new Error('Degenerate CAM arc span has near-zero sweep.');
  }
  return sweep;
}

export function createCamLineSpan(startInput: CamPoint3, endInput: CamPoint3, options: CamSpanOptions | string = {}): CamPathSpan {
  const start = validatePoint(startInput, 'line start');
  const end = validatePoint(endInput, 'line end');
  const tolerance = toleranceFromOptions(options);
  const length2dValue = distance2d(start, end);
  if (length2dValue <= tolerance && distance3d(start, end) <= tolerance) {
    throw new Error('Degenerate CAM line span is shorter than tolerance.');
  }
  const id = normalizeId(options, 'line');
  return {
    id,
    kind: 'line',
    start,
    end,
    length2d: () => length2dValue,
    pointAt: (t: number) => lerpPoint(start, end, clamp01(t)),
    toSerializable: () => ({ kind: 'line', id, start: clonePoint(start), end: clonePoint(end) }),
  };
}

export function createCamArcSpan(
  startInput: CamPoint3,
  endInput: CamPoint3,
  centerInput: CamPoint3,
  clockwise = false,
  options: CamSpanOptions | string = {},
): CamArcPathSpan {
  const start = validatePoint(startInput, 'arc start');
  const end = validatePoint(endInput, 'arc end');
  const center = validatePoint(centerInput, 'arc center');
  const tolerance = toleranceFromOptions(options);
  const startRadius = distance2d(start, center);
  const endRadius = distance2d(end, center);
  if (startRadius <= tolerance || endRadius <= tolerance) {
    throw new Error('Degenerate CAM arc span radius is shorter than tolerance.');
  }
  const radiusTolerance = Math.max(tolerance, startRadius * 1e-6);
  if (Math.abs(startRadius - endRadius) > radiusTolerance) {
    throw new Error('Invalid CAM arc span has mismatched start and end radii.');
  }
  if (pointsEqual(start, end, tolerance)) {
    throw new Error('Degenerate CAM arc span has near-zero sweep.');
  }
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const sweepRadians = clockwise
    ? normalizeClockwiseSweep(startAngle, endAngle, tolerance)
    : normalizeCounterClockwiseSweep(startAngle, endAngle, tolerance);
  const radius = (startRadius + endRadius) * 0.5;
  const id = normalizeId(options, 'arc');
  return {
    id,
    kind: 'arc',
    start,
    end,
    center,
    clockwise: !!clockwise,
    radius,
    sweepRadians,
    length2d: () => Math.abs(sweepRadians) * radius,
    pointAt: (t: number) => {
      const clamped = clamp01(t);
      const angle = startAngle + sweepRadians * clamped;
      return [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
        start[2] + (end[2] - start[2]) * clamped,
      ];
    },
    toSerializable: () => ({
      kind: 'arc',
      id,
      start: clonePoint(start),
      end: clonePoint(end),
      center: clonePoint(center),
      clockwise: !!clockwise,
    }),
  };
}

export function createCamPathSpan(raw: SerializedCamPathSpan, fallbackId = 'span'): CamPathSpan {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid serialized CAM span.');
  const id = String(raw.id || fallbackId);
  if (raw.kind === 'line') return createCamLineSpan(raw.start, raw.end, { id });
  if (raw.kind === 'arc') return createCamArcSpan(raw.start, raw.end, raw.center, raw.clockwise === true, { id });
  throw new Error(`Unsupported CAM span kind: ${(raw as any).kind}`);
}

export function sampleCamPathSpans(
  spansInput: CamPathSpan[],
  sampleSpacing: number,
  options: { suppressSharedEndpoints?: boolean; tolerance?: number } = {},
) {
  const spans = Array.isArray(spansInput) ? spansInput : [];
  const spacing = Math.max(EPS, positiveFiniteNumber(sampleSpacing, 'sample spacing'));
  const suppressSharedEndpoints = options.suppressSharedEndpoints !== false;
  const tolerance = Math.max(EPS, finiteNumber(options.tolerance, 1e-6));
  const points: CamPoint3[] = [];
  const spanIds: string[] = [];

  for (const span of spans) {
    if (!span || typeof span.pointAt !== 'function' || typeof span.length2d !== 'function') continue;
    const steps = Math.max(1, Math.ceil(Math.max(0, finiteNumber(span.length2d(), 0)) / spacing));
    for (let index = 0; index <= steps; index += 1) {
      const point = span.pointAt(index / steps);
      if (!pointIsFinite(point)) throw new Error(`Invalid CAM sampled point from span ${span.id || 'span'}.`);
      if (suppressSharedEndpoints && points.length && index === 0 && pointsEqual(points[points.length - 1], point, tolerance)) {
        continue;
      }
      points.push(clonePoint(point));
      spanIds.push(span.id);
    }
  }

  return {
    points,
    spanIds,
  };
}
