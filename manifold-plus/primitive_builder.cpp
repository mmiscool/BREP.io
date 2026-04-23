#include "primitive_builder.h"

#include <manifold/manifold.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace manifoldplus {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTau = 2.0 * kPi;
constexpr double kEps = 1e-9;
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
  std::vector<std::pair<std::string, uint32_t>> face_entries;
  std::vector<std::pair<uint32_t, std::string>> reverse_face_entries;
  std::vector<std::pair<std::string, std::string>> face_metadata_json;

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

  void AddTriangle(const std::string& face_name, const Vec3& a, const Vec3& b,
                   const Vec3& c) {
    const uint32_t face_id = EnsureFaceID(face_name);
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
  const double length_sq = LengthSq(v);
  if (!(length_sq > kEps * kEps)) return {0.0, 0.0, 0.0};
  return Scale(v, 1.0 / std::sqrt(length_sq));
}

Vec3 Average4(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d) {
  return Scale(Add(Add(a, b), Add(c, d)), 0.25);
}

Vec3 RotateZupToYup(const Vec3& point) {
  return {point.x, point.z, -point.y};
}

void AddTriangleOriented(SnapshotBuilder& builder, const std::string& face_name,
                         const Vec3& a, const Vec3& b, const Vec3& c,
                         const Vec3& outward_dir) {
  if (LengthSq(outward_dir) <= kEps * kEps) {
    builder.AddTriangle(face_name, a, b, c);
    return;
  }
  const Vec3 normal = Cross(Subtract(b, a), Subtract(c, a));
  if (Dot(normal, outward_dir) < 0.0) {
    builder.AddTriangle(face_name, a, c, b);
  } else {
    builder.AddTriangle(face_name, a, b, c);
  }
}

void AddQuadOriented(SnapshotBuilder& builder, const std::string& face_name,
                     const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d,
                     const Vec3& outward_dir) {
  AddTriangleOriented(builder, face_name, a, b, c, outward_dir);
  AddTriangleOriented(builder, face_name, a, c, d, outward_dir);
}

std::string CylindricalMetadataJson(double radius, double height) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"type\":\"cylindrical\",\"radius\":" << radius
       << ",\"height\":" << height
       << ",\"axis\":[0,1,0],\"center\":[0," << (height * 0.5) << ",0]}";
  return json.str();
}

std::string ConicalMetadataJson(double radius_bottom, double radius_top,
                                double height) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"type\":\"conical\",\"radiusBottom\":" << radius_bottom
       << ",\"radiusTop\":" << radius_top
       << ",\"height\":" << height
       << ",\"axis\":[0,1,0],\"center\":[0," << (height * 0.5) << ",0]}";
  return json.str();
}

std::string SphericalMetadataJson(double radius) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"type\":\"spherical\",\"radius\":" << radius
       << ",\"center\":[0,0,0]}";
  return json.str();
}

std::string ToroidalMetadataJson(double major_radius, double tube_radius) {
  std::ostringstream json;
  json.precision(std::numeric_limits<double>::max_digits10);
  json << "{\"type\":\"toroidal\",\"majorRadius\":" << major_radius
       << ",\"tubeRadius\":" << tube_radius
       << ",\"axis\":[0,1,0],\"center\":[0,0,0]}";
  return json.str();
}

void BuildCube(const emscripten::val& options, SnapshotBuilder& builder,
               const std::string& name) {
  const double x = ReadFiniteNumber(options["x"], "x");
  const double y = ReadFiniteNumber(options["y"], "y");
  const double z = ReadFiniteNumber(options["z"], "z");

  const Vec3 p000{0.0, 0.0, 0.0};
  const Vec3 p100{x, 0.0, 0.0};
  const Vec3 p010{0.0, y, 0.0};
  const Vec3 p110{x, y, 0.0};
  const Vec3 p001{0.0, 0.0, z};
  const Vec3 p101{x, 0.0, z};
  const Vec3 p011{0.0, y, z};
  const Vec3 p111{x, y, z};

  AddTriangleOriented(builder, name + "_NX", p000, p001, p011, {-1.0, 0.0, 0.0});
  AddTriangleOriented(builder, name + "_NX", p000, p011, p010, {-1.0, 0.0, 0.0});
  AddTriangleOriented(builder, name + "_PX", p100, p110, p111, {1.0, 0.0, 0.0});
  AddTriangleOriented(builder, name + "_PX", p100, p111, p101, {1.0, 0.0, 0.0});
  AddTriangleOriented(builder, name + "_NY", p000, p100, p101, {0.0, -1.0, 0.0});
  AddTriangleOriented(builder, name + "_NY", p000, p101, p001, {0.0, -1.0, 0.0});
  AddTriangleOriented(builder, name + "_PY", p010, p011, p111, {0.0, 1.0, 0.0});
  AddTriangleOriented(builder, name + "_PY", p010, p111, p110, {0.0, 1.0, 0.0});
  AddTriangleOriented(builder, name + "_NZ", p000, p010, p110, {0.0, 0.0, -1.0});
  AddTriangleOriented(builder, name + "_NZ", p000, p110, p100, {0.0, 0.0, -1.0});
  AddTriangleOriented(builder, name + "_PZ", p001, p101, p111, {0.0, 0.0, 1.0});
  AddTriangleOriented(builder, name + "_PZ", p001, p111, p011, {0.0, 0.0, 1.0});
}

