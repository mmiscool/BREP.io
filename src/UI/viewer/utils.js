export const safe = (fn) => {
    try { fn(); } catch { }
};
