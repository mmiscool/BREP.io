#include "fillet_segment_builder.h"

#include "brep_solid_core.h"
#include "tube_builder.h"

#include <manifold/manifold.h>

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace manifoldplus {

namespace {

constexpr double kEps = 1e-12;
constexpr uint32_t kNumProp = 3;

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct SnapshotBuilder {
  std::vector<float> vert_properties;
  std::vector<uint32_t> tri_verts;
  std::vector<uint32_t> tri_ids;
  std::unordered_map<std::string, uint32_t> vert_key_to_index;
  std::unordered_map<std::string, uint32_t> face_name_to_id;
  std::unordered_map<uint32_t, std::string> id_to_face_name;

  uint32_t GetPointIndex(const Vec3& point) {
    std::ostringstream stream;
    stream.precision(std::numeric_limits<double>::max_digits10);
    stream << point.x << ',' << point.y << ',' << point.z;
    const std::string key = stream.str();
    const auto found = vert_key_to_index.find(key);
    if (found != vert_key_to_index.end()) return found->second;

    const uint32_t index = static_cast<uint32_t>(vert_properties.size() / 3);
    vert_properties.push_back(static_cast<float>(point.x));
    vert_properties.push_back(static_cast<float>(point.y));
    vert_properties.push_back(static_cast<float>(point.z));
    vert_key_to_index.emplace(key, index);
    return index;
  }

  uint32_t EnsureFaceId(const std::string& face_name) {
    const auto found = face_name_to_id.find(face_name);
    if (found != face_name_to_id.end()) return found->second;
    const uint32_t id = manifold::Manifold::ReserveIDs(1);
    face_name_to_id.emplace(face_name, id);
    id_to_face_name.emplace(id, face_name);
    return id;
  }

  void AddTriangle(const std::string& face_name, const Vec3& a, const Vec3& b,
                   const Vec3& c) {
    const uint32_t face_id = EnsureFaceId(face_name);
    tri_verts.push_back(GetPointIndex(a));
    tri_verts.push_back(GetPointIndex(b));
    tri_verts.push_back(GetPointIndex(c));
    tri_ids.push_back(face_id);
  }
};

double ReadFiniteNumber(const emscripten::val& value, const char* label) {
  if (value.isUndefined() || value.isNull()) {
    throw std::runtime_error(std::string("Missing numeric value: ") + label);
  }
  const double number = value.as<double>();
  if (!std::isfinite(number)) {
    throw std::runtime_error(std::string("Non-finite numeric value: ") + label);
  }
  return number;
}

std::string ReadString(const emscripten::val& value, const char* fallback) {
  if (value.isUndefined() || value.isNull()) return std::string(fallback);
  std::string out = value.as<std::string>();
  if (out.empty()) out = fallback;
  return out;
}

std::vector<Vec3> ReadPoints(const emscripten::val& values, const char* label) {
  if (values.isUndefined() || values.isNull()) {
    throw std::runtime_error(std::string("Missing point array: ") + label);
  }
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<Vec3> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val point = values[i];
    if (point.isUndefined() || point.isNull()) continue;
    const double x = point[0].as<double>();
    const double y = point[1].as<double>();
    const double z = point[2].as<double>();
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
      throw std::runtime_error(std::string("Non-finite point in array: ") + label);
    }
    out.push_back({x, y, z});
  }
  return out;
}

emscripten::val ToJsArray(const std::vector<float>& values) {
  emscripten::val array = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    array.set(i, emscripten::val(values[i]));
  }
  return array;
}

emscripten::val ToJsArray(const std::vector<uint32_t>& values) {
  emscripten::val array = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    array.set(i, emscripten::val(values[i]));
  }
  return array;
}

emscripten::val ToPointArray(const std::vector<Vec3>& values) {
  emscripten::val array = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    emscripten::val point = emscripten::val::array();
    point.set(0, values[i].x);
    point.set(1, values[i].y);
    point.set(2, values[i].z);
    array.set(i, point);
  }
  return array;
}

emscripten::val ToFaceNameEntries(
    const std::unordered_map<std::string, uint32_t>& values) {
  emscripten::val array = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    array.set(index++, pair);
  }
  return array;
}

emscripten::val ToFaceIdEntries(
    const std::unordered_map<uint32_t, std::string>& values) {
  emscripten::val array = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    array.set(index++, pair);
  }
  return array;
}

emscripten::val ToStringMapEntries(
    const std::unordered_map<std::string, std::string>& values) {
  emscripten::val array = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& entry : values) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, entry.first);
    pair.set(1, entry.second);
    array.set(index++, pair);
  }
  return array;
}

std::vector<AuxEdgeRecord> ReadAuxEdges(const emscripten::val& values) {
  std::vector<AuxEdgeRecord> out;
  if (values.isUndefined() || values.isNull()) return out;
  const uint32_t length = values["length"].as<uint32_t>();
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val entry = values[i];
    if (entry.isUndefined() || entry.isNull()) continue;
    AuxEdgeRecord record;
    record.name = ReadString(entry["name"], "EDGE");
    record.closed_loop =
        !entry["closedLoop"].isUndefined() && !entry["closedLoop"].isNull() &&
        entry["closedLoop"].as<bool>();
    record.polyline_world =
        !entry["polylineWorld"].isUndefined() &&
        !entry["polylineWorld"].isNull() &&
        entry["polylineWorld"].as<bool>();
    record.centerline =
        !entry["centerline"].isUndefined() && !entry["centerline"].isNull() &&
        entry["centerline"].as<bool>();
    record.material_key = ReadString(entry["materialKey"], "");
    record.face_a = ReadString(entry["faceA"], "");
    record.face_b = ReadString(entry["faceB"], "");
    const emscripten::val points = entry["points"];
    if (points.isUndefined() || points.isNull()) continue;
    const uint32_t point_count = points["length"].as<uint32_t>();
    for (uint32_t p = 0; p < point_count; ++p) {
      const emscripten::val point = points[p];
      if (point.isUndefined() || point.isNull()) continue;
      const double x = point[0].as<double>();
      const double y = point[1].as<double>();
      const double z = point[2].as<double>();
      if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) continue;
      record.points.push_back({x, y, z});
    }
    if (record.points.size() < 2) continue;
    out.push_back(std::move(record));
  }
  return out;
}

emscripten::val ToAuxEdges(const std::vector<AuxEdgeRecord>& aux_edges) {
  emscripten::val array = emscripten::val::array();
  uint32_t index = 0;
  for (const auto& aux : aux_edges) {
    if (aux.points.size() < 2) continue;
    emscripten::val entry = emscripten::val::object();
    entry.set("name", aux.name);
    entry.set("closedLoop", aux.closed_loop);
    entry.set("polylineWorld", aux.polyline_world);
    entry.set("centerline", aux.centerline);
    if (!aux.material_key.empty()) entry.set("materialKey", aux.material_key);
    if (!aux.face_a.empty()) entry.set("faceA", aux.face_a);
    if (!aux.face_b.empty()) entry.set("faceB", aux.face_b);
    emscripten::val points = emscripten::val::array();
    for (uint32_t p = 0; p < aux.points.size(); ++p) {
      emscripten::val point = emscripten::val::array();
      point.set(0, aux.points[p][0]);
      point.set(1, aux.points[p][1]);
      point.set(2, aux.points[p][2]);
      points.set(p, point);
    }
    entry.set("points", points);
    array.set(index++, entry);
  }
  return array;
}

void MergeAuxEdges(std::vector<AuxEdgeRecord>& target,
                   const std::vector<AuxEdgeRecord>& src) {
  target.insert(target.end(), src.begin(), src.end());
}

emscripten::val BuildSnapshot(const SnapshotBuilder& builder,
                              const std::unordered_map<std::string, std::string>&
                                  face_metadata_json = {},
                              const std::vector<AuxEdgeRecord>& aux_edges = {}) {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", kNumProp);
  snapshot.set("vertProperties", ToJsArray(builder.vert_properties));
  snapshot.set("triVerts", ToJsArray(builder.tri_verts));
  snapshot.set("triIDs", ToJsArray(builder.tri_ids));
  snapshot.set("faceNameToID", ToFaceNameEntries(builder.face_name_to_id));
  snapshot.set("idToFaceName", ToFaceIdEntries(builder.id_to_face_name));
  snapshot.set("faceMetadataJson", ToStringMapEntries(face_metadata_json));
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("auxEdges", ToAuxEdges(aux_edges));
  snapshot.set("vertexCount",
               static_cast<uint32_t>(builder.vert_properties.size() / 3));
  snapshot.set("triangleCount", static_cast<uint32_t>(builder.tri_ids.size()));
  return snapshot;
}

manifold::MeshGL SnapshotToMesh(const emscripten::val& snapshot) {
  manifold::MeshGL mesh;
  const emscripten::val num_prop_val = snapshot["numProp"];
  mesh.numProp =
      (num_prop_val.isUndefined() || num_prop_val.isNull())
          ? 3
          : static_cast<uint32_t>(num_prop_val.as<double>());

  const emscripten::val vp = snapshot["vertProperties"];
  const uint32_t vp_length = vp["length"].as<uint32_t>();
  mesh.vertProperties.reserve(vp_length);
  for (uint32_t i = 0; i < vp_length; ++i) {
    mesh.vertProperties.push_back(vp[i].as<float>());
  }

  const emscripten::val tv = snapshot["triVerts"];
  const uint32_t tv_length = tv["length"].as<uint32_t>();
  mesh.triVerts.reserve(tv_length);
  for (uint32_t i = 0; i < tv_length; ++i) {
    mesh.triVerts.push_back(tv[i].as<uint32_t>());
  }

  const emscripten::val ids = snapshot["triIDs"];
  const uint32_t id_length = ids["length"].as<uint32_t>();
  mesh.faceID.reserve(id_length);
  for (uint32_t i = 0; i < id_length; ++i) {
    mesh.faceID.push_back(ids[i].as<uint32_t>());
  }
  return mesh;
}

manifold::MeshGL PreparedMeshToMesh(const emscripten::val& prepared) {
  manifold::MeshGL mesh;
  const emscripten::val num_prop_val = prepared["numProp"];
  mesh.numProp =
      (num_prop_val.isUndefined() || num_prop_val.isNull())
          ? 3
          : static_cast<uint32_t>(num_prop_val.as<double>());

  const emscripten::val vp = prepared["vertProperties"];
  const uint32_t vp_length = vp["length"].as<uint32_t>();
  mesh.vertProperties.reserve(vp_length);
  for (uint32_t i = 0; i < vp_length; ++i) {
    mesh.vertProperties.push_back(vp[i].as<float>());
  }

  const emscripten::val tv = prepared["triVerts"];
  const uint32_t tv_length = tv["length"].as<uint32_t>();
  mesh.triVerts.reserve(tv_length);
  for (uint32_t i = 0; i < tv_length; ++i) {
    mesh.triVerts.push_back(tv[i].as<uint32_t>());
  }

  const emscripten::val ids = prepared["faceID"];
  const uint32_t id_length = ids["length"].as<uint32_t>();
  mesh.faceID.reserve(id_length);
  for (uint32_t i = 0; i < id_length; ++i) {
    mesh.faceID.push_back(ids[i].as<uint32_t>());
  }

  const emscripten::val merge_from = prepared["mergeFromVert"];
  if (!merge_from.isUndefined() && !merge_from.isNull()) {
    const uint32_t merge_from_length = merge_from["length"].as<uint32_t>();
    mesh.mergeFromVert.reserve(merge_from_length);
    for (uint32_t i = 0; i < merge_from_length; ++i) {
      mesh.mergeFromVert.push_back(merge_from[i].as<uint32_t>());
    }
  }

  const emscripten::val merge_to = prepared["mergeToVert"];
  if (!merge_to.isUndefined() && !merge_to.isNull()) {
    const uint32_t merge_to_length = merge_to["length"].as<uint32_t>();
    mesh.mergeToVert.reserve(merge_to_length);
    for (uint32_t i = 0; i < merge_to_length; ++i) {
      mesh.mergeToVert.push_back(merge_to[i].as<uint32_t>());
    }
  }

  return mesh;
}

std::unordered_map<uint32_t, std::string> ReadIdToFaceName(
    const emscripten::val& entries) {
  std::unordered_map<uint32_t, std::string> out;
  if (entries.isUndefined() || entries.isNull()) return out;
  const uint32_t length = entries["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = entries[i];
    if (pair.isUndefined() || pair.isNull()) continue;
    out.emplace(pair[0].as<uint32_t>(), pair[1].as<std::string>());
  }
  return out;
}

std::unordered_map<std::string, uint32_t> ReadFaceNameToId(
    const emscripten::val& entries) {
  std::unordered_map<std::string, uint32_t> out;
  if (entries.isUndefined() || entries.isNull()) return out;
  const uint32_t length = entries["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = entries[i];
    if (pair.isUndefined() || pair.isNull()) continue;
    out.emplace(pair[0].as<std::string>(), pair[1].as<uint32_t>());
  }
  return out;
}

std::unordered_map<std::string, std::string> ReadStringMapEntries(
    const emscripten::val& entries) {
  std::unordered_map<std::string, std::string> out;
  if (entries.isUndefined() || entries.isNull()) return out;
  const uint32_t length = entries["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = entries[i];
    if (pair.isUndefined() || pair.isNull()) continue;
    out.emplace(pair[0].as<std::string>(), pair[1].as<std::string>());
  }
  return out;
}

std::unordered_map<uint32_t, std::string> BuildResolvedIdToFaceName(
    const emscripten::val& snapshot);
double TriangleArea(const Vec3& a, const Vec3& b, const Vec3& c);
bool PointInsideMesh(const manifold::MeshGL& mesh, const Vec3& point);

struct SnapshotInfo {
  manifold::MeshGL mesh;
  std::unordered_map<uint32_t, std::string> id_to_face_name;
  std::unordered_map<std::string, uint32_t> face_name_to_id;
  std::unordered_map<std::string, std::string> face_metadata_json;
  std::unordered_map<std::string, std::string> edge_metadata_json;
  std::vector<AuxEdgeRecord> aux_edges;
};

SnapshotInfo ReadSnapshotInfo(const emscripten::val& snapshot) {
  SnapshotInfo info;
  info.mesh = SnapshotToMesh(snapshot);
  info.id_to_face_name = BuildResolvedIdToFaceName(snapshot);
  info.face_name_to_id = ReadFaceNameToId(snapshot["faceNameToID"]);
  if (info.face_name_to_id.empty()) {
    for (const auto& entry : info.id_to_face_name) {
      info.face_name_to_id.emplace(entry.second, entry.first);
    }
  }
  info.face_metadata_json = ReadStringMapEntries(snapshot["faceMetadataJson"]);
  info.edge_metadata_json = ReadStringMapEntries(snapshot["edgeMetadataJson"]);
  info.aux_edges = ReadAuxEdges(snapshot["auxEdges"]);
  return info;
}

SnapshotInfo ReadBooleanReadySnapshotInfo(
    const emscripten::val& snapshot,
    const std::string& fallback_name = std::string()) {
  emscripten::val canonical = emscripten::val::object();
  canonical.set("numProp", snapshot["numProp"]);
  canonical.set("vertProperties", snapshot["vertProperties"]);
  canonical.set("triVerts", snapshot["triVerts"]);
  canonical.set("triIDs", snapshot["triIDs"]);
  canonical.set("faceNameToID", snapshot["faceNameToID"]);
  canonical.set("idToFaceName", snapshot["idToFaceName"]);
  canonical.set("faceMetadataJson", snapshot["faceMetadataJson"]);
  canonical.set("edgeMetadataJson", snapshot["edgeMetadataJson"]);
  canonical.set("auxEdges", snapshot["auxEdges"]);
  const std::string snapshot_name =
      fallback_name.empty() ? ReadString(snapshot["name"], "") : fallback_name;
  if (!snapshot_name.empty()) canonical.set("name", snapshot_name);

  BrepSolidCore core;
  core.SetAuthoringState(canonical);
  core.NormalizeFaceTracking();

  SnapshotInfo info;
  const emscripten::val normalized = core.GetAuthoringState();
  info.mesh = PreparedMeshToMesh(core.PrepareManifoldMesh());
  info.id_to_face_name = BuildResolvedIdToFaceName(normalized);
  info.face_name_to_id = ReadFaceNameToId(normalized["faceNameToID"]);
  if (info.face_name_to_id.empty()) {
    for (const auto& entry : info.id_to_face_name) {
      info.face_name_to_id.emplace(entry.second, entry.first);
    }
  }
  info.face_metadata_json = ReadStringMapEntries(normalized["faceMetadataJson"]);
  info.edge_metadata_json = ReadStringMapEntries(normalized["edgeMetadataJson"]);
  info.aux_edges = ReadAuxEdges(normalized["auxEdges"]);
  return info;
}

bool IsFallbackFaceName(const std::string& name, uint32_t id_hint = 0,
                        bool has_id_hint = false) {
  const std::string raw = name;
  if (raw.empty()) return true;
  if (raw == "FACE") return true;
  if (raw.rfind("FACE_", 0) == 0) {
    if (raw.size() > 5) return true;
  }
  if (has_id_hint && raw == ("FACE_" + std::to_string(id_hint))) return true;
  return false;
}

std::unordered_map<uint32_t, std::string> CombineIdMaps(
    const std::unordered_map<uint32_t, std::string>& left,
    const std::unordered_map<uint32_t, std::string>& right) {
  std::unordered_map<uint32_t, std::string> merged(left.begin(), left.end());
  for (const auto& entry : right) {
    const uint32_t id = entry.first;
    const std::string incoming = entry.second;
    const auto found = merged.find(id);
    if (found == merged.end()) {
      merged.emplace(id, incoming);
      continue;
    }
    if (found->second == incoming) continue;
    const bool existing_is_fallback =
        IsFallbackFaceName(found->second, id, true);
    const bool incoming_is_fallback = IsFallbackFaceName(incoming, id, true);
    if (existing_is_fallback && !incoming_is_fallback) {
      found->second = incoming;
    }
  }
  return merged;
}

void MergeMetadataMaps(std::unordered_map<std::string, std::string>& target,
                       const std::unordered_map<std::string, std::string>& src) {
  for (const auto& entry : src) target[entry.first] = entry.second;
}

double EdgeLength(const manifold::MeshGL& mesh, uint32_t a, uint32_t b) {
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t abase = a * stride;
  const uint32_t bbase = b * stride;
  if (abase + 2 >= mesh.vertProperties.size() || bbase + 2 >= mesh.vertProperties.size()) {
    return 0.0;
  }
  const double dx = mesh.vertProperties[bbase + 0] - mesh.vertProperties[abase + 0];
  const double dy = mesh.vertProperties[bbase + 1] - mesh.vertProperties[abase + 1];
  const double dz = mesh.vertProperties[bbase + 2] - mesh.vertProperties[abase + 2];
  return std::sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

std::unordered_map<uint32_t, double> BuildFaceAreas(const manifold::MeshGL& mesh) {
  std::unordered_map<uint32_t, double> areas;
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    const uint32_t a = i0 * stride;
    const uint32_t b = i1 * stride;
    const uint32_t c = i2 * stride;
    if (a + 2 >= mesh.vertProperties.size() || b + 2 >= mesh.vertProperties.size() ||
        c + 2 >= mesh.vertProperties.size()) {
      continue;
    }
    const Vec3 p0{mesh.vertProperties[a + 0], mesh.vertProperties[a + 1],
                  mesh.vertProperties[a + 2]};
    const Vec3 p1{mesh.vertProperties[b + 0], mesh.vertProperties[b + 1],
                  mesh.vertProperties[b + 2]};
    const Vec3 p2{mesh.vertProperties[c + 0], mesh.vertProperties[c + 1],
                  mesh.vertProperties[c + 2]};
    areas[mesh.faceID[tri_idx]] += TriangleArea(p0, p1, p2);
  }
  return areas;
}

void NormalizeFaceMaps(
    const manifold::MeshGL& mesh,
    std::unordered_map<uint32_t, std::string>& id_to_face_name,
    std::unordered_map<std::string, uint32_t>& face_name_to_id,
    std::unordered_map<std::string, std::string>& face_metadata_json) {
  std::unordered_set<uint32_t> seen_ids(mesh.faceID.begin(), mesh.faceID.end());
  std::unordered_map<uint32_t, std::string> normalized_id_to_name;
  std::unordered_map<std::string, uint32_t> normalized_name_to_id;
  std::unordered_map<std::string, std::string> normalized_meta;
  for (const uint32_t id : seen_ids) {
    std::string face_name = "FACE_" + std::to_string(id);
    const auto found = id_to_face_name.find(id);
    if (found != id_to_face_name.end() && !found->second.empty()) {
      face_name = found->second;
    }
    normalized_id_to_name.emplace(id, face_name);
    normalized_name_to_id.emplace(face_name, id);
    const auto meta_found = face_metadata_json.find(face_name);
    if (meta_found != face_metadata_json.end()) {
      normalized_meta.emplace(face_name, meta_found->second);
    }
  }
  id_to_face_name.swap(normalized_id_to_name);
  face_name_to_id.swap(normalized_name_to_id);
  face_metadata_json.swap(normalized_meta);
}

bool JsonContains(const std::string& json, const std::string& needle) {
  return !json.empty() && json.find(needle) != std::string::npos;
}

int ScoreFallbackRenameTarget(const std::string& face_name,
                              const std::string& metadata_json,
                              const std::string& feature_id) {
  const bool is_merged_side_wall =
      JsonContains(metadata_json, "\"filletMergedSideWall\":true") ||
      JsonContains(metadata_json, "\"filletSideWall\":true");
  const bool has_round_face =
      JsonContains(metadata_json, "\"filletRoundFace\":\"");
  const bool is_tube_outer =
      face_name.size() >= 11 &&
      face_name.rfind("_TUBE_Outer") == face_name.size() - 11;
  const bool is_tube_cap =
      (face_name.size() >= 14 &&
       face_name.rfind("_TUBE_CapStart") == face_name.size() - 14) ||
      (face_name.size() >= 12 &&
       face_name.rfind("_TUBE_CapEnd") == face_name.size() - 12);
  bool is_feature_owned = false;
  if (!feature_id.empty()) {
    const std::string feature_token = "\"" + feature_id + "\"";
    is_feature_owned = JsonContains(metadata_json,
                                    "\"featureID\":" + feature_token) ||
                       JsonContains(metadata_json,
                                    "\"sourceFeatureId\":" + feature_token) ||
                       face_name.rfind(feature_id + "_", 0) == 0;
  }
  if (is_merged_side_wall) return 5;
  if (is_feature_owned && (has_round_face || is_tube_outer)) return 4;
  if (is_feature_owned || is_tube_cap) return 3;
  if (has_round_face || is_tube_outer) return 2;
  return 1;
}

void ReplaceFaceId(manifold::MeshGL& mesh, uint32_t old_id, uint32_t new_id) {
  for (uint32_t& id : mesh.faceID) {
    if (id == old_id) id = new_id;
  }
}

void RelabelFallbackFacesByAdjacency(
    manifold::MeshGL& mesh, std::unordered_map<uint32_t, std::string>& id_to_face_name,
    std::unordered_map<std::string, uint32_t>& face_name_to_id,
    std::unordered_map<std::string, std::string>& face_metadata_json,
    const std::string& feature_id) {
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  if (tri_count == 0 || mesh.faceID.size() < tri_count) return;
  for (uint32_t pass = 0; pass < 3; ++pass) {
    NormalizeFaceMaps(mesh, id_to_face_name, face_name_to_id, face_metadata_json);
    const auto face_areas = BuildFaceAreas(mesh);
    std::unordered_set<uint32_t> fallback_ids;
    for (const auto& entry : id_to_face_name) {
      if (IsFallbackFaceName(entry.second, entry.first, true)) {
        fallback_ids.insert(entry.first);
      }
    }
    if (fallback_ids.empty()) break;

    std::unordered_map<uint32_t, std::unordered_map<uint32_t, double>> adjacency;
    std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
    edge_to_tris.reserve(tri_count * 3);
    for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
      const uint32_t tri_base = tri_idx * 3;
      const uint32_t i0 = mesh.triVerts[tri_base + 0];
      const uint32_t i1 = mesh.triVerts[tri_base + 1];
      const uint32_t i2 = mesh.triVerts[tri_base + 2];
      edge_to_tris[std::to_string(std::min(i0, i1)) + "|" +
                   std::to_string(std::max(i0, i1))]
          .push_back(tri_idx);
      edge_to_tris[std::to_string(std::min(i1, i2)) + "|" +
                   std::to_string(std::max(i1, i2))]
          .push_back(tri_idx);
      edge_to_tris[std::to_string(std::min(i2, i0)) + "|" +
                   std::to_string(std::max(i2, i0))]
          .push_back(tri_idx);
    }
    for (const auto& entry : edge_to_tris) {
      if (entry.second.size() != 2) continue;
      const uint32_t tri_a = entry.second[0];
      const uint32_t tri_b = entry.second[1];
      const uint32_t face_a = mesh.faceID[tri_a];
      const uint32_t face_b = mesh.faceID[tri_b];
      if (face_a == face_b) continue;
      const size_t split = entry.first.find('|');
      const uint32_t va = static_cast<uint32_t>(std::stoul(entry.first.substr(0, split)));
      const uint32_t vb =
          static_cast<uint32_t>(std::stoul(entry.first.substr(split + 1)));
      const double length = EdgeLength(mesh, va, vb);
      if (!(length > 0.0)) continue;
      if (fallback_ids.count(face_a) && !fallback_ids.count(face_b)) {
        adjacency[face_a][face_b] += length;
      }
      if (fallback_ids.count(face_b) && !fallback_ids.count(face_a)) {
        adjacency[face_b][face_a] += length;
      }
    }

    uint32_t renamed_this_pass = 0;
    for (const uint32_t fallback_id : fallback_ids) {
      const auto neighbors_found = adjacency.find(fallback_id);
      if (neighbors_found == adjacency.end() || neighbors_found->second.empty()) {
        continue;
      }
      uint32_t best_id = 0;
      int best_rank = std::numeric_limits<int>::min();
      double best_length = -1.0;
      double best_area = -1.0;
      for (const auto& neighbor : neighbors_found->second) {
        const uint32_t neighbor_id = neighbor.first;
        const auto name_found = id_to_face_name.find(neighbor_id);
        if (name_found == id_to_face_name.end()) continue;
        const auto meta_found = face_metadata_json.find(name_found->second);
        const std::string metadata_json =
            meta_found == face_metadata_json.end() ? std::string()
                                                   : meta_found->second;
        const int rank =
            ScoreFallbackRenameTarget(name_found->second, metadata_json, feature_id);
        const double shared_length = neighbor.second;
        const double area =
            face_areas.count(neighbor_id) ? face_areas.at(neighbor_id) : 0.0;
        if (rank > best_rank || (rank == best_rank && shared_length > best_length) ||
            (rank == best_rank && shared_length == best_length && area > best_area)) {
          best_id = neighbor_id;
          best_rank = rank;
          best_length = shared_length;
          best_area = area;
        }
      }
      if (best_length <= 0.0) continue;
      ReplaceFaceId(mesh, fallback_id, best_id);
      renamed_this_pass++;
    }
    if (renamed_this_pass == 0) break;
  }
  NormalizeFaceMaps(mesh, id_to_face_name, face_name_to_id, face_metadata_json);
}

void CleanupTinyFaceIslands(
    manifold::MeshGL& mesh, std::unordered_map<uint32_t, std::string>& id_to_face_name,
    std::unordered_map<std::string, uint32_t>& face_name_to_id,
    std::unordered_map<std::string, std::string>& face_metadata_json,
    double max_area) {
  if (!(max_area > 0.0)) return;
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  if (tri_count == 0 || mesh.faceID.size() < tri_count) return;
  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
  edge_to_tris.reserve(tri_count * 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    edge_to_tris[std::to_string(std::min(i0, i1)) + "|" +
                 std::to_string(std::max(i0, i1))]
        .push_back(tri_idx);
    edge_to_tris[std::to_string(std::min(i1, i2)) + "|" +
                 std::to_string(std::max(i1, i2))]
        .push_back(tri_idx);
    edge_to_tris[std::to_string(std::min(i2, i0)) + "|" +
                 std::to_string(std::max(i2, i0))]
        .push_back(tri_idx);
  }
  std::vector<std::vector<uint32_t>> tri_adj(tri_count);
  for (const auto& entry : edge_to_tris) {
    if (entry.second.size() != 2) continue;
    const uint32_t a = entry.second[0];
    const uint32_t b = entry.second[1];
    tri_adj[a].push_back(b);
    tri_adj[b].push_back(a);
  }
  std::vector<uint8_t> seen(tri_count, 0);
  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (seen[seed]) continue;
    const uint32_t face_id = mesh.faceID[seed];
    std::vector<uint32_t> stack = {seed};
    std::vector<uint32_t> component_tris;
    std::unordered_map<uint32_t, uint32_t> neighbor_counts;
    double component_area = 0.0;
    seen[seed] = 1;
    while (!stack.empty()) {
      const uint32_t tri_idx = stack.back();
      stack.pop_back();
      component_tris.push_back(tri_idx);
      const uint32_t tri_base = tri_idx * 3;
      const uint32_t i0 = mesh.triVerts[tri_base + 0] * std::max<uint32_t>(3, mesh.numProp);
      const uint32_t i1 = mesh.triVerts[tri_base + 1] * std::max<uint32_t>(3, mesh.numProp);
      const uint32_t i2 = mesh.triVerts[tri_base + 2] * std::max<uint32_t>(3, mesh.numProp);
      if (i0 + 2 < mesh.vertProperties.size() && i1 + 2 < mesh.vertProperties.size() &&
          i2 + 2 < mesh.vertProperties.size()) {
        const Vec3 a{mesh.vertProperties[i0 + 0], mesh.vertProperties[i0 + 1],
                     mesh.vertProperties[i0 + 2]};
        const Vec3 b{mesh.vertProperties[i1 + 0], mesh.vertProperties[i1 + 1],
                     mesh.vertProperties[i1 + 2]};
        const Vec3 c{mesh.vertProperties[i2 + 0], mesh.vertProperties[i2 + 1],
                     mesh.vertProperties[i2 + 2]};
        component_area += TriangleArea(a, b, c);
      }
      for (const uint32_t neighbor_tri : tri_adj[tri_idx]) {
        const uint32_t neighbor_face_id = mesh.faceID[neighbor_tri];
        if (neighbor_face_id == face_id) {
          if (!seen[neighbor_tri]) {
            seen[neighbor_tri] = 1;
            stack.push_back(neighbor_tri);
          }
        } else {
          neighbor_counts[neighbor_face_id] += 1;
        }
      }
    }
    if (!(component_area <= max_area) || neighbor_counts.size() != 1) continue;
    const uint32_t new_face_id = neighbor_counts.begin()->first;
    for (const uint32_t tri_idx : component_tris) {
      mesh.faceID[tri_idx] = new_face_id;
    }
  }
  NormalizeFaceMaps(mesh, id_to_face_name, face_name_to_id, face_metadata_json);
}

