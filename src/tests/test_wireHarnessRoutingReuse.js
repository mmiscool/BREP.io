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
