import { router } from '@inertiajs/core';
import type { Force10Cache, Force10Config, Force10Matcher, Force10Navigator, Force10Patch, Force10Preflight } from './types';
import { log } from './debug';

export function applyPatch(
  navigator: Force10Navigator,
  matcher: Force10Matcher,
  cache: Force10Cache,
  config: Force10Config,
  preflight?: Force10Preflight,
): Force10Patch {
  const originalVisit = router.visit;
  let cancelPendingBackground: (() => void) | null = null;

  log(`Patching router.visit (original is ${typeof originalVisit})`);

  function patchedVisit(href: string | URL, options?: Record<string, any>): void {
    log(`visit() called: ${href}`, { method: options?.method || 'GET', options });

    // Cancel any pending background request from a previous Force10 navigation.
    // This prevents stale requests from firing after the user has navigated away.
    if (cancelPendingBackground) {
      cancelPendingBackground();
    }

    // Extract the URL path string from href
    let urlPath: string;

    if (href instanceof URL) {
      urlPath = href.pathname;
    } else {
      urlPath = href;
    }

    // Skip: hash-only navigation
    if (typeof urlPath === 'string' && urlPath.startsWith('#')) {
      log(`SKIP: hash-only navigation: ${urlPath}`);
      return originalVisit.call(router, href, options);
    }

    // Skip: same-page navigation
    const currentPageUrl = typeof window !== 'undefined' ? window.history.state?.page?.url : undefined;
    if (urlPath === currentPageUrl) {
      log(`SKIP: same-page navigation: ${urlPath} === ${currentPageUrl}`);
      return originalVisit.call(router, href, options);
    }

    // Skip: external URLs (different origin)
    if (typeof urlPath === 'string' && (urlPath.startsWith('http://') || urlPath.startsWith('https://'))) {
      try {
        const parsedUrl = new URL(urlPath);
        const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
        if (parsedUrl.origin !== currentOrigin) {
          log(`SKIP: external URL: ${parsedUrl.origin} !== ${currentOrigin}`);
          return originalVisit.call(router, href, options);
        }
        // Same origin absolute URL - extract pathname for matching
        urlPath = parsedUrl.pathname;
      } catch {
        log(`SKIP: invalid URL: ${urlPath}`);
        return originalVisit.call(router, href, options);
      }
    }

    // Skip: non-GET requests
    if (options?.method && options.method !== 'get') {
      log(`SKIP: non-GET request: ${options.method}`);
      return originalVisit.call(router, href, options);
    }

    // Skip: URL not in manifest
    const match = matcher.match(urlPath);
    if (!match) {
      log(`SKIP: no manifest match for: ${urlPath}`);
      return originalVisit.call(router, href, options);
    }

    log(`MATCH: ${urlPath} → ${match.route.component}`, { params: match.params, middleware: match.route.middleware });

    // Skip: navigator says we shouldn't optimistically navigate (e.g., auth check)
    if (!navigator.shouldOptimisticallyNavigate(match)) {
      log(`SKIP: shouldOptimisticallyNavigate returned false (auth check failed?)`, { middleware: match.route.middleware });
      return originalVisit.call(router, href, options);
    }

    // Check cache
    const cached = cache.getOrStale(match.url);
    log(`CACHE: ${cached ? (cached.isStale ? 'STALE' : 'FRESH') : 'MISS'} for ${match.url}`);

    // Cache-gating: when preflight has no opinion (null) and cache is empty,
    // fall through to normal Inertia but seed cache on success
    if (!cached && preflight) {
      const preflightResult = preflight.check(match.route.middleware);
      if (preflightResult === null) {
        log(`PASSTHROUGH: no cache and no preflight data for ${match.url}`);

        const passthroughOptions: Record<string, any> = {
          ...options,
          onSuccess: (page: any) => {
            if (page.props?._force10?.preflight) {
              preflight.update(page.props._force10.preflight);
            }
            if (page.component === match.route.component) {
              cache.set(match.url, { component: page.component, props: page.props, url: page.url, timestamp: Date.now() });
            }
            if (options?.onSuccess) options.onSuccess(page);
          },
          onError: (errors: any) => {
            if (options?.onError) options.onError(errors);
          },
        };
        return originalVisit.call(router, href, passthroughOptions);
      }
    }

    // Build background request options
    const backgroundOptions: Record<string, any> = {
      ...options,
      async: true,
      replace: true,
      showProgress: false,
      onSuccess: (page: any) => {
        log(`SUCCESS: server responded for ${page.url}`, { component: page.component, propKeys: Object.keys(page.props || {}) });

        // Update preflight data from response
        if (preflight && page.props?._force10?.preflight) {
          preflight.update(page.props._force10.preflight);
        }

        // Mismatch detection: server returned a different component (e.g., middleware redirected)
        if (page.component !== match.route.component) {
          log(`MISMATCH: expected ${match.route.component}, got ${page.component}`);
          cache.remove(match.url);
          navigator.setLoaded();
          if (options?.onSuccess) options.onSuccess(page);
          return;
        }

        // Update cache with real server data
        cache.set(match.url, {
          component: page.component,
          props: page.props,
          url: page.url,
          timestamp: Date.now(),
        });

        // Process server-side cache invalidation directives
        const serverDirectives = page.props?._force10_server;
        if (serverDirectives?.invalidate) {
          log(`INVALIDATE: ${serverDirectives.invalidate.join(', ')}`);
          for (const pattern of serverDirectives.invalidate) {
            cache.invalidateByPattern(pattern);
          }
        }

        // Clear loading state
        navigator.setLoaded();

        // Call original onSuccess if provided
        if (options?.onSuccess) {
          options.onSuccess(page);
        }
      },
      onError: (errors: any) => {
        log(`ERROR: background request failed`, errors);

        // Clear loading state
        navigator.setLoaded();

        // Call original onError if provided
        if (options?.onError) {
          options.onError(errors);
        }
      },
    };

    // Delay the background server request until AFTER the optimistic push renders.
    //
    // Without this delay, both router.push() and originalVisit() call Inertia's
    // page.set() which uses a componentId counter. If the server response arrives
    // before push resolves its component, the counter increments and push's swap
    // is silently cancelled — the user sees no optimistic navigation.
    //
    // We listen for Inertia's 'navigate' event (fired when router.push() completes
    // its page swap) as the signal to fire the background request. A timeout
    // fallback ensures the request fires even if navigate doesn't fire (e.g., when
    // using router.replace() which doesn't emit navigate, or if push errors).
    let backgroundFired = false;
    const fireBackground = () => {
      if (backgroundFired) return;
      backgroundFired = true;
      removeListener();
      clearTimeout(fallbackTimer);
      cancelPendingBackground = null;
      log(`FETCH: background request → ${href}`);
      originalVisit.call(router, href, backgroundOptions);
    };

    log(`PUSH: optimistic navigate → ${match.route.component}`);
    const removeListener = router.on('navigate', fireBackground);
    const fallbackTimer = setTimeout(fireBackground, 100);

    cancelPendingBackground = () => {
      if (!backgroundFired) {
        log(`CANCEL: pending background for ${href} (new navigation started)`);
        backgroundFired = true;
        removeListener();
        clearTimeout(fallbackTimer);
        navigator.setLoaded();
      }
      cancelPendingBackground = null;
    };

    navigator.optimisticNavigate(match, options);
  }

  // Immediately apply the patch
  router.visit = patchedVisit as typeof router.visit;

  log(`Patch applied. router.visit is now patched: ${router.visit === patchedVisit}`);

  const patch: Force10Patch = {
    apply() {
      router.visit = patchedVisit as typeof router.visit;
    },
    remove() {
      router.visit = originalVisit;
      if (cancelPendingBackground) {
        cancelPendingBackground();
      }
    },
  };

  return patch;
}
