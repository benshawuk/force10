import type { CachedPage, Force10Cache, Force10Config } from './types';

export function createCache(config: Force10Config): Force10Cache {
  const store = new Map<string, CachedPage>();
  const ttl = config.cache.ttl;
  const maxEntries = config.cache.maxEntries;

  function isExpired(entry: CachedPage): boolean {
    return Date.now() - entry.timestamp > ttl;
  }

  function evictIfNeeded(): void {
    while (store.size > maxEntries) {
      // Map iterates in insertion order, so the first key is the oldest
      const oldestKey = store.keys().next().value as string;
      store.delete(oldestKey);
    }
  }

  /**
   * Convert a glob-like URL pattern (with `*` wildcards) into a RegExp.
   * `*` matches one or more characters (non-greedy within a single segment,
   * but the tests use `/users/*` to match `/users/1`, `/users/2`, etc.).
   */
  function patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const withWildcards = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${withWildcards}$`);
  }

  const cache: Force10Cache = {
    get(url: string): CachedPage | null {
      const entry = store.get(url);
      if (!entry) {
        return null;
      }
      if (isExpired(entry)) {
        return null;
      }
      return entry;
    },

    set(url: string, page: CachedPage): void {
      // Delete first so re-insertion moves it to the end (most recent)
      store.delete(url);
      store.set(url, page);
      evictIfNeeded();
    },

    remove(url: string): void {
      store.delete(url);
    },

    clear(): void {
      store.clear();
    },

    getOrStale(url: string): { page: CachedPage; isStale: boolean } | null {
      const entry = store.get(url);
      if (!entry) {
        return null;
      }
      return {
        page: entry,
        isStale: isExpired(entry),
      };
    },

    invalidateByPattern(pattern: string): void {
      const regex = patternToRegex(pattern);
      for (const key of Array.from(store.keys())) {
        if (regex.test(key)) {
          store.delete(key);
        }
      }
    },

    updateProps(url: string, props: Record<string, unknown>): void {
      const entry = store.get(url);
      if (!entry) {
        return;
      }
      entry.props = { ...entry.props, ...props };
      entry.timestamp = Date.now();
    },
  };

  return cache;
}
