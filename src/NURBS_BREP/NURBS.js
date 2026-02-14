// NURBS library for BREP modeling

const EPS = 1e-9;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function clampParameter(u, min, max, tol = EPS) {
  if (u < min - tol || u > max + tol) {
    throw new Error(`Parameter ${u} out of range [${min}, ${max}]`);
  }
  if (u < min) return min;
  if (u > max) return max;
  return u;
}

function toPointArray(point) {
  if (Array.isArray(point)) return point.slice();
  if (ArrayBuffer.isView(point)) return Array.from(point);
  if (point && typeof point === "object") {
    if (isFiniteNumber(point.x) && isFiniteNumber(point.y)) {
      if (isFiniteNumber(point.z)) return [point.x, point.y, point.z];
      return [point.x, point.y];
    }
  }
  throw new Error("Invalid point. Expected array-like or {x,y[,z]}.");
}

function normalizePointArray(points) {
  assert(Array.isArray(points) && points.length > 0, "Control points must be a non-empty array.");
  const first = toPointArray(points[0]);
  const dim = first.length;
  assert(dim >= 2, "Control point dimension must be >= 2.");
  const out = new Array(points.length);
  out[0] = first;
  for (let i = 1; i < points.length; i++) {
    const p = toPointArray(points[i]);
    assert(p.length === dim, "All control points must have the same dimension.");
    out[i] = p;
  }
  return { points: out, dim };
}

function normalizePointGrid(grid) {
  assert(Array.isArray(grid) && grid.length > 0, "Surface control points must be a non-empty 2D array.");
  const rows = grid.length;
  assert(Array.isArray(grid[0]) && grid[0].length > 0, "Surface control points must be a rectangular 2D array.");
  const cols = grid[0].length;
  const first = toPointArray(grid[0][0]);
  const dim = first.length;
  assert(dim >= 2, "Control point dimension must be >= 2.");
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = grid[i];
    assert(Array.isArray(row) && row.length === cols, "Surface control points must be rectangular.");
    out[i] = new Array(cols);
    for (let j = 0; j < cols; j++) {
      const p = toPointArray(row[j]);
      assert(p.length === dim, "All surface control points must have the same dimension.");
      out[i][j] = p;
    }
  }
  return { points: out, dim, rows, cols };
}

function normalizeWeightsCurve(weights, count) {
  if (!weights) return new Array(count).fill(1);
  assert(Array.isArray(weights) && weights.length === count, "Weights length must match control points.");
  return weights.map((w) => {
    assert(isFiniteNumber(w), "Weights must be finite numbers.");
    return w;
  });
}

function normalizeWeightsSurface(weights, rows, cols) {
  if (!weights) {
    const out = new Array(rows);
    for (let i = 0; i < rows; i++) out[i] = new Array(cols).fill(1);
    return out;
  }
  assert(Array.isArray(weights) && weights.length === rows, "Surface weights must be a 2D array.");
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) {
    assert(Array.isArray(weights[i]) && weights[i].length === cols, "Surface weights must be rectangular.");
    out[i] = new Array(cols);
    for (let j = 0; j < cols; j++) {
      const w = weights[i][j];
      assert(isFiniteNumber(w), "Surface weights must be finite numbers.");
      out[i][j] = w;
    }
  }
  return out;
}

function validateKnotVector(knots, degree, numCtrl, label) {
  assert(Array.isArray(knots), `${label} knot vector must be an array.`);
  assert(Number.isInteger(degree) && degree >= 1, `${label} degree must be an integer >= 1.`);
  const expectedLength = numCtrl + degree + 1;
  assert(
    knots.length === expectedLength,
    `${label} knot vector length must be ${expectedLength} (got ${knots.length}).`
  );
  for (let i = 0; i < knots.length; i++) {
    assert(isFiniteNumber(knots[i]), `${label} knot values must be finite numbers.`);
    if (i > 0) {
      assert(knots[i] >= knots[i - 1], `${label} knot vector must be non-decreasing.`);
    }
  }
}

function knotMultiplicity(u, knots, tol = EPS) {
  let count = 0;
  for (let i = 0; i < knots.length; i++) {
    if (Math.abs(knots[i] - u) <= tol) count++;
  }
  return count;
}

function vecZero(dim) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = 0;
  return v;
}

function vecAddScaled(out, v, scale) {
  for (let i = 0; i < out.length; i++) out[i] += v[i] * scale;
}

function vecScale(out, scale) {
  for (let i = 0; i < out.length; i++) out[i] *= scale;
}

function vecSubScaled(out, v, scale) {
  for (let i = 0; i < out.length; i++) out[i] -= v[i] * scale;
}

function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res *= (n - (k - i));
    res /= i;
  }
  return res;
}

function clonePointArray(points) {
  return points.map((p) => p.slice());
}

function clonePointGrid(grid) {
  const out = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    out[i] = new Array(row.length);
    for (let j = 0; j < row.length; j++) out[i][j] = row[j].slice();
  }
  return out;
}

function cloneWeightGrid(grid) {
  const out = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = grid[i].slice();
  return out;
}

function homogenizePoints(controlPoints, weights, dim) {
  const Pw = new Array(controlPoints.length);
  for (let i = 0; i < controlPoints.length; i++) {
    const w = weights[i];
    const P = controlPoints[i];
    const hw = new Array(dim + 1);
    for (let d = 0; d < dim; d++) hw[d] = P[d] * w;
    hw[dim] = w;
    Pw[i] = hw;
  }
  return Pw;
}

