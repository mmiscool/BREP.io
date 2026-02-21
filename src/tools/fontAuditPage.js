const SAMPLE_FOX = 'The quick brown fox jumps over the lazy dog';
const SAMPLE_DIGITS = '0123456789';

const FONT_URLS = import.meta.glob('../assets/fonts/**/*.{ttf,otf,woff,woff2,ttc}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const cssEscapeValue = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const extFromPath = (path) => {
  const m = String(path || '').toLowerCase().match(/\.([^.]+)$/);
  return m ? m[1] : '';
};

const formatHintFromExt = (path) => {
  const ext = extFromPath(path);
  if (ext === 'ttf') return 'truetype';
  if (ext === 'otf') return 'opentype';
  if (ext === 'woff') return 'woff';
  if (ext === 'woff2') return 'woff2';
  if (ext === 'ttc') return 'truetype';
  return '';
};

const prettyNameFromPath = (relPath) => {
  const base = String(relPath || '')
    .split('/')
    .pop() || '';
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeRelPath = (key) => String(key || '').replace(/^..\/assets\/fonts\//, '').replace(/\\/g, '/');

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const compareByName = (a, b) => {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' });
};

const compareBySize = (a, b, descending) => {
  const aKnown = Number.isFinite(a.sizeBytes);
  const bKnown = Number.isFinite(b.sizeBytes);

  if (aKnown && bKnown) {
    const diff = a.sizeBytes - b.sizeBytes;
    if (diff !== 0) return descending ? -diff : diff;
  }

  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  return compareByName(a, b);
};

const sortEntriesInPlace = (entries, sortMode) => {
  entries.sort((a, b) => {
    if (sortMode === 'name-desc') return -compareByName(a, b);
    if (sortMode === 'size-desc') return compareBySize(a, b, true);
    if (sortMode === 'size-asc') return compareBySize(a, b, false);
    return compareByName(a, b);
  });
};

const fetchFontSizeBytes = async (url) => {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
    if (head.ok) {
      const len = Number(head.headers.get('content-length'));
      if (Number.isFinite(len) && len > 0) return len;
    }
  } catch {
    // Fall through to GET.
  }

  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return buf.byteLength;
};

const mapLimit = async (items, limit, mapper) => {
  const maxWorkers = Math.max(1, Math.min(limit, items.length || 1));
  let nextIndex = 0;
  const workers = Array.from({ length: maxWorkers }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
};

const createFontEntries = () => {
  const entries = Object.entries(FONT_URLS).map(([key, url], idx) => {
    const relPath = normalizeRelPath(key);
    return {
      idx,
      relPath,
      url,
      name: prettyNameFromPath(relPath),
      sizeBytes: null,
      sizeText: 'loading...',
      familyName: `__font_audit_${idx}`,
      rowEl: null,
      checkboxEl: null,
      sizeEl: null,
    };
  });
  return entries;
};

const injectFontFaces = (entries) => {
  const style = document.createElement('style');
  const css = entries
    .map((entry) => {
      const family = cssEscapeValue(entry.familyName);
      const url = cssEscapeValue(entry.url);
      const format = formatHintFromExt(entry.relPath);
      const formatPart = format ? ` format("${format}")` : '';
      return `@font-face{font-family:"${family}";src:url("${url}")${formatPart};font-display:swap;}`;
    })
    .join('\n');
  style.textContent = css;
  document.head.appendChild(style);
};

const buildRow = (entry) => {
  const row = document.createElement('article');
  row.className = 'font-row';

  const head = document.createElement('div');
  head.className = 'font-row-head';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  checkbox.setAttribute('aria-label', `Select ${entry.name}`);
  head.appendChild(checkbox);

  const labelWrap = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'font-row-name';
  nameEl.textContent = entry.name || entry.relPath;
  const metaEl = document.createElement('div');
  metaEl.className = 'font-row-meta';
  metaEl.textContent = entry.relPath;
  labelWrap.appendChild(nameEl);
  labelWrap.appendChild(metaEl);
  head.appendChild(labelWrap);

  const sizeEl = document.createElement('div');
  sizeEl.className = 'font-row-size';
  sizeEl.textContent = 'loading...';
  head.appendChild(sizeEl);

  row.appendChild(head);

  const sample = document.createElement('div');
  sample.className = 'font-sample';
  sample.style.fontFamily = `"${entry.familyName}", ui-sans-serif, system-ui, sans-serif`;

  const foxEl = document.createElement('div');
  foxEl.className = 'font-sample-fox';
  foxEl.textContent = SAMPLE_FOX;
  sample.appendChild(foxEl);

  const digitsEl = document.createElement('div');
  digitsEl.className = 'font-sample-digits';
  digitsEl.textContent = SAMPLE_DIGITS;
  sample.appendChild(digitsEl);

  row.appendChild(sample);

  entry.rowEl = row;
  entry.checkboxEl = checkbox;
  entry.sizeEl = sizeEl;
  return row;
};

const renderRows = (entries, listEl) => {
  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    if (entry.rowEl) frag.appendChild(entry.rowEl);
  }
  listEl.appendChild(frag);
};

const updateStatus = (entries, statusEl) => {
  const selected = entries.filter((entry) => entry.checkboxEl?.checked).length;
  const knownSizes = entries.filter((entry) => Number.isFinite(entry.sizeBytes));
  const totalKnown = knownSizes.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  statusEl.textContent = `${entries.length} fonts • ${selected} selected • known size ${formatBytes(totalKnown)}`;
};

const applyVisibilityFilter = (entries, searchTerm, selectedOnly) => {
  const query = String(searchTerm || '').trim().toLowerCase();
  for (const entry of entries) {
    const matchesQuery =
      !query ||
      entry.name.toLowerCase().includes(query) ||
      entry.relPath.toLowerCase().includes(query);
    const matchesSelected = !selectedOnly || !!entry.checkboxEl?.checked;
    const visible = matchesQuery && matchesSelected;
    entry.rowEl?.classList.toggle('hidden', !visible);
  }
};

const buildSelectedListText = (entries) => {
  const selected = entries.filter((entry) => entry.checkboxEl?.checked);
  const knownTotal = selected.reduce(
    (sum, entry) => sum + (Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0),
    0
  );

  const lines = [];
  lines.push(`Selected fonts: ${selected.length}`);
  lines.push(`Known total size: ${formatBytes(knownTotal)}`);
  lines.push('');
  lines.push('Path\tSize');

  for (const entry of selected) {
    lines.push(`${entry.relPath}\t${formatBytes(entry.sizeBytes)}`);
  }

  return lines.join('\n');
};

const loadFontSizes = async (entries, statusEl) => {
  let completed = 0;
  await mapLimit(entries, 8, async (entry) => {
    try {
      entry.sizeBytes = await fetchFontSizeBytes(entry.url);
      entry.sizeText = formatBytes(entry.sizeBytes);
    } catch {
      entry.sizeBytes = null;
      entry.sizeText = 'size unavailable';
    }
    if (entry.sizeEl) entry.sizeEl.textContent = entry.sizeText;
    completed += 1;
    if (statusEl) {
      statusEl.textContent = `Loading sizes... ${completed}/${entries.length}`;
    }
  });
};

const initFontAuditPage = () => {
  const listEl = document.getElementById('font-list');
  const statusEl = document.getElementById('font-audit-status');
  const outputEl = document.getElementById('font-selection-output');
  const selectAllBtn = document.getElementById('btn-select-all');
  const clearAllBtn = document.getElementById('btn-clear-all');
  const generateBtn = document.getElementById('btn-generate-list');
  const copyBtn = document.getElementById('btn-copy-list');
  const filterInput = document.getElementById('font-filter');
  const sortInput = document.getElementById('font-sort');
  const showSelectedOnlyInput = document.getElementById('show-selected-only');

  if (!listEl || !statusEl || !outputEl || !selectAllBtn || !clearAllBtn || !generateBtn || !copyBtn || !filterInput || !sortInput || !showSelectedOnlyInput) {
    return;
  }

  const entries = createFontEntries();
  injectFontFaces(entries);

  const refreshStatus = () => updateStatus(entries, statusEl);
  const refreshFilter = () =>
    applyVisibilityFilter(entries, filterInput.value, !!showSelectedOnlyInput.checked);
  const refreshSort = () => {
    sortEntriesInPlace(entries, sortInput.value || 'name-asc');
    renderRows(entries, listEl);
  };

  for (const entry of entries) {
    const row = buildRow(entry);
    listEl.appendChild(row);
    entry.checkboxEl?.addEventListener('change', () => {
      refreshStatus();
      refreshFilter();
    });
  }

  selectAllBtn.addEventListener('click', () => {
    for (const entry of entries) {
      if (entry.checkboxEl) entry.checkboxEl.checked = true;
    }
    refreshStatus();
    refreshFilter();
  });

  clearAllBtn.addEventListener('click', () => {
    for (const entry of entries) {
      if (entry.checkboxEl) entry.checkboxEl.checked = false;
    }
    refreshStatus();
    refreshFilter();
  });

  generateBtn.addEventListener('click', () => {
    outputEl.value = buildSelectedListText(entries);
  });

  copyBtn.addEventListener('click', async () => {
    const text = outputEl.value || '';
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy List';
      }, 1000);
    } catch {
      copyBtn.textContent = 'Copy Failed';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy List';
      }, 1200);
    }
  });

  filterInput.addEventListener('input', refreshFilter);
  showSelectedOnlyInput.addEventListener('change', refreshFilter);
  sortInput.addEventListener('change', () => {
    refreshSort();
    refreshFilter();
  });

  refreshSort();
  refreshStatus();
  refreshFilter();

  loadFontSizes(entries, statusEl)
    .catch(() => {
      statusEl.textContent = 'Loaded fonts with partial size info.';
    })
    .finally(() => {
      refreshSort();
      refreshStatus();
    });
};

initFontAuditPage();
