#include "brep_solid_core.h"
#include "fillet_segment_builder.h"

#include <emscripten/bind.h>
#include <manifold/manifold.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

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

double TriangleAreaFromVerts(const std::vector<float>& vert_properties,
                             uint32_t num_prop, uint32_t i0, uint32_t i1,
                             uint32_t i2) {
  const uint32_t a = i0 * num_prop;
  const uint32_t b = i1 * num_prop;
  const uint32_t c = i2 * num_prop;
  const double ax = vert_properties[a + 0];
  const double ay = vert_properties[a + 1];
  const double az = vert_properties[a + 2];
  const double bx = vert_properties[b + 0];
  const double by = vert_properties[b + 1];
  const double bz = vert_properties[b + 2];
  const double cx = vert_properties[c + 0];
  const double cy = vert_properties[c + 1];
  const double cz = vert_properties[c + 2];
  const double ux = bx - ax;
  const double uy = by - ay;
  const double uz = bz - az;
  const double vx = cx - ax;
  const double vy = cy - ay;
  const double vz = cz - az;
  const double nx = uy * vz - uz * vy;
  const double ny = uz * vx - ux * vz;
  const double nz = ux * vy - uy * vx;
  return 0.5 * std::hypot(nx, ny, nz);
}

double SignedVolume6FromVerts(const std::vector<float>& vert_properties,
                              uint32_t num_prop, uint32_t i0, uint32_t i1,
                              uint32_t i2) {
  const uint32_t a = i0 * num_prop;
  const uint32_t b = i1 * num_prop;
  const uint32_t c = i2 * num_prop;
  const double x0 = vert_properties[a + 0];
  const double y0 = vert_properties[a + 1];
  const double z0 = vert_properties[a + 2];
  const double x1 = vert_properties[b + 0];
  const double y1 = vert_properties[b + 1];
  const double z1 = vert_properties[b + 2];
  const double x2 = vert_properties[c + 0];
  const double y2 = vert_properties[c + 1];
  const double z2 = vert_properties[c + 2];
  return x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) +
         z0 * (x1 * y2 - y1 * x2);
}

double RayTriangleHit(const std::array<double, 3>& origin,
                      const std::array<double, 3>& dir,
                      const std::array<std::array<double, 3>, 3>& tri) {
  constexpr double kEps = 1e-12;
  const double ax = tri[0][0], ay = tri[0][1], az = tri[0][2];
  const double bx = tri[1][0], by = tri[1][1], bz = tri[1][2];
  const double cx = tri[2][0], cy = tri[2][1], cz = tri[2][2];
  const double e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const double e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const double px = dir[1] * e2z - dir[2] * e2y;
  const double py = dir[2] * e2x - dir[0] * e2z;
  const double pz = dir[0] * e2y - dir[1] * e2x;
  const double det = e1x * px + e1y * py + e1z * pz;
  if (std::abs(det) < kEps) return -1.0;
  const double inv_det = 1.0 / det;
  const double tvecx = origin[0] - ax;
  const double tvecy = origin[1] - ay;
  const double tvecz = origin[2] - az;
  const double u = (tvecx * px + tvecy * py + tvecz * pz) * inv_det;
  if (u < 0.0 || u > 1.0) return -1.0;
  const double qx = tvecy * e1z - tvecz * e1y;
  const double qy = tvecz * e1x - tvecx * e1z;
  const double qz = tvecx * e1y - tvecy * e1x;
  const double v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv_det;
  if (v < 0.0 || (u + v) > 1.0) return -1.0;
  const double t_hit = (e2x * qx + e2y * qy + e2z * qz) * inv_det;
  return t_hit > kEps ? t_hit : -1.0;
}

void CompactMeshByTriangleMask(uint32_t num_prop, std::vector<float>& vert_props,
                               std::vector<uint32_t>& tri_verts,
                               std::vector<uint32_t>& tri_ids,
                               const std::vector<uint8_t>& keep_tri) {
  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_verts.size() / 3),
               static_cast<uint32_t>(tri_ids.size()));
  const uint32_t nv =
      static_cast<uint32_t>(vert_props.size() / std::max<uint32_t>(3, num_prop));
  if (tri_count == 0 || nv == 0) return;

  std::vector<uint8_t> used_vert(nv, 0);
  std::vector<uint32_t> new_tri_verts;
  std::vector<uint32_t> new_tri_ids;
  new_tri_verts.reserve(tri_verts.size());
  new_tri_ids.reserve(tri_ids.size());

  for (uint32_t t = 0; t < tri_count; ++t) {
    if (t >= keep_tri.size() || !keep_tri[t]) continue;
    const uint32_t base = t * 3;
    const uint32_t a = tri_verts[base + 0];
    const uint32_t b = tri_verts[base + 1];
    const uint32_t c = tri_verts[base + 2];
    if (a >= nv || b >= nv || c >= nv) continue;
    new_tri_verts.push_back(a);
    new_tri_verts.push_back(b);
    new_tri_verts.push_back(c);
    new_tri_ids.push_back(tri_ids[t]);
    used_vert[a] = 1;
    used_vert[b] = 1;
    used_vert[c] = 1;
  }

  std::vector<int32_t> old_to_new(nv, -1);
  std::vector<float> new_vert_properties;
  new_vert_properties.reserve(vert_props.size());
  uint32_t write = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!used_vert[i]) continue;
    old_to_new[i] = static_cast<int32_t>(write++);
    const uint32_t base = i * num_prop;
    for (uint32_t prop = 0; prop < num_prop; ++prop) {
      new_vert_properties.push_back(vert_props[base + prop]);
    }
  }

  for (uint32_t& index : new_tri_verts) {
    index = static_cast<uint32_t>(old_to_new[index]);
  }

  vert_props.swap(new_vert_properties);
  tri_verts.swap(new_tri_verts);
  tri_ids.swap(new_tri_ids);
}

std::string MakeQuantizedPointKey(double x, double y, double z,
                                  double scale = 1e6) {
  const long long qx = static_cast<long long>(std::llround(x * scale));
  const long long qy = static_cast<long long>(std::llround(y * scale));
  const long long qz = static_cast<long long>(std::llround(z * scale));
  return std::to_string(qx) + "," + std::to_string(qy) + "," +
         std::to_string(qz);
}

