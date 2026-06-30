const CONFIGURATOR_WIDGET_TYPES = new Set(['slider', 'number', 'select', 'string']);
const CONFIGURATOR_FIELD_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

type ConfiguratorFieldType = 'slider' | 'number' | 'select' | 'string';

type ConfiguratorField = {
  name: string;
  label: string;
  type: ConfiguratorFieldType;
  min?: number | null;
  max?: number | null;
  step?: number;
  options?: string[];
  defaultValue?: number | string;
};

type ConfiguratorState = {
  fields: ConfiguratorField[];
  values: Record<string, number | string>;
};

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const next = String(value ?? '').trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

export function createEmptyConfiguratorState(): ConfiguratorState {
  return {
    fields: [],
    values: {},
  };
}

export function isConfiguratorFieldNameValid(name) {
  return CONFIGURATOR_FIELD_NAME_RE.test(String(name ?? '').trim());
}

export function prettyConfiguratorLabel(name) {
  const text = String(name ?? '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Field';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeConfiguratorFieldName(rawName, index = 0, usedNames = new Set()) {
  let next = String(rawName ?? '').trim();
  next = next.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_$]/g, '_').replace(/_+/g, '_');
  if (!next) next = `field${index + 1}`;
  if (!/^[A-Za-z_$]/.test(next)) next = `_${next}`;
  if (!CONFIGURATOR_FIELD_NAME_RE.test(next)) next = `field${index + 1}`;

  let unique = next;
  let suffix = 2;
  while (usedNames.has(unique)) {
    unique = `${next}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(unique);
  return unique;
}

export function parseConfiguratorOptions(rawOptions) {
  if (Array.isArray(rawOptions)) return uniqueStrings(rawOptions);
  if (typeof rawOptions !== 'string') return [];
  return uniqueStrings(rawOptions.split(/\r?\n|,/g));
}

function normalizeConfiguratorType(rawType) {
  const next = String(rawType ?? '').trim().toLowerCase();
  if (next === 'options' || next === 'dropdown') return 'select';
  return CONFIGURATOR_WIDGET_TYPES.has(next) ? next as ConfiguratorFieldType : 'number';
}

export function normalizeConfiguratorValue(field, rawValue) {
  const type = String(field?.type ?? '').trim().toLowerCase();

  if (type === 'slider' || type === 'number') {
    let num = toFiniteNumber(rawValue, toFiniteNumber(field?.defaultValue, 0));
    const min = toFiniteNumber(field?.min, null);
    const max = toFiniteNumber(field?.max, null);
    if (Number.isFinite(min)) num = Math.max(min, num);
    if (Number.isFinite(max)) num = Math.min(max, num);
    return num;
  }

  if (type === 'select') {
    const options = Array.isArray(field?.options) ? uniqueStrings(field.options) : [];
    if (!options.length) return '';
    const raw = String(rawValue ?? field?.defaultValue ?? options[0] ?? '');
    return options.includes(raw) ? raw : options[0];
  }

  return String(rawValue ?? field?.defaultValue ?? '');
}

export function normalizeConfiguratorState(rawState) {
  const out = createEmptyConfiguratorState();
  const rawFields = Array.isArray(rawState?.fields) ? rawState.fields : [];
  const rawValues = (rawState?.values && typeof rawState.values === 'object' && !Array.isArray(rawState.values))
    ? rawState.values
    : {};
  const usedNames = new Set();

  for (let index = 0; index < rawFields.length; index += 1) {
    const rawField = rawFields[index] && typeof rawFields[index] === 'object'
      ? rawFields[index]
      : {};
    const type = normalizeConfiguratorType(rawField.type);
    const name = normalizeConfiguratorFieldName(
      rawField.name ?? rawField.key ?? rawField.fieldName,
      index,
      usedNames,
    );

    const field: ConfiguratorField = {
      name,
      label: String(rawField.label ?? '').trim() || prettyConfiguratorLabel(name),
      type,
    };

    if (type === 'slider' || type === 'number') {
      let min = toFiniteNumber(rawField.min, type === 'slider' ? 0 : null);
      let max = toFiniteNumber(rawField.max, type === 'slider' ? 100 : null);
      if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        const swap = min;
        min = max;
        max = swap;
      }
      let step = toFiniteNumber(rawField.step, 1);
      if (!Number.isFinite(step) || step <= 0) step = 1;
      field.min = min;
      field.max = max;
      field.step = step;
      field.defaultValue = normalizeConfiguratorValue(field, rawField.defaultValue ?? rawField.value);
    } else if (type === 'select') {
      field.options = parseConfiguratorOptions(rawField.options);
      if (!field.options.length) field.options = ['Option'];
      field.defaultValue = normalizeConfiguratorValue(field, rawField.defaultValue ?? rawField.value);
    } else {
      field.defaultValue = String(rawField.defaultValue ?? rawField.value ?? '');
    }

    const rawValue = Object.prototype.hasOwnProperty.call(rawValues, name)
      ? rawValues[name]
      : field.defaultValue;
    out.fields.push(field);
    out.values[name] = normalizeConfiguratorValue(field, rawValue);
  }

  return out;
}
