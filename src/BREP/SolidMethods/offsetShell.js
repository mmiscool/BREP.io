import {
    buildNativeUnionManyResult,
    hasNativeBooleanUnionManyBuilder,
} from "./booleanOps.js";

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

function nowMs() {
    try {
        if (globalThis.performance && typeof globalThis.performance.now === "function") {
            return globalThis.performance.now();
        }
    } catch {
        /* fall through */
    }
    return Date.now();
}

function roundMs(value) {
    return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
}

function describeError(error) {
    const message = error?.message || error?.toString?.() || String(error || "");
    return String(message || "unknown error").slice(0, 240);
}

function baseSolidCtorFor(solid) {
    const ctor = solid && solid.constructor;
    return (ctor && ctor.BaseSolid) ? ctor.BaseSolid : ctor;
}

function unionNodesSequential(nodes, diagnostics) {
    if (!nodes.length) return null;
    let current = nodes[0];
    for (let i = 1; i < nodes.length; i += 1) {
        const next = nodes[i];
        diagnostics.unionAttemptCount += 1;
        try {
            current = {
                solid: current.solid.union(next.solid),
                count: current.count + next.count,
            };
        } catch (error) {
            diagnostics.unionFailureCount += 1;
            diagnostics.skippedSolidCount += next.count;
            if (!diagnostics.firstUnionError) diagnostics.firstUnionError = describeError(error);
        }
    }
    return current;
}

function unionNodesBalanced(nodes, diagnostics) {
    let round = nodes.slice();
    while (round.length > 1) {
        const nextRound = [];
        for (let i = 0; i < round.length; i += 2) {
            const left = round[i];
            const right = round[i + 1];
            if (!right) {
                nextRound.push(left);
                continue;
            }
            diagnostics.unionAttemptCount += 1;
            try {
                nextRound.push({
                    solid: left.solid.union(right.solid),
                    count: left.count + right.count,
                });
            } catch (error) {
                diagnostics.unionFailureCount += 1;
                diagnostics.skippedSolidCount += right.count;
                if (!diagnostics.firstUnionError) diagnostics.firstUnionError = describeError(error);
                nextRound.push(left);
            }
        }
        round = nextRound;
    }
    return round[0] || null;
}

function unionThickenedSolids(thickenedSolids, options = {}) {
    const solids = Array.isArray(thickenedSolids) ? thickenedSolids.filter(Boolean) : [];
    const diagnostics = {
        unionStrategy: "none",
        nativeBatchUnionAvailable: hasNativeBooleanUnionManyBuilder(),
        nativeBatchUnionStatus: solids.length > 1 ? "not_run" : "not_applicable",
        nativeBatchUnionError: null,
        unionAttemptCount: 0,
        unionFailureCount: 0,
        skippedSolidCount: 0,
        contributedSolidCount: solids.length,
        firstUnionError: null,
    };
    if (!solids.length) {
        diagnostics.contributedSolidCount = 0;
        return { solid: null, diagnostics };
    }
    if (solids.length === 1) {
        diagnostics.unionStrategy = "single";
        return { solid: solids[0], diagnostics };
    }

    const requestedStrategy = String(options?.unionStrategy || "native_batch").trim().toLowerCase();
    const allowNativeBatch = options?.nativeBatchUnion !== false
        && requestedStrategy !== "balanced"
        && requestedStrategy !== "sequential";
    if (allowNativeBatch && diagnostics.nativeBatchUnionAvailable) {
        try {
            const solid = buildNativeUnionManyResult(solids, baseSolidCtorFor(solids[0]), {
                featureID: options?.featureId,
                name: options?.name,
                owningFeatureID: options?.featureId,
            });
            if (!solid) throw new Error("native batch union returned null");
            diagnostics.unionStrategy = "native_batch";
            diagnostics.nativeBatchUnionStatus = "passed";
            return { solid, diagnostics };
        } catch (error) {
            diagnostics.nativeBatchUnionStatus = "failed";
            diagnostics.nativeBatchUnionError = describeError(error);
        }
    } else if (!diagnostics.nativeBatchUnionAvailable) {
        diagnostics.nativeBatchUnionStatus = "unavailable";
    } else if (!allowNativeBatch) {
        diagnostics.nativeBatchUnionStatus = "disabled";
    }

    const nodes = solids.map((solid) => ({ solid, count: 1 }));
    const node = requestedStrategy === "sequential"
        ? unionNodesSequential(nodes, diagnostics)
        : unionNodesBalanced(nodes, diagnostics);
    diagnostics.unionStrategy = requestedStrategy === "sequential"
        ? (diagnostics.nativeBatchUnionStatus === "failed" ? "sequential_fallback" : "sequential")
        : (diagnostics.nativeBatchUnionStatus === "failed" ? "balanced_fallback" : "balanced");
    diagnostics.contributedSolidCount = Number(node?.count || 0);
    return { solid: node?.solid || null, diagnostics };
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

    let generatedCount = 0;
    let skippedCount = 0;
    let thickenWallMs = 0;
    let unionWallMs = 0;
    const thickenedSolids = [];

    for (let index = 0; index < faceObjects.length; index += 1) {
        const faceObj = faceObjects[index];

        let thickened = null;
        const thickenStart = nowMs();
        try {
            thickened = faceObj.thicken(thickenDistance, {
                featureId,
                name: featureId,
                skipTriangleSplit: true,
            });
        } catch {
            thickenWallMs += nowMs() - thickenStart;
            skippedCount += 1;
            continue;
        }
        thickenWallMs += nowMs() - thickenStart;
        if (!thickened) {
            skippedCount += 1;
            continue;
        }
        thickenedSolids.push(thickened);
    }

    const unionStart = nowMs();
    const unionResult = unionThickenedSolids(thickenedSolids, {
        featureId,
        name: newSolidName,
        nativeBatchUnion: options?.nativeBatchUnion,
        unionStrategy: options?.offsetShellUnionStrategy,
    });
    unionWallMs += nowMs() - unionStart;

    let combined = unionResult.solid;
    if (!combined) return null;
    skippedCount += Number(unionResult.diagnostics?.skippedSolidCount || 0);
    generatedCount = Number(unionResult.diagnostics?.contributedSolidCount || thickenedSolids.length);

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
        thickenWallMs: roundMs(thickenWallMs),
        unionWallMs: roundMs(unionWallMs),
        unionStrategy: unionResult.diagnostics?.unionStrategy || "unknown",
        nativeBatchUnionAvailable: !!unionResult.diagnostics?.nativeBatchUnionAvailable,
        nativeBatchUnionStatus: unionResult.diagnostics?.nativeBatchUnionStatus || "unknown",
        nativeBatchUnionError: unionResult.diagnostics?.nativeBatchUnionError || null,
        unionAttemptCount: Number(unionResult.diagnostics?.unionAttemptCount || 0),
        unionFailureCount: Number(unionResult.diagnostics?.unionFailureCount || 0),
        firstUnionError: unionResult.diagnostics?.firstUnionError || null,
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
                unionStrategy: unionResult.diagnostics?.unionStrategy || "unknown",
            },
        };
    } catch { /* ignore */ }
    appendSourceCenterlines(combined, this);
    return combined;
}
