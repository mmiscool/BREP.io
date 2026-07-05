import { ListEntityBase } from '../core/entities/ListEntityBase.js';
import { normalizeCamMachineProfile, type CamMachineProfile } from './CamMachineProfile.js';
import {
  CAM_TOOLPATH_SCHEMA_VERSION,
  generateGcodeForCamToolpathProgram,
  makeBallEndMillCutter,
  makeEmptyCamToolpathProgram,
  normalizeCamOrientation,
  summarizeCamToolpathProgram,
  type CamBounds,
  type CamCutterDefinition,
  type CamCutterOrientation,
  type CamToolpathPath,
  type CamToolpathPoint,
  type CamToolpathProgram,
  type CamToolpathSegment,
} from './CamToolpathDefinition.js';
import {
  EPS,
  extractTrianglesFromFace,
  extractTrianglesFromSolid,
  finiteNumber,
  positiveNumber,
  resolveSceneFromContext,
  resolveTargetSolids,
  roundCoord,
  triangleBounds,
  type AnyRecord,
  type Triangle,
} from './ShadowCutterEntity.js';

export const CAM_OPERATION_TYPE_SURFACING = 'surfacing';

type ScanlineRun = {
  scanline: number;
  points: Array<[number, number, number]>;
  rawPointCount?: number;
  filteredPointCount?: number;
};

type ScanlineInterval = {
  start: number;
  end: number;
};

const inputParamsSchema = {
  id: {
    type: 'string',
    default_value: null,
    hint: 'Unique identifier for this surfacing operation.',
  },
  name: {
    type: 'string',
    default_value: 'Surfacing',
    hint: 'Display name for this surfacing operation.',
  },
  enabled: {
    type: 'boolean',
    default_value: true,
    hint: 'Include this operation when generating CAM output.',
  },
  targetFaces: {
    type: 'reference_selection',
    selectionFilter: ['FACE'],
    multiple: true,
    default_value: [],
    hint: 'Faces to surface with the ball end mill. Passes are clipped to the projected footprint of these faces.',
  },
  toolDiameter: {
    type: 'number',
    default_value: 3.175,
    hint: 'Ball end mill diameter in model units.',
  },
  toolLength: {
    type: 'number',
    default_value: 25,
    hint: 'Cutter cutting length in model units.',
  },
  stepover: {
    type: 'number',
    default_value: 0.8,
    hint: 'Distance between adjacent surfacing passes.',
  },
  stockAllowance: {
    type: 'number',
    default_value: 0,
    hint: 'Material to leave on the surface. The ball contact is offset outward by this amount.',
  },
  linkClearance: {
    type: 'number',
    default_value: 0.5,
    hint: 'Clearance above local model geometry for non-cutting links between surfacing runs.',
  },
  pathTolerance: {
    type: 'number',
    default_value: 0.01,
    hint: 'Maximum 3D deviation allowed when removing redundant surfacing samples. Set to 0 to preserve all samples.',
  },
  rasterDirection: {
    type: 'options',
    options: ['X', 'Y'],
    default_value: 'X',
    hint: 'Direction the surfacing passes travel.',
  },
  safeHeight: {
    type: 'number',
    default_value: 5,
    hint: 'Clearance above the part top before and after cutting.',
  },
  feedRate: {
    type: 'number',
    default_value: 800,
    hint: 'Cutting feed rate.',
  },
  plungeRate: {
    type: 'number',
    default_value: 200,
    hint: 'Vertical plunge feed rate.',
  },
  spindleRPM: {
    type: 'number',
    default_value: 12000,
    hint: 'Requested spindle speed.',
  },
};

export class SurfacingEntity extends ListEntityBase {
  static entityType = CAM_OPERATION_TYPE_SURFACING;
  static shortName = 'SF';
  static longName = 'Surfacing';
  static inputParamsSchema = inputParamsSchema;

  static uiFieldsTest(_context: AnyRecord = {}) {
    return { exclude: ['enabled'] };
  }

  run(context: AnyRecord = {}) {
    return this.generateToolpath(context);
  }

