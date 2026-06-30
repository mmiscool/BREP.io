import * as THREE from 'three';

type ScreenSizeWorldFn = (pixels: number) => number;
type VectorLike = THREE.Vector3 | number[] | { x: unknown; y: unknown; z: unknown } | null | undefined;
type PlaneBasis = { U: THREE.Vector3; V: THREE.Vector3; N: THREE.Vector3 };
type Segment3D = [THREE.Vector3, THREE.Vector3];
type ArrowSpec = { tip: THREE.Vector3; direction: THREE.Vector3; length: number; width: number };
type AngleType = 'acute' | 'obtuse' | 'reflex' | string | null | undefined;
type AngleCombo = {
  A: THREE.Vector2;
  B: THREE.Vector2;
  angle: number;
  signedAngle: number;
};
export type AngleOrientation2D = {
  start: THREE.Vector2;
  end: THREE.Vector2;
  sweep: number;
  dirSign: number;
  angleRad: number;
  bisector: THREE.Vector2;
  angleType: 'acute' | 'obtuse' | 'reflex';
  signedAngle: number;
};
export type AngleDimensionGeometryOptions = {
  planePoint?: THREE.Vector3 | null;
  planeNormal?: THREE.Vector3 | null;
  basis?: PlaneBasis | null;
  vertex2D?: THREE.Vector2 | null;
  directionA2D?: THREE.Vector2 | null;
  directionB2D?: THREE.Vector2 | null;
  sweepRad?: number;
  sweepDirection?: number;
  bisector2D?: THREE.Vector2 | null;
  labelWorld?: VectorLike;
  screenSizeWorld?: ScreenSizeWorldFn | null;
  fallbackScreenSizeWorld?: ScreenSizeWorldFn | null;
  defaultRadiusPixels?: number;
  minRadiusPixels?: number;
  arcDensity?: number;
  minArcSteps?: number;
  extensionPixels?: number;
  stubPixels?: number;
  labelOffsetPixels?: number;
  arrowLengthPixels?: number;
  arrowWidthPixels?: number;
};
export type AngleDimensionGeometry = {
  radius: number;
  arcPoints: THREE.Vector3[];
  arrowSpecs: ArrowSpec[];
  segments: Segment3D[];
  labelPosition: THREE.Vector3;
  originWorld: THREE.Vector3;
};
export type LinearDimensionGeometryOptions = {
  pointA?: VectorLike;
  pointB?: VectorLike;
  extensionAnchorA?: VectorLike;
  extensionAnchorB?: VectorLike;
  normal?: VectorLike;
  offset?: number;
  showExtensions?: boolean;
  labelWorld?: VectorLike;
  screenSizeWorld?: ScreenSizeWorldFn | null;
  fallbackScreenSizeWorld?: ScreenSizeWorldFn | null;
  arrowLengthPixels?: number;
  arrowWidthPixels?: number;
  labelLiftPixels?: number;
  labelLeaderThresholdPixels?: number;
};
export type LinearDimensionGeometry = {
  direction: THREE.Vector3;
  tangent: THREE.Vector3;
  offset: number;
  offsetA: THREE.Vector3;
  offsetB: THREE.Vector3;
  segments: Segment3D[];
  arrowSpecs: ArrowSpec[];
  labelPosition: THREE.Vector3;
  leaderSegment: Segment3D | null;
};

function resolveScreenSizeWorld(
  pixels: number,
  screenSizeWorld?: ScreenSizeWorldFn | null,
  fallbackScreenSizeWorld?: ScreenSizeWorldFn | null,
  fallbackValue = 0.01,
): number {
  const candidates: ScreenSizeWorldFn[] = [];
  if (typeof screenSizeWorld === 'function') candidates.push(screenSizeWorld);
  if (typeof fallbackScreenSizeWorld === 'function') candidates.push(fallbackScreenSizeWorld);
  for (const fn of candidates) {
    try {
      const value = Number(fn(pixels));
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // ignore callback failures
    }
  }
  return fallbackValue;
}

