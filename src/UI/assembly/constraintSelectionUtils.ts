import { resolveSelectionObject as resolveSelectionObjectBase, scoreObjectForNormal } from '../../utils/selectionResolver.js';

type SelectionResolveOptions = Record<string, any> & {
  scoreFn?: ((object: any) => number) | null;
};

export function resolveSelectionObject(scene, selection, options: SelectionResolveOptions = {}) {
  const scoreFn = typeof options.scoreFn === 'function' ? options.scoreFn : scoreObjectForNormal;
  return resolveSelectionObjectBase(scene, selection, { ...options, scoreFn });
}
