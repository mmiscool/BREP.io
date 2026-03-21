#pragma once

#include <emscripten/val.h>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace manifoldplus {

class BrepSolidCore {
 public:
  BrepSolidCore() = default;

  void Clear();
  uint32_t GetOrCreateFaceId(const std::string& face_name);
  uint32_t GetPointIndex(const emscripten::val& point);
  void AddTriangle(const std::string& face_name, const emscripten::val& v1,
                   const emscripten::val& v2, const emscripten::val& v3);

  void SetFaceMetadataJson(const std::string& face_name,
                           const std::string& metadata_json);
  std::string GetFaceMetadataJson(const std::string& face_name) const;
  void SetEdgeMetadataJson(const std::string& edge_name,
                           const std::string& metadata_json);
  std::string GetEdgeMetadataJson(const std::string& edge_name) const;

  emscripten::val GetFaceNames() const;
  emscripten::val GetAuthoringState() const;

  uint32_t VertexCount() const;
  uint32_t TriangleCount() const;

 private:
  static std::string MakeVertexKey(double x, double y, double z);
  static emscripten::val ToJsArray(const std::vector<float>& values);
  static emscripten::val ToJsArray(const std::vector<uint32_t>& values);
  static emscripten::val ToStringArray(const std::vector<std::string>& values);
  static emscripten::val ToStringMapEntries(
      const std::unordered_map<std::string, std::string>& values);
  static emscripten::val ToFaceNameEntries(
      const std::unordered_map<std::string, uint32_t>& values);
  static emscripten::val ToFaceIdEntries(
      const std::unordered_map<uint32_t, std::string>& values);
  static void ReadPoint(const emscripten::val& point, double& x, double& y,
                        double& z);

  uint32_t num_prop_ = 3;
  std::vector<float> vert_properties_;
  std::vector<uint32_t> tri_verts_;
  std::vector<uint32_t> tri_ids_;
  std::unordered_map<std::string, uint32_t> vert_key_to_index_;
  std::unordered_map<std::string, uint32_t> face_name_to_id_;
  std::unordered_map<uint32_t, std::string> id_to_face_name_;
  std::unordered_map<std::string, std::string> face_metadata_json_;
  std::unordered_map<std::string, std::string> edge_metadata_json_;
};

}  // namespace manifoldplus