  generateToolpath(context: AnyRecord = {}): CamToolpathProgram {
    const params = this.inputParams || {};
    const machine = normalizeCamMachineProfile(context.machineProfile);
    const operationId = String(params.id || this.id || 'SF');
    const operationName = String(params.name || 'Surfacing');
    const warnings: string[] = [];
    const toolDiameter = positiveNumber(params.toolDiameter, 3.175);
    const toolLength = positiveNumber(params.toolLength, 25);
    const cutter = makeBallEndMillCutter({
      id: `${operationId}-CUTTER`,
      diameter: toolDiameter,
      cuttingLength: toolLength,
      overallLength: toolLength,
    });
    const toolRadius = toolDiameter * 0.5;
    const stockAllowance = Math.max(0, finiteNumber(params.stockAllowance, 0));
    const contactRadius = toolRadius + stockAllowance;
    const linkClearance = Math.max(0, finiteNumber(params.linkClearance, 0.5));
    const pathTolerance = Math.max(0, finiteNumber(params.pathTolerance, 0.01));
    const stepover = positiveNumber(params.stepover, 0.8, EPS);
    const feedRate = positiveNumber(params.feedRate, 800, 1);
    const plungeRate = positiveNumber(params.plungeRate, 200, 1);
    const rasterDirection = String(params.rasterDirection || 'X').toUpperCase() === 'Y' ? 'Y' : 'X';
    const spindleRPM = Math.min(
      positiveNumber(params.spindleRPM, 12000, 1),
      Math.max(1, Number(machine.maxSpindleRPM) || 1),
    );

    const viewer = context.viewer || context.partHistory?.viewer || this.history?.partHistory?.viewer || null;
    const partHistory = context.partHistory || viewer?.partHistory || this.history?.partHistory || null;
    const faces = resolveTargetFaces({ viewer, partHistory }, params.targetFaces);
    if (!faces.length) {
      return makeEmptySurfacingResult({
        operationId,
        operationName,
        machine,
        cutter,
        spindleRPM,
        warnings: ['Select one or more faces to surface.'],
      });
    }
    const faceTriangles: Triangle[] = [];
    for (const face of faces) faceTriangles.push(...extractTrianglesFromFace(face));
    if (!faceTriangles.length) {
      return makeEmptySurfacingResult({
        operationId,
        operationName,
        machine,
        cutter,
        spindleRPM,
        warnings: ['Selected faces do not contain any mesh triangles.'],
      });
    }

    // Gouge safety checks the whole part, not just the selected faces.
    const obstacleSolids = resolveTargetSolids({ viewer, partHistory }, []);
    const obstacleTriangles: Triangle[] = [];
    for (const solid of obstacleSolids) obstacleTriangles.push(...extractTrianglesFromSolid(solid));
    if (!obstacleTriangles.length) obstacleTriangles.push(...faceTriangles);
    const targetBounds = triangleBounds(obstacleTriangles);
    if (!targetBounds) {
      return makeEmptySurfacingResult({
        operationId,
        operationName,
        machine,
        cutter,
        spindleRPM,
        warnings: ['No target geometry is available for Surfacing generation.'],
      });
    }

    const footprint = new TriangleFootprint(faceTriangles);
    const dropCutter = new DropCutterIndex(obstacleTriangles, contactRadius);
    const sampleStep = Math.max(0.02, Math.min(stepover, toolRadius * 0.5));
    const runs = buildSurfacingRuns({
      footprint,
      dropCutter,
      rasterDirection,
      stepover,
      sampleStep,
      toolRadius,
      pathTolerance,
    });
    if (!runs.length) {
      return makeEmptySurfacingResult({
        operationId,
        operationName,
        machine,
        targetBounds,
        cutter,
        spindleRPM,
        warnings: ['Selected faces have no projected area to surface. Vertical faces cannot be surfaced top-down.'],
      });
    }

    const topZ = targetBounds.max[2];
    const safeHeight = Math.max(0, finiteNumber(params.safeHeight, 5));
    const safeZ = roundCoord(Math.max(Number(machine.safeParkZ) || 0, topZ + safeHeight));
    const orientation = normalizeCamOrientation({ toolAxis: [0, 0, -1], forward: [1, 0, 0] });
    const path = makeSurfacingPath({
      id: `${operationId}-SURF`,
      operationId,
      operationName,
      runs,
      footprint,
      dropCutter,
      toolRadius,
      sampleStep,
      stepover,
      safeZ,
      linkClearance,
      pathTolerance,
      cutter,
      orientation,
      feedRate,
      plungeRate,
      spindleRPM,
    });
    const paths = [path];
    const bounds = boundsFromSurfacingPath(path, targetBounds);
    const resultBase: Omit<CamToolpathProgram, 'gcode'> = {
      schemaVersion: CAM_TOOLPATH_SCHEMA_VERSION,
      operationId,
      operationName,
      units: 'mm',
      coordinateSystem: 'machine',
      generatedAt: new Date().toISOString(),
      machine,
      bounds,
      targetBounds,
      safeZ,
      cutter,
      spindleRPM,
      paths,
      summary: summarizeCamToolpathProgram({
        paths,
        targetCount: faces.length,
        triangleCount: obstacleTriangles.length,
        levelCount: runs.length,
        warningCount: warnings.length,
      }),
      warnings,
      metadata: {
        strategy: 'surfacing',
        faceCount: faces.length,
        faceNames: faces.map((face) => String(face?.name || '')).filter(Boolean),
        runCount: runs.length,
        rasterDirection,
        stepover: roundCoord(stepover),
        sampleStep: roundCoord(sampleStep),
        stockAllowance: roundCoord(stockAllowance),
        linkClearance: roundCoord(linkClearance),
        pathTolerance: roundCoord(pathTolerance),
      },
    };
    return { ...resultBase, gcode: generateGcodeForCamToolpathProgram(resultBase) };
  }

