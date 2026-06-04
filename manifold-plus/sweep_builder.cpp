#include "sweep_builder.h"

#include <manifold/manifold.h>
#include <manifold/polygon.h>

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

constexpr double kEps = 1e-12;
constexpr uint32_t kNumProp = 3;
constexpr double kPi = 3.141592653589793238462643383279502884;

struct Vec2 {
  double x = 0.0;
  double y = 0.0;
};

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct LoopData {
  std::vector<Vec3> pts;
  bool is_hole = false;
};

struct EdgeData {
  std::string name;
  std::vector<Vec3> polyline;
  std::string metadata_json;
};

struct Frame {
  Vec3 origin;
  Vec3 x;
  Vec3 y;
  Vec3 z;
  Vec3 tangent;
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

double ReadOptionalNumber(const emscripten::val& value, double fallback) {
  if (value.isUndefined() || value.isNull()) return fallback;
  const double number = value.as<double>();
  return std::isfinite(number) ? number : fallback;
}

std::string ReadString(const emscripten::val& value, const char* fallback) {
  if (value.isUndefined() || value.isNull()) return std::string(fallback);
  std::string out = value.as<std::string>();
  if (out.empty()) out = fallback;
  return out;
}

bool ReadBool(const emscripten::val& value, bool fallback = false) {
  if (value.isUndefined() || value.isNull()) return fallback;
  return value.as<bool>();
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

std::vector<Vec3> ReadOptionalPoints(const emscripten::val& values) {
  if (values.isUndefined() || values.isNull()) return {};
  return ReadPoints(values, "optionalPoints");
}

Vec3 ReadVec3(const emscripten::val& value, const char* label,
              const Vec3& fallback = {}) {
  if (value.isUndefined() || value.isNull()) return fallback;
  const double x = value[0].as<double>();
  const double y = value[1].as<double>();
  const double z = value[2].as<double>();
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) {
    throw std::runtime_error(std::string("Non-finite Vec3: ") + label);
  }
  return {x, y, z};
}

emscripten::val ToJsArray(const std::vector<float>& values) {
  emscripten::val array = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) array.set(i, values[i]);
  return array;
}

emscripten::val ToJsArray(const std::vector<uint32_t>& values) {
  emscripten::val array = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) array.set(i, values[i]);
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

emscripten::val ToMetadataEntries(
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

emscripten::val BuildSnapshot(
    const SnapshotBuilder& builder,
    const std::unordered_map<std::string, std::string>& face_metadata_json) {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", kNumProp);
  snapshot.set("vertProperties", ToJsArray(builder.vert_properties));
  snapshot.set("triVerts", ToJsArray(builder.tri_verts));
  snapshot.set("triIDs", ToJsArray(builder.tri_ids));
  snapshot.set("faceNameToID", ToFaceNameEntries(builder.face_name_to_id));
  snapshot.set("idToFaceName", ToFaceIdEntries(builder.id_to_face_name));
  snapshot.set("faceMetadataJson", ToMetadataEntries(face_metadata_json));
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount",
               static_cast<uint32_t>(builder.vert_properties.size() / 3));
  snapshot.set("triangleCount", static_cast<uint32_t>(builder.tri_ids.size()));
  return snapshot;
}

Vec3 Add(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 Subtract(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 Scale(const Vec3& value, double scalar) {
  return {value.x * scalar, value.y * scalar, value.z * scalar};
}

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

double LengthSq(const Vec3& value) { return Dot(value, value); }

double Length(const Vec3& value) { return std::sqrt(LengthSq(value)); }

Vec3 Normalize(const Vec3& value, const Vec3& fallback = {0.0, 0.0, 1.0}) {
  const double length = Length(value);
  if (!(length > kEps)) return fallback;
  return Scale(value, 1.0 / length);
}

double DistanceSq(const Vec3& a, const Vec3& b) { return LengthSq(Subtract(a, b)); }

Vec3 Lerp(const Vec3& a, const Vec3& b, double t) {
  return Add(a, Scale(Subtract(b, a), t));
}

Vec3 RotateAroundAxis(const Vec3& point, const Vec3& origin, const Vec3& axis,
                      double angle) {
  const Vec3 unit_axis = Normalize(axis, {0.0, 1.0, 0.0});
  const Vec3 p = Subtract(point, origin);
  const double cos_a = std::cos(angle);
  const double sin_a = std::sin(angle);
  const Vec3 term0 = Scale(p, cos_a);
  const Vec3 term1 = Scale(Cross(unit_axis, p), sin_a);
  const Vec3 term2 = Scale(unit_axis, Dot(unit_axis, p) * (1.0 - cos_a));
  return Add(origin, Add(term0, Add(term1, term2)));
}

double SignedArea2D(const std::vector<Vec2>& pts) {
  if (pts.size() < 3) return 0.0;
  double area = 0.0;
  for (size_t i = 0; i < pts.size(); ++i) {
    const Vec2& a = pts[i];
    const Vec2& b = pts[(i + 1) % pts.size()];
    area += a.x * b.y - b.x * a.y;
  }
  return 0.5 * area;
}

void DedupConsecutive(std::vector<Vec3>& pts) {
  if (pts.size() < 2) return;
  std::vector<Vec3> out;
  out.reserve(pts.size());
  out.push_back(pts.front());
  for (size_t i = 1; i < pts.size(); ++i) {
    if (DistanceSq(pts[i], out.back()) <= 1e-24) continue;
    out.push_back(pts[i]);
  }
  pts.swap(out);
}

void EnsureClosed(std::vector<Vec3>& pts) {
  if (pts.size() < 2) return;
  if (DistanceSq(pts.front(), pts.back()) > 1e-24) pts.push_back(pts.front());
}

std::vector<LoopData> ReadBoundaryLoops(const emscripten::val& values) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<LoopData> loops;
  loops.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val loop_val = values[i];
    if (loop_val.isUndefined() || loop_val.isNull()) continue;
    LoopData loop;
    loop.is_hole = ReadBool(loop_val["isHole"], false);
    loop.pts = ReadPoints(loop_val["pts"], "boundaryLoops[].pts");
    DedupConsecutive(loop.pts);
    if (loop.pts.size() >= 2 && DistanceSq(loop.pts.front(), loop.pts.back()) <= 1e-24) {
      loop.pts.pop_back();
    }
    if (loop.pts.size() >= 3) loops.push_back(std::move(loop));
  }
  return loops;
}

