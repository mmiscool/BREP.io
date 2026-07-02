// Direct TypeScript port of the core pngcam-go toolpath generator.
// Source: https://github.com/jes/pngcam.git (Unlicense), commit b4922ab.

export enum PngcamDirection {
  Horizontal = 0,
  Vertical = 1,
  Helical = 2,
}

export enum PngcamFeedType {
  RapidFeed = 0,
  CuttingFeed = 1,
}

export type PngcamTool = {
  radius(): number;
  heightAtRadius(r: number): number;
  heightAtRadiusSqr(rSqr: number): number;
  lengthToIntersection(xOffset: number, angle: number, z: number): number;
};

export type PngcamDepthSource = {
  widthPx: number;
  heightPx: number;
  getDepth(x: number, y: number): number;
  isBottom?: (x: number, y: number) => boolean;
};

export type PngcamOptionsInput = {
  safeZ?: number;
  rapidFeed?: number;
  xyFeed?: number;
  zFeed?: number;
  rpm?: number;
  width: number;
  height: number;
  depth: number;
  rotary?: boolean;
  direction?: PngcamDirection;
  stepOver: number;
  stepDown: number;
  tool: PngcamTool;
  stockToLeave?: number;
  roughingOnly?: boolean;
  omitTop?: boolean;
  omitBottom?: boolean;
  rampEntry?: boolean;
  cutBelowBottom?: boolean;
  cutBeyondEdges?: boolean;
  imperial?: boolean;
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  maxVel?: number;
  maxAccel?: number;
  quiet?: boolean;
  xMmPerPx?: number;
  yMmPerPx?: number;
  widthPx?: number;
  heightPx?: number;
};

export class PngcamOptions {
  safeZ: number;
  rapidFeed: number;
  xyFeed: number;
  zFeed: number;
  rpm: number;
  width: number;
  height: number;
  depth: number;
  rotary: boolean;
  direction: PngcamDirection;
  stepOver: number;
  stepDown: number;
  tool: PngcamTool;
  stockToLeave: number;
  roughingOnly: boolean;
  omitTop: boolean;
  omitBottom: boolean;
  rampEntry: boolean;
  cutBelowBottom: boolean;
  cutBeyondEdges: boolean;
  imperial: boolean;
  xOffset: number;
  yOffset: number;
  zOffset: number;
  maxVel: number;
  maxAccel: number;
  quiet: boolean;
  xMmPerPx: number;
  yMmPerPx: number;
  widthPx: number;
  heightPx: number;

  constructor(input: PngcamOptionsInput) {
    this.safeZ = finite(input.safeZ, 5);
    this.rapidFeed = finite(input.rapidFeed, 2500);
    this.xyFeed = finite(input.xyFeed, 800);
    this.zFeed = finite(input.zFeed, 200);
    this.rpm = finite(input.rpm, 12000);
    this.width = positive(input.width, 1);
    this.height = positive(input.height, 1);
    this.depth = positive(input.depth, 1);
    this.rotary = input.rotary === true;
    this.direction = input.direction ?? PngcamDirection.Horizontal;
    this.stepOver = positive(input.stepOver, 1);
    this.stepDown = positive(input.stepDown, 1);
    this.tool = input.tool;
    this.stockToLeave = finite(input.stockToLeave, 0);
    this.roughingOnly = input.roughingOnly === true;
    this.omitTop = input.omitTop === true;
    this.omitBottom = input.omitBottom === true;
    this.rampEntry = input.rampEntry === true;
    this.cutBelowBottom = input.cutBelowBottom === true;
    this.cutBeyondEdges = input.cutBeyondEdges === true;
    this.imperial = input.imperial === true;
    this.xOffset = finite(input.xOffset, 0);
    this.yOffset = finite(input.yOffset, 0);
    this.zOffset = finite(input.zOffset, 0);
    this.maxVel = positive(input.maxVel, this.rapidFeed);
    this.maxAccel = finite(input.maxAccel, 0);
    this.quiet = input.quiet !== false;
    this.widthPx = Math.max(1, Math.round(finite(input.widthPx, Math.ceil(this.width / this.stepOver) + 1)));
    this.heightPx = Math.max(1, Math.round(finite(input.heightPx, Math.ceil(this.height / this.stepOver) + 1)));
    this.xMmPerPx = positive(input.xMmPerPx, this.width / this.widthPx);
    this.yMmPerPx = positive(input.yMmPerPx, this.height / this.heightPx);
  }

