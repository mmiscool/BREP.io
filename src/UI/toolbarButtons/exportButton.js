import JSZip from 'jszip';
import { generate3MF } from '../../exporters/threeMF.js';
import { generateSTEP } from '../../exporters/step.js';

async function _captureThumbnail(viewer, size = 256) {
  try {
    const canvas = viewer?.renderer?.domElement;
    if (!canvas) return null;
    const srcW = canvas.width || canvas.clientWidth || 1;
    const srcH = canvas.height || canvas.clientHeight || 1;
    const dst = document.createElement('canvas');
    dst.width = size; dst.height = size;
    const ctx = dst.getContext('2d');
    if (!ctx) return null;
    try { ctx.clearRect(0, 0, size, size); } catch {}
    const scale = Math.min(size / srcW, size / srcH);
    const dw = Math.max(1, Math.floor(srcW * scale));
    const dh = Math.max(1, Math.floor(srcH * scale));
    const dx = Math.floor((size - dw) / 2);
    const dy = Math.floor((size - dh) / 2);
    try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } catch {}
    ctx.drawImage(canvas, 0, 0, srcW, srcH, dx, dy, dw, dh);
    return dst.toDataURL('image/png');
  } catch { return null; }
}

export function createExportButton(viewer) {
  const onClick = () => _openExportDialog(viewer);
  return { label: '📤', title: 'Export…', onClick };
}

