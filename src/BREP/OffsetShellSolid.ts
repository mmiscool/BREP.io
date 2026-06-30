import { Solid } from './BetterSolid.js';

type OffsetShellOptions = {
  removeFaces?: unknown[];
  removeFaceNames?: unknown[];
  faces?: unknown[];
  [key: string]: any;
};

export class OffsetShellSolid extends Solid {
  sourceSolid: any;

  constructor(sourceSolid: any) {
    super();
    this.sourceSolid = sourceSolid || null;
  }

  run(distance: number, options: OffsetShellOptions = {}) {
    if (!this.sourceSolid || typeof this.sourceSolid.offsetShell !== 'function') {
      throw new Error('OffsetShellSolid requires a valid source solid with Solid.offsetShell().');
    }
    return OffsetShellSolid.generate(this.sourceSolid, distance, options);
  }

  static generate(sourceSolid: any, distance: number, options: OffsetShellOptions = {}) {
    if (!sourceSolid || typeof sourceSolid.offsetShell !== 'function') {
      throw new Error('OffsetShellSolid.generate requires a valid source solid with Solid.offsetShell().');
    }
    const removeFaces = options?.removeFaces || options?.removeFaceNames || options?.faces || [];
    return sourceSolid.offsetShell(removeFaces, distance, options);
  }
}
