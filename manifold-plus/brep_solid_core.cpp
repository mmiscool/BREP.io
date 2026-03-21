#include "brep_solid_core.h"

#include <manifold/manifold.h>

#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace manifoldplus {

namespace {

double ReadNumericProperty(const emscripten::val& point, const char* name,
                           uint32_t index) {
  const emscripten::val indexed = point[index];
  if (!indexed.isUndefined() && !indexed.isNull()) {
    return indexed.as<double>();
  }

  const emscripten::val named = point[name];
  if (!named.isUndefined() && !named.isNull()) {
    return named.as<double>();
  }

  throw std::runtime_error(std::string("Point is missing coordinate: ") + name);
}

}  // namespace

void BrepSolidCore::Clear() {
  vert_properties_.clear();
  tri_verts_.clear();
  tri_ids_.clear();
  vert_key_to_index_.clear();
  face_name_to_id_.clear();
  id_to_face_name_.clear();
  face_metadata_json_.clear();
  edge_metadata_json_.clear();
}

uint32_t BrepSolidCore::GetOrCreateFaceId(const std::string& face_name) {
  const auto found = face_name_to_id_.find(face_name);
  if (found != face_name_to_id_.end()) return found->second;

  const uint32_t id = manifold::Manifold::ReserveIDs(1);
  face_name_to_id_[face_name] = id;
  id_to_face_name_[id] = face_name;
  return id;
}

uint32_t BrepSolidCore::GetPointIndex(const emscripten::val& point) {
  double x = 0;
  double y = 0;
  double z = 0;
  ReadPoint(point, x, y, z);

  const std::string key = MakeVertexKey(x, y, z);
  const auto found = vert_key_to_index_.find(key);
  if (found != vert_key_to_index_.end()) return found->second;

  const uint32_t index = static_cast<uint32_t>(vert_properties_.size() / 3);
  vert_properties_.push_back(static_cast<float>(x));
  vert_properties_.push_back(static_cast<float>(y));
  vert_properties_.push_back(static_cast<float>(z));
  vert_key_to_index_[key] = index;
  return index;
}

void BrepSolidCore::AddTriangle(const std::string& face_name,
                                const emscripten::val& v1,
                                const emscripten::val& v2,
                                const emscripten::val& v3) {
  const uint32_t id = GetOrCreateFaceId(face_name);
  tri_verts_.push_back(GetPointIndex(v1));
  tri_verts_.push_back(GetPointIndex(v2));
  tri_verts_.push_back(GetPointIndex(v3));
  tri_ids_.push_back(id);
}

void BrepSolidCore::SetFaceMetadataJson(const std::string& face_name,
                                        const std::string& metadata_json) {
  face_metadata_json_[face_name] = metadata_json;
}

std::string BrepSolidCore::GetFaceMetadataJson(
    const std::string& face_name) const {
  const auto found = face_metadata_json_.find(face_name);
  if (found == face_metadata_json_.end()) return std::string();
  return found->second;
}

void BrepSolidCore::SetEdgeMetadataJson(const std::string& edge_name,
                                        const std::string& metadata_json) {
  edge_metadata_json_[edge_name] = metadata_json;
}

std::string BrepSolidCore::GetEdgeMetadataJson(
    const std::string& edge_name) const {
  const auto found = edge_metadata_json_.find(edge_name);
  if (found == edge_metadata_json_.end()) return std::string();
  return found->second;
}

emscripten::val BrepSolidCore::GetFaceNames() const {
  std::vector<std::string> names;
  names.reserve(face_name_to_id_.size());
  for (const auto& entry : face_name_to_id_) {
    names.push_back(entry.first);
  }
  return ToStringArray(names);
}

emscripten::val BrepSolidCore::GetAuthoringState() const {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", num_prop_);
  snapshot.set("vertProperties", ToJsArray(vert_properties_));
  snapshot.set("triVerts", ToJsArray(tri_verts_));
  snapshot.set("triIDs", ToJsArray(tri_ids_));
  snapshot.set("faceNameToID", ToFaceNameEntries(face_name_to_id_));
  snapshot.set("idToFaceName", ToFaceIdEntries(id_to_face_name_));
  snapshot.set("faceMetadataJson", ToStringMapEntries(face_metadata_json_));
  snapshot.set("edgeMetadataJson", ToStringMapEntries(edge_metadata_json_));
  snapshot.set("vertexCount", VertexCount());
  snapshot.set("triangleCount", TriangleCount());
  return snapshot;
}

uint32_t BrepSolidCore::VertexCount() const {
  return static_cast<uint32_t>(vert_properties_.size() / 3);
}

uint32_t BrepSolidCore::TriangleCount() const {
  return static_cast<uint32_t>(tri_ids_.size());
}

std::string BrepSolidCore::MakeVertexKey(double x, double y, double z) {
  std::ostringstream stream;
  stream.precision(std::numeric_limits<double>::max_digits10);
  stream << x << ',' << y << ',' << z;
  return stream.str();
}

emscripten::val BrepSolidCore::ToJsArray(const std::vector<float>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToJsArray(const std::vector<uint32_t>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToStringArray(
    const std::vector<std::string>& values) {
  emscripten::val out = emscripten::val::array();
  for (std::size_t i = 0; i < values.size(); ++i) {
    out.set(static_cast<uint32_t>(i), values[i]);
  }
  return out;
}

emscripten::val BrepSolidCore::ToStringMapEntries(
    const std::unordered_map<std::string, std::string>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

emscripten::val BrepSolidCore::ToFaceNameEntries(
    const std::unordered_map<std::string, uint32_t>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

emscripten::val BrepSolidCore::ToFaceIdEntries(
    const std::unordered_map<uint32_t, std::string>& values) {
  emscripten::val out = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    out.set(index++, pair);
  }
  return out;
}

void BrepSolidCore::ReadPoint(const emscripten::val& point, double& x,
                              double& y, double& z) {
  x = ReadNumericProperty(point, "x", 0);
  y = ReadNumericProperty(point, "y", 1);
  z = ReadNumericProperty(point, "z", 2);

  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
    throw std::runtime_error("Point coordinates must be finite.");
  }
}

}  // namespace manifoldplus