std::vector<EdgeData> ReadEdgeData(const emscripten::val& values) {
  if (values.isUndefined() || values.isNull()) return {};
  const uint32_t length = values["length"].as<uint32_t>();
  std::vector<EdgeData> edges;
  edges.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    const emscripten::val edge_val = values[i];
    if (edge_val.isUndefined() || edge_val.isNull()) continue;
    EdgeData edge;
    edge.name = ReadString(edge_val["name"], "EDGE_SW");
    edge.metadata_json = ReadString(edge_val["metadataJson"], "");
    edge.polyline = ReadPoints(edge_val["polyline"], "edges[].polyline");
    DedupConsecutive(edge.polyline);
    if (edge.polyline.size() >= 2) edges.push_back(std::move(edge));
  }
  return edges;
}

std::string QuantizedPointKey(const Vec3& point, double quantum = 1e-6) {
  const auto quantize = [quantum](double value) -> double {
    return std::round(value / quantum) * quantum;
  };
  std::ostringstream stream;
  stream.setf(std::ios::fixed);
  stream.precision(6);
  stream << quantize(point.x) << ',' << quantize(point.y) << ','
         << quantize(point.z);
  return stream.str();
}

std::unordered_map<std::string, std::unordered_set<std::string>>
BuildPointToEdgeNames(const std::vector<EdgeData>& edges) {
  std::unordered_map<std::string, std::unordered_set<std::string>> out;
  for (const EdgeData& edge : edges) {
    for (const Vec3& point : edge.polyline) {
      out[QuantizedPointKey(point)].insert(edge.name);
    }
  }
  return out;
}

std::unordered_map<std::string, std::string> BuildEdgeMetadataMap(
    const std::vector<EdgeData>& edges) {
  std::unordered_map<std::string, std::string> out;
  for (const EdgeData& edge : edges) {
    if (!edge.metadata_json.empty()) out[edge.name] = edge.metadata_json;
  }
  return out;
}

std::string ResolveSegmentFaceName(
    const Vec3& a, const Vec3& b, const std::string& fallback_name,
    const std::unordered_map<std::string, std::unordered_set<std::string>>&
        point_to_edge_names) {
  const auto found_a = point_to_edge_names.find(QuantizedPointKey(a));
  const auto found_b = point_to_edge_names.find(QuantizedPointKey(b));
  if (found_a == point_to_edge_names.end() || found_b == point_to_edge_names.end()) {
    return fallback_name;
  }
  for (const std::string& name : found_a->second) {
    if (found_b->second.count(name)) return name;
  }
  return fallback_name;
}

double TriangleArea(const Vec3& a, const Vec3& b, const Vec3& c) {
  return Length(Cross(Subtract(b, a), Subtract(c, a)));
}

void AddTriangleIfNonDegenerate(SnapshotBuilder& builder,
                                const std::string& face_name, const Vec3& a,
                                const Vec3& b, const Vec3& c) {
  if (!(TriangleArea(a, b, c) > 1e-18)) return;
  builder.AddTriangle(face_name, a, b, c);
}

