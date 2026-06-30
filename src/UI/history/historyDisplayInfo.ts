import { constraintStatusInfo } from '../assembly/constraintStatusUtils.js';

type AnyRecord = Record<string, any>;
type StatusInfo = {
  label?: string;
  title?: string;
  color?: string;
  error?: boolean;
  running?: boolean;
};
type ResolveStatusOptions = {
  isRunning?: boolean;
};
type ResolveHistoryDisplayInfoOptions = {
  history?: AnyRecord | null;
  index?: number;
};
export type HistoryDisplayInfo = {
  name: string;
  id: string;
  statusText: string;
  statusTitle: string;
  statusColor: string;
  badge: string;
  isRunning: boolean;
  hasError: boolean;
};

function firstString(value: unknown): string {
  if (value == null && value !== 0) return '';
  const str = String(value).trim();
  return str;
}

function formatDuration(ms: unknown): string {
  if (!Number.isFinite(ms)) return '';
  const numeric = Number(ms);
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(2)} s`;
  return `${Math.round(numeric)} ms`;
}

export function resolveEntryId(entry: AnyRecord | null | undefined, index = 0): string {
  const fallbackId = `entry-${index}`;
  const params = entry?.inputParams || {};
  if (params.id != null) return String(params.id);
  if (params.featureID != null) return String(params.featureID);
  if (params.constraintID != null) return String(params.constraintID);
  if (entry?.featureID != null) return String(entry.featureID);
  if (entry?.id != null) return String(entry.id);
  return fallbackId;
}

function resolveEntityClass(entry: AnyRecord | null | undefined, history: AnyRecord | null = null) {
  const type =
    entry?.type ||
    entry?.entityType ||
    entry?.constraintType ||
    entry?.inputParams?.type ||
    null;
  let foundInRegistry = false;
  if (!type) return { entityClass: entry?.constraintClass || entry?.constructor || null, foundInRegistry };

  const registry = history?.registry || history?.featureRegistry || null;
  if (registry) {
    if (typeof registry.resolve === 'function') {
      const resolved = registry.resolve(type);
      if (resolved) return { entityClass: resolved, foundInRegistry: true };
    }
    if (typeof registry.getSafe === 'function') {
      const resolved = registry.getSafe(type) || registry.get?.(type);
      if (resolved) return { entityClass: resolved, foundInRegistry: true };
    }
    if (registry.entityClasses instanceof Map) {
      const mapValue = registry.entityClasses.get(type);
      if (mapValue) return { entityClass: mapValue, foundInRegistry: true };
      for (const value of registry.entityClasses.values()) {
        if (!value) continue;
        if (
          value.entityType === type ||
          value.shortName === type ||
          value.type === type
        ) return { entityClass: value, foundInRegistry: true };
      }
    }
  }
  return { entityClass: entry?.constraintClass || entry?.constructor || null, foundInRegistry };
}

function resolveStatus(
  entry: AnyRecord | null | undefined,
  { isRunning = false }: ResolveStatusOptions = {},
): StatusInfo {
  if (isRunning) {
    return {
      label: 'Running...',
      title: 'Currently executing',
      color: '#6ea8fe',
      error: false,
      running: true,
    };
  }

  if (entry?.lastRun) {
    const duration = entry.lastRun.durationMs;
    const parts = [];
    const label = formatDuration(duration);
    if (label) parts.push(label);
    if (entry.lastRun.ok === false) {
      parts.push('Error');
      const title = firstString(
        entry.lastRun.errorMessage
        || entry.lastRun.message
        || entry.lastRun.error
        || 'Last run failed.'
      );
      return {
        label: parts.join(' ').trim() || 'Error',
        title,
        color: '#ef4444',
        error: true,
        running: false,
      };
    }
    return {
      label: parts.join(' ').trim(),
      error: false,
      running: false,
    };
  }

  if (entry?.persistentData || entry?.constraintClass) {
    try {
      const info = (constraintStatusInfo(entry) || {}) as StatusInfo;
      return {
        label: info.label || '',
        title: info.title || '',
        color: info.color || '',
        error: Boolean(info.error),
        running: false,
      };
    } catch {
      return { label: '', title: '', running: false };
    }
  }

  return { label: '', running: false };
}

export function resolveHistoryDisplayInfo(entry, {
  history = null,
  index = 0,
}: ResolveHistoryDisplayInfoOptions = {}): HistoryDisplayInfo {
  const { entityClass, foundInRegistry } = resolveEntityClass(entry, history);
  const resolvedType =
    entry?.type ||
    entry?.entityType ||
    entry?.constraintType ||
    entry?.inputParams?.type ||
    '';
  const longName = firstString(
    entityClass?.longName ||
    entityClass?.constraintName ||
    entityClass?.displayName ||
    entityClass?.name ||
    entry?.type ||
    entry?.entityType ||
    ''
  );
  const shortName = firstString(
    entityClass?.shortName ||
    entityClass?.constraintShortName ||
    entityClass?.entityType ||
    entityClass?.type ||
    entry?.type ||
    entry?.entityType ||
    ''
  );
  const id = resolveEntryId(entry, index);
  const runningFeatureId = history?.runningFeatureId != null ? String(history.runningFeatureId) : null;
  const isRunning = runningFeatureId != null && String(id) === runningFeatureId;
  const status = resolveStatus(entry, { isRunning });

  return {
    name: longName || shortName || `Item ${index + 1}`,
    id,
    statusText: status.label || '',
    statusTitle: status.title || '',
    statusColor: status.color || '',
    badge: '',
    isRunning: Boolean(status.running || isRunning),
    hasError: Boolean(status.error || (!foundInRegistry && !!resolvedType)),
  };
}
