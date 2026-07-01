declare global {
    interface Window {
        DEBUG_MODE?: boolean;
    }
}

const debugGlobal = globalThis as typeof globalThis & { DEBUG_MODE?: boolean };
debugGlobal.DEBUG_MODE = false;

export function debugLog(...args) {
    if (debugGlobal.DEBUG_MODE) {
        console.log(...args);
    }
}
