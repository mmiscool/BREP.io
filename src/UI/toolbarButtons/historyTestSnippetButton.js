const DEFAULT_EXPRESSIONS = '//Examples:\nx = 10 + 6; \ny = x * 2;';
const UI_ONLY_INPUT_PARAM_KEYS = new Set(['__open']);
const DIALOG_STYLE_ID = 'history-test-snippet-dialog-styles';
const BUG_REPORT_URL_BASE = 'https://github.com/mmiscool/BREP/issues/new';
const BUG_REPORT_TEMPLATE = 'bug_report.yml';

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
  const sanitized = {};
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

function hasSerializablePersistentData(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (Array.isArray(raw)) return raw.length > 0;
  return Object.keys(raw).length > 0;
}

function extractSketchPersistentData(featureType, persistentData) {
  const normalizedType = String(featureType || '').trim().toUpperCase();
  if (normalizedType !== 'S') return null;
  const source = (persistentData && typeof persistentData === 'object') ? persistentData : null;
  const sketch = source?.sketch;
  if (!hasSerializablePersistentData(sketch)) return null;
  return { sketch };
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
    return { features: [], expressions: '' };
  }
  const json = await partHistory.toJSON();
  const parsed = JSON.parse(json || '{}');
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  const expressions = typeof parsed?.expressions === 'string' ? parsed.expressions : '';
  return { features, expressions };
}

function buildTestSnippet({ functionName, features, expressions }) {
  const safeFunctionName = sanitizeFunctionName(functionName) || 'test_generated_history';
  const list = Array.isArray(features) ? features : [];
  const lines = [];

  lines.push(`// Generated from current part history on ${new Date().toISOString()}`);
  lines.push(`// Feature count: ${list.length}`);
  lines.push(`async function ${safeFunctionName}(partHistory = env.partHistory) {`);

  if (typeof expressions === 'string' && expressions.trim().length > 0 && expressions !== DEFAULT_EXPRESSIONS) {
    lines.push(`  partHistory.expressions =${stringifyAsCodeLiteral(expressions, 4)};`);
  }

  if (!list.length) {
    lines.push('  // No features were found in the current history.');
    lines.push('  partHistory.runHistory()');
    lines.push('  return partHistory;');
    lines.push('}');
    lines.push('');
    lines.push(`${safeFunctionName}()`);
    return lines.join('\n');
  }

  for (let index = 0; index < list.length; index += 1) {
    const feature = list[index] || {};
    const variableName = `feature${index + 1}`;
    const featureType = String(feature?.type || '');
    const inputParams = sanitizeInputParamsForSnippet(feature?.inputParams);
    const persistentData = feature?.persistentData;
    const sketchPersistentData = extractSketchPersistentData(featureType, persistentData);

    lines.push('');
    lines.push(`  const ${variableName} = await partHistory.newFeature(${JSON.stringify(featureType)});`);

    if (Object.keys(inputParams).length > 0) {
      lines.push(`  Object.assign(${variableName}.inputParams,${stringifyAsCodeLiteral(inputParams, 4)});`);
    }

    if (sketchPersistentData) {
      lines.push(`  ${variableName}.persistentData =${stringifyAsCodeLiteral(sketchPersistentData, 4)};`);
    }
  }

  lines.push('');
  lines.push('  partHistory.runHistory()');
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
    .testsnip-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; z-index: 30; }
    .testsnip-modal { background: #0b0e14; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; width: min(940px, calc(100vw - 32px)); height: min(80vh, 820px); box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 8px; }
    .testsnip-title { font-size: 14px; font-weight: 700; }
    .testsnip-hint { font-size: 12px; color: #9aa0aa; }
    .testsnip-text { flex: 1 1 auto; width: 100%; resize: none; background: #06080c; color: #dbe7ff; border: 1px solid #374151; border-radius: 8px; padding: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .testsnip-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .testsnip-btn { background: rgba(255,255,255,.03); color: #f9fafb; border: 1px solid #374151; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1; }
    .testsnip-btn:hover { border-color: #3b82f6; background: rgba(59,130,246,.12); }
    .testsnip-link { text-decoration: none; display: inline-flex; align-items: center; }
  `;
  document.head.appendChild(style);
}

function openSnippetDialog({ snippet, functionName, featureCount, copied }) {
  ensureDialogStyles();
  const overlay = document.createElement('div');
  overlay.className = 'testsnip-overlay';

  const modal = document.createElement('div');
  modal.className = 'testsnip-modal';

  const title = document.createElement('div');
  title.className = 'testsnip-title';
  title.textContent = 'Generated Test Snippet';

  const hint = document.createElement('div');
  hint.className = 'testsnip-hint';
  hint.textContent = copied
    ? `Copied to clipboard. Function: ${functionName}. Features: ${featureCount}.`
    : `Clipboard copy was unavailable. Function: ${functionName}. Features: ${featureCount}.`;

  const text = document.createElement('textarea');
  text.className = 'testsnip-text';
  text.value = String(snippet || '');
  text.readOnly = true;

  const actions = document.createElement('div');
  actions.className = 'testsnip-actions';

  const issueLink = document.createElement('a');
  issueLink.className = 'testsnip-btn testsnip-link';
  issueLink.textContent = 'Open GitHub Issue';
  issueLink.href = buildBugReportUrl(functionName, featureCount);
  issueLink.target = '_blank';
  issueLink.rel = 'noopener noreferrer';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'testsnip-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyTextToClipboard(text.value);
    hint.textContent = ok
      ? `Copied to clipboard. Function: ${functionName}. Features: ${featureCount}.`
      : 'Clipboard copy failed. Use Ctrl/Cmd+C in the textbox.';
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'testsnip-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    try { document.body.removeChild(overlay); } catch { /* ignore */ }
  });

  actions.appendChild(issueLink);
  actions.appendChild(copyBtn);
  actions.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(hint);
  modal.appendChild(text);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  overlay.addEventListener('click', (event) => {
    if (event.target !== overlay) return;
    try { document.body.removeChild(overlay); } catch { /* ignore */ }
  });

  document.body.appendChild(overlay);

  try {
    text.focus();
    text.select();
  } catch { /* ignore */ }
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
        });
        const copied = await copyTextToClipboard(snippet);
        try { window.__generatedHistoryTestSnippet = snippet; } catch { /* ignore */ }
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