  onIdChanged() {}

  onParamsChanged() {}

  onPersistentDataChanged() {}
}

function resolveTargetFaces(context: AnyRecord, selection: any = null) {
  const viewer = context.viewer || null;
  const partHistory = context.partHistory || viewer?.partHistory || null;
  const scene = resolveSceneFromContext({ viewer, partHistory });
  const list = Array.isArray(selection) ? selection : (selection ? [selection] : []);
  const out: any[] = [];
  const seen = new Set<any>();
  for (const item of list) {
    let face: any = null;
    if (item && typeof item === 'object' && String(item.type || '').toUpperCase() === 'FACE') {
      face = item;
    } else {
      const name = String(item?.name || item?.id || item || '');
      if (!name) continue;
      const resolved = scene?.getObjectByName?.(name) || partHistory?.getObjectByName?.(name) || null;
      if (resolved && String(resolved.type || '').toUpperCase() === 'FACE') face = resolved;
    }
    if (!face || seen.has(face)) continue;
    seen.add(face);
    out.push(face);
  }
  return out;
}

// 2D spatial hash over triangle XY footprints for point-in-footprint tests.
class TriangleFootprint {
  triangles: Triangle[];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  cellSize = 1;
  cells = new Map<string, number[]>();

  constructor(triangles: Triangle[]) {
    this.triangles = triangles.filter((triangle) => projectedTriangleAreaXY(triangle) > EPS);
    for (const triangle of this.triangles) {
      for (const point of triangle) {
        this.minX = Math.min(this.minX, point[0]);
        this.maxX = Math.max(this.maxX, point[0]);
        this.minY = Math.min(this.minY, point[1]);
        this.maxY = Math.max(this.maxY, point[1]);
      }
    }
    if (!this.triangles.length) return;
    const extent = Math.max(this.maxX - this.minX, this.maxY - this.minY, EPS);
    this.cellSize = Math.max(extent / 64, 1e-3);
    this.triangles.forEach((triangle, index) => {
      const xs = triangle.map((point) => point[0]);
      const ys = triangle.map((point) => point[1]);
      this.visitCells(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (key) => {
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(index);
      });
    });
  }

  visitCells(minX: number, minY: number, maxX: number, maxY: number, visit: (key: string) => void) {
    const x0 = Math.floor((minX - this.minX) / this.cellSize);
    const x1 = Math.floor((maxX - this.minX) / this.cellSize);
    const y0 = Math.floor((minY - this.minY) / this.cellSize);
    const y1 = Math.floor((maxY - this.minY) / this.cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        visit(`${cx},${cy}`);
      }
    }
  }

  contains(px: number, py: number) {
    if (!this.triangles.length) return false;
    if (px < this.minX - EPS || px > this.maxX + EPS || py < this.minY - EPS || py > this.maxY + EPS) return false;
    const cx = Math.floor((px - this.minX) / this.cellSize);
    const cy = Math.floor((py - this.minY) / this.cellSize);
    const bucket = this.cells.get(`${cx},${cy}`);
    if (!bucket) return false;
    for (const index of bucket) {
      if (pointInTriangleXY(px, py, this.triangles[index])) return true;
    }
    return false;
  }

  scanlineIntervals(rasterDirection: 'X' | 'Y', lineCoord: number): ScanlineInterval[] {
    const alongX = rasterDirection === 'X';
    const intervals: ScanlineInterval[] = [];
    for (const triangle of this.triangles) {
      const interval = triangleScanlineInterval(triangle, lineCoord, alongX);
      if (interval) intervals.push(interval);
    }
    return mergeScanlineIntervals(intervals);
  }
}

