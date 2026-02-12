// Public entry point for the BREP kernel package
// Expose the core BREP kernel and part history classes

export { BREP } from './BREP/BREP.js';

// Part history API
export { PartHistory, extractDefaultValues } from './PartHistory.js';

// Assembly constraints history and registry (useful when working with PartHistory)
export { AssemblyConstraintHistory } from './assemblyConstraints/AssemblyConstraintHistory.js';
export { AssemblyConstraintRegistry } from './assemblyConstraints/AssemblyConstraintRegistry.js';

// License helpers
export {
  getPackageLicenseInfo,
  getPackageLicenseInfoString,
  getPackageLicenseText,
  getAllLicensesInfoString,
} from './licenseInfo.js';

// 2D Sketcher embed (iframe-based)
export { Sketcher2DEmbed, bootSketcher2DFrame } from './UI/sketcher2d/Sketcher2DEmbed.js';
export { sketchToSVG, sketchToSVGPaths } from './UI/sketcher2d/sketchToSVG.js';
