#include "tube_builder.h"

#include <manifold/manifold.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
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

constexpr double kEps = 1e-9;
constexpr double kEpsSq = kEps * kEps;
constexpr uint32_t kNumProp = 3;
constexpr double kPi = 3.14159265358979323846;

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct TrimPlane {
  bool valid = false;
  Vec3 anchor;
  Vec3 normal;
  double offset = 0.0;
};

struct PathData {
  std::vector<Vec3> points;
  bool closed = false;
};

struct SegmentCacheEntry {
  double ax = 0.0;
  double ay = 0.0;
  double az = 0.0;
  double dx = 0.0;
  double dy = 0.0;
  double dz = 0.0;
  double len_sq = 0.0;
  double min_x = 0.0;
  double min_y = 0.0;
  double min_z = 0.0;
  double max_x = 0.0;
  double max_y = 0.0;
  double max_z = 0.0;
};

struct AuthoringBuffers {
  std::vector<float> vert_properties;
  std::vector<uint32_t> tri_verts;
  std::vector<uint32_t> tri_ids;

  uint32_t AddVertex(const Vec3& point) {
    const uint32_t index = static_cast<uint32_t>(vert_properties.size() / 3);
    vert_properties.push_back(static_cast<float>(point.x));
    vert_properties.push_back(static_cast<float>(point.y));
    vert_properties.push_back(static_cast<float>(point.z));
    return index;
  }

  void AddTriangleIndices(uint32_t face_id, uint32_t a, uint32_t b,
                          uint32_t c) {
    tri_verts.push_back(a);
    tri_verts.push_back(b);
    tri_verts.push_back(c);
    tri_ids.push_back(face_id);
  }
};

struct FastTubeResult {
  AuthoringBuffers buffers;
  std::vector<Vec3> path_points;
  bool closed = false;
  uint32_t pre_triangles = 0;
  uint32_t post_triangles = 0;
  bool union_succeeded = false;
  bool path_foldback_likely = false;
  double min_non_adjacent_segment_distance = std::numeric_limits<double>::infinity();
};

struct TubeFaceLabels {
  uint32_t outer_id = 0;
  uint32_t inner_id = 0;
  uint32_t cap_start_id = 0;
  uint32_t cap_end_id = 0;
  std::vector<std::pair<std::string, uint32_t>> face_name_to_id;
  std::vector<std::pair<uint32_t, std::string>> id_to_face_name;
};

struct TubeBuildOptions {
  std::vector<Vec3> raw_points;
  double radius = 0.0;
  double inner_radius = 0.0;
  int resolution = 32;
  bool closed = false;
  bool prefer_fast = true;
  bool allow_slow_fallback = true;
  bool self_union = true;
  bool profile = false;
  std::string name = "Tube";
  std::string feature_id = "TUBE";
};

double NativeNowMs() {
  using Clock = std::chrono::steady_clock;
  return std::chrono::duration<double, std::milli>(
             Clock::now().time_since_epoch())
      .count();
}

void LogNativeTubeProfile(const TubeBuildOptions& options,
                          const std::string& step, double ms,
                          const emscripten::val& extra =
                              emscripten::val::undefined()) {
  if (!options.profile) return;
  try {
    emscripten::val detail = emscripten::val::object();
    detail.set("featureID", options.feature_id);
    detail.set("tubeName", options.name);
    detail.set("step", step);
    detail.set("ms", ms);
    if (!extra.isUndefined() && !extra.isNull()) detail.set("extra", extra);
    emscripten::val::global("console").call<void>(
        "log", std::string("[Native tube profile]"), detail);
  } catch (...) {
  }
}

bool FastTubeNeedsSlowFallback(const FastTubeResult& fast_result,
                               const TubeBuildOptions& options) {
  if (!options.allow_slow_fallback || !options.prefer_fast) {
    return false;
  }
  if (fast_result.path_foldback_likely) return true;
  if (!options.self_union) return false;
  return fast_result.post_triangles > fast_result.pre_triangles;
}

void AnnotateTubeSnapshotBuildDecision(emscripten::val snapshot,
                                       const char* build_mode,
                                       bool requested_fast,
                                       bool fallback_from_fast,
                                       const std::string& fallback_reason,
                                       const std::string& fast_error) {
  snapshot.set("buildMode", std::string(build_mode ? build_mode : ""));
  snapshot.set("requestedFast", requested_fast);
  snapshot.set("fallbackFromFast", fallback_from_fast);
  snapshot.set(
      "fallbackReason",
      fallback_reason.empty() ? emscripten::val::null()
                              : emscripten::val(fallback_reason));
  snapshot.set("fastBuilderError",
               fast_error.empty() ? emscripten::val::null()
                                  : emscripten::val(fast_error));
}

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

Vec3 ReadPoint(const emscripten::val& point) {
  return {
      ReadFiniteNumber(point[0], "point[0]"),
      ReadFiniteNumber(point[1], "point[1]"),
      ReadFiniteNumber(point[2], "point[2]"),
  };
}

