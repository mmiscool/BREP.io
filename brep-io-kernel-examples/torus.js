import { BREP } from 'brep-io-kernel';

const torus = new BREP.Torus({ mR: 2, tR: 0.5, resolution: 48, name: 'Torus' });
console.log('Torus volume:', torus.volume());
console.log('Torus surface area:', torus.surfaceArea());
console.log('Torus triangles:', torus.getTriangleCount());
