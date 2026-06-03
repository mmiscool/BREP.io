function getFaceName(entry) {
    if (!entry) return null;
    if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed || null;
    }
    const raw = entry?.userData?.faceName ?? entry?.faceName ?? entry?.name ?? null;
    if (raw == null) return null;
    const name = String(raw).trim();
    return name || null;
}

function getSelectedFaceNames(faces, sourceFaces) {
    const sourceNames = new Set();
    for (const face of sourceFaces) {
        const name = getFaceName(face);
        if (name) sourceNames.add(name);
    }

    const selected = new Set();
    for (const entry of Array.isArray(faces) ? faces : [faces]) {
        if (!entry) continue;
        const name = getFaceName(entry);
        if (name && sourceNames.has(name)) selected.add(name);
    }
    return selected;
}

function cloneCenterlineAuxEdges(sourceSolid) {
    const source = Array.isArray(sourceSolid?._auxEdges) ? sourceSolid._auxEdges : [];
    const out = [];
    for (const aux of source) {
        const name = String(aux?.name || "EDGE");
        const isCenterline = !!aux?.centerline || /centerline/i.test(name);
        if (!isCenterline) continue;

        const points = Array.isArray(aux?.points)
            ? aux.points.map((point) => {
                if (Array.isArray(point) && point.length >= 3) {
                    const x = Number(point[0]);
                    const y = Number(point[1]);
                    const z = Number(point[2]);
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
                    return null;
                }
                if (point && typeof point === "object") {
                    const x = Number(point.x);
                    const y = Number(point.y);
                    const z = Number(point.z);
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
                }
                return null;
            }).filter(Boolean)
            : [];
        if (points.length < 2) continue;

        const entry = {
            name,
            points,
            closedLoop: !!aux?.closedLoop,
            polylineWorld: !!aux?.polylineWorld,
            centerline: true,
        };
        const materialKey = String(aux?.materialKey || "").trim();
        if (materialKey) entry.materialKey = materialKey;
        const faceA = String(aux?.faceA || "").trim();
        const faceB = String(aux?.faceB || "").trim();
        if (faceA) entry.faceA = faceA;
        if (faceB) entry.faceB = faceB;
        out.push(entry);
    }
    return out;
}

function appendSourceCenterlines(targetSolid, sourceSolid) {
    if (!targetSolid) return targetSolid;
    const centerlines = cloneCenterlineAuxEdges(sourceSolid);
    if (!centerlines.length) return targetSolid;
    const existing = Array.isArray(targetSolid._auxEdges) ? targetSolid._auxEdges : [];
    const keyFor = (aux) => JSON.stringify({
        name: String(aux?.name || "EDGE"),
        points: Array.isArray(aux?.points) ? aux.points : [],
        closedLoop: !!aux?.closedLoop,
    });
    const seen = new Set(existing.map(keyFor));
    const additions = centerlines.filter((aux) => {
        const key = keyFor(aux);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!additions.length) return targetSolid;
    targetSolid._auxEdges = [...existing, ...additions];
    targetSolid._visualizeCache = null;
    targetSolid._cppSolidCoreSyncStamp = null;
    return targetSolid;
}

export function offsetShell(faces, distance, options = {}) {
    const featureId = String(options?.featureId || options?.name || this?.name || "OffsetShell").trim() || "OffsetShell";
    const newSolidName = String(options?.newSolidName || `${this?.name || "Solid"}_${featureId}`).trim() || `${this?.name || "Solid"}_${featureId}`;

    const offsetDistance = Number(distance);
    if (!Number.isFinite(offsetDistance) || offsetDistance === 0) return null;

    const thickenDistance = -offsetDistance;
    let sourceFaces = [];
    try {
        sourceFaces = Array.isArray(this.faces) ? this.faces.slice() : [];
    } catch {
        sourceFaces = [];
    }
    const selectedFaceNames = getSelectedFaceNames(faces, sourceFaces);
    const faceObjects = sourceFaces.filter((face) => {
        const name = getFaceName(face);
        return name && !selectedFaceNames.has(name);
    });
    if (!faceObjects.length) return null;

    let combined = null;
    let generatedCount = 0;
    let skippedCount = 0;

    for (let index = 0; index < faceObjects.length; index += 1) {
        const faceObj = faceObjects[index];

        let thickened = null;
        try {
            thickened = faceObj.thicken(thickenDistance, {
                featureId,
                name: featureId,
                skipTriangleSplit: true,
            });
        } catch {
            skippedCount += 1;
            continue;
        }
        if (!thickened) {
            skippedCount += 1;
            continue;
        }

        if (!combined) {
            combined = thickened;
            generatedCount += 1;
            continue;
        }

        try {
            combined = combined.union(thickened);
            generatedCount += 1;
        } catch {
            skippedCount += 1;
            continue;
        }
    }

    if (!combined) return null;

    try { combined.name = newSolidName; } catch { /* ignore */ }
    combined.__offsetMethod = 'face_thicken_union_shell';
    combined.__offsetDiagnostics = {
        buildMethod: 'face_thicken_union_shell',
        faceCount: sourceFaces.length,
        selectedFaceCount: selectedFaceNames.size,
        thickenedFaceCount: faceObjects.length,
        generatedFaceCount: generatedCount,
        skippedFaceCount: skippedCount,
        thickenDistance,
    };
    try {
        combined.userData = {
            ...(combined.userData || {}),
            offsetShell: {
                buildMethod: 'face_thicken_union_shell',
                selectedFaceNames: Array.from(selectedFaceNames),
                thickenedFaceNames: faceObjects.map((face) => getFaceName(face)).filter(Boolean),
                generatedFaceCount: generatedCount,
                skippedFaceCount: skippedCount,
                thickenDistance,
            },
        };
    } catch { /* ignore */ }
    appendSourceCenterlines(combined, this);
    return combined;
}