function dehomogenizePoint(pw, dim) {
  const w = pw[dim];
  assert(Math.abs(w) > EPS, "Homogeneous weight is zero.");
  const p = new Array(dim);
  for (let d = 0; d < dim; d++) p[d] = pw[d] / w;
  return p;
}

function pointDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export class KnotVector {
  constructor(knots, degree) {
    assert(Array.isArray(knots), "Knot vector must be an array.");
    assert(Number.isInteger(degree) && degree >= 1, "Degree must be an integer >= 1.");
    this.knots = knots.slice();
    this.degree = degree;
  }

  static uniformClamped(numCtrlPoints, degree, min = 0, max = 1) {
    assert(numCtrlPoints >= degree + 1, "numCtrlPoints must be >= degree + 1.");
    const n = numCtrlPoints - 1;
    const m = n + degree + 1;
    const knots = new Array(m + 1);
    for (let i = 0; i <= degree; i++) knots[i] = min;
    for (let i = m - degree; i <= m; i++) knots[i] = max;
    const interior = n - degree;
    if (interior > 0) {
      const step = (max - min) / (interior + 1);
      for (let j = 1; j <= interior; j++) {
        knots[degree + j] = min + step * j;
      }
    }
    return new KnotVector(knots, degree);
  }

  static uniform(numCtrlPoints, degree, min = 0, max = 1) {
    assert(numCtrlPoints >= degree + 1, "numCtrlPoints must be >= degree + 1.");
    const n = numCtrlPoints - 1;
    const m = n + degree + 1;
    const knots = new Array(m + 1);
    const step = (max - min) / (m - degree * 2);
    for (let i = 0; i <= m; i++) {
      knots[i] = min + (i - degree) * step;
    }
    return new KnotVector(knots, degree);
  }

  domain() {
    return [this.knots[this.degree], this.knots[this.knots.length - this.degree - 1]];
  }

  normalize(min = 0, max = 1) {
    const [a, b] = this.domain();
    const span = b - a;
    const scale = span === 0 ? 0 : (max - min) / span;
    const out = this.knots.map((k) => (k - a) * scale + min);
    return new KnotVector(out, this.degree);
  }
}

export function findSpan(n, degree, u, knots) {
  if (u >= knots[n + 1]) return n;
  if (u <= knots[degree]) return degree;
  let low = degree;
  let high = n + 1;
  let mid = Math.floor((low + high) * 0.5);
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) {
      high = mid;
    } else {
      low = mid;
    }
    mid = Math.floor((low + high) * 0.5);
  }
  return mid;
}

export function basisFunctions(span, u, degree, knots) {
  const N = new Array(degree + 1).fill(0);
  const left = new Array(degree + 1);
  const right = new Array(degree + 1);
  N[0] = 1.0;
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom === 0 ? 0 : N[r] / denom;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

export function dersBasisFunctions(span, u, degree, n, knots) {
  const ndu = new Array(degree + 1);
  for (let i = 0; i <= degree; i++) ndu[i] = new Array(degree + 1).fill(0);
  const left = new Array(degree + 1);
  const right = new Array(degree + 1);

  ndu[0][0] = 1.0;
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r];
      const temp = ndu[j][r] === 0 ? 0 : ndu[r][j - 1] / ndu[j][r];
      ndu[r][j] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    ndu[j][j] = saved;
  }

  const ders = new Array(n + 1);
  for (let k = 0; k <= n; k++) ders[k] = new Array(degree + 1).fill(0);
  for (let j = 0; j <= degree; j++) ders[0][j] = ndu[j][degree];

  const a = [new Array(degree + 1).fill(0), new Array(degree + 1).fill(0)];
  for (let r = 0; r <= degree; r++) {
    let s1 = 0;
    let s2 = 1;
    a[0][0] = 1.0;
    for (let k = 1; k <= n; k++) {
      let d = 0.0;
      const rk = r - k;
      const pk = degree - k;
      let j1 = 0;
      let j2 = 0;
      if (r >= k) {
        const denom = ndu[pk + 1][rk];
        a[s2][0] = denom === 0 ? 0 : a[s1][0] / denom;
        d = a[s2][0] * ndu[rk][pk];
      }
      if (rk >= -1) j1 = 1;
      else j1 = -rk;
      if (r - 1 <= pk) j2 = k - 1;
      else j2 = degree - r;
      for (let j = j1; j <= j2; j++) {
        const denom = ndu[pk + 1][rk + j];
        a[s2][j] = denom === 0 ? 0 : (a[s1][j] - a[s1][j - 1]) / denom;
        d += a[s2][j] * ndu[rk + j][pk];
      }
      if (r <= pk) {
        const denom = ndu[pk + 1][r];
        a[s2][k] = denom === 0 ? 0 : -a[s1][k - 1] / denom;
        d += a[s2][k] * ndu[r][pk];
      }
      ders[k][r] = d;
      const tmp = s1;
      s1 = s2;
      s2 = tmp;
    }
  }

  let r = degree;
  for (let k = 1; k <= n; k++) {
    for (let j = 0; j <= degree; j++) {
      ders[k][j] *= r;
    }
    r *= degree - k;
  }

  return ders;
}