void AddQuad(SnapshotBuilder& builder, const std::string& face_name,
             const Vec3& a0, const Vec3& b0, const Vec3& b1, const Vec3& a1,
             bool is_hole) {
  const double area_d1 = TriangleArea(a0, b0, b1) + TriangleArea(a0, b1, a1);
  const double area_d2 = TriangleArea(a0, b0, a1) + TriangleArea(b0, b1, a1);
  if (!(area_d1 > 1e-18 || area_d2 > 1e-18)) return;

  if (area_d2 > area_d1) {
    if (is_hole) {
      AddTriangleIfNonDegenerate(builder, face_name, a0, a1, b0);
      AddTriangleIfNonDegenerate(builder, face_name, b0, a1, b1);
    } else {
      AddTriangleIfNonDegenerate(builder, face_name, a0, b0, a1);
      AddTriangleIfNonDegenerate(builder, face_name, b0, b1, a1);
    }
  } else {
    if (is_hole) {
      AddTriangleIfNonDegenerate(builder, face_name, a0, b1, b0);
      AddTriangleIfNonDegenerate(builder, face_name, a0, a1, b1);
    } else {
      AddTriangleIfNonDegenerate(builder, face_name, a0, b0, b1);
      AddTriangleIfNonDegenerate(builder, face_name, a0, b1, a1);
    }
  }
}

double DistanceSqToAxis(const Vec3& point, const Vec3& origin,
                        const Vec3& unit_axis) {
  const Vec3 v = Subtract(point, origin);
  const Vec3 axial = Scale(unit_axis, Dot(v, unit_axis));
  return LengthSq(Subtract(v, axial));
}

Vec3 RotateAroundAxisSnappingAxisPoint(const Vec3& point, const Vec3& origin,
                                       const Vec3& unit_axis, double angle) {
  if (DistanceSqToAxis(point, origin, unit_axis) <= 1e-18) return point;
  return RotateAroundAxis(point, origin, unit_axis, angle);
}

Vec3 ComputeCentroid(const std::vector<Vec3>& pts) {
  if (pts.empty()) return {};
  Vec3 out{};
  for (const Vec3& point : pts) out = Add(out, point);
  return Scale(out, 1.0 / static_cast<double>(pts.size()));
}

struct Basis3 {
  Vec3 origin;
  Vec3 u;
  Vec3 v;
  Vec3 n;
};

Basis3 ComputeLoopBasis(const std::vector<LoopData>& loops, const Vec3& normal) {
  std::vector<Vec3> outer_pts;
  for (const LoopData& loop : loops) {
    if (!loop.is_hole && loop.pts.size() >= 3) {
      outer_pts = loop.pts;
      break;
    }
  }
  if (outer_pts.empty() && !loops.empty()) outer_pts = loops.front().pts;

  Vec3 n = Normalize(normal, {0.0, 0.0, 1.0});
  Vec3 origin = ComputeCentroid(outer_pts);
  Vec3 anchor = outer_pts.empty() ? Add(origin, {1.0, 0.0, 0.0}) : outer_pts.front();
  double best_d2 = -1.0;
  for (const Vec3& point : outer_pts) {
    const double d2 = DistanceSq(point, origin);
    if (d2 > best_d2) {
      best_d2 = d2;
      anchor = point;
    }
  }
  Vec3 x = Subtract(anchor, origin);
  x = Subtract(x, Scale(n, Dot(x, n)));
  if (!(LengthSq(x) > 1e-12)) {
    x = {1.0, 0.0, 0.0};
    if (std::abs(Dot(x, n)) > 0.9) x = {0.0, 1.0, 0.0};
    x = Subtract(x, Scale(n, Dot(x, n)));
  }
  x = Normalize(x, {1.0, 0.0, 0.0});
  Vec3 y = Normalize(Cross(n, x), {0.0, 1.0, 0.0});
  x = Normalize(Cross(y, n), {1.0, 0.0, 0.0});
  return {origin, x, y, n};
}

Vec2 ProjectToBasis(const Vec3& point, const Basis3& basis) {
  const Vec3 delta = Subtract(point, basis.origin);
  return {Dot(delta, basis.u), Dot(delta, basis.v)};
}

