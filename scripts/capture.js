import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { prepareModelingScreenshot } from './capture/docsShots/modelingScreenshot.js';
import { prepareSketchScreenshot } from './capture/docsShots/sketchScreenshot.js';
import { preparePmiScreenshot } from './capture/docsShots/pmiScreenshot.js';

const require = createRequire(import.meta.url);
const DEFAULT_BASE_URL = process.env.CAPTURE_BASE_URL || 'http://localhost:5173';
const LOCAL_CAPTURE_SERVER_URL = 'http://localhost:5173/';
const DOCS_CAPTURE_VIEWPORT = { width: 1200, height: 800 };
const DEFAULT_VIEWPORT = { ...DOCS_CAPTURE_VIEWPORT };
const DEVICE_SCALE_FACTOR = 1;
const OUTPUT_SCALE_MODE = 4;
const CAPTURE_HEADLESS = resolveHeadless(process.env.CAPTURE_HEADLESS);
const CAPTURE_KEEP_OPEN = resolveKeepOpen(process.env.CAPTURE_KEEP_OPEN, CAPTURE_HEADLESS);
const PLAYWRIGHT_PNG_COMPARATOR = resolvePlaywrightPngComparator();
const CAPTURE_SKIP_HISTORY_DIALOGS = resolveSkipHistoryDialogs();
const PLAYWRIGHT_IMAGE_COMPARE_OPTIONS = {
  // Match Playwright's default toHaveScreenshot pixel comparator settings.
  threshold: 0.2,
};
const CAPTURE_SERVER_PROBE_TIMEOUT_MS = 1500;
const CAPTURE_SERVER_POLL_INTERVAL_MS = 750;
const CAPTURE_SERVER_READY_TIMEOUT_MS = 120000;
const DOC_FIXTURE_PATH = resolve(process.cwd(), 'src', 'tests', 'partFiles', 'fillet_angle_test.BREP.json');
const DOC_PMI_FIXTURE_PATH = resolve(process.cwd(), 'scripts', 'capture', 'docsShots', 'PMI_example.BREP.json');
const DOC_IMAGE_TO_FACE_SOURCE_PATH = resolve(process.cwd(), 'scripts', 'capture', 'docsShots', 'car.png');
const DOC_SHOTS = [
  {
    id: 'modeling',
    label: 'Modeling mode',
    relativePath: join('docs', 'MODELING.png'),
  },
  {
    id: 'sketch',
    label: 'Sketch mode',
    relativePath: join('docs', 'SKETCH.png'),
  },
  {
    id: 'pmi-mode',
    label: 'PMI mode',
    relativePath: join('docs', 'PMI.png'),
  },
  {
    id: 'image-to-face-2d',
    label: 'Image to Face 2D editor',
    relativePath: join('docs', 'features', 'image-to-face-2D_dialog.png'),
  },
  {
    id: 'image-to-face-3d',
    label: 'Image to Face 3D result',
    relativePath: join('docs', 'features', 'image-to-face-3D_dialog.png'),
  },
];
const FEATURE_DOC_SHOT_IDS = new Set(['image-to-face-2d', 'image-to-face-3d']);
const DEFAULT_TARGETS = [
  {
    id: 'features',
    label: 'Feature dialogs',
    path: '/feature-dialog-capture.html',
    outputParts: ['docs', 'features'],
    kind: 'dialogs',
  },
  {
    id: 'pmi',
    label: 'PMI annotations',
    path: '/pmi-dialog-capture.html',
    outputParts: ['docs', 'pmi-annotations'],
    kind: 'dialogs',
  },
  {
    id: 'assembly',
    label: 'Assembly constraints',
    path: '/assembly-constraint-capture.html',
    outputParts: ['docs', 'assembly-constraints'],
    kind: 'dialogs',
  },
  {
    id: 'docs',
    label: 'Documentation screenshots',
    path: '/cad.html',
    kind: 'docs',
    shots: DOC_SHOTS,
  },
];