function curveDerivativesHomogeneous(curve, u, order) {
  const { degree, knots, controlPoints, weights, dim } = curve;
  const n = controlPoints.length - 1;
  const du = Math.min(order, degree);
  const span = findSpan(n, degree, u, knots);
  const nders = dersBasisFunctions(span, u, degree, du, knots);
  const CK = new Array(du + 1);
  const dimH = dim + 1;

  for (let k = 0; k <= du; k++) {
    const Ck = vecZero(dimH);
    for (let j = 0; j <= degree; j++) {
      const idx = span - degree + j;
      const w = weights[idx];
      const Nj = nders[k][j] * w;
      const P = controlPoints[idx];
      for (let d = 0; d < dim; d++) Ck[d] += Nj * P[d];
      Ck[dim] += Nj;
    }
    CK[k] = Ck;
  }
  return CK;
}

function rationalCurveDerivatives(Cw, dim) {
  const d = Cw.length - 1;
  const CK = new Array(d + 1);
  const w = Cw[0][dim];
  assert(Math.abs(w) > EPS, "Rational curve weight sum is zero.");
  const wDer = new Array(d + 1);
  for (let k = 0; k <= d; k++) wDer[k] = Cw[k][dim];

  CK[0] = Cw[0].slice(0, dim).map((v) => v / w);
  for (let k = 1; k <= d; k++) {
    const v = Cw[k].slice(0, dim);
    for (let i = 1; i <= k; i++) {
      const coeff = binomial(k, i) * wDer[i];
      vecSubScaled(v, CK[k - i], coeff);
    }
    vecScale(v, 1 / w);
    CK[k] = v;
  }
  return CK;
}

function surfaceDerivativesHomogeneous(surface, u, v, du, dv) {
  const { degreeU, degreeV, knotsU, knotsV, controlPoints, weights, dim } = surface;
  const nu = controlPoints.length - 1;
  const nv = controlPoints[0].length - 1;
  const duEff = Math.min(du, degreeU);
  const dvEff = Math.min(dv, degreeV);
  const uspan = findSpan(nu, degreeU, u, knotsU);
  const vspan = findSpan(nv, degreeV, v, knotsV);
  const Nu = dersBasisFunctions(uspan, u, degreeU, duEff, knotsU);
  const Nv = dersBasisFunctions(vspan, v, degreeV, dvEff, knotsV);
  const dimH = dim + 1;

  const SKL = new Array(duEff + 1);
  for (let k = 0; k <= duEff; k++) {
    SKL[k] = new Array(dvEff + 1);
    for (let l = 0; l <= dvEff; l++) SKL[k][l] = vecZero(dimH);
  }

  const temp = new Array(degreeV + 1);
  for (let k = 0; k <= duEff; k++) {
    for (let s = 0; s <= degreeV; s++) {
      const tmp = vecZero(dimH);
      for (let r = 0; r <= degreeU; r++) {
        const i = uspan - degreeU + r;
        const j = vspan - degreeV + s;
        const w = weights[i][j];
        const coeff = Nu[k][r] * w;
        const P = controlPoints[i][j];
        for (let d = 0; d < dim; d++) tmp[d] += coeff * P[d];
        tmp[dim] += coeff;
      }
      temp[s] = tmp;
    }
    for (let l = 0; l <= dvEff; l++) {
      const skl = SKL[k][l];
      for (let s = 0; s <= degreeV; s++) {
        vecAddScaled(skl, temp[s], Nv[l][s]);
      }
    }
  }
  return SKL;
}

function rationalSurfaceDerivatives(SKLw, dim) {
  const du = SKLw.length - 1;
  const dv = SKLw[0].length - 1;
  const SKL = new Array(du + 1);
  for (let k = 0; k <= du; k++) SKL[k] = new Array(dv + 1);

  const w00 = SKLw[0][0][dim];
  assert(Math.abs(w00) > EPS, "Rational surface weight sum is zero.");

  const wDer = new Array(du + 1);
  for (let k = 0; k <= du; k++) {
    wDer[k] = new Array(dv + 1);
    for (let l = 0; l <= dv; l++) wDer[k][l] = SKLw[k][l][dim];
  }

  for (let k = 0; k <= du; k++) {
    for (let l = 0; l <= dv; l++) {
      const v = SKLw[k][l].slice(0, dim);
      for (let i = 1; i <= k; i++) {
        const coeff = binomial(k, i) * wDer[i][0];
        vecSubScaled(v, SKL[k - i][l], coeff);
      }
      for (let j = 1; j <= l; j++) {
        const coeff = binomial(l, j) * wDer[0][j];
        vecSubScaled(v, SKL[k][l - j], coeff);
      }
      for (let i = 1; i <= k; i++) {
        for (let j = 1; j <= l; j++) {
          const coeff = binomial(k, i) * binomial(l, j) * wDer[i][j];
          vecSubScaled(v, SKL[k - i][l - j], coeff);
        }
      }
      vecScale(v, 1 / w00);
      SKL[k][l] = v;
    }
  }
  return SKL;
}

function curveDomain(knots, degree) {
  return [knots[degree], knots[knots.length - degree - 1]];
}

function evaluateCurveData(degree, knots, controlPoints, weights, u, dim) {
  const n = controlPoints.length - 1;
  const span = findSpan(n, degree, u, knots);
  const N = basisFunctions(span, u, degree, knots);
  const Cw = vecZero(dim + 1);
  for (let j = 0; j <= degree; j++) {
    const idx = span - degree + j;
    const w = weights[idx];
    const coeff = N[j] * w;
    const P = controlPoints[idx];
    for (let d = 0; d < dim; d++) Cw[d] += coeff * P[d];
    Cw[dim] += coeff;
  }
  const w = Cw[dim];
  assert(Math.abs(w) > EPS, "Rational curve weight sum is zero.");
  const out = new Array(dim);
  for (let d = 0; d < dim; d++) out[d] = Cw[d] / w;
  return out;
}

