import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPatch } from '../src/patch';
import type { Force10Cache, Force10Config, Force10Matcher, Force10Navigator, Force10Preflight, MatchResult } from '../src/types';
import { defaultConfig } from '../src/config';

const { mockVisit, mockOn, mockOnCleanup } = vi.hoisted(() => {
  const mockOnCleanup = vi.fn();
  return {
    mockVisit: vi.fn(),
    mockOn: vi.fn().mockReturnValue(mockOnCleanup),
    mockOnCleanup,
  };
});

vi.mock('@inertiajs/core', () => ({
  router: {
    visit: mockVisit,
    push: vi.fn(),
    replace: vi.fn(),
    on: mockOn,
  },
}));

import { router } from '@inertiajs/core';

function makeConfig(overrides?: Partial<Force10Config>): Force10Config {
  return { ...defaultConfig, ...overrides };
}

function makeMatch(component: string = 'Users/Index', url: string = '/users'): MatchResult {
  return {
    route: { pattern: url, component, middleware: [], parameters: [] },
    params: {},
    url,
  };
}

function makeMatcher(matchResult: MatchResult | null = null): Force10Matcher {
  return {
    match: vi.fn().mockReturnValue(matchResult),
    isExcluded: vi.fn().mockReturnValue(false),
  };
}

function makeNavigator(): Force10Navigator {
  return {
    optimisticNavigate: vi.fn(),
    shouldOptimisticallyNavigate: vi.fn().mockReturnValue(true),
    isLoading: vi.fn().mockReturnValue(false),
    setLoaded: vi.fn(),
  };
}

function makeCache(): Force10Cache {
  return {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    getOrStale: vi.fn(),
    invalidateByPattern: vi.fn(),
    updateProps: vi.fn(),
  };
}

function makePreflight(checkResult: boolean | null = true): Force10Preflight {
  return {
    update: vi.fn(),
    check: vi.fn().mockReturnValue(checkResult),
  };
}

/** Trigger the most recent navigate event listener registered via router.on */
function triggerNavigate() {
  const navigateCalls = mockOn.mock.calls.filter(([event]: [string]) => event === 'navigate');
  const lastCallback = navigateCalls[navigateCalls.length - 1]?.[1];
  if (lastCallback) lastCallback();
}