async function run() {
  const serverProcess = await maybeStartCaptureServer();
  try {
    const targets = resolveTargets();
    if (!targets.length) {
      console.warn('⚠️  No capture targets selected. Use CAPTURE_SCOPE or CAPTURE_URL to configure targets.');
      return;
    }

    const browser = await chromium.launch({ headless: CAPTURE_HEADLESS });
    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        try {
          localStorage.setItem('__BREP_STARTUP_TOUR_DONE__', '1');
        } catch {
          // ignore localStorage access issues
        }
      });
      let totalCaptured = 0;

      for (const target of targets) {
        const count = await captureTarget(page, target);
        totalCaptured += count;
      }

      console.log(`✅ Processed ${totalCaptured} screenshot(s) across ${targets.length} target(s).`);
      if (CAPTURE_KEEP_OPEN) {
        console.log('ℹ️  Keeping browser open. Press Ctrl+C to close it and exit.');
        await waitForShutdownSignal();
      }
    } finally {
      await closeCaptureBrowser(context, browser);
    }
  } finally {
    await stopCaptureServer(serverProcess);
  }
}

async function maybeStartCaptureServer() {
  if (!shouldManageLocalCaptureServer()) return null;
  const isAlreadyRunning = await isServerReachable(LOCAL_CAPTURE_SERVER_URL);
  if (isAlreadyRunning) {
    console.log(`ℹ️  Reusing existing server at ${LOCAL_CAPTURE_SERVER_URL}`);
    return null;
  }

  console.log(`▶️  No server detected at ${LOCAL_CAPTURE_SERVER_URL}. Starting pnpm dev...`);
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const serverProcess = spawn(pnpmCommand, ['dev'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  let spawnError = null;
  serverProcess.once('error', (error) => {
    spawnError = error;
  });

  await waitForServerReady(LOCAL_CAPTURE_SERVER_URL, serverProcess, () => spawnError);
  console.log(`✅ Dev server ready at ${LOCAL_CAPTURE_SERVER_URL}`);
  return serverProcess;
}

function shouldManageLocalCaptureServer() {
  if (process.env.CAPTURE_URL) return false;
  try {
    const baseUrl = new URL(DEFAULT_BASE_URL);
    const isHttp = baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:';
    if (!isHttp) return false;
    const hostname = String(baseUrl.hostname || '').toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!isLocalHost) return false;
    const port = Number(baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80));
    return port === 5173;
  } catch {
    return false;
  }
}

