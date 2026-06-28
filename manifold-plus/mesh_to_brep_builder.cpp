#include "mesh_to_brep_builder.h"

#include <emscripten/val.h>
#include <manifold/manifold.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace manifoldplus {

namespace {

constexpr uint32_t kNumProp = 3;
constexpr double kTriEps = 1e-12;

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct Triangle {
  uint32_t a = 0;
  uint32_t b = 0;
  uint32_t c = 0;
};

struct FaceStats {
  double area = 0.0;
  Vec3 normal;
  Vec3 centroid;
  std::vector<uint32_t> triangles;
};

struct SnapshotBuilder {
  std::vector<float> vert_properties;
  std::vector<uint32_t> tri_verts;
  std::vector<uint32_t> tri_ids;
  std::unordered_map<std::string, uint32_t> face_name_to_id;
  std::vector<std::pair<std::string, uint32_t>> face_entries;
  std::vector<std::pair<uint32_t, std::string>> reverse_face_entries;
  std::vector<std::pair<std::string, std::string>> face_metadata_json;

  uint32_t EnsureFaceID(const std::string& face_name) {
    const auto found = face_name_to_id.find(face_name);
    if (found != face_name_to_id.end()) return found->second;
    const uint32_t id = manifold::Manifold::ReserveIDs(1);
    face_name_to_id.emplace(face_name, id);
    face_entries.push_back({face_name, id});
    reverse_face_entries.push_back({id, face_name});
    return id;
  }

  void SetFaceMetadata(const std::string& face_name, const std::string& json) {
    EnsureFaceID(face_name);
    for (auto& entry : face_metadata_json) {
      if (entry.first == face_name) {
        entry.second = json;
        return;
      }
    }
    face_metadata_json.push_back({face_name, json});
  }

  uint32_t AddVertex(const Vec3& p) {
    const uint32_t index = static_cast<uint32_t>(vert_properties.size() / 3);
    vert_properties.push_back(static_cast<float>(p.x));
    vert_properties.push_back(static_cast<float>(p.y));
    vert_properties.push_back(static_cast<float>(p.z));
    return index;
  }

  void AddTriangleIndices(const std::string& face_name, uint32_t a, uint32_t b,
                          uint32_t c) {
    const uint32_t face_id = EnsureFaceID(face_name);
    tri_verts.push_back(a);
    tri_verts.push_back(b);
    tri_verts.push_back(c);
    tri_ids.push_back(face_id);
  }
};

double NumberOr(const emscripten::val& value, double fallback) {
  if (value.isUndefined() || value.isNull()) return fallback;
  const double number = value.as<double>();
  return std::isfinite(number) ? number : fallback;
}

bool BoolOr(const emscripten::val& value, bool fallback) {
  if (value.isUndefined() || value.isNull()) return fallback;
  return value.as<bool>();
}

std::vector<double> ReadDoubleArray(const emscripten::val& value,
                                    const char* label) {
  if (value.isUndefined() || value.isNull()) {
    throw std::runtime_error(std::string("Missing array: ") + label);
  }
  const uint32_t length = value["length"].as<uint32_t>();
  std::vector<double> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const double number = value[i].as<double>();
    if (!std::isfinite(number)) {
      throw std::runtime_error(std::string("Non-finite value in ") + label);
    }
    out.push_back(number);
  }
  return out;
}

std::vector<uint32_t> ReadUintArray(const emscripten::val& value) {
  if (value.isUndefined() || value.isNull()) return {};
  const uint32_t length = value["length"].as<uint32_t>();
  std::vector<uint32_t> out;
  out.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    out.push_back(value[i].as<uint32_t>());
  }
  return out;
}

