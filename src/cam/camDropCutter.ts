import {
  createCamCutterProfile,
  type CamCutterProfile,
  type CamCutterProfileInput,
} from './CamCutterProfile.js';
import {
  buildCamTriangleSpatialIndex,
  buildCamTriangleSpatialIndexWithFallback,
  normalizeCamTriangles,
  queryCamTriangleAabbBruteForce,
  type CamBounds3,
  type CamPoint3,
  type CamTriangleIndexFallbackOptions,
  type CamTriangleInput,
} from './camTriangleSpatialIndex.js';

export type CamCLPoint = {
  x: number;
  y: number;
  z: number;
  id?: string;
  pathId?: string;
  contact?: CamContact;
};

export type CamContactType = 'none' | 'vertex' | 'facet' | 'edge' | 'tool-profile' | 'numeric-fallback';

export type CamContact = {
  type: CamContactType;
  point?: CamPoint3;
  triangleId?: number;
  distance?: number;
  detail?: string;
};

export type CamDropCutterTolerance = {
  pointEps?: number;
  distanceEps?: number;
  areaEps?: number;
  angleEps?: number;
};

export type CamDropCutterProgress = {
  phase: string;
  message: string;
  detail?: string;
  current: number;
  total: number;
};

export type CamPointDropInput = {
  point: CamCLPoint | CamPoint3;
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  floorZ?: number;
  tolerance?: CamDropCutterTolerance;
};

export type CamPointDropOutput = {
  point: CamCLPoint;
  candidateCount: number;
  contactCount: number;
  warnings: string[];
};

export type CamBatchDropInput = {
  points: Array<CamCLPoint | CamPoint3>;
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  floorZ?: number;
  tolerance?: CamDropCutterTolerance;
  chunkSize?: number;
  indexOptions?: CamTriangleIndexFallbackOptions;
  onProgress?: (progress: CamDropCutterProgress) => void;
  progressYield?: () => Promise<void> | void;
};

export type CamBatchDropOutput = {
  points: CamCLPoint[];
  summary: {
    pointCount: number;
    candidateCount: number;
    contactCount: number;
    warningCount: number;
  };
  warnings: string[];
};

export type CamDropCutterProjectorInput = {
  cutter: CamCutterProfile | CamCutterProfileInput;
  triangles: CamTriangleInput[];
  index?: ReturnType<typeof buildCamTriangleSpatialIndex>;
  indexOptions?: CamTriangleIndexFallbackOptions;
  floorZ?: number;
  tolerance?: CamDropCutterTolerance;
};

export type CamDropCutterProjector = {
  cutter: CamCutterProfile;
  index: ReturnType<typeof buildCamTriangleSpatialIndex> | null;
  warnings: string[];
  dropPoint(point: CamCLPoint | CamPoint3): CamPointDropOutput;
};

type NormalizedTriangle = ReturnType<typeof normalizeCamTriangles>[number];

const EPS = 1e-7;
const QUERY_Z_LIMIT = 1e20;

const DEFAULT_TOLERANCE = {
  pointEps: 1e-6,
  distanceEps: 1e-7,
  areaEps: 1e-9,
  angleEps: 1e-9,
};
const EMPTY_MESH_WARNING = 'No mesh triangles were found for drop-cutter projection.';

