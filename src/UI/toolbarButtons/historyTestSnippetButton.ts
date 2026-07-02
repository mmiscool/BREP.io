import { FloatingWindow } from '../FloatingWindow.js';

type AnyRecord = Record<string, any>;

declare global {
  interface Window {
    __generatedHistoryTestSnippet?: string;
  }
}

const DEFAULT_EXPRESSIONS = '//Examples:\nx = 10 + 6; \ny = x * 2;';
const UI_ONLY_INPUT_PARAM_KEYS = new Set(['__open']);
const DIALOG_STYLE_ID = 'history-test-snippet-dialog-styles';
const BUG_REPORT_URL_BASE = 'https://github.com/mmiscool/BREP/issues/new';
const BUG_REPORT_TEMPLATE = 'bug_report.yml';
const FEATURE_PERSISTENT_DATA_KEY_ALLOWLIST = new Map([
  ['S', ['sketch']],
  ['SKETCH', ['sketch']],
  ['SKETCHFEATURE', ['sketch']],
  ['SP', ['spline']],
  ['SPLINE', ['spline']],
  ['SPLINEFEATURE', ['spline']],
  ['NURBS', ['cage', 'editorOptions']],
  ['NURBS FACE SOLID', ['cage', 'editorOptions']],
  ['NURBSFACESOLIDFEATURE', ['cage', 'editorOptions']],
  ['POLY', ['meshData', 'editorOptions']],
  ['POLYGON SOLID', ['meshData', 'editorOptions']],
  ['POLYGONSOLIDFEATURE', ['meshData', 'editorOptions']],
  ['TEXT', ['fontFile', 'fontFileKey', 'embeddedFont']],
  ['TEXT TO FACE', ['fontFile', 'fontFileKey', 'embeddedFont']],
  ['TEXTTOFACEFEATURE', ['fontFile', 'fontFileKey', 'embeddedFont']],
  ['IMPORT3D', ['importCache']],
  ['IMPORT 3D MODEL', ['importCache']],
  ['IMPORT3DMODELFEATURE', ['importCache']],
  ['STL', ['importCache']],
  ['ACOMP', ['componentData']],
  ['ASSY COMPONENT', ['componentData']],
  ['ASSEMBLY COMPONENT', ['componentData']],
  ['ASSEMBLYCOMPONENTFEATURE', ['componentData']],
]);

function sanitizeFunctionName(rawName) {
  const trimmed = String(rawName || '').trim();
  const normalized = trimmed.replace(/[^a-zA-Z0-9_$]+/g, '_');
  if (!normalized) return '';
  if (/^[a-zA-Z_$]/.test(normalized)) return normalized;
  return `test_${normalized}`;
}

function buildGeneratedFunctionName(_viewer) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return sanitizeFunctionName(`test_generated_history_${stamp}`);
}

function sanitizeInputParamsForSnippet(rawParams) {
  const source = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
    ? rawParams
    : {};
  const sanitized: AnyRecord = {};
  if (Object.prototype.hasOwnProperty.call(source, 'id')) {
    sanitized.id = source.id;
  }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'id') continue;
    if (UI_ONLY_INPUT_PARAM_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function hasSerializableSnippetValue(raw) {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'string') return raw.length > 0;
  if (typeof raw !== 'object') return true;
  if (Array.isArray(raw)) return raw.length > 0;
  return Object.keys(raw).length > 0;
}

function extractSnippetPersistentData(featureType, persistentData) {
  const normalizedType = String(featureType || '').trim().toUpperCase();
  const keys = FEATURE_PERSISTENT_DATA_KEY_ALLOWLIST.get(normalizedType);
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const source = (persistentData && typeof persistentData === 'object') ? persistentData : null;
  if (!source) return null;
  const output = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (!hasSerializableSnippetValue(value)) continue;
    output[key] = value;
  }
  return Object.keys(output).length ? output : null;
}

function normalizeSnippetCamState(rawCam) {
  const source = (rawCam && typeof rawCam === 'object' && !Array.isArray(rawCam))
    ? rawCam
    : null;
  if (!source) return null;
  const operations = Array.isArray(source.operations)
    ? source.operations.filter((operation) => operation && typeof operation === 'object')
    : [];
  if (!operations.length) return null;
  const out: AnyRecord = { operations };
  if (source.machineProfile && typeof source.machineProfile === 'object' && !Array.isArray(source.machineProfile)) {
    out.machineProfile = source.machineProfile;
  }
  return out;
}

