// FuzzyDraw - zero-dependency raster-to-primitive vectorizer
// Exports: loadPNGToImageData, vectorizeImageData, shapesToSVG, renderShapesToSVG

export const defaultOptions = {
  threshold: 200, // grayscale threshold for "ink"
  minAlpha: 10, // alpha threshold for "ink"
  minComponentSize: 25, // pixels
  sampleStep: 2, // sample every Nth pixel for fitting
  outlineStep: 2, // sample every Nth boundary pixel for path display
  lineMaxRmsRatio: 0.02, // RMS distance / component diagonal
  lineMaxDistRatio: 0.05, // max distance / component diagonal
  lineMinEigenRatio: 8, // line eccentricity threshold (bigger = more line-like)
  circleMaxRmsRatio: 0.08, // RMS radial error / radius
  circleMaxSpreadRatio: 0.25, // (rmax-rmin)/radius allowed for thick strokes
  circleMinCurvatureRatio: 0.2, // component diag / radius (reject near-lines)
  fullCircleRatio: 0.9, // span fraction to consider a full circle
  arcMinSpan: Math.PI / 6, // minimum arc span (radians)
  circleByArcLengthRatio: 0.9, // arc length / circumference to promote to circle
  arcLineRatio: 0.15, // treat short arcs (< ratio of full circle) as lines
};

export async function loadPNGToImageData(source) {
  if (source instanceof ImageData) return source;
  if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d");
    return ctx.getImageData(0, 0, source.width, source.height);
  }
  if (source instanceof HTMLImageElement) {
    await ensureImageLoaded(source);
    return imageToImageData(source);
  }
  if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    try {
      const img = await loadImage(url);
      return imageToImageData(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (typeof source === "string") {
    const img = await loadImage(source);
    return imageToImageData(img);
  }
  throw new Error("Unsupported source type. Provide ImageData, canvas, image, Blob, or URL string.");
}

export async function vectorizePNGToSVG(source, options = {}) {
  const imageData = await loadPNGToImageData(source);
  const { svg: svgOptions, ...vectorOptions } = options;
  const shapes = vectorizeImageData(imageData, vectorOptions);
  return shapesToSVG(shapes, imageData.width, imageData.height, svgOptions);
}

export function vectorizeImageData(imageData, options = {}) {
  const opts = { ...defaultOptions, ...options };
  const { width, height, data } = imageData;
  const size = width * height;
  const mask = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < opts.minAlpha) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum <= opts.threshold) mask[i] = 1;
  }

  const visited = new Uint8Array(size);
  const shapes = [];
  const queueX = [];
  const queueY = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx] || visited[idx]) continue;

      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      visited[idx] = 1;

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      const points = [];
      const outline = [];

      for (let qi = 0; qi < queueX.length; qi++) {
        const cx = queueX[qi];
        const cy = queueY[qi];
        count++;

        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        if (opts.sampleStep <= 1 || ((cx + cy * width) % opts.sampleStep) === 0) {
          points.push([cx + 0.5, cy + 0.5]);
        }

        const cidx = cy * width + cx;
        const isBoundary =
          cx === 0 ||
          cy === 0 ||
          cx === width - 1 ||
          cy === height - 1 ||
          !mask[cidx - 1] ||
          !mask[cidx + 1] ||
          !mask[cidx - width] ||
          !mask[cidx + width];

        if (isBoundary && (opts.outlineStep <= 1 || (cidx % opts.outlineStep) === 0)) {
          outline.push([cx + 0.5, cy + 0.5]);
        }

        // 4-neighborhood
        if (cx > 0) {
          const n = idxAt(cx - 1, cy, width);
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queueX.push(cx - 1);
            queueY.push(cy);
          }
        }
        if (cx + 1 < width) {
          const n = idxAt(cx + 1, cy, width);
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queueX.push(cx + 1);
            queueY.push(cy);
          }
        }
        if (cy > 0) {
          const n = idxAt(cx, cy - 1, width);
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queueX.push(cx);
            queueY.push(cy - 1);
          }
        }
        if (cy + 1 < height) {
          const n = idxAt(cx, cy + 1, width);
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queueX.push(cx);
            queueY.push(cy + 1);
          }
        }
      }

      if (count < opts.minComponentSize || points.length < 2) continue;

      const bbox = {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };

      const shape = classifyShape(points, outline, bbox, opts);
      const path = buildPath(outline, shape, points);
      shapes.push({ ...shape, bbox, path });
    }
  }

  return shapes;
}