function finiteNumber(value: any, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function positiveInteger(value: any, fallback: number) {
  const num = Math.round(finiteNumber(value, fallback));
  return Math.max(1, num);
}

function hasCoordinateValue(value: any) {
  return value != null && value !== '';
}

function toleranceWithDefaults(tolerance: CamDropCutterTolerance | null | undefined) {
  const source = tolerance || {};
  return {
    pointEps: Math.max(EPS, finiteNumber(source.pointEps, DEFAULT_TOLERANCE.pointEps)),
    distanceEps: Math.max(EPS, finiteNumber(source.distanceEps, DEFAULT_TOLERANCE.distanceEps)),
    areaEps: Math.max(EPS, finiteNumber(source.areaEps, DEFAULT_TOLERANCE.areaEps)),
    angleEps: Math.max(EPS, finiteNumber(source.angleEps, DEFAULT_TOLERANCE.angleEps)),
  };
}

function isProfile(value: any): value is CamCutterProfile {
  return value
    && typeof value === 'object'
    && typeof value.heightAtRadius === 'function'
    && typeof value.radiusAtHeight === 'function'
    && typeof value.validate === 'function';
}

function normalizeCutter(cutterInput: CamCutterProfile | CamCutterProfileInput) {
  return isProfile(cutterInput) ? cutterInput : createCamCutterProfile(cutterInput);
}

function normalizePoint(pointInput: CamCLPoint | CamPoint3, floorZ: number, warnings: string[]) {
  if (Array.isArray(pointInput)) {
    const x = Number(pointInput[0]);
    const y = Number(pointInput[1]);
    const hasZ = hasCoordinateValue(pointInput[2]);
    const z = hasZ ? Number(pointInput[2]) : floorZ;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      warnings.push('Drop-cutter point must contain finite x, y, and z coordinates.');
      return null;
    }
    return { x, y, z };
  }

  const source = (pointInput && typeof pointInput === 'object') ? pointInput : null;
  const x = Number((source as any)?.x);
  const y = Number((source as any)?.y);
  const hasZ = hasCoordinateValue((source as any)?.z);
  const z = hasZ ? Number((source as any).z) : floorZ;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    warnings.push('Drop-cutter point must contain finite x, y, and z coordinates.');
    return null;
  }
  return {
    ...(source || {}),
    x,
    y,
    z,
  } as CamCLPoint;
}

function clonePoint(point: CamCLPoint): CamCLPoint {
  return {
    ...point,
    contact: point.contact ? { ...point.contact, point: point.contact.point ? [...point.contact.point] as CamPoint3 : undefined } : undefined,
  };
}

function noContactPointFromInput(pointInput: CamCLPoint | CamPoint3, floorZ: number, detail: string): CamCLPoint {
  if (Array.isArray(pointInput)) {
    return {
      x: finiteNumber(pointInput[0], 0),
      y: finiteNumber(pointInput[1], 0),
      z: floorZ,
      contact: { type: 'none', detail },
    };
  }
  const source = (pointInput && typeof pointInput === 'object') ? pointInput : {};
  return {
    ...(source as CamCLPoint),
    x: finiteNumber((source as any).x, 0),
    y: finiteNumber((source as any).y, 0),
    z: floorZ,
    contact: { type: 'none', detail },
  };
}

function buildTriangleMap(triangles: NormalizedTriangle[]) {
  return new Map(triangles.map((triangle) => [triangle.id, triangle]));
}

function cutterQueryBounds(point: CamCLPoint, cutter: CamCutterProfile): CamBounds3 {
  const radius = Math.max(EPS, cutter.radius);
  return {
    min: [point.x - radius, point.y - radius, -QUERY_Z_LIMIT],
    max: [point.x + radius, point.y + radius, QUERY_Z_LIMIT],
  };
}

function trianglePlaneAtXY(triangle: NormalizedTriangle, x: number, y: number, areaEps: number) {
  const ax = triangle.a[0];
  const ay = triangle.a[1];
  const bx = triangle.b[0];
  const by = triangle.b[1];
  const cx = triangle.c[0];
  const cy = triangle.c[1];
  const v0x = bx - ax;
  const v0y = by - ay;
  const v1x = cx - ax;
  const v1y = cy - ay;
  const v2x = x - ax;
  const v2y = y - ay;
  const denom = v0x * v1y - v0y * v1x;
  if (Math.abs(denom) <= areaEps) return null;
  const u = (v2x * v1y - v2y * v1x) / denom;
  const v = (v0x * v2y - v0y * v2x) / denom;
  return {
    z: triangle.a[2] + u * (triangle.b[2] - triangle.a[2]) + v * (triangle.c[2] - triangle.a[2]),
    u,
    v,
  };
}