function projectedTriangleAreaXY(triangle: Triangle) {
  const [a, b, c] = triangle;
  return Math.abs(
    ((a[0] * (b[1] - c[1])) + (b[0] * (c[1] - a[1])) + (c[0] * (a[1] - b[1]))) * 0.5,
  );
}

function pointInTriangleXY(px: number, py: number, triangle: Triangle) {
  const [a, b, c] = triangle;
  const d1 = signXY(px, py, a, b);
  const d2 = signXY(px, py, b, c);
  const d3 = signXY(px, py, c, a);
  const hasNegative = (d1 < -EPS) || (d2 < -EPS) || (d3 < -EPS);
  const hasPositive = (d1 > EPS) || (d2 > EPS) || (d3 > EPS);
  return !(hasNegative && hasPositive);
}

function triangleScanlineInterval(triangle: Triangle, lineCoord: number, alongX: boolean): ScanlineInterval | null {
  const lineAxis = alongX ? 1 : 0;
  const travelAxis = alongX ? 0 : 1;
  const hits: number[] = [];
  const addHit = (value: number) => {
    if (Number.isFinite(value)) hits.push(value);
  };
  for (let index = 0; index < 3; index += 1) {
    const a = triangle[index];
    const b = triangle[(index + 1) % 3];
    const aLine = a[lineAxis];
    const bLine = b[lineAxis];
    const aTravel = a[travelAxis];
    const bTravel = b[travelAxis];
    const delta = bLine - aLine;
    if (Math.abs(delta) <= EPS) {
      if (Math.abs(lineCoord - aLine) <= EPS) {
        addHit(aTravel);
        addHit(bTravel);
      }
      continue;
    }
    if (lineCoord < Math.min(aLine, bLine) - EPS || lineCoord > Math.max(aLine, bLine) + EPS) continue;
    const t = (lineCoord - aLine) / delta;
    if (t < -EPS || t > 1 + EPS) continue;
    addHit(aTravel + ((bTravel - aTravel) * Math.min(1, Math.max(0, t))));
  }
  if (hits.length < 2) return null;
  const unique = hits
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > EPS);
  if (unique.length < 2) return null;
  const start = unique[0];
  const end = unique[unique.length - 1];
  return end - start > EPS ? { start, end } : null;
}

function mergeScanlineIntervals(intervals: ScanlineInterval[]) {
  if (!intervals.length) return [];
  const sorted = intervals
    .map((interval) => ({
      start: Math.min(interval.start, interval.end),
      end: Math.max(interval.start, interval.end),
    }))
    .filter((interval) => interval.end - interval.start > EPS)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ScanlineInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end + EPS) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function signXY(px: number, py: number, a: [number, number, number], b: [number, number, number]) {
  return ((px - b[0]) * (a[1] - b[1])) - ((a[0] - b[0]) * (py - b[1]));
}

// Drop-cutter: highest ball-nose position over the obstacle mesh at (x, y).
class DropCutterIndex {
  triangles: Triangle[];
  radius: number;
  minX = Infinity;
  minY = Infinity;
  cellSize = 1;
  cells = new Map<string, number[]>();

  constructor(triangles: Triangle[], radius: number) {
    this.triangles = triangles;
    this.radius = Math.max(radius, EPS);
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const triangle of triangles) {
      for (const point of triangle) {
        this.minX = Math.min(this.minX, point[0]);
        this.minY = Math.min(this.minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }
    const extent = Math.max(maxX - this.minX, maxY - this.minY, EPS);
    this.cellSize = Math.max(extent / 64, this.radius, 1e-3);
    triangles.forEach((triangle, index) => {
      const xs = triangle.map((point) => point[0]);
      const ys = triangle.map((point) => point[1]);
      const x0 = Math.floor((Math.min(...xs) - this.radius - this.minX) / this.cellSize);
      const x1 = Math.floor((Math.max(...xs) + this.radius - this.minX) / this.cellSize);
      const y0 = Math.floor((Math.min(...ys) - this.radius - this.minY) / this.cellSize);
      const y1 = Math.floor((Math.max(...ys) + this.radius - this.minY) / this.cellSize);
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const key = `${cx},${cy}`;
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(index);
        }
      }
    });
  }

  // Highest sphere-center Z (sphere radius = contact radius) touching the mesh
  // on the vertical line through (px, py); null when nothing is within reach.
  centerZ(px: number, py: number): number | null {
    const cx = Math.floor((px - this.minX) / this.cellSize);
    const cy = Math.floor((py - this.minY) / this.cellSize);
    const bucket = this.cells.get(`${cx},${cy}`);
    if (!bucket) return null;
    let best: number | null = null;
    for (const index of bucket) {
      const candidate = sphereCenterZOnTriangle(px, py, this.radius, this.triangles[index]);
      if (candidate !== null && (best === null || candidate > best)) best = candidate;
    }
    return best;
  }
}

