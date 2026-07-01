/**
 * Repairs authored triangle face IDs after topology-producing operations.
 *
 * This module intentionally uses explicit face metadata roles, not generated
 * name suffixes. If a feature creates start/end/sidewall/intersection-cap
 * faces, it must write those roles before asking for provenance repair.
 */

function getFaceMetadata(solid, faceName) {
  const key = String(faceName || '').trim();
  if (!key) return {};
  if (solid?._faceMetadata instanceof Map) {
    const metadata = solid._faceMetadata.get(key);
    return metadata && typeof metadata === 'object' ? metadata : {};
  }
  try {
    const metadata = typeof solid?.getFaceMetadata === 'function' ? solid.getFaceMetadata(key) : null;
    return metadata && typeof metadata === 'object' ? metadata : {};
  } catch {
    return {};
  }
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function getFaceRole(solid, faceName) {
  const metadata = getFaceMetadata(solid, faceName);
  const role = normalizeRole(
    metadata.offsetShellFaceRole
    || metadata.faceRole
    || metadata.faceType
    || metadata.type
    || metadata.role
    || '',
  );
  if (role === 'intersection_cap' || role === 'intersectioncap') return 'intersection_cap';
  if (role === 'start_cap' || role === 'startcap' || role === 'start') return 'start_cap';
  if (role === 'end_cap' || role === 'endcap' || role === 'end') return 'end_cap';
  if (role === 'sidewall' || role === 'side_wall') return 'sidewall';
  return '';
}

function getSourceFaceRole(solid, faceName) {
  const metadata = getFaceMetadata(solid, faceName);
  return normalizeRole(
    metadata.sourceFaceRole
    || metadata.sourceOffsetShellFaceRole
    || metadata.sourceFaceType
    || metadata.sourceType
    || metadata.sourceMetadata?.offsetShellFaceRole
    || metadata.sourceMetadata?.faceRole
    || metadata.sourceMetadata?.faceType
    || metadata.sourceMetadata?.type
    || '',
  );
}

function isCapRole(role) {
  return role === 'start_cap' || role === 'end_cap';
}

function isSidewallCap(solid, faceName) {
  const role = getFaceRole(solid, faceName);
  if (!isCapRole(role)) return false;
  const sourceRole = getSourceFaceRole(solid, faceName);
  return sourceRole === 'sidewall' || sourceRole === 'side_wall';
}

function edgeKey(a, b) {
  const u = a < b ? a : b;
  const v = a < b ? b : a;
  return `${u}|${v}`;
}

function collectEdgeUses(tv, triCount) {
  const edgeUses = new Map();
  for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      let list = edgeUses.get(key);
      if (!list) {
        list = [];
        edgeUses.set(key, list);
      }
      list.push(triIndex);
    }
  }
  return edgeUses;
}

function markSolidFaceIDsChanged(solid) {
  if (!solid || typeof solid !== 'object') return;
  solid._dirty = true;
  solid._faceIndex = null;
  solid._manifold = null;
  solid._visualizeCache = null;
  solid._cppSolidCoreSyncStamp = null;
}

function reassignTemporaryIntersectionCapTriangles(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const idToName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  const triCount = (tv.length / 3) | 0;
  if (!triCount || ids.length < triCount || !idToName) return 0;

  const capIds = new Set();
  const roleByID = new Map();
  for (const [idRaw, nameRaw] of idToName.entries()) {
    const id = Number(idRaw) >>> 0;
    const faceName = String(nameRaw || '').trim();
    if (!id || !faceName) continue;
    const role = getFaceRole(solid, faceName);
    if (!role) continue;
    roleByID.set(id, role);
    if (role === 'intersection_cap') capIds.add(id);
  }
  if (!capIds.size) return 0;

  const edgeUses = collectEdgeUses(tv, triCount);
  let changedTotal = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = 0;
    for (let triIndex = 0; triIndex < triCount; triIndex += 1) {
      const currentID = ids[triIndex] >>> 0;
      if (!capIds.has(currentID)) continue;

      const neighborScore = new Map();
      const neighborRoles = new Map();
      const a = tv[(triIndex * 3) + 0] >>> 0;
      const b = tv[(triIndex * 3) + 1] >>> 0;
      const c = tv[(triIndex * 3) + 2] >>> 0;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        for (const neighborTri of edgeUses.get(edgeKey(u, v)) || []) {
          if (neighborTri === triIndex) continue;
          const neighborID = ids[neighborTri] >>> 0;
          if (!neighborID || capIds.has(neighborID)) continue;
          const role = roleByID.get(neighborID) || getFaceRole(solid, idToName.get(neighborID));
          if (!role) continue;
          neighborRoles.set(neighborID, role);
          const capBonus = isCapRole(role) ? 10 : 0;
          const sidewallPenalty = role === 'sidewall' ? -1 : 0;
          neighborScore.set(neighborID, (neighborScore.get(neighborID) || 0) + 1 + capBonus + sidewallPenalty);
        }
      }

      const touchesStart = Array.from(neighborRoles.values()).some((role) => role === 'start_cap');
      const touchesEnd = Array.from(neighborRoles.values()).some((role) => role === 'end_cap');
      if (touchesStart && touchesEnd) {
        for (const [candidateID, role] of neighborRoles.entries()) {
          if (role !== 'sidewall') continue;
          neighborScore.set(candidateID, (neighborScore.get(candidateID) || 0) + 100);
        }
      }

      let bestID = 0;
      let bestScore = -Infinity;
      for (const [candidateID, score] of neighborScore.entries()) {
        if (score > bestScore) {
          bestScore = score;
          bestID = candidateID;
        }
      }
      if (bestID) {
        ids[triIndex] = bestID;
        changed += 1;
      }
    }
    changedTotal += changed;
    if (!changed) break;
  }

  if (changedTotal > 0) markSolidFaceIDsChanged(solid);
  return changedTotal;
}

