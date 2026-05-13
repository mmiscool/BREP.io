import { Solid } from './BetterSolid.js';
import { makeTube, setOccState } from './OpenCascadeKernel.js';

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

function applyNativeTubeState(target, state, name) {
  setOccState(target, state);
  target._auxEdges = [];
  target._tubeBuildMode = 'occ_make_pipe';
  target.name = name || 'Tube';
  addTubePathAuxEdge(target, target.params?.points, target.name, target.params.closed);
  return target;
}

export class Tube extends Solid {
  constructor(opts = {}) {
    super();
    const {
      points = [],
      radius = 1,
      innerRadius = 0,
      closed = false,
      name = 'Tube',
      autoVisualize = false,
      pathCurve = null,
      endpointExtension = 0,
    } = opts;
    this.params = { points, radius, innerRadius, closed, name, pathCurve, endpointExtension };
    this.name = name;

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

    const hasPath = Array.isArray(points) && points.length >= 2;
    const validRadius = Number(radius) > 0;
    if (hasPath && validRadius) {
      this.generate();
      if (autoVisualize) this.visualize();
    }
  }

  generate() {
    return this.generateNative();
  }

  buildNativeSnapshot() {
    const {
      points,
      radius,
      innerRadius,
      closed,
      name,
      pathCurve,
      endpointExtension,
    } = this.params || {};

    return makeTube({
      points: sanitizePathPoints(points),
      radius: Number(radius),
      innerRadius: Number(innerRadius) || 0,
      closed: !!closed,
      name: name || 'Tube',
      pathCurve,
      endpointExtension: Number(endpointExtension) || 0,
    });
  }

  generateNative() {
    if (typeof this.free === 'function') {
      try { this.free(); } catch { }
    }
    const state = this.buildNativeSnapshot();
    return applyNativeTubeState(this, state, this.params?.name);
  }
}
