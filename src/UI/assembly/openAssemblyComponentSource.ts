import { SelectionFilter } from '../SelectionFilter.js';

function normalizeSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (value === 'github' || value === 'gh') return 'github';
  if (value === 'mounted' || value === 'mount') return 'mounted';
  return 'local';
}

function normalizePath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  const out = [];
  for (const part of raw.split('/')) {
    const token = String(part || '').trim();
    if (!token || token === '.' || token === '..') continue;
    out.push(token);
  }
  return out.join('/');
}

function getFeatureId(feature) {
  const raw = feature?.inputParams?.featureID ?? feature?.inputParams?.id ?? feature?.id ?? null;
  const value = raw == null ? '' : String(raw).trim();
  return value || '';
}

export function findOwningAssemblyComponent(selection, viewer) {
  const items = Array.isArray(selection) ? selection : (selection ? [selection] : []);
  if (!items.length) return null;

  const findComponent = (obj) => {
    if (!obj) return null;
    if (viewer && typeof viewer._findOwningComponent === 'function') {
      try {
        const found = viewer._findOwningComponent(obj);
        if (found) return found;
      } catch { /* ignore */ }
    }
    let cur = obj;
    while (cur) {
      if (cur.isAssemblyComponent || String(cur.type || '').toUpperCase() === SelectionFilter.COMPONENT) return cur;
      cur = cur.parent || null;
    }
    return null;
  };

  let component = null;
  for (const item of items) {
    const obj = item?.object || item?.target || item;
    const owning = findComponent(obj);
    if (!owning) return null;
    if (!component) component = owning;
    else if (component !== owning) return null;
  }
  return component;
}

export function findAssemblyComponentFeatureForComponent(component, viewer) {
  const partHistory = viewer?.partHistory || null;
  const features = Array.isArray(partHistory?.features) ? partHistory.features : [];
  if (!component || !features.length) return null;

  const componentFeatureId = String(component.owningFeatureID || component.userData?.owningFeatureID || '').trim();
  const source = component.userData?.componentSource || {};
  const sourcePath = normalizePath(source.path || source.name || '');

  return features.find((feature) => {
    const featureId = getFeatureId(feature);
    if (componentFeatureId && featureId === componentFeatureId) return true;
    const data = feature?.persistentData?.componentData || {};
    const dataPath = normalizePath(data.path || data.name || feature?.inputParams?.componentName || '');
    return !!sourcePath && dataPath === sourcePath;
  }) || null;
}

export function getAssemblyComponentSource(featureOrComponent, viewer = null) {
  const feature = featureOrComponent?.persistentData
    ? featureOrComponent
    : findAssemblyComponentFeatureForComponent(featureOrComponent, viewer);
  const data = feature?.persistentData?.componentData || {};
  const params = feature?.inputParams || {};
  const path = normalizePath(data.path || data.name || params.componentName || '');
  if (!path) return null;
  return {
    source: normalizeSource(data.source || featureOrComponent?.userData?.componentSource?.source),
    path,
    repoFull: String(data.repoFull || featureOrComponent?.userData?.componentSource?.repoFull || '').trim(),
    branch: String(data.branch || featureOrComponent?.userData?.componentSource?.branch || '').trim(),
  };
}

export function buildAssemblyComponentSourceUrl(sourceInfo, baseHref = null) {
  const path = normalizePath(sourceInfo?.path || '');
  if (!path) return '';
  const url = new URL('cad.html', baseHref || window.location.href);
  const source = normalizeSource(sourceInfo?.source);
  if (source === 'github') {
    const repoFull = normalizePath(sourceInfo?.repoFull || '');
    url.searchParams.set('path', repoFull ? `github/${repoFull}/${path}` : `github/${path}`);
  } else if (source === 'mounted') {
    const mountId = encodeURIComponent(String(sourceInfo?.repoFull || '').trim());
    url.searchParams.set('path', mountId ? `mounted/${mountId}/${path}` : `mounted/${path}`);
  } else {
    url.searchParams.set('path', path);
  }
  if (sourceInfo?.branch) url.searchParams.set('branch', String(sourceInfo.branch));
  return url.toString();
}

export function openAssemblyComponentSource(featureOrComponent, viewer = null) {
  const sourceInfo = getAssemblyComponentSource(featureOrComponent, viewer);
  const url = buildAssemblyComponentSourceUrl(sourceInfo);
  if (!url) {
    viewer?._toast?.('No saved source part found for this component.');
    return false;
  }
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) {
      try { opened.opener = null; } catch { /* ignore */ }
    }
    return true;
  } catch {
    viewer?._toast?.('Unable to open component source.');
    return false;
  }
}
