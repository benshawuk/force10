# Force10 — Project Guide

## What Is Force10?

Force10 is an Inertia.js plugin that makes navigation instant. When a user clicks a Link, Force10 intercepts `router.visit()`, immediately renders the target page component (with cached or preserved props) via `router.push()`, then fires the real server request in the background. When the server responds, Inertia updates props seamlessly.

## Project Structure

```
force10/
├── packages/
│   ├── client/              # @force10/client (NPM) — TypeScript
│   │   ├── src/
│   │   │   ├── index.ts     # Entry: initForce10(manifest, config?)
│   │   │   ├── types.ts     # All interfaces (Force10Config, ManifestRoute, etc.)
│   │   │   ├── config.ts    # Runtime config with deep merge
│   │   │   ├── debug.ts     # [Force10] conditional console logging
│   │   │   ├── matcher.ts   # URL→component route matching with regex cache
│   │   │   ├── cache.ts     # SWR prop cache with TTL + LRU eviction
│   │   │   ├── navigator.ts # Optimistic router.push/replace
│   │   │   └── patch.ts     # router.visit monkey-patch
│   │   ├── tests/           # Vitest — 48 tests, ALL PASSING
│   │   ├── tsup.config.ts   # Build: ESM + CJS + DTS
│   │   └── vitest.config.ts
│   ├── vite/                # force10-vite (NPM) — Vite plugin
│   │   └── src/index.ts     # Manifest gen + HMR + virtual module + preload
│   └── laravel/             # force10/laravel (Composer)
│       ├── src/
│       │   ├── Force10ServiceProvider.php  # Registers middleware + @force10Preload directive
│       │   ├── RouteScanner.php           # Scans Laravel GET routes
│       │   ├── ComponentResolver.php      # Resolves Inertia component names
│       │   ├── ManifestWriter.php         # Generates TS manifest file
│       │   ├── ManifestEntry.php          # Value object
│       │   ├── PreloadTagGenerator.php    # Generates <link rel="modulepreload"> tags
│       │   ├── Middleware/
│       │   │   └── Force10CacheControl.php  # Server-side cache invalidation
│       │   └── Commands/
│       │       ├── GenerateCommand.php  # force10:generate (--verbose)
│       │       └── InstallCommand.php   # force10:install
│       ├── config/force10.php
│       └── tests/           # Pest — 26 tests (46 assertions), ALL PASSING
├── test-app/                # Laravel 12 + Inertia v2 + React 19 demo app
├── CONTRACTS.md             # Full spec of interfaces & module behaviors
└── package.json             # Bun workspace root
```

## Tooling

