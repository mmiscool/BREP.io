import { BREP } from '../dist-kernel/brep-kernel.js';

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const btnRun = document.getElementById('btn-run');

const setStatus = (text, cls) => {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
};

const fmt = (num) => Number(num).toFixed(6);

const write = (...parts) => {
  const line = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
  logEl.textContent += `${line}\n`;
  console.log(...parts);
};

const summarize = (solid) => ({
  volume: solid.volume(),
  area: solid.surfaceArea(),
  triangles: solid.getTriangleCount(),
});

const runExample = () => {
  logEl.textContent = '';
  setStatus('Running...', 'pending');

  const primitives: Array<[string, () => any]> = [
    ['Cube', () => new BREP.Cube({ x: 2, y: 3, z: 4, name: 'Cube' })],
    ['Sphere', () => new BREP.Sphere({ r: 1.2, resolution: 32, name: 'Sphere' })],
    ['Cylinder', () => new BREP.Cylinder({ radius: 1, height: 2.4, resolution: 48, name: 'Cylinder' })],
    ['Cone', () => new BREP.Cone({ radius: 1.1, height: 2.1, resolution: 48, name: 'Cone' })],
    ['Torus', () => new BREP.Torus({ mR: 2, tR: 0.55, resolution: 64, name: 'Torus' })],
    ['Pyramid', () => new BREP.Pyramid({ bL: 2, s: 4, h: 2.7, name: 'Pyramid' })],
  ];

  write('--- Primitive Summary ---');
  for (const [name, createSolid] of primitives) {
    const solid = createSolid();
    const stats = summarize(solid);
    write(`${name.padEnd(10)} volume=${fmt(stats.volume)} area=${fmt(stats.area)} triangles=${stats.triangles}`);
  }

  setStatus('Completed', 'ok');
};

btnRun.addEventListener('click', () => {
  try {
    runExample();
  } catch (error) {
    console.error(error);
    write('ERROR:', error?.stack || error?.message || String(error));
    setStatus('Failed', 'err');
  }
});

try {
  runExample();
} catch (error) {
  console.error(error);
  write('ERROR:', error?.stack || error?.message || String(error));
  setStatus('Failed', 'err');
}