function arbitraryPerpendicular3D(dir: THREE.Vector3 | null | undefined): THREE.Vector3 {
  if (!dir || dir.lengthSq() === 0) return new THREE.Vector3(0, 0, 1);
  const axis = Math.abs(dir.dot(new THREE.Vector3(0, 0, 1))) < 0.9
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const perp = new THREE.Vector3().crossVectors(dir, axis);
  if (perp.lengthSq() === 0) {
    perp.crossVectors(dir, new THREE.Vector3(1, 0, 0));
  }
  return perp.lengthSq() === 0 ? new THREE.Vector3(1, 0, 0) : perp.normalize();
}

export function vectorFromAny(value: VectorLike): THREE.Vector3 | null {
  if (!value) return null;
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  if (typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return new THREE.Vector3(x, y, z);
    }
  }
  return null;
}

function clampToUnit(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function signedAngle2D(a: THREE.Vector2, b: THREE.Vector2): number {
  const cross = a.x * b.y - a.y * b.x;
  const dot = a.x * b.x + a.y * b.y;
  return Math.atan2(cross, dot);
}

function rotate2D(vec: THREE.Vector2, angle: number): THREE.Vector2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new THREE.Vector2(vec.x * c - vec.y * s, vec.x * s + vec.y * c);
}

export function planeBasis(normal: THREE.Vector3, preferDir: THREE.Vector3 | null = null): PlaneBasis {
  const n = normal.clone().normalize();
  let u = (preferDir ? preferDir.clone() : new THREE.Vector3(1, 0, 0)).projectOnPlane(n);
  if (u.lengthSq() < 1e-12) {
    u = Math.abs(n.z) < 0.9
      ? new THREE.Vector3(0, 0, 1).cross(n)
      : new THREE.Vector3(0, 1, 0).cross(n);
  }
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { U: u, V: v, N: n };
}

export function to2D(point: THREE.Vector3, planePoint: THREE.Vector3, basis: PlaneBasis): THREE.Vector2 {
  const relative = point.clone().sub(planePoint);
  return new THREE.Vector2(relative.dot(basis.U), relative.dot(basis.V));
}

export function dirTo2D(dir: THREE.Vector3, basis: PlaneBasis): THREE.Vector2 {
  return new THREE.Vector2(dir.dot(basis.U), dir.dot(basis.V));
}

function from2D(p2: THREE.Vector2, planePoint: THREE.Vector3, basis: PlaneBasis): THREE.Vector3 {
  return planePoint.clone()
    .add(basis.U.clone().multiplyScalar(p2.x))
    .add(basis.V.clone().multiplyScalar(p2.y));
}

export function intersectLines2D(
  p1: THREE.Vector2,
  d1: THREE.Vector2,
  p2: THREE.Vector2,
  d2: THREE.Vector2,
): THREE.Vector2 | null {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-12) return null;
  const delta = new THREE.Vector2().subVectors(p2, p1);
  const t = (delta.x * d2.y - delta.y * d2.x) / cross;
  return new THREE.Vector2(p1.x + d1.x * t, p1.y + d1.y * t);
}

function projectPointToPlane(
  point: THREE.Vector3,
  planePoint: THREE.Vector3,
  planeNormal: THREE.Vector3,
): THREE.Vector3 {
  const distance = point.clone().sub(planePoint).dot(planeNormal);
  return point.clone().sub(planeNormal.clone().multiplyScalar(distance));
}

function createAngleCombo(
  directionA: THREE.Vector2,
  directionB: THREE.Vector2,
  flipA: boolean,
  flipB: boolean,
): AngleCombo {
  const a = flipA ? directionA.clone().multiplyScalar(-1) : directionA.clone();
  const b = flipB ? directionB.clone().multiplyScalar(-1) : directionB.clone();
  const dot = clampToUnit(a.dot(b));
  const angle = Math.acos(dot);
  const signedAngle = signedAngle2D(a, b);
  return { A: a, B: b, angle, signedAngle };
}