export function shapesToSVG(shapes, width, height, options = {}) {
  const svgOpts = {
    stroke: "#111",
    strokeWidth: 2.5,
    fill: "none",
    background: null,
    showUnknown: false,
    ...options,
  };

  const content = shapesMarkup(shapes, svgOpts);
  const bg = svgOpts.background
    ? `<rect width="100%" height="100%" fill="${svgOpts.background}" />`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    bg +
    content +
    `</svg>`;
}

export function renderShapesToSVG(svgEl, shapes, options = {}) {
  const width = options.width ?? svgEl.viewBox?.baseVal?.width ?? svgEl.clientWidth;
  const height = options.height ?? svgEl.viewBox?.baseVal?.height ?? svgEl.clientHeight;
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgEl.setAttribute("width", width);
  svgEl.setAttribute("height", height);
  svgEl.innerHTML = shapesMarkup(shapes, options);
}

function shapesMarkup(shapes, options) {
  const stroke = options.stroke ?? "#111";
  const strokeWidth = options.strokeWidth ?? 2.5;
  const fill = options.fill ?? "none";
  const showUnknown = options.showUnknown ?? false;
  const showPoints = options.showPoints ?? false;
  const pointsStroke = options.pointsStroke ?? "rgba(15, 88, 100, 0.6)";
  const pointsStrokeWidth = options.pointsStrokeWidth ?? 1.2;
  const pointsDash = options.pointsDash ?? "3 6";

  const fmt = (n) => Number.isFinite(n) ? Number(n.toFixed(2)) : 0;

  return shapes
    .map((shape) => {
      const path = showPoints && shape.path?.length > 1
        ? `<polyline points="${shape.path.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" ")}" ` +
          `stroke="${pointsStroke}" stroke-width="${pointsStrokeWidth}" fill="none" ` +
          `stroke-dasharray="${pointsDash}" stroke-linecap="round" stroke-linejoin="round" />`
        : "";

      if (shape.type === "line") {
        return path + `<line x1="${fmt(shape.x1)}" y1="${fmt(shape.y1)}" x2="${fmt(shape.x2)}" y2="${fmt(shape.y2)}" ` +
          `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
      }
      if (shape.type === "circle") {
        return path + `<circle cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" r="${fmt(shape.radius)}" ` +
          `stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" />`;
      }
      if (shape.type === "arc") {
        const largeArc = shape.span > Math.PI ? 1 : 0;
        const sweep = shape.sweep ?? 1;
        return path + `<path d="M ${fmt(shape.sx)} ${fmt(shape.sy)} A ${fmt(shape.radius)} ${fmt(shape.radius)} ` +
          `0 ${largeArc} ${sweep} ${fmt(shape.ex)} ${fmt(shape.ey)}" ` +
          `stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" stroke-linecap="round" />`;
      }
      if (showUnknown && shape.type === "unknown") {
        const points = shape.points?.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" ") ?? "";
        return path + `<polyline points="${points}" stroke="#999" stroke-width="${strokeWidth}" fill="none" />`;
      }
      return path;
    })
    .join("");
}

