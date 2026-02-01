import { resolveSelectionObject as resolveSelectionObjectBase, scoreObjectForNormal } from '../../utils/selectionResolver.js';

export function resolveSelectionObject(scene, selection, options = {}) {
  const scoreFn = typeof options.scoreFn === 'function' ? options.scoreFn : scoreObjectForNormal;
  return resolveSelectionObjectBase(scene, selection, { ...options, scoreFn });
}
