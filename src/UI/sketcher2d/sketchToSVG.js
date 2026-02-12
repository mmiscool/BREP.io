function formatNumber(value, precision) {
  const p = Number.isFinite(precision) ? Math.max(0, Math.min(8, Math.floor(precision))) : 3;
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(p);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  let next = angle % twoPi;
  if (next < 0) next += twoPi;
  return next;
}

function collectPointMap(sketch) {
  const map = new Map();
  for (const pt of sketch?.points || []) {
    if (!pt || !Number.isFinite(Number(pt.id))) continue;
    const x = Number(pt.x);
    const y = Number(pt.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    map.set(Number(pt.id), { x, y });
  }
  return map;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const x = (mt * mt * mt * p0.x)
    + (3 * mt * mt * t * p1.x)
    + (3 * mt * t * t * p2.x)
    + (t * t * t * p3.x);
  const y = (mt * mt * mt * p0.y)
    + (3 * mt * mt * t * p1.y)
    + (3 * mt * t * t * p2.y)
    + (t * t * t * p3.y);
  return { x, y };
}

function arcSweep(startAngle, endAngle) {
  const twoPi = Math.PI * 2;
  let delta = endAngle - startAngle;
  delta = ((delta % twoPi) + twoPi) % twoPi;
  if (Math.abs(delta) < 1e-8) delta = twoPi;
  return delta;
}

function pathForGeometry(geo, pointsById, precision, bezierSamples) {
  if (!geo || !Array.isArray(geo.points)) return null;
  if (geo.type === "line" && geo.points.length >= 2) {
    const p0 = pointsById.get(Number(geo.points[0]));
    const p1 = pointsById.get(Number(geo.points[1]));
    if (!p0 || !p1) return null;
    return {
      d: `M ${formatNumber(p0.x, precision)} ${formatNumber(p0.y, precision)} L ${formatNumber(p1.x, precision)} ${formatNumber(p1.y, precision)}`,
      samples: [p0, p1],
      closed: false,
    };
  }

  if (geo.type === "circle" && geo.points.length >= 2) {
    const center = pointsById.get(Number(geo.points[0]));
    const radiusPt = pointsById.get(Number(geo.points[1]));
    if (!center || !radiusPt) return null;
    const r = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
    if (!Number.isFinite(r) || r <= 1e-9) return null;
    const x0 = center.x + r;
    const x1 = center.x - r;
    const d = [
      "M", formatNumber(x0, precision), formatNumber(center.y, precision),
      "A", formatNumber(r, precision), formatNumber(r, precision), "0", "1", "1", formatNumber(x1, precision), formatNumber(center.y, precision),
      "A", formatNumber(r, precision), formatNumber(r, precision), "0", "1", "1", formatNumber(x0, precision), formatNumber(center.y, precision),
    ].join(" ");
    const samples = [];
    for (let i = 0; i < 32; i += 1) {
      const t = (i / 32) * Math.PI * 2;
      samples.push({ x: center.x + (r * Math.cos(t)), y: center.y + (r * Math.sin(t)) });
    }
    return { d, samples, closed: true };
  }

  if (geo.type === "arc" && geo.points.length >= 3) {
    const center = pointsById.get(Number(geo.points[0]));
    const start = pointsById.get(Number(geo.points[1]));
    const end = pointsById.get(Number(geo.points[2]));
    if (!center || !start || !end) return null;
    const r = Math.hypot(start.x - center.x, start.y - center.y);
    if (!Number.isFinite(r) || r <= 1e-9) return null;
    const a0 = normalizeAngle(Math.atan2(start.y - center.y, start.x - center.x));
    const a1 = normalizeAngle(Math.atan2(end.y - center.y, end.x - center.x));
    const sweep = arcSweep(a0, a1);
    if (Math.abs(sweep - (Math.PI * 2)) < 1e-8) {
      const x0 = center.x + r;
      const x1 = center.x - r;
      const d = [
        "M", formatNumber(x0, precision), formatNumber(center.y, precision),
        "A", formatNumber(r, precision), formatNumber(r, precision), "0", "1", "1", formatNumber(x1, precision), formatNumber(center.y, precision),
        "A", formatNumber(r, precision), formatNumber(r, precision), "0", "1", "1", formatNumber(x0, precision), formatNumber(center.y, precision),
      ].join(" ");
      const samples = [];
      for (let i = 0; i < 32; i += 1) {
        const t = (i / 32) * Math.PI * 2;
        samples.push({ x: center.x + (r * Math.cos(t)), y: center.y + (r * Math.sin(t)) });
      }
      return { d, samples, closed: true };
    }
    const largeArcFlag = sweep > Math.PI ? 1 : 0;
    const d = [
      "M", formatNumber(start.x, precision), formatNumber(start.y, precision),
      "A", formatNumber(r, precision), formatNumber(r, precision), "0", String(largeArcFlag), "1", formatNumber(end.x, precision), formatNumber(end.y, precision),
    ].join(" ");
    const segs = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 48));
    const samples = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = a0 + (sweep * (i / segs));
      samples.push({ x: center.x + (r * Math.cos(t)), y: center.y + (r * Math.sin(t)) });
    }
    return { d, samples, closed: false };
  }

  if (geo.type === "bezier" && geo.points.length >= 4) {
    const ids = geo.points.map((id) => Number(id));
    const segCount = Math.floor((ids.length - 1) / 3);
    if (segCount < 1) return null;
    const p0 = pointsById.get(ids[0]);
    if (!p0) return null;
    const chunks = [`M ${formatNumber(p0.x, precision)} ${formatNumber(p0.y, precision)}`];
    const samples = [p0];
    for (let seg = 0; seg < segCount; seg += 1) {
      const i0 = seg * 3;
      const c0 = pointsById.get(ids[i0 + 1]);
      const c1 = pointsById.get(ids[i0 + 2]);
      const p1 = pointsById.get(ids[i0 + 3]);
      const start = pointsById.get(ids[i0]);
      if (!start || !c0 || !c1 || !p1) return null;
      chunks.push(`C ${formatNumber(c0.x, precision)} ${formatNumber(c0.y, precision)} ${formatNumber(c1.x, precision)} ${formatNumber(c1.y, precision)} ${formatNumber(p1.x, precision)} ${formatNumber(p1.y, precision)}`);
      for (let i = 1; i <= bezierSamples; i += 1) {
        const t = i / bezierSamples;
        samples.push(cubicPoint(start, c0, c1, p1, t));
      }
    }
    return { d: chunks.join(" "), samples, closed: false };
  }

  return null;
}

