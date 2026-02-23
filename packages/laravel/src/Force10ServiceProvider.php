<?php

namespace Force10\Laravel;

use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Force10\Laravel\Commands\GenerateCommand;
use Force10\Laravel\Commands\InstallCommand;
use Force10\Laravel\Middleware\Force10CacheControl;

class Force10ServiceProvider extends ServiceProvider
{
    protected ?array $manifestMiddlewareCache = null;

    public function register(): void
    {
        $this->mergeConfigFrom(
            __DIR__.'/../config/force10.php',
            'force10'
        );

        $this->app->singleton(PreflightChecker::class);
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/force10.php' => config_path('force10.php'),
        ], 'force10-config');

        /** @var Router $router */
        $router = $this->app->make(Router::class);
        $router->aliasMiddleware('force10.cache', Force10CacheControl::class);

        Blade::directive('force10Preload', function () {
            return "<?php echo app(\Force10\Laravel\PreloadTagGenerator::class)->generate(); ?>";
        });

        if ($this->app->runningInConsole()) {
            $this->commands([
                GenerateCommand::class,
                InstallCommand::class,
            ]);
        }

        if (config('force10.enabled', true) && config('force10.preflight.enabled', true) && class_exists(Inertia::class)) {
            Inertia::share('_force10', function () {
                $checker = app(PreflightChecker::class);
                $middleware = $this->getAllManifestMiddleware();

                return [
                    'preflight' => $checker->evaluate(request(), $middleware),
                ];
            });
        }
    }

    protected function getAllManifestMiddleware(): array
    {
        if ($this->manifestMiddlewareCache !== null) {
            return $this->manifestMiddlewareCache;
        }

        $manifestPath = config('force10.manifest_path');

        if (!$manifestPath || !file_exists($manifestPath)) {
            $this->manifestMiddlewareCache = [];
            return [];
        }

        $content = file_get_contents($manifestPath);
        $middleware = [];

        // Extract middleware arrays from the TS manifest
        if (preg_match_all("/middleware:\s*\[([^\]]*)\]/", $content, $matches)) {
            foreach ($matches[1] as $match) {
                if (preg_match_all("/'([^']+)'/", $match, $items)) {
                    $middleware = array_merge($middleware, $items[1]);
                }
            }
        }

        $this->manifestMiddlewareCache = array_unique($middleware);
        return $this->manifestMiddlewareCache;
    }
}
