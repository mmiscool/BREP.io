import { BREP } from '../BREP/BREP.js';
import { extractPortRuntimeData } from '../features/port/portUtils.js';
import {
  buildHermitePolyline,
  createResolvedSplineData,
  DEFAULT_RESOLUTION,
  normalizeSplineData,
} from '../features/spline/splineUtils.js';
import { abSegmentsToDigraph, nodeToPoint, pointToNode } from './pathFinderLogic/js/sided_ab_graphs/digraph_ab_builder.js';
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

function resolveSegmentPortSide(portData, fromPoint, toPoint, fallbackSide = 'A') {
  const branch = new THREE.Vector3(
    normalizeNumber(toPoint?.[0], 0) - normalizeNumber(fromPoint?.[0], 0),
    normalizeNumber(toPoint?.[1], 0) - normalizeNumber(fromPoint?.[1], 0),
    normalizeNumber(toPoint?.[2], 0) - normalizeNumber(fromPoint?.[2], 0),
  );
  const baseDirection = new THREE.Vector3(
    normalizeNumber(portData?.direction?.[0], 1),
    normalizeNumber(portData?.direction?.[1], 0),
    normalizeNumber(portData?.direction?.[2], 0),
  );
  if (branch.lengthSq() <= 1e-12 || baseDirection.lengthSq() <= 1e-12) {
    return normalizePortSide(fallbackSide, portData?.kind);
  }
  branch.normalize();
  baseDirection.normalize();
  return branch.dot(baseDirection) >= 0 ? 'A' : 'B';
}

