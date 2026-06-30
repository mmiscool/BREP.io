import * as THREE from 'three';
import {
  clearWireHarnessRouteGroup,
  listWireHarnessRouteObjectsForConnection,
  renderWireHarnessRoutes,
} from '../wireHarness/wireHarnessRouteRenderer.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed.');
  }
}

export function test_wire_harness_routes_render_as_scene_solids() {
  const scene = new THREE.Scene();

  renderWireHarnessRoutes(scene, [], [{
    segmentId: 'SEG1',
    featureId: 'SP1',
    polyline: [
      [0, 0, 0],
      [15, 0, 0],
      [15, 10, 0],
    ],
    diameter: 2.5,
    wireCount: 3,
    wireDiameters: [1, 1, 1.5],
    connectionIds: ['WIRE-1'],
    connectionNames: ['Wire 1'],
  }]);

  const routeGroup = scene.getObjectByName('__WireHarnessRoutes');
  assert(routeGroup, 'Expected the wire harness route group to be added to the scene.');

  const solids = [];
  scene.traverse((object) => {
    if (object?.type === 'SOLID' && object?.userData?.isWireHarnessRoute) {
      solids.push(object);
    }
  });

  assert(solids.length === 1, `Expected one routed harness solid, got ${solids.length}.`);
  assert(typeof solids[0].toSTL === 'function', 'Expected routed harness geometry to be a real BREP solid.');
  assert(
    listWireHarnessRouteObjectsForConnection(scene, 'WIRE-1').length === 1,
    'Expected connection hover lookup to resolve the routed harness solid.',
  );

  const mesh = solids[0].getMesh();
  const triCount = ((mesh?.triVerts?.length || 0) / 3) | 0;
  try { mesh?.delete?.(); } catch { /* ignore */ }
  assert(triCount > 0, 'Expected routed harness solid to contribute triangulated geometry for export.');

  clearWireHarnessRouteGroup(scene);

  assert(scene.getObjectByName('__WireHarnessRoutes') == null, 'Expected clear to remove the wire harness route group.');
  const remainingSolids = [];
  scene.traverse((object) => {
    if (object?.type === 'SOLID' && object?.userData?.isWireHarnessRoute) remainingSolids.push(object);
  });
  assert(remainingSolids.length === 0, 'Expected clear to remove routed harness solids from the scene.');
}
