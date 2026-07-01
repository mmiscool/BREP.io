import { BREP } from '../BREP/BREP.js';

const approx = (actual, expected, eps = 1e-9) =>
  Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected));

function expectNear(actual, expected, label) {
  if (!approx(actual, expected)) {
    throw new Error(`[solidPointMinGap] ${label}: expected ${expected}, got ${actual}`);
  }
}

function expectRecord(record, expected) {
  if (!record || typeof record !== 'object') {
    throw new Error('[solidPointMinGap] expected a proximity record');
  }
  if (typeof expected.inside === 'boolean' && record.inside !== expected.inside) {
    throw new Error(`[solidPointMinGap] inside: expected ${expected.inside}, got ${record.inside}`);
  }
  if (typeof expected.distance === 'number') expectNear(record.distance, expected.distance, 'distance');
  if (expected.directionVector) {
    expectNear(record.directionVector.x, expected.directionVector.x, 'directionVector.x');
    expectNear(record.directionVector.y, expected.directionVector.y, 'directionVector.y');
    expectNear(record.directionVector.z, expected.directionVector.z, 'directionVector.z');
  }
}

export async function test_solidPointMinGap() {
  const cube = new BREP.Cube({ x: 2, y: 3, z: 4, name: 'gap_cube' });

  expectRecord(cube.minGapToPoint([1, 1.5, 2], 1.01)[0], { inside: true, distance: 1 });
  expectRecord(cube.minGapToPoint([2, 1.5, 2], 0.001)[0], { inside: true, distance: 0 });
  expectRecord(cube.minGapToPoint([3, 1.5, 2], 1.01)[0], {
    inside: false,
    distance: 1,
    directionVector: { x: -1, y: 0, z: 0 },
  });
  expectRecord(cube.minGapToPoint([3, 4, 2], 1.5)[0], { inside: false, distance: Math.sqrt(2) });
  expectRecord(cube.minGapToPoint({ x: 3, y: 4, z: 5 }, 1.8)[0], { inside: false, distance: Math.sqrt(3) });

  const faceRecords = cube.minGapToPoint([3, 1.5, 2], 1.01);
  if (faceRecords.length < 2) {
    throw new Error(`[solidPointMinGap] expected multiple nearby triangle records, got ${faceRecords.length}`);
  }
  if (cube.minGapToPoint([10, 1, 1], 2).length !== 0) {
    throw new Error('[solidPointMinGap] expected no records outside searchLength');
  }
}
