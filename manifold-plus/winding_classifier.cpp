// Generalized-winding-number classification of internal triangles.
//
// Mirrors the JS fallback in src/BREP/SolidMethods/selfIntersectionCleanup.ts
// (removeInternalTrianglesByWinding): for each triangle, evaluate the exact
// generalized winding number at centroid +/- eps along the normal and keep the
// triangle only when the pair straddles the surface. The mesh rebuild stays on
// the JS side; this returns just the keep mask.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <cstdint>
#include <vector>

namespace {

using emscripten::val;

val ClassifyInternalTrianglesByWinding(const val& vert_properties,
                                       const val& tri_verts,
                                       double offset_scale,
                                       double crossing_tolerance) {
  const size_t vp_len = vert_properties["length"].as<size_t>();
  const size_t tv_len = tri_verts["length"].as<size_t>();
  const size_t tri_count = tv_len / 3;

  val result = val::global("Uint8Array").new_(static_cast<uint32_t>(tri_count));
  if (tri_count == 0 || vp_len < 9) {
    result.call<void>("fill", 1);
    return result;
  }

  std::vector<double> vp(vp_len);
  {
    val view = val(emscripten::typed_memory_view(vp_len, vp.data()));
    view.call<void>("set", vert_properties);
  }
  std::vector<uint32_t> tv(tv_len);
  {
    val view = val(emscripten::typed_memory_view(tv_len, tv.data()));
    view.call<void>("set", tri_verts);
  }

  double min_x = HUGE_VAL, min_y = HUGE_VAL, min_z = HUGE_VAL;
  double max_x = -HUGE_VAL, max_y = -HUGE_VAL, max_z = -HUGE_VAL;
  for (size_t i = 0; i + 2 < vp_len; i += 3) {
    const double x = vp[i], y = vp[i + 1], z = vp[i + 2];
    if (x < min_x) min_x = x;
    if (x > max_x) max_x = x;
    if (y < min_y) min_y = y;
    if (y > max_y) max_y = y;
    if (z < min_z) min_z = z;
    if (z > max_z) max_z = z;
  }
  double diag = std::hypot(max_x - min_x, max_y - min_y, max_z - min_z);
  if (!(diag > 0.0)) diag = 1.0;
  const double eps = offset_scale * diag;

  std::vector<double> tri_coords(tri_count * 9);
  std::vector<double> centroids(tri_count * 3);
  std::vector<double> normals(tri_count * 3, 0.0);
  const size_t vert_count = vp_len / 3;
  for (size_t t = 0; t < tri_count; ++t) {
    const size_t b = t * 3;
    const size_t i0 = tv[b + 0];
    const size_t i1 = tv[b + 1];
    const size_t i2 = tv[b + 2];
    if (i0 >= vert_count || i1 >= vert_count || i2 >= vert_count) continue;
    const double ax = vp[i0 * 3 + 0], ay = vp[i0 * 3 + 1], az = vp[i0 * 3 + 2];
    const double bx = vp[i1 * 3 + 0], by = vp[i1 * 3 + 1], bz = vp[i1 * 3 + 2];
    const double cx = vp[i2 * 3 + 0], cy = vp[i2 * 3 + 1], cz = vp[i2 * 3 + 2];
    const size_t c9 = t * 9;
    tri_coords[c9 + 0] = ax; tri_coords[c9 + 1] = ay; tri_coords[c9 + 2] = az;
    tri_coords[c9 + 3] = bx; tri_coords[c9 + 4] = by; tri_coords[c9 + 5] = bz;
    tri_coords[c9 + 6] = cx; tri_coords[c9 + 7] = cy; tri_coords[c9 + 8] = cz;
    centroids[b + 0] = (ax + bx + cx) / 3.0;
    centroids[b + 1] = (ay + by + cy) / 3.0;
    centroids[b + 2] = (az + bz + cz) / 3.0;
    const double ux = bx - ax, uy = by - ay, uz = bz - az;
    const double vx = cx - ax, vy = cy - ay, vz = cz - az;
    const double nx = uy * vz - uz * vy;
    const double ny = uz * vx - ux * vz;
    const double nz = ux * vy - uy * vx;
    const double nl = std::hypot(nx, ny, nz);
    if (nl >= 1e-18) {
      normals[b + 0] = nx / nl;
      normals[b + 1] = ny / nl;
      normals[b + 2] = nz / nl;
    }
  }

  double tau = crossing_tolerance;
  if (!(tau > 0.0)) tau = 0.0;
  if (tau > 0.49) tau = 0.49;
  const double four_pi = 4.0 * M_PI;

  std::vector<uint8_t> keep(tri_count, 1);
  for (size_t t = 0; t < tri_count; ++t) {
    const size_t b = t * 3;
    const double nx = normals[b + 0], ny = normals[b + 1], nz = normals[b + 2];
    if (nx == 0.0 && ny == 0.0 && nz == 0.0) continue;  // keep degenerate tris
    const double cx0 = centroids[b + 0], cy0 = centroids[b + 1], cz0 = centroids[b + 2];
    const double px_p = cx0 + nx * eps, py_p = cy0 + ny * eps, pz_p = cz0 + nz * eps;
    const double px_m = cx0 - nx * eps, py_m = cy0 - ny * eps, pz_m = cz0 - nz * eps;
    double omega_p = 0.0;
    double omega_m = 0.0;
    const double* c = tri_coords.data();
    for (size_t u = 0; u < tri_count; ++u, c += 9) {
      const double Ax = c[0], Ay = c[1], Az = c[2];
      const double Bx = c[3], By = c[4], Bz = c[5];
      const double Cx = c[6], Cy = c[7], Cz = c[8];
      {
        const double ax = Ax - px_p, ay = Ay - py_p, az = Az - pz_p;
        const double bx = Bx - px_p, by = By - py_p, bz = Bz - pz_p;
        const double cx = Cx - px_p, cy = Cy - py_p, cz = Cz - pz_p;
        const double la = std::sqrt(ax * ax + ay * ay + az * az);
        const double lb = std::sqrt(bx * bx + by * by + bz * bz);
        const double lc = std::sqrt(cx * cx + cy * cy + cz * cz);
        if (la >= 1e-18 && lb >= 1e-18 && lc >= 1e-18) {
          const double dot_ab = ax * bx + ay * by + az * bz;
          const double dot_bc = bx * cx + by * cy + bz * cz;
          const double dot_ca = cx * ax + cy * ay + cz * az;
          const double triple = (ay * bz - az * by) * cx +
                                (az * bx - ax * bz) * cy +
                                (ax * by - ay * bx) * cz;
          const double denom = la * lb * lc + dot_ab * lc + dot_bc * la + dot_ca * lb;
          omega_p += 2.0 * std::atan2(triple, denom);
        }
      }
      {
        const double ax = Ax - px_m, ay = Ay - py_m, az = Az - pz_m;
        const double bx = Bx - px_m, by = By - py_m, bz = Bz - pz_m;
        const double cx = Cx - px_m, cy = Cy - py_m, cz = Cz - pz_m;
        const double la = std::sqrt(ax * ax + ay * ay + az * az);
        const double lb = std::sqrt(bx * bx + by * by + bz * bz);
        const double lc = std::sqrt(cx * cx + cy * cy + cz * cz);
        if (la >= 1e-18 && lb >= 1e-18 && lc >= 1e-18) {
          const double dot_ab = ax * bx + ay * by + az * bz;
          const double dot_bc = bx * cx + by * cy + bz * cz;
          const double dot_ca = cx * ax + cy * ay + cz * az;
          const double triple = (ay * bz - az * by) * cx +
                                (az * bx - ax * bz) * cy +
                                (ax * by - ay * bx) * cz;
          const double denom = la * lb * lc + dot_ab * lc + dot_bc * la + dot_ca * lb;
          omega_m += 2.0 * std::atan2(triple, denom);
        }
      }
    }
    const double w_plus = omega_p / four_pi;
    const double w_minus = omega_m / four_pi;
    const double a = std::fabs(w_plus) - 0.5;
    const double b2 = std::fabs(w_minus) - 0.5;
    const bool crosses = (a < -tau && b2 > tau) || (a > tau && b2 < -tau) ||
                         (a * b2 < -tau * tau);
    if (!crosses) keep[t] = 0;
  }

  {
    val view = val(emscripten::typed_memory_view(tri_count, keep.data()));
    result.call<void>("set", view);
  }
  return result;
}

}  // namespace

EMSCRIPTEN_BINDINGS(manifold_plus_winding_classifier) {
  emscripten::function("classifyInternalTrianglesByWinding",
                       &ClassifyInternalTrianglesByWinding);
}
