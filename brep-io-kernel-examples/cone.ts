import { BREP } from 'brep-io-kernel';

const cone = new BREP.Cone({ radius: 1, height: 2, resolution: 32, name: 'Cone' });
console.log('Cone volume:', cone.volume());
console.log('Cone surface area:', cone.surfaceArea());
console.log('Cone triangles:', cone.getTriangleCount());