std::string MakeGeometricEdgeKey(const std::string& a, const std::string& b) {
  return (a < b) ? (a + "|" + b) : (b + "|" + a);
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
    const emscripten::val name = entry["name"];
    record.name =
        (name.isUndefined() || name.isNull()) ? "EDGE" : name.as<std::string>();
    if (record.name.empty()) record.name = "EDGE";
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
    if (!entry["materialKey"].isUndefined() && !entry["materialKey"].isNull()) {
      record.material_key = entry["materialKey"].as<std::string>();
    }
    if (!entry["faceA"].isUndefined() && !entry["faceA"].isNull()) {
      record.face_a = entry["faceA"].as<std::string>();
    }
    if (!entry["faceB"].isUndefined() && !entry["faceB"].isNull()) {
      record.face_b = entry["faceB"].as<std::string>();
    }

    const emscripten::val points = entry["points"];
    if (points.isUndefined() || points.isNull()) continue;
    const uint32_t point_count = points["length"].as<uint32_t>();
    for (uint32_t p = 0; p < point_count; ++p) {
      const emscripten::val point = points[p];
      if (point.isUndefined() || point.isNull()) continue;
      const double x = ReadNumericProperty(point, "x", 0);
      const double y = ReadNumericProperty(point, "y", 1);
      const double z = ReadNumericProperty(point, "z", 2);
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

std::array<double, 16> ReadTransformMatrix(const emscripten::val& matrix_values,
                                           const char* method_name) {
  const uint32_t length = matrix_values["length"].as<uint32_t>();
  if (length < 16) {
    throw std::runtime_error(std::string(method_name) +
                             " requires a 4x4 matrix array with 16 numeric elements.");
  }

  std::array<double, 16> values{};
  for (uint32_t i = 0; i < 16; ++i) {
    const double value = matrix_values[i].as<double>();
    if (!std::isfinite(value)) {
      throw std::runtime_error(std::string(method_name) +
                               " matrix elements must be finite numbers.");
    }
    values[i] = value;
  }
  return values;
}

bool TryReadVector3Property(const emscripten::val& object, const char* name,
                            std::array<double, 3>& out) {
  const emscripten::val value = object[name];
  if (value.isUndefined() || value.isNull()) return false;
  const emscripten::val length_val = value["length"];
  if (length_val.isUndefined() || length_val.isNull()) return false;
  if (length_val.as<uint32_t>() < 3) return false;

  for (uint32_t i = 0; i < 3; ++i) {
    const double numeric = value[i].as<double>();
    if (!std::isfinite(numeric)) return false;
    out[i] = numeric;
  }
  return true;
}

void WriteVector3Property(emscripten::val& object, const char* name,
                          const std::array<double, 3>& value) {
  emscripten::val array = emscripten::val::array();
  array.set(0, value[0]);
  array.set(1, value[1]);
  array.set(2, value[2]);
  object.set(name, array);
}

void TransformFaceMetadataJson(
    std::unordered_map<std::string, std::string>& face_metadata_json,
    const std::array<double, 16>& matrix_values) {
  if (face_metadata_json.empty()) return;

  const emscripten::val json = emscripten::val::global("JSON");
  for (auto& entry : face_metadata_json) {
    if (entry.second.empty()) continue;

    try {
      emscripten::val metadata = json.call<emscripten::val>(
          "parse", emscripten::val(entry.second));
      if (metadata.isUndefined() || metadata.isNull()) continue;
      const std::string type = metadata.typeOf().as<std::string>();
      if (type != "object") continue;

      bool changed = false;
      std::array<double, 3> center{};
      if (TryReadVector3Property(metadata, "center", center)) {
        const double x = center[0];
        const double y = center[1];
        const double z = center[2];
        center[0] = matrix_values[0] * x + matrix_values[4] * y +
                    matrix_values[8] * z + matrix_values[12];
        center[1] = matrix_values[1] * x + matrix_values[5] * y +
                    matrix_values[9] * z + matrix_values[13];
        center[2] = matrix_values[2] * x + matrix_values[6] * y +
                    matrix_values[10] * z + matrix_values[14];
        WriteVector3Property(metadata, "center", center);
        changed = true;
      }

      std::array<double, 3> axis{};
      if (TryReadVector3Property(metadata, "axis", axis)) {
        const double x = axis[0];
        const double y = axis[1];
        const double z = axis[2];
        axis[0] = matrix_values[0] * x + matrix_values[4] * y +
                  matrix_values[8] * z;
        axis[1] = matrix_values[1] * x + matrix_values[5] * y +
                  matrix_values[9] * z;
        axis[2] = matrix_values[2] * x + matrix_values[6] * y +
                  matrix_values[10] * z;
        const double axis_len =
            std::hypot(axis[0], axis[1], axis[2]);
        if (axis_len > 0.0) {
          axis[0] /= axis_len;
          axis[1] /= axis_len;
          axis[2] /= axis_len;
        }
        WriteVector3Property(metadata, "axis", axis);
        changed = true;
      }

      if (changed) {
        entry.second =
            json.call<std::string>("stringify", metadata);
      }
    } catch (...) {
      // Leave malformed metadata untouched.
    }
  }
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
  aux_edges_.clear();
}

void BrepSolidCore::SetAuthoringState(const emscripten::val& snapshot) {
  Clear();

  const emscripten::val num_prop_val = snapshot["numProp"];
  if (!num_prop_val.isUndefined() && !num_prop_val.isNull()) {
    const double num_prop = num_prop_val.as<double>();
    if (!std::isfinite(num_prop) || num_prop < 3.0) {
      throw std::runtime_error("Authoring state numProp must be finite and >= 3.");
    }
    num_prop_ = static_cast<uint32_t>(num_prop);
  }

  vert_properties_ = ReadFloatArray(snapshot["vertProperties"], "vertProperties");
  tri_verts_ = ReadUint32Array(snapshot["triVerts"], "triVerts");
  tri_ids_ = ReadUint32Array(snapshot["triIDs"], "triIDs");
  face_name_to_id_ =
      ReadStringUint32Map(snapshot["faceNameToID"], "faceNameToID");
  id_to_face_name_ =
      ReadUint32StringMap(snapshot["idToFaceName"], "idToFaceName");
  face_metadata_json_ =
      ReadStringMap(snapshot["faceMetadataJson"], "faceMetadataJson");
  edge_metadata_json_ =
      ReadStringMap(snapshot["edgeMetadataJson"], "edgeMetadataJson");
  aux_edges_ = ReadAuxEdges(snapshot["auxEdges"]);

  if (num_prop_ == 0 || (vert_properties_.size() % num_prop_) != 0) {
    throw std::runtime_error(
        "Authoring state vertProperties length must be a multiple of numProp.");
  }
  if ((tri_verts_.size() % 3) != 0) {
    throw std::runtime_error(
        "Authoring state triVerts length must be a multiple of 3.");
  }
  if (tri_ids_.size() != (tri_verts_.size() / 3)) {
    throw std::runtime_error(
        "Authoring state triIDs length must match the triangle count.");
  }

  if (id_to_face_name_.empty() && !face_name_to_id_.empty()) {
    for (const auto& entry : face_name_to_id_) {
      id_to_face_name_[entry.second] = entry.first;
    }
  } else if (face_name_to_id_.empty() && !id_to_face_name_.empty()) {
    for (const auto& entry : id_to_face_name_) {
      face_name_to_id_[entry.second] = entry.first;
    }
  }

  RebuildVertexKeyIndex();
}

void BrepSolidCore::NormalizeFaceTracking() {
  if (tri_ids_.empty()) {
    face_name_to_id_.clear();
    id_to_face_name_.clear();
    face_metadata_json_.clear();
    return;
  }

  std::vector<uint32_t> tri_ids_sorted(tri_ids_.begin(), tri_ids_.end());
  std::sort(tri_ids_sorted.begin(), tri_ids_sorted.end());
  tri_ids_sorted.erase(
      std::unique(tri_ids_sorted.begin(), tri_ids_sorted.end()),
      tri_ids_sorted.end());

  std::unordered_map<uint32_t, std::string> resolved = id_to_face_name_;
  if (resolved.empty() && !face_name_to_id_.empty()) {
    for (const auto& entry : face_name_to_id_) {
      resolved.emplace(entry.second, entry.first);
    }
  }

  bool covers_all = true;
  for (const uint32_t id : tri_ids_sorted) {
    if (!resolved.count(id)) {
      covers_all = false;
      break;
    }
  }
  if (!covers_all) {
    if (resolved.size() == tri_ids_sorted.size()) {
      std::vector<std::pair<uint32_t, std::string>> ordered(resolved.begin(),
                                                            resolved.end());
      std::sort(ordered.begin(), ordered.end(),
                [](const auto& a, const auto& b) { return a.first < b.first; });
      resolved.clear();
      for (size_t i = 0; i < tri_ids_sorted.size(); ++i) {
        const std::string face_name =
            ordered[i].second.empty()
                ? ("FACE_" + std::to_string(tri_ids_sorted[i]))
                : ordered[i].second;
        resolved.emplace(tri_ids_sorted[i], face_name);
      }
    } else {
      for (const uint32_t id : tri_ids_sorted) {
        if (!resolved.count(id)) {
          resolved.emplace(id, "FACE_" + std::to_string(id));
        }
      }
    }
  }

  std::unordered_map<uint32_t, uint32_t> raw_to_reserved;
  std::unordered_map<uint32_t, std::string> remapped_id_to_face_name;
  std::unordered_map<std::string, uint32_t> remapped_face_name_to_id;
  auto ensure_reserved_id = [&](uint32_t raw_id) -> uint32_t {
    const auto found = raw_to_reserved.find(raw_id);
    if (found != raw_to_reserved.end()) return found->second;
    const uint32_t reserved_id = manifold::Manifold::ReserveIDs(1);
    raw_to_reserved.emplace(raw_id, reserved_id);
    const auto resolved_found = resolved.find(raw_id);
    const std::string face_name =
        (resolved_found != resolved.end() && !resolved_found->second.empty())
            ? resolved_found->second
            : ("FACE_" + std::to_string(reserved_id));
    remapped_id_to_face_name.emplace(reserved_id, face_name);
    remapped_face_name_to_id.emplace(face_name, reserved_id);
    return reserved_id;
  };

  for (const auto& entry : resolved) {
    ensure_reserved_id(entry.first);
  }
  for (uint32_t& id : tri_ids_) {
    id = ensure_reserved_id(id);
  }

  id_to_face_name_.swap(remapped_id_to_face_name);
  face_name_to_id_.swap(remapped_face_name_to_id);
  PruneUnusedFaces();
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

void BrepSolidCore::BakeTransform(const emscripten::val& matrix_values) {
  const std::array<double, 16> e =
      ReadTransformMatrix(matrix_values, "BakeTransform");

  const uint32_t vertex_count = VertexCount();
  for (uint32_t i = 0; i < vertex_count; ++i) {
    const uint32_t base = i * num_prop_;
    const double x = vert_properties_[base + 0];
    const double y = vert_properties_[base + 1];
    const double z = vert_properties_[base + 2];
    vert_properties_[base + 0] =
        static_cast<float>(e[0] * x + e[4] * y + e[8] * z + e[12]);
    vert_properties_[base + 1] =
        static_cast<float>(e[1] * x + e[5] * y + e[9] * z + e[13]);
    vert_properties_[base + 2] =
        static_cast<float>(e[2] * x + e[6] * y + e[10] * z + e[14]);
  }

  for (AuxEdgeRecord& aux : aux_edges_) {
    for (std::array<double, 3>& point : aux.points) {
      const double x = point[0];
      const double y = point[1];
      const double z = point[2];
      point[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      point[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      point[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
  }

  TransformFaceMetadataJson(face_metadata_json_, e);
  RebuildVertexKeyIndex();
}

void BrepSolidCore::TransformMetadata(const emscripten::val& matrix_values) {
  const std::array<double, 16> values =
      ReadTransformMatrix(matrix_values, "TransformMetadata");
  TransformFaceMetadataJson(face_metadata_json_, values);
}

void BrepSolidCore::WeldVerticesByEpsilon(double eps) {
  if (!std::isfinite(eps) || eps <= 0.0) return;

  const uint32_t nv = VertexCount();
  if (nv == 0) return;

  const double eps_sq = eps * eps;
  auto to_cell = [eps](double value) {
    return static_cast<long long>(std::floor(value / eps));
  };
  auto make_cell_key = [](long long cx, long long cy, long long cz) {
    std::ostringstream key_stream;
    key_stream << cx << ',' << cy << ',' << cz;
    return key_stream.str();
  };
  auto distance_sq = [&](uint32_t a, uint32_t b) {
    const uint32_t abase = a * num_prop_;
    const uint32_t bbase = b * num_prop_;
    const double dx = static_cast<double>(vert_properties_[abase + 0]) -
                      static_cast<double>(vert_properties_[bbase + 0]);
    const double dy = static_cast<double>(vert_properties_[abase + 1]) -
                      static_cast<double>(vert_properties_[bbase + 1]);
    const double dz = static_cast<double>(vert_properties_[abase + 2]) -
                      static_cast<double>(vert_properties_[bbase + 2]);
    return dx * dx + dy * dy + dz * dz;
  };

  std::unordered_map<std::string, std::vector<uint32_t>> cell_map;
  cell_map.reserve(nv * 2);
  std::vector<std::array<long long, 3>> vertex_cells(nv);
  for (uint32_t i = 0; i < nv; ++i) {
    const uint32_t base = i * num_prop_;
    const long long cx = to_cell(vert_properties_[base + 0]);
    const long long cy = to_cell(vert_properties_[base + 1]);
    const long long cz = to_cell(vert_properties_[base + 2]);
    vertex_cells[i] = {cx, cy, cz};
    cell_map[make_cell_key(cx, cy, cz)].push_back(i);
  }

  std::vector<uint32_t> parent(nv);
  std::vector<uint8_t> rank(nv, 0);
  for (uint32_t i = 0; i < nv; ++i) parent[i] = i;
  auto find_root = [&](uint32_t value) {
    uint32_t root = value;
    while (parent[root] != root) root = parent[root];
    while (parent[value] != value) {
      const uint32_t next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  auto unite = [&](uint32_t a, uint32_t b) {
    a = find_root(a);
    b = find_root(b);
    if (a == b) return false;
    if (rank[a] < rank[b]) std::swap(a, b);
    parent[b] = a;
    if (rank[a] == rank[b]) rank[a] += 1;
    return true;
  };

  bool changed = false;
  for (uint32_t i = 0; i < nv; ++i) {
    const auto [cx, cy, cz] = vertex_cells[i];
    for (long long dx = -1; dx <= 1; ++dx) {
      for (long long dy = -1; dy <= 1; ++dy) {
        for (long long dz = -1; dz <= 1; ++dz) {
          const auto found =
              cell_map.find(make_cell_key(cx + dx, cy + dy, cz + dz));
          if (found == cell_map.end()) continue;
          for (const uint32_t other : found->second) {
            if (other <= i) continue;
            if (distance_sq(i, other) > eps_sq) continue;
            if (unite(i, other)) changed = true;
          }
        }
      }
    }
  }

  struct ClusterAccum {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    uint32_t count = 0;
  };
  std::unordered_map<uint32_t, ClusterAccum> cluster_map;
  cluster_map.reserve(nv);
  for (uint32_t i = 0; i < nv; ++i) {
    const uint32_t root = find_root(i);
    const uint32_t base = i * num_prop_;
    auto& cluster = cluster_map[root];
    cluster.x += static_cast<double>(vert_properties_[base + 0]);
    cluster.y += static_cast<double>(vert_properties_[base + 1]);
    cluster.z += static_cast<double>(vert_properties_[base + 2]);
    cluster.count += 1;
  }

  if (!changed) return;

  for (uint32_t i = 0; i < nv; ++i) {
    const uint32_t root = find_root(i);
    const auto cluster = cluster_map.find(root);
    if (cluster == cluster_map.end() || cluster->second.count == 0) continue;
    const uint32_t base = i * num_prop_;
    vert_properties_[base + 0] = static_cast<float>(
        cluster->second.x / static_cast<double>(cluster->second.count));
    vert_properties_[base + 1] = static_cast<float>(
        cluster->second.y / static_cast<double>(cluster->second.count));
    vert_properties_[base + 2] = static_cast<float>(
        cluster->second.z / static_cast<double>(cluster->second.count));
  }

  RebuildVertexKeyIndex();
}

bool BrepSolidCore::IsCoherentlyOrientedManifold() const {
  const uint32_t tri_count = static_cast<uint32_t>(tri_verts_.size() / 3);
  const uint32_t vertex_count = VertexCount();
  if (tri_count == 0 || vertex_count == 0) return false;

  struct EdgeUse {
    uint32_t a = 0;
    uint32_t b = 0;
  };

  std::unordered_map<std::string, std::vector<EdgeUse>> edge_map;
  edge_map.reserve(tri_count * 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    const std::array<std::array<uint32_t, 2>, 3> edges = {
        std::array<uint32_t, 2>{i0, i1},
        std::array<uint32_t, 2>{i1, i2},
        std::array<uint32_t, 2>{i2, i0},
    };
    for (const auto& edge : edges) {
      edge_map[MakeUndirectedEdgeKey(edge[0], edge[1])].push_back(
          {edge[0], edge[1]});
    }
  }

  for (const auto& entry : edge_map) {
    const auto& uses = entry.second;
    if (uses.size() != 2) return false;
    if (!(uses[0].a == uses[1].b && uses[0].b == uses[1].a)) return false;
  }
  return true;
}

bool BrepSolidCore::FixTriangleWindingsByAdjacency() {
  const uint32_t tri_count = static_cast<uint32_t>(tri_verts_.size() / 3);
  const uint32_t vertex_count = VertexCount();
  if (tri_count == 0 || vertex_count == 0) return false;
  if (IsCoherentlyOrientedManifold()) return false;

  struct EdgeUse {
    uint32_t tri = 0;
    uint32_t a = 0;
    uint32_t b = 0;
  };

  std::vector<std::array<uint32_t, 3>> tris(tri_count);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    tris[tri_idx] = {tri_verts_[tri_base + 0], tri_verts_[tri_base + 1],
                     tri_verts_[tri_base + 2]};
  }

  std::unordered_map<std::string, std::vector<EdgeUse>> edge_map;
  edge_map.reserve(tri_count * 3);
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const auto& tri = tris[tri_idx];
    const std::array<std::array<uint32_t, 2>, 3> edges = {
        std::array<uint32_t, 2>{tri[0], tri[1]},
        std::array<uint32_t, 2>{tri[1], tri[2]},
        std::array<uint32_t, 2>{tri[2], tri[0]},
    };
    for (const auto& edge : edges) {
      edge_map[MakeUndirectedEdgeKey(edge[0], edge[1])].push_back(
          {tri_idx, edge[0], edge[1]});
    }
  }

  std::vector<uint8_t> visited(tri_count, 0);
  std::vector<uint32_t> stack;
  stack.reserve(tri_count);
  bool changed = false;

  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    stack.push_back(seed);

    while (!stack.empty()) {
      const uint32_t tri_idx = stack.back();
      stack.pop_back();
      auto& tri = tris[tri_idx];
      const std::array<std::array<uint32_t, 2>, 3> edges = {
          std::array<uint32_t, 2>{tri[0], tri[1]},
          std::array<uint32_t, 2>{tri[1], tri[2]},
          std::array<uint32_t, 2>{tri[2], tri[0]},
      };
      for (const auto& edge : edges) {
        const auto found =
            edge_map.find(MakeUndirectedEdgeKey(edge[0], edge[1]));
        if (found == edge_map.end()) continue;
        const auto& adjacent = found->second;
        if (adjacent.size() < 2) continue;

        for (const auto& use : adjacent) {
          if (use.tri == tri_idx || visited[use.tri]) continue;
          auto& neighbor = tris[use.tri];
          if (use.a == edge[0] && use.b == edge[1]) {
            std::swap(neighbor[1], neighbor[2]);
            changed = true;
          }
          visited[use.tri] = 1;
          stack.push_back(use.tri);
        }
      }
    }
  }

  if (!changed) return false;

  tri_verts_.clear();
  tri_verts_.reserve(tri_count * 3);
  for (const auto& tri : tris) {
    tri_verts_.push_back(tri[0]);
    tri_verts_.push_back(tri[1]);
    tri_verts_.push_back(tri[2]);
  }
  return true;
}

void BrepSolidCore::InvertNormals() {
  for (uint32_t tri_base = 0; tri_base + 2 < tri_verts_.size(); tri_base += 3) {
    std::swap(tri_verts_[tri_base + 1], tri_verts_[tri_base + 2]);
  }
}

emscripten::val BrepSolidCore::PrepareManifoldMesh() {
  manifold::MeshGL mesh = BuildPreparedMeshGL();

  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", mesh.numProp);
  snapshot.set("vertProperties", ToJsArray(mesh.vertProperties));
  snapshot.set("triVerts", ToJsArray(mesh.triVerts));
  snapshot.set("faceID", ToJsArray(mesh.faceID));
  snapshot.set("mergeFromVert", ToJsArray(mesh.mergeFromVert));
  snapshot.set("mergeToVert", ToJsArray(mesh.mergeToVert));
  snapshot.set("triangleCount", static_cast<uint32_t>(mesh.NumTri()));
  snapshot.set("vertexCount", static_cast<uint32_t>(mesh.NumVert()));
  return snapshot;
}

emscripten::val BrepSolidCore::PrepareManifoldMeshTyped() {
  manifold::MeshGL mesh = BuildPreparedMeshGL();

  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", mesh.numProp);
  snapshot.set("vertProperties", ToJsTypedArray(mesh.vertProperties));
  snapshot.set("triVerts", ToJsTypedArray(mesh.triVerts));
  snapshot.set("faceID", ToJsTypedArray(mesh.faceID));
  snapshot.set("mergeFromVert", ToJsTypedArray(mesh.mergeFromVert));
  snapshot.set("mergeToVert", ToJsTypedArray(mesh.mergeToVert));
  snapshot.set("triangleCount", static_cast<uint32_t>(mesh.NumTri()));
  snapshot.set("vertexCount", static_cast<uint32_t>(mesh.NumVert()));
  return snapshot;
}

std::string BrepSolidCore::ResolveFaceName(uint32_t face_id) const {
  const auto found = id_to_face_name_.find(face_id);
  if (found != id_to_face_name_.end() && !found->second.empty()) {
    return found->second;
  }
  return "FACE_" + std::to_string(face_id);
}

manifold::MeshGL BrepSolidCore::BuildAuthoringMeshGL() const {
  manifold::MeshGL mesh;
  mesh.numProp = num_prop_;
  mesh.vertProperties = vert_properties_;
  mesh.triVerts = tri_verts_;
  mesh.faceID = tri_ids_;
  return mesh;
}

manifold::MeshGL BrepSolidCore::BuildPreparedMeshGL() {
  FixTriangleWindingsByAdjacency();

  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  double signed_volume = 0.0;
  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= VertexCount() || i1 >= VertexCount() || i2 >= VertexCount()) continue;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;
    const double x0 = vert_properties_[a + 0];
    const double y0 = vert_properties_[a + 1];
    const double z0 = vert_properties_[a + 2];
    const double x1 = vert_properties_[b + 0];
    const double y1 = vert_properties_[b + 1];
    const double z1 = vert_properties_[b + 2];
    const double x2 = vert_properties_[c + 0];
    const double y2 = vert_properties_[c + 1];
    const double z2 = vert_properties_[c + 2];
    signed_volume += x0 * (y1 * z2 - z1 * y2) -
                     y0 * (x1 * z2 - z1 * x2) +
                     z0 * (x1 * y2 - y1 * x2);
  }
  if (signed_volume < 0.0) InvertNormals();

  manifold::MeshGL mesh;
  mesh.numProp = num_prop_;
  mesh.vertProperties = vert_properties_;
  mesh.triVerts = tri_verts_;
  mesh.faceID = tri_ids_;
  mesh.Merge();
  return mesh;
}

manifold::MeshGL BrepSolidCore::BuildRuntimeMeshGL() {
  const manifold::MeshGL prepared = BuildPreparedMeshGL();
  const manifold::Manifold runtime(prepared);
  return runtime.GetMeshGL();
}

emscripten::val BrepSolidCore::GetFace(const std::string& face_name) {
  emscripten::val out = emscripten::val::array();
  const auto found = face_name_to_id_.find(face_name);
  if (found == face_name_to_id_.end()) return out;

  const uint32_t target_id = found->second;
  manifold::MeshGL mesh;
  try {
    mesh = BuildRuntimeMeshGL();
  } catch (...) {
    mesh = BuildAuthoringMeshGL();
  }
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  const uint32_t tri_count = static_cast<uint32_t>(mesh.NumTri());
  uint32_t write_idx = 0;
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    if (mesh.faceID[tri_idx] != target_id) continue;
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    if (i0 * stride + 2 >= mesh.vertProperties.size() ||
        i1 * stride + 2 >= mesh.vertProperties.size() ||
        i2 * stride + 2 >= mesh.vertProperties.size()) {
      continue;
    }

    emscripten::val tri = emscripten::val::object();
    tri.set("faceName", face_name);

    emscripten::val indices = emscripten::val::array();
    indices.set(0, i0);
    indices.set(1, i1);
    indices.set(2, i2);
    tri.set("indices", indices);

    auto build_point = [&](uint32_t vertex_idx) {
      emscripten::val point = emscripten::val::array();
      const uint32_t base = vertex_idx * stride;
      point.set(0, mesh.vertProperties[base + 0]);
      point.set(1, mesh.vertProperties[base + 1]);
      point.set(2, mesh.vertProperties[base + 2]);
      return point;
    };

    tri.set("p1", build_point(i0));
    tri.set("p2", build_point(i1));
    tri.set("p3", build_point(i2));
    out.set(write_idx++, tri);
  }
  return out;
}

emscripten::val BrepSolidCore::GetFaces(bool include_empty) {
  manifold::MeshGL mesh;
  try {
    mesh = BuildRuntimeMeshGL();
  } catch (...) {
    mesh = BuildAuthoringMeshGL();
  }
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  emscripten::val out = emscripten::val::array();
  std::unordered_map<std::string, uint32_t> face_to_index;
  uint32_t next_index = 0;

  auto ensure_face_entry = [&](const std::string& face_name) -> uint32_t {
    const auto found = face_to_index.find(face_name);
    if (found != face_to_index.end()) return found->second;
    const uint32_t index = next_index++;
    face_to_index.emplace(face_name, index);
    emscripten::val entry = emscripten::val::object();
    entry.set("faceName", face_name);
    entry.set("triangles", emscripten::val::array());
    out.set(index, entry);
    return index;
  };

  if (include_empty) {
    for (const auto& entry : face_name_to_id_) {
      ensure_face_entry(entry.first);
    }
  }

  const uint32_t tri_count = static_cast<uint32_t>(mesh.NumTri());
  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    const std::string face_name = ResolveFaceName(mesh.faceID[tri_idx]);
    const uint32_t face_index = ensure_face_entry(face_name);
    emscripten::val triangles = out[face_index]["triangles"];

    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    if (i0 * stride + 2 >= mesh.vertProperties.size() ||
        i1 * stride + 2 >= mesh.vertProperties.size() ||
        i2 * stride + 2 >= mesh.vertProperties.size()) {
      continue;
    }

    emscripten::val tri = emscripten::val::object();
    tri.set("faceName", face_name);

    emscripten::val indices = emscripten::val::array();
    indices.set(0, i0);
    indices.set(1, i1);
    indices.set(2, i2);
    tri.set("indices", indices);

    auto build_point = [&](uint32_t vertex_idx) {
      emscripten::val point = emscripten::val::array();
      const uint32_t base = vertex_idx * stride;
      point.set(0, mesh.vertProperties[base + 0]);
      point.set(1, mesh.vertProperties[base + 1]);
      point.set(2, mesh.vertProperties[base + 2]);
      return point;
    };

    tri.set("p1", build_point(i0));
    tri.set("p2", build_point(i1));
    tri.set("p3", build_point(i2));
    const uint32_t tri_out_idx =
        triangles["length"].isUndefined() ? 0 : triangles["length"].as<uint32_t>();
    triangles.set(tri_out_idx, tri);
  }

  return out;
}

emscripten::val BrepSolidCore::GetFaceNormal(const std::string& face_name) {
  emscripten::val result = emscripten::val::object();
  result.set("faceFound", false);
  result.set("validNormal", false);
  result.set("normal", emscripten::val::array());
  result.set("planarRatio", 0.0);
  result.set("affectedVertexCount", 0);

  const auto face_found = face_name_to_id_.find(face_name);
  if (face_found == face_name_to_id_.end()) return result;
  result.set("faceFound", true);

  const uint32_t face_id = face_found->second;
  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0) return result;

  double nx = 0.0;
  double ny = 0.0;
  double nz = 0.0;
  double area_sum = 0.0;
  std::vector<uint8_t> affected(nv, 0);

  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    if (tri_ids_[tri_idx] != face_id) continue;

    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;

    affected[i0] = 1;
    affected[i1] = 1;
    affected[i2] = 1;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;

    const double ax = vert_properties_[a + 0];
    const double ay = vert_properties_[a + 1];
    const double az = vert_properties_[a + 2];
    const double bx = vert_properties_[b + 0];
    const double by = vert_properties_[b + 1];
    const double bz = vert_properties_[b + 2];
    const double cx = vert_properties_[c + 0];
    const double cy = vert_properties_[c + 1];
    const double cz = vert_properties_[c + 2];

    const double ux = bx - ax;
    const double uy = by - ay;
    const double uz = bz - az;
    const double vx = cx - ax;
    const double vy = cy - ay;
    const double vz = cz - az;
    const double tx = uy * vz - uz * vy;
    const double ty = uz * vx - ux * vz;
    const double tz = ux * vy - uy * vx;
    const double t_len = std::hypot(tx, ty, tz);
    if (!(t_len > 0.0)) continue;

    area_sum += t_len;
    nx += tx;
    ny += ty;
    nz += tz;
  }

  uint32_t affected_count = 0;
  for (uint8_t value : affected) affected_count += value ? 1u : 0u;
  result.set("affectedVertexCount", affected_count);

  const double len = std::hypot(nx, ny, nz);
  const double planar_ratio = area_sum > 0.0 ? (len / area_sum) : 0.0;
  result.set("planarRatio", planar_ratio);
  if (!(len > 0.0)) return result;

  emscripten::val normal = emscripten::val::array();
  normal.set(0, nx / len);
  normal.set(1, ny / len);
  normal.set(2, nz / len);
  result.set("validNormal", true);
  result.set("normal", normal);
  return result;
}