void AddCapFromLoops(SnapshotBuilder& builder, const std::string& face_name,
                     const std::vector<LoopData>& loops,
                     const Basis3& projection_basis,
                     const std::vector<Frame>* frames, int frame_index,
                     bool reverse_winding) {
  manifold::Polygons polygons;
  std::vector<Vec3> all_points;
  polygons.reserve(loops.size());

  for (const LoopData& loop : loops) {
    if (loop.pts.size() < 3) continue;
    std::vector<Vec3> pts = loop.pts;
    DedupConsecutive(pts);
    if (pts.size() >= 2 && DistanceSq(pts.front(), pts.back()) <= 1e-24) pts.pop_back();
    if (pts.size() < 3) continue;

    manifold::SimplePolygon polygon;
    polygon.reserve(pts.size());
    std::vector<Vec2> projected;
    projected.reserve(pts.size());

    for (const Vec3& point : pts) {
      Vec3 mapped = point;
      if (frames) {
        const Frame& frame = (*frames)[std::max(0, frame_index)];
        const Vec2 uv = ProjectToBasis(point, projection_basis);
        mapped = Add(frame.origin,
                     Add(Scale(frame.x, uv.x), Scale(frame.y, uv.y)));
      }
      const Vec2 uv = frames ? Vec2{Dot(Subtract(mapped, (*frames)[std::max(0, frame_index)].origin),
                                        (*frames)[std::max(0, frame_index)].x),
                                    Dot(Subtract(mapped, (*frames)[std::max(0, frame_index)].origin),
                                        (*frames)[std::max(0, frame_index)].y)}
                            : ProjectToBasis(mapped, projection_basis);
      projected.push_back(uv);
      polygon.push_back({static_cast<float>(uv.x), static_cast<float>(uv.y)});
      all_points.push_back(mapped);
    }

    double area = SignedArea2D(projected);
    const bool should_be_ccw = !loop.is_hole;
    if ((should_be_ccw && area < 0.0) || (!should_be_ccw && area > 0.0)) {
      std::reverse(polygon.begin(), polygon.end());
      std::reverse(projected.begin(), projected.end());
      std::reverse(all_points.end() - static_cast<long>(pts.size()), all_points.end());
    }
    polygons.push_back(std::move(polygon));
  }

  if (polygons.empty()) return;
  const std::vector<manifold::ivec3> tris = manifold::Triangulate(polygons);
  for (const manifold::ivec3& tri : tris) {
    const Vec3& a = all_points[tri[0]];
    const Vec3& b = all_points[tri[1]];
    const Vec3& c = all_points[tri[2]];
    if (reverse_winding) builder.AddTriangle(face_name, a, c, b);
    else builder.AddTriangle(face_name, a, b, c);
  }
}

std::vector<Vec3> ComputeTangents(const std::vector<Vec3>& path) {
  std::vector<Vec3> tangents(path.size(), {0.0, 0.0, 1.0});
  if (path.size() < 2) return tangents;
  for (size_t i = 0; i < path.size(); ++i) {
    Vec3 tangent{};
    if (i == 0) tangent = Subtract(path[1], path[0]);
    else if (i + 1 == path.size()) tangent = Subtract(path[i], path[i - 1]);
    else {
      const Vec3 prev = Normalize(Subtract(path[i], path[i - 1]), {0.0, 0.0, 1.0});
      const Vec3 next = Normalize(Subtract(path[i + 1], path[i]), {0.0, 0.0, 1.0});
      tangent = Add(prev, next);
    }
    tangents[i] = Normalize(tangent, {0.0, 0.0, 1.0});
  }
  return tangents;
}

std::vector<Frame> ComputeFrames(const std::vector<Vec3>& path,
                                 const Basis3& basis, double twist_degrees) {
  std::vector<Frame> frames;
  if (path.size() < 2) return frames;

  std::vector<Vec3> tangents = ComputeTangents(path);
  Vec3 x = basis.u;
  Vec3 y = basis.v;
  Vec3 z = basis.n;
  if (Dot(z, tangents.front()) < 0.0) {
    z = Scale(z, -1.0);
    y = Scale(y, -1.0);
  }

  frames.reserve(path.size());
  frames.push_back({path.front(), x, y, z, tangents.front()});

  for (size_t i = 1; i < path.size(); ++i) {
    const Vec3 prev_t = tangents[i - 1];
    const Vec3 t = tangents[i];
    Vec3 axis = Cross(prev_t, t);
    const double sin_angle = Length(axis);
    const double cos_angle = std::max(-1.0, std::min(1.0, Dot(prev_t, t)));
    if (sin_angle < kEps) {
      if (cos_angle < 0.0) {
        Vec3 rot_axis = Subtract(x, Scale(prev_t, Dot(x, prev_t)));
        if (!(LengthSq(rot_axis) > kEps)) {
          rot_axis = Subtract(y, Scale(prev_t, Dot(y, prev_t)));
        }
        rot_axis = Normalize(rot_axis, {1.0, 0.0, 0.0});
        const double angle = kPi;
        const auto rotate = [&](const Vec3& value) {
          const Vec3 v_par = Scale(rot_axis, Dot(value, rot_axis));
          const Vec3 v_perp = Subtract(value, v_par);
          const Vec3 cross = Cross(rot_axis, value);
          return Add(v_par, Add(Scale(v_perp, std::cos(angle)),
                                Scale(cross, std::sin(angle))));
        };
        x = rotate(x);
        y = rotate(y);
        z = rotate(z);
      }
    } else {
      axis = Normalize(axis, {0.0, 0.0, 1.0});
      const double angle = std::atan2(sin_angle, cos_angle);
      const auto rotate = [&](const Vec3& value) {
        const Vec3 v_par = Scale(axis, Dot(value, axis));
        const Vec3 v_perp = Subtract(value, v_par);
        const Vec3 cross = Cross(axis, value);
        return Add(v_par, Add(Scale(v_perp, std::cos(angle)),
                              Scale(cross, std::sin(angle))));
      };
      x = rotate(x);
      y = rotate(y);
      z = rotate(z);
    }
    frames.push_back({path[i], x, y, z, tangents[i]});
  }

  double lock_u = 0.0;
  double lock_v = 0.0;
  if (!frames.empty()) {
    std::vector<Vec3> outer_pts;
    lock_u = 0.0;
    lock_v = 0.0;
    if (LengthSq(basis.u) > kEps || LengthSq(basis.v) > kEps) {
      Vec3 anchor = Add(basis.origin, basis.u);
      const Vec2 uv = ProjectToBasis(anchor, basis);
      lock_u = uv.x;
      lock_v = uv.y;
    }
  }

  if ((lock_u * lock_u + lock_v * lock_v) > 1e-20) {
    for (size_t i = 1; i < frames.size(); ++i) {
      const Vec3 prev_vec = Add(Scale(frames[i - 1].x, lock_u),
                                Scale(frames[i - 1].y, lock_v));
      const Vec3 curr_vec = Add(Scale(frames[i].x, lock_u),
                                Scale(frames[i].y, lock_v));
      if (LengthSq(prev_vec) > 1e-24 && LengthSq(curr_vec) > 1e-24 &&
          Dot(Normalize(prev_vec), Normalize(curr_vec)) < 0.0) {
        frames[i].x = Scale(frames[i].x, -1.0);
        frames[i].y = Scale(frames[i].y, -1.0);
        frames[i].z = Scale(frames[i].z, -1.0);
      }
    }
  }

  const double twist_radians =
      std::isfinite(twist_degrees) ? (twist_degrees * kPi / 180.0) : 0.0;
  if (std::abs(twist_radians) > 1e-12 && frames.size() >= 2) {
    std::vector<double> cumulative(path.size(), 0.0);
    double total_length = 0.0;
    for (size_t i = 1; i < path.size(); ++i) {
      total_length += Length(Subtract(path[i], path[i - 1]));
      cumulative[i] = total_length;
    }
    const double inv_total = total_length > 1e-12 ? 1.0 / total_length : 0.0;
    const double denom = std::max<size_t>(1, frames.size() - 1);
    for (size_t i = 0; i < frames.size(); ++i) {
      const double frac = inv_total > 0.0 ? cumulative[i] * inv_total
                                          : static_cast<double>(i) / denom;
      const double angle = twist_radians * frac;
      if (std::abs(angle) <= 1e-12) continue;
      const Vec3 axis = Normalize(frames[i].tangent, {0.0, 0.0, 1.0});
      const auto rotate = [&](const Vec3& value) {
        const Vec3 v_par = Scale(axis, Dot(value, axis));
        const Vec3 v_perp = Subtract(value, v_par);
        const Vec3 cross = Cross(axis, value);
        return Add(v_par, Add(Scale(v_perp, std::cos(angle)),
                              Scale(cross, std::sin(angle))));
      };
      frames[i].x = rotate(frames[i].x);
      frames[i].y = rotate(frames[i].y);
      frames[i].z = rotate(frames[i].z);
    }
  }

  return frames;
}

