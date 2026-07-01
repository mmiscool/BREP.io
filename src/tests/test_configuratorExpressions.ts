import { PartHistory } from '../PartHistory.js';

export async function test_configurator_expressions(partHistory) {
  partHistory.configurator = {
    fields: [
      { name: 'width', label: 'Width', type: 'slider', defaultValue: 42, min: 0, max: 100, step: 1 },
      { name: 'label', label: 'Label', type: 'string', defaultValue: 'BREP' },
      { name: 'mode', label: 'Mode', type: 'select', defaultValue: 'draft', options: ['draft', 'final'] },
    ],
    values: {
      width: 42,
      label: 'BREP',
      mode: 'draft',
    },
  };
  partHistory.expressions = 'doubleWidth = configurator.width * 2;\ncaption = configurator.label + "-" + configurator.mode;';

  const numericValue = partHistory.evaluateExpression('configurator.width + 8');
  if (numericValue !== 50) {
    throw new Error(`[configurator_expressions] Expected configurator.width + 8 to equal 50, got ${numericValue}`);
  }

  const captionValue = partHistory.evaluateExpression('caption');
  if (captionValue !== 'BREP-draft') {
    throw new Error(`[configurator_expressions] Expected caption to equal "BREP-draft", got ${captionValue}`);
  }

  const sanitized = await partHistory.sanitizeInputParams({
    distance: { type: 'number', default_value: 0 },
    title: { type: 'string', allowExpression: true, default_value: '' },
  }, {
    distance: 'configurator.width * 2',
    title: 'configurator.label + "-" + configurator.mode',
  });

  if (sanitized.distance !== 84) {
    throw new Error(`[configurator_expressions] Expected sanitized distance to equal 84, got ${sanitized.distance}`);
  }
  if (sanitized.title !== 'BREP-draft') {
    throw new Error(`[configurator_expressions] Expected sanitized title to equal "BREP-draft", got ${sanitized.title}`);
  }

  const json = await partHistory.toJSON();
  const parsed = JSON.parse(json || '{}');
  if (parsed?.configurator?.values?.width !== 42) {
    throw new Error('[configurator_expressions] Configurator values were not serialized into part history JSON');
  }

  const restored = new PartHistory();
  await restored.fromJSON(json);
  const restoredValue = restored.evaluateExpression('configurator.width + 8');
  if (restoredValue !== 50) {
    throw new Error(`[configurator_expressions] Expected restored configurator.width + 8 to equal 50, got ${restoredValue}`);
  }
}