  feedRate(start: PngcamToolpoint, end: PngcamToolpoint) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    let xyDist = Math.sqrt(dx * dx + dy * dy);
    const zDist = dz;

    if (this.rotary) {
      const highZ = Math.max(start.z, end.z);
      const arcLength = Math.PI * highZ * 2 * dy / 360.0;
      xyDist = Math.sqrt(arcLength * arcLength + dx * dx);
    }

    const totalDist = Math.sqrt(xyDist * xyDist + zDist * zDist);
    const epsilon = 0.00001;
    let unitsPerMin = this.rapidFeed;
    if (xyDist >= epsilon || zDist < 0) {
      if (zDist >= 0 || Math.abs(xyDist / zDist) > Math.abs(this.xyFeed / this.zFeed)) {
        unitsPerMin = this.xyFeed;
      } else {
        unitsPerMin = this.zFeed;
      }
    }

    if (this.rotary) {
      if (totalDist < epsilon) return this.rapidFeed;
      return unitsPerMin / totalDist;
    }
    return unitsPerMin;
  }

  mmToPx(x: number, y: number): [number, number] {
    const xPx = Math.trunc(x / this.xMmPerPx);
    let yPx = Math.trunc(-y / this.yMmPerPx) + this.heightPx - 1;
    if (this.rotary) yPx = mod(yPx, this.heightPx);
    return [xPx, yPx];
  }

  pxToMm(x: number, y: number): [number, number] {
    return [
      x * this.xMmPerPx,
      (this.heightPx - 1 - y) * this.yMmPerPx,
    ];
  }
}

export class PngcamBallEndMill implements PngcamTool {
  readonly toolRadius: number;

  constructor(radius: number) {
    this.toolRadius = positive(radius, 0.5);
  }

  radius() { return this.toolRadius; }

  heightAtRadius(r: number) { return this.heightAtRadiusSqr(r * r); }

  heightAtRadiusSqr(rSqr: number) {
    if (rSqr > this.toolRadius * this.toolRadius) return Infinity;
    return this.toolRadius - Math.sqrt(this.toolRadius * this.toolRadius - rSqr);
  }

  lengthToIntersection(xOffset: number, angle: number, z: number) {
    const radiusChange = this.toolRadius - Math.sqrt(this.toolRadius * this.toolRadius - xOffset * xOffset);
    const a = this.toolRadius - radiusChange;
    const b = z + this.toolRadius + radiusChange;
    const angleA = Math.abs(angle * Math.PI / 180.0);
    let angleB = Math.asin(b * Math.sin(angleA) / a);
    if (Number.isNaN(angleB)) return Number.NaN;
    angleB = Math.PI - angleB;
    const angleC = Math.PI - (angleB + angleA);
    return a * Math.sin(angleC) / Math.sin(angleA);
  }
}

export class PngcamFlatEndMill implements PngcamTool {
  readonly toolRadius: number;

  constructor(radius: number) {
    this.toolRadius = positive(radius, 0.5);
  }

  radius() { return this.toolRadius; }

  heightAtRadius(r: number) { return this.heightAtRadiusSqr(r * r); }

  heightAtRadiusSqr(rSqr: number) {
    if (rSqr > this.toolRadius * this.toolRadius) return Infinity;
    return 0;
  }

  lengthToIntersection(xOffset: number, angle: number, z: number) {
    const h = z / Math.cos(angle * Math.PI / 180.0);
    const yOffset = h * Math.sin(angle * Math.PI / 180.0);
    const rSqr = xOffset * xOffset + yOffset * yOffset;
    if (rSqr > this.toolRadius * this.toolRadius) return Number.NaN;
    return h;
  }
}

export class PngcamVBit implements PngcamTool {
  readonly toolRadius: number;
  readonly angle: number;

  constructor(radius: number, angle: number) {
    this.toolRadius = positive(radius, 0.5);
    this.angle = positive(angle, 90);
  }

  radius() { return this.toolRadius; }

