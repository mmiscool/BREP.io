export type CamCutterKind = 'flat' | 'ball' | 'bull' | 'cone' | 'ball-cone';

export type CamCutterProfileInput = {
  kind?: CamCutterKind | string | null;
  toolShape?: CamCutterKind | string | null;
  diameter?: number | string | null;
  toolDiameter?: number | string | null;
  maximumDiameter?: number | string | null;
  ballDiameter?: number | string | null;
  cuttingLength?: number | string | null;
  toolLength?: number | string | null;
  shaftLength?: number | string | null;
  cornerRadius?: number | string | null;
  includedAngleDeg?: number | string | null;
  includedAngle?: number | string | null;
};

export type CamCutterProfileSegmentKind = 'flat' | 'ball' | 'bull-corner' | 'cone' | 'cylinder';

export type CamCutterProfileSegment = {
  kind: CamCutterProfileSegmentKind;
  minRadius: number;
  maxRadius: number;
  minHeight: number;
  maxHeight: number;
};

export type CamCutterMesh = {
  positions: number[];
  indices: number[];
  vertexCount: number;
  triangleCount: number;
};

export type CamCutterMeshOptions = {
  radialSegments?: number;
  verticalSegments?: number;
};

export type CamCutterProfile = {
  kind: CamCutterKind;
  diameter: number;
  radius: number;
  cuttingLength: number;
  shaftLength: number;
  profileHeight: number;
  cornerRadius?: number;
  includedAngleDeg?: number;
  halfAngleRad?: number;
  ballDiameter?: number;
  maximumDiameter?: number;
  tangentRadius?: number;
  tangentHeight?: number;
  coneTopHeight?: number;
  segments: CamCutterProfileSegment[];
  heightAtRadius(r: number): number | null;
  radiusAtHeight(h: number): number | null;
  maxRadiusAtHeight(h: number): number | null;
  segmentAtRadius(r: number): CamCutterProfileSegment | null;
  segmentAtHeight(h: number): CamCutterProfileSegment | null;
  validate(): string[];
  makePreviewMesh(options?: CamCutterMeshOptions | number): CamCutterMesh;
  makeSweptSegmentMesh(start: [number, number, number], end: [number, number, number], options?: CamCutterMeshOptions | number): CamCutterMesh;
};

const EPS = 1e-9;

export const DEFAULT_CAM_CUTTER_PROFILE_INPUT = {
  kind: 'flat' as CamCutterKind,
  diameter: 3.175,
  cuttingLength: 25,
  shaftLength: 0,
};

function hasValue(value: any) {
  return value != null && value !== '';
}

function sourceNumber(source: CamCutterProfileInput, keys: string[], fallback: number, label: string, errors: string[]) {
  for (const key of keys) {
    const value = (source as any)[key];
    if (!hasValue(value)) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
    errors.push(`${label} must be a positive finite number.`);
    return fallback;
  }
  return fallback;
}

function optionalSourceNumber(source: CamCutterProfileInput, keys: string[], fallback: number, label: string, errors: string[]) {
  for (const key of keys) {
    const value = (source as any)[key];
    if (!hasValue(value)) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
    errors.push(`${label} must be a positive finite number.`);
    return fallback;
  }
  return fallback;
}

function shaftLengthNumber(value: any, fallback: number, errors: string[]) {
  if (!hasValue(value)) return fallback;
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) return num;
  errors.push('shaftLength must be a non-negative finite number.');
  return fallback;
}

function includedAngleNumber(source: CamCutterProfileInput, errors: string[]) {
  for (const key of ['includedAngleDeg', 'includedAngle']) {
    const value = (source as any)[key];
    if (!hasValue(value)) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0 && num < 180) return num;
    errors.push('includedAngle must be a finite number greater than 0 and less than 180.');
    return 90;
  }
  return 90;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min - EPS && value <= max + EPS;
}

function safeSqrt(value: number) {
  return Math.sqrt(Math.max(0, value));
}

export function normalizeCamCutterKind(value: any): CamCutterKind {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ball') return 'ball';
  if (normalized === 'bull') return 'bull';
  if (normalized === 'cone') return 'cone';
  if (normalized === 'ball-cone' || normalized === 'ballcone' || normalized === 'ball_to_cone') return 'ball-cone';
  return 'flat';
}