void BuildPyramid(const emscripten::val& options, SnapshotBuilder& builder,
                  const std::string& name) {
  const double base_length = ReadFiniteNumber(options["bL"], "bL");
  const double height = ReadFiniteNumber(options["h"], "h");
  const int sides =
      std::max(3, static_cast<int>(std::floor(ReadFiniteNumber(options["s"], "s"))));

  const double radius = base_length / (2.0 * std::sin(kPi / static_cast<double>(sides)));
  const Vec3 apex{0.0, height, 0.0};
  std::vector<Vec3> ring;
  ring.reserve(static_cast<size_t>(sides));
  for (int i = 0; i < sides; ++i) {
    const double angle = (static_cast<double>(i) / static_cast<double>(sides)) * kTau;
    ring.push_back({radius * std::cos(angle), 0.0, radius * std::sin(angle)});
  }

  for (int i = 0; i < sides; ++i) {
    const int next = (i + 1) % sides;
    const Vec3 centroid = Scale(Add(Add(apex, ring[i]), ring[next]), 1.0 / 3.0);
    const Vec3 outward = {centroid.x, 0.0, centroid.z};
    AddTriangleOriented(builder, name + "_S[" + std::to_string(i) + "]", apex,
                        ring[i], ring[next], outward);
  }

  for (int i = 1; i + 1 < sides; ++i) {
    AddTriangleOriented(builder, name + "_Base", ring[0], ring[i], ring[i + 1],
                        {0.0, -1.0, 0.0});
  }
}

void BuildSphere(const emscripten::val& options, SnapshotBuilder& builder,
                 const std::string& name) {
  const double radius = ReadFiniteNumber(options["r"], "r");
  if (!(radius > 0.0)) {
    throw std::runtime_error("Sphere radius must be greater than zero.");
  }
  const int longitude_segments =
      std::max(8, static_cast<int>(std::floor(ReadFiniteNumber(options["resolution"], "resolution"))));
  const int latitude_segments = std::max(4, longitude_segments / 2);

  const Vec3 north{0.0, radius, 0.0};
  const Vec3 south{0.0, -radius, 0.0};
  std::vector<std::vector<Vec3>> rings;
  rings.reserve(static_cast<size_t>(std::max(0, latitude_segments - 1)));

  for (int lat = 1; lat < latitude_segments; ++lat) {
    const double phi = (static_cast<double>(lat) / static_cast<double>(latitude_segments)) * kPi;
    const double y = radius * std::cos(phi);
    const double ring_radius = radius * std::sin(phi);
    std::vector<Vec3> ring;
    ring.reserve(static_cast<size_t>(longitude_segments));
    for (int lon = 0; lon < longitude_segments; ++lon) {
      const double theta =
          (static_cast<double>(lon) / static_cast<double>(longitude_segments)) * kTau;
      ring.push_back({ring_radius * std::cos(theta), y, ring_radius * std::sin(theta)});
    }
    rings.push_back(std::move(ring));
  }

  if (rings.empty()) {
    throw std::runtime_error("Sphere resolution is too low to build faces.");
  }

  const std::string face_name = name;
  const std::vector<Vec3>& first_ring = rings.front();
  for (int lon = 0; lon < longitude_segments; ++lon) {
    const int next = (lon + 1) % longitude_segments;
    const Vec3 centroid = Scale(Add(Add(north, first_ring[next]), first_ring[lon]), 1.0 / 3.0);
    AddTriangleOriented(builder, face_name, north, first_ring[next], first_ring[lon],
                        centroid);
  }

  for (size_t ring_index = 0; ring_index + 1 < rings.size(); ++ring_index) {
    const std::vector<Vec3>& ring_a = rings[ring_index];
    const std::vector<Vec3>& ring_b = rings[ring_index + 1];
    for (int lon = 0; lon < longitude_segments; ++lon) {
      const int next = (lon + 1) % longitude_segments;
      const Vec3 outward = Average4(ring_a[lon], ring_a[next], ring_b[next], ring_b[lon]);
      AddQuadOriented(builder, face_name, ring_a[lon], ring_a[next], ring_b[next],
                      ring_b[lon], outward);
    }
  }

  const std::vector<Vec3>& last_ring = rings.back();
  for (int lon = 0; lon < longitude_segments; ++lon) {
    const int next = (lon + 1) % longitude_segments;
    const Vec3 centroid = Scale(Add(Add(south, last_ring[lon]), last_ring[next]), 1.0 / 3.0);
    AddTriangleOriented(builder, face_name, south, last_ring[lon], last_ring[next],
                        centroid);
  }

  builder.SetFaceMetadata(face_name, SphericalMetadataJson(radius));
}

