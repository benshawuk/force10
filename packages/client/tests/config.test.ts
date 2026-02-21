import { describe, it, expect } from 'vitest';
import { createConfig, getConfig, updateConfig, defaultConfig } from '../src/config';

describe('config', () => {
  it('merges user config with defaults', () => {
    const config = createConfig({ debug: true, cache: { strategy: 'stale-while-revalidate', ttl: 10000, maxEntries: 100 } });
    expect(config.debug).toBe(true);
    expect(config.cache.ttl).toBe(10000);
    expect(config.cache.maxEntries).toBe(100);
    // Unspecified fields should have defaults
    expect(config.enabled).toBe(true);
    expect(config.loading.suppressProgress).toBe(true);
  });

  it('returns defaults when no user config provided', () => {
    const config = createConfig();
    expect(config).toEqual(defaultConfig);
  });

  it('allows runtime config updates', () => {
    createConfig(); // Initialize with defaults
    const updated = updateConfig({ debug: true });
    expect(updated.debug).toBe(true);
    expect(getConfig().debug).toBe(true);
    // Other values should remain unchanged
    expect(updated.enabled).toBe(true);

    // Reset
    updateConfig({ debug: false });
  });
});
