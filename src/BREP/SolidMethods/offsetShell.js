function sanitizeToken(value, fallback = 'FACE') {
    const raw = value == null ? '' : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    return trimmed
        .replace(/[:[\]]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_.-]/g, '_')
        || fallback;
}

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

function restoreThickenStartFaceName(thickened, sourceFaceName) {
    if (!thickened || typeof thickened.renameFace !== "function") return;
    if (!sourceFaceName) return;
    const startFaceName = `${sourceFaceName}_START`;
    if (startFaceName === sourceFaceName) return;
    try {
        thickened.renameFace(startFaceName, sourceFaceName);
    } catch {
        /* ignore rename failures and keep the generated names */
    }
}

export function offsetShell(faces, distance, options = {}) {
    const featureId = String(options?.featureId || options?.name || this?.name || "OffsetShell").trim() || "OffsetShell";
    const newSolidName = String(options?.newSolidName || `${this?.name || "Solid"}_${featureId}`).trim() || `${this?.name || "Solid"}_${featureId}`;
    const excludedFaceNames = new Set(
        (Array.isArray(faces) ? faces : [faces])
            .map((entry) => getFaceName(entry))
            .filter(Boolean)
    );

    const magnitude = Math.abs(Number(distance));
    if (!Number.isFinite(magnitude) || magnitude === 0) return null;

    const thickenDistance = -magnitude;
    let faceObjects = [];
    try {
        faceObjects = Array.isArray(this.faces) ? this.faces.slice() : [];
    } catch {
        faceObjects = [];
    }
    if (!faceObjects.length) return null;

    faceObjects.sort((a, b) => {
        const nameA = String(getFaceName(a) || "");
        const nameB = String(getFaceName(b) || "");
        return nameA.localeCompare(nameB);
    });

    let combined = null;
    let generatedCount = 0;
    let skippedCount = 0;

    for (let index = 0; index < faceObjects.length; index += 1) {
        const faceObj = faceObjects[index];
        const sourceFaceName = getFaceName(faceObj) || `FACE_${index + 1}`;
        if (excludedFaceNames.has(sourceFaceName)) continue;

        let thickened = null;
        try {
            thickened = faceObj.thicken(thickenDistance, {
                featureId,
                name: `${featureId}_${sanitizeToken(sourceFaceName, `FACE_${index + 1}`)}`,
            });
        } catch {
            skippedCount += 1;
            continue;
        }
        if (!thickened) {
            skippedCount += 1;
            continue;
        }

        restoreThickenStartFaceName(thickened, sourceFaceName);

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
        faceCount: faceObjects.length,
        excludedFaceCount: excludedFaceNames.size,
        generatedFaceCount: generatedCount,
        skippedFaceCount: skippedCount,
        thickenDistance,
    };
    try {
        combined.userData = {
            ...(combined.userData || {}),
            offsetShell: {
                buildMethod: 'face_thicken_union_shell',
                excludedFaceNames: Array.from(excludedFaceNames),
                generatedFaceCount: generatedCount,
                skippedFaceCount: skippedCount,
                thickenDistance,
            },
        };
    } catch { /* ignore */ }
    return combined;
}
