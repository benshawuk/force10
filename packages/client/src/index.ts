import type { Force10Config, Force10Manifest, Force10Navigator } from './types';
import { createConfig } from './config';
import { createCache } from './cache';
import { createMatcher } from './matcher';
import { createNavigator } from './navigator';
import { applyPatch } from './patch';
import { log, warn } from './debug';

export type { Force10Config, ManifestRoute, Force10Manifest, CachedPage, MatchResult } from './types';

let _navigator: Force10Navigator | null = null;
let _initialized = false;

/**
 * Initialize Force10 — call this in your app entry point.
 * Pass the manifest (from `virtual:force10-manifest`) and optional config overrides.
 * Returns a cleanup function to remove the patch.
 */
export function initForce10(
  manifest: Force10Manifest,
  config?: Partial<Force10Config>,
): () => void {
  // SSR guard
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Double-init guard
  if (_initialized) {
    warn('Force10 is already initialized. Skipping.');
    return () => {};
  }

  // Create config
  const resolvedConfig = createConfig(config);

  if (!resolvedConfig.enabled) {
    log('Force10 is disabled via config.');
    return () => {};
  }

  // Validate manifest
  if (!manifest || !manifest.routes || manifest.routes.length === 0) {
    warn('No routes in manifest. Force10 will be a no-op.');
    return () => {};
  }

  // Create module instances
  const cache = createCache(resolvedConfig);
  const matcher = createMatcher(manifest, resolvedConfig);
  const navigator = createNavigator(cache, resolvedConfig);
  _navigator = navigator;

  // Apply the router patch
  const patch = applyPatch(navigator, matcher, cache, resolvedConfig);

  _initialized = true;
  log(`Initialized with ${manifest.routes.length} routes.`);

  // Preload all page component chunks so navigation is instant
  if (manifest.preload) {
    manifest.preload();
    log('Preloading component chunks for all manifest routes.');
  }

  // Return cleanup function
  return () => {
    patch.remove();
    _navigator = null;
    _initialized = false;
    log('Force10 removed.');
  };
}

/**
 * Check if Force10 is currently loading a background request.
 */
export function isForce10Loading(): boolean {
  return _navigator ? _navigator.isLoading() : false;
}

export { createConfig } from './config';
