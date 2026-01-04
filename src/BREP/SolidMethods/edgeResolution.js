export function resolveEdgesFromInputs(solid, { edgeNames, edges } = {}) {
  const edgeObjs = [];
  const wantNames = Array.isArray(edgeNames) ? Array.from(new Set(edgeNames.map(String))) : [];
  if (wantNames.length) {
    for (const ch of solid?.children || []) {
      if (ch && ch.type === 'EDGE' && wantNames.includes(ch.name)) {
        if (ch.parentSolid === solid || ch.parent === solid) edgeObjs.push(ch);
      }
    }
  }
  if (Array.isArray(edges)) {
    for (const e of edges) {
      if (e && (e.parentSolid === solid || e.parent === solid)) edgeObjs.push(e);
    }
  }
  const unique = [];
  const seen = new Set();
  for (const e of edgeObjs) {
    if (e && !seen.has(e)) {
      seen.add(e);
      unique.push(e);
    }
  }
  return unique;
}
