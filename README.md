# Force10

**Make Inertia.js navigations instant.** Zero changes to your components.

```
composer require force10/laravel
npm install @force10/client force10-vite
php artisan force10:install
```

That's it. Every link click now renders in under 50ms.

## The Problem

Inertia.js feels instant in development. Your server is localhost, the round trip is < 10ms, and every click feels like a SPA. Then you deploy.

On production, that same click now waits for a real network round trip — 100–300ms on a good connection. Behind a slow database query or an overloaded server, it's 500ms+. On a mobile connection or from the other side of the world? Over a second per click. **Simulate "Fast 3G" in Chrome DevTools on any Inertia app and you'll see exactly what your users experience.**

This isn't a bug. It's Inertia's architecture:

```
User clicks link
  → HTTP request to server (100–1000ms+ depending on network, server, DB)
    → Server runs controller, queries database, builds props
      → JSON response sent back
        → Inertia resolves component via dynamic import()
          → Page renders
```

Every navigation is **blocked by the server**. The client can't render anything until it gets the response back, because the server decides which component to load and what props to pass. Unlike a traditional SPA where the router knows every route and can render immediately, Inertia has to ask the server first — every single time.

The waterfall is invisible on localhost. It's painfully obvious in production.

## The Solution

Force10 gives Inertia the one thing it's missing: **the client knows the routes.**

At build time, Force10 scans your Laravel routes and generates a manifest mapping URL patterns to Inertia component names. Now the client knows that `/users` renders `Users/Index` and `/users/:id` renders `Users/Show` — without asking the server.

When a user clicks a link:

```
User clicks link
  → Force10 matches URL against manifest (< 1ms)
  → router.push() renders the component INSTANTLY
  → Background request fetches real props from server
  → Props update seamlessly when response arrives
```

The page appears immediately. Data fills in moments later. The server is still the source of truth — Force10 just removes it from the critical rendering path.

**With page component preloading**, the dynamic `import()` resolves from memory instead of fetching a chunk over the network. Combined with SWR caching of props, repeat visits render with full data in under 1ms.

### Before and After

| | Without Force10 | With Force10 |
|---|---|---|
| First click | 200–500ms (server round trip) | < 50ms (instant render, data follows) |
| Repeat visit | 200–500ms (same round trip) | < 1ms (cached props, preloaded component) |
| Slow server (3s query) | 3000ms+ blocked | < 50ms render, data arrives at 3000ms |
| Offline | Broken | Works from cache |
| Component code changes | None | None |

## How It Works

Force10 has three packages that work together:

**`force10/laravel`** scans your Laravel routes at build time and generates a manifest file — a simple mapping of URL patterns to Inertia component names and middleware.

**`force10-vite`** serves the manifest as a virtual module during development, regenerates it via HMR when routes change, and injects `import()` calls that preload every page component chunk on app boot.

**`@force10/client`** patches `router.visit()` to intercept navigation. When a link click matches a manifest route, it calls `router.push()` to render the component instantly, then fires the real server request in the background. When the server responds, Inertia updates props seamlessly — the user never sees a loading state for cached pages.

```
                    ┌─────────────────────────┐
 Link click ───────►  router.visit() [patched] │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Match URL → manifest   │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                     │
 ┌────────────▼────────────┐         ┌──────────────▼──────────────┐
 │  router.push() INSTANT  │         │  originalVisit() BACKGROUND │
 │  (cached or current     │         │  (async: true, replace: true)│
 │   props preserved)      │         └──────────────┬──────────────┘
 └─────────────────────────┘                        │
                                     ┌──────────────▼──────────────┐
                                     │  Server responds → props    │
                                     │  update seamlessly + cache  │
                                     └─────────────────────────────┘
```

### What Gets Preloaded

Force10 preloads only the **page component chunks** — the code-split files for each page in your `resources/js/pages/` directory. Shared code (React, your layout, UI libraries) is already loaded with the initial page visit. Page chunks are typically a few KB each. For a 20-route app, preloading all of them adds a few hundred KB loaded in parallel after boot — negligible on any connection.

## Installation

### 1. Install packages

```bash
composer require force10/laravel
npm install @force10/client force10-vite
```

### 2. Run the installer

```bash
php artisan force10:install
```

This automatically:
- Publishes the config file
- Adds the Vite plugin to `vite.config.ts`
- Writes TypeScript type declarations for the virtual module
- Injects `initForce10()` into your app entry point
- Adds `@force10Preload` to your Blade layout (for production preload tags)
- Generates the initial route manifest

### 3. Done

No changes to your components. No special Link component. No wrapper. Force10 is invisible — it patches Inertia's router at the framework level.

## Loading States

On first visit to a page (no cache), Force10 renders the component with the current page's props preserved. For the best experience, use Inertia's built-in `<Deferred>` component so expensive data loads gracefully:

```php
// In your Laravel controller
return Inertia::render('Users/Index', [
    'users' => Inertia::defer(fn() => User::all()),
]);
```

```tsx
// In your React component — no Force10-specific code
import { Deferred } from "@inertiajs/react";

export default function UsersIndex({ users }) {
  return (
    <Deferred data="users" fallback={<UsersSkeleton />}>
      <UserTable users={users} />
    </Deferred>
  );
}
```

