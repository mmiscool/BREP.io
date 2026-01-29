import { BREP } from 'brep-io-kernel';

const pyramid = new BREP.Pyramid({ bL: 2, s: 4, h: 3, name: 'Pyramid' });
console.log('Pyramid volume:', pyramid.volume());
console.log('Pyramid surface area:', pyramid.surfaceArea());
console.log('Pyramid triangles:', pyramid.getTriangleCount());
