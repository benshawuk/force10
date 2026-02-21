import { describe, it, expect } from 'vitest';
import { createMatcher } from '../src/matcher';
import type { Force10Config, Force10Manifest } from '../src/types';
import { defaultConfig } from '../src/config';

function makeManifest(routes: Force10Manifest['routes']): Force10Manifest {
  return { routes };
}

function makeConfig(overrides?: Partial<Force10Config>): Force10Config {
  return { ...defaultConfig, ...overrides };
}

describe('matcher', () => {
  it('matches exact static routes', () => {
    const manifest = makeManifest([
      { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/about');
    expect(result).not.toBeNull();
    expect(result!.route.component).toBe('About');
    expect(result!.params).toEqual({});
  });

  it('matches routes with single parameter', () => {
    const manifest = makeManifest([
      { pattern: '/users/:id', component: 'Users/Show', middleware: [], parameters: [{ name: 'id', required: true }] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/users/5');
    expect(result).not.toBeNull();
    expect(result!.route.component).toBe('Users/Show');
    expect(result!.params).toEqual({ id: '5' });
  });

  it('matches routes with multiple parameters', () => {
    const manifest = makeManifest([
      { pattern: '/teams/:teamId/members/:memberId', component: 'Teams/Members/Show', middleware: [], parameters: [{ name: 'teamId', required: true }, { name: 'memberId', required: true }] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/teams/3/members/7');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ teamId: '3', memberId: '7' });
  });

  it('matches routes with optional parameters', () => {
    const manifest = makeManifest([
      { pattern: '/users/:id?', component: 'Users/Index', middleware: [], parameters: [{ name: 'id', required: false }] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());

    const withParam = matcher.match('/users/5');
    expect(withParam).not.toBeNull();
    expect(withParam!.params).toEqual({ id: '5' });

    const withoutParam = matcher.match('/users');
    expect(withoutParam).not.toBeNull();
    expect(withoutParam!.params).toEqual({});
  });

  it('returns null for unmatched URLs', () => {
    const manifest = makeManifest([
      { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    expect(matcher.match('/contact')).toBeNull();
  });

  it('strips query strings before matching', () => {
    const manifest = makeManifest([
      { pattern: '/users', component: 'Users/Index', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/users?page=2&sort=name');
    expect(result).not.toBeNull();
    expect(result!.route.component).toBe('Users/Index');
  });

  it('strips hash before matching', () => {
    const manifest = makeManifest([
      { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/about#section');
    expect(result).not.toBeNull();
  });

  it('handles trailing slashes', () => {
    const manifest = makeManifest([
      { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    expect(matcher.match('/about/')).not.toBeNull();
    expect(matcher.match('/about')).not.toBeNull();
  });

  it('handles URL-encoded segments', () => {
    const manifest = makeManifest([
      { pattern: '/users/:name', component: 'Users/Show', middleware: [], parameters: [{ name: 'name', required: true }] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/users/john%20doe');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ name: 'john doe' });
  });

  it('respects exclude patterns', () => {
    const config = makeConfig({ routes: { exclude: ['/admin*', '/api/*'] } });
    const manifest = makeManifest([
      { pattern: '/admin', component: 'Admin', middleware: [], parameters: [] },
      { pattern: '/about', component: 'About', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, config);
    expect(matcher.isExcluded('/admin')).toBe(true);
    expect(matcher.isExcluded('/admin/dashboard')).toBe(true);
    expect(matcher.isExcluded('/api/users')).toBe(true);
    expect(matcher.isExcluded('/about')).toBe(false);
  });

  it('matches most specific route first', () => {
    const manifest = makeManifest([
      { pattern: '/users/:id', component: 'Users/Show', middleware: [], parameters: [{ name: 'id', required: true }] },
      { pattern: '/users/create', component: 'Users/Create', middleware: [], parameters: [] },
    ]);
    const matcher = createMatcher(manifest, makeConfig());
    const result = matcher.match('/users/create');
    expect(result).not.toBeNull();
    expect(result!.route.component).toBe('Users/Create');
  });
});