The skeleton shows during instant navigation, then disappears when real data arrives. On repeat visits, cached props are available immediately — no skeleton needed.

## Configuration

### PHP config (`config/force10.php`)

```php
return [
    'enabled' => env('FORCE10_ENABLED', true),

    'manifest_path' => resource_path('js/force10-manifest.ts'),

    'routes' => [
        'include' => [],           // Empty = all routes
        'exclude' => [
            'telescope*',
            'horizon*',
            '_debugbar*',
        ],
    ],

    'resolution' => [
        'controller_paths' => [
            app_path('Http/Controllers'),
        ],
    ],
];
```

### JS config (`initForce10()`)

```ts
import { initForce10 } from "@force10/client";
import manifest from "virtual:force10-manifest";

initForce10(manifest, {
  cache: {
    ttl: 5 * 60 * 1000, // 5 minutes (default)
    maxEntries: 50,      // Max cached pages (default)
  },
  debug: false,          // Console logging (default)
  routes: {
    exclude: [],         // URL patterns to skip
  },
});
```

## Cache Control

### Client-side (automatic)

Force10 uses a stale-while-revalidate (SWR) strategy:

- **Fresh cache** — renders cached props instantly, still fetches in background
- **Stale cache** — renders stale props instantly, refreshes on server response
- **No cache** — preserves current props, populates on server response

Cache entries expire after the configured TTL (default 5 minutes) and are evicted LRU when `maxEntries` is reached.

### Server-side invalidation (opt-in)

For mutations that should bust specific cache entries, use the `force10.cache` middleware:

```php
Route::post('/users', [UserController::class, 'store'])
    ->middleware('force10.cache:invalidate:/users/*');
```

Multiple patterns are supported:

```php
->middleware('force10.cache:invalidate:/users/*,invalidate:/dashboard')
```

## Verbose Manifest Generation

```bash
php artisan force10:generate --verbose
```

## API Reference

### `initForce10(manifest, config?)`

Initialize Force10. Call once in your app entry point. Returns a cleanup function.

```ts
const cleanup = initForce10(manifest, { debug: true });
cleanup(); // disable Force10
```

### `isForce10Loading()`

Returns `true` while a background request is in flight after an optimistic navigation.

### `Force10Config`

```ts
interface Force10Config {
  enabled: boolean;
  cache: {
    strategy: "stale-while-revalidate";
    ttl: number;
    maxEntries: number;
  };
  loading: {
    suppressProgress: boolean;
  };
  debug: boolean;
  routes: {
    exclude: string[];
  };
}
```

## Edge Cases & Limitations

- **Route closures** — `ComponentResolver` resolves `Route::inertia()`, controller `Inertia::render()` / `inertia()` calls, closures, and arrow functions. Complex conditional logic inside closures may only resolve the first `Inertia::render()` found.
- **Query strings** — Different query strings are separate cache entries (by design). `/users?page=1` and `/users?page=2` are cached independently.
- **Trailing slashes** — Normalized by the matcher. `/users/` and `/users` match the same route.
- **Conditional renders** — If a controller method has multiple `Inertia::render()` calls behind conditionals, the first one found is used.
- **Non-GET routes** — Passed through to Inertia unchanged (by design).
- **API routes** — Excluded automatically (routes in the `api` middleware group are not scanned).
- **SSR** — Force10 is a no-op during server-side rendering.
- **Back/forward** — Browser history navigation bypasses Force10 (Inertia handles popstate directly).
- **Auth middleware** — Routes with `auth` middleware are only optimistically navigated if the current page has `auth.user` in props.

## Tests

### Unit Tests (81 total)

```bash
# Run all tests from project root
bun run test

# Or individually:
bun run test:client   # Vitest — 55 tests
bun run test:php      # Pest — 26 tests
```

| Module | Tests |
|--------|-------|
| config.ts | 3 |
| cache.ts | 9 |
| matcher.ts | 11 |
| navigator.ts | 11 |
| patch.ts | 21 |
| RouteScanner.php | 5 |
| ComponentResolver.php | 8 |
| ManifestWriter.php | 5 |
| Force10CacheControl.php | 3 |
| PreloadTagGenerator.php | 5 |

### Browser Tests (Playwright)

```bash
cd test-app && bunx vite build && bunx playwright test
```

| Test | What it proves |
|------|----------------|
| **Initialization** | Force10 boots and logs `[Force10] Initialized with N routes` |
| **Slow server contrast** | Full page load with 3s server delay takes ~3s. Same delay with Force10 link click renders in ~50ms |
| **Offline navigation** | Visit Home → About (caches both). Go offline. Navigate Home → About — both render from cache |
| **Cache hit** | Navigate Home → About → Home. Second visit uses cached props |

## Development

```bash
# Run all tests
bun run test

# Client package
cd packages/client
bun run test          # Vitest
bun run build         # ESM + CJS + DTS

# Vite plugin
cd packages/vite
bun run build

# Laravel package
cd packages/laravel
./vendor/bin/pest

# Test app
cd test-app
php artisan serve --port=8000
bunx vite --port=5173
```

## License

MIT
