import { Solid } from './BetterSolid.js';
import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { manifold } from './setupManifold.js';

const DEFAULT_SEGMENTS = 32;

function hasNativeTubeBuilder() {
  return typeof manifold?.buildTubeAuthoringState === 'function';
}

function requireNativeTubeBuilder() {
  if (hasNativeTubeBuilder()) return;
  throw new Error('Tube generation requires the custom local manifold build with native tube support.');
}

function sanitizePathPoints(points) {
  const out = [];
  if (!Array.isArray(points)) return out;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    const z = Number(point[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push([x, y, z]);
  }
  return out;
}

function addTubePathAuxEdge(target, pathPoints, name, closed) {
  const auxPath = sanitizePathPoints(pathPoints);
  if (auxPath.length < 2) return;
  target.addAuxEdge(`${name}_PATH`, auxPath, {
    polylineWorld: true,
    materialKey: 'OVERLAY',
    closedLoop: !!closed,
    centerline: true,
  });
}

function applyNativeTubeSnapshot(target, snapshot, name) {
  applySolidAuthoringStateSnapshot(target, snapshot, { remapFaceIDs: true });
  target._dirty = true;
  target._manifold = null;
  target._faceIndex = null;
  target._auxEdges = [];
  target.debugSphereSolids = [];
  target._selfUnionStats = snapshot?.selfUnionStats ?? null;
  target._tubeBuildMode = typeof snapshot?.buildMode === 'string' ? snapshot.buildMode : null;
  target.name = name || 'Tube';
  target.params.closed = !!snapshot?.closed;
  addTubePathAuxEdge(target, snapshot?.pathPoints || target.params?.points, target.name, target.params.closed);
  return target;
}

export class Tube extends Solid {
  constructor(opts: any = {}) {
    super();
    const {
      points = [],
      radius = 1,
      innerRadius = 0,
      resolution = DEFAULT_SEGMENTS,
      closed = false,
      name = 'Tube',
      debugSpheres = false,
      preferFast = true,
      selfUnion = true,
      autoVisualize = false,
    } = opts;
    this.params = { points, radius, innerRadius, resolution, closed, name, debugSpheres, preferFast, selfUnion };
    this.name = name;
    this.debugSphereSolids = [];
    this._selfUnionStats = null;

    if (Array.isArray(points) && points.length >= 2) {
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      if (Array.isArray(firstPoint) && Array.isArray(lastPoint) &&
          firstPoint[0] === lastPoint[0] &&
          firstPoint[1] === lastPoint[1] &&
          firstPoint[2] === lastPoint[2]) {
        this.params.closed = true;
      }
    }

    try {
      const hasPath = Array.isArray(points) && points.length >= 2;
      const validRadius = Number(radius) > 0;
      if (hasPath && validRadius) {
        this.generate();
        if (autoVisualize) this.visualize();
      }
    } catch {
      // Fail-quietly to keep boolean reconstruction safe.
    }
  }

  generate() {
    const preferFast = this.params?.preferFast !== false;
    return this.generateNative({
      preferFast,
      allowSlowFallback: preferFast,
    });
  }

  generateFast() {
    return this.generateNative({ preferFast: true, allowSlowFallback: false });
  }

  generateSlow() {
    return this.generateNative({ preferFast: false });
  }

  buildNativeSnapshot(overrides: any = {}) {
    requireNativeTubeBuilder();

    const {
      points,
      radius,
      innerRadius,
      resolution,
      closed,
      name,
      selfUnion,
    } = this.params || {};

    return manifold.buildTubeAuthoringState({
      points: sanitizePathPoints(points),
      radius: Number(radius),
      innerRadius: Number(innerRadius) || 0,
      resolution: Math.max(8, Math.floor(Number(resolution) || DEFAULT_SEGMENTS)),
      closed: !!closed,
      preferFast: overrides.preferFast ?? true,
      allowSlowFallback: overrides.allowSlowFallback ?? (overrides.preferFast ?? true),
      selfUnion: overrides.selfUnion ?? (selfUnion !== false),
      name: name || 'Tube',
    });
  }

  generateNative(overrides: any = {}) {
    if (typeof this.free === 'function') {
      try { this.free(); } catch { /* ignore stale manifold cleanup failure */ }
    }
    const snapshot = this.buildNativeSnapshot(overrides);
    return applyNativeTubeSnapshot(this, snapshot, this.params?.name);
  }
}

export { hasNativeTubeBuilder as tubeHasNativeBuilder };
