const IMPORT_FEATURE_ID = 'IMPORT3D_SEGMENTATION_CYLINDER_LABEL';

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  if (Math.abs(num) < 1e-16) return '0';
  return num.toFixed(9);
}

function appendFacet(out, p0, p1, p2) {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  let nx = (uy * vz) - (uz * vy);
  let ny = (uz * vx) - (ux * vz);
  let nz = (ux * vy) - (uy * vx);
  const nLen = Math.hypot(nx, ny, nz) || 1;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  out.push(`  facet normal ${formatNumber(nx)} ${formatNumber(ny)} ${formatNumber(nz)}`);
  out.push('    outer loop');
  out.push(`      vertex ${formatNumber(p0[0])} ${formatNumber(p0[1])} ${formatNumber(p0[2])}`);
  out.push(`      vertex ${formatNumber(p1[0])} ${formatNumber(p1[1])} ${formatNumber(p1[2])}`);
  out.push(`      vertex ${formatNumber(p2[0])} ${formatNumber(p2[1])} ${formatNumber(p2[2])}`);
  out.push('    endloop');
  out.push('  endfacet');
}

function buildCylinderStl({ radius = 6, height = 10, segments = 64 } = {}) {
  const segCount = Math.max(12, Number(segments) | 0);
  const r = Math.max(0.1, Number(radius) || 1);
  const h = Math.max(0.1, Number(height) || 1);
  const half = h * 0.5;
  const topCenter = [0, half, 0];
  const bottomCenter = [0, -half, 0];

  const lines = ['solid import3d_segmentation_cylinder'];
  for (let i = 0; i < segCount; i += 1) {
    const t0 = (i / segCount) * Math.PI * 2;
    const t1 = ((i + 1) / segCount) * Math.PI * 2;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);

    const b0 = [r * c0, -half, r * s0];
    const b1 = [r * c1, -half, r * s1];
    const top0 = [r * c0, half, r * s0];
    const top1 = [r * c1, half, r * s1];

    appendFacet(lines, b0, b1, top1);
    appendFacet(lines, b0, top1, top0);
    appendFacet(lines, topCenter, top1, top0);
    appendFacet(lines, bottomCenter, b0, b1);
  }
  lines.push('endsolid import3d_segmentation_cylinder');
  return lines.join('\n');
}

function buildMixedCylinderPatchStl({ radius = 5, height = 10 } = {}) {
  const r = Math.max(0.1, Number(radius) || 1);
  const h = Math.max(0.1, Number(height) || 1);
  const rows = 8;
  const arcSegments = 44;
  const theta0 = -Math.PI * 0.46;
  const theta1 = Math.PI * 0.44;

  const points = [];
  const triangles = [];
  const addPoint = (x, y, z) => {
    const idx = points.length;
    points.push([x, y, z]);
    return idx;
  };
  const addQuad = (a, b, c, d) => {
    triangles.push([a, b, c], [a, c, d]);
  };

  const grid = [];
  for (let yIdx = 0; yIdx <= rows; yIdx += 1) {
    const y = (-h * 0.5) + ((h * yIdx) / rows);
    const row = [];
    for (let i = 0; i <= arcSegments; i += 1) {
      const t = theta0 + (((theta1 - theta0) * i) / arcSegments);
      row.push(addPoint(r * Math.cos(t), y, r * Math.sin(t)));
    }
    grid.push(row);
  }
  for (let yIdx = 0; yIdx < rows; yIdx += 1) {
    for (let i = 0; i < arcSegments; i += 1) {
      addQuad(grid[yIdx][i], grid[yIdx][i + 1], grid[yIdx + 1][i + 1], grid[yIdx + 1][i]);
    }
  }

  // Add one attached near-planar flap so this should not stay as a single pure cylinder region.
  const leftEdge = [];
  for (let yIdx = 0; yIdx <= rows; yIdx += 1) leftEdge.push(grid[yIdx][0]);
  const xPlane = (r * Math.cos(theta0)) - 2.8;
  const zPlane = (r * Math.sin(theta0)) - 1.4;
  const planeMid = [];
  const planeOuter = [];
  for (let yIdx = 0; yIdx <= rows; yIdx += 1) {
    const y = (-h * 0.5) + ((h * yIdx) / rows);
    const t = yIdx / rows;
    planeMid.push(addPoint(
      xPlane,
      y + (0.06 * h * Math.sin(t * Math.PI)),
      zPlane + (1.0 * t),
    ));
    planeOuter.push(addPoint(
      xPlane - 1.25,
      y - (0.04 * h * Math.sin(t * Math.PI)),
      zPlane + 1.7 + (0.28 * t),
    ));
  }
  for (let yIdx = 0; yIdx < rows; yIdx += 1) {
    addQuad(planeMid[yIdx], leftEdge[yIdx], leftEdge[yIdx + 1], planeMid[yIdx + 1]);
    addQuad(planeOuter[yIdx], planeMid[yIdx], planeMid[yIdx + 1], planeOuter[yIdx + 1]);
  }

  const lines = ['solid import3d_segmentation_mixed_patch'];
  for (const tri of triangles) {
    appendFacet(lines, points[tri[0]], points[tri[1]], points[tri[2]]);
  }
  lines.push('endsolid import3d_segmentation_mixed_patch');
  return lines.join('\n');
}

