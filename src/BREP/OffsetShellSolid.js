import { Solid } from './BetterSolid.js';

const OFFSET_SHELL_STUB_MESSAGE =
  'OffsetShellSolid is currently stubbed out pending reimplementation.';

export class OffsetShellSolid extends Solid {
  constructor(sourceSolid) {
    super();
    this.sourceSolid = sourceSolid || null;
  }

  run(_distance) {
    throw new Error(OFFSET_SHELL_STUB_MESSAGE);
  }

  static generate(_sourceSolid, _distance, _options = {}) {
    throw new Error(OFFSET_SHELL_STUB_MESSAGE);
  }
}
