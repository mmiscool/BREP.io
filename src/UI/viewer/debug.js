window.DEBUG_MODE = false;

export function debugLog(...args) {
    if (window.DEBUG_MODE) {
        console.log(...args);
    }
}
