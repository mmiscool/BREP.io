function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed.");
}

function finiteNumber(value, label) {
    const number = Number(value);
    assert(Number.isFinite(number), `${label} must be finite. Received ${value}.`);
    return number;
}

function vecAdd(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecSubtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecScale(a, scale) {
    return { x: a.x * scale, y: a.y * scale, z: a.z * scale };
}

function vecCross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function vecDot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecLengthSq(a) {
    return vecDot(a, a);
}

function vecAverage4(a, b, c, d) {
    return vecScale(vecAdd(vecAdd(a, b), vecAdd(c, d)), 0.25);
}

function triangleVolume6(a, b, c) {
    return a.x * (b.y * c.z - b.z * c.y)
        - a.y * (b.x * c.z - b.z * c.x)
        + a.z * (b.x * c.y - b.y * c.x);
}

function orientedTriangleVolume6(a, b, c, outward) {
    if (vecLengthSq(outward) <= 1e-18) return triangleVolume6(a, b, c);
    const normal = vecCross(vecSubtract(b, a), vecSubtract(c, a));
    return vecDot(normal, outward) < 0
        ? triangleVolume6(a, c, b)
        : triangleVolume6(a, b, c);
}

function orientedQuadVolume6(a, b, c, d, outward) {
    return orientedTriangleVolume6(a, b, c, outward)
        + orientedTriangleVolume6(a, c, d, outward);
}

export function getSceneSolids(partHistory) {
    return (partHistory?.scene?.children || []).filter((obj) => obj?.type === "SOLID");
}

export function getSceneSolidByName(partHistory, name) {
    const expectedName = String(name || "");
    return getSceneSolids(partHistory).find((solid) => String(solid?.name || "") === expectedName) || null;
}

export function volumeTolerance(expectedVolume, relative = 1e-6, absolute = 1e-6) {
    return Math.max(Number(absolute) || 0, Math.abs(Number(expectedVolume) || 0) * (Number(relative) || 0));
}

export function assertSolidVolume(solid, expectedVolume, tolerance, label = "solid") {
    assert(solid, `[${label}] Expected a solid.`);
    assert(typeof solid.volume === "function", `[${label}] Expected solid.volume() to be available.`);
    const actual = solid.volume();
    assert(Number.isFinite(actual), `[${label}] Expected a finite volume, received ${actual}.`);
    const expected = finiteNumber(expectedVolume, `[${label}] expected volume`);
    const eps = finiteNumber(tolerance, `[${label}] volume tolerance`);
    const delta = Math.abs(actual - expected);
    assert(
        delta <= eps,
        `[${label}] Expected volume ${expected} +/- ${eps}, received ${actual} (delta ${delta}).`,
    );
    return actual;
}

export function assertSceneSolidVolume(partHistory, name, expectedVolume, tolerance, label = String(name || "solid")) {
    const solid = getSceneSolidByName(partHistory, name);
    assert(solid, `[${label}] Expected scene solid "${name}".`);
    return assertSolidVolume(solid, expectedVolume, tolerance, label);
}

export function collectSceneSolidVolumeRecords(partHistory, options = {}) {
    const allowVolumeErrors = options?.allowVolumeErrors === true;
    return getSceneSolids(partHistory).map((solid, index) => {
        const name = String(solid?.name || `solid_${index}`);
        assert(typeof solid.volume === "function", `[${name}] Expected solid.volume() to be available.`);
        try {
            const volume = solid.volume();
            assert(Number.isFinite(volume), `[${name}] Expected a finite volume, received ${volume}.`);
            return { name, volume };
        } catch (error) {
            if (allowVolumeErrors) {
                return { name, volumeError: error?.message || String(error) };
            }
            throw error;
        }
    });
}

function normalizeExpectedSolidVolumes(expectations) {
    if (Array.isArray(expectations)) return { solids: expectations };
    if (expectations && Array.isArray(expectations.solids)) return expectations;
    return null;
}

function sortVolumeRecords(records) {
    return records
        .map((record, index) => ({ ...record, index }))
        .sort((a, b) => {
            const nameCompare = String(a.name || "").localeCompare(String(b.name || ""));
            return nameCompare || (a.index - b.index);
        });
}

export function assertSceneSolidVolumeExpectations(partHistory, expectations, testName = "test") {
    const normalized = normalizeExpectedSolidVolumes(expectations);
    assert(normalized, `[${testName}] Solid volume expectations must be an array or { solids }.`);

    const relativeTolerance = Number(normalized.relativeTolerance ?? 1e-5);
    const absoluteTolerance = Number(normalized.absoluteTolerance ?? 1e-5);
    const expected = sortVolumeRecords(normalized.solids || []);
    const actual = sortVolumeRecords(collectSceneSolidVolumeRecords(partHistory, { allowVolumeErrors: true }));

    assert(
        actual.length === expected.length,
        `[${testName}] Expected ${expected.length} solid volume record(s), found ${actual.length}. `
            + `Expected=[${expected.map((record) => record.name).join(", ")}], `
            + `actual=[${actual.map((record) => record.name).join(", ")}].`,
    );

    for (let i = 0; i < expected.length; i++) {
        const expectedRecord = expected[i];
        const actualRecord = actual[i];
        assert(
            actualRecord.name === expectedRecord.name,
            `[${testName}] Solid volume record ${i} expected "${expectedRecord.name}", found "${actualRecord.name}".`,
        );
        if (Object.prototype.hasOwnProperty.call(expectedRecord, "volumeError")) {
            const expectedError = String(expectedRecord.volumeError || "");
            assert(
                Object.prototype.hasOwnProperty.call(actualRecord, "volumeError"),
                `[${testName}:${expectedRecord.name}] Expected volume() to fail with "${expectedError}", `
                    + `but received volume ${actualRecord.volume}.`,
            );
            assert(
                String(actualRecord.volumeError || "").includes(expectedError),
                `[${testName}:${expectedRecord.name}] Expected volume() error to include "${expectedError}", `
                    + `received "${actualRecord.volumeError}".`,
            );
        } else {
            assert(
                !Object.prototype.hasOwnProperty.call(actualRecord, "volumeError"),
                `[${testName}:${expectedRecord.name}] Expected numeric volume ${expectedRecord.volume}, `
                    + `but volume() failed with "${actualRecord.volumeError}".`,
            );
            assertSolidVolume(
                { volume: () => actualRecord.volume },
                expectedRecord.volume,
                volumeTolerance(expectedRecord.volume, relativeTolerance, absoluteTolerance),
                `${testName}:${expectedRecord.name}`,
            );
        }
    }
}

export function expectedBoxVolume(x, y, z) {
    return Math.abs(finiteNumber(x, "box x") * finiteNumber(y, "box y") * finiteNumber(z, "box z"));
}

export function regularPolygonArea(radius, sides) {
    const r = Math.abs(finiteNumber(radius, "polygon radius"));
    const n = Math.max(3, Math.floor(finiteNumber(sides, "polygon sides")));
    return 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
}

export function expectedCylinderVolume(radius, height, resolution) {
    return regularPolygonArea(radius, resolution) * Math.abs(finiteNumber(height, "cylinder height"));
}

export function expectedConeVolume(radiusTop, radiusBottom, height, resolution) {
    const topArea = regularPolygonArea(radiusTop, resolution);
    const bottomArea = regularPolygonArea(radiusBottom, resolution);
    return Math.abs(finiteNumber(height, "cone height")) * (topArea + bottomArea + Math.sqrt(topArea * bottomArea)) / 3;
}

export function expectedPyramidVolume(baseSideLength, sides, height) {
    const sideLength = Math.abs(finiteNumber(baseSideLength, "pyramid base side length"));
    const n = Math.max(3, Math.floor(finiteNumber(sides, "pyramid sides")));
    const baseArea = n * sideLength * sideLength / (4 * Math.tan(Math.PI / n));
    return baseArea * Math.abs(finiteNumber(height, "pyramid height")) / 3;
}

export function expectedSphereVolume(radius, resolution) {
    const r = Math.abs(finiteNumber(radius, "sphere radius"));
    const longitudeSegments = Math.max(8, Math.floor(finiteNumber(resolution, "sphere resolution")));
    const latitudeSegments = Math.max(4, Math.floor(longitudeSegments / 2));
    const north = { x: 0, y: r, z: 0 };
    const south = { x: 0, y: -r, z: 0 };
    const rings = [];

    for (let lat = 1; lat < latitudeSegments; lat++) {
        const phi = (lat / latitudeSegments) * Math.PI;
        const y = r * Math.cos(phi);
        const ringRadius = r * Math.sin(phi);
        const ring = [];
        for (let lon = 0; lon < longitudeSegments; lon++) {
            const theta = (lon / longitudeSegments) * 2 * Math.PI;
            ring.push({
                x: ringRadius * Math.cos(theta),
                y,
                z: ringRadius * Math.sin(theta),
            });
        }
        rings.push(ring);
    }

    let volume6 = 0;
    const firstRing = rings[0];
    for (let lon = 0; lon < longitudeSegments; lon++) {
        const next = (lon + 1) % longitudeSegments;
        const centroid = vecScale(vecAdd(vecAdd(north, firstRing[next]), firstRing[lon]), 1 / 3);
        volume6 += orientedTriangleVolume6(north, firstRing[next], firstRing[lon], centroid);
    }

    for (let ringIndex = 0; ringIndex + 1 < rings.length; ringIndex++) {
        const ringA = rings[ringIndex];
        const ringB = rings[ringIndex + 1];
        for (let lon = 0; lon < longitudeSegments; lon++) {
            const next = (lon + 1) % longitudeSegments;
            const outward = vecAverage4(ringA[lon], ringA[next], ringB[next], ringB[lon]);
            volume6 += orientedQuadVolume6(ringA[lon], ringA[next], ringB[next], ringB[lon], outward);
        }
    }

    const lastRing = rings[rings.length - 1];
    for (let lon = 0; lon < longitudeSegments; lon++) {
        const next = (lon + 1) % longitudeSegments;
        const centroid = vecScale(vecAdd(vecAdd(south, lastRing[lon]), lastRing[next]), 1 / 3);
        volume6 += orientedTriangleVolume6(south, lastRing[lon], lastRing[next], centroid);
    }

    return Math.abs(volume6) / 6;
}

export function expectedTorusVolume(majorRadius, tubeRadius, resolution, arcDegrees = 360) {
    const major = finiteNumber(majorRadius, "torus major radius");
    const tube = Math.abs(finiteNumber(tubeRadius, "torus tube radius"));
    const majorSegments = Math.max(8, Math.floor(finiteNumber(resolution, "torus resolution")));
    const tubeSegments = Math.max(3, Math.floor(majorSegments / 2));
    const arc = finiteNumber(arcDegrees, "torus arc degrees");
    const fullArc = arc >= 360 - 1e-6;
    const sweep = fullArc ? 2 * Math.PI : (arc / 180) * Math.PI;
    assert(sweep > 0, "torus arc must be greater than zero.");

    const ringCount = fullArc ? majorSegments : majorSegments + 1;
    const rings = [];
    const centers = [];
    const ringAngles = [];

    for (let i = 0; i < ringCount; i++) {
        const u = fullArc
            ? (i / majorSegments) * sweep
            : (i / (ringCount - 1)) * sweep;
        const center = { x: major * Math.cos(u), y: 0, z: -major * Math.sin(u) };
        const radial = { x: Math.cos(u), y: 0, z: -Math.sin(u) };
        const ring = [];
        for (let j = 0; j < tubeSegments; j++) {
            const v = (j / tubeSegments) * 2 * Math.PI;
            ring.push(vecAdd(center, vecAdd(
                vecScale(radial, tube * Math.cos(v)),
                { x: 0, y: tube * Math.sin(v), z: 0 },
            )));
        }
        centers.push(center);
        ringAngles.push(u);
        rings.push(ring);
    }

    let volume6 = 0;
    const sideRingCount = fullArc ? ringCount : ringCount - 1;
    for (let i = 0; i < sideRingCount; i++) {
        const next = (i + 1) % ringCount;
        const nextAngle = fullArc && next === 0
            ? ringAngles[i] + sweep / majorSegments
            : ringAngles[next];
        const midU = 0.5 * (ringAngles[i] + nextAngle);
        const midCenter = { x: major * Math.cos(midU), y: 0, z: -major * Math.sin(midU) };
        for (let j = 0; j < tubeSegments; j++) {
            const jNext = (j + 1) % tubeSegments;
            const outward = vecSubtract(
                vecAverage4(rings[i][j], rings[i][jNext], rings[next][jNext], rings[next][j]),
                midCenter,
            );
            volume6 += orientedQuadVolume6(rings[i][j], rings[i][jNext], rings[next][jNext], rings[next][j], outward);
        }
    }

    if (!fullArc) {
        const startCenter = centers[0];
        const endCenter = centers[centers.length - 1];
        const startOutward = { x: 0, y: 0, z: 1 };
        const endOutward = { x: -Math.sin(sweep), y: 0, z: -Math.cos(sweep) };
        const firstRing = rings[0];
        const lastRing = rings[rings.length - 1];
        for (let j = 0; j < tubeSegments; j++) {
            const next = (j + 1) % tubeSegments;
            volume6 += orientedTriangleVolume6(startCenter, firstRing[next], firstRing[j], startOutward);
            volume6 += orientedTriangleVolume6(endCenter, lastRing[j], lastRing[next], endOutward);
        }
    }

    return Math.abs(volume6) / 6;
}
