function normalizeKey(key) {
  return String(key ?? '');
}

export function getBrowserLocalStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore localStorage access failures.
  }
  return null;
}

export function readBrowserStorageValue(
  key,
  { fallback = null } = {},
) {
  const normalizedKey = normalizeKey(key);
  const store = getBrowserLocalStorage();

  if (!store) return fallback;

  try {
    const value = store.getItem(normalizedKey);
    return value === null ? fallback : String(value);
  } catch {
    // Ignore localStorage read failures.
    return fallback;
  }
}

export function writeBrowserStorageValue(key, value) {
  const normalizedKey = normalizeKey(key);
  const store = getBrowserLocalStorage();
  if (!store) return false;
  try {
    store.setItem(normalizedKey, String(value ?? ''));
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorageValue(key) {
  const normalizedKey = normalizeKey(key);
  const store = getBrowserLocalStorage();
  if (!store) return false;
  try {
    store.removeItem(normalizedKey);
    return true;
  } catch {
    return false;
  }
}
