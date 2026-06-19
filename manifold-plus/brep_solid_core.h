#pragma once

#include <emscripten/val.h>
#include <manifold/manifold.h>

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace manifoldplus {

struct AuxEdgeRecord {
  std::string name;
  std::vector<std::array<double, 3>> points;
  bool closed_loop = false;
  bool polyline_world = false;
  std::string material_key;
  bool centerline = false;
  std::string face_a;
  std::string face_b;
};

class BrepSolidCore {
 public:
  BrepSolidCore() = default;

  void Clear();
  void SetAuthoringState(const emscripten::val& snapshot);
  uint32_t GetOrCreateFaceId(const std::string& face_name);
  uint32_t GetPointIndex(const emscripten::val& point);
  void AddTriangle(const std::string& face_name, const emscripten::val& v1,
                   const emscripten::val& v2, const emscripten::val& v3);
  void BakeTransform(const emscripten::val& matrix_values);
  void TransformMetadata(const emscripten::val& matrix_values);
  void WeldVerticesByEpsilon(double eps);
  emscripten::val PushFace(const std::string& face_name, double distance);
  void NormalizeFaceTracking();
  bool IsCoherentlyOrientedManifold() const;
  bool FixTriangleWindingsByAdjacency();
  void InvertNormals();
  emscripten::val PrepareManifoldMesh();
  emscripten::val PrepareManifoldMeshTyped();

  void SetFaceMetadataJson(const std::string& face_name,
                           const std::string& metadata_json);
  std::string GetFaceMetadataJson(const std::string& face_name) const;
  bool RenameFace(const std::string& old_face_name,
                  const std::string& new_face_name);
  uint32_t CleanupTinyFaceIslands(double max_area);
  uint32_t RemoveSmallIslands(uint32_t max_triangles, bool remove_internal,
                              bool remove_external);
  uint32_t MergeTinyFaces(double max_area);
  uint32_t RemoveInternalTriangles();
  uint32_t RemoveDisconnectedIslandsByVolume(double min_volume);
  void SetEdgeMetadataJson(const std::string& edge_name,
                           const std::string& metadata_json);
  std::string GetEdgeMetadataJson(const std::string& edge_name) const;

  emscripten::val GetFace(const std::string& face_name);
  emscripten::val GetFaces(bool include_empty);
  emscripten::val GetFaceNormal(const std::string& face_name);
  emscripten::val GetBoundaryEdgePolylines();
  emscripten::val ComputeFilletCenterline(const emscripten::val& options) const;
  void AddAuxEdge(const std::string& name, const emscripten::val& points,
                  const emscripten::val& options);
  void SetAuxEdges(const emscripten::val& aux_edges);
  emscripten::val GetAuxEdges() const;
  emscripten::val GetFaceNames() const;
  emscripten::val GetAuthoringState() const;

  uint32_t VertexCount() const;
  uint32_t TriangleCount() const;

 private:
  static std::string MakeVertexKey(double x, double y, double z);
  static emscripten::val ToJsArray(const std::vector<float>& values);
  static emscripten::val ToJsArray(const std::vector<uint32_t>& values);
  static emscripten::val ToJsTypedArray(const std::vector<float>& values);
  static emscripten::val ToJsTypedArray(const std::vector<uint32_t>& values);
  static emscripten::val ToStringArray(const std::vector<std::string>& values);
  static emscripten::val ToStringMapEntries(
      const std::unordered_map<std::string, std::string>& values);
  static emscripten::val ToFaceNameEntries(
      const std::unordered_map<std::string, uint32_t>& values);
  static emscripten::val ToFaceIdEntries(
      const std::unordered_map<uint32_t, std::string>& values);
  static std::string MakeUndirectedEdgeKey(uint32_t a, uint32_t b);
  static std::vector<float> ReadFloatArray(const emscripten::val& values,
                                           const char* label);
  static std::vector<uint32_t> ReadUint32Array(const emscripten::val& values,
                                               const char* label);
  static std::unordered_map<std::string, uint32_t> ReadStringUint32Map(
      const emscripten::val& values, const char* label);
  static std::unordered_map<uint32_t, std::string> ReadUint32StringMap(
      const emscripten::val& values, const char* label);
  static std::unordered_map<std::string, std::string> ReadStringMap(
      const emscripten::val& values, const char* label);
  static void ReadPoint(const emscripten::val& point, double& x, double& y,
                        double& z);
  std::string ResolveFaceName(uint32_t face_id) const;
  manifold::MeshGL BuildAuthoringMeshGL() const;
  manifold::MeshGL BuildPreparedMeshGL();
  manifold::MeshGL BuildRuntimeMeshGL();
  void PruneUnusedFaces();
  void RebuildVertexKeyIndex();

  uint32_t num_prop_ = 3;
  std::vector<float> vert_properties_;
  std::vector<uint32_t> tri_verts_;
  std::vector<uint32_t> tri_ids_;
  std::unordered_map<std::string, uint32_t> vert_key_to_index_;
  std::unordered_map<std::string, uint32_t> face_name_to_id_;
  std::unordered_map<uint32_t, std::string> id_to_face_name_;
  std::unordered_map<std::string, std::string> face_metadata_json_;
  std::unordered_map<std::string, std::string> edge_metadata_json_;
  std::vector<AuxEdgeRecord> aux_edges_;
};

}  // namespace manifoldplus
