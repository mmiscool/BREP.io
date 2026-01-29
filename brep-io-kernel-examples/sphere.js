import { BREP } from 'brep-io-kernel';

const sphere = new BREP.Sphere({ r: 1, resolution: 24, name: 'Sphere' });
console.log('Sphere volume:', sphere.volume());
console.log('Sphere surface area:', sphere.surfaceArea());
console.log('Sphere triangles:', sphere.getTriangleCount());