Vec3 Add(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 Subtract(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 Scale(const Vec3& v, double s) { return {v.x * s, v.y * s, v.z * s}; }

double Dot(const Vec3& a, const Vec3& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 Cross(const Vec3& a, const Vec3& b) {
  return {
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
  };
}

double Length(const Vec3& v) { return std::hypot(v.x, v.y, v.z); }

Vec3 Normalize(const Vec3& v) {
  const double length = Length(v);
  if (!(length > 0.0)) return {0.0, 0.0, 1.0};
  return Scale(v, 1.0 / length);
}

double NormalizedDot(const Vec3& a, const Vec3& b) {
  const double la = Length(a);
  const double lb = Length(b);
  if (la == 0.0 || lb == 0.0) return 1.0;
  return Dot(a, b) / (la * lb);
}

std::string EdgeKey(uint32_t u, uint32_t v) {
  if (u > v) std::swap(u, v);
  return std::to_string(u) + "," + std::to_string(v);
}

std::string GridKey(double x, double y, double z, double q) {
  if (q <= 0.0) {
    std::ostringstream stream;
    stream.precision(std::numeric_limits<double>::max_digits10);
    stream << x << "," << y << "," << z;
    return stream.str();
  }
  const long long rx = static_cast<long long>(std::llround(x / q));
  const long long ry = static_cast<long long>(std::llround(y / q));
  const long long rz = static_cast<long long>(std::llround(z / q));
  return std::to_string(rx) + "," + std::to_string(ry) + "," +
         std::to_string(rz);
}

emscripten::val ToJsArray(const std::vector<float>& values) {
  emscripten::val out = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) out.set(i, values[i]);
  return out;
}

emscripten::val ToJsArray(const std::vector<uint32_t>& values) {
  emscripten::val out = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) out.set(i, values[i]);
  return out;
}

template <typename A, typename B>
emscripten::val ToPairEntries(const std::vector<std::pair<A, B>>& values) {
  emscripten::val out = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, values[i].first);
    pair.set(1, values[i].second);
    out.set(i, pair);
  }
  return out;
}

emscripten::val BuildSnapshot(const SnapshotBuilder& builder) {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", kNumProp);
  snapshot.set("vertProperties", ToJsArray(builder.vert_properties));
  snapshot.set("triVerts", ToJsArray(builder.tri_verts));
  snapshot.set("triIDs", ToJsArray(builder.tri_ids));
  snapshot.set("faceNameToID", ToPairEntries(builder.face_entries));
  snapshot.set("idToFaceName", ToPairEntries(builder.reverse_face_entries));
  snapshot.set("faceMetadataJson", ToPairEntries(builder.face_metadata_json));
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount",
               static_cast<uint32_t>(builder.vert_properties.size() / 3));
  snapshot.set("triangleCount", static_cast<uint32_t>(builder.tri_ids.size()));
  return snapshot;
}

std::string PlanarMetadataJson() {
  return "{\"source\":\"MESH_TO_BREP\",\"importAutoPlanarGroup\":true}";
}

struct UnionFind {
  std::unordered_map<std::string, std::string> parent;

  std::string Find(const std::string& name) {
    auto found = parent.find(name);
    if (found == parent.end()) return name;
    if (found->second == name) return name;
    found->second = Find(found->second);
    return found->second;
  }

  void Union(const std::string& a, const std::string& b,
             const std::unordered_map<std::string, FaceStats>& stats) {
    const std::string ra = Find(a);
    const std::string rb = Find(b);
    if (ra == rb) return;
    const double area_a = stats.count(ra) ? stats.at(ra).area : 0.0;
    const double area_b = stats.count(rb) ? stats.at(rb).area : 0.0;
    const std::string root = area_a >= area_b ? ra : rb;
    const std::string child = root == ra ? rb : ra;
    parent[child] = root;
  }
};

}  // namespace