emscripten::val BuildSnapshotFromMesh(
    const manifold::MeshGL& mesh,
    std::unordered_map<uint32_t, std::string> id_to_face_name,
    std::unordered_map<std::string, uint32_t> face_name_to_id,
    std::unordered_map<std::string, std::string> face_metadata_json,
    std::unordered_map<std::string, std::string> edge_metadata_json = {},
    std::vector<AuxEdgeRecord> aux_edges = {},
    const std::string& name = std::string()) {
  NormalizeFaceMaps(mesh, id_to_face_name, face_name_to_id, face_metadata_json);
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", mesh.numProp);
  snapshot.set("vertProperties", ToJsArray(mesh.vertProperties));
  snapshot.set("triVerts", ToJsArray(mesh.triVerts));
  snapshot.set("triIDs", ToJsArray(mesh.faceID));
  snapshot.set("faceNameToID", ToFaceNameEntries(face_name_to_id));
  snapshot.set("idToFaceName", ToFaceIdEntries(id_to_face_name));
  snapshot.set("faceMetadataJson", ToStringMapEntries(face_metadata_json));
  snapshot.set("edgeMetadataJson", ToStringMapEntries(edge_metadata_json));
  snapshot.set("auxEdges", ToAuxEdges(aux_edges));
  snapshot.set("vertexCount", static_cast<uint32_t>(mesh.NumVert()));
  snapshot.set("triangleCount", static_cast<uint32_t>(mesh.NumTri()));
  if (!name.empty()) snapshot.set("name", name);
  return snapshot;
}

std::unordered_map<uint32_t, std::string> BuildResolvedIdToFaceName(
    const emscripten::val& snapshot) {
  std::vector<uint32_t> tri_ids;
  const emscripten::val tri_ids_val = snapshot["triIDs"];
  const uint32_t tri_count = tri_ids_val["length"].as<uint32_t>();
  tri_ids.reserve(tri_count);
  for (uint32_t i = 0; i < tri_count; ++i) tri_ids.push_back(tri_ids_val[i].as<uint32_t>());

  std::unordered_set<uint32_t> tri_set(tri_ids.begin(), tri_ids.end());
  std::vector<uint32_t> tri_ids_sorted(tri_set.begin(), tri_set.end());
  std::sort(tri_ids_sorted.begin(), tri_ids_sorted.end());

  std::unordered_map<uint32_t, std::string> id_to_face =
      ReadIdToFaceName(snapshot["idToFaceName"]);
  if (id_to_face.empty()) {
    const auto face_to_id = ReadFaceNameToId(snapshot["faceNameToID"]);
    for (const auto& entry : face_to_id) id_to_face.emplace(entry.second, entry.first);
  }

  bool covers_all = true;
  for (const uint32_t id : tri_ids_sorted) {
    if (!id_to_face.count(id)) {
      covers_all = false;
      break;
    }
  }
  if (covers_all || tri_ids_sorted.empty()) return id_to_face;

  if (id_to_face.size() == tri_ids_sorted.size()) {
    std::vector<std::pair<uint32_t, std::string>> ordered(id_to_face.begin(),
                                                          id_to_face.end());
    std::sort(ordered.begin(), ordered.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });
    std::unordered_map<uint32_t, std::string> resolved;
    for (size_t i = 0; i < tri_ids_sorted.size(); ++i) {
      resolved.emplace(tri_ids_sorted[i], ordered[i].second);
    }
    return resolved;
  }

  for (const uint32_t id : tri_ids_sorted) {
    if (!id_to_face.count(id)) {
      id_to_face.emplace(id, "FACE_" + std::to_string(id));
    }
  }
  return id_to_face;
}

double TriangleArea(const Vec3& a, const Vec3& b, const Vec3& c) {
  const double ux = b.x - a.x;
  const double uy = b.y - a.y;
  const double uz = b.z - a.z;
  const double vx = c.x - a.x;
  const double vy = c.y - a.y;
  const double vz = c.z - a.z;
  const double cx = uy * vz - uz * vy;
  const double cy = uz * vx - ux * vz;
  const double cz = ux * vy - uy * vx;
  return 0.5 * std::sqrt((cx * cx) + (cy * cy) + (cz * cz));
}

double Dot(const Vec3& a, const Vec3& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 Add(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 Subtract(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 Scale(const Vec3& v, double scale) {
  return {v.x * scale, v.y * scale, v.z * scale};
}

Vec3 Cross(const Vec3& a, const Vec3& b) {
  return {
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
  };
}

double LengthSq(const Vec3& v) { return Dot(v, v); }

Vec3 Normalize(const Vec3& v) {
  const double len_sq = LengthSq(v);
  if (!(len_sq > 0.0)) return {};
  return Scale(v, 1.0 / std::sqrt(len_sq));
}

double DistanceSq(const Vec3& a, const Vec3& b) {
  return LengthSq(Subtract(a, b));
}

manifold::vec3 ToManifoldVec3(const Vec3& v) {
  return manifold::vec3(v.x, v.y, v.z);
}

bool IsFinitePoint(const Vec3& point) {
  return std::isfinite(point.x) && std::isfinite(point.y) && std::isfinite(point.z);
}

bool AddTriangleIfValid(SnapshotBuilder& builder, const std::string& face_name,
                        const Vec3& a, const Vec3& b, const Vec3& c,
                        double min_triangle_area) {
  if (!IsFinitePoint(a) || !IsFinitePoint(b) || !IsFinitePoint(c)) return false;
  if (!(TriangleArea(a, b, c) > min_triangle_area)) return false;
  builder.AddTriangle(face_name, a, b, c);
  return true;
}

std::vector<Vec3> BuildTubePath(const std::vector<Vec3>& centerline, bool closed) {
  std::vector<Vec3> path = centerline;
  if (path.size() < 2) return path;
  if (closed) {
    const Vec3& first = path.front();
    const Vec3& last = path.back();
    if (std::abs(first.x - last.x) > kEps || std::abs(first.y - last.y) > kEps ||
        std::abs(first.z - last.z) > kEps) {
      path.push_back(first);
    }
    return path;
  }

  constexpr double extension_distance = 0.1;
  {
    const Vec3 p0 = path[0];
    const Vec3 p1 = path[1];
    const double dx = p0.x - p1.x;
    const double dy = p0.y - p1.y;
    const double dz = p0.z - p1.z;
    const double len = std::sqrt((dx * dx) + (dy * dy) + (dz * dz));
    if (len > kEps) {
      path[0] = {p0.x + (dx / len) * extension_distance,
                 p0.y + (dy / len) * extension_distance,
                 p0.z + (dz / len) * extension_distance};
    }
  }
  {
    const size_t last_index = path.size() - 1;
    const Vec3 p_last = path[last_index];
    const Vec3 p_prev = path[last_index - 1];
    const double dx = p_last.x - p_prev.x;
    const double dy = p_last.y - p_prev.y;
    const double dz = p_last.z - p_prev.z;
    const double len = std::sqrt((dx * dx) + (dy * dy) + (dz * dz));
    if (len > kEps) {
      path[last_index] = {p_last.x + (dx / len) * extension_distance,
                          p_last.y + (dy / len) * extension_distance,
                          p_last.z + (dz / len) * extension_distance};
    }
  }
  return path;
}

double ComputeFaceArea(const emscripten::val& snapshot, uint32_t face_id) {
  const emscripten::val vp = snapshot["vertProperties"];
  const emscripten::val tv = snapshot["triVerts"];
  const emscripten::val ids = snapshot["triIDs"];
  const uint32_t tri_count = ids["length"].as<uint32_t>();
  double area = 0.0;
  for (uint32_t t = 0; t < tri_count; ++t) {
    if (ids[t].as<uint32_t>() != face_id) continue;
    const uint32_t base = t * 3;
    const uint32_t i0 = tv[base + 0].as<uint32_t>() * 3;
    const uint32_t i1 = tv[base + 1].as<uint32_t>() * 3;
    const uint32_t i2 = tv[base + 2].as<uint32_t>() * 3;
    const Vec3 a{vp[i0 + 0].as<double>(), vp[i0 + 1].as<double>(), vp[i0 + 2].as<double>()};
    const Vec3 b{vp[i1 + 0].as<double>(), vp[i1 + 1].as<double>(), vp[i1 + 2].as<double>()};
    const Vec3 c{vp[i2 + 0].as<double>(), vp[i2 + 1].as<double>(), vp[i2 + 2].as<double>()};
    area += TriangleArea(a, b, c);
  }
  return area;
}

std::string JsonString(double value) {
  std::ostringstream stream;
  stream.precision(std::numeric_limits<double>::max_digits10);
  stream << value;
  return stream.str();
}

std::string PipeMetadataJson(const std::string& feature_id, double radius,
                             double requested_radius, const std::string& edge_reference) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"type\":\"pipe\",\"source\":\"FilletFeature\",\"featureID\":\""
       << feature_id << "\",\"inflatedRadius\":" << radius
       << ",\"pmiRadiusOverride\":" << requested_radius
       << ",\"radiusOverride\":" << requested_radius;
  if (!edge_reference.empty()) {
    json << ",\"edgeReference\":\"" << edge_reference << "\"";
  }
  json << "}";
  return json.str();
}

std::string FilletSourceAreaMetadataJson(double area,
                                         const std::string& round_face_name,
                                         bool is_end_cap) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"filletSourceArea\":" << area << ",\"filletRoundFace\":\""
       << round_face_name << "\",\"filletEndCap\":"
       << (is_end_cap ? "true" : "false") << "}";
  return json.str();
}

std::unordered_map<std::string, std::string> BuildWedgeMetadata(
    const emscripten::val& wedge_snapshot, const std::string& name, bool closed) {
  std::unordered_map<std::string, std::string> metadata;
  const auto id_to_face_name = BuildResolvedIdToFaceName(wedge_snapshot);
  const std::string round_face_name = name + "_TUBE_Outer";
  for (const auto& entry : id_to_face_name) {
    const std::string& face_name = entry.second;
    if (face_name != (name + "_WEDGE_A") && face_name != (name + "_WEDGE_B") &&
        face_name != (name + "_END_CAP_1") && face_name != (name + "_END_CAP_2")) {
      continue;
    }
    if (closed &&
        (face_name == (name + "_END_CAP_1") || face_name == (name + "_END_CAP_2"))) {
      continue;
    }
    const double area = ComputeFaceArea(wedge_snapshot, entry.first);
    if (!(area > 0.0)) continue;
    metadata.emplace(face_name,
                     FilletSourceAreaMetadataJson(
                         area, round_face_name,
                         face_name == (name + "_END_CAP_1") ||
                             face_name == (name + "_END_CAP_2")));
  }
  return metadata;
}

std::unordered_map<std::string, std::string> BuildTubeMetadata(
    const emscripten::val& tube_snapshot, const std::string& name,
    double radius_used, double requested_radius,
    const std::string& edge_reference, bool closed) {
  std::unordered_map<std::string, std::string> metadata;
  const auto id_to_face_name = BuildResolvedIdToFaceName(tube_snapshot);
  const std::string round_face_name = name + "_TUBE_Outer";
  metadata.emplace(round_face_name,
                   PipeMetadataJson(name, radius_used, requested_radius,
                                    edge_reference));
  if (closed) return metadata;
  for (const auto& entry : id_to_face_name) {
    const std::string& face_name = entry.second;
    if (face_name != (name + "_TUBE_CapStart") &&
        face_name != (name + "_TUBE_CapEnd")) {
      continue;
    }
    const double area = ComputeFaceArea(tube_snapshot, entry.first);
    if (!(area > 0.0)) continue;
    metadata.emplace(face_name,
                     FilletSourceAreaMetadataJson(area, round_face_name, true));
  }
  return metadata;
}

emscripten::val ApplyFaceOpsAndMetadata(
    const emscripten::val& snapshot,
    const std::vector<std::pair<std::string, double>>& push_faces,
    const std::unordered_map<std::string, std::string>& metadata) {
  BrepSolidCore core;
  core.SetAuthoringState(snapshot);
  for (const auto& op : push_faces) {
    if (std::abs(op.second) <= 1e-12) continue;
    try {
      core.PushFace(op.first, op.second);
    } catch (...) {
    }
  }
  for (const auto& entry : metadata) {
    core.SetFaceMetadataJson(entry.first, entry.second);
  }
  return core.GetAuthoringState();
}

emscripten::val RemapSnapshotFaceIDsToReservedRange(
    const emscripten::val& snapshot, const std::string& fallback_name = std::string()) {
  const SnapshotInfo info = ReadBooleanReadySnapshotInfo(snapshot, fallback_name);
  return BuildSnapshotFromMesh(info.mesh, info.id_to_face_name, info.face_name_to_id,
                               info.face_metadata_json, info.edge_metadata_json,
                               info.aux_edges, fallback_name);
}

emscripten::val BuildBooleanResultSnapshot(
    const emscripten::val& wedge_snapshot, const emscripten::val& tube_snapshot,
    const std::string& name) {
  const emscripten::val canonical_wedge_snapshot =
      RemapSnapshotFaceIDsToReservedRange(wedge_snapshot, name + "_WEDGE");
  const emscripten::val canonical_tube_snapshot =
      RemapSnapshotFaceIDsToReservedRange(tube_snapshot, name + "_TUBE");
  const SnapshotInfo wedge_info =
      ReadBooleanReadySnapshotInfo(canonical_wedge_snapshot, name + "_WEDGE");
  const SnapshotInfo tube_info =
      ReadBooleanReadySnapshotInfo(canonical_tube_snapshot, name + "_TUBE");
  const manifold::Manifold wedge_manifold(wedge_info.mesh);
  const manifold::Manifold tube_manifold(tube_info.mesh);
  manifold::MeshGL final_mesh = (wedge_manifold - tube_manifold).GetMeshGL();

  const auto& wedge_names = wedge_info.id_to_face_name;
  const auto& tube_names = tube_info.id_to_face_name;
  auto wedge_meta = wedge_info.face_metadata_json;
  const auto& tube_meta = tube_info.face_metadata_json;
  wedge_meta.insert(tube_meta.begin(), tube_meta.end());

  std::unordered_set<uint32_t> seen_ids(final_mesh.faceID.begin(), final_mesh.faceID.end());
  std::unordered_map<uint32_t, std::string> id_to_face_name;
  std::unordered_map<std::string, uint32_t> face_name_to_id;
  std::unordered_map<std::string, std::string> filtered_meta;
  for (const uint32_t id : seen_ids) {
    auto found = wedge_names.find(id);
    if (found == wedge_names.end()) found = tube_names.find(id);
    const std::string face_name =
        (found != wedge_names.end() || found != tube_names.end())
            ? found->second
            : ("FACE_" + std::to_string(id));
    id_to_face_name.emplace(id, face_name);
    face_name_to_id.emplace(face_name, id);
    const auto meta_found = wedge_meta.find(face_name);
    if (meta_found != wedge_meta.end()) {
      filtered_meta.emplace(face_name, meta_found->second);
    }
  }

  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", final_mesh.numProp);
  snapshot.set("vertProperties", ToJsArray(final_mesh.vertProperties));
  snapshot.set("triVerts", ToJsArray(final_mesh.triVerts));
  snapshot.set("triIDs", ToJsArray(final_mesh.faceID));
  snapshot.set("faceNameToID", ToFaceNameEntries(face_name_to_id));
  snapshot.set("idToFaceName", ToFaceIdEntries(id_to_face_name));
  snapshot.set("faceMetadataJson", ToStringMapEntries(filtered_meta));
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount", static_cast<uint32_t>(final_mesh.NumVert()));
  snapshot.set("triangleCount", static_cast<uint32_t>(final_mesh.NumTri()));
  snapshot.set("name", name + "_FINAL_FILLET");
  BrepSolidCore core;
  core.SetAuthoringState(snapshot);
  core.NormalizeFaceTracking();
  return core.GetAuthoringState();
}

emscripten::val ReadOptionalPoint(const emscripten::val& value) {
  if (value.isUndefined() || value.isNull()) return emscripten::val::null();
  const bool has_length = !value["length"].isUndefined() && !value["length"].isNull();
  if (!has_length || value["length"].as<uint32_t>() < 3) {
    return emscripten::val::null();
  }
  return value;
}

Vec3 ReadPointOrDefault(const emscripten::val& value, const Vec3& fallback) {
  if (value.isUndefined() || value.isNull()) return fallback;
  const bool has_length = !value["length"].isUndefined() && !value["length"].isNull();
  if (!has_length || value["length"].as<uint32_t>() < 3) return fallback;
  const double x = value[0].as<double>();
  const double y = value[1].as<double>();
  const double z = value[2].as<double>();
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return fallback;
  return {x, y, z};
}

std::vector<Vec3> DeduplicatePoints(const std::vector<Vec3>& points, double eps_sq) {
  std::vector<Vec3> out;
  out.reserve(points.size());
  for (const Vec3& point : points) {
    if (!IsFinitePoint(point)) continue;
    bool duplicate = false;
    for (const Vec3& existing : out) {
      if (DistanceSq(point, existing) <= eps_sq) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) out.push_back(point);
  }
  return out;
}

uint32_t StableStringHash32(const std::string& value) {
  uint32_t hash = 2166136261u;
  for (unsigned char ch : value) {
    hash ^= static_cast<uint32_t>(ch);
    hash *= 16777619u;
  }
  return hash;
}

std::string SanitizeFaceNameToken(const std::string& raw_value,
                                  const std::string& fallback) {
  std::string raw = raw_value;
  auto is_space = [](unsigned char ch) { return std::isspace(ch) != 0; };
  raw.erase(raw.begin(),
            std::find_if(raw.begin(), raw.end(),
                         [&](unsigned char ch) { return !is_space(ch); }));
  raw.erase(
      std::find_if(raw.rbegin(), raw.rend(),
                   [&](unsigned char ch) { return !is_space(ch); })
          .base(),
      raw.end());
  if (raw.empty()) return fallback;
  std::string cleaned;
  cleaned.reserve(raw.size());
  bool last_was_underscore = false;
  for (char ch : raw) {
    const bool valid = std::isalnum(static_cast<unsigned char>(ch)) != 0;
    if (valid) {
      cleaned.push_back(ch);
      last_was_underscore = false;
    } else if (!last_was_underscore) {
      cleaned.push_back('_');
      last_was_underscore = true;
    }
  }
  while (!cleaned.empty() && cleaned.front() == '_') cleaned.erase(cleaned.begin());
  while (!cleaned.empty() && cleaned.back() == '_') cleaned.pop_back();
  return cleaned.empty() ? fallback : cleaned;
}

std::string HexString(uint32_t value, size_t width) {
  std::ostringstream stream;
  stream << std::hex << std::nouppercase << std::setw(static_cast<int>(width))
         << std::setfill('0') << value;
  return stream.str();
}

std::string BuildEdgeDerivedSideWallFaceName(const std::string& edge_reference,
                                             const std::string& feature_id) {
  const std::string edge_token =
      SanitizeFaceNameToken(edge_reference, "EDGE");
  const std::string edge_token_short =
      edge_token.size() > 48 ? edge_token.substr(0, 48) : edge_token;
  const std::string edge_hash = HexString(StableStringHash32(edge_reference), 8);
  return feature_id + "_FILLET_SIDEWALL_" + edge_token_short + "_" + edge_hash;
}

std::string BuildDeterministicBridgeName(const std::string& feature_id,
                                         const std::string& edge_name_a,
                                         const std::string& edge_name_b,
                                         const std::string& label) {
  std::array<std::string, 2> ordered = {edge_name_a, edge_name_b};
  if (ordered[1] < ordered[0]) std::swap(ordered[0], ordered[1]);
  const std::string token_a =
      SanitizeFaceNameToken(ordered[0], "EDGE_A");
  const std::string token_b =
      SanitizeFaceNameToken(ordered[1], "EDGE_B");
  const std::string pair_hash =
      HexString(StableStringHash32(ordered[0] + "|" + ordered[1]), 8);
  const std::string label_token = SanitizeFaceNameToken(label, "BRIDGE");
  return feature_id + "_" + label_token + "_" + token_a + "_" + token_b + "_" +
         pair_hash;
}

std::string JsonStringifyObject(const emscripten::val& value) {
  return emscripten::val::global("JSON")
      .call<emscripten::val>("stringify", value)
      .as<std::string>();
}

double Clamp(double value, double lo, double hi);
std::vector<Vec3> CollectUniqueFacePoints(const emscripten::val& snapshot,
                                          const std::string& face_name,
                                          double eps);

struct BuiltFilletEntry {
  uint32_t index = 0;
  std::string fillet_name;
  std::string edge_reference;
  std::string face_a_name;
  std::string face_b_name;
  std::string edge_direction;
  std::string direction_reason;
  emscripten::val direction_detail = emscripten::val::null();
  emscripten::val wedge_snapshot = emscripten::val::null();
  emscripten::val tube_snapshot = emscripten::val::null();
  emscripten::val final_snapshot = emscripten::val::null();
  std::vector<Vec3> centerline_points;
  std::vector<Vec3> edge_points;
  std::vector<Vec3> edge_polyline;
  std::vector<Vec3> tube_cap_start;
  std::vector<Vec3> tube_cap_end;
  bool closed_loop = false;
  bool corner_bridge = false;
  std::string merge_target_face_name;
  std::vector<std::string> merge_face_names;
  std::string merge_face_metadata_json;
};

struct SharedEndpointInfo {
  bool valid = false;
  uint32_t a_end_index = 0;
  uint32_t b_end_index = 0;
  double distance = std::numeric_limits<double>::infinity();
  Vec3 shared_point{};
  Vec3 tangent_a{};
  Vec3 tangent_b{};
  double tangent_dot = std::numeric_limits<double>::quiet_NaN();
  double abs_tangent_dot = std::numeric_limits<double>::quiet_NaN();
};

Vec3 PathEndpoint(const std::vector<Vec3>& points, uint32_t endpoint_index) {
  if (points.empty()) return {};
  return endpoint_index == 0 ? points.front() : points.back();
}

Vec3 TangentAwayFromEndpoint(const std::vector<Vec3>& points,
                            uint32_t endpoint_index, double eps_sq) {
  if (points.size() < 2) return {};
  if (endpoint_index == 0) {
    const Vec3& anchor = points.front();
    for (size_t i = 1; i < points.size(); ++i) {
      if (DistanceSq(anchor, points[i]) <= eps_sq) continue;
      return Normalize(Subtract(points[i], anchor));
    }
    return {};
  }
  const Vec3& anchor = points.back();
  for (size_t i = points.size() - 1; i-- > 0;) {
    if (DistanceSq(anchor, points[i]) <= eps_sq) continue;
    return Normalize(Subtract(points[i], anchor));
  }
  return {};
}

SharedEndpointInfo ResolveSharedEndpointInfo(const BuiltFilletEntry& entry_a,
                                             const BuiltFilletEntry& entry_b,
                                             double endpoint_tol) {
  SharedEndpointInfo out;
  const auto& path_a = entry_a.edge_points.empty() ? entry_a.edge_polyline : entry_a.edge_points;
  const auto& path_b = entry_b.edge_points.empty() ? entry_b.edge_polyline : entry_b.edge_points;
  if (path_a.size() < 2 || path_b.size() < 2) return out;
  const double tol_sq = endpoint_tol * endpoint_tol;
  for (uint32_t ai = 0; ai < 2; ++ai) {
    const Vec3 pa = PathEndpoint(path_a, ai);
    for (uint32_t bi = 0; bi < 2; ++bi) {
      const Vec3 pb = PathEndpoint(path_b, bi);
      const double dist_sq = DistanceSq(pa, pb);
      if (!(dist_sq <= tol_sq)) continue;
      if (!out.valid || dist_sq < (out.distance * out.distance)) {
        out.valid = true;
        out.a_end_index = ai;
        out.b_end_index = bi;
        out.distance = std::sqrt(dist_sq);
        out.shared_point = Scale(Add(pa, pb), 0.5);
      }
    }
  }
  if (!out.valid) return out;
  out.tangent_a = TangentAwayFromEndpoint(path_a, out.a_end_index,
                                          std::max(1e-20, tol_sq * 1e-8));
  out.tangent_b = TangentAwayFromEndpoint(path_b, out.b_end_index,
                                          std::max(1e-20, tol_sq * 1e-8));
  if (LengthSq(out.tangent_a) > 1e-24 && LengthSq(out.tangent_b) > 1e-24) {
    out.tangent_dot = Dot(out.tangent_a, out.tangent_b);
    out.abs_tangent_dot = std::min(1.0, std::abs(out.tangent_dot));
  }
  return out;
}

struct CornerSegment {
  Vec3 a{};
  Vec3 b{};
  uint32_t index = 0;
};

std::vector<CornerSegment> ResolveCenterlineCornerSegments(
    const BuiltFilletEntry& entry, uint32_t endpoint_index, uint32_t max_segments,
    double eps_sq) {
  const auto& path = entry.centerline_points;
  std::vector<CornerSegment> segments;
  if (path.size() < 2) return segments;

  std::vector<Vec3> ordered;
  ordered.reserve(std::min<size_t>(path.size(), max_segments + 1));
  if (endpoint_index == 0) {
    for (const Vec3& point : path) {
      if (!ordered.empty() &&
          DistanceSq(ordered.back(), point) <= eps_sq) {
        continue;
      }
      ordered.push_back(point);
      if (ordered.size() >= max_segments + 1) break;
    }
  } else {
    for (size_t i = path.size(); i-- > 0;) {
      const Vec3& point = path[i];
      if (!ordered.empty() &&
          DistanceSq(ordered.back(), point) <= eps_sq) {
        continue;
      }
      ordered.push_back(point);
      if (ordered.size() >= max_segments + 1) break;
    }
  }

  for (size_t i = 0; i + 1 < ordered.size(); ++i) {
    segments.push_back({ordered[i], ordered[i + 1], static_cast<uint32_t>(i)});
  }
  return segments;
}

struct ClosestSegmentPointsResult {
  bool valid = false;
  double distance = std::numeric_limits<double>::infinity();
  double s = 0.0;
  double t = 0.0;
  Vec3 point_a{};
  Vec3 point_b{};
};

ClosestSegmentPointsResult ClosestPointsBetweenSegments3D(const Vec3& p0,
                                                          const Vec3& p1,
                                                          const Vec3& q0,
                                                          const Vec3& q1) {
  ClosestSegmentPointsResult out;
  const Vec3 u = Subtract(p1, p0);
  const Vec3 v = Subtract(q1, q0);
  const Vec3 w = Subtract(p0, q0);
  const double a = Dot(u, u);
  const double b = Dot(u, v);
  const double c = Dot(v, v);
  const double d = Dot(u, w);
  const double e = Dot(v, w);
  const double denom = a * c - b * b;
  constexpr double kSegEps = 1e-14;
  double s_n = 0.0;
  double s_d = denom;
  double t_n = 0.0;
  double t_d = denom;

  if (a <= kSegEps && c <= kSegEps) {
    out.valid = true;
    out.distance = std::sqrt(DistanceSq(p0, q0));
    out.point_a = p0;
    out.point_b = q0;
    return out;
  }
  if (a <= kSegEps) {
    s_n = 0.0;
    s_d = 1.0;
    t_n = e;
    t_d = c;
  } else if (c <= kSegEps) {
    t_n = 0.0;
    t_d = 1.0;
    s_n = -d;
    s_d = a;
  } else {
    s_n = b * e - c * d;
    t_n = a * e - b * d;
    if (s_n < 0.0) {
      s_n = 0.0;
      t_n = e;
      t_d = c;
    } else if (s_n > s_d) {
      s_n = s_d;
      t_n = e + b;
      t_d = c;
    }
  }

  if (t_n < 0.0) {
    t_n = 0.0;
    if (-d < 0.0) {
      s_n = 0.0;
    } else if (-d > a) {
      s_n = s_d;
    } else {
      s_n = -d;
      s_d = a;
    }
  } else if (t_n > t_d) {
    t_n = t_d;
    if ((-d + b) < 0.0) {
      s_n = 0.0;
    } else if ((-d + b) > a) {
      s_n = s_d;
    } else {
      s_n = -d + b;
      s_d = a;
    }
  }

  const double s = std::abs(s_n) <= kSegEps ? 0.0 : s_n / (std::abs(s_d) <= kSegEps ? 1.0 : s_d);
  const double t = std::abs(t_n) <= kSegEps ? 0.0 : t_n / (std::abs(t_d) <= kSegEps ? 1.0 : t_d);
  out.s = Clamp(s, 0.0, 1.0);
  out.t = Clamp(t, 0.0, 1.0);
  out.point_a = Add(p0, Scale(u, out.s));
  out.point_b = Add(q0, Scale(v, out.t));
  out.distance = std::sqrt(DistanceSq(out.point_a, out.point_b));
  out.valid = true;
  return out;
}

bool DetectCenterlineCrossNearSharedCorner(const BuiltFilletEntry& entry_a,
                                           const BuiltFilletEntry& entry_b,
                                           const SharedEndpointInfo& shared,
                                           double endpoint_tol,
                                           double cross_tolerance,
                                           double interior_param_eps) {
  const std::vector<CornerSegment> segs_a = ResolveCenterlineCornerSegments(
      entry_a, shared.a_end_index, 4, std::max(1e-20, endpoint_tol * endpoint_tol * 1e-6));
  const std::vector<CornerSegment> segs_b = ResolveCenterlineCornerSegments(
      entry_b, shared.b_end_index, 4, std::max(1e-20, endpoint_tol * endpoint_tol * 1e-6));
  if (segs_a.empty() || segs_b.empty()) return false;

  for (const CornerSegment& seg_a : segs_a) {
    for (const CornerSegment& seg_b : segs_b) {
      const ClosestSegmentPointsResult closest =
          ClosestPointsBetweenSegments3D(seg_a.a, seg_a.b, seg_b.a, seg_b.b);
      if (!closest.valid || !(closest.distance <= cross_tolerance)) continue;
      if (closest.s <= interior_param_eps || closest.s >= (1.0 - interior_param_eps)) {
        continue;
      }
      if (closest.t <= interior_param_eps || closest.t >= (1.0 - interior_param_eps)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

struct EntryEndCapData {
  std::vector<Vec3> wedge_points;
  std::vector<Vec3> tube_points;
  Vec3 wedge_center{};
  Vec3 tube_center{};
  bool has_wedge_center = false;
  bool has_tube_center = false;
};

Vec3 CentroidOfPoints(const std::vector<Vec3>& points, bool* has_center = nullptr) {
  Vec3 center{};
  if (has_center) *has_center = false;
  if (points.empty()) return center;
  for (const Vec3& point : points) {
    center = Add(center, point);
  }
  center = Scale(center, 1.0 / static_cast<double>(points.size()));
  if (has_center) *has_center = true;
  return center;
}

double EstimatePointSetRadius(const std::vector<Vec3>& points, const Vec3& center,
                              bool has_center) {
  if (!has_center || points.empty()) return std::numeric_limits<double>::quiet_NaN();
  std::vector<double> distances;
  distances.reserve(points.size());
  for (const Vec3& point : points) {
    const double dist = std::sqrt(DistanceSq(point, center));
    if (dist > 1e-12) distances.push_back(dist);
  }
  if (distances.empty()) return std::numeric_limits<double>::quiet_NaN();
  std::sort(distances.begin(), distances.end());
  return distances[distances.size() / 2];
}

EntryEndCapData ResolveEntryEndCapData(const BuiltFilletEntry& entry,
                                       uint32_t endpoint_index,
                                       double point_tol) {
  EntryEndCapData out;
  if (entry.fillet_name.empty()) return out;
  const std::string wedge_face_name = entry.fillet_name + "_END_CAP_" +
                                      std::to_string(endpoint_index == 0 ? 1 : 2);
  const std::string tube_face_name =
      entry.fillet_name + "_TUBE_" + (endpoint_index == 0 ? "CapStart" : "CapEnd");
  out.wedge_points =
      CollectUniqueFacePoints(entry.wedge_snapshot, wedge_face_name, point_tol);
  const auto& preferred_tube_points =
      endpoint_index == 0 ? entry.tube_cap_start : entry.tube_cap_end;
  if (preferred_tube_points.size() >= 3) {
    out.tube_points = preferred_tube_points;
  } else {
    out.tube_points =
        CollectUniqueFacePoints(entry.tube_snapshot, tube_face_name, point_tol);
  }
  out.wedge_center = CentroidOfPoints(out.wedge_points, &out.has_wedge_center);
  out.tube_center = CentroidOfPoints(out.tube_points, &out.has_tube_center);
  return out;
}

manifold::Manifold BuildPointHull(const std::vector<Vec3>& points, double radius,
                                  int resolution) {
  const std::vector<Vec3> unique =
      DeduplicatePoints(points, std::max(1e-16, radius * radius * 1e-4));
  if (unique.size() < 2) {
    throw std::runtime_error("Corner bridge hull requires at least two distinct points.");
  }
  manifold::Manifold base_sphere =
      manifold::Manifold::Sphere(std::max(1e-6, radius), std::max(6, resolution));
  std::vector<manifold::Manifold> seeds;
  seeds.reserve(unique.size());
  for (const Vec3& point : unique) {
    seeds.push_back(base_sphere.Translate(ToManifoldVec3(point)));
  }
  if (seeds.size() == 1) return seeds.front();
  return manifold::Manifold::Hull(seeds);
}

void CollapseMeshToSingleFace(
    manifold::MeshGL& mesh, const std::string& face_name,
    std::unordered_map<uint32_t, std::string>& id_to_face_name,
    std::unordered_map<std::string, uint32_t>& face_name_to_id,
    std::unordered_map<std::string, std::string>& face_metadata_json) {
  const uint32_t face_id = manifold::Manifold::ReserveIDs(1);
  std::fill(mesh.faceID.begin(), mesh.faceID.end(), face_id);
  id_to_face_name.clear();
  face_name_to_id.clear();
  id_to_face_name.emplace(face_id, face_name);
  face_name_to_id.emplace(face_name, face_id);
  std::unordered_map<std::string, std::string> filtered_meta;
  const auto meta_found = face_metadata_json.find(face_name);
  if (meta_found != face_metadata_json.end()) {
    filtered_meta.emplace(face_name, meta_found->second);
  }
  face_metadata_json.swap(filtered_meta);
}

void CopyFaceMetadata(const std::string& source_face_name,
                      const std::vector<std::string>& target_face_names,
                      std::unordered_map<std::string, std::string>& face_metadata_json) {
  const auto found = face_metadata_json.find(source_face_name);
  if (found == face_metadata_json.end()) return;
  for (const std::string& face_name : target_face_names) {
    if (!face_name.empty()) face_metadata_json[face_name] = found->second;
  }
  face_metadata_json.erase(source_face_name);
}

std::vector<std::vector<uint32_t>> BuildFaceComponents(const manifold::MeshGL& mesh,
                                                       uint32_t face_id) {
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  std::vector<uint32_t> source_triangles;
  source_triangles.reserve(tri_count);
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    if (mesh.faceID[tri_idx] == face_id) source_triangles.push_back(tri_idx);
  }
  if (source_triangles.empty()) return {};

  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_triangles;
  edge_to_triangles.reserve(source_triangles.size() * 3);
  for (uint32_t tri_idx : source_triangles) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    edge_to_triangles[std::to_string(std::min(i0, i1)) + "|" +
                      std::to_string(std::max(i0, i1))]
        .push_back(tri_idx);
    edge_to_triangles[std::to_string(std::min(i1, i2)) + "|" +
                      std::to_string(std::max(i1, i2))]
        .push_back(tri_idx);
    edge_to_triangles[std::to_string(std::min(i2, i0)) + "|" +
                      std::to_string(std::max(i2, i0))]
        .push_back(tri_idx);
  }

  std::unordered_map<uint32_t, std::vector<uint32_t>> tri_adj;
  for (uint32_t tri_idx : source_triangles) {
    tri_adj.emplace(tri_idx, std::vector<uint32_t>());
  }
  for (const auto& entry : edge_to_triangles) {
    const std::vector<uint32_t>& tris = entry.second;
    if (tris.size() < 2) continue;
    for (size_t i = 0; i < tris.size(); ++i) {
      for (size_t j = i + 1; j < tris.size(); ++j) {
        tri_adj[tris[i]].push_back(tris[j]);
        tri_adj[tris[j]].push_back(tris[i]);
      }
    }
  }

  std::unordered_set<uint32_t> seen;
  std::vector<std::vector<uint32_t>> components;
  for (uint32_t seed : source_triangles) {
    if (seen.count(seed)) continue;
    std::vector<uint32_t> stack = {seed};
    std::vector<uint32_t> component;
    seen.insert(seed);
    while (!stack.empty()) {
      const uint32_t tri_idx = stack.back();
      stack.pop_back();
      component.push_back(tri_idx);
      for (uint32_t neighbor : tri_adj[tri_idx]) {
        if (seen.count(neighbor)) continue;
        seen.insert(neighbor);
        stack.push_back(neighbor);
      }
    }
    components.push_back(component);
  }
  return components;
}

Vec3 TriangleCentroid(const manifold::MeshGL& mesh, uint32_t tri_idx) {
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t tri_base = tri_idx * 3;
  const uint32_t ia = mesh.triVerts[tri_base + 0] * stride;
  const uint32_t ib = mesh.triVerts[tri_base + 1] * stride;
  const uint32_t ic = mesh.triVerts[tri_base + 2] * stride;
  if (ia + 2 >= mesh.vertProperties.size() || ib + 2 >= mesh.vertProperties.size() ||
      ic + 2 >= mesh.vertProperties.size()) {
    return {};
  }
  return {(mesh.vertProperties[ia + 0] + mesh.vertProperties[ib + 0] +
           mesh.vertProperties[ic + 0]) /
              3.0,
          (mesh.vertProperties[ia + 1] + mesh.vertProperties[ib + 1] +
           mesh.vertProperties[ic + 1]) /
              3.0,
          (mesh.vertProperties[ia + 2] + mesh.vertProperties[ib + 2] +
           mesh.vertProperties[ic + 2]) /
              3.0};
}

std::vector<std::string> RelabelDisconnectedFaceComponents(
    manifold::MeshGL& mesh, const std::string& source_face_name,
    const std::vector<std::string>& desired_names,
    const std::vector<Vec3>& anchor_points,
    std::unordered_map<uint32_t, std::string>& id_to_face_name,
    std::unordered_map<std::string, uint32_t>& face_name_to_id,
    std::unordered_map<std::string, std::string>& face_metadata_json) {
  auto face_found = face_name_to_id.find(source_face_name);
  if (face_found == face_name_to_id.end()) return {};
  const uint32_t source_face_id = face_found->second;
  std::vector<std::vector<uint32_t>> components =
      BuildFaceComponents(mesh, source_face_id);
  if (components.empty()) return {};

  struct ComponentInfo {
    std::vector<uint32_t> triangles;
    uint32_t min_triangle = 0;
    Vec3 center;
  };

  std::vector<ComponentInfo> infos;
  infos.reserve(components.size());
  for (const auto& component : components) {
    if (component.empty()) continue;
    Vec3 sum{};
    for (uint32_t tri_idx : component) {
      sum = Add(sum, TriangleCentroid(mesh, tri_idx));
    }
    infos.push_back({
        component,
        *std::min_element(component.begin(), component.end()),
        Scale(sum, 1.0 / static_cast<double>(component.size())),
    });
  }
  if (infos.empty()) return {};
  std::sort(infos.begin(), infos.end(),
            [](const ComponentInfo& a, const ComponentInfo& b) {
              return a.min_triangle < b.min_triangle;
            });

  std::vector<std::string> names;
  names.reserve(infos.size());
  std::unordered_set<std::string> reserved_names;
  for (const auto& entry : face_name_to_id) {
    if (entry.first != source_face_name) reserved_names.insert(entry.first);
  }
  for (size_t i = 0; i < infos.size(); ++i) {
    std::string candidate =
        (i < desired_names.size() && !desired_names[i].empty())
            ? desired_names[i]
            : (source_face_name + "_PART_" + std::to_string(i + 1));
    std::string base = candidate;
    int suffix = 2;
    while (reserved_names.count(candidate)) {
      candidate = base + "_" + std::to_string(suffix++);
    }
    reserved_names.insert(candidate);
    names.push_back(candidate);
  }

  if (infos.size() == 2 && anchor_points.size() >= 2) {
    const double direct =
        DistanceSq(infos[0].center, anchor_points[0]) +
        DistanceSq(infos[1].center, anchor_points[1]);
    const double swapped =
        DistanceSq(infos[0].center, anchor_points[1]) +
        DistanceSq(infos[1].center, anchor_points[0]);
    if (swapped < direct) {
      std::swap(names[0], names[1]);
    }
  }

  const auto metadata_found = face_metadata_json.find(source_face_name);
  const std::string metadata_json =
      metadata_found == face_metadata_json.end() ? std::string()
                                                 : metadata_found->second;

  face_name_to_id.erase(source_face_name);
  face_name_to_id.emplace(names[0], source_face_id);
  id_to_face_name[source_face_id] = names[0];
  if (!metadata_json.empty()) face_metadata_json[names[0]] = metadata_json;

  for (size_t i = 1; i < infos.size(); ++i) {
    const uint32_t new_face_id = manifold::Manifold::ReserveIDs(1);
    for (uint32_t tri_idx : infos[i].triangles) {
      mesh.faceID[tri_idx] = new_face_id;
    }
    id_to_face_name[new_face_id] = names[i];
    face_name_to_id[names[i]] = new_face_id;
    if (!metadata_json.empty()) face_metadata_json[names[i]] = metadata_json;
  }
  face_metadata_json.erase(source_face_name);
  NormalizeFaceMaps(mesh, id_to_face_name, face_name_to_id, face_metadata_json);
  return names;
}

emscripten::val BuildSingleFaceSnapshot(const manifold::Manifold& manifold_solid,
                                        const std::string& face_name,
                                        const std::string& name = std::string()) {
  manifold::MeshGL mesh = manifold_solid.GetMeshGL();
  std::unordered_map<uint32_t, std::string> id_to_face_name;
  std::unordered_map<std::string, uint32_t> face_name_to_id;
  std::unordered_map<std::string, std::string> face_metadata_json;
  CollapseMeshToSingleFace(mesh, face_name, id_to_face_name, face_name_to_id,
                           face_metadata_json);
  return BuildSnapshotFromMesh(mesh, id_to_face_name, face_name_to_id,
                               face_metadata_json, {}, {}, name);
}

struct SharedBoundaryChain {
  std::vector<uint32_t> indices;
  double length = 0.0;
};

struct OrientedTangentInfo {
  Vec3 tangent;
  Vec3 midpoint;
  int segment_index = -1;
  bool valid = false;
};

double BoundingBoxDiagonal(const manifold::MeshGL& mesh) {
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  if (mesh.vertProperties.size() < stride) return 1.0;
  double min_x = std::numeric_limits<double>::infinity();
  double min_y = std::numeric_limits<double>::infinity();
  double min_z = std::numeric_limits<double>::infinity();
  double max_x = -std::numeric_limits<double>::infinity();
  double max_y = -std::numeric_limits<double>::infinity();
  double max_z = -std::numeric_limits<double>::infinity();
  for (uint32_t i = 0; i + 2 < mesh.vertProperties.size(); i += stride) {
    const double x = mesh.vertProperties[i + 0];
    const double y = mesh.vertProperties[i + 1];
    const double z = mesh.vertProperties[i + 2];
    min_x = std::min(min_x, x);
    min_y = std::min(min_y, y);
    min_z = std::min(min_z, z);
    max_x = std::max(max_x, x);
    max_y = std::max(max_y, y);
    max_z = std::max(max_z, z);
  }
  const double diag =
      std::sqrt((max_x - min_x) * (max_x - min_x) +
                (max_y - min_y) * (max_y - min_y) +
                (max_z - min_z) * (max_z - min_z));
  return diag > 0.0 ? diag : 1.0;
}

Vec3 MeshVertexPoint(const manifold::MeshGL& mesh, uint32_t index) {
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t base = index * stride;
  if (base + 2 >= mesh.vertProperties.size()) return {};
  return {mesh.vertProperties[base + 0], mesh.vertProperties[base + 1],
          mesh.vertProperties[base + 2]};
}

Vec3 TriangleNormal(const manifold::MeshGL& mesh, uint32_t tri_idx) {
  const uint32_t tri_base = tri_idx * 3;
  if (tri_base + 2 >= mesh.triVerts.size()) return {};
  const Vec3 a = MeshVertexPoint(mesh, mesh.triVerts[tri_base + 0]);
  const Vec3 b = MeshVertexPoint(mesh, mesh.triVerts[tri_base + 1]);
  const Vec3 c = MeshVertexPoint(mesh, mesh.triVerts[tri_base + 2]);
  return Normalize(Cross(Subtract(b, a), Subtract(c, a)));
}

int FindDirectedEdgeOrientationInFace(const manifold::MeshGL& mesh,
                                      uint32_t face_id, uint32_t ia,
                                      uint32_t ib) {
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    if (mesh.faceID[tri_idx] != face_id) continue;
    const uint32_t base = tri_idx * 3;
    const uint32_t a = mesh.triVerts[base + 0];
    const uint32_t b = mesh.triVerts[base + 1];
    const uint32_t c = mesh.triVerts[base + 2];
    if ((a == ia && b == ib) || (b == ia && c == ib) || (c == ia && a == ib)) {
      return 1;
    }
    if ((a == ib && b == ia) || (b == ib && c == ia) || (c == ib && a == ia)) {
      return -1;
    }
  }
  return 0;
}

std::vector<SharedBoundaryChain> BuildSharedBoundaryChains(
    const manifold::MeshGL& mesh, uint32_t face_a_id, uint32_t face_b_id) {
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  std::unordered_map<std::string, std::vector<std::pair<uint32_t, uint32_t>>> edge_faces;
  edge_faces.reserve(tri_count * 3);
  auto edge_key = [](uint32_t a, uint32_t b) {
    return std::to_string(std::min(a, b)) + "|" + std::to_string(std::max(a, b));
  };

  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    const uint32_t face_id = mesh.faceID[tri_idx];
    const uint32_t base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[base + 0];
    const uint32_t i1 = mesh.triVerts[base + 1];
    const uint32_t i2 = mesh.triVerts[base + 2];
    edge_faces[edge_key(i0, i1)].push_back({face_id, tri_idx});
    edge_faces[edge_key(i1, i2)].push_back({face_id, tri_idx});
    edge_faces[edge_key(i2, i0)].push_back({face_id, tri_idx});
  }

  std::vector<std::pair<uint32_t, uint32_t>> shared_edges;
  for (const auto& entry : edge_faces) {
    const auto& faces = entry.second;
    if (faces.size() != 2) continue;
    const uint32_t id0 = faces[0].first;
    const uint32_t id1 = faces[1].first;
    const bool matches =
        (id0 == face_a_id && id1 == face_b_id) ||
        (id0 == face_b_id && id1 == face_a_id);
    if (!matches) continue;
    const size_t split = entry.first.find('|');
    const uint32_t a =
        static_cast<uint32_t>(std::stoul(entry.first.substr(0, split)));
    const uint32_t b =
        static_cast<uint32_t>(std::stoul(entry.first.substr(split + 1)));
    shared_edges.push_back({a, b});
  }
  if (shared_edges.empty()) return {};

  std::unordered_map<uint32_t, std::vector<uint32_t>> adj;
  std::unordered_set<std::string> edge_visited;
  adj.reserve(shared_edges.size() * 2);
  for (const auto& edge : shared_edges) {
    adj[edge.first].push_back(edge.second);
    adj[edge.second].push_back(edge.first);
  }

  auto undirected_key = [&](uint32_t a, uint32_t b) { return edge_key(a, b); };
  auto visit_chain_from = [&](uint32_t start) {
    SharedBoundaryChain chain;
    uint32_t prev = std::numeric_limits<uint32_t>::max();
    uint32_t curr = start;
    chain.indices.push_back(curr);
    while (true) {
      auto found_adj = adj.find(curr);
      if (found_adj == adj.end()) break;
      uint32_t next = std::numeric_limits<uint32_t>::max();
      for (uint32_t neighbor : found_adj->second) {
        const std::string key = undirected_key(curr, neighbor);
        if (edge_visited.count(key)) continue;
        if (neighbor == prev) continue;
        next = neighbor;
        edge_visited.insert(key);
        break;
      }
      if (next == std::numeric_limits<uint32_t>::max()) break;
      chain.length += EdgeLength(mesh, curr, next);
      prev = curr;
      curr = next;
      chain.indices.push_back(curr);
    }
    return chain;
  };

  std::vector<SharedBoundaryChain> chains;
  for (const auto& entry : adj) {
    if (entry.second.size() != 1) continue;
    if (edge_visited.count(undirected_key(entry.first, entry.second.front()))) continue;
    SharedBoundaryChain chain = visit_chain_from(entry.first);
    if (chain.indices.size() >= 2 && chain.length > 0.0) chains.push_back(chain);
  }

  for (const auto& edge : shared_edges) {
    const std::string key = undirected_key(edge.first, edge.second);
    if (edge_visited.count(key)) continue;
    SharedBoundaryChain chain = visit_chain_from(edge.first);
    if (chain.indices.size() >= 2 && chain.length > 0.0) chains.push_back(chain);
  }

  std::sort(chains.begin(), chains.end(),
            [](const SharedBoundaryChain& a, const SharedBoundaryChain& b) {
              if (a.length == b.length) {
                return a.indices.size() > b.indices.size();
              }
              return a.length > b.length;
            });
  return chains;
}

OrientedTangentInfo ResolveOrientedEdgeTangent(const manifold::MeshGL& mesh,
                                               uint32_t face_a_id,
                                               const SharedBoundaryChain& chain) {
  OrientedTangentInfo result;
  if (chain.indices.size() < 2) return result;
  std::vector<int> segment_order;
  segment_order.reserve(chain.indices.size() - 1);
  const double center = static_cast<double>(chain.indices.size() - 1) * 0.5;
  for (size_t i = 0; i + 1 < chain.indices.size(); ++i) {
    segment_order.push_back(static_cast<int>(i));
  }
  std::sort(segment_order.begin(), segment_order.end(), [center](int a, int b) {
    return std::abs(static_cast<double>(a) - center) <
           std::abs(static_cast<double>(b) - center);
  });

  for (int seg_idx : segment_order) {
    const uint32_t ia = chain.indices[seg_idx];
    const uint32_t ib = chain.indices[seg_idx + 1];
    if (ia == ib) continue;
    const int orient = FindDirectedEdgeOrientationInFace(mesh, face_a_id, ia, ib);
    if (!orient) continue;
    Vec3 a = MeshVertexPoint(mesh, ia);
    Vec3 b = MeshVertexPoint(mesh, ib);
    Vec3 tangent = Subtract(b, a);
    if (orient < 0) tangent = Scale(tangent, -1.0);
    const double length_sq = LengthSq(tangent);
    if (!(length_sq > 1e-24)) continue;
    tangent = Scale(tangent, 1.0 / std::sqrt(length_sq));
    result.tangent = tangent;
    result.midpoint = Scale(Add(a, b), 0.5);
    result.segment_index = seg_idx;
    result.valid = true;
    return result;
  }
  return result;
}

Vec3 ClosestPointOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b,
                            const Vec3& c) {
  const Vec3 ab = Subtract(b, a);
  const Vec3 ac = Subtract(c, a);
  const Vec3 ap = Subtract(p, a);
  const double d1 = Dot(ab, ap);
  const double d2 = Dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) return a;

  const Vec3 bp = Subtract(p, b);
  const double d3 = Dot(ab, bp);
  const double d4 = Dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) return b;

  const double vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const double v = d1 / (d1 - d3);
    return Add(a, Scale(ab, v));
  }

  const Vec3 cp = Subtract(p, c);
  const double d5 = Dot(ab, cp);
  const double d6 = Dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) return c;

  const double vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const double w = d2 / (d2 - d6);
    return Add(a, Scale(ac, w));
  }

  const double va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    const Vec3 bc = Subtract(c, b);
    const double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Add(b, Scale(bc, w));
  }

  const double denom = 1.0 / (va + vb + vc);
  const double v = vb * denom;
  const double w = vc * denom;
  return Add(a, Add(Scale(ab, v), Scale(ac, w)));
}