function classifyShape(points, outline, bbox, opts) {
  const diag = Math.hypot(bbox.width, bbox.height);
  const line = fitLine(points);
  const circlePoints = outline && outline.length >= 6 ? outline : points;
  const circle = fitCircle(circlePoints);

  const lineOk = line &&
    line.eigRatio >= opts.lineMinEigenRatio &&
    line.rms <= opts.lineMaxRmsRatio * diag &&
    line.maxDist <= opts.lineMaxDistRatio * diag;

  const lineConfidence = line
    ? computeLineConfidence(line, diag, opts)
    : 0;

  let circleOk = false;
  let arcLengthRatio = 0;
  let circleConfidence = 0;
  let arcConfidence = 0;
  if (circle) {
    const curvature = diag / circle.radius;
    const rmsOk = circle.rms <= opts.circleMaxRmsRatio * circle.radius;
    const spreadOk = circle.spreadRatio <= opts.circleMaxSpreadRatio;
    const curvatureOk = circle.radius > 2 && curvature >= opts.circleMinCurvatureRatio;
    const spanRatio = circle.span / (Math.PI * 2);

    if (curvatureOk && circlePoints.length >= 3) {
      let arcPoints = circlePoints;
      if (Number.isFinite(circle.meanRadius)) {
        const outer = circlePoints.filter((p) => {
          const dx = p[0] - circle.cx;
          const dy = p[1] - circle.cy;
          return Math.hypot(dx, dy) >= circle.meanRadius;
        });
        if (outer.length >= 3) arcPoints = outer;
      }

      const ordered = orderByAngle(arcPoints, circle.cx, circle.cy);
      const arcLength = pathLength(ordered);
      const circumference = Math.PI * 2 * circle.radius;
      if (circumference > 0) {
        const lengthRatio = arcLength / circumference;
        arcLengthRatio = Math.min(spanRatio, lengthRatio);
      }
    }

    circleOk = curvatureOk &&
      (rmsOk || spreadOk || arcLengthRatio >= opts.circleByArcLengthRatio);

    circleConfidence = computeCircleConfidence(circle, arcLengthRatio, spanRatio, opts);
    arcConfidence = computeArcConfidence(circle, arcLengthRatio, spanRatio, opts);
  }

  // Very short arcs should be treated as lines to avoid misclassification.
  if (arcLengthRatio > 0 && arcLengthRatio < (opts.arcLineRatio ?? 0.15) && line) {
    return { type: "line", ...line, weak: !lineOk, confidence: lineConfidence * (lineOk ? 1 : 0.7) };
  }

  if (lineOk && (!circleOk || line.rms / diag <= (circle.rms / circle.radius) * 1.1)) {
    return { type: "line", ...line, confidence: lineConfidence };
  }

  if (circleOk) {
    const span = circle.span;
    const isClosed = span >= opts.fullCircleRatio * Math.PI * 2 ||
      arcLengthRatio >= opts.circleByArcLengthRatio;

    if (isClosed) {
      return { type: "circle", ...circle, arcLengthRatio, confidence: circleConfidence };
    }

    if (span >= opts.arcMinSpan) {
      return { type: "arc", ...circle, arcLengthRatio, confidence: arcConfidence };
    }
  }

  if (line) {
    return { type: "line", ...line, weak: true, confidence: lineConfidence * 0.5 };
  }

  return { type: "unknown", points };
}

