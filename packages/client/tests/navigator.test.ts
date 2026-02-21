import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNavigator } from '../src/navigator';
import type { Force10Cache, Force10Config, MatchResult, CachedPage } from '../src/types';
import { defaultConfig } from '../src/config';

// Mock @inertiajs/core
vi.mock('@inertiajs/core', () => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

import { router } from '@inertiajs/core';

function makeConfig(overrides?: Partial<Force10Config>): Force10Config {
  return { ...defaultConfig, ...overrides };
}

function makeMatch(overrides?: Partial<MatchResult>): MatchResult {
  return {
    route: { pattern: '/users', component: 'Users/Index', middleware: [], parameters: [] },
    params: {},
    url: '/users',
    ...overrides,
  };
}

function makeCache(getResult: { page: CachedPage; isStale: boolean } | null = null): Force10Cache {
  return {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    getOrStale: vi.fn().mockReturnValue(getResult),
    invalidateByPattern: vi.fn(),
    updateProps: vi.fn(),
  };
}

describe('navigator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate Inertia v2's history state (where current page lives)
    (globalThis as any).window = {
      history: { state: { page: { component: 'Dashboard', url: '/dashboard', props: { auth: { user: { id: 1, name: 'Test User' } } } } } },
      location: { origin: 'http://localhost' },
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('calls router.push with correct component and URL', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    const match = makeMatch();
    navigator.optimisticNavigate(match);

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'Users/Index',
        url: '/users',
      }),
    );
  });

  it('uses cached props when available', () => {
    const cachedPage: CachedPage = {
      url: '/users',
      component: 'Users/Index',
      props: { users: [{ id: 1 }] },
      timestamp: Date.now(),
    };
    const cache = makeCache({ page: cachedPage, isStale: false });
    const navigator = createNavigator(cache, makeConfig());
    navigator.optimisticNavigate(makeMatch());

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { users: [{ id: 1 }] },
      }),
    );
  });

  it('uses props function to preserve current props when no cache exists', () => {
    const navigator = createNavigator(makeCache(null), makeConfig());
    navigator.optimisticNavigate(makeMatch());

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.any(Function),
      }),
    );

    // The props function should return whatever is passed to it (identity)
    const call = (router.push as any).mock.calls[0][0];
    const currentProps = { auth: { user: { id: 1 } }, flash: {} };
    expect(call.props(currentProps)).toEqual(currentProps);
  });

  it('skips optimistic nav for auth-protected routes when not authenticated', () => {
    // Override history state to have no auth user
    (globalThis as any).window = {
      history: { state: { page: { component: 'Login', url: '/login', props: { auth: { user: null } } } } },
      location: { origin: 'http://localhost' },
    };

    const match = makeMatch({
      route: { pattern: '/dashboard', component: 'Dashboard', middleware: ['auth'], parameters: [] },
    });
    const navigator = createNavigator(makeCache(), makeConfig());
    expect(navigator.shouldOptimisticallyNavigate(match)).toBe(false);
  });

  it('allows optimistic nav for auth-protected routes when authenticated', () => {
    const match = makeMatch({
      route: { pattern: '/dashboard', component: 'Dashboard', middleware: ['auth'], parameters: [] },
    });
    const navigator = createNavigator(makeCache(), makeConfig());
    expect(navigator.shouldOptimisticallyNavigate(match)).toBe(true);
  });

  it('allows optimistic nav for non-auth routes always', () => {
    const match = makeMatch({
      route: { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    });
    const navigator = createNavigator(makeCache(), makeConfig());
    expect(navigator.shouldOptimisticallyNavigate(match)).toBe(true);
  });

  it('passes preserveScroll option through to router.push', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    navigator.optimisticNavigate(makeMatch(), { preserveScroll: true });

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveScroll: true,
      }),
    );
  });

  it('passes preserveState option through to router.push', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    navigator.optimisticNavigate(makeMatch(), { preserveState: true });

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveState: true,
      }),
    );
  });

  it('uses router.replace when replace option is true', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    navigator.optimisticNavigate(makeMatch(), { replace: true });

    expect(router.replace).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sets isLoading to true during pending navigation', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    expect(navigator.isLoading()).toBe(false);
    navigator.optimisticNavigate(makeMatch());
    expect(navigator.isLoading()).toBe(true);
  });

  it('sets isLoading to false after background response', () => {
    const navigator = createNavigator(makeCache(), makeConfig());
    navigator.optimisticNavigate(makeMatch());
    expect(navigator.isLoading()).toBe(true);
    navigator.setLoaded();
    expect(navigator.isLoading()).toBe(false);
  });
});
