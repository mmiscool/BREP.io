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
    return combined;
}
