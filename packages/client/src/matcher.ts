import type { Force10Config, Force10Manifest, Force10Matcher, ManifestRoute, MatchResult } from './types';

interface CompiledRoute {
  route: ManifestRoute;
  regex: RegExp;
  paramNames: string[];
  specificity: number; // higher = more specific
}

/**
 * Calculate a specificity score for a route pattern.
 * Exact static segments score highest, parameterized segments score lower,
 * and wildcards score lowest.
 */
function calcSpecificity(pattern: string): number {
  const segments = pattern.split('/').filter(Boolean);
  let score = 0;
  for (const seg of segments) {
    if (seg === '*' || seg === '**') {
      score += 1;
    } else if (seg.startsWith(':')) {
      score += 2;
    } else {
      score += 3;
    }
  }
  return score;
}

/**
 * Compile a route pattern like "/users/:id" into a RegExp with named capture groups.
 * Supports:
 *   - :param (required parameter)
 *   - :param? (optional parameter)
 *   - * (catch-all wildcard)
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Split into segments
  const segments = pattern.split('/').filter(Boolean);
  let regexStr = '';

  for (const seg of segments) {
    if (seg === '*' || seg === '**') {
      // Catch-all wildcard: matches one or more segments
      regexStr += '(?:/.*)?';
    } else if (seg.startsWith(':')) {
      // Parameter segment
      const isOptional = seg.endsWith('?');
      const name = isOptional ? seg.slice(1, -1) : seg.slice(1);
      paramNames.push(name);

      if (isOptional) {
        // Optional param: the whole /segment is optional
        regexStr += `(?:/([^/]+))?`;
      } else {
        regexStr += `/([^/]+)`;
      }
    } else {
      // Static segment
      regexStr += `/${escapeRegex(seg)}`;
    }
  }

  // If the pattern is "/", handle root
  if (segments.length === 0) {
    regexStr = '';
  }

  // Allow optional trailing slash, anchor start and end
  const regex = new RegExp(`^${regexStr}/?$`);
  return { regex, paramNames };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a URL path for matching:
 * - Strip query string and hash
 * - Decode URI components
 */
function normalizePath(url: string): string {
  // Strip hash
  let path = url.split('#')[0];
  // Strip query string
  path = path.split('?')[0];
  // Decode URI-encoded segments
  try {
    path = decodeURI(path);
  } catch {
    // If decoding fails, use the original path
  }
  return path;
}

/**
 * Convert a glob-like exclude pattern to a RegExp.
 * Supports simple patterns like "/admin*" and "/api/*".
 */
function excludePatternToRegex(pattern: string): RegExp {
  let regexStr = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      regexStr += '.*';
    } else if (ch === '?') {
      regexStr += '.';
    } else {
      regexStr += escapeRegex(ch);
    }
  }
  return new RegExp(`^${regexStr}$`);
}

// Module-level regex cache: pattern string -> compiled result
const regexCache = new Map<string, { regex: RegExp; paramNames: string[] }>();

function getCompiledPattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  let compiled = regexCache.get(pattern);
  if (!compiled) {
    compiled = compilePattern(pattern);
    regexCache.set(pattern, compiled);
  }
  return compiled;
}

export function createMatcher(manifest: Force10Manifest, config: Force10Config): Force10Matcher {
  // Pre-compile all routes and sort by specificity (most specific first)
  const compiledRoutes: CompiledRoute[] = manifest.routes
    .map((route) => {
      const { regex, paramNames } = getCompiledPattern(route.pattern);
      return {
        route,
        regex,
        paramNames,
        specificity: calcSpecificity(route.pattern),
      };
    })
    .sort((a, b) => b.specificity - a.specificity);

  // Pre-compile exclude patterns
  const excludeRegexes = config.routes.exclude.map(excludePatternToRegex);

  return {
    match(url: string): MatchResult | null {
      const path = normalizePath(url);

      for (const compiled of compiledRoutes) {
        const m = compiled.regex.exec(path);
        if (m) {
          const params: Record<string, string> = {};
          for (let i = 0; i < compiled.paramNames.length; i++) {
            const value = m[i + 1];
            if (value !== undefined) {
              // Decode individual parameter values
              try {
                params[compiled.paramNames[i]] = decodeURIComponent(value);
              } catch {
                params[compiled.paramNames[i]] = value;
              }
            }
          }
          return {
            route: compiled.route,
            params,
            url,
          };
        }
      }

      return null;
    },

    isExcluded(url: string): boolean {
      const path = normalizePath(url);
      return excludeRegexes.some((regex) => regex.test(path));
    },
  };
}
