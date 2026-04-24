import { Solid } from './BetterSolid.js';

export class OffsetShellSolid extends Solid {
  constructor(sourceSolid) {
    super();
    this.sourceSolid = sourceSolid || null;
  }

  run(distance, options = {}) {
    if (!this.sourceSolid || typeof this.sourceSolid.offsetShell !== 'function') {
      throw new Error('OffsetShellSolid requires a valid source solid with Solid.offsetShell().');
    }
    return OffsetShellSolid.generate(this.sourceSolid, distance, options);
  }

  static generate(sourceSolid, distance, options = {}) {
    if (!sourceSolid || typeof sourceSolid.offsetShell !== 'function') {
      throw new Error('OffsetShellSolid.generate requires a valid source solid with Solid.offsetShell().');
    }
    const removeFaces = options?.removeFaces || options?.removeFaceNames || options?.faces || [];
    return sourceSolid.offsetShell(removeFaces, distance, options);
  }
}