double Clamp(double value, double lo, double hi) {
  return std::max(lo, std::min(hi, value));
}

struct FaceMeshInfo {
  struct TriangleData {
    Vec3 a{};
    Vec3 b{};
    Vec3 c{};
    Vec3 normal{};
  };
  uint32_t face_id = 0;
  std::vector<uint32_t> tri_indices;
  std::vector<Vec3> vertices;
  std::vector<TriangleData> triangles;
  Vec3 avg_normal{};
};

FaceMeshInfo BuildFaceMeshInfo(const manifold::MeshGL& mesh, uint32_t face_id) {
  FaceMeshInfo info;
  info.face_id = face_id;
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  std::unordered_set<uint32_t> unique_vertices;
  Vec3 accum{};
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    if (mesh.faceID[tri_idx] != face_id) continue;
    info.tri_indices.push_back(tri_idx);
    const uint32_t base = tri_idx * 3;
    const uint32_t ia = mesh.triVerts[base + 0];
    const uint32_t ib = mesh.triVerts[base + 1];
    const uint32_t ic = mesh.triVerts[base + 2];
    unique_vertices.insert(ia);
    unique_vertices.insert(ib);
    unique_vertices.insert(ic);
    FaceMeshInfo::TriangleData tri;
    tri.a = MeshVertexPoint(mesh, ia);
    tri.b = MeshVertexPoint(mesh, ib);
    tri.c = MeshVertexPoint(mesh, ic);
    tri.normal = Normalize(Cross(Subtract(tri.b, tri.a), Subtract(tri.c, tri.a)));
    if (LengthSq(tri.normal) > 1e-24) {
      accum = Add(accum, tri.normal);
    }
    info.triangles.push_back(tri);
  }
  info.avg_normal = Normalize(accum);
  info.vertices.reserve(unique_vertices.size());
  for (const uint32_t index : unique_vertices) {
    info.vertices.push_back(MeshVertexPoint(mesh, index));
  }
  return info;
}

Vec3 ProjectPointOntoFace(const FaceMeshInfo& face, const Vec3& point) {
  double best_dist_sq = std::numeric_limits<double>::infinity();
  Vec3 best = point;
  bool found = false;
  for (const FaceMeshInfo::TriangleData& tri : face.triangles) {
    const Vec3 closest = ClosestPointOnTriangle(point, tri.a, tri.b, tri.c);
    const double dist_sq = DistanceSq(point, closest);
    if (dist_sq < best_dist_sq) {
      best_dist_sq = dist_sq;
      best = closest;
      found = true;
    }
  }
  return found ? best : point;
}

Vec3 LocalFaceNormalAtPoint(const FaceMeshInfo& face, const Vec3& point,
                            const Vec3& fallback) {
  double best_dist_sq = std::numeric_limits<double>::infinity();
  Vec3 best_normal = fallback;
  bool found = false;
  for (const FaceMeshInfo::TriangleData& tri : face.triangles) {
    if (!(LengthSq(tri.normal) > 1e-24)) continue;
    const Vec3 closest = ClosestPointOnTriangle(point, tri.a, tri.b, tri.c);
    const double dist_sq = DistanceSq(point, closest);
    if (dist_sq < best_dist_sq) {
      best_dist_sq = dist_sq;
      best_normal = tri.normal;
      found = true;
    }
  }
  return found ? best_normal : fallback;
}

std::pair<double, double> ComputeProjectionRange(const std::vector<Vec3>& vertices,
                                                 const Vec3& dir) {
  double min_proj = std::numeric_limits<double>::infinity();
  double max_proj = -std::numeric_limits<double>::infinity();
  for (const Vec3& vertex : vertices) {
    const double projection = Dot(vertex, dir);
    min_proj = std::min(min_proj, projection);
    max_proj = std::max(max_proj, projection);
  }
  return {min_proj, max_proj};
}

std::vector<Vec3> SanitizeFilletInputPolyline(const std::vector<Vec3>& input,
                                              double tolerance) {
  if (input.empty()) return {};
  const double tol = std::max(1e-12, std::abs(tolerance));
  const double tol_sq = tol * tol;
  std::vector<Vec3> out;
  out.reserve(input.size());
  for (const Vec3& point : input) {
    if (!IsFinitePoint(point)) continue;
    if (!out.empty() && DistanceSq(out.back(), point) <= tol_sq) continue;
    out.push_back(point);
  }
  if (out.size() < 3) return out;

  double total_length = 0.0;
  double max_segment_length = 0.0;
  for (size_t i = 1; i < out.size(); ++i) {
    const double length = std::sqrt(DistanceSq(out[i - 1], out[i]));
    if (!(length > 0.0)) continue;
    total_length += length;
    max_segment_length = std::max(max_segment_length, length);
  }
  const double adaptive_tol =
      std::max({tol, total_length * 1e-7, max_segment_length * 1e-6});
  const double adaptive_tol_sq = adaptive_tol * adaptive_tol;
  if (!(adaptive_tol_sq > tol_sq)) return out;

  std::vector<Vec3> refined;
  refined.reserve(out.size());
  for (const Vec3& point : out) {
    if (!refined.empty() &&
        DistanceSq(refined.back(), point) <= adaptive_tol_sq) {
      continue;
    }
    refined.push_back(point);
  }
  return refined.size() >= 2 ? refined : out;
}

std::vector<Vec3> BuildCenterlineSamples(const std::vector<Vec3>& polyline,
                                         bool closed, double dist_tol) {
  std::vector<Vec3> src = polyline;
  if (closed && src.size() > 2 &&
      DistanceSq(src.front(), src.back()) <= (dist_tol * dist_tol)) {
    src.pop_back();
  }
  std::vector<Vec3> samples;
  samples.reserve(src.size() * 2);
  for (size_t i = 0; i < src.size(); ++i) {
    const Vec3& a = src[i];
    samples.push_back(a);
    if (closed) {
      const Vec3& b = src[(i + 1) % src.size()];
      if (DistanceSq(a, b) > (dist_tol * dist_tol)) {
        samples.push_back(Scale(Add(a, b), 0.5));
      }
    } else if (i + 1 < src.size()) {
      const Vec3& b = src[i + 1];
      if (DistanceSq(a, b) > (dist_tol * dist_tol)) {
        samples.push_back(Scale(Add(a, b), 0.5));
      }
    }
  }
  return samples;
}

struct SampledPolyline {
  std::vector<Vec3> points;
  std::vector<uint32_t> segment_indices;
};

SampledPolyline BuildCenterlineSamplesWithSegmentIndices(
    const std::vector<Vec3>& polyline, bool closed, double dist_tol,
    uint32_t segment_count) {
  SampledPolyline sampled;
  std::vector<Vec3> src = polyline;
  if (closed && src.size() > 2 &&
      DistanceSq(src.front(), src.back()) <= (dist_tol * dist_tol)) {
    src.pop_back();
  }
  if (src.empty()) return sampled;

  const uint32_t seg_count = std::max<uint32_t>(1, segment_count);
  sampled.points.reserve(src.size() * 2);
  sampled.segment_indices.reserve(src.size() * 2);
  for (uint32_t i = 0; i < src.size(); ++i) {
    const Vec3& a = src[i];
    const uint32_t seg_idx_vertex =
        closed ? ((i + seg_count - 1) % seg_count)
               : std::max<uint32_t>(0, std::min<uint32_t>(i > 0 ? i - 1 : 0,
                                                          seg_count - 1));
    const uint32_t seg_idx_mid =
        closed ? (i % seg_count) : std::min<uint32_t>(i, seg_count - 1);
    sampled.points.push_back(a);
    sampled.segment_indices.push_back(seg_idx_vertex);
    if (closed) {
      const Vec3& b = src[(i + 1) % src.size()];
      if (DistanceSq(a, b) > (dist_tol * dist_tol)) {
        sampled.points.push_back(Scale(Add(a, b), 0.5));
        sampled.segment_indices.push_back(seg_idx_mid);
      }
    } else if (i + 1 < src.size()) {
      const Vec3& b = src[i + 1];
      if (DistanceSq(a, b) > (dist_tol * dist_tol)) {
        sampled.points.push_back(Scale(Add(a, b), 0.5));
        sampled.segment_indices.push_back(seg_idx_mid);
      }
    }
  }
  return sampled;
}

