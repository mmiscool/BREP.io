import { Solid } from './BetterSolid.js';
import {
  makeBox,
  makeCone,
  makeCylinder,
  makePyramid,
  makeSphere,
  makeTorus,
  setOccState,
} from './OpenCascadeKernel.js';

function hasNativePrimitiveBuilder() {
  return true;
}

function requireNativePrimitiveBuilder() {
  if (hasNativePrimitiveBuilder()) return;
  throw new Error('Primitive generation requires OpenCASCADE support.');
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
    const params = { ...this.params, name: this.params?.name || this.name || 'Solid' };
    if (this._primitiveKind === 'cube') return makeBox(params);
    if (this._primitiveKind === 'cylinder') return makeCylinder(params);
    if (this._primitiveKind === 'cone') return makeCone(params);
    if (this._primitiveKind === 'pyramid') return makePyramid(params);
    if (this._primitiveKind === 'sphere') return makeSphere(params);
    if (this._primitiveKind === 'torus') return makeTorus(params);
    throw new Error(`OpenCASCADE primitive "${this._primitiveKind}" is not implemented.`);
  }

  generate() {
    const state = this.buildNativeSnapshot();
    setOccState(this, state);
    this._auxEdges = [];
    this.name = this.params?.name || 'Solid';
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
  constructor({ mR = 2, tR = 0.5, resolution = 48, arcDegrees = 360, name = 'Torus' } = {}) {
    super({ mR, tR, resolution, arcDegrees, name }, name, 'torus');
  }
}

export class Cube extends PrimitiveBase {
  constructor({ x = 1, y = 1, z = 1, name = 'Cube' } = {}) {
    super({ x, y, z, name }, name, 'cube');
  }
}

export class Cylinder extends PrimitiveBase {
  constructor({ radius = 1, height = 1, resolution = 32, name = 'Cylinder' } = {}) {
    super({ radius, height, resolution, name }, name, 'cylinder');
  }
}

export class Cone extends PrimitiveBase {
  constructor({ r1 = 0.5, r2 = 1, h = 1, resolution = 32, name = 'Cone' } = {}) {
    super({ r1, r2, h, resolution, name }, name, 'cone');
  }
}

export { hasNativePrimitiveBuilder as primitiveHasNativeBuilder };