function pointInsideTriangleXY(triangle: NormalizedTriangle, x: number, y: number, areaEps: number) {
  const plane = trianglePlaneAtXY(triangle, x, y, areaEps);
  return !!plane && plane.u >= -areaEps && plane.v >= -areaEps && plane.u + plane.v <= 1 + areaEps;
}

function triangleGradientXY(triangle: NormalizedTriangle, areaEps: number) {
  const planeAtA = trianglePlaneAtXY(triangle, triangle.a[0], triangle.a[1], areaEps);
  if (!planeAtA) return null;
  const dx = trianglePlaneAtXY(triangle, triangle.a[0] + 1, triangle.a[1], areaEps);
  const dy = trianglePlaneAtXY(triangle, triangle.a[0], triangle.a[1] + 1, areaEps);
  if (!dx || !dy) return null;
  return [dx.z - planeAtA.z, dy.z - planeAtA.z] as [number, number];
}

function closestPointOnSegmentXY(origin: CamCLPoint, a: CamPoint3, b: CamPoint3) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= EPS * EPS) return { t: 0, point: [...a] as CamPoint3 };
  const t = Math.max(0, Math.min(1, ((origin.x - a[0]) * dx + (origin.y - a[1]) * dy) / lenSq));
  return {
    t,
    point: [
      a[0] + dx * t,
      a[1] + dy * t,
      a[2] + (b[2] - a[2]) * t,
    ] as CamPoint3,
  };
}

function circleSegmentIntersectionsXY(origin: CamCLPoint, radius: number, a: CamPoint3, b: CamPoint3, distanceEps: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - origin.x;
  const fy = a[1] - origin.y;
  const qa = dx * dx + dy * dy;
  if (qa <= distanceEps * distanceEps) return [];
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radius * radius;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < -distanceEps) return [];
  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const out: CamPoint3[] = [];
  for (const t of [(-qb - sqrtDisc) / (2 * qa), (-qb + sqrtDisc) / (2 * qa)]) {
    if (t < -distanceEps || t > 1 + distanceEps) continue;
    const clamped = Math.max(0, Math.min(1, t));
    out.push([
      a[0] + dx * clamped,
      a[1] + dy * clamped,
      a[2] + (b[2] - a[2]) * clamped,
    ]);
  }
  return out;
}

function cross2(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function uniqueSorted(values: number[], tolerance: number) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (value < -tolerance) continue;
    if (!out.length || Math.abs(value - out[out.length - 1]) > tolerance) out.push(value);
  }
  return out;
}

function raySegmentParameter(origin: CamCLPoint, dir: [number, number], a: CamPoint3, b: CamPoint3, tolerance: number) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const wx = a[0] - origin.x;
  const wy = a[1] - origin.y;
  const denom = cross2(dir[0], dir[1], ex, ey);
  if (Math.abs(denom) <= tolerance) return null;
  const rayT = cross2(wx, wy, ex, ey) / denom;
  const edgeT = cross2(wx, wy, dir[0], dir[1]) / denom;
  if (rayT < -tolerance || edgeT < -tolerance || edgeT > 1 + tolerance) return null;
  return Math.max(0, rayT);
}