function sphereCenterZOnTriangle(px: number, py: number, radius: number, triangle: Triangle): number | null {
  const radiusSq = radius * radius;
  let best: number | null = null;
  const consider = (value: number) => {
    if (best === null || value > best) best = value;
  };

  // Vertex contacts.
  for (const vertex of triangle) {
    const dx = px - vertex[0];
    const dy = py - vertex[1];
    const distSq = (dx * dx) + (dy * dy);
    if (distSq <= radiusSq) consider(vertex[2] + Math.sqrt(radiusSq - distSq));
  }

  // Edge contacts: maximize p.z + t*Dz + sqrt(r^2 - dxy^2(t)) over t in (0, 1).
  for (let index = 0; index < 3; index += 1) {
    const p = triangle[index];
    const q = triangle[(index + 1) % 3];
    const dX = q[0] - p[0];
    const dY = q[1] - p[1];
    const dZ = q[2] - p[2];
    const wX = p[0] - px;
    const wY = p[1] - py;
    const a2 = (dX * dX) + (dY * dY);
    if (a2 <= EPS) continue; // XY-vertical edge: vertex contacts cover it
    const b2 = 2 * ((wX * dX) + (wY * dY));
    const c2 = (wX * wX) + (wY * wY);
    // Critical points of the height function satisfy this quadratic in t.
    const qa = (4 * a2 * a2) + (4 * dZ * dZ * a2);
    const qb = (4 * a2 * b2) + (4 * dZ * dZ * b2);
    const qc = (b2 * b2) + (4 * dZ * dZ * (c2 - radiusSq));
    const discriminant = (qb * qb) - (4 * qa * qc);
    if (discriminant < 0) continue;
    const sqrtDisc = Math.sqrt(discriminant);
    for (const t of [(-qb - sqrtDisc) / (2 * qa), (-qb + sqrtDisc) / (2 * qa)]) {
      if (!(t > EPS && t < 1 - EPS)) continue;
      const distSq = (a2 * t * t) + (b2 * t) + c2;
      if (distSq >= radiusSq - EPS) continue;
      consider(p[2] + (t * dZ) + Math.sqrt(radiusSq - distSq));
    }
  }

  // Facet contact: sphere resting on the triangle plane with the touch point
  // inside the triangle. Vertical facets are covered by edge/vertex contacts.
  const ux = triangle[1][0] - triangle[0][0];
  const uy = triangle[1][1] - triangle[0][1];
  const uz = triangle[1][2] - triangle[0][2];
  const vx = triangle[2][0] - triangle[0][0];
  const vy = triangle[2][1] - triangle[0][1];
  const vz = triangle[2][2] - triangle[0][2];
  let nx = (uy * vz) - (uz * vy);
  let ny = (uz * vx) - (ux * vz);
  let nz = (ux * vy) - (uy * vx);
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength > EPS && Math.abs(nz / normalLength) > 1e-6) {
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const planeOffset = (nx * triangle[0][0]) + (ny * triangle[0][1]) + (nz * triangle[0][2]);
    const centerZ = (planeOffset + radius - (nx * px) - (ny * py)) / nz;
    const contactX = px - (radius * nx);
    const contactY = py - (radius * ny);
    if (pointInTriangleXY(contactX, contactY, triangle)) consider(centerZ);
  }

  return best;
}

