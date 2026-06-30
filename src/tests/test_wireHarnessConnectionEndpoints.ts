import {
  buildWireHarnessRoutingPayload,
  resolveWireHarnessConnectionPortRefs,
} from '../wireHarness/wireHarnessRouting.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

function createFakePort(name, label) {
  return {
    name,
    userData: {
      isPortRoot: true,
      portData: {
        objectName: name,
        name: label,
        kind: 'termination',
        point: [0, 0, 0],
        direction: [1, 0, 0],
      },
    },
  };
}

export async function test_wire_harness_connection_endpoint_resolution() {
  const portA = createFakePort('PORT_A', 'Port A');
  const portB = createFakePort('PORT_B', 'Port B');
  const objects = new Map([
    [portA.name, portA],
    [portB.name, portB],
  ]);
  const partHistory = {
    scene: {
      traverse(visitor) {
        visitor(portA);
        visitor(portB);
      },
      getObjectByName(name) {
        return objects.get(String(name)) || null;
      },
    },
    getObjectByName(name) {
      return objects.get(String(name)) || null;
    },
  };

  const resolved = resolveWireHarnessConnectionPortRefs(partHistory, {
    from: 'Port A',
    to: 'Port B',
  });
  assert(resolved.ok === true, 'Expected endpoint labels to resolve.');
  assert(resolved.fromRef === 'PORT_A', 'Expected from endpoint to resolve to PORT_A.');
  assert(resolved.toRef === 'PORT_B', 'Expected to endpoint to resolve to PORT_B.');
  assert(Array.isArray(resolved.portRefs) && resolved.portRefs.length === 2, 'Expected both endpoint refs to be returned.');

  const missing = resolveWireHarnessConnectionPortRefs(partHistory, {
    from: 'Port A',
    to: 'Missing',
  });
  assert(missing.ok === false, 'Expected unresolved endpoint lookup to fail.');
  assert(missing.portRefs.length === 1 && missing.portRefs[0] === 'PORT_A', 'Expected partial resolution to preserve the valid endpoint.');

  const payload = buildWireHarnessRoutingPayload(partHistory, [{
    id: 'WIRE1',
    from: 'Port A',
    to: 'Port B',
    diameter: 1.25,
  }]);
  assert(Array.isArray(payload.segments) && payload.segments.length === 0, 'Expected payload to expose a segments array.');
  assert(Array.isArray(payload.connections) && payload.connections.length === 1, 'Expected payload to expose one valid connection.');
  assert(payload.connections[0].id === 'WIRE1', 'Expected payload connection id to match.');
  assert(payload.connections[0].startPoint === 'PORT_A', 'Expected payload startPoint to use resolved port object names.');
  assert(payload.connections[0].endPoint === 'PORT_B', 'Expected payload endPoint to use resolved port object names.');
  assert(payload.connections[0].wireInfo?.diameter === 1.25, 'Expected payload diameter to match input.');
}