function rayTriangleIntervals(origin: CamCLPoint, dir: [number, number], triangle: NormalizedTriangle, radius: number, tolerance: number) {
  const vertices = [triangle.a, triangle.b, triangle.c];
  const tValues = [0, radius];
  for (let index = 0; index < 3; index += 1) {
    const t = raySegmentParameter(origin, dir, vertices[index], vertices[(index + 1) % 3], tolerance);
    if (t != null && t <= radius + tolerance) tValues.push(Math.min(radius, t));
  }
  const sorted = uniqueSorted(tValues, tolerance);
  const intervals: Array<[number, number]> = [];
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const a = Math.max(0, sorted[index]);
    const b = Math.min(radius, sorted[index + 1]);
    if (b < a + tolerance) continue;
    const mid = (a + b) * 0.5;
    const x = origin.x + dir[0] * mid;
    const y = origin.y + dir[1] * mid;
    if (pointInsideTriangleXY(triangle, x, y, tolerance)) intervals.push([a, b]);
  }
  for (const t of sorted) {
    const clamped = Math.max(0, Math.min(radius, t));
    const x = origin.x + dir[0] * clamped;
    const y = origin.y + dir[1] * clamped;
    if (!pointInsideTriangleXY(triangle, x, y, tolerance)) continue;
    intervals.push([clamped, clamped]);
  }
  return intervals;
}

function evaluateRayProfileContact(
  origin: CamCLPoint,
  triangle: NormalizedTriangle,
  cutter: CamCutterProfile,
  dir: [number, number],
  minT: number,
  maxT: number,
  areaEps: number,
) {
  const valueAt = (t: number) => {
    const h = cutter.heightAtRadius(t);
    if (h == null) return null;
    const x = origin.x + dir[0] * t;
    const y = origin.y + dir[1] * t;
    const plane = trianglePlaneAtXY(triangle, x, y, areaEps);
    if (!plane) return null;
    return plane.z - h;
  };

  let bestT = minT;
  let bestValue = valueAt(minT);
  const consider = (t: number) => {
    const value = valueAt(t);
    if (value == null) return;
    if (bestValue == null || value > bestValue) {
      bestValue = value;
      bestT = t;
    }
  };

  consider(maxT);
  consider((minT + maxT) * 0.5);
  for (const segment of cutter.segments || []) {
    if (segment.maxRadius > minT && segment.maxRadius < maxT) consider(segment.maxRadius);
    if (segment.minRadius > minT && segment.minRadius < maxT) consider(segment.minRadius);
  }

  if (maxT > minT + EPS) {
    let left = minT;
    let right = maxT;
    for (let index = 0; index < 28; index += 1) {
      const m1 = left + (right - left) / 3;
      const m2 = right - (right - left) / 3;
      const v1 = valueAt(m1);
      const v2 = valueAt(m2);
      if ((v1 ?? -Infinity) < (v2 ?? -Infinity)) left = m1;
      else right = m2;
    }
    consider((left + right) * 0.5);
  }

  if (bestValue == null) return null;
  const plane = trianglePlaneAtXY(triangle, origin.x + dir[0] * bestT, origin.y + dir[1] * bestT, areaEps);
  if (!plane) return null;
  return {
    point: [origin.x + dir[0] * bestT, origin.y + dir[1] * bestT, plane.z] as CamPoint3,
    requiredZ: bestValue,
    distance: bestT,
  };
}

function contactDistance(point: CamCLPoint, contactPoint: CamPoint3) {
  return Math.hypot(contactPoint[0] - point.x, contactPoint[1] - point.y);
}

function evaluateContactPoint(
  point: CamCLPoint,
  cutter: CamCutterProfile,
  triangle: NormalizedTriangle,
  contactPoint: CamPoint3,
  type: CamContactType,
  areaEps: number,
) {
  const distance = contactDistance(point, contactPoint);
  const cutterHeight = cutter.heightAtRadius(distance);
  if (cutterHeight == null) return null;

  const plane = trianglePlaneAtXY(triangle, contactPoint[0], contactPoint[1], areaEps);
  const surfaceZ = plane ? plane.z : contactPoint[2];
  return {
    requiredZ: surfaceZ - cutterHeight,
    contact: {
      type,
      point: [contactPoint[0], contactPoint[1], surfaceZ] as CamPoint3,
      triangleId: triangle.id,
      distance,
    } as CamContact,
  };
}