std::vector<Vec3> ReadPoints(const emscripten::val& points_val) {
  if (points_val.isUndefined() || points_val.isNull()) return {};
  const uint32_t length = points_val["length"].as<uint32_t>();
  std::vector<Vec3> points;
  points.reserve(length);
  for (uint32_t i = 0; i < length; ++i) {
    points.push_back(ReadPoint(points_val[i]));
  }
  return points;
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

double Length(const Vec3& v) { return std::sqrt(LengthSq(v)); }

Vec3 Normalize(const Vec3& v) {
  const double len = Length(v);
  if (!(len > 0.0)) return {0.0, 0.0, 0.0};
  return Scale(v, 1.0 / len);
}

double DistanceSq(const Vec3& a, const Vec3& b) {
  return LengthSq(Subtract(a, b));
}

Vec3 Lerp(const Vec3& a, const Vec3& b, double t) {
  return Add(a, Scale(Subtract(b, a), t));
}

Vec3 RotateAroundAxis(const Vec3& vector, const Vec3& axis, double angle) {
  const Vec3 unit_axis = Normalize(axis);
  if (LengthSq(unit_axis) <= kEpsSq || !(angle != 0.0)) return vector;

  const double cos_angle = std::cos(angle);
  const double sin_angle = std::sin(angle);
  const Vec3 term1 = Scale(vector, cos_angle);
  const Vec3 term2 = Scale(Cross(unit_axis, vector), sin_angle);
  const Vec3 term3 = Scale(unit_axis, Dot(unit_axis, vector) * (1.0 - cos_angle));
  return Add(Add(term1, term2), term3);
}

manifold::vec3 ToManifoldVec3(const Vec3& v) {
  return manifold::vec3(v.x, v.y, v.z);
}

double ClampUnit(double value) {
  return std::max(-1.0, std::min(1.0, value));
}

TubeFaceLabels MakeTubeFaceLabels(const std::string& name, bool closed,
                                  bool hollow) {
  TubeFaceLabels labels;
  const uint32_t label_count = 1u + (hollow ? 1u : 0u) + (closed ? 0u : 2u);
  const uint32_t base_id = manifold::Manifold::ReserveIDs(label_count);

  labels.outer_id = base_id;
  uint32_t next_id = base_id + 1;
  labels.inner_id = hollow ? next_id++ : labels.outer_id;
  labels.cap_start_id = closed ? labels.outer_id : next_id++;
  labels.cap_end_id = closed ? labels.outer_id : next_id++;

  labels.face_name_to_id.push_back({name + "_Outer", labels.outer_id});
  labels.id_to_face_name.push_back({labels.outer_id, name + "_Outer"});
  if (hollow) {
    labels.face_name_to_id.push_back({name + "_Inner", labels.inner_id});
    labels.id_to_face_name.push_back({labels.inner_id, name + "_Inner"});
  }
  if (!closed) {
    labels.face_name_to_id.push_back({name + "_CapStart", labels.cap_start_id});
    labels.face_name_to_id.push_back({name + "_CapEnd", labels.cap_end_id});
    labels.id_to_face_name.push_back({labels.cap_start_id, name + "_CapStart"});
    labels.id_to_face_name.push_back({labels.cap_end_id, name + "_CapEnd"});
  }
  return labels;
}

std::vector<Vec3> DedupeConsecutive(const std::vector<Vec3>& points,
                                    double eps) {
  if (points.empty()) return {};
  const double eps_sq = eps * eps;
  std::vector<Vec3> out;
  out.reserve(points.size());
  out.push_back(points.front());
  for (size_t i = 1; i < points.size(); ++i) {
    if (DistanceSq(points[i], out.back()) > eps_sq) out.push_back(points[i]);
  }
  return out;
}

PathData NormalizePath(const std::vector<Vec3>& points, bool requested_closed,
                       double tol) {
  PathData out;
  out.points = DedupeConsecutive(points, tol);
  if (out.points.size() < 2) {
    out.closed = false;
    return out;
  }
  const double closure_tol = std::max(tol * 4.0, kEps);
  const double closure_tol_sq = closure_tol * closure_tol;
  const bool is_closed =
      requested_closed ||
      DistanceSq(out.points.front(), out.points.back()) <= closure_tol_sq;
  out.closed = is_closed;
  if (is_closed && DistanceSq(out.points.front(), out.points.back()) <=
                       closure_tol_sq) {
    out.points.pop_back();
  }
  return out;
}

bool IsCollinearMiddlePoint(const Vec3& prev, const Vec3& curr,
                            const Vec3& next, double tolerance_sq) {
  const Vec3 span = Subtract(next, prev);
  const double span_len_sq = LengthSq(span);
  if (span_len_sq <= kEpsSq) return false;

  const Vec3 from_prev = Subtract(curr, prev);
  const Vec3 to_next = Subtract(next, curr);
  if (LengthSq(from_prev) <= kEpsSq || LengthSq(to_next) <= kEpsSq) return true;
  if (Dot(from_prev, to_next) < 0.0) return false;

  const double projection = Dot(from_prev, span);
  if (projection < -kEps || projection > span_len_sq + kEps) return false;

  const double cross_len_sq = LengthSq(Cross(from_prev, span));
  return cross_len_sq <= tolerance_sq * span_len_sq;
}

std::vector<Vec3> SimplifyCollinearPath(const std::vector<Vec3>& points,
                                         bool closed, double tolerance) {
  const size_t min_points = closed ? 3u : 2u;
  if (points.size() <= min_points) return points;

  const double tolerance_sq = tolerance * tolerance;
  if (!closed) {
    std::vector<Vec3> simplified;
    simplified.reserve(points.size());
    for (const Vec3& point : points) {
      simplified.push_back(point);
      while (simplified.size() >= 3) {
        const size_t n = simplified.size();
        if (!IsCollinearMiddlePoint(simplified[n - 3], simplified[n - 2],
                                    simplified[n - 1], tolerance_sq)) {
          break;
        }
        simplified[n - 2] = simplified[n - 1];
        simplified.pop_back();
      }
    }
    return simplified.size() >= min_points ? simplified : points;
  }

  std::vector<Vec3> simplified = points;
  bool changed = true;
  while (changed && simplified.size() > min_points) {
    changed = false;
    for (size_t i = 0; i < simplified.size() && simplified.size() > min_points;
         ++i) {
      const size_t prev = (i + simplified.size() - 1) % simplified.size();
      const size_t next = (i + 1) % simplified.size();
      if (!IsCollinearMiddlePoint(simplified[prev], simplified[i],
                                  simplified[next], tolerance_sq)) {
        continue;
      }
      simplified.erase(simplified.begin() + static_cast<std::ptrdiff_t>(i));
      changed = true;
      if (i > 0) --i;
    }
  }
  return simplified.size() >= min_points ? simplified : points;
}

std::vector<Vec3> CalculateTubeIntersectionTrimming(
    const std::vector<Vec3>& points, double tube_radius) {
  if (points.size() < 2) return points;
  if (points.size() == 2) return points;

  std::vector<Vec3> out;
  out.reserve(points.size() * 2);
  out.push_back(points.front());

  for (size_t i = 1; i + 1 < points.size(); ++i) {
    const Vec3& prev = points[i - 1];
    const Vec3& curr = points[i];
    const Vec3& next = points[i + 1];

    Vec3 v_prev = Subtract(curr, prev);
    Vec3 v_next = Subtract(next, curr);
    const double prev_len_sq = LengthSq(v_prev);
    const double next_len_sq = LengthSq(v_next);
    if (prev_len_sq < kEpsSq || next_len_sq < kEpsSq) {
      out.push_back(curr);
      continue;
    }

    v_prev = Normalize(v_prev);
    v_next = Normalize(v_next);
    const double dot =
        std::max(-1.0, std::min(1.0, Dot(v_prev, v_next)));
    const double angle = std::acos(std::abs(dot));

    if (angle > kPi / 3.0) {
      const double half_angle = angle * 0.5;
      const double tan_half = std::tan(half_angle);
      if (!(std::abs(tan_half) > kEps)) {
        out.push_back(curr);
        continue;
      }

      const double intersection_dist = tube_radius / tan_half;
      const double dist_prev = std::sqrt(DistanceSq(prev, curr));
      const double dist_next = std::sqrt(DistanceSq(curr, next));
      const double trim_prev = std::min(intersection_dist * 0.8, dist_prev * 0.6);
      const double trim_next = std::min(intersection_dist * 0.8, dist_next * 0.6);

      if (trim_prev > tube_radius * 0.1 && trim_next > tube_radius * 0.1) {
        const Vec3 trimmed_prev = Add(curr, Scale(v_prev, -trim_prev));
        const Vec3 trimmed_next = Add(curr, Scale(v_next, trim_next));
        if (DistanceSq(out.back(), trimmed_prev) > 1e-12) {
          out.push_back(trimmed_prev);
        }
        out.push_back(trimmed_next);
      } else {
        out.push_back(curr);
      }
    } else {
      out.push_back(curr);
    }
  }

  out.push_back(points.back());
  return DedupeConsecutive(out, 1e-6);
}

std::vector<Vec3> SmoothPath(const std::vector<Vec3>& points,
                             double tube_radius) {
  const std::vector<Vec3> trimmed =
      CalculateTubeIntersectionTrimming(points, tube_radius);
  if (trimmed.size() < 2) return points;
  return DedupeConsecutive(trimmed, 1e-9);
}

double SegmentSegmentDistanceSq(const Vec3& p1, const Vec3& q1, const Vec3& p2,
                                const Vec3& q2) {
  const Vec3 d1 = Subtract(q1, p1);
  const Vec3 d2 = Subtract(q2, p2);
  const Vec3 r = Subtract(p1, p2);
  const double a = Dot(d1, d1);
  const double e = Dot(d2, d2);
  const double f = Dot(d2, r);

  double s = 0.0;
  double t = 0.0;

  if (a <= kEpsSq && e <= kEpsSq) return DistanceSq(p1, p2);
  if (a <= kEpsSq) {
    t = std::max(0.0, std::min(1.0, f / e));
  } else {
    const double c = Dot(d1, r);
    if (e <= kEpsSq) {
      s = std::max(0.0, std::min(1.0, -c / a));
    } else {
      const double b = Dot(d1, d2);
      const double denom = a * e - b * b;
      if (std::abs(denom) > kEpsSq) {
        s = std::max(0.0, std::min(1.0, (b * f - c * e) / denom));
      }
      const double t_nom = b * s + f;
      if (t_nom <= 0.0) {
        t = 0.0;
        s = std::max(0.0, std::min(1.0, -c / a));
      } else if (t_nom >= e) {
        t = 1.0;
        s = std::max(0.0, std::min(1.0, (b - c) / a));
      } else {
        t = t_nom / e;
      }
    }
  }

  const Vec3 c1 = Add(p1, Scale(d1, s));
  const Vec3 c2 = Add(p2, Scale(d2, t));
  return DistanceSq(c1, c2);
}

bool ArePathSegmentsAdjacent(size_t a, size_t b, size_t segment_count, bool closed) {
  if (a == b) return true;
  if (a + 1 == b || b + 1 == a) return true;
  if (closed && segment_count > 2) {
    if ((a == 0 && b + 1 == segment_count) || (b == 0 && a + 1 == segment_count)) {
      return true;
    }
  }
  return false;
}

struct PathFoldbackAnalysis {
  bool overlap_likely = false;
  bool near_overlap_likely = false;
  double min_non_adjacent_segment_distance = std::numeric_limits<double>::infinity();
};

PathFoldbackAnalysis AnalyzeTubePathFoldback(const std::vector<Vec3>& path_points,
                                             bool closed, double radius) {
  PathFoldbackAnalysis result;
  if (!(radius > 0.0) || path_points.size() < 4) return result;

  const size_t segment_count =
      closed ? path_points.size() : (path_points.size() > 1 ? path_points.size() - 1 : 0);
  if (segment_count < 2) return result;

  const double overlap_limit = std::max(1e-6, radius * 2.0);
  const double overlap_limit_sq = overlap_limit * overlap_limit;
  const double near_limit =
      overlap_limit + std::max(1e-4, std::max(radius * 0.1, overlap_limit * 0.02));
  const double near_limit_sq = near_limit * near_limit;

  auto segment_point = [&](size_t index) -> std::pair<Vec3, Vec3> {
    const size_t next = (index + 1) % path_points.size();
    return {path_points[index], path_points[next]};
  };

  for (size_t i = 0; i < segment_count; ++i) {
    const auto [a0, a1] = segment_point(i);
    const Vec3 dir_a = Normalize(Subtract(a1, a0));
    for (size_t j = i + 1; j < segment_count; ++j) {
      if (ArePathSegmentsAdjacent(i, j, segment_count, closed)) continue;
      const auto [b0, b1] = segment_point(j);
      const Vec3 dir_b = Normalize(Subtract(b1, b0));
      const double dist_sq = SegmentSegmentDistanceSq(a0, a1, b0, b1);
      if (dist_sq < std::numeric_limits<double>::infinity()) {
        result.min_non_adjacent_segment_distance =
            std::min(result.min_non_adjacent_segment_distance, std::sqrt(dist_sq));
      }
      if (dist_sq <= overlap_limit_sq) {
        result.overlap_likely = true;
        result.near_overlap_likely = true;
        return result;
      }
      const double dir_dot = Dot(dir_a, dir_b);
      if (dist_sq <= near_limit_sq && dir_dot <= -0.25) {
        result.near_overlap_likely = true;
      }
    }
  }

  if (!closed && path_points.size() >= 3) {
    for (size_t i = 1; i + 1 < path_points.size(); ++i) {
      const Vec3 prev = Subtract(path_points[i], path_points[i - 1]);
      const Vec3 next = Subtract(path_points[i + 1], path_points[i]);
      const double prev_len = Length(prev);
      const double next_len = Length(next);
      if (!(prev_len > kEps) || !(next_len > kEps)) continue;
      const Vec3 prev_dir = Scale(prev, 1.0 / prev_len);
      const Vec3 next_dir = Scale(next, 1.0 / next_len);
      const double turn_dot = ClampUnit(Dot(prev_dir, next_dir));
      if (turn_dot > -0.1) continue;
      const double half_angle = 0.5 * std::acos(turn_dot);
      const double tan_half = std::tan(half_angle);
      if (!(tan_half > kEps)) continue;
      const double intersection_dist = radius / tan_half;
      if (intersection_dist >= std::min(prev_len, next_len) * 0.95) {
        result.near_overlap_likely = true;
        break;
      }
    }
  }

  return result;
}

void ComputeFrames(const std::vector<Vec3>& points, bool closed,
                   std::vector<Vec3>& tangents, std::vector<Vec3>& normals,
                   std::vector<Vec3>& binormals) {
  tangents.clear();
  normals.clear();
  binormals.clear();
  if (points.size() < 2) return;

  tangents.reserve(points.size());
  for (size_t i = 0; i < points.size(); ++i) {
    Vec3 tangent;
    if (closed) {
      const size_t prev_idx = (i + points.size() - 1) % points.size();
      const size_t next_idx = (i + 1) % points.size();
      const Vec3 forward = Subtract(points[next_idx], points[i]);
      const Vec3 backward = Subtract(points[i], points[prev_idx]);
      const double forward_len = Length(forward);
      const double backward_len = Length(backward);
      if (forward_len > kEps && backward_len > kEps) {
        tangent = Normalize(Add(Scale(forward, 1.0 / forward_len),
                                Scale(backward, 1.0 / backward_len)));
      } else if (forward_len > kEps) {
        tangent = Scale(forward, 1.0 / forward_len);
      } else if (backward_len > kEps) {
        tangent = Scale(backward, 1.0 / backward_len);
      } else {
        tangent = {0.0, 0.0, 1.0};
      }
    } else {
      if (i == 0) {
        tangent = Normalize(Subtract(points[1], points[0]));
      } else if (i + 1 == points.size()) {
        tangent = Normalize(Subtract(points[i], points[i - 1]));
      } else {
        const Vec3 forward = Subtract(points[i + 1], points[i]);
        const Vec3 backward = Subtract(points[i], points[i - 1]);
        const double forward_len = Length(forward);
        const double backward_len = Length(backward);
        if (forward_len > kEps && backward_len > kEps) {
          tangent = Normalize(Add(Scale(forward, 1.0 / forward_len),
                                  Scale(backward, 1.0 / backward_len)));
        } else if (forward_len > kEps) {
          tangent = Scale(forward, 1.0 / forward_len);
        } else if (backward_len > kEps) {
          tangent = Scale(backward, 1.0 / backward_len);
        } else {
          tangent = (i > 0) ? tangents[i - 1] : Vec3{0.0, 0.0, 1.0};
        }
      }
    }
    tangents.push_back(Normalize(tangent));
  }

  Vec3 normal_seed = {0.0, 0.0, 1.0};
  if (std::abs(Dot(tangents[0], normal_seed)) > 0.99) {
    normal_seed = {1.0, 0.0, 0.0};
  }
  Vec3 first_normal = Cross(Cross(tangents[0], normal_seed), tangents[0]);
  first_normal = Normalize(first_normal);
  normals.push_back(first_normal);
  binormals.push_back(Normalize(Cross(tangents[0], first_normal)));

  for (size_t i = 1; i < points.size(); ++i) {
    Vec3 normal = normals[i - 1];
    Vec3 binormal = binormals[i - 1];
    const double delta_t = Dot(tangents[i - 1], tangents[i]);
    if (delta_t <= 1.0 - kEps) {
      const Vec3 axis = Normalize(Cross(tangents[i - 1], tangents[i]));
      const double angle = std::acos(std::max(-1.0, std::min(1.0, delta_t)));
      normal = Normalize(RotateAroundAxis(normal, axis, angle));
      binormal = Normalize(Cross(tangents[i], normal));
    }
    normals.push_back(normal);
    binormals.push_back(binormal);
  }

  if (closed && points.size() > 2) {
    Vec3 avg_normal = {0.0, 0.0, 0.0};
    for (const Vec3& normal : normals) avg_normal = Add(avg_normal, normal);
    avg_normal = Normalize(avg_normal);
    for (size_t i = 0; i < normals.size(); ++i) {
      const Vec3 projection =
          Subtract(normals[i], Scale(tangents[i], Dot(tangents[i], normals[i])));
      if (LengthSq(projection) > kEpsSq) {
        normals[i] = Normalize(projection);
        binormals[i] = Normalize(Cross(tangents[i], normals[i]));
      } else {
        normals[i] = avg_normal;
        binormals[i] = Normalize(Cross(tangents[i], avg_normal));
      }
    }
  }
}

void AddTriangleIndexedOriented(AuthoringBuffers& buffers, uint32_t face_id,
                                uint32_t ia, const Vec3& a, uint32_t ib,
                                const Vec3& b, uint32_t ic, const Vec3& c,
                                const Vec3* outward_dir) {
  if (outward_dir == nullptr || LengthSq(*outward_dir) < 1e-10) {
    buffers.AddTriangleIndices(face_id, ia, ib, ic);
    return;
  }
  const Vec3 normal = Cross(Subtract(b, a), Subtract(c, a));
  if (Dot(normal, *outward_dir) < 0.0) {
    buffers.AddTriangleIndices(face_id, ia, ic, ib);
  } else {
    buffers.AddTriangleIndices(face_id, ia, ib, ic);
  }
}

void AddQuadIndexedOriented(AuthoringBuffers& buffers, uint32_t face_id,
                            uint32_t ia, const Vec3& a, uint32_t ib,
                            const Vec3& b, uint32_t ic, const Vec3& c,
                            uint32_t id, const Vec3& d,
                            const Vec3* outward_dir) {
  AddTriangleIndexedOriented(buffers, face_id, ia, a, ib, b, ic, c,
                             outward_dir);
  AddTriangleIndexedOriented(buffers, face_id, ia, a, ic, c, id, d,
                             outward_dir);
}

void BuildRingVertices(AuthoringBuffers& buffers, const Vec3& center,
                       const Vec3& normal, const Vec3& binormal,
                       double radius, const std::vector<double>& cos_table,
                       const std::vector<double>& sin_table,
                       std::vector<Vec3>& out_points,
                       std::vector<uint32_t>& out_indices) {
  const size_t segments = cos_table.size();
  out_points.resize(segments);
  out_indices.resize(segments);
  for (size_t i = 0; i < segments; ++i) {
    const Vec3 offset = Add(Scale(normal, cos_table[i]),
                            Scale(binormal, sin_table[i]));
    const Vec3 point = Add(center, Scale(offset, radius));
    out_points[i] = point;
    out_indices[i] = buffers.AddVertex(point);
  }
}

FastTubeResult BuildFastTube(const TubeBuildOptions& options) {
  const double total_start_ms = NativeNowMs();
  FastTubeResult result;
  const TubeFaceLabels labels = MakeTubeFaceLabels(
      options.name, options.closed, options.inner_radius > 0.0);

  std::vector<Vec3> vec_points = DedupeConsecutive(options.raw_points, 1e-7);
  if (vec_points.size() < 2) {
    std::ostringstream msg;
    msg << "Tube requires at least two distinct path points. Got "
        << vec_points.size() << " valid points from "
        << options.raw_points.size() << " input points.";
    throw std::runtime_error(msg.str());
  }

  double scale_estimate = std::max(1e-6, options.radius);
  for (const Vec3& point : vec_points) {
    scale_estimate =
        std::max(scale_estimate,
                 std::max(std::abs(point.x),
                          std::max(std::abs(point.y), std::abs(point.z))));
  }
  double closure_tol =
      std::max(1e-7, std::max(options.radius * 1e-5, scale_estimate * 1e-6));
  const double closure_tol_sq = closure_tol * closure_tol;

  bool is_closed = options.closed;
  if (!is_closed && vec_points.size() >= 2 &&
      DistanceSq(vec_points.front(), vec_points.back()) <= closure_tol_sq) {
    is_closed = true;
  }

  const double smooth_start_ms = NativeNowMs();
  std::vector<Vec3> smoothed = SmoothPath(vec_points, options.radius);
  LogNativeTubeProfile(options, "fast smooth path",
                       NativeNowMs() - smooth_start_ms);
  if (smoothed.size() < 2) {
    std::ostringstream msg;
    msg << "Tube path collapsed after smoothing; check input. Original: "
        << vec_points.size() << ", Smoothed: " << smoothed.size();
    throw std::runtime_error(msg.str());
  }
  if (smoothed.size() > 1) {
    if (!is_closed &&
        DistanceSq(smoothed.front(), smoothed.back()) <= closure_tol_sq) {
      is_closed = true;
    }
    if (is_closed && smoothed.size() > 2 &&
        DistanceSq(smoothed.front(), smoothed.back()) <= closure_tol_sq) {
      smoothed.pop_back();
    }
  }

  std::vector<Vec3> tangents;
  std::vector<Vec3> normals;
  std::vector<Vec3> binormals;
  const double frames_start_ms = NativeNowMs();
  ComputeFrames(smoothed, is_closed, tangents, normals, binormals);
  LogNativeTubeProfile(options, "fast compute frames",
                       NativeNowMs() - frames_start_ms);
  if (tangents.size() < 2 || normals.size() != smoothed.size() ||
      binormals.size() != smoothed.size()) {
    throw std::runtime_error("Unable to compute frames for tube path.");
  }

  const int segments = options.resolution;
  std::vector<double> cos_table(segments);
  std::vector<double> sin_table(segments);
  for (int j = 0; j < segments; ++j) {
    const double theta =
        (static_cast<double>(j) / static_cast<double>(segments)) * 2.0 * kPi;
    cos_table[j] = std::cos(theta);
    sin_table[j] = std::sin(theta);
  }

  std::vector<Vec3> first_outer_points;
  std::vector<uint32_t> first_outer_indices;
  std::vector<Vec3> prev_outer_points;
  std::vector<uint32_t> prev_outer_indices;
  BuildRingVertices(result.buffers, smoothed.front(), normals.front(),
                    binormals.front(), options.radius, cos_table, sin_table,
                    prev_outer_points, prev_outer_indices);
  first_outer_points = prev_outer_points;
  first_outer_indices = prev_outer_indices;

  std::vector<Vec3> first_inner_points;
  std::vector<uint32_t> first_inner_indices;
  std::vector<Vec3> prev_inner_points;
  std::vector<uint32_t> prev_inner_indices;
  if (options.inner_radius > 0.0) {
    BuildRingVertices(result.buffers, smoothed.front(), normals.front(),
                      binormals.front(), options.inner_radius, cos_table,
                      sin_table, prev_inner_points, prev_inner_indices);
    first_inner_points = prev_inner_points;
    first_inner_indices = prev_inner_indices;
  }

  std::vector<Vec3> curr_outer_points;
  std::vector<uint32_t> curr_outer_indices;
  std::vector<Vec3> curr_inner_points;
  std::vector<uint32_t> curr_inner_indices;
  for (size_t i = 1; i < smoothed.size(); ++i) {
    BuildRingVertices(result.buffers, smoothed[i], normals[i], binormals[i],
                      options.radius, cos_table, sin_table, curr_outer_points,
                      curr_outer_indices);
    const Vec3 path_dir = Normalize(Subtract(smoothed[i], smoothed[i - 1]));
    for (int j = 0; j < segments; ++j) {
      const int j1 = (j + 1) % segments;
      AddQuadIndexedOriented(
          result.buffers, labels.outer_id, prev_outer_indices[j],
          prev_outer_points[j], prev_outer_indices[j1], prev_outer_points[j1],
          curr_outer_indices[j1], curr_outer_points[j1], curr_outer_indices[j],
          curr_outer_points[j], &path_dir);
    }
    prev_outer_points.swap(curr_outer_points);
    prev_outer_indices.swap(curr_outer_indices);

    if (options.inner_radius > 0.0) {
      BuildRingVertices(result.buffers, smoothed[i], normals[i], binormals[i],
                        options.inner_radius, cos_table, sin_table,
                        curr_inner_points, curr_inner_indices);
      const Vec3 inward_dir = Scale(path_dir, -1.0);
      for (int j = 0; j < segments; ++j) {
        const int j1 = (j + 1) % segments;
        AddQuadIndexedOriented(
            result.buffers, labels.inner_id, prev_inner_indices[j],
            prev_inner_points[j], curr_inner_indices[j], curr_inner_points[j],
            curr_inner_indices[j1], curr_inner_points[j1],
            prev_inner_indices[j1], prev_inner_points[j1], &inward_dir);
      }
      prev_inner_points.swap(curr_inner_points);
      prev_inner_indices.swap(curr_inner_indices);
    }
  }

  const double rings_start_ms = NativeNowMs();
  if (is_closed) {
    const Vec3 close_dir = Normalize(Subtract(smoothed.front(), smoothed.back()));
    for (int j = 0; j < segments; ++j) {
      const int j1 = (j + 1) % segments;
      AddQuadIndexedOriented(
          result.buffers, labels.outer_id, prev_outer_indices[j],
          prev_outer_points[j], prev_outer_indices[j1], prev_outer_points[j1],
          first_outer_indices[j1], first_outer_points[j1], first_outer_indices[j],
          first_outer_points[j], &close_dir);
    }
    if (options.inner_radius > 0.0) {
      const Vec3 inward_close_dir = Scale(close_dir, -1.0);
      for (int j = 0; j < segments; ++j) {
        const int j1 = (j + 1) % segments;
        AddQuadIndexedOriented(
            result.buffers, labels.inner_id, prev_inner_indices[j],
            prev_inner_points[j], first_inner_indices[j], first_inner_points[j],
            first_inner_indices[j1], first_inner_points[j1],
            prev_inner_indices[j1], prev_inner_points[j1], &inward_close_dir);
      }
    }
  }

  if (!is_closed) {
    const Vec3 start_dir = Scale(tangents.front(), -1.0);
    const Vec3 end_dir = tangents.back();
    const Vec3 start_center = smoothed.front();
    const Vec3 end_center = smoothed.back();
    const uint32_t start_center_index =
        options.inner_radius > 0.0 ? 0u : result.buffers.AddVertex(start_center);
    const uint32_t end_center_index =
        options.inner_radius > 0.0 ? 0u : result.buffers.AddVertex(end_center);

    for (int j = 0; j < segments; ++j) {
      const int j1 = (j + 1) % segments;
      if (options.inner_radius > 0.0) {
        AddQuadIndexedOriented(
            result.buffers, labels.cap_start_id, first_outer_indices[j],
            first_outer_points[j], first_outer_indices[j1],
            first_outer_points[j1], first_inner_indices[j1],
            first_inner_points[j1], first_inner_indices[j], first_inner_points[j],
            &start_dir);
        AddQuadIndexedOriented(
            result.buffers, labels.cap_end_id, prev_outer_indices[j],
            prev_outer_points[j], prev_outer_indices[j1], prev_outer_points[j1],
            prev_inner_indices[j1], prev_inner_points[j1], prev_inner_indices[j],
            prev_inner_points[j], &end_dir);
      } else {
        AddTriangleIndexedOriented(
            result.buffers, labels.cap_start_id, start_center_index, start_center,
            first_outer_indices[j], first_outer_points[j], first_outer_indices[j1],
            first_outer_points[j1], &start_dir);
        AddTriangleIndexedOriented(
            result.buffers, labels.cap_end_id, end_center_index, end_center,
            prev_outer_indices[j], prev_outer_points[j], prev_outer_indices[j1],
            prev_outer_points[j1], &end_dir);
      }
    }
  }
  if (options.profile) {
    emscripten::val extra = emscripten::val::object();
    extra.set("pathPoints", static_cast<uint32_t>(smoothed.size()));
    extra.set("resolution", options.resolution);
    extra.set("preTriangles",
              static_cast<uint32_t>(result.buffers.tri_verts.size() / 3));
    LogNativeTubeProfile(options, "fast build rings",
                         NativeNowMs() - rings_start_ms, extra);
  }

  const double foldback_start_ms = NativeNowMs();
  const PathFoldbackAnalysis foldback =
      AnalyzeTubePathFoldback(smoothed, is_closed, options.radius);
  LogNativeTubeProfile(options, "fast analyze foldback",
                       NativeNowMs() - foldback_start_ms);
  result.path_points = smoothed;
  result.closed = is_closed;
  result.pre_triangles =
      static_cast<uint32_t>(result.buffers.tri_verts.size() / 3);
  result.post_triangles = result.pre_triangles;
  result.path_foldback_likely =
      foldback.overlap_likely || foldback.near_overlap_likely;
  result.min_non_adjacent_segment_distance =
      foldback.min_non_adjacent_segment_distance;

  if (options.self_union) {
    const double self_union_start_ms = NativeNowMs();
    manifold::MeshGL mesh;
    mesh.numProp = kNumProp;
    mesh.vertProperties = result.buffers.vert_properties;
    mesh.triVerts = result.buffers.tri_verts;
    mesh.faceID = result.buffers.tri_ids;
    mesh.Merge();

    try {
      manifold::Manifold input(mesh);
      if (input.Status() == manifold::Manifold::Error::NoError) {
        manifold::Manifold combined = input + input;
        manifold::MeshGL combined_mesh = combined.GetMeshGL();
        result.buffers.vert_properties = combined_mesh.vertProperties;
        result.buffers.tri_verts = combined_mesh.triVerts;
        result.buffers.tri_ids = combined_mesh.faceID;
        result.post_triangles = static_cast<uint32_t>(combined_mesh.NumTri());
        result.union_succeeded = true;
      }
    } catch (...) {
      result.union_succeeded = false;
    }
    if (options.profile) {
      emscripten::val extra = emscripten::val::object();
      extra.set("preTriangles", result.pre_triangles);
      extra.set("postTriangles", result.post_triangles);
      extra.set("unionSucceeded", result.union_succeeded);
      LogNativeTubeProfile(options, "fast self union",
                           NativeNowMs() - self_union_start_ms, extra);
    }
  }

  if (options.profile) {
    emscripten::val extra = emscripten::val::object();
    extra.set("pathPoints", static_cast<uint32_t>(smoothed.size()));
    extra.set("closedLoop", result.closed);
    extra.set("preTriangles", result.pre_triangles);
    extra.set("postTriangles", result.post_triangles);
    extra.set("pathFoldbackLikely", result.path_foldback_likely);
    LogNativeTubeProfile(options, "fast total", NativeNowMs() - total_start_ms,
                         extra);
  }
  return result;
}

TrimPlane MakeTrimPlane(const Vec3& anchor, const Vec3& neighbor) {
  const Vec3 direction = Subtract(neighbor, anchor);
  if (LengthSq(direction) <= kEpsSq) return {};
  const Vec3 normal = Normalize(direction);
  return {true, anchor, normal, Dot(normal, anchor)};
}

void ApplyTrimPlaneSequentially(std::vector<manifold::Manifold>& spheres,
                                const std::vector<Vec3>& points, double radius,
                                const TrimPlane& plane,
                                bool iterate_forward) {
  if (!plane.valid || radius <= 0.0 || spheres.empty()) return;
  const int start = iterate_forward ? 0 : static_cast<int>(spheres.size()) - 1;
  const int end = iterate_forward ? static_cast<int>(spheres.size()) : -1;
  const int step = iterate_forward ? 1 : -1;
  const double radius_sq = radius * radius;
  for (int idx = start; idx != end; idx += step) {
    if (DistanceSq(points[idx], plane.anchor) > radius_sq) break;
    spheres[idx] =
        spheres[idx].TrimByPlane(ToManifoldVec3(plane.normal), plane.offset);
  }
}

manifold::Manifold BuildHullChain(const std::vector<Vec3>& points, double radius,
                                  int resolution, bool closed,
                                  const TrimPlane& start_plane,
                                  const TrimPlane& end_plane) {
  if (points.size() < 2) {
    throw std::runtime_error("Tube requires at least two distinct points.");
  }

  manifold::Manifold base_sphere = manifold::Manifold::Sphere(radius, resolution);
  std::vector<manifold::Manifold> spheres;
  spheres.reserve(points.size());
  for (const Vec3& point : points) {
    spheres.push_back(base_sphere.Translate(ToManifoldVec3(point)));
  }

  if (!closed) {
    ApplyTrimPlaneSequentially(spheres, points, radius, start_plane, true);
    ApplyTrimPlaneSequentially(spheres, points, radius, end_plane, false);
  }

  const size_t segment_count = closed ? points.size() : points.size() - 1;
  std::vector<manifold::Manifold> hulls;
  hulls.reserve(segment_count);
  std::vector<manifold::Manifold> pair;
  pair.reserve(2);
  for (size_t i = 0; i < segment_count; ++i) {
    const size_t next = (i + 1) % points.size();
    if (DistanceSq(points[i], points[next]) <= kEpsSq) continue;
    pair.clear();
    pair.push_back(spheres[i]);
    pair.push_back(spheres[next]);
    hulls.push_back(manifold::Manifold::Hull(pair));
  }

  if (hulls.empty()) {
    throw std::runtime_error("Unable to build tube hulls from the supplied path.");
  }
  if (hulls.size() == 1) return hulls.front();
  return manifold::Manifold::BatchBoolean(hulls, manifold::OpType::Add);
}

Vec3 FirstTangent(const std::vector<Vec3>& points) {
  if (points.size() < 2) return {};
  for (size_t i = 1; i < points.size(); ++i) {
    const Vec3 dir = Normalize(Subtract(points[i], points[i - 1]));
    if (LengthSq(dir) > kEpsSq) return dir;
  }
  return {};
}

Vec3 LastTangentBackwards(const std::vector<Vec3>& points) {
  if (points.size() < 2) return {};
  for (size_t i = points.size() - 1; i >= 1; --i) {
    const Vec3 dir = Normalize(Subtract(points[i - 1], points[i]));
    if (LengthSq(dir) > kEpsSq) return dir;
    if (i == 1) break;
  }
  return {};
}

std::vector<SegmentCacheEntry> BuildSegmentCache(
    const std::vector<Vec3>& polyline) {
  std::vector<SegmentCacheEntry> segments;
  if (polyline.size() < 2) return segments;
  segments.reserve(polyline.size() - 1);
  for (size_t i = 0; i + 1 < polyline.size(); ++i) {
    const Vec3& a = polyline[i];
    const Vec3& b = polyline[i + 1];
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double dz = b.z - a.z;
    const double len_sq = dx * dx + dy * dy + dz * dz;
    segments.push_back({a.x,
                        a.y,
                        a.z,
                        dx,
                        dy,
                        dz,
                        len_sq,
                        std::min(a.x, b.x),
                        std::min(a.y, b.y),
                        std::min(a.z, b.z),
                        std::max(a.x, b.x),
                        std::max(a.y, b.y),
                        std::max(a.z, b.z)});
  }
  return segments;
}

double DistanceSqToAABB(double px, double py, double pz,
                        const SegmentCacheEntry& segment) {
  const double dx = px < segment.min_x ? segment.min_x - px
                    : px > segment.max_x
                        ? px - segment.max_x
                        : 0.0;
  const double dy = py < segment.min_y ? segment.min_y - py
                    : py > segment.max_y
                        ? py - segment.max_y
                        : 0.0;
  const double dz = pz < segment.min_z ? segment.min_z - pz
                    : pz > segment.max_z
                        ? pz - segment.max_z
                        : 0.0;
  return dx * dx + dy * dy + dz * dz;
}

double MinDistanceToPolylineSq(double px, double py, double pz,
                               const std::vector<SegmentCacheEntry>& segments,
                               double break_at_sq) {
  if (segments.empty()) return std::numeric_limits<double>::infinity();
  double min_sq = std::numeric_limits<double>::infinity();
  for (const SegmentCacheEntry& segment : segments) {
    if (segment.len_sq <= kEpsSq) continue;
    if (DistanceSqToAABB(px, py, pz, segment) > break_at_sq) continue;
    const double apx = px - segment.ax;
    const double apy = py - segment.ay;
    const double apz = pz - segment.az;
    double t = (apx * segment.dx + apy * segment.dy + apz * segment.dz) /
               segment.len_sq;
    t = std::max(0.0, std::min(1.0, t));
    const double cx = segment.ax + segment.dx * t;
    const double cy = segment.ay + segment.dy * t;
    const double cz = segment.az + segment.dz * t;
    const double dx = px - cx;
    const double dy = py - cy;
    const double dz = pz - cz;
    const double dist_sq = dx * dx + dy * dy + dz * dz;
    if (dist_sq < min_sq) {
      min_sq = dist_sq;
      if (min_sq <= break_at_sq) break;
    }
  }
  return min_sq;
}

manifold::MeshGL RelabelSlowMesh(manifold::MeshGL mesh,
                                 const std::vector<Vec3>& path_points,
                                 bool closed, double outer_radius,
                                 double inner_radius,
                                 const TubeFaceLabels& labels) {
  const uint32_t tri_count = mesh.NumTri();
  mesh.faceID.resize(tri_count);

  const Vec3 start_normal = closed ? Vec3{} : FirstTangent(path_points);
  const Vec3 end_normal = closed ? Vec3{} : LastTangentBackwards(path_points);
  const Vec3 path_start = path_points.front();
  const Vec3 path_end = path_points.back();
  const double start_offset = Dot(start_normal, path_start);
  const double end_offset = Dot(end_normal, path_end);
  const double cap_tol = std::max(outer_radius * 1e-2, 1e-5);
  const double cap_reach_sq =
      (outer_radius + cap_tol) * (outer_radius + cap_tol);
  const double inner_outer_threshold =
      inner_radius > 0.0 ? (inner_radius + outer_radius) * 0.5
                         : outer_radius * 0.5;
  const double inner_outer_threshold_sq =
      inner_outer_threshold * inner_outer_threshold;
  const std::vector<SegmentCacheEntry> segment_cache =
      inner_radius > 0.0 ? BuildSegmentCache(path_points)
                         : std::vector<SegmentCacheEntry>{};

  for (uint32_t tri = 0; tri < tri_count; ++tri) {
    const uint32_t i0 = mesh.triVerts[tri * 3 + 0] * mesh.numProp;
    const uint32_t i1 = mesh.triVerts[tri * 3 + 1] * mesh.numProp;
    const uint32_t i2 = mesh.triVerts[tri * 3 + 2] * mesh.numProp;
    const double cx =
        (mesh.vertProperties[i0 + 0] + mesh.vertProperties[i1 + 0] +
         mesh.vertProperties[i2 + 0]) /
        3.0;
    const double cy =
        (mesh.vertProperties[i0 + 1] + mesh.vertProperties[i1 + 1] +
         mesh.vertProperties[i2 + 1]) /
        3.0;
    const double cz =
        (mesh.vertProperties[i0 + 2] + mesh.vertProperties[i1 + 2] +
         mesh.vertProperties[i2 + 2]) /
        3.0;

    uint32_t assigned = labels.outer_id;
    const Vec3 centroid = {cx, cy, cz};
    if (!closed && LengthSq(start_normal) > kEpsSq) {
      const double plane_dist = std::abs(Dot(start_normal, centroid) - start_offset);
      if (plane_dist <= cap_tol &&
          DistanceSq(centroid, path_start) <= cap_reach_sq) {
        assigned = labels.cap_start_id;
      }
    }
    if (assigned == labels.outer_id && !closed &&
        LengthSq(end_normal) > kEpsSq) {
      const double plane_dist = std::abs(Dot(end_normal, centroid) - end_offset);
      if (plane_dist <= cap_tol &&
          DistanceSq(centroid, path_end) <= cap_reach_sq) {
        assigned = labels.cap_end_id;
      }
    }
    if (assigned == labels.outer_id && inner_radius > 0.0) {
      const double dist_sq = MinDistanceToPolylineSq(
          cx, cy, cz, segment_cache, inner_outer_threshold_sq);
      if (dist_sq <= inner_outer_threshold_sq) assigned = labels.inner_id;
    }
    mesh.faceID[tri] = assigned;
  }
  return mesh;
}

manifold::MeshGL BuildSlowTubeMesh(const TubeBuildOptions& options,
                                   std::vector<Vec3>& out_path_points,
                                   bool& out_closed) {
  const double tolerance = std::max(1e-7, options.radius * 1e-5);
  PathData path = NormalizePath(options.raw_points, options.closed, tolerance);
  path.points = SimplifyCollinearPath(path.points, path.closed, tolerance);
  if (path.points.size() < 2) {
    std::ostringstream msg;
    msg << "Tube requires at least two distinct path points. Got "
        << path.points.size() << " valid points from "
        << options.raw_points.size() << " input points.";
    throw std::runtime_error(msg.str());
  }
  if (path.closed && path.points.size() < 3) {
    throw std::runtime_error("Closed tubes require at least three unique points.");
  }

  const TrimPlane start_plane =
      path.closed ? TrimPlane{} : MakeTrimPlane(path.points.front(), path.points[1]);
  const TrimPlane end_plane =
      path.closed ? TrimPlane{}
                  : MakeTrimPlane(path.points.back(),
                                  path.points[path.points.size() - 2]);

  manifold::Manifold outer =
      BuildHullChain(path.points, options.radius, options.resolution, path.closed,
                     start_plane, end_plane);
  manifold::Manifold final_manifold = outer;
  if (options.inner_radius > 0.0) {
    manifold::Manifold inner = BuildHullChain(path.points, options.inner_radius,
                                              options.resolution, path.closed,
                                              start_plane, end_plane);
    final_manifold = outer - inner;
  }

  const TubeFaceLabels labels = MakeTubeFaceLabels(
      options.name, path.closed, options.inner_radius > 0.0);
  out_path_points = path.points;
  out_closed = path.closed;
  return RelabelSlowMesh(final_manifold.GetMeshGL(), path.points, path.closed,
                         options.radius, options.inner_radius, labels);
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

emscripten::val ToMapEntries(
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

emscripten::val ToReverseMapEntries(
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

emscripten::val ToPointArray(const std::vector<Vec3>& points,
                             bool append_closure_point) {
  emscripten::val out = emscripten::val::array();
  uint32_t write = 0;
  for (const Vec3& point : points) {
    emscripten::val entry = emscripten::val::array();
    entry.set(0, point.x);
    entry.set(1, point.y);
    entry.set(2, point.z);
    out.set(write++, entry);
  }
  if (append_closure_point && !points.empty()) {
    emscripten::val entry = emscripten::val::array();
    entry.set(0, points.front().x);
    entry.set(1, points.front().y);
    entry.set(2, points.front().z);
    out.set(write, entry);
  }
  return out;
}

emscripten::val BuildSnapshotFromAuthoring(const AuthoringBuffers& buffers,
                                           const TubeFaceLabels& labels,
                                           const std::vector<Vec3>& path_points,
                                           bool closed,
                                           uint32_t pre_triangles,
                                           uint32_t post_triangles,
                                           bool union_succeeded,
                                           bool self_union_skipped,
                                           bool self_intersection_likely,
                                           bool path_foldback_likely,
                                           double min_non_adjacent_segment_distance) {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", kNumProp);
  snapshot.set("vertProperties", ToJsArray(buffers.vert_properties));
  snapshot.set("triVerts", ToJsArray(buffers.tri_verts));
  snapshot.set("triIDs", ToJsArray(buffers.tri_ids));
  snapshot.set("faceNameToID", ToMapEntries(labels.face_name_to_id));
  snapshot.set("idToFaceName", ToReverseMapEntries(labels.id_to_face_name));
  snapshot.set("faceMetadataJson", emscripten::val::array());
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount",
               static_cast<uint32_t>(buffers.vert_properties.size() / 3));
  snapshot.set("triangleCount", static_cast<uint32_t>(buffers.tri_ids.size()));
  snapshot.set("pathPoints", ToPointArray(path_points, closed));
  snapshot.set("closed", closed);

  emscripten::val stats = emscripten::val::object();
  stats.set("preTriangles", pre_triangles);
  stats.set("postTriangles", post_triangles);
  stats.set("selfIntersectionLikely", self_intersection_likely);
  stats.set("unionSucceeded", union_succeeded);
  stats.set("selfUnionSkipped", self_union_skipped);
  stats.set("pathFoldbackLikely", path_foldback_likely);
  stats.set("minNonAdjacentSegmentDistance",
            std::isfinite(min_non_adjacent_segment_distance)
                ? emscripten::val(min_non_adjacent_segment_distance)
                : emscripten::val::null());
  snapshot.set("selfUnionStats", stats);
  return snapshot;
}

emscripten::val BuildSnapshotFromMesh(const manifold::MeshGL& mesh,
                                      const TubeFaceLabels& labels,
                                      const std::vector<Vec3>& path_points,
                                      bool closed) {
  emscripten::val snapshot = emscripten::val::object();
  snapshot.set("numProp", mesh.numProp);
  snapshot.set("vertProperties", ToJsArray(mesh.vertProperties));
  snapshot.set("triVerts", ToJsArray(mesh.triVerts));
  snapshot.set("triIDs", ToJsArray(mesh.faceID));
  snapshot.set("faceNameToID", ToMapEntries(labels.face_name_to_id));
  snapshot.set("idToFaceName", ToReverseMapEntries(labels.id_to_face_name));
  snapshot.set("faceMetadataJson", emscripten::val::array());
  snapshot.set("edgeMetadataJson", emscripten::val::array());
  snapshot.set("vertexCount", static_cast<uint32_t>(mesh.NumVert()));
  snapshot.set("triangleCount", static_cast<uint32_t>(mesh.NumTri()));
  snapshot.set("pathPoints", ToPointArray(path_points, false));
  snapshot.set("closed", closed);
  return snapshot;
}

}  // namespace

emscripten::val BuildTubeAuthoringState(const emscripten::val& options) {
  const double total_start_ms = NativeNowMs();
  TubeBuildOptions build_options;
  build_options.raw_points = ReadPoints(options["points"]);
  build_options.radius = ReadFiniteNumber(options["radius"], "radius");
  if (!(build_options.radius > 0.0)) {
    throw std::runtime_error("Tube radius must be greater than zero.");
  }

  const emscripten::val inner_val = options["innerRadius"];
  build_options.inner_radius =
      (inner_val.isUndefined() || inner_val.isNull())
          ? 0.0
          : ReadFiniteNumber(inner_val, "innerRadius");
  if (build_options.inner_radius < 0.0) {
    throw std::runtime_error("Inside radius cannot be negative.");
  }
  if (build_options.inner_radius > 0.0 &&
      build_options.inner_radius >= build_options.radius) {
    throw std::runtime_error(
        "Inside radius must be smaller than the outer radius.");
  }

  const emscripten::val resolution_val = options["resolution"];
  const double resolution_raw =
      (resolution_val.isUndefined() || resolution_val.isNull())
          ? 32.0
          : ReadFiniteNumber(resolution_val, "resolution");
  build_options.resolution =
      std::max(8, static_cast<int>(std::floor(resolution_raw)));

  build_options.closed =
      !(options["closed"].isUndefined() || options["closed"].isNull()) &&
      options["closed"].as<bool>();
  build_options.prefer_fast =
      (options["preferFast"].isUndefined() || options["preferFast"].isNull())
          ? true
          : options["preferFast"].as<bool>();
  build_options.allow_slow_fallback =
      (options["allowSlowFallback"].isUndefined() ||
       options["allowSlowFallback"].isNull())
          ? build_options.prefer_fast
          : options["allowSlowFallback"].as<bool>();
  build_options.self_union =
      (options["selfUnion"].isUndefined() || options["selfUnion"].isNull())
          ? true
          : options["selfUnion"].as<bool>();
  if (!(options["name"].isUndefined() || options["name"].isNull())) {
    build_options.name = options["name"].as<std::string>();
    if (build_options.name.empty()) build_options.name = "Tube";
  }
  build_options.profile =
      !(options["profile"].isUndefined() || options["profile"].isNull()) &&
      options["profile"].as<bool>();
  if (!(options["featureID"].isUndefined() || options["featureID"].isNull())) {
    build_options.feature_id = options["featureID"].as<std::string>();
    if (build_options.feature_id.empty()) build_options.feature_id = "TUBE";
  }

  bool fallback_from_fast = false;
  std::string fallback_reason;
  std::string fast_error;

  if (build_options.prefer_fast) {
    try {
      const double fast_start_ms = NativeNowMs();
      FastTubeResult fast = BuildFastTube(build_options);
      LogNativeTubeProfile(build_options, "build fast result",
                           NativeNowMs() - fast_start_ms);
      if (!FastTubeNeedsSlowFallback(fast, build_options)) {
        const double snapshot_start_ms = NativeNowMs();
        const TubeFaceLabels labels = MakeTubeFaceLabels(
            build_options.name, fast.closed, build_options.inner_radius > 0.0);
        emscripten::val snapshot =
            BuildSnapshotFromAuthoring(fast.buffers, labels, fast.path_points,
                                       fast.closed, fast.pre_triangles,
                                       fast.post_triangles, fast.union_succeeded,
                                       !build_options.self_union,
                                       fast.path_foldback_likely ||
                                           fast.post_triangles > fast.pre_triangles,
                                       fast.path_foldback_likely,
                                       fast.min_non_adjacent_segment_distance);
        AnnotateTubeSnapshotBuildDecision(snapshot, "fast",
                                          build_options.prefer_fast, false, "",
                                          "");
        LogNativeTubeProfile(build_options, "build fast snapshot",
                             NativeNowMs() - snapshot_start_ms);
        LogNativeTubeProfile(build_options, "build tube total",
                             NativeNowMs() - total_start_ms);
        return snapshot;
      }
      fallback_from_fast = true;
      fallback_reason = fast.path_foldback_likely
                            ? "path_foldback_proximity"
                            : "self_intersection_likely";
    } catch (const std::exception& error) {
      if (!build_options.allow_slow_fallback) throw;
      fallback_from_fast = true;
      fallback_reason = "fast_builder_error";
      fast_error = error.what();
    } catch (...) {
      if (!build_options.allow_slow_fallback) throw;
      fallback_from_fast = true;
      fallback_reason = "fast_builder_error";
      fast_error = "native_fast_tube_error";
    }
  }

  std::vector<Vec3> path_points;
  bool closed = false;
  const double slow_start_ms = NativeNowMs();
  manifold::MeshGL mesh = BuildSlowTubeMesh(build_options, path_points, closed);
  LogNativeTubeProfile(build_options, "build slow mesh",
                       NativeNowMs() - slow_start_ms);
  const double slow_snapshot_start_ms = NativeNowMs();
  const TubeFaceLabels labels = MakeTubeFaceLabels(
      build_options.name, closed, build_options.inner_radius > 0.0);
  emscripten::val snapshot =
      BuildSnapshotFromMesh(mesh, labels, path_points, closed);
  AnnotateTubeSnapshotBuildDecision(snapshot, "slow",
                                    build_options.prefer_fast,
                                    fallback_from_fast, fallback_reason,
                                    fast_error);
  LogNativeTubeProfile(build_options, "build slow snapshot",
                       NativeNowMs() - slow_snapshot_start_ms);
  LogNativeTubeProfile(build_options, "build tube total",
                       NativeNowMs() - total_start_ms);
  return snapshot;
}

}  // namespace manifoldplus
