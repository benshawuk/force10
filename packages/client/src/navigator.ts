import { router } from '@inertiajs/core';
import type { Force10Cache, Force10Config, Force10Navigator, Force10Preflight, MatchResult, NavigateOptions } from './types';
import { log } from './debug';

export function createNavigator(cache: Force10Cache, config: Force10Config, preflight?: Force10Preflight): Force10Navigator {
  let _isLoading = false;

  function optimisticNavigate(match: MatchResult, options?: NavigateOptions): void {
    // Look up cached props for the target URL
    const cached = cache.getOrStale(match.url);

    log(`navigator: cache ${cached ? (cached.isStale ? 'STALE' : 'FRESH') : 'MISS'}${cached ? `, props keys: [${Object.keys(cached.page.props).join(', ')}]` : ''}`);

    // Build the page object
    // When we have cached props, use them directly.
    // On cache miss, use a props function to preserve current page props
    // (passing empty {} would wipe all props and crash the component).
    const page: Record<string, unknown> = {
      component: match.route.component,
      url: match.url,
      props: cached
        ? cached.page.props
        : (currentProps: Record<string, unknown>) => currentProps,
    };

    // Pass through preserveScroll and preserveState if provided
    if (options?.preserveScroll !== undefined) {
      page.preserveScroll = options.preserveScroll;
    }
    if (options?.preserveState !== undefined) {
      page.preserveState = options.preserveState;
    }

    // Set loading state
    _isLoading = true;

    // Use router.replace or router.push based on options
    const method = options?.replace ? 'replace' : 'push';
    log(`navigator: calling router.${method}()`, { component: page.component, url: page.url, cached: !!cached });

    const before = performance.now();
    if (options?.replace) {
      router.replace(page as any);
    } else {
      router.push(page as any);
    }
    const after = performance.now();
    log(`navigator: router.${method}() returned in ${(after - before).toFixed(1)}ms`);
  }

  function shouldOptimisticallyNavigate(match: MatchResult): boolean {
    if (!config.enabled) {
      return false;
    }

    // Layer 1: Preflight — server-evaluated middleware state
    if (preflight) {
      const preflightResult = preflight.check(match.route.middleware);
      if (preflightResult === false) {
        log('SKIP: preflight says middleware will redirect');
        return false;
      }
    }

    // Fallback: auth check from page props (covers case where preflight data hasn't loaded yet)
    if (match.route.middleware.includes('auth')) {
      const currentPage = typeof window !== 'undefined' ? window.history.state?.page : undefined;
      const authProps = (currentPage?.props as any)?.auth;
      const user = authProps?.user;
      if (!user) {
        return false;
      }
    }

    return true;
  }

  function isLoading(): boolean {
    return _isLoading;
  }

  function setLoaded(): void {
    _isLoading = false;
  }

  return {
    optimisticNavigate,
    shouldOptimisticallyNavigate,
    isLoading,
    setLoaded,
  };
}
