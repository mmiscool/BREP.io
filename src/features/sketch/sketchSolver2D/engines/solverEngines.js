export const SKETCH_SOLVER_ENGINES = Object.freeze({
    LEGACY: "legacy",
    BREP_IO_2D: "brep-io-2d-solver",
});

export const DEFAULT_SKETCH_SOLVER_ENGINE = SKETCH_SOLVER_ENGINES.LEGACY;

export const SKETCH_SOLVER_ENGINE_OPTIONS = Object.freeze([
    { value: SKETCH_SOLVER_ENGINES.LEGACY, label: "Legacy Engine" },
    { value: SKETCH_SOLVER_ENGINES.BREP_IO_2D, label: "brep-io-2d-solver Engine" },
]);

const ENGINE_ALIASES = new Map([
    ["", DEFAULT_SKETCH_SOLVER_ENGINE],
    ["default", DEFAULT_SKETCH_SOLVER_ENGINE],
    ["legacy", SKETCH_SOLVER_ENGINES.LEGACY],
    ["original", SKETCH_SOLVER_ENGINES.LEGACY],
    ["engine:legacy", SKETCH_SOLVER_ENGINES.LEGACY],
    ["native", SKETCH_SOLVER_ENGINES.BREP_IO_2D],
    ["engine:native", SKETCH_SOLVER_ENGINES.BREP_IO_2D],
    ["brep-io-2d-solver", SKETCH_SOLVER_ENGINES.BREP_IO_2D],
    ["brep_io_2d_solver", SKETCH_SOLVER_ENGINES.BREP_IO_2D],
    ["brep-io-2d", SKETCH_SOLVER_ENGINES.BREP_IO_2D],
]);

export function normalizeSketchSolverEngine(value) {
    if (value == null) return DEFAULT_SKETCH_SOLVER_ENGINE;
    const key = String(value).trim().toLowerCase();
    return ENGINE_ALIASES.get(key) || DEFAULT_SKETCH_SOLVER_ENGINE;
}