Vec3 PlaceAtFrame(const Vec3& point, const Basis3& basis, const Frame& frame) {
  const Vec2 uv = ProjectToBasis(point, basis);
  return Add(frame.origin, Add(Scale(frame.x, uv.x), Scale(frame.y, uv.y)));
}

double ComputeSuggestedEpsilon(const SnapshotBuilder& builder) {
  if (builder.vert_properties.size() < 6) return 1e-6;
  double min_x = std::numeric_limits<double>::infinity();
  double min_y = std::numeric_limits<double>::infinity();
  double min_z = std::numeric_limits<double>::infinity();
  double max_x = -std::numeric_limits<double>::infinity();
  double max_y = -std::numeric_limits<double>::infinity();
  double max_z = -std::numeric_limits<double>::infinity();
  for (size_t i = 0; i + 2 < builder.vert_properties.size(); i += 3) {
    min_x = std::min<double>(min_x, builder.vert_properties[i + 0]);
    min_y = std::min<double>(min_y, builder.vert_properties[i + 1]);
    min_z = std::min<double>(min_z, builder.vert_properties[i + 2]);
    max_x = std::max<double>(max_x, builder.vert_properties[i + 0]);
    max_y = std::max<double>(max_y, builder.vert_properties[i + 1]);
    max_z = std::max<double>(max_z, builder.vert_properties[i + 2]);
  }
  const double dx = max_x - min_x;
  const double dy = max_y - min_y;
  const double dz = max_z - min_z;
  const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  return std::min(1e-4, std::max(1e-7, diag * 1e-6));
}

std::string FaceTypeJson(const char* face_type) {
  std::ostringstream json;
  json << "{\"faceType\":\"" << face_type << "\"}";
  return json.str();
}

}  // namespace