function buildSurfacingRuns({
  footprint,
  dropCutter,
  rasterDirection,
  stepover,
  sampleStep,
  toolRadius,
  pathTolerance,
}: {
  footprint: TriangleFootprint;
  dropCutter: DropCutterIndex;
  rasterDirection: 'X' | 'Y';
  stepover: number;
  sampleStep: number;
  toolRadius: number;
  pathTolerance: number;
}): ScanlineRun[] {
  const alongX = rasterDirection === 'X';
  const lineMin = alongX ? footprint.minY : footprint.minX;
  const lineMax = alongX ? footprint.maxY : footprint.maxX;
  const travelMin = alongX ? footprint.minX : footprint.minY;
  const travelMax = alongX ? footprint.maxX : footprint.maxY;
  if (!(lineMax >= lineMin) || !(travelMax >= travelMin)) return [];
  const lineSteps = Math.max(0, Math.ceil((lineMax - lineMin) / stepover));
  const maxSampleSteps = Math.max(1, Math.ceil((travelMax - travelMin) / sampleStep));
  if ((lineSteps + 1) * (maxSampleSteps + 1) > 4_000_000) {
    throw new Error('Surfacing raster is too dense; increase stepover or reduce the selected area.');
  }
  const runs: ScanlineRun[] = [];
  for (let lineIndex = 0; lineIndex <= lineSteps; lineIndex += 1) {
    const lineCoord = lineIndex === lineSteps ? lineMax : Math.min(lineMax, lineMin + (lineIndex * stepover));
    const intervals = footprint.scanlineIntervals(rasterDirection, lineCoord);
    for (const interval of intervals) {
      let current: ScanlineRun | null = null;
      const sampleSteps = Math.max(1, Math.ceil((interval.end - interval.start) / sampleStep));
      for (let sampleIndex = 0; sampleIndex <= sampleSteps; sampleIndex += 1) {
        const travelCoord = sampleIndex === sampleSteps
          ? interval.end
          : Math.min(interval.end, interval.start + (sampleIndex * sampleStep));
        const px = alongX ? travelCoord : lineCoord;
        const py = alongX ? lineCoord : travelCoord;
        // Center is held contactRadius (= radius + allowance) off the part;
        // the real ball tip sits one tool radius below the center.
        const centerZ = dropCutter.centerZ(px, py);
        const tipZ = centerZ === null ? null : centerZ - toolRadius;
        if (tipZ === null) {
          finalizeSurfacingRun(runs, current, pathTolerance);
          current = null;
          continue;
        }
        if (!current) current = { scanline: lineIndex + 1, points: [] };
        current.points.push([roundCoord(px), roundCoord(py), roundCoord(tipZ)]);
      }
      finalizeSurfacingRun(runs, current, pathTolerance);
    }
  }
  return runs;
}

function finalizeSurfacingRun(runs: ScanlineRun[], run: ScanlineRun | null, pathTolerance: number) {
  if (!run || run.points.length < 2) return;
  const rawPointCount = run.points.length;
  const points = filterCutterLocationLine(run.points, pathTolerance);
  if (points.length < 2) return;
  runs.push({
    ...run,
    points,
    rawPointCount,
    filteredPointCount: rawPointCount - points.length,
  });
}