function buildPath(outline, shape, fallback) {
  const source = outline && outline.length ? outline : (fallback || []);
  if (source.length < 2) return source;

  if (shape.type === "line" && Number.isFinite(shape.vx)) {
    return orderByLine(source, shape);
  }

  if ((shape.type === "circle" || shape.type === "arc") && Number.isFinite(shape.cx)) {
    return orderByAngle(source, shape.cx, shape.cy);
  }

  return source.slice().sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  return total;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function computeLineConfidence(line, diag, opts) {
  const rmsRatio = line.rms / (opts.lineMaxRmsRatio * diag);
  const distRatio = line.maxDist / (opts.lineMaxDistRatio * diag);
  const fitScore = clamp01(1 - Math.max(rmsRatio, distRatio));
  const eigScore = clamp01(line.eigRatio / opts.lineMinEigenRatio);
  return clamp01(fitScore * 0.7 + eigScore * 0.3);
}

function computeCircleConfidence(circle, arcLengthRatio, spanRatio, opts) {
  const rmsScore = clamp01(1 - circle.rms / (opts.circleMaxRmsRatio * circle.radius));
  const spreadScore = clamp01(1 - circle.spreadRatio / opts.circleMaxSpreadRatio);
  const fitScore = Math.max(rmsScore, spreadScore);
  const coverageScore = clamp01(arcLengthRatio);
  const spanScore = clamp01(spanRatio);
  return clamp01(fitScore * 0.55 + coverageScore * 0.25 + spanScore * 0.2);
}

function computeArcConfidence(circle, arcLengthRatio, spanRatio, opts) {
  const rmsScore = clamp01(1 - circle.rms / (opts.circleMaxRmsRatio * circle.radius));
  const spreadScore = clamp01(1 - circle.spreadRatio / opts.circleMaxSpreadRatio);
  const fitScore = Math.max(rmsScore, spreadScore);
  const minSpanRatio = opts.arcMinSpan / (Math.PI * 2);
  const spanScore = clamp01((spanRatio - minSpanRatio) / (1 - minSpanRatio));
  const separationScore = clamp01(1 - arcLengthRatio / opts.circleByArcLengthRatio);
  return clamp01(fitScore * 0.5 + spanScore * 0.3 + separationScore * 0.2);
}

function orderByLine(points, line) {
  const { cx, cy, vx, vy } = line;
  return points.slice().sort((a, b) => {
    const ta = (a[0] - cx) * vx + (a[1] - cy) * vy;
    const tb = (b[0] - cx) * vx + (b[1] - cy) * vy;
    return ta - tb;
  });
}

function orderByAngle(points, cx, cy) {
  const entries = points.map((p) => {
    let ang = Math.atan2(p[1] - cy, p[0] - cx);
    if (ang < 0) ang += Math.PI * 2;
    return { p, ang };
  });

  entries.sort((a, b) => a.ang - b.ang);

  let maxGap = -1;
  let maxIdx = 0;
  for (let i = 0; i < entries.length; i++) {
    const a1 = entries[i].ang;
    const a2 = i === entries.length - 1 ? entries[0].ang + Math.PI * 2 : entries[i + 1].ang;
    const gap = a2 - a1;
    if (gap > maxGap) {
      maxGap = gap;
      maxIdx = i;
    }
  }

  const start = (maxIdx + 1) % entries.length;
  const ordered = [];
  for (let i = 0; i < entries.length; i++) {
    ordered.push(entries[(start + i) % entries.length].p);
  }
  return ordered;
}

function fitLine(points) {
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += points[i][0];
    sumY += points[i][1];
  }
  const cx = sumX / n;
  const cy = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i][0] - cx;
    const dy = points[i][1] - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const trace = sxx + syy;
  const diff = sxx - syy;
  const root = Math.sqrt(Math.max(0, diff * diff + 4 * sxy * sxy));
  const eig1 = (trace + root) / 2;
  const eig2 = Math.max(0, trace - eig1);

  let vx;
  let vy;
  if (Math.abs(sxy) > 1e-9) {
    vx = eig1 - syy;
    vy = sxy;
  } else {
    vx = 1;
    vy = 0;
    if (sxx < syy) {
      vx = 0;
      vy = 1;
    }
  }

  const vlen = Math.hypot(vx, vy) || 1;
  vx /= vlen;
  vy /= vlen;

  let tmin = Infinity;
  let tmax = -Infinity;
  let sumSq = 0;
  let maxDist = 0;

  for (let i = 0; i < n; i++) {
    const dx = points[i][0] - cx;
    const dy = points[i][1] - cy;
    const t = dx * vx + dy * vy;
    const dist = Math.abs(-vy * dx + vx * dy);
    sumSq += dist * dist;
    if (dist > maxDist) maxDist = dist;
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }

  const rms = Math.sqrt(sumSq / n);
  return {
    cx,
    cy,
    vx,
    vy,
    eigRatio: eig1 / Math.max(eig2, 1e-9),
    tmin,
    tmax,
    x1: cx + vx * tmin,
    y1: cy + vy * tmin,
    x2: cx + vx * tmax,
    y2: cy + vy * tmax,
    rms,
    maxDist,
  };
}