  heightAtRadius(r: number) {
    if (r > this.toolRadius) return Infinity;
    return r / Math.tan((this.angle / 2) * Math.PI / 180);
  }

  heightAtRadiusSqr(rSqr: number) {
    return this.heightAtRadius(Math.sqrt(rSqr));
  }

  lengthToIntersection(_xOffset: number, _angle: number, _z: number) {
    return 0;
  }
}

export function newPngcamTool(tooltype: string, diameter: number): PngcamTool {
  const radius = positive(diameter, 1) / 2;
  if (tooltype === 'flat') return new PngcamFlatEndMill(radius);
  if (tooltype === 'ball') return new PngcamBallEndMill(radius);
  if (tooltype.startsWith('vbit')) return new PngcamVBit(radius, Number(tooltype.slice(4)));
  throw new Error(`unrecognised tool type: ${tooltype}`);
}

export class PngcamHeightmap {
  source: PngcamDepthSource;
  options: PngcamOptions;

  constructor(source: PngcamDepthSource, options: PngcamOptions) {
    this.source = source;
    this.options = options;
  }

  toToolpointsMap() {
    const map = new PngcamToolpointsMap(this.source.widthPx, this.source.heightPx, this.options, Number.NaN);
    map.hm = this;
    return map;
  }

  cutDepth(x: number, y: number) {
    const opt = this.options;
    const tool = opt.tool;
    const belowBottomDepth = -opt.depth - tool.radius() + opt.stockToLeave;
    let maxDepth = belowBottomDepth;
    const toolRadiusSqr = tool.radius() * tool.radius();

    if (opt.rotary) {
      for (let sy = -90.0; sy <= 90.0; sy += opt.yMmPerPx) {
        for (let sx = -tool.radius(); sx <= tool.radius(); sx += opt.xMmPerPx) {
          const workpieceZ = opt.depth + this.getDepth(x + sx, -1 - y + sy);
          const realY = workpieceZ * Math.sin(sy * Math.PI / 180.0);
          const realZ = workpieceZ * Math.cos(sy * Math.PI / 180.0);
          const rSqr = sx * sx + realY * realY;
          if (rSqr > toolRadiusSqr) continue;
          const d = opt.stockToLeave - tool.heightAtRadiusSqr(rSqr) + realZ;
          if (d > maxDepth) maxDepth = d;
        }
      }
    } else {
      for (let sy = -tool.radius(); sy <= tool.radius(); sy += opt.yMmPerPx) {
        for (let sx = -tool.radius(); sx <= tool.radius(); sx += opt.xMmPerPx) {
          const rSqr = sx * sx + sy * sy;
          if (rSqr > toolRadiusSqr) continue;
          if (!opt.cutBelowBottom || !this.isBottom(x + sx, y + sy)) {
            const d = opt.stockToLeave - tool.heightAtRadiusSqr(rSqr) + this.getDepth(x + sx, y + sy);
            if (d > maxDepth) maxDepth = d;
          }
        }
      }
    }

    return maxDepth;
  }

  getDepth(x: number, y: number) {
    return this.source.getDepth(x, y);
  }

  isBottom(x: number, y: number) {
    if (this.source.isBottom) return this.source.isBottom(x, y);
    return this.getDepth(x, y) < -this.options.depth + 0.00001;
  }
}

export class PngcamToolpointsMap {
  w: number;
  h: number;
  hm: PngcamHeightmap | null;
  height: number[];
  initialHeight: number;
  options: PngcamOptions;

  constructor(w: number, h: number, options: PngcamOptions, init: number) {
    this.w = w;
    this.h = h;
    this.hm = null;
    this.height = new Array(w * h).fill(init);
    this.options = options;
    this.initialHeight = init;
  }

  setMm(x: number, y: number, z: number) {
    const [px, py] = this.options.mmToPx(x, y);
    this.setPx(px, py, z);
  }

  getMm(x: number, y: number) {
    const [px, py] = this.options.mmToPx(x, y);
    return this.getPx(px, py);
  }

  setPx(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.height[y * this.w + x] = z;
  }