function buildCylinderWithTinyPlanarTabStl({ radius = 5, height = 10 } = {}) {
  const r = Math.max(0.1, Number(radius) || 1);
  const h = Math.max(0.1, Number(height) || 1);
  const rows = 10;
  const arcSegments = 56;
  const theta0 = -Math.PI * 0.42;
  const theta1 = Math.PI * 0.42;

  const points = [];
  const triangles = [];
  const addPoint = (x, y, z) => {
    const idx = points.length;
    points.push([x, y, z]);
    return idx;
  };
  const addQuad = (a, b, c, d) => {
    triangles.push([a, b, c], [a, c, d]);
  };

  const grid = [];
  for (let yIdx = 0; yIdx <= rows; yIdx += 1) {
    const y = (-h * 0.5) + ((h * yIdx) / rows);
    const row = [];
    for (let i = 0; i <= arcSegments; i += 1) {
      const t = theta0 + (((theta1 - theta0) * i) / arcSegments);
      row.push(addPoint(r * Math.cos(t), y, r * Math.sin(t)));
    }
    grid.push(row);
  }
  for (let yIdx = 0; yIdx < rows; yIdx += 1) {
    for (let i = 0; i < arcSegments; i += 1) {
      addQuad(grid[yIdx][i], grid[yIdx][i + 1], grid[yIdx + 1][i + 1], grid[yIdx + 1][i]);
    }
  }

  // Add a tiny 2-triangle tab on the left boundary. This is the shape we want
  // to be promoted from OTHER to PLANE during per-face refinement.
  const y0 = Math.floor(rows * 0.45);
  const y1 = y0 + 1;
  const a0 = points[grid[y0][0]];
  const a1 = points[grid[y1][0]];
  const tangent = [-Math.sin(theta0), 0, Math.cos(theta0)];
  const radial = [Math.cos(theta0), 0, Math.sin(theta0)];
  const blendX = tangent[0] + (0.55 * radial[0]);
  const blendZ = tangent[2] + (0.55 * radial[2]);
  const blendLen = Math.hypot(blendX, blendZ) || 1;
  const tabDir = [blendX / blendLen, 0, blendZ / blendLen];
  const tabWidth = r * 0.35;
  const b0 = addPoint(
    a0[0] + (tabDir[0] * tabWidth),
    a0[1],
    a0[2] + (tabDir[2] * tabWidth),
  );
  const b1 = addPoint(
    a1[0] + (tabDir[0] * tabWidth),
    a1[1],
    a1[2] + (tabDir[2] * tabWidth),
  );
  triangles.push([grid[y0][0], b1, grid[y1][0]]);
  triangles.push([grid[y0][0], b0, b1]);

  const lines = ['solid import3d_segmentation_tiny_planar_tab'];
  for (const tri of triangles) {
    appendFacet(lines, points[tri[0]], points[tri[1]], points[tri[2]]);
  }
  lines.push('endsolid import3d_segmentation_tiny_planar_tab');
  return lines.join('\n');
}

