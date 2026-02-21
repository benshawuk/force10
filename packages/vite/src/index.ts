import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Force10ViteOptions {
  /** Path to output the generated manifest file */
  manifestPath?: string;
  /** File patterns to watch for changes (glob) */
  watch?: string[];
  /** Path to pages directory relative to project root (default: resources/js/pages) */
  pagesDirectory?: string;
}

const VIRTUAL_MODULE_ID = 'virtual:force10-manifest';
const RESOLVED_VIRTUAL_MODULE_ID = '\0virtual:force10-manifest';

const DEFAULT_MANIFEST_PATH = 'resources/js/force10-manifest.ts';
const DEFAULT_PAGES_DIRECTORY = 'resources/js/pages';
const DEFAULT_WATCH_PATTERNS = [
  'routes/*.php',
  'app/Http/Controllers/**/*.php',
];
const PAGE_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js', 'vue'];

/**
 * Resolve a component name (e.g. "dashboard" or "settings/profile") to its
 * file path relative to the project root. Returns null if no file found.
 */
function resolveComponentFile(
  root: string,
  pagesDir: string,
  component: string,
): string | null {
  for (const ext of PAGE_EXTENSIONS) {
    const relPath = `${pagesDir}/${component}.${ext}`;
    if (existsSync(resolve(root, relPath))) {
      return relPath;
    }
  }
  return null;
}

/**
 * Extract component names from the manifest file content.
 */
function extractComponents(content: string): string[] {
  const matches = [...content.matchAll(/component:\s*'([^']+)'/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Generate the preload function code with static import() calls for each component.
 * These imports tell the browser to download component chunks in the background.
 */
function generatePreloadCode(
  root: string,
  pagesDir: string,
  components: string[],
): string {
  const imports: string[] = [];

  for (const component of components) {
    const filePath = resolveComponentFile(root, pagesDir, component);
    if (filePath) {
      imports.push(`    import('/${filePath}');`);
    }
  }

  if (imports.length === 0) {
    return '';
  }

  return `\n_manifest.preload = function() {\n${imports.join('\n')}\n};\n`;
}

function generateManifest(root: string): boolean {
  try {
    const output = execSync('php artisan force10:generate', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Extract route count from artisan output (e.g. "Generated 12 routes to ...")
    const match = output.match(/(\d+)\s+routes?/);
    const count = match ? match[1] : '?';
    console.log(`[force10] Manifest generated (${count} routes)`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[force10] Failed to generate manifest: ${message}`);
    return false;
  }
}

export default function force10(options?: Force10ViteOptions): Plugin {
  let config: ResolvedConfig;
  let root: string;
  let manifestPath: string;
  let pagesDir: string;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watchPatterns = options?.watch ?? DEFAULT_WATCH_PATTERNS;

  return {
    name: 'force10',

    config() {
      return {
        resolve: {
          dedupe: ['@inertiajs/core'],
        },
      };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      root = config.root;
      manifestPath = resolve(
        root,
        options?.manifestPath ?? DEFAULT_MANIFEST_PATH,
      );
      pagesDir = options?.pagesDirectory ?? DEFAULT_PAGES_DIRECTORY;
    },

    buildStart() {
      generateManifest(root);
    },

    configureServer(server: ViteDevServer) {
      // Watch route and controller files for changes
      for (const pattern of watchPatterns) {
        server.watcher.add(pattern);
      }

      const handleChange = (filePath: string) => {
        // Check if the changed file matches any of our watch patterns
        const isWatchedFile = watchPatterns.some((pattern) => {
          // Convert glob pattern to a simple check
          // routes/*.php -> file is in routes/ and ends with .php
          // app/Http/Controllers/**/*.php -> file is under app/Http/Controllers/ and ends with .php
          const parts = pattern.split('*');
          const prefix = parts[0];
          const suffix = parts[parts.length - 1];
          return filePath.includes(prefix) && filePath.endsWith(suffix);
        });

        if (!isWatchedFile) return;

        // Debounce regeneration
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          const success = generateManifest(root);
          if (success) {
            // Trigger HMR full-reload so the virtual module is re-evaluated
            server.ws.send({ type: 'full-reload', path: '*' });
          }
        }, 300);
      };

      server.watcher.on('change', handleChange);
      server.watcher.on('add', handleChange);
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    load(id: string) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        if (!existsSync(manifestPath)) {
          console.warn(
            `[force10] Manifest file not found at ${manifestPath}. Run "php artisan force10:generate" first.`,
          );
          return 'export default { routes: [] };';
        }

        try {
          const rawContent = readFileSync(manifestPath, 'utf-8');

          // Extract component names and generate preload imports
          const components = extractComponents(rawContent);
          const preloadCode = generatePreloadCode(root, pagesDir, components);

          if (!preloadCode) {
            return rawContent;
          }

          // Transform: `export default { ... };` → `const _manifest = { ... }; ... export default _manifest;`
          const content = rawContent.replace(
            'export default',
            'const _manifest =',
          );

          return `${content}\n${preloadCode}\nexport default _manifest;\n`;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(`[force10] Failed to read manifest: ${message}`);
          return 'export default { routes: [] };';
        }
      }
    },
  };
}
