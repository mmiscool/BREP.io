function emptyAnnotations() {
  return [];
}

function normalizeFeatureDimensionFeatureKey(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase();
}

const FEATURE_DIMENSION_DESCRIPTORS = new Map();

function registerFeatureDimensionDescriptor(descriptor = {}) {
  const featureKey = normalizeFeatureDimensionFeatureKey(descriptor.featureKey);
  if (!featureKey) return null;

  const normalized = {
    ...descriptor,
    featureKey,
    supportsTransformDimensionToggle: descriptor.supportsTransformDimensionToggle !== false,
    buildAnnotations: typeof descriptor.buildAnnotations === 'function'
      ? descriptor.buildAnnotations
      : emptyAnnotations,
  };
  FEATURE_DIMENSION_DESCRIPTORS.set(featureKey, normalized);
  return normalized;
}

function getFeatureDimensionDescriptor(featureKey) {
  return FEATURE_DIMENSION_DESCRIPTORS.get(normalizeFeatureDimensionFeatureKey(featureKey)) || null;
}

export function supportsFeatureDimensionFeatureKey(featureKey) {
  return !!getFeatureDimensionDescriptor(featureKey);
}

export function supportsTransformDimensionToggle(featureKey) {
  const descriptor = getFeatureDimensionDescriptor(featureKey);
  return !!descriptor?.supportsTransformDimensionToggle;
}

export function buildFeatureDimensionAnnotations(context = {}) {
  const descriptor = getFeatureDimensionDescriptor(context.featureKey);
  if (!descriptor) return [];
  const annotations = descriptor.buildAnnotations(context);
  return Array.isArray(annotations) ? annotations : [];
}

function callBuilder(context, methodName, values = []) {
  const method = context?.builder?.[methodName];
  return typeof method === 'function' ? method.apply(context.builder, values) : [];
}

function registerDefaultFeatureDimensionDescriptors() {
  registerFeatureDimensionDescriptor({
    featureKey: 'P.CU',
    buildAnnotations: (context) => callBuilder(context, 'buildCubeAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'P.CY',
    buildAnnotations: (context) => callBuilder(context, 'buildCylinderAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'P.CO',
    buildAnnotations: (context) => callBuilder(context, 'buildConeAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'P.S',
    buildAnnotations: (context) => callBuilder(context, 'buildSphereAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'P.PY',
    buildAnnotations: (context) => callBuilder(context, 'buildPyramidAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'P.T',
    buildAnnotations: (context) => callBuilder(context, 'buildTorusAnnotations', [context.params, context.matrix, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'E',
    buildAnnotations: (context) => callBuilder(context, 'buildExtrudeAnnotations', [context.params, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'R',
    buildAnnotations: (context) => callBuilder(context, 'buildRevolveAnnotations', [context.params, context.entryId]),
  });
  registerFeatureDimensionDescriptor({
    featureKey: 'PORT',
    buildAnnotations: (context) => callBuilder(context, 'buildPortAnnotations', [context.params, context.entryId, context.entry]),
  });
}

registerDefaultFeatureDimensionDescriptors();
