import { BREP } from '../dist-kernel/brep-kernel.js';

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const btnRun = document.getElementById('btn-run');

const setStatus = (text, cls) => {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
};

const write = (...parts) => {
  const line = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
  logEl.textContent += `${line}\n`;
  console.log(...parts);
};

const firstLines = (text, count = 8) => text.split('\n').slice(0, count).join('\n');

const runExample = () => {
  logEl.textContent = '';
  setStatus('Running...', 'pending');

  const shaft = new BREP.Cylinder({ radius: 1, height: 3, resolution: 48, name: 'Shaft' })
    .bakeTRS({ position: [0, 0, 0.6], rotationEuler: [90, 0, 0], scale: [1, 1, 1] });

  const head = new BREP.Cone({ radius: 1.55, height: 1.6, resolution: 48, name: 'Head' })
    .bakeTRS({ position: [0, 1.65, 0.6], rotationEuler: [-90, 0, 0], scale: [1, 1, 1] });

  const body = shaft.union(head);
  const stl = body.toSTL('api_example_part', 4);
  const step = body.toSTEP('api_example_part', { precision: 4 });

  write('--- Export Summary ---');
  write('Volume:', body.volume());
  write('Surface area:', body.surfaceArea());
  write('Triangles:', body.getTriangleCount());
  write('STL characters:', stl.length);
  write('STEP characters:', step.length);
  write('');
  write('--- STL Preview ---');
  write(firstLines(stl));
  write('');
  write('--- STEP Preview ---');
  write(firstLines(step));

  if (!stl.startsWith('solid')) {
    throw new Error('STL output did not start with "solid".');
  }
  if (!step.includes('ISO-10303-21')) {
    throw new Error('STEP output did not contain expected ISO header.');
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