function makeSurfacingPath({
  id,
  operationId,
  operationName,
  runs,
  footprint,
  dropCutter,
  toolRadius,
  sampleStep,
  stepover,
  safeZ,
  linkClearance,
  pathTolerance,
  cutter,
  orientation,
  feedRate,
  plungeRate,
  spindleRPM,
}: {
  id: string;
  operationId: string;
  operationName: string;
  runs: ScanlineRun[];
  footprint: TriangleFootprint;
  dropCutter: DropCutterIndex;
  toolRadius: number;
  sampleStep: number;
  stepover: number;
  safeZ: number;
  linkClearance: number;
  pathTolerance: number;
  cutter: CamCutterDefinition;
  orientation: CamCutterOrientation;
  feedRate: number;
  plungeRate: number;
  spindleRPM: number;
}): CamToolpathPath {
  // Serpentine ordering: reverse every other run so passes flow back and forth.
  const ordered = runs.map((run, index) => (
    index % 2 === 1 ? { ...run, points: run.points.slice().reverse() } : run
  ));
  const first = ordered[0]?.points[0] || [0, 0, 0];
  const points: CamToolpathPoint[] = [{
    position: [first[0], first[1], roundCoord(safeZ)],
    orientation,
    metadata: { strategy: 'surfacing', safe: true },
  }];
  const segments: CamToolpathSegment[] = [];
  let currentIndex = 0;
  let segmentNumber = 1;
  const addMove = (
    kind: CamToolpathSegment['kind'],
    position: [number, number, number],
    metadata: Record<string, any>,
  ) => {
    const previous = points[currentIndex].position;
    if (
      Math.abs(previous[0] - position[0]) <= EPS
      && Math.abs(previous[1] - position[1]) <= EPS
      && Math.abs(previous[2] - position[2]) <= EPS
    ) return;
    const pointIndex = points.length;
    const pointMetadata = { strategy: 'surfacing', ...metadata };
    points.push({ position, orientation, metadata: pointMetadata });
    segments.push({
      id: `${id}-${segmentNumber++}-${kind.toUpperCase()}`,
      kind,
      startIndex: currentIndex,
      endIndex: pointIndex,
      orientation,
      cutter,
      feedRate: kind === 'plunge' ? plungeRate : feedRate,
      spindleRPM,
      metadata: pointMetadata,
    });
    currentIndex = pointIndex;
  };

  let previousRun: ScanlineRun | null = null;
  for (const run of ordered) {
    const start = run.points[0];
    const linked = previousRun
      ? tryLinkRuns({
        from: points[currentIndex].position,
        to: start,
        footprint,
        dropCutter,
        toolRadius,
        sampleStep,
        stepover,
        addMove,
        scanline: run.scanline,
        pathTolerance,
      })
      : false;
    const clearanceLinked = !linked && previousRun
      ? tryClearanceLinkRuns({
        from: points[currentIndex].position,
        to: start,
        dropCutter,
        toolRadius,
        sampleStep,
        safeZ,
        linkClearance,
        addMove,
        scanline: run.scanline,
      })
      : false;
    if (!linked && !clearanceLinked) {
      if (previousRun) {
        addMove('retract', [points[currentIndex].position[0], points[currentIndex].position[1], roundCoord(safeZ)], { safe: true, scanline: previousRun.scanline });
      }
      addMove('rapid', [start[0], start[1], roundCoord(safeZ)], { safe: true, scanline: run.scanline });
      addMove('plunge', start, { scanline: run.scanline });
    }
    for (let index = 1; index < run.points.length; index += 1) {
      addMove('cut', run.points[index], { scanline: run.scanline });
    }
    previousRun = run;
  }
  addMove('retract', [points[currentIndex].position[0], points[currentIndex].position[1], roundCoord(safeZ)], { safe: true });

  return {
    id,
    operationId,
    operationName,
    points,
    segments,
    cutter,
    defaultOrientation: orientation,
    feedRate,
    plungeRate,
    spindleRPM,
    metadata: {
      strategy: 'surfacing',
      runCount: runs.length,
      scanlineCount: new Set(runs.map((run) => run.scanline)).size,
      pointCount: points.length,
      rawCutPointCount: runs.reduce((sum, run) => sum + (run.rawPointCount || run.points.length), 0),
      filteredCutPointCount: runs.reduce((sum, run) => sum + (run.filteredPointCount || 0), 0),
      clearanceLinkCount: segments.filter((segment) => segment.metadata?.clearanceLink).length,
    },
  };
}

// Try to travel between adjacent runs while staying on the surface: sample the
// straight XY link with the drop cutter. Only allowed when the whole link stays
// over the selected footprint, so the tool never grazes unselected geometry.
function tryLinkRuns({
  from,
  to,
  footprint,
  dropCutter,
  toolRadius,
  sampleStep,
  stepover,
  addMove,
  scanline,
  pathTolerance,
}: {
  from: [number, number, number];
  to: [number, number, number];
  footprint: TriangleFootprint;
  dropCutter: DropCutterIndex;
  toolRadius: number;
  sampleStep: number;
  stepover: number;
  addMove: (kind: CamToolpathSegment['kind'], position: [number, number, number], metadata: Record<string, any>) => void;
  scanline: number;
  pathTolerance: number;
}) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (distance > stepover * 2.5) return false;
  const steps = Math.max(1, Math.ceil(distance / Math.max(sampleStep, EPS)));
  const linkPoints: Array<[number, number, number]> = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const px = from[0] + ((to[0] - from[0]) * t);
    const py = from[1] + ((to[1] - from[1]) * t);
    if (!footprint.contains(px, py)) return false;
    const centerZ = dropCutter.centerZ(px, py);
    if (centerZ === null) return false;
    linkPoints.push([roundCoord(px), roundCoord(py), roundCoord(centerZ - toolRadius)]);
  }
  const filtered = filterCutterLocationLine([from, ...linkPoints], pathTolerance);
  for (let index = 1; index < filtered.length; index += 1) {
    addMove('cut', filtered[index], { scanline, link: true });
  }
  return true;
}

function filterCutterLocationLine(points: Array<[number, number, number]>, tolerance: number) {
  if (!Array.isArray(points) || points.length < 3 || !(tolerance > EPS)) return points.slice();
  const out: Array<[number, number, number]> = [points[0]];
  let anchorIndex = 0;
  let candidateIndex = 2;
  while (candidateIndex < points.length) {
    if (lineFilterCanRemoveIntermediate(points, anchorIndex, candidateIndex, tolerance)) {
      candidateIndex += 1;
      continue;
    }
    out.push(points[candidateIndex - 1]);
    anchorIndex = candidateIndex - 1;
    candidateIndex = anchorIndex + 2;
  }
  const last = points[points.length - 1];
  const previous = out[out.length - 1];
  if (!samePoint3(previous, last)) out.push(last);
  return out;
}