function repairDirectStartEndCapBoundaries(solid) {
  const tv = Array.isArray(solid?._triVerts) ? solid._triVerts : [];
  const ids = Array.isArray(solid?._triIDs) ? solid._triIDs : [];
  const idToName = solid?._idToFaceName instanceof Map ? solid._idToFaceName : null;
  const triCount = (tv.length / 3) | 0;
  if (!triCount || ids.length < triCount || !idToName) return 0;

  const roleByID = new Map();
  const sidewallCapIDs = new Set();
  let hasStart = false;
  let hasEnd = false;
  let hasSidewall = false;
  for (const [idRaw, faceNameRaw] of idToName.entries()) {
    const id = Number(idRaw) >>> 0;
    const faceName = String(faceNameRaw || '').trim();
    if (!id || !faceName) continue;
    const role = getFaceRole(solid, faceName);
    if (!role) continue;
    roleByID.set(id, role);
    if (role === 'start_cap') hasStart = true;
    if (role === 'end_cap') hasEnd = true;
    if (role === 'sidewall') hasSidewall = true;
    if (isSidewallCap(solid, faceName)) sidewallCapIDs.add(id);
  }
  if (!hasStart || !hasEnd || !hasSidewall) return 0;

  const edgeUses = collectEdgeUses(tv, triCount);
  const bestSidewallNeighbor = (triIndex) => {
    const score = new Map();
    const a = tv[(triIndex * 3) + 0] >>> 0;
    const b = tv[(triIndex * 3) + 1] >>> 0;
    const c = tv[(triIndex * 3) + 2] >>> 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      for (const neighborTri of edgeUses.get(edgeKey(u, v)) || []) {
        if (neighborTri === triIndex) continue;
        const neighborID = ids[neighborTri] >>> 0;
        if (roleByID.get(neighborID) !== 'sidewall') continue;
        score.set(neighborID, (score.get(neighborID) || 0) + 1);
      }
    }
    let bestID = 0;
    let bestScore = 0;
    for (const [candidateID, candidateScore] of score.entries()) {
      if (candidateScore > bestScore) {
        bestID = candidateID;
        bestScore = candidateScore;
      }
    }
    return bestID;
  };

  let changedTotal = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = 0;
    for (const uses of edgeUses.values()) {
      if (!Array.isArray(uses) || uses.length !== 2) continue;
      const aTri = uses[0];
      const bTri = uses[1];
      const aID = ids[aTri] >>> 0;
      const bID = ids[bTri] >>> 0;
      const aRole = roleByID.get(aID) || '';
      const bRole = roleByID.get(bID) || '';
      const directCaps = (aRole === 'start_cap' && bRole === 'end_cap')
        || (aRole === 'end_cap' && bRole === 'start_cap');
      if (!directCaps) continue;
      if (sidewallCapIDs.has(aID) || sidewallCapIDs.has(bID)) continue;

      const aSidewall = bestSidewallNeighbor(aTri);
      const bSidewall = bestSidewallNeighbor(bTri);
      if (aSidewall && !bSidewall) {
        ids[aTri] = aSidewall;
        changed += 1;
      } else if (bSidewall && !aSidewall) {
        ids[bTri] = bSidewall;
        changed += 1;
      } else if (aSidewall || bSidewall) {
        const targetTri = aRole === 'end_cap' ? aTri : bTri;
        ids[targetTri] = aSidewall || bSidewall;
        changed += 1;
      }
    }
    changedTotal += changed;
    if (!changed) break;
  }

  if (changedTotal > 0) markSolidFaceIDsChanged(solid);
  return changedTotal;
}

export function repairGeneratedFaceIDProvenance(solid) {
  const intersectionCapReassignedTriangles = reassignTemporaryIntersectionCapTriangles(solid);
  const directStartEndCapBoundaryReassignedTriangles = repairDirectStartEndCapBoundaries(solid);
  const changedTriangles = intersectionCapReassignedTriangles + directStartEndCapBoundaryReassignedTriangles;
  return {
    changedTriangles,
    intersectionCapReassignedTriangles,
    directStartEndCapBoundaryReassignedTriangles,
  };
}
