import { DxfWriter, point3d, Colors, Units } from "@tarikjabiri/dxf";

const EPS = 1e-8;

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function fmt(value, digits = 6) {
  return Number(toFiniteNumber(value)).toFixed(digits);
}

function escapeXml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDashPattern(raw) {
  if (!Array.isArray(raw)) return null;
  const values = raw
    .map((entry) => toFiniteNumber(entry, Number.NaN))
    .filter((entry) => Number.isFinite(entry) && Math.abs(entry) > EPS);
  return values.length ? values : null;
}

function normalizeSvgDash(raw) {
  if (Array.isArray(raw)) {
    const values = raw
      .map((entry) => Math.abs(toFiniteNumber(entry, Number.NaN)))
      .filter((entry) => Number.isFinite(entry) && entry > EPS);
    return values.length ? values.join(" ") : null;
  }
  if (typeof raw === "string" && raw.trim().length) return raw.trim();
  return null;
}

function normalizeSceneStyle(styleKey, rawStyle = {}) {
  const layer = String(rawStyle.layer || styleKey || "0").trim() || "0";
  const dxfColorRaw = toFiniteNumber(rawStyle.dxfColor, Colors.White);
  const dxfColor = Number.isFinite(dxfColorRaw) ? dxfColorRaw : Colors.White;

  const dxfLineType = String(rawStyle.dxfLineType || "Continuous");
  const dxfDashPattern = normalizeDashPattern(rawStyle.dxfDashPattern || null);
  const dxfLineTypeName = String(rawStyle.dxfLineTypeName || `${layer}_LT`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const dxfLineTypeDescription = String(rawStyle.dxfLineTypeDescription || "_ _ _ _ _");

  return {
    key: String(styleKey || "DEFAULT"),
    layer,
    stroke: String(rawStyle.stroke || "#000000"),
    textColor: String(rawStyle.textColor || rawStyle.stroke || "#000000"),
    dxfColor,
    dxfLineType,
    dxfDashPattern,
    dxfLineTypeName,
    dxfLineTypeDescription,
    dxfLineTypeScale: Math.max(0.01, toFiniteNumber(rawStyle.dxfLineTypeScale, 1)),
    svgDash: normalizeSvgDash(rawStyle.svgDash || rawStyle.dxfDashPattern || null),
    svgStrokeWidthScale: Math.max(0.05, toFiniteNumber(rawStyle.svgStrokeWidthScale, 1)),
    svgFontFamily: String(rawStyle.svgFontFamily || "Arial, Helvetica, sans-serif"),
  };
}

function normalizeSceneStyles(scene) {
  const rawStyles = scene?.styles && typeof scene.styles === "object" ? scene.styles : {};
  const normalized = new Map();
  for (const [key, style] of Object.entries(rawStyles)) {
    normalized.set(String(key), normalizeSceneStyle(key, style));
  }
  if (!normalized.has("DEFAULT")) {
    normalized.set("DEFAULT", normalizeSceneStyle("DEFAULT", {
      layer: "0",
      stroke: "#000000",
      textColor: "#000000",
      dxfColor: Colors.White,
      dxfLineType: "Continuous",
    }));
  }
  return normalized;
}

function resolveStyle(styleMap, styleKey) {
  if (styleMap.has(String(styleKey || ""))) return styleMap.get(String(styleKey));
  return styleMap.get("DEFAULT");
}

export function computeTwoDSceneBounds(sceneLike) {
  const scene = sceneLike || {};
  const entities = Array.isArray(scene.entities) ? scene.entities : [];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (point) => {
    const x = toFiniteNumber(point?.[0], Number.NaN);
    const y = toFiniteNumber(point?.[1], Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    if (entity.type === "line") {
      visit(entity.a);
      visit(entity.b);
      continue;
    }
    if (entity.type === "polyline") {
      const points = Array.isArray(entity.points) ? entity.points : [];
      for (const point of points) visit(point);
      continue;
    }
    if (entity.type === "text") {
      visit(entity.at);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  return { minX, minY, maxX, maxY, width, height };
}

function iterSceneLineSegments(sceneLike) {
  const scene = sceneLike || {};
  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  const out = [];

  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    if (entity.type === "line") {
      out.push(entity);
      continue;
    }
    if (entity.type === "polyline") {
      const points = Array.isArray(entity.points) ? entity.points : [];
      if (points.length < 2) continue;
      for (let i = 0; i < points.length - 1; i += 1) {
        out.push({
          type: "line",
          style: entity.style,
          a: points[i],
          b: points[i + 1],
        });
      }
      if (entity.closed && points.length > 2) {
        out.push({
          type: "line",
          style: entity.style,
          a: points[points.length - 1],
          b: points[0],
        });
      }
    }
  }

  return out;
}

function sceneUnitsToDxf(unitsRaw) {
  const units = String(unitsRaw || "mm").trim().toLowerCase();
  if (units === "mm" || units === "millimeter" || units === "millimeters") return Units.Millimeters;
  if (units === "cm" || units === "centimeter" || units === "centimeters") return Units.Centimeters;
  if (units === "m" || units === "meter" || units === "meters") return Units.Meters;
  if (units === "in" || units === "inch" || units === "inches") return Units.Inches;
  return Units.Unitless;
}

export function buildDxfFromTwoDScene(sceneLike) {
  const scene = sceneLike || {};
  const styleMap = normalizeSceneStyles(scene);

  const writer = new DxfWriter();
  writer.setUnits(sceneUnitsToDxf(scene.units));

  const styleRuntime = new Map();
  for (const style of styleMap.values()) {
    let lineTypeName = style.dxfLineType;
    if (style.dxfDashPattern && style.dxfDashPattern.length) {
      lineTypeName = style.dxfLineTypeName;
      try {
        writer.addLType(lineTypeName, style.dxfLineTypeDescription, style.dxfDashPattern);
      } catch {
        // ignore duplicate ltype registrations
      }
    }

    try {
      writer.addLayer(style.layer, style.dxfColor, lineTypeName);
    } catch {
      // ignore duplicate layer registrations
    }

    styleRuntime.set(style.key, {
      ...style,
      resolvedLineType: lineTypeName,
    });
  }

  const resolveRuntimeStyle = (styleKey) => {
    const style = resolveStyle(styleMap, styleKey);
    return styleRuntime.get(style.key) || style;
  };

  const segments = iterSceneLineSegments(scene);
  for (const segment of segments) {
    const style = resolveRuntimeStyle(segment.style);
    writer.addLine(
      point3d(toFiniteNumber(segment?.a?.[0]), toFiniteNumber(segment?.a?.[1]), 0),
      point3d(toFiniteNumber(segment?.b?.[0]), toFiniteNumber(segment?.b?.[1]), 0),
      {
        layerName: style.layer,
        colorNumber: style.dxfColor,
        lineType: style.resolvedLineType || style.dxfLineType || "Continuous",
        lineTypeScale: style.dxfLineTypeScale,
      }
    );
  }

  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  for (const entity of entities) {
    if (!entity || entity.type !== "text") continue;
    const style = resolveRuntimeStyle(entity.style);
    const value = String(entity.value || "");
    if (!value.length) continue;

    const height = Math.max(0.01, toFiniteNumber(entity.height, 2));
    const angle = toFiniteNumber(entity.rotationDeg, 0);
    writer.addText(
      point3d(toFiniteNumber(entity?.at?.[0]), toFiniteNumber(entity?.at?.[1]), 0),
      height,
      value,
      {
        layerName: style.layer,
        colorNumber: style.dxfColor,
        lineType: style.resolvedLineType || style.dxfLineType || "Continuous",
        rotation: angle,
      }
    );
  }

  return writer.stringify();
}

export function buildSvgFromTwoDScene(sceneLike) {
  const scene = sceneLike || {};
  const styleMap = normalizeSceneStyles(scene);
  const bounds = computeTwoDSceneBounds(scene);

  const pad = Math.max(bounds.width, bounds.height) * 0.03;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const width = bounds.width + (pad * 2);
  const height = bounds.height + (pad * 2);
  const centerY = bounds.minY + bounds.maxY;
  const maxDim = Math.max(bounds.width, bounds.height);
  const strokeWidth = Math.max(maxDim * 0.0012, 0.15);
  const defaultTextHeight = Math.max(maxDim * 0.02, 1.8);

  const mapY = (y) => centerY - toFiniteNumber(y);

  const lineContentByStyle = new Map();
  const textContentByStyle = new Map();
  const pushLine = (styleKey, content) => {
    if (!lineContentByStyle.has(styleKey)) lineContentByStyle.set(styleKey, []);
    lineContentByStyle.get(styleKey).push(content);
  };
  const pushText = (styleKey, content) => {
    if (!textContentByStyle.has(styleKey)) textContentByStyle.set(styleKey, []);
    textContentByStyle.get(styleKey).push(content);
  };

  const segments = iterSceneLineSegments(scene);
  for (const segment of segments) {
    const style = resolveStyle(styleMap, segment.style);
    const x1 = toFiniteNumber(segment?.a?.[0]);
    const y1 = mapY(segment?.a?.[1]);
    const x2 = toFiniteNumber(segment?.b?.[0]);
    const y2 = mapY(segment?.b?.[1]);
    pushLine(style.key, `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" />`);
  }

  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  for (const entity of entities) {
    if (!entity || entity.type !== "text") continue;
    const style = resolveStyle(styleMap, entity.style);
    const value = String(entity.value || "");
    if (!value.length) continue;
    const x = toFiniteNumber(entity?.at?.[0]);
    const y = mapY(entity?.at?.[1]);
    const rot = -toFiniteNumber(entity.rotationDeg, 0);
    const fontSize = Math.max(0.1, toFiniteNumber(entity.height, defaultTextHeight));
    pushText(
      style.key,
      `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(fontSize)}" fill="${escapeXml(style.textColor)}" font-family="${escapeXml(style.svgFontFamily)}" transform="rotate(${fmt(rot, 3)} ${fmt(x)} ${fmt(y)})">${escapeXml(value)}</text>`
    );
  }

  const lineGroups = [];
  for (const [styleKey, lines] of lineContentByStyle.entries()) {
    const style = resolveStyle(styleMap, styleKey);
    if (!lines.length) continue;
    const dash = style.svgDash ? ` stroke-dasharray="${escapeXml(style.svgDash)}"` : "";
    const widthScale = Math.max(0.05, toFiniteNumber(style.svgStrokeWidthScale, 1));
    lineGroups.push(
      `  <g fill="none" stroke="${escapeXml(style.stroke)}" stroke-width="${fmt(strokeWidth * widthScale)}" stroke-linecap="round"${dash}>${lines.join("")}</g>`
    );
  }

  const textGroups = [];
  for (const [styleKey, texts] of textContentByStyle.entries()) {
    const style = resolveStyle(styleMap, styleKey);
    if (!texts.length) continue;
    textGroups.push(
      `  <g fill="${escapeXml(style.textColor)}" stroke="none">${texts.join("")}</g>`
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${fmt(width)}mm" height="${fmt(height)}mm"`,
    ` viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}">`,
    `${lineGroups.join("\n")}`,
    `${textGroups.join("\n")}`,
    `</svg>`,
  ].join("");
}
