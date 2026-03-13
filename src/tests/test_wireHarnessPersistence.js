import { PartHistory } from '../PartHistory.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export async function test_wire_harness_route_results_persist_in_model_json() {
  const partHistory = new PartHistory();
  partHistory.wireHarnessManager.addConnection({
    id: 'wire-1',
    name: 'Wire 1',
    from: 'PORT-A',
    to: 'PORT-B',
    diameter: 1.5,
  });
  partHistory.wireHarnessManager.setRouteResults([{
    connectionId: 'wire-1',
    connectionName: 'Wire 1',
    feasible: true,
    error: '',
    distance: 42.5,
    polyline: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 5, 0],
    ],
    segmentIds: ['SP1', 'SP2'],
    nodePath: ['PORT-A:A', 'MID:A', 'PORT-B:A'],
    reusesHarnessPoint: false,
    diameter: 1.5,
    from: 'PORT-A',
    to: 'PORT-B',
  }]);

  const json = await partHistory.toJSON();
  const restored = new PartHistory();
  await restored.fromJSON(json);

  const restoredConnections = restored.wireHarnessManager.getConnections();
  assert(restoredConnections.length === 1, `Expected one restored connection, got ${restoredConnections.length}.`);
  assert(restoredConnections[0].id === 'wire-1', 'Expected the connection ID to persist.');

  const restoredRoutes = restored.wireHarnessManager.getRouteResults();
  assert(restoredRoutes.length === 1, `Expected one restored route result, got ${restoredRoutes.length}.`);
  assert(restoredRoutes[0].feasible === true, 'Expected the restored route result to remain feasible.');
  assert(restoredRoutes[0].distance === 42.5, `Expected the restored route distance to persist, got ${restoredRoutes[0].distance}.`);
  assert(restoredRoutes[0].segmentIds.join(',') === 'SP1,SP2', 'Expected restored route segment IDs to persist.');

  const pendingRestore = restored.wireHarnessManager.consumePendingRestoredRouteResults();
  assert(Array.isArray(pendingRestore) && pendingRestore.length === 1, 'Expected the restored model to queue route geometry restoration.');
  assert(
    restored.wireHarnessManager.consumePendingRestoredRouteResults() == null,
    'Expected pending restored routes to be consumed only once.',
  );
}