function buildPaths(sketch, options = {}, includeSamples = false) {
  const includeConstruction = options.includeConstruction === true;
  const precision = Number.isFinite(Number(options.precision)) ? Number(options.precision) : 3;
  const bezierSamples = Number.isFinite(Number(options.bezierSamples))
    ? Math.max(6, Math.min(128, Math.floor(Number(options.bezierSamples))))
    : 24;
  const pointsById = collectPointMap(sketch || {});
  const out = [];
  for (const geo of sketch?.geometries || []) {
    if (!geo || !geo.type) continue;
    if (!includeConstruction && geo.construction === true) continue;
    const built = pathForGeometry(geo, pointsById, precision, bezierSamples);
    if (!built) continue;
    const row = {
      id: Number.isFinite(Number(geo.id)) ? Number(geo.id) : geo.id,
      type: geo.type,
      d: built.d,
      construction: geo.construction === true,
      closed: built.closed === true,
    };
    if (includeSamples) row.samples = built.samples;
    out.push(row);
  }
  return out;
}

function computeBounds(pathsWithSamples) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of pathsWithSamples) {
    for (const pt of row.samples || []) {
      const x = Number(pt?.x);
      const y = Number(pt?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  if (maxX <= minX) maxX = minX + 1;
  if (maxY <= minY) maxY = minY + 1;
  return { minX, minY, maxX, maxY };
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sketchToSVGPaths(sketch, options = {}) {
  const rows = buildPaths(sketch, options, false);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    d: row.d,
    construction: row.construction,
    closed: row.closed,
  }));
}

export function sketchToSVG(sketch, options = {}) {
  const precision = Number.isFinite(Number(options.precision)) ? Number(options.precision) : 3;
  const padding = Number.isFinite(Number(options.padding)) ? Math.max(0, Number(options.padding)) : 10;
  const stroke = options.stroke || "#111111";
  const strokeWidth = Number.isFinite(Number(options.strokeWidth)) ? Number(options.strokeWidth) : 1.5;
  const fill = options.fill || "none";
  const background = options.background || null;
  const flipY = options.flipY !== false;
  const pathsWithSamples = buildPaths(sketch, options, true);
  const paths = pathsWithSamples.map((row) => ({
    id: row.id,
    type: row.type,
    d: row.d,
    construction: row.construction,
    closed: row.closed,
  }));
  const bounds = computeBounds(pathsWithSamples);
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const width = contentWidth + (padding * 2);
  const height = contentHeight + (padding * 2);
  const tx = padding - bounds.minX;
  const ty = padding - bounds.minY;
  const transform = flipY
    ? `translate(${formatNumber(tx, precision)} ${formatNumber(height - ty, precision)}) scale(1 -1)`
    : `translate(${formatNumber(tx, precision)} ${formatNumber(ty, precision)})`;
  const pathMarkup = paths
    .map((row) => `<path d="${escapeAttr(row.d)}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${formatNumber(strokeWidth, precision)}" vector-effect="non-scaling-stroke" data-geometry-id="${escapeAttr(row.id)}" data-geometry-type="${escapeAttr(row.type)}" />`)
    .join("");
  const bgMarkup = background
    ? `<rect x="0" y="0" width="${formatNumber(width, precision)}" height="${formatNumber(height, precision)}" fill="${escapeAttr(background)}" />`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width, precision)}" height="${formatNumber(height, precision)}" viewBox="0 0 ${formatNumber(width, precision)} ${formatNumber(height, precision)}">${bgMarkup}<g transform="${escapeAttr(transform)}">${pathMarkup}</g></svg>`;
  return {
    svg,
    paths,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      contentWidth,
      contentHeight,
      width,
      height,
      padding,
      flipY,
      transform,
    },
  };
}
