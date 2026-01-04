export function collectEdgesFromSelection(inputObjects) {
  if (!Array.isArray(inputObjects) || inputObjects.length === 0) return [];
  const edges = [];
  for (const obj of inputObjects) {
    if (!obj) continue;
    if (obj.type === 'EDGE') {
      edges.push(obj);
      continue;
    }
    if (obj.type === 'FACE' && Array.isArray(obj.edges)) {
      for (const e of obj.edges) edges.push(e);
    }
  }
  const unique = [];
  const seen = new Set();
  for (const edge of edges) {
    if (!edge || seen.has(edge)) continue;
    if (!(edge.parentSolid || edge.parent)) continue;
    seen.add(edge);
    unique.push(edge);
  }
  return unique;
}

export function resolveSingleSolidFromEdges(edges) {
  const solids = new Set();
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      const solid = edge?.parentSolid || edge?.parent;
      if (solid) solids.add(solid);
    }
  }
  const solid = solids.size === 1 ? solids.values().next().value : null;
  return { solid, solids };
}

export function getSolidGeometryCounts(solid) {
  const triCount = Array.isArray(solid?._triVerts) ? (solid._triVerts.length / 3) : 0;
  const vertCount = Array.isArray(solid?._vertProperties) ? (solid._vertProperties.length / 3) : 0;
  return { triCount, vertCount };
}