emscripten::val BrepSolidCore::GetBoundaryEdgePolylines() {
  auto build_polylines = [&](const manifold::MeshGL& mesh) {
  const uint32_t tri_count = static_cast<uint32_t>(mesh.NumTri());
  const uint32_t stride = std::max<uint32_t>(3, mesh.numProp);
  struct EdgeUse {
    uint32_t face_id;
    uint32_t a;
    uint32_t b;
  };
  std::unordered_map<std::string, std::vector<EdgeUse>> edge_to_triangles;
  edge_to_triangles.reserve(tri_count * 3);

  for (uint32_t tri_idx = 0; tri_idx < tri_count && tri_idx < mesh.faceID.size();
       ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = mesh.triVerts[tri_base + 0];
    const uint32_t i1 = mesh.triVerts[tri_base + 1];
    const uint32_t i2 = mesh.triVerts[tri_base + 2];
    edge_to_triangles[MakeUndirectedEdgeKey(i0, i1)].push_back(
        {mesh.faceID[tri_idx], i0, i1});
    edge_to_triangles[MakeUndirectedEdgeKey(i1, i2)].push_back(
        {mesh.faceID[tri_idx], i1, i2});
    edge_to_triangles[MakeUndirectedEdgeKey(i2, i0)].push_back(
        {mesh.faceID[tri_idx], i2, i0});
  }

  struct PairGroup {
    std::string face_a;
    std::string face_b;
    std::vector<std::array<uint32_t, 2>> edges;
  };
  std::unordered_map<std::string, PairGroup> pair_to_edges;
  for (const auto& entry : edge_to_triangles) {
    const auto& uses = entry.second;
    if (uses.size() != 2) continue;
    if (uses[0].face_id == uses[1].face_id) continue;
    const std::string name_a = ResolveFaceName(uses[0].face_id);
    const std::string name_b = ResolveFaceName(uses[1].face_id);
    const bool ordered = name_a < name_b;
    const std::string face_a = ordered ? name_a : name_b;
    const std::string face_b = ordered ? name_b : name_a;
    const std::string pair_key = face_a + '\x1f' + face_b;
    auto& group = pair_to_edges[pair_key];
    group.face_a = face_a;
    group.face_b = face_b;
    group.edges.push_back({std::min(uses[0].a, uses[0].b),
                           std::max(uses[0].a, uses[0].b)});
  }

  emscripten::val polylines = emscripten::val::array();
  uint32_t polyline_index = 0;
  for (auto& pair_entry : pair_to_edges) {
    PairGroup& group = pair_entry.second;
    std::unordered_map<uint32_t, std::unordered_set<uint32_t>> adjacency;
    adjacency.reserve(group.edges.size() * 2);
    for (const auto& edge : group.edges) {
      adjacency[edge[0]].insert(edge[1]);
      adjacency[edge[1]].insert(edge[0]);
    }

    std::unordered_set<std::string> visited_edges;
    auto edge_key = [&](uint32_t a, uint32_t b) {
      return MakeUndirectedEdgeKey(a, b);
    };

    auto append_polyline = [&](const std::vector<uint32_t>& chain,
                               bool closed_loop, uint32_t local_index) {
      emscripten::val polyline = emscripten::val::object();
      polyline.set("name", group.face_a + "|" + group.face_b + "[" +
                               std::to_string(local_index) + "]");
      polyline.set("faceA", group.face_a);
      polyline.set("faceB", group.face_b);
      polyline.set("closedLoop", closed_loop);

      emscripten::val indices = emscripten::val::array();
      emscripten::val positions = emscripten::val::array();
      for (uint32_t i = 0; i < chain.size(); ++i) {
        indices.set(i, chain[i]);
        emscripten::val point = emscripten::val::array();
        const uint32_t base = chain[i] * stride;
        point.set(0, mesh.vertProperties[base + 0]);
        point.set(1, mesh.vertProperties[base + 1]);
        point.set(2, mesh.vertProperties[base + 2]);
        positions.set(i, point);
      }
      polyline.set("indices", indices);
      polyline.set("positions", positions);
      polylines.set(polyline_index++, polyline);
    };

    auto visit_chain_from = [&](uint32_t start) {
      std::vector<uint32_t> chain;
      chain.push_back(start);
      uint32_t prev = std::numeric_limits<uint32_t>::max();
      uint32_t curr = start;
      while (true) {
        auto found = adjacency.find(curr);
        if (found == adjacency.end()) break;
        bool advanced = false;
        for (const uint32_t next : found->second) {
          const std::string key = edge_key(curr, next);
          if (visited_edges.count(key)) continue;
          if (next == prev) continue;
          visited_edges.insert(key);
          prev = curr;
          curr = next;
          chain.push_back(curr);
          advanced = true;
          break;
        }
        if (!advanced) break;
      }
      return chain;
    };

    uint32_t local_index = 0;
    for (const auto& node_entry : adjacency) {
      if (node_entry.second.size() != 1) continue;
      const uint32_t node = node_entry.first;
      const uint32_t next = *node_entry.second.begin();
      if (visited_edges.count(edge_key(node, next))) continue;
      const std::vector<uint32_t> chain = visit_chain_from(node);
      if (chain.size() >= 2) append_polyline(chain, false, local_index++);
    }

    auto build_loop_from_edge = [&](uint32_t start_u, uint32_t start_v) {
      std::vector<uint32_t> chain = {start_u, start_v};
      uint32_t prev = start_u;
      uint32_t curr = start_v;
      visited_edges.insert(edge_key(start_u, start_v));
      while (true) {
        auto found = adjacency.find(curr);
        if (found == adjacency.end()) break;
        bool advanced = false;
        for (const uint32_t next : found->second) {
          if (next == prev) continue;
          const std::string key = edge_key(curr, next);
          if (visited_edges.count(key)) continue;
          visited_edges.insert(key);
          chain.push_back(next);
          prev = curr;
          curr = next;
          advanced = true;
          break;
        }
        if (!advanced) break;
      }
      const uint32_t first = chain.front();
      const uint32_t last = chain.back();
      auto last_found = adjacency.find(last);
      if (last_found != adjacency.end() && last_found->second.count(first)) {
        visited_edges.insert(edge_key(last, first));
        chain.push_back(first);
      }
      return chain;
    };

    for (const auto& node_entry : adjacency) {
      const uint32_t u = node_entry.first;
      for (const uint32_t v : node_entry.second) {
        if (visited_edges.count(edge_key(u, v))) continue;
        const std::vector<uint32_t> chain = build_loop_from_edge(u, v);
        const bool closed_loop =
            chain.size() >= 3 && chain.front() == chain.back();
        if (chain.size() >= 2) append_polyline(chain, closed_loop, local_index++);
      }
    }
  }

  return polylines;
  };

  try {
    const emscripten::val runtime_polylines = build_polylines(BuildRuntimeMeshGL());
    const uint32_t runtime_count =
        runtime_polylines["length"].isUndefined()
            ? 0
            : runtime_polylines["length"].as<uint32_t>();
    if (runtime_count > 0) return runtime_polylines;
  } catch (...) {
  }

  const manifold::MeshGL authoring = BuildAuthoringMeshGL();
  struct GeometricEdgeUse {
    uint32_t face_id;
    uint32_t a_index;
    uint32_t b_index;
    std::string a_key;
    std::string b_key;
    std::array<double, 3> a_pos;
    std::array<double, 3> b_pos;
  };
  std::unordered_map<std::string, std::vector<GeometricEdgeUse>> geometric_edges;
  geometric_edges.reserve(authoring.NumTri() * 3);

  const uint32_t stride = std::max<uint32_t>(3, authoring.numProp);
  const auto read_pos = [&](uint32_t vertex_index) {
    const uint32_t base = vertex_index * stride;
    return std::array<double, 3>{
        authoring.vertProperties[base + 0], authoring.vertProperties[base + 1],
        authoring.vertProperties[base + 2]};
  };

  for (uint32_t tri_idx = 0;
       tri_idx < authoring.faceID.size() && tri_idx * 3 + 2 < authoring.triVerts.size();
       ++tri_idx) {
    const uint32_t tri_base = tri_idx * 3;
    const std::array<uint32_t, 3> tri = {authoring.triVerts[tri_base + 0],
                                         authoring.triVerts[tri_base + 1],
                                         authoring.triVerts[tri_base + 2]};
    for (uint32_t edge_idx = 0; edge_idx < 3; ++edge_idx) {
      const uint32_t a = tri[edge_idx];
      const uint32_t b = tri[(edge_idx + 1) % 3];
      if (a * stride + 2 >= authoring.vertProperties.size() ||
          b * stride + 2 >= authoring.vertProperties.size()) {
        continue;
      }
      const auto a_pos = read_pos(a);
      const auto b_pos = read_pos(b);
      const std::string a_key =
          MakeQuantizedPointKey(a_pos[0], a_pos[1], a_pos[2]);
      const std::string b_key =
          MakeQuantizedPointKey(b_pos[0], b_pos[1], b_pos[2]);
      geometric_edges[MakeGeometricEdgeKey(a_key, b_key)].push_back(
          {authoring.faceID[tri_idx], a, b, a_key, b_key, a_pos, b_pos});
    }
  }

  struct AuthoringEdge {
    std::string u_key;
    std::string v_key;
  };
  struct AuthoringPairGroup {
    std::string face_a;
    std::string face_b;
    std::vector<AuthoringEdge> edges;
  };
  std::unordered_map<std::string, std::array<double, 3>> point_positions;
  std::unordered_map<std::string, uint32_t> point_indices;
  std::unordered_map<std::string, AuthoringPairGroup> authoring_pairs;

  for (const auto& entry : geometric_edges) {
    const auto& uses = entry.second;
    if (uses.size() != 2) continue;
    if (uses[0].face_id == uses[1].face_id) continue;

    const std::string name_a = ResolveFaceName(uses[0].face_id);
    const std::string name_b = ResolveFaceName(uses[1].face_id);
    const bool ordered = name_a < name_b;
    const std::string face_a = ordered ? name_a : name_b;
    const std::string face_b = ordered ? name_b : name_a;
    const std::string pair_key = face_a + '\x1f' + face_b;

    const std::string u_key = uses[0].a_key < uses[0].b_key ? uses[0].a_key : uses[0].b_key;
    const std::string v_key = uses[0].a_key < uses[0].b_key ? uses[0].b_key : uses[0].a_key;
    const auto& u_pos = uses[0].a_key < uses[0].b_key ? uses[0].a_pos : uses[0].b_pos;
    const auto& v_pos = uses[0].a_key < uses[0].b_key ? uses[0].b_pos : uses[0].a_pos;
    const uint32_t u_idx = uses[0].a_key < uses[0].b_key ? uses[0].a_index : uses[0].b_index;
    const uint32_t v_idx = uses[0].a_key < uses[0].b_key ? uses[0].b_index : uses[0].a_index;

    point_positions.emplace(u_key, u_pos);
    point_positions.emplace(v_key, v_pos);
    point_indices.emplace(u_key, u_idx);
    point_indices.emplace(v_key, v_idx);

    auto& group = authoring_pairs[pair_key];
    group.face_a = face_a;
    group.face_b = face_b;
    group.edges.push_back({u_key, v_key});
  }

  emscripten::val polylines = emscripten::val::array();
  uint32_t polyline_index = 0;
  for (auto& pair_entry : authoring_pairs) {
    auto& group = pair_entry.second;
    std::unordered_map<std::string, std::unordered_set<std::string>> adjacency;
    for (const auto& edge : group.edges) {
      adjacency[edge.u_key].insert(edge.v_key);
      adjacency[edge.v_key].insert(edge.u_key);
    }

    std::unordered_set<std::string> visited_edges;
    auto visit_key = [&](const std::string& a, const std::string& b) {
      return MakeGeometricEdgeKey(a, b);
    };

    auto append_polyline = [&](const std::vector<std::string>& chain,
                               bool closed_loop, uint32_t local_index) {
      emscripten::val polyline = emscripten::val::object();
      polyline.set("name", group.face_a + "|" + group.face_b + "[" +
                               std::to_string(local_index) + "]");
      polyline.set("faceA", group.face_a);
      polyline.set("faceB", group.face_b);
      polyline.set("closedLoop", closed_loop);

      emscripten::val indices = emscripten::val::array();
      emscripten::val positions = emscripten::val::array();
      for (uint32_t i = 0; i < chain.size(); ++i) {
        const auto index_found = point_indices.find(chain[i]);
        indices.set(i, index_found == point_indices.end() ? 0 : index_found->second);
        emscripten::val point = emscripten::val::array();
        const auto point_found = point_positions.find(chain[i]);
        if (point_found == point_positions.end()) continue;
        const auto& pos = point_found->second;
        point.set(0, pos[0]);
        point.set(1, pos[1]);
        point.set(2, pos[2]);
        positions.set(i, point);
      }
      polyline.set("indices", indices);
      polyline.set("positions", positions);
      polylines.set(polyline_index++, polyline);
    };

    auto visit_chain_from = [&](const std::string& start) {
      std::vector<std::string> chain;
      chain.push_back(start);
      std::string prev;
      std::string curr = start;
      while (true) {
        const auto found = adjacency.find(curr);
        if (found == adjacency.end()) break;
        bool advanced = false;
        for (const auto& next : found->second) {
          const std::string key = visit_key(curr, next);
          if (visited_edges.count(key)) continue;
          if (!prev.empty() && next == prev) continue;
          visited_edges.insert(key);
          prev = curr;
          curr = next;
          chain.push_back(curr);
          advanced = true;
          break;
        }
        if (!advanced) break;
      }
      return chain;
    };

    uint32_t local_index = 0;
    for (const auto& node_entry : adjacency) {
      if (node_entry.second.size() != 1) continue;
      const std::string& node = node_entry.first;
      const std::string& next = *node_entry.second.begin();
      if (visited_edges.count(visit_key(node, next))) continue;
      const std::vector<std::string> chain = visit_chain_from(node);
      if (chain.size() >= 2) append_polyline(chain, false, local_index++);
    }

    auto build_loop_from_edge = [&](const std::string& start_u,
                                    const std::string& start_v) {
      std::vector<std::string> chain = {start_u, start_v};
      std::string prev = start_u;
      std::string curr = start_v;
      visited_edges.insert(visit_key(start_u, start_v));
      while (true) {
        const auto found = adjacency.find(curr);
        if (found == adjacency.end()) break;
        bool advanced = false;
        for (const auto& next : found->second) {
          if (next == prev) continue;
          const std::string key = visit_key(curr, next);
          if (visited_edges.count(key)) continue;
          visited_edges.insert(key);
          chain.push_back(next);
          prev = curr;
          curr = next;
          advanced = true;
          break;
        }
        if (!advanced) break;
      }
      const auto last_found = adjacency.find(chain.back());
      if (last_found != adjacency.end() && last_found->second.count(chain.front())) {
        visited_edges.insert(visit_key(chain.back(), chain.front()));
        chain.push_back(chain.front());
      }
      return chain;
    };

    for (const auto& node_entry : adjacency) {
      const std::string& u = node_entry.first;
      for (const auto& v : node_entry.second) {
        if (visited_edges.count(visit_key(u, v))) continue;
        const std::vector<std::string> chain = build_loop_from_edge(u, v);
        const bool closed_loop =
            chain.size() >= 3 && chain.front() == chain.back();
        if (chain.size() >= 2) append_polyline(chain, closed_loop, local_index++);
      }
    }
  }

  return polylines;
}