function stringifyAsCodeLiteral(value, indent = 4) {
  const json = JSON.stringify(value, null, 2);
  if (json == null) return ' null';
  const lines = json.split('\n');
  if (lines.length === 1) return ` ${lines[0]}`;
  const pad = ' '.repeat(Math.max(0, Number(indent) || 0));
  return `\n${lines.map((line) => `${pad}${line}`).join('\n')}`;
}

async function loadSerializableHistory(partHistory) {
  if (!partHistory || typeof partHistory.toJSON !== 'function') {
    return { features: [], expressions: '', configurator: null, cam: null };
  }
  const json = await partHistory.toJSON();
  const parsed = JSON.parse(json || '{}');
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  const expressions = typeof parsed?.expressions === 'string' ? parsed.expressions : '';
  const configurator = (parsed?.configurator && typeof parsed.configurator === 'object' && !Array.isArray(parsed.configurator))
    ? parsed.configurator
    : null;
  const cam = normalizeSnippetCamState(parsed?.cam);
  return { features, expressions, configurator, cam };
}

function buildTestSnippet({ functionName, features, expressions, configurator, cam = null }) {
  const safeFunctionName = sanitizeFunctionName(functionName) || 'test_generated_history';
  const list = Array.isArray(features) ? features : [];
  const camState = normalizeSnippetCamState(cam);
  const camOperationCount = Array.isArray(camState?.operations) ? camState.operations.length : 0;
  const lines = [];

  lines.push(`// Generated from current part history on ${new Date().toISOString()}`);
  lines.push(`// Feature count: ${list.length}`);
  if (camOperationCount > 0) {
    lines.push(`// CAM operation count: ${camOperationCount}`);
  }
  lines.push(`async function ${safeFunctionName}(partHistory = env.partHistory) {`);

  if (typeof expressions === 'string' && expressions.trim().length > 0 && expressions !== DEFAULT_EXPRESSIONS) {
    lines.push(`  partHistory.expressions =${stringifyAsCodeLiteral(expressions, 4)};`);
  }
  if (configurator && typeof configurator === 'object') {
    lines.push(`  partHistory.configurator =${stringifyAsCodeLiteral(configurator, 4)};`);
  }

  if (!list.length) {
    lines.push('  // No features were found in the current history.');
  } else {
    for (let index = 0; index < list.length; index += 1) {
      const feature = list[index] || {};
      const variableName = `feature${index + 1}`;
      const featureType = String(feature?.type || '');
      const inputParams = sanitizeInputParamsForSnippet(feature?.inputParams);
      const persistentData = feature?.persistentData;
      const snippetPersistentData = extractSnippetPersistentData(featureType, persistentData);

      lines.push('');
      lines.push(`  const ${variableName} = await partHistory.newFeature(${JSON.stringify(featureType)});`);

      if (Object.keys(inputParams).length > 0) {
        lines.push(`  Object.assign(${variableName}.inputParams,${stringifyAsCodeLiteral(inputParams, 4)});`);
      }

      if (snippetPersistentData) {
        lines.push(`  ${variableName}.persistentData =${stringifyAsCodeLiteral(snippetPersistentData, 4)};`);
      }
    }
  }

  if (camState) {
    lines.push('');
    lines.push(`  const camState =${stringifyAsCodeLiteral(camState, 4)};`);
    lines.push('  if (partHistory.camPlanManager?.loadSerializable) {');
    lines.push('    partHistory.camPlanManager.loadSerializable(camState);');
    lines.push('  }');
  }

  lines.push('');
  lines.push('  await partHistory.runHistory();');
  lines.push('  return partHistory;');
  lines.push('}');
  lines.push('');
  lines.push(`${safeFunctionName}()`);
  return lines.join('\n');
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return !!copied;
  } catch {
    return false;
  }
}