function maxCurveDeviation(
  degree,
  knotsA,
  controlPointsA,
  weightsA,
  knotsB,
  controlPointsB,
  weightsB,
  dim
) {
  const domainA = curveDomain(knotsA, degree);
  const domainB = curveDomain(knotsB, degree);
  const umin = Math.max(domainA[0], domainB[0]);
  const umax = Math.min(domainA[1], domainB[1]);
  if (umax < umin) return 0;
  const sampleCount = Math.max(10, Math.min(100, controlPointsA.length * 2));
  let maxError = 0;
  for (let i = 0; i <= sampleCount; i++) {
    const t = umin + (i / sampleCount) * (umax - umin);
    const pA = evaluateCurveData(degree, knotsA, controlPointsA, weightsA, t, dim);
    const pB = evaluateCurveData(degree, knotsB, controlPointsB, weightsB, t, dim);
    const err = pointDistance(pA, pB);
    if (err > maxError) maxError = err;
  }
  return maxError;
}

function insertKnotCurveData(degree, knots, controlPoints, weights, u, r, dim) {
  if (r === 0) {
    return {
      knots: knots.slice(),
      controlPoints: clonePointArray(controlPoints),
      weights: weights.slice(),
    };
  }

  const n = controlPoints.length - 1;
  const m = n + degree + 1;
  const s = knotMultiplicity(u, knots);
  assert(r >= 1 && r <= degree - s, "Invalid knot insertion count.");
  const k = findSpan(n, degree, u, knots);

  const Pw = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const w = weights[i];
    const P = controlPoints[i];
    const hw = new Array(dim + 1);
    for (let d = 0; d < dim; d++) hw[d] = P[d] * w;
    hw[dim] = w;
    Pw[i] = hw;
  }

  const nq = n + r;
  const mq = m + r;
  const UQ = new Array(mq + 1);
  for (let i = 0; i <= k; i++) UQ[i] = knots[i];
  for (let i = 1; i <= r; i++) UQ[k + i] = u;
  for (let i = k + 1; i <= m; i++) UQ[i + r] = knots[i];

  const Qw = new Array(nq + 1);
  for (let i = 0; i <= k - degree; i++) Qw[i] = Pw[i].slice();
  for (let i = k - s; i <= n; i++) Qw[i + r] = Pw[i].slice();

  const Rw = new Array(degree - s + 1);
  for (let i = 0; i <= degree - s; i++) {
    Rw[i] = Pw[k - degree + i].slice();
  }

  for (let j = 1; j <= r; j++) {
    const L = k - degree + j;
    for (let i = 0; i <= degree - j - s; i++) {
      const denom = knots[i + k + 1] - knots[L + i];
      const alpha = denom === 0 ? 0 : (u - knots[L + i]) / denom;
      const Ri = Rw[i];
      const Ri1 = Rw[i + 1];
      for (let d = 0; d <= dim; d++) {
        Ri[d] = alpha * Ri1[d] + (1 - alpha) * Ri[d];
      }
    }
    Qw[L] = Rw[0].slice();
    Qw[k + r - j - s] = Rw[degree - j - s].slice();
  }

  const L = k - degree + r;
  for (let i = L + 1; i <= k - s - 1; i++) {
    Qw[i] = Rw[i - L].slice();
  }

  const newControl = new Array(nq + 1);
  const newWeights = new Array(nq + 1);
  for (let i = 0; i <= nq; i++) {
    const w = Qw[i][dim];
    newWeights[i] = w;
    newControl[i] = new Array(dim);
    for (let d = 0; d < dim; d++) newControl[i][d] = Qw[i][d] / w;
  }

  return { knots: UQ, controlPoints: newControl, weights: newWeights };
}

