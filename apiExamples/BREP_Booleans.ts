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
  surfaceArea: solid.surfaceArea(),
  triangles: solid.getTriangleCount(),
});

const runExample = () => {
  logEl.textContent = '';
  setStatus('Running...', 'pending');

  const cube = new BREP.Cube({ x: 2.2, y: 2.2, z: 2.2, name: 'Cube' });
  const sphere = new BREP.Sphere({ r: 1.35, resolution: 40, name: 'Sphere' });

  const union = cube.union(sphere);
  const subtract = cube.subtract(sphere);
  const intersect = cube.intersect(sphere);

  const report = {
    cube: summarize(cube),
    sphere: summarize(sphere),
    union: summarize(union),
    subtract: summarize(subtract),
    intersect: summarize(intersect),
  };

  write('--- Boolean Results ---');
  for (const [name, stats] of Object.entries(report)) {
    write(
      `${name.padEnd(10)} volume=${fmt(stats.volume)} area=${fmt(stats.surfaceArea)} triangles=${stats.triangles}`,
    );
  }

  const epsilon = 1e-6;
  if (report.union.volume + epsilon < Math.max(report.cube.volume, report.sphere.volume)) {
    throw new Error('Union volume is unexpectedly smaller than both source solids.');
  }
  if (report.intersect.volume - epsilon > Math.min(report.cube.volume, report.sphere.volume)) {
    throw new Error('Intersection volume is unexpectedly larger than a source solid.');
  }
  if (report.subtract.volume - epsilon > report.cube.volume) {
    throw new Error('Subtract volume is unexpectedly larger than the original cube.');
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