describe('patch', () => {
  let originalVisit: typeof router.visit;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    originalVisit = router.visit;
    // Simulate Inertia v2's history state (where current page lives)
    (globalThis as any).window = {
      history: { state: { page: { component: 'Dashboard', url: '/dashboard', props: { auth: { user: { id: 1 } } } } } },
      location: { origin: 'http://localhost' },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    router.visit = originalVisit;
    delete (globalThis as any).window;
  });

  it('patches router.visit on apply', () => {
    const patch = applyPatch(makeNavigator(), makeMatcher(), makeCache(), makeConfig());
    expect(router.visit).not.toBe(mockVisit);
    patch.remove();
  });

  it('restores original router.visit on remove', () => {
    const patch = applyPatch(makeNavigator(), makeMatcher(), makeCache(), makeConfig());
    patch.remove();
    expect(router.visit).toBe(mockVisit);
  });

  it('passes through non-GET requests unchanged', () => {
    const navigator = makeNavigator();
    const patch = applyPatch(navigator, makeMatcher(makeMatch()), makeCache(), makeConfig());

    router.visit('/users', { method: 'post' as any });

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith('/users', expect.objectContaining({ method: 'post' }));
    patch.remove();
  });

  it('passes through unmatched URLs unchanged', () => {
    const navigator = makeNavigator();
    const matcher = makeMatcher(null); // No match
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    router.visit('/unknown');

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith('/unknown', undefined);
    patch.remove();
  });

  it('triggers optimistic navigation for matched GET requests', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');

    expect(navigator.optimisticNavigate).toHaveBeenCalledWith(match, undefined);
    patch.remove();
  });

  it('defers background request until navigate event fires', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');

    // Background request should NOT have fired yet
    expect(mockVisit).not.toHaveBeenCalled();

    // Should have registered a navigate listener
    expect(mockOn).toHaveBeenCalledWith('navigate', expect.any(Function));

    // Trigger navigate event (simulates push completing)
    triggerNavigate();

    // Now the background request should fire
    expect(mockVisit).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        async: true,
        replace: true,
        showProgress: false,
      }),
    );
    patch.remove();
  });

  it('fires background via timeout fallback if navigate does not fire', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');
    expect(mockVisit).not.toHaveBeenCalled();

    // Advance past the 100ms fallback timeout
    vi.advanceTimersByTime(100);

    expect(mockVisit).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        async: true,
        replace: true,
      }),
    );
    patch.remove();
  });

  it('does not double-fire background on both navigate and timeout', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');

    // Fire via navigate event
    triggerNavigate();
    expect(mockVisit).toHaveBeenCalledTimes(1);

    // Timeout fires later — should be a no-op
    vi.advanceTimersByTime(100);
    expect(mockVisit).toHaveBeenCalledTimes(1);

    patch.remove();
  });

  it('cleans up navigate listener after background fires', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');
    triggerNavigate();

    // The cleanup function returned by router.on should have been called
    expect(mockOnCleanup).toHaveBeenCalled();
    patch.remove();
  });

  it('suppresses progress bar on background request', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');
    triggerNavigate();

    expect(mockVisit).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({ showProgress: false }),
    );
    patch.remove();
  });

  it('updates cache on successful background response', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig());

    router.visit('/users');
    triggerNavigate();

    // Get the onSuccess callback that was passed to the original visit
    const visitOptions = mockVisit.mock.calls[0][1];
    expect(visitOptions.onSuccess).toBeDefined();

    // Simulate server response
    const page = { component: 'Users/Index', props: { users: [] }, url: '/users', version: '1' };
    visitOptions.onSuccess(page);

    expect(cache.set).toHaveBeenCalled();
    patch.remove();
  });

  it('handles URL object input', () => {
    const navigator = makeNavigator();
    const match = makeMatch('Users/Index', '/users?page=2');
    const matcher = makeMatcher(match);
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    const url = new URL('http://localhost/users?page=2#team');
    router.visit(url as any);

    expect(matcher.match).toHaveBeenCalledWith('/users?page=2');
    expect(navigator.optimisticNavigate).toHaveBeenCalledWith(match, undefined);
    patch.remove();
  });

  it('skips hash-only navigation', () => {
    const navigator = makeNavigator();
    const patch = applyPatch(navigator, makeMatcher(makeMatch()), makeCache(), makeConfig());

    router.visit('#section');

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    patch.remove();
  });

  it('skips same-page navigation', () => {
    const navigator = makeNavigator();
    const patch = applyPatch(navigator, makeMatcher(makeMatch('Dashboard', '/dashboard')), makeCache(), makeConfig());

    // Current page is /dashboard
    router.visit('/dashboard');

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith('/dashboard', undefined);
    patch.remove();
  });

  it('skips external URLs', () => {
    const navigator = makeNavigator();
    const patch = applyPatch(navigator, makeMatcher(makeMatch()), makeCache(), makeConfig());

    router.visit('https://external.com/page');

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    patch.remove();
  });

  it('skips URLs excluded by config matcher', () => {
    const navigator = makeNavigator();
    const matcher = makeMatcher(makeMatch());
    (matcher.isExcluded as any).mockReturnValue(true);
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    router.visit('/admin');

    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith('/admin', undefined);
    patch.remove();
  });

  it('matches same-origin absolute URL strings with query intact', () => {
    const navigator = makeNavigator();
    const match = makeMatch('Users/Index', '/users?page=2');
    const matcher = makeMatcher(match);
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    router.visit('http://localhost/users?page=2');

    expect(matcher.match).toHaveBeenCalledWith('/users?page=2');
    expect(navigator.optimisticNavigate).toHaveBeenCalledWith(match, undefined);
    patch.remove();
  });

  it('invalidates cache by pattern from server directives on success', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig());

    router.visit('/users');
    triggerNavigate();

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = {
      component: 'Users/Index',
      props: {
        users: [],
        _force10_server: { invalidate: ['/users/*', '/dashboard'] },
      },
      url: '/users',
      version: '1',
    };
    visitOptions.onSuccess(page);

    expect(cache.invalidateByPattern).toHaveBeenCalledWith('/users/*');
    expect(cache.invalidateByPattern).toHaveBeenCalledWith('/dashboard');
    patch.remove();
  });

  it('handles server response with no invalidation directives', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig());

    router.visit('/users');
    triggerNavigate();

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = { component: 'Users/Index', props: { users: [] }, url: '/users', version: '1' };
    visitOptions.onSuccess(page);

    expect(cache.invalidateByPattern).not.toHaveBeenCalled();
    patch.remove();
  });

  it('cancels pending background when new navigation starts', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const matchB = makeMatch('Posts/Index', '/posts');
    const matcher: Force10Matcher = {
      match: vi.fn()
        .mockReturnValueOnce(match)
        .mockReturnValueOnce(matchB),
      isExcluded: vi.fn().mockReturnValue(false),
    };
    (navigator.shouldOptimisticallyNavigate as any).mockReturnValue(true);
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    // First navigation
    router.visit('/users');
    expect(mockVisit).not.toHaveBeenCalled();

    // Second navigation before first's background fires
    router.visit('/posts');

    // Trigger navigate for the second navigation
    triggerNavigate();

    // Only the second background should fire
    expect(mockVisit).toHaveBeenCalledTimes(1);
    expect(mockVisit).toHaveBeenCalledWith('/posts', expect.objectContaining({ async: true }));

    // First's timeout should also be a no-op
    vi.advanceTimersByTime(100);
    expect(mockVisit).toHaveBeenCalledTimes(1);

    patch.remove();
  });

  it('cancels pending background for non-Force10 navigations too', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const matcher: Force10Matcher = {
      match: vi.fn()
        .mockReturnValueOnce(match)
        .mockReturnValueOnce(null), // Second visit doesn't match
      isExcluded: vi.fn().mockReturnValue(false),
    };
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    // Force10 navigation
    router.visit('/users');
    expect(mockVisit).not.toHaveBeenCalled();

    // Non-Force10 navigation (falls through to originalVisit synchronously)
    router.visit('/unknown');
    expect(mockVisit).toHaveBeenCalledTimes(1);
    expect(mockVisit).toHaveBeenCalledWith('/unknown', undefined);

    // Original Force10 background should never fire
    vi.advanceTimersByTime(100);
    expect(mockVisit).toHaveBeenCalledTimes(1);

    patch.remove();
  });

  it('resets loading state when background is cancelled', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const matcher: Force10Matcher = {
      match: vi.fn()
        .mockReturnValueOnce(match)
        .mockReturnValueOnce(null),
      isExcluded: vi.fn().mockReturnValue(false),
    };
    const patch = applyPatch(navigator, matcher, makeCache(), makeConfig());

    // Force10 navigation sets loading state
    router.visit('/users');

    // Non-Force10 navigation cancels the pending background
    router.visit('/unknown');

    // Loading state should have been reset
    expect(navigator.setLoaded).toHaveBeenCalled();
    patch.remove();
  });

  it('cancels pending background on patch remove', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    router.visit('/users');
    expect(mockVisit).not.toHaveBeenCalled();

    // Remove the patch while background is pending
    patch.remove();

    // Timeout should not fire the background
    vi.advanceTimersByTime(100);
    expect(mockVisit).not.toHaveBeenCalled();
  });

  it('skips optimistic nav when preflight returns false', () => {
    const navigator = makeNavigator();
    (navigator.shouldOptimisticallyNavigate as any).mockReturnValue(false);
    const match = makeMatch();
    const preflight = makePreflight(false);
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig(), preflight);

    router.visit('/users');

    // Should fall through to original visit directly
    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith('/users', undefined);
    patch.remove();
  });

  it('optimistic navigates when preflight returns true and cache misses', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const preflight = makePreflight(true);
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig(), preflight);

    router.visit('/users');

    // Preflight passes, so optimistic nav should happen even on cache miss
    expect(navigator.optimisticNavigate).toHaveBeenCalledWith(match, undefined);
    patch.remove();
  });

  it('falls through to normal Inertia when preflight returns null and cache misses', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const cache = makeCache();
    (cache.getOrStale as any).mockReturnValue(null);
    const preflight = makePreflight(null);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');

    // No optimistic nav — passthrough to original visit
    expect(navigator.optimisticNavigate).not.toHaveBeenCalled();
    expect(mockVisit).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    patch.remove();
  });

  it('passthrough seeds cache when component matches', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const cache = makeCache();
    (cache.getOrStale as any).mockReturnValue(null);
    const preflight = makePreflight(null);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = { component: 'Users/Index', props: { users: [] }, url: '/users' };
    visitOptions.onSuccess(page);

    expect(cache.set).toHaveBeenCalledWith('/users', expect.objectContaining({
      component: 'Users/Index',
      props: { users: [] },
      url: '/users',
    }));
    patch.remove();
  });

  it('passthrough does not seed cache when component mismatches (redirect)', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const cache = makeCache();
    (cache.getOrStale as any).mockReturnValue(null);
    const preflight = makePreflight(null);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');

    const visitOptions = mockVisit.mock.calls[0][1];
    // Server returned a different component (redirect happened)
    const page = { component: 'Auth/ConfirmPassword', props: {}, url: '/confirm-password' };
    visitOptions.onSuccess(page);

    expect(cache.set).not.toHaveBeenCalled();
    patch.remove();
  });

  it('passthrough updates preflight from response', () => {
    const navigator = makeNavigator();
    const match = makeMatch();
    const cache = makeCache();
    (cache.getOrStale as any).mockReturnValue(null);
    const preflight = makePreflight(null);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = {
      component: 'Users/Index',
      props: { users: [], _force10: { preflight: { auth: { pass: true } } } },
      url: '/users',
    };
    visitOptions.onSuccess(page);

    expect(preflight.update).toHaveBeenCalledWith({ auth: { pass: true } });
    patch.remove();
  });

  it('background response updates preflight data', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch();
    const preflight = makePreflight(true);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');
    triggerNavigate();

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = {
      component: 'Users/Index',
      props: { users: [], _force10: { preflight: { auth: { pass: true } } } },
      url: '/users',
      version: '1',
    };
    visitOptions.onSuccess(page);

    expect(preflight.update).toHaveBeenCalledWith({ auth: { pass: true } });
    patch.remove();
  });

  it('background mismatch removes cache entry and stops loading', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch();
    const preflight = makePreflight(true);
    const patch = applyPatch(navigator, makeMatcher(match), cache, makeConfig(), preflight);

    router.visit('/users');
    triggerNavigate();

    const visitOptions = mockVisit.mock.calls[0][1];
    // Server returned a different component (middleware redirected after state changed)
    const page = {
      component: 'Auth/ConfirmPassword',
      props: {},
      url: '/confirm-password',
      version: '1',
    };
    visitOptions.onSuccess(page);

    expect(cache.remove).toHaveBeenCalledWith('/users');
    expect(navigator.setLoaded).toHaveBeenCalled();
    // Should NOT cache the mismatched response under the original URL
    expect(cache.set).not.toHaveBeenCalled();
    patch.remove();
  });

  it('stores query-specific cache keys for absolute URL navigations', () => {
    const navigator = makeNavigator();
    const cache = makeCache();
    const match = makeMatch('Users/Index', '/users?page=2');
    const matcher = makeMatcher(match);
    const patch = applyPatch(navigator, matcher, cache, makeConfig());

    router.visit('http://localhost/users?page=2');
    triggerNavigate();

    const visitOptions = mockVisit.mock.calls[0][1];
    const page = {
      component: 'Users/Index',
      props: { users: [] },
      url: '/users?page=2',
      version: '1',
    };
    visitOptions.onSuccess(page);

    expect(cache.set).toHaveBeenCalledWith('/users?page=2', expect.objectContaining({ url: '/users?page=2' }));
    patch.remove();
  });
});