  getPx(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      if (!this.hm) return -Infinity;
      return this.hm.cutDepth(...this.options.pxToMm(x, y));
    }
    const n = y * this.w + x;
    if (Number.isNaN(this.height[n]) && this.hm) {
      this.height[n] = this.hm.cutDepth(...this.options.pxToMm(x, y));
    }
    return this.height[n];
  }

  plotPixelMm(x: number, y: number, z: number) {
    const [px, py] = this.options.mmToPx(x, y);
    this.plotPixelPx(px, py, z);
  }

  plotPixelPx(px: number, py: number, z: number) {
    const curZ = this.getPx(px, py);
    if (Number.isNaN(curZ) || z < curZ) this.setPx(px, py, z);
  }

  plotToolShape(x: number, y: number, z: number) {
    const opt = this.options;
    const tool = opt.tool;
    const [xPx, yPx] = opt.mmToPx(x, y);
    const r = tool.radius();
    const rPxX = Math.trunc(r / opt.xMmPerPx) + 1;
    let rPxY = Math.trunc(r / opt.yMmPerPx) + 1;
    if (opt.rotary) rPxY = Math.trunc(90.0 / opt.yMmPerPx) + 1;
    const toolRadiusSqr = r * r;

    if (opt.rotary) {
      for (let sy = -rPxY; sy <= rPxY; sy += 1) {
        for (let sx = -rPxX; sx <= rPxX; sx += 1) {
          const sxMm = sx * opt.xMmPerPx;
          const syDeg = sy * opt.yMmPerPx;
          const height = tool.lengthToIntersection(sxMm, syDeg, z);
          this.plotPixelPx(xPx + sx, yPx + sy, height - opt.depth);
        }
      }
    } else {
      for (let sy = -rPxY; sy <= rPxY; sy += 1) {
        for (let sx = -rPxX; sx <= rPxX; sx += 1) {
          const sxMm = sx * opt.xMmPerPx;
          const syMm = sy * opt.yMmPerPx;
          const rSqr = sxMm * sxMm + syMm * syMm;
          if (rSqr > toolRadiusSqr) continue;
          this.plotPixelPx(xPx + sx, yPx + sy, z + tool.heightAtRadiusSqr(rSqr));
        }
      }
    }
  }

  plotLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const xyDist = Math.sqrt(dx * dx + dy * dy);
    if (xyDist <= 0.00001) {
      this.plotPixelMm(x1, y1, z1);
      return;
    }
    const xStep = dx / xyDist;
    const yStep = dy / xyDist;
    const zStep = dz / xyDist;
    for (let k = 0.0; k <= xyDist; k += this.options.xMmPerPx) {
      this.plotPixelMm(x1 + xStep * k, y1 + yStep * k, z1 + zStep * k);
    }
  }

  plotToolpathSegment(seg: PngcamToolpathSegment) {
    if (seg.points.length === 0) return;
    if (seg.points.length === 1) {
      const p = seg.points[0];
      this.plotLine(p.x, p.y, p.z, p.x, p.y, p.z);
      return;
    }
    for (let i = 1; i < seg.points.length; i += 1) {
      const a = seg.points[i - 1];
      const b = seg.points[i];
      this.plotLine(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  plotToolpath(tp: PngcamToolpath) {
    for (const seg of tp.segments) this.plotToolpathSegment(seg);
  }
}

export type PngcamToolpoint = {
  x: number;
  y: number;
  z: number;
  feed: PngcamFeedType;
};

export class PngcamToolpathSegment {
  points: PngcamToolpoint[];

  constructor() {
    this.points = [];
  }

  append(t: PngcamToolpoint) {
    this.points.push(t);
  }

  appendSegment(more: PngcamToolpathSegment) {
    for (const point of more.points) this.append(point);
  }

  simplified() {
    const newseg = new PngcamToolpathSegment();
    if (this.points.length === 0) return newseg;
    newseg.append(this.points[0]);
    if (this.points.length === 1) return newseg;

    const epsilon = 0.00001;
    let prev = this.points[1];
    for (let i = 2; i < this.points.length; i += 1) {
      const first = newseg.points[newseg.points.length - 1];
      const cur = this.points[i];
      const prevXY = Math.atan2(prev.y - first.y, prev.x - first.x);
      const curXY = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      const prevXZ = Math.atan2(prev.z - first.z, prev.x - first.x);
      const curXZ = Math.atan2(cur.z - prev.z, cur.x - prev.x);
      const prevYZ = Math.atan2(prev.z - first.z, prev.y - first.y);
      const curYZ = Math.atan2(cur.z - prev.z, cur.y - prev.y);
      if (
        Math.abs(curXY - prevXY) > epsilon
        || Math.abs(curXZ - prevXZ) > epsilon
        || Math.abs(curYZ - prevYZ) > epsilon
      ) {
        newseg.append(prev);
      }
      prev = cur;
    }
    newseg.append(prev);
    return newseg;
  }

  reversed() {
    const newseg = new PngcamToolpathSegment();
    for (let i = this.points.length - 1; i >= 0; i -= 1) newseg.points.push(this.points[i]);
    return newseg;
  }

  toGcode(opt: PngcamOptions) {
    const yAxisName = opt.rotary ? 'A' : 'Y';
    let gcode = '';
    for (let i = 0; i < this.points.length; i += 1) {
      const p = this.points[i];
      let feedRate = opt.rapidFeed;
      if (p.feed === PngcamFeedType.CuttingFeed && i > 0) feedRate = opt.feedRate(this.points[i - 1], p);
      if (feedRate === opt.rapidFeed && opt.rotary) gcode += 'G94\n';
      gcode += `G1 X${format4(p.x + opt.xOffset)} ${yAxisName}${format4(p.y + opt.yOffset)} Z${format4(p.z + opt.zOffset)} F${formatG(feedRate)}\n`;
      if (feedRate === opt.rapidFeed && opt.rotary) gcode += 'G93\n';
    }
    return gcode;
  }

  omitTopAndBottom(opt: PngcamOptions) {
    const tp = new PngcamToolpath();
    let newseg = new PngcamToolpathSegment();
    const epsilon = 0.01;
    for (const point of this.points) {
      let omit = false;
      if (opt.omitTop && point.z > -epsilon) omit = true;
      if (opt.omitBottom && point.z < -opt.depth + epsilon) omit = true;
      if (omit) {
        tp.append(newseg);
        newseg = new PngcamToolpathSegment();
      } else {
        newseg.append(point);
      }
    }
    tp.append(newseg);
    return tp;
  }

  rampEntry() {
    if (this.points.length <= 2) return this;
    const newseg = new PngcamToolpathSegment();
    const maxPlungeAngle = 30 * Math.PI / 180;
    const minRampDistance = 0.01;
    for (let i = 1; i < this.points.length - 1; i += 1) {
      const last = this.points[i - 1];
      const p = this.points[i];
      const next = this.points[i + 1];
      if (p.feed === PngcamFeedType.RapidFeed) {
        newseg.append(p);
        continue;
      }
      const dxLast = p.x - last.x;
      const dyLast = p.y - last.y;
      const dzLast = p.z - last.z;
      const dxyLast = Math.sqrt(dxLast * dxLast + dyLast * dyLast);
      const plungeAngle = Math.atan2(-dzLast, dxyLast);
      if (plungeAngle < maxPlungeAngle) {
        newseg.append(p);
        continue;
      }
      const dxNext = next.x - p.x;
      const dyNext = next.y - p.y;
      const dzNext = next.z - p.z;
      const dxyNext = Math.sqrt(dxNext * dxNext + dyNext * dyNext);
      if (dxyNext < minRampDistance) {
        newseg.append(p);
        continue;
      }
      const availableRampAngle = Math.atan2(dzNext, dxyNext);
      const impliedAvailableRampAngle = Math.atan2(-dzLast / 2, dxyNext);
      let rampAngle = maxPlungeAngle;
      if (availableRampAngle > rampAngle) rampAngle = availableRampAngle;
      if (impliedAvailableRampAngle > rampAngle) rampAngle = impliedAvailableRampAngle;
      const dxyRamp = -(dzLast / 2) / Math.tan(rampAngle);
      const k = dxyRamp / dxyNext;
      const dxRamp = k * dxNext;
      const dyRamp = k * dyNext;
      const plungeAngle2 = Math.atan2(-dzLast / 2, Math.abs(dxyRamp) - dxyLast);
      if (plungeAngle2 > plungeAngle) {
        newseg.append(p);
        continue;
      }
      newseg.append({ x: last.x + dxRamp, y: last.y + dyRamp, z: p.z - dzLast / 2, feed: PngcamFeedType.CuttingFeed });
      newseg.append(p);
    }
    newseg.append(this.points[this.points.length - 1]);
    return newseg;
  }

  cycleTime(opt: PngcamOptions) {
    let cycleTime = 0.0;
    for (let i = 1; i < this.points.length; i += 1) {
      const a = this.points[i - 1];
      const b = this.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let feedRate = opt.rapidFeed;
      if (b.feed === PngcamFeedType.CuttingFeed) feedRate = opt.feedRate(a, b);
      if (feedRate > opt.maxVel) feedRate = opt.maxVel;
      if (feedRate !== opt.rapidFeed && opt.rotary) {
        cycleTime += 60 / feedRate;
      } else {
        cycleTime += 60 * (dist / feedRate);
      }
    }
    return cycleTime;
  }
}

export class PngcamToolpath {
  segments: PngcamToolpathSegment[];

  constructor() {
    this.segments = [];
  }

  append(seg: PngcamToolpathSegment) {
    this.segments.push(seg);
  }

  appendToolpath(more: PngcamToolpath) {
    for (const segment of more.segments) this.append(segment);
  }

  simplified() {
    const out = new PngcamToolpath();
    for (const segment of this.segments) out.append(segment.simplified());
    return out;
  }

  rampEntry(opt: PngcamOptions) {
    const out = new PngcamToolpath();
    out.append(this.asOneSegment(opt).rampEntry());
    return out;
  }

  sorted() {
    const out = new PngcamToolpath();
    const needsegs = new Map<number, PngcamToolpathSegment>();
    let last: PngcamToolpoint = { x: 0, y: 0, z: 0, feed: PngcamFeedType.RapidFeed };
    let gotFirstPoint = false;
    for (let i = 0; i < this.segments.length; i += 1) {
      const seg = this.segments[i];
      if (!seg.points.length) continue;
      if (!gotFirstPoint) {
        last = seg.points[0];
        gotFirstPoint = true;
      }
      needsegs.set(i, seg);
    }
    while (needsegs.size > 0) {
      let minDist = Infinity;
      let minIdx = 0;
      let minReversed = false;
      for (const [i, seg] of needsegs.entries()) {
        const first = seg.points[0];
        let dist = distance(first, last);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
          minReversed = false;
        }
        const lastPoint = seg.points[seg.points.length - 1];
        dist = distance(lastPoint, last);
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
          minReversed = true;
        }
      }
      const minSeg = needsegs.get(minIdx);
      if (!minSeg) break;
      if (minReversed) {
        last = minSeg.points[0];
        out.append(minSeg.reversed());
      } else {
        last = minSeg.points[minSeg.points.length - 1];
        out.append(minSeg);
      }
      needsegs.delete(minIdx);
    }
    return out;
  }

  asOneSegment(opt: PngcamOptions) {
    const seg = new PngcamToolpathSegment();
    if (this.segments.length === 0) return seg;
    for (const source of this.segments) {
      if (!source.points.length) continue;
      const p0 = source.points[0];
      const pLast = source.points[source.points.length - 1];
      seg.append({ x: p0.x, y: p0.y, z: opt.safeZ, feed: PngcamFeedType.RapidFeed });
      if (p0.z + opt.stepDown < opt.safeZ) {
        seg.append({ x: p0.x, y: p0.y, z: p0.z + opt.stepDown, feed: PngcamFeedType.RapidFeed });
      }
      seg.appendSegment(source);
      seg.append({ x: pLast.x, y: pLast.y, z: opt.safeZ, feed: PngcamFeedType.RapidFeed });
    }
    return seg;
  }

  rapidPath(a: PngcamToolpoint, b: PngcamToolpoint, opt: PngcamOptions) {
    const seg = new PngcamToolpathSegment();
    seg.append({ x: a.x, y: a.y, z: opt.safeZ, feed: PngcamFeedType.RapidFeed });
    seg.append({ x: b.x, y: b.y, z: opt.safeZ, feed: PngcamFeedType.RapidFeed });
    if (b.z + opt.stepDown < opt.safeZ) {
      seg.append({ x: b.x, y: b.y, z: b.z + opt.stepDown, feed: PngcamFeedType.RapidFeed });
    }
    return seg;
  }

  toGcode(opt: PngcamOptions) {
    return this.asOneSegment(opt).toGcode(opt);
  }

  cycleTime(opt: PngcamOptions) {
    return this.asOneSegment(opt).cycleTime(opt);
  }
}