function removeOneKnotCurveData(degree, knots, controlPoints, weights, u, dim, tol) {
  const n = controlPoints.length - 1;
  const s = knotMultiplicity(u, knots);
  if (s <= 0) return { removed: 0, maxError: 0 };
  if (n <= degree) return { removed: 0, maxError: 0 };

  const k = findSpan(n, degree, u, knots);
  const first = k - degree;
  const last = k - s;
  if (first < 1 || last + 1 > n) return { removed: 0, maxError: 0 };

  const Pw = homogenizePoints(controlPoints, weights, dim);
  const temp = [];
  const off = first - 1;
  temp[0] = Pw[off].slice();
  temp[last + 1 - off] = Pw[last + 1].slice();

  let i = first;
  let j = last;
  let ii = 1;
  let jj = last - off;
  while (j - i > 0) {
    const denomL = knots[i + degree + 1] - knots[i];
    if (Math.abs(denomL) < EPS) return { removed: 0, maxError: 0 };
    const alphaL = (u - knots[i]) / denomL;
    if (Math.abs(alphaL) < EPS) return { removed: 0, maxError: 0 };
    const tmpL = new Array(dim + 1);
    for (let d = 0; d <= dim; d++) {
      tmpL[d] = (Pw[i][d] - (1 - alphaL) * temp[ii - 1][d]) / alphaL;
    }
    temp[ii] = tmpL;

    const denomR = knots[j + degree + 1] - knots[j];
    if (Math.abs(denomR) < EPS) return { removed: 0, maxError: 0 };
    const alphaR = (u - knots[j]) / denomR;
    const oneMinus = 1 - alphaR;
    if (Math.abs(oneMinus) < EPS) return { removed: 0, maxError: 0 };
    const tmpR = new Array(dim + 1);
    for (let d = 0; d <= dim; d++) {
      tmpR[d] = (Pw[j][d] - alphaR * temp[jj + 1][d]) / oneMinus;
    }
    temp[jj] = tmpR;

    i += 1;
    j -= 1;
    ii += 1;
    jj -= 1;
  }

  const pA = dehomogenizePoint(temp[ii - 1], dim);
  const pB = dehomogenizePoint(temp[jj + 1], dim);
  const localError = pointDistance(pA, pB);
  if (localError > tol) return { removed: 0, maxError: localError };

  const PwUpdated = Pw.map((p) => p.slice());
  for (let idx = first; idx <= last; idx++) {
    PwUpdated[idx] = temp[idx - off].slice();
  }

  const removeIndex = k - s;
  const PwOut = new Array(n);
  for (let idx = 0; idx < removeIndex; idx++) PwOut[idx] = PwUpdated[idx];
  for (let idx = removeIndex; idx < n; idx++) PwOut[idx] = PwUpdated[idx + 1];

  const newKnots = new Array(knots.length - 1);
  for (let idx = 0; idx < k; idx++) newKnots[idx] = knots[idx];
  for (let idx = k; idx < knots.length - 1; idx++) newKnots[idx] = knots[idx + 1];

  const newControl = new Array(PwOut.length);
  const newWeights = new Array(PwOut.length);
  for (let idx = 0; idx < PwOut.length; idx++) {
    const w = PwOut[idx][dim];
    if (Math.abs(w) < EPS) return { removed: 0, maxError: 0 };
    newWeights[idx] = w;
    const P = new Array(dim);
    for (let d = 0; d < dim; d++) P[d] = PwOut[idx][d] / w;
    newControl[idx] = P;
  }

  const maxError = maxCurveDeviation(
    degree,
    knots,
    controlPoints,
    weights,
    newKnots,
    newControl,
    newWeights,
    dim
  );
  if (maxError > tol) return { removed: 0, maxError };

  return {
    removed: 1,
    maxError,
    controlPoints: newControl,
    weights: newWeights,
    knots: newKnots,
  };
}

function removeKnotCurveData(degree, knots, controlPoints, weights, u, r, dim, tol) {
  let removed = 0;
  let maxError = 0;
  let data = {
    controlPoints: clonePointArray(controlPoints),
    weights: weights.slice(),
    knots: knots.slice(),
  };

  for (let i = 0; i < r; i++) {
    const result = removeOneKnotCurveData(
      degree,
      data.knots,
      data.controlPoints,
      data.weights,
      u,
      dim,
      tol
    );
    if (!result.removed) {
      if (result.maxError > maxError) maxError = result.maxError;
      break;
    }
    removed += result.removed;
    if (result.maxError > maxError) maxError = result.maxError;
    data = {
      controlPoints: result.controlPoints,
      weights: result.weights,
      knots: result.knots,
    };
  }

  return {
    removed,
    maxError,
    controlPoints: data.controlPoints,
    weights: data.weights,
    knots: data.knots,
  };
}

export class NURBSCurve {
  constructor({ degree, controlPoints, weights, knots }) {
    const { points, dim } = normalizePointArray(controlPoints);
    this.degree = degree;
    this.controlPoints = points;
    this.dim = dim;
    this.weights = normalizeWeightsCurve(weights, points.length);
    if (knots) {
      this.knots = knots.slice();
    } else {
      this.knots = KnotVector.uniformClamped(points.length, degree).knots;
    }
    validateKnotVector(this.knots, this.degree, this.controlPoints.length, "Curve");
  }

  domain() {
    return [this.knots[this.degree], this.knots[this.knots.length - this.degree - 1]];
  }

  evaluate(u, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domain();
    const t = clamp ? clampParameter(u, umin, umax) : u;
    const n = this.controlPoints.length - 1;
    const span = findSpan(n, this.degree, t, this.knots);
    const N = basisFunctions(span, t, this.degree, this.knots);
    const Cw = vecZero(this.dim + 1);
    for (let j = 0; j <= this.degree; j++) {
      const idx = span - this.degree + j;
      const w = this.weights[idx];
      const coeff = N[j] * w;
      const P = this.controlPoints[idx];
      for (let d = 0; d < this.dim; d++) Cw[d] += coeff * P[d];
      Cw[this.dim] += coeff;
    }
    const w = Cw[this.dim];
    assert(Math.abs(w) > EPS, "Rational curve weight sum is zero.");
    return Cw.slice(0, this.dim).map((v) => v / w);
  }

  derivatives(u, order = 1, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domain();
    const t = clamp ? clampParameter(u, umin, umax) : u;
    const Cw = curveDerivativesHomogeneous(this, t, order);
    return rationalCurveDerivatives(Cw, this.dim);
  }

  tangent(u, options = {}) {
    const ders = this.derivatives(u, 1, options);
    const tan = ders[1];
    let len = 0;
    for (let i = 0; i < tan.length; i++) len += tan[i] * tan[i];
    len = Math.sqrt(len);
    if (len < EPS) return tan.slice();
    return tan.map((v) => v / len);
  }

