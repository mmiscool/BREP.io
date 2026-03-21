#include <emscripten/bind.h>

#include "brep_solid_core.h"

EMSCRIPTEN_BINDINGS(manifold_plus_solid_bindings) {
  emscripten::class_<manifoldplus::BrepSolidCore>("BrepSolidCore")
      .constructor<>()
      .function("clear", &manifoldplus::BrepSolidCore::Clear)
      .function("getOrCreateFaceId",
                &manifoldplus::BrepSolidCore::GetOrCreateFaceId)
      .function("getPointIndex", &manifoldplus::BrepSolidCore::GetPointIndex)
      .function("addTriangle", &manifoldplus::BrepSolidCore::AddTriangle)
      .function("setFaceMetadataJson",
                &manifoldplus::BrepSolidCore::SetFaceMetadataJson)
      .function("getFaceMetadataJson",
                &manifoldplus::BrepSolidCore::GetFaceMetadataJson)
      .function("setEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::SetEdgeMetadataJson)
      .function("getEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::GetEdgeMetadataJson)
      .function("getFaceNames", &manifoldplus::BrepSolidCore::GetFaceNames)
      .function("getAuthoringState",
                &manifoldplus::BrepSolidCore::GetAuthoringState)
      .function("vertexCount", &manifoldplus::BrepSolidCore::VertexCount)
      .function("triangleCount", &manifoldplus::BrepSolidCore::TriangleCount);
}
