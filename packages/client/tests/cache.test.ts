import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCache } from '../src/cache';
import type { CachedPage, Force10Config } from '../src/types';
import { defaultConfig } from '../src/config';

function makeConfig(overrides?: Partial<Force10Config>): Force10Config {
  return {
    ...defaultConfig,
    ...overrides,
    cache: { ...defaultConfig.cache, ...(overrides?.cache as any) },
  };
}

function makePage(url: string, component: string = 'TestComponent', props: Record<string, unknown> = { title: 'Test' }): CachedPage {
  return { url, component, props, timestamp: Date.now() };
}

describe('cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves cached pages', () => {
    const cache = createCache(makeConfig());
    const page = makePage('/users');
    cache.set('/users', page);
    const result = cache.get('/users');
    expect(result).not.toBeNull();
    expect(result!.url).toBe('/users');
    expect(result!.props).toEqual({ title: 'Test' });
  });

  it('returns null for missing keys', () => {
    const cache = createCache(makeConfig());
    expect(cache.get('/nonexistent')).toBeNull();
  });

  it('returns null for expired entries', () => {
    const cache = createCache(makeConfig({ cache: { strategy: 'stale-while-revalidate', ttl: 1000, maxEntries: 50 } }));
    const page = makePage('/users');
    cache.set('/users', page);

    // Advance time past TTL
    vi.advanceTimersByTime(1500);

    expect(cache.get('/users')).toBeNull();
  });

  it('returns stale entries with isStale flag via getOrStale', () => {
    const cache = createCache(makeConfig({ cache: { strategy: 'stale-while-revalidate', ttl: 1000, maxEntries: 50 } }));
    const page = makePage('/users');
    cache.set('/users', page);

    // Advance time past TTL
    vi.advanceTimersByTime(1500);

    const result = cache.getOrStale('/users');
    expect(result).not.toBeNull();
    expect(result!.isStale).toBe(true);
    expect(result!.page.url).toBe('/users');
  });

  it('evicts oldest entries when maxEntries exceeded', () => {
    const cache = createCache(makeConfig({ cache: { strategy: 'stale-while-revalidate', ttl: 300000, maxEntries: 3 } }));

    cache.set('/page1', makePage('/page1'));
    cache.set('/page2', makePage('/page2'));
    cache.set('/page3', makePage('/page3'));
    cache.set('/page4', makePage('/page4'));

    // Oldest entry should be evicted
    expect(cache.get('/page1')).toBeNull();
    expect(cache.get('/page4')).not.toBeNull();
  });

  it('clears all entries', () => {
    const cache = createCache(makeConfig());
    cache.set('/page1', makePage('/page1'));
    cache.set('/page2', makePage('/page2'));
    cache.clear();
    expect(cache.get('/page1')).toBeNull();
    expect(cache.get('/page2')).toBeNull();
  });

  it('removes specific entries', () => {
    const cache = createCache(makeConfig());
    cache.set('/page1', makePage('/page1'));
    cache.set('/page2', makePage('/page2'));
    cache.remove('/page1');
    expect(cache.get('/page1')).toBeNull();
    expect(cache.get('/page2')).not.toBeNull();
  });

  it('invalidates entries matching a URL pattern', () => {
    const cache = createCache(makeConfig());
    cache.set('/users/1', makePage('/users/1'));
    cache.set('/users/2', makePage('/users/2'));
    cache.set('/about', makePage('/about'));

    cache.invalidateByPattern('/users/*');

    expect(cache.get('/users/1')).toBeNull();
    expect(cache.get('/users/2')).toBeNull();
    expect(cache.get('/about')).not.toBeNull();
  });

  it('updates props for existing cache entry', () => {
    const cache = createCache(makeConfig());
    cache.set('/users', makePage('/users', 'Users', { name: 'Old' }));
    cache.updateProps('/users', { name: 'New', email: 'new@test.com' });

    const result = cache.get('/users');
    expect(result).not.toBeNull();
    expect(result!.props).toEqual({ name: 'New', email: 'new@test.com' });
  });
});