emscripten::val BrepSolidCore::ComputeFilletCenterline(
    const emscripten::val& options) const {
  emscripten::val payload = emscripten::val::object();
  payload.set("snapshot", GetAuthoringState());

  const emscripten::val face_a_name = options["faceAName"];
  if (!face_a_name.isUndefined() && !face_a_name.isNull()) {
    payload.set("faceAName", face_a_name);
  }

  const emscripten::val face_b_name = options["faceBName"];
  if (!face_b_name.isUndefined() && !face_b_name.isNull()) {
    payload.set("faceBName", face_b_name);
  }

  const emscripten::val polyline = options["polyline"];
  if (!polyline.isUndefined() && !polyline.isNull()) {
    payload.set("polyline", polyline);
  }

  const emscripten::val radius = options["radius"];
  if (!radius.isUndefined() && !radius.isNull()) {
    payload.set("radius", radius);
  }

  const emscripten::val side_mode = options["sideMode"];
  if (!side_mode.isUndefined() && !side_mode.isNull()) {
    payload.set("sideMode", side_mode);
  }

  const emscripten::val closed_loop = options["closedLoop"];
  if (!closed_loop.isUndefined() && !closed_loop.isNull()) {
    payload.set("closedLoop", closed_loop);
  }

  const emscripten::val segment_face_pairs = options["segmentFacePairs"];
  if (!segment_face_pairs.isUndefined() && !segment_face_pairs.isNull()) {
    payload.set("segmentFacePairs", segment_face_pairs);
  }

  return manifoldplus::ComputeFilletCenterline(payload);
}

