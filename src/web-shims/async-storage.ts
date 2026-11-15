const memoryFallback = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // ignore storage quota/privacy errors
    }
    return memoryFallback.has(key) ? memoryFallback.get(key)! : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // ignore
    }
    memoryFallback.set(key, value);
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch {
      // ignore
    }
    memoryFallback.delete(key);
  },

  async clear(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
        return;
      }
    } catch {
      // ignore
    }
    memoryFallback.clear();
  },
};

export default AsyncStorage;
