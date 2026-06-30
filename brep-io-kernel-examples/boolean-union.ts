import { BREP } from 'brep-io-kernel';

const cube = new BREP.Cube({ x: 2, y: 2, z: 2, name: 'Cube' });
const sphere = new BREP.Sphere({ r: 1.25, resolution: 24, name: 'Sphere' });

const union = cube.union(sphere);

console.log('Union volume:', union.volume());
console.log('Union surface area:', union.surfaceArea());
console.log('Union triangles:', union.getTriangleCount());
