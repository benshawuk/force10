import { test, expect } from '@playwright/test';

test.describe('Force10', () => {
  test('initializes and logs debug messages', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[Force10]')) {
        logs.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Home');

    expect(logs.some((l) => l.includes('Initialized with'))).toBe(true);
  });

  test('slow server: baseline takes 3s, Force10 is instant', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[Force10]')) {
        logs.push(msg.text());
      }
    });

    // --- BASELINE: full page load must wait for server ---
    // Delay ALL requests to /about by 3 seconds
    await page.route('**/about', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    const baselineStart = Date.now();
    await page.goto('/about');
    await expect(page.locator('h1')).toHaveText('About');
    const baselineMs = Date.now() - baselineStart;

    // Baseline MUST be slow — this proves our delay is real
    expect(baselineMs).toBeGreaterThan(2500);

    // Clear all route handlers
    await page.unrouteAll();

    // --- FORCE10: link click should be instant despite same delay ---
    // First, go to Home (no delay)
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Home');
    logs.length = 0; // Clear logs from baseline

    // Now delay only Inertia XHR to /about (same 3s)
    await page.route('**/about', async (route) => {
      const headers = route.request().headers();
      if (headers['x-inertia']) {
        await new Promise((r) => setTimeout(r, 3000));
      }
      await route.continue();
    });

    const force10Start = Date.now();
    await page.click('a[href="/about"]');
    await expect(page.locator('h1')).toHaveText('About', { timeout: 2000 });
    const force10Ms = Date.now() - force10Start;

    // Force10 MUST be fast — this is the whole point
    expect(force10Ms).toBeLessThan(500);

    // Verify Force10 actually intercepted (not just Inertia being fast)
    expect(logs.some((l) => l.includes('PUSH: optimistic navigate'))).toBe(true);
    expect(logs.some((l) => l.includes('FETCH: background request'))).toBe(true);

    // Log the actual numbers for diagnostic clarity
    console.log(`Baseline: ${baselineMs}ms | Force10: ${force10Ms}ms | Speedup: ${(baselineMs / force10Ms).toFixed(1)}x`);
  });

  test('offline: navigate between visited pages with network down', async ({ context, page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[Force10]')) {
        logs.push(msg.text());
      }
    });
    page.on('pageerror', () => {}); // Suppress errors from failed background requests

    // Visit home
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Home');

    // Visit about (so Force10 caches it)
    await page.click('a[href="/about"]');
    await expect(page.locator('h1')).toHaveText('About');

    // Wait for the background server response to complete and cache
    await page.waitForTimeout(500);

    // Go offline
    await context.setOffline(true);

    // Verify we're actually offline — a fetch should fail
    const isOffline = await page.evaluate(async () => {
      try {
        await fetch('/', { signal: AbortSignal.timeout(1000) });
        return false;
      } catch {
        return true;
      }
    });
    expect(isOffline).toBe(true);

    logs.length = 0; // Clear previous logs

    // Click Home link — Force10 should render from cache despite being offline
    await page.click('a[href="/"]');
    await expect(page.locator('h1')).toHaveText('Home', { timeout: 3000 });

    // Verify Force10 did the work
    expect(logs.some((l) => l.includes('PUSH: optimistic navigate'))).toBe(true);

    // Navigate back to about — also cached
    await page.click('a[href="/about"]');
    await expect(page.locator('h1')).toHaveText('About', { timeout: 3000 });

    await context.setOffline(false);
  });

  test('cache: second visit to a page is faster than the first', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[Force10]')) {
        logs.push(msg.text());
      }
    });

    // Visit home (full page load)
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Home');

    // First visit to /about via link click
    const firstStart = Date.now();
    await page.click('a[href="/about"]');
    await expect(page.locator('h1')).toHaveText('About');
    const firstMs = Date.now() - firstStart;

    // Wait for background response to complete (populates cache)
    await page.waitForTimeout(300);

    // Second visit: go back to home then to about again
    await page.click('a[href="/"]');
    await expect(page.locator('h1')).toHaveText('Home');
    await page.waitForTimeout(300);

    logs.length = 0;

    const secondStart = Date.now();
    await page.click('a[href="/about"]');
    await expect(page.locator('h1')).toHaveText('About');
    const secondMs = Date.now() - secondStart;

    // Verify cache was used on second visit
    expect(logs.some((l) => l.includes('CACHE:') && !l.includes('MISS'))).toBe(true);

    // Second visit should be fast (from cache)
    expect(secondMs).toBeLessThan(500);

    console.log(`First visit: ${firstMs}ms | Second visit (cached): ${secondMs}ms`);
  });
});