function bundleDiameter(diameters, packingEfficiency = 0.75, safetyFactor = 1.1) {
  const values = Array.isArray(diameters) ? diameters : [];
  const sumSquares = values.reduce((sum, value) => {
    const diameter = Math.max(0, normalizeNumber(value, 0));
    return sum + (diameter * diameter);
  }, 0);
  if (!(sumSquares > 0)) return 0;
  const efficiency = Math.max(1e-6, normalizeNumber(packingEfficiency, 0.75));
  const factor = Math.max(1, normalizeNumber(safetyFactor, 1.1));
  return Math.sqrt(sumSquares / efficiency) * factor;
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
    firstSide: resolveSegmentPortSide(firstPort, cleanedPolyline[0], cleanedPolyline[1], firstAttachment?.side),
    secondPoint: getPortPointId(lastPort, lastRef),
    secondSide: resolveSegmentPortSide(
      lastPort,
      cleanedPolyline[cleanedPolyline.length - 1],
      cleanedPolyline[cleanedPolyline.length - 2],
      lastAttachment?.side,
    ),
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

export function resolveWireHarnessConnectionPortRefs(partHistory, connection) {
  const network = buildWireHarnessNetwork(partHistory);
  const fromResult = resolveConnectionEndpoint(network, connection?.from);
  const toResult = resolveConnectionEndpoint(network, connection?.to);
  const refs = [];

  const pushRef = (port) => {
    const ref = normalizeText(port?.ref, '');
    if (ref && !refs.includes(ref)) refs.push(ref);
  };

  if (fromResult?.ok) pushRef(fromResult.port);
  if (toResult?.ok) pushRef(toResult.port);

  return {
    ok: fromResult?.ok && toResult?.ok,
    fromRef: fromResult?.ok ? normalizeText(fromResult?.port?.ref, '') : '',
    toRef: toResult?.ok ? normalizeText(toResult?.port?.ref, '') : '',
    portRefs: refs,
    errors: [fromResult?.error, toResult?.error].filter(Boolean),
  };
}

export function buildWireHarnessRoutingPayload(partHistory, requestedConnections = []) {
  const network = buildWireHarnessNetwork(partHistory);
  const connections = Array.isArray(requestedConnections) ? requestedConnections : [];
  const unresolved = [];
  const validPairs = [];

  for (const connection of connections) {
    const connectionId = normalizeText(connection?.id, '');
    const source = resolveConnectionEndpoint(network, connection?.from);
    const target = resolveConnectionEndpoint(network, connection?.to);
    if (!source.ok || !target.ok) {
      unresolved.push({
        connectionId,
        connectionName: normalizeText(connection?.name, connectionId),
        from: normalizeText(connection?.from, ''),
        to: normalizeText(connection?.to, ''),
        error: source.error || target.error || 'Invalid connection endpoints.',
        diameter: Math.max(0.01, normalizeNumber(connection?.diameter, 1)),
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

  return {
    network,
    segments: (Array.isArray(network?.splineSegments) ? network.splineSegments : []).map((segment) => ({
      id: normalizeText(segment?.id, ''),
      firstPoint: normalizeText(segment?.firstPoint, ''),
      firstSide: normalizePortSide(segment?.firstSide, 'waypoint'),
      secondPoint: normalizeText(segment?.secondPoint, ''),
      secondSide: normalizePortSide(segment?.secondSide, 'waypoint'),
      weight: Math.max(1e-6, normalizeNumber(segment?.weight, 0)),
    })),
    connections: validPairs.map((pair) => ({
      id: normalizeText(pair?.id, ''),
      startPoint: normalizeText(pair?.startPoint, ''),
      endPoint: normalizeText(pair?.endPoint, ''),
      wireInfo: {
        diameter: Math.max(0.01, normalizeNumber(pair?.wireInfo?.diameter, 1)),
      },
    })),
    unresolved,
  };
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

function routeReusesHarnessPoint(route) {
  if (!route || typeof route !== 'object') return false;
  if (route.containsDuplicates === true) return true;
  const nodes = Array.isArray(route?.nodes) ? route.nodes : [];
  const seen = new Set();
  for (const node of nodes) {
    const raw = normalizeText(node, '');
    if (!raw) continue;
    const pointId = raw.endsWith('/A') || raw.endsWith('/B')
      ? raw.slice(0, -2)
      : raw;
    if (!pointId) continue;
    if (seen.has(pointId)) return true;
    seen.add(pointId);
  }
  return false;
}

function findShortestNonReusingRoute(digraph, startPoint, endPoint) {
  const start = normalizeText(startPoint, '');
  const end = normalizeText(endPoint, '');
  if (!start || !end) return null;

  const queue = [
    {
      currentNode: pointToNode(start, 'A'),
      distance: 0,
      nodes: [pointToNode(start, 'A')],
      segments: [],
      visitedPoints: new Set([start]),
    },
    {
      currentNode: pointToNode(start, 'B'),
      distance: 0,
      nodes: [pointToNode(start, 'B')],
      segments: [],
      visitedPoints: new Set([start]),
    },
  ];
  const bestByState = new Map();

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance);
    const state = queue.shift();
    if (!state) break;

    const stateKey = `${state.currentNode}|${Array.from(state.visitedPoints).sort().join(',')}`;
    const bestDistance = bestByState.get(stateKey);
    if (bestDistance != null && bestDistance < state.distance - 1e-9) continue;

    const currentNode = normalizeText(state.currentNode, '');
    const currentPoint = nodeToPoint(currentNode);
    if (currentPoint === end && state.segments.length > 0) {
      return {
        feasible: true,
        startId: state.nodes[0] || pointToNode(start, 'A'),
        endId: currentNode,
        segments: state.segments.slice(),
        nodes: state.nodes.slice(),
        distance: state.distance,
        containsDuplicates: false,
      };
    }

    const graphNode = digraph?.getNode?.(currentNode) || null;
    const edgeCount = Math.max(0, Number(graphNode?.numberOfEdges) || 0);
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const nextNode = normalizeText(graphNode?.getNeighbourId?.(edgeIndex), '');
      if (!nextNode) continue;
      const nextPoint = nodeToPoint(nextNode);
      if (!nextPoint) continue;
      if (state.visitedPoints.has(nextPoint)) continue;

      const nextVisited = new Set(state.visitedPoints);
      nextVisited.add(nextPoint);
      const nextDistance = state.distance + Math.max(1e-6, normalizeNumber(graphNode?.getWeight?.(edgeIndex), 0));
      const nextStateKey = `${nextNode}|${Array.from(nextVisited).sort().join(',')}`;
      const nextBest = bestByState.get(nextStateKey);
      if (nextBest != null && nextBest <= nextDistance + 1e-9) continue;
      bestByState.set(nextStateKey, nextDistance);
      queue.push({
        currentNode: nextNode,
        distance: nextDistance,
        nodes: state.nodes.concat([nextNode]),
        segments: state.segments.concat([normalizeText(graphNode?.getEdgeId?.(edgeIndex), '')]),
        visitedPoints: nextVisited,
      });
    }
  }

  return null;
}

function buildBundleSegments(network, routes = []) {
  const segmentsById = new Map(
    (Array.isArray(network?.splineSegments) ? network.splineSegments : [])
      .map((segment) => [String(segment?.id || ''), segment]),
  );
  const usageBySegment = new Map();

  for (const route of Array.isArray(routes) ? routes : []) {
    if (!route?.feasible) continue;
    const routeDiameter = Math.max(0.01, normalizeNumber(route?.diameter, 1));
    const connectionId = normalizeText(route?.connectionId, '');
    const connectionName = normalizeText(route?.connectionName, connectionId || 'Wire');
    for (const rawSegmentId of Array.isArray(route?.segmentIds) ? route.segmentIds : []) {
      const segmentId = normalizeText(rawSegmentId, '');
      if (!segmentId || !segmentsById.has(segmentId)) continue;
      let usage = usageBySegment.get(segmentId);
      if (!usage) {
        usage = {
          segmentId,
          diameters: [],
          connectionIds: [],
          connectionNames: [],
        };
        usageBySegment.set(segmentId, usage);
      }
      usage.diameters.push(routeDiameter);
      if (connectionId && !usage.connectionIds.includes(connectionId)) usage.connectionIds.push(connectionId);
      if (connectionName && !usage.connectionNames.includes(connectionName)) usage.connectionNames.push(connectionName);
    }
  }

  const bundleSegments = [];
  for (const [segmentId, usage] of usageBySegment.entries()) {
    const segment = segmentsById.get(segmentId);
    if (!segment) continue;
    const diameters = usage.diameters.slice();
    const diameter = Math.max(0.01, bundleDiameter(diameters));
    bundleSegments.push({
      segmentId,
      featureId: normalizeText(segment?.featureId, segmentId),
      polyline: dedupePolyline(segment?.polyline),
      length: Math.max(polylineLength(segment?.polyline), 0),
      diameter,
      wireCount: diameters.length,
      wireDiameters: diameters,
      connectionIds: usage.connectionIds.slice(),
      connectionNames: usage.connectionNames.slice(),
    });
  }

  return bundleSegments;
}

export function buildWireHarnessBundleSegments(partHistory, routes = []) {
  const network = buildWireHarnessNetwork(partHistory);
  return buildBundleSegments(network, routes);
}

export async function routeWireHarnessConnections(partHistory, connections = []) {
  const requestedConnections = Array.isArray(connections) ? connections : [];
  const payload = buildWireHarnessRoutingPayload(partHistory, requestedConnections);
  const network = payload.network;
  const unresolved = (Array.isArray(payload?.unresolved) ? payload.unresolved : []).map((entry) => ({
    connectionId: normalizeText(entry?.connectionId, ''),
    connectionName: normalizeText(entry?.connectionName, normalizeText(entry?.connectionId, 'Wire')),
    feasible: false,
    error: normalizeText(entry?.error, 'Invalid connection endpoints.'),
    distance: null,
    polyline: [],
    segmentIds: [],
  }));
  const validPairs = Array.isArray(payload?.connections) ? payload.connections.slice() : [];

  if (!network.splineSegments.length || !validPairs.length) {
    const routes = unresolved.concat(validPairs.map((pair) => ({
      connectionId: pair.id,
      feasible: false,
      error: network.splineSegments.length ? 'No valid connections to route.' : 'No harness splines are available for routing.',
      distance: null,
      polyline: [],
      segmentIds: [],
    })));
    return {
      network,
      routes,
      bundleSegments: buildBundleSegments(network, routes),
    };
  }

  const digraph = abSegmentsToDigraph(network.splineSegments);
  const pointPairs = simpleArrayToPointPairs(validPairs);
  await findShortestPathForAllPairsAsync(digraph, pointPairs, null);

  const segmentsById = new Map(network.splineSegments.map((segment) => [segment.id, segment]));
  const routes = [];
  for (const pair of pointPairs) {
    const connection = requestedConnections.find((entry) => String(entry?.id || '') === String(pair?.id || '')) || null;
    const rawRoute = pair?.route || null;
    const feasibleCandidate = !!rawRoute?.feasible;
    const reusesPoint = routeReusesHarnessPoint(rawRoute);
    const fallbackRoute = (feasibleCandidate && reusesPoint)
      ? findShortestNonReusingRoute(digraph, pair?.startPoint, pair?.endPoint)
      : null;
    const resolvedRoute = fallbackRoute?.feasible ? fallbackRoute : rawRoute;
    const finalReusesPoint = routeReusesHarnessPoint(resolvedRoute);
    const feasible = !!resolvedRoute?.feasible && !finalReusesPoint;
    const polyline = feasible ? stitchRoutePolyline(resolvedRoute, segmentsById) : [];
    const error = (reusesPoint && !fallbackRoute?.feasible)
      ? 'No route found without reusing the same harness port.'
      : (feasible && polyline.length >= 2 ? '' : 'No route found through the harness network.');
    routes.push({
      connectionId: normalizeText(pair?.id, ''),
      connectionName: normalizeText(connection?.name, normalizeText(pair?.id, 'Wire')),
      feasible: feasible && polyline.length >= 2,
      error: feasible && polyline.length >= 2 ? '' : error,
      distance: Number.isFinite(Number(resolvedRoute?.distance)) && feasible ? Number(resolvedRoute.distance) : null,
      polyline,
      segmentIds: feasible && Array.isArray(resolvedRoute?.segments) ? resolvedRoute.segments.slice() : [],
      nodePath: Array.isArray(resolvedRoute?.nodes) ? resolvedRoute.nodes.slice() : [],
      reusesHarnessPoint: finalReusesPoint,
      diameter: Math.max(0.01, normalizeNumber(connection?.diameter, pair?.wireInfo?.diameter || 1)),
      from: normalizeText(connection?.from, ''),
      to: normalizeText(connection?.to, ''),
    });
  }

  const allRoutes = unresolved.concat(routes);
  return {
    network,
    routes: allRoutes,
    bundleSegments: buildBundleSegments(network, allRoutes),
  };
}