export class PngcamJob {
  options: PngcamOptions;
  toolpoints: PngcamToolpointsMap;
  readStock: PngcamToolpointsMap | null;
  writeStock: PngcamToolpointsMap | null;
  mainToolpath: PngcamToolpath;

  constructor(options: PngcamOptions, heightmap: PngcamHeightmap, readStock: PngcamToolpointsMap | null = null) {
    this.options = options;
    this.toolpoints = heightmap.toToolpointsMap();
    this.readStock = readStock;
    this.writeStock = null;
    this.mainToolpath = new PngcamToolpath();
    this.makeToolpath();
  }

  makeToolpath() {
    this.mainToolpath = new PngcamToolpath();
    const opt = this.options;
    let xLimit = opt.width;
    let yLimit = opt.height;
    let xStep = opt.xMmPerPx;
    let yStep = 0.0;
    if (opt.direction === PngcamDirection.Vertical) {
      xStep = 0.0;
      yStep = opt.yMmPerPx;
    } else if (opt.direction === PngcamDirection.Helical) {
      xStep = opt.stepOver / opt.heightPx;
      yStep = opt.yMmPerPx;
    }

    let zero = 0.0;
    if (opt.cutBeyondEdges) {
      const extraLimit = opt.tool.radius();
      zero -= extraLimit;
      xLimit += extraLimit;
      yLimit += extraLimit;
    }

    let x = zero;
    let y = zero;
    while (x >= zero && y >= zero && x < xLimit && y < yLimit) {
      const seg = new PngcamToolpathSegment();
      while (x >= zero && y >= zero && x < xLimit && (y < yLimit || opt.direction === PngcamDirection.Helical)) {
        seg.append({ x, y, z: this.toolpoints.getMm(x, y), feed: PngcamFeedType.CuttingFeed });
        x += xStep;
        y += yStep;
      }
      if (opt.omitTop || opt.omitBottom) {
        this.mainToolpath.appendToolpath(seg.omitTopAndBottom(opt).simplified());
      } else {
        this.mainToolpath.append(seg.simplified());
      }
      if (opt.direction === PngcamDirection.Horizontal) {
        y += opt.stepOver;
      } else if (opt.direction === PngcamDirection.Vertical) {
        x += opt.stepOver;
      } else if (opt.direction === PngcamDirection.Helical) {
        break;
      } else {
        throw new Error('unimplemented direction');
      }
      xStep = -xStep;
      yStep = -yStep;
      x += xStep;
      y += yStep;
    }
  }

