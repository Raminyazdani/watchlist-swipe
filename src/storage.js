/**
 * لایه‌ی ذخیره‌سازی.
 * داخل آرتیفکت Claude از window.storage استفاده می‌شود،
 * در اجرای معمولی (Vite / Vercel) از localStorage.
 * هر دو همان اینترفیس get/set/delete را می‌دهند.
 */

const hasHostStorage = typeof window !== "undefined" && !!window.storage;

const local = {
  async get(key) {
    const value = window.localStorage.getItem(key);
    if (value === null) throw new Error(`key not found: ${key}`);
    return { key, value };
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    window.localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

export const storage = hasHostStorage ? window.storage : local;
export const storageKind = hasHostStorage ? "host" : "localStorage";