export function resolveAngleOrientation2D(
  directionA: THREE.Vector2 | null | undefined,
  directionB: THREE.Vector2 | null | undefined,
  angleType: AngleType,
  isExplicitType = true,
): AngleOrientation2D | null {
  if (!directionA || !directionB) return null;
  const combos = [
    createAngleCombo(directionA, directionB, false, false),
    createAngleCombo(directionA, directionB, false, true),
    createAngleCombo(directionA, directionB, true, false),
    createAngleCombo(directionA, directionB, true, true),
  ];

  const halfPi = Math.PI / 2;
  const eps = 1e-6;

  const selectByAngle = (items: AngleCombo[], comparator: (a: AngleCombo, b: AngleCombo) => number) => {
    if (!items.length) return null;
    const sorted = items.slice().sort(comparator);
    return sorted[0];
  };

  if (angleType === 'reflex') {
    const base = combos[0];
    const baseAbs = Math.abs(base.signedAngle);
    const reflexAngle = baseAbs < 1e-6 ? 0 : (2 * Math.PI) - baseAbs;
    const dirSign = -Math.sign(base.signedAngle || 1);
    const bisector = base.A.clone().add(base.B);
    if (bisector.lengthSq() < 1e-10) bisector.set(-base.A.y, base.A.x);
    bisector.normalize().multiplyScalar(-1);
    return {
      start: base.A.clone(),
      end: base.B.clone(),
      sweep: reflexAngle,
      dirSign,
      angleRad: reflexAngle,
      bisector,
      angleType: 'reflex',
      signedAngle: base.signedAngle,
    };
  }

  if (angleType === 'acute') {
    if (!isExplicitType) {
      const base = combos[0];
      const bisector = base.A.clone().add(base.B);
      if (bisector.lengthSq() < 1e-10) bisector.set(-base.A.y, base.A.x);
      bisector.normalize();
      const sign = Math.abs(base.signedAngle) < 1e-8 ? 1 : Math.sign(base.signedAngle);
      const sweep = Math.abs(base.signedAngle);
      return {
        start: base.A.clone(),
        end: base.B.clone(),
        sweep,
        dirSign: sign,
        angleRad: sweep,
        bisector,
        angleType: 'acute',
        signedAngle: base.signedAngle,
      };
    }
    const candidates = combos.filter((candidate) => candidate.angle <= halfPi + eps);
    const selected = selectByAngle(candidates.length ? candidates : combos, (a, b) => a.angle - b.angle);
    if (!selected) return null;
    const bisector = selected.A.clone().add(selected.B);
    if (bisector.lengthSq() < 1e-10) bisector.set(-selected.A.y, selected.A.x);
    bisector.normalize();
    const sign = Math.abs(selected.signedAngle) < 1e-8 ? 1 : Math.sign(selected.signedAngle);
    return {
      start: selected.A.clone(),
      end: selected.B.clone(),
      sweep: selected.angle,
      dirSign: sign,
      angleRad: selected.angle,
      bisector,
      angleType: 'acute',
      signedAngle: selected.signedAngle,
    };
  }

  if (angleType === 'obtuse') {
    const candidates = combos.filter((candidate) => candidate.angle >= halfPi - eps);
    let selected = selectByAngle(candidates, (a, b) => a.angle - b.angle);
    if (!selected) selected = selectByAngle(combos, (a, b) => b.angle - a.angle);
    if (!selected) return null;
    const bisector = selected.A.clone().add(selected.B);
    if (bisector.lengthSq() < 1e-10) bisector.set(-selected.A.y, selected.A.x);
    bisector.normalize();
    const sign = Math.abs(selected.signedAngle) < 1e-8 ? 1 : Math.sign(selected.signedAngle);
    return {
      start: selected.A.clone(),
      end: selected.B.clone(),
      sweep: selected.angle,
      dirSign: sign,
      angleRad: selected.angle,
      bisector,
      angleType: 'obtuse',
      signedAngle: selected.signedAngle,
    };
  }

  return null;
}

