import type { Force10Config } from './types';

export const defaultConfig: Force10Config = {
  enabled: true,
  cache: {
    strategy: 'stale-while-revalidate',
    ttl: 5 * 60 * 1000, // 5 minutes
    maxEntries: 50,
  },
  loading: {
    suppressProgress: true,
  },
  debug: false,
  routes: {
    exclude: [],
  },
};

let _config: Force10Config = deepMerge(defaultConfig, {});

function deepMerge(target: Force10Config, source: Partial<Force10Config>): Force10Config {
  const result = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source) as (keyof Force10Config)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = { ...targetVal as Record<string, unknown>, ...sourceVal as Record<string, unknown> };
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result as unknown as Force10Config;
}

export function createConfig(userConfig?: Partial<Force10Config>): Force10Config {
  _config = deepMerge(defaultConfig, userConfig ?? {});
  return _config;
}

export function getConfig(): Force10Config {
  return _config;
}

export function updateConfig(updates: Partial<Force10Config>): Force10Config {
  _config = deepMerge(_config, updates);
  return _config;
}