  programToolpath() {
    const path = this.roughing();
    if (!this.options.roughingOnly) path.appendToolpath(this.finishing());
    return this.options.rampEntry ? path.rampEntry(this.options) : path;
  }

  gcode() {
    const path = this.programToolpath();
    return this.preamble() + path.toGcode(this.options) + this.postamble();
  }

  preamble() {
    let gcode = this.options.imperial ? 'G20\n' : 'G21\n';
    gcode += 'G90\n';
    gcode += 'G54\n';
    if (this.options.rotary) gcode += 'G93\n';
    gcode += `M3 S${formatG(this.options.rpm)}\n`;
    gcode += `G0 Z${format4(this.options.safeZ + this.options.zOffset)}\n`;
    if (this.options.rotary) gcode += 'G0 Y0\n';
    return gcode;
  }

  postamble() {
    return 'M5\nM2\n';
  }

  finishing() {
    return this.combineSegments(this.mainToolpath.simplified().sorted());
  }

  roughing() {
    const opt = this.options;
    let deepest = -opt.depth;
    if (opt.cutBelowBottom) deepest -= opt.tool.radius();
    const path = new PngcamToolpath();
    if (opt.rotary) {
      for (let z = opt.depth - opt.stepDown; z > 0; z -= opt.stepDown) {
        path.appendToolpath(this.roughingLevel(z).simplified().sorted());
      }
    } else {
      for (let z = -opt.stepDown; z > deepest; z -= opt.stepDown) {
        path.appendToolpath(this.roughingLevel(z).simplified().sorted());
      }
    }
    return path;
  }