struct SegmentFacePair {
  bool blended = false;
  std::string face_a_name;
  std::string face_b_name;
  std::string base_name;
  std::string side_a_name;
  std::string side_b_name;
  double t = 0.5;
};

std::vector<SegmentFacePair> ReadSegmentFacePairs(const emscripten::val& values) {
  std::vector<SegmentFacePair> out;
  if (values.isUndefined() || values.isNull()) return out;
  const uint32_t length = values["length"].as<uint32_t>();
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    if (pair.isUndefined() || pair.isNull()) continue;
    SegmentFacePair entry;
    if (pair.typeOf().as<std::string>() == "object" &&
        !pair["length"].isNumber()) {
      entry.base_name = ReadString(pair["base"], "");
      entry.side_a_name = ReadString(pair["sideA"], "");
      entry.side_b_name = ReadString(pair["sideB"], "");
      if (!entry.base_name.empty() && !entry.side_a_name.empty() &&
          !entry.side_b_name.empty()) {
        entry.blended = true;
        if (!(pair["t"].isUndefined() || pair["t"].isNull())) {
          entry.t = Clamp(pair["t"].as<double>(), 0.0, 1.0);
        }
      } else {
        entry.face_a_name = ReadString(pair["faceA"], "");
        if (entry.face_a_name.empty()) entry.face_a_name = ReadString(pair["a"], "");
        entry.face_b_name = ReadString(pair["faceB"], "");
        if (entry.face_b_name.empty()) entry.face_b_name = ReadString(pair["b"], "");
      }
    } else {
      entry.face_a_name = ReadString(pair[0], "");
      entry.face_b_name = ReadString(pair[1], "");
    }
    if (entry.blended ||
        (!entry.face_a_name.empty() && !entry.face_b_name.empty())) {
      out.push_back(entry);
    }
  }
  return out;
}

double PointDistance(const Vec3& a, const Vec3& b) {
  if (!IsFinitePoint(a) || !IsFinitePoint(b)) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  return std::sqrt(DistanceSq(a, b));
}

double MedianFinite(std::vector<double> values) {
  values.erase(std::remove_if(values.begin(), values.end(),
                              [](double value) {
                                return !std::isfinite(value);
                              }),
               values.end());
  if (values.empty()) return std::numeric_limits<double>::quiet_NaN();
  std::sort(values.begin(), values.end());
  const size_t mid = values.size() / 2;
  if ((values.size() % 2) == 1) return values[mid];
  return 0.5 * (values[mid - 1] + values[mid]);
}

bool CopyOffsetSampleToEndpoint(std::vector<Vec3>& samples,
                                const std::vector<Vec3>& edge_points,
                                size_t from_index, size_t to_index) {
  if (from_index >= samples.size() || to_index >= samples.size() ||
      from_index >= edge_points.size() || to_index >= edge_points.size()) {
    return false;
  }
  const Vec3& from = samples[from_index];
  const Vec3& edge_from = edge_points[from_index];
  const Vec3& edge_to = edge_points[to_index];
  if (!IsFinitePoint(from) || !IsFinitePoint(edge_from) || !IsFinitePoint(edge_to)) {
    return false;
  }
  samples[to_index] = {edge_to.x + (from.x - edge_from.x),
                       edge_to.y + (from.y - edge_from.y),
                       edge_to.z + (from.z - edge_from.z)};
  return true;
}

void StabilizeOpenFilletEndpoints(std::vector<Vec3>& centerline,
                                  std::vector<Vec3>& tangent_a,
                                  std::vector<Vec3>& tangent_b,
                                  const std::vector<Vec3>& edge_points,
                                  double radius) {
  const size_t n =
      std::min(std::min(centerline.size(), tangent_a.size()),
               std::min(tangent_b.size(), edge_points.size()));
  if (n < 3) return;
  std::vector<double> distances(n, std::numeric_limits<double>::quiet_NaN());
  for (size_t i = 0; i < n; ++i) {
    distances[i] = PointDistance(centerline[i], edge_points[i]);
  }

  std::vector<double> interior;
  std::vector<double> all;
  interior.reserve(n);
  all.reserve(n);
  for (size_t i = 0; i < n; ++i) {
    const double value = distances[i];
    if (!(std::isfinite(value) && value > 1e-9)) continue;
    all.push_back(value);
    if (i > 0 && i + 1 < n) interior.push_back(value);
  }
  const double base_dist = std::isfinite(MedianFinite(interior))
                               ? MedianFinite(interior)
                               : MedianFinite(all);
  if (!(base_dist > 0.0)) return;

  const double r = std::max(0.0, std::abs(radius));
  const double outlier_threshold =
      std::max({base_dist * 2.25, r * 2.5, base_dist + std::max(0.5, r)});
  auto maybe_stabilize = [&](size_t index, size_t neighbor_index) {
    const double dist = distances[index];
    const double neighbor_dist = distances[neighbor_index];
    const bool too_far =
        std::isfinite(dist)
            ? (dist > outlier_threshold &&
               (!std::isfinite(neighbor_dist) || dist > (neighbor_dist * 2.25)))
            : true;
    if (!too_far) return;
    CopyOffsetSampleToEndpoint(centerline, edge_points, neighbor_index, index);
    CopyOffsetSampleToEndpoint(tangent_a, edge_points, neighbor_index, index);
    CopyOffsetSampleToEndpoint(tangent_b, edge_points, neighbor_index, index);
  };

  maybe_stabilize(0, 1);
  maybe_stabilize(n - 1, n - 2);
}

struct WindingDecision {
  bool centerline_reversed = false;
  bool tangent_a_reversed = false;
  bool tangent_b_reversed = false;
};

void ReversePrefix(std::vector<Vec3>& points, size_t count) {
  if (count > points.size()) count = points.size();
  std::reverse(points.begin(), points.begin() + static_cast<std::ptrdiff_t>(count));
}

WindingDecision FixPolylineWinding(const std::vector<Vec3>& centerline,
                                   const std::vector<Vec3>& tangent_a,
                                   const std::vector<Vec3>& tangent_b,
                                   double expected_radius) {
  WindingDecision decision;
  const size_t n =
      std::min(centerline.size(), std::min(tangent_a.size(), tangent_b.size()));
  if (n < 3) return decision;

  if (std::isfinite(expected_radius) && expected_radius > 0.0) {
    const std::array<std::array<bool, 3>, 8> combos = {{
        {{false, false, false}}, {{false, true, false}},
        {{false, false, true}},  {{true, false, false}},
        {{true, true, false}},   {{true, false, true}},
        {{false, true, true}},   {{true, true, true}},
    }};
    std::vector<size_t> indices;
    auto idx_from_t = [&](double t) {
      return static_cast<size_t>(std::max(
          0.0, std::min(static_cast<double>(n - 1),
                        std::round(t * static_cast<double>(n - 1)))));
    };
    indices.push_back(idx_from_t(0.25));
    indices.push_back(idx_from_t(0.5));
    indices.push_back(idx_from_t(0.75));
    std::sort(indices.begin(), indices.end());
    indices.erase(std::unique(indices.begin(), indices.end()), indices.end());

    double best_cost = std::numeric_limits<double>::infinity();
    for (const auto& combo : combos) {
      double cost = 0.0;
      for (const size_t i : indices) {
        const size_t ci = combo[0] ? (n - 1 - i) : i;
        const size_t ai = combo[1] ? (n - 1 - i) : i;
        const size_t bi = combo[2] ? (n - 1 - i) : i;
        cost += std::abs(PointDistance(centerline[ci], tangent_a[ai]) -
                         expected_radius);
        cost += std::abs(PointDistance(centerline[ci], tangent_b[bi]) -
                         expected_radius);
      }
      if (cost < best_cost) {
        best_cost = cost;
        decision.centerline_reversed = combo[0];
        decision.tangent_a_reversed = combo[1];
        decision.tangent_b_reversed = combo[2];
      }
    }
    if (std::isfinite(best_cost)) return decision;
  }

  auto avg_dir = [n](const std::vector<Vec3>& points) {
    Vec3 sum{};
    for (size_t i = 0; i + 1 < n; ++i) {
      sum = Add(sum, Subtract(points[i + 1], points[i]));
    }
    return Normalize(sum);
  };
  const Vec3 c_dir = avg_dir(centerline);
  const Vec3 a_dir = avg_dir(tangent_a);
  const Vec3 b_dir = avg_dir(tangent_b);
  if (Dot(c_dir, a_dir) < 0.0) decision.tangent_a_reversed = true;
  if (Dot(c_dir, b_dir) < 0.0) decision.tangent_b_reversed = true;
  if (decision.tangent_a_reversed && decision.tangent_b_reversed) {
    decision.centerline_reversed = true;
    decision.tangent_a_reversed = false;
    decision.tangent_b_reversed = false;
  }
  return decision;
}

double EndpointCost(const std::vector<Vec3>& poly, const Vec3& ref_a,
                    const Vec3& ref_b) {
  if (poly.size() < 2) return std::numeric_limits<double>::infinity();
  const double d1 = PointDistance(poly.front(), ref_a);
  const double d2 = PointDistance(poly.back(), ref_b);
  if (!std::isfinite(d1) || !std::isfinite(d2)) {
    return std::numeric_limits<double>::infinity();
  }
  return d1 + d2;
}

void AlignPolylineToCenterlineEnds(std::vector<Vec3>& poly,
                                   const std::vector<Vec3>& centerline) {
  if (poly.size() < 2 || centerline.size() < 2) return;
  const double forward = EndpointCost(poly, centerline.front(), centerline.back());
  const double reverse = EndpointCost(poly, centerline.back(), centerline.front());
  if (reverse + 1e-9 < forward) {
    std::reverse(poly.begin(), poly.end());
  }
}

bool PointsMatchWithinTolerance(const Vec3& a, const Vec3& b, double eps = 1e-9) {
  return DistanceSq(a, b) <= (eps * eps);
}

struct PolylineBacktrackingStats {
  uint32_t checked_segments = 0;
  uint32_t backtracking_segments = 0;
  double worst_cos = 1.0;
};

PolylineBacktrackingStats FilletPolylineBacktrackingStats(
    const std::vector<Vec3>& reference_points,
    const std::vector<Vec3>& candidate_points) {
  PolylineBacktrackingStats stats;
  const size_t count =
      std::min(reference_points.size(), candidate_points.size());
  if (count < 2) return stats;

  for (size_t i = 0; i + 1 < count; ++i) {
    const Vec3& r0 = reference_points[i];
    const Vec3& r1 = reference_points[i + 1];
    const Vec3& c0 = candidate_points[i];
    const Vec3& c1 = candidate_points[i + 1];
    if (!IsFinitePoint(r0) || !IsFinitePoint(r1) || !IsFinitePoint(c0) ||
        !IsFinitePoint(c1)) {
      continue;
    }

    const Vec3 r = Subtract(r1, r0);
    const Vec3 c = Subtract(c1, c0);
    const double r_len = std::sqrt(LengthSq(r));
    const double c_len = std::sqrt(LengthSq(c));
    if (!(r_len > 1e-12) || !(c_len > 1e-12)) continue;

    stats.checked_segments += 1;
    const double cos = Dot(r, c) / (r_len * c_len);
    stats.worst_cos = std::min(stats.worst_cos, cos);
    if (cos < -1e-6) stats.backtracking_segments += 1;
  }

  return stats;
}

std::vector<Vec3> FilletSmoothPolylineKinks(const std::vector<Vec3>& points,
                                            double strength) {
  const size_t count = points.size();
  const double clamped_strength = std::max(0.0, std::min(1.0, strength));
  if (count < 3 || !(clamped_strength > 0.0)) return points;
  for (const Vec3& point : points) {
    if (!IsFinitePoint(point)) return points;
  }

  const int iterations = 1 + static_cast<int>(std::floor(clamped_strength * 2.0));
  std::vector<Vec3> current = points;
  for (int pass = 0; pass < iterations; ++pass) {
    std::vector<Vec3> next = current;
    bool moved_in_pass = false;
    for (size_t i = 1; i + 1 < count; ++i) {
      const Vec3& prev = current[i - 1];
      const Vec3& cur = current[i];
      const Vec3& after = current[i + 1];
      const Vec3 v_prev = Subtract(cur, prev);
      const Vec3 v_next = Subtract(after, cur);
      const double len_prev = std::sqrt(LengthSq(v_prev));
      const double len_next = std::sqrt(LengthSq(v_next));
      if (!(len_prev > 1e-12) || !(len_next > 1e-12)) continue;

      const double dot_raw = Dot(v_prev, v_next) / (len_prev * len_next);
      const double dot = Clamp(dot_raw, -1.0, 1.0);
      const double kink_factor = std::max(0.0, (1.0 - dot) * 0.5);
      if (kink_factor < 0.01) continue;

      const double local_weight = clamped_strength * std::sqrt(kink_factor);
      if (!(local_weight > 1e-6)) continue;

      const Vec3 target = Scale(Add(prev, after), 0.5);
      Vec3 move = Scale(Subtract(target, cur), local_weight);
      const double move_len = std::sqrt(LengthSq(move));
      if (!(move_len > 1e-12)) continue;

      const double max_move = std::min(len_prev, len_next) * 0.45;
      if (move_len > max_move && max_move > 1e-12) {
        move = Scale(move, max_move / move_len);
      }

      next[i] = Add(cur, move);
      moved_in_pass = true;
    }
    current.swap(next);
    if (!moved_in_pass) break;
  }
  return current;
}

struct ForwardProgressResult {
  std::vector<Vec3> points;
  uint32_t corrected_segments = 0;
};

ForwardProgressResult FilletEnforcePolylineForwardProgress(
    const std::vector<Vec3>& reference_points,
    const std::vector<Vec3>& candidate_points, bool lock_endpoints,
    int passes) {
  ForwardProgressResult result;
  const size_t count =
      std::min(reference_points.size(), candidate_points.size());
  result.points.assign(candidate_points.begin(),
                       candidate_points.begin() +
                           static_cast<std::ptrdiff_t>(count));
  if (count < 2) return result;

  const int clamped_passes = std::max(1, std::min(8, passes));
  for (int pass = 0; pass < clamped_passes; ++pass) {
    bool changed_in_pass = false;
    for (size_t i = 0; i + 1 < count; ++i) {
      const Vec3& r0 = reference_points[i];
      const Vec3& r1 = reference_points[i + 1];
      Vec3& p0 = result.points[i];
      Vec3& p1 = result.points[i + 1];
      if (!IsFinitePoint(r0) || !IsFinitePoint(r1) || !IsFinitePoint(p0) ||
          !IsFinitePoint(p1)) {
        continue;
      }

      const Vec3 r = Subtract(r1, r0);
      const double r_len = std::sqrt(LengthSq(r));
      if (!(r_len > 1e-12)) continue;
      const Vec3 u = Scale(r, 1.0 / r_len);
      const double forward = Dot(Subtract(p1, p0), u);
      const double min_forward = std::max(1e-10, r_len * 1e-6);
      if (forward >= min_forward) continue;

      const double correction = min_forward - forward;
      const bool can_move_prev = !lock_endpoints || (i > 0);
      const bool can_move_next = !lock_endpoints || ((i + 1) < (count - 1));
      if (!can_move_prev && !can_move_next) continue;

      if (can_move_prev && can_move_next) {
        const double half = correction * 0.5;
        p0 = Add(p0, Scale(u, -half));
        p1 = Add(p1, Scale(u, half));
      } else if (can_move_next) {
        p1 = Add(p1, Scale(u, correction));
      } else {
        p0 = Add(p0, Scale(u, -correction));
      }

      result.corrected_segments += 1;
      changed_in_pass = true;
    }
    if (!changed_in_pass) break;
  }

  return result;
}

std::vector<Vec3> SanitizeFilletTangentPolyline(
    const std::vector<Vec3>& centerline_points,
    const std::vector<Vec3>& tangent_points, bool closed_loop,
    double strength) {
  const size_t count =
      std::min(centerline_points.size(), tangent_points.size());
  std::vector<Vec3> source;
  source.assign(tangent_points.begin(),
                tangent_points.begin() + static_cast<std::ptrdiff_t>(count));
  if (count < 2) return source;

  std::vector<Vec3> working =
      strength > 0.0 ? FilletSmoothPolylineKinks(source, strength) : source;
  ForwardProgressResult primary = FilletEnforcePolylineForwardProgress(
      centerline_points, working, true, 4);
  working = std::move(primary.points);

  if (closed_loop && working.size() >= 2 &&
      PointsMatchWithinTolerance(source.front(), source.back())) {
    working.back() = working.front();
  }

  PolylineBacktrackingStats after =
      FilletPolylineBacktrackingStats(centerline_points, working);
  if (after.backtracking_segments > 0) {
    ForwardProgressResult fallback = FilletEnforcePolylineForwardProgress(
        centerline_points, working, false, 4);
    working = std::move(fallback.points);
    if (closed_loop && working.size() >= 2 &&
        PointsMatchWithinTolerance(source.front(), source.back())) {
      working.back() = working.front();
    }
  }

  if (tangent_points.size() > count) {
    working.insert(working.end(), tangent_points.begin() +
                                      static_cast<std::ptrdiff_t>(count),
                   tangent_points.end());
  }
  return working;
}

void ApplyTangentOffset(std::vector<Vec3>& tangent_points,
                        const std::vector<Vec3>& centerline_points,
                        double offset_distance) {
  const size_t count =
      std::min(tangent_points.size(), centerline_points.size());
  for (size_t i = 0; i < count; ++i) {
    const Vec3& center = centerline_points[i];
    Vec3& tangent = tangent_points[i];
    const Vec3 dir = Subtract(tangent, center);
    const double dir_len = std::sqrt(LengthSq(dir));
    if (!(dir_len > 1e-12)) continue;
    tangent = Add(tangent, Scale(dir, offset_distance / dir_len));
  }
}

void ApplyWedgeInset(std::vector<Vec3>& edge_points,
                     const std::vector<Vec3>& centerline_points,
                     const manifold::MeshGL& mesh, double inset_magnitude,
                     bool use_inside_check, int default_dir_sign) {
  if (!(inset_magnitude > 0.0)) return;
  const size_t count =
      std::min(edge_points.size(), centerline_points.size());
  if (count == 0) return;

  struct InsetCandidate {
    Vec3 original;
    Vec3 candidate_in;
    Vec3 candidate_out;
    bool has_in_inside = false;
    bool has_out_inside = false;
    bool in_inside = false;
    bool out_inside = false;
  };

  std::vector<InsetCandidate> candidates(count);
  int count_in = 0;
  int count_out = 0;
  for (size_t i = 0; i < count; ++i) {
    const Vec3& edge = edge_points[i];
    const Vec3& center = centerline_points[i];
    const Vec3 inward = Subtract(center, edge);
    const double inward_len = std::sqrt(LengthSq(inward));
    if (!(inward_len > 1e-12)) continue;
    const Vec3 inward_unit = Scale(inward, 1.0 / inward_len);
    InsetCandidate candidate;
    candidate.original = edge;
    candidate.candidate_in = Add(edge, Scale(inward_unit, inset_magnitude));
    candidate.candidate_out = Add(edge, Scale(inward_unit, -inset_magnitude));
    if (use_inside_check) {
      candidate.in_inside = PointInsideMesh(mesh, candidate.candidate_in);
      candidate.out_inside = PointInsideMesh(mesh, candidate.candidate_out);
      candidate.has_in_inside = true;
      candidate.has_out_inside = true;
      if (candidate.in_inside != candidate.out_inside) {
        if (candidate.in_inside) count_in += 1;
        else count_out += 1;
      }
    }
    candidates[i] = candidate;
  }

  const int preferred_dir_sign =
      (use_inside_check && (count_in || count_out))
          ? (count_in >= count_out ? 1 : -1)
          : default_dir_sign;

  for (size_t i = 0; i < count; ++i) {
    const InsetCandidate& candidate = candidates[i];
    if (!IsFinitePoint(candidate.original)) continue;
    Vec3 chosen = candidate.original;
    bool has_choice = false;
    if (use_inside_check && candidate.has_in_inside && candidate.has_out_inside &&
        candidate.in_inside != candidate.out_inside) {
      chosen = candidate.in_inside ? candidate.candidate_in : candidate.candidate_out;
      has_choice = true;
    }
    if (!has_choice) {
      chosen =
          preferred_dir_sign >= 0 ? candidate.candidate_in : candidate.candidate_out;
      has_choice = true;
    }
    if (has_choice && IsFinitePoint(chosen)) {
      edge_points[i] = chosen;
    } else {
      edge_points[i] = candidate.original;
    }
  }
}

void PushUniquePoint(std::vector<Vec3>& target, const Vec3& point, double eps_sq) {
  if (!IsFinitePoint(point)) return;
  for (const Vec3& existing : target) {
    if (DistanceSq(existing, point) <= eps_sq) return;
  }
  target.push_back(point);
}

std::vector<Vec3> CollectUniqueFacePoints(const emscripten::val& snapshot,
                                          const std::string& face_name,
                                          double eps) {
  std::vector<Vec3> out;
  if (face_name.empty()) return out;
  SnapshotInfo info = ReadSnapshotInfo(snapshot);
  const std::unordered_map<uint32_t, std::string> resolved_id_to_face_name =
      BuildResolvedIdToFaceName(snapshot);
  uint32_t face_id = 0;
  bool found_face_id = false;
  for (const auto& entry : resolved_id_to_face_name) {
    if (entry.second == face_name) {
      face_id = entry.first;
      found_face_id = true;
      break;
    }
  }
  if (!found_face_id) return out;
  const manifold::MeshGL& mesh = info.mesh;
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  const double eps_sq = std::max(1e-14, eps * eps);
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    if (mesh.faceID[tri_idx] != face_id) continue;
    const uint32_t base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[base + 0] * stride;
    const uint32_t i1 = mesh.triVerts[base + 1] * stride;
    const uint32_t i2 = mesh.triVerts[base + 2] * stride;
    if (i0 + 2 >= mesh.vertProperties.size() || i1 + 2 >= mesh.vertProperties.size() ||
        i2 + 2 >= mesh.vertProperties.size()) {
      continue;
    }
    PushUniquePoint(out, {mesh.vertProperties[i0 + 0], mesh.vertProperties[i0 + 1],
                          mesh.vertProperties[i0 + 2]},
                    eps_sq);
    PushUniquePoint(out, {mesh.vertProperties[i1 + 0], mesh.vertProperties[i1 + 1],
                          mesh.vertProperties[i1 + 2]},
                    eps_sq);
    PushUniquePoint(out, {mesh.vertProperties[i2 + 0], mesh.vertProperties[i2 + 1],
                          mesh.vertProperties[i2 + 2]},
                    eps_sq);
  }
  return out;
}

Vec3 SolveCenterFromOffsetPlanesAnchored(const Vec3& p, const Vec3& t,
                                         const Vec3& n_a, const Vec3& q_a,
                                         int sign_a, const Vec3& n_b,
                                         const Vec3& q_b, int sign_b,
                                         double radius) {
  const double d_a = Dot(n_a, q_a) + static_cast<double>(sign_a) * radius;
  const double d_b = Dot(n_b, q_b) + static_cast<double>(sign_b) * radius;
  const double d_t = Dot(t, p);
  const Vec3 nbxt = Cross(n_b, t);
  const Vec3 txn_a = Cross(t, n_a);
  const Vec3 n_axn_b = Cross(n_a, n_b);
  const double denom = Dot(n_a, nbxt);
  if (!std::isfinite(denom) || std::abs(denom) < 1e-14) {
    return {std::numeric_limits<double>::quiet_NaN(),
            std::numeric_limits<double>::quiet_NaN(),
            std::numeric_limits<double>::quiet_NaN()};
  }
  return Scale(Add(Add(Scale(nbxt, d_a), Scale(txn_a, d_b)),
                   Scale(n_axn_b, d_t)),
               1.0 / denom);
}

Vec3 SamplePolylineAt(const manifold::MeshGL& mesh, const SharedBoundaryChain& chain,
                      double t_norm) {
  if (chain.indices.empty()) return {};
  if (chain.indices.size() == 1) return MeshVertexPoint(mesh, chain.indices.front());
  const double clamped_t = std::max(0.0, std::min(1.0, t_norm));
  const double target = chain.length * clamped_t;
  double traversed = 0.0;
  for (size_t i = 0; i + 1 < chain.indices.size(); ++i) {
    const Vec3 a = MeshVertexPoint(mesh, chain.indices[i]);
    const Vec3 b = MeshVertexPoint(mesh, chain.indices[i + 1]);
    const double segment_length = std::sqrt(DistanceSq(a, b));
    if (!(segment_length > 1e-24)) continue;
    if (target <= traversed + segment_length || i + 2 == chain.indices.size()) {
      const double local_t = std::max(0.0, std::min(1.0, (target - traversed) / segment_length));
      return Add(a, Scale(Subtract(b, a), local_t));
    }
    traversed += segment_length;
  }
  return MeshVertexPoint(mesh, chain.indices.back());
}

double RayIntersectsTriangle(const Vec3& origin, const Vec3& dir, const Vec3& a,
                             const Vec3& b, const Vec3& c) {
  constexpr double kRayEps = 1e-12;
  const Vec3 e1 = Subtract(b, a);
  const Vec3 e2 = Subtract(c, a);
  const Vec3 p = Cross(dir, e2);
  const double det = Dot(e1, p);
  if (std::abs(det) < kRayEps) return -1.0;
  const double inv_det = 1.0 / det;
  const Vec3 tvec = Subtract(origin, a);
  const double u = Dot(tvec, p) * inv_det;
  if (u < -1e-12 || u > 1.0 + 1e-12) return -1.0;
  const Vec3 q = Cross(tvec, e1);
  const double v = Dot(dir, q) * inv_det;
  if (v < -1e-12 || u + v > 1.0 + 1e-12) return -1.0;
  const double t_hit = Dot(e2, q) * inv_det;
  return t_hit > 1e-10 ? t_hit : -1.0;
}

bool PointInsideMesh(const manifold::MeshGL& mesh, const Vec3& point) {
  const double diag = BoundingBoxDiagonal(mesh);
  const double jitter = 1e-6 * diag;
  const std::array<Vec3, 3> dirs = {{{1.0, 0.0, 0.0}, {0.0, 1.0, 0.0},
                                     {0.0, 0.0, 1.0}}};
  const uint32_t tri_count = static_cast<uint32_t>(mesh.triVerts.size() / 3);
  int votes = 0;
  for (size_t k = 0; k < dirs.size(); ++k) {
    const Vec3 origin{point.x + static_cast<double>(k + 1) * jitter,
                      point.y + static_cast<double>(k + 2) * jitter,
                      point.z + static_cast<double>(k + 3) * jitter};
    int hits = 0;
    for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
      const uint32_t base = tri_idx * 3;
      const Vec3 a = MeshVertexPoint(mesh, mesh.triVerts[base + 0]);
      const Vec3 b = MeshVertexPoint(mesh, mesh.triVerts[base + 1]);
      const Vec3 c = MeshVertexPoint(mesh, mesh.triVerts[base + 2]);
      if (RayIntersectsTriangle(origin, dirs[k], a, b, c) >= 0.0) hits++;
    }
    if ((hits % 2) == 1) votes++;
  }
  return votes >= 2;
}

}  // namespace

