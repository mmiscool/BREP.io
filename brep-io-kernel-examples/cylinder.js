import { BREP } from 'brep-io-kernel';

const cylinder = new BREP.Cylinder({ radius: 1, height: 2, resolution: 32, name: 'Cylinder' });
console.log('Cylinder volume:', cylinder.volume());
console.log('Cylinder surface area:', cylinder.surfaceArea());
console.log('Cylinder triangles:', cylinder.getTriangleCount());