void BrepSolidCore::AddAuxEdge(const std::string& name,
                               const emscripten::val& points,
                               const emscripten::val& options) {
  AuxEdgeRecord record;
  record.name = name.empty() ? "EDGE" : name;
  record.closed_loop =
      !options["closedLoop"].isUndefined() && !options["closedLoop"].isNull() &&
      options["closedLoop"].as<bool>();
  record.polyline_world =
      !options["polylineWorld"].isUndefined() &&
      !options["polylineWorld"].isNull() &&
      options["polylineWorld"].as<bool>();
  record.centerline =
      !options["centerline"].isUndefined() && !options["centerline"].isNull() &&
      options["centerline"].as<bool>();
  if (!options["materialKey"].isUndefined() && !options["materialKey"].isNull()) {
    record.material_key = options["materialKey"].as<std::string>();
  }
  if (!options["faceA"].isUndefined() && !options["faceA"].isNull()) {
    record.face_a = options["faceA"].as<std::string>();
  }
  if (!options["faceB"].isUndefined() && !options["faceB"].isNull()) {
    record.face_b = options["faceB"].as<std::string>();
  }

  const uint32_t point_count =
      (points.isUndefined() || points.isNull()) ? 0 : points["length"].as<uint32_t>();
  record.points.reserve(point_count);
  for (uint32_t i = 0; i < point_count; ++i) {
    const emscripten::val point = points[i];
    if (point.isUndefined() || point.isNull()) continue;
    const double x = ReadNumericProperty(point, "x", 0);
    const double y = ReadNumericProperty(point, "y", 1);
    const double z = ReadNumericProperty(point, "z", 2);
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) continue;
    record.points.push_back({x, y, z});
  }
  if (record.points.size() < 2) return;
  aux_edges_.push_back(std::move(record));
}