- **Package manager**: bun (not npm/pnpm — user has aliases)
- **JS build**: tsup (ESM + CJS + DTS)
- **JS test**: vitest
- **PHP test**: pest (with orchestra/testbench)
- **Monorepo**: bun workspaces (packages/* + test-app)

## Commands

```bash
# Run client tests (from project root or packages/client)
cd packages/client && bunx vitest run

# Run PHP tests
cd packages/laravel && ./vendor/bin/pest

# Build client package
cd packages/client && bunx tsup

# Build vite plugin
cd packages/vite && bunx tsup

# Generate manifest in test-app
cd test-app && php artisan force10:generate

# Build test-app (verifies full integration)
cd test-app && bunx vite build

# Run test-app dev servers
cd test-app && php artisan serve --port=8000
cd test-app && bunx vite --port=5173
```

## Current Status: BLOCKED — Race Condition in patch.ts

### The Core Bug: `page.set()` componentId Race

Force10's patch calls `router.push()` then `originalVisit()` back-to-back. Both internally call Inertia's `page.set()`, which has a componentId cancellation mechanism:

```javascript
// Inside Inertia's page.set() (simplified from v2.3.15 source):
async set(page, options) {
    const componentId = ++this.componentId;  // Increment counter
    const component = await this.resolve(page.component);  // Async import()
    if (componentId !== this.componentId) return;  // ABORT if stale
    // ... history update, swap component
}
```

**What happens:**
1. `router.push()` → queues `performClientVisit` → `page.set()` with componentId=N → starts async `resolveComponent` (dynamic import)
2. `originalVisit()` fires server request immediately (same tick)
3. Server responds → `page.set()` with componentId=N+1 → starts async `resolveComponent`
4. Client visit's `resolveComponent` finishes → checks componentId → sees N≠N+1 → **ABORTS** (never swaps)
5. Server visit's `resolveComponent` finishes → checks componentId → sees N+1=N+1 → **swaps** (this is what the user sees)

**Result:** The optimistic push is silently canceled. Navigation only completes when the server responds.

### The Fix Needed

Delay the background server request until AFTER the optimistic push renders. Use Inertia's `navigate` event (fired when `router.push()` completes its page swap):

```javascript
// In patch.ts — REPLACE the current approach:

// CURRENT (broken — race condition):
navigator.optimisticNavigate(match, options);
originalVisit.call(router, href, backgroundOptions);  // Cancels the push!

// FIXED (wait for push to render):
let backgroundFired = false;
const fireBackground = () => {
    if (backgroundFired) return;
    backgroundFired = true;
    removeListener();
    originalVisit.call(router, href, backgroundOptions);
};
const removeListener = router.on('navigate', fireBackground);
navigator.optimisticNavigate(match, options);
setTimeout(fireBackground, 100);  // Fallback if navigate doesn't fire
```

**Why this works:**
- `router.push()` (replace=false) fires the `navigate` event after `page.set()` completes (component resolved + swapped)
- `originalVisit()` with `replace: true` does NOT fire `navigate` (no event conflict)
- Fallback timeout ensures the server request fires even if push errors

**Key Inertia v2 facts (confirmed from source, v2.3.15):**
- `router.push()` uses a `clientVisitQueue` (Promise-based sequential queue)
- `router.visit()` uses `asyncRequestStream` (independent from client visit queue)
- They don't cancel each other at the queue level — the conflict is inside `page.set()`
- `navigate` event fires for `push()` (replace=false) but NOT for `replace: true`
- `page.set()` componentId check is the ONLY cancellation mechanism

### What's Already Done (This Session)

1. **Fixed empty props crash** — navigator.ts now uses `props: (currentProps) => currentProps` on cache miss instead of `props: {}` which wiped all props and crashed components
2. **Removed broken client-side preloading** — removed `pages: import.meta.glob(...)` option from `initForce10()` and `InstallCommand.php`
3. **Added `@force10Preload` Blade directive** — `PreloadTagGenerator.php` generates `<link rel="modulepreload">` tags for production
4. **Added Vite plugin preloading** — virtual module now includes a `preload()` function with static `import()` calls for each manifest route component, called automatically by `initForce10()`
5. **All tests pass** — 48 client + 26 PHP = 74 total

### What Needs To Be Done Next

1. **Fix the race condition in patch.ts** — implement the `navigate` event delay approach shown above
2. **Test in browser** — verify optimistic push renders before server response
3. **Update patch.test.ts** — update tests for the new async flow
4. **Build + reinstall** — `cd packages/client && bunx tsup` then `cd forcetest && bun install`

### Test Project

- Location: `/Users/benshaw/Documents/Coding/laravel/forcetest/`
- Fresh Laravel 12 + Inertia v2 + React 19 + Fortify
- Local packages installed via `bun install ../force10/packages/client ../force10/packages/vite`
- Servers: `php artisan serve --port=8000` + `bunx vite --port=5173`
- `app.tsx` is up to date: `initForce10(manifest, { debug: true })`
- `app.blade.php` has `@force10Preload` after `@inertiaHead`
- Sandbox removed — Claude can edit files directly now

## Architecture Notes

### Core Mechanism (intended, after fix)
```
Link click → router.visit() [patched]
  → Match URL against manifest (matcher.ts)
  → Call router.push({ component, url, props: cached || fn })  ← INSTANT
  → Wait for push to render (navigate event)
  → Call originalVisit(href, { async:true, replace:true })     ← BACKGROUND
  → Server responds → Inertia updates props seamlessly         ← SEAMLESS
```

### Module Dependencies
```
types.ts ← config.ts ← debug.ts
                ↑
manifest → matcher.ts ← patch.ts → navigator.ts
                           ↑           ↑
                           └── cache.ts ┘
```

### Inertia v2 Internals (confirmed from @inertiajs/core v2.3.15)

**`router.push(params)` flow:**
1. `push(params)` → `clientVisit(params)` → `clientVisitQueue.add(performClientVisit)`
2. Queue processes via `Promise.resolve(next()).then(processNext)`
3. `performClientVisit` → builds page object (`{ ...currentPage, ...params }`) → `page.set(page2)`
4. `page.set()` → increments `componentId` → `resolveComponent(name)` → async `import()` → `swapComponent()`
5. After swap: fires `navigate` event (only if replace=false)

**`router.visit(url, options)` flow:**
1. Constructs request params, cancels in-flight async requests
2. Sends via `asyncRequestStream.send()` (XHR/fetch)
3. On response: `page.set(serverPage)` → same componentId/resolve/swap flow

**Key interactions:**
- `clientVisitQueue` and `asyncRequestStream` are fully independent
- Conflict is inside `page.set()` via `componentId` counter
- `props` can be a function: `(currentProps, onceProps) => mergedProps`

### Key Design Decisions
- Factory pattern (`createX()`) not classes — returns interface objects
- All modules tree-shakeable (named exports, no side effects)
- Manifest is generated server-side (PHP), consumed client-side (TS)
- Virtual module `virtual:force10-manifest` served by Vite plugin
- Vite plugin adds `preload()` to virtual module with static `import()` calls per component
- SWR cache: show stale data instantly, refresh in background
- `@force10Preload` Blade directive for production `<link rel="modulepreload">` tags
- Props preservation: use Inertia props function `(current) => current` on cache miss

## Test Coverage

| Module | Tests | Status |
|--------|-------|--------|
| config.ts | 3 | PASS |
| cache.ts | 9 | PASS |
| matcher.ts | 11 | PASS |
| navigator.ts | 11 | PASS |
| patch.ts | 14 | PASS |
| RouteScanner.php | 5 | PASS |
| ComponentResolver.php | 8 | PASS |
| ManifestWriter.php | 5 | PASS |
| Force10CacheControl.php | 3 | PASS |
| PreloadTagGenerator.php | 5 | PASS |
| **Total** | **74** | **ALL PASS** |