void BuildCylinder(const emscripten::val& options, SnapshotBuilder& builder,
                   const std::string& name) {
  const double radius = ReadFiniteNumber(options["radius"], "radius");
  const double height = ReadFiniteNumber(options["height"], "height");
  if (!(radius > 0.0)) {
    throw std::runtime_error("Cylinder radius must be greater than zero.");
  }
  const int segments =
      std::max(3, static_cast<int>(std::floor(ReadFiniteNumber(options["resolution"], "resolution"))));
  const double step = kTau / static_cast<double>(segments);

  std::vector<Vec3> bottom_ring;
  std::vector<Vec3> top_ring;
  bottom_ring.reserve(static_cast<size_t>(segments));
  top_ring.reserve(static_cast<size_t>(segments));
  for (int i = 0; i < segments; ++i) {
    const double angle = static_cast<double>(i) * step;
    const double x = std::cos(angle) * radius;
    const double z = std::sin(angle) * radius;
    bottom_ring.push_back({x, 0.0, z});
    top_ring.push_back({x, height, z});
  }

  const Vec3 bottom_center{0.0, 0.0, 0.0};
  const Vec3 top_center{0.0, height, 0.0};
  for (int i = 0; i < segments; ++i) {
    const int next = (i + 1) % segments;
    AddTriangleOriented(builder, name + "_B", bottom_center, bottom_ring[next],
                        bottom_ring[i], {0.0, -1.0, 0.0});
    AddTriangleOriented(builder, name + "_T", top_center, top_ring[i], top_ring[next],
                        {0.0, 1.0, 0.0});
    const Vec3 outward = Average4(bottom_ring[i], bottom_ring[next], top_ring[next],
                                  top_ring[i]);
    AddQuadOriented(builder, name + "_S", bottom_ring[i], bottom_ring[next],
                    top_ring[next], top_ring[i], {outward.x, 0.0, outward.z});
  }

  builder.SetFaceMetadata(name + "_S", CylindricalMetadataJson(radius, height));
}

