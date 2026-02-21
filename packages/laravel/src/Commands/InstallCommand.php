<?php

namespace Force10\Laravel\Commands;

use Illuminate\Console\Command;

class InstallCommand extends Command
{
    protected $signature = 'force10:install';

    protected $description = 'Install Force10 into your Laravel + Inertia application';

    public function handle(): int
    {
        $this->info('Installing Force10...');
        $this->newLine();

        // Step 1: Publish config file
        $this->components->task('Publishing config', function () {
            $this->callSilently('vendor:publish', [
                '--tag' => 'force10-config',
            ]);
        });

        // Step 2: Inject Vite plugin
        $viteInjected = false;
        $this->components->task('Configuring Vite plugin', function () use (&$viteInjected) {
            $viteInjected = $this->injectVitePlugin();
            return $viteInjected;
        });

        // Step 3: Add virtual module types to tsconfig
        $this->components->task('Configuring TypeScript types', function () {
            return $this->injectTsConfigTypes();
        });

        // Step 4: Inject initForce10 into app entry point
        $appInjected = false;
        $this->components->task('Configuring app entry point', function () use (&$appInjected) {
            $appInjected = $this->injectAppInit();
            return $appInjected;
        });

        // Step 5: Inject @force10Preload into Blade layout
        $preloadInjected = false;
        $this->components->task('Adding preload directive to layout', function () use (&$preloadInjected) {
            $preloadInjected = $this->injectPreloadDirective();
            return $preloadInjected;
        });

        // Step 6: Generate initial manifest
        $this->components->task('Generating route manifest', function () {
            return $this->callSilently('force10:generate') === 0;
        });

        // Output next steps
        $this->newLine();
        $this->components->info('Force10 installed successfully!');
        $this->newLine();

        $this->line('  <fg=gray>Next steps:</>');
        $this->line('  <fg=gray>1.</> Install npm dependencies:');
        $this->line('     <fg=yellow>npm install @force10/client force10-vite</>');

        if (! $viteInjected) {
            $this->line('  <fg=gray>2.</> Manually add the Force10 Vite plugin to your vite.config:');
            $this->line("     <fg=yellow>import force10 from 'force10-vite';</>");
            $this->line('     <fg=yellow>// Add force10() to your plugins array</>');
        }

        if (! $appInjected) {
            $nextStep = $viteInjected ? '2' : '3';
            $this->line("  <fg=gray>{$nextStep}.</> Manually add Force10 to your app entry point:");
            $this->line("     <fg=yellow>import { initForce10 } from '@force10/client';</>");
            $this->line('     <fg=yellow>initForce10();</>');
        }

        $this->newLine();

        return self::SUCCESS;
    }

    /**
     * Write a type declaration for the virtual:force10-manifest module.
     */
    protected function injectTsConfigTypes(): bool
    {
        $dtsPath = resource_path('js/force10.d.ts');

        if (file_exists($dtsPath)) {
            return true;
        }

        $content = <<<'DTS'
        declare module 'virtual:force10-manifest' {
          import type { Force10Manifest } from '@force10/client';
          const manifest: Force10Manifest;
          export default manifest;
        }
        DTS;

        file_put_contents($dtsPath, $content . "\n");

        return true;
    }

    /**
     * Detect and inject the Force10 Vite plugin into vite.config.ts or vite.config.js.
     */
    protected function injectVitePlugin(): bool
    {
        $viteConfigPath = null;

        if (file_exists(base_path('vite.config.ts'))) {
            $viteConfigPath = base_path('vite.config.ts');
        } elseif (file_exists(base_path('vite.config.js'))) {
            $viteConfigPath = base_path('vite.config.js');
        }

        if (! $viteConfigPath) {
            return false;
        }

        $contents = file_get_contents($viteConfigPath);

        // Skip if already configured
        if (str_contains($contents, 'force10')) {
            return true;
        }

        // Add import statement after the last existing import
        $importLine = "import force10 from 'force10-vite';";

        if (preg_match('/^(import\s.+;\s*\n)(?!import\s)/ms', $contents, $matches, PREG_OFFSET_CAPTURE)) {
            // Find the position right after the last import statement
            $lastImportEnd = $this->findLastImportPosition($contents);
            $contents = substr($contents, 0, $lastImportEnd) . $importLine . "\n" . substr($contents, $lastImportEnd);
        } else {
            // No imports found, add at the top
            $contents = $importLine . "\n" . $contents;
        }

        // Add force10() to the plugins array
        if (preg_match('/plugins\s*:\s*\[/', $contents, $matches, PREG_OFFSET_CAPTURE)) {
            $insertPos = $matches[0][1] + strlen($matches[0][0]);
            $contents = substr($contents, 0, $insertPos) . "\n        force10()," . substr($contents, $insertPos);
        }

        file_put_contents($viteConfigPath, $contents);

        return true;
    }

    /**
     * Find the position right after the last import statement.
     */
    protected function findLastImportPosition(string $contents): int
    {
        $lines = explode("\n", $contents);
        $lastImportLine = 0;
        $offset = 0;

        foreach ($lines as $index => $line) {
            if (preg_match('/^\s*import\s/', $line)) {
                $lastImportLine = $index;
            }
        }

        // Calculate byte offset to end of last import line
        $offset = 0;
        for ($i = 0; $i <= $lastImportLine; $i++) {
            $offset += strlen($lines[$i]) + 1; // +1 for newline
        }

        return $offset;
    }

    /**
     * Inject @force10Preload directive into the Blade layout.
     */
    protected function injectPreloadDirective(): bool
    {
        $layoutPath = resource_path('views/app.blade.php');

        if (! file_exists($layoutPath)) {
            return false;
        }

        $contents = file_get_contents($layoutPath);

        if (str_contains($contents, 'force10Preload')) {
            return true;
        }

        // Insert after @inertiaHead
        if (str_contains($contents, '@inertiaHead')) {
            $contents = str_replace('@inertiaHead', "@inertiaHead\n        @force10Preload", $contents);
            file_put_contents($layoutPath, $contents);

            return true;
        }

        // Fallback: insert before </head>
        if (str_contains($contents, '</head>')) {
            $contents = str_replace('</head>', "    @force10Preload\n    </head>", $contents);
            file_put_contents($layoutPath, $contents);

            return true;
        }

        return false;
    }

    /**
     * Detect and inject initForce10 into the app entry point.
     */
    protected function injectAppInit(): bool
    {
        $appPath = null;
        $candidates = ['app.tsx', 'app.jsx', 'app.ts'];

        foreach ($candidates as $candidate) {
            $path = resource_path("js/{$candidate}");
            if (file_exists($path)) {
                $appPath = $path;
                break;
            }
        }

        if (! $appPath) {
            return false;
        }

        $contents = file_get_contents($appPath);

        // Skip if already configured
        if (str_contains($contents, 'initForce10')) {
            return true;
        }

        // Add imports after the last existing import
        $imports = "import { initForce10 } from '@force10/client';\nimport manifest from 'virtual:force10-manifest';";

        $lastImportEnd = $this->findLastImportPosition($contents);
        $contents = substr($contents, 0, $lastImportEnd) . $imports . "\n" . substr($contents, $lastImportEnd);

        // Append initForce10 call
        $contents = rtrim($contents) . "\n\ninitForce10(manifest);\n";

        file_put_contents($appPath, $contents);

        return true;
    }
}
