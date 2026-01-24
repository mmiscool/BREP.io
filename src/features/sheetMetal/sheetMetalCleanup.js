export function cleanupSheetMetalOppositeEdgeFaces(solids, options = {}) {
  const list = Array.isArray(solids) ? solids : (solids ? [solids] : []);
  for (const solid of list) {
    if (!solid || typeof solid.removeOppositeSingleEdgeFaces !== "function") continue;
    try {
      solid.removeOppositeSingleEdgeFaces(options);
    } catch { /* best effort */ }
  }
}
