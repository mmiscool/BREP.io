import { Solid } from './BetterSolid.js';
import { applySolidAuthoringStateSnapshot } from './CppSolidCore.js';
import { manifold } from './setupManifold.js';

function hasNativePrimitiveBuilder() {
  return typeof manifold?.buildPrimitiveAuthoringState === 'function';
}

function requireNativePrimitiveBuilder() {
  if (hasNativePrimitiveBuilder()) return;
  throw new Error('Primitive generation requires the custom local manifold build with native primitive support.');
}

function applyNativePrimitiveSnapshot(target, snapshot, name) {
  applySolidAuthoringStateSnapshot(target, snapshot, { remapFaceIDs: true });
  target._dirty = true;
  target._manifold = null;
  target._faceIndex = null;
  target._auxEdges = [];
  target.name = name || 'Solid';
  return target;
}

function buildTorusTubeCenterlinePoints(majorRadius, resolution, arcDegrees) {
  const major = Number(majorRadius);
  const segments = Math.max(8, Math.floor(Number(resolution) || 48));
  const arc = Number.isFinite(Number(arcDegrees)) ? Number(arcDegrees) : 360;
  const fullArc = arc >= 360 - 1e-6;
  const sweep = fullArc ? Math.PI * 2 : (arc / 180) * Math.PI;
  if (!Number.isFinite(major) || Math.abs(major) <= 1e-12 || !(sweep > 0)) return [];

  const count = fullArc ? segments : segments + 1;
  const points = [];
  for (let i = 0; i < count; i++) {
    const u = fullArc
      ? (i / segments) * sweep
      : (i / Math.max(1, count - 1)) * sweep;
    points.push([
      major * Math.cos(u),
      0,
      -major * Math.sin(u),
    ]);
  }
  return points;
}

class PrimitiveBase extends Solid {
  constructor(defaults, name, primitiveKind) {
    super();
    this.params = { ...defaults, name: name ?? defaults?.name ?? 'Solid' };
    this.name = this.params.name;
    this._primitiveKind = primitiveKind;
    this.generate();
  }

  buildNativeSnapshot() {
    requireNativePrimitiveBuilder();
    return manifold.buildPrimitiveAuthoringState({
      kind: this._primitiveKind,
      ...this.params,
      name: this.params?.name || this.name || 'Solid',
    });
  }

  generate() {
    const snapshot = this.buildNativeSnapshot();
    applyNativePrimitiveSnapshot(this, snapshot, this.params?.name);
    if (typeof this.addPrimitiveAuxiliaryGeometry === 'function') {
      this.addPrimitiveAuxiliaryGeometry();
    }
    return this;
  }
}

export class Pyramid extends PrimitiveBase {
  constructor({ bL = 1, s = 4, h = 1, name = 'Pyramid' } = {}) {
    super({ bL, s, h, name }, name, 'pyramid');
  }
}

export class Sphere extends PrimitiveBase {
  constructor({ r = 1, resolution = 24, name = 'Sphere' } = {}) {
    super({ r, resolution, name }, name, 'sphere');
  }
}

export class Torus extends PrimitiveBase {
  constructor({ mR = 2, tR = 0.5, resolution = 48, arcDegrees = 360, name = 'Torus', centerlines = true } = {}) {
    super({ mR, tR, resolution, arcDegrees, name, centerlines }, name, 'torus');
  }

  addPrimitiveAuxiliaryGeometry() {
    if (this.params?.centerlines === false) return;

    const name = this.params?.name || this.name || 'Torus';
    const tubeRadius = Math.abs(Number(this.params?.tR) || 0);
    const axisLength = tubeRadius * 3;
    if (axisLength > 1e-12) {
      this.addCenterline(
        [0, -0.5 * axisLength, 0],
        [0, 0.5 * axisLength, 0],
        `${name}_AXIS`,
        { materialKey: 'OVERLAY' },
      );
    }

    const tubeCenterline = buildTorusTubeCenterlinePoints(
      this.params?.mR,
      this.params?.resolution,
      this.params?.arcDegrees,
    );
    if (tubeCenterline.length >= 2) {
      this.addAuxEdge(
        `${name}_TUBE_CENTERLINE`,
        tubeCenterline,
        {
          closedLoop: Number(this.params?.arcDegrees) >= 360 - 1e-6,
          materialKey: 'OVERLAY',
          centerline: true,
          faceA: `${name}_Side`,
        },
      );
    }
  }
}

export class Cube extends PrimitiveBase {
  constructor({ x = 1, y = 1, z = 1, name = 'Cube' } = {}) {
    super({ x, y, z, name }, name, 'cube');
  }
}

export class Cylinder extends PrimitiveBase {
  constructor({ radius = 1, height = 1, resolution = 32, name = 'Cylinder', centerlines = true } = {}) {
    super({ radius, height, resolution, name, centerlines }, name, 'cylinder');
  }

  addPrimitiveAuxiliaryGeometry() {
    if (this.params?.centerlines === false) return;

    const name = this.params?.name || this.name || 'Cylinder';
    const height = Number(this.params?.height) || 0;
    if (Math.abs(height) <= 1e-12) return;

    this.addCenterline(
      [0, 0, 0],
      [0, height, 0],
      `${name}_AXIS`,
      { materialKey: 'OVERLAY' },
    );
  }
}

export class Cone extends PrimitiveBase {
  constructor({ r1 = 0.5, r2 = 1, h = 1, resolution = 32, name = 'Cone', centerlines = true } = {}) {
    super({ r1, r2, h, resolution, name, centerlines }, name, 'cone');
  }

  addPrimitiveAuxiliaryGeometry() {
    if (this.params?.centerlines === false) return;

    const name = this.params?.name || this.name || 'Cone';
    const height = Number(this.params?.h) || 0;
    if (Math.abs(height) <= 1e-12) return;

    this.addCenterline(
      [0, 0, 0],
      [0, height, 0],
      `${name}_AXIS`,
      { materialKey: 'OVERLAY' },
    );
  }
}

export { hasNativePrimitiveBuilder as primitiveHasNativeBuilder };
