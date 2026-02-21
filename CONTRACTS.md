# Force10 — Contracts & Specifications

## Purpose

Force10 is an Inertia.js plugin that makes navigation instant. When a user clicks a link, Force10 immediately renders the target page component (with cached or empty props) using `router.push()`, then fires the real server request in the background. When the server responds, Inertia updates the props seamlessly.

## Core Mechanism

```
User clicks Link → Force10 intercepts router.visit()
  → Matches URL against manifest (URL pattern → component name)
  → Calls router.push({ component, url, props: cached || {} })  ← INSTANT
  → Fires original visit() with { async: true, replace: true }  ← BACKGROUND
  → Server response arrives → Inertia updates props normally    ← SEAMLESS
```

## Module Dependency Graph

```
types.ts ← config.ts ← debug.ts
                ↑
manifest   → matcher.ts ←─────── patch.ts → navigator.ts
(generated)                          ↑           ↑
                                     └── cache.ts ┘
                                          ↑
                                     config.ts
```

## Inertia Internals

- `router.visit(href, options)` — The main navigation method. We monkey-patch this.
- `router.push({ component, url, props })` — Client-side page swap WITHOUT server request. Used for optimistic render.
- `router.replace({ component, url, props })` — Same as push but replaces history entry.
- `router.page` — Current page object with `component`, `props`, `url`.

## Module Specifications

### types.ts
All shared TypeScript interfaces. Every module imports from here. Never modify.

### config.ts
- `defaultConfig`: Full Force10Config with sensible defaults
- `createConfig(partial?)`: Deep merges user config over defaults
- `getConfig()`: Returns current config
- `updateConfig(partial)`: Merges updates into current config

### debug.ts
- `log(message, data?)`: Console.log prefixed with `[Force10]`, only when config.debug is true
- `warn(message, data?)`: Console.warn prefixed with `[Force10]`, only when config.debug is true

### matcher.ts
- `createMatcher(manifest, config)`: Returns Force10Matcher instance
- Converts `:param` patterns to regex with named capture groups
- Caches compiled regexes
- Strips query strings and hashes before matching
- Normalizes trailing slashes
- Handles URL-encoded segments
- Handles optional params (`:param?`)
- Sorts by specificity: exact > parameterized > wildcard
- `isExcluded(url)`: Tests URL against `config.routes.exclude` patterns

### cache.ts
- `createCache(config)`: Returns Force10Cache instance
- In-memory `Map<string, CachedPage>` store
- `get(url)`: Returns cached page or null if missing/expired
- `set(url, page)`: Stores page with timestamp, triggers LRU eviction if over max
- `getOrStale(url)`: Returns page + isStale flag (stale-while-revalidate)
- `remove(url)`: Remove single entry
- `clear()`: Remove all entries
- `invalidateByPattern(pattern)`: Remove entries matching URL pattern
- `updateProps(url, props)`: Merge new props into existing entry, update timestamp

### navigator.ts
- `createNavigator(cache, config)`: Returns Force10Navigator instance
- `optimisticNavigate(match, options?)`: Calls `router.push()` with component from match and cached/empty props
- `shouldOptimisticallyNavigate(match)`: Returns false if config.enabled is false, or if route has 'auth' middleware and user is not authenticated
- Auth check: Reads `router.page.props.auth.user` — if falsy and route has 'auth' middleware, skip
- `isLoading()`: Returns true while background request is pending
- `setLoaded()`: Called by patch.ts when background request completes

### patch.ts
- `applyPatch(navigator, matcher, cache, config)`: Monkey-patches `router.visit`
- `removePatch()`: Restores original `router.visit`
- Skip conditions: non-GET, hash-only nav, same-page nav, external URLs, URL not in manifest, auth check fails
- For matched GET requests: call `navigator.optimisticNavigate()`, then call original `visit()` with `{ async: true, replace: true, showProgress: false }`
- Wraps onSuccess to update cache with real props
- Wraps onError/onFinish to clear loading state
- Preserves all original visit options and callbacks

### index.ts (entry point)
- `initForce10(config?)`: Creates all module instances, applies patch, returns cleanup function
- `isForce10Loading()`: Delegates to navigator.isLoading()
- Imports manifest from `virtual:force10-manifest`

### Vite Plugin (packages/vite)
- `force10(options?)`: Returns Vite Plugin
- Build mode: Runs `php artisan force10:generate` before build
- Dev mode: Watches route/controller files, regenerates on change with 300ms debounce
- Virtual module `virtual:force10-manifest` resolves to generated manifest file
- Default manifest path: `resources/js/force10-manifest.ts`

### Laravel Package

#### RouteScanner
- Scans all GET web routes from Laravel router
- Converts `{param}` to `:param` format
- Extracts middleware names
- Filters by config include/exclude patterns
- Returns ManifestEntry[]

#### ComponentResolver
- `resolve(route)`: Try route defaults, then controller parsing
- `resolveFromRouteDefaults(route)`: Check `$route->defaults['component']` (for Route::inertia routes)
- `resolveFromController(route)`: Parse controller file for `Inertia::render('ComponentName')` or `inertia('ComponentName')`

#### ManifestWriter
- `writeTypeScript(entries[], outputPath)`: Generates TypeScript manifest file

#### ManifestEntry
- Value object: pattern, component, middleware[], parameters[], name

#### GenerateCommand (`force10:generate`)
- Uses RouteScanner + ComponentResolver + ManifestWriter
- Outputs summary of generated routes

#### InstallCommand (`force10:install`)
- Publishes config
- Injects Vite plugin into vite.config
- Injects initForce10 into app entry point
- Adds npm dependencies

## Rules for Agents

1. ONLY modify files in your assigned scope
2. Import types from `types.ts`, never redefine them
3. Use `createX()` factory pattern — return interface, not class
4. All modules must be tree-shakeable (named exports, no side effects at module level)
5. Never import implementation from other modules — only types
