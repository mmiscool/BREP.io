#pragma once

#include <emscripten/val.h>

namespace manifoldplus {

emscripten::val BuildFilletSegmentAuthoringState(const emscripten::val& options);
emscripten::val BuildChamferAuthoringState(const emscripten::val& options);
emscripten::val BuildChamferWorkflowAuthoringState(const emscripten::val& options);
emscripten::val BuildFilletCornerBridgeAuthoringState(
    const emscripten::val& options);
emscripten::val ClassifyFilletEdgeDirection(const emscripten::val& options);
emscripten::val ComputeFilletCenterline(const emscripten::val& options);
emscripten::val BuildFilletEdgeAuthoringState(const emscripten::val& options);
emscripten::val BuildFilletBatchAuthoringState(const emscripten::val& options);
emscripten::val BuildFilletAuthoringState(const emscripten::val& options);
emscripten::val BuildFilletCombinedAuthoringState(const emscripten::val& options);
emscripten::val BuildBooleanCombinedAuthoringState(const emscripten::val& options);
emscripten::val BuildSolidAuthoringStateFromMesh(const emscripten::val& options);

}  // namespace manifoldplus
