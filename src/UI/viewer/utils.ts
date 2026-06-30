export const safe = (fn) => {
    try {
        fn();
    } catch {
        // best effort
    }
};