  approximateLength(segments = 64) {
    assert(Number.isInteger(segments) && segments > 0, "segments must be a positive integer.");
    const [umin, umax] = this.domain();
    let total = 0;
    let prev = this.evaluate(umin);
    for (let i = 1; i <= segments; i++) {
      const t = umin + (i / segments) * (umax - umin);
      const curr = this.evaluate(t);
      let d2 = 0;
      for (let k = 0; k < curr.length; k++) {
        const dx = curr[k] - prev[k];
        d2 += dx * dx;
      }
      total += Math.sqrt(d2);
      prev = curr;
    }
    return total;
  }

  insertKnot(u, r = 1, options = {}) {
    assert(Number.isInteger(r) && r >= 0, "r must be a non-negative integer.");
    const { clamp = true } = options;
    const [umin, umax] = this.domain();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    const s = knotMultiplicity(uu, this.knots);
    if (r === 0) return new NURBSCurve(this);
    assert(r <= this.degree - s, "Knot insertion exceeds maximum multiplicity.");
    const data = insertKnotCurveData(
      this.degree,
      this.knots,
      this.controlPoints,
      this.weights,
      uu,
      r,
      this.dim
    );
    return new NURBSCurve({
      degree: this.degree,
      controlPoints: data.controlPoints,
      weights: data.weights,
      knots: data.knots,
    });
  }

  refineKnots(knotsToInsert, options = {}) {
    assert(Array.isArray(knotsToInsert), "knotsToInsert must be an array.");
    const sorted = knotsToInsert.slice().sort((a, b) => a - b);
    let curve = this;
    for (let i = 0; i < sorted.length; i++) {
      curve = curve.insertKnot(sorted[i], 1, options);
    }
    return curve;
  }

  split(u, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domain();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    assert(uu > umin + EPS && uu < umax - EPS, "Split parameter must be inside the domain.");
    const s = knotMultiplicity(uu, this.knots);
    const r = this.degree - s;
    const refined = r > 0 ? this.insertKnot(uu, r, { clamp: false }) : this;
    const n = refined.controlPoints.length - 1;
    const k = findSpan(n, refined.degree, uu, refined.knots);
    const leftEnd = k - refined.degree;

    const leftCtrl = refined.controlPoints.slice(0, leftEnd + 1);
    const leftW = refined.weights.slice(0, leftEnd + 1);
    const rightCtrl = refined.controlPoints.slice(leftEnd);
    const rightW = refined.weights.slice(leftEnd);

    const leftKnots = refined.knots.slice(0, k + 1);
    leftKnots.push(uu);
    const rightKnots = [uu].concat(refined.knots.slice(leftEnd + 1));

    return [
      new NURBSCurve({
        degree: refined.degree,
        controlPoints: leftCtrl,
        weights: leftW,
        knots: leftKnots,
      }),
      new NURBSCurve({
        degree: refined.degree,
        controlPoints: rightCtrl,
        weights: rightW,
        knots: rightKnots,
      }),
    ];
  }

  removeKnot(u, r = 1, options = {}) {
    assert(Number.isInteger(r) && r >= 0, "r must be a non-negative integer.");
    const { clamp = true, tolerance = 1e-6, throwOnFail = false } = options;
    const [umin, umax] = this.domain();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    if (r === 0) return { curve: this, removed: 0, maxError: 0 };

    const s = knotMultiplicity(uu, this.knots);
    if (s <= 0) {
      if (throwOnFail) throw new Error(`Knot ${uu} is not present in the curve.`);
      return { curve: this, removed: 0, maxError: 0 };
    }

    const data = removeKnotCurveData(
      this.degree,
      this.knots,
      this.controlPoints,
      this.weights,
      uu,
      Math.min(r, s),
      this.dim,
      tolerance
    );

    if (data.removed <= 0) {
      if (throwOnFail) throw new Error(`Knot removal failed within tolerance (${tolerance}).`);
      return { curve: this, removed: 0, maxError: data.maxError };
    }

    const curve = new NURBSCurve({
      degree: this.degree,
      controlPoints: data.controlPoints,
      weights: data.weights,
      knots: data.knots,
    });

    if (throwOnFail && data.removed < r) {
      throw new Error(`Only removed ${data.removed} of ${r} requested knot(s) at u=${uu}.`);
    }

    return { curve, removed: data.removed, maxError: data.maxError };
  }

  removeKnots(knotsToRemove, options = {}) {
    assert(Array.isArray(knotsToRemove), "knotsToRemove must be an array.");
    const sorted = knotsToRemove.slice().sort((a, b) => a - b);
    let curve = this;
    let removed = 0;
    let maxError = 0;
    for (let i = 0; i < sorted.length; i++) {
      const result = curve.removeKnot(sorted[i], 1, options);
      curve = result.curve;
      removed += result.removed;
      if (result.maxError > maxError) maxError = result.maxError;
    }
    return { curve, removed, maxError };
  }
}

export class NURBSSurface {
  constructor({ degreeU, degreeV, controlPoints, weights, knotsU, knotsV }) {
    const { points, dim, rows, cols } = normalizePointGrid(controlPoints);
    this.degreeU = degreeU;
    this.degreeV = degreeV;
    this.controlPoints = points;
    this.dim = dim;
    this.weights = normalizeWeightsSurface(weights, rows, cols);
    if (knotsU) this.knotsU = knotsU.slice();
    else this.knotsU = KnotVector.uniformClamped(rows, degreeU).knots;
    if (knotsV) this.knotsV = knotsV.slice();
    else this.knotsV = KnotVector.uniformClamped(cols, degreeV).knots;
    validateKnotVector(this.knotsU, this.degreeU, rows, "Surface U");
    validateKnotVector(this.knotsV, this.degreeV, cols, "Surface V");
  }

