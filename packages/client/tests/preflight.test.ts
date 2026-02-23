import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPreflight } from '../src/preflight';

describe('preflight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when all middleware pass', () => {
    const preflight = createPreflight();
    preflight.update({
      auth: { pass: true },
      verified: { pass: true },
    });

    expect(preflight.check(['auth', 'verified'])).toBe(true);
  });

  it('returns false when any middleware fails', () => {
    const preflight = createPreflight();
    preflight.update({
      auth: { pass: true },
      'password.confirm': { pass: false },
    });

    expect(preflight.check(['auth', 'password.confirm'])).toBe(false);
  });

  it('returns null when no middleware have preflight data', () => {
    const preflight = createPreflight();
    preflight.update({ auth: { pass: true } });

    expect(preflight.check(['custom.middleware'])).toBeNull();
  });

  it('returns false when expiresAt is in the past', () => {
    const preflight = createPreflight();
    const pastTime = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
    preflight.update({
      'password.confirm': { pass: true, expiresAt: pastTime },
    });

    expect(preflight.check(['password.confirm'])).toBe(false);
  });

  it('returns true when expiresAt is in the future', () => {
    const preflight = createPreflight();
    const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    preflight.update({
      'password.confirm': { pass: true, expiresAt: futureTime },
    });

    expect(preflight.check(['password.confirm'])).toBe(true);
  });

  it('update replaces previous data', () => {
    const preflight = createPreflight();
    preflight.update({ auth: { pass: true } });
    expect(preflight.check(['auth'])).toBe(true);

    preflight.update({ auth: { pass: false } });
    expect(preflight.check(['auth'])).toBe(false);
  });

  it('ignores middleware not in preflight data (partial coverage)', () => {
    const preflight = createPreflight();
    preflight.update({ auth: { pass: true } });

    // 'auth' has data and passes, 'unknown' has no data — still returns true
    // because at least one middleware had data and it passed
    expect(preflight.check(['auth', 'unknown'])).toBe(true);
  });

  it('returns null for empty middleware array', () => {
    const preflight = createPreflight();
    preflight.update({ auth: { pass: true } });

    expect(preflight.check([])).toBeNull();
  });
});
