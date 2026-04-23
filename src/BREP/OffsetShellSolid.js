import { Solid } from './BetterSolid.js';
import {
  analyzePolyhedralSolid,
  buildOffsetPolyhedralSolid,
} from './polyhedralOffset.js';

export class OffsetShellSolid extends Solid {
  constructor(sourceSolid) {
    super();
    if (!sourceSolid || typeof sourceSolid._manifoldize !== 'function') {
      throw new Error('OffsetShellSolid requires a valid Solid instance.');
    }
    this.sourceSolid = sourceSolid;
  }

  run(distance) {
    return OffsetShellSolid.generate(this.sourceSolid, distance);
  }

  static generate(sourceSolid, distance, options = {}) {
    if (!sourceSolid || typeof sourceSolid._manifoldize !== 'function') {
      throw new Error('OffsetShellSolid.generate requires a valid Solid.');
    }

    const dist = Number(distance);
    if (!Number.isFinite(dist) || dist === 0) return sourceSolid.clone();

    const {
      newSolidName = `${sourceSolid.name || 'Solid'}_${Math.abs(dist)}`,
      repairPasses = 4,
      removeFaceNames = [],
    } = options;

    const polyhedral = analyzePolyhedralSolid(sourceSolid);
    const polyhedralResult = buildOffsetPolyhedralSolid(sourceSolid, polyhedral, dist, {
      newSolidName,
      repairPasses,
      removeFaceNames,
    });
    if (polyhedralResult) return polyhedralResult;

    throw new Error(
      'OffsetShellSolid failed to build a valid non-SDF offset for this geometry. '
      + 'Analysis requires a repairable closed surface with valid face topology.'
    );
  }
}
