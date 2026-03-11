import { routeWireHarnessConnections } from '../wireHarness/wireHarnessRouting.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

function createPort(name, label, kind = 'termination', point = [0, 0, 0], direction = [1, 0, 0]) {
  return {
    name,
    userData: {
      isPortRoot: true,
      portData: {
        objectName: name,
        name: label,
        kind,
        point: point.slice(),
        direction: direction.slice(),
        extension: 1,
        displayLength: 1,
      },
    },
  };
}

function createSplineFeature(featureID, firstPortRef, firstSide, secondPortRef, secondSide) {
  return {
    type: 'SP',
    inputParams: {
      featureID,
      curveResolution: 4,
      bendRadius: 1,
    },
    persistentData: {
      spline: {
        points: [
          {
            id: 'p0',
            position: [0, 0, 0],
            attachment: { type: 'port', portRef: firstPortRef, side: firstSide },
          },
          {
            id: 'p1',
            position: [1, 0, 0],
            attachment: { type: 'port', portRef: secondPortRef, side: secondSide },
          },
        ],
      },
    },
  };
}

export async function test_wire_harness_route_reuse_is_invalid() {
  const start = createPort('START', 'Start', 'termination', [-4, 0, 0], [1, 0, 0]);
  const end = createPort('END', 'End', 'termination', [4, 0, 0], [1, 0, 0]);
  const waypoint = createPort('WAYPOINT', 'Waypoint', 'waypoint', [0, 0, 0], [1, 0, 0]);
  const middle = createPort('MIDDLE', 'Middle', 'waypoint', [0, 4, 0], [0, 1, 0]);
  const objects = new Map([
    [start.name, start],
    [end.name, end],
    [waypoint.name, waypoint],
    [middle.name, middle],
  ]);

  const partHistory = {
    scene: {
      traverse(visitor) {
        visitor(start);
        visitor(end);
        visitor(waypoint);
        visitor(middle);
      },
      getObjectByName(name) {
        return objects.get(String(name)) || null;
      },
    },
    getObjectByName(name) {
      return objects.get(String(name)) || null;
    },
    features: [
      createSplineFeature('SP1', 'START', 'A', 'WAYPOINT', 'A'),
      createSplineFeature('SP2', 'WAYPOINT', 'A', 'END', 'A'),
      createSplineFeature('SP3', 'WAYPOINT', 'B', 'MIDDLE', 'A'),
      createSplineFeature('SP4', 'MIDDLE', 'B', 'WAYPOINT', 'B'),
    ],
  };

  const { routes } = await routeWireHarnessConnections(partHistory, [{
    id: 'WIRE1',
    name: 'Wire 1',
    from: 'Start',
    to: 'End',
    diameter: 1,
  }]);

  assert(Array.isArray(routes) && routes.length === 1, 'Expected one route result.');
  assert(routes[0].feasible === false, 'Expected route to be rejected when it reuses a waypoint.');
  assert(routes[0].reusesHarnessPoint === true, 'Expected route result to record harness point reuse.');
  assert(
    String(routes[0].error || '').includes('reusing the same harness port'),
    'Expected route result to explain the waypoint reuse failure.',
  );
  assert(Array.isArray(routes[0].segmentIds) && routes[0].segmentIds.length === 0, 'Rejected route should not expose routed segments.');
}

export async function test_wire_harness_route_prefers_non_reusing_path() {
  const start = createPort('START', 'Start', 'termination', [-4, 0, 0], [1, 0, 0]);
  const end = createPort('END', 'End', 'termination', [6, 0, 0], [1, 0, 0]);
  const waypoint = createPort('WAYPOINT', 'Waypoint', 'waypoint', [0, 0, 0], [1, 0, 0]);
  const middle = createPort('MIDDLE', 'Middle', 'waypoint', [0, 4, 0], [0, 1, 0]);
  const detour = createPort('DETOUR', 'Detour', 'waypoint', [3, 3, 0], [1, 0, 0]);
  const objects = new Map([
    [start.name, start],
    [end.name, end],
    [waypoint.name, waypoint],
    [middle.name, middle],
    [detour.name, detour],
  ]);

  const partHistory = {
    scene: {
      traverse(visitor) {
        visitor(start);
        visitor(end);
        visitor(waypoint);
        visitor(middle);
        visitor(detour);
      },
      getObjectByName(name) {
        return objects.get(String(name)) || null;
      },
    },
    getObjectByName(name) {
      return objects.get(String(name)) || null;
    },
    features: [
      createSplineFeature('SP1', 'START', 'A', 'WAYPOINT', 'A'),
      createSplineFeature('SP2', 'WAYPOINT', 'A', 'END', 'A'),
      createSplineFeature('SP3', 'WAYPOINT', 'B', 'MIDDLE', 'A'),
      createSplineFeature('SP4', 'MIDDLE', 'B', 'WAYPOINT', 'B'),
      createSplineFeature('SP5', 'WAYPOINT', 'B', 'DETOUR', 'A'),
      createSplineFeature('SP6', 'DETOUR', 'B', 'END', 'A'),
    ],
  };

  const { routes } = await routeWireHarnessConnections(partHistory, [{
    id: 'WIRE2',
    name: 'Wire 2',
    from: 'Start',
    to: 'End',
    diameter: 1,
  }]);

  assert(Array.isArray(routes) && routes.length === 1, 'Expected one route result.');
  assert(routes[0].feasible === true, 'Expected router to fall back to the valid non-reusing detour.');
  assert(routes[0].reusesHarnessPoint === false, 'Expected chosen route to avoid harness point reuse.');
  assert(
    Array.isArray(routes[0].segmentIds) && routes[0].segmentIds.join(',') === 'SP1,SP5,SP6',
    'Expected router to choose the non-reusing detour segments.',
  );
}

export async function test_wire_harness_infers_endpoint_side_from_spline_direction() {
  const start = createPort('START', 'Start', 'termination', [-4, 0, 0], [1, 0, 0]);
  const end = createPort('END', 'End', 'termination', [4, 0, 0], [1, 0, 0]);
  const waypoint = createPort('WAYPOINT', 'Waypoint', 'waypoint', [0, 0, 0], [1, 0, 0]);
  const objects = new Map([
    [start.name, start],
    [end.name, end],
    [waypoint.name, waypoint],
  ]);

  const partHistory = {
    scene: {
      traverse(visitor) {
        visitor(start);
        visitor(end);
        visitor(waypoint);
      },
      getObjectByName(name) {
        return objects.get(String(name)) || null;
      },
    },
    getObjectByName(name) {
      return objects.get(String(name)) || null;
    },
    features: [
      createSplineFeature('SP1', 'START', 'A', 'WAYPOINT', 'A'),
      createSplineFeature('SP2', 'WAYPOINT', 'B', 'END', 'A'),
    ],
  };

  const { network, routes } = await routeWireHarnessConnections(partHistory, [{
    id: 'WIRE3',
    name: 'Wire 3',
    from: 'Start',
    to: 'End',
    diameter: 1,
  }]);

  const wpSides = (network?.splineSegments || [])
    .filter((segment) => segment.firstPoint === 'WAYPOINT' || segment.secondPoint === 'WAYPOINT')
    .map((segment) => segment.firstPoint === 'WAYPOINT' ? segment.firstSide : segment.secondSide);

  assert(wpSides.length === 2, 'Expected two waypoint segment attachments.');
  assert(wpSides.every((side) => side === 'B'), 'Expected both spline branches to occupy waypoint side B.');
  assert(routes[0].feasible === false, 'Expected route to fail when both branches use the same physical waypoint side.');
}