emscripten::val BuildFilletSegmentAuthoringState(const emscripten::val& options) {
  const std::string name = ReadString(options["name"], "fillet");
  const std::vector<Vec3> centerline = ReadPoints(options["centerline"], "centerline");
  const std::vector<Vec3> tangent_a = ReadPoints(options["tangentA"], "tangentA");
  const std::vector<Vec3> tangent_b = ReadPoints(options["tangentB"], "tangentB");
  const std::vector<Vec3> edge_points = ReadPoints(options["edge"], "edge");
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const double requested_radius =
      options["requestedRadius"].isUndefined() || options["requestedRadius"].isNull()
          ? radius
          : ReadFiniteNumber(options["requestedRadius"], "requestedRadius");
  const double nudge_face_distance =
      options["nudgeFaceDistance"].isUndefined() ||
              options["nudgeFaceDistance"].isNull()
          ? 0.0001
          : ReadFiniteNumber(options["nudgeFaceDistance"], "nudgeFaceDistance");
  const double resolution_raw =
      options["resolution"].isUndefined() || options["resolution"].isNull()
          ? 32.0
          : ReadFiniteNumber(options["resolution"], "resolution");
  const bool closed =
      !(options["closedLoop"].isUndefined() || options["closedLoop"].isNull()) &&
      options["closedLoop"].as<bool>();
  const std::string edge_reference =
      ReadString(options["edgeReference"], "");

  if (centerline.size() < 2 || tangent_a.size() < 2 || tangent_b.size() < 2 ||
      edge_points.size() < 2) {
    throw std::runtime_error("Fillet segment requires at least two sampled points per polyline.");
  }

  SnapshotBuilder wedge_builder;
  const double min_triangle_area = radius * radius * 1e-8;
  const size_t sample_count = std::min(
      std::min(centerline.size(), tangent_a.size()),
      std::min(tangent_b.size(), edge_points.size()));

  if (closed) {
    for (size_t i = 0; i + 1 < sample_count; ++i) {
      const Vec3& c1 = centerline[i];
      const Vec3& c2 = centerline[i + 1];
      const Vec3& ta1 = tangent_a[i];
      const Vec3& ta2 = tangent_a[i + 1];
      const Vec3& tb1 = tangent_b[i];
      const Vec3& tb2 = tangent_b[i + 1];
      const Vec3& e1 = edge_points[i];
      const Vec3& e2 = edge_points[i + 1];

      AddTriangleIfValid(wedge_builder, name + "_WEDGE_A", c1, ta1, c2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_WEDGE_A", c2, ta1, ta2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_WEDGE_B", c1, c2, tb1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_WEDGE_B", c2, tb2, tb1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SIDE_A", e1, ta1, e2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SIDE_A", e2, ta1, ta2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SIDE_B", e1, e2, tb1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SIDE_B", e2, tb2, tb1,
                         min_triangle_area);
    }
  } else {
    for (size_t i = 0; i + 1 < sample_count; ++i) {
      const Vec3& c1 = centerline[i];
      const Vec3& c2 = centerline[i + 1];
      const Vec3& ta1 = tangent_a[i];
      const Vec3& ta2 = tangent_a[i + 1];
      const Vec3& tb1 = tangent_b[i];
      const Vec3& tb2 = tangent_b[i + 1];
      const Vec3& e1 = edge_points[i];
      const Vec3& e2 = edge_points[i + 1];

      AddTriangleIfValid(wedge_builder, name + "_SURFACE_CA", c1, c2, ta1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SURFACE_CA", c2, ta2, ta1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SURFACE_CB", c1, tb1, c2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_SURFACE_CB", c2, tb1, tb2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_FACE_A", ta1, ta2, e1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_FACE_A", ta2, e2, e1,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_FACE_B", tb1, e1, tb2,
                         min_triangle_area);
      AddTriangleIfValid(wedge_builder, name + "_FACE_B", tb2, e1, e2,
                         min_triangle_area);
    }

    const Vec3& first_c = centerline.front();
    const Vec3& first_ta = tangent_a.front();
    const Vec3& first_tb = tangent_b.front();
    const Vec3& first_e = edge_points.front();
    AddTriangleIfValid(wedge_builder, name + "_END_CAP_1", first_c, first_tb,
                       first_ta, min_triangle_area);
    AddTriangleIfValid(wedge_builder, name + "_END_CAP_1", first_ta, first_tb,
                       first_e, min_triangle_area);

    const Vec3& last_c = centerline[sample_count - 1];
    const Vec3& last_ta = tangent_a[sample_count - 1];
    const Vec3& last_tb = tangent_b[sample_count - 1];
    const Vec3& last_e = edge_points[sample_count - 1];
    AddTriangleIfValid(wedge_builder, name + "_END_CAP_2", last_c, last_ta,
                       last_tb, min_triangle_area);
    AddTriangleIfValid(wedge_builder, name + "_END_CAP_2", last_ta, last_e,
                       last_tb, min_triangle_area);
  }

  emscripten::val wedge_snapshot = BuildSnapshot(wedge_builder);
  std::vector<std::pair<std::string, double>> wedge_push_faces = {
      {name + "_FACE_A", nudge_face_distance},
      {name + "_FACE_B", nudge_face_distance},
  };
  if (!closed) {
    wedge_push_faces.push_back({name + "_END_CAP_1", nudge_face_distance});
    wedge_push_faces.push_back({name + "_END_CAP_2", nudge_face_distance});
  }
  wedge_snapshot = ApplyFaceOpsAndMetadata(
      wedge_snapshot, wedge_push_faces,
      BuildWedgeMetadata(wedge_snapshot, name, closed));

  emscripten::val tube_options = emscripten::val::object();
  tube_options.set("points", ToPointArray(BuildTubePath(centerline, closed)));
  tube_options.set("radius", radius);
  tube_options.set("innerRadius", 0.0);
  tube_options.set("resolution",
                   std::max(8, static_cast<int>(std::floor(resolution_raw))));
  tube_options.set("closed", closed);
  tube_options.set("preferFast", true);
  tube_options.set("selfUnion", true);
  tube_options.set("name", name + "_TUBE");
  emscripten::val tube_snapshot = BuildTubeAuthoringState(tube_options);
  tube_snapshot = ApplyFaceOpsAndMetadata(
      tube_snapshot, {},
      BuildTubeMetadata(tube_snapshot, name, radius, requested_radius,
                        edge_reference, closed));

  emscripten::val final_snapshot =
      BuildBooleanResultSnapshot(wedge_snapshot, tube_snapshot, name);

  emscripten::val result = emscripten::val::object();
  result.set("wedgeSnapshot", wedge_snapshot);
  result.set("tubeSnapshot", tube_snapshot);
  result.set("finalSnapshot", final_snapshot);
  return result;
}

emscripten::val ClassifyFilletEdgeDirection(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("classifyFilletEdgeDirection requires snapshot.");
  }

  const std::string face_a_name = ReadString(options["faceAName"], "");
  const std::string face_b_name = ReadString(options["faceBName"], "");
  if (face_a_name.empty() || face_b_name.empty()) {
    throw std::runtime_error(
        "classifyFilletEdgeDirection requires faceAName and faceBName.");
  }
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const std::string fallback_direction_raw =
      ReadString(options["fallbackDirection"], "INSET");
  const std::string fallback_direction =
      fallback_direction_raw == "OUTSET" ? "OUTSET" : "INSET";
  const double threshold =
      options["threshold"].isUndefined() || options["threshold"].isNull()
          ? 0.2
          : ReadFiniteNumber(options["threshold"], "threshold");

  SnapshotInfo info = ReadSnapshotInfo(snapshot);
  const auto face_a_found = info.face_name_to_id.find(face_a_name);
  const auto face_b_found = info.face_name_to_id.find(face_b_name);

  emscripten::val result = emscripten::val::object();
  result.set("direction", fallback_direction);
  result.set("reason", "missing_context");
  result.set("signedDihedral", emscripten::val::null());
  result.set("insetVotes", 0);
  result.set("outsetVotes", 0);
  result.set("ambiguousSamples", 0);
  result.set("usedSamples", 0);
  if (face_a_found == info.face_name_to_id.end() ||
      face_b_found == info.face_name_to_id.end()) {
    result.set("reason", "missing_faces");
    return result;
  }

  const uint32_t face_a_id = face_a_found->second;
  const uint32_t face_b_id = face_b_found->second;
  const std::vector<SharedBoundaryChain> chains =
      BuildSharedBoundaryChains(info.mesh, face_a_id, face_b_id);
  if (chains.empty()) {
    result.set("reason", "missing_boundary_polyline");
    return result;
  }

  const SharedBoundaryChain& chain = chains.front();
  result.set("boundarySegmentCount",
             static_cast<uint32_t>(chain.indices.size() > 0
                                       ? chain.indices.size() - 1
                                       : 0));
  result.set("boundaryLength", chain.length);

  const OrientedTangentInfo tangent_info =
      ResolveOrientedEdgeTangent(info.mesh, face_a_id, chain);
  if (!tangent_info.valid) {
    result.set("reason", "missing_oriented_tangent");
    return result;
  }

  const FaceMeshInfo face_a = BuildFaceMeshInfo(info.mesh, face_a_id);
  const FaceMeshInfo face_b = BuildFaceMeshInfo(info.mesh, face_b_id);
  const Vec3 fallback_normal_a = face_a.avg_normal;
  const Vec3 fallback_normal_b = face_b.avg_normal;
  const Vec3 normal_a =
      LocalFaceNormalAtPoint(face_a, tangent_info.midpoint, fallback_normal_a);
  const Vec3 normal_b =
      LocalFaceNormalAtPoint(face_b, tangent_info.midpoint, fallback_normal_b);
  if (!(LengthSq(normal_a) > 1e-24) || !(LengthSq(normal_b) > 1e-24)) {
    result.set("reason", "missing_normals");
    return result;
  }

  const double signed_dihedral =
      Dot(Cross(normal_a, normal_b), tangent_info.tangent);
  if (!std::isfinite(signed_dihedral)) {
    result.set("reason", "invalid_signed_dihedral");
    return result;
  }
  result.set("signedDihedral", signed_dihedral);

  if (signed_dihedral > threshold) {
    result.set("direction", "INSET");
    result.set("reason", "signed_dihedral");
    return result;
  }
  if (signed_dihedral < -threshold) {
    result.set("direction", "OUTSET");
    result.set("reason", "signed_dihedral");
    return result;
  }

  const double solid_tolerance =
      std::max(1e-6, BoundingBoxDiagonal(info.mesh) * 1e-6);
  const double probe_distance =
      std::max(std::max(solid_tolerance * 8.0, std::abs(radius) * 1e-4), 1e-6);
  const std::array<double, 3> sample_ts = {{0.2, 0.5, 0.8}};
  int inset_votes = 0;
  int outset_votes = 0;
  int ambiguous_samples = 0;
  int used_samples = 0;
  for (double sample_t : sample_ts) {
    const Vec3 point = SamplePolylineAt(info.mesh, chain, sample_t);
    const Vec3 local_a =
        LocalFaceNormalAtPoint(face_a, point, fallback_normal_a);
    const Vec3 local_b =
        LocalFaceNormalAtPoint(face_b, point, fallback_normal_b);
    Vec3 sum = Add(local_a, local_b);
    const double sum_len_sq = LengthSq(sum);
    if (!(sum_len_sq > 1e-24)) {
      ambiguous_samples += 1;
      continue;
    }
    sum = Scale(sum, 1.0 / std::sqrt(sum_len_sq));
    const Vec3 plus = Add(point, Scale(sum, probe_distance));
    const Vec3 minus = Add(point, Scale(sum, -probe_distance));
    const bool plus_inside = PointInsideMesh(info.mesh, plus);
    const bool minus_inside = PointInsideMesh(info.mesh, minus);
    used_samples += 1;
    if (minus_inside && !plus_inside) {
      inset_votes += 1;
    } else if (plus_inside && !minus_inside) {
      outset_votes += 1;
    } else {
      ambiguous_samples += 1;
    }
  }

  result.set("insetVotes", inset_votes);
  result.set("outsetVotes", outset_votes);
  result.set("ambiguousSamples", ambiguous_samples);
  result.set("usedSamples", used_samples);
  if (inset_votes > outset_votes) {
    result.set("direction", "INSET");
    result.set("reason", "classified");
  } else if (outset_votes > inset_votes) {
    result.set("direction", "OUTSET");
    result.set("reason", "classified");
  } else {
    result.set("direction", fallback_direction);
    result.set("reason", "ambiguous");
  }
  return result;
}

emscripten::val ComputeFilletCenterline(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("computeFilletCenterline requires snapshot.");
  }

  const std::string face_a_name = ReadString(options["faceAName"], "");
  const std::string face_b_name = ReadString(options["faceBName"], "");
  const std::vector<SegmentFacePair> segment_face_pairs =
      ReadSegmentFacePairs(options["segmentFacePairs"]);
  const bool use_segment_pairs = !segment_face_pairs.empty();
  if (!use_segment_pairs && (face_a_name.empty() || face_b_name.empty())) {
    throw std::runtime_error(
        "computeFilletCenterline requires faceAName and faceBName.");
  }

  const std::vector<Vec3> polyline_raw = ReadPoints(options["polyline"], "polyline");
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const std::string side_mode_raw = ReadString(options["sideMode"], "INSET");
  const bool closed =
      !(options["closedLoop"].isUndefined() || options["closedLoop"].isNull()) &&
      options["closedLoop"].as<bool>();

  emscripten::val out = emscripten::val::object();
  out.set("points", emscripten::val::array());
  out.set("tangentA", emscripten::val::array());
  out.set("tangentB", emscripten::val::array());
  out.set("edge", emscripten::val::array());
  out.set("closedLoop", closed);
  out.set("nativeKernel", true);

  if (!(radius > 0.0) || polyline_raw.size() < 2) return out;

  SnapshotInfo info = ReadSnapshotInfo(snapshot);
  const std::string side_mode = side_mode_raw == "OUTSET" ? "OUTSET" : "INSET";
  const bool prefer_outset = side_mode == "OUTSET";
  const double dist_tol = std::max(1e-9, 1e-6 * std::abs(radius));
  const double angle_tol = 1e-6;
  const double vec_length_tol = std::max(1e-14, 1e-14 * std::abs(radius));
  const std::vector<Vec3> polyline =
      SanitizeFilletInputPolyline(polyline_raw, dist_tol);
  if (polyline.size() < 2) return out;

  FaceMeshInfo face_a;
  FaceMeshInfo face_b;
  if (!use_segment_pairs) {
    const auto face_a_found = info.face_name_to_id.find(face_a_name);
    const auto face_b_found = info.face_name_to_id.find(face_b_name);
    if (face_a_found == info.face_name_to_id.end() ||
        face_b_found == info.face_name_to_id.end()) {
      return out;
    }
    face_a = BuildFaceMeshInfo(info.mesh, face_a_found->second);
    face_b = BuildFaceMeshInfo(info.mesh, face_b_found->second);
    if (face_a.tri_indices.empty() || face_b.tri_indices.empty()) return out;
    if (!(LengthSq(face_a.avg_normal) > 1e-24) ||
        !(LengthSq(face_b.avg_normal) > 1e-24)) {
      return out;
    }
  }

  std::vector<Vec3> samples;
  std::vector<uint32_t> sample_segment_indices;
  if (use_segment_pairs) {
    const SampledPolyline sampled = BuildCenterlineSamplesWithSegmentIndices(
        polyline, closed, dist_tol,
        static_cast<uint32_t>(segment_face_pairs.size()));
    samples = sampled.points;
    sample_segment_indices = sampled.segment_indices;
  } else {
    samples = BuildCenterlineSamples(polyline, closed, dist_tol);
  }
  if (samples.size() < 2) return out;

  const size_t sample_count = samples.size();
  std::vector<Vec3> centers;
  std::vector<Vec3> tangent_a_points;
  std::vector<Vec3> tangent_b_points;
  std::vector<Vec3> edge_points;
  centers.reserve(sample_count);
  tangent_a_points.reserve(sample_count);
  tangent_b_points.reserve(sample_count);
  edge_points.reserve(sample_count);

  const double radius_eff = std::max(kEps, radius);
  double max_allowed_radius = std::numeric_limits<double>::infinity();
  uint32_t max_allowed_samples = 0;
  std::unordered_map<std::string, FaceMeshInfo> face_cache;
  face_cache.reserve(use_segment_pairs ? (segment_face_pairs.size() * 3) : 2);

  auto get_face_entry = [&](const std::string& name) -> const FaceMeshInfo* {
    if (name.empty()) return nullptr;
    const auto found = face_cache.find(name);
    if (found != face_cache.end()) return &found->second;
    const auto id_found = info.face_name_to_id.find(name);
    if (id_found == info.face_name_to_id.end()) return nullptr;
    FaceMeshInfo built = BuildFaceMeshInfo(info.mesh, id_found->second);
    if (built.tri_indices.empty() || !(LengthSq(built.avg_normal) > 1e-24)) {
      return nullptr;
    }
    const auto inserted = face_cache.emplace(name, std::move(built));
    return &inserted.first->second;
  };

  for (size_t i = 0; i < sample_count; ++i) {
    const Vec3& point = samples[i];
    const Vec3& prev =
        closed ? samples[(i + sample_count - 1) % sample_count]
               : samples[i == 0 ? 0 : i - 1];
    const Vec3& next =
        closed ? samples[(i + 1) % sample_count]
               : samples[std::min(sample_count - 1, i + 1)];

    Vec3 tangent = Normalize(Subtract(next, prev));
    if (!(LengthSq(tangent) > vec_length_tol * vec_length_tol)) continue;

    const FaceMeshInfo* face_a_use = &face_a;
    const FaceMeshInfo* face_b_use = &face_b;
    const std::vector<Vec3>* face_vertices_a_use = &face_a.vertices;
    const std::vector<Vec3>* face_vertices_b_use = &face_b.vertices;
    uint32_t face_a_id_use = face_a.face_id;
    uint32_t face_b_id_use = face_b.face_id;
    Vec3 fallback_avg_a = face_a.avg_normal;
    Vec3 fallback_avg_b = face_b.avg_normal;
    bool allow_refine = true;

    Vec3 q_a{};
    Vec3 q_b{};
    Vec3 n_a{};
    Vec3 n_b{};
    if (use_segment_pairs) {
      const uint32_t seg_idx =
          sample_segment_indices.empty()
              ? 0
              : std::min<uint32_t>(
                    sample_segment_indices[i],
                    static_cast<uint32_t>(segment_face_pairs.size() - 1));
      const SegmentFacePair& pair = segment_face_pairs[seg_idx];
      if (pair.blended) {
        const FaceMeshInfo* base_entry = get_face_entry(pair.base_name);
        const FaceMeshInfo* side_a_entry = get_face_entry(pair.side_a_name);
        const FaceMeshInfo* side_b_entry = get_face_entry(pair.side_b_name);
        if (!base_entry || !side_a_entry || !side_b_entry) continue;

        face_a_use = base_entry;
        face_b_use = side_a_entry;
        face_vertices_a_use = &base_entry->vertices;
        face_vertices_b_use = &side_a_entry->vertices;
        face_a_id_use = base_entry->face_id;
        face_b_id_use = side_a_entry->face_id;
        fallback_avg_a = base_entry->avg_normal;
        fallback_avg_b = side_a_entry->avg_normal;
        allow_refine = false;

        q_a = ProjectPointOntoFace(*base_entry, point);
        n_a = LocalFaceNormalAtPoint(*base_entry, q_a, fallback_avg_a);

        const Vec3 q_side_a = ProjectPointOntoFace(*side_a_entry, point);
        const Vec3 q_side_b = ProjectPointOntoFace(*side_b_entry, point);
        const Vec3 n_side_a =
            LocalFaceNormalAtPoint(*side_a_entry, q_side_a,
                                   side_a_entry->avg_normal);
        const Vec3 n_side_b =
            LocalFaceNormalAtPoint(*side_b_entry, q_side_b,
                                   side_b_entry->avg_normal);
        n_b = Normalize(Add(Scale(n_side_a, 1.0 - pair.t),
                            Scale(n_side_b, pair.t)));
        if (!(LengthSq(n_b) > 1e-24)) n_b = n_side_a;
        q_b = Add(q_side_a, Scale(Subtract(q_side_b, q_side_a), pair.t));
      } else {
        const FaceMeshInfo* entry_a = get_face_entry(pair.face_a_name);
        const FaceMeshInfo* entry_b = get_face_entry(pair.face_b_name);
        if (!entry_a || !entry_b) continue;

        face_a_use = entry_a;
        face_b_use = entry_b;
        face_vertices_a_use = &entry_a->vertices;
        face_vertices_b_use = &entry_b->vertices;
        face_a_id_use = entry_a->face_id;
        face_b_id_use = entry_b->face_id;
        fallback_avg_a = entry_a->avg_normal;
        fallback_avg_b = entry_b->avg_normal;

        q_a = ProjectPointOntoFace(*entry_a, point);
        q_b = ProjectPointOntoFace(*entry_b, point);
        n_a = LocalFaceNormalAtPoint(*entry_a, q_a, fallback_avg_a);
        n_b = LocalFaceNormalAtPoint(*entry_b, q_b, fallback_avg_b);
      }
    } else {
      q_a = ProjectPointOntoFace(face_a, point);
      q_b = ProjectPointOntoFace(face_b, point);
      n_a = LocalFaceNormalAtPoint(face_a, q_a, face_a.avg_normal);
      n_b = LocalFaceNormalAtPoint(face_b, q_b, face_b.avg_normal);
    }
    if (!(LengthSq(n_a) > 1e-24) || !(LengthSq(n_b) > 1e-24)) continue;

    Vec3 v_a3 = Normalize(Cross(n_a, tangent));
    Vec3 v_b3 = Normalize(Cross(n_b, tangent));
    if (!(LengthSq(v_a3) > 1e-24) || !(LengthSq(v_b3) > 1e-24)) continue;

    const Vec3 u = v_a3;
    const Vec3 v = Normalize(Cross(tangent, u));
    if (!(LengthSq(v) > 1e-24)) continue;

    const Vec3 in_a3 = Scale(Cross(tangent, v_a3), -1.0);
    const Vec3 in_b3 = Scale(Cross(tangent, v_b3), -1.0);
    double n0x = Dot(in_a3, u);
    double n0y = Dot(in_a3, v);
    double n1x = Dot(in_b3, u);
    double n1y = Dot(in_b3, v);
    const double n0_len = std::hypot(n0x, n0y);
    const double n1_len = std::hypot(n1x, n1y);
    if (!(n0_len > 1e-8) || !(n1_len > 1e-8)) continue;
    n0x /= n0_len;
    n0y /= n0_len;
    n1x /= n1_len;
    n1y /= n1_len;

    const double dot_n = Clamp((n0x * n1x) + (n0y * n1y), -1.0, 1.0);
    const double ang_abs = std::acos(dot_n);
    const double sin_half = std::sin(0.5 * ang_abs);
    if (std::abs(sin_half) < angle_tol) continue;

    double bis_x = n0x + n1x;
    double bis_y = n0y + n1y;
    const double bis_len = std::hypot(bis_x, bis_y);
    if (bis_len > 1e-9) {
      bis_x /= bis_len;
      bis_y /= bis_len;
    } else {
      bis_x = 0.0;
      bis_y = 0.0;
    }

    if (face_vertices_a_use && face_vertices_b_use &&
        !face_vertices_a_use->empty() && !face_vertices_b_use->empty()) {
      const double tan_half = std::tan(0.5 * ang_abs);
      if (std::isfinite(tan_half) && tan_half > angle_tol &&
          (bis_x * bis_x + bis_y * bis_y) > 1e-16) {
        Vec3 dir3 = Add(Scale(u, bis_x), Scale(v, bis_y));
        if (prefer_outset) dir3 = Scale(dir3, -1.0);
        dir3 = Normalize(dir3);
        if (LengthSq(dir3) > 1e-24) {
          const auto range_a = ComputeProjectionRange(*face_vertices_a_use, v_a3);
          const auto range_b = ComputeProjectionRange(*face_vertices_b_use, v_b3);
          if (std::isfinite(range_a.first) && std::isfinite(range_a.second) &&
              std::isfinite(range_b.first) && std::isfinite(range_b.second)) {
            const double p_dot_a = Dot(point, v_a3);
            const double p_dot_b = Dot(point, v_b3);
            const double sign_a = Dot(v_a3, dir3) >= 0.0 ? 1.0 : -1.0;
            const double sign_b = Dot(v_b3, dir3) >= 0.0 ? 1.0 : -1.0;
            const double avail_a = sign_a >= 0.0 ? (range_a.second - p_dot_a)
                                                 : (p_dot_a - range_a.first);
            const double avail_b = sign_b >= 0.0 ? (range_b.second - p_dot_b)
                                                 : (p_dot_b - range_b.first);
            const double avail_min = std::min(avail_a, avail_b);
            if (std::isfinite(avail_min) && avail_min > kEps) {
              const double max_r = avail_min * tan_half;
              if (std::isfinite(max_r) && max_r > kEps) {
                max_allowed_radius = std::min(max_allowed_radius, max_r);
                max_allowed_samples += 1;
              }
            }
          }
        }
      }
    }

    const double expect_dist = radius_eff / std::abs(sin_half);
    const Vec3 c_in = SolveCenterFromOffsetPlanesAnchored(
        point, tangent, n_a, q_a, -1, n_b, q_b, -1, radius_eff);
    const Vec3 c_out = SolveCenterFromOffsetPlanesAnchored(
        point, tangent, n_a, q_a, +1, n_b, q_b, +1, radius_eff);
    const Vec3 outward_avg = Normalize(Add(n_a, n_b));
    const double outward_len_sq = LengthSq(outward_avg);
    const double desired_sign = prefer_outset ? 1.0 : -1.0;

    auto score_candidate = [&](const Vec3& candidate, const char* tag) {
      if (!IsFinitePoint(candidate)) {
        return std::make_pair(std::numeric_limits<double>::infinity(),
                              std::string(tag));
      }
      const int local_sign = std::string(tag) == "in" ? -1 : 1;
      const Vec3 t_a0 = Add(candidate, Scale(n_a, -local_sign * radius_eff));
      const Vec3 t_b0 = Add(candidate, Scale(n_b, -local_sign * radius_eff));
      const Vec3 q_a0 = ProjectPointOntoFace(*face_a_use, t_a0);
      const Vec3 q_b0 = ProjectPointOntoFace(*face_b_use, t_b0);
      const double d_a = std::sqrt(DistanceSq(t_a0, q_a0));
      const double d_b = std::sqrt(DistanceSq(t_b0, q_b0));
      double side_penalty = 0.0;
      if (outward_len_sq > kEps * kEps) {
        const Vec3 dir = Subtract(candidate, point);
        const double sign = Dot(dir, outward_avg);
        if (std::abs(sign) > kEps && (sign > 0.0 ? 1.0 : -1.0) != desired_sign) {
          side_penalty = radius_eff;
        }
      }
      const double dist_penalty =
          std::abs(std::sqrt(DistanceSq(candidate, point)) - expect_dist);
      return std::make_pair(d_a + d_b + (0.2 * dist_penalty) + side_penalty,
                            std::string(tag));
    };

    std::string pick = prefer_outset ? "out" : "in";
    Vec3 center{std::numeric_limits<double>::quiet_NaN(),
                std::numeric_limits<double>::quiet_NaN(),
                std::numeric_limits<double>::quiet_NaN()};
    const auto in_score = score_candidate(c_in, "in");
    const auto out_score = score_candidate(c_out, "out");
    if (in_score.first < std::numeric_limits<double>::infinity() ||
        out_score.first < std::numeric_limits<double>::infinity()) {
      if (in_score.first <= out_score.first) {
        pick = in_score.second;
        center = c_in;
      } else {
        pick = out_score.second;
        center = c_out;
      }
    }

    const int s_a = pick == "in" ? -1 : +1;
    const int s_b = s_a;
    Vec3 t_a = IsFinitePoint(center)
                   ? Add(center, Scale(n_a, -s_a * radius_eff))
                   : point;
    Vec3 t_b = IsFinitePoint(center)
                   ? Add(center, Scale(n_b, -s_b * radius_eff))
                   : point;

    if (!IsFinitePoint(center)) {
      if ((bis_x * bis_x + bis_y * bis_y) > 1e-16) {
        Vec3 dir3 = Normalize(Add(Scale(u, bis_x), Scale(v, bis_y)));
        if (pick == "out") dir3 = Scale(dir3, -1.0);
        center = Add(point, Scale(dir3, expect_dist));
      } else {
        const Vec3 avg_normal = Normalize(Add(n_a, n_b));
        if (!(LengthSq(avg_normal) > 1e-24)) continue;
        center = Add(point, Scale(avg_normal, (pick == "in" ? -1.0 : 1.0) * expect_dist));
      }
      t_a = Add(center, Scale(n_a, -s_a * radius_eff));
      t_b = Add(center, Scale(n_b, -s_b * radius_eff));
    }

    const double initial_dist = std::sqrt(DistanceSq(center, point));
    const bool needs_refinement =
        std::abs(initial_dist - expect_dist) > (0.1 * radius_eff);
    const bool acute_angle = std::abs(sin_half) < 0.5;
    const int refine_iters =
        (allow_refine && (needs_refinement || acute_angle))
            ? (acute_angle ? 2 : 1)
            : 0;
    for (int iter = 0; iter < refine_iters; ++iter) {
      const Vec3 q_a1 = ProjectPointOntoFace(*face_a_use, t_a);
      const Vec3 q_b1 = ProjectPointOntoFace(*face_b_use, t_b);
      const Vec3 n_a1 =
          LocalFaceNormalAtPoint(*face_a_use, q_a1, fallback_avg_a);
      const Vec3 n_b1 =
          LocalFaceNormalAtPoint(*face_b_use, q_b1, fallback_avg_b);
      const Vec3 refined = SolveCenterFromOffsetPlanesAnchored(
          point, tangent, n_a1, q_a1, s_a, n_b1, q_b1, s_b, radius_eff);
      if (!IsFinitePoint(refined)) break;
      if (DistanceSq(center, refined) < (1e-12 * std::max(1.0, radius_eff))) {
        center = refined;
        break;
      }
      center = refined;
      n_a = n_a1;
      n_b = n_b1;
      t_a = Add(center, Scale(n_a, -s_a * radius_eff));
      t_b = Add(center, Scale(n_b, -s_b * radius_eff));
    }

    const double p_to_c = std::sqrt(DistanceSq(point, center));
    const double hard_cap = 6.0 * radius_eff;
    double expect_dist_safe = expect_dist;
    const Vec3 v_pa = Subtract(t_a, point);
    const Vec3 v_pb = Subtract(t_b, point);
    const double len_a = std::sqrt(LengthSq(v_pa));
    const double len_b = std::sqrt(LengthSq(v_pb));
    if (len_a > kEps && len_b > kEps) {
      const double dot_ab =
          Clamp(Dot(v_pa, v_pb) / (len_a * len_b), -1.0, 1.0);
      const double ang = std::acos(dot_ab);
      const double sin_h = std::sin(0.5 * ang);
      if (std::abs(sin_h) > angle_tol) {
        expect_dist_safe = radius_eff / std::abs(sin_h);
      }
    }
    if (!std::isfinite(p_to_c) || p_to_c > hard_cap ||
        p_to_c > (3.0 * expect_dist_safe)) {
      double dir2_x = bis_x;
      double dir2_y = bis_y;
      if (prefer_outset) {
        dir2_x *= -1.0;
        dir2_y *= -1.0;
      }
      const double dir2_len = std::hypot(dir2_x, dir2_y);
      if (dir2_len > 1e-8) {
        dir2_x /= dir2_len;
        dir2_y /= dir2_len;
        const Vec3 dir3 =
            Normalize(Add(Scale(u, dir2_x), Scale(v, dir2_y)));
        center = Add(point, Scale(dir3, std::min(expect_dist_safe, hard_cap)));
        t_a = Add(center, Scale(n_a, -s_a * radius_eff));
        t_b = Add(center, Scale(n_b, -s_b * radius_eff));
      }
    }

    centers.push_back(center);
    tangent_a_points.push_back(t_a);
    tangent_b_points.push_back(t_b);
    edge_points.push_back(point);
  }

  if (!closed && centers.size() >= 3 && tangent_a_points.size() >= 3 &&
      tangent_b_points.size() >= 3 && edge_points.size() >= 3) {
    StabilizeOpenFilletEndpoints(centers, tangent_a_points, tangent_b_points,
                                 edge_points, radius_eff);
  }
  if (closed && centers.size() >= 2 &&
      DistanceSq(centers.front(), centers.back()) > 1e-18) {
    centers.push_back(centers.front());
    if (!tangent_a_points.empty()) {
      tangent_a_points.push_back(tangent_a_points.front());
    }
    if (!tangent_b_points.empty()) {
      tangent_b_points.push_back(tangent_b_points.front());
    }
    if (!edge_points.empty()) {
      edge_points.push_back(edge_points.front());
    }
  }

  const WindingDecision winding =
      FixPolylineWinding(centers, tangent_a_points, tangent_b_points, radius);
  if (winding.centerline_reversed) {
    std::reverse(centers.begin(), centers.end());
    std::reverse(edge_points.begin(), edge_points.end());
  }
  if (winding.tangent_a_reversed) {
    std::reverse(tangent_a_points.begin(), tangent_a_points.end());
  }
  if (winding.tangent_b_reversed) {
    std::reverse(tangent_b_points.begin(), tangent_b_points.end());
  }
  if (!closed && centers.size() >= 2) {
    AlignPolylineToCenterlineEnds(tangent_a_points, centers);
    AlignPolylineToCenterlineEnds(tangent_b_points, centers);
    AlignPolylineToCenterlineEnds(edge_points, centers);
  }

  out.set("points", ToPointArray(centers));
  out.set("tangentA", ToPointArray(tangent_a_points));
  out.set("tangentB", ToPointArray(tangent_b_points));
  out.set("edge", ToPointArray(edge_points));
  out.set("nativeFinalized", true);
  if (std::isfinite(max_allowed_radius) && max_allowed_radius < radius_eff &&
      max_allowed_samples > 0) {
    emscripten::val clamp_info = emscripten::val::object();
    clamp_info.set("requested", radius);
    clamp_info.set("maxAllowed", max_allowed_radius);
    clamp_info.set("samples", max_allowed_samples);
    out.set("radiusClamp", clamp_info);
  }
  return out;
}