// Helpers moved from MainToolbar
function _ensureExportDialogStyles() {
  if (document.getElementById('export-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'export-dialog-styles';
  style.textContent = `
      .exp-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 11; }
      .exp-modal { background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; width: min(480px, calc(100vw - 32px)); box-shadow: 0 10px 40px rgba(0,0,0,.5); }
      .exp-title { margin: 0 0 8px 0; font-size: 14px; font-weight: 700; }
      .exp-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
      .exp-col { display: flex; flex-direction: column; gap: 6px; }
      .exp-label { width: 90px; color: #9aa0aa; font-size: 12px; }
      .exp-input, .exp-select { flex: 1 1 auto; padding: 6px 8px; border-radius: 8px; background: #0b0e14; color: #e5e7eb; border: 1px solid #374151; outline: none; font-size: 12px; }
      .exp-input:focus, .exp-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
      .exp-hint { color: #9aa0aa; font-size: 12px; margin-top: 6px; }
      .exp-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .exp-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
      .exp-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
      .exp-btn:active { transform: translateY(1px); }
    `;
  document.head.appendChild(style);
}

function _unitScale(unit) {
  switch (String(unit || 'millimeter')) {
    case 'millimeter': return 1;
    case 'centimeter': return 0.1;            // mm -> cm
    case 'meter': return 0.001;               // mm -> m
    case 'micron': return 1000;               // mm -> µm
    case 'inch': return 1 / 25.4;             // mm -> in
    case 'foot': return 1 / 304.8;            // mm -> ft
    default: return 1;
  }
}

function _meshToAsciiSTL(mesh, name = 'solid', precision = 6, scale = 1) {
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const fmt = (n) => Number.isFinite(n) ? n.toFixed(precision) : '0';
  const out = [];
  out.push(`solid ${name}`);
  const triCount = (tv.length / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = tv[t * 3 + 0] >>> 0;
    const i1 = tv[t * 3 + 1] >>> 0;
    const i2 = tv[t * 3 + 2] >>> 0;
    const ax = vp[i0 * 3 + 0] * scale, ay = vp[i0 * 3 + 1] * scale, az = vp[i0 * 3 + 2] * scale;
    const bx = vp[i1 * 3 + 0] * scale, by = vp[i1 * 3 + 1] * scale, bz = vp[i1 * 3 + 2] * scale;
    const cx = vp[i2 * 3 + 0] * scale, cy = vp[i2 * 3 + 1] * scale, cz = vp[i2 * 3 + 2] * scale;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    out.push(`  facet normal ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}`);
    out.push('    outer loop');
    out.push(`      vertex ${fmt(ax)} ${fmt(ay)} ${fmt(az)}`);
    out.push(`      vertex ${fmt(bx)} ${fmt(by)} ${fmt(bz)}`);
    out.push(`      vertex ${fmt(cx)} ${fmt(cy)} ${fmt(cz)}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}

function _objClamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function _objParseRgbComponent(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (s.endsWith('%')) {
    const num = parseFloat(s.slice(0, -1));
    if (!Number.isFinite(num)) return NaN;
    return (num / 100) * 255;
  }
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return NaN;
  return num;
}

function _objParseHue(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return NaN;
  if (s.endsWith('turn')) {
    const num = parseFloat(s.slice(0, -4));
    if (!Number.isFinite(num)) return NaN;
    return num * 360;
  }
  if (s.endsWith('rad')) {
    const num = parseFloat(s.slice(0, -3));
    if (!Number.isFinite(num)) return NaN;
    return (num * 180) / Math.PI;
  }
  if (s.endsWith('deg')) {
    const num = parseFloat(s.slice(0, -3));
    if (!Number.isFinite(num)) return NaN;
    return num;
  }
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return NaN;
  return num;
}

function _objParsePercent(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (s.endsWith('%')) {
    const num = parseFloat(s.slice(0, -1));
    if (!Number.isFinite(num)) return NaN;
    return num / 100;
  }
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return NaN;
  return num > 1 ? num / 100 : num;
}

function _objHslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [r + m, g + m, b + m];
}

function _parseColorToOBJRgb(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.max(0, Math.min(0xffffff, Math.round(value)));
    return [((n >> 16) & 0xFF) / 255, ((n >> 8) & 0xFF) / 255, (n & 0xFF) / 255];
  }
  if (typeof value === 'string') {
    const v = value.trim();
    if (!v) return null;
    const hexMatch = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const h = hexMatch[1];
      if (h.length === 3) {
        return [
          parseInt(h[0] + h[0], 16) / 255,
          parseInt(h[1] + h[1], 16) / 255,
          parseInt(h[2] + h[2], 16) / 255,
        ];
      }
      return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
      ];
    }
    const hex0xMatch = v.match(/^0x([0-9a-f]{6})$/i);
    if (hex0xMatch) {
      const h = hex0xMatch[1];
      return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
      ];
    }
    const rgbMatch = v.match(/^rgba?\((.+)\)$/i);
    if (rgbMatch) {
      const inner = rgbMatch[1].replace('/', ' ');
      const parts = inner.split(/[, ]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) return null;
      const r = _objParseRgbComponent(parts[0]);
      const g = _objParseRgbComponent(parts[1]);
      const b = _objParseRgbComponent(parts[2]);
      if (![r, g, b].every(Number.isFinite)) return null;
      return [_objClamp01(r / 255), _objClamp01(g / 255), _objClamp01(b / 255)];
    }
    const hslMatch = v.match(/^hsla?\((.+)\)$/i);
    if (hslMatch) {
      const inner = hslMatch[1].replace('/', ' ');
      const parts = inner.split(/[, ]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) return null;
      const h = _objParseHue(parts[0]);
      const s = _objParsePercent(parts[1]);
      const l = _objParsePercent(parts[2]);
      if (![h, s, l].every(Number.isFinite)) return null;
      return _objHslToRgb(h, s, l).map(_objClamp01);
    }
    return null;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0]);
    const g = Number(value[1]);
    const b = Number(value[2]);
    if (![r, g, b].every(Number.isFinite)) return null;
    const max = Math.max(r, g, b);
    if (max <= 1) return [_objClamp01(r), _objClamp01(g), _objClamp01(b)];
    return [_objClamp01(r / 255), _objClamp01(g / 255), _objClamp01(b / 255)];
  }
  if (typeof value === 'object') {
    const r = Number(value.r);
    const g = Number(value.g);
    const b = Number(value.b);
    if ([r, g, b].every(Number.isFinite)) {
      const max = Math.max(r, g, b);
      if (max <= 1) return [_objClamp01(r), _objClamp01(g), _objClamp01(b)];
      return [_objClamp01(r / 255), _objClamp01(g / 255), _objClamp01(b / 255)];
    }
  }
  return null;
}

function _pickColorValue(meta, keys) {
  if (!meta || typeof meta !== 'object') return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
    const raw = meta[key];
    if (raw == null) continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;
    return raw;
  }
  return null;
}

function _resolveColorFromMeta(meta, keys) {
  return _parseColorToOBJRgb(_pickColorValue(meta, keys));
}

function _extractMaterialColor(material) {
  if (!material) return null;
  if (Array.isArray(material)) {
    for (const mat of material) {
      const c = _extractMaterialColor(mat);
      if (c) return c;
    }
    return null;
  }
  if (material.color) {
    const c = _parseColorToOBJRgb(material.color);
    if (c) return c;
    try {
      if (typeof material.color.getHex === 'function') {
        const hex = material.color.getHex();
        const parsed = _parseColorToOBJRgb(hex);
        if (parsed) return parsed;
      }
    } catch {}
  }
  return null;
}

function _buildOBJColorContext(solid, mesh, metadataManager) {
  const solidKeys = ['solidColor', 'color'];
  const faceKeys = ['faceColor', 'color'];
  const triCount = (mesh?.triVerts?.length / 3) | 0;
  const faceIDs = (mesh?.faceID && mesh.faceID.length === triCount) ? mesh.faceID : null;

  const getMetadata = (name) => {
    if (!name || !metadataManager || typeof metadataManager.getMetadata !== 'function') return null;
    try { return metadataManager.getMetadata(name); } catch { return null; }
  };

  let solidColor = _resolveColorFromMeta(getMetadata(solid?.name), solidKeys)
    || _resolveColorFromMeta(solid?.userData?.metadata || null, solidKeys)
    || _parseColorToOBJRgb(solid?.userData?.__metadataColor)
    || _extractMaterialColor(solid?.material);

  let idToFaceName = (solid && solid._idToFaceName instanceof Map) ? solid._idToFaceName : null;
  if (!idToFaceName && solid && solid._faceNameToID instanceof Map) {
    const inverted = new Map();
    for (const [faceName, faceId] of solid._faceNameToID.entries()) {
      if (faceId == null || faceName == null) continue;
      inverted.set(faceId, String(faceName));
    }
    if (inverted.size) idToFaceName = inverted;
  }

  const faceColorById = new Map();
  if (faceIDs && idToFaceName) {
    const faceDisplayColorByName = new Map();
    const children = Array.isArray(solid?.children) ? solid.children : [];
    for (const child of children) {
      if (!child || child.type !== 'FACE') continue;
      const faceName = child.name || child.userData?.faceName || null;
      if (!faceName) continue;
      const color = _parseColorToOBJRgb(child?.userData?.__metadataColor)
        || _extractMaterialColor(child.material);
      if (color) faceDisplayColorByName.set(faceName, color);
    }

    const seen = new Set();
    for (let t = 0; t < faceIDs.length; t++) {
      const fid = faceIDs[t] >>> 0;
      if (seen.has(fid)) continue;
      seen.add(fid);
      const faceName = idToFaceName.get(fid) || `FACE_${fid}`;
      let faceMeta = null;
      try { faceMeta = (typeof solid?.getFaceMetadata === 'function') ? solid.getFaceMetadata(faceName) : null; } catch { faceMeta = null; }
      const faceColor = _resolveColorFromMeta(getMetadata(faceName), faceKeys)
        || _resolveColorFromMeta(faceMeta, faceKeys)
        || faceDisplayColorByName.get(faceName)
        || null;
      if (faceColor) faceColorById.set(fid, faceColor);
    }
  }

  if (!solidColor && faceColorById.size === 1) {
    solidColor = faceColorById.values().next().value || null;
  }

  if (!solidColor && faceColorById.size === 0) {
    return { enabled: false, defaultColor: null, faceIDs: null, faceColorById: new Map() };
  }
  const defaultColor = solidColor || [0.75, 0.75, 0.75];
  return { enabled: true, defaultColor, faceIDs, faceColorById };
}

function _meshToAsciiOBJ(mesh, name = 'object', precision = 6, scale = 1, colorContext = null) {
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const fmt = (n) => Number.isFinite(n) ? n.toFixed(precision) : '0';
  const colorFmt = (n) => _objClamp01(n).toFixed(precision);
  const out = [];
  // Object/group name (safe ASCII)
  out.push(`# Exported by BREP`);
  if (colorContext?.enabled) out.push('# Vertex colors are encoded as "v x y z r g b" (0..1)');
  out.push(`o ${name}`);
  // Emit unique vertices referenced by triVerts to keep file smaller
  const indexMap = new Map(); // original index(+color) -> 1-based OBJ index
  let nextIndex = 1;
  const faces = []; // store triples of mapped indices
  const triCount = (tv.length / 3) | 0;
  const faceColorById = colorContext?.faceColorById || null;
  const faceIDs = (colorContext?.enabled && colorContext?.faceIDs && colorContext.faceIDs.length === triCount)
    ? colorContext.faceIDs
    : null;
  const defaultColor = colorContext?.enabled ? (colorContext.defaultColor || [0.75, 0.75, 0.75]) : null;
  for (let t = 0; t < triCount; t++) {
    const i0 = tv[t * 3 + 0] >>> 0;
    const i1 = tv[t * 3 + 1] >>> 0;
    const i2 = tv[t * 3 + 2] >>> 0;
    const triColor = colorContext?.enabled
      ? ((faceIDs && faceColorById) ? (faceColorById.get(faceIDs[t] >>> 0) || defaultColor) : defaultColor)
      : null;
    const mapIndex = (i, rgb) => {
      const colorKey = rgb
        ? `${colorFmt(rgb[0])},${colorFmt(rgb[1])},${colorFmt(rgb[2])}`
        : '';
      const key = `${i}|${colorKey}`;
      let id = indexMap.get(key);
      if (!id) {
        const x = vp[i * 3 + 0] * scale;
        const y = vp[i * 3 + 1] * scale;
        const z = vp[i * 3 + 2] * scale;
        if (rgb) {
          out.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)} ${colorFmt(rgb[0])} ${colorFmt(rgb[1])} ${colorFmt(rgb[2])}`);
        } else {
          out.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)}`);
        }
        id = nextIndex++;
        indexMap.set(key, id);
      }
      return id;
    };
    const a = mapIndex(i0, triColor);
    const b = mapIndex(i1, triColor);
    const c = mapIndex(i2, triColor);
    faces.push([a, b, c]);
  }
  // Faces (referencing v indices; no normals/UVs)
  for (const f of faces) out.push(`f ${f[0]} ${f[1]} ${f[2]}`);
  return out.join('\n');
}

function _collectSolids(viewer) {
  const scene = viewer?.partHistory?.scene || viewer?.scene;
  if (!scene) return [];
  const solids = [];
  scene.traverse((o) => {
    if (!o || !o.visible) return;
    if (o.type === 'SOLID' && typeof o.toSTL === 'function') solids.push(o);
  });
  const selected = solids.filter(o => o.selected === true);
  return selected.length ? selected : solids;
}

function _download(filename, data, mime = 'application/octet-stream') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

function _safeName(raw, fallback = 'solid') {
  const s = String(raw || '').trim();
  return (s.length ? s : fallback).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

function _openExportDialog(viewer) {
  _ensureExportDialogStyles();
  const solids = _collectSolids(viewer);
  if (!solids.length) { alert('No solids to export.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'exp-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'exp-modal';

  const title = document.createElement('div');
  title.className = 'exp-title';
  title.textContent = 'Export';

  const baseDefault = _safeName(viewer?.fileManagerWidget?.currentName || solids[0]?.name || 'part');

  // Filename
  const rowName = document.createElement('div'); rowName.className = 'exp-row';
  const labName = document.createElement('div'); labName.className = 'exp-label'; labName.textContent = 'Filename';
  const inpName = document.createElement('input'); inpName.className = 'exp-input'; inpName.value = baseDefault;
  rowName.appendChild(labName); rowName.appendChild(inpName);

  // Format
  const rowFmt = document.createElement('div'); rowFmt.className = 'exp-row';
  const labFmt = document.createElement('div'); labFmt.className = 'exp-label'; labFmt.textContent = 'Format';
  const selFmt = document.createElement('select'); selFmt.className = 'exp-select';
  const opt3mf = document.createElement('option'); opt3mf.value = '3mf'; opt3mf.textContent = '3MF (+history)'; selFmt.appendChild(opt3mf);
  const optStl = document.createElement('option'); optStl.value = 'stl'; optStl.textContent = 'STL (ASCII)'; selFmt.appendChild(optStl);
  const optStep = document.createElement('option'); optStep.value = 'step'; optStep.textContent = 'STEP (faceted)'; selFmt.appendChild(optStep);
  const optJson = document.createElement('option'); optJson.value = 'json'; optJson.textContent = 'BREP JSON (history only)'; selFmt.appendChild(optJson);
  const optObj = document.createElement('option'); optObj.value = 'obj'; optObj.textContent = 'OBJ (ASCII)'; selFmt.appendChild(optObj);
  rowFmt.appendChild(labFmt); rowFmt.appendChild(selFmt);

  // Units
  const rowUnit = document.createElement('div'); rowUnit.className = 'exp-row';
  const labUnit = document.createElement('div'); labUnit.className = 'exp-label'; labUnit.textContent = 'Units';
  const selUnit = document.createElement('select'); selUnit.className = 'exp-select';
  const units = [
    ['millimeter', 'Millimeters (mm)'],
    ['centimeter', 'Centimeters (cm)'],
    ['meter', 'Meters (m)'],
    ['micron', 'Microns (µm)'],
    ['inch', 'Inches (in)'],
    ['foot', 'Feet (ft)'],
  ];
  for (const [v, label] of units) { const o = document.createElement('option'); o.value = v; o.textContent = label; selUnit.appendChild(o); }
  try { selUnit.value = 'millimeter'; } catch {}
  rowUnit.appendChild(labUnit); rowUnit.appendChild(selUnit);

  // OBJ color option
  const rowObjColors = document.createElement('div'); rowObjColors.className = 'exp-row';
  const labObjColors = document.createElement('div'); labObjColors.className = 'exp-label'; labObjColors.textContent = 'OBJ';
  const chkObjColors = document.createElement('input'); chkObjColors.type = 'checkbox'; chkObjColors.checked = false;
  const objColorsWrap = document.createElement('label');
  objColorsWrap.style.display = 'flex';
  objColorsWrap.style.alignItems = 'center';
  objColorsWrap.style.gap = '6px';
  objColorsWrap.appendChild(chkObjColors);
  objColorsWrap.appendChild(document.createTextNode('Include vertex colors'));
  rowObjColors.appendChild(labObjColors); rowObjColors.appendChild(objColorsWrap);

  // STEP tessellation options
  const rowTess = document.createElement('div'); rowTess.className = 'exp-row';
  const labTess = document.createElement('div'); labTess.className = 'exp-label'; labTess.textContent = 'STEP';
  const chkTess = document.createElement('input'); chkTess.type = 'checkbox'; chkTess.checked = false;
  const tessWrap = document.createElement('label');
  tessWrap.style.display = 'flex';
  tessWrap.style.alignItems = 'center';
  tessWrap.style.gap = '6px';
  tessWrap.appendChild(chkTess);
  tessWrap.appendChild(document.createTextNode('Use tessellated faces (AP242)'));
  rowTess.appendChild(labTess); rowTess.appendChild(tessWrap);

  const rowStepFaces = document.createElement('div'); rowStepFaces.className = 'exp-row';
  const labStepFaces = document.createElement('div'); labStepFaces.className = 'exp-label'; labStepFaces.textContent = 'STEP';
  const chkStepFaces = document.createElement('input'); chkStepFaces.type = 'checkbox'; chkStepFaces.checked = true;
  const stepFacesWrap = document.createElement('label');
  stepFacesWrap.style.display = 'flex';
  stepFacesWrap.style.alignItems = 'center';
  stepFacesWrap.style.gap = '6px';
  stepFacesWrap.appendChild(chkStepFaces);
  stepFacesWrap.appendChild(document.createTextNode('Export faces'));
  rowStepFaces.appendChild(labStepFaces); rowStepFaces.appendChild(stepFacesWrap);

  const rowStepEdges = document.createElement('div'); rowStepEdges.className = 'exp-row';
  const labStepEdges = document.createElement('div'); labStepEdges.className = 'exp-label'; labStepEdges.textContent = 'STEP';
  const chkStepEdges = document.createElement('input'); chkStepEdges.type = 'checkbox'; chkStepEdges.checked = true;
  const stepEdgesWrap = document.createElement('label');
  stepEdgesWrap.style.display = 'flex';
  stepEdgesWrap.style.alignItems = 'center';
  stepEdgesWrap.style.gap = '6px';
  stepEdgesWrap.appendChild(chkStepEdges);
  stepEdgesWrap.appendChild(document.createTextNode('Export edges as polylines'));
  rowStepEdges.appendChild(labStepEdges); rowStepEdges.appendChild(stepEdgesWrap);

  // Toggle unit row visibility based on format
  const updateUnitVisibility = () => {
    const fmt = selFmt.value;
    rowUnit.style.display = (fmt === 'stl' || fmt === '3mf' || fmt === 'obj' || fmt === 'step') ? 'flex' : 'none';
    rowObjColors.style.display = (fmt === 'obj') ? 'flex' : 'none';
    rowTess.style.display = (fmt === 'step') ? 'flex' : 'none';
    rowStepFaces.style.display = (fmt === 'step') ? 'flex' : 'none';
    rowStepEdges.style.display = (fmt === 'step') ? 'flex' : 'none';
  };
  selFmt.addEventListener('change', updateUnitVisibility);
  updateUnitVisibility();

  const hint = document.createElement('div'); hint.className = 'exp-hint'; hint.textContent = '3MF includes feature history when available. STL/OBJ/STEP export triangulated meshes. BREP JSON saves editable feature history only.';

  // Buttons
  const buttons = document.createElement('div'); buttons.className = 'exp-buttons';
  const btnCancel = document.createElement('button'); btnCancel.className = 'exp-btn'; btnCancel.textContent = 'Cancel';
  btnCancel.addEventListener('click', () => { try { document.body.removeChild(overlay); } catch {} });
  const btnExport = document.createElement('button'); btnExport.className = 'exp-btn'; btnExport.textContent = 'Export';

  const close = () => { try { document.body.removeChild(overlay); } catch {} };

  btnExport.addEventListener('click', async () => {
    try {
      const base = String(inpName.value || baseDefault).trim() || baseDefault;
      const fmt = selFmt.value;
      const unit = selUnit.value;
      const scale = _unitScale(unit);
      const metadataManager = viewer?.partHistory?.metadataManager || null;

      if (fmt === 'json') {
        try {
          const json = await viewer?.partHistory?.toJSON?.();
          const text = typeof json === 'string' ? json : JSON.stringify(json || {});
          _download(`${base}.BREP.json`, text, 'application/json');
          close();
          return;
        } catch (e) { /* fall through to show alert below */ }
      }

      if (fmt === '3mf') {
        // Possibly include feature history in metadata
        let additionalFiles = undefined;
        let modelMetadata = undefined;
        try {
          const json = await viewer?.partHistory?.toJSON?.();
          if (json && typeof json === 'string') {
            additionalFiles = { 'Metadata/featureHistory.json': json };
            modelMetadata = { featureHistoryPath: '/Metadata/featureHistory.json' };
          }
          const viewFiles = await viewer?.pmiViewsWidget?.captureViewImagesForPackage?.();
          if (viewFiles && typeof viewFiles === 'object') {
            additionalFiles = { ...(additionalFiles || {}), ...viewFiles };
          }
        } catch {}

        // Gracefully handle non-manifold solids by skipping them
        const solidsForExport = [];
        const skipped = [];
        solids.forEach((s, idx) => {
          try {
            const mesh = s?.getMesh?.();
            if (mesh && mesh.vertProperties && mesh.triVerts) {
              solidsForExport.push(s);
            } else {
              const name = _safeName(s?.name || `solid_${idx}`);
              skipped.push(name);
            }
          } catch (e) {
            const name = _safeName(s?.name || `solid_${idx}`);
            skipped.push(name);
          }
        });

        // Capture a preview thumbnail to embed (best-effort)
        const thumbnail = await _captureThumbnail(viewer, 256);

        let data;
        try {
          const metadataManager = viewer?.partHistory?.metadataManager || null;
          data = await generate3MF(solidsForExport, { unit, precision: 6, scale, additionalFiles, modelMetadata, thumbnail, metadataManager });
        } catch (e) {
          // As a last resort, attempt exporting only the feature history (no solids)
          try {
            const metadataManager = viewer?.partHistory?.metadataManager || null;
            data = await generate3MF([], { unit, precision: 6, scale, additionalFiles, modelMetadata, thumbnail, metadataManager });
          } catch (e2) {
            throw e; // fall back to outer error handler
          }
        }

        _download(`${base}.3mf`, data, 'model/3mf');
        close();
        if (skipped.length > 0) {
          const msg = (solidsForExport.length === 0)
            ? `Exported 3MF with feature history only. Skipped non-manifold solids: ${skipped.join(', ')}`
            : `Exported 3MF. Skipped non-manifold solids: ${skipped.join(', ')}`;
          try { alert(msg); } catch {}
        }
        return;
      }

      if (fmt === 'step') {
        if (!chkStepFaces.checked && !chkStepEdges.checked) {
          try { alert('STEP export: enable faces and/or edges.'); } catch {}
          return;
        }
        const { data, exported, skipped } = generateSTEP(solids, {
          name: base,
          unit,
          precision: 6,
          scale,
          applyWorldTransform: true,
          useTessellatedFaces: chkTess.checked,
          exportFaces: chkStepFaces.checked,
          exportEdgesAsPolylines: chkStepEdges.checked,
        });
        if (!exported) {
          const msg = skipped.length
            ? `STEP export failed. Skipped solids: ${skipped.join(', ')}`
            : 'STEP export failed.';
          try { alert(msg); } catch {}
          return;
        }
        _download(`${base}.step`, data, 'application/step');
        close();
        if (skipped.length > 0) {
          try { alert(`Exported STEP. Skipped solids: ${skipped.join(', ')}`); } catch {}
        }
        return;
      }

      if (fmt === 'obj') {
        const includeObjColors = !!chkObjColors.checked;
        // Single solid -> OBJ
        if (solids.length === 1) {
          const s = solids[0];
          const mesh = s.getMesh();
          const colorContext = includeObjColors ? _buildOBJColorContext(s, mesh, metadataManager) : null;
          const obj = _meshToAsciiOBJ(mesh, base, 6, scale, colorContext);
          try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
          _download(`${base}.obj`, obj, 'text/plain');
          close();
          return;
        }
        // Multiple solids -> ZIP of individual OBJs
        const zip = new JSZip();
        solids.forEach((s, idx) => {
          try {
            const safe = _safeName(s.name || `solid_${idx}`);
            const mesh = s.getMesh();
            const colorContext = includeObjColors ? _buildOBJColorContext(s, mesh, metadataManager) : null;
            const obj = _meshToAsciiOBJ(mesh, safe, 6, scale, colorContext);
            try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
            zip.file(`${safe}.obj`, obj);
          } catch {}
        });
        const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        _download(`${base}_obj.zip`, blob, 'application/zip');
        close();
        return;
      }

      // STL path
      if (solids.length === 1) {
        const s = solids[0];
        const mesh = s.getMesh();
        const stl = _meshToAsciiSTL(mesh, base, 6, scale);
        try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
        _download(`${base}.stl`, stl, 'model/stl');
        close();
        return;
      }
      // Multiple solids -> ZIP of individual STLs
      const zip = new JSZip();
      solids.forEach((s, idx) => {
        try {
          const safe = _safeName(s.name || `solid_${idx}`);
          const mesh = s.getMesh();
          const stl = _meshToAsciiSTL(mesh, safe, 6, scale);
          try { if (mesh && typeof mesh.delete === 'function') mesh.delete(); } catch {}
          zip.file(`${safe}.stl`, stl);
        } catch {}
      });
      const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      _download(`${base}_stl.zip`, blob, 'application/zip');
      close();
    } catch (e) {
      alert('Export failed. See console for details.');
      console.error(e);
    }
  });

  buttons.appendChild(btnCancel);
  buttons.appendChild(btnExport);

  modal.appendChild(title);
  modal.appendChild(rowName);
  modal.appendChild(rowFmt);
  modal.appendChild(rowUnit);
  modal.appendChild(rowObjColors);
  modal.appendChild(rowTess);
  modal.appendChild(rowStepFaces);
  modal.appendChild(rowStepEdges);
  modal.appendChild(hint);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try { inpName.focus(); inpName.select(); } catch {}
}