void BuildCone(const emscripten::val& options, SnapshotBuilder& builder,
               const std::string& name) {
  const double radius_top = ReadFiniteNumber(options["r1"], "r1");
  const double radius_bottom = ReadFiniteNumber(options["r2"], "r2");
  const double height = ReadFiniteNumber(options["h"], "h");
  if (!(radius_top > 0.0) && !(radius_bottom > 0.0)) {
    throw std::runtime_error("Cone requires a positive top or bottom radius.");
  }
  const int segments =
      std::max(3, static_cast<int>(std::floor(ReadFiniteNumber(options["resolution"], "resolution"))));
  const double step = kTau / static_cast<double>(segments);

  std::vector<Vec3> bottom_ring;
  std::vector<Vec3> top_ring;
  bottom_ring.reserve(static_cast<size_t>(segments));
  top_ring.reserve(static_cast<size_t>(segments));
  for (int i = 0; i < segments; ++i) {
    const double angle = static_cast<double>(i) * step;
    const double c = std::cos(angle);
    const double s = std::sin(angle);
    bottom_ring.push_back({radius_bottom * c, 0.0, radius_bottom * s});
    top_ring.push_back({radius_top * c, height, radius_top * s});
  }

  if (radius_bottom > 0.0) {
    const Vec3 bottom_center{0.0, 0.0, 0.0};
    for (int i = 0; i < segments; ++i) {
      const int next = (i + 1) % segments;
      AddTriangleOriented(builder, name + "_B", bottom_center, bottom_ring[next],
                          bottom_ring[i], {0.0, -1.0, 0.0});
    }
  }

  if (radius_top > 0.0) {
    const Vec3 top_center{0.0, height, 0.0};
    for (int i = 0; i < segments; ++i) {
      const int next = (i + 1) % segments;
      AddTriangleOriented(builder, name + "_T", top_center, top_ring[i], top_ring[next],
                          {0.0, 1.0, 0.0});
    }
  }

  if (radius_bottom > 0.0 && radius_top > 0.0) {
    for (int i = 0; i < segments; ++i) {
      const int next = (i + 1) % segments;
      const Vec3 outward = Average4(bottom_ring[i], bottom_ring[next], top_ring[next],
                                    top_ring[i]);
      AddQuadOriented(builder, name + "_S", bottom_ring[i], bottom_ring[next],
                      top_ring[next], top_ring[i], {outward.x, 0.0, outward.z});
    }
  } else if (radius_bottom > 0.0) {
    const Vec3 apex{0.0, height, 0.0};
    for (int i = 0; i < segments; ++i) {
      const int next = (i + 1) % segments;
      const Vec3 centroid = Scale(Add(Add(bottom_ring[i], bottom_ring[next]), apex), 1.0 / 3.0);
      AddTriangleOriented(builder, name + "_S", bottom_ring[i], bottom_ring[next], apex,
                          {centroid.x, 0.0, centroid.z});
    }
  } else {
    const Vec3 apex{0.0, 0.0, 0.0};
    for (int i = 0; i < segments; ++i) {
      const int next = (i + 1) % segments;
      const Vec3 centroid = Scale(Add(Add(top_ring[next], top_ring[i]), apex), 1.0 / 3.0);
      AddTriangleOriented(builder, name + "_S", apex, top_ring[next], top_ring[i],
                          {centroid.x, 0.0, centroid.z});
    }
  }

  builder.SetFaceMetadata(name + "_S",
                          ConicalMetadataJson(radius_bottom, radius_top, height));
}