emscripten::val BuildSweepAuthoringState(const emscripten::val& options) {
  const std::string name = ReadString(options["name"], "Sweep");
  const std::string face_name = ReadString(options["faceName"], "Face");
  const std::string mode = ReadString(options["mode"], "translate");
  const double distance = ReadOptionalNumber(options["distance"], 0.0);
  const Vec3 distance_vector = ReadVec3(options["distanceVector"], "distanceVector");
  const double distance_back = ReadOptionalNumber(options["distanceBack"], 0.0);
  const bool omit_base_cap = ReadBool(options["omitBaseCap"], false);
  const double twist_angle = ReadOptionalNumber(options["twistAngle"], 0.0);
  const Vec3 face_normal =
      Normalize(ReadVec3(options["faceNormal"], "faceNormal", {0.0, 0.0, 1.0}),
                {0.0, 0.0, 1.0});
  std::vector<LoopData> boundary_loops = ReadBoundaryLoops(options["boundaryLoops"]);
  if (boundary_loops.empty()) {
    throw std::runtime_error("buildSweepAuthoringState requires boundaryLoops.");
  }
  std::vector<EdgeData> edges = ReadEdgeData(options["edges"]);
  std::vector<Vec3> path_points = ReadOptionalPoints(options["pathPoints"]);
  DedupConsecutive(path_points);

  SnapshotBuilder builder;
  std::unordered_map<std::string, std::string> face_metadata_json;

  const std::string feature_tag = name.empty() ? std::string() : (name + ":");
  const std::string start_name = feature_tag + face_name + "_START";
  const std::string end_name = feature_tag + face_name + "_END";
  const std::string default_side_name = feature_tag + face_name + "_SW";
  face_metadata_json[start_name] = FaceTypeJson("STARTCAP");
  face_metadata_json[end_name] = FaceTypeJson("ENDCAP");

  const auto point_to_edge_names = BuildPointToEdgeNames(edges);
  const auto edge_metadata_json = BuildEdgeMetadataMap(edges);

  bool do_path_sweep = path_points.size() >= 2;

  std::vector<Vec3> offsets;
  Vec3 dir_f = distance_vector;
  Vec3 dir_b{};
  if (do_path_sweep) {
    const Vec3 base = path_points.front();
    offsets.reserve(path_points.size());
    for (const Vec3& point : path_points) offsets.push_back(Subtract(point, base));
    std::vector<Vec3> filtered_offsets;
    filtered_offsets.reserve(offsets.size());
    filtered_offsets.push_back(offsets.front());
    for (size_t i = 1; i < offsets.size(); ++i) {
      if (DistanceSq(offsets[i], filtered_offsets.back()) > 1e-14) {
        filtered_offsets.push_back(offsets[i]);
      }
    }
    offsets.swap(filtered_offsets);
    if (offsets.size() >= 2) {
      dir_f = offsets.back();
      do_path_sweep = true;
    } else {
      do_path_sweep = false;
    }
  } else if (LengthSq(dir_f) <= kEps) {
    dir_f = Scale(face_normal, distance);
  }

  const bool two_sided = !do_path_sweep && std::abs(distance_back) > 1e-12;
  if (two_sided) dir_b = Scale(face_normal, -distance_back);

  const Basis3 basis = ComputeLoopBasis(boundary_loops, face_normal);
  std::vector<Frame> frames;
  if (do_path_sweep && mode == "pathAlign") {
    frames = ComputeFrames(path_points, basis, twist_angle);
    if (frames.size() < 2) {
      throw std::runtime_error(
          "buildSweepAuthoringState could not construct pathAlign frames.");
    }
  }

  if (do_path_sweep && mode == "pathAlign") {
    AddCapFromLoops(builder, start_name, boundary_loops, basis, &frames, 0, true);
    AddCapFromLoops(builder, end_name, boundary_loops, basis, &frames,
                    static_cast<int>(frames.size() - 1), false);
  } else {
    if (!omit_base_cap) {
      std::vector<LoopData> start_loops = boundary_loops;
      if (two_sided) {
        for (LoopData& loop : start_loops) {
          for (Vec3& point : loop.pts) point = Add(point, dir_b);
        }
      }
      AddCapFromLoops(builder, start_name, start_loops, basis, nullptr, 0, true);
    }

    std::vector<LoopData> end_loops = boundary_loops;
    for (LoopData& loop : end_loops) {
      for (Vec3& point : loop.pts) point = Add(point, dir_f);
    }
    const bool end_is_base = LengthSq(dir_f) <= 1e-20;
    if (!(omit_base_cap && end_is_base)) {
      AddCapFromLoops(builder, end_name, end_loops, basis, nullptr, 0, false);
    }
  }

  for (const LoopData& loop_in : boundary_loops) {
    std::vector<Vec3> base = loop_in.pts;
    EnsureClosed(base);
    DedupConsecutive(base);
    if (base.size() < 2) continue;
    const bool is_hole = loop_in.is_hole;

    if (!do_path_sweep) {
      if (two_sided) {
        for (size_t i = 0; i + 1 < base.size(); ++i) {
          const Vec3& a = base[i];
          const Vec3& b = base[i + 1];
          if (DistanceSq(a, b) <= 1e-24) continue;
          const std::string face_name_for_seg =
              ResolveSegmentFaceName(a, b, default_side_name, point_to_edge_names);
          face_metadata_json.try_emplace(face_name_for_seg,
                                         edge_metadata_json.count(face_name_for_seg)
                                             ? edge_metadata_json.at(face_name_for_seg)
                                             : FaceTypeJson("SIDEWALL"));
          const Vec3 a0 = Add(a, dir_b);
          const Vec3 b0 = Add(b, dir_b);
          const Vec3 a1 = Add(a, dir_f);
          const Vec3 b1 = Add(b, dir_f);
          AddQuad(builder, face_name_for_seg, a0, b0, b1, a1, is_hole);
        }
      } else {
        for (size_t i = 0; i + 1 < base.size(); ++i) {
          const Vec3& a = base[i];
          const Vec3& b = base[i + 1];
          if (DistanceSq(a, b) <= 1e-24) continue;
          const std::string face_name_for_seg =
              ResolveSegmentFaceName(a, b, default_side_name, point_to_edge_names);
          face_metadata_json.try_emplace(face_name_for_seg,
                                         edge_metadata_json.count(face_name_for_seg)
                                             ? edge_metadata_json.at(face_name_for_seg)
                                             : FaceTypeJson("SIDEWALL"));
          const Vec3 a1 = Add(a, dir_f);
          const Vec3 b1 = Add(b, dir_f);
          if (is_hole) {
            builder.AddTriangle(face_name_for_seg, a, b1, b);
            builder.AddTriangle(face_name_for_seg, a, a1, b1);
          } else {
            builder.AddTriangle(face_name_for_seg, a, b, b1);
            builder.AddTriangle(face_name_for_seg, a, b1, a1);
          }
        }
      }
      continue;
    }

    if (mode == "pathAlign") {
      for (size_t seg = 0; seg + 1 < frames.size(); ++seg) {
        const Frame& frame0 = frames[seg];
        const Frame& frame1 = frames[seg + 1];
        for (size_t i = 0; i + 1 < base.size(); ++i) {
          const Vec3& a = base[i];
          const Vec3& b = base[i + 1];
          if (DistanceSq(a, b) <= 1e-24) continue;
          const std::string face_name_for_seg =
              ResolveSegmentFaceName(a, b, default_side_name, point_to_edge_names);
          face_metadata_json.try_emplace(face_name_for_seg,
                                         edge_metadata_json.count(face_name_for_seg)
                                             ? edge_metadata_json.at(face_name_for_seg)
                                             : FaceTypeJson("SIDEWALL"));
          const Vec3 a0 = PlaceAtFrame(a, basis, frame0);
          const Vec3 b0 = PlaceAtFrame(b, basis, frame0);
          const Vec3 a1 = PlaceAtFrame(a, basis, frame1);
          const Vec3 b1 = PlaceAtFrame(b, basis, frame1);
          AddQuad(builder, face_name_for_seg, a0, b0, b1, a1, is_hole);
        }
      }
    } else {
      for (size_t seg = 0; seg + 1 < offsets.size(); ++seg) {
        const Vec3 off0 = offsets[seg];
        const Vec3 off1 = offsets[seg + 1];
        if (DistanceSq(off0, off1) <= 1e-24) continue;
        for (size_t i = 0; i + 1 < base.size(); ++i) {
          const Vec3& a = base[i];
          const Vec3& b = base[i + 1];
          if (DistanceSq(a, b) <= 1e-24) continue;
          const std::string face_name_for_seg =
              ResolveSegmentFaceName(a, b, default_side_name, point_to_edge_names);
          face_metadata_json.try_emplace(face_name_for_seg,
                                         edge_metadata_json.count(face_name_for_seg)
                                             ? edge_metadata_json.at(face_name_for_seg)
                                             : FaceTypeJson("SIDEWALL"));
          const Vec3 a0 = Add(a, off0);
          const Vec3 b0 = Add(b, off0);
          const Vec3 a1 = Add(a, off1);
          const Vec3 b1 = Add(b, off1);
          AddQuad(builder, face_name_for_seg, a0, b0, b1, a1, is_hole);
        }
      }
    }
  }

  emscripten::val snapshot = BuildSnapshot(builder, face_metadata_json);
  snapshot.set("suggestedEpsilon", ComputeSuggestedEpsilon(builder));
  snapshot.set("nativeKernel", true);
  snapshot.set("nativeSource", std::string("buildSweepAuthoringState"));
  return snapshot;
}