void BrepSolidCore::SetAuxEdges(const emscripten::val& aux_edges) {
  aux_edges_ = ReadAuxEdges(aux_edges);
}

emscripten::val BrepSolidCore::GetAuxEdges() const { return ToAuxEdges(aux_edges_); }

emscripten::val BrepSolidCore::PushFace(const std::string& face_name,
                                        double distance) {
  emscripten::val result = emscripten::val::object();
  result.set("faceFound", false);
  result.set("moved", false);
  result.set("invalidNormal", false);

  if (!std::isfinite(distance) || distance == 0.0) return result;

  const auto face_found = face_name_to_id_.find(face_name);
  if (face_found == face_name_to_id_.end()) return result;
  result.set("faceFound", true);

  const uint32_t face_id = face_found->second;
  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_ids_.size()),
               static_cast<uint32_t>(tri_verts_.size() / 3));
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0) return result;

  double nx = 0.0;
  double ny = 0.0;
  double nz = 0.0;
  double area_sum = 0.0;
  std::vector<uint8_t> affected(nv, 0);
  std::vector<std::array<double, 3>> vertex_normals(nv, {0.0, 0.0, 0.0});

  for (uint32_t tri_idx = 0; tri_idx < tri_count; ++tri_idx) {
    if (tri_ids_[tri_idx] != face_id) continue;

    const uint32_t tri_base = tri_idx * 3;
    const uint32_t i0 = tri_verts_[tri_base + 0];
    const uint32_t i1 = tri_verts_[tri_base + 1];
    const uint32_t i2 = tri_verts_[tri_base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;

    affected[i0] = 1;
    affected[i1] = 1;
    affected[i2] = 1;

    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;

    const double ax = vert_properties_[a + 0];
    const double ay = vert_properties_[a + 1];
    const double az = vert_properties_[a + 2];
    const double bx = vert_properties_[b + 0];
    const double by = vert_properties_[b + 1];
    const double bz = vert_properties_[b + 2];
    const double cx = vert_properties_[c + 0];
    const double cy = vert_properties_[c + 1];
    const double cz = vert_properties_[c + 2];

    const double ux = bx - ax;
    const double uy = by - ay;
    const double uz = bz - az;
    const double vx = cx - ax;
    const double vy = cy - ay;
    const double vz = cz - az;
    const double tx = uy * vz - uz * vy;
    const double ty = uz * vx - ux * vz;
    const double tz = ux * vy - uy * vx;
    const double t_len = std::hypot(tx, ty, tz);
    if (!(t_len > 0.0)) continue;

    area_sum += t_len;
    nx += tx;
    ny += ty;
    nz += tz;
    vertex_normals[i0][0] += tx;
    vertex_normals[i0][1] += ty;
    vertex_normals[i0][2] += tz;
    vertex_normals[i1][0] += tx;
    vertex_normals[i1][1] += ty;
    vertex_normals[i1][2] += tz;
    vertex_normals[i2][0] += tx;
    vertex_normals[i2][1] += ty;
    vertex_normals[i2][2] += tz;
  }

  uint32_t affected_count = 0;
  for (uint8_t value : affected) affected_count += value ? 1u : 0u;
  if (affected_count == 0) return result;

  const double len = std::hypot(nx, ny, nz);
  const double planar_ratio = area_sum > 0.0 ? (len / area_sum) : 0.0;
  if (len > 0.0 && planar_ratio > 0.98) {
    const double dx = nx * (distance / len);
    const double dy = ny * (distance / len);
    const double dz = nz * (distance / len);
    for (uint32_t i = 0; i < nv; ++i) {
      if (!affected[i]) continue;
      const uint32_t base = i * num_prop_;
      vert_properties_[base + 0] += static_cast<float>(dx);
      vert_properties_[base + 1] += static_cast<float>(dy);
      vert_properties_[base + 2] += static_cast<float>(dz);
    }
    RebuildVertexKeyIndex();
    result.set("moved", true);
    return result;
  }

  uint32_t moved = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!affected[i]) continue;
    const double vx = vertex_normals[i][0];
    const double vy = vertex_normals[i][1];
    const double vz = vertex_normals[i][2];
    const double vlen = std::hypot(vx, vy, vz);
    if (!(vlen > 0.0)) continue;
    const double scale = distance / vlen;
    const uint32_t base = i * num_prop_;
    vert_properties_[base + 0] += static_cast<float>(vx * scale);
    vert_properties_[base + 1] += static_cast<float>(vy * scale);
    vert_properties_[base + 2] += static_cast<float>(vz * scale);
    moved++;
  }

  if (moved == 0) {
    result.set("invalidNormal", true);
    return result;
  }

  RebuildVertexKeyIndex();
  result.set("moved", true);
  return result;
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

bool BrepSolidCore::RenameFace(const std::string& old_face_name,
                               const std::string& new_face_name) {
  if (old_face_name.empty() || new_face_name.empty() ||
      old_face_name == new_face_name) {
    return false;
  }

  const auto old_found = face_name_to_id_.find(old_face_name);
  if (old_found == face_name_to_id_.end()) return false;

  const uint32_t old_id = old_found->second;
  const auto new_found = face_name_to_id_.find(new_face_name);
  if (new_found == face_name_to_id_.end() || new_found->second == old_id) {
    face_name_to_id_.erase(old_face_name);
    face_name_to_id_[new_face_name] = old_id;
    id_to_face_name_[old_id] = new_face_name;

    const auto old_meta = face_metadata_json_.find(old_face_name);
    if (old_meta != face_metadata_json_.end()) {
      if (!face_metadata_json_.count(new_face_name)) {
        face_metadata_json_[new_face_name] = old_meta->second;
      }
      face_metadata_json_.erase(old_meta);
    }
    return true;
  }

  const uint32_t new_id = new_found->second;
  bool changed = false;
  for (uint32_t& tri_id : tri_ids_) {
    if (tri_id == old_id) {
      tri_id = new_id;
      changed = true;
    }
  }

  face_name_to_id_.erase(old_face_name);
  id_to_face_name_.erase(old_id);
  id_to_face_name_[new_id] = new_face_name;

  const auto old_meta = face_metadata_json_.find(old_face_name);
  if (old_meta != face_metadata_json_.end()) {
    if (!face_metadata_json_.count(new_face_name)) {
      face_metadata_json_[new_face_name] = old_meta->second;
    }
    face_metadata_json_.erase(old_meta);
  }

  PruneUnusedFaces();
  return changed || true;
}

uint32_t BrepSolidCore::CleanupTinyFaceIslands(double max_area) {
  if (!std::isfinite(max_area) || max_area <= 0.0) return 0;

  const uint32_t tri_count = static_cast<uint32_t>(tri_verts_.size() / 3);
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0 || tri_ids_.size() < tri_count ||
      vert_properties_.size() < 9) {
    return 0;
  }

  std::vector<double> tri_areas(tri_count, 0.0);
  std::unordered_map<uint32_t, std::vector<uint32_t>> face_to_tris;
  std::unordered_map<uint32_t, double> face_area;
  for (uint32_t t = 0; t < tri_count; ++t) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;
    const double area =
        TriangleAreaFromVerts(vert_properties_, num_prop_, i0, i1, i2);
    tri_areas[t] = area;
    const uint32_t face_id = tri_ids_[t];
    face_to_tris[face_id].push_back(t);
    face_area[face_id] += area;
  }

  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
  edge_to_tris.reserve(tri_count * 3);
  for (uint32_t t = 0; t < tri_count; ++t) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    edge_to_tris[MakeUndirectedEdgeKey(i0, i1)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i1, i2)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i2, i0)].push_back(t);
  }

  std::vector<std::vector<uint32_t>> tri_adj(tri_count);
  for (const auto& entry : edge_to_tris) {
    const auto& tris = entry.second;
    if (tris.size() != 2) continue;
    tri_adj[tris[0]].push_back(tris[1]);
    tri_adj[tris[1]].push_back(tris[0]);
  }

  uint32_t reassigned = 0;
  std::vector<uint32_t> tiny_face_ids;
  tiny_face_ids.reserve(face_area.size());
  for (const auto& entry : face_area) {
    if (entry.second <= max_area) tiny_face_ids.push_back(entry.first);
  }

  for (const uint32_t tiny_face_id : tiny_face_ids) {
    const auto tris_found = face_to_tris.find(tiny_face_id);
    if (tris_found == face_to_tris.end()) continue;
    const auto& tiny_face_tris = tris_found->second;
    bool moved_in_pass = true;
    while (moved_in_pass) {
      moved_in_pass = false;
      for (const uint32_t t : tiny_face_tris) {
        if (t >= tri_count || tri_ids_[t] != tiny_face_id) continue;
        std::unordered_map<uint32_t, uint32_t> contact_count;
        uint32_t best_id = 0;
        int32_t best_contact = -1;
        double best_neighbor_area = -1.0;
        for (const uint32_t nbr : tri_adj[t]) {
          if (nbr >= tri_count) continue;
          const uint32_t neighbor_id = tri_ids_[nbr];
          if (neighbor_id == tiny_face_id) continue;
          const uint32_t count = ++contact_count[neighbor_id];
          const double area = face_area[neighbor_id];
          if (static_cast<int32_t>(count) > best_contact ||
              (static_cast<int32_t>(count) == best_contact &&
               area > best_neighbor_area)) {
            best_contact = static_cast<int32_t>(count);
            best_neighbor_area = area;
            best_id = neighbor_id;
          }
        }
        if (best_contact < 0) continue;
        tri_ids_[t] = best_id;
        const double tri_area = tri_areas[t];
        face_area[tiny_face_id] -= tri_area;
        face_area[best_id] += tri_area;
        reassigned++;
        moved_in_pass = true;
      }
    }
  }

  std::vector<int32_t> seen_token(tri_count, 0);
  int32_t token = 1;
  std::vector<uint32_t> stack;
  stack.reserve(tri_count);
  auto collapse_tiny_label_islands = [&]() {
    std::unordered_map<uint32_t, std::vector<uint32_t>> current_face_to_tris;
    for (uint32_t t = 0; t < tri_count; ++t) {
      current_face_to_tris[tri_ids_[t]].push_back(t);
    }

    bool changed = false;
    for (const auto& entry : current_face_to_tris) {
      const uint32_t face_id = entry.first;
      const auto& tris = entry.second;
      if (tris.empty()) continue;

      token++;
      if (token <= 0) {
        std::fill(seen_token.begin(), seen_token.end(), 0);
        token = 1;
      }

      for (const uint32_t seed : tris) {
        if (seed >= tri_count || tri_ids_[seed] != face_id ||
            seen_token[seed] == token) {
          continue;
        }
        seen_token[seed] = token;
        stack.clear();
        stack.push_back(seed);
        std::vector<uint32_t> component_tris;
        double component_area = 0.0;
        std::unordered_set<uint32_t> neighbor_ids;

        while (!stack.empty()) {
          const uint32_t t = stack.back();
          stack.pop_back();
          component_tris.push_back(t);
          component_area += tri_areas[t];
          for (const uint32_t nbr : tri_adj[t]) {
            if (nbr >= tri_count) continue;
            const uint32_t neighbor_id = tri_ids_[nbr];
            if (neighbor_id == face_id) {
              if (seen_token[nbr] == token) continue;
              seen_token[nbr] = token;
              stack.push_back(nbr);
            } else {
              neighbor_ids.insert(neighbor_id);
            }
          }
        }

        if (!(component_area <= max_area) || neighbor_ids.empty()) continue;

        uint32_t best_id = 0;
        double best_neighbor_area = -1.0;
        for (const uint32_t neighbor_id : neighbor_ids) {
          const double area = face_area[neighbor_id];
          if (area > best_neighbor_area) {
            best_neighbor_area = area;
            best_id = neighbor_id;
          }
        }
        if (best_neighbor_area < 0.0) continue;

        for (const uint32_t tri_idx : component_tris) {
          if (tri_ids_[tri_idx] == face_id) {
            tri_ids_[tri_idx] = best_id;
            reassigned++;
            changed = true;
          }
        }
        face_area[face_id] = std::max(0.0, face_area[face_id] - component_area);
        face_area[best_id] += component_area;
      }
    }
    return changed;
  };

  uint32_t island_passes = 0;
  while (collapse_tiny_label_islands()) {
    island_passes++;
    if (island_passes >= 8) break;
  }

  if (reassigned > 0) {
    PruneUnusedFaces();
  }
  return reassigned;
}

