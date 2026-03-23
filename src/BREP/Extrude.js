import { Solid } from './BetterSolid.js';
import { generateNativeSweep } from './Sweep.js';

export class ExtrudeSolid extends Solid {
  /**
   * @param {object} [opts]
   * @param {import('./Face.js').Face} opts.face Source face to extrude
   * @param {number|import('three').Vector3} [opts.distance=1] Extrusion distance or explicit vector
   * @param {import('three').Vector3|null} [opts.dir=null] Optional direction vector override
   * @param {number} [opts.distanceBack=0] Optional backward extrusion distance
   * @param {string} [opts.name='Extrude'] Name of the resulting solid
   */
  constructor({ face, distance = 1, dir = null, distanceBack = 0, name = 'Extrude' } = {}) {
    super();
    this.name = name;
    this.params = { face, distance, dir, distanceBack };
    this.generate();
  }

  generate() {
    const { face, distance, dir, distanceBack } = this.params;
    if (!face || !face.geometry) return this;
    const nativeDistance = (dir && dir.isVector3) ? dir : distance;
    generateNativeSweep(this, {
      face,
      distance: nativeDistance,
      distanceBack,
      mode: 'translate',
      omitBaseCap: false,
      name: this.name || 'Extrude',
    });
    return this;
  }
}
