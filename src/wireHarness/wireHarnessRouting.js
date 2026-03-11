import { BREP } from '../BREP/BREP.js';
import { extractPortRuntimeData } from '../features/port/portUtils.js';
import {
  buildHermitePolyline,
  createResolvedSplineData,
  DEFAULT_RESOLUTION,
  normalizeSplineData,
} from '../features/spline/splineUtils.js';
import { abSegmentsToDigraph, pointToNode } from './pathFinderLogic/js/sided_ab_graphs/digraph_ab_builder.js';
import {
  findShortestPathForAllPairsAsync,
  simpleArrayToPointPairs,
} from './pathFinderLogic/js/sided_ab_graphs/digraph_ab_pairs_analyser.js';

const THREE = BREP.THREE;

function normalizeText(value, fallback = '') {
  const next = String(value == null ? '' : value).trim();
  return next || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizePortSide(side, _kind = 'termination') {
  return String(side || '').trim().toUpperCase() === 'B' ? 'B' : 'A';
}

function otherSide(side) {
  return String(side || '').trim().toUpperCase() === 'B' ? 'A' : 'B';
}

function getPortLabel(portData, fallback = '') {
  return normalizeText(
    portData?.linkName || portData?.displayName || portData?.name || portData?.objectName,
    fallback,
  );
}

function getPortPointId(portData, fallback = '') {
  return normalizeText(portData?.objectName, fallback);
}

function getPortRuntimeByRef(partHistory, portRef) {
  const ref = normalizeText(portRef, '');
  if (!ref || !partHistory?.getObjectByName) return null;
  return extractPortRuntimeData(partHistory.getObjectByName(ref));
}

function createRotationArrayFromDirection(directionArray) {
  const xAxis = new THREE.Vector3(
    normalizeNumber(directionArray?.[0], 1),
    normalizeNumber(directionArray?.[1], 0),
    normalizeNumber(directionArray?.[2], 0),
  );
  if (xAxis.lengthSq() <= 1e-12) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const upHint = Math.abs(xAxis.dot(new THREE.Vector3(0, 0, 1))) > 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);
  let yAxis = new THREE.Vector3().crossVectors(upHint, xAxis).normalize();
  if (yAxis.lengthSq() <= 1e-12) yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)).elements.slice();
}

function dedupePolyline(points, tolerance = 1e-6) {
  const out = [];
  const toleranceSq = tolerance * tolerance;
  for (const point of Array.isArray(points) ? points : []) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const next = [
      normalizeNumber(point[0], 0),
      normalizeNumber(point[1], 0),
      normalizeNumber(point[2], 0),
    ];
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(next);
      continue;
    }
    const dx = prev[0] - next[0];
    const dy = prev[1] - next[1];
    const dz = prev[2] - next[2];
    if ((dx * dx) + (dy * dy) + (dz * dz) > toleranceSq) out.push(next);
  }
  return out;
}

function polylineLength(polyline) {
  let total = 0;
  const points = Array.isArray(polyline) ? polyline : [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const dx = normalizeNumber(b[0], 0) - normalizeNumber(a[0], 0);
    const dy = normalizeNumber(b[1], 0) - normalizeNumber(a[1], 0);
    const dz = normalizeNumber(b[2], 0) - normalizeNumber(a[2], 0);
    total += Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  }
  return total;
}

function reversePolyline(polyline) {
  return dedupePolyline((Array.isArray(polyline) ? polyline : []).slice().reverse());
}

function collectPortRuntimes(partHistory) {
  const scene = partHistory?.scene || null;
  const ports = [];
  const seen = new Set();
  scene?.traverse?.((object) => {
    if (!object?.userData?.isPortRoot) return;
    const key = normalizeText(object.name, '');
    if (!key || seen.has(key)) return;
    const runtime = extractPortRuntimeData(object);
    if (!runtime) return;
    seen.add(key);
    ports.push({
      ...runtime,
      ref: key,
      pointId: getPortPointId(runtime, key),
      label: getPortLabel(runtime, key),
    });
  });
  return ports;
}

function resolveSplineForPorts(partHistory, spline) {
  return createResolvedSplineData(spline, (attachment) => {
    const portData = getPortRuntimeByRef(partHistory, attachment?.portRef);
    if (!portData) return null;
    const baseDirection = Array.isArray(portData.direction) ? portData.direction.slice(0, 3) : [1, 0, 0];
    const side = normalizePortSide(attachment?.side, portData.kind);
    const direction = side === 'B'
      ? [-baseDirection[0], -baseDirection[1], -baseDirection[2]]
      : baseDirection;
    return {
      position: portData.point,
      rotation: createRotationArrayFromDirection(direction),
      extension: portData.extension,
      portName: portData.name,
      portKind: portData.kind,
      componentInstanceName: portData.componentInstanceName || '',
      displayName: portData.linkName || portData.name || '',
    };
  });
}