emscripten::val BuildRevolveAuthoringState(const emscripten::val& options) {
  const std::string name = ReadString(options["name"], "Revolve");
  const std::string face_name = ReadString(options["faceName"], "Face");
  const Vec3 axis_origin = ReadVec3(options["axisOrigin"], "axisOrigin");
  const Vec3 axis_direction =
      Normalize(ReadVec3(options["axisDirection"], "axisDirection"),
                {0.0, 1.0, 0.0});
  const double angle = ReadOptionalNumber(options["angle"], 360.0);
  const double raw_resolution = ReadOptionalNumber(options["resolution"], 64.0);
  const Vec3 face_normal =
      Normalize(ReadVec3(options["faceNormal"], "faceNormal", {0.0, 0.0, 1.0}),
                {0.0, 0.0, 1.0});
  std::vector<LoopData> boundary_loops = ReadBoundaryLoops(options["boundaryLoops"]);
  if (boundary_loops.empty()) {
    throw std::runtime_error("buildRevolveAuthoringState requires boundaryLoops.");
  }
  std::vector<EdgeData> edges = ReadEdgeData(options["edges"]);

  SnapshotBuilder builder;
  std::unordered_map<std::string, std::string> face_metadata_json;

  const double sweep_rad = -(angle * kPi / 180.0);
  const int base_resolution =
      std::max(3, static_cast<int>(std::floor(std::abs(raw_resolution))));
  const int steps =
      std::max(3, static_cast<int>(std::ceil((std::abs(angle) / 360.0) *
                                             static_cast<double>(base_resolution))));
  const double d_angle = sweep_rad / static_cast<double>(steps);
  const double full_turns = std::abs(angle) / 360.0;
  const bool is_closed_revolution =
      std::abs(angle) > 1e-9 &&
      std::abs(full_turns - std::round(full_turns)) <= 1e-9;
  const std::string start_name = face_name + "_START";
  const std::string end_name = face_name + "_END";
  const std::string default_side_name = face_name + "_RV";
  face_metadata_json[start_name] = FaceTypeJson("STARTCAP");
  face_metadata_json[end_name] = FaceTypeJson("ENDCAP");

  const auto point_to_edge_names = BuildPointToEdgeNames(edges);
  const auto edge_metadata_json = BuildEdgeMetadataMap(edges);

  if (std::abs(angle) < 360.0 - 1e-6) {
    const Basis3 start_basis = ComputeLoopBasis(boundary_loops, face_normal);
    AddCapFromLoops(builder, start_name, boundary_loops, start_basis, nullptr, 0,
                    true);

    std::vector<LoopData> end_loops = boundary_loops;
    for (LoopData& loop : end_loops) {
      for (Vec3& point : loop.pts) {
        point = RotateAroundAxisSnappingAxisPoint(point, axis_origin,
                                                  axis_direction, sweep_rad);
      }
    }
    const Vec3 end_normal = RotateAroundAxis(Add(axis_origin, face_normal),
                                             axis_origin, axis_direction,
                                             sweep_rad);
    const Basis3 end_basis =
        ComputeLoopBasis(end_loops, Normalize(Subtract(end_normal, axis_origin),
                                              face_normal));
    AddCapFromLoops(builder, end_name, end_loops, end_basis, nullptr, 0, false);
  }

  for (const LoopData& loop_in : boundary_loops) {
    std::vector<Vec3> base = loop_in.pts;
    EnsureClosed(base);
    DedupConsecutive(base);
    if (base.size() < 2) continue;
    const bool is_hole = loop_in.is_hole;
    for (size_t i = 0; i + 1 < base.size(); ++i) {
      const Vec3& a = base[i];
      const Vec3& b = base[i + 1];
      if (DistanceSq(a, b) <= 1e-24) continue;
      const bool a_on_axis =
          DistanceSqToAxis(a, axis_origin, axis_direction) <= 1e-18;
      const bool b_on_axis =
          DistanceSqToAxis(b, axis_origin, axis_direction) <= 1e-18;
      if (a_on_axis && b_on_axis) continue;
      const std::string face_name_for_seg =
          ResolveSegmentFaceName(a, b, default_side_name, point_to_edge_names);
      face_metadata_json.try_emplace(face_name_for_seg,
                                     edge_metadata_json.count(face_name_for_seg)
                                         ? edge_metadata_json.at(face_name_for_seg)
                                         : FaceTypeJson("SIDEWALL"));
      double ang0 = 0.0;
      for (int s = 0; s < steps; ++s, ang0 += d_angle) {
        const double ang1 = (s == steps - 1) ? sweep_rad : (ang0 + d_angle);
        const bool snap_final_ring = is_closed_revolution && s == steps - 1;
        const Vec3 a0 = a_on_axis
                            ? a
                            : RotateAroundAxis(a, axis_origin, axis_direction,
                                               ang0);
        const Vec3 a1 = snap_final_ring
                            ? a
                            : (a_on_axis
                                   ? a
                                   : RotateAroundAxis(a, axis_origin,
                                                      axis_direction, ang1));
        const Vec3 b0 = b_on_axis
                            ? b
                            : RotateAroundAxis(b, axis_origin, axis_direction,
                                               ang0);
        const Vec3 b1 = snap_final_ring
                            ? b
                            : (b_on_axis
                                   ? b
                                   : RotateAroundAxis(b, axis_origin,
                                                      axis_direction, ang1));
        AddQuad(builder, face_name_for_seg, a0, b0, b1, a1, is_hole);
      }
    }
  }

  emscripten::val snapshot = BuildSnapshot(builder, face_metadata_json);
  snapshot.set("suggestedEpsilon", 1e-6);
  snapshot.set("nativeKernel", true);
  snapshot.set("nativeSource", std::string("buildRevolveAuthoringState"));
  return snapshot;
}

}  // namespace manifoldplus