function fitCircle(points) {
  const n = points.length;
  if (n < 3) return null;

  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Syy = 0;
  let Sxy = 0;
  let Sx2y2 = 0;
  let Sx2y2x = 0;
  let Sx2y2y = 0;

  for (let i = 0; i < n; i++) {
    const x = points[i][0];
    const y = points[i][1];
    const x2 = x * x;
    const y2 = y * y;
    Sx += x;
    Sy += y;
    Sxx += x2;
    Syy += y2;
    Sxy += x * y;
    const x2y2 = x2 + y2;
    Sx2y2 += x2y2;
    Sx2y2x += x2y2 * x;
    Sx2y2y += x2y2 * y;
  }

  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, n],
  ];
  const B = [Sx2y2x, Sx2y2y, Sx2y2];
  const sol = solve3x3(A, B);
  if (!sol) return null;

  const a = sol[0];
  const b = sol[1];
  const c = sol[2];
  const cx = a / 2;
  const cy = b / 2;
  const r2 = c + (a * a + b * b) / 4;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);

  let rsum = 0;
  let rmin = Infinity;
  let rmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = points[i][0] - cx;
    const dy = points[i][1] - cy;
    const d = Math.hypot(dx, dy);
    rsum += d;
    if (d < rmin) rmin = d;
    if (d > rmax) rmax = d;
  }
  const rmean = rsum / n;

  let sumSq = 0;
  const angles = new Array(n);
  for (let i = 0; i < n; i++) {
    const dx = points[i][0] - cx;
    const dy = points[i][1] - cy;
    const d = Math.hypot(dx, dy);
    const diff = d - rmean;
    sumSq += diff * diff;
    let ang = Math.atan2(dy, dx);
    if (ang < 0) ang += Math.PI * 2;
    angles[i] = ang;
  }

  angles.sort((p, q) => p - q);
  let maxGap = -1;
  let maxIdx = 0;
  for (let i = 0; i < n; i++) {
    const a1 = angles[i];
    const a2 = i === n - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
    const gap = a2 - a1;
    if (gap > maxGap) {
      maxGap = gap;
      maxIdx = i;
    }
  }

  const span = Math.PI * 2 - maxGap;
  const startAngle = angles[(maxIdx + 1) % n];
  const endAngle = angles[maxIdx];

  const sx = cx + radius * Math.cos(startAngle);
  const sy = cy + radius * Math.sin(startAngle);
  const ex = cx + radius * Math.cos(endAngle);
  const ey = cy + radius * Math.sin(endAngle);

  return {
    cx,
    cy,
    radius,
    meanRadius: rmean,
    rms: Math.sqrt(sumSq / n),
    rmin,
    rmax,
    spreadRatio: (rmax - rmin) / (radius || 1),
    span,
    startAngle,
    endAngle,
    sx,
    sy,
    ex,
    ey,
    sweep: 1,
  };
}

function solve3x3(A, B) {
  // Gaussian elimination with partial pivoting
  const m = [
    [A[0][0], A[0][1], A[0][2], B[0]],
    [A[1][0], A[1][1], A[1][2], B[1]],
    [A[2][0], A[2][1], A[2][2], B[2]],
  ];

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }

    const div = m[col][col];
    for (let k = col; k < 4; k++) m[col][k] /= div;

    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let k = col; k < 4; k++) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }

  return [m[0][3], m[1][3], m[2][3]];
}

function idxAt(x, y, width) {
  return y * width + x;
}

function ensureImageLoaded(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function imageToImageData(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