async function waitForServerReady(url, serverProcess, getSpawnError) {
  const startMs = Date.now();
  while (Date.now() - startMs < CAPTURE_SERVER_READY_TIMEOUT_MS) {
    const spawnError = typeof getSpawnError === 'function' ? getSpawnError() : null;
    if (spawnError) {
      throw new Error(`Failed to start dev server: ${spawnError.message || spawnError}`);
    }
    if (serverProcess?.exitCode != null) {
      throw new Error(`Dev server exited before becoming ready (code ${serverProcess.exitCode}).`);
    }
    if (await isServerReachable(url)) {
      return;
    }
    await delay(CAPTURE_SERVER_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for dev server at ${url}.`);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function isServerReachable(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  const requestFn = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  if (requestFn !== httpRequest && requestFn !== httpsRequest) return false;

  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };

    const request = requestFn(parsedUrl, { method: 'GET', timeout: CAPTURE_SERVER_PROBE_TIMEOUT_MS }, (response) => {
      response.resume();
      settle(true);
    });

    request.on('timeout', () => {
      request.destroy();
      settle(false);
    });
    request.on('error', () => {
      settle(false);
    });
    request.end();
  });
}

async function stopCaptureServer(serverProcess) {
  if (!serverProcess) return;
  if (serverProcess.exitCode != null) return;

  console.log('▶️  Stopping temporary capture dev server...');
  try {
    serverProcess.kill('SIGTERM');
  } catch {
    return;
  }

  const exitedAfterTerm = await waitForExit(serverProcess, 5000);
  if (exitedAfterTerm) return;

  try {
    serverProcess.kill('SIGKILL');
  } catch {
    return;
  }
  await waitForExit(serverProcess, 2000);
}

async function waitForExit(serverProcess, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (serverProcess.exitCode != null) return true;
    await delay(100);
  }
  return serverProcess.exitCode != null;
}

function resolveTargets() {
  if (process.env.CAPTURE_URL) {
    const output = process.env.CAPTURE_OUTPUT
      ? resolve(process.cwd(), process.env.CAPTURE_OUTPUT)
      : resolve(process.cwd(), 'docs', 'features');
    return [{
      id: 'custom',
      label: 'Custom capture',
      targetUrl: process.env.CAPTURE_URL,
      outputDir: output,
      kind: 'dialogs',
    }];
  }

  const scope = parseScope(process.env.CAPTURE_SCOPE);
  return DEFAULT_TARGETS
    .filter((target) => !scope || scope.has(String(target?.id || '').trim().toLowerCase()))
    .map((target) => {
      const resolvedTarget = {
        ...target,
        targetUrl: resolveUrl(DEFAULT_BASE_URL, target.path),
      };
      if (Array.isArray(target.outputParts)) {
        resolvedTarget.outputDir = resolve(process.cwd(), ...target.outputParts);
      }
      return resolvedTarget;
    });
}

function parseScope(scopeValue) {
  return parseCsvSet(scopeValue);
}

function parseCsvSet(rawValue) {
  if (!rawValue) return null;
  const parts = String(rawValue)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

function readCliOptionValues(optionNames = []) {
  if (!Array.isArray(optionNames) || !optionNames.length) return [];
  const values = [];
  const names = optionNames
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    for (const name of names) {
      if (arg === name) {
        const nextValue = String(args[i + 1] || '').trim();
        if (nextValue && !nextValue.startsWith('-')) {
          values.push(nextValue);
          i += 1;
        }
        break;
      }
      if (arg.startsWith(`${name}=`)) {
        const inlineValue = arg.slice(name.length + 1).trim();
        if (inlineValue) values.push(inlineValue);
        break;
      }
    }
  }

  return values;
}

function hasCliFlag(optionNames = []) {
  if (!Array.isArray(optionNames) || !optionNames.length) return false;
  const names = optionNames
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const args = process.argv.slice(2);
  for (const arg of args) {
    const token = String(arg || '');
    for (const name of names) {
      if (token === name || token.startsWith(`${name}=`)) return true;
    }
  }
  return false;
}

function parseOptionalBoolean(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return null;
}

function resolveSkipHistoryDialogs() {
  const flagNames = ['--skip-history-dialogs', '--skip-history'];
  const cliValues = readCliOptionValues(flagNames);
  for (const cliValue of cliValues) {
    const parsed = parseOptionalBoolean(cliValue);
    if (parsed != null) return parsed;
  }
  if (hasCliFlag(flagNames)) return true;
  const rawValues = [
    process.env.CAPTURE_SKIP_HISTORY_DIALOGS,
    process.env.npm_config_capture_skip_history_dialogs,
    process.env.npm_config_capture_skip_history,
  ];
  for (const rawValue of rawValues) {
    const parsed = parseOptionalBoolean(rawValue);
    if (parsed != null) return parsed;
  }
  return false;
}

function isHistoryDialog(captureName = '', shortName = '') {
  const isHistory = (value) => /\bhistory\b/i.test(String(value || ''));
  return isHistory(captureName) || isHistory(shortName);
}

async function captureTarget(page, target) {
  if (target.kind === 'docs') {
    return captureDocsForTarget(page, target);
  }
  return captureDialogsForTarget(page, target);
}

async function captureDialogsForTarget(page, target) {
  console.log(`▶️  Capturing ${target.label} from ${target.targetUrl}`);
  await page.goto(target.targetUrl, { waitUntil: 'networkidle' });
  await waitForFonts(page);

  const cardLocator = page.locator('.dialog-card');
  await cardLocator.first().waitFor({ state: 'visible', timeout: 15000 });
  await mkdir(target.outputDir, { recursive: true });

  const cards = await cardLocator.all();
  if (!cards.length) {
    throw new Error(`No dialog cards found at ${target.targetUrl}`);
  }

  let capturedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  for (const card of cards) {
    const { captureName, shortName } = await pickCaptureMeta(card);
    const fileSafe = captureName.replace(/[^a-z0-9._-]+/gi, '_') || 'Dialog';
    if (CAPTURE_SKIP_HISTORY_DIALOGS && isHistoryDialog(captureName, shortName)) {
      console.log(`  • ${captureName} → skipped (history dialog)`);
      skippedCount += 1;
      continue;
    }
    const dialog = card.locator('.dialog-form');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    await dialog.scrollIntoViewIfNeeded();
    const targetPath = join(target.outputDir, `${fileSafe}_dialog.png`);
    const rawBuffer = await dialog.screenshot({
      scale: 'device',
      animations: 'disabled',
    });
    const buffer = await maybeNormalizeScreenshot(page, rawBuffer);
    const wroteFile = await writeScreenshotIfChanged(targetPath, buffer);
    if (wroteFile) updatedCount += 1;
    console.log(`  • ${captureName} → ${targetPath}${wroteFile ? ' (updated)' : ' (unchanged)'}`);
    capturedCount += 1;
  }

  const skippedSegments = [];
  if (CAPTURE_SKIP_HISTORY_DIALOGS && skippedCount) skippedSegments.push(`${skippedCount} skipped history`);
  const skippedSuffix = skippedSegments.length ? `, ${skippedSegments.join(', ')}` : '';
  console.log(`✅ Processed ${capturedCount} dialog screenshots (${updatedCount} updated${skippedSuffix}) in ${target.outputDir}`);
  return capturedCount;
}

async function captureDocsForTarget(page, target) {
  console.log(`▶️  Capturing ${target.label} from ${target.targetUrl}`);
  let fixtureJson = '';
  let pmiFixtureJson = '';
  let imageToFaceDataUrl = '';
  try {
    fixtureJson = await readFile(DOC_FIXTURE_PATH, 'utf-8');
  } catch (error) {
    console.warn(`⚠️  Could not load fixture ${DOC_FIXTURE_PATH}:`, error?.message || error);
  }
  try {
    pmiFixtureJson = await readFile(DOC_PMI_FIXTURE_PATH, 'utf-8');
  } catch (error) {
    console.warn(`⚠️  Could not load PMI fixture ${DOC_PMI_FIXTURE_PATH}:`, error?.message || error);
  }
  try {
    const imageBytes = await readFile(DOC_IMAGE_TO_FACE_SOURCE_PATH);
    if (imageBytes?.length) {
      imageToFaceDataUrl = `data:image/png;base64,${imageBytes.toString('base64')}`;
    }
  } catch (error) {
    console.warn(`⚠️  Could not load image-to-face source ${DOC_IMAGE_TO_FACE_SOURCE_PATH}:`, error?.message || error);
  }

  const shots = Array.isArray(target.shots) ? target.shots : [];
  if (!shots.length) {
    console.warn('⚠️  No documentation shots configured.');
    return 0;
  }

  let capturedCount = 0;
  let updatedCount = 0;
  await page.setViewportSize(DOCS_CAPTURE_VIEWPORT);
  for (const shot of shots) {
    await page.goto(target.targetUrl, { waitUntil: 'networkidle' });
    await waitForCadReady(page);
    if (!isFeatureDocShot(shot?.id)) {
      await page.waitForLoadState('networkidle');
    }
    await prepareDocsShot(page, shot.id, {
      fixtureJson,
      pmiFixtureJson,
      imageToFaceDataUrl,
    });
    if (!isFeatureDocShot(shot?.id)) {
      await page.waitForLoadState('networkidle');
    }
    await waitForFonts(page);
    await page.waitForTimeout(250);

    const targetPath = resolve(process.cwd(), shot.relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    const buffer = await page.screenshot({
      scale: 'css',
      animations: 'disabled',
    });
    const wroteFile = await writeScreenshotIfChanged(targetPath, buffer);
    if (wroteFile) updatedCount += 1;
    console.log(`  • ${shot.label} → ${targetPath}${wroteFile ? ' (updated)' : ' (unchanged)'}`);
    capturedCount += 1;
  }

  console.log(`✅ Processed ${capturedCount} documentation screenshot(s) (${updatedCount} updated).`);
  return capturedCount;
}

function isFeatureDocShot(shotId) {
  return FEATURE_DOC_SHOT_IDS.has(String(shotId || '').trim().toLowerCase());
}

async function waitForCadReady(page) {
  await page.waitForFunction(() => {
    const viewer = window.viewer;
    return !!(
      viewer
      && viewer.partHistory
      && viewer.historyWidget
      && viewer.renderer
      && viewer.camera
    );
  }, { timeout: 60000 });

  await page.evaluate(() => {
    try {
      localStorage.setItem('__BREP_STARTUP_TOUR_DONE__', '1');
    } catch {
      // ignore localStorage access issues
    }
    try {
      const tour = document.getElementById('startup-tour-overlay');
      if (tour && tour.parentNode) {
        tour.parentNode.removeChild(tour);
      }
    } catch {
      // ignore tour cleanup errors
    }
  });
}

async function prepareDocsShot(page, shotId, context = {}) {
  if (shotId === 'modeling') {
    await prepareModelingScreenshot(page);
    return;
  }
  if (shotId === 'sketch') {
    await prepareSketchScreenshot(page, context.fixtureJson || '');
    return;
  }
  if (shotId === 'pmi-mode') {
    await preparePmiScreenshot(page, context.pmiFixtureJson || '');
    return;
  }
  if (shotId === 'image-to-face-2d') {
    await prepareImageToFaceShot(page, {
      openEditor: true,
      imageDataUrl: context.imageToFaceDataUrl || '',
    });
    return;
  }
  if (shotId === 'image-to-face-3d') {
    await prepareImageToFaceShot(page, {
      openEditor: false,
      imageDataUrl: context.imageToFaceDataUrl || '',
    });
    return;
  }
  throw new Error(`Unknown docs shot id "${shotId}"`);
}

async function prepareImageToFaceShot(page, { openEditor = false, imageDataUrl = '' } = {}) {
  await page.evaluate(async ({ shouldOpenEditor, providedImageDataUrl }) => {
    const viewer = window.viewer;
    if (!viewer?.partHistory) throw new Error('Viewer is not ready');

    const createSampleTraceImage = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(70, 375);
      ctx.lineTo(145, 262);
      ctx.lineTo(280, 190);
      ctx.lineTo(520, 190);
      ctx.lineTo(655, 245);
      ctx.lineTo(780, 270);
      ctx.lineTo(845, 322);
      ctx.lineTo(845, 430);
      ctx.lineTo(765, 430);
      ctx.arc(690, 430, 74, 0, Math.PI * 2);
      ctx.moveTo(430, 430);
      ctx.arc(260, 430, 78, 0, Math.PI * 2);
      ctx.lineTo(120, 430);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(220, 266);
      ctx.lineTo(318, 206);
      ctx.lineTo(430, 206);
      ctx.lineTo(426, 288);
      ctx.lineTo(248, 286);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(455, 206);
      ctx.lineTo(560, 206);
      ctx.lineTo(694, 270);
      ctx.lineTo(706, 330);
      ctx.lineTo(455, 330);
      ctx.closePath();
      ctx.fill();

      const punchWheel = (cx, cy, r) => {
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(6, r * 0.22), 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 6; i += 1) {
          const angle = (Math.PI * 2 * i) / 6;
          const px = cx + Math.cos(angle) * r * 0.55;
          const py = cy + Math.sin(angle) * r * 0.55;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(4, r * 0.14), 0, Math.PI * 2);
          ctx.fill();
        }
      };

      punchWheel(260, 430, 54);
      punchWheel(690, 430, 52);
      return canvas.toDataURL('image/png');
    };

    const partHistory = viewer.partHistory;
    try { viewer.endSketchMode?.(); } catch { /* ignore */ }
    try { viewer.endPMIMode?.(); } catch { /* ignore */ }

    await partHistory.reset();
    const imageFeature = await partHistory.newFeature('IMAGE');
    const hasProvidedImage = typeof providedImageDataUrl === 'string'
      && providedImageDataUrl.startsWith('data:image/');
    imageFeature.inputParams.fileToImport = hasProvidedImage
      ? providedImageDataUrl
      : createSampleTraceImage();

    const featureId = imageFeature.inputParams.id || imageFeature.inputParams.featureID || null;
    partHistory.currentHistoryStepId = featureId;
    await partHistory.runHistory();
    try { viewer.historyWidget?.render?.(); } catch { /* ignore */ }

    if (shouldOpenEditor) {
      const featureClass = partHistory.featureRegistry?.getSafe?.('IMAGE') || partHistory.featureRegistry?.get?.('IMAGE');
      const openEditorAction = featureClass?.inputParamsSchema?.editImage?.actionFunction;
      if (typeof openEditorAction !== 'function') {
        throw new Error('Image editor action is unavailable');
      }
      openEditorAction({
        feature: imageFeature,
        params: imageFeature.inputParams,
        partHistory,
        viewer,
      });
      return;
    }

    try {
      viewer.camera?.position?.set?.(18, 11, 18);
      viewer.controls?.target?.set?.(0, 0, 0);
      viewer.controls?.update?.();
    } catch { /* ignore */ }
    try {
      viewer._setSidebarPinned?.(true);
      viewer._setSidebarAutoHideSuspended?.(false);
      viewer._setSidebarHoverVisible?.(true);
    } catch { /* ignore */ }
    try { viewer.zoomToFit?.(1.15); } catch { /* ignore */ }
  }, { shouldOpenEditor: !!openEditor, providedImageDataUrl: imageDataUrl || '' });

  if (openEditor) {
    await page.locator('.img-editor-overlay').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(250);
    return;
  }
  await page.waitForTimeout(350);
}

async function waitForFonts(page) {
  try {
    await page.evaluate(async () => {
      if (document.fonts && typeof document.fonts.ready === 'object') {
        try {
          await document.fonts.ready;
        } catch {
          // ignore font readiness errors
        }
      }
    });
  } catch {
    // ignore evaluation errors
  }
}

async function pickCaptureMeta(card) {
  const displayNameRaw = await card.getAttribute('data-feature-name');
  const shortNameRaw = await card.getAttribute('data-feature-short-name');
  const displayNameTrimmed = displayNameRaw ? displayNameRaw.trim() : '';
  const shortNameTrimmed = shortNameRaw ? shortNameRaw.trim() : '';
  return {
    captureName: displayNameTrimmed || shortNameTrimmed || 'Dialog',
    shortName: shortNameTrimmed || '',
  };
}

function resolveUrl(base, path) {
  try {
    return new URL(path, base).toString();
  } catch {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}

async function maybeNormalizeScreenshot(page, buffer) {
  if (OUTPUT_SCALE_MODE !== 'css') return buffer;
  if (DEVICE_SCALE_FACTOR <= 1) return buffer;
  if (!buffer?.length) return buffer;
  const normalized = await downscaleScreenshot(page, buffer, DEVICE_SCALE_FACTOR);
  if (!normalized) return buffer;
  return normalized;
}

function resolvePlaywrightPngComparator() {
  try {
    const playwrightEntry = require.resolve('playwright');
    const playwrightCorePkg = require.resolve('playwright-core/package.json', { paths: [playwrightEntry] });
    const comparatorModulePath = join(dirname(playwrightCorePkg), 'lib', 'server', 'utils', 'comparators.js');
    const comparatorModule = require(comparatorModulePath);
    const comparator = comparatorModule?.getComparator?.('image/png');
    if (typeof comparator === 'function') return comparator;
  } catch (error) {
    console.warn('⚠️  Could not load Playwright screenshot comparator; using byte-compare fallback.', error?.message || error);
  }
  return null;
}

function screenshotsMatch(existingBuffer, nextBuffer) {
  if (!existingBuffer?.length || !nextBuffer?.length) return false;
  if (PLAYWRIGHT_PNG_COMPARATOR) {
    try {
      const diff = PLAYWRIGHT_PNG_COMPARATOR(nextBuffer, existingBuffer, PLAYWRIGHT_IMAGE_COMPARE_OPTIONS);
      return !diff;
    } catch (error) {
      console.warn('⚠️  Playwright comparator failed; using byte-compare fallback.', error?.message || error);
    }
  }
  return Buffer.compare(existingBuffer, nextBuffer) === 0;
}

async function writeScreenshotIfChanged(targetPath, nextBuffer) {
  if (!nextBuffer?.length) return false;
  let existingBuffer = null;
  try {
    existingBuffer = await readFile(targetPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (existingBuffer && screenshotsMatch(existingBuffer, nextBuffer)) {
    return false;
  }

  await writeFile(targetPath, nextBuffer);
  return true;
}

async function downscaleScreenshot(page, buffer, scale) {
  try {
    const base64Data = buffer.toString('base64');
    const normalizedBase64 = await page.evaluate(async ({ data, factor }) => {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const targetWidth = Math.max(1, Math.round(bitmap.width / factor));
      const targetHeight = Math.max(1, Math.round(bitmap.height / factor));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const result = canvas.toDataURL('image/png');
      return result.slice(result.indexOf(',') + 1);
    }, { data: base64Data, factor: scale /2});
    return Buffer.from(normalizedBase64, 'base64');
  } catch (error) {
    console.warn('⚠️  Failed to downscale screenshot:', error);
    return null;
  }
}

function resolveDeviceScaleFactor(value) {
  const fallback = 2;
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`⚠️  Invalid device scale factor "${value}". Falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

function resolveHeadless(value) {
  if (value == null || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  console.warn(`⚠️  Invalid CAPTURE_HEADLESS value "${value}". Using headed mode.`);
  return false;
}

function resolveKeepOpen(value, isHeadless) {
  const parsed = parseOptionalBoolean(value);
  if (parsed != null) return parsed;
  if (value != null && value !== '') {
    console.warn(`⚠️  Invalid CAPTURE_KEEP_OPEN value "${value}". Using default behavior.`);
  }
  return !isHeadless;
}

function waitForShutdownSignal() {
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      try { process.off('SIGINT', onSignal); } catch { /* ignore */ }
      try { process.off('SIGTERM', onSignal); } catch { /* ignore */ }
      resolvePromise();
    };
    const onSignal = () => settle();
    try { process.once('SIGINT', onSignal); } catch { /* ignore */ }
    try { process.once('SIGTERM', onSignal); } catch { /* ignore */ }
  });
}

async function closeCaptureBrowser(context, browser) {
  try { await context?.close?.(); } catch { /* ignore */ }
  try { await browser?.close?.(); } catch { /* ignore */ }
}

function resolveOutputScale(value, deviceScale) {
  if (!value) {
    return deviceScale > 1 ? 'css' : 'device';
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'device' ? 'device' : 'css';
}

run().catch((err) => {
  console.error('❌ Capture failed:', err);
  process.exitCode = 1;
});
