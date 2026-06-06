#include <emscripten/bind.h>

#include "brep_solid_core.h"

EMSCRIPTEN_BINDINGS(manifold_plus_solid_bindings) {
  emscripten::class_<manifoldplus::BrepSolidCore>("BrepSolidCore")
      .constructor<>()
      .function("clear", &manifoldplus::BrepSolidCore::Clear)
      .function("setAuthoringState", &manifoldplus::BrepSolidCore::SetAuthoringState)
      .function("getOrCreateFaceId",
                &manifoldplus::BrepSolidCore::GetOrCreateFaceId)
      .function("getPointIndex", &manifoldplus::BrepSolidCore::GetPointIndex)
      .function("addTriangle", &manifoldplus::BrepSolidCore::AddTriangle)
      .function("bakeTransform", &manifoldplus::BrepSolidCore::BakeTransform)
      .function("transformMetadata",
                &manifoldplus::BrepSolidCore::TransformMetadata)
      .function("weldVerticesByEpsilon",
                &manifoldplus::BrepSolidCore::WeldVerticesByEpsilon)
      .function("pushFace", &manifoldplus::BrepSolidCore::PushFace)
      .function("normalizeFaceTracking",
                &manifoldplus::BrepSolidCore::NormalizeFaceTracking)
      .function("isCoherentlyOrientedManifold",
                &manifoldplus::BrepSolidCore::IsCoherentlyOrientedManifold)
      .function("fixTriangleWindingsByAdjacency",
                &manifoldplus::BrepSolidCore::FixTriangleWindingsByAdjacency)
      .function("invertNormals", &manifoldplus::BrepSolidCore::InvertNormals)
      .function("prepareManifoldMesh",
                &manifoldplus::BrepSolidCore::PrepareManifoldMesh)
      .function("setFaceMetadataJson",
                &manifoldplus::BrepSolidCore::SetFaceMetadataJson)
      .function("getFaceMetadataJson",
                &manifoldplus::BrepSolidCore::GetFaceMetadataJson)
      .function("renameFace", &manifoldplus::BrepSolidCore::RenameFace)
      .function("cleanupTinyFaceIslands",
                &manifoldplus::BrepSolidCore::CleanupTinyFaceIslands)
      .function("removeSmallIslands",
                &manifoldplus::BrepSolidCore::RemoveSmallIslands)
      .function("mergeTinyFaces", &manifoldplus::BrepSolidCore::MergeTinyFaces)
      .function("removeInternalTriangles",
                &manifoldplus::BrepSolidCore::RemoveInternalTriangles)
      .function("removeDisconnectedIslandsByVolume",
                &manifoldplus::BrepSolidCore::RemoveDisconnectedIslandsByVolume)
      .function("setEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::SetEdgeMetadataJson)
      .function("getEdgeMetadataJson",
                &manifoldplus::BrepSolidCore::GetEdgeMetadataJson)
      .function("getFace", &manifoldplus::BrepSolidCore::GetFace)
      .function("getFaces", &manifoldplus::BrepSolidCore::GetFaces)
      .function("getFaceNormal", &manifoldplus::BrepSolidCore::GetFaceNormal)
      .function("getBoundaryEdgePolylines",
                &manifoldplus::BrepSolidCore::GetBoundaryEdgePolylines)
      .function("computeFilletCenterline",
                &manifoldplus::BrepSolidCore::ComputeFilletCenterline)
      .function("addAuxEdge", &manifoldplus::BrepSolidCore::AddAuxEdge)
      .function("setAuxEdges", &manifoldplus::BrepSolidCore::SetAuxEdges)
      .function("getAuxEdges", &manifoldplus::BrepSolidCore::GetAuxEdges)
      .function("getFaceNames", &manifoldplus::BrepSolidCore::GetFaceNames)
      .function("getAuthoringState",
                &manifoldplus::BrepSolidCore::GetAuthoringState)
      .function("vertexCount", &manifoldplus::BrepSolidCore::VertexCount)
      .function("triangleCount", &manifoldplus::BrepSolidCore::TriangleCount);
}