export function buildAngleDimensionGeometry({
  planePoint = null,
  planeNormal = null,
  basis = null,
  vertex2D = null,
  directionA2D = null,
  directionB2D = null,
  sweepRad = 0,
  sweepDirection = 1,
  bisector2D = null,
  labelWorld = null,
  screenSizeWorld = null,
  fallbackScreenSizeWorld = null,
  defaultRadiusPixels = 60,
  minRadiusPixels = 30,
  arcDensity = 64,
  minArcSteps = 48,
  extensionPixels = 25,
  stubPixels = 12,
  labelOffsetPixels = 70,
  arrowLengthPixels = 10,
  arrowWidthPixels = 4,
}: AngleDimensionGeometryOptions = {}): AngleDimensionGeometry | null {
  if (!planePoint || !planeNormal || !basis || !vertex2D || !directionA2D || !directionB2D) return null;
  const origin2D = vertex2D.clone();
  const dirA2D = directionA2D.clone();
  const dirB2D = directionB2D.clone();
  if (dirA2D.lengthSq() <= 1e-12 || dirB2D.lengthSq() <= 1e-12) return null;
  dirA2D.normalize();
  dirB2D.normalize();

  const normal = planeNormal.clone().normalize();

  let radius: number | null = null;
  const worldLabel = vectorFromAny(labelWorld);
  if (worldLabel) {
    const projected = projectPointToPlane(worldLabel, planePoint, normal);
    const label2D = to2D(projected, planePoint, basis);
    radius = label2D.clone().sub(origin2D).length();
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    radius = resolveScreenSizeWorld(defaultRadiusPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.02);
  }
  const minRadius = resolveScreenSizeWorld(minRadiusPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.01);
  radius = Math.max(radius, minRadius);

  const arcPoints: THREE.Vector3[] = [];
  const sweep = Math.max(0, Number(sweepRad) || 0);
  const directionSign = Number(sweepDirection) || 1;
  if (sweep > 1e-6) {
    const steps = Math.max(minArcSteps, Math.floor(sweep * arcDensity));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angle = directionSign * sweep * t;
      const rotated = rotate2D(dirA2D, angle);
      const point2D = new THREE.Vector2(
        origin2D.x + rotated.x * radius,
        origin2D.y + rotated.y * radius,
      );
      arcPoints.push(from2D(point2D, planePoint, basis));
    }
  }

  const arrowLength = resolveScreenSizeWorld(arrowLengthPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.08);
  const arrowWidth = resolveScreenSizeWorld(arrowWidthPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.03);
  const arrowSpecs: ArrowSpec[] = [];
  if (arcPoints.length >= 2) {
    const startDirection = arcPoints[0].clone().sub(arcPoints[1]).normalize();
    arrowSpecs.push({ tip: arcPoints[0].clone(), direction: startDirection, length: arrowLength, width: arrowWidth });
    const last = arcPoints[arcPoints.length - 1].clone();
    const beforeLast = arcPoints[arcPoints.length - 2].clone();
    const endDirection = last.clone().sub(beforeLast).normalize();
    arrowSpecs.push({ tip: last, direction: endDirection, length: arrowLength, width: arrowWidth });
  }

  const extensionDistance = radius + resolveScreenSizeWorld(extensionPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.02);
  const stubDistance = resolveScreenSizeWorld(stubPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.01);

  const originWorld = from2D(origin2D, planePoint, basis);
  const segmentAExt = from2D(new THREE.Vector2(
    origin2D.x + dirA2D.x * extensionDistance,
    origin2D.y + dirA2D.y * extensionDistance,
  ), planePoint, basis);
  const segmentBExt = from2D(new THREE.Vector2(
    origin2D.x + dirB2D.x * extensionDistance,
    origin2D.y + dirB2D.y * extensionDistance,
  ), planePoint, basis);
  const segmentAStub = from2D(new THREE.Vector2(
    origin2D.x - dirA2D.x * stubDistance,
    origin2D.y - dirA2D.y * stubDistance,
  ), planePoint, basis);
  const segmentBStub = from2D(new THREE.Vector2(
    origin2D.x - dirB2D.x * stubDistance,
    origin2D.y - dirB2D.y * stubDistance,
  ), planePoint, basis);

  const segments: Segment3D[] = [
    [originWorld.clone(), segmentAExt],
    [originWorld.clone(), segmentBExt],
    [originWorld.clone(), segmentAStub],
    [originWorld.clone(), segmentBStub],
  ];

  let bisector = bisector2D ? bisector2D.clone() : new THREE.Vector2().addVectors(dirA2D, dirB2D);
  if (bisector.lengthSq() < 1e-10) bisector.set(-dirA2D.y, dirA2D.x);
  bisector.normalize();
  const labelOffset = resolveScreenSizeWorld(labelOffsetPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.03);
  const labelDistance = radius > 0 ? (radius + labelOffset * 0.3) : labelOffset;
  const label2D = new THREE.Vector2(
    origin2D.x + bisector.x * labelDistance,
    origin2D.y + bisector.y * labelDistance,
  );
  const labelPosition = from2D(label2D, planePoint, basis);

  return {
    radius,
    arcPoints,
    arrowSpecs,
    segments,
    labelPosition,
    originWorld,
  };
}