void BuildTorus(const emscripten::val& options, SnapshotBuilder& builder,
                const std::string& name) {
  const double major_radius = ReadFiniteNumber(options["mR"], "mR");
  const double tube_radius = ReadFiniteNumber(options["tR"], "tR");
  if (!(tube_radius > 0.0)) {
    throw std::runtime_error("Torus tube radius must be greater than zero.");
  }
  const int major_segments =
      std::max(8, static_cast<int>(std::floor(ReadFiniteNumber(options["resolution"], "resolution"))));
  const int tube_segments = std::max(3, major_segments / 2);
  const double arc_degrees = ReadFiniteNumber(options["arcDegrees"], "arcDegrees");
  const bool full_arc = arc_degrees >= 360.0 - 1e-6;
  const double sweep = full_arc ? kTau : (arc_degrees / 180.0) * kPi;
  if (!(sweep > 0.0)) {
    throw std::runtime_error("Torus arc must be greater than zero.");
  }

  const int ring_count = full_arc ? major_segments : (major_segments + 1);
  std::vector<std::vector<Vec3>> rings;
  std::vector<Vec3> centers;
  std::vector<double> ring_angles;
  rings.reserve(static_cast<size_t>(ring_count));
  centers.reserve(static_cast<size_t>(ring_count));
  ring_angles.reserve(static_cast<size_t>(ring_count));

  for (int i = 0; i < ring_count; ++i) {
    const double u = full_arc
        ? (static_cast<double>(i) / static_cast<double>(major_segments)) * sweep
        : (static_cast<double>(i) / static_cast<double>(ring_count - 1)) * sweep;
    const Vec3 center{major_radius * std::cos(u), 0.0, -major_radius * std::sin(u)};
    const Vec3 radial{std::cos(u), 0.0, -std::sin(u)};
    std::vector<Vec3> ring;
    ring.reserve(static_cast<size_t>(tube_segments));
    for (int j = 0; j < tube_segments; ++j) {
      const double v = (static_cast<double>(j) / static_cast<double>(tube_segments)) * kTau;
      ring.push_back(Add(center, Add(Scale(radial, tube_radius * std::cos(v)),
                                     Vec3{0.0, tube_radius * std::sin(v), 0.0})));
    }
    centers.push_back(center);
    ring_angles.push_back(u);
    rings.push_back(std::move(ring));
  }

  const int side_ring_count = full_arc ? ring_count : (ring_count - 1);
  for (int i = 0; i < side_ring_count; ++i) {
    const int next = (i + 1) % ring_count;
    const double next_angle = full_arc && next == 0 ? (ring_angles[i] + (sweep / major_segments)) : ring_angles[next];
    const double mid_u = 0.5 * (ring_angles[i] + next_angle);
    const Vec3 mid_center{major_radius * std::cos(mid_u), 0.0, -major_radius * std::sin(mid_u)};
    for (int j = 0; j < tube_segments; ++j) {
      const int j_next = (j + 1) % tube_segments;
      const Vec3 outward = Subtract(
          Average4(rings[i][j], rings[i][j_next], rings[next][j_next], rings[next][j]),
          mid_center);
      AddQuadOriented(builder, name + "_Side", rings[i][j], rings[i][j_next],
                      rings[next][j_next], rings[next][j], outward);
    }
  }

  if (!full_arc) {
    const Vec3 start_center = centers.front();
    const Vec3 end_center = centers.back();
    const Vec3 start_outward{0.0, 0.0, 1.0};
    const Vec3 end_outward{-std::sin(sweep), 0.0, -std::cos(sweep)};
    for (int j = 0; j < tube_segments; ++j) {
      const int next = (j + 1) % tube_segments;
      AddTriangleOriented(builder, name + "_Cap0", start_center, rings.front()[next],
                          rings.front()[j], start_outward);
      AddTriangleOriented(builder, name + "_Cap1", end_center, rings.back()[j],
                          rings.back()[next], end_outward);
    }
  }

  builder.SetFaceMetadata(name + "_Side",
                          ToroidalMetadataJson(major_radius, tube_radius));
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

emscripten::val ToNameIdEntries(
    const std::vector<std::pair<std::string, uint32_t>>& values) {
  emscripten::val out = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, values[i].first);
    pair.set(1, values[i].second);
    out.set(i, pair);
  }
  return out;
}

emscripten::val ToIdNameEntries(
    const std::vector<std::pair<uint32_t, std::string>>& values) {
  emscripten::val out = emscripten::val::array();
  for (uint32_t i = 0; i < values.size(); ++i) {
    emscripten::val pair = emscripten::val::array();
    pair.set(0, values[i].first);
    pair.set(1, values[i].second);
    out.set(i, pair);
  }
  return out;
}

emscripten::val ToMetadataEntries(
    const std::vector<std::pair<std::string, std::string>>& values) {
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
  snapshot.set("faceNameToID", ToNameIdEntries(builder.face_entries));
  snapshot.set("idToFaceName", ToIdNameEntries(builder.reverse_face_entries));
  snapshot.set("faceMetadataJson", ToMetadataEntries(builder.face_metadata_json));
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount",
               static_cast<uint32_t>(builder.vert_properties.size() / 3));
  snapshot.set("triangleCount", static_cast<uint32_t>(builder.tri_ids.size()));
  return snapshot;
}

}  // namespace

emscripten::val BuildPrimitiveAuthoringState(const emscripten::val& options) {
  const std::string kind = ReadString(options["kind"], "");
  const std::string name = ReadString(options["name"], "Solid");
  SnapshotBuilder builder;

  if (kind == "cube") {
    BuildCube(options, builder, name);
  } else if (kind == "pyramid") {
    BuildPyramid(options, builder, name);
  } else if (kind == "sphere") {
    BuildSphere(options, builder, name);
  } else if (kind == "cylinder") {
    BuildCylinder(options, builder, name);
  } else if (kind == "cone") {
    BuildCone(options, builder, name);
  } else if (kind == "torus") {
    BuildTorus(options, builder, name);
  } else {
    throw std::runtime_error("Unsupported primitive kind: " + kind);
  }

  return BuildSnapshot(builder);
}

}  // namespace manifoldplus