function makeSegmentLookup(segments: CamCutterProfileSegment[]) {
  return {
    segmentAtRadius(r: number) {
      if (!Number.isFinite(r)) return null;
      return segments.find((segment) => inRange(r, segment.minRadius, segment.maxRadius)) || null;
    },
    segmentAtHeight(h: number) {
      if (!Number.isFinite(h)) return null;
      return segments.find((segment) => inRange(h, segment.minHeight, segment.maxHeight)) || null;
    },
  };
}

function meshOptions(options: CamCutterMeshOptions | number | null | undefined) {
  const source = typeof options === 'number' ? { radialSegments: options } : (options || {});
  return {
    radialSegments: Math.max(8, Math.min(96, Math.round(Number(source.radialSegments) || 24))),
    verticalSegments: Math.max(4, Math.min(128, Math.round(Number(source.verticalSegments) || 32))),
  };
}

function sortedUniqueNumbers(values: number[], tolerance = 1e-7) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > tolerance) out.push(value);
  }
  return out;
}

function profileHeightSamples(profile: CamCutterProfile, totalHeight: number, verticalSegments: number) {
  const values = [0, totalHeight, profile.profileHeight, profile.cuttingLength, profile.cuttingLength + profile.shaftLength];
  for (let index = 0; index <= verticalSegments; index += 1) {
    values.push((totalHeight * index) / verticalSegments);
  }
  for (const segment of profile.segments || []) {
    values.push(segment.minHeight, segment.maxHeight);
  }
  return sortedUniqueNumbers(values
    .map((value) => Math.max(0, Math.min(totalHeight, value))));
}

function radiusAtMeshHeight(profile: CamCutterProfile, height: number) {
  const radius = profile.maxRadiusAtHeight(height);
  return Math.max(0, Number.isFinite(radius as number) ? Number(radius) : 0);
}

function appendVertex(positions: number[], x: number, y: number, z: number) {
  positions.push(x, y, z);
  return positions.length / 3 - 1;
}