function buildBugReportUrl(functionName, featureCount) {
  try {
    const issueUrl = new URL(BUG_REPORT_URL_BASE);
    issueUrl.searchParams.set('template', BUG_REPORT_TEMPLATE);
    const count = Number.isFinite(featureCount) ? featureCount : 0;
    const plural = count === 1 ? '' : 's';
    issueUrl.searchParams.set('title', `[Bug]: Repro from ${functionName} (${count} feature${plural})`);
    return issueUrl.toString();
  } catch {
    return `${BUG_REPORT_URL_BASE}?template=${encodeURIComponent(BUG_REPORT_TEMPLATE)}`;
  }
}

function ensureDialogStyles() {
  if (document.getElementById(DIALOG_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DIALOG_STYLE_ID;
  style.textContent = `
    .testsnip-modal { color: #e5e7eb; padding: 6px; width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; }
    .testsnip-hint { font-size: 12px; color: #9aa0aa; }
    .testsnip-text { flex: 1 1 auto; width: 100%; resize: none; background: #06080c; color: #dbe7ff; border: 1px solid #374151; border-radius: 8px; padding: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .testsnip-link { text-decoration: none; }
  `;
  document.head.appendChild(style);
}

function openSnippetDialog({ snippet, functionName, featureCount, copied }) {
  ensureDialogStyles();

  const pageWidth = Number(window?.innerWidth) || 980;
  const pageHeight = Number(window?.innerHeight) || 760;
  const fw = new FloatingWindow({
    title: 'Generated Test Snippet',
    width: Math.max(520, Math.min(940, pageWidth - 32)),
    height: Math.max(420, Math.min(820, Math.round(pageHeight * 0.8))),
    minWidth: 460,
    minHeight: 320,
    modal: true,
    closeOnBackdrop: true,
    closeOnEscape: true,
    onClose: () => {
      try { fw.destroy(); } catch {
        // best effort
      }
    },
  });

  const modal = document.createElement('div');
  modal.className = 'testsnip-modal';

  const hint = document.createElement('div');
  hint.className = 'testsnip-hint';
  hint.textContent = copied
    ? `Copied to clipboard. Function: ${functionName}. Features: ${featureCount}.`
    : `Clipboard copy was unavailable. Function: ${functionName}. Features: ${featureCount}.`;

  const code3 = document.createElement('textarea');
  code3.id = 'code3';
  code3.className = 'testsnip-text';
  code3.value = String(snippet || '');
  code3.readOnly = true;

  const issueLink = document.createElement('a');
  issueLink.className = 'fw-btn testsnip-link';
  issueLink.textContent = 'Open GitHub Issue';
  issueLink.href = buildBugReportUrl(functionName, featureCount);
  issueLink.target = '_blank';
  issueLink.rel = 'noopener noreferrer';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'fw-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyTextToClipboard(code3.value);
    hint.textContent = ok
      ? `Copied to clipboard. Function: ${functionName}. Features: ${featureCount}.`
      : 'Clipboard copy failed. Use Ctrl/Cmd+C in the textbox.';
  });

  fw.addHeaderAction(issueLink);
  fw.addHeaderAction(copyBtn);
  modal.appendChild(hint);
  modal.appendChild(code3);
  fw.content.appendChild(modal);

  try {
    code3.focus();
    code3.select();
  } catch {
    // best effort
  }
}

export function createHistoryTestSnippetButton(viewer) {
  if (!viewer) return null;
  return {
    label: '🪲',
    title: 'Generate a test snippet from current feature history',
    onClick: async () => {
      try {
        const snapshot = await loadSerializableHistory(viewer?.partHistory);
        const functionName = buildGeneratedFunctionName(viewer);
        const snippet = buildTestSnippet({
          functionName,
          features: snapshot.features,
          expressions: snapshot.expressions,
          configurator: snapshot.configurator,
          cam: snapshot.cam,
        });
        const copied = await copyTextToClipboard(snippet);
        try { window.__generatedHistoryTestSnippet = snippet; } catch {
          // best effort
        }
        openSnippetDialog({
          snippet,
          functionName,
          featureCount: snapshot.features.length,
          copied,
        });
      } catch (error) {
        console.error('[HistoryTestSnippet] Failed to generate snippet:', error);
        alert('Failed to generate test snippet. See console for details.');
      }
    },
  };
}

export {
  buildTestSnippet,
};
