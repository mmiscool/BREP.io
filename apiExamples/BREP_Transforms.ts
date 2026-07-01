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

const describe = (label, solid) => {
  write(
    `${label.padEnd(16)} volume=${fmt(solid.volume())} area=${fmt(solid.surfaceArea())} triangles=${solid.getTriangleCount()}`,
  );
};

const runExample = () => {
  logEl.textContent = '';
  setStatus('Running...', 'pending');

  const base = new BREP.Cube({ x: 2.2, y: 1.4, z: 1.0, name: 'BaseCube' });
  const moved = base.clone().bakeTRS({
    position: [2.0, 0.4, 0.3],
    rotationEuler: [0, 35, 20],
    scale: [1.1, 0.85, 1.25],
  });
  const mirrored = moved.mirrorAcrossPlane([0, 0, 0], [1, 0, 0]);
  const combined = moved.union(mirrored);

  write('--- Transform Summary ---');
  describe('base', base);
  describe('moved', moved);
  describe('mirrored', mirrored);
  describe('combined', combined);

  if (combined.volume() <= moved.volume()) {
    throw new Error('Combined solid volume should be greater than a single moved solid.');
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
