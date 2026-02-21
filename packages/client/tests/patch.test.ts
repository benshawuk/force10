import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPatch } from '../src/patch';
import type { Force10Cache, Force10Config, Force10Matcher, Force10Navigator, MatchResult } from '../src/types';
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
    const match = makeMatch();
    const patch = applyPatch(navigator, makeMatcher(match), makeCache(), makeConfig());

    const url = new URL('http://localhost/users');
    router.visit(url as any);

    expect(navigator.optimisticNavigate).toHaveBeenCalled();
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
});
