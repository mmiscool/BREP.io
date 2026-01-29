import { BREP } from 'brep-io-kernel';

const cube = new BREP.Cube({ x: 2, y: 3, z: 4, name: 'Cube' });
console.log('Cube volume:', cube.volume());
console.log('Cube surface area:', cube.surfaceArea());
console.log('Cube triangles:', cube.getTriangleCount());
