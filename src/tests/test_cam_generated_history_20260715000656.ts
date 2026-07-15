import { PartHistory } from '../PartHistory.js';
import { buildSliceShadowLoops } from '../cam/RoughingEntity.js';
import { DropCutterIndex } from '../cam/SurfacingEntity.js';
import {
  extractTrianglesFromSolid,
  mergeOuterOffsetLoops,
  offsetPolygon,
  pointInPolygon,
  triangleBounds,
  type CamPoint2,
  type ShadowLoop,
  type Triangle,
} from '../cam/ShadowCutterEntity.js';

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

// Exact first six features from test_generated_history_20260715000656. The JSON
// is compressed only to keep this generated-history regression reviewable.
const SERIALIZED_HISTORY_GZIP_BASE64 = [
  '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',
].join('');

async function decodeSerializedHistory() {
  const compressed = Uint8Array.from(
    atob(SERIALIZED_HISTORY_GZIP_BASE64),
    (character) => character.charCodeAt(0),
  );
  const decompressed = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressed).text();
}

function collectSceneTriangles(partHistory: PartHistory): Triangle[] {
  return (partHistory.scene?.children || [])
    .filter((child: any) => child?.type === 'SOLID')
    .flatMap((solid: any) => extractTrianglesFromSolid(solid));
}

function pointInsideProtectedLoops(point: CamPoint2, loops: ShadowLoop[]) {
  const insideOuter = loops.some((loop) => loop.role === 'outer' && pointInPolygon(point, loop.points));
  const insideHole = loops.some((loop) => loop.role === 'hole' && pointInPolygon(point, loop.points));
  return insideOuter && !insideHole;
}

function findUnsafeRoughingLink(path: any, triangles: Triangle[]) {
  const bounds = triangleBounds(triangles);
  const toolRadius = Number(path.cutter?.diameter || 0) * 0.5;
  if (!bounds || !(toolRadius > 0)) return { reason: 'missing roughing collision geometry' };

  const protectedLoopsByZ = new Map<number, ShadowLoop[]>();
  const protectedLoopsAtZ = (z: number) => {
    const key = Math.round(z * 10000) / 10000;
    const cached = protectedLoopsByZ.get(key);
    if (cached) return cached;

    const shadow = buildSliceShadowLoops(triangles, {
      index: 0,
      bottomZ: z + 0.0001,
      topZ: bounds.max[2],
    });
    // Ignore a small boundary band so this test detects real incursions rather
    // than polygon-offset rounding at an intended tangent contact.
    const collisionRadius = Math.max(0, toolRadius - 0.05);
    const offsetLoops = shadow.flatMap((loop) => {
      const distance = loop.role === 'hole' ? -collisionRadius : collisionRadius;
      return offsetPolygon(loop.points, distance)
        .map((points) => ({ role: loop.role, points }) as ShadowLoop);
    });
    const merged = mergeOuterOffsetLoops(offsetLoops);
    protectedLoopsByZ.set(key, merged);
    return merged;
  };

  for (const segment of path.segments || []) {
    if (segment.kind !== 'link') continue;
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    if (!start || !end) continue;
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const steps = Math.max(2, Math.ceil(distance / 0.1));
    const protectedLoops = protectedLoopsAtZ(start[2]);
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      const point: CamPoint2 = [
        start[0] + ((end[0] - start[0]) * t),
        start[1] + ((end[1] - start[1]) * t),
      ];
      if (pointInsideProtectedLoops(point, protectedLoops)) {
        return { start, end, point, metadata: segment.metadata };
      }
    }
  }
  return null;
}

function findUnsafeSurfacingSegment(path: any, triangles: Triangle[]) {
  const toolRadius = Number(path.cutter?.diameter || 0) * 0.5;
  if (!(toolRadius > 0)) return { reason: 'missing surfacing cutter radius' };
  const dropCutter = new DropCutterIndex(triangles, toolRadius);

  for (const segment of path.segments || []) {
    const start = path.points[segment.startIndex]?.position;
    const end = path.points[segment.endIndex]?.position;
    if (!start || !end) continue;
    const distance = Math.hypot(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    );
    const steps = Math.max(1, Math.ceil(distance / 0.05));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = [
        start[0] + ((end[0] - start[0]) * t),
        start[1] + ((end[1] - start[1]) * t),
        start[2] + ((end[2] - start[2]) * t),
      ];
      const centerZ = dropCutter.centerZ(point[0], point[1]);
      const requiredTipZ = centerZ === null ? -Infinity : centerZ - toolRadius;
      if (point[2] < requiredTipZ - 0.001) {
        return {
          kind: segment.kind,
          penetration: requiredTipZ - point[2],
          point,
          start,
          end,
          metadata: segment.metadata,
        };
      }
    }
  }
  return null;
}

export async function test_generated_history_20260715000656(
  partHistory: PartHistory = new PartHistory(),
) {
  await partHistory.reset();
  await partHistory.fromJSON(await decodeSerializedHistory());

  const feature7 = await partHistory.newFeature('XFORM');
  Object.assign(feature7.inputParams, {
    id: 'XFORM10',
    solids: ['E2'],
    space: 'WORLD',
    pivot: 'ORIGIN',
    translate: [0, 0, 0],
    rotateEulerDeg: ['90', '0', '0'],
    scale: ['1', '1', '1'],
    copy: false,
  });

  partHistory.camPlanManager.loadSerializable({
    operations: [
      {
        type: 'roughing',
        inputParams: {
          id: 'RG1',
        },
      },
      {
        type: 'surfacing',
        inputParams: {
          id: 'SF2',
          targetFaces: [
            'E4:S3:G19_SW',
            'E4:S3:G16_SW',
            'E4:S3:G20_SW',
            'E2:S1:G2_SW',
          ],
        },
      },
    ],
    machineProfile: {
      name: 'Generic 3 Axis Mill',
      controller: 'grbl',
      units: 'mm',
      maxSpindleRPM: 24000,
      defaultRapidRate: 2500,
      safeParkZ: 15,
      tokenSpacer: true,
      stripComments: false,
      header: '',
      footer: '',
    },
    stockProfile: {
      mode: 'auto',
      margin: 6.35,
      sizeX: null,
      sizeY: null,
      sizeZ: null,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    },
  });

  await partHistory.runHistory({ throwOnFeatureError: true });
  const program = partHistory.camPlanManager.generateAll({
    partHistory,
    scene: partHistory.scene,
  } as any);
  const roughingPath = program.paths.find((path) => path.operationId === 'RG1');
  const surfacingPath = program.paths.find((path) => path.operationId === 'SF2');
  assert(program.paths.length === 2, 'Generated bracket history should produce both CAM paths');
  assert(program.warnings.length === 0, 'Generated bracket history should produce CAM paths without warnings');
  assert(roughingPath, 'Generated bracket history should produce its Roughing path');
  assert(surfacingPath, 'Generated bracket history should produce its Surfacing path');

  const triangles = collectSceneTriangles(partHistory);
  assert(triangles.length > 0, 'Generated bracket history should retain collision geometry');
  const unsafeRoughingLink = findUnsafeRoughingLink(roughingPath, triangles);
  assert(
    !unsafeRoughingLink,
    'Roughing feed link crosses retained material: ' + JSON.stringify(unsafeRoughingLink),
  );
  const unsafeSurfacingSegment = findUnsafeSurfacingSegment(surfacingPath, triangles);
  assert(
    !unsafeSurfacingSegment,
    'Surfacing cutter crosses retained material: ' + JSON.stringify(unsafeSurfacingSegment),
  );

  return partHistory;
}