function buildSplineSegmentRecord(partHistory, feature, portsByRef) {
  const spline = normalizeSplineData(feature?.persistentData?.spline || null);
  const points = Array.isArray(spline?.points) ? spline.points : [];
  if (points.length < 2) return null;

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const firstAttachment = firstPoint?.attachment || null;
  const lastAttachment = lastPoint?.attachment || null;
  const firstRef = normalizeText(firstAttachment?.portRef, '');
  const lastRef = normalizeText(lastAttachment?.portRef, '');
  if (!firstRef || !lastRef || firstRef === lastRef) return null;

  const firstPort = portsByRef.get(firstRef) || getPortRuntimeByRef(partHistory, firstRef);
  const lastPort = portsByRef.get(lastRef) || getPortRuntimeByRef(partHistory, lastRef);
  if (!firstPort || !lastPort) return null;

  const resolution = Math.max(4, normalizeNumber(feature?.inputParams?.curveResolution, DEFAULT_RESOLUTION));
  const bendRadius = Math.max(0.1, Math.min(5.0, normalizeNumber(feature?.inputParams?.bendRadius, 1.0)));
  const resolvedSpline = resolveSplineForPorts(partHistory, spline);
  const { polyline } = buildHermitePolyline(resolvedSpline, resolution, bendRadius);
  const cleanedPolyline = dedupePolyline(polyline);
  if (cleanedPolyline.length < 2) return null;

  const segmentId = normalizeText(
    feature?.inputParams?.featureID || feature?.inputParams?.id || feature?.id,
    `Spline:${Math.random().toString(36).slice(2, 8)}`,
  );

  return {
    id: segmentId,
    featureId: segmentId,
    firstPoint: getPortPointId(firstPort, firstRef),
    firstSide: normalizePortSide(firstAttachment?.side, firstPort.kind),
    secondPoint: getPortPointId(lastPort, lastRef),
    secondSide: normalizePortSide(lastAttachment?.side, lastPort.kind),
    firstPortRef: firstRef,
    secondPortRef: lastRef,
    firstLabel: getPortLabel(firstPort, firstRef),
    secondLabel: getPortLabel(lastPort, lastRef),
    weight: Math.max(polylineLength(cleanedPolyline), 1e-6),
    polyline: cleanedPolyline,
  };
}

export function listWireHarnessPorts(partHistory) {
  return collectPortRuntimes(partHistory);
}