export async function test_import3d_primitive_segmentation_labels_unsplit_cylinder(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.id = IMPORT_FEATURE_ID;
  import3d.inputParams.featureID = IMPORT_FEATURE_ID;
  import3d.inputParams.fileToImport = buildCylinderStl({
    radius: 5,
    height: 12,
    segments: 64,
  });
  import3d.inputParams.centerMesh = false;
  import3d.inputParams.deflectionAngle = 10;
  import3d.inputParams.extractPlanarFaces = false;
  import3d.inputParams.segmentAnalyticPrimitives = true;
  return partHistory;
}

export async function afterRun_import3d_primitive_segmentation_labels_unsplit_cylinder(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  if (!solids.length) throw new Error('[import3d segmentation] No solids were generated');

  const solid = solids.find((obj) => String(obj?.name || '') === IMPORT_FEATURE_ID) || solids[0];
  if (!solid) throw new Error('[import3d segmentation] Could not find the imported solid');

  const summary = solid?.userData?.importPrimitiveSegmentation;
  if (!summary?.enabled) {
    throw new Error('[import3d segmentation] Primitive segmentation summary is missing or disabled');
  }
  if (!(Number(summary.classifiedFaceCount) >= 1)) {
    throw new Error('[import3d segmentation] Expected at least one classified parent primitive face');
  }
  if (!(Number(summary.renamedParentFaceCount) >= 1)) {
    throw new Error('[import3d segmentation] Expected at least one renamed parent primitive face');
  }
  if (Number(summary.splitFaceCount) !== 0) {
    throw new Error(`[import3d segmentation] Expected unsplit classification, got splitFaceCount=${summary.splitFaceCount}`);
  }

  const idToFaceName = (solid._idToFaceName instanceof Map) ? solid._idToFaceName : new Map();
  const faceNames = Array.from(idToFaceName.values()).map((name) => String(name || ''));
  const hasCylinderLabel = faceNames.some((name) => name.includes('_CYLINDER'));
  if (!hasCylinderLabel) {
    throw new Error('[import3d segmentation] Expected a face name with _CYLINDER after unsplit classification');
  }

  const metadata = (solid._faceMetadata instanceof Map) ? solid._faceMetadata : new Map();
  const hasParentCylinderMetadata = Array.from(metadata.values()).some((entry) => (
    entry &&
    entry.isParentPrimitiveRegion === true &&
    String(entry.primitiveType || '').toUpperCase() === 'CYLINDER'
  ));
  if (!hasParentCylinderMetadata) {
    throw new Error('[import3d segmentation] Expected parent primitive metadata for CYLINDER');
  }
}

export async function test_import3d_primitive_segmentation_splits_mixed_face(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.id = `${IMPORT_FEATURE_ID}_MIXED`;
  import3d.inputParams.featureID = `${IMPORT_FEATURE_ID}_MIXED`;
  import3d.inputParams.fileToImport = buildMixedCylinderPatchStl({
    radius: 5,
    height: 10,
  });
  import3d.inputParams.centerMesh = false;
  import3d.inputParams.deflectionAngle = 40;
  import3d.inputParams.extractPlanarFaces = false;
  import3d.inputParams.segmentAnalyticPrimitives = true;
  return partHistory;
}