function collectTriangleContacts(
  point: CamCLPoint,
  cutter: CamCutterProfile,
  triangle: NormalizedTriangle,
  tolerance: ReturnType<typeof toleranceWithDefaults>,
  warnings: string[],
) {
  const contacts: Array<{ requiredZ: number; contact: CamContact }> = [];
  const seen = new Set<string>();
  const consider = (contactPoint: CamPoint3, type: CamContactType) => {
    if (!Number.isFinite(contactPoint[0]) || !Number.isFinite(contactPoint[1]) || !Number.isFinite(contactPoint[2])) {
      warnings.push(`Triangle ${triangle.id} produced a non-finite drop-cutter contact candidate.`);
      return;
    }
    const key = `${Math.round(contactPoint[0] / tolerance.pointEps)},${Math.round(contactPoint[1] / tolerance.pointEps)},${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    const contact = evaluateContactPoint(point, cutter, triangle, contactPoint, type, tolerance.areaEps);
    if (contact && Number.isFinite(contact.requiredZ)) contacts.push(contact);
  };

  for (const vertex of [triangle.a, triangle.b, triangle.c]) consider(vertex, 'vertex');

  const axisPlane = trianglePlaneAtXY(triangle, point.x, point.y, tolerance.areaEps);
  if (axisPlane && axisPlane.u >= -tolerance.areaEps && axisPlane.v >= -tolerance.areaEps && axisPlane.u + axisPlane.v <= 1 + tolerance.areaEps) {
    consider([point.x, point.y, axisPlane.z], 'facet');
  }

  const edges: Array<[CamPoint3, CamPoint3]> = [
    [triangle.a, triangle.b],
    [triangle.b, triangle.c],
    [triangle.c, triangle.a],
  ];
  for (const [a, b] of edges) {
    consider(closestPointOnSegmentXY(point, a, b).point, 'edge');
    for (const intersection of circleSegmentIntersectionsXY(point, cutter.radius, a, b, tolerance.distanceEps)) {
      consider(intersection, 'edge');
    }
  }

  const gradient = triangleGradientXY(triangle, tolerance.areaEps);
  const profileDirections: Array<[number, number]> = [];
  if (gradient) {
    const gradientLength = Math.hypot(gradient[0], gradient[1]);
    if (gradientLength > tolerance.angleEps) {
      profileDirections.push([gradient[0] / gradientLength, gradient[1] / gradientLength]);
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI / 4;
    profileDirections.push([Math.cos(angle), Math.sin(angle)]);
  }

  const directionKeys = new Set<string>();
  for (const dir of profileDirections) {
    const key = `${Math.round(dir[0] * 1e6)},${Math.round(dir[1] * 1e6)}`;
    if (directionKeys.has(key)) continue;
    directionKeys.add(key);
    for (const [minT, maxT] of rayTriangleIntervals(point, dir, triangle, cutter.radius, tolerance.distanceEps)) {
      const profileContact = evaluateRayProfileContact(point, triangle, cutter, dir, minT, maxT, tolerance.areaEps);
      if (!profileContact) continue;
      contacts.push({
        requiredZ: profileContact.requiredZ,
        contact: {
          type: 'tool-profile',
          point: profileContact.point,
          triangleId: triangle.id,
          distance: profileContact.distance,
        },
      });
    }
  }

  return contacts;
}

function dropCutterAtPreparedPoint(
  pointInput: CamCLPoint | CamPoint3,
  cutter: CamCutterProfile,
  triangles: NormalizedTriangle[],
  trianglesById: Map<number, NormalizedTriangle>,
  index: ReturnType<typeof buildCamTriangleSpatialIndex> | null,
  floorZ: number,
  tolerance: ReturnType<typeof toleranceWithDefaults>,
) {
  const warnings: string[] = [];
  const point = normalizePoint(pointInput, floorZ, warnings);
  if (!point) {
    return {
      point: { x: 0, y: 0, z: floorZ, contact: { type: 'none' as CamContactType } },
      candidateCount: 0,
      contactCount: 0,
      warnings,
    };
  }

  const validationErrors = cutter.validate();
  if (validationErrors.length) {
    return {
      point: { ...point, z: floorZ, contact: { type: 'none' as CamContactType, detail: 'Invalid cutter profile.' } },
      candidateCount: 0,
      contactCount: 0,
      warnings: validationErrors,
    };
  }
  if (!triangles.length) {
    return {
      point: { ...clonePoint(point), z: floorZ, contact: { type: 'none' as CamContactType, detail: EMPTY_MESH_WARNING } },
      candidateCount: 0,
      contactCount: 0,
      warnings: [EMPTY_MESH_WARNING],
    };
  }

  const queryBounds = cutterQueryBounds(point, cutter);
  const candidateIds = index
    ? index.queryAabb(queryBounds, 'xy')
    : queryCamTriangleAabbBruteForce(triangles, queryBounds, 'xy');
  let safeZ = Math.max(floorZ, finiteNumber(point.z, floorZ));
  let winningContact: CamContact = { type: 'none' };
  let contactCount = 0;

  for (const id of candidateIds) {
    const triangle = trianglesById.get(id);
    if (!triangle) continue;
    const contacts = collectTriangleContacts(point, cutter, triangle, tolerance, warnings);
    for (const contact of contacts) {
      contactCount += 1;
      if (contact.requiredZ > safeZ + tolerance.distanceEps) {
        safeZ = contact.requiredZ;
        winningContact = contact.contact;
      }
    }
  }

  return {
    point: {
      ...clonePoint(point),
      z: safeZ,
      contact: winningContact,
    },
    candidateCount: candidateIds.length,
    contactCount,
    warnings,
  };
}

export function dropCutterAtPoint(input: CamPointDropInput): CamPointDropOutput {
  const triangles = normalizeCamTriangles(input.triangles || []);
  const trianglesById = buildTriangleMap(triangles);
  const cutter = normalizeCutter(input.cutter);
  const floorZ = finiteNumber(input.floorZ, 0);
  return dropCutterAtPreparedPoint(
    input.point,
    cutter,
    triangles,
    trianglesById,
    input.index || null,
    floorZ,
    toleranceWithDefaults(input.tolerance),
  );
}

export function createDropCutterProjector(input: CamDropCutterProjectorInput): CamDropCutterProjector {
  const triangles = normalizeCamTriangles(input.triangles || []);
  const trianglesById = buildTriangleMap(triangles);
  const cutter = normalizeCutter(input.cutter);
  const floorZ = finiteNumber(input.floorZ, 0);
  const tolerance = toleranceWithDefaults(input.tolerance);
  const builtIndex = input.index
    ? { index: input.index, warnings: [] }
    : (triangles.length ? buildCamTriangleSpatialIndexWithFallback(triangles, input.indexOptions) : { index: null, warnings: [] });
  const index = builtIndex.index;
  return {
    cutter,
    index,
    warnings: builtIndex.warnings.slice(),
    dropPoint(point: CamCLPoint | CamPoint3) {
      return dropCutterAtPreparedPoint(
        point,
        cutter,
        triangles,
        trianglesById,
        index,
        floorZ,
        tolerance,
      );
    },
  };
}

function emitProgress(input: CamBatchDropInput, progress: CamDropCutterProgress) {
  if (typeof input.onProgress !== 'function') return;
  input.onProgress({
    total: 100,
    ...progress,
  });
  const aliasPhase = ({
    'batch-drop-index': 'prepare-drop-index',
    'batch-drop-points': 'drop-points',
    'batch-drop-complete': 'drop-complete',
  } as Record<string, string>)[progress.phase];
  if (aliasPhase) {
    input.onProgress({
      total: 100,
      ...progress,
      phase: aliasPhase,
    });
  }
}

async function yieldProgress(input: CamBatchDropInput) {
  if (typeof input.progressYield === 'function') await input.progressYield();
}

function pointWarningLabel(pointInput: CamCLPoint | CamPoint3, index: number) {
  if (!pointInput || typeof pointInput !== 'object' || Array.isArray(pointInput)) return `${index}`;
  const id = String((pointInput as CamCLPoint).id || '').trim();
  const pathId = String((pointInput as CamCLPoint).pathId || '').trim();
  const details = [
    pathId ? `path ${pathId}` : '',
    id ? `id ${id}` : '',
  ].filter(Boolean).join(', ');
  return details ? `${index} (${details})` : `${index}`;
}

export async function dropCutterBatch(input: CamBatchDropInput): Promise<CamBatchDropOutput> {
  const sourcePoints = Array.isArray(input.points) ? input.points : [];
  const floorZ = finiteNumber(input.floorZ, 0);
  const cutter = normalizeCutter(input.cutter);
  const warnings = cutter.validate().slice();
  if (!sourcePoints.length) {
    return {
      points: [],
      summary: {
        pointCount: 0,
        candidateCount: 0,
        contactCount: 0,
        warningCount: warnings.length,
      },
      warnings,
    };
  }
  if (warnings.length) {
    const detail = 'Invalid cutter profile.';
    return {
      points: sourcePoints.map((point) => noContactPointFromInput(point, floorZ, detail)),
      summary: {
        pointCount: sourcePoints.length,
        candidateCount: 0,
        contactCount: 0,
        warningCount: warnings.length,
      },
      warnings,
    };
  }

  emitProgress(input, {
    phase: 'batch-drop-prepare',
    message: 'Preparing drop-cutter points',
    detail: `${sourcePoints.length} point${sourcePoints.length === 1 ? '' : 's'}`,
    current: 2,
    total: 100,
  });
  await yieldProgress(input);

  const triangles = normalizeCamTriangles(input.triangles || []);
  const trianglesById = buildTriangleMap(triangles);
  emitProgress(input, {
    phase: 'batch-drop-index',
    message: 'Building drop-cutter triangle index',
    detail: `${triangles.length} triangle${triangles.length === 1 ? '' : 's'}`,
    current: 8,
    total: 100,
  });
  await yieldProgress(input);
  const builtIndex = input.index
    ? { index: input.index, warnings: [] }
    : buildCamTriangleSpatialIndexWithFallback(triangles, input.indexOptions);
  warnings.push(...builtIndex.warnings);
  const index = builtIndex.index;
  const tolerance = toleranceWithDefaults(input.tolerance);
  const chunkSize = positiveInteger(input.chunkSize, 128);
  const out: CamCLPoint[] = [];
  let candidateCount = 0;
  let contactCount = 0;

  for (let start = 0; start < sourcePoints.length; start += chunkSize) {
    const end = Math.min(sourcePoints.length, start + chunkSize);
    for (let indexInChunk = start; indexInChunk < end; indexInChunk += 1) {
      const result = dropCutterAtPreparedPoint(
        sourcePoints[indexInChunk],
        cutter,
        triangles,
        trianglesById,
        index,
        floorZ,
        tolerance,
      );
      out[indexInChunk] = result.point;
      candidateCount += result.candidateCount;
      contactCount += result.contactCount;
      for (const warning of result.warnings) {
        warnings.push(`Point ${pointWarningLabel(sourcePoints[indexInChunk], indexInChunk)}: ${warning}`);
      }
    }
    emitProgress(input, {
      phase: 'batch-drop-points',
      message: 'Projecting drop-cutter points',
      detail: `${end} of ${sourcePoints.length}`,
      current: 10 + (end / sourcePoints.length) * 84,
      total: 100,
    });
    await yieldProgress(input);
  }

  emitProgress(input, {
    phase: 'batch-drop-complete',
    message: 'Drop-cutter projection complete',
    detail: `${out.length} point${out.length === 1 ? '' : 's'} projected.`,
    current: 100,
    total: 100,
  });

  return {
    points: out,
    summary: {
      pointCount: out.length,
      candidateCount,
      contactCount,
      warningCount: warnings.length,
    },
    warnings,
  };
}