function makeCutterPreviewMesh(profile: CamCutterProfile, options?: CamCutterMeshOptions | number): CamCutterMesh {
  const { radialSegments, verticalSegments } = meshOptions(options);
  const totalHeight = Math.max(EPS, profile.cuttingLength + profile.shaftLength);
  const heights = profileHeightSamples(profile, totalHeight, verticalSegments);
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];

  for (const height of heights) {
    const radius = radiusAtMeshHeight(profile, height);
    const ring: number[] = [];
    for (let index = 0; index < radialSegments; index += 1) {
      const angle = (Math.PI * 2 * index) / radialSegments;
      ring.push(appendVertex(
        positions,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        height,
      ));
    }
    rings.push(ring);
  }

  for (let row = 0; row + 1 < rings.length; row += 1) {
    const current = rings[row];
    const next = rings[row + 1];
    for (let index = 0; index < radialSegments; index += 1) {
      const nextIndex = (index + 1) % radialSegments;
      indices.push(current[index], current[nextIndex], next[nextIndex]);
      indices.push(current[index], next[nextIndex], next[index]);
    }
  }

  const capRing = (ring: number[], z: number, reverse = false) => {
    const centerIndex = appendVertex(positions, 0, 0, z);
    for (let index = 0; index < radialSegments; index += 1) {
      const nextIndex = (index + 1) % radialSegments;
      if (reverse) indices.push(centerIndex, ring[nextIndex], ring[index]);
      else indices.push(centerIndex, ring[index], ring[nextIndex]);
    }
  };
  if (rings.length) {
    capRing(rings[0], heights[0], true);
    capRing(rings[rings.length - 1], heights[heights.length - 1], false);
  }

  return {
    positions,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function sweepFootprintBoundary(start: [number, number, number], end: [number, number, number], radius: number, radialSegments: number) {
  const sx = Number(start[0]) || 0;
  const sy = Number(start[1]) || 0;
  const ex = Number(end[0]) || 0;
  const ey = Number(end[1]) || 0;
  const dx = ex - sx;
  const dy = ey - sy;
  const xyLength = Math.hypot(dx, dy);
  const r = Math.max(0, radius);
  const out: Array<{ x: number; y: number }> = [];

  if (xyLength <= EPS) {
    for (let index = 0; index < radialSegments; index += 1) {
      const angle = (Math.PI * 2 * index) / radialSegments;
      out.push({ x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r });
    }
    return out;
  }

  const ux = dx / xyLength;
  const uy = dy / xyLength;
  const leftAngle = Math.atan2(uy, ux) + Math.PI / 2;
  const rightAngle = Math.atan2(uy, ux) - Math.PI / 2;
  const capSteps = Math.max(4, Math.round(radialSegments / 2));
  out.push({ x: sx + Math.cos(leftAngle) * r, y: sy + Math.sin(leftAngle) * r });
  for (let index = 0; index <= capSteps; index += 1) {
    const angle = leftAngle + ((rightAngle - leftAngle) * index) / capSteps;
    out.push({ x: ex + Math.cos(angle) * r, y: ey + Math.sin(angle) * r });
  }
  out.push({ x: sx + Math.cos(rightAngle) * r, y: sy + Math.sin(rightAngle) * r });
  for (let index = 0; index <= capSteps; index += 1) {
    const angle = rightAngle - (Math.PI * index) / capSteps;
    out.push({ x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r });
  }
  return out;
}

function maxSweptRadiusAtZ(profile: CamCutterProfile, absoluteZ: number, lowTipZ: number, highTipZ: number, totalHeight: number, heightSamples: number[]) {
  const minLocalHeight = Math.max(0, absoluteZ - highTipZ);
  const maxLocalHeight = Math.min(totalHeight, absoluteZ - lowTipZ);
  if (maxLocalHeight < minLocalHeight - EPS) return 0;
  let maxRadius = 0;
  for (const height of [minLocalHeight, maxLocalHeight, ...heightSamples]) {
    if (height < minLocalHeight - EPS || height > maxLocalHeight + EPS) continue;
    maxRadius = Math.max(maxRadius, radiusAtMeshHeight(profile, height));
  }
  return maxRadius;
}

function makeCutterSweptSegmentMesh(
  profile: CamCutterProfile,
  start: [number, number, number],
  end: [number, number, number],
  options?: CamCutterMeshOptions | number,
): CamCutterMesh {
  const { radialSegments, verticalSegments } = meshOptions(options);
  const startZ = Number(start?.[2]) || 0;
  const endZ = Number(end?.[2]) || 0;
  const lowTipZ = Math.min(startZ, endZ);
  const highTipZ = Math.max(startZ, endZ);
  const totalHeight = Math.max(EPS, profile.cuttingLength + profile.shaftLength);
  const heightSamples = profileHeightSamples(profile, totalHeight, verticalSegments);
  const layerZs = [lowTipZ, highTipZ + totalHeight];
  const zSpan = Math.max(EPS, highTipZ + totalHeight - lowTipZ);
  for (let index = 0; index <= verticalSegments; index += 1) {
    layerZs.push(lowTipZ + (zSpan * index) / verticalSegments);
  }
  for (const height of heightSamples) {
    layerZs.push(startZ + height, endZ + height);
  }
  const layers = sortedUniqueNumbers(layerZs).map((z) => ({
    z,
    radius: maxSweptRadiusAtZ(profile, z, lowTipZ, highTipZ, totalHeight, heightSamples),
  }));
  const positions: number[] = [];
  const indices: number[] = [];
  const rows: number[][] = [];

  for (const layer of layers) {
    const boundary = sweepFootprintBoundary(start, end, layer.radius, radialSegments);
    rows.push(boundary.map((point) => appendVertex(positions, point.x, point.y, layer.z)));
  }

  for (let row = 0; row + 1 < rows.length; row += 1) {
    const current = rows[row];
    const next = rows[row + 1];
    const count = Math.min(current.length, next.length);
    for (let index = 0; index < count; index += 1) {
      const nextIndex = (index + 1) % count;
      indices.push(current[index], current[nextIndex], next[nextIndex]);
      indices.push(current[index], next[nextIndex], next[index]);
    }
  }

  const capRow = (row: number[], z: number, reverse = false) => {
    const center = row.reduce((sum, vertexIndex) => ({
      x: sum.x + (positions[vertexIndex * 3] || 0),
      y: sum.y + (positions[vertexIndex * 3 + 1] || 0),
    }), { x: 0, y: 0 });
    const centerIndex = appendVertex(positions, center.x / Math.max(1, row.length), center.y / Math.max(1, row.length), z);
    for (let index = 0; index < row.length; index += 1) {
      const nextIndex = (index + 1) % row.length;
      if (reverse) indices.push(centerIndex, row[nextIndex], row[index]);
      else indices.push(centerIndex, row[index], row[nextIndex]);
    }
  };
  if (rows.length) {
    capRow(rows[0], layers[0].z, true);
    capRow(rows[rows.length - 1], layers[layers.length - 1].z, false);
  }

  return {
    positions,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function maxRadiusAtHeight(profile: Pick<CamCutterProfile, 'radius' | 'cuttingLength' | 'shaftLength' | 'radiusAtHeight'>, h: number) {
  if (!Number.isFinite(h) || h < -EPS) return null;
  const cuttingRadius = profile.radiusAtHeight(h);
  if (cuttingRadius != null) return cuttingRadius;
  const totalLength = profile.cuttingLength + profile.shaftLength;
  return h <= totalLength + EPS ? profile.radius : null;
}

function makeProfile(base: Omit<CamCutterProfile, 'maxRadiusAtHeight' | 'segmentAtRadius' | 'segmentAtHeight' | 'validate' | 'makePreviewMesh' | 'makeSweptSegmentMesh'>, errors: string[]): CamCutterProfile {
  const lookup = makeSegmentLookup(base.segments);
  const profile = {
    ...base,
    maxRadiusAtHeight(h: number) {
      return maxRadiusAtHeight(profile, h);
    },
    segmentAtRadius: lookup.segmentAtRadius,
    segmentAtHeight: lookup.segmentAtHeight,
    validate() {
      return [...errors];
    },
    makePreviewMesh(options?: CamCutterMeshOptions | number) {
      return makeCutterPreviewMesh(profile, options);
    },
    makeSweptSegmentMesh(start: [number, number, number], end: [number, number, number], options?: CamCutterMeshOptions | number) {
      return makeCutterSweptSegmentMesh(profile, start, end, options);
    },
  };
  return profile;
}

function makeFlatProfile(diameter: number, cuttingLength: number, shaftLength: number, errors: string[]) {
  const radius = diameter * 0.5;
  const segments: CamCutterProfileSegment[] = [
    { kind: 'flat', minRadius: 0, maxRadius: radius, minHeight: 0, maxHeight: 0 },
    { kind: 'cylinder', minRadius: radius, maxRadius: radius, minHeight: 0, maxHeight: cuttingLength },
  ];
  return makeProfile({
    kind: 'flat',
    diameter,
    radius,
    cuttingLength,
    shaftLength,
    profileHeight: 0,
    segments,
    heightAtRadius(r: number) {
      return inRange(r, 0, radius) ? 0 : null;
    },
    radiusAtHeight(h: number) {
      return inRange(h, 0, cuttingLength) ? radius : null;
    },
  }, errors);
}

function makeBallProfile(diameter: number, cuttingLength: number, shaftLength: number, errors: string[]) {
  const radius = diameter * 0.5;
  const segments: CamCutterProfileSegment[] = [
    { kind: 'ball', minRadius: 0, maxRadius: radius, minHeight: 0, maxHeight: radius },
    { kind: 'cylinder', minRadius: radius, maxRadius: radius, minHeight: radius, maxHeight: cuttingLength },
  ];
  return makeProfile({
    kind: 'ball',
    diameter,
    radius,
    cuttingLength,
    shaftLength,
    profileHeight: radius,
    segments,
    heightAtRadius(r: number) {
      if (!inRange(r, 0, radius)) return null;
      const rr = clamp(r, 0, radius);
      return radius - safeSqrt(radius * radius - rr * rr);
    },
    radiusAtHeight(h: number) {
      if (!inRange(h, 0, cuttingLength)) return null;
      if (h >= radius) return radius;
      const hh = clamp(h, 0, radius);
      return safeSqrt(radius * radius - (radius - hh) * (radius - hh));
    },
  }, errors);
}

function makeBullProfile(diameter: number, cuttingLength: number, shaftLength: number, cornerRadius: number, errors: string[]) {
  const radius = diameter * 0.5;
  const safeCornerRadius = clamp(cornerRadius, EPS, Math.max(EPS, radius - EPS));
  const flatRadius = Math.max(0, radius - safeCornerRadius);
  const segments: CamCutterProfileSegment[] = [
    { kind: 'flat', minRadius: 0, maxRadius: flatRadius, minHeight: 0, maxHeight: 0 },
    { kind: 'bull-corner', minRadius: flatRadius, maxRadius: radius, minHeight: 0, maxHeight: safeCornerRadius },
    { kind: 'cylinder', minRadius: radius, maxRadius: radius, minHeight: safeCornerRadius, maxHeight: cuttingLength },
  ];
  return makeProfile({
    kind: 'bull',
    diameter,
    radius,
    cuttingLength,
    shaftLength,
    profileHeight: safeCornerRadius,
    cornerRadius: safeCornerRadius,
    segments,
    heightAtRadius(r: number) {
      if (!inRange(r, 0, radius)) return null;
      const rr = clamp(r, 0, radius);
      if (rr <= flatRadius + EPS) return 0;
      const cornerOffset = rr - flatRadius;
      return safeCornerRadius - safeSqrt(safeCornerRadius * safeCornerRadius - cornerOffset * cornerOffset);
    },
    radiusAtHeight(h: number) {
      if (!inRange(h, 0, cuttingLength)) return null;
      if (h >= safeCornerRadius) return radius;
      const hh = clamp(h, 0, safeCornerRadius);
      return flatRadius + safeSqrt(safeCornerRadius * safeCornerRadius - (safeCornerRadius - hh) * (safeCornerRadius - hh));
    },
  }, errors);
}

function makeConeProfile(maximumDiameter: number, cuttingLength: number, shaftLength: number, includedAngleDeg: number, errors: string[]) {
  const radius = maximumDiameter * 0.5;
  const halfAngleRad = includedAngleDeg * Math.PI / 360;
  const tanHalfAngle = Math.tan(halfAngleRad);
  const profileHeight = radius / tanHalfAngle;
  const segments: CamCutterProfileSegment[] = [
    { kind: 'cone', minRadius: 0, maxRadius: radius, minHeight: 0, maxHeight: profileHeight },
    { kind: 'cylinder', minRadius: radius, maxRadius: radius, minHeight: profileHeight, maxHeight: cuttingLength },
  ];
  return makeProfile({
    kind: 'cone',
    diameter: maximumDiameter,
    maximumDiameter,
    radius,
    cuttingLength,
    shaftLength,
    profileHeight,
    coneTopHeight: profileHeight,
    includedAngleDeg,
    halfAngleRad,
    segments,
    heightAtRadius(r: number) {
      if (!inRange(r, 0, radius)) return null;
      return clamp(r, 0, radius) / tanHalfAngle;
    },
    radiusAtHeight(h: number) {
      if (!inRange(h, 0, cuttingLength)) return null;
      return Math.min(radius, Math.max(0, h) * tanHalfAngle);
    },
  }, errors);
}

function makeBallConeProfile(ballDiameter: number, maximumDiameter: number, cuttingLength: number, shaftLength: number, includedAngleDeg: number, errors: string[]) {
  const ballRadius = ballDiameter * 0.5;
  const radius = maximumDiameter * 0.5;
  if (Math.abs(radius - ballRadius) <= EPS) {
    const ball = makeBallProfile(ballDiameter, cuttingLength, shaftLength, errors);
    return {
      ...ball,
      kind: 'ball-cone' as CamCutterKind,
      diameter: maximumDiameter,
      maximumDiameter,
      ballDiameter,
      tangentRadius: ballRadius,
      tangentHeight: ballRadius,
      coneTopHeight: ballRadius,
      includedAngleDeg,
      halfAngleRad: includedAngleDeg * Math.PI / 360,
    };
  }

  const halfAngleRad = includedAngleDeg * Math.PI / 360;
  const tanHalfAngle = Math.tan(halfAngleRad);
  const tangentRadius = ballRadius * Math.cos(halfAngleRad);
  const tangentHeight = ballRadius - safeSqrt(ballRadius * ballRadius - tangentRadius * tangentRadius);
  const coneTopHeight = tangentHeight + (radius - tangentRadius) / tanHalfAngle;
  const segments: CamCutterProfileSegment[] = [
    { kind: 'ball', minRadius: 0, maxRadius: tangentRadius, minHeight: 0, maxHeight: tangentHeight },
    { kind: 'cone', minRadius: tangentRadius, maxRadius: radius, minHeight: tangentHeight, maxHeight: coneTopHeight },
    { kind: 'cylinder', minRadius: radius, maxRadius: radius, minHeight: coneTopHeight, maxHeight: cuttingLength },
  ];
  return makeProfile({
    kind: 'ball-cone',
    diameter: maximumDiameter,
    maximumDiameter,
    ballDiameter,
    radius,
    cuttingLength,
    shaftLength,
    profileHeight: coneTopHeight,
    coneTopHeight,
    includedAngleDeg,
    halfAngleRad,
    tangentRadius,
    tangentHeight,
    segments,
    heightAtRadius(r: number) {
      if (!inRange(r, 0, radius)) return null;
      const rr = clamp(r, 0, radius);
      if (rr <= tangentRadius + EPS) {
        return ballRadius - safeSqrt(ballRadius * ballRadius - rr * rr);
      }
      return tangentHeight + (rr - tangentRadius) / tanHalfAngle;
    },
    radiusAtHeight(h: number) {
      if (!inRange(h, 0, cuttingLength)) return null;
      const hh = Math.max(0, h);
      if (hh <= tangentHeight + EPS) {
        return Math.min(tangentRadius, safeSqrt(ballRadius * ballRadius - (ballRadius - hh) * (ballRadius - hh)));
      }
      if (hh <= coneTopHeight + EPS) {
        return Math.min(radius, tangentRadius + (hh - tangentHeight) * tanHalfAngle);
      }
      return radius;
    },
  }, errors);
}

export function createCamCutterProfile(raw: CamCutterProfileInput | null | undefined = null): CamCutterProfile {
  const source = (raw && typeof raw === 'object') ? raw : {};
  const errors: string[] = [];
  const kind = normalizeCamCutterKind(source.toolShape ?? source.kind);
  const diameter = sourceNumber(source, ['diameter', 'toolDiameter'], DEFAULT_CAM_CUTTER_PROFILE_INPUT.diameter, 'diameter', errors);
  const cuttingLength = sourceNumber(source, ['cuttingLength', 'toolLength'], DEFAULT_CAM_CUTTER_PROFILE_INPUT.cuttingLength, 'cuttingLength', errors);
  const shaftLength = shaftLengthNumber(source.shaftLength, DEFAULT_CAM_CUTTER_PROFILE_INPUT.shaftLength, errors);

  if (source.kind != null || source.toolShape != null) {
    const rawKind = String((source.toolShape ?? source.kind) || '').trim().toLowerCase();
    if (rawKind && normalizeCamCutterKind(rawKind) === 'flat' && rawKind !== 'flat') {
      errors.push(`Unsupported cutter shape "${rawKind}".`);
    }
  }

  if (kind === 'ball') {
    return makeBallProfile(diameter, cuttingLength, shaftLength, errors);
  }

  if (kind === 'bull') {
    const fallbackCornerRadius = Math.max(EPS, diameter * 0.05);
    const rawCornerRadius = optionalSourceNumber(source, ['cornerRadius'], fallbackCornerRadius, 'cornerRadius', errors);
    if (rawCornerRadius <= 0 || rawCornerRadius >= diameter * 0.5) {
      errors.push('cornerRadius must be greater than 0 and less than the cutter radius.');
    }
    const cornerRadius = rawCornerRadius > 0 && rawCornerRadius < diameter * 0.5 ? rawCornerRadius : fallbackCornerRadius;
    return makeBullProfile(diameter, cuttingLength, shaftLength, cornerRadius, errors);
  }

  if (kind === 'cone') {
    const maximumDiameter = sourceNumber(source, ['maximumDiameter', 'diameter', 'toolDiameter'], diameter, 'maximumDiameter', errors);
    const includedAngleDeg = includedAngleNumber(source, errors);
    return makeConeProfile(maximumDiameter, cuttingLength, shaftLength, includedAngleDeg, errors);
  }

  if (kind === 'ball-cone') {
    const ballDiameter = sourceNumber(source, ['ballDiameter'], diameter, 'ballDiameter', errors);
    const maximumDiameter = sourceNumber(source, ['maximumDiameter', 'diameter', 'toolDiameter'], Math.max(diameter, ballDiameter), 'maximumDiameter', errors);
    const includedAngleDeg = includedAngleNumber(source, errors);
    if (ballDiameter > maximumDiameter) {
      errors.push('ballDiameter must be less than or equal to maximumDiameter.');
    }
    const safeMaximumDiameter = Math.max(maximumDiameter, ballDiameter);
    return makeBallConeProfile(ballDiameter, safeMaximumDiameter, cuttingLength, shaftLength, includedAngleDeg, errors);
  }

  return makeFlatProfile(diameter, cuttingLength, shaftLength, errors);
}

export function normalizeCamCutterProfile(raw: CamCutterProfileInput | null | undefined = null) {
  return createCamCutterProfile(raw);
}

export function validateCamCutterProfile(raw: CamCutterProfileInput | null | undefined = null) {
  return createCamCutterProfile(raw).validate();
}

export const DEFAULT_CAM_CUTTER_PROFILE = createCamCutterProfile(DEFAULT_CAM_CUTTER_PROFILE_INPUT);