Vec3 Lerp(const Vec3& a, const Vec3& b, double t) {
  return Add(a, Scale(Subtract(b, a), t));
}

double PolylineLength(const std::vector<Vec3>& points) {
  double length = 0.0;
  for (size_t i = 1; i < points.size(); ++i) {
    length += std::sqrt(DistanceSq(points[i - 1], points[i]));
  }
  return length;
}

Vec3 PointAtArcLength(const std::vector<Vec3>& points, double distance) {
  if (points.empty()) return {};
  double acc = 0.0;
  for (size_t i = 1; i < points.size(); ++i) {
    const double seg = std::sqrt(DistanceSq(points[i - 1], points[i]));
    if (acc + seg >= distance && seg > kEps) {
      const double t = Clamp((distance - acc) / seg, 0.0, 1.0);
      return Lerp(points[i - 1], points[i], t);
    }
    acc += seg;
  }
  return points.back();
}

std::vector<Vec3> ResamplePolyline3(const std::vector<Vec3>& src, uint32_t n,
                                    bool closed) {
  if (src.size() < 2 || n < 2) return src;
  std::vector<Vec3> list = src;
  if (closed) list.push_back(list.front());
  const double total_length = PolylineLength(list);
  if (!(total_length > kEps)) return src;
  std::vector<Vec3> out;
  out.reserve(n);
  for (uint32_t i = 0; i < n; ++i) {
    const double t = (n <= 1) ? 0.0 : (static_cast<double>(i) / (n - 1));
    out.push_back(PointAtArcLength(list, t * total_length));
  }
  return out;
}

double SignNonZero(double value) { return value >= 0.0 ? 1.0 : -1.0; }

struct ProjectedPoint2D {
  double x = 0.0;
  double y = 0.0;
};

struct PolylineProjection {
  bool valid = false;
  Vec3 origin{};
  Vec3 axis_u{};
  Vec3 axis_v{};
  std::vector<ProjectedPoint2D> planar;
};

PolylineProjection ProjectPolylineToPlane(const std::vector<Vec3>& points) {
  PolylineProjection projection;
  if (points.size() < 2) return projection;
  projection.origin = points.front();
  for (size_t i = 1; i < points.size(); ++i) {
    const Vec3 delta = Subtract(points[i], projection.origin);
    if (LengthSq(delta) > 1e-12) {
      projection.axis_u = Normalize(delta);
      break;
    }
  }
  if (!(LengthSq(projection.axis_u) > 1e-16)) return projection;

  Vec3 normal{};
  for (size_t i = 0; i + 2 < points.size(); ++i) {
    const Vec3 a = Subtract(points[i + 1], points[i]);
    const Vec3 b = Subtract(points[i + 2], points[i + 1]);
    const Vec3 cross = Cross(a, b);
    if (LengthSq(cross) > 1e-16) normal = Add(normal, cross);
  }
  if (!(LengthSq(normal) > 1e-16)) {
    const Vec3 fallback =
        std::abs(projection.axis_u.x) < 0.9 ? Vec3{1.0, 0.0, 0.0}
                                            : Vec3{0.0, 1.0, 0.0};
    normal = Cross(projection.axis_u, fallback);
    if (!(LengthSq(normal) > 1e-16)) normal = {0.0, 0.0, 1.0};
  }
  normal = Normalize(normal);
  projection.axis_v = Normalize(Cross(normal, projection.axis_u));
  if (!(LengthSq(projection.axis_v) > 1e-16)) return projection;

  projection.planar.reserve(points.size());
  for (const Vec3& point : points) {
    const Vec3 rel = Subtract(point, projection.origin);
    projection.planar.push_back(
        {Dot(rel, projection.axis_u), Dot(rel, projection.axis_v)});
  }
  projection.valid = true;
  return projection;
}

struct SegmentIntersectionHit {
  bool hit = false;
  double t = 0.0;
  double u = 0.0;
};

SegmentIntersectionHit SegmentIntersection2D(const ProjectedPoint2D& a1,
                                             const ProjectedPoint2D& a2,
                                             const ProjectedPoint2D& b1,
                                             const ProjectedPoint2D& b2,
                                             double tol = 1e-12) {
  const double rx = a2.x - a1.x;
  const double ry = a2.y - a1.y;
  const double sx = b2.x - b1.x;
  const double sy = b2.y - b1.y;
  const double denom = rx * sy - ry * sx;
  if (std::abs(denom) < tol) return {};
  const double dx = b1.x - a1.x;
  const double dy = b1.y - a1.y;
  const double t = (dx * sy - dy * sx) / denom;
  const double u = (dx * ry - dy * rx) / denom;
  if (t >= -tol && t <= 1.0 + tol && u >= -tol && u <= 1.0 + tol) {
    return {true, Clamp(t, 0.0, 1.0), Clamp(u, 0.0, 1.0)};
  }
  return {};
}

struct RailIntersection {
  bool hit = false;
  uint32_t i = 0;
  uint32_t j = 0;
  double t = 0.0;
  double u = 0.0;
};

RailIntersection NextRailSelfIntersection(const std::vector<Vec3>& points) {
  const PolylineProjection projection = ProjectPolylineToPlane(points);
  if (!projection.valid || projection.planar.size() < 4) return {};
  for (uint32_t i = 0; i + 3 < projection.planar.size(); ++i) {
    const ProjectedPoint2D& a0 = projection.planar[i];
    const ProjectedPoint2D& a1 = projection.planar[i + 1];
    for (uint32_t j = i + 2; j + 1 < projection.planar.size(); ++j) {
      if (j == i + 1) continue;
      const SegmentIntersectionHit hit =
          SegmentIntersection2D(a0, a1, projection.planar[j], projection.planar[j + 1]);
      if (hit.hit) return {true, i, j, hit.t, hit.u};
    }
  }
  return {};
}

Vec3 AveragePointOnSegments(const std::vector<Vec3>& points, uint32_t i,
                            double t, uint32_t j, double u) {
  if (i + 1 >= points.size() || j + 1 >= points.size()) return {};
  const Vec3 p_a = Lerp(points[i], points[i + 1], t);
  const Vec3 p_b = Lerp(points[j], points[j + 1], u);
  return Scale(Add(p_a, p_b), 0.5);
}

void CollapseRailsAtIntersection(std::vector<std::vector<Vec3>*>& rails,
                                 const RailIntersection& intersection) {
  if (!intersection.hit || intersection.j <= intersection.i + 1) return;
  const size_t remove_count = intersection.j - intersection.i;
  for (std::vector<Vec3>* rail : rails) {
    if (!rail || rail->size() <= intersection.j) return;
  }
  for (std::vector<Vec3>* rail : rails) {
    const Vec3 merged = AveragePointOnSegments(
        *rail, intersection.i, intersection.t, intersection.j, intersection.u);
    rail->erase(rail->begin() + intersection.i + 1,
                rail->begin() + intersection.i + 1 + remove_count);
    rail->insert(rail->begin() + intersection.i + 1, merged);
  }
}

void ResolveChamferSelfIntersections(std::vector<std::vector<Vec3>*>& rails,
                                     bool closed) {
  if (closed || rails.empty() || !rails.front() || rails.front()->size() < 4) return;
  const size_t base_length = rails.front()->size();
  for (const std::vector<Vec3>* rail : rails) {
    if (!rail || rail->size() != base_length) return;
  }
  const size_t max_iterations =
      std::min<size_t>(4096, base_length * base_length * rails.size());
  for (size_t iter = 0; iter < max_iterations; ++iter) {
    RailIntersection best{};
    for (const std::vector<Vec3>* rail : rails) {
      const RailIntersection hit = NextRailSelfIntersection(*rail);
      if (!hit.hit) continue;
      if (!best.hit || hit.i < best.i || (hit.i == best.i && hit.j < best.j)) {
        best = hit;
      }
    }
    if (!best.hit) break;
    CollapseRailsAtIntersection(rails, best);
  }
}

double PolylineLengthFromOrder(const std::vector<Vec3>& points,
                               const std::vector<uint32_t>& order) {
  if (points.size() < 2 || order.size() < 2) return 0.0;
  double length = 0.0;
  for (size_t i = 1; i < order.size(); ++i) {
    length += std::sqrt(DistanceSq(points[order[i - 1]], points[order[i]]));
  }
  return length;
}

std::vector<uint32_t> ComputeChamferRailOrder(const std::vector<Vec3>& points,
                                              bool closed) {
  if (closed || points.size() < 3) return {};
  if (DistanceSq(points.front(), points.back()) < 1e-9) return {};

  const uint32_t n = static_cast<uint32_t>(points.size());
  std::vector<uint8_t> used(n, 0);
  std::vector<uint32_t> order;
  order.reserve(n);
  order.push_back(0);
  used[0] = 1;
  used[n - 1] = 1;
  while (order.size() < n - 1) {
    const Vec3& current = points[order.back()];
    int32_t best = -1;
    double best_dist = std::numeric_limits<double>::infinity();
    for (uint32_t i = 1; i + 1 < n; ++i) {
      if (used[i]) continue;
      const double dist = DistanceSq(current, points[i]);
      if (dist < best_dist) {
        best_dist = dist;
        best = static_cast<int32_t>(i);
      }
    }
    if (best < 0) break;
    order.push_back(static_cast<uint32_t>(best));
    used[best] = 1;
  }
  order.push_back(n - 1);
  if (order.size() != n) return {};

  bool changed = false;
  for (uint32_t i = 0; i < n; ++i) {
    if (order[i] != i) {
      changed = true;
      break;
    }
  }
  if (!changed) return {};

  const double original_length = PolylineLength(points);
  const double reordered_length = PolylineLengthFromOrder(points, order);
  const double tolerance = std::max(1e-6, original_length * 1e-4);
  if (!(reordered_length + tolerance < original_length)) return {};
  return order;
}

void ApplyOrder(std::vector<Vec3>& values, const std::vector<uint32_t>& order) {
  if (values.size() != order.size() || order.empty()) return;
  std::vector<Vec3> reordered(order.size());
  for (size_t i = 0; i < order.size(); ++i) reordered[i] = values[order[i]];
  values.swap(reordered);
}

void ReorderChamferRailSamples(std::vector<Vec3>& rail_p,
                               std::vector<Vec3>& rail_a,
                               std::vector<Vec3>& rail_b,
                               std::vector<Vec3>& normals_a,
                               std::vector<Vec3>& normals_b,
                               std::vector<Vec3>& tangents, bool closed) {
  const std::vector<uint32_t> order = ComputeChamferRailOrder(rail_p, closed);
  if (order.empty()) return;
  ApplyOrder(rail_p, order);
  ApplyOrder(rail_a, order);
  ApplyOrder(rail_b, order);
  ApplyOrder(normals_a, order);
  ApplyOrder(normals_b, order);
  ApplyOrder(tangents, order);
}

Vec3 ShiftEdgePoint(const Vec3& point, const Vec3& normal_a,
                    const Vec3& normal_b, double inflate) {
  const Vec3 n_a = Normalize(normal_a);
  const Vec3 n_b = Normalize(normal_b);
  const Vec3 sum = Add(n_a, n_b);
  const double denom = 1.0 + Dot(n_a, n_b);
  if (!(std::abs(denom) > 1e-9) || !(LengthSq(sum) > 1e-18)) return point;
  return Add(point, Scale(sum, inflate / denom));
}

Vec3 TranslatePointWithinPlane(const Vec3& point, const Vec3& face_normal,
                               const Vec3& plane_normal, double inflate) {
  const Vec3 n = Normalize(face_normal);
  const Vec3 plane = Normalize(plane_normal);
  const Vec3 dir = Subtract(n, Scale(plane, Dot(plane, n)));
  const double len_sq = LengthSq(dir);
  if (!(len_sq > 1e-18)) return point;
  return Add(point, Scale(dir, inflate / len_sq));
}

void InflateChamferRails(const std::vector<Vec3>& rail_p,
                         const std::vector<Vec3>& rail_a,
                         const std::vector<Vec3>& rail_b,
                         const std::vector<Vec3>& normals_a,
                         const std::vector<Vec3>& normals_b,
                         const std::vector<Vec3>& tangents, double inflate,
                         std::vector<Vec3>& out_p, std::vector<Vec3>& out_a,
                         std::vector<Vec3>& out_b) {
  const size_t count = std::min(
      {rail_p.size(), rail_a.size(), rail_b.size(), normals_a.size(),
       normals_b.size(), tangents.size()});
  out_p.resize(count);
  out_a.resize(count);
  out_b.resize(count);
  for (size_t i = 0; i < count; ++i) {
    out_p[i] = ShiftEdgePoint(rail_p[i], normals_a[i], normals_b[i], inflate);
    const Vec3 tangent = Normalize(tangents[i]);
    if (!(LengthSq(tangent) > 1e-14)) {
      out_a[i] = rail_a[i];
      out_b[i] = rail_b[i];
      continue;
    }
    const Vec3 ab = Subtract(rail_b[i], rail_a[i]);
    if (!(LengthSq(ab) > 1e-18)) {
      out_a[i] = rail_a[i];
      out_b[i] = rail_b[i];
      continue;
    }
    const Vec3 bevel_normal = Normalize(Cross(ab, tangent));
    if (!(LengthSq(bevel_normal) > 1e-18)) {
      out_a[i] = rail_a[i];
      out_b[i] = rail_b[i];
      continue;
    }
    out_a[i] =
        TranslatePointWithinPlane(rail_a[i], normals_a[i], bevel_normal, inflate);
    out_b[i] =
        TranslatePointWithinPlane(rail_b[i], normals_b[i], bevel_normal, inflate);
  }
}

void BuildChamferPrismNamed(SnapshotBuilder& builder, const std::string& base_name,
                            const std::vector<Vec3>& rail_p,
                            const std::vector<Vec3>& rail_a,
                            const std::vector<Vec3>& rail_b, bool close_loop) {
  const size_t count = std::min({rail_p.size(), rail_a.size(), rail_b.size()});
  if (count < 2) return;
  const std::string name_pa = base_name + "_SIDE_A";
  const std::string name_pb = base_name + "_SIDE_B";
  const std::string name_ab = base_name + "_BEVEL";
  auto link = [&](const std::string& face_name, const Vec3& a0, const Vec3& a1,
                  const Vec3& b0, const Vec3& b1) {
    AddTriangleIfValid(builder, face_name, a0, b0, b1, 1e-18);
    AddTriangleIfValid(builder, face_name, a0, b1, a1, 1e-18);
  };
  for (size_t i = 0; i + 1 < count; ++i) {
    link(name_pa, rail_p[i], rail_p[i + 1], rail_a[i], rail_a[i + 1]);
    link(name_pb, rail_p[i], rail_p[i + 1], rail_b[i], rail_b[i + 1]);
    link(name_ab, rail_a[i], rail_a[i + 1], rail_b[i], rail_b[i + 1]);
  }
  if (close_loop) {
    const size_t i = count - 1;
    link(name_pa, rail_p[i], rail_p[0], rail_a[i], rail_a[0]);
    link(name_pb, rail_p[i], rail_p[0], rail_b[i], rail_b[0]);
    link(name_ab, rail_a[i], rail_a[0], rail_b[i], rail_b[0]);
  } else {
    AddTriangleIfValid(builder, base_name + "_CAP0", rail_p.front(), rail_a.front(),
                       rail_b.front(), 1e-18);
    AddTriangleIfValid(builder, base_name + "_CAP1", rail_p.back(), rail_b.back(),
                       rail_a.back(), 1e-18);
  }
}

emscripten::val BuildChamferAuthoringState(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("buildChamferAuthoringState requires snapshot.");
  }

  const std::string face_a_name = ReadString(options["faceAName"], "");
  const std::string face_b_name = ReadString(options["faceBName"], "");
  if (face_a_name.empty() || face_b_name.empty()) {
    throw std::runtime_error(
        "buildChamferAuthoringState requires faceAName and faceBName.");
  }

  std::vector<Vec3> polyline = ReadPoints(options["polyline"], "polyline");
  if (polyline.size() < 2) {
    throw std::runtime_error(
        "buildChamferAuthoringState requires at least two edge polyline points.");
  }

  const double distance = ReadFiniteNumber(options["distance"], "distance");
  const double inflate =
      options["inflate"].isUndefined() || options["inflate"].isNull()
          ? 0.0
          : ReadFiniteNumber(options["inflate"], "inflate");
  const double sample_count_raw =
      options["sampleCount"].isUndefined() || options["sampleCount"].isNull()
          ? 50.0
          : ReadFiniteNumber(options["sampleCount"], "sampleCount");
  const bool snap_seam_to_edge =
      options["snapSeamToEdge"].isUndefined() || options["snapSeamToEdge"].isNull()
          ? true
          : options["snapSeamToEdge"].as<bool>();
  const bool flip_side =
      !(options["flipSide"].isUndefined() || options["flipSide"].isNull()) &&
      options["flipSide"].as<bool>();
  const std::string direction_raw = ReadString(options["direction"], "INSET");
  const std::string direction = direction_raw == "OUTSET" ? "OUTSET" : "INSET";
  std::string name = ReadString(options["name"], "CHAMFER");
  bool closed_loop =
      !(options["closedLoop"].isUndefined() || options["closedLoop"].isNull()) &&
      options["closedLoop"].as<bool>();
  if (!closed_loop && polyline.size() > 2 &&
      DistanceSq(polyline.front(), polyline.back()) <= 1e-12) {
    closed_loop = true;
  }

  if (!(distance > 0.0)) {
    throw std::runtime_error("buildChamferAuthoringState requires a positive distance.");
  }

  SnapshotInfo info = ReadBooleanReadySnapshotInfo(snapshot, name);
  const auto face_a_found = info.face_name_to_id.find(face_a_name);
  const auto face_b_found = info.face_name_to_id.find(face_b_name);
  if (face_a_found == info.face_name_to_id.end() ||
      face_b_found == info.face_name_to_id.end()) {
    throw std::runtime_error("buildChamferAuthoringState could not resolve face ids.");
  }
  const uint32_t face_a_id = face_a_found->second;
  const uint32_t face_b_id = face_b_found->second;
  const FaceMeshInfo face_a = BuildFaceMeshInfo(info.mesh, face_a_id);
  const FaceMeshInfo face_b = BuildFaceMeshInfo(info.mesh, face_b_id);
  const Vec3 face_a_avg = face_a.avg_normal;
  const Vec3 face_b_avg = face_b.avg_normal;

  if (snap_seam_to_edge) {
    if (closed_loop && polyline.size() > 2 &&
        DistanceSq(polyline.front(), polyline.back()) <= 1e-12) {
      polyline.pop_back();
    }
  } else {
    polyline = ResamplePolyline3(
        polyline, std::max<uint32_t>(8, static_cast<uint32_t>(sample_count_raw)),
        closed_loop);
  }

  if (polyline.size() < 2) {
    throw std::runtime_error(
        "buildChamferAuthoringState produced too few polyline samples.");
  }

  const size_t mid_idx = polyline.size() / 2;
  const Vec3 pm = polyline[mid_idx];
  const Vec3 pm_prev = polyline[mid_idx > 0 ? mid_idx - 1 : 0];
  const Vec3 pm_next =
      polyline[mid_idx + 1 < polyline.size() ? mid_idx + 1 : polyline.size() - 1];
  Vec3 t_mid = Normalize(Subtract(pm_next, pm_prev));
  if (!(LengthSq(t_mid) > 1e-14)) {
    throw std::runtime_error("buildChamferAuthoringState could not resolve edge tangent.");
  }

  const Vec3 n_a_mid = LocalFaceNormalAtPoint(face_a, pm, face_a_avg);
  const Vec3 n_b_mid = LocalFaceNormalAtPoint(face_b, pm, face_b_avg);
  const Vec3 v_a_mid = Normalize(Cross(n_a_mid, t_mid));
  const Vec3 v_b_mid = Normalize(Cross(n_b_mid, t_mid));
  Vec3 outward_avg_mid = Normalize(Add(n_a_mid, n_b_mid));
  const double want = direction == "OUTSET" ? 1.0 : -1.0;
  const double s_a_global = want * SignNonZero(Dot(v_a_mid, outward_avg_mid));
  const double s_b_global = want * SignNonZero(Dot(v_b_mid, outward_avg_mid));
  const double s_flip = flip_side ? -1.0 : 1.0;
  const double s_a = s_a_global * s_flip;
  const double s_b = s_b_global * s_flip;

  std::vector<Vec3> rail_p;
  std::vector<Vec3> rail_a;
  std::vector<Vec3> rail_b;
  std::vector<Vec3> normals_a;
  std::vector<Vec3> normals_b;
  std::vector<Vec3> tangents;
  rail_p.reserve(polyline.size());
  rail_a.reserve(polyline.size());
  rail_b.reserve(polyline.size());
  normals_a.reserve(polyline.size());
  normals_b.reserve(polyline.size());
  tangents.reserve(polyline.size());

  for (size_t i = 0; i < polyline.size(); ++i) {
    const Vec3& point = polyline[i];
    const Vec3 prev =
        closed_loop ? polyline[(i + polyline.size() - 1) % polyline.size()]
                    : polyline[i > 0 ? i - 1 : 0];
    const Vec3 next =
        closed_loop ? polyline[(i + 1) % polyline.size()]
                    : polyline[i + 1 < polyline.size() ? i + 1 : polyline.size() - 1];
    Vec3 tangent = Normalize(Subtract(next, prev));
    if (!(LengthSq(tangent) > 1e-14)) continue;

    Vec3 n_a = Normalize(LocalFaceNormalAtPoint(face_a, point, face_a_avg));
    Vec3 n_b = Normalize(LocalFaceNormalAtPoint(face_b, point, face_b_avg));
    Vec3 v_a = Normalize(Cross(n_a, tangent));
    Vec3 v_b = Normalize(Cross(n_b, tangent));
    if (!(LengthSq(v_a) > 1e-12) || !(LengthSq(v_b) > 1e-12)) continue;

    rail_p.push_back(point);
    rail_a.push_back(Add(point, Scale(v_a, s_a * distance)));
    rail_b.push_back(Add(point, Scale(v_b, s_b * distance)));
    normals_a.push_back(n_a);
    normals_b.push_back(n_b);
    tangents.push_back(tangent);
  }

  if (rail_p.size() < 2) {
    throw std::runtime_error(
        "buildChamferAuthoringState generated insufficient rail samples.");
  }

  ReorderChamferRailSamples(rail_p, rail_a, rail_b, normals_a, normals_b,
                            tangents, closed_loop);

  std::vector<Vec3> rail_p_used = rail_p;
  std::vector<Vec3> rail_a_used = rail_a;
  std::vector<Vec3> rail_b_used = rail_b;
  if (std::abs(inflate) > 1e-12) {
    InflateChamferRails(rail_p, rail_a, rail_b, normals_a, normals_b, tangents,
                        inflate, rail_p_used, rail_a_used, rail_b_used);
  }

  std::vector<std::vector<Vec3>*> rails = {&rail_p_used, &rail_a_used, &rail_b_used};
  ResolveChamferSelfIntersections(rails, closed_loop);

  const std::string base_name = "CHAMFER_" + face_a_name + "|" + face_b_name;
  SnapshotBuilder builder;
  BuildChamferPrismNamed(builder, base_name, rail_p_used, rail_a_used, rail_b_used,
                         closed_loop);
  emscripten::val out = BuildSnapshot(builder);
  out.set("name", name);
  out.set("nativeKernel", true);

  if (!closed_loop) {
    BrepSolidCore core;
    core.SetAuthoringState(out);
    core.PushFace(base_name + "_CAP0", 0.0001);
    core.PushFace(base_name + "_CAP1", 0.0001);
    out = core.GetAuthoringState();
    out.set("name", name);
    out.set("nativeKernel", true);
  }

  return out;
}

emscripten::val BuildChamferWorkflowAuthoringState(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("buildChamferWorkflowAuthoringState requires snapshot.");
  }
  const emscripten::val edges = options["edges"];
  if (edges.isUndefined() || edges.isNull()) {
    throw std::runtime_error("buildChamferWorkflowAuthoringState requires edges.");
  }

  const double distance = ReadFiniteNumber(options["distance"], "distance");
  const double inflate_raw =
      options["inflate"].isUndefined() || options["inflate"].isNull()
          ? 0.1
          : ReadFiniteNumber(options["inflate"], "inflate");
  const std::string direction_mode_raw =
      ReadString(options["directionMode"], "AUTO");
  const std::string direction_mode =
      direction_mode_raw == "INSET" || direction_mode_raw == "OUTSET"
          ? direction_mode_raw
          : "AUTO";
  const bool auto_direction = direction_mode == "AUTO";
  const std::string fallback_direction =
      direction_mode == "OUTSET" ? "OUTSET" : "INSET";
  const std::string feature_id = ReadString(options["featureID"], "CHAMFER");
  const std::string final_name = ReadString(options["name"], feature_id.c_str());
  const double cleanup_tiny_face_islands_area =
      options["cleanupTinyFaceIslandsArea"].isUndefined() ||
              options["cleanupTinyFaceIslandsArea"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["cleanupTinyFaceIslandsArea"],
                             "cleanupTinyFaceIslandsArea");
  const bool debug =
      !(options["debug"].isUndefined() || options["debug"].isNull()) &&
      options["debug"].as<bool>();

  emscripten::val combine_entries = emscripten::val::array();
  emscripten::val debug_snapshots = emscripten::val::array();
  emscripten::val direction_decision = emscripten::val::object();
  direction_decision.set("mode", direction_mode);
  direction_decision.set("autoEnabled", auto_direction);
  direction_decision.set("fallbackDirection", fallback_direction);

  const uint32_t edge_count = edges["length"].as<uint32_t>();
  uint32_t combine_index = 0;
  uint32_t debug_index = 0;
  int inset_edges = 0;
  int outset_edges = 0;
  int fallback_edges = 0;
  int ambiguous_edges = 0;

  for (uint32_t i = 0; i < edge_count; ++i) {
    const emscripten::val edge = edges[i];
    if (edge.isUndefined() || edge.isNull()) continue;

    const std::string edge_reference =
        ReadString(edge["edgeReference"], ("EDGE_" + std::to_string(i)).c_str());
    const std::string face_a_name = ReadString(edge["faceAName"], "");
    const std::string face_b_name = ReadString(edge["faceBName"], "");
    if (face_a_name.empty() || face_b_name.empty()) continue;

    std::string edge_direction = fallback_direction;
    std::string direction_reason = auto_direction ? "fallback" : "explicit";
    emscripten::val direction_detail = emscripten::val::null();
    if (auto_direction) {
      emscripten::val classify_options = emscripten::val::object();
      classify_options.set("snapshot", snapshot);
      classify_options.set("faceAName", face_a_name);
      classify_options.set("faceBName", face_b_name);
      classify_options.set("radius", distance);
      classify_options.set("fallbackDirection", fallback_direction);
      classify_options.set("threshold", 0.2);
      try {
        direction_detail = ClassifyFilletEdgeDirection(classify_options);
        edge_direction =
            ReadString(direction_detail["direction"], fallback_direction.c_str());
        direction_reason = ReadString(direction_detail["reason"], "fallback");
      } catch (...) {
        edge_direction = fallback_direction;
        direction_reason = "native_classifier_error";
      }
      const bool is_classified =
          direction_reason == "classified" || direction_reason == "signed_dihedral";
      if (!is_classified) {
        fallback_edges += 1;
        if (direction_reason.find("ambiguous") != std::string::npos) {
          ambiguous_edges += 1;
        }
      }
    }
    if (edge_direction == "OUTSET") {
      outset_edges += 1;
    } else {
      edge_direction = "INSET";
      inset_edges += 1;
    }

    emscripten::val build_options = emscripten::val::object();
    build_options.set("snapshot", snapshot);
    build_options.set("faceAName", face_a_name);
    build_options.set("faceBName", face_b_name);
    build_options.set("polyline", edge["polyline"]);
    build_options.set("distance", distance);
    build_options.set("direction", edge_direction);
    build_options.set("inflate", edge_direction == "OUTSET" ? -inflate_raw : inflate_raw);
    build_options.set("closedLoop",
                      !(edge["closedLoop"].isUndefined() ||
                        edge["closedLoop"].isNull()) &&
                          edge["closedLoop"].as<bool>());
    build_options.set("name", ReadString(edge["name"], edge_reference.c_str()));
    if (!edge["sampleCount"].isUndefined() && !edge["sampleCount"].isNull()) {
      build_options.set("sampleCount", edge["sampleCount"]);
    }
    if (!edge["snapSeamToEdge"].isUndefined() &&
        !edge["snapSeamToEdge"].isNull()) {
      build_options.set("snapSeamToEdge", edge["snapSeamToEdge"]);
    }
    if (!edge["flipSide"].isUndefined() && !edge["flipSide"].isNull()) {
      build_options.set("flipSide", edge["flipSide"]);
    }

    emscripten::val chamfer_snapshot;
    try {
      chamfer_snapshot = BuildChamferAuthoringState(build_options);
    } catch (...) {
      continue;
    }

    emscripten::val combine_entry = emscripten::val::object();
    combine_entry.set("snapshot", chamfer_snapshot);
    combine_entry.set("direction", edge_direction);
    combine_entries.set(combine_index++, combine_entry);

    if (debug) {
      emscripten::val debug_entry = emscripten::val::object();
      debug_entry.set("kind", "chamferTool");
      debug_entry.set("name",
                      ReadString(edge["name"], edge_reference.c_str()));
      debug_entry.set("snapshot", chamfer_snapshot);
      if (!direction_detail.isNull() && !direction_detail.isUndefined()) {
        debug_entry.set("directionDetail", direction_detail);
      }
      debug_snapshots.set(debug_index++, debug_entry);
    }
  }

  direction_decision.set("totalEdges", edge_count);
  direction_decision.set("insetEdges", inset_edges);
  direction_decision.set("outsetEdges", outset_edges);
  direction_decision.set("fallbackEdges", fallback_edges);
  direction_decision.set("ambiguousEdges", ambiguous_edges);

  emscripten::val combine_options = emscripten::val::object();
  combine_options.set("targetSnapshot", snapshot);
  combine_options.set("entries", combine_entries);
  combine_options.set("featureID", feature_id);
  combine_options.set("name", final_name);
  combine_options.set("cleanupTinyFaceIslandsArea",
                      cleanup_tiny_face_islands_area);
  const emscripten::val final_snapshot =
      BuildFilletCombinedAuthoringState(combine_options);

  emscripten::val result = emscripten::val::object();
  result.set("finalSnapshot", final_snapshot);
  result.set("directionDecision", direction_decision);
  result.set("toolCount", combine_index);
  result.set("nativeKernel", true);
  if (debug) result.set("debugSnapshots", debug_snapshots);
  return result;
}

