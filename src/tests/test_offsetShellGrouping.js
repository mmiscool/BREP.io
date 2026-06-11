import { Cylinder } from '../BREP/primitives.js';
import { OffsetShellSolid } from '../BREP/OffsetShellSolid.js';

export async function test_offsetShell_preserves_source_centerlines(partHistory) {
  const source = new Cylinder({ radius: 2, height: 4, resolution: 16, name: 'CYL_CL' });
  source.addCenterline([0, 0, 0], [0, 4, 0], 'CYL_CL_AXIS', { materialKey: 'OVERLAY' });
  source.addAuxEdge('CYL_CL_REFERENCE', [[2, 0, 0], [2, 4, 0]], { materialKey: 'OVERLAY' });

  const shell = OffsetShellSolid.generate(source, -0.5, {
    newSolidName: 'CYL_CL_shell',
    featureId: 'TEST_CL',
  });

  const auxEdges = Array.isArray(shell?._auxEdges) ? shell._auxEdges : [];
  const centerlines = auxEdges.filter((aux) => aux?.centerline);
  if (centerlines.length !== 1) {
    throw new Error(`Expected exactly one preserved centerline, got ${centerlines.length}.`);
  }
  if (auxEdges.some((aux) => aux?.name === 'CYL_CL_REFERENCE')) {
    throw new Error('Offset shell should not preserve non-centerline auxiliary edges.');
  }

  const axis = centerlines[0];
  if (axis.name !== 'CYL_CL_AXIS') {
    throw new Error(`Expected preserved centerline name CYL_CL_AXIS, got ${axis.name || 'unnamed'}.`);
  }
  if (!Array.isArray(axis.points) || axis.points.length !== 2) {
    throw new Error('Expected preserved centerline to keep two points.');
  }
  const expected = [[0, 0, 0], [0, 4, 0]];
  for (let i = 0; i < expected.length; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      if (axis.points[i][j] !== expected[i][j]) {
        throw new Error(`Expected centerline point ${i}.${j} to remain ${expected[i][j]}, got ${axis.points[i][j]}.`);
      }
    }
  }

  axis.points[0][0] = 123;
  if (source._auxEdges?.[0]?.points?.[0]?.[0] === 123) {
    throw new Error('Offset shell centerline should be a deep copy, not a shared source reference.');
  }

  return partHistory;
}