uint32_t BrepSolidCore::RemoveSmallIslands(uint32_t max_triangles,
                                           bool remove_internal,
                                           bool remove_external) {
  if (max_triangles == 0 || (!remove_internal && !remove_external)) return 0;

  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_verts_.size() / 3),
               static_cast<uint32_t>(tri_ids_.size()));
  const uint32_t nv = VertexCount();
  if (tri_count == 0 || nv == 0 || vert_properties_.size() < 9) return 0;

  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
  edge_to_tris.reserve(tri_count * 3);
  for (uint32_t t = 0; t < tri_count; ++t) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    edge_to_tris[MakeUndirectedEdgeKey(i0, i1)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i1, i2)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i2, i0)].push_back(t);
  }

  std::vector<std::vector<uint32_t>> tri_adj(tri_count);
  for (const auto& entry : edge_to_tris) {
    const auto& tris = entry.second;
    if (tris.size() != 2) continue;
    tri_adj[tris[0]].push_back(tris[1]);
    tri_adj[tris[1]].push_back(tris[0]);
  }

  std::vector<int32_t> comp_id(tri_count, -1);
  std::vector<std::vector<uint32_t>> comps;
  std::vector<uint32_t> stack;
  stack.reserve(tri_count);
  int32_t comp_count = 0;
  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (comp_id[seed] != -1) continue;
    comp_id[seed] = comp_count;
    stack.clear();
    stack.push_back(seed);
    comps.push_back({});
    while (!stack.empty()) {
      const uint32_t t = stack.back();
      stack.pop_back();
      comps.back().push_back(t);
      for (const uint32_t nbr : tri_adj[t]) {
        if (nbr >= tri_count || comp_id[nbr] != -1) continue;
        comp_id[nbr] = comp_count;
        stack.push_back(nbr);
      }
    }
    comp_count++;
  }

  if (comps.size() <= 1) return 0;

  size_t main_idx = 0;
  for (size_t i = 1; i < comps.size(); ++i) {
    if (comps[i].size() > comps[main_idx].size()) main_idx = i;
  }

  std::vector<std::array<std::array<double, 3>, 3>> main_faces;
  main_faces.reserve(comps[main_idx].size());
  for (const uint32_t t : comps[main_idx]) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    if (i0 >= nv || i1 >= nv || i2 >= nv) continue;
    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;
    main_faces.push_back({{{vert_properties_[a + 0], vert_properties_[a + 1],
                            vert_properties_[a + 2]},
                           {vert_properties_[b + 0], vert_properties_[b + 1],
                            vert_properties_[b + 2]},
                           {vert_properties_[c + 0], vert_properties_[c + 1],
                            vert_properties_[c + 2]}}});
  }

  const std::array<double, 3> ray_dir{1.0, 0.0, 0.0};
  auto point_inside_main = [&](const std::array<double, 3>& point) {
    uint32_t hits = 0;
    for (const auto& tri : main_faces) {
      if (RayTriangleHit(point, ray_dir, tri) >= 0.0) hits++;
    }
    return (hits % 2u) == 1u;
  };

  auto tri_centroid = [&](uint32_t t) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    const uint32_t a = i0 * num_prop_;
    const uint32_t b = i1 * num_prop_;
    const uint32_t c = i2 * num_prop_;
    return std::array<double, 3>{
        (vert_properties_[a + 0] + vert_properties_[b + 0] +
         vert_properties_[c + 0]) /
            3.0 +
            1e-8,
        (vert_properties_[a + 1] + vert_properties_[b + 1] +
         vert_properties_[c + 1]) /
            3.0 +
            1e-8,
        (vert_properties_[a + 2] + vert_properties_[b + 2] +
         vert_properties_[c + 2]) /
            3.0 +
            1e-8};
  };

  std::vector<uint8_t> remove_comp(comps.size(), 0);
  for (size_t i = 0; i < comps.size(); ++i) {
    if (i == main_idx) continue;
    const auto& tris = comps[i];
    if (tris.empty() || tris.size() > max_triangles) continue;
    const bool inside = point_inside_main(tri_centroid(tris[0]));
    if ((inside && remove_internal) || (!inside && remove_external)) {
      remove_comp[i] = 1;
    }
  }

  uint32_t removed = 0;
  std::vector<uint8_t> keep_tri(tri_count, 1);
  for (uint32_t t = 0; t < tri_count; ++t) {
    if (!remove_comp[comp_id[t]]) continue;
    keep_tri[t] = 0;
    removed++;
  }
  if (removed == 0) return 0;

  CompactMeshByTriangleMask(num_prop_, vert_properties_, tri_verts_, tri_ids_,
                            keep_tri);
  RebuildVertexKeyIndex();
  PruneUnusedFaces();
  return removed;
}

uint32_t BrepSolidCore::MergeTinyFaces(double max_area) {
  if (!std::isfinite(max_area) || max_area <= 0.0) return 0;

  auto merge_from_mesh = [&](const manifold::MeshGL& mesh) {
    const uint32_t tri_count = static_cast<uint32_t>(mesh.NumTri());
    if (tri_count == 0 || mesh.faceID.size() < tri_count ||
        mesh.vertProperties.size() < 9) {
      return uint32_t{0};
    }

    std::unordered_map<uint32_t, double> face_area;
    face_area.reserve(face_name_to_id_.size());
    for (uint32_t t = 0; t < tri_count; ++t) {
      const uint32_t base = t * 3;
      const uint32_t i0 = mesh.triVerts[base + 0];
      const uint32_t i1 = mesh.triVerts[base + 1];
      const uint32_t i2 = mesh.triVerts[base + 2];
      face_area[mesh.faceID[t]] += TriangleAreaFromVerts(
          mesh.vertProperties, mesh.numProp, i0, i1, i2);
    }

    std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
    edge_to_tris.reserve(tri_count * 3);
    for (uint32_t t = 0; t < tri_count; ++t) {
      const uint32_t base = t * 3;
      const uint32_t i0 = mesh.triVerts[base + 0];
      const uint32_t i1 = mesh.triVerts[base + 1];
      const uint32_t i2 = mesh.triVerts[base + 2];
      edge_to_tris[MakeUndirectedEdgeKey(i0, i1)].push_back(t);
      edge_to_tris[MakeUndirectedEdgeKey(i1, i2)].push_back(t);
      edge_to_tris[MakeUndirectedEdgeKey(i2, i0)].push_back(t);
    }

    std::unordered_map<uint32_t, std::unordered_set<uint32_t>> neighbors;
    for (const auto& entry : edge_to_tris) {
      const auto& tris = entry.second;
      if (tris.size() != 2) continue;
      const uint32_t face_a = mesh.faceID[tris[0]];
      const uint32_t face_b = mesh.faceID[tris[1]];
      if (face_a == face_b) continue;
      neighbors[face_a].insert(face_b);
      neighbors[face_b].insert(face_a);
    }
    if (neighbors.empty()) return uint32_t{0};

    std::vector<std::string> face_names;
    face_names.reserve(face_name_to_id_.size());
    for (const auto& entry : face_name_to_id_) {
      face_names.push_back(entry.first);
    }

    uint32_t merged = 0;
    for (const std::string& face_name : face_names) {
      const auto found = face_name_to_id_.find(face_name);
      if (found == face_name_to_id_.end()) continue;
      const uint32_t face_id = found->second;
      const double area = face_area.count(face_id) ? face_area[face_id] : 0.0;
      if (!(area < max_area)) continue;
      const auto nbr_found = neighbors.find(face_id);
      if (nbr_found == neighbors.end() || nbr_found->second.empty()) continue;

      uint32_t best_id = 0;
      double best_neighbor_area = -1.0;
      for (const uint32_t neighbor_id : nbr_found->second) {
        const double neighbor_area =
            face_area.count(neighbor_id) ? face_area[neighbor_id] : 0.0;
        if (neighbor_area > best_neighbor_area) {
          best_neighbor_area = neighbor_area;
          best_id = neighbor_id;
        }
      }
      if (best_neighbor_area < 0.0) continue;
      const std::string best_name = ResolveFaceName(best_id);
      if (best_name.empty() || best_name == face_name) continue;
      if (RenameFace(face_name, best_name)) merged++;
    }

    return merged;
  };

  try {
    const uint32_t merged = merge_from_mesh(BuildRuntimeMeshGL());
    if (merged > 0) return merged;
  } catch (...) {
  }

  return merge_from_mesh(BuildAuthoringMeshGL());
}

uint32_t BrepSolidCore::RemoveInternalTriangles() {
  const uint32_t tri_count_before =
      static_cast<uint32_t>(tri_verts_.size() / 3);
  if (tri_count_before == 0) return 0;

  const manifold::MeshGL mesh = BuildRuntimeMeshGL();
  const uint32_t tri_count_after = static_cast<uint32_t>(mesh.NumTri());
  if (tri_count_after == 0 && tri_count_before > 0) {
    throw std::runtime_error(
        "native manifold rebuild produced an empty mesh");
  }

  num_prop_ = std::max<uint32_t>(3, mesh.numProp);
  vert_properties_ = mesh.vertProperties;
  tri_verts_ = mesh.triVerts;
  if (mesh.faceID.size() == tri_count_after) {
    tri_ids_ = mesh.faceID;
  } else {
    tri_ids_.assign(tri_count_after, 0);
  }
  RebuildVertexKeyIndex();
  PruneUnusedFaces();

  return tri_count_before > tri_count_after ? (tri_count_before - tri_count_after)
                                            : 0;
}