emscripten::val BuildFilletEdgeAuthoringState(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("buildFilletEdgeAuthoringState requires snapshot.");
  }

  const std::string face_a_name = ReadString(options["faceAName"], "");
  const std::string face_b_name = ReadString(options["faceBName"], "");
  const emscripten::val segment_face_pairs = options["segmentFacePairs"];
  const bool has_segment_face_pairs =
      !(segment_face_pairs.isUndefined() || segment_face_pairs.isNull()) &&
      segment_face_pairs["length"].as<uint32_t>() > 0;
  if (!has_segment_face_pairs && (face_a_name.empty() || face_b_name.empty())) {
    throw std::runtime_error(
        "buildFilletEdgeAuthoringState requires faceAName and faceBName.");
  }

  const std::vector<Vec3> polyline = ReadPoints(options["polyline"], "polyline");
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const double requested_radius =
      options["requestedRadius"].isUndefined() || options["requestedRadius"].isNull()
          ? radius
          : ReadFiniteNumber(options["requestedRadius"], "requestedRadius");
  const double inflate =
      options["inflate"].isUndefined() || options["inflate"].isNull()
          ? 0.1
          : ReadFiniteNumber(options["inflate"], "inflate");
  const double nudge_face_distance =
      options["nudgeFaceDistance"].isUndefined() ||
              options["nudgeFaceDistance"].isNull()
          ? 0.0001
          : ReadFiniteNumber(options["nudgeFaceDistance"], "nudgeFaceDistance");
  const double resolution_raw =
      options["resolution"].isUndefined() || options["resolution"].isNull()
          ? 32.0
          : ReadFiniteNumber(options["resolution"], "resolution");
  const bool closed =
      !(options["closedLoop"].isUndefined() || options["closedLoop"].isNull()) &&
      options["closedLoop"].as<bool>();
  const std::string side_mode_raw = ReadString(options["sideMode"], "INSET");
  const std::string side_mode =
      side_mode_raw == "OUTSET" ? "OUTSET" : "INSET";
  const std::string name = ReadString(options["name"], "fillet");
  const std::string edge_reference = ReadString(options["edgeReference"], "");

  if (!(radius > 0.0)) {
    throw std::runtime_error("buildFilletEdgeAuthoringState requires a positive radius.");
  }
  if (polyline.size() < 2) {
    throw std::runtime_error(
        "buildFilletEdgeAuthoringState requires at least two edge polyline points.");
  }

  emscripten::val centerline_options = emscripten::val::object();
  centerline_options.set("snapshot", snapshot);
  centerline_options.set("faceAName", face_a_name);
  centerline_options.set("faceBName", face_b_name);
  if (has_segment_face_pairs) {
    centerline_options.set("segmentFacePairs", segment_face_pairs);
  }
  centerline_options.set("polyline", ToPointArray(polyline));
  centerline_options.set("radius", radius);
  centerline_options.set("sideMode", side_mode);
  centerline_options.set("closedLoop", closed);
  const emscripten::val centerline_result =
      ComputeFilletCenterline(centerline_options);

  std::vector<Vec3> centerline =
      ReadPoints(centerline_result["points"], "centerline.points");
  std::vector<Vec3> tangent_a =
      ReadPoints(centerline_result["tangentA"], "centerline.tangentA");
  std::vector<Vec3> tangent_b =
      ReadPoints(centerline_result["tangentB"], "centerline.tangentB");
  std::vector<Vec3> edge_points =
      ReadPoints(centerline_result["edge"], "centerline.edge");
  const bool result_closed =
      !(centerline_result["closedLoop"].isUndefined() ||
        centerline_result["closedLoop"].isNull()) &&
      centerline_result["closedLoop"].as<bool>();

  if (centerline.size() < 2 || tangent_a.size() < 2 || tangent_b.size() < 2 ||
      edge_points.size() < 2) {
    throw std::runtime_error(
        "Native fillet centerline produced insufficient points for edge build.");
  }

  bool has_variation = false;
  for (size_t i = 1; i < centerline.size(); ++i) {
    if (DistanceSq(centerline[i - 1], centerline[i]) > 1e-12) {
      has_variation = true;
      break;
    }
  }
  if (!has_variation) {
    throw std::runtime_error("Degenerate centerline: all points are identical.");
  }

  std::vector<Vec3> tangent_a_copy =
      SanitizeFilletTangentPolyline(centerline, tangent_a, result_closed, 1.0);
  std::vector<Vec3> tangent_b_copy =
      SanitizeFilletTangentPolyline(centerline, tangent_b, result_closed, 1.0);
  const std::vector<Vec3> tangent_a_seam = tangent_a_copy;
  const std::vector<Vec3> tangent_b_seam = tangent_b_copy;
  const std::vector<Vec3> edge_copy = edge_points;
  std::vector<Vec3> edge_wedge = edge_copy;

  const double offset_distance = inflate;
  const bool has_tangent_offset = std::abs(offset_distance) > 1e-12;
  if (has_tangent_offset) {
    ApplyTangentOffset(tangent_a_copy, centerline, offset_distance);
    ApplyTangentOffset(tangent_b_copy, centerline, offset_distance);
    tangent_a_copy =
        SanitizeFilletTangentPolyline(centerline, tangent_a_copy, result_closed, 0.0);
    tangent_b_copy =
        SanitizeFilletTangentPolyline(centerline, tangent_b_copy, result_closed, 0.0);
  }

  const double outset_inset_magnitude =
      std::max(1e-4, std::min(0.05, std::abs(radius) * 0.05));
  const double wedge_inset_magnitude =
      result_closed ? 0.0
                    : (side_mode == "INSET" ? std::abs(inflate)
                                            : outset_inset_magnitude);
  if (wedge_inset_magnitude > 0.0) {
    SnapshotInfo info = ReadSnapshotInfo(snapshot);
    const bool use_inside_check = side_mode == "OUTSET";
    const int default_dir_sign = side_mode == "OUTSET" ? 1 : -1;
    ApplyWedgeInset(edge_wedge, centerline, info.mesh, wedge_inset_magnitude,
                    use_inside_check, default_dir_sign);
  }

  emscripten::val segment_options = emscripten::val::object();
  segment_options.set("name", name);
  segment_options.set("centerline", ToPointArray(centerline));
  segment_options.set("tangentA", ToPointArray(tangent_a_copy));
  segment_options.set("tangentB", ToPointArray(tangent_b_copy));
  segment_options.set("edge", ToPointArray(edge_wedge));
  segment_options.set("radius", radius);
  segment_options.set("requestedRadius", requested_radius);
  segment_options.set("nudgeFaceDistance", nudge_face_distance);
  segment_options.set("resolution", resolution_raw);
  segment_options.set("closedLoop", result_closed);
  segment_options.set("edgeReference", edge_reference);
  const emscripten::val segment_result =
      BuildFilletSegmentAuthoringState(segment_options);

  emscripten::val tube_cap_points = emscripten::val::object();
  tube_cap_points.set("start", emscripten::val::array());
  tube_cap_points.set("end", emscripten::val::array());
  if (!result_closed) {
    tube_cap_points.set(
        "start",
        ToPointArray(CollectUniqueFacePoints(
            segment_result["tubeSnapshot"], name + "_TUBE_CapStart", 1e-7)));
    tube_cap_points.set(
        "end",
        ToPointArray(CollectUniqueFacePoints(
            segment_result["tubeSnapshot"], name + "_TUBE_CapEnd", 1e-7)));
  }

  emscripten::val result = emscripten::val::object();
  result.set("name", name);
  result.set("centerline", ToPointArray(centerline));
  result.set("tangentA", ToPointArray(tangent_a_copy));
  result.set("tangentB", ToPointArray(tangent_b_copy));
  result.set("edge", ToPointArray(edge_copy));
  result.set("edgeWedge", ToPointArray(edge_wedge));
  result.set("tangentASeam", ToPointArray(tangent_a_seam));
  result.set("tangentBSeam", ToPointArray(tangent_b_seam));
  result.set("tubeCapPointsBeforeNudge", tube_cap_points);
  result.set("wedgeSnapshot", segment_result["wedgeSnapshot"]);
  result.set("tubeSnapshot", segment_result["tubeSnapshot"]);
  result.set("finalSnapshot", segment_result["finalSnapshot"]);
  result.set("closedLoop", result_closed);
  result.set("nativeKernel", true);
  if (!centerline_result["radiusClamp"].isUndefined() &&
      !centerline_result["radiusClamp"].isNull()) {
    result.set("radiusClamp", centerline_result["radiusClamp"]);
  }
  return result;
}

emscripten::val BuildFilletBatchAuthoringState(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("buildFilletBatchAuthoringState requires snapshot.");
  }

  const emscripten::val edges = options["edges"];
  if (edges.isUndefined() || edges.isNull()) {
    throw std::runtime_error("buildFilletBatchAuthoringState requires edges.");
  }

  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const double inflate =
      options["inflate"].isUndefined() || options["inflate"].isNull()
          ? 0.1
          : ReadFiniteNumber(options["inflate"], "inflate");
  const double nudge_face_distance =
      options["nudgeFaceDistance"].isUndefined() ||
              options["nudgeFaceDistance"].isNull()
          ? 0.0001
          : ReadFiniteNumber(options["nudgeFaceDistance"], "nudgeFaceDistance");
  const double resolution_raw =
      options["resolution"].isUndefined() || options["resolution"].isNull()
          ? 32.0
          : ReadFiniteNumber(options["resolution"], "resolution");
  const std::string direction_mode_raw =
      ReadString(options["directionMode"], "AUTO");
  const std::string direction_mode =
      direction_mode_raw == "INSET" || direction_mode_raw == "OUTSET"
          ? direction_mode_raw
          : "AUTO";
  const std::string fallback_direction =
      direction_mode == "OUTSET" ? "OUTSET" : "INSET";
  const bool auto_direction = direction_mode == "AUTO";

  emscripten::val out = emscripten::val::object();
  emscripten::val out_entries = emscripten::val::array();
  emscripten::val direction_decision = emscripten::val::object();
  direction_decision.set("mode", direction_mode);
  direction_decision.set("autoEnabled", auto_direction);
  direction_decision.set("fallbackDirection", fallback_direction);

  const uint32_t edge_count = edges["length"].as<uint32_t>();
  int inset_edges = 0;
  int outset_edges = 0;
  int fallback_edges = 0;
  int ambiguous_edges = 0;
  uint32_t out_index = 0;

  for (uint32_t i = 0; i < edge_count; ++i) {
    const emscripten::val edge = edges[i];
    if (edge.isUndefined() || edge.isNull()) continue;

    const std::string edge_name =
        ReadString(edge["edgeReference"], ("EDGE_" + std::to_string(i)).c_str());
    const std::string face_a_name = ReadString(edge["faceAName"], "");
    const std::string face_b_name = ReadString(edge["faceBName"], "");
    const emscripten::val segment_face_pairs = edge["segmentFacePairs"];
    const bool has_segment_face_pairs =
        !(segment_face_pairs.isUndefined() || segment_face_pairs.isNull()) &&
        segment_face_pairs["length"].as<uint32_t>() > 0;
    if (!has_segment_face_pairs &&
        (face_a_name.empty() || face_b_name.empty())) {
      emscripten::val failed = emscripten::val::object();
      failed.set("index", i);
      failed.set("edgeReference", edge_name);
      failed.set("error", "missing_face_names");
      out_entries.set(out_index++, failed);
      continue;
    }

    std::string edge_direction = fallback_direction;
    std::string direction_reason = auto_direction ? "fallback" : "explicit";
    emscripten::val direction_detail = emscripten::val::null();
    if (auto_direction) {
      emscripten::val classify_options = emscripten::val::object();
      classify_options.set("snapshot", snapshot);
      classify_options.set("faceAName", face_a_name);
      classify_options.set("faceBName", face_b_name);
      classify_options.set("radius", radius);
      classify_options.set("fallbackDirection", fallback_direction);
      classify_options.set("threshold", 0.2);
      try {
        direction_detail = ClassifyFilletEdgeDirection(classify_options);
        edge_direction =
            ReadString(direction_detail["direction"], fallback_direction.c_str());
        direction_reason = ReadString(direction_detail["reason"], "fallback");
      } catch (...) {
        edge_direction = fallback_direction;
        direction_reason = "native_classifier_error";
      }
      const bool is_classified =
          direction_reason == "classified" || direction_reason == "signed_dihedral";
      if (!is_classified) {
        fallback_edges += 1;
        if (direction_reason.find("ambiguous") != std::string::npos) {
          ambiguous_edges += 1;
        }
      }
    }
    if (edge_direction == "OUTSET") {
      outset_edges += 1;
    } else {
      edge_direction = "INSET";
      inset_edges += 1;
    }

    emscripten::val build_options = emscripten::val::object();
    build_options.set("snapshot", snapshot);
    build_options.set("polyline", edge["polyline"]);
    build_options.set("radius", radius);
    build_options.set("requestedRadius", radius);
    build_options.set("sideMode", edge_direction);
    build_options.set("inflate", inflate);
    build_options.set("nudgeFaceDistance", nudge_face_distance);
    build_options.set("resolution", resolution_raw);
    build_options.set("closedLoop",
                      !(edge["closedLoop"].isUndefined() ||
                        edge["closedLoop"].isNull()) &&
                          edge["closedLoop"].as<bool>());
    build_options.set("name", ReadString(edge["name"], edge_name.c_str()));
    build_options.set("edgeReference", edge_name);
    if (!face_a_name.empty()) build_options.set("faceAName", face_a_name);
    if (!face_b_name.empty()) build_options.set("faceBName", face_b_name);
    if (has_segment_face_pairs) {
      build_options.set("segmentFacePairs", segment_face_pairs);
    }

    emscripten::val edge_result = emscripten::val::object();
    try {
      edge_result = BuildFilletEdgeAuthoringState(build_options);
    } catch (const std::exception& error) {
      edge_result.set("error", std::string(error.what()));
    } catch (...) {
      edge_result.set("error", "native_fillet_edge_error");
    }
    edge_result.set("index", i);
    edge_result.set("name", ReadString(build_options["name"], edge_name.c_str()));
    edge_result.set("edgeReference", edge_name);
    edge_result.set("faceAName", face_a_name);
    edge_result.set("faceBName", face_b_name);
    edge_result.set("edgeDirection", edge_direction);
    edge_result.set("directionReason", direction_reason);
    if (!direction_detail.isNull() && !direction_detail.isUndefined()) {
      edge_result.set("directionDetail", direction_detail);
    }
    out_entries.set(out_index++, edge_result);
  }

  direction_decision.set("totalEdges", edge_count);
  direction_decision.set("insetEdges", inset_edges);
  direction_decision.set("outsetEdges", outset_edges);
  direction_decision.set("fallbackEdges", fallback_edges);
  direction_decision.set("ambiguousEdges", ambiguous_edges);

  out.set("entries", out_entries);
  out.set("directionDecision", direction_decision);
  out.set("nativeKernel", true);
  return out;
}

emscripten::val BuildFilletAuthoringState(const emscripten::val& options) {
  const emscripten::val snapshot = options["snapshot"];
  if (snapshot.isUndefined() || snapshot.isNull()) {
    throw std::runtime_error("buildFilletAuthoringState requires snapshot.");
  }
  const emscripten::val edges = options["edges"];
  if (edges.isUndefined() || edges.isNull()) {
    throw std::runtime_error("buildFilletAuthoringState requires edges.");
  }

  const std::string feature_id = ReadString(options["featureID"], "FILLET");
  const std::string final_name = ReadString(options["name"], feature_id.c_str());
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const double cleanup_tiny_face_islands_area =
      options["cleanupTinyFaceIslandsArea"].isUndefined() ||
              options["cleanupTinyFaceIslandsArea"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["cleanupTinyFaceIslandsArea"],
                             "cleanupTinyFaceIslandsArea");
  const bool debug =
      !(options["debug"].isUndefined() || options["debug"].isNull()) &&
      options["debug"].as<bool>();
  const double resolution =
      options["resolution"].isUndefined() || options["resolution"].isNull()
          ? 32.0
          : ReadFiniteNumber(options["resolution"], "resolution");

  emscripten::val batch_options = emscripten::val::object();
  batch_options.set("snapshot", snapshot);
  batch_options.set("edges", edges);
  batch_options.set("radius", radius);
  batch_options.set("directionMode", options["directionMode"]);
  batch_options.set("inflate", options["inflate"]);
  batch_options.set("nudgeFaceDistance", options["nudgeFaceDistance"]);
  batch_options.set("resolution", options["resolution"]);
  batch_options.set("featureID", feature_id);
  const emscripten::val batch_result = BuildFilletBatchAuthoringState(batch_options);

  std::vector<BuiltFilletEntry> built_entries;
  emscripten::val debug_snapshots = emscripten::val::array();
  uint32_t debug_index = 0;
  const emscripten::val batch_entries = batch_result["entries"];
  if (!batch_entries.isUndefined() && !batch_entries.isNull()) {
    const uint32_t length = batch_entries["length"].as<uint32_t>();
    built_entries.reserve(length);
    for (uint32_t i = 0; i < length; ++i) {
      const emscripten::val entry = batch_entries[i];
      if (entry.isUndefined() || entry.isNull()) continue;
      if (!entry["error"].isUndefined() && !entry["error"].isNull()) continue;
      if (entry["finalSnapshot"].isUndefined() || entry["finalSnapshot"].isNull()) continue;
      BuiltFilletEntry built;
      built.index = i;
      built.fillet_name = ReadString(entry["name"], "");
      if (built.fillet_name.empty()) {
        built.fillet_name = ReadString(entry["edgeReference"],
                                       ("FILLET_EDGE_" + std::to_string(i)).c_str());
      }
      built.edge_reference = ReadString(entry["edgeReference"], built.fillet_name.c_str());
      built.face_a_name = ReadString(entry["faceAName"], "");
      built.face_b_name = ReadString(entry["faceBName"], "");
      built.edge_direction =
          ReadString(entry["edgeDirection"], "INSET") == "OUTSET" ? "OUTSET" : "INSET";
      built.direction_reason = ReadString(entry["directionReason"], "explicit");
      built.direction_detail = entry["directionDetail"];
      built.wedge_snapshot = entry["wedgeSnapshot"];
      built.tube_snapshot = entry["tubeSnapshot"];
      built.final_snapshot = entry["finalSnapshot"];
      built.centerline_points = ReadPoints(entry["centerline"], "centerline");
      built.edge_points = ReadPoints(entry["edge"], "edge");
      built.closed_loop =
          !(entry["closedLoop"].isUndefined() || entry["closedLoop"].isNull()) &&
          entry["closedLoop"].as<bool>();
      const emscripten::val cap_points = entry["tubeCapPointsBeforeNudge"];
      if (!cap_points.isUndefined() && !cap_points.isNull()) {
        built.tube_cap_start =
            ReadPoints(cap_points["start"], "tubeCapPointsBeforeNudge.start");
        built.tube_cap_end =
            ReadPoints(cap_points["end"], "tubeCapPointsBeforeNudge.end");
      }
      const emscripten::val edge_desc = edges[i];
      if (!edge_desc.isUndefined() && !edge_desc.isNull()) {
        built.edge_polyline = ReadPoints(edge_desc["polyline"], "polyline");
      }
      built_entries.push_back(built);

      if (debug) {
        emscripten::val wedge_debug = emscripten::val::object();
        wedge_debug.set("kind", "wedge");
        wedge_debug.set("name", built.fillet_name + "_WEDGE");
        wedge_debug.set("snapshot", built.wedge_snapshot);
        debug_snapshots.set(debug_index++, wedge_debug);

        emscripten::val tube_debug = emscripten::val::object();
        tube_debug.set("kind", "tube");
        tube_debug.set("name", built.fillet_name + "_TUBE");
        tube_debug.set("snapshot", built.tube_snapshot);
        debug_snapshots.set(debug_index++, tube_debug);

        emscripten::val final_debug = emscripten::val::object();
        final_debug.set("kind", "edgeFinal");
        final_debug.set("name", built.fillet_name + "_FINAL_FILLET");
        final_debug.set("snapshot", built.final_snapshot);
        debug_snapshots.set(debug_index++, final_debug);
      }
    }
  }

  const double radius_abs = std::abs(radius);
  const double endpoint_tol = std::max(1e-6, radius_abs * 1e-4);
  const double cap_point_tol = std::max(1e-7, endpoint_tol * 0.5);
  const double tangent_dot_threshold = 0.995;
  std::unordered_set<std::string> emitted_corner_keys;

  for (size_t i = 0; i < built_entries.size(); ++i) {
    const BuiltFilletEntry& entry_a = built_entries[i];
    if (entry_a.corner_bridge) continue;
    for (size_t j = i + 1; j < built_entries.size(); ++j) {
      const BuiltFilletEntry& entry_b = built_entries[j];
      if (entry_b.corner_bridge) continue;
      if (entry_a.edge_direction != entry_b.edge_direction) continue;

      const SharedEndpointInfo shared =
          ResolveSharedEndpointInfo(entry_a, entry_b, endpoint_tol);
      if (!shared.valid) continue;
      if (std::isfinite(shared.abs_tangent_dot) &&
          shared.abs_tangent_dot >= tangent_dot_threshold) {
        continue;
      }

      const std::string source_edge_name_a = entry_a.edge_reference.empty()
                                                 ? entry_a.fillet_name
                                                 : entry_a.edge_reference;
      const std::string source_edge_name_b = entry_b.edge_reference.empty()
                                                 ? entry_b.fillet_name
                                                 : entry_b.edge_reference;
      const std::string corner_key =
          (source_edge_name_a < source_edge_name_b
               ? source_edge_name_a + "|" + source_edge_name_b
               : source_edge_name_b + "|" + source_edge_name_a) +
          ":" + SanitizeFaceNameToken(
                    std::to_string(shared.shared_point.x) + "_" +
                        std::to_string(shared.shared_point.y) + "_" +
                        std::to_string(shared.shared_point.z),
                    "POINT");
      if (!emitted_corner_keys.emplace(corner_key).second) continue;

      const EntryEndCapData cap_a =
          ResolveEntryEndCapData(entry_a, shared.a_end_index, cap_point_tol);
      const EntryEndCapData cap_b =
          ResolveEntryEndCapData(entry_b, shared.b_end_index, cap_point_tol);
      if (cap_a.wedge_points.size() < 3 || cap_b.wedge_points.size() < 3) continue;

      const bool centerline_cross = DetectCenterlineCrossNearSharedCorner(
          entry_a, entry_b, shared, endpoint_tol,
          std::max(std::max(endpoint_tol * 2.0, cap_point_tol * 4.0),
                   std::max(1e-6, radius_abs * 1e-3)),
          0.02);
      if (centerline_cross) continue;

      const bool has_tube_point_a = cap_a.has_tube_center || cap_a.has_wedge_center;
      const bool has_tube_point_b = cap_b.has_tube_center || cap_b.has_wedge_center;
      const Vec3 tube_point_a =
          cap_a.has_tube_center ? cap_a.tube_center : cap_a.wedge_center;
      const Vec3 tube_point_b =
          cap_b.has_tube_center ? cap_b.tube_center : cap_b.wedge_center;
      if (!has_tube_point_a || !has_tube_point_b) continue;
      const double tube_distance = std::sqrt(DistanceSq(tube_point_a, tube_point_b));
      const double min_bridge_gap =
          std::max(std::max(endpoint_tol * 2.0, cap_point_tol * 4.0), 1e-6);
      if (!(tube_distance > min_bridge_gap)) continue;

      double bridge_tube_radius = radius_abs;
      const double cap_radius_a =
          EstimatePointSetRadius(cap_a.tube_points, tube_point_a, has_tube_point_a);
      const double cap_radius_b =
          EstimatePointSetRadius(cap_b.tube_points, tube_point_b, has_tube_point_b);
      if (std::isfinite(cap_radius_a) && std::isfinite(cap_radius_b)) {
        bridge_tube_radius = std::min(cap_radius_a, cap_radius_b);
      } else if (std::isfinite(cap_radius_a)) {
        bridge_tube_radius = cap_radius_a;
      } else if (std::isfinite(cap_radius_b)) {
        bridge_tube_radius = cap_radius_b;
      }
      bridge_tube_radius = std::max(1e-6, bridge_tube_radius);

      const std::string corner_name =
          BuildDeterministicBridgeName(feature_id, source_edge_name_a,
                                       source_edge_name_b, "CORNER") +
          "_" + HexString(StableStringHash32(corner_key), 8);
      const std::string wedge_bridge_name = corner_name + "_WEDGE_BRIDGE";
      const std::string tube_bridge_name = corner_name + "_TUBE_BRIDGE";
      const std::string edge_token_a =
          SanitizeFaceNameToken(source_edge_name_a,
                                "EDGE_" + std::to_string(static_cast<int>(i)));
      const std::string edge_token_b =
          SanitizeFaceNameToken(source_edge_name_b,
                                "EDGE_" + std::to_string(static_cast<int>(j)));
      const std::string edge_hash_a =
          HexString(StableStringHash32(source_edge_name_a), 8).substr(2);
      const std::string edge_hash_b =
          HexString(StableStringHash32(source_edge_name_b), 8).substr(2);
      const std::string wedge_bridge_face_name_a =
          corner_name + "_WEDGE_BRIDGE_ON_" + edge_token_a + "_" + edge_hash_a;
      const std::string wedge_bridge_face_name_b =
          corner_name + "_WEDGE_BRIDGE_ON_" + edge_token_b + "_" + edge_hash_b;

      emscripten::val corner_options = emscripten::val::object();
      corner_options.set("name", corner_name);
      corner_options.set("wedgeName", wedge_bridge_name);
      corner_options.set("tubeName", tube_bridge_name);
      corner_options.set("finalName", corner_name + "_FINAL_FILLET");
      corner_options.set("singleFaceTubeName", tube_bridge_name + "_SINGLE_FACE");
      corner_options.set("wedgeFaceNameA", wedge_bridge_face_name_a);
      corner_options.set("wedgeFaceNameB", wedge_bridge_face_name_b);
      corner_options.set("wedgePointsA", ToPointArray(cap_a.wedge_points));
      corner_options.set("wedgePointsB", ToPointArray(cap_b.wedge_points));
      if (cap_a.has_wedge_center) {
        emscripten::val p = emscripten::val::array();
        p.set(0, cap_a.wedge_center.x);
        p.set(1, cap_a.wedge_center.y);
        p.set(2, cap_a.wedge_center.z);
        corner_options.set("wedgeCenterA", p);
      }
      if (cap_b.has_wedge_center) {
        emscripten::val p = emscripten::val::array();
        p.set(0, cap_b.wedge_center.x);
        p.set(1, cap_b.wedge_center.y);
        p.set(2, cap_b.wedge_center.z);
        corner_options.set("wedgeCenterB", p);
      }
      corner_options.set("tubePointsA", ToPointArray(cap_a.tube_points));
      corner_options.set("tubePointsB", ToPointArray(cap_b.tube_points));
      {
        emscripten::val p = emscripten::val::array();
        p.set(0, tube_point_a.x);
        p.set(1, tube_point_a.y);
        p.set(2, tube_point_a.z);
        corner_options.set("tubeCenterA", p);
      }
      {
        emscripten::val p = emscripten::val::array();
        p.set(0, tube_point_b.x);
        p.set(1, tube_point_b.y);
        p.set(2, tube_point_b.z);
        corner_options.set("tubeCenterB", p);
      }
      corner_options.set("bridgeTubeRadius", bridge_tube_radius);
      corner_options.set("pointRadius",
                         std::max(std::max(1e-6, radius_abs * 1e-4),
                                  cap_point_tol * 0.2));
      corner_options.set(
          "resolution",
          std::max(6, std::min(16, static_cast<int>(std::floor(resolution / 4.0)))));
      corner_options.set("bridgeEndCapPushDistance", 0.01);
      emscripten::val adjacent_tubes = emscripten::val::array();
      adjacent_tubes.set(0, entry_a.tube_snapshot);
      adjacent_tubes.set(1, entry_b.tube_snapshot);
      corner_options.set("adjacentTubeSnapshots", adjacent_tubes);

      emscripten::val native_corner;
      try {
        native_corner = BuildFilletCornerBridgeAuthoringState(corner_options);
      } catch (...) {
        continue;
      }
      if (native_corner.isUndefined() || native_corner.isNull()) continue;

      BuiltFilletEntry corner_entry;
      corner_entry.corner_bridge = true;
      corner_entry.fillet_name = corner_name;
      corner_entry.edge_reference = corner_name;
      corner_entry.edge_direction = entry_a.edge_direction;
      corner_entry.direction_reason = "corner_bridge_non_tangent";
      corner_entry.wedge_snapshot = native_corner["wedgeSnapshot"];
      corner_entry.tube_snapshot = native_corner["tubeSnapshot"];
      corner_entry.final_snapshot = native_corner["finalSnapshot"];
      built_entries.push_back(corner_entry);

      if (debug) {
        emscripten::val wedge_debug = emscripten::val::object();
        wedge_debug.set("kind", "cornerWedge");
        wedge_debug.set("name", wedge_bridge_name);
        wedge_debug.set("snapshot", corner_entry.wedge_snapshot);
        debug_snapshots.set(debug_index++, wedge_debug);

        emscripten::val tube_debug = emscripten::val::object();
        tube_debug.set("kind", "cornerTube");
        tube_debug.set("name", tube_bridge_name + "_SINGLE_FACE");
        tube_debug.set("snapshot", corner_entry.tube_snapshot);
        debug_snapshots.set(debug_index++, tube_debug);

        emscripten::val final_debug = emscripten::val::object();
        final_debug.set("kind", "cornerFinal");
        final_debug.set("name", corner_name + "_FINAL_FILLET");
        final_debug.set("snapshot", corner_entry.final_snapshot);
        debug_snapshots.set(debug_index++, final_debug);
      }
    }
  }

  for (BuiltFilletEntry& entry : built_entries) {
    if (entry.corner_bridge || entry.final_snapshot.isUndefined() ||
        entry.final_snapshot.isNull()) {
      continue;
    }
    bool include_start_cap = false;
    bool include_end_cap = false;
    for (const BuiltFilletEntry& other : built_entries) {
      if (&other == &entry || other.corner_bridge) continue;
      const SharedEndpointInfo shared =
          ResolveSharedEndpointInfo(entry, other, endpoint_tol);
      if (!shared.valid) continue;
      if (shared.a_end_index == 0) include_start_cap = true;
      else include_end_cap = true;
    }

    const SnapshotInfo info = ReadSnapshotInfo(entry.final_snapshot);
    std::unordered_set<std::string> face_names;
    for (const auto& pair : info.id_to_face_name) {
      face_names.insert(pair.second);
    }
    std::vector<std::string> merge_face_names;
    const std::vector<std::string> side_candidates = {
        entry.fillet_name + "_SURFACE_CA", entry.fillet_name + "_SURFACE_CB",
        entry.fillet_name + "_FACE_A",     entry.fillet_name + "_FACE_B",
        entry.fillet_name + "_WEDGE_A",    entry.fillet_name + "_WEDGE_B",
        entry.fillet_name + "_SIDE_A",     entry.fillet_name + "_SIDE_B"};
    for (const std::string& candidate : side_candidates) {
      if (face_names.find(candidate) != face_names.end()) {
        merge_face_names.push_back(candidate);
      }
    }
    if (include_start_cap &&
        face_names.find(entry.fillet_name + "_END_CAP_1") != face_names.end()) {
      merge_face_names.push_back(entry.fillet_name + "_END_CAP_1");
    }
    if (include_end_cap &&
        face_names.find(entry.fillet_name + "_END_CAP_2") != face_names.end()) {
      merge_face_names.push_back(entry.fillet_name + "_END_CAP_2");
    }

    const std::string tube_outer_face_name = entry.fillet_name + "_TUBE_Outer";
    const std::string merge_target_face_name =
        face_names.find(tube_outer_face_name) != face_names.end()
            ? tube_outer_face_name
            : BuildEdgeDerivedSideWallFaceName(entry.edge_reference, feature_id);
    if (face_names.find(merge_target_face_name) != face_names.end()) {
      merge_face_names.insert(merge_face_names.begin(), merge_target_face_name);
    }
    for (const auto& pair : info.id_to_face_name) {
      if (!IsFallbackFaceName(pair.second, pair.first, true) ||
          pair.second == merge_target_face_name) {
        continue;
      }
      merge_face_names.push_back(pair.second);
    }

    if (!merge_face_names.empty()) {
      entry.merge_target_face_name = merge_target_face_name;
      entry.merge_face_names = merge_face_names;
      emscripten::val metadata = emscripten::val::object();
      metadata.set("filletMergedSideWall", true);
      metadata.set("filletSideWall", true);
      metadata.set("filletSideWallEdge", entry.edge_reference);
      metadata.set("filletSideWallIncludesStartCap", include_start_cap);
      metadata.set("filletSideWallIncludesEndCap", include_end_cap);
      entry.merge_face_metadata_json = JsonStringifyObject(metadata);
    }

  }

  emscripten::val combine_options = emscripten::val::object();
  combine_options.set("targetSnapshot", snapshot);
  combine_options.set("featureID", feature_id);
  combine_options.set("name", final_name);
  combine_options.set("cleanupTinyFaceIslandsArea",
                      cleanup_tiny_face_islands_area);
  combine_options.set("debug", debug);
  emscripten::val combine_entries = emscripten::val::array();
  uint32_t combine_index = 0;
  for (const BuiltFilletEntry& entry : built_entries) {
    if (entry.final_snapshot.isUndefined() || entry.final_snapshot.isNull()) continue;
    emscripten::val combine_entry = emscripten::val::object();
    combine_entry.set("snapshot", entry.final_snapshot);
    combine_entry.set("direction", entry.edge_direction);
    if (!entry.merge_target_face_name.empty()) {
      combine_entry.set("mergeTargetFaceName", entry.merge_target_face_name);
    }
    if (!entry.merge_face_names.empty()) {
      emscripten::val merge_face_names = emscripten::val::array();
      for (uint32_t i = 0; i < entry.merge_face_names.size(); ++i) {
        merge_face_names.set(i, entry.merge_face_names[i]);
      }
      combine_entry.set("mergeFaceNames", merge_face_names);
    }
    if (!entry.merge_face_metadata_json.empty()) {
      combine_entry.set("mergeFaceMetadataJson", entry.merge_face_metadata_json);
    }
    combine_entries.set(combine_index++, combine_entry);
  }
  combine_options.set("entries", combine_entries);
  const emscripten::val final_snapshot =
      BuildFilletCombinedAuthoringState(combine_options);

  emscripten::val result = emscripten::val::object();
  result.set("finalSnapshot", final_snapshot);
  result.set("directionDecision", batch_result["directionDecision"]);
  result.set("entryCount", static_cast<uint32_t>(built_entries.size()));
  result.set("nativeKernel", true);
  if (debug) {
    const emscripten::val combine_debug_snapshots = final_snapshot["debugSnapshots"];
    if (!combine_debug_snapshots.isUndefined() &&
        !combine_debug_snapshots.isNull()) {
      const uint32_t combine_debug_count =
          combine_debug_snapshots["length"].as<uint32_t>();
      for (uint32_t i = 0; i < combine_debug_count; ++i) {
        debug_snapshots.set(debug_index++, combine_debug_snapshots[i]);
      }
    }
    result.set("debugSnapshots", debug_snapshots);
  }
  return result;
}

