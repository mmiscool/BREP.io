#include <emscripten/bind.h>

#include "fillet_segment_builder.h"
#include "mesh_to_brep_builder.h"
#include "primitive_builder.h"
#include "sweep_builder.h"
#include "tube_builder.h"

namespace {

double SumNumbers(double a, double b) { return a + b; }

}  // namespace

EMSCRIPTEN_BINDINGS(manifold_plus_bindings) {
  emscripten::function("sum", &SumNumbers);
  emscripten::function("buildPrimitiveAuthoringState",
                       &manifoldplus::BuildPrimitiveAuthoringState);
  emscripten::function("buildMeshToBrepAuthoringState",
                       &manifoldplus::BuildMeshToBrepAuthoringState);
  emscripten::function("buildTubeAuthoringState",
                       &manifoldplus::BuildTubeAuthoringState);
  emscripten::function("buildFilletSegmentAuthoringState",
                       &manifoldplus::BuildFilletSegmentAuthoringState);
  emscripten::function("buildChamferAuthoringState",
                       &manifoldplus::BuildChamferAuthoringState);
  emscripten::function("buildChamferWorkflowAuthoringState",
                       &manifoldplus::BuildChamferWorkflowAuthoringState);
  emscripten::function("buildSweepAuthoringState",
                       &manifoldplus::BuildSweepAuthoringState);
  emscripten::function("buildRevolveAuthoringState",
                       &manifoldplus::BuildRevolveAuthoringState);
  emscripten::function("buildFilletEdgeAuthoringState",
                       &manifoldplus::BuildFilletEdgeAuthoringState);
  emscripten::function("buildFilletBatchAuthoringState",
                       &manifoldplus::BuildFilletBatchAuthoringState);
  emscripten::function("buildFilletAuthoringState",
                       &manifoldplus::BuildFilletAuthoringState);
  emscripten::function("buildFilletCornerBridgeAuthoringState",
                       &manifoldplus::BuildFilletCornerBridgeAuthoringState);
  emscripten::function("classifyFilletEdgeDirection",
                       &manifoldplus::ClassifyFilletEdgeDirection);
  emscripten::function("computeFilletCenterline",
                       &manifoldplus::ComputeFilletCenterline);
  emscripten::function("buildFilletCombinedAuthoringState",
                       &manifoldplus::BuildFilletCombinedAuthoringState);
  emscripten::function("buildBooleanCombinedAuthoringState",
                       &manifoldplus::BuildBooleanCombinedAuthoringState);
  emscripten::function("buildBooleanUnionManyAuthoringState",
                       &manifoldplus::BuildBooleanUnionManyAuthoringState);
  emscripten::function("buildSolidAuthoringStateFromMesh",
                       &manifoldplus::BuildSolidAuthoringStateFromMesh);
}