  roughingLevel(z: number) {
    const path = new PngcamToolpath();
    for (const source of this.mainToolpath.segments) {
      let seg = new PngcamToolpathSegment();
      for (const tp of source.points) {
        if (tp.z < z && (!this.readStock || z < this.readStock.getMm(tp.x, tp.y))) {
          seg.append({ x: tp.x, y: tp.y, z, feed: PngcamFeedType.CuttingFeed });
        } else {
          if (seg.points.length > 0) path.append(seg);
          seg = new PngcamToolpathSegment();
        }
      }
      if (seg.points.length > 0) path.append(seg);
    }
    return this.combineSegments(path.sorted());
  }

  combineSegments(tp: PngcamToolpath) {
    const opt = this.options;
    if (tp.segments.length <= 1) return tp;
    const out = new PngcamToolpath();
    let seg = tp.segments[0];
    for (let i = 1; i < tp.segments.length; i += 1) {
      const prev = seg.points[seg.points.length - 1];
      const cur = tp.segments[i].points[0];
      const rapidPath = tp.rapidPath(prev, cur, opt);
      const deepestZ = Math.min(prev.z, cur.z);
      let cutPath = this.cutPath(prev, cur, deepestZ);
      const xCur = { x: cur.x, y: prev.y, z: Math.max(deepestZ, this.toolpoints.getMm(cur.x, prev.y)), feed: PngcamFeedType.CuttingFeed };
      const yCur = { x: prev.x, y: cur.y, z: Math.max(deepestZ, this.toolpoints.getMm(prev.x, cur.y)), feed: PngcamFeedType.CuttingFeed };
      const xYCutPath = this.cutPath(prev, xCur, deepestZ);
      xYCutPath.appendSegment(this.cutPath(xCur, cur, deepestZ));
      const yXCutPath = this.cutPath(prev, yCur, deepestZ);
      yXCutPath.appendSegment(this.cutPath(yCur, cur, deepestZ));
      if (xYCutPath.cycleTime(opt) < cutPath.cycleTime(opt)) cutPath = xYCutPath;
      if (yXCutPath.cycleTime(opt) < cutPath.cycleTime(opt)) cutPath = yXCutPath;
      if (cutPath.cycleTime(opt) < 10 * rapidPath.cycleTime(opt)) {
        seg.appendSegment(cutPath);
      } else {
        out.append(seg);
        seg = new PngcamToolpathSegment();
      }
      seg.appendSegment(tp.segments[i]);
    }
    if (seg.points.length > 0) out.append(seg);
    return out;
  }