function lineFilterCanRemoveIntermediate(points: Array<[number, number, number]>, anchorIndex: number, candidateIndex: number, tolerance: number) {
  const anchor = points[anchorIndex];
  const candidate = points[candidateIndex];
  for (let index = anchorIndex + 1; index < candidateIndex; index += 1) {
    if (distancePointToSegment3D(points[index], anchor, candidate) > tolerance) return false;
  }
  return true;
}

function distancePointToSegment3D(point: [number, number, number], a: [number, number, number], b: [number, number, number]) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const lenSq = (abx * abx) + (aby * aby) + (abz * abz);
  if (lenSq <= EPS * EPS) return Math.hypot(point[0] - a[0], point[1] - a[1], point[2] - a[2]);
  const t = Math.max(0, Math.min(1, (((point[0] - a[0]) * abx) + ((point[1] - a[1]) * aby) + ((point[2] - a[2]) * abz)) / lenSq));
  const x = a[0] + (abx * t);
  const y = a[1] + (aby * t);
  const z = a[2] + (abz * t);
  return Math.hypot(point[0] - x, point[1] - y, point[2] - z);
}

function samePoint3(a: [number, number, number] | undefined, b: [number, number, number] | undefined) {
  return Boolean(a && b
    && Math.abs(a[0] - b[0]) <= EPS
    && Math.abs(a[1] - b[1]) <= EPS
    && Math.abs(a[2] - b[2]) <= EPS);
}

function tryClearanceLinkRuns({
  from,
  to,
  dropCutter,
  toolRadius,
  sampleStep,
  safeZ,
  linkClearance,
  addMove,
  scanline,
}: {
  from: [number, number, number];
  to: [number, number, number];
  dropCutter: DropCutterIndex;
  toolRadius: number;
  sampleStep: number;
  safeZ: number;
  linkClearance: number;
  addMove: (kind: CamToolpathSegment['kind'], position: [number, number, number], metadata: Record<string, any>) => void;
  scanline: number;
}) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!Number.isFinite(distance)) return false;
  const steps = Math.max(1, Math.ceil(distance / Math.max(sampleStep, EPS)));
  let requiredZ = Math.max(from[2], to[2]);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const px = from[0] + ((to[0] - from[0]) * t);
    const py = from[1] + ((to[1] - from[1]) * t);
    const centerZ = dropCutter.centerZ(px, py);
    if (centerZ !== null) requiredZ = Math.max(requiredZ, centerZ - toolRadius + linkClearance);
  }
  if (!Number.isFinite(requiredZ)) return false;
  const linkZ = roundCoord(Math.min(Math.max(requiredZ, from[2], to[2]), safeZ));
  const metadata = { safe: true, scanline, clearanceLink: true };
  addMove('retract', [from[0], from[1], linkZ], metadata);
  addMove('rapid', [to[0], to[1], linkZ], metadata);
  addMove('plunge', to, { scanline, clearanceLink: true });
  return true;
}

function boundsFromSurfacingPath(path: CamToolpathPath, targetBounds: CamBounds): CamBounds {
  const xs = path.points.map((point) => point.position[0]);
  const ys = path.points.map((point) => point.position[1]);
  const zs = path.points.map((point) => point.position[2]);
  return {
    min: [roundCoord(Math.min(...xs)), roundCoord(Math.min(...ys)), roundCoord(Math.min(...zs, targetBounds.min[2]))],
    max: [roundCoord(Math.max(...xs)), roundCoord(Math.max(...ys)), roundCoord(Math.max(...zs))],
  };
}

function makeEmptySurfacingResult({
  operationId,
  operationName,
  machine,
  targetBounds = null,
  cutter = null,
  spindleRPM = 0,
  warnings = [],
}: {
  operationId: string;
  operationName: string;
  machine: CamMachineProfile;
  targetBounds?: CamBounds | null;
  cutter?: CamCutterDefinition | null;
  spindleRPM?: number;
  warnings?: string[];
}): CamToolpathProgram {
  return makeEmptyCamToolpathProgram({
    operationId,
    operationName,
    machine,
    targetBounds,
    cutter: cutter || makeBallEndMillCutter({ diameter: 3.175 }),
    spindleRPM,
    warnings,
  });
}
