/**
 * Force10 Configuration
 */
export interface Force10Config {
  /** Whether Force10 is enabled */
  enabled: boolean;
  /** Cache configuration */
  cache: {
    /** Cache strategy: 'stale-while-revalidate' always shows cached then refreshes */
    strategy: 'stale-while-revalidate';
    /** Time-to-live in milliseconds before cache entries are considered stale */
    ttl: number;
    /** Maximum number of cached pages */
    maxEntries: number;
  };
  /** Loading behavior configuration */
  loading: {
    /** Whether to suppress Inertia's progress bar during background requests */
    suppressProgress: boolean;
  };
  /** Enable debug logging to console */
  debug: boolean;
  /** Route filtering */
  routes: {
    /** URL patterns to exclude from optimistic navigation (glob-like) */
    exclude: string[];
  };
}

/**
 * A single route entry from the generated manifest
 */
export interface ManifestRoute {
  /** URL pattern with :param placeholders (e.g. "/users/:id") */
  pattern: string;
  /** Inertia page component name (e.g. "Users/Show") */
  component: string;
  /** Route middleware names (e.g. ["auth", "verified"]) */
  middleware: string[];
  /** Route parameter definitions */
  parameters: RouteParameter[];
}

export interface RouteParameter {
  name: string;
  required: boolean;
}

/**
 * The generated route manifest
 */
export interface Force10Manifest {
  routes: ManifestRoute[];
  /** Preload all page component chunks. Injected by the Vite plugin. */
  preload?: () => void;
}

/**
 * A cached page entry
 */
export interface CachedPage {
  /** The cached page props */
  props: Record<string, unknown>;
  /** Timestamp when this entry was cached */
  timestamp: number;
  /** The URL this entry was cached for */
  url: string;
  /** The component name */
  component: string;
}

/**
 * Result of matching a URL against the manifest
 */
export interface MatchResult {
  /** The matched manifest route */
  route: ManifestRoute;
  /** Extracted URL parameters (e.g. { id: "5" }) */
  params: Record<string, string>;
  /** The matched URL */
  url: string;
}

/**
 * Cache module interface
 */
export interface Force10Cache {
  /** Get a cached page, or null if not found or expired */
  get(url: string): CachedPage | null;
  /** Store a page in the cache */
  set(url: string, page: CachedPage): void;
  /** Remove a specific cache entry */
  remove(url: string): void;
  /** Clear all cache entries */
  clear(): void;
  /** Get a cached page even if stale, with isStale flag */
  getOrStale(url: string): { page: CachedPage; isStale: boolean } | null;
  /** Remove all entries matching a URL pattern */
  invalidateByPattern(pattern: string): void;
  /** Update props for an existing cached entry */
  updateProps(url: string, props: Record<string, unknown>): void;
}

/**
 * Route matcher interface
 */
export interface Force10Matcher {
  /** Match a URL against the manifest, returning the matched route and params */
  match(url: string): MatchResult | null;
  /** Check if a URL is excluded from optimistic navigation */
  isExcluded(url: string): boolean;
}

/**
 * Navigator interface — performs the optimistic page swap
 */
export interface Force10Navigator {
  /** Perform an optimistic navigation using router.push/replace */
  optimisticNavigate(match: MatchResult, options?: NavigateOptions): void;
  /** Check if optimistic navigation should be performed for this match */
  shouldOptimisticallyNavigate(match: MatchResult): boolean;
  /** Whether a background request is currently pending */
  isLoading(): boolean;
  /** Mark navigation as complete (called by patch when background request finishes) */
  setLoaded(): void;
}

export interface NavigateOptions {
  preserveScroll?: boolean;
  preserveState?: boolean;
  replace?: boolean;
}

/**
 * Router patch interface
 */
export interface Force10Patch {
  /** Apply the router.visit monkey-patch */
  apply(): void;
  /** Remove the patch and restore original router.visit */
  remove(): void;
}