uint32_t BrepSolidCore::RemoveDisconnectedIslandsByVolume(double min_volume) {
  if (!std::isfinite(min_volume) || min_volume <= 0.0) return 0;

  const uint32_t tri_count =
      std::min(static_cast<uint32_t>(tri_verts_.size() / 3),
               static_cast<uint32_t>(tri_ids_.size()));
  const uint32_t nv = VertexCount();
  if (tri_count <= 1 || nv == 0 || vert_properties_.size() < 9) {
    return 0;
  }

  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
  edge_to_tris.reserve(tri_count * 3);
  for (uint32_t t = 0; t < tri_count; ++t) {
    const uint32_t base = t * 3;
    const uint32_t i0 = tri_verts_[base + 0];
    const uint32_t i1 = tri_verts_[base + 1];
    const uint32_t i2 = tri_verts_[base + 2];
    edge_to_tris[MakeUndirectedEdgeKey(i0, i1)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i1, i2)].push_back(t);
    edge_to_tris[MakeUndirectedEdgeKey(i2, i0)].push_back(t);
  }

  std::vector<std::vector<uint32_t>> tri_adj(tri_count);
  for (const auto& entry : edge_to_tris) {
    const auto& tris = entry.second;
    if (tris.size() < 2) continue;
    const uint32_t root = tris[0];
    for (size_t i = 1; i < tris.size(); ++i) {
      const uint32_t other = tris[i];
      if (other == root) continue;
      tri_adj[root].push_back(other);
      tri_adj[other].push_back(root);
    }
  }

  std::vector<int32_t> comp_id(tri_count, -1);
  std::vector<double> comp_vol6;
  std::vector<uint32_t> comp_sizes;
  std::vector<uint32_t> stack;
  stack.reserve(tri_count);
  int32_t comp_count = 0;

  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (comp_id[seed] != -1) continue;

    comp_id[seed] = comp_count;
    comp_vol6.push_back(0.0);
    comp_sizes.push_back(0);
    stack.clear();
    stack.push_back(seed);

    while (!stack.empty()) {
      const uint32_t t = stack.back();
      stack.pop_back();
      comp_sizes[comp_count] += 1;

      const uint32_t base = t * 3;
      const uint32_t vi0 = tri_verts_[base + 0];
      const uint32_t vi1 = tri_verts_[base + 1];
      const uint32_t vi2 = tri_verts_[base + 2];
      if (vi0 < nv && vi1 < nv && vi2 < nv) {
        const uint32_t i0 = vi0 * num_prop_;
        const uint32_t i1 = vi1 * num_prop_;
        const uint32_t i2 = vi2 * num_prop_;
        const double x0 = vert_properties_[i0 + 0];
        const double y0 = vert_properties_[i0 + 1];
        const double z0 = vert_properties_[i0 + 2];
        const double x1 = vert_properties_[i1 + 0];
        const double y1 = vert_properties_[i1 + 1];
        const double z1 = vert_properties_[i1 + 2];
        const double x2 = vert_properties_[i2 + 0];
        const double y2 = vert_properties_[i2 + 1];
        const double z2 = vert_properties_[i2 + 2];
        comp_vol6[comp_count] += x0 * (y1 * z2 - z1 * y2) -
                                 y0 * (x1 * z2 - z1 * x2) +
                                 z0 * (x1 * y2 - y1 * x2);
      }

      for (const uint32_t nbr : tri_adj[t]) {
        if (nbr >= tri_count || comp_id[nbr] != -1) continue;
        comp_id[nbr] = comp_count;
        stack.push_back(nbr);
      }
    }

    comp_count++;
  }

  if (comp_count <= 1) return 0;

  int32_t main_idx = 0;
  for (int32_t i = 1; i < comp_count; ++i) {
    const double best_vol = std::abs(comp_vol6[main_idx]);
    const double next_vol = std::abs(comp_vol6[i]);
    if (next_vol > best_vol + 1e-12 ||
        (std::abs(next_vol - best_vol) <= 1e-12 &&
         comp_sizes[i] > comp_sizes[main_idx])) {
      main_idx = i;
    }
  }

  std::vector<uint8_t> remove_comp(comp_count, 0);
  for (int32_t i = 0; i < comp_count; ++i) {
    if (i == main_idx) continue;
    const double comp_volume = std::abs(comp_vol6[i]) / 6.0;
    if (comp_volume < min_volume) {
      remove_comp[i] = 1;
    }
  }

  uint32_t removed = 0;
  for (uint32_t t = 0; t < tri_count; ++t) {
    if (remove_comp[comp_id[t]]) removed++;
  }
  if (removed == 0) return 0;

  std::vector<uint8_t> used_vert(nv, 0);
  std::vector<uint32_t> new_tri_verts;
  std::vector<uint32_t> new_tri_ids;
  new_tri_verts.reserve((tri_count - removed) * 3);
  new_tri_ids.reserve(tri_count - removed);

  for (uint32_t t = 0; t < tri_count; ++t) {
    if (remove_comp[comp_id[t]]) continue;
    const uint32_t base = t * 3;
    const uint32_t a = tri_verts_[base + 0];
    const uint32_t b = tri_verts_[base + 1];
    const uint32_t c = tri_verts_[base + 2];
    if (a >= nv || b >= nv || c >= nv) continue;
    new_tri_verts.push_back(a);
    new_tri_verts.push_back(b);
    new_tri_verts.push_back(c);
    new_tri_ids.push_back(tri_ids_[t]);
    used_vert[a] = 1;
    used_vert[b] = 1;
    used_vert[c] = 1;
  }

  std::vector<int32_t> old_to_new(nv, -1);
  std::vector<float> new_vert_properties;
  new_vert_properties.reserve(vert_properties_.size());
  uint32_t write = 0;
  for (uint32_t i = 0; i < nv; ++i) {
    if (!used_vert[i]) continue;
    old_to_new[i] = static_cast<int32_t>(write++);
    const uint32_t base = i * num_prop_;
    for (uint32_t prop = 0; prop < num_prop_; ++prop) {
      new_vert_properties.push_back(vert_properties_[base + prop]);
    }
  }

  for (uint32_t& index : new_tri_verts) {
    index = static_cast<uint32_t>(old_to_new[index]);
  }

  vert_properties_.swap(new_vert_properties);
  tri_verts_.swap(new_tri_verts);
  tri_ids_.swap(new_tri_ids);
  RebuildVertexKeyIndex();
  PruneUnusedFaces();
  return removed;
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
  snapshot.set("auxEdges", ToAuxEdges(aux_edges_));
  snapshot.set("vertexCount", VertexCount());
  snapshot.set("triangleCount", TriangleCount());
  return snapshot;
}

uint32_t BrepSolidCore::VertexCount() const {
  return static_cast<uint32_t>(vert_properties_.size() / num_prop_);
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

std::string BrepSolidCore::MakeUndirectedEdgeKey(uint32_t a, uint32_t b) {
  const uint32_t lo = std::min(a, b);
  const uint32_t hi = std::max(a, b);
  std::ostringstream stream;
  stream << lo << ',' << hi;
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

emscripten::val BrepSolidCore::ToJsTypedArray(
    const std::vector<float>& values) {
  return emscripten::val(
             emscripten::typed_memory_view(values.size(), values.data()))
      .call<emscripten::val>("slice");
}

emscripten::val BrepSolidCore::ToJsTypedArray(
    const std::vector<uint32_t>& values) {
  return emscripten::val(
             emscripten::typed_memory_view(values.size(), values.data()))
      .call<emscripten::val>("slice");
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

std::vector<float> BrepSolidCore::ReadFloatArray(const emscripten::val& values,
                                                 const char* label) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<float> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const double value = values[i].as<double>();
    if (!std::isfinite(value)) {
      throw std::runtime_error(std::string(label) +
                               " contains a non-finite numeric value.");
    }
    out.push_back(static_cast<float>(value));
  }
  return out;
}

std::vector<uint32_t> BrepSolidCore::ReadUint32Array(
    const emscripten::val& values, const char* label) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<uint32_t> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const double value = values[i].as<double>();
    if (!std::isfinite(value) || value < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer value.");
    }
    out.push_back(static_cast<uint32_t>(value));
  }
  return out;
}

std::unordered_map<std::string, uint32_t> BrepSolidCore::ReadStringUint32Map(
    const emscripten::val& values, const char* label) {
  std::unordered_map<std::string, uint32_t> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    const std::string key = pair[0].as<std::string>();
    const double value = pair[1].as<double>();
    if (!std::isfinite(value) || value < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer value.");
    }
    out[key] = static_cast<uint32_t>(value);
  }
  return out;
}

std::unordered_map<uint32_t, std::string> BrepSolidCore::ReadUint32StringMap(
    const emscripten::val& values, const char* label) {
  std::unordered_map<uint32_t, std::string> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    const double key = pair[0].as<double>();
    if (!std::isfinite(key) || key < 0.0) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid unsigned integer key.");
    }
    out[static_cast<uint32_t>(key)] = pair[1].as<std::string>();
  }
  return out;
}

std::unordered_map<std::string, std::string> BrepSolidCore::ReadStringMap(
    const emscripten::val& values, const char* label) {
  std::unordered_map<std::string, std::string> out;
  if (values.isUndefined() || values.isNull()) return out;

  const uint32_t length = values["length"].as<uint32_t>();
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val pair = values[i];
    const uint32_t pair_length = pair["length"].as<uint32_t>();
    if (pair_length < 2) {
      throw std::runtime_error(std::string(label) +
                               " contains an invalid entry.");
    }
    out[pair[0].as<std::string>()] = pair[1].as<std::string>();
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

void BrepSolidCore::PruneUnusedFaces() {
  std::unordered_set<uint32_t> used_ids;
  used_ids.reserve(tri_ids_.size());
  for (const uint32_t id : tri_ids_) used_ids.insert(id);

  for (auto it = face_name_to_id_.begin(); it != face_name_to_id_.end();) {
    if (!used_ids.count(it->second)) {
      face_metadata_json_.erase(it->first);
      it = face_name_to_id_.erase(it);
    } else {
      ++it;
    }
  }

  for (auto it = id_to_face_name_.begin(); it != id_to_face_name_.end();) {
    if (!used_ids.count(it->first)) {
      it = id_to_face_name_.erase(it);
    } else {
      ++it;
    }
  }

  for (auto it = face_metadata_json_.begin(); it != face_metadata_json_.end();) {
    if (!face_name_to_id_.count(it->first)) {
      it = face_metadata_json_.erase(it);
    } else {
      ++it;
    }
  }
}

void BrepSolidCore::RebuildVertexKeyIndex() {
  vert_key_to_index_.clear();
  const uint32_t vertex_count = VertexCount();
  for (uint32_t i = 0; i < vertex_count; ++i) {
    const uint32_t base = i * num_prop_;
    const double x = vert_properties_[base + 0];
    const double y = vert_properties_[base + 1];
    const double z = vert_properties_[base + 2];
    vert_key_to_index_[MakeVertexKey(x, y, z)] = i;
  }
}

}  // namespace manifoldplus