  domainU() {
    return [this.knotsU[this.degreeU], this.knotsU[this.knotsU.length - this.degreeU - 1]];
  }

  domainV() {
    return [this.knotsV[this.degreeV], this.knotsV[this.knotsV.length - this.degreeV - 1]];
  }

  evaluate(u, v, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domainU();
    const [vmin, vmax] = this.domainV();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    const vv = clamp ? clampParameter(v, vmin, vmax) : v;
    const nu = this.controlPoints.length - 1;
    const nv = this.controlPoints[0].length - 1;
    const uspan = findSpan(nu, this.degreeU, uu, this.knotsU);
    const vspan = findSpan(nv, this.degreeV, vv, this.knotsV);
    const Nu = basisFunctions(uspan, uu, this.degreeU, this.knotsU);
    const Nv = basisFunctions(vspan, vv, this.degreeV, this.knotsV);
    const dimH = this.dim + 1;
    const temp = new Array(this.degreeV + 1);
    for (let l = 0; l <= this.degreeV; l++) temp[l] = vecZero(dimH);

    for (let l = 0; l <= this.degreeV; l++) {
      const tmp = temp[l];
      for (let k = 0; k <= this.degreeU; k++) {
        const i = uspan - this.degreeU + k;
        const j = vspan - this.degreeV + l;
        const w = this.weights[i][j];
        const coeff = Nu[k] * w;
        const P = this.controlPoints[i][j];
        for (let d = 0; d < this.dim; d++) tmp[d] += coeff * P[d];
        tmp[this.dim] += coeff;
      }
    }

    const Cw = vecZero(dimH);
    for (let l = 0; l <= this.degreeV; l++) vecAddScaled(Cw, temp[l], Nv[l]);
    const w = Cw[this.dim];
    assert(Math.abs(w) > EPS, "Rational surface weight sum is zero.");
    return Cw.slice(0, this.dim).map((val) => val / w);
  }

  derivatives(u, v, du = 1, dv = 1, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domainU();
    const [vmin, vmax] = this.domainV();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    const vv = clamp ? clampParameter(v, vmin, vmax) : v;
    const SKLw = surfaceDerivativesHomogeneous(this, uu, vv, du, dv);
    return rationalSurfaceDerivatives(SKLw, this.dim);
  }

  normal(u, v, options = {}) {
    if (this.dim !== 3) throw new Error("Surface normal is only defined for 3D surfaces.");
    const ders = this.derivatives(u, v, 1, 1, options);
    const du = ders[1][0];
    const dv = ders[0][1];
    const n = vecCross(du, dv);
    let len = 0;
    for (let i = 0; i < 3; i++) len += n[i] * n[i];
    len = Math.sqrt(len);
    if (len < EPS) return n;
    return n.map((v0) => v0 / len);
  }

  insertKnotU(u, r = 1, options = {}) {
    assert(Number.isInteger(r) && r >= 0, "r must be a non-negative integer.");
    const { clamp = true } = options;
    const [umin, umax] = this.domainU();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    const s = knotMultiplicity(uu, this.knotsU);
    if (r === 0) return new NURBSSurface(this);
    assert(r <= this.degreeU - s, "Knot insertion exceeds maximum multiplicity.");

    const rows = this.controlPoints.length;
    const cols = this.controlPoints[0].length;
    const newRows = rows + r;
    const newCtrl = new Array(newRows);
    const newW = new Array(newRows);
    for (let i = 0; i < newRows; i++) {
      newCtrl[i] = new Array(cols);
      newW[i] = new Array(cols);
    }

    let newKnotsU = null;
    for (let j = 0; j < cols; j++) {
      const colPoints = new Array(rows);
      const colWeights = new Array(rows);
      for (let i = 0; i < rows; i++) {
        colPoints[i] = this.controlPoints[i][j];
        colWeights[i] = this.weights[i][j];
      }
      const data = insertKnotCurveData(
        this.degreeU,
        this.knotsU,
        colPoints,
        colWeights,
        uu,
        r,
        this.dim
      );
      if (!newKnotsU) newKnotsU = data.knots;
      for (let i = 0; i < newRows; i++) {
        newCtrl[i][j] = data.controlPoints[i];
        newW[i][j] = data.weights[i];
      }
    }

    return new NURBSSurface({
      degreeU: this.degreeU,
      degreeV: this.degreeV,
      controlPoints: newCtrl,
      weights: newW,
      knotsU: newKnotsU,
      knotsV: this.knotsV,
    });
  }

  insertKnotV(v, r = 1, options = {}) {
    assert(Number.isInteger(r) && r >= 0, "r must be a non-negative integer.");
    const { clamp = true } = options;
    const [vmin, vmax] = this.domainV();
    const vv = clamp ? clampParameter(v, vmin, vmax) : v;
    const s = knotMultiplicity(vv, this.knotsV);
    if (r === 0) return new NURBSSurface(this);
    assert(r <= this.degreeV - s, "Knot insertion exceeds maximum multiplicity.");

    const rows = this.controlPoints.length;
    const cols = this.controlPoints[0].length;
    const newCols = cols + r;
    const newCtrl = new Array(rows);
    const newW = new Array(rows);
    for (let i = 0; i < rows; i++) {
      newCtrl[i] = new Array(newCols);
      newW[i] = new Array(newCols);
    }

    let newKnotsV = null;
    for (let i = 0; i < rows; i++) {
      const rowPoints = this.controlPoints[i];
      const rowWeights = this.weights[i];
      const data = insertKnotCurveData(
        this.degreeV,
        this.knotsV,
        rowPoints,
        rowWeights,
        vv,
        r,
        this.dim
      );
      if (!newKnotsV) newKnotsV = data.knots;
      for (let j = 0; j < newCols; j++) {
        newCtrl[i][j] = data.controlPoints[j];
        newW[i][j] = data.weights[j];
      }
    }

    return new NURBSSurface({
      degreeU: this.degreeU,
      degreeV: this.degreeV,
      controlPoints: newCtrl,
      weights: newW,
      knotsU: this.knotsU,
      knotsV: newKnotsV,
    });
  }