export function buildLinearDimensionGeometry({
  pointA = null,
  pointB = null,
  extensionAnchorA = null,
  extensionAnchorB = null,
  normal = null,
  offset = 0,
  showExtensions = true,
  labelWorld = null,
  screenSizeWorld = null,
  fallbackScreenSizeWorld = null,
  arrowLengthPixels = 12,
  arrowWidthPixels = 4,
  labelLiftPixels = 6,
  labelLeaderThresholdPixels = 6,
}: LinearDimensionGeometryOptions = {}): LinearDimensionGeometry | null {
  const p0 = vectorFromAny(pointA);
  const p1 = vectorFromAny(pointB);
  if (!p0 || !p1) return null;

  const dir = p1.clone().sub(p0);
  if (dir.lengthSq() < 1e-8) return null;
  dir.normalize();

  let n = vectorFromAny(normal);
  if (!n || n.lengthSq() < 1e-12) n = new THREE.Vector3(0, 0, 1);
  n.normalize();

  let tangent = new THREE.Vector3().crossVectors(n, dir);
  if (tangent.lengthSq() < 1e-12) tangent = arbitraryPerpendicular3D(dir);
  if (tangent.lengthSq() < 1e-12) return null;
  tangent.normalize();

  let safeOffset = Number(offset);
  if (!Number.isFinite(safeOffset)) {
    safeOffset = resolveScreenSizeWorld(20, screenSizeWorld, fallbackScreenSizeWorld, 0.05);
  }

  const offsetA = p0.clone().addScaledVector(tangent, safeOffset);
  const offsetB = p1.clone().addScaledVector(tangent, safeOffset);

  const segments: Segment3D[] = [];
  if (showExtensions !== false) {
    segments.push(...buildLinearExtensionSegments(extensionAnchorA, p0, offsetA));
    segments.push(...buildLinearExtensionSegments(extensionAnchorB, p1, offsetB));
  }
  segments.push([offsetA.clone(), offsetB.clone()]);

  const arrowLength = resolveScreenSizeWorld(arrowLengthPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.08);
  const arrowWidth = resolveScreenSizeWorld(arrowWidthPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.03);
  const arrowSpecs = [
    { tip: offsetA.clone(), direction: dir.clone().negate(), length: arrowLength, width: arrowWidth },
    { tip: offsetB.clone(), direction: dir.clone(), length: arrowLength, width: arrowWidth },
  ];

  const providedLabel = vectorFromAny(labelWorld);
  const mid = new THREE.Vector3().addVectors(offsetA, offsetB).multiplyScalar(0.5);
  const lift = resolveScreenSizeWorld(labelLiftPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.02);
  const labelPosition = providedLabel || mid.addScaledVector(tangent, lift);

  let leaderSegment: Segment3D | null = null;
  if (providedLabel) {
    const lineLength = offsetA.distanceTo(offsetB);
    if (lineLength > 1e-6) {
      const toLabel = providedLabel.clone().sub(offsetA);
      const along = toLabel.dot(dir);
      const clamped = Math.max(0, Math.min(lineLength, along));
      const nearest = offsetA.clone().addScaledVector(dir, clamped);
      const threshold = resolveScreenSizeWorld(labelLeaderThresholdPixels, screenSizeWorld, fallbackScreenSizeWorld, 0.02);
      if (providedLabel.distanceTo(nearest) > threshold) {
        leaderSegment = [nearest, providedLabel.clone()];
      }
    }
  }

  return {
    direction: dir,
    tangent,
    offset: safeOffset,
    offsetA,
    offsetB,
    segments,
    arrowSpecs,
    labelPosition,
    leaderSegment,
  };
}

function buildLinearExtensionSegments(
  anchorValue: VectorLike,
  measuredPoint: THREE.Vector3,
  dimensionPoint: THREE.Vector3,
): Segment3D[] {
  const out: Segment3D[] = [];
  const anchor = vectorFromAny(anchorValue) || measuredPoint;
  const epsSq = 1e-12;
  if (anchor.distanceToSquared(measuredPoint) > epsSq) {
    out.push([anchor.clone(), measuredPoint.clone()]);
  }
  if (measuredPoint.distanceToSquared(dimensionPoint) > epsSq) {
    out.push([measuredPoint.clone(), dimensionPoint.clone()]);
  }
  return out;
}