export async function afterRun_import3d_primitive_segmentation_splits_mixed_face(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  if (!solids.length) throw new Error('[import3d segmentation mixed] No solids were generated');
  const solid = solids.find((obj) => String(obj?.name || '').includes('_MIXED')) || solids[0];

  const summary = solid?.userData?.importPrimitiveSegmentation;
  if (!summary?.enabled) {
    throw new Error('[import3d segmentation mixed] Primitive segmentation summary missing');
  }
  if (!(Number(summary.splitFaceCount) >= 1)) {
    throw new Error(`[import3d segmentation mixed] Expected splitFaceCount >= 1, got ${summary?.splitFaceCount}`);
  }
  if (!(Number(summary.createdFaceCount) >= 1)) {
    throw new Error(`[import3d segmentation mixed] Expected createdFaceCount >= 1, got ${summary?.createdFaceCount}`);
  }

  const names = Array.from((solid._idToFaceName instanceof Map ? solid._idToFaceName.values() : []))
    .map((name) => String(name || ''));
  const hasNonCylinderSegment = names.some(
    (name) => name.includes('_OTHER') || name.includes('_PLANE') || name.includes('_CONE')
  );
  if (!hasNonCylinderSegment) {
    throw new Error('[import3d segmentation mixed] Expected a non-cylinder segment label after refinement');
  }
}

export async function test_import3d_primitive_segmentation_promotes_tiny_planar_patch(partHistory) {
  const import3d = await partHistory.newFeature('IMPORT3D');
  import3d.inputParams.id = `${IMPORT_FEATURE_ID}_TINY_PLANAR`;
  import3d.inputParams.featureID = `${IMPORT_FEATURE_ID}_TINY_PLANAR`;
  import3d.inputParams.fileToImport = buildCylinderWithTinyPlanarTabStl({
    radius: 5,
    height: 10,
  });
  import3d.inputParams.centerMesh = false;
  import3d.inputParams.deflectionAngle = 80;
  import3d.inputParams.extractPlanarFaces = false;
  import3d.inputParams.segmentAnalyticPrimitives = true;
  import3d.inputParams.primitivePromoteSmallPlanarOther = true;
  import3d.inputParams.primitivePromoteSmallPlanarMaxTriangles = 4;
  return partHistory;
}

export async function afterRun_import3d_primitive_segmentation_promotes_tiny_planar_patch(partHistory) {
  const solids = (partHistory.scene?.children || []).filter((obj) => obj?.type === 'SOLID');
  if (!solids.length) throw new Error('[import3d segmentation tiny planar] No solids were generated');
  const solid = solids.find((obj) => String(obj?.name || '').includes('_TINY_PLANAR')) || solids[0];

  const summary = solid?.userData?.importPrimitiveSegmentation;
  if (!summary?.enabled) {
    throw new Error('[import3d segmentation tiny planar] Primitive segmentation summary missing');
  }
  if (!(Number(summary.splitFaceCount) >= 1)) {
    throw new Error(`[import3d segmentation tiny planar] Expected splitFaceCount >= 1, got ${summary?.splitFaceCount}`);
  }

  const names = Array.from((solid._idToFaceName instanceof Map ? solid._idToFaceName.values() : []))
    .map((name) => String(name || ''));
  const hasPlaneSegment = names.some((name) => name.includes('_PLANE'));
  if (!hasPlaneSegment) {
    throw new Error('[import3d segmentation tiny planar] Expected a _PLANE segment label for tiny planar tab');
  }

  const metadata = (solid._faceMetadata instanceof Map) ? solid._faceMetadata : new Map();
  const hasTinyPlaneMetadata = Array.from(metadata.values()).some((entry) => (
    entry &&
    String(entry.primitiveType || '').toUpperCase() === 'PLANE' &&
    Number(entry.triangleCount) <= 4
  ));
  if (!hasTinyPlaneMetadata) {
    throw new Error('[import3d segmentation tiny planar] Expected tiny PLANE metadata entry (<=4 triangles)');
  }
}