  refineKnotsU(knotsToInsert, options = {}) {
    assert(Array.isArray(knotsToInsert), "knotsToInsert must be an array.");
    const sorted = knotsToInsert.slice().sort((a, b) => a - b);
    let surface = this;
    for (let i = 0; i < sorted.length; i++) {
      surface = surface.insertKnotU(sorted[i], 1, options);
    }
    return surface;
  }

  refineKnotsV(knotsToInsert, options = {}) {
    assert(Array.isArray(knotsToInsert), "knotsToInsert must be an array.");
    const sorted = knotsToInsert.slice().sort((a, b) => a - b);
    let surface = this;
    for (let i = 0; i < sorted.length; i++) {
      surface = surface.insertKnotV(sorted[i], 1, options);
    }
    return surface;
  }

  splitU(u, options = {}) {
    const { clamp = true } = options;
    const [umin, umax] = this.domainU();
    const uu = clamp ? clampParameter(u, umin, umax) : u;
    assert(uu > umin + EPS && uu < umax - EPS, "Split parameter must be inside the domain.");
    const s = knotMultiplicity(uu, this.knotsU);
    const r = this.degreeU - s;
    const refined = r > 0 ? this.insertKnotU(uu, r, { clamp: false }) : this;
    const n = refined.controlPoints.length - 1;
    const k = findSpan(n, refined.degreeU, uu, refined.knotsU);
    const leftEnd = k - refined.degreeU;

    const leftCtrl = refined.controlPoints.slice(0, leftEnd + 1);
    const leftW = refined.weights.slice(0, leftEnd + 1);
    const rightCtrl = refined.controlPoints.slice(leftEnd);
    const rightW = refined.weights.slice(leftEnd);

    const leftKnotsU = refined.knotsU.slice(0, k + 1);
    leftKnotsU.push(uu);
    const rightKnotsU = [uu].concat(refined.knotsU.slice(leftEnd + 1));

    return [
      new NURBSSurface({
        degreeU: refined.degreeU,
        degreeV: refined.degreeV,
        controlPoints: clonePointGrid(leftCtrl),
        weights: cloneWeightGrid(leftW),
        knotsU: leftKnotsU,
        knotsV: refined.knotsV.slice(),
      }),
      new NURBSSurface({
        degreeU: refined.degreeU,
        degreeV: refined.degreeV,
        controlPoints: clonePointGrid(rightCtrl),
        weights: cloneWeightGrid(rightW),
        knotsU: rightKnotsU,
        knotsV: refined.knotsV.slice(),
      }),
    ];
  }

  splitV(v, options = {}) {
    const { clamp = true } = options;
    const [vmin, vmax] = this.domainV();
    const vv = clamp ? clampParameter(v, vmin, vmax) : v;
    assert(vv > vmin + EPS && vv < vmax - EPS, "Split parameter must be inside the domain.");
    const s = knotMultiplicity(vv, this.knotsV);
    const r = this.degreeV - s;
    const refined = r > 0 ? this.insertKnotV(vv, r, { clamp: false }) : this;
    const n = refined.controlPoints[0].length - 1;
    const k = findSpan(n, refined.degreeV, vv, refined.knotsV);
    const leftEnd = k - refined.degreeV;

    const rows = refined.controlPoints.length;
    const leftCtrl = new Array(rows);
    const rightCtrl = new Array(rows);
    const leftW = new Array(rows);
    const rightW = new Array(rows);
    for (let i = 0; i < rows; i++) {
      leftCtrl[i] = refined.controlPoints[i].slice(0, leftEnd + 1);
      rightCtrl[i] = refined.controlPoints[i].slice(leftEnd);
      leftW[i] = refined.weights[i].slice(0, leftEnd + 1);
      rightW[i] = refined.weights[i].slice(leftEnd);
    }

    const leftKnotsV = refined.knotsV.slice(0, k + 1);
    leftKnotsV.push(vv);
    const rightKnotsV = [vv].concat(refined.knotsV.slice(leftEnd + 1));

    return [
      new NURBSSurface({
        degreeU: refined.degreeU,
        degreeV: refined.degreeV,
        controlPoints: clonePointGrid(leftCtrl),
        weights: cloneWeightGrid(leftW),
        knotsU: refined.knotsU.slice(),
        knotsV: leftKnotsV,
      }),
      new NURBSSurface({
        degreeU: refined.degreeU,
        degreeV: refined.degreeV,
        controlPoints: clonePointGrid(rightCtrl),
        weights: cloneWeightGrid(rightW),
        knotsU: refined.knotsU.slice(),
        knotsV: rightKnotsV,
      }),
    ];
  }
}

export const NURBS = {
  EPS,
  KnotVector,
  findSpan,
  basisFunctions,
  dersBasisFunctions,
  NURBSCurve,
  NURBSSurface,
};

export default NURBS;