  cutPath(a: PngcamToolpoint, b: PngcamToolpoint, deepestZ: number) {
    const dxTotal = b.x - a.x;
    const dyTotal = b.y - a.y;
    const dist = Math.sqrt(dxTotal * dxTotal + dyTotal * dyTotal);
    const seg = new PngcamToolpathSegment();
    if (dist <= 0.00001) {
      seg.append(b);
      return seg;
    }

    const r1 = this.options.tool.radius();
    const r2 = this.options.stepOver / 2;
    const deviation = r1 - Math.sqrt(Math.max(0, r1 * r1 - r2 * r2));
    const dx = dxTotal / dist;
    const dy = dyTotal / dist;
    for (let k = 0.0; k <= dist; k += this.options.xMmPerPx) {
      const x = a.x + k * dx;
      const y = a.y + k * dy;
      let z = this.toolpoints.getMm(x, y);
      if (z < deepestZ) z = deepestZ;
      seg.append({ x, y, z: z + deviation, feed: PngcamFeedType.CuttingFeed });
    }
    seg.append(b);
    return seg;
  }
}

function finite(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function positive(value: unknown, fallback: number) {
  return Math.max(0.00001, Math.abs(finite(value, fallback)));
}

function mod(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function distance(a: PngcamToolpoint, b: PngcamToolpoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function format4(value: number) {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

function formatG(value: number) {
  const rounded = Math.round(value * 100000) / 100000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
