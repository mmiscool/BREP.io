// Public entry point for the BREP kernel package
// Expose the core BREP kernel and part history classes

export { BREP } from './BREP/BREP.js';
export { CppSolidCore } from './BREP/CppSolidCore.js';

// Part history API
export { PartHistory, extractDefaultValues } from './PartHistory.js';

// Standalone sketch solver API
export { ConstraintSolver, ConstraintEngine } from './features/sketch/sketchSolver2D/ConstraintEngine.js';
export { constraints } from './features/sketch/sketchSolver2D/constraintDefinitions.js';

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

export {
  manifold,
  Manifold,
  ManifoldMesh,
  manifoldBuildSource,
  manifoldHasCustomExtensions,
  manifoldPlusSum,
} from './BREP/setupManifold.js';