emscripten::val BuildFilletCornerBridgeAuthoringState(
    const emscripten::val& options) {
  const std::string corner_name = ReadString(options["name"], "FILLET_CORNER");
  const std::string wedge_name =
      ReadString(options["wedgeName"], (corner_name + "_WEDGE_BRIDGE").c_str());
  const std::string tube_name =
      ReadString(options["tubeName"], (corner_name + "_TUBE_BRIDGE").c_str());
  const std::string final_name = ReadString(
      options["finalName"], (corner_name + "_FINAL_FILLET").c_str());
  const std::string single_face_tube_name =
      ReadString(options["singleFaceTubeName"],
                 (tube_name + "_SINGLE_FACE").c_str());
  const std::string wedge_face_name_a = ReadString(
      options["wedgeFaceNameA"], (corner_name + "_WEDGE_BRIDGE_A").c_str());
  const std::string wedge_face_name_b = ReadString(
      options["wedgeFaceNameB"], (corner_name + "_WEDGE_BRIDGE_B").c_str());

  const std::vector<Vec3> wedge_points_a =
      ReadPoints(options["wedgePointsA"], "wedgePointsA");
  const std::vector<Vec3> wedge_points_b =
      ReadPoints(options["wedgePointsB"], "wedgePointsB");
  const std::vector<Vec3> tube_points_a =
      ReadPoints(options["tubePointsA"], "tubePointsA");
  const std::vector<Vec3> tube_points_b =
      ReadPoints(options["tubePointsB"], "tubePointsB");
  const Vec3 wedge_center_a =
      ReadPointOrDefault(options["wedgeCenterA"], wedge_points_a.empty()
                                                       ? Vec3{}
                                                       : wedge_points_a.front());
  const Vec3 wedge_center_b =
      ReadPointOrDefault(options["wedgeCenterB"], wedge_points_b.empty()
                                                       ? Vec3{}
                                                       : wedge_points_b.front());
  const Vec3 tube_center_a =
      ReadPointOrDefault(options["tubeCenterA"], tube_points_a.empty()
                                                      ? Vec3{}
                                                      : tube_points_a.front());
  const Vec3 tube_center_b =
      ReadPointOrDefault(options["tubeCenterB"], tube_points_b.empty()
                                                      ? Vec3{}
                                                      : tube_points_b.front());

  const double bridge_tube_radius =
      ReadFiniteNumber(options["bridgeTubeRadius"], "bridgeTubeRadius");
  const double point_radius =
      options["pointRadius"].isUndefined() || options["pointRadius"].isNull()
          ? std::max(1e-6, bridge_tube_radius * 1e-3)
          : ReadFiniteNumber(options["pointRadius"], "pointRadius");
  const double bridge_end_cap_push_distance =
      options["bridgeEndCapPushDistance"].isUndefined() ||
              options["bridgeEndCapPushDistance"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["bridgeEndCapPushDistance"],
                             "bridgeEndCapPushDistance");
  const int resolution =
      options["resolution"].isUndefined() || options["resolution"].isNull()
          ? 16
          : std::max(6, static_cast<int>(
                              std::floor(ReadFiniteNumber(options["resolution"],
                                                          "resolution"))));

  std::vector<Vec3> wedge_hull_points = wedge_points_a;
  wedge_hull_points.insert(wedge_hull_points.end(), wedge_points_b.begin(),
                           wedge_points_b.end());
  manifold::Manifold wedge_manifold =
      BuildPointHull(wedge_hull_points, std::max(1e-6, point_radius), resolution);

  uint32_t adjacent_edge_tube_subtractions_applied = 0;
  const emscripten::val adjacent_tubes = options["adjacentTubeSnapshots"];
  if (!adjacent_tubes.isUndefined() && !adjacent_tubes.isNull()) {
    const uint32_t adjacent_count = adjacent_tubes["length"].as<uint32_t>();
    for (uint32_t i = 0; i < adjacent_count; ++i) {
      const emscripten::val adjacent_snapshot = adjacent_tubes[i];
      if (adjacent_snapshot.isUndefined() || adjacent_snapshot.isNull()) continue;
      try {
        const manifold::Manifold adjacent_manifold(SnapshotToMesh(adjacent_snapshot));
        wedge_manifold -= adjacent_manifold;
        adjacent_edge_tube_subtractions_applied += 1;
      } catch (...) {
      }
    }
  }

  emscripten::val wedge_snapshot =
      BuildSingleFaceSnapshot(wedge_manifold, wedge_name, wedge_name);

  std::vector<Vec3> tube_hull_points = tube_points_a;
  tube_hull_points.insert(tube_hull_points.end(), tube_points_b.begin(),
                          tube_points_b.end());
  std::vector<Vec3> unique_tube_hull_points = DeduplicatePoints(
      tube_hull_points, std::max(1e-16, point_radius * point_radius * 1e-4));

  emscripten::val tube_snapshot;
  std::string tube_bridge_mode = "none";
  if (unique_tube_hull_points.size() >= 4) {
    manifold::Manifold tube_manifold = BuildPointHull(
        unique_tube_hull_points, std::max(1e-6, bridge_tube_radius * 1e-3),
        resolution);
    tube_snapshot = BuildSingleFaceSnapshot(tube_manifold, single_face_tube_name,
                                            single_face_tube_name);
    tube_bridge_mode = "tube_cap_hull";
  } else {
    const double fallback_gap_sq = DistanceSq(tube_center_a, tube_center_b);
    if (!(fallback_gap_sq > 1e-16)) {
      throw std::runtime_error(
          "Corner bridge requires either cap hull points or distinct tube centers.");
    }
    emscripten::val tube_options = emscripten::val::object();
    emscripten::val points = emscripten::val::array();
    emscripten::val point_a = emscripten::val::array();
    point_a.set(0, tube_center_a.x);
    point_a.set(1, tube_center_a.y);
    point_a.set(2, tube_center_a.z);
    emscripten::val point_b = emscripten::val::array();
    point_b.set(0, tube_center_b.x);
    point_b.set(1, tube_center_b.y);
    point_b.set(2, tube_center_b.z);
    points.set(0, point_a);
    points.set(1, point_b);
    tube_options.set("points", points);
    tube_options.set("radius", bridge_tube_radius);
    tube_options.set("innerRadius", 0.0);
    tube_options.set("resolution", std::max(8, resolution));
    tube_options.set("closed", false);
    tube_options.set("preferFast", true);
    tube_options.set("selfUnion", true);
    tube_options.set("name", tube_name);
    tube_snapshot = BuildTubeAuthoringState(tube_options);
    BrepSolidCore core;
    core.SetAuthoringState(tube_snapshot);
    try {
      core.PushFace(tube_name + "_CapStart", bridge_end_cap_push_distance);
    } catch (...) {
    }
    try {
      core.PushFace(tube_name + "_CapEnd", bridge_end_cap_push_distance);
    } catch (...) {
    }
    tube_snapshot = core.GetAuthoringState();
    manifold::MeshGL tube_mesh = SnapshotToMesh(tube_snapshot);
    std::unordered_map<uint32_t, std::string> tube_id_to_face_name =
        BuildResolvedIdToFaceName(tube_snapshot);
    std::unordered_map<std::string, uint32_t> tube_face_name_to_id =
        ReadFaceNameToId(tube_snapshot["faceNameToID"]);
    std::unordered_map<std::string, std::string> tube_metadata =
        ReadStringMapEntries(tube_snapshot["faceMetadataJson"]);
    CollapseMeshToSingleFace(tube_mesh, single_face_tube_name, tube_id_to_face_name,
                             tube_face_name_to_id, tube_metadata);
    tube_snapshot = BuildSnapshotFromMesh(
        tube_mesh, tube_id_to_face_name, tube_face_name_to_id, tube_metadata,
        {}, {}, single_face_tube_name);
    tube_bridge_mode = "tube_centerline_fallback";
  }

  const SnapshotInfo wedge_info =
      ReadBooleanReadySnapshotInfo(wedge_snapshot, wedge_name);
  const SnapshotInfo tube_info =
      ReadBooleanReadySnapshotInfo(tube_snapshot, single_face_tube_name);
  manifold::MeshGL final_mesh =
      (manifold::Manifold(wedge_info.mesh) -
       manifold::Manifold(tube_info.mesh))
          .GetMeshGL();
  std::unordered_map<uint32_t, std::string> final_id_to_face_name =
      wedge_info.id_to_face_name;
  std::unordered_map<std::string, uint32_t> final_face_name_to_id =
      wedge_info.face_name_to_id;
  std::unordered_map<std::string, std::string> final_metadata =
      wedge_info.face_metadata_json;

  const std::vector<std::string> bridge_transition_face_names =
      RelabelDisconnectedFaceComponents(
          final_mesh, wedge_name, {wedge_face_name_a, wedge_face_name_b},
          {wedge_center_a, wedge_center_b}, final_id_to_face_name,
          final_face_name_to_id, final_metadata);
  emscripten::val final_snapshot =
      BuildSnapshotFromMesh(final_mesh, final_id_to_face_name,
                            final_face_name_to_id, final_metadata, {}, {},
                            final_name);

  emscripten::val result = emscripten::val::object();
  result.set("wedgeSnapshot", wedge_snapshot);
  result.set("tubeSnapshot", tube_snapshot);
  result.set("finalSnapshot", final_snapshot);
  result.set("tubeBridgeMode", tube_bridge_mode);
  result.set("adjacentEdgeTubeSubtractionsApplied",
             adjacent_edge_tube_subtractions_applied);
  emscripten::val transition_names = emscripten::val::array();
  for (uint32_t i = 0; i < bridge_transition_face_names.size(); ++i) {
    transition_names.set(i, bridge_transition_face_names[i]);
  }
  result.set("bridgeTransitionFaceNames", transition_names);
  return result;
}

emscripten::val BuildFilletCombinedAuthoringState(const emscripten::val& options) {
  const emscripten::val target_snapshot = options["targetSnapshot"];
  if (target_snapshot.isUndefined() || target_snapshot.isNull()) {
    throw std::runtime_error("buildFilletCombinedAuthoringState requires targetSnapshot.");
  }

  const std::string feature_id = ReadString(options["featureID"], "FILLET");
  const std::string name =
      ReadString(options["name"], (feature_id + "_FINAL_FILLET").c_str());
  const double cleanup_tiny_face_islands_area =
      options["cleanupTinyFaceIslandsArea"].isUndefined() ||
              options["cleanupTinyFaceIslandsArea"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["cleanupTinyFaceIslandsArea"],
                             "cleanupTinyFaceIslandsArea");
  const bool debug =
      !(options["debug"].isUndefined() || options["debug"].isNull()) &&
      options["debug"].as<bool>();

  SnapshotInfo target_info = ReadBooleanReadySnapshotInfo(target_snapshot, name);
  manifold::Manifold result_manifold(target_info.mesh);
  std::unordered_map<uint32_t, std::string> merged_id_to_face_name =
      target_info.id_to_face_name;
  std::unordered_map<std::string, std::string> merged_metadata =
      target_info.face_metadata_json;
  std::vector<AuxEdgeRecord> merged_aux_edges = target_info.aux_edges;
  emscripten::val debug_snapshots = emscripten::val::array();
  uint32_t debug_index = 0;
  auto append_debug_snapshot = [&](const std::string& kind,
                                   const std::string& snapshot_name,
                                   const emscripten::val& snapshot) {
    if (!debug) return;
    emscripten::val entry = emscripten::val::object();
    entry.set("kind", kind);
    entry.set("name", snapshot_name);
    entry.set("snapshot", snapshot);
    debug_snapshots.set(debug_index++, entry);
  };
  auto append_debug_mesh_snapshot =
      [&](const std::string& kind, const std::string& snapshot_name,
          const manifold::MeshGL& mesh,
          const std::unordered_map<uint32_t, std::string>& id_to_face_name,
          const std::unordered_map<std::string, uint32_t>& face_name_to_id,
          const std::unordered_map<std::string, std::string>& metadata) {
        if (!debug) return;
        append_debug_snapshot(kind, snapshot_name,
                              BuildSnapshotFromMesh(mesh, id_to_face_name,
                                                    face_name_to_id, metadata, {},
                                                    merged_aux_edges,
                                                    snapshot_name));
      };

  append_debug_snapshot("combineTargetStart", feature_id + "_COMBINE_TARGET_START",
                        target_snapshot);

  struct GroupState {
    std::unique_ptr<manifold::Manifold> manifold;
    std::unordered_map<uint32_t, std::string> id_to_face_name;
    std::unordered_map<std::string, std::string> metadata;
  };

  GroupState inset_group;
  GroupState outset_group;
  const emscripten::val entries = options["entries"];
  if (!entries.isUndefined() && !entries.isNull()) {
    const uint32_t length = entries["length"].as<uint32_t>();
    for (uint32_t i = 0; i < length; ++i) {
      const emscripten::val entry = entries[i];
      if (entry.isUndefined() || entry.isNull()) continue;
      const emscripten::val snapshot = entry["snapshot"];
      if (snapshot.isUndefined() || snapshot.isNull()) continue;
      emscripten::val entry_snapshot = snapshot;
      const std::string merge_target_face_name =
          ReadString(entry["mergeTargetFaceName"], "");
      const emscripten::val merge_face_names = entry["mergeFaceNames"];
      const std::string merge_face_metadata_json =
          ReadString(entry["mergeFaceMetadataJson"], "");
      const bool has_merge_target = !merge_target_face_name.empty();
      const bool has_merge_face_names =
          !(merge_face_names.isUndefined() || merge_face_names.isNull()) &&
          merge_face_names["length"].as<uint32_t>() > 0;
      const bool has_merge_metadata = !merge_face_metadata_json.empty();
      if (has_merge_target && (has_merge_face_names || has_merge_metadata)) {
        BrepSolidCore core;
        core.SetAuthoringState(snapshot);
        if (has_merge_face_names) {
          const uint32_t merge_count = merge_face_names["length"].as<uint32_t>();
          for (uint32_t merge_idx = 0; merge_idx < merge_count; ++merge_idx) {
            const emscripten::val merge_name_val = merge_face_names[merge_idx];
            if (merge_name_val.isUndefined() || merge_name_val.isNull()) continue;
            const std::string merge_name = merge_name_val.as<std::string>();
            if (merge_name.empty() || merge_name == merge_target_face_name) continue;
            core.RenameFace(merge_name, merge_target_face_name);
          }
        }
        if (has_merge_metadata) {
          core.SetFaceMetadataJson(merge_target_face_name,
                                   merge_face_metadata_json);
        }
        entry_snapshot = core.GetAuthoringState();
        append_debug_snapshot(
            "combineEntryPostRename",
            feature_id + "_COMBINE_ENTRY_" + std::to_string(i) + "_" +
                SanitizeFaceNameToken(merge_target_face_name, "TARGET") +
                "_POST_RENAME",
            entry_snapshot);
      }

      SnapshotInfo info =
          ReadBooleanReadySnapshotInfo(entry_snapshot, merge_target_face_name);
      manifold::Manifold entry_manifold(info.mesh);
      const std::string direction = ReadString(entry["direction"], "INSET");
      GroupState& group =
          (direction == "OUTSET") ? outset_group : inset_group;
      if (!group.manifold) {
        group.manifold = std::make_unique<manifold::Manifold>(entry_manifold);
        group.id_to_face_name = info.id_to_face_name;
        group.metadata = info.face_metadata_json;
        MergeAuxEdges(merged_aux_edges, info.aux_edges);
      } else {
        group.manifold = std::make_unique<manifold::Manifold>(
            (*group.manifold) + entry_manifold);
        group.id_to_face_name =
            CombineIdMaps(group.id_to_face_name, info.id_to_face_name);
        MergeMetadataMaps(group.metadata, info.face_metadata_json);
        MergeAuxEdges(merged_aux_edges, info.aux_edges);
      }
    }
  }

  if (inset_group.manifold) {
    result_manifold = result_manifold - (*inset_group.manifold);
    merged_id_to_face_name =
        CombineIdMaps(merged_id_to_face_name, inset_group.id_to_face_name);
    MergeMetadataMaps(merged_metadata, inset_group.metadata);
  }
  if (outset_group.manifold) {
    result_manifold = result_manifold + (*outset_group.manifold);
    merged_id_to_face_name =
        CombineIdMaps(merged_id_to_face_name, outset_group.id_to_face_name);
    MergeMetadataMaps(merged_metadata, outset_group.metadata);
  }

  manifold::MeshGL final_mesh = result_manifold.GetMeshGL();
  std::unordered_map<std::string, uint32_t> merged_face_name_to_id;
  for (const auto& entry : merged_id_to_face_name) {
    merged_face_name_to_id[entry.second] = entry.first;
  }

  append_debug_mesh_snapshot("combinePreRelabel",
                             feature_id + "_COMBINE_PRE_RELABEL", final_mesh,
                             merged_id_to_face_name, merged_face_name_to_id,
                             merged_metadata);
  RelabelFallbackFacesByAdjacency(final_mesh, merged_id_to_face_name,
                                  merged_face_name_to_id, merged_metadata,
                                  feature_id);
  append_debug_mesh_snapshot("combinePostRelabel",
                             feature_id + "_COMBINE_POST_RELABEL", final_mesh,
                             merged_id_to_face_name, merged_face_name_to_id,
                             merged_metadata);
  CleanupTinyFaceIslands(final_mesh, merged_id_to_face_name,
                         merged_face_name_to_id, merged_metadata,
                         cleanup_tiny_face_islands_area);
  append_debug_mesh_snapshot("combinePostCleanup",
                             feature_id + "_COMBINE_POST_CLEANUP", final_mesh,
                             merged_id_to_face_name, merged_face_name_to_id,
                             merged_metadata);

  emscripten::val final_snapshot = BuildSnapshotFromMesh(
      final_mesh, merged_id_to_face_name, merged_face_name_to_id,
      merged_metadata, {}, merged_aux_edges, name);
  if (debug) {
    final_snapshot.set("debugSnapshots", debug_snapshots);
  }
  return final_snapshot;
}

emscripten::val BuildBooleanCombinedAuthoringState(const emscripten::val& options) {
  const emscripten::val left_snapshot = options["leftSnapshot"];
  const emscripten::val right_snapshot = options["rightSnapshot"];
  if (left_snapshot.isUndefined() || left_snapshot.isNull()) {
    throw std::runtime_error("buildBooleanCombinedAuthoringState requires leftSnapshot.");
  }
  if (right_snapshot.isUndefined() || right_snapshot.isNull()) {
    throw std::runtime_error("buildBooleanCombinedAuthoringState requires rightSnapshot.");
  }

  const std::string operation =
      ReadString(options["operation"], "UNION");
  const std::string feature_id = ReadString(options["featureID"], operation.c_str());
  const std::string name = ReadString(options["name"], "");
  const double cleanup_tiny_face_islands_area =
      options["cleanupTinyFaceIslandsArea"].isUndefined() ||
              options["cleanupTinyFaceIslandsArea"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["cleanupTinyFaceIslandsArea"],
                             "cleanupTinyFaceIslandsArea");
  const double disconnected_island_min_volume =
      options["disconnectedIslandMinVolume"].isUndefined() ||
              options["disconnectedIslandMinVolume"].isNull()
          ? 0.01
          : ReadFiniteNumber(options["disconnectedIslandMinVolume"],
                             "disconnectedIslandMinVolume");

  const SnapshotInfo left_info =
      ReadBooleanReadySnapshotInfo(left_snapshot, name.empty() ? "BOOLEAN_LEFT" : name);
  const SnapshotInfo right_info =
      ReadBooleanReadySnapshotInfo(right_snapshot, name.empty() ? "BOOLEAN_RIGHT" : name);

  manifold::Manifold left_manifold(left_info.mesh);
  manifold::Manifold right_manifold(right_info.mesh);
  manifold::Manifold result_manifold;
  if (operation == "SUBTRACT" || operation == "DIFFERENCE") {
    result_manifold = left_manifold - right_manifold;
  } else if (operation == "INTERSECT" || operation == "INTERSECTION") {
    result_manifold = left_manifold ^ right_manifold;
  } else {
    result_manifold = left_manifold + right_manifold;
  }

  manifold::MeshGL final_mesh = result_manifold.GetMeshGL();
  std::unordered_map<uint32_t, std::string> merged_id_to_face_name =
      CombineIdMaps(left_info.id_to_face_name, right_info.id_to_face_name);
  std::unordered_map<std::string, uint32_t> merged_face_name_to_id =
      left_info.face_name_to_id;
  for (const auto& entry : right_info.face_name_to_id) {
    merged_face_name_to_id[entry.first] = entry.second;
  }
  std::unordered_map<std::string, std::string> merged_face_metadata =
      left_info.face_metadata_json;
  MergeMetadataMaps(merged_face_metadata, right_info.face_metadata_json);
  std::unordered_map<std::string, std::string> merged_edge_metadata =
      left_info.edge_metadata_json;
  MergeMetadataMaps(merged_edge_metadata, right_info.edge_metadata_json);
  std::vector<AuxEdgeRecord> merged_aux_edges = left_info.aux_edges;
  MergeAuxEdges(merged_aux_edges, right_info.aux_edges);

  RelabelFallbackFacesByAdjacency(final_mesh, merged_id_to_face_name,
                                  merged_face_name_to_id, merged_face_metadata,
                                  feature_id);
  CleanupTinyFaceIslands(final_mesh, merged_id_to_face_name,
                         merged_face_name_to_id, merged_face_metadata,
                         cleanup_tiny_face_islands_area);

  const std::string final_name = name.empty() ? feature_id : name;
  emscripten::val snapshot = BuildSnapshotFromMesh(
      final_mesh, merged_id_to_face_name, merged_face_name_to_id,
      merged_face_metadata, merged_edge_metadata, merged_aux_edges, final_name);

  BrepSolidCore core;
  core.SetAuthoringState(snapshot);
  if (disconnected_island_min_volume > 0.0) {
    core.RemoveDisconnectedIslandsByVolume(disconnected_island_min_volume);
  }
  return core.GetAuthoringState();
}

emscripten::val BuildSolidAuthoringStateFromMesh(const emscripten::val& options) {
  emscripten::val canonical = emscripten::val::object();
  canonical.set("numProp", options["numProp"]);
  canonical.set("vertProperties", options["vertProperties"]);
  canonical.set("triVerts", options["triVerts"]);
  if (!options["triIDs"].isUndefined() && !options["triIDs"].isNull()) {
    canonical.set("triIDs", options["triIDs"]);
  } else {
    canonical.set("triIDs", options["faceID"]);
  }
  canonical.set("faceNameToID", options["faceNameToID"]);
  canonical.set("idToFaceName", options["idToFaceName"]);
  canonical.set("faceMetadataJson", options["faceMetadataJson"]);
  canonical.set("edgeMetadataJson", options["edgeMetadataJson"]);
  canonical.set("auxEdges", options["auxEdges"]);
  if (!options["name"].isUndefined() && !options["name"].isNull()) {
    canonical.set("name", options["name"]);
  }

  SnapshotInfo info = ReadSnapshotInfo(canonical);
  manifold::Manifold manifold_solid(info.mesh);
  manifold::MeshGL rebuilt_mesh = manifold_solid.GetMeshGL();
  return BuildSnapshotFromMesh(rebuilt_mesh, info.id_to_face_name,
                               info.face_name_to_id, info.face_metadata_json,
                               info.edge_metadata_json, info.aux_edges,
                               ReadString(options["name"], ""));
}

}  // namespace manifoldplus