export function listWireHarnessTerminationEndpoints(partHistory) {
  return collectPortRuntimes(partHistory)
    .filter((port) => String(port?.kind || '').trim().toLowerCase() !== 'waypoint')
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

export function buildWireHarnessNetwork(partHistory) {
  const allPorts = collectPortRuntimes(partHistory);
  const portsByRef = new Map();
  const portsByLabel = new Map();
  for (const port of allPorts) {
    const ref = normalizeText(port?.ref, '');
    const label = normalizeText(port?.label, ref);
    if (ref) portsByRef.set(ref, port);
    if (label && !portsByLabel.has(label)) portsByLabel.set(label, []);
    if (label) portsByLabel.get(label).push(port);
  }

  const features = Array.isArray(partHistory?.features) ? partHistory.features : [];
  const splineSegments = [];
  for (const feature of features) {
    if (String(feature?.type || '').trim().toUpperCase() !== 'SP') continue;
    const segment = buildSplineSegmentRecord(partHistory, feature, portsByRef);
    if (segment) splineSegments.push(segment);
  }

  return {
    ports: allPorts,
    portsByRef,
    portsByLabel,
    splineSegments,
  };
}

function resolveConnectionEndpoint(network, label) {
  const target = normalizeText(label, '');
  if (!target) {
    return { ok: false, error: 'Missing endpoint.' };
  }
  const matches = network?.portsByLabel?.get?.(target) || [];
  if (!Array.isArray(matches) || matches.length === 0) {
    return { ok: false, error: `Port "${target}" not found.` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `Port "${target}" is ambiguous.` };
  }
  const match = matches[0];
  return {
    ok: true,
    port: match,
    pointId: getPortPointId(match, match?.ref || target),
  };
}

function resolveSegmentDirection(segment, startNode, endNode) {
  const forwardStart = pointToNode(segment.firstPoint, otherSide(segment.firstSide));
  const forwardEnd = pointToNode(segment.secondPoint, segment.secondSide);
  if (startNode === forwardStart && endNode === forwardEnd) return 1;

  const reverseStart = pointToNode(segment.secondPoint, otherSide(segment.secondSide));
  const reverseEnd = pointToNode(segment.firstPoint, segment.firstSide);
  if (startNode === reverseStart && endNode === reverseEnd) return -1;

  return 0;
}

function stitchRoutePolyline(route, segmentsById) {
  const nodes = Array.isArray(route?.nodes) ? route.nodes : [];
  const segmentIds = Array.isArray(route?.segments) ? route.segments : [];
  const stitched = [];

  for (let index = 0; index < segmentIds.length; index += 1) {
    const segmentId = segmentIds[index];
    const segment = segmentsById.get(segmentId);
    if (!segment) continue;
    const startNode = nodes[index] || null;
    const endNode = nodes[index + 1] || null;
    const direction = resolveSegmentDirection(segment, startNode, endNode);
    const points = direction < 0 ? reversePolyline(segment.polyline) : dedupePolyline(segment.polyline);
    for (const point of points) {
      const prev = stitched[stitched.length - 1];
      if (
        prev
        && Math.abs(prev[0] - point[0]) <= 1e-6
        && Math.abs(prev[1] - point[1]) <= 1e-6
        && Math.abs(prev[2] - point[2]) <= 1e-6
      ) {
        continue;
      }
      stitched.push(point);
    }
  }

  return dedupePolyline(stitched);
}

export async function routeWireHarnessConnections(partHistory, connections = []) {
  const network = buildWireHarnessNetwork(partHistory);
  const requestedConnections = Array.isArray(connections) ? connections : [];
  const unresolved = [];
  const validPairs = [];

  for (const connection of requestedConnections) {
    const connectionId = normalizeText(connection?.id, '');
    const source = resolveConnectionEndpoint(network, connection?.from);
    const target = resolveConnectionEndpoint(network, connection?.to);
    if (!source.ok || !target.ok) {
      unresolved.push({
        connectionId,
        connectionName: normalizeText(connection?.name, connectionId),
        feasible: false,
        error: source.error || target.error || 'Invalid connection endpoints.',
        distance: null,
        polyline: [],
        segmentIds: [],
      });
      continue;
    }
    validPairs.push({
      id: connectionId,
      startPoint: source.pointId,
      endPoint: target.pointId,
      wireInfo: {
        diameter: Math.max(0.01, normalizeNumber(connection?.diameter, 1)),
      },
    });
  }

  if (!network.splineSegments.length || !validPairs.length) {
    return {
      network,
      routes: unresolved.concat(validPairs.map((pair) => ({
        connectionId: pair.id,
        feasible: false,
        error: network.splineSegments.length ? 'No valid connections to route.' : 'No harness splines are available for routing.',
        distance: null,
        polyline: [],
        segmentIds: [],
      }))),
    };
  }

  const digraph = abSegmentsToDigraph(network.splineSegments);
  const pointPairs = simpleArrayToPointPairs(validPairs);
  await findShortestPathForAllPairsAsync(digraph, pointPairs, null);

  const segmentsById = new Map(network.splineSegments.map((segment) => [segment.id, segment]));
  const routes = [];
  for (const pair of pointPairs) {
    const connection = requestedConnections.find((entry) => String(entry?.id || '') === String(pair?.id || '')) || null;
    const feasible = !!pair?.route?.feasible;
    const polyline = feasible ? stitchRoutePolyline(pair.route, segmentsById) : [];
    routes.push({
      connectionId: normalizeText(pair?.id, ''),
      connectionName: normalizeText(connection?.name, normalizeText(pair?.id, 'Wire')),
      feasible: feasible && polyline.length >= 2,
      error: feasible && polyline.length >= 2 ? '' : 'No route found through the harness network.',
      distance: Number.isFinite(Number(pair?.route?.distance)) ? Number(pair.route.distance) : null,
      polyline,
      segmentIds: Array.isArray(pair?.route?.segments) ? pair.route.segments.slice() : [],
      nodePath: Array.isArray(pair?.route?.nodes) ? pair.route.nodes.slice() : [],
      diameter: Math.max(0.01, normalizeNumber(connection?.diameter, pair?.wireInfo?.diameter || 1)),
      from: normalizeText(connection?.from, ''),
      to: normalizeText(connection?.to, ''),
    });
  }

  return {
    network,
    routes: unresolved.concat(routes),
  };
}