emscripten::val BuildMeshToBrepAuthoringState(const emscripten::val& options) {
  const std::vector<double> positions =
      ReadDoubleArray(options["positions"], "positions");
  const std::vector<uint32_t> indices = ReadUintArray(options["indices"]);
  const std::vector<double> normals =
      options["normals"].isUndefined() || options["normals"].isNull()
          ? std::vector<double>{}
          : ReadDoubleArray(options["normals"], "normals");
  if (positions.size() < 9 || positions.size() % 3 != 0) {
    throw std::runtime_error("MeshToBrep requires position triples.");
  }

  const uint32_t position_count = static_cast<uint32_t>(positions.size() / 3);
  const uint32_t tri_count =
      indices.empty() ? (position_count / 3)
                      : static_cast<uint32_t>(indices.size() / 3);
  if (tri_count == 0) return BuildSnapshot(SnapshotBuilder{});

  const double face_deflection_angle = NumberOr(options["faceDeflectionAngle"], 30.0);
  const double weld_tolerance = std::max(0.0, NumberOr(options["weldTolerance"], 1e-5));
  const bool extract_planar_faces = BoolOr(options["extractPlanarFaces"], false);
  const double planar_min_area_percent = NumberOr(options["planarMinAreaPercent"], 5.0);
  const double planar_normal_tolerance_deg = NumberOr(options["planarNormalToleranceDeg"], 1.0);
  const double planar_distance_tolerance =
      NumberOr(options["planarDistanceTolerance"],
               std::numeric_limits<double>::quiet_NaN());

  auto source_index = [&](uint32_t offset) -> uint32_t {
    if (indices.empty()) return offset;
    return indices[offset];
  };
  auto source_point = [&](uint32_t index) -> Vec3 {
    if (index >= position_count) {
      throw std::runtime_error("MeshToBrep index is outside position range.");
    }
    const uint32_t base = index * 3;
    return {positions[base + 0], positions[base + 1], positions[base + 2]};
  };

  std::unordered_map<std::string, uint32_t> key_to_index;
  std::vector<Vec3> canonical_positions;
  std::vector<Triangle> triangles(tri_count);
  std::vector<Vec3> tri_normals(tri_count);
  const double q = weld_tolerance;

  auto canonical_index = [&](const Vec3& p) -> uint32_t {
    const std::string key = GridKey(p.x, p.y, p.z, q);
    const auto found = key_to_index.find(key);
    if (found != key_to_index.end()) return found->second;
    const uint32_t index = static_cast<uint32_t>(canonical_positions.size());
    const Vec3 rounded = q <= 0.0
        ? p
        : Vec3{std::round(p.x / q) * q, std::round(p.y / q) * q,
               std::round(p.z / q) * q};
    canonical_positions.push_back(rounded);
    key_to_index.emplace(key, index);
    return index;
  };

  for (uint32_t t = 0; t < tri_count; ++t) {
    const uint32_t ia = source_index(t * 3 + 0);
    const uint32_t ib = source_index(t * 3 + 1);
    const uint32_t ic = source_index(t * 3 + 2);
    const Vec3 pa = source_point(ia);
    const Vec3 pb = source_point(ib);
    const Vec3 pc = source_point(ic);
    triangles[t] = {canonical_index(pa), canonical_index(pb), canonical_index(pc)};

    Vec3 normal;
    if (normals.size() == positions.size()) {
      const uint32_t nb = ia * 3;
      normal = {normals[nb + 0], normals[nb + 1], normals[nb + 2]};
      if (Length(normal) > 0.0) {
        tri_normals[t] = Normalize(normal);
        continue;
      }
    }
    tri_normals[t] = Normalize(Cross(Subtract(pb, pa), Subtract(pc, pa)));
  }

  std::vector<Vec3> tri_geo_normals(tri_count);
  std::vector<double> tri_areas(tri_count, 0.0);
  double total_area = 0.0;
  for (uint32_t t = 0; t < tri_count; ++t) {
    const Triangle tri = triangles[t];
    const Vec3& pa = canonical_positions[tri.a];
    const Vec3& pb = canonical_positions[tri.b];
    const Vec3& pc = canonical_positions[tri.c];
    const Vec3 cross = Cross(Subtract(pb, pa), Subtract(pc, pa));
    const double len = Length(cross);
    const double area = 0.5 * len;
    tri_areas[t] = std::isfinite(area) ? area : 0.0;
    total_area += tri_areas[t];
    tri_geo_normals[t] = len > kTriEps ? Scale(cross, 1.0 / len) : tri_normals[t];
  }

  std::unordered_map<std::string, std::vector<uint32_t>> edge_to_tris;
  for (uint32_t t = 0; t < tri_count; ++t) {
    const Triangle tri = triangles[t];
    edge_to_tris[EdgeKey(tri.a, tri.b)].push_back(t);
    edge_to_tris[EdgeKey(tri.b, tri.c)].push_back(t);
    edge_to_tris[EdgeKey(tri.c, tri.a)].push_back(t);
  }

  std::vector<std::vector<uint32_t>> neighbors(tri_count);
  for (const auto& entry : edge_to_tris) {
    const std::vector<uint32_t>& list = entry.second;
    if (list.size() < 2) continue;
    for (size_t i = 0; i < list.size(); ++i) {
      for (size_t j = i + 1; j < list.size(); ++j) {
        neighbors[list[i]].push_back(list[j]);
        neighbors[list[j]].push_back(list[i]);
      }
    }
  }

  double min_x = std::numeric_limits<double>::infinity();
  double min_y = min_x;
  double min_z = min_x;
  double max_x = -min_x;
  double max_y = -min_x;
  double max_z = -min_x;
  for (const Vec3& p : canonical_positions) {
    min_x = std::min(min_x, p.x);
    min_y = std::min(min_y, p.y);
    min_z = std::min(min_z, p.z);
    max_x = std::max(max_x, p.x);
    max_y = std::max(max_y, p.y);
    max_z = std::max(max_z, p.z);
  }
  const double diag = std::hypot(max_x - min_x, max_y - min_y, max_z - min_z);
  const double max_angle_rad =
      std::max(0.0, face_deflection_angle) * 3.14159265358979323846 / 180.0;
  const double cos_thresh = std::cos(max_angle_rad);

  std::vector<std::string> tri_face_name(tri_count);
  std::unordered_set<std::string> auto_planar_face_names;
  uint32_t face_counter = 0;
  double planar_merge_cos = std::numeric_limits<double>::quiet_NaN();
  double planar_merge_dist_tol = std::numeric_limits<double>::quiet_NaN();

  if (extract_planar_faces && total_area > 0.0) {
    const double pct = std::max(0.0, std::min(100.0, planar_min_area_percent));
    const double min_planar_area = total_area * (pct / 100.0);
    if (min_planar_area > 0.0) {
      const double planar_cos = std::cos(
          std::max(0.0, planar_normal_tolerance_deg) *
          3.14159265358979323846 / 180.0);
      const double dist_tol = std::isfinite(planar_distance_tolerance)
          ? std::max(0.0, planar_distance_tolerance)
          : std::max({weld_tolerance * 4.0, diag * 1e-6, 1e-9});
      planar_merge_cos = planar_cos;
      planar_merge_dist_tol =
          std::max({dist_tol * 4.0, weld_tolerance * 8.0, diag * 4e-6, 1e-9});

      std::vector<double> smooth_group_areas(tri_count, 0.0);
      std::vector<uint8_t> visited_smooth(tri_count, 0);
      for (uint32_t seed = 0; seed < tri_count; ++seed) {
        if (visited_smooth[seed]) continue;
        std::vector<uint32_t> component;
        std::vector<uint32_t> queue{seed};
        size_t head = 0;
        double area_sum = 0.0;
        visited_smooth[seed] = 1;
        while (head < queue.size()) {
          const uint32_t t = queue[head++];
          component.push_back(t);
          area_sum += tri_areas[t];
          for (uint32_t nb : neighbors[t]) {
            if (visited_smooth[nb]) continue;
            if (NormalizedDot(tri_normals[t], tri_normals[nb]) >= cos_thresh) {
              visited_smooth[nb] = 1;
              queue.push_back(nb);
            }
          }
        }
        for (uint32_t t : component) smooth_group_areas[t] = area_sum;
      }

      std::vector<uint8_t> planar_locked(tri_count, 0);
      std::vector<uint32_t> planar_visit_token(tri_count, 0);
      uint32_t run_token = 1;
      const bool allow_local_planar_patches = pct <= 5.0;
      const double min_meaningful_patch_area = total_area * 0.00025;
      const double local_planar_area_fraction = 0.04;

      for (uint32_t seed = 0; seed < tri_count; ++seed) {
        if (planar_locked[seed] || tri_areas[seed] <= 0.0) continue;
        const Vec3 seed_normal = tri_geo_normals[seed];
        const Vec3 p0 = canonical_positions[triangles[seed].a];
        const double plane_d = -Dot(seed_normal, p0);
        run_token += 1;
        if (run_token == 0xffffffffu) {
          std::fill(planar_visit_token.begin(), planar_visit_token.end(), 0);
          run_token = 1;
        }
        std::vector<uint32_t> queue{seed};
        std::vector<uint32_t> component{seed};
        size_t head = 0;
        double area_sum = tri_areas[seed];
        planar_visit_token[seed] = run_token;

        auto tri_is_coplanar = [&](uint32_t tri_index) {
          if (std::abs(NormalizedDot(seed_normal, tri_geo_normals[tri_index])) <
              planar_cos) {
            return false;
          }
          const Triangle tri = triangles[tri_index];
          const Vec3 points[3] = {canonical_positions[tri.a],
                                  canonical_positions[tri.b],
                                  canonical_positions[tri.c]};
          for (const Vec3& p : points) {
            if (std::abs(Dot(seed_normal, p) + plane_d) > dist_tol) return false;
          }
          return true;
        };

        while (head < queue.size()) {
          const uint32_t t = queue[head++];
          for (uint32_t nb : neighbors[t]) {
            if (planar_locked[nb] || planar_visit_token[nb] == run_token) continue;
            planar_visit_token[nb] = run_token;
            if (!tri_is_coplanar(nb)) continue;
            component.push_back(nb);
            area_sum += tri_areas[nb];
            queue.push_back(nb);
          }
        }

        bool accept = area_sum >= min_planar_area;
        if (!accept && allow_local_planar_patches && component.size() >= 2 &&
            area_sum >= min_meaningful_patch_area &&
            smooth_group_areas[seed] > 0.0) {
          accept = area_sum >= smooth_group_areas[seed] * local_planar_area_fraction;
        }
        if (!accept) continue;

        const std::string face_name = "STL_FACE_" + std::to_string(++face_counter);
        auto_planar_face_names.insert(face_name);
        for (uint32_t t : component) {
          tri_face_name[t] = face_name;
          planar_locked[t] = 1;
        }
      }
    }
  }

  std::vector<uint8_t> visited(tri_count, 0);
  for (uint32_t t = 0; t < tri_count; ++t) {
    if (!tri_face_name[t].empty()) visited[t] = 1;
  }
  for (uint32_t seed = 0; seed < tri_count; ++seed) {
    if (visited[seed]) continue;
    const std::string face_name = "STL_FACE_" + std::to_string(++face_counter);
    std::vector<uint32_t> queue{seed};
    size_t head = 0;
    visited[seed] = 1;
    tri_face_name[seed] = face_name;
    while (head < queue.size()) {
      const uint32_t t = queue[head++];
      for (uint32_t nb : neighbors[t]) {
        if (visited[nb]) continue;
        if (NormalizedDot(tri_normals[t], tri_normals[nb]) >= cos_thresh) {
          visited[nb] = 1;
          tri_face_name[nb] = face_name;
          queue.push_back(nb);
        }
      }
    }
  }

  if (!auto_planar_face_names.empty() && std::isfinite(planar_merge_cos) &&
      std::isfinite(planar_merge_dist_tol)) {
    std::unordered_map<std::string, FaceStats> face_stats;
    for (uint32_t t = 0; t < tri_count; ++t) {
      FaceStats& stats = face_stats[tri_face_name[t]];
      const double area = tri_areas[t];
      stats.area += area;
      stats.normal = Add(stats.normal, Scale(tri_geo_normals[t], area));
      const Triangle tri = triangles[t];
      const Vec3& pa = canonical_positions[tri.a];
      const Vec3& pb = canonical_positions[tri.b];
      const Vec3& pc = canonical_positions[tri.c];
      stats.centroid = Add(stats.centroid, Scale(Add(Add(pa, pb), pc), area / 3.0));
      stats.triangles.push_back(t);
    }
    for (auto& entry : face_stats) {
      FaceStats& stats = entry.second;
      if (stats.area > 0.0) {
        stats.normal = Normalize(stats.normal);
        stats.centroid = Scale(stats.centroid, 1.0 / stats.area);
      }
    }

    UnionFind uf;
    auto plane_distance = [&](const FaceStats& stats, const Vec3& p) {
      return Dot(stats.normal, Subtract(p, stats.centroid));
    };
    auto face_is_planar_on = [&](const std::string& face_name,
                                 const FaceStats& plane_stats) {
      const auto found = face_stats.find(face_name);
      if (found == face_stats.end() || Length(found->second.normal) <= 0.0) {
        return false;
      }
      for (uint32_t tri_index : found->second.triangles) {
        const Triangle tri = triangles[tri_index];
        const Vec3 points[3] = {canonical_positions[tri.a],
                                canonical_positions[tri.b],
                                canonical_positions[tri.c]};
        for (const Vec3& p : points) {
          if (std::abs(plane_distance(plane_stats, p)) > planar_merge_dist_tol) {
            return false;
          }
        }
      }
      return true;
    };
    auto faces_are_coplanar = [&](const std::string& face_a,
                                  const std::string& face_b) {
      const auto a = face_stats.find(face_a);
      const auto b = face_stats.find(face_b);
      if (a == face_stats.end() || b == face_stats.end()) return false;
      if (Length(a->second.normal) <= 0.0 || Length(b->second.normal) <= 0.0) {
        return false;
      }
      if (std::abs(NormalizedDot(a->second.normal, b->second.normal)) <
          planar_merge_cos) {
        return false;
      }
      const double area_a = a->second.area;
      const double area_b = b->second.area;
      if (area_a > 0.0 && area_b > 0.0) {
        const std::string larger = area_a >= area_b ? face_a : face_b;
        const std::string smaller = larger == face_a ? face_b : face_a;
        const FaceStats& larger_stats =
            larger == face_a ? a->second : b->second;
        const FaceStats& smaller_stats =
            larger == face_a ? b->second : a->second;
        if (smaller_stats.area <= larger_stats.area * 0.2) {
          return face_is_planar_on(smaller, larger_stats);
        }
      }
      return face_is_planar_on(face_a, b->second) &&
             face_is_planar_on(face_b, a->second);
    };

    for (const auto& entry : edge_to_tris) {
      const std::vector<uint32_t>& list = entry.second;
      if (list.size() < 2) continue;
      for (size_t i = 0; i < list.size(); ++i) {
        for (size_t j = i + 1; j < list.size(); ++j) {
          const std::string& face_a = tri_face_name[list[i]];
          const std::string& face_b = tri_face_name[list[j]];
          if (face_a.empty() || face_b.empty() || face_a == face_b) continue;
          if (!auto_planar_face_names.count(face_a) &&
              !auto_planar_face_names.count(face_b)) {
            continue;
          }
          if (faces_are_coplanar(face_a, face_b)) uf.Union(face_a, face_b, face_stats);
        }
      }
    }

    std::unordered_set<std::string> merged_auto;
    for (uint32_t t = 0; t < tri_count; ++t) {
      tri_face_name[t] = uf.Find(tri_face_name[t]);
    }
    for (const std::string& name : auto_planar_face_names) {
      merged_auto.insert(uf.Find(name));
    }
    auto_planar_face_names.swap(merged_auto);
  }

  SnapshotBuilder builder;
  std::vector<uint32_t> snapshot_vertex_by_canonical(canonical_positions.size(), 0);
  for (uint32_t i = 0; i < canonical_positions.size(); ++i) {
    snapshot_vertex_by_canonical[i] = builder.AddVertex(canonical_positions[i]);
  }
  for (uint32_t t = 0; t < tri_count; ++t) {
    const std::string face_name =
        tri_face_name[t].empty() ? ("STL_FACE_" + std::to_string(face_counter + 1))
                                 : tri_face_name[t];
    const Triangle tri = triangles[t];
    builder.AddTriangleIndices(face_name, snapshot_vertex_by_canonical[tri.a],
                               snapshot_vertex_by_canonical[tri.b],
                               snapshot_vertex_by_canonical[tri.c]);
  }
  for (const std::string& face_name : auto_planar_face_names) {
    builder.SetFaceMetadata(face_name, PlanarMetadataJson());
  }
  return BuildSnapshot(builder);
}

}  // namespace manifoldplus
