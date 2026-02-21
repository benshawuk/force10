<?php

namespace Force10\Laravel\Commands;

use Illuminate\Console\Command;
use Illuminate\Routing\Route;
use Force10\Laravel\RouteScanner;
use Force10\Laravel\ComponentResolver;
use Force10\Laravel\ManifestWriter;

class GenerateCommand extends Command
{
    protected $signature = 'force10:generate
        {--path= : Output path for manifest}';

    protected $description = 'Generate the Force10 route manifest';

    public function handle(): int
    {
        $resolver = $this->laravel->make(ComponentResolver::class);
        $scanner = $this->laravel->make(RouteScanner::class, [
            'resolver' => $resolver,
        ]);
        $writer = $this->laravel->make(ManifestWriter::class);

        $routesConfig = config('force10.routes', []);

        if ($this->output->isVerbose()) {
            $this->verboseGenerate($scanner, $resolver, $writer, $routesConfig);
        } else {
            $entries = $scanner->buildManifest($routesConfig);
            $outputPath = $this->option('path') ?? config('force10.manifest_path');
            $writer->writeTypeScript($entries, $outputPath);

            $count = count($entries);
            $this->info("Generated {$count} routes to {$outputPath}");
        }

        return self::SUCCESS;
    }

    protected function verboseGenerate(
        RouteScanner $scanner,
        ComponentResolver $resolver,
        ManifestWriter $writer,
        array $routesConfig,
    ): void {
        $allRoutes = $scanner->scan();
        $filteredRoutes = $scanner->filterByConfig($allRoutes, $routesConfig['routes'] ?? []);

        $included = [];
        $skipped = [];

        foreach ($filteredRoutes as $route) {
            $component = $resolver->resolve($route);
            $uri = $route->uri();

            if ($component !== null) {
                $included[] = [$uri, $component];
            } else {
                $reason = $this->diagnoseSkipReason($route);
                $skipped[] = [$uri, $reason];
            }
        }

        // Also show routes excluded by config filter
        $excludedByConfig = array_udiff($allRoutes, $filteredRoutes, function (Route $a, Route $b) {
            return strcmp($a->uri(), $b->uri());
        });

        foreach ($excludedByConfig as $route) {
            $skipped[] = [$route->uri(), 'Excluded by config filter'];
        }

        // Build and write manifest from included routes
        $entries = $scanner->buildManifest($routesConfig);
        $outputPath = $this->option('path') ?? config('force10.manifest_path');
        $writer->writeTypeScript($entries, $outputPath);

        // Output results
        $this->info('Included routes ('.count($included).'):');
        foreach ($included as [$uri, $component]) {
            $this->line("  <fg=green>+</> {$uri} → {$component}");
        }

        if (! empty($skipped)) {
            $this->newLine();
            $this->warn('Skipped routes ('.count($skipped).'):');
            foreach ($skipped as [$uri, $reason]) {
                $this->line("  <fg=yellow>-</> {$uri} — {$reason}");
            }
        }

        $this->newLine();
        $this->info("Generated ".count($entries)." routes to {$outputPath}");
    }

    protected function diagnoseSkipReason(Route $route): string
    {
        $action = $route->getAction();
        $uses = $action['uses'] ?? null;

        if ($uses instanceof \Closure) {
            return 'No Inertia::render() or inertia() call found in closure';
        }

        if ($uses === null) {
            return 'No action defined';
        }

        if (! is_string($uses)) {
            return 'Non-string action';
        }

        return 'No Inertia::render() or inertia() call found in controller method';
    }
}
